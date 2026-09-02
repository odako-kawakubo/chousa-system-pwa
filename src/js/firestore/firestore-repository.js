/**
 * src/js/firestore/firestore-repository.js
 *
 * v0.1.6.2 Firestore Repository。
 * finishRecordは疎保存し、set/deleteを短期変更履歴にも同一batchで記録する。
 *
 * v0.1.6.3C:
 *   - 手動オフラインと物理通信不可を分離
 *   - 通常書込成功後に過去未送信を最大3件だけ自動再送
 *   - 大量未送信用に50件単位の明示バッチ同期を提供
 *   - 大量同期は1バッチ失敗時に自動継続しない
 *   - 通常保存と大量同期はRepository内でも直列化し、古い未送信が新しい編集を上書きしない
 */

import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  orderBy,
  startAfter,
  limit,
  documentId
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseApp } from '../../config/firebase-config.js';
import {
  serializeFinishRecord,
  serializeMaterialRecord,
  serializePhotoRecord
} from './record-serializer.js';
import { putUnsent, removeUnsent, listUnsent } from '../sync/unsent-queue.js';
import {
  isManualOffline,
  isNetworkOnline,
  canUseFirestore,
  beginFirestoreActivity,
  endFirestoreActivity,
  markError
} from '../sync/sync-status.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

const db = getFirestore(firebaseApp);
const RECORD_COLLECTIONS = Object.freeze({
  finish: 'finishRecords',
  material: 'materialRecords',
  photo: 'photoRecords'
});
const FINISH_BATCH_SIZE = 200;
const CHANGE_LOG_COLLECTION = 'finishChangeLogs';
const CHANGE_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_DEVICE_COLLECTION = 'syncDevices';
const CHANGE_LOG_CLEANUP_LIMIT = 200;
const PASSIVE_RETRY_LIMIT = 3;
export const BULK_SYNC_BATCH_SIZE = 50;

let repositoryWriteChain = Promise.resolve();

function enqueueRepositoryWrite(run) {
  const next = repositoryWriteChain.then(run, run);
  repositoryWriteChain = next.catch(() => undefined);
  return next;
}

function projectRoot(environment) {
  return environment === 'test' ? 'testProjects' : 'projects';
}

function projectDocRef(projectId, environment = 'production') {
  return doc(db, projectRoot(environment), String(projectId));
}

function collectionRef(projectId, environment, recordType) {
  const name = RECORD_COLLECTIONS[recordType];
  if (!name) throw new Error(`未対応のrecordTypeです: ${recordType}`);
  return collection(db, projectRoot(environment), String(projectId), name);
}

function recordRef(projectId, environment, recordType, recordId) {
  return doc(collectionRef(projectId, environment, recordType), String(recordId));
}

function finishChangeLogCollectionRef(projectId, environment = 'production') {
  return collection(db, projectRoot(environment), String(projectId), CHANGE_LOG_COLLECTION);
}

function projectSyncDeviceRef(projectId, environment = 'production', deviceCode = '') {
  return doc(db, projectRoot(environment), String(projectId), SYNC_DEVICE_COLLECTION, String(deviceCode));
}

function plainFinishPayload(record) {
  return {
    finishId: String(record.finishId || ''),
    ...serializeFinishRecord(record, { updatedAt: null })
  };
}

function appendFinishChangeToBatch(batch, { projectId, environment, recordId, operation, record = null }) {
  const logRef = doc(finishChangeLogCollectionRef(projectId, environment));
  batch.set(logRef, {
    recordType: 'finish',
    recordId: String(recordId || ''),
    operation,
    record: operation === 'set' && record ? plainFinishPayload(record) : null,
    committedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CHANGE_LOG_RETENTION_MS)
  });
}

function appendRecordOperationToBatch(batch, entry) {
  const projectId = String(entry.projectId || '');
  const environment = entry.environment === 'test' ? 'test' : 'production';
  const recordType = String(entry.recordType || '');
  const recordId = String(entry.recordId || '');
  const operation = entry.operation === 'delete' ? 'delete' : 'set';
  const record = entry.record || null;

  if (!projectId || !recordType || !recordId) {
    throw new Error('未送信レコードのキー情報が不足しています。');
  }

  if (recordType === 'finish') {
    if (operation === 'delete') {
      batch.delete(recordRef(projectId, environment, 'finish', recordId));
      appendFinishChangeToBatch(batch, { projectId, environment, recordId, operation: 'delete' });
      return;
    }
    if (!record) throw new Error(`finishRecord本体がありません: ${recordId}`);
    batch.set(
      recordRef(projectId, environment, 'finish', recordId),
      serializeFinishRecord(record, { updatedAt: serverTimestamp() })
    );
    appendFinishChangeToBatch(batch, { projectId, environment, recordId, operation: 'set', record });
    return;
  }

  if (operation === 'delete') {
    batch.delete(recordRef(projectId, environment, recordType, recordId));
    return;
  }

  if (!record) throw new Error(`${recordType}Record本体がありません: ${recordId}`);
  if (recordType === 'material') {
    batch.set(
      recordRef(projectId, environment, 'material', recordId),
      serializeMaterialRecord(record, { updatedAt: serverTimestamp() })
    );
    return;
  }
  if (recordType === 'photo') {
    batch.set(
      recordRef(projectId, environment, 'photo', recordId),
      serializePhotoRecord(record, { updatedAt: serverTimestamp() })
    );
    return;
  }
  throw new Error(`未対応のrecordTypeです: ${recordType}`);
}

async function commitRecordEntries(entries = []) {
  if (!entries.length) return { ok: true, sent: 0 };
  const batch = writeBatch(db);
  entries.forEach((entry) => appendRecordOperationToBatch(batch, entry));
  await batch.commit();
  entries.forEach((entry) => removeUnsent(entry.projectId, entry.recordType, entry.recordId));
  return { ok: true, sent: entries.length };
}

async function retryPastUnsent(projectId, limitCount = PASSIVE_RETRY_LIMIT) {
  if (!canUseFirestore()) return { ok: false, sent: 0, skipped: true };
  const entries = listUnsent({ projectId, limit: limitCount });
  if (!entries.length) return { ok: true, sent: 0 };

  try {
    const result = await commitRecordEntries(entries);
    syncDiagnosticLog('UNSENT_PASSIVE_RETRY_OK', {
      projectId,
      requested: entries.length,
      sent: result.sent
    });
    return result;
  } catch (error) {
    syncDiagnosticLog('UNSENT_PASSIVE_RETRY_ERROR', {
      projectId,
      requested: entries.length,
      message: error?.message || String(error)
    });
    markError(error);
    return { ok: false, sent: 0, error };
  }
}

async function retryUnsentBatchNow({ projectId, batchSize = BULK_SYNC_BATCH_SIZE }) {
  const id = String(projectId || '');
  if (!id) return { ok: false, sent: 0, remaining: 0, reason: 'project-missing' };
  const remainingBefore = listUnsent({ projectId: id }).length;
  if (!remainingBefore) return { ok: true, sent: 0, remaining: 0, completed: true };
  if (isManualOffline()) {
    return { ok: false, sent: 0, remaining: remainingBefore, reason: 'manual-offline' };
  }
  if (!isNetworkOnline()) {
    return { ok: false, sent: 0, remaining: remainingBefore, reason: 'network-offline' };
  }

  const size = Math.max(1, Math.min(100, Number(batchSize) || BULK_SYNC_BATCH_SIZE));
  const entries = listUnsent({ projectId: id, limit: size });
  beginFirestoreActivity();
  try {
    const result = await commitRecordEntries(entries);
    const remaining = listUnsent({ projectId: id }).length;
    syncDiagnosticLog('UNSENT_BULK_BATCH_OK', {
      projectId: id,
      sent: result.sent,
      remaining
    });
    return { ok: true, sent: result.sent, remaining, completed: remaining === 0 };
  } catch (error) {
    syncDiagnosticLog('UNSENT_BULK_BATCH_ERROR', {
      projectId: id,
      requested: entries.length,
      remaining: remainingBefore,
      message: error?.message || String(error)
    });
    markError(error);
    return { ok: false, sent: 0, remaining: remainingBefore, error, reason: 'write-failed' };
  } finally {
    endFirestoreActivity();
  }
}

/**
 * 大量未送信をユーザーの明示操作で50件ずつ送る。
 * 1バッチはFirestore writeBatchで原子的に確定し、失敗時は1件もキューから削除しない。
 * Repository書込キューへ入れるため、通常編集中の新しい保存と競合しない。
 */
export function retryUnsentBatch(options) {
  return enqueueRepositoryWrite(() => retryUnsentBatchNow(options));
}

function serializeChangeCursor(snapshotDoc) {
  if (!snapshotDoc) return null;
  const committedAt = snapshotDoc.data()?.committedAt;
  if (!committedAt || typeof committedAt.seconds !== 'number') return null;
  return {
    seconds: Number(committedAt.seconds),
    nanoseconds: Number(committedAt.nanoseconds || 0),
    changeId: snapshotDoc.id
  };
}

function cursorTimestamp(cursor) {
  if (!cursor || typeof cursor.seconds !== 'number') return null;
  return new Timestamp(Number(cursor.seconds), Number(cursor.nanoseconds || 0));
}

function deserializeFinishChangeDoc(item) {
  const data = item.data() || {};
  const committedAt = data.committedAt || null;
  const operation = data.operation === 'delete' ? 'delete' : data.operation === 'checkpoint' ? 'checkpoint' : 'set';
  const recordId = String(data.recordId || '');
  const record = operation === 'set' && data.record
    ? { ...data.record, finishId: recordId || data.record.finishId || '', updatedAt: committedAt }
    : null;
  return {
    recordType: 'finish',
    changeType: operation === 'delete' ? 'removed' : operation === 'checkpoint' ? 'checkpoint' : 'modified',
    operation,
    id: recordId,
    record,
    committedAt,
    changeId: item.id
  };
}

function deserializeSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

async function writeWithQueue({ projectId, environment, recordType, recordId, operation, localRecord, source = 'unspecified' }) {
  const entry = {
    projectId,
    environment,
    recordType,
    recordId,
    operation,
    record: localRecord
  };
  syncDiagnosticLog('WRITE_REQUEST', {
    projectId,
    environment,
    recordType,
    recordId,
    operation,
    source,
    manualOffline: isManualOffline(),
    networkOnline: isNetworkOnline()
  });

  if (isManualOffline()) {
    putUnsent(entry);
    syncDiagnosticLog('WRITE_QUEUED_MANUAL_OFFLINE', { projectId, recordType, recordId, operation, source });
    return { ok: false, queued: true, operation, offline: true, reason: 'manual-offline' };
  }

  if (!isNetworkOnline()) {
    putUnsent(entry);
    syncDiagnosticLog('WRITE_QUEUED_NETWORK_OFFLINE', { projectId, recordType, recordId, operation, source });
    return { ok: false, queued: true, operation, offline: true, reason: 'network-offline' };
  }

  beginFirestoreActivity();
  try {
    await commitRecordEntries([entry]);
    syncDiagnosticLog('WRITE_OK', { projectId, recordType, recordId, operation, source });

    const retryResult = await retryPastUnsent(projectId, PASSIVE_RETRY_LIMIT);
    return {
      ok: true,
      queued: false,
      operation,
      retried: Number(retryResult.sent || 0),
      retryError: retryResult.ok === false && !retryResult.skipped ? retryResult.error || null : null
    };
  } catch (error) {
    putUnsent(entry);
    syncDiagnosticLog('WRITE_ERROR', { projectId, recordType, recordId, operation, source, message: error?.message || String(error) });
    markError(error);
    return { ok: false, queued: true, operation, error };
  } finally {
    endFirestoreActivity();
  }
}

/** finishRecord本体と変更履歴を同一batchで確定する。 */
export function saveFinishRecord({ projectId, environment = 'production', record, source = 'finish-unspecified' }) {
  return enqueueRepositoryWrite(() => writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'set',
    localRecord: record,
    source
  }));
}

/** 内容差分の解消を他端末へ伝えるため、deleteも変更履歴と同一batchで確定する。 */
export function deleteFinishRecord({ projectId, environment = 'production', record, source = 'finish-delete-unspecified' }) {
  if (!record?.finishId) return Promise.resolve({ ok: true, skipped: true });
  return enqueueRepositoryWrite(() => writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'delete',
    localRecord: record,
    source
  }));
}

export function saveMaterialRecord({ projectId, environment = 'production', record, source = 'material-unspecified' }) {
  return enqueueRepositoryWrite(() => writeWithQueue({
    projectId,
    environment,
    recordType: 'material',
    recordId: record.materialId,
    operation: 'set',
    localRecord: record,
    source
  }));
}

export function savePhotoRecord({ projectId, environment = 'production', record, source = 'photo-unspecified' }) {
  return enqueueRepositoryWrite(() => writeWithQueue({
    projectId,
    environment,
    recordType: 'photo',
    recordId: record.photoId,
    operation: 'set',
    localRecord: record,
    source
  }));
}

/** 仮案件番号の他端末重複を避けるため、案件メタ情報を親Documentにも保持する。 */
export async function saveProjectMetadata(project, { initializeChangeLog = false } = {}) {
  syncDiagnosticLog('PROJECT_METADATA_WRITE_REQUEST', { projectId: project?.projectId || '', initializeChangeLog });
  if (!project?.projectId || project.isSample) return { ok: true, skipped: true };
  if (!canUseFirestore()) {
    return {
      ok: false,
      queued: true,
      offline: true,
      reason: isManualOffline() ? 'manual-offline' : 'network-offline'
    };
  }
  const environment = project.environment === 'test' ? 'test' : 'production';
  beginFirestoreActivity();
  try {
    await setDoc(projectDocRef(project.projectId, environment), {
      projectId: String(project.projectId),
      projectNo: String(project.projectNo || project.projectId),
      projectName: String(project.projectName || ''),
      address: String(project.address || ''),
      projectType: String(project.projectType || ''),
      isTemporary: Boolean(project.isTemporary),
      createdAt: String(project.createdAt || ''),
      ...(initializeChangeLog ? { finishChangeLogStartedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp()
    }, { merge: true });
    syncDiagnosticLog('PROJECT_METADATA_WRITE_OK', { projectId: project.projectId, initializeChangeLog });
    return { ok: true };
  } catch (error) {
    markError(error);
    throw error;
  } finally {
    endFirestoreActivity();
  }
}

/**
 * テスト案件専用の完全削除。
 * Firestore Web SDKには親Document削除だけでsubcollectionを再帰削除する機能がないため、
 * 3 Record collectionを先に削除してから案件親Documentを削除する。
 */
export async function deleteTestProjectCompletely(projectId) {
  const id = String(projectId || '');
  if (!id) throw new Error('削除対象の案件IDがありません。');
  const environment = 'test';

  for (const recordType of Object.keys(RECORD_COLLECTIONS)) {
    const snapshot = await getDocs(collectionRef(id, environment, recordType));
    const docs = snapshot.docs;
    for (let start = 0; start < docs.length; start += FINISH_BATCH_SIZE) {
      const batch = writeBatch(db);
      docs.slice(start, start + FINISH_BATCH_SIZE).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
  }

  const changeSnapshot = await getDocs(finishChangeLogCollectionRef(id, environment));
  for (let start = 0; start < changeSnapshot.docs.length; start += FINISH_BATCH_SIZE) {
    const batch = writeBatch(db);
    changeSnapshot.docs.slice(start, start + FINISH_BATCH_SIZE).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }

  const deviceSnapshot = await getDocs(collection(db, projectRoot(environment), id, SYNC_DEVICE_COLLECTION));
  for (let start = 0; start < deviceSnapshot.docs.length; start += FINISH_BATCH_SIZE) {
    const batch = writeBatch(db);
    deviceSnapshot.docs.slice(start, start + FINISH_BATCH_SIZE).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }

  await deleteDoc(projectDocRef(id, environment));
  return { ok: true };
}

/** 指定日の仮案件番号をFirestore親Documentから取得する。 */
export async function readTemporaryProjectNos(dateCode, environment = 'production') {
  const prefix = `${String(dateCode)}-`;
  const ref = collection(db, projectRoot(environment));
  const snapshot = await getDocs(query(
    ref,
    where('projectNo', '>=', prefix),
    where('projectNo', '<', `${prefix}\uf8ff`)
  ));
  return snapshot.docs
    .map((item) => String(item.data()?.projectNo || item.id || ''))
    .filter((value) => value.startsWith(prefix));
}

/**
 * 保存済みカーソルがまだ変更履歴内に残っているか確認する。
 * 物理deleteされたfinishRecordの取りこぼしを防ぐため、時刻推測だけでなく
 * カーソル自身のchangeLog Documentが存在することを確認する。
 */
export async function isFinishChangeCursorAvailable({ projectId, environment = 'production', cursor = null }) {
  syncDiagnosticLog('CURSOR_CHECK_START', { projectId, cursor });
  if (!cursor?.changeId || typeof cursor.seconds !== 'number') return false;
  const ageMs = Date.now() - ((Number(cursor.seconds) * 1000) + Math.floor(Number(cursor.nanoseconds || 0) / 1e6));
  if (ageMs > CHANGE_LOG_RETENTION_MS) return false;
  if (!canUseFirestore()) return true;
  const snapshot = await getDoc(doc(finishChangeLogCollectionRef(projectId, environment), String(cursor.changeId)));
  syncDiagnosticLog('CURSOR_CHECK_READ', { projectId, changeId: String(cursor.changeId), exists: snapshot.exists() });
  if (!snapshot.exists()) return false;
  const stored = serializeChangeCursor(snapshot);
  return Boolean(stored
    && stored.seconds === Number(cursor.seconds)
    && stored.nanoseconds === Number(cursor.nanoseconds || 0)
    && stored.changeId === String(cursor.changeId));
}

/** 案件ごとに、この端末が接触したことと最後に反映したfinish変更位置を記録する。 */
export async function touchProjectSyncDevice({
  projectId, environment = 'production', deviceCode, deviceName, finishChangeCursor = null
}) {
  syncDiagnosticLog('DEVICE_TOUCH_REQUEST', { projectId, deviceCode, deviceName, finishChangeCursor });
  const code = String(deviceCode || '').trim();
  if (!projectId || !code || !canUseFirestore()) return { ok: true, skipped: true };
  try {
    await setDoc(projectSyncDeviceRef(projectId, environment, code), {
      deviceCode: code,
      deviceName: String(deviceName || ''),
      lastSeenAt: serverTimestamp(),
      finishChangeCursor: finishChangeCursor || null
    }, { merge: true });
    syncDiagnosticLog('DEVICE_TOUCH_OK', { projectId, deviceCode: code });
    return { ok: true };
  } catch (error) {
    syncDiagnosticLog('DEVICE_TOUCH_ERROR', { projectId, deviceCode: code, message: error?.message || String(error) });
    markError(error);
    return { ok: false, error };
  }
}

/**
 * 30日を過ぎたfinish変更履歴を最大200件だけ整理する。
 * Firestore TTLへ依存せず無料枠内でも運用できるよう、案件同期時の低頻度清掃用とする。
 */
export async function cleanupExpiredFinishChangeLogs({ projectId, environment = 'production' }) {
  syncDiagnosticLog('CHANGELOG_CLEANUP_START', { projectId });
  if (!projectId || !canUseFirestore()) return { ok: true, skipped: true, deleted: 0 };
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const snapshot = await getDocs(query(
    ref,
    where('expiresAt', '<=', Timestamp.now()),
    orderBy('expiresAt'),
    limit(CHANGE_LOG_CLEANUP_LIMIT)
  ));
  syncDiagnosticLog('CHANGELOG_CLEANUP_READ', { projectId, expiredCount: snapshot.docs.length });
  if (!snapshot.docs.length) return { ok: true, deleted: 0 };
  const batch = writeBatch(db);
  snapshot.docs.forEach((item) => batch.delete(item.ref));
  await batch.commit();
  syncDiagnosticLog('CHANGELOG_CLEANUP_DELETE_OK', { projectId, deleted: snapshot.docs.length });
  return { ok: true, deleted: snapshot.docs.length };
}

/** 変更履歴がまだ無い案件に、同期開始点となるcheckpointを1件だけ作る。 */
export async function createFinishChangeLogCheckpoint({ projectId, environment = 'production' }) {
  syncDiagnosticLog('CHECKPOINT_CREATE_START', { projectId });
  if (!canUseFirestore()) return null;
  const logRef = doc(finishChangeLogCollectionRef(projectId, environment));
  const batch = writeBatch(db);
  batch.set(logRef, {
    recordType: 'finish',
    recordId: '',
    operation: 'checkpoint',
    record: null,
    committedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + CHANGE_LOG_RETENTION_MS)
  });
  batch.set(projectDocRef(projectId, environment), {
    finishChangeLogEpochStartedAt: serverTimestamp(),
    finishChangeLogEpochCheckpointId: logRef.id
  }, { merge: true });
  await batch.commit();
  syncDiagnosticLog('CHECKPOINT_CREATE_WRITE_OK', { projectId, changeId: logRef.id });
  const snapshot = await getDocs(query(
    finishChangeLogCollectionRef(projectId, environment),
    orderBy('committedAt', 'desc'), orderBy(documentId(), 'desc'), limit(1)
  ));
  syncDiagnosticLog('CHECKPOINT_CURSOR_READ', { projectId, docs: snapshot.docs.length });
  return serializeChangeCursor(snapshot.docs[0] || null);
}

/** finishRecordの変更履歴をカーソル以降だけ取得する。 */
export async function readFinishChangeLog({ projectId, environment = 'production', cursor = null }) {
  syncDiagnosticLog('CHANGELOG_READ_START', { projectId, cursor });
  if (!canUseFirestore()) return { changes: [], cursor };
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const ts = cursorTimestamp(cursor);
  const source = ts
    ? query(ref, orderBy('committedAt'), orderBy(documentId()), startAfter(ts, String(cursor.changeId || '')))
    : query(ref, orderBy('committedAt'), orderBy(documentId()));
  const snapshot = await getDocs(source);
  const docs = snapshot.docs;
  syncDiagnosticLog('CHANGELOG_READ_RESULT', { projectId, count: docs.length, fromCursor: cursor?.changeId || null });
  return {
    changes: docs.map(deserializeFinishChangeDoc),
    cursor: docs.length ? serializeChangeCursor(docs[docs.length - 1]) : cursor
  };
}

/** 現在のfinish変更履歴の末尾だけ取得し、全件復元後の開始カーソルにする。 */
export async function readLatestFinishChangeCursor({ projectId, environment = 'production' }) {
  syncDiagnosticLog('CHANGELOG_LATEST_CURSOR_READ_START', { projectId });
  if (!canUseFirestore()) return null;
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const snapshot = await getDocs(query(
    ref,
    orderBy('committedAt', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(1)
  ));
  syncDiagnosticLog('CHANGELOG_LATEST_CURSOR_READ_RESULT', { projectId, count: snapshot.docs.length });
  return serializeChangeCursor(snapshot.docs[0] || null);
}

/** finish変更履歴だけをリアルタイム監視する。 */
export function subscribeFinishChangeLog({ projectId, environment = 'production', afterCursor = null, onChanges, onState, onError }) {
  syncDiagnosticLog('CHANGELOG_LISTENER_START', { projectId, afterCursor });
  if (!canUseFirestore()) return () => {};
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const ts = cursorTimestamp(afterCursor);
  const source = ts
    ? query(ref, orderBy('committedAt'), orderBy(documentId()), startAfter(ts, String(afterCursor.changeId || '')))
    : query(ref, orderBy('committedAt'), orderBy(documentId()));

  const unsubscribe = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
    syncDiagnosticLog('CHANGELOG_LISTENER_SNAPSHOT', { projectId, size: snapshot.size, changes: snapshot.docChanges().length, fromCache: Boolean(snapshot.metadata?.fromCache), pending: Boolean(snapshot.metadata?.hasPendingWrites) });
    onState?.({ recordType: 'finish', fromCache: Boolean(snapshot.metadata?.fromCache), hasPendingWrites: Boolean(snapshot.metadata?.hasPendingWrites) });
    const docs = snapshot.docChanges()
      .filter((change) => change.type !== 'removed' && !change.doc.metadata?.hasPendingWrites)
      .map((change) => deserializeFinishChangeDoc(change.doc));
    if (docs.length) onChanges?.(docs, serializeChangeCursor(snapshot.docs[snapshot.docs.length - 1] || null));
  }, (error) => {
    syncDiagnosticLog('CHANGELOG_LISTENER_ERROR', { projectId, message: error?.message || String(error) });
    onError?.(error);
  });
  return () => {
    syncDiagnosticLog('CHANGELOG_LISTENER_STOP', { projectId });
    unsubscribe();
  };
}

/** 3Recordそれぞれの基準時刻以降を1回だけ取得する。 */
export async function readProjectRecordsOnce({
  projectId,
  environment = 'production',
  sinceByType = null,
  recordTypes = Object.keys(RECORD_COLLECTIONS)
}) {
  syncDiagnosticLog('RECORD_READ_START', { projectId, recordTypes, sinceByType });
  if (!canUseFirestore()) {
    syncDiagnosticLog('RECORD_READ_SKIPPED_OFFLINE', { projectId, recordTypes });
    return { finishRecords: [], materialRecords: [], photoRecords: [] };
  }

  const entries = await Promise.all(recordTypes.map(async (recordType) => {
    const ref = collectionRef(projectId, environment, recordType);
    const since = Number(sinceByType?.[recordType] || 0);
    const source = since > 0
      ? query(ref, where('updatedAt', '>', Timestamp.fromMillis(since)))
      : ref;
    const snapshot = await getDocs(source);
    syncDiagnosticLog('RECORD_READ_RESULT', { projectId, recordType, count: snapshot.docs.length, since });
    return [recordType, deserializeSnapshot(snapshot)];
  }));
  const byType = Object.fromEntries(entries);
  return {
    finishRecords: byType.finish || [],
    materialRecords: byType.material || [],
    photoRecords: byType.photo || []
  };
}

/**
 * 1回の取りこぼし回収が終わった後だけ使うリアルタイム監視。
 * afterByTypeは「今回の監視開始時点で各Recordがどこまで揃っているか」を表す。
 * 前回案件切替時の古いlastSyncedAtを長時間listener条件として使い続けない。
 */
export function subscribeProjectRecordChanges({
  projectId,
  environment = 'production',
  afterByType = {},
  recordTypes = Object.keys(RECORD_COLLECTIONS),
  onChanges,
  onState,
  onError
}) {
  syncDiagnosticLog('RECORD_LISTENER_GROUP_START', { projectId, recordTypes, afterByType });
  if (!canUseFirestore()) return () => {};

  let closed = false;
  const unsubscribers = recordTypes.map((recordType) => {
    const ref = collectionRef(projectId, environment, recordType);
    const after = Number(afterByType?.[recordType] || 0);
    const source = after > 0
      ? query(ref, where('updatedAt', '>', Timestamp.fromMillis(after)))
      : ref;

    return onSnapshot(
      source,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (closed) return;
        syncDiagnosticLog('RECORD_LISTENER_SNAPSHOT', { projectId, recordType, size: snapshot.size, changes: snapshot.docChanges().length, fromCache: Boolean(snapshot.metadata?.fromCache), pending: Boolean(snapshot.metadata?.hasPendingWrites) });
        onState?.({
          recordType,
          fromCache: Boolean(snapshot.metadata?.fromCache),
          hasPendingWrites: Boolean(snapshot.metadata?.hasPendingWrites)
        });

        const changes = snapshot.docChanges().map((change) => ({
          recordType,
          changeType: change.type,
          id: change.doc.id,
          record: change.type === 'removed' ? null : { id: change.doc.id, ...change.doc.data() },
          hasPendingWrites: Boolean(change.doc.metadata?.hasPendingWrites)
        }));

        const remoteChanges = changes.filter((change) => !change.hasPendingWrites);
        if (remoteChanges.length) onChanges?.(remoteChanges);
      },
      (error) => onError?.(error)
    );
  });

  return () => {
    syncDiagnosticLog('RECORD_LISTENER_GROUP_STOP', { projectId, recordTypes });
    closed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
