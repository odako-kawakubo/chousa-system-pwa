/**
 * src/js/photos/photo-remote-reader.js
 *
 * 他端末で撮影済みの写真をOneDriveから読む専用モジュール。
 * - 一覧表示はOneDriveサムネイルを取得する。
 * - 拡大表示は完成画像本体を取得する。
 * - UI・IndexedDB・photoRecordStoreの責務は持たない。
 */

import { downloadDriveFile, downloadDriveThumbnail } from '../onedrive/onedrive-client.js';

function completedRef(record) {
  const driveId = String(record?.oneDriveDriveId || '').trim();
  const itemId = String(record?.completedItemId || '').trim();
  return driveId && itemId ? { driveId, itemId } : null;
}

export function hasRemoteCompletedPhoto(record) {
  return Boolean(completedRef(record));
}

export async function fetchRemotePhotoThumbnail(record) {
  const ref = completedRef(record);
  if (!ref) return null;
  return downloadDriveThumbnail(ref, { size: 'medium' });
}

export async function fetchRemoteCompletedPhoto(record) {
  const ref = completedRef(record);
  if (!ref) return null;
  return downloadDriveFile(ref, { responseType: 'blob' });
}
