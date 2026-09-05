/**
 * src/js/photos/photo-local-store.js
 *
 * 写真本体のローカル正本。
 * - photoRecordへDataURLを持たせず、IndexedDBへBlobとして保存する。
 * - original / completed を photoId ごとに分離する。
 * - OneDrive送信状態も photoId × variant 単位でここへ永続化する。
 * - IndexedDB内部構造はこのモジュールだけが知り、送信側へはAPIだけを公開する。
 */

const DB_NAME = 'chousa-system-pwa';
const DB_VERSION = 1;
const BLOB_STORE = 'photoBlobs';
const RECORD_STORE = 'cameraPhotoRecords';

let dbPromise = null;
const listeners = [];

function publish() {
  listeners.slice().forEach((callback) => callback());
}

export function subscribePhotoLocalStore(callback) {
  if (typeof callback !== 'function') return () => undefined;
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDBが利用できません。'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        db.createObjectStore(RECORD_STORE, { keyPath: 'photoId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDBを開けませんでした。'));
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB処理に失敗しました。'));
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let value;
    try {
      value = callback(store, tx);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function replaceBlobEntry(key, updater) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    const store = tx.objectStore(BLOB_STORE);
    let nextValue = null;
    const request = store.get(key);

    request.onsuccess = () => {
      try {
        nextValue = updater(request.result || null);
        if (nextValue) store.put(nextValue);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error || new Error('写真キャッシュを取得できませんでした。'));
    tx.oncomplete = () => resolve(nextValue);
    tx.onerror = () => reject(tx.error || new Error('写真キャッシュを更新できませんでした。'));
    tx.onabort = () => reject(tx.error || new Error('写真キャッシュの更新を中止しました。'));
  });
}

export function blobKey(photoId, variant) {
  return `${photoId}:${variant}`;
}

/**
 * Blobを保存する。
 * completedを再編集した場合はpendingへ戻すが、originalは編集処理で再保存されても
 * 既にuploadedなら送信済み状態を維持する。元画像自体は看板編集では変化しないため。
 */
export async function savePhotoBlob(photoId, variant, blob, metadata = {}) {
  const key = blobKey(photoId, variant);
  const requestedStatus = metadata.uploadStatus || 'pending';

  await replaceBlobEntry(key, (existing) => {
    const preserveOriginalUpload = variant === 'original'
      && requestedStatus === 'pending'
      && existing?.uploadStatus === 'uploaded';

    return {
      ...(existing || {}),
      key,
      photoId,
      variant,
      blob,
      mimeType: blob?.type || existing?.mimeType || 'image/jpeg',
      size: Number(blob?.size || 0),
      projectId: String(metadata.projectId || existing?.projectId || ''),
      createdAt: metadata.createdAt || existing?.createdAt || new Date().toISOString(),
      fileName: metadata.fileName || existing?.fileName || '',
      uploadStatus: preserveOriginalUpload ? 'uploaded' : requestedStatus,
      uploadedItemId: existing?.uploadedItemId || '',
      uploadedDriveId: existing?.uploadedDriveId || '',
      uploadedFileName: existing?.uploadedFileName || '',
      uploadedAt: existing?.uploadedAt || '',
      supersededUploads: Array.isArray(existing?.supersededUploads) ? existing.supersededUploads : [],
      lastUploadError: preserveOriginalUpload ? '' : (requestedStatus === 'pending' ? '' : existing?.lastUploadError || '')
    };
  });

  publish();
  return key;
}

export async function getPhotoBlobEntry(photoId, variant = 'completed') {
  const db = await openDb();
  const tx = db.transaction(BLOB_STORE, 'readonly');
  const record = await requestToPromise(tx.objectStore(BLOB_STORE).get(blobKey(photoId, variant)));
  return record ? { ...record } : null;
}

export async function getPhotoBlob(photoId, variant = 'completed') {
  const record = await getPhotoBlobEntry(photoId, variant);
  return record?.blob || null;
}

export async function listPhotoBlobEntries() {
  const db = await openDb();
  const tx = db.transaction(BLOB_STORE, 'readonly');
  const rows = await requestToPromise(tx.objectStore(BLOB_STORE).getAll());
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
}

/** 現案件の未送信variantだけ返す。 */
export async function listPendingPhotoBlobEntries(projectId) {
  const id = String(projectId || '');
  if (!id) return [];
  const rows = await listPhotoBlobEntries();
  return rows.filter((row) => (
    String(row.projectId || '') === id
    && row.uploadStatus !== 'uploaded'
    && (row.variant === 'original' || row.variant === 'completed')
    && row.blob instanceof Blob
  ));
}

/**
 * 既存写真キャッシュを案件へ帰属させる。
 * 旧キャッシュや撮影直後のBlobにはprojectIdが無い場合があるため、
 * 現案件のphotoRecordと照合できた時だけ明示的に付与する。
 */
export async function assignPhotoProject(photoId, projectId) {
  const targetPhotoId = String(photoId || '');
  const targetProjectId = String(projectId || '');
  if (!targetPhotoId || !targetProjectId) return 0;

  const db = await openDb();
  let changed = 0;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    const store = tx.objectStore(BLOB_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      rows.forEach((row) => {
        if (String(row?.photoId || '') !== targetPhotoId) return;
        if (String(row.projectId || '') === targetProjectId) return;
        store.put({ ...row, projectId: targetProjectId });
        changed += 1;
      });
    };
    request.onerror = () => reject(request.error || new Error('写真キャッシュの案件紐付けに失敗しました。'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('写真キャッシュの案件紐付けに失敗しました。'));
    tx.onabort = () => reject(tx.error || new Error('写真キャッシュの案件紐付けを中止しました。'));
  });

  if (changed) publish();
  return changed;
}

/** OneDrive実在確認まで成功したvariantだけuploadedへ進める。 */
export async function markPhotoBlobUploaded(photoId, variant, upload = {}) {
  const key = blobKey(photoId, variant);
  const next = await replaceBlobEntry(key, (existing) => {
    if (!existing) return null;

    const nextItemId = String(upload.itemId || upload.id || '');
    const nextDriveId = String(upload.driveId || '');
    const nextFileName = String(upload.fileName || upload.name || existing.fileName || '');
    const superseded = Array.isArray(existing.supersededUploads) ? [...existing.supersededUploads] : [];

    if (existing.uploadedItemId && existing.uploadedItemId !== nextItemId) {
      superseded.push({
        driveId: existing.uploadedDriveId || '',
        itemId: existing.uploadedItemId,
        fileName: existing.uploadedFileName || '',
        uploadedAt: existing.uploadedAt || ''
      });
    }

    return {
      ...existing,
      uploadStatus: 'uploaded',
      uploadedItemId: nextItemId,
      uploadedDriveId: nextDriveId,
      uploadedFileName: nextFileName,
      uploadedAt: upload.uploadedAt || new Date().toISOString(),
      supersededUploads: superseded,
      lastUploadError: ''
    };
  });
  if (next) publish();
  return next;
}

/** 失敗はpendingのまま保持し、自動連続再試行は発生させない。 */
export async function recordPhotoBlobUploadError(photoId, variant, error) {
  const key = blobKey(photoId, variant);
  return replaceBlobEntry(key, (existing) => existing ? {
    ...existing,
    uploadStatus: 'pending',
    lastUploadError: String(error?.message || error || 'OneDrive送信に失敗しました。')
  } : null);
}

export async function saveCameraPhotoRecord(record) {
  await withStore(RECORD_STORE, 'readwrite', (store) => {
    store.put({ ...record });
  });
}

export async function getCameraPhotoRecords() {
  const db = await openDb();
  const tx = db.transaction(RECORD_STORE, 'readonly');
  const rows = await requestToPromise(tx.objectStore(RECORD_STORE).getAll());
  return Array.isArray(rows) ? rows : [];
}

export async function saveCapturedPhoto({ record, originalBlob, completedBlob, projectId = '' }) {
  if (!record?.photoId) throw new Error('photoIdがありません。');
  if (!(originalBlob instanceof Blob) || !(completedBlob instanceof Blob)) {
    throw new Error('保存対象の画像Blobがありません。');
  }

  const metadata = {
    projectId,
    createdAt: record.capturedAt,
    fileName: record.fileName,
    uploadStatus: 'pending'
  };

  await savePhotoBlob(record.photoId, 'original', originalBlob, metadata);
  await savePhotoBlob(record.photoId, 'completed', completedBlob, metadata);
  await saveCameraPhotoRecord(record);
}

/** 撮影後編集でphotoRecordのローカル永続版だけ更新する。 */
export async function updateCameraPhotoRecord(record) {
  await saveCameraPhotoRecord(record);
}

/**
 * 案件を端末から削除するとき、指定photoId群の画像Blobとカメラ写真Recordを消す。
 * photoRecord自体は案件Store/Firestore側で管理するため、ここではIndexedDBだけを担当する。
 */
export async function deleteLocalPhotoData(photoIds = []) {
  const ids = new Set((Array.isArray(photoIds) ? photoIds : [])
    .map((value) => String(value || ''))
    .filter(Boolean));
  if (!ids.size) return { deletedRecords: 0, deletedBlobs: 0 };

  const db = await openDb();
  let deletedRecords = 0;
  let deletedBlobs = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction([RECORD_STORE, BLOB_STORE], 'readwrite');
    const recordStore = tx.objectStore(RECORD_STORE);
    const blobStore = tx.objectStore(BLOB_STORE);

    ids.forEach((photoId) => {
      recordStore.delete(photoId);
      deletedRecords += 1;
    });

    const request = blobStore.getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      rows.forEach((row) => {
        if (!ids.has(String(row?.photoId || ''))) return;
        blobStore.delete(row.key);
        deletedBlobs += 1;
      });
    };
    request.onerror = () => reject(request.error || new Error('写真キャッシュの削除に失敗しました。'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('写真キャッシュの削除に失敗しました。'));
    tx.onabort = () => reject(tx.error || new Error('写真キャッシュの削除に失敗しました。'));
  });

  if (deletedRecords || deletedBlobs) publish();
  return { deletedRecords, deletedBlobs };
}
