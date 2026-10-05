/**
 * src/js/sync/project-record-persistence.js
 *
 * v0.1.6.2 3レコードの保存・復元共通入口。
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
  deleteTestProjectCompletely,
  retryUnsentBatch,
  BULK_SYNC_BATCH_SIZE
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

/**
 * 案件情報からFirestore同期に必要なenvironment情報を作る。sample案件や同期対象外案件の判定もここで共通化する。
 */
function projectEnvironment(project) {
  return project?.environment === 'test' ? 'test' : 'production';
}

/**
 * 指定案件がFirestore同期対象か判定する。sample/無効案件を下位Repositoryへ流さないための入口。
 */
function shouldSyncProject(project) {
  return Boolean(project?.projectId) && !project.isSample;
}

/**
 * Repository呼び出しを未送信管理付きで実行する共通helper。同期対象外なら何も送らない。
 */
function enqueue(run) {
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  return next;
}

/**
 * finishの疎構造cacheをローカル保存から読み込む。全セルを常時保持せず必要Recordだけ復元するために使う。
 */
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

/**
 * 現在のfinish疎構造cacheをローカルへ保存する。オフライン復元用。
 */
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

/**
 * 案件ごとの既知finish Record mapを返す。Realtime差分を受けた時の追加/更新/削除判定に使う。
 */
function knownFinishMap(projectId) {
  const id = String(projectId || '');
  if (!knownFinishRecordsByProject.has(id)) knownFinishRecordsByProject.set(id, new Map());
  return knownFinishRecordsByProject.get(id);
}

/**
 * 案件の既知finish Record集合を丸ごと置き換える。full load後の基準状態設定用。
 */
export function setKnownFinishRecords(projectId, records = []) {
  const map = new Map();
  records.forEach((record) => {
    const finishId = String(record?.finishId || record?.id || '');
    if (finishId) map.set(finishId, { ...record, finishId });
  });
  knownFinishRecordsByProject.set(String(projectId || ''), map);
  persistSparseCache();
}

/**
 * 案件の既知finish Recordを配列で返す。Store再構築時のsource。
 */
export function getKnownFinishRecords(projectId) {
  return [...knownFinishMap(projectId).values()].map((record) => ({ ...record }));
}

/**
 * 指定finishIdが既知Recordとして存在するか判定する。
 */
export function hasKnownFinishRecord(projectId, finishId) {
  return knownFinishMap(projectId).has(String(finishId || ''));
}

/**
 * finish change log 1件を既知Record mapへ適用する。Realtime受信直後にStoreへ反映する前の正本更新。
 */
export function applyKnownFinishChange(projectId, change) {
  const map = knownFinishMap(projectId);
  const id = String(change?.id || change?.record?.finishId || '');
  if (!id) return;
  if (change.changeType === 'removed' || change.operation === 'delete') map.delete(id);
  else if (change.record) map.set(id, { ...change.record, finishId: id });
  persistSparseCache();
}

function applyCommittedFinishEntries(projectId, entries = []) {
  const map = knownFinishMap(projectId);
  let changed = false;

  entries.forEach((entry) => {
    if (entry?.recordType !== 'finish') return;
    const id = String(entry.recordId || entry.record?.finishId || '');
    if (!id) return;

    if (entry.operation === 'delete') {
      changed = map.delete(id) || changed;
      return;
    }
    if (entry.record) {
      map.set(id, { ...entry.record, finishId: id });
      changed = true;
    }
  });

  if (changed) persistSparseCache();
}

function applyRetryResultToKnownFinish(projectId, result) {
  applyCommittedFinishEntries(projectId, result?.retriedEntries || []);
}

/**
 * finish Recordをローカル既知状態へ反映し、同期対象案件ならFirestoreへ保存する。
 */
export function persistFinishForProject(project, record, source = 'finish-unspecified') {
  if (!shouldSyncProject(project) || !record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(async () => {
    const result = await saveFinishRecord({
      projectId: project.projectId,
      environment: projectEnvironment(project),
      record,
      source
    });
    if (result?.ok) {
      knownFinishMap(project.projectId).set(String(record.finishId), { ...record });
      persistSparseCache();
      applyRetryResultToKnownFinish(project.projectId, result);
    }
    return result;
  });
}

/**
 * finish Recordを既知状態から削除し、同期対象ならFirestore削除+change log記録を行う。
 */
export function deleteFinishForProject(project, record, source = 'finish-delete-unspecified') {
  if (!shouldSyncProject(project) || !record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(async () => {
    const result = await deleteFinishRecord({
      projectId: project.projectId,
      environment: projectEnvironment(project),
      record,
      source
    });
    if (result?.ok) {
      knownFinishMap(project.projectId).delete(String(record.finishId));
      persistSparseCache();
      applyRetryResultToKnownFinish(project.projectId, result);
    }
    return result;
  });
}


/**
 * material RecordをFirestoreへ保存する同期adapter。ControllerはRepositoryを直接呼ばずこの層を使う。
 */
export function persistMaterialForProject(project, record, source = 'material-unspecified') {
  if (!shouldSyncProject(project) || !record?.materialId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(async () => {
    const result = await saveMaterialRecord({
      projectId: project.projectId,
      environment: projectEnvironment(project),
      record,
      source
    });
    if (result?.ok) applyRetryResultToKnownFinish(project.projectId, result);
    return result;
  });
}

/**
 * photo RecordメタデータをFirestoreへ保存する同期adapter。
 */
export function persistPhotoForProject(project, record, source = 'photo-unspecified') {
  if (!shouldSyncProject(project) || !record?.photoId) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(async () => {
    const result = await savePhotoRecord({
      projectId: project.projectId,
      environment: projectEnvironment(project),
      record,
      source
    });
    if (result?.ok) applyRetryResultToKnownFinish(project.projectId, result);
    return result;
  });
}

export const PROJECT_BULK_SYNC_BATCH_SIZE = BULK_SYNC_BATCH_SIZE;

export function retryUnsentForProject(project, options = {}) {
  if (!shouldSyncProject(project)) {
    return Promise.resolve({ ok: true, skipped: true, sent: 0, remaining: 0, completed: true });
  }
  return enqueue(async () => {
    const result = await retryUnsentBatch({
      projectId: project.projectId,
      batchSize: options.batchSize || BULK_SYNC_BATCH_SIZE
    });
    if (result?.ok) {
      applyCommittedFinishEntries(project.projectId, result.committedEntries || []);
    }
    return result;
  });
}

/**
 * 案件メタデータをFirestoreへ保存する同期adapter。
 */
export function persistProjectMetadataForProject(project, options = {}) {
  if (!shouldSyncProject(project)) return Promise.resolve({ ok: true, skipped: true });
  return enqueue(() => saveProjectMetadata(project, options));
}

/**
 * 現在端末の同期接触情報をFirestoreへ送るadapter。project-sync-metaから呼ばれる。
 */
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

/**
 * 案件の古いfinish change log整理をRepositoryへ依頼するadapter。
 */
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

/**
 * Firestore上の仮案件番号一覧を取得する。案件新規作成時の重複回避用。
 */
export async function getRemoteTemporaryProjectNos(dateCode, environment = 'production') {
  return readTemporaryProjectNos(dateCode, environment);
}

/** 現在までにこの端末で積まれた書込要求が終わるまで待つ。 */
export async function flushPendingWrites() {
  await writeChain;
}

/**
 * materialIdから表示/互換用inputIdを補完する。古いRecordを現行形式へhydrateする際のfallback。
 */
function inputIdFromMaterialId(materialId, fallbackIndex) {
  const match = /^R(\d+)$/.exec(String(materialId || ''));
  if (match) return Number(match[1]);
  return fallbackIndex + 1;
}

/**
 * Firestore/ローカルSnapshotのmaterial配列を現行Record形式へ正規化する。欠損項目のdefault補完も行う。
 */
function hydrateMaterialRecords(rawRecords = []) {
  return rawRecords
    .slice()
    .sort((a, b) => String(a.materialId || a.id || '').localeCompare(String(b.materialId || b.id || '')))
    .map((raw, index) => {
      const materialId = String(raw.materialId || raw.id || '');
      const inputId = inputIdFromMaterialId(materialId, index);
      const persistedSortOrder = Number(raw.sortOrder);
      const localMaterialNo = Number(raw.materialNo);
      const materialNo = Number.isFinite(persistedSortOrder) && persistedSortOrder > 0
        ? persistedSortOrder
        : (Number.isFinite(localMaterialNo) && localMaterialNo > 0 ? localMaterialNo : index + 1);
      return createMaterialRecord({
        ...raw,
        materialId,
        inputId,
        materialNo,
        color: colorForInputId(inputId),
        updatedAt: raw.updatedAt || '',
        fieldEditedAt: raw.fieldEditedAt || {}
      });
    });
}

/**
 * finish配列を現行Record形式へ正規化し、案件内構造として扱える状態にする。
 */
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

/**
 * photo配列を現行Record形式へ正規化する。削除flagや同期参照を含む現行schemaへ合わせる。
 */
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

/**
 * Record配列中の最大updatedAtを返す。差分cursorの初期値計算に使う。
 */
export function newestRecordUpdatedAt(records = []) {
  return records.reduce((max, record) => Math.max(max, firestoreTimeToMillis(record?.updatedAt)), 0);
}

/**
 * 3Record snapshot全体の最大updatedAtを返す。full load完了時の基準時刻。
 */
function newestSnapshotUpdatedAt(raw = {}) {
  return Math.max(
    newestRecordUpdatedAt(raw.finishRecords || []),
    newestRecordUpdatedAt(raw.materialRecords || []),
    newestRecordUpdatedAt(raw.photoRecords || [])
  );
}

/**
 * full snapshotを差分適用形式のchanges配列へ変換する。full/deltaで同じ適用経路を使うためのadapter。
 */
function rawSnapshotToChanges(raw = {}) {
  return [
    ...(raw.materialRecords || []).map((record) => ({ recordType: 'material', changeType: 'modified', id: String(record.materialId || record.id || ''), record })),
    ...(raw.finishRecords || []).map((record) => ({ recordType: 'finish', changeType: 'modified', id: String(record.finishId || record.id || ''), record })),
    ...(raw.photoRecords || []).map((record) => ({ recordType: 'photo', changeType: 'modified', id: String(record.photoId || record.id || ''), record }))
  ];
}

/**
 * changesからfinish/material/photo各種別の最新updatedAtを集計する。
 */
function newestByType(raw = {}, fallback = {}) {
  return {
    finish: Math.max(Number(fallback.finish || 0), newestRecordUpdatedAt(raw.finishRecords || [])),
    material: Math.max(Number(fallback.material || 0), newestRecordUpdatedAt(raw.materialRecords || [])),
    photo: Math.max(Number(fallback.photo || 0), newestRecordUpdatedAt(raw.photoRecords || []))
  };
}

/**
 * 複数cursor候補から大きい値を返す小helper。
 */
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
  baseRecords = null
} = {}) {
  if (!shouldSyncProject(project)) {
    return {
      mode: 'local',
      typeModes: { finish: 'local', material: 'local', photo: 'local' },
      finishRecords: [], materialRecords: [], photoRecords: [], changes: [],
      cursors: { finish: 0, material: 0, photo: 0 }, finishChangeCursor: null, lastSyncedAt: 0
    };
  }

  const projectId = String(project.projectId);
  const environment = projectEnvironment(project);
  const hasLocalBaseline = Boolean(baseRecords);
  const numericCursors = cursors || {};
  const unsent = listUnsent({ projectId });

  // 3Recordを一括でfull/delta判定しない。
  // finishは変更履歴カーソル、material/photoは各updatedAtカーソルだけを見て独立判定する。
  let canFinishDelta = false;
  if (hasLocalBaseline && finishChangeCursor && isFinishChangeCursorFresh(finishChangeCursor)) {
    canFinishDelta = await isFinishChangeCursorAvailable({ projectId, environment, cursor: finishChangeCursor });
  }

  const typeModes = {
    finish: canFinishDelta ? 'delta' : 'full',
    material: hasLocalBaseline && Number(numericCursors.material || 0) > 0 ? 'delta' : 'full',
    photo: hasLocalBaseline && Number(numericCursors.photo || 0) > 0 ? 'delta' : 'full'
  };

  // material/photoは1回のreadProjectRecordsOnceで取得するが、since値はタイプ別。
  // 片方がfullでも、もう片方の健全なcursorは維持する。
  const otherSince = {
    material: typeModes.material === 'delta' ? Number(numericCursors.material || 0) : 0,
    photo: typeModes.photo === 'delta' ? Number(numericCursors.photo || 0) : 0
  };

  const finishPromise = typeModes.finish === 'delta'
    ? readFinishChangeLog({ projectId, environment, cursor: finishChangeCursor })
    : Promise.all([
        readProjectRecordsOnce({ projectId, environment, sinceByType: null, recordTypes: ['finish'] }),
        readLatestFinishChangeCursor({ projectId, environment })
      ]);

  const [finishResult, otherRaw] = await Promise.all([
    finishPromise,
    readProjectRecordsOnce({
      projectId,
      environment,
      sinceByType: otherSince,
      recordTypes: ['material', 'photo']
    })
  ]);

  // Firestoreで確認できたRecordだけから次cursorを作る。未送信ローカル値はcursorへ混ぜない。
  const nextCursors = {
    finish: Number(numericCursors.finish || 0),
    material: typeModes.material === 'delta'
      ? Math.max(Number(numericCursors.material || 0), newestRecordUpdatedAt(otherRaw.materialRecords || []))
      : newestRecordUpdatedAt(otherRaw.materialRecords || []),
    photo: typeModes.photo === 'delta'
      ? Math.max(Number(numericCursors.photo || 0), newestRecordUpdatedAt(otherRaw.photoRecords || []))
      : newestRecordUpdatedAt(otherRaw.photoRecords || [])
  };

  // finish全件復元時にmaterialId→inputIdを正しく引けるよう、現在形のmaterialをここで組み立てる。
  // materialがdeltaならローカル現在形へ受信差分を重ね、fullならFirestore現在形から作り直す。
  const materialRawMap = new Map();
  if (typeModes.material === 'delta') {
    (baseRecords?.materialRecords || []).forEach((record) => {
      const id = String(record?.materialId || record?.id || '');
      if (id) materialRawMap.set(id, { ...record, materialId: id });
    });
  }
  (otherRaw.materialRecords || []).forEach((record) => {
    const id = String(record?.materialId || record?.id || '');
    if (id) materialRawMap.set(id, record);
  });
  unsent.filter((item) => item.recordType === 'material' && item.operation === 'set' && item.record)
    .forEach((item) => materialRawMap.set(String(item.recordId), item.record));
  const effectiveMaterials = hydrateMaterialRecords(Array.from(materialRawMap.values()));
  const materialById = new Map(effectiveMaterials.map((record) => [record.materialId, record]));

  let finishRecords = [];
  let nextFinishChangeCursor = finishChangeCursor;
  let finishChanges = [];
  let finishHistoryMode = 'delta';

  if (typeModes.finish === 'delta') {
    finishChanges = finishResult.changes || [];
    nextFinishChangeCursor = finishResult.cursor || finishChangeCursor;
  } else {
    const [finishRaw, latestCursorRead] = finishResult;
    const latestFinishCursor = isFinishChangeCursorFresh(latestCursorRead)
      ? latestCursorRead
      : await createFinishChangeLogCheckpoint({ projectId, environment });
    nextFinishChangeCursor = latestFinishCursor;
    finishHistoryMode = 'rebuilt';
    nextCursors.finish = newestRecordUpdatedAt(finishRaw.finishRecords || []);

    const sparseFinishMap = new Map((finishRaw.finishRecords || []).map((record) => [String(record.finishId || record.id || ''), record]));
    setKnownFinishRecords(projectId, sparseFinishMap.values());
    unsent.filter((item) => item.recordType === 'finish').forEach((item) => {
      const finishId = String(item.recordId || '');
      if (!finishId) return;
      if (item.operation === 'delete') sparseFinishMap.delete(finishId);
      else if (item.record) sparseFinishMap.set(finishId, item.record);
    });
    finishRecords = hydrateFinishRecords(
      restoreFinishRecordsFromSparse(Array.from(sparseFinishMap.values())),
      materialById
    );
  }

  let materialRecords = [];
  if (typeModes.material === 'full') materialRecords = effectiveMaterials;

  let photoRecords = [];
  if (typeModes.photo === 'full') {
    const photoRawMap = new Map((otherRaw.photoRecords || []).map((record) => [String(record.photoId || record.id || ''), record]));
    unsent.filter((item) => item.recordType === 'photo' && item.operation === 'set' && item.record)
      .forEach((item) => photoRawMap.set(String(item.recordId), item.record));
    photoRecords = hydratePhotoRecords(Array.from(photoRawMap.values()));
  }

  const changes = [
    ...finishChanges,
    ...(typeModes.material === 'delta'
      ? (otherRaw.materialRecords || []).map((record) => ({ recordType: 'material', changeType: 'modified', id: String(record.materialId || record.id || ''), record }))
      : []),
    ...(typeModes.photo === 'delta'
      ? (otherRaw.photoRecords || []).map((record) => ({ recordType: 'photo', changeType: 'modified', id: String(record.photoId || record.id || ''), record }))
      : [])
  ];

  const modeValues = Object.values(typeModes);
  const mode = modeValues.every((value) => value === 'delta')
    ? 'delta'
    : modeValues.every((value) => value === 'full')
      ? 'full'
      : 'mixed';

  return {
    mode,
    typeModes,
    finishRecords,
    materialRecords,
    photoRecords,
    changes,
    cursors: nextCursors,
    finishChangeCursor: nextFinishChangeCursor,
    finishHistoryMode,
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

/**
 * 受信changesからRecord種別別の最新cursorを算出する。適用成功後だけ保存する前提。
 */
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

/**
 * Record種別別cursorの最大値を返す。ヘッダーの最終同期時刻などに使う。
 */
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
