/**
 * src/js/sync/project-record-persistence.js
 *
 * v0.1.6.2C 3レコードの保存・復元共通入口。
 * finishRecordは案件の仕上表構造として全件保持する。
 */

import {
  saveFinishRecord,
  deleteFinishRecord,
  saveFinishRecordsBatch,
  saveMaterialRecord,
  savePhotoRecord,
  saveProjectMetadata,
  readTemporaryProjectNos,
  readProjectRecords,
  deleteTestProjectCompletely
} from '../firestore/firestore-repository.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import { createMaterialRecord, colorForInputId } from '../records/material-record.js';
import { createFinishRecord, nextRoomUid } from '../records/finish-record.js';
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

export function deleteFinishForProject(project, record) {
  if (!shouldSyncProject(project) || !record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => deleteFinishRecord({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    record
  }));
}

export function persistFinishStructureForProject(project, records) {
  if (!shouldSyncProject(project) || !Array.isArray(records) || !records.length) {
    return Promise.resolve({ ok: true, skipped: true, count: 0 });
  }
  return enqueue(() => saveFinishRecordsBatch({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    records
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

export function persistProjectMetadataForProject(project) {
  if (!shouldSyncProject(project)) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => saveProjectMetadata(project));
}



/** テスト案件だけFirestoreから完全削除する。 */
export function deleteTestProjectFromFirestore(project) {
  if (!project?.projectId || project.isSample || projectEnvironment(project) !== 'test') {
    return Promise.resolve({ ok: true, skipped: true });
  }
  return enqueue(() => deleteTestProjectCompletely(project.projectId));
}

export async function getRemoteTemporaryProjectNos(dateCode, environment = 'production') {
  return readTemporaryProjectNos(dateCode, environment);
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

function hydrateFinishRecords(rawRecords = [], materialById = new Map()) {
  const roomUidByKey = new Map();
  return rawRecords
    .filter((raw) => raw && (raw.finishId || raw.id))
    .slice()
    .sort((a, b) => String(a.finishId || a.id || '').localeCompare(String(b.finishId || b.id || ''), 'ja', { numeric: true }))
    .map((raw) => {
      const finishId = String(raw.finishId || raw.id || '');
      const roomKey = `${String(raw.areaCode || '')}|${String(raw.roomPosition || '')}`;
      if (!roomUidByKey.has(roomKey)) roomUidByKey.set(roomKey, nextRoomUid());
      const material = materialById.get(String(raw.materialId || ''));
      return createFinishRecord({
        ...raw,
        finishId,
        inputId: material ? String(material.inputId) : '',
        status: 'active',
        roomUid: roomUidByKey.get(roomKey),
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
 * v0.1.6.2C案件復元。
 * C以降はFirestoreのfinishRecords全件を現在の仕上表構造として扱う。
 * 旧A/B案件の差分保存データは、456件未満ならdefaultへ重ねて一度だけ全件化する。
 */
export async function loadProjectRecordsFromFirestore(project) {
  if (!shouldSyncProject(project)) return null;

  await flushPendingWrites();

  const remote = await readProjectRecords({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    backupAt: null
  });

  const unsent = listUnsent({ projectId: project.projectId });

  const unsentMaterials = unsent.filter((item) => item.recordType === 'material' && item.operation === 'set' && item.record);
  const materialRawMap = new Map(remote.materialRecords.map((record) => [String(record.materialId || record.id || ''), record]));
  unsentMaterials.forEach((item) => materialRawMap.set(String(item.recordId), item.record));
  const materials = hydrateMaterialRecords(Array.from(materialRawMap.values()));
  const materialById = new Map(materials.map((record) => [record.materialId, record]));

  const defaultRecords = createDefaultFinishRecords();
  const isLegacySparse = remote.finishRecords.length > 0 && remote.finishRecords.length < defaultRecords.length;
  let finishRaw;

  if (!remote.finishRecords.length) {
    // Firestore未登録の旧ローカル案件。ローカル保険は呼び出し側で利用する。
    finishRaw = [];
  } else if (isLegacySparse) {
    const merged = new Map(defaultRecords.map((record) => [record.finishId, record]));
    remote.finishRecords.forEach((raw) => merged.set(String(raw.finishId || raw.id || ''), raw));
    finishRaw = Array.from(merged.values());
  } else {
    finishRaw = remote.finishRecords;
  }

  const finishRawMap = new Map(finishRaw.map((record) => [String(record.finishId || record.id || ''), record]));

  // 未送信の最新ローカル状態をFirestore読込後に重ねる。
  // 最後に全件まとめてhydrateし、同じ部屋のroomUidを必ず共有させる。
  unsent.filter((item) => item.recordType === 'finish').forEach((item) => {
    const finishId = String(item.recordId || '');
    if (!finishId) return;
    if (item.operation === 'delete') {
      finishRawMap.delete(finishId);
      return;
    }
    if (item.record) finishRawMap.set(finishId, item.record);
  });

  const finishes = hydrateFinishRecords(Array.from(finishRawMap.values()), materialById);

  // A/Bの差分方式案件は、Cで開いた時点で現在形を全件Firestoreへ移行する。
  if (isLegacySparse && finishes.length) {
    persistFinishStructureForProject(project, finishes);
  }

  const unsentPhotos = unsent.filter((item) => item.recordType === 'photo' && item.operation === 'set' && item.record);
  const photoRawMap = new Map(remote.photoRecords.map((record) => [String(record.photoId || record.id || ''), record]));
  unsentPhotos.forEach((item) => photoRawMap.set(String(item.recordId), item.record));
  const photos = hydratePhotoRecords(Array.from(photoRawMap.values()));

  return {
    finishRecords: finishes,
    materialRecords: materials,
    photoRecords: photos
  };
}
