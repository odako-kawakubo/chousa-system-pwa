/**
 * src/js/output/output-photo-source.js
 *
 * 出力プレビュー / PDF / 印刷 / Excel で共通利用する写真準備。
 * 完成画像はローカル優先、必要時のみOneDriveから取得する既存resolverを使う。
 */
import { resolveViewerCompletedPhoto } from '../photos/photo-viewer-source.js';
import * as photoRecordStore from '../store/photo-record-store.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('写真変換に失敗しました。'));
    reader.readAsDataURL(blob);
  });
}

export function collectOutputPhotoIds(targets, vm) {
  const requested = new Set(Array.isArray(targets) ? targets : []);
  const ids = new Set();

  if (requested.has('visual-photos')) {
    (vm?.visualPhotoItems || []).forEach((item) => {
      if (item?.photoId) ids.add(String(item.photoId));
    });
  }

  if (requested.has('sampling-photos')) {
    (vm?.samplingPhotoPages || []).forEach((page) => {
      (page?.stages || []).forEach((stage) => {
        if (stage?.photoId) ids.add(String(stage.photoId));
      });
    });
  }

  return [...ids];
}

export async function prepareOutputPhotoSources(targets, vm, { onProgress = null } = {}) {
  const ids = collectOutputPhotoIds(targets, vm);
  const result = new Map();
  if (!ids.length) return result;

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    onProgress?.(`写真を準備中 ${index + 1} / ${ids.length}`, (index + 1) / ids.length);
    const photo = photoRecordStore.get(id);
    if (!photo) continue;

    try {
      const blob = await resolveViewerCompletedPhoto(photo);
      if (blob instanceof Blob) result.set(id, await blobToDataUrl(blob));
    } catch (error) {
      console.warn('出力用写真の準備に失敗しました', { id, error });
    }
  }

  return result;
}
