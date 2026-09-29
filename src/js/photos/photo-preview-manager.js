/**
 * 写真タブのローカル完成画像・OneDriveサムネイル・Object URL管理を担当する。
 * DOM全体の描画やphotoRecord更新は持たない。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import { getPhotoBlob } from './photo-local-store.js';
import { fetchRemotePhotoThumbnail, hasRemoteCompletedPhoto } from './photo-remote-reader.js';
import { PHOTO_TYPES } from '../records/photo-record.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

const localPreviewUrls = new Map();
const remoteThumbnailUrls = new Map();
const remoteThumbnailFetches = new Map();
let previewSessionId = 0;

function revokePreviewUrl(map, photoId) {
  const value = map.get(photoId);
  if (value && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value);
  map.delete(photoId);
}

function demoPreviewSource(photo) {
  if (!String(photo?.photoId || '').startsWith('DEMO-PHOTO-')) return '';
  const label = photo.photoType === PHOTO_TYPES.VISUAL
    ? `${photo.roomNo || photo.roomPosition || '-'} / ${photo.part || '-'}`
    : `${photo.sampleNo || '-'} / ${photo.shootingType || '-'}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#dbe4ef"/><rect x="100" y="120" width="1000" height="560" rx="24" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="8"/><text x="600" y="390" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="700" fill="#0f172a">${label}</text><text x="600" y="465" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#334155">比較UI確認用デモ写真</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function previewSourceForPhoto(photo) {
  if (!photo) return '';
  const local = localPreviewUrls.get(photo.photoId);
  if (local) return local;
  const demo = demoPreviewSource(photo);
  if (demo) return demo;
  return remoteThumbnailUrls.get(photo.photoId) || '';
}

export function setLocalPhotoPreview(photoId, blob) {
  if (!photoId || !(blob instanceof Blob) || typeof URL.createObjectURL !== 'function') return;
  revokePreviewUrl(localPreviewUrls, photoId);
  revokePreviewUrl(remoteThumbnailUrls, photoId);
  const url = URL.createObjectURL(blob);
  localPreviewUrls.set(photoId, url);
  syncDiagnosticLog('PHOTO_LOCAL_PREVIEW_SET', {
    photoId,
    size: Number(blob.size || 0),
    type: String(blob.type || ''),
    urlTail: String(url).slice(-24)
  });
}

function setRemoteThumbnail(photoId, blob) {
  if (!photoId || !(blob instanceof Blob) || typeof URL.createObjectURL !== 'function') return;
  if (localPreviewUrls.has(photoId)) return;
  revokePreviewUrl(remoteThumbnailUrls, photoId);
  remoteThumbnailUrls.set(photoId, URL.createObjectURL(blob));
}

async function ensureRemoteThumbnail(photo, scope) {
  const photoId = String(photo?.photoId || '');
  if (!photoId || photo.deleted || localPreviewUrls.has(photoId) || remoteThumbnailUrls.has(photoId)) return;
  if (!hasRemoteCompletedPhoto(photo) || remoteThumbnailFetches.has(photoId)) return;

  const sessionId = previewSessionId;
  const fetchPromise = fetchRemotePhotoThumbnail(photo)
    .then((blob) => {
      if (sessionId !== previewSessionId) return;
      if (!(blob instanceof Blob) || !photoRecordStore.get(photoId) || localPreviewUrls.has(photoId)) return;
      setRemoteThumbnail(photoId, blob);
      hydrateThumbnailImages(scope);
    })
    .catch(() => undefined)
    .finally(() => {
      if (sessionId === previewSessionId) remoteThumbnailFetches.delete(photoId);
    });

  remoteThumbnailFetches.set(photoId, fetchPromise);
  await fetchPromise;
}

/**
 * サムネイルはローカル完成画像を最優先し、無い写真だけOneDriveサムネイルを非同期取得する。
 */
export function hydrateThumbnailImages(scope) {
  if (!scope) return;

  scope.querySelectorAll('[data-photo-thumb-image]').forEach((image) => {
    const photoId = image.dataset.photoThumbImage || '';
    const photo = photoRecordStore.get(photoId);
    const card = image.closest('.photo-thumb-card');
    const source = photo ? previewSourceForPhoto(photo) : '';
    const isLocalPreview = localPreviewUrls.has(photoId);

    const markReady = () => {
      card?.classList.add('photo-thumb-ready');
      card?.classList.remove('photo-thumb-loading');
      syncDiagnosticLog('PHOTO_THUMB_READY', {
        photoId,
        local: isLocalPreview,
        complete: Boolean(image.complete),
        naturalWidth: Number(image.naturalWidth || 0)
      });
    };
    const markLoading = () => {
      card?.classList.remove('photo-thumb-ready');
      card?.classList.add('photo-thumb-loading');
      syncDiagnosticLog('PHOTO_THUMB_LOADING', {
        photoId,
        local: isLocalPreview,
        hasSource: Boolean(source),
        complete: Boolean(image.complete),
        naturalWidth: Number(image.naturalWidth || 0)
      });
    };

    if (!source) {
      image.removeAttribute('src');
      image.loading = 'lazy';
      markLoading();
      if (photo) void ensureRemoteThumbnail(photo, scope);
      return;
    }

    image.loading = isLocalPreview ? 'eager' : 'lazy';
    image.onload = markReady;
    image.onerror = markLoading;
    if (image.getAttribute('src') !== source) image.src = source;

    if (image.complete && image.naturalWidth > 0) {
      markReady();
      return;
    }

    if (isLocalPreview && typeof image.decode === 'function') {
      image.decode().then(markReady).catch(() => {
        if (image.complete && image.naturalWidth > 0) markReady();
      });
    }
  });
}

export async function hydrateCurrentPhotoPreviews(scope) {
  const sessionId = previewSessionId;
  try {
    const activeIds = new Set(photoRecordStore.getAll().map((record) => record.photoId));
    for (const map of [localPreviewUrls, remoteThumbnailUrls]) {
      for (const photoId of [...map.keys()]) {
        if (!activeIds.has(photoId)) revokePreviewUrl(map, photoId);
      }
    }

    for (const record of photoRecordStore.getAll()) {
      if (sessionId !== previewSessionId) return;
      if (localPreviewUrls.has(record.photoId)) continue;
      const blob = await getPhotoBlob(record.photoId, 'completed');
      if (sessionId !== previewSessionId) return;
      if (blob && typeof URL.createObjectURL === 'function') {
        setLocalPhotoPreview(record.photoId, blob);
        continue;
      }
      void ensureRemoteThumbnail(record, scope);
    }
  } catch (error) {
    console.warn('現在案件の写真プレビュー復元に失敗しました', error);
  }
}

export function removePhotoPreview(photoId) {
  revokePreviewUrl(localPreviewUrls, photoId);
  revokePreviewUrl(remoteThumbnailUrls, photoId);
}

export function resetPhotoPreviewManager() {
  previewSessionId += 1;
  remoteThumbnailFetches.clear();
  for (const map of [localPreviewUrls, remoteThumbnailUrls]) {
    [...map.keys()].forEach((photoId) => revokePreviewUrl(map, photoId));
  }
}

export function getLocalPreviewCount() {
  return localPreviewUrls.size;
}
