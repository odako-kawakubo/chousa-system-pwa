/**
 * src/js/photos/photo-local-store.js
 *
 * v0.1.5.5B ローカル写真キャッシュ。
 * - 画像本体は photoRecord に DataURL で持たず、IndexedDB に Blob として保存する。
 * - original / completed を photoId ごとに分離して保持する。
 * - AではOneDriveへ実送信しないため、photoRecordの同期状態は pending のままにする。
 * - カメラ撮影で作成した photoRecord も IndexedDB に保存し、再読込時に復元できるようにする。
 */

const DB_NAME = 'chousa-system-pwa';
const DB_VERSION = 1;
const BLOB_STORE = 'photoBlobs';
const RECORD_STORE = 'cameraPhotoRecords';

let dbPromise = null;

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

export function blobKey(photoId, variant) {
  return `${photoId}:${variant}`;
}

export async function savePhotoBlob(photoId, variant, blob, metadata = {}) {
  const key = blobKey(photoId, variant);
  await withStore(BLOB_STORE, 'readwrite', (store) => {
    store.put({
      key,
      photoId,
      variant,
      blob,
      mimeType: blob?.type || 'image/jpeg',
      size: Number(blob?.size || 0),
      createdAt: metadata.createdAt || new Date().toISOString(),
      fileName: metadata.fileName || '',
      uploadStatus: metadata.uploadStatus || 'pending'
    });
  });
  return key;
}

export async function getPhotoBlob(photoId, variant = 'completed') {
  const db = await openDb();
  const tx = db.transaction(BLOB_STORE, 'readonly');
  const record = await requestToPromise(tx.objectStore(BLOB_STORE).get(blobKey(photoId, variant)));
  return record?.blob || null;
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

export async function saveCapturedPhoto({ record, originalBlob, completedBlob }) {
  if (!record?.photoId) throw new Error('photoIdがありません。');
  if (!(originalBlob instanceof Blob) || !(completedBlob instanceof Blob)) {
    throw new Error('保存対象の画像Blobがありません。');
  }

  const metadata = {
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

  return { deletedRecords, deletedBlobs };
}
