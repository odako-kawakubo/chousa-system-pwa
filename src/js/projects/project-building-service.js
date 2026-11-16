/**
 * 棟追加・名称変更の業務入口。入力検証とローカル反映は全案件共通。
 * 採番と同期のみ案件種別で切り替え、サンプルは外部保存しない。
 */
import { getCurrentProject, getProject, updateProjectFields } from './project-store.js';
import { normalizeProjectBuildings, normalizeBuildingId, nextBuildingId, makeBuildingDefinition } from './project-buildings.js';
import { reserveNextBuildingForProject, persistProjectMetadataForProject } from '../sync/project-record-persistence.js';
import { putUnsent } from '../sync/unsent-queue.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import * as finishRecordStore from '../store/finish-record-store.js';

export function ensureDeclaredBuildingFinishRecords(project, { notify = true } = {}) {
  const buildings = normalizeProjectBuildings(project?.buildings);
  const records = new Map(finishRecordStore.getAll().map((record) => [record.finishId, record]));
  let added = 0;
  for (const buildingId of Object.keys(buildings)) {
    if (buildingId === 'A') continue;
    for (const record of createDefaultFinishRecords(buildingId)) {
      if (records.has(record.finishId)) continue;
      records.set(record.finishId, record);
      added += 1;
    }
  }
  if (added) finishRecordStore.replaceAll([...records.values()], { notify });
  return added;
}

function currentProjectForMutation() {
  const project = getCurrentProject();
  return project?.projectId ? project : null;
}

function currentBuildingMetadata(project) {
  const latest = getProject(project.projectId)?.project || project;
  return normalizeProjectBuildings(latest.buildings);
}

/** 通常案件の採番はFirestoreのトランザクション、サンプルはローカル採番。 */
async function reserveBuilding(project, name) {
  if (!project.isSample) return reserveNextBuildingForProject(project, name);
  const buildingId = nextBuildingId(project);
  if (!buildingId) return { ok:false, reason:'building-limit-reached' };
  return { ok:true, buildingId, definition:makeBuildingDefinition(buildingId, name) };
}

/** 採番方式によらず棟定義を1経路で反映する。 */
function commitBuildingDefinition(project, buildingId, definition) {
  const known = currentBuildingMetadata(project);
  const buildings = {
    A:known.A || {name:'A棟',order:1},
    ...known,
    [buildingId]:definition
  };
  updateProjectFields(project.projectId, { buildings });
  // 非同期の採番待ちの間に別案件を開いた場合、その案件のRecord Storeには触れない。
  if (getCurrentProject()?.projectId === project.projectId) {
    ensureDeclaredBuildingFinishRecords({ buildings });
  }
  return buildings;
}

export async function addBuildingForCurrentProject(name = '') {
  const project = currentProjectForMutation();
  if (!project) return { ok:false, reason:'project-not-available' };
  const reserved = await reserveBuilding(project, name);
  if (!reserved.ok) return reserved;
  commitBuildingDefinition(project, reserved.buildingId, reserved.definition);
  return { ok:true, buildingId:reserved.buildingId, definition:reserved.definition,
    ...(project.isSample ? {localOnly:true} : {}) };
}

/** 棟名のみ変更し、既存の棟ID・仕上IDを保持する。 */
export async function renameBuildingForCurrentProject(rawId, rawName) {
  const project = currentProjectForMutation();
  if (!project) return { ok:false, reason:'project-not-available' };
  const buildingId = normalizeBuildingId(rawId) || (String(rawId || '').trim() === '' ? 'A' : '');
  const name = String(rawName || '').trim();
  if (!buildingId || !name) return { ok:false, reason:'invalid-building-name' };

  const known = currentBuildingMetadata(project);
  if (buildingId !== 'A' && !known[buildingId]) return { ok:false, reason:'building-not-found' };
  const definition = { ...(known[buildingId] || {name:'A棟',order:1}), name };
  const buildings = { ...known, [buildingId]:definition };
  if (project.isSample) {
    updateProjectFields(project.projectId, { buildings });
    return { ok:true, buildingId, definition, localOnly:true };
  }

  const patch = { buildings:{ [buildingId]:{name} } };
  // 通常案件はオフライン中も編集内容を保護する。
  putUnsent({
    projectId:project.projectId,
    environment:project.environment === 'test' ? 'test' : 'production',
    recordType:'project', recordId:project.projectId,
    operation:'set', record:patch,
    meta:{partialProjectMetadata:true}
  });
  updateProjectFields(project.projectId, { buildings });
  const result = await persistProjectMetadataForProject(project, { patch });
  return { ...result, buildingId, definition };
}
