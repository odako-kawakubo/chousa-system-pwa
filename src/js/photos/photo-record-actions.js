/**
 * 写真Recordの登録・削除・代表変更・編集開始を担当する。
 * DOMイベントや画面全体の描画状態は持たない。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import { createPhotoRecord, PHOTO_TYPES } from '../records/photo-record.js';
import { saveCapturedPhoto, updateCameraPhotoRecord } from './photo-local-store.js';
import { setLocalPhotoPreview, removePhotoPreview } from './photo-preview-manager.js';
import { openPhotoBoardEditorSequence } from './photo-board-editor.js';
import { getDeviceCode } from '../device-code.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

const PHOTO_COMMON_CREATE_EDIT_FIELDS = Object.freeze([
  'photoType', 'fileName', 'isRepresentative', 'capturedDevice', 'capturedAt',
  'isEdited', 'lastEditedDevice', 'lastEditedAt', 'deleted', 'systemMemo',
  'boardPosition', 'boardSize', 'originalPath', 'completedPath'
]);

function photoCreateEditFields(record) {
  return record?.photoType === PHOTO_TYPES.VISUAL
    ? [...PHOTO_COMMON_CREATE_EDIT_FIELDS, 'areaCode', 'roomPosition', 'partSlot', 'roomNo', 'part']
    : [...PHOTO_COMMON_CREATE_EDIT_FIELDS, 'materialId', 'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType'];
}

function photoWithEditedFields(record, fields = null, confirmedAt = Date.now()) {
  return createPhotoRecord({
    ...record,
    fieldEditedAt: touchFieldEditedAt(record?.fieldEditedAt, fields || photoCreateEditFields(record), confirmedAt)
  });
}

function persistPhoto(record, reason = 'photo-actions-save') {
  return persistPhotoForProject(getCurrentProject(), record, reason);
}

function nextPhotoId() {
  return `I-${getDeviceCode()}-${Date.now()}`;
}

export async function importPickedPhotoFiles(context, fileList) {
  const files = [...(fileList || [])].filter((file) => file instanceof Blob);
  if (!context || !files.length) return [];

  const storedRecords = [];
  for (const file of files) {
    const photoId = nextPhotoId();
    const capturedAt = new Date().toISOString();
    const common = {
      photoId,
      fileName: String(file.name || `${photoId}.jpg`),
      capturedDevice: getDeviceCode(),
      capturedAt,
      syncStatus: 'pending',
      localOriginalStatus: 'saved',
      localCompletedStatus: 'saved'
    };

    const record = photoWithEditedFields(createPhotoRecord(context.photoType === PHOTO_TYPES.VISUAL
      ? {
          ...common,
          photoType: PHOTO_TYPES.VISUAL,
          areaCode: context.areaCode,
          roomPosition: context.roomPosition,
          partSlot: 0,
          roomNo: context.roomNo,
          part: ''
        }
      : {
          ...common,
          photoType: PHOTO_TYPES.SAMPLING,
          materialId: context.materialId,
          samplingPlace: '',
          samplingBranch: 0,
          sampleNo: '',
          sampleBaseNo: '',
          part: '',
          shootingType: ''
        }));

    await saveCapturedPhoto({ record, originalBlob: file, completedBlob: file });
    setLocalPhotoPreview(photoId, file);

    const stored = photoRecordStore.set(record);
    await updateCameraPhotoRecord(stored);
    await persistPhoto(stored, 'photo-import-save');
    storedRecords.push(stored);
  }

  return storedRecords;
}

export async function registerCapturedPhoto({ record, originalBlob, completedBlob }, {
  refreshBlock = null,
  renderAfter = true
} = {}) {
  if (!record?.photoId) throw new Error('photoIdがありません。');

  const stored = photoRecordStore.set(record);
  setLocalPhotoPreview(stored.photoId, completedBlob);
  let blockRefreshed = null;
  if (renderAfter && typeof refreshBlock === 'function') {
    blockRefreshed = refreshBlock(stored);
  }

  syncDiagnosticLog('PHOTO_LOCAL_BLOCK_REFRESH', {
    photoId: stored.photoId,
    photoType: stored.photoType,
    renderAfter,
    refreshed: blockRefreshed
  });

  await saveCapturedPhoto({ record: stored, originalBlob, completedBlob });
  await persistPhoto(stored, 'photo-camera-save');
  return stored;
}

export async function startPhotoEditSequence(photoIds) {
  const ids = [...(photoIds || [])].filter((photoId) => {
    const record = photoRecordStore.get(photoId);
    return record && !record.deleted;
  });
  if (!ids.length) return false;

  await openPhotoBoardEditorSequence(ids);
  return true;
}

export async function deletePhotos(photoIds) {
  const ids = [...(photoIds || [])].filter((photoId) => {
    const record = photoRecordStore.get(photoId);
    return record && !record.deleted;
  });
  if (!ids.length) return [];

  const before = new Map(photoRecordStore.getAll().map((record) => [record.photoId, { ...record }]));

  photoRecordStore.batch(() => {
    ids.forEach((photoId) => {
      removePhotoPreview(photoId);
      photoRecordStore.markDeleted(photoId);
    });
  });

  const changed = [];
  photoRecordStore.getAll().forEach((record) => {
    const previous = before.get(record.photoId);
    const fields = [];
    if (Boolean(previous?.deleted) !== Boolean(record.deleted)) fields.push('deleted');
    if (Boolean(previous?.isRepresentative) !== Boolean(record.isRepresentative)) fields.push('isRepresentative');
    if (!fields.length) return;
    const next = photoRecordStore.set({
      ...record,
      fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, fields)
    });
    changed.push(next);
  });

  await Promise.all(changed.map(async (record) => {
    await updateCameraPhotoRecord(record);
    await persistPhoto(record, 'photo-delete-save');
  }));

  return changed;
}

export async function setRepresentativePhoto(photoId) {
  const before = new Map(photoRecordStore.getAll().map((record) => [record.photoId, { ...record }]));
  if (!photoRecordStore.setRepresentative(photoId)) return [];

  const changed = [];
  photoRecordStore.getAll().forEach((record) => {
    const previous = before.get(record.photoId);
    if (Boolean(previous?.isRepresentative) === Boolean(record.isRepresentative)) return;
    const next = photoRecordStore.set({
      ...record,
      fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, 'isRepresentative')
    });
    changed.push(next);
  });

  await Promise.all(changed.map((record) => persistPhoto(record, 'photo-representative-save')));
  return changed;
}
