/**
 * src/js/photos/photo-local-store.js
 *
 * 写真本体のローカル正本。
 * - photoRecordへDataURLを持たせず、IndexedDBへBlobとして保存する。
 * - original / completed を photoId ごとに分離する。
 * - OneDrive送信状態も photoId × variant 単位でここへ永続化する。
 * - IndexedDB内部構造はこのモジュールだけが知り、送信側へはAPIだけを公開する。
 *
 * v0.1.6.5K:
 * - 新規保存は保存時点でprojectIdを確定する。
 * - 旧キャッシュ救済はprojectId空欄だけを対象にし、他案件の所属を上書きしない。
 * - 未送信抽出・案件帰属・削除は既知photoIdのoriginal/completedキーだけを直接扱う。
 *
 * v0.1.6.5L:
 * - 他端末で拡大表示した完成画像をcompletedとして端末へ保持する。
 * - OneDriveから取得済み画像は最初からuploadedとして保存し、再送対象にしない。
 */

const DB_NAME = 'chousa-system-pwa';
const DB_VERSION = 1;
const BLOB_STORE = 'photoBlobs';
const RECORD_STORE = 'cameraPhotoRecords';

let dbPromise = null;
const listeners = [];
let projectIdProvider = () => '';

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

/**
 * 写真生成側から現在案件の取得方法だけを注入する。
 * local-store自身はproject-storeを直接参照しない。
 */
export function configurePhotoLocalStore(options = {}) {
  projectIdProvider = typeof options.getProjectId === 'function'
    ? options.getProjectId
    : () => '';
}

function resolveProjectId(explicitProjectId = '') {
  return String(explicitProjectId || projectIdProvider?.() || '').trim();
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
 * 看板編集で元画像の内容と保存名が変わらない場合、originalのuploaded状態は維持する。
 * 未整理→正式整理など保存名が変わる時はoriginalもpendingへ戻し、完成画像と同じ正式名へ揃える。
 */
export async function savePhotoBlob(photoId, variant, blob, metadata = {}) {
  const key = blobKey(photoId, variant);
  const requestedStatus = metadata.uploadStatus || 'pending';
  const requestedProjectId = resolveProjectId(metadata.projectId);

  await replaceBlobEntry(key, (existing) => {
    const nextFileName = metadata.fileName || existing?.fileName || '';
    const preserveOriginalUpload = variant === 'original'
      && requestedStatus === 'pending'
      && existing?.uploadStatus === 'uploaded'
      && String(existing?.uploadedFileName || '') === String(nextFileName || '');

    return {
      ...(existing || {}),
      key,
      photoId,
      variant,
      blob,
      mimeType: blob?.type || existing?.mimeType || 'image/jpeg',
      size: Number(blob?.size || 0),
      projectId: String(requestedProjectId || existing?.projectId || ''),
      createdAt: metadata.createdAt || existing?.createdAt || new Date().toISOString(),
      fileName: nextFileName,
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

async function readBlobEntriesForPhotoIds(photoIds = []) {
  const ids = [...new Set((Array.isArray(photoIds) ? photoIds : [])
    .map((value) => String(value || ''))
    .filter(Boolean))];
  if (!ids.length) return [];

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const store = tx.objectStore(BLOB_STORE);
    const rows = [];
    let pendingRequests = ids.length * 2;

    const finishRequest = () => {
      pendingRequests -= 1;
      if (pendingRequests === 0) resolve(rows);
    };

    ids.forEach((photoId) => {
      ['original', 'completed'].forEach((variant) => {
        const request = store.get(blobKey(photoId, variant));
        request.onsuccess = () => {
          if (request.result) rows.push({ ...request.result });
          finishRequest();
        };
        request.onerror = () => reject(request.error || new Error('写真キャッシュを取得できませんでした。'));
      });
    });

    tx.onerror = () => reject(tx.error || new Error('写真キャッシュを取得できませんでした。'));
    tx.onabort = () => reject(tx.error || new Error('写真キャッシュ取得を中止しました。'));
  });
}

/** 現案件の既知photoIdに属する未送信variantだけ返す。 */
export async function listPendingPhotoBlobEntries(projectId, photoIds = []) {
  const id = String(projectId || '');
  if (!id) return [];
  const rows = await readBlobEntriesForPhotoIds(photoIds);
  return rows.filter((row) => (
    String(row.projectId || '') === id
    && row.uploadStatus !== 'uploaded'
    && (row.variant === 'original' || row.variant === 'completed')
    && row.blob instanceof Blob
  ));
}

/**
 * 旧キャッシュ救済専用。
 * 指定photoIdのoriginal/completedだけを直接確認し、projectIdが空欄の時だけ現在案件を補完する。
 * すでに別案件projectIdが入っているBlobは絶対に書き換えない。
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

    ['original', 'completed'].forEach((variant) => {
      const request = store.get(blobKey(targetPhotoId, variant));
      request.onsuccess = () => {
        const row = request.result || null;
        if (row && !String(row.projectId || '')) {
          store.put({ ...row, projectId: targetProjectId });
          changed += 1;
        }
      };
      request.onerror = () => reject(request.error || new Error('写真キャッシュの案件紐付けに失敗しました。'));
    });

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

/**
 * 他端末で拡大表示した完成画像をローカルへ保持する。
 * OneDriveから取得済みなのでpendingには戻さず、送信済みvariantとして保存する。
 */
export async function saveRemoteCompletedPhoto({ record, blob, projectId = '' }) {
  if (!record?.photoId) throw new Error('photoIdがありません。');
  if (!(blob instanceof Blob)) throw new Error('保存対象の完成画像Blobがありません。');

  const resolvedProjectId = resolveProjectId(projectId);
  if (!resolvedProjectId) throw new Error('写真の保存先案件を確認できませんでした。');

  const driveId = String(record.oneDriveDriveId || '');
  const itemId = String(record.completedItemId || '');
  if (!driveId || !itemId) throw new Error('OneDrive完成画像を特定できません。');

  const key = blobKey(record.photoId, 'completed');
  const next = await replaceBlobEntry(key, (existing) => ({
    ...(existing || {}),
    key,
    photoId: record.photoId,
    variant: 'completed',
    blob,
    mimeType: blob.type || existing?.mimeType || 'image/jpeg',
    size: Number(blob.size || 0),
    projectId: resolvedProjectId,
    createdAt: record.capturedAt || existing?.createdAt || new Date().toISOString(),
    fileName: record.fileName || existing?.fileName || '',
    uploadStatus: 'uploaded',
    uploadedItemId: itemId,
    uploadedDriveId: driveId,
    uploadedFileName: record.fileName || existing?.uploadedFileName || '',
    uploadedAt: existing?.uploadedAt || new Date().toISOString(),
    supersededUploads: Array.isArray(existing?.supersededUploads) ? existing.supersededUploads : [],
    lastUploadError: ''
  }));

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

  const resolvedProjectId = resolveProjectId(projectId);
  if (!resolvedProjectId) {
    throw new Error('写真の保存先案件を確認できませんでした。');
  }

  const metadata = {
    projectId: resolvedProjectId,
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
      blobStore.delete(blobKey(photoId, 'original'));
      blobStore.delete(blobKey(photoId, 'completed'));
      deletedBlobs += 2;
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('写真キャッシュの削除に失敗しました。'));
    tx.onabort = () => reject(tx.error || new Error('写真キャッシュの削除に失敗しました。'));
  });

  if (deletedRecords || deletedBlobs) publish();
  return { deletedRecords, deletedBlobs };
}
