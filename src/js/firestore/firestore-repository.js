/**
 * src/js/firestore/firestore-repository.js
 *
 * v0.1.6.2G Firestore Repository。
 * finishRecordは「案件の仕上表構造そのもの」を全件保持する。
 * 案件作成時は初期構造を一括登録し、その後は変更Recordだけ差分更新する。
 */

import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch
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
const FINISH_BATCH_SIZE = 400;

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

/** finishRecordは空欄でも案件構造の一部として常にsetする。 */
export async function saveFinishRecord({ projectId, environment = 'production', record }) {
  return writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'set',
    localRecord: record,
    run: () => setDoc(
      recordRef(projectId, environment, 'finish', record.finishId),
      serializeFinishRecord(record, { updatedAt: serverTimestamp() })
    )
  });
}

/** 構造削除時だけfinishRecordを物理削除する。 */
export async function deleteFinishRecord({ projectId, environment = 'production', record }) {
  if (!record?.finishId) return { ok: true, skipped: true };
  return writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'delete',
    localRecord: record,
    run: () => deleteDoc(recordRef(projectId, environment, 'finish', record.finishId))
  });
}

/** 案件作成・構造追加時のfinishRecord一括登録。 */
export async function saveFinishRecordsBatch({ projectId, environment = 'production', records = [] }) {
  const valid = records.filter((record) => record?.finishId);
  const results = [];

  if (isManualOffline()) {
    valid.forEach((record) => putUnsent({
      projectId,
      environment,
      recordType: 'finish',
      recordId: record.finishId,
      operation: 'set',
      record
    }));
    return { ok: false, queued: true, offline: true, count: valid.length, results: [] };
  }

  beginFirestoreActivity();
  for (let start = 0; start < valid.length; start += FINISH_BATCH_SIZE) {
    const chunk = valid.slice(start, start + FINISH_BATCH_SIZE);
    try {
      const batch = writeBatch(db);
      chunk.forEach((record) => {
        batch.set(
          recordRef(projectId, environment, 'finish', record.finishId),
          serializeFinishRecord(record, { updatedAt: serverTimestamp() })
        );
      });
      await batch.commit();
      chunk.forEach((record) => removeUnsent(projectId, 'finish', record.finishId));
      results.push({ ok: true, count: chunk.length });
    } catch (error) {
      chunk.forEach((record) => putUnsent({
        projectId,
        environment,
        recordType: 'finish',
        recordId: record.finishId,
        operation: 'set',
        record
      }));
      results.push({ ok: false, count: chunk.length, error });
    }
  }

  const response = {
    ok: results.every((item) => item.ok),
    queued: results.some((item) => !item.ok),
    count: valid.length,
    results
  };
  if (!response.ok) markError(results.find((item) => !item.ok)?.error);
  endFirestoreActivity();
  return response;
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
export async function saveProjectMetadata(project) {
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



/** 3Recordそれぞれの基準時刻以降を1回だけ取得する。 */
export async function readProjectRecordsOnce({
  projectId,
  environment = 'production',
  sinceByType = null
}) {
  if (isManualOffline()) {
    return { finishRecords: [], materialRecords: [], photoRecords: [] };
  }

  const entries = await Promise.all(Object.keys(RECORD_COLLECTIONS).map(async (recordType) => {
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
  onChanges,
  onState,
  onError
}) {
  if (isManualOffline()) return () => {};

  let closed = false;
  const unsubscribers = Object.keys(RECORD_COLLECTIONS).map((recordType) => {
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

