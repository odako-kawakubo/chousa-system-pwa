/**
 * src/js/sync/project-record-persistence.js
 *
 * v0.1.6.2G 3レコードの保存・復元共通入口。
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
  readProjectRecordsOnce,
  subscribeProjectRecordChanges,
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

/** Firestore Timestamp / Date / ISO文字列を比較用ミリ秒へ揃える。 */
export function firestoreTimeToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.seconds === 'number') {
    return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newestRecordUpdatedAt(records = []) {
  return records.reduce((max, record) => Math.max(max, firestoreTimeToMillis(record?.updatedAt)), 0);
}

function newestSnapshotUpdatedAt(raw = {}) {
  return Math.max(
    newestRecordUpdatedAt(raw.finishRecords || []),
    newestRecordUpdatedAt(raw.materialRecords || []),
    newestRecordUpdatedAt(raw.photoRecords || [])
  );
}

function rawSnapshotToChanges(raw = {}) {
  return [
    ...(raw.materialRecords || []).map((record) => ({ recordType: 'material', changeType: 'modified', id: String(record.materialId || record.id || ''), record })),
    ...(raw.finishRecords || []).map((record) => ({ recordType: 'finish', changeType: 'modified', id: String(record.finishId || record.id || ''), record })),
    ...(raw.photoRecords || []).map((record) => ({ recordType: 'photo', changeType: 'modified', id: String(record.photoId || record.id || ''), record }))
  ];
}

function newestByType(raw = {}, fallback = {}) {
  return {
    finish: Math.max(Number(fallback.finish || 0), newestRecordUpdatedAt(raw.finishRecords || [])),
    material: Math.max(Number(fallback.material || 0), newestRecordUpdatedAt(raw.materialRecords || [])),
    photo: Math.max(Number(fallback.photo || 0), newestRecordUpdatedAt(raw.photoRecords || []))
  };
}

function maxCursor(cursors = {}) {
  return Math.max(Number(cursors.finish || 0), Number(cursors.material || 0), Number(cursors.photo || 0));
}

/**
 * 案件を開く/復帰する時の取りこぼし回収。
 * - cursorsなし: 3Recordの現在形を1回だけ全件取得する。
 * - cursorsあり: Record種別ごとに前回cursorより新しいRecordだけ1回取得する。
 * listenerはここでは張らない。
 */
export async function readProjectRecordsForProject(project, { cursors = null } = {}) {
  if (!shouldSyncProject(project)) {
    return {
      mode: 'local',
      finishRecords: [],
      materialRecords: [],
      photoRecords: [],
      changes: [],
      cursors: { finish: 0, material: 0, photo: 0 },
      lastSyncedAt: 0
    };
  }

  const projectId = String(project.projectId);
  const environment = projectEnvironment(project);
  const deltaMode = Boolean(cursors && Object.values(cursors).some((value) => Number(value || 0) > 0));
  const raw = await readProjectRecordsOnce({
    projectId,
    environment,
    sinceByType: deltaMode ? cursors : null
  });
  const nextCursors = newestByType(raw, cursors || {});

  if (deltaMode) {
    return {
      mode: 'delta',
      changes: rawSnapshotToChanges(raw),
      cursors: nextCursors,
      lastSyncedAt: maxCursor(nextCursors)
    };
  }

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

  return {
    mode: 'full',
    finishRecords: finishes,
    materialRecords: materials,
    photoRecords: photos,
    changes: [],
    cursors: nextCursors,
    lastSyncedAt: maxCursor(nextCursors)
  };
}

/**
 * 取りこぼし回収後の「今ここから先」だけを監視する。
 * afterByTypeは案件を開いた時点の3Record別cursorを固定して使う。
 */
export function subscribeRealtimeProjectRecordsForProject(project, { afterByType = {}, onChanges, onState, onError } = {}) {
  if (!shouldSyncProject(project)) return () => {};
  return subscribeProjectRecordChanges({
    projectId: String(project.projectId),
    environment: projectEnvironment(project),
    afterByType,
    onChanges,
    onState,
    onError
  });
}

export function newestCursorsFromChanges(changes = [], fallback = {}) {
  const next = {
    finish: Number(fallback.finish || 0),
    material: Number(fallback.material || 0),
    photo: Number(fallback.photo || 0)
  };
  changes.forEach((change) => {
    const type = change?.recordType;
    if (!(type in next)) return;
    next[type] = Math.max(next[type], firestoreTimeToMillis(change?.record?.updatedAt));
  });
  return next;
}

export function latestCursorValue(cursors = {}) {
  return maxCursor(cursors);
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
