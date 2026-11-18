/**
 * 棟追加・名称変更の業務入口。入力検証とローカル反映は全案件共通。
 * 採番と同期のみ案件種別で切り替え、サンプルは外部保存しない。
 */
import { getCurrentProject, getProject, updateProjectFields } from './project-store.js';
import { normalizeProjectBuildings, normalizeBuildingId, nextBuildingId, makeBuildingDefinition } from './project-buildings.js';
import { persistProjectMetadataForProject } from '../sync/project-record-persistence.js';
import { putUnsent, listUnsent } from '../sync/unsent-queue.js';
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

/** 未送信キューが端末へ永続化されたことを再読込で確認する。 */
function queueBuildingMetadata(project, buildingId, patch) {
  const projectId = String(project.projectId);
  putUnsent({
    projectId,
    environment:project.environment === 'test' ? 'test' : 'production',
    recordType:'project', recordId:projectId,
    operation:'set', record:patch,
    meta:{partialProjectMetadata:true}
  });
  const saved = listUnsent({ projectId }).find((item) => item.recordType === 'project');
  if (saved?.record?.buildings?.[buildingId]?.name !== patch.buildings?.[buildingId]?.name) {
    throw new Error('棟情報の端末保存に失敗しました。端末の空き容量を確認してください。');
  }
}

function currentBuildingMetadata(project) {
  const latest = getProject(project.projectId)?.project || project;
  return normalizeProjectBuildings(latest.buildings);
}

/** ローカル採番済みの棟定義を案件情報と仕上表へ反映する。 */
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

  // 部屋・階と同様に端末内の最新状態で採番する。複数端末の同時追加は運用で回避する。
  const buildingId = nextBuildingId({ buildings:currentBuildingMetadata(project) });
  if (!buildingId) return { ok:false, reason:'building-limit-reached' };
  const definition = makeBuildingDefinition(buildingId, name);
  const patch = { buildings:{ [buildingId]:definition } };

  // 同期前にキューを確保し、直後に画面／案件Snapshotへ反映する。
  // 既存の建材・仕上・写真IDは再採番しない。
  if (!project.isSample) {
    queueBuildingMetadata(project, buildingId, patch);
  }
  commitBuildingDefinition(project, buildingId, definition);

  if (project.isSample) return { ok:true, buildingId, definition, localOnly:true };
  const result = await persistProjectMetadataForProject(project, { patch });
  // 未送信がある場合もローカル作成は成功している。
  return { ok:true, buildingId, definition, synced:Boolean(result?.ok),
    queued:!result?.ok, syncReason:result?.reason || '' };
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
  queueBuildingMetadata(project, buildingId, patch);
  updateProjectFields(project.projectId, { buildings });
  const result = await persistProjectMetadataForProject(project, { patch });
  return { ...result, buildingId, definition };
}
