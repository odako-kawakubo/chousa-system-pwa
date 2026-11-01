/**
 * 仕上表の部屋共通情報が変わった際、目視写真の完成画像だけを元画像から再生成する。
 * 写真本体・紐付け・代表指定は一切変更しない。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import { resolveRoomLocation } from '../finish-table/room-location.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import { composeCompletedPhotoBlob } from './photo-completed-composer.js';
import { savePhotoBlob, updateCameraPhotoRecord } from './photo-local-store.js';
import { getDeviceCode } from '../device-code.js';
import { getCurrentProject } from '../projects/project-store.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';

function formatBoardDate(photo) {
  const raw = String(photo.boardDate || photo.capturedAt || '');
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return raw;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

async function updateVisualCompletedPhoto(photo, room, settings) {
  const originalBlob = await resolveEditorOriginalPhoto(photo);
  if (!(originalBlob instanceof Blob)) throw new Error(`元画像を取得できません: ${photo.photoId}`);
  const completedBlob = await composeCompletedPhotoBlob({
    originalBlob,
    photoType: 'visual',
    boardPosition: photo.boardPosition || 'bottom-left',
    boardSize: photo.boardSize || 'medium',
    boardData: {
      photoType: 'visual',
      projectName: settings.subjectText || settings.projectName,
      address: settings.addressText || settings.address,
      subjectFontSize: settings.subjectFontSize,
      addressFontSize: settings.addressFontSize,
      areaCode: room.areaCode,
      roomNo: room.roomNo,
      roomName: room.roomName,
      part: photo.part,
      statusCode: '5',
      date: formatBoardDate(photo)
    }
  });
  const now = new Date().toISOString();
  await savePhotoBlob(photo.photoId, 'completed', completedBlob, {
    createdAt: now, fileName: photo.fileName, uploadStatus: 'pending'
  });
  const next = photoRecordStore.set({
    ...photo,
    roomNo: room.roomNo,
    isEdited: true,
    lastEditedDevice: getDeviceCode(),
    lastEditedAt: now,
    localCompletedStatus: 'saved',
    syncStatus: 'pending',
    fieldEditedAt: touchFieldEditedAt(photo.fieldEditedAt, [
      'roomNo', 'isEdited', 'lastEditedDevice', 'lastEditedAt'
    ])
  });
  await updateCameraPhotoRecord(next);
  await persistPhotoForProject(getCurrentProject(), next, 'visual-room-board-refresh');
}

export async function refreshVisualPhotoBoardsForRoom(roomKey) {
  const room = resolveRoomLocation(roomKey, { context:'photo' });
  if (!room) return { updated: 0, errors: [] };
  const photos = photoRecordStore.getActive().filter((photo) =>
    photo.photoType === 'visual' && photo.areaCode === room.areaCode
      && photo.roomPosition === room.roomPosition
  );
  const settings = boardSettingsStore.get();
  const errors = [];
  let updated = 0;
  for (const photo of photos) {
    try {
      await updateVisualCompletedPhoto(photo, room, settings);
      updated += 1;
    } catch (error) {
      errors.push({ photoId: photo.photoId, message: String(error?.message || error) });
      console.error('目視写真の看板再生成に失敗しました', photo.photoId, error);
    }
  }
  if (errors.length && typeof window !== 'undefined') {
    window.alert(`目視写真の看板更新に失敗した写真が${errors.length}枚あります。元画像と写真レコードは維持されています。`);
  }
  return { updated, errors };
}
