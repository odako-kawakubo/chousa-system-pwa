/**
 * src/js/firestore/firestore-repository.js
 *
 * v0.1.6.2H Firestore Repository。
 * finishRecordは疎保存し、set/deleteを短期変更履歴にも同一batchで記録する。
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
import { putUnsent, removeUnsent } from '../sync/unsent-queue.js';
import {
  isManualOffline,
  beginFirestoreActivity,
  endFirestoreActivity,
  markError
} from '../sync/sync-status.js';

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

async function writeWithQueue({ projectId, environment, recordType, recordId, operation, localRecord, run }) {
  if (isManualOffline()) {
    putUnsent({
      projectId,
      environment,
      recordType,
      recordId,
      operation,
      record: localRecord
    });
    return { ok: false, queued: true, operation, offline: true };
  }

  beginFirestoreActivity();
  try {
    await run();
    removeUnsent(projectId, recordType, recordId);
    endFirestoreActivity();
    return { ok: true, queued: false, operation };
  } catch (error) {
    putUnsent({
      projectId,
      environment,
      recordType,
      recordId,
      operation,
      record: localRecord
    });
    markError(error);
    endFirestoreActivity();
    return { ok: false, queued: true, operation, error };
  }
}

/** finishRecord本体と変更履歴を同一batchで確定する。 */
export async function saveFinishRecord({ projectId, environment = 'production', record }) {
  return writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'set',
    localRecord: record,
    run: async () => {
      const batch = writeBatch(db);
      batch.set(
        recordRef(projectId, environment, 'finish', record.finishId),
        serializeFinishRecord(record, { updatedAt: serverTimestamp() })
      );
      appendFinishChangeToBatch(batch, { projectId, environment, recordId: record.finishId, operation: 'set', record });
      await batch.commit();
    }
  });
}

/** 内容差分の解消を他端末へ伝えるため、deleteも変更履歴と同一batchで確定する。 */
export async function deleteFinishRecord({ projectId, environment = 'production', record }) {
  if (!record?.finishId) return { ok: true, skipped: true };
  return writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'delete',
    localRecord: record,
    run: async () => {
      const batch = writeBatch(db);
      batch.delete(recordRef(projectId, environment, 'finish', record.finishId));
      appendFinishChangeToBatch(batch, { projectId, environment, recordId: record.finishId, operation: 'delete' });
      await batch.commit();
    }
  });
}

export async function saveMaterialRecord({ projectId, environment = 'production', record }) {
  return writeWithQueue({
    projectId,
    environment,
    recordType: 'material',
    recordId: record.materialId,
    operation: 'set',
    localRecord: record,
    run: () => setDoc(
      recordRef(projectId, environment, 'material', record.materialId),
      serializeMaterialRecord(record, { updatedAt: serverTimestamp() })
    )
  });
}

export async function savePhotoRecord({ projectId, environment = 'production', record }) {
  return writeWithQueue({
    projectId,
    environment,
    recordType: 'photo',
    recordId: record.photoId,
    operation: 'set',
    localRecord: record,
    run: () => setDoc(
      recordRef(projectId, environment, 'photo', record.photoId),
      serializePhotoRecord(record, { updatedAt: serverTimestamp() })
    )
  });
}

/** 仮案件番号の他端末重複を避けるため、案件メタ情報を親Documentにも保持する。 */
export async function saveProjectMetadata(project, { initializeChangeLog = false } = {}) {
  if (!project?.projectId || project.isSample) return { ok: true, skipped: true };
  if (isManualOffline()) return { ok: false, queued: true, offline: true };
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
    endFirestoreActivity();
    return { ok: true };
  } catch (error) {
    markError(error);
    endFirestoreActivity();
    throw error;
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
  if (!cursor?.changeId || typeof cursor.seconds !== 'number') return false;
  const ageMs = Date.now() - ((Number(cursor.seconds) * 1000) + Math.floor(Number(cursor.nanoseconds || 0) / 1e6));
  if (ageMs > CHANGE_LOG_RETENTION_MS) return false;
  if (isManualOffline()) return true;
  const snapshot = await getDoc(doc(finishChangeLogCollectionRef(projectId, environment), String(cursor.changeId)));
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
  const code = String(deviceCode || '').trim();
  if (!projectId || !code || isManualOffline()) return { ok: true, skipped: true };
  try {
    await setDoc(projectSyncDeviceRef(projectId, environment, code), {
      deviceCode: code,
      deviceName: String(deviceName || ''),
      lastSeenAt: serverTimestamp(),
      finishChangeCursor: finishChangeCursor || null
    }, { merge: true });
    return { ok: true };
  } catch (error) {
    markError(error);
    return { ok: false, error };
  }
}

/**
 * 30日を過ぎたfinish変更履歴を最大200件だけ整理する。
 * Firestore TTLへ依存せず無料枠内でも運用できるよう、案件同期時の低頻度清掃用とする。
 */
export async function cleanupExpiredFinishChangeLogs({ projectId, environment = 'production' }) {
  if (!projectId || isManualOffline()) return { ok: true, skipped: true, deleted: 0 };
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const snapshot = await getDocs(query(
    ref,
    where('expiresAt', '<=', Timestamp.now()),
    orderBy('expiresAt'),
    limit(CHANGE_LOG_CLEANUP_LIMIT)
  ));
  if (!snapshot.docs.length) return { ok: true, deleted: 0 };
  const batch = writeBatch(db);
  snapshot.docs.forEach((item) => batch.delete(item.ref));
  await batch.commit();
  return { ok: true, deleted: snapshot.docs.length };
}

/** 変更履歴がまだ無い案件に、同期開始点となるcheckpointを1件だけ作る。 */
export async function createFinishChangeLogCheckpoint({ projectId, environment = 'production' }) {
  if (isManualOffline()) return null;
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
  const snapshot = await getDocs(query(
    finishChangeLogCollectionRef(projectId, environment),
    orderBy('committedAt', 'desc'), orderBy(documentId(), 'desc'), limit(1)
  ));
  return serializeChangeCursor(snapshot.docs[0] || null);
}

/** finishRecordの変更履歴をカーソル以降だけ取得する。 */
export async function readFinishChangeLog({ projectId, environment = 'production', cursor = null }) {
  if (isManualOffline()) return { changes: [], cursor };
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const ts = cursorTimestamp(cursor);
  const source = ts
    ? query(ref, orderBy('committedAt'), orderBy(documentId()), startAfter(ts, String(cursor.changeId || '')))
    : query(ref, orderBy('committedAt'), orderBy(documentId()));
  const snapshot = await getDocs(source);
  const docs = snapshot.docs;
  return {
    changes: docs.map(deserializeFinishChangeDoc),
    cursor: docs.length ? serializeChangeCursor(docs[docs.length - 1]) : cursor
  };
}

/** 現在のfinish変更履歴の末尾だけ取得し、全件復元後の開始カーソルにする。 */
export async function readLatestFinishChangeCursor({ projectId, environment = 'production' }) {
  if (isManualOffline()) return null;
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const snapshot = await getDocs(query(
    ref,
    orderBy('committedAt', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(1)
  ));
  return serializeChangeCursor(snapshot.docs[0] || null);
}

/** finish変更履歴だけをリアルタイム監視する。 */
export function subscribeFinishChangeLog({ projectId, environment = 'production', afterCursor = null, onChanges, onState, onError }) {
  if (isManualOffline()) return () => {};
  const ref = finishChangeLogCollectionRef(projectId, environment);
  const ts = cursorTimestamp(afterCursor);
  const source = ts
    ? query(ref, orderBy('committedAt'), orderBy(documentId()), startAfter(ts, String(afterCursor.changeId || '')))
    : query(ref, orderBy('committedAt'), orderBy(documentId()));

  return onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
    onState?.({ recordType: 'finish', fromCache: Boolean(snapshot.metadata?.fromCache), hasPendingWrites: Boolean(snapshot.metadata?.hasPendingWrites) });
    const docs = snapshot.docChanges()
      .filter((change) => change.type !== 'removed' && !change.doc.metadata?.hasPendingWrites)
      .map((change) => deserializeFinishChangeDoc(change.doc));
    if (docs.length) onChanges?.(docs, serializeChangeCursor(snapshot.docs[snapshot.docs.length - 1] || null));
  }, (error) => onError?.(error));
}

/** 3Recordそれぞれの基準時刻以降を1回だけ取得する。 */
export async function readProjectRecordsOnce({
  projectId,
  environment = 'production',
  sinceByType = null,
  recordTypes = Object.keys(RECORD_COLLECTIONS)
}) {
  if (isManualOffline()) {
    return { finishRecords: [], materialRecords: [], photoRecords: [] };
  }

  const entries = await Promise.all(recordTypes.map(async (recordType) => {
    const ref = collectionRef(projectId, environment, recordType);
    const since = Number(sinceByType?.[recordType] || 0);
    const source = since > 0
      ? query(ref, where('updatedAt', '>', Timestamp.fromMillis(since)))
      : ref;
    const snapshot = await getDocs(source);
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
  if (isManualOffline()) return () => {};

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

        // 自端末のローカルpending writeはStoreへ戻さない。server ack後は
        // fieldEditedAt比較で同一変更として除外される。
        const remoteChanges = changes.filter((change) => !change.hasPendingWrites);
        if (remoteChanges.length) onChanges?.(remoteChanges);
      },
      (error) => onError?.(error)
    );
  });

  return () => {
    closed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

