/**
 * src/js/camera/board-photo-composer.js
 *
 * 電子看板付き完成画像を作る唯一の共通経路。
 * 内蔵カメラ撮影・写真取込後編集・通常看板編集のすべてがここを通る。
 */

import { drawBoard, getBoardRect } from './camera-board.js';

export const BOARD_JPEG_QUALITY = 0.82;

function sourceSize(source) {
  const width = Number(source?.width || source?.naturalWidth || source?.videoWidth || 0);
  const height = Number(source?.height || source?.naturalHeight || source?.videoHeight || 0);
  if (!(width > 0 && height > 0)) throw new Error('看板合成元画像のサイズを取得できませんでした。');
  return { width, height };
}

/**
 * 元画像と看板情報から完成Canvasを生成する。
 * @param {CanvasImageSource} source
 * @param {object} options
 * @param {object} options.boardData
 * @param {'bottom-left'|'bottom-right'|'top-right'|'top-left'} options.boardPosition
 * @param {'small'|'medium'|'large'} options.boardSize
 * @param {boolean} options.hideBoard
 */
export function composeBoardPhotoCanvas(source, {
  boardData = {},
  boardPosition = 'bottom-left',
  boardSize = 'medium',
  hideBoard = false
} = {}) {
  const { width, height } = sourceSize(source);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, width, height);

  if (!hideBoard) {
    const rect = getBoardRect(width, height, boardPosition, boardSize);
    drawBoard(ctx, rect, boardData);
  }
  return canvas;
}

export function canvasToJpegBlob(canvas, quality = BOARD_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('画像Blobを生成できませんでした。')),
      'image/jpeg',
      quality
    );
  });
}
