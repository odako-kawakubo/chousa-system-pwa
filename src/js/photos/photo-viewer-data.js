/**
 * PhotoViewerへ渡す写真集合と比較候補を組み立てる。
 * DOM操作・Viewer状態・Record更新は持たない。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import { isSamplingPhotoUnorganized, isVisualPhotoUnorganized, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { visualCompareTargets } from './photo-compare-data.js';

const SAMPLE_STAGE_ORDER = [
  SHOOTING_TYPES.BEFORE,
  SHOOTING_TYPES.DURING,
  SHOOTING_TYPES.AFTER,
  SHOOTING_TYPES.SECTION
];

export function photosForViewer(photoId) {
  const photo = photoRecordStore.get(photoId);
  if (!photo || photo.deleted) return [];

  if (photo.photoType === PHOTO_TYPES.VISUAL) {
    const photos = isVisualPhotoUnorganized(photo)
      ? photoRecordStore.getActive().filter((item) => (
          item.photoType === PHOTO_TYPES.VISUAL
          && item.areaCode === photo.areaCode
          && item.roomPosition === photo.roomPosition
          && isVisualPhotoUnorganized(item)
        ))
      : photoRecordStore.findVisual({ areaCode: photo.areaCode, roomPosition: photo.roomPosition, partSlot: photo.partSlot });

    return photos.sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId).localeCompare(String(b.photoId)));
  }

  const samplingPhotos = isSamplingPhotoUnorganized(photo)
    ? photoRecordStore.getActive().filter((item) => (
        item.photoType === PHOTO_TYPES.SAMPLING
        && item.materialId === photo.materialId
        && isSamplingPhotoUnorganized(item)
      ))
    : photoRecordStore.findSampling({ materialId: photo.materialId, samplingBranch: photo.samplingBranch });

  return samplingPhotos.sort((a, b) => {
    const stageDiff = SAMPLE_STAGE_ORDER.indexOf(a.shootingType) - SAMPLE_STAGE_ORDER.indexOf(b.shootingType);
    if (stageDiff) return stageDiff;
    return String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId).localeCompare(String(b.photoId));
  });
}


export function compareTargetsForViewer(context = {}) {
  return visualCompareTargets(context);
}


/**
 * 採取場所変更の「確認する」で表示する代表写真集合。
 * 同一 materialId + samplingBranch から、施工前/施工中/施工後/断面を最大1枚ずつ返す。
 * 各区分は代表写真優先、代表が無ければ撮影日時の早い写真を使う。
 */
export function samplingLocationReviewPhotos({ materialId = '', samplingBranch = 0 } = {}) {
  const id = String(materialId || '').trim();
  const branch = Number(samplingBranch || 0);
  if (!id || !branch) return [];

  return SAMPLE_STAGE_ORDER.map((shootingType) => {
    const photos = photoRecordStore.findSampling({
      materialId:id,
      samplingBranch:branch,
      shootingType
    }).slice().sort((a, b) => {
      if (Boolean(a.isRepresentative) !== Boolean(b.isRepresentative)) return a.isRepresentative ? -1 : 1;
      return String(a.capturedAt || '').localeCompare(String(b.capturedAt || ''))
        || String(a.photoId || '').localeCompare(String(b.photoId || ''));
    });
    return photos[0] || null;
  }).filter(Boolean);
}
