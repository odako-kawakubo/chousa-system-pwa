/**
 * 既存の完成画像を安全に更新する共通経路。
 * 生成→保存→写真レコード反映。書き込み途中で失敗した場合は
 * ローカル完成画像とレコードを可能な範囲で元に戻す。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import { composeCompletedPhotoBlob } from './photo-completed-composer.js';
import { getPhotoBlobEntry, savePhotoBlob, updateCameraPhotoRecord } from './photo-local-store.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';

const running = new Map();

function projectId() {
  return String(getCurrentProject()?.projectId || '');
}

export async function prepareCompletedPhotoUpdate(photo, boardData) {
  const preparedProjectId = projectId();
  const originalBlob = await resolveEditorOriginalPhoto(photo);
  if (!(originalBlob instanceof Blob)) throw new Error(`元写真を取得できません。(${photo.photoId})`);
  const completedBlob = await composeCompletedPhotoBlob({
    originalBlob,
    photoType: photo.photoType,
    shootingType: photo.shootingType,
    boardPosition: photo.boardPosition || 'bottom-left',
    boardSize: photo.boardSize || 'medium',
    boardData
  });
  if (projectId() !== preparedProjectId) throw new Error('画像の再生成中に案件が切り替わりました。');
  return { photo, completedBlob, projectId:preparedProjectId };
}

/** 同じ写真への連続更新は直列化する。案件切替後の誤保存も防ぐ。 */
export function persistCompletedPhotoUpdate(prepared, nextFields, source) {
  const photoId = String(prepared.photo.photoId);
  const startedProjectId = String(prepared.projectId || '');
  if (!startedProjectId || projectId() !== startedProjectId) {
    return Promise.reject(new Error('画像の再生成後に案件が切り替わりました。'));
  }
  const key = `${startedProjectId}|${photoId}`;
  const previousTask = running.get(key) || Promise.resolve();
  const task = previousTask.catch(() => {}).then(async () => {
    if (projectId() !== startedProjectId) throw new Error('案件が切り替わりました。');
    const current = photoRecordStore.get(photoId);
    if (!current || current.deleted) throw new Error('写真レコードが見つかりません。');
    const previousBlob = await getPhotoBlobEntry(photoId, 'completed');
    const now = new Date().toISOString();
    let blobWritten = false;
    let recordWritten = false;
    try {
      await savePhotoBlob(photoId, 'completed', prepared.completedBlob, {
        projectId: startedProjectId, createdAt: now,
        fileName: current.fileName, uploadStatus: 'pending'
      });
      blobWritten = true;
      if (projectId() !== startedProjectId) throw new Error('画像保存中に案件が切り替わりました。');
      const next = photoRecordStore.set({
        ...current, ...nextFields, syncStatus: 'pending', localCompletedStatus: 'saved'
      });
      recordWritten = true;
      await updateCameraPhotoRecord(next);
      await persistPhotoForProject(getCurrentProject(), next, source);
      return next;
    } catch (error) {
      if (recordWritten && projectId() === startedProjectId) {
        photoRecordStore.set(current);
        try { await updateCameraPhotoRecord(current); } catch (rollbackError) {
          console.error('写真レコードの復元に失敗', rollbackError);
        }
      }
      if (blobWritten && previousBlob?.blob instanceof Blob) {
        try {
          await savePhotoBlob(photoId, 'completed', previousBlob.blob, {
            projectId: startedProjectId,
            createdAt: previousBlob.createdAt,
            fileName: previousBlob.fileName,
            uploadStatus: previousBlob.uploadStatus
          });
        } catch (rollbackError) {
          console.error('完成画像の復元に失敗', rollbackError);
        }
      }
      throw error;
    }
  });
  running.set(key, task);
  void task.finally(() => {
    if (running.get(key) === task) running.delete(key);
  }).catch(() => {});
  return task;
}
