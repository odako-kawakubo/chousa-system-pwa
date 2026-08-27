/**
 * src/js/sync/project-record-persistence.js
 *
 * v0.1.6.2E 3レコードの保存・復元共通入口。
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
  subscribeProjectRecords,
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


/**
 * 案件を開いたままFirestoreの変更を受け取るための購読入口。
 * 初回snapshotは3Recordをまとめてhydrateし、以後は差分changeだけ返す。
 */
export function subscribeProjectRecordsForProject(project, { onInitial, onChanges, onError } = {}) {
  if (!shouldSyncProject(project)) {
    onInitial?.({ finishRecords: [], materialRecords: [], photoRecords: [] });
    return () => {};
  }

  const projectId = String(project.projectId);
  const environment = projectEnvironment(project);

  return subscribeProjectRecords({
    projectId,
    environment,
    onInitial: (raw) => {
      const unsent = listUnsent({ projectId });

      const materialRawMap = new Map((raw.materialRecords || []).map((record) => [String(record.materialId || record.id || ''), record]));
      unsent
        .filter((item) => item.recordType === 'material' && item.operation === 'set' && item.record)
        .forEach((item) => materialRawMap.set(String(item.recordId), item.record));
      const materials = hydrateMaterialRecords(Array.from(materialRawMap.values()));
      const materialById = new Map(materials.map((record) => [record.materialId, record]));

      const defaultRecords = createDefaultFinishRecords();
      const remoteFinish = raw.finishRecords || [];
      const isLegacySparse = remoteFinish.length > 0 && remoteFinish.length < defaultRecords.length;
      const finishRawMap = new Map(
        (isLegacySparse
          ? (() => {
              const merged = new Map(defaultRecords.map((record) => [record.finishId, record]));
              remoteFinish.forEach((record) => merged.set(String(record.finishId || record.id || ''), record));
              return Array.from(merged.values());
            })()
          : remoteFinish
        ).map((record) => [String(record.finishId || record.id || ''), record])
      );
      unsent.filter((item) => item.recordType === 'finish').forEach((item) => {
        const finishId = String(item.recordId || '');
        if (!finishId) return;
        if (item.operation === 'delete') finishRawMap.delete(finishId);
        else if (item.record) finishRawMap.set(finishId, item.record);
      });
      const finishes = hydrateFinishRecords(Array.from(finishRawMap.values()), materialById);
      if (isLegacySparse && finishes.length) persistFinishStructureForProject(project, finishes);

      const photoRawMap = new Map((raw.photoRecords || []).map((record) => [String(record.photoId || record.id || ''), record]));
      unsent
        .filter((item) => item.recordType === 'photo' && item.operation === 'set' && item.record)
        .forEach((item) => photoRawMap.set(String(item.recordId), item.record));
      const photos = hydratePhotoRecords(Array.from(photoRawMap.values()));

      onInitial?.({ finishRecords: finishes, materialRecords: materials, photoRecords: photos });
    },
    onChanges,
    onError
  });
}

/** 受信したmaterialRecord 1件を現在Storeへ入れられる形へ正規化する。 */
export function hydrateIncomingMaterialRecord(rawRecord, currentRecords = []) {
  const id = String(rawRecord?.materialId || rawRecord?.id || '');
  const raw = currentRecords
    .filter((record) => String(record.materialId) !== id)
    .map((record) => ({ ...record }));
  if (rawRecord) raw.push(rawRecord);
  return hydrateMaterialRecords(raw);
}

/** 受信したfinishRecord 1件を現在案件のroomUidを維持して正規化する。 */
export function hydrateIncomingFinishRecord(rawRecord, currentFinishRecords = [], currentMaterialRecords = []) {
  if (!rawRecord) return null;
  const finishId = String(rawRecord.finishId || rawRecord.id || '');
  const existing = currentFinishRecords.find((record) => String(record.finishId) === finishId);
  const roomKey = `${String(rawRecord.areaCode || '')}|${String(rawRecord.roomPosition || '')}`;
  const sameRoom = currentFinishRecords.find((record) =>
    `${String(record.areaCode || '')}|${String(record.roomPosition || '')}` === roomKey
  );
  const material = currentMaterialRecords.find((record) => String(record.materialId) === String(rawRecord.materialId || ''));
  return createFinishRecord({
    ...rawRecord,
    finishId,
    inputId: material ? String(material.inputId) : '',
    status: 'active',
    roomUid: existing?.roomUid || sameRoom?.roomUid || nextRoomUid(),
    updatedAt: rawRecord.updatedAt || '',
    fieldEditedAt: rawRecord.fieldEditedAt || {}
  });
}

/** 受信したphotoRecord 1件をStore用に正規化する。 */
export function hydrateIncomingPhotoRecord(rawRecord) {
  if (!rawRecord) return null;
  return createPhotoRecord({
    ...rawRecord,
    photoId: String(rawRecord.photoId || rawRecord.id || ''),
    syncStatus: rawRecord.syncStatus || 'synced',
    updatedAt: rawRecord.updatedAt || '',
    fieldEditedAt: rawRecord.fieldEditedAt || {}
  });
}
