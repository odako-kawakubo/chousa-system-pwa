/**
 * 案件内の棟追加を確定する業務入口。
 * Firestoreで採番が成功した後、現在の端末の案件Snapshotと初期仕上表へ反映する。
 * 仕上表UIやレビュー公開の責務は持たない。
 */
import { getCurrentProject, getProject, updateProjectFields } from './project-store.js';
import { normalizeProjectBuildings, normalizeBuildingId } from './project-buildings.js';
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

export async function addBuildingForCurrentProject(name = '') {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return { ok: false, reason: 'project-not-available' };
  const reserved = await reserveNextBuildingForProject(project, name);
  if (!reserved.ok) return reserved;

  // トランザクションが並行端末の変更を確定した場合も、既知の棟を消さない。
  const latest = getProject(project.projectId)?.project || project;
  const knownBuildings = normalizeProjectBuildings(latest.buildings);
  const buildings = {
    A: knownBuildings.A || { name: 'A棟', order: 1 },
    ...knownBuildings,
    [reserved.buildingId]: reserved.definition
  };
  updateProjectFields(project.projectId, { buildings });
  // 棟採番の通信待ち中に別案件へ移動していたら、その案件のStoreを変更しない。
  if (getCurrentProject()?.projectId === project.projectId) {
    ensureDeclaredBuildingFinishRecords({ buildings });
  }

  return { ok: true, buildingId: reserved.buildingId, definition: reserved.definition };
}

/** 既存の棟名のみを更新する。棟IDと仕上IDは変更しない。 */
export async function renameBuildingForCurrentProject(rawId, rawName) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return { ok: false, reason: 'project-not-available' };
  const buildingId = normalizeBuildingId(rawId) || (String(rawId || '').trim() === '' ? 'A' : '');
  const name = String(rawName || '').trim();
  if (!buildingId || !name) return { ok: false, reason: 'invalid-building-name' };

  const latest = getProject(project.projectId)?.project || project;
  const known = normalizeProjectBuildings(latest.buildings);
  if (buildingId !== 'A' && !known[buildingId]) return { ok: false, reason: 'building-not-found' };
  const definition = { ...(known[buildingId] || { name: 'A棟', order: 1 }), name };
  const buildings = { ...known, [buildingId]: definition };
  const patch = { buildings: { [buildingId]: { name } } };
  // オフライン中・送信待ちもローカル編集を保護する。
  putUnsent({
    projectId: project.projectId,
    environment: project.environment === 'test' ? 'test' : 'production',
    recordType: 'project',
    recordId: project.projectId,
    operation: 'set',
    record: patch,
    meta: { partialProjectMetadata: true }
  });
  updateProjectFields(project.projectId, { buildings });
  const result = await persistProjectMetadataForProject(project, { patch });
  return { ...result, buildingId, definition };
}
