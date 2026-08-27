/**
 * src/js/sync/project-record-persistence.js
 *
 * v0.1.6.2B 仕上表＋建材＋写真の1端末保存・復元をつなぐ共通入口。
 * UI側はFirestore Repositoryを直接呼ばず、このモジュール経由で保存する。
 * 保存要求は1本のPromiseチェーンへ積み、同一端末内で確定順が逆転しないようにする。
 */

import { saveFinishRecord, saveMaterialRecord, savePhotoRecord, readProjectRecords } from '../firestore/firestore-repository.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import { createMaterialRecord, colorForInputId } from '../records/material-record.js';
import { createPhotoRecord } from '../records/photo-record.js';
import { listUnsent } from './unsent-queue.js';

let writeChain = Promise.resolve();

function projectEnvironment(project) {
  return project?.environment === 'test' ? 'test' : 'production';
}

function shouldSyncProject(project) {
  return Boolean(project?.projectId) && !project.isSample;
}

function enqueue(run) {
  const next = writeChain.then(run, run);
  // 後続要求を止めないため、チェーン本体は失敗を吸収して継続する。
  writeChain = next.catch(() => undefined);
  return next;
}

export function persistFinishForProject(project, record) {
  if (!shouldSyncProject(project) || !record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => saveFinishRecord({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    record
  }));
}

export function persistMaterialForProject(project, record) {
  if (!shouldSyncProject(project) || !record?.materialId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => saveMaterialRecord({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    record
  }));
}

export function persistPhotoForProject(project, record) {
  if (!shouldSyncProject(project) || !record?.photoId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => savePhotoRecord({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    record
  }));
}

/** 現在までにこの端末で積まれた書込要求が終わるまで待つ。 */
export async function flushPendingWrites() {
  await writeChain;
}

function inputIdFromMaterialId(materialId, fallbackIndex) {
  const match = /^R(\d+)$/.exec(String(materialId || ''));
  if (match) return Number(match[1]);
  return fallbackIndex + 1;
}

function hydrateMaterialRecords(rawRecords = []) {
  return rawRecords
    .slice()
    .sort((a, b) => String(a.materialId || a.id || '').localeCompare(String(b.materialId || b.id || '')))
    .map((raw, index) => {
      const materialId = String(raw.materialId || raw.id || '');
      const inputId = inputIdFromMaterialId(materialId, index);
      return createMaterialRecord({
        ...raw,
        materialId,
        inputId,
        materialNo: index + 1,
        color: colorForInputId(inputId),
        updatedAt: raw.updatedAt || '',
        fieldEditedAt: raw.fieldEditedAt || {}
      });
    });
}


function hydratePhotoRecords(rawRecords = []) {
  return rawRecords
    .slice()
    .sort((a, b) => String(a.photoId || a.id || '').localeCompare(String(b.photoId || b.id || ''), 'ja', { numeric: true }))
    .map((raw) => createPhotoRecord({
      ...raw,
      photoId: String(raw.photoId || raw.id || ''),
      syncStatus: raw.syncStatus || 'synced',
      updatedAt: raw.updatedAt || '',
      fieldEditedAt: raw.fieldEditedAt || {}
    }));
}

/**
 * バックアップなし案件のB段階復元。
 * default仕上表を土台に、Firestoreに現在存在するfinish差分を上書きする。
 * materialはFirestore一式から再構築する。
 */
export async function loadProjectRecordsFromFirestore(project) {
  if (!shouldSyncProject(project)) return null;

  // 切替直前の編集確定writeが残っている場合、先に完了させてから読み戻す。
  await flushPendingWrites();

  const remote = await readProjectRecords({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    backupAt: null
  });

  // Firestoreへまだ反映できていない端末内変更は、読込時にも絶対に捨てない。
  // remoteへ同じIDが存在しても、未送信の最新ローカル状態を最後に重ねる。
  const unsent = listUnsent({ projectId: project.projectId });
  const unsentMaterials = unsent.filter((item) => item.recordType === 'material' && item.operation === 'set' && item.record);
  const materialRawMap = new Map(remote.materialRecords.map((record) => [String(record.materialId || record.id || ''), record]));
  unsentMaterials.forEach((item) => materialRawMap.set(String(item.recordId), item.record));

  const materials = hydrateMaterialRecords(Array.from(materialRawMap.values()));
  const materialById = new Map(materials.map((record) => [record.materialId, record]));

  const finishMap = new Map(createDefaultFinishRecords().map((record) => [record.finishId, record]));
  remote.finishRecords.forEach((raw) => {
    const finishId = String(raw.finishId || raw.id || '');
    if (!finishId) return;
    const baseline = finishMap.get(finishId);
    const material = materialById.get(String(raw.materialId || ''));
    finishMap.set(finishId, {
      ...(baseline || {}),
      ...raw,
      finishId,
      inputId: material ? String(material.inputId) : '',
      status: baseline?.status || 'active',
      roomUid: baseline?.roomUid || raw.roomUid || ''
    });
  });

  // 未送信finishはFirestore現在値より後に適用する。
  // deleteは「初期状態へ戻したがFirestore削除が未完了」を意味するためdefaultを維持する。
  unsent.filter((item) => item.recordType === 'finish').forEach((item) => {
    const finishId = String(item.recordId || '');
    if (!finishId) return;
    if (item.operation === 'delete') {
      const baseline = createDefaultFinishRecords().find((record) => record.finishId === finishId);
      if (baseline) finishMap.set(finishId, baseline);
      return;
    }
    if (!item.record) return;
    const material = materialById.get(String(item.record.materialId || ''));
    const baseline = finishMap.get(finishId);
    finishMap.set(finishId, {
      ...(baseline || {}),
      ...item.record,
      finishId,
      inputId: material ? String(material.inputId) : String(item.record.inputId || '')
    });
  });

  const unsentPhotos = unsent.filter((item) => item.recordType === 'photo' && item.operation === 'set' && item.record);
  const photoRawMap = new Map(remote.photoRecords.map((record) => [String(record.photoId || record.id || ''), record]));
  unsentPhotos.forEach((item) => photoRawMap.set(String(item.recordId), item.record));
  const photos = hydratePhotoRecords(Array.from(photoRawMap.values()));

  return {
    finishRecords: Array.from(finishMap.values()),
    materialRecords: materials,
    photoRecords: photos
  };
}
