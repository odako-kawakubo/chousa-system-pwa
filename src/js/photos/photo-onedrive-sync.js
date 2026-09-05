/**
 * src/js/photos/photo-onedrive-sync.js
 *
 * 写真本体のOneDrive送信だけを担当する。
 * - 送信単位は photoId × variant(original/completed)。
 * - 現在案件のpendingだけを1件ずつ直列送信する。
 * - upload成功後、返却itemIdをgetDriveItem()で再確認してからuploadedへ進める。
 * - 失敗はpendingのまま残し、このモジュール自身では連続自動再試行しない。
 * - 再送トリガーは写真Blob保存、photoRecord確定、案件切替、OneDrive実接続復帰。
 * - 新規Blobは保存時点でprojectIdを持ち、assignPhotoProjectは旧空欄Blob救済だけに使う。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import {
  assignPhotoProject,
  listPendingPhotoBlobEntries,
  markPhotoBlobUploaded,
  recordPhotoBlobUploadError,
  subscribePhotoLocalStore,
  updateCameraPhotoRecord
} from './photo-local-store.js';
import { getPhotoUploadFileName } from './photo-filename.js';
import { PHOTO_TYPES } from '../records/photo-record.js';
import {
  getCurrentProject,
  getProjectSyncMeta,
  subscribe as subscribeProjects
} from '../projects/project-store.js';
import { getCurrentOneDriveState, subscribeOneDriveState } from '../onedrive/onedrive-project.js';
import { getDriveItem, uploadDriveFile } from '../onedrive/onedrive-client.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

let initialized = false;
let running = false;
let rerunRequested = false;
let scheduleTimer = null;

function activeProject() {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return null;
  return project;
}

/**
 * OneDrive画面状態そのものは接続可否の判定だけに使い、folderIdは必ず現在案件のsyncMetaから取る。
 * 案件切替直後に前案件のcurrentStateが一瞬残っても、別案件へ誤送信しないため。
 */
function activeBinding(project) {
  const state = getCurrentOneDriveState();
  if (state?.phase !== 'formal' && state?.phase !== 'temporary') return null;
  if (!project?.projectId) return null;

  const binding = { ...(getProjectSyncMeta(project.projectId)?.oneDriveBinding || {}) };
  const driveId = String(binding.driveId || binding.rootDriveId || '');
  const projectFolderId = String(binding.projectFolderId || '');
  if (!driveId || !projectFolderId) return null;
  return binding;
}

function folderRefFor(record, variant, binding) {
  const driveId = String(binding?.driveId || binding?.rootDriveId || '');
  let itemId = '';

  if (record.photoType === PHOTO_TYPES.SAMPLING) {
    itemId = variant === 'original'
      ? String(binding?.samplingOriginalFolderId || '')
      : String(binding?.samplingFolderId || '');
  } else {
    itemId = variant === 'original'
      ? String(binding?.visualOriginalFolderId || '')
      : String(binding?.visualFolderId || '');
  }

  return driveId && itemId ? { driveId, itemId } : null;
}

function pathFieldForVariant(variant) {
  return variant === 'original' ? 'originalPath' : 'completedPath';
}

function itemIdFieldForVariant(variant) {
  return variant === 'original' ? 'originalItemId' : 'completedItemId';
}

function stablePhotoOrder(entries = []) {
  const variantOrder = { original: 0, completed: 1 };
  return entries.slice().sort((a, b) => {
    const photoDiff = String(a.photoId || '').localeCompare(String(b.photoId || ''), 'ja', { numeric: true });
    if (photoDiff) return photoDiff;
    return (variantOrder[a.variant] ?? 9) - (variantOrder[b.variant] ?? 9);
  });
}

/** 旧projectId空欄Blobだけ現在案件へ救済する。 */
async function attachLegacyBlobs(project, records) {
  for (const record of records) {
    if (record.deleted) continue;
    await assignPhotoProject(record.photoId, project.projectId);
  }
}

async function persistUploadedReference(project, record, variant, verifiedItem) {
  const pathField = pathFieldForVariant(variant);
  const itemIdField = itemIdFieldForVariant(variant);
  const driveId = String(verifiedItem?.driveId || '');
  const itemId = String(verifiedItem?.itemId || verifiedItem?.id || '');
  const webUrl = String(verifiedItem?.webUrl || '');

  const changedFields = [];
  if (driveId && String(record.oneDriveDriveId || '') !== driveId) changedFields.push('oneDriveDriveId');
  if (itemId && String(record[itemIdField] || '') !== itemId) changedFields.push(itemIdField);
  if (webUrl && String(record[pathField] || '') !== webUrl) changedFields.push(pathField);
  if (!changedFields.length) return record;

  const stored = photoRecordStore.set({
    ...record,
    oneDriveDriveId: driveId || record.oneDriveDriveId || '',
    [itemIdField]: itemId || record[itemIdField] || '',
    [pathField]: webUrl || record[pathField] || '',
    fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, changedFields)
  });

  await updateCameraPhotoRecord(stored);
  await persistPhotoForProject(project, stored, `photo-onedrive-${variant}-reference`);
  return stored;
}

async function uploadOneVariant(project, binding, entry) {
  let record = photoRecordStore.get(entry.photoId);
  if (!record || record.deleted) {
    syncDiagnosticLog('PHOTO_SYNC_SKIP', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      reason: 'deleted-or-missing'
    });
    return { ok: true, skipped: true, reason: 'deleted-or-missing' };
  }

  const folderRef = folderRefFor(record, entry.variant, binding);
  if (!folderRef) {
    syncDiagnosticLog('PHOTO_SYNC_SKIP', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      reason: 'folder-unavailable'
    });
    return { ok: false, skipped: true, reason: 'folder-unavailable' };
  }

  const fileName = getPhotoUploadFileName(record);
  if (!fileName) {
    syncDiagnosticLog('PHOTO_SYNC_SKIP', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      reason: 'filename-unavailable'
    });
    return { ok: false, skipped: true, reason: 'filename-unavailable' };
  }

  let verified = null;
  try {
    syncDiagnosticLog('PHOTO_UPLOAD_START', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      fileName
    });

    const uploaded = await uploadDriveFile(
      folderRef,
      fileName,
      entry.blob,
      entry.mimeType || 'image/jpeg'
    );

    const uploadedRef = {
      driveId: String(uploaded?.driveId || folderRef.driveId || ''),
      itemId: String(uploaded?.itemId || uploaded?.id || '')
    };
    if (!uploadedRef.itemId) throw new Error('OneDrive保存後のitemIdを確認できませんでした。');

    syncDiagnosticLog('PHOTO_UPLOAD_OK', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      fileName,
      itemId: uploadedRef.itemId
    });

    verified = await getDriveItem(uploadedRef);
    if (!verified?.file || !verified?.itemId) {
      throw new Error('OneDrive保存後のファイル実在確認に失敗しました。');
    }

    syncDiagnosticLog('PHOTO_VERIFY_OK', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      fileName: verified.name || fileName,
      itemId: verified.itemId
    });

    await markPhotoBlobUploaded(entry.photoId, entry.variant, {
      driveId: verified.driveId || uploadedRef.driveId,
      itemId: verified.itemId,
      fileName: verified.name || fileName,
      uploadedAt: new Date().toISOString()
    });
  } catch (error) {
    await recordPhotoBlobUploadError(entry.photoId, entry.variant, error);
    syncDiagnosticLog('PHOTO_UPLOAD_ERROR', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      fileName,
      message: error?.message || String(error)
    });
    console.warn('[v0.1.6.5K] 写真OneDrive送信失敗', {
      photoId: entry.photoId,
      variant: entry.variant,
      error
    });
    return { ok: false, error, photoId: entry.photoId, variant: entry.variant };
  }

  try {
    record = await persistUploadedReference(project, record, entry.variant, verified);
  } catch (error) {
    syncDiagnosticLog('PHOTO_REFERENCE_SAVE_ERROR', {
      projectId: project.projectId,
      photoId: entry.photoId,
      variant: entry.variant,
      message: error?.message || String(error)
    });
    console.warn('[v0.1.6.5K] 写真OneDrive参照情報の保存失敗', {
      photoId: entry.photoId,
      variant: entry.variant,
      error
    });
  }

  return { ok: true, uploaded: true, photoId: entry.photoId, variant: entry.variant };
}

async function runCurrentProjectPhotoSync() {
  const project = activeProject();
  if (!project) return { ok: false, reason: 'no-project' };

  syncDiagnosticLog('PHOTO_SYNC_START', { projectId: project.projectId });

  const binding = activeBinding(project);
  if (!binding) {
    const oneDrive = getCurrentOneDriveState();
    syncDiagnosticLog('PHOTO_SYNC_BINDING_MISSING', {
      projectId: project.projectId,
      phase: oneDrive?.phase || '',
      label: oneDrive?.label || ''
    });
    return { ok: false, reason: 'onedrive-unavailable' };
  }

  const activeRecords = photoRecordStore.getAll().filter((record) => !record.deleted);
  const photoIds = activeRecords.map((record) => record.photoId);

  // I以前などprojectId空欄で残ったBlobだけ救済する。
  await attachLegacyBlobs(project, activeRecords);

  const pending = stablePhotoOrder(
    await listPendingPhotoBlobEntries(project.projectId, photoIds)
  );

  syncDiagnosticLog('PHOTO_SYNC_PENDING', {
    projectId: project.projectId,
    photoCount: photoIds.length,
    pendingCount: pending.length,
    pending: pending.map((entry) => ({ photoId: entry.photoId, variant: entry.variant, fileName: entry.fileName || '' }))
  });

  if (!pending.length) {
    syncDiagnosticLog('PHOTO_SYNC_END', { projectId: project.projectId, uploaded: 0 });
    return { ok: true, uploaded: 0 };
  }

  let uploaded = 0;
  for (const entry of pending) {
    if (String(getCurrentProject()?.projectId || '') !== String(project.projectId)) {
      syncDiagnosticLog('PHOTO_SYNC_SKIP', {
        projectId: project.projectId,
        photoId: entry.photoId,
        variant: entry.variant,
        reason: 'project-changed'
      });
      break;
    }

    const result = await uploadOneVariant(project, binding, entry);
    if (result?.uploaded) uploaded += 1;
  }

  syncDiagnosticLog('PHOTO_SYNC_END', { projectId: project.projectId, uploaded });
  return { ok: true, uploaded };
}

async function drain() {
  if (running) {
    rerunRequested = true;
    return;
  }

  running = true;
  try {
    do {
      rerunRequested = false;
      await runCurrentProjectPhotoSync();
    } while (rerunRequested);
  } finally {
    running = false;
  }
}

function requestSync() {
  if (scheduleTimer) return;
  scheduleTimer = window.setTimeout(() => {
    scheduleTimer = null;
    void drain();
  }, 0);
}

/**
 * 案件画面で1回だけ初期化する。
 * Blob保存とphotoRecord確定の両方を監視し、案件/OneDrive接続変化でも再判定する。
 * camera/photo-controller/editorへOneDrive処理を重複実装しない。
 */
export function initializePhotoOneDriveSync() {
  if (initialized) return;
  initialized = true;

  subscribePhotoLocalStore(requestSync);
  photoRecordStore.subscribe(requestSync);
  subscribeProjects(requestSync);
  subscribeOneDriveState((state) => {
    if (state?.phase === 'formal' || state?.phase === 'temporary') requestSync();
  });

  requestSync();
}

/** 手動検証用。UIはまだ持たせない。 */
export async function syncCurrentProjectPhotosNow() {
  await drain();
}
