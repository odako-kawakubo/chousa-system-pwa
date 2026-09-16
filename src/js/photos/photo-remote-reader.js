/**
 * src/js/photos/photo-remote-reader.js
 *
 * 他端末で撮影済みの写真をOneDriveから読む専用モジュール。
 * - 一覧表示は完成画像のOneDriveサムネイルを取得する。
 * - Viewerは完成画像本体を取得する。
 * - 看板編集は元画像本体を取得する。
 * - UI・IndexedDB・photoRecordStoreの責務は持たない。
 */

import { downloadDriveFile, downloadDriveThumbnail } from '../onedrive/onedrive-client.js';

function remoteRef(record, variant) {
  const driveId = String(record?.oneDriveDriveId || '').trim();
  const itemId = String(variant === 'original' ? record?.originalItemId : record?.completedItemId).trim();
  return driveId && itemId ? { driveId, itemId } : null;
}

function completedRef(record) {
  return remoteRef(record, 'completed');
}

function originalRef(record) {
  return remoteRef(record, 'original');
}

export function hasRemoteCompletedPhoto(record) {
  return Boolean(completedRef(record));
}

export function hasRemoteOriginalPhoto(record) {
  return Boolean(originalRef(record));
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

export async function fetchRemoteOriginalPhoto(record) {
  const ref = originalRef(record);
  if (!ref) return null;
  return downloadDriveFile(ref, { responseType: 'blob' });
}
