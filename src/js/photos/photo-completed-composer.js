/**
 * src/js/photos/photo-completed-composer.js
 *
 * 元画像と看板描画データから完成画像Blobを生成する共通処理。
 * - Photo Board Editorと採取場所変更の一括反映で同じ合成経路を使う。
 * - Record保存、IndexedDB保存、Firestore保存は呼び出し側が担当する。
 */

import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { drawBoard, getBoardRect } from '../camera/camera-board.js';

async function loadImageForComposition(blob) {
  if (!(blob instanceof Blob)) throw new Error('元写真Blobがありません。');

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('完成画像を生成できませんでした。')),
      'image/jpeg',
      0.82
    );
  });
}

/**
 * 元写真へ電子看板を合成し、完成画像JPEG Blobを返す。
 * 採取写真の断面だけは現行仕様どおり看板を描画しない。
 */
export async function composeCompletedPhotoBlob({
  originalBlob,
  photoType,
  shootingType = '',
  boardPosition = 'bottom-left',
  boardSize = 'medium',
  boardData = {}
} = {}) {
  const image = await loadImageForComposition(originalBlob);
  const out = document.createElement('canvas');
  out.width = image.width;
  out.height = image.height;

  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('完成画像Canvasを作成できませんでした。');
  ctx.drawImage(image, 0, 0);

  const omitBoard = photoType === PHOTO_TYPES.SAMPLING && shootingType === SHOOTING_TYPES.SECTION;
  if (!omitBoard) {
    const rect = getBoardRect(out.width, out.height, boardPosition, boardSize);
    drawBoard(ctx, rect, boardData);
  }

  return canvasToJpegBlob(out);
}
