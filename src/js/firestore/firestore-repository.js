/**
 * src/js/firestore/firestore-repository.js
 *
 * v0.1.6.2C Firestore Repository。
 * finishRecordは「案件の仕上表構造そのもの」を全件保持する。
 * 案件作成時は初期構造を一括登録し、その後は変更Recordだけ差分更新する。
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

  return {
    ok: results.every((item) => item.ok),
    queued: results.some((item) => !item.ok),
    count: valid.length,
    results
  };
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
  const environment = project.environment === 'test' ? 'test' : 'production';
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

async function readCollection({ projectId, environment, recordType, since = null }) {
  const ref = collectionRef(projectId, environment, recordType);
  const timestamp = toTimestamp(since);
  const source = timestamp ? query(ref, where('updatedAt', '>', timestamp)) : ref;
  return deserializeSnapshot(await getDocs(source));
}

/**
 * 案件を開く際のFirestore取得基盤。
 * finishRecordは案件構造そのものなので常に全件取得する。
 * material/photoはバックアップ復元時のみbackupAt後の差分取得を許容する。
 */
export async function readProjectRecords({ projectId, environment = 'production', backupAt = null }) {
  const hasBackup = Boolean(toTimestamp(backupAt));
  const [finishRecords, materialRecords, photoRecords] = await Promise.all([
    readCollection({ projectId, environment, recordType: 'finish' }),
    readCollection({ projectId, environment, recordType: 'material', since: hasBackup ? backupAt : null }),
    readCollection({ projectId, environment, recordType: 'photo', since: hasBackup ? backupAt : null })
  ]);

  return {
    mode: hasBackup ? 'backup-plus-firestore' : 'firestore-full',
    finishRecords,
    materialRecords,
    photoRecords
  };
}
