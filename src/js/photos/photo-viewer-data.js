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
