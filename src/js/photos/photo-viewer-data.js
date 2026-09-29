/**
 * PhotoViewerへ渡す写真集合と比較候補を組み立てる。
 * DOM操作・Viewer状態・Record更新は持たない。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { getVisualPhotoRoomKey, getVisualPhotoTargetKey, isSamplingPhotoUnorganized, isVisualPhotoUnorganized, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';

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
  const preferredMaterialId = String(context.preferredMaterialId || '').trim();
  const roomInfo = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || !record.areaCode || !record.roomPosition) return;
    const roomKey = getVisualPhotoRoomKey(record);
    if (!roomInfo.has(roomKey)) {
      roomInfo.set(roomKey, { areaCode: record.areaCode, roomPosition: record.roomPosition, roomNo: record.roomNo, roomName: record.roomName });
    }
  });

  const groups = new Map();
  photoRecordStore.getActive().filter((photo) => photo.photoType === PHOTO_TYPES.VISUAL).forEach((photo) => {
    const key = getVisualPhotoTargetKey(photo);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { key, areaCode: photo.areaCode, roomPosition: photo.roomPosition, partSlot: photo.partSlot, part: photo.part, photos: [] });
    groups.get(key).photos.push(photo);
  });

  const usedByPreferred = new Set();
  if (preferredMaterialId) {
    finishRecordStore.getAll().forEach((record) => {
      if (record.status !== 'active' || String(record.materialId || '') !== preferredMaterialId) return;
      const partSlot = Math.floor(Number(record.position || 0) / 100);
      if (record.areaCode && record.roomPosition && partSlot) usedByPreferred.add(getVisualPhotoTargetKey({ areaCode: record.areaCode, roomPosition: record.roomPosition, partSlot }));
    });
  }

  return [...groups.values()].map((group) => {
    const room = roomInfo.get(getVisualPhotoRoomKey(group)) || {};
    const no = String(room.roomNo || group.roomPosition || '-').trim();
    const name = String(room.roomName || '').trim();
    const roomLabel = name && name !== no ? `${no} ${name}` : no;
    return {
      ...group,
      label: `${roomLabel} / ${group.part}`,
      preferred: usedByPreferred.has(group.key),
      photos: group.photos.sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')))
    };
  }).sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.label.localeCompare(b.label, 'ja', { numeric: true });
  });
}

