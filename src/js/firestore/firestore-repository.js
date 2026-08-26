/**
 * src/js/firestore/firestore-repository.js
 *
 * v0.1.6.1C Firestore 1レコード保存・読込の共通Repository。
 * UIイベントとはまだ直結しない。後続版は必ずこの入口を通して保存・読込する。
 */

import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseApp } from '../../config/firebase-config.js';
import {
  getFinishPersistenceDecision,
  serializeFinishRecord,
  serializeMaterialRecord,
  serializePhotoRecord
} from './record-serializer.js';
import { putUnsent, removeUnsent } from '../sync/unsent-queue.js';

const db = getFirestore(firebaseApp);
const RECORD_COLLECTIONS = Object.freeze({
  finish: 'finishRecords',
  material: 'materialRecords',
  photo: 'photoRecords'
});

function projectRoot(environment) {
  return environment === 'test' ? 'testProjects' : 'projects';
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
  try {
    await run();
    removeUnsent(projectId, recordType, recordId);
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
    return { ok: false, queued: true, operation, error };
  }
}

/** finishRecordは初期差分判定をRepository内で必ず通す。 */
export async function saveFinishRecord({ projectId, environment = 'production', record }) {
  const decision = getFinishPersistenceDecision(record);
  const ref = recordRef(projectId, environment, 'finish', record.finishId);

  if (decision === 'delete') {
    return writeWithQueue({
      projectId,
      environment,
      recordType: 'finish',
      recordId: record.finishId,
      operation: 'delete',
      localRecord: record,
      run: () => deleteDoc(ref)
    });
  }

  return writeWithQueue({
    projectId,
    environment,
    recordType: 'finish',
    recordId: record.finishId,
    operation: 'set',
    localRecord: record,
    run: () => setDoc(ref, serializeFinishRecord(record, { updatedAt: serverTimestamp() }))
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

async function readCollection({ projectId, environment, recordType, since = null }) {
  const ref = collectionRef(projectId, environment, recordType);
  const timestamp = toTimestamp(since);
  const source = timestamp ? query(ref, where('updatedAt', '>', timestamp)) : ref;
  return deserializeSnapshot(await getDocs(source));
}

/**
 * 案件を開く際のFirestore取得基盤。
 *
 * backupAtなし:
 *   3レコードすべて一式取得。
 *
 * backupAtあり:
 *   material/photoはbackupAt後の差分だけ取得。
 *   finishは一式取得する。
 *
 * finishだけ全取得する理由:
 *   初期状態へ戻したfinishRecordはFirestoreドキュメントを物理削除する仕様のため、
 *   updatedAt > backupAt のqueryだけでは「バックアップ後に削除された」事実を取得できない。
 *   現在存在するfinish差分一式を取得し、default + current Firestore差分で確定する。
 */
export async function readProjectRecords({ projectId, environment = 'production', backupAt = null }) {
  const hasBackup = Boolean(toTimestamp(backupAt));
  const [finishRecords, materialRecords, photoRecords] = await Promise.all([
    readCollection({ projectId, environment, recordType: 'finish' }),
    readCollection({ projectId, environment, recordType: 'material', since: hasBackup ? backupAt : null }),
    readCollection({ projectId, environment, recordType: 'photo', since: hasBackup ? backupAt : null })
  ]);

  return {
    mode: hasBackup ? 'backup-plus-firestore' : 'default-plus-firestore',
    finishRecords,
    materialRecords,
    photoRecords
  };
}
