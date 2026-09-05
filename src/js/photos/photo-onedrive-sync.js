/**
 * src/js/photos/photo-onedrive-sync.js
 *
 * 写真本体のOneDrive送信だけを担当する。
 * - 送信単位は photoId × variant(original/completed)。
 * - 現在案件のpendingだけを1件ずつ直列送信する。
 * - upload成功後、返却itemIdをgetDriveItem()で再確認してからuploadedへ進める。
 * - 失敗はpendingのまま残し、このモジュール自身では連続自動再試行しない。
 * - 再送トリガーは写真保存、案件切替、OneDrive実接続復帰。
 * - 月曜テスト段階ではOneDrive上の旧一時ファイル/旧名称ファイルを物理削除しない。
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
import { getCurrentProject, subscribe as subscribeProjects } from '../projects/project-store.js';
import { getCurrentOneDriveState, subscribeOneDriveState } from '../onedrive/onedrive-project.js';
import { getDriveItem, uploadDriveFile } from '../onedrive/onedrive-client.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';

let initialized = false;
let running = false;
let rerunRequested = false;
let scheduleTimer = null;

function activeProject() {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return null;
  return project;
}

function activeBinding() {
  const state = getCurrentOneDriveState();
  if (state?.phase !== 'formal' && state?.phase !== 'temporary') return null;
  return state.binding || null;
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

function stablePhotoOrder(entries = []) {
  const variantOrder = { original: 0, completed: 1 };
  return entries.slice().sort((a, b) => {
    const photoDiff = String(a.photoId || '').localeCompare(String(b.photoId || ''), 'ja', { numeric: true });
    if (photoDiff) return photoDiff;
    return (variantOrder[a.variant] ?? 9) - (variantOrder[b.variant] ?? 9);
  });
}

async function attachCurrentProjectToLocalBlobs(project) {
  const activeRecords = photoRecordStore.getAll().filter((record) => !record.deleted);
  for (const record of activeRecords) {
    await assignPhotoProject(record.photoId, project.projectId);
  }
}

async function persistUploadedPath(project, record, variant, verifiedItem) {
  const field = pathFieldForVariant(variant);
  const value = String(verifiedItem?.webUrl || '');
  if (!value || String(record?.[field] || '') === value) return record;

  const stored = photoRecordStore.set({
    ...record,
    [field]: value
  });
  await updateCameraPhotoRecord(stored);
  await persistPhotoForProject(project, stored, `photo-onedrive-${variant}-path`);
  return stored;
}

async function uploadOneVariant(project, binding, entry) {
  let record = photoRecordStore.get(entry.photoId);
  if (!record || record.deleted) return { ok: true, skipped: true, reason: 'deleted-or-missing' };

  const folderRef = folderRefFor(record, entry.variant, binding);
  if (!folderRef) return { ok: false, skipped: true, reason: 'folder-unavailable' };

  const fileName = getPhotoUploadFileName(record);
  if (!fileName) return { ok: false, skipped: true, reason: 'filename-unavailable' };

  try {
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

    const verified = await getDriveItem(uploadedRef);
    if (!verified?.file || !verified?.itemId) {
      throw new Error('OneDrive保存後のファイル実在確認に失敗しました。');
    }

    // OneDrive実在確認後にphotoRecordの保存先情報を更新する。
    record = await persistUploadedPath(project, record, entry.variant, verified);

    await markPhotoBlobUploaded(entry.photoId, entry.variant, {
      driveId: verified.driveId || uploadedRef.driveId,
      itemId: verified.itemId,
      fileName: verified.name || fileName,
      uploadedAt: new Date().toISOString()
    });

    return { ok: true, uploaded: true, photoId: entry.photoId, variant: entry.variant };
  } catch (error) {
    await recordPhotoBlobUploadError(entry.photoId, entry.variant, error);
    console.warn('[v0.1.6.5I] 写真OneDrive送信失敗', {
      photoId: entry.photoId,
      variant: entry.variant,
      error
    });
    return { ok: false, error, photoId: entry.photoId, variant: entry.variant };
  }
}

async function runCurrentProjectPhotoSync() {
  const project = activeProject();
  const binding = activeBinding();
  if (!project || !binding) return { ok: false, reason: 'unavailable' };

  await attachCurrentProjectToLocalBlobs(project);
  const pending = stablePhotoOrder(await listPendingPhotoBlobEntries(project.projectId));
  if (!pending.length) return { ok: true, uploaded: 0 };

  let uploaded = 0;
  for (const entry of pending) {
    // 処理中に案件が変わった場合は誤送信を防ぐため、その場で止める。
    if (String(getCurrentProject()?.projectId || '') !== String(project.projectId)) break;

    const result = await uploadOneVariant(project, binding, entry);
    if (result?.uploaded) uploaded += 1;

    // 1件失敗しても次variant/次写真は進める。
    // 失敗variant自体はpendingのまま保持し、同一トリガー内では再試行しない。
  }

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
 * photo-local-storeの変更通知が撮影/取込/編集保存の共通トリガーになるため、
 * camera/photo-controller/editorへOneDrive処理を重複実装しない。
 */
export function initializePhotoOneDriveSync() {
  if (initialized) return;
  initialized = true;

  subscribePhotoLocalStore(requestSync);
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
