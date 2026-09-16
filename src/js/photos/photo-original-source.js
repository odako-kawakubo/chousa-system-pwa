/**
 * src/js/photos/photo-original-source.js
 *
 * 看板編集で必要な「元画像本体」の解決を一元化する。
 *
 * 解決順:
 * 1. この端末のIndexedDBにoriginalがあれば返す。
 * 2. 無ければphotoRecordのOneDrive参照からoriginalを取得する。
 * 3. 取得したoriginalはIndexedDBへuploaded状態で保存し、以後はローカルを優先する。
 */

import { getPhotoBlob, savePhotoBlob, markPhotoBlobUploaded } from './photo-local-store.js';
import { fetchRemoteOriginalPhoto, hasRemoteOriginalPhoto } from './photo-remote-reader.js';
import { getCurrentProject } from '../projects/project-store.js';

const inflight = new Map();

function requestKey(projectId, photoId) {
  return `${projectId}::${photoId}`;
}

/**
 * @param {object} photo
 * @returns {Promise<Blob|null>}
 */
export async function resolveEditorOriginalPhoto(photo) {
  const photoId = String(photo?.photoId || '');
  if (!photoId || photo?.deleted) return null;

  const projectId = String(getCurrentProject()?.projectId || '');
  const key = requestKey(projectId, photoId);
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const local = await getPhotoBlob(photoId, 'original');
    if (local instanceof Blob) return local;
    if (!hasRemoteOriginalPhoto(photo)) return null;

    const remote = await fetchRemoteOriginalPhoto(photo);
    if (!(remote instanceof Blob)) return null;

    // 取得中に案件が切り替わった場合、旧案件の画像を現在案件のIndexedDBへ混ぜない。
    if (String(getCurrentProject()?.projectId || '') !== projectId) return null;

    await savePhotoBlob(photoId, 'original', remote, {
      projectId,
      createdAt: photo.capturedAt,
      fileName: photo.fileName,
      uploadStatus: 'uploaded'
    });
    await markPhotoBlobUploaded(photoId, 'original', {
      driveId: photo.oneDriveDriveId,
      itemId: photo.originalItemId,
      fileName: photo.fileName
    });
    return remote;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}
