/**
 * src/js/sync/project-record-persistence.js
 *
 * v0.1.6.2H 3レコードの保存・復元共通入口。
 * finishRecordは初期構造を端末で生成し、入力差分と追加構造の最小レコードだけをFirestoreへ保持する。
 */

import {
  saveFinishRecord,
  deleteFinishRecord,
  saveMaterialRecord,
  savePhotoRecord,
  saveProjectMetadata,
  readTemporaryProjectNos,
  readProjectRecordsOnce,
  subscribeProjectRecordChanges,
  readFinishChangeLog,
  readLatestFinishChangeCursor,
  createFinishChangeLogCheckpoint,
  isFinishChangeCursorAvailable,
  touchProjectSyncDevice,
  cleanupExpiredFinishChangeLogs,
  subscribeFinishChangeLog,
  deleteTestProjectCompletely
} from '../firestore/firestore-repository.js';
import { createMaterialRecord, colorForInputId } from '../records/material-record.js';
import { createFinishRecord, nextRoomUid } from '../records/finish-record.js';
import { createPhotoRecord } from '../records/photo-record.js';
import { listUnsent } from './unsent-queue.js';
import { restoreFinishRecordsFromSparse } from './finish-sparse-structure.js';

let writeChain = Promise.resolve();
const knownFinishRecordsByProject = new Map();
const FINISH_CHANGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FINISH_SPARSE_CACHE_KEY = 'chousa-finish-sparse-cache-v0162h';

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

function loadSparseCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(FINISH_SPARSE_CACHE_KEY) || '{}');
    Object.entries(raw || {}).forEach(([projectId, records]) => {
      const map = new Map();
      (Array.isArray(records) ? records : []).forEach((record) => {
        const finishId = String(record?.finishId || record?.id || '');
        if (finishId) map.set(finishId, { ...record, finishId });
      });
      knownFinishRecordsByProject.set(projectId, map);
    });
  } catch {
    // 壊れたローカル補助キャッシュで案件を開けなくしない。
  }
}

function persistSparseCache() {
  try {
    const payload = {};
    knownFinishRecordsByProject.forEach((map, projectId) => {
      payload[projectId] = [...map.values()];
    });
    localStorage.setItem(FINISH_SPARSE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Firestore正本があるため、補助キャッシュ保存失敗は操作を止めない。
  }
}

loadSparseCache();

function knownFinishMap(projectId) {
  const id = String(projectId || '');
  if (!knownFinishRecordsByProject.has(id)) knownFinishRecordsByProject.set(id, new Map());
  return knownFinishRecordsByProject.get(id);
}

export function setKnownFinishRecords(projectId, records = []) {
  const map = new Map();
  records.forEach((record) => {
    const finishId = String(record?.finishId || record?.id || '');
    if (finishId) map.set(finishId, { ...record, finishId });
  });
  knownFinishRecordsByProject.set(String(projectId || ''), map);
  persistSparseCache();
}

export function getKnownFinishRecords(projectId) {
  return [...knownFinishMap(projectId).values()].map((record) => ({ ...record }));
}

export function hasKnownFinishRecord(projectId, finishId) {
  return knownFinishMap(projectId).has(String(finishId || ''));
}

export function applyKnownFinishChange(projectId, change) {
  const map = knownFinishMap(projectId);
  const id = String(change?.id || change?.record?.finishId || '');
  if (!id) return;
  if (change.changeType === 'removed' || change.operation === 'delete') map.delete(id);
  else if (change.record) map.set(id, { ...change.record, finishId: id });
  persistSparseCache();
}

export function persistFinishForProject(project, record) {
  if (!shouldSyncProject(project) || !record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(async () => {
    const result = await saveFinishRecord({
      projectId: project.projectId,
      environment: projectEnvironment(project),
      record
    });
    if (result?.ok) {
      knownFinishMap(project.projectId).set(String(record.finishId), { ...record });
      persistSparseCache();
    }
    return result;
  });
}

export function deleteFinishForProject(project, record) {
  if (!shouldSyncProject(project) || !record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(async () => {
    const result = await deleteFinishRecord({
      projectId: project.projectId,
      environment: projectEnvironment(project),
      record
    });
    if (result?.ok) {
      knownFinishMap(project.projectId).delete(String(record.finishId));
      persistSparseCache();
    }
    return result;
  });
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

export function persistProjectMetadataForProject(project, options = {}) {
  if (!shouldSyncProject(project)) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => saveProjectMetadata(project, options));
}

export function touchProjectSyncDeviceForProject(project, device) {
  if (!shouldSyncProject(project)) return Promise.resolve({ ok: true, skipped: true });
  return touchProjectSyncDevice({
    projectId: project.projectId,
    environment: projectEnvironment(project),
    deviceCode: device?.deviceCode,
    deviceName: device?.deviceName,
    finishChangeCursor: device?.finishChangeCursor || null
  });
}

export function cleanupFinishChangeLogsForProject(project) {
  if (!shouldSyncProject(project)) return Promise.resolve({ ok: true, skipped: true, deleted: 0 });
  return cleanupExpiredFinishChangeLogs({
    projectId: project.projectId,
    environment: projectEnvironment(project)
  });
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
export function isFinishChangeCursorFresh(cursor) {
  if (!cursor || typeof cursor.seconds !== 'number') return false;
  const millis = (Number(cursor.seconds) * 1000) + Math.floor(Number(cursor.nanoseconds || 0) / 1e6);
  return millis >= (Date.now() - FINISH_CHANGE_RETENTION_MS);
}

/**
 * 案件を開く/復帰する時の取りこぼし回収。
 * finishRecordは変更履歴カーソルを使う。履歴が古い/未移行なら疎finishRecordを全件取得して再構築する。
 * material/photoは従来どおりupdatedAt差分取得。
 */
export async function readProjectRecordsForProject(project, {
  cursors = null,
  finishChangeCursor = null,
  baseMaterialRecords = [],
  basePhotoRecords = []
} = {}) {
  if (!shouldSyncProject(project)) {
    return {
      mode: 'local', typeModes: { finish: 'local', material: 'local', photo: 'local' },
      finishRecords: [], materialRecords: [], photoRecords: [], changes: [],
      cursors: { finish: 0, material: 0, photo: 0 }, finishChangeCursor: null, lastSyncedAt: 0
    };
  }

  const projectId = String(project.projectId);
  const environment = projectEnvironment(project);
  const numericCursors = cursors || {};
  const allowDelta = Boolean(cursors);
  const materialSince = allowDelta ? Number(numericCursors.material || 0) : 0;
  const photoSince = allowDelta ? Number(numericCursors.photo || 0) : 0;

  // finish/material/photoは互いの同期位置に依存させない。
  // 1タイプだけcursor=0でも、他タイプの健全なcursorを巻き込んで全件取得へ戻さない。
  let canFinishDelta = false;
  if (allowDelta && finishChangeCursor && isFinishChangeCursorFresh(finishChangeCursor)) {
    canFinishDelta = await isFinishChangeCursorAvailable({ projectId, environment, cursor: finishChangeCursor });
  }
  const typeModes = {
    finish: canFinishDelta ? 'delta' : 'full',
    material: materialSince > 0 ? 'delta' : 'full',
    photo: photoSince > 0 ? 'delta' : 'full'
  };
  hlog('SYNC_TYPE_READ_PLAN', {
    projectId,
    allowDelta,
    typeModes,
    materialSince,
    photoSince,
    finishChangeCursor: canFinishDelta ? finishChangeCursor : null
  });

  // material/photoは1回の並列読込の中でも、タイプごとのsince値で独立してfull/deltaを選ぶ。
  const otherReadPromise = readProjectRecordsOnce({
    projectId,
    environment,
    sinceByType: { material: materialSince, photo: photoSince },
    recordTypes: ['material', 'photo']
  });

  // finishだけは物理deleteを伝える必要があるため、変更履歴カーソルが健全ならログ差分、
  // そうでなければ現在の疎finishRecordを一式取得して再構築する。
  const finishReadPromise = canFinishDelta
    ? readFinishChangeLog({ projectId, environment, cursor: finishChangeCursor })
    : Promise.all([
        readProjectRecordsOnce({ projectId, environment, sinceByType: null, recordTypes: ['finish'] }),
        readLatestFinishChangeCursor({ projectId, environment })
      ]);

  const [otherRaw, finishRead] = await Promise.all([otherReadPromise, finishReadPromise]);
  const unsent = listUnsent({ projectId });

  // materialはfullならFirestore現在形、deltaなら端末内現在形へ受信分だけ上書きする。
  const materialRawMap = new Map();
  if (typeModes.material === 'delta') {
    (baseMaterialRecords || []).forEach((record) => {
      const id = String(record?.materialId || record?.id || '');
      if (id) materialRawMap.set(id, record);
    });
  }
  (otherRaw.materialRecords || []).forEach((record) => {
    const id = String(record?.materialId || record?.id || '');
    if (id) materialRawMap.set(id, record);
  });
  unsent.filter((item) => item.recordType === 'material').forEach((item) => {
    const id = String(item.recordId || '');
    if (!id) return;
    if (item.operation === 'delete') materialRawMap.delete(id);
    else if (item.record) materialRawMap.set(id, item.record);
  });
  const materials = hydrateMaterialRecords([...materialRawMap.values()]);
  const materialById = new Map(materials.map((record) => [record.materialId, record]));

  // finish疎キャッシュを最新化してから、画面用の完全構造へ復元する。
  let nextFinishChangeCursor = finishChangeCursor;
  let finishChanges = [];
  if (typeModes.finish === 'delta') {
    finishChanges = finishRead?.changes || [];
    finishChanges.forEach((change) => applyKnownFinishChange(projectId, change));
    nextFinishChangeCursor = finishRead?.cursor || finishChangeCursor;
  } else {
    const [finishRawResult, latestCursorRead] = finishRead;
    const sparseFinishRecords = finishRawResult?.finishRecords || [];
    setKnownFinishRecords(projectId, sparseFinishRecords);
    nextFinishChangeCursor = isFinishChangeCursorFresh(latestCursorRead)
      ? latestCursorRead
      : await createFinishChangeLogCheckpoint({ projectId, environment });
  }

  const sparseFinishMap = new Map(getKnownFinishRecords(projectId).map((record) => [String(record.finishId || record.id || ''), record]));
  unsent.filter((item) => item.recordType === 'finish').forEach((item) => {
    const finishId = String(item.recordId || '');
    if (!finishId) return;
    if (item.operation === 'delete') sparseFinishMap.delete(finishId);
    else if (item.record) sparseFinishMap.set(finishId, item.record);
  });
  const finishes = hydrateFinishRecords(
    restoreFinishRecordsFromSparse([...sparseFinishMap.values()]),
    materialById
  );

  // photoもmaterialと同じく、cursorがある時だけ端末内現在形へ差分を重ねる。
  const photoRawMap = new Map();
  if (typeModes.photo === 'delta') {
    (basePhotoRecords || []).forEach((record) => {
      const id = String(record?.photoId || record?.id || '');
      if (id) photoRawMap.set(id, record);
    });
  }
  (otherRaw.photoRecords || []).forEach((record) => {
    const id = String(record?.photoId || record?.id || '');
    if (id) photoRawMap.set(id, record);
  });
  unsent.filter((item) => item.recordType === 'photo').forEach((item) => {
    const id = String(item.recordId || '');
    if (!id) return;
    if (item.operation === 'delete') photoRawMap.delete(id);
    else if (item.record) photoRawMap.set(id, item.record);
  });
  const photos = hydratePhotoRecords([...photoRawMap.values()]);

  const nextCursors = newestByType(otherRaw, numericCursors);
  const otherChanges = [
    ...(typeModes.material === 'delta' ? (otherRaw.materialRecords || []).map((record) => ({ recordType: 'material', changeType: 'modified', id: String(record.materialId || record.id || ''), record })) : []),
    ...(typeModes.photo === 'delta' ? (otherRaw.photoRecords || []).map((record) => ({ recordType: 'photo', changeType: 'modified', id: String(record.photoId || record.id || ''), record })) : [])
  ];
  const allModes = Object.values(typeModes);
  const mode = allModes.every((value) => value === 'delta')
    ? 'delta'
    : allModes.every((value) => value === 'full') ? 'full' : 'mixed';

  return {
    mode,
    typeModes,
    finishRecords: finishes,
    materialRecords: materials,
    photoRecords: photos,
    changes: [...finishChanges, ...otherChanges],
    cursors: nextCursors,
    finishChangeCursor: nextFinishChangeCursor,
    finishHistoryMode: typeModes.finish === 'delta' ? 'delta' : 'rebuilt',
    lastSyncedAt: maxCursor(nextCursors)
  };
}

/**
 * 取りこぼし回収後の「今ここから先」だけを監視する。
 * afterByTypeは案件を開いた時点の3Record別cursorを固定して使う。
 */
export function subscribeRealtimeProjectRecordsForProject(project, { afterByType = {}, finishChangeCursor = null, onChanges, onState, onFinishCursor, onError } = {}) {
  if (!shouldSyncProject(project)) return () => {};
  const projectId = String(project.projectId);
  const environment = projectEnvironment(project);

  const stopFinish = subscribeFinishChangeLog({
    projectId, environment, afterCursor: finishChangeCursor,
    onChanges: (changes, cursor) => {
      changes.forEach((change) => {
        applyKnownFinishChange(projectId, change);
      });
      onChanges?.(changes);
      if (cursor) onFinishCursor?.(cursor);
    },
    onState,
    onError
  });

  // material/photoだけは従来のupdatedAt listenerを継続する。finish本体listenerは張らない。
  const stopOther = subscribeProjectRecordChanges({
    projectId, environment, afterByType,
    recordTypes: ['material', 'photo'],
    onChanges,
    onState,
    onError
  });

  return () => { stopFinish(); stopOther(); };
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

/** 保存済み疎finishRecordキャッシュから画面用の完全な仕上表を復元する。 */
export function restoreKnownFinishRecords(projectId, currentMaterialRecords = []) {
  const materialById = new Map(currentMaterialRecords.map((record) => [String(record.materialId || ''), record]));
  const sparseMap = new Map(getKnownFinishRecords(projectId).map((record) => [String(record.finishId || ''), record]));

  // 送信失敗・手動オフライン中でも、端末で確定済みの変更を受信差分で巻き戻さない。
  // knownFinishRecordsは「Firestoreで確認済み」のみを表し、画面復元時だけ未送信を上書きする。
  listUnsent({ projectId }).filter((item) => item.recordType === 'finish').forEach((item) => {
    const id = String(item.recordId || '');
    if (!id) return;
    if (item.operation === 'delete') sparseMap.delete(id);
    else if (item.record) sparseMap.set(id, item.record);
  });

  return hydrateFinishRecords(restoreFinishRecordsFromSparse([...sparseMap.values()]), materialById);
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
