/**
 * 完成画像の再生成・電子看板編集で共用する保存経路。
 * IndexedDBへ完成画像と影響する写真Recordを一括確定してからStoreへ反映し、
 * Firestoreは未送信キュー対応の後追い処理とする。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import { composeCompletedPhotoBlob } from './photo-completed-composer.js';
import { saveEditedPhotoLocally, notifyEditedPhotoSaved } from './photo-local-store.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';
import { setLocalPhotoPreview } from './photo-preview-manager.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';

const running = new Map();

function projectId() {
  return String(getCurrentProject()?.projectId || '');
}

/** 部屋の変更に合わせて元画像から新しい完成画像を生成する。 */
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
  return { photo, completedBlob, projectId: preparedProjectId };
}

function queueMetadata(project, record, source) {
  void persistPhotoForProject(project, record, source).catch((error) => {
    console.warn('写真編集のメタデータ同期は未完了です', record.photoId, error);
  });
}

/**
 * 同一写真への更新を直列化し、画像本体とRecord群を一つのローカル確定単位にする。
 * originalBlobは手動看板編集で指定し、自動看板再生成では従来のoriginalを維持する。
 */
export function persistCompletedPhotoUpdate(prepared, nextFields, source, options = {}) {
  const photoId = String(prepared?.photo?.photoId || '');
  const startedProjectId = String(prepared?.projectId || '');
  if (!photoId || !startedProjectId || projectId() !== startedProjectId) {
    return Promise.reject(new Error('写真編集の開始後に案件が切り替わりました。'));
  }
  const key = `${startedProjectId}|${photoId}`;
  const previousTask = running.get(key) || Promise.resolve();
  const task = previousTask.catch(() => {}).then(async () => {
    if (projectId() !== startedProjectId) throw new Error('写真保存中に案件が切り替わりました。');
    const project = getCurrentProject();
    const current = photoRecordStore.get(photoId);
    if (!current || current.deleted) throw new Error('写真レコードが見つかりません。');

    const planned = photoRecordStore.planSet({
      ...current,
      ...nextFields,
      syncStatus: 'pending',
      localOriginalStatus: options.originalBlob instanceof Blob ? 'saved' : current.localOriginalStatus,
      localCompletedStatus: 'saved'
    });
    const changes = planned.changed.map((candidate) => {
      const before = photoRecordStore.get(candidate.photoId);
      if (before && Boolean(before.isRepresentative) !== Boolean(candidate.isRepresentative)) {
        return {
          ...candidate,
          syncStatus: 'pending',
          fieldEditedAt: touchFieldEditedAt(candidate.fieldEditedAt, 'isRepresentative')
        };
      }
      return candidate;
    });
    const ordered = [
      ...changes.filter((item) => item.photoId === photoId),
      ...changes.filter((item) => item.photoId !== photoId)
    ];

    if (projectId() !== startedProjectId) throw new Error('写真保存中に案件が切り替わりました。');
    await saveEditedPhotoLocally({
      photoId,
      projectId: startedProjectId,
      originalBlob: options.originalBlob,
      completedBlob: prepared.completedBlob,
      fileName: planned.record.fileName,
      capturedAt: current.capturedAt,
      editedAt: options.editedAt || new Date().toISOString(),
      records: ordered
    });
    if (projectId() !== startedProjectId) {
      throw new Error('写真保存中に案件が切り替わりました。');
    }

    photoRecordStore.batch(() => {
      ordered.forEach((record) => photoRecordStore.set(record));
    });
    const updated = photoRecordStore.get(photoId);
    setLocalPhotoPreview(photoId, prepared.completedBlob);
    ordered.forEach((record) => {
      queueMetadata(project, photoRecordStore.get(record.photoId) || record,
        record.photoId === photoId ? source : `${source}-representative`);
    });
    notifyEditedPhotoSaved();
    return updated;
  });
  running.set(key, task);
  void task.finally(() => {
    if (running.get(key) === task) running.delete(key);
  }).catch(() => {});
  return task;
}
