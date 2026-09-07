/**
 * src/js/photos/photo-viewer-source.js
 *
 * PhotoViewerが表示する「完成画像本体」の解決だけを担当する。
 * Viewerや簡易リストへOneDrive/IndexedDBの詳細を漏らさない。
 *
 * 解決順:
 * 1. この端末のIndexedDBに完成画像があれば返す。
 * 2. 無ければOneDrive上の完成画像を取得する。
 * 3. 取得できた本体はIndexedDBへ保存して返す。
 *
 * サムネイルはここでは扱わない。Viewer側は本体解決中だけ既存サムネイルを表示できる。
 */

import { getPhotoBlob, saveRemoteCompletedPhoto } from './photo-local-store.js';
import { fetchRemoteCompletedPhoto, hasRemoteCompletedPhoto } from './photo-remote-reader.js';
import { getCurrentProject } from '../projects/project-store.js';

const inflight = new Map();

function requestKey(projectId, photoId) {
  return `${projectId}::${photoId}`;
}

/**
 * @param {object} photo
 * @returns {Promise<Blob|null>}
 */
export async function resolveViewerCompletedPhoto(photo) {
  const photoId = String(photo?.photoId || '');
  if (!photoId || photo?.deleted) return null;

  const projectId = String(getCurrentProject()?.projectId || '');
  const key = requestKey(projectId, photoId);
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const local = await getPhotoBlob(photoId, 'completed');
    if (local instanceof Blob) return local;
    if (!hasRemoteCompletedPhoto(photo)) return null;

    const remote = await fetchRemoteCompletedPhoto(photo);
    if (!(remote instanceof Blob)) return null;

    // 取得中に案件が切り替わった場合、旧案件の結果を現在案件のローカル状態へ混ぜない。
    if (String(getCurrentProject()?.projectId || '') !== projectId) return null;

    await saveRemoteCompletedPhoto({ record: photo, blob: remote, projectId });
    return remote;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}
