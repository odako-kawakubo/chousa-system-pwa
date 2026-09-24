/**
 * camera-capture.js
 * 撮影画像の切り出し・看板合成・Blob化を担当する。
 */
import { PHOTO_TYPES } from '../records/photo-record.js';
import { drawBoard, getBoardRect } from './camera-board.js';
import { CAMERA_QUALITY } from './camera-preferences.js';
import {
  currentSamplingTarget,
  currentVisualTarget,
  currentStatusCode,
  samplingDisplayNo
} from './camera-state.js';

export const JPEG_QUALITY = 0.82;

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

export function buildCameraBoardData(state, boardSettings = {}) {
  if (state.photoType === PHOTO_TYPES.SAMPLING) {
    const target = currentSamplingTarget(state);
    return {
      photoType: 'sampling',
      projectName: boardSettings.subjectText || boardSettings.projectName || '',
      address: boardSettings.addressText || boardSettings.address || '',
      subjectFontSize: boardSettings.subjectFontSize,
      addressFontSize: boardSettings.addressFontSize,
      samplingPlace: target.samplingPlace || '',
      sampleNo: samplingDisplayNo(target),
      statusCode: currentStatusCode(state),
      date: todayText()
    };
  }

  const { room, target } = currentVisualTarget(state);
  return {
    photoType: 'visual',
    projectName: boardSettings.subjectText || boardSettings.projectName || '',
    address: boardSettings.addressText || boardSettings.address || '',
    subjectFontSize: boardSettings.subjectFontSize,
    addressFontSize: boardSettings.addressFontSize,
    roomNo: room.roomNo || '',
    part: target.part || '',
    statusCode: '5',
    date: todayText()
  };
}

export function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('画像Blobを生成できませんでした。')),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

export function captureOriginalCanvas(video, qualityKey) {
  const quality = CAMERA_QUALITY[qualityKey] || CAMERA_QUALITY.standard;
  const canvas = document.createElement('canvas');
  canvas.width = quality.width;
  canvas.height = quality.height;
  const ctx = canvas.getContext('2d');

  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createCompletedCanvas(originalCanvas, boardData, snapshot) {
  const canvas = document.createElement('canvas');
  canvas.width = originalCanvas.width;
  canvas.height = originalCanvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(originalCanvas, 0, 0);

  if (snapshot.photoType === PHOTO_TYPES.SAMPLING && snapshot.sectionMode) return canvas;

  const boardRect = getBoardRect(canvas.width, canvas.height, snapshot.boardPosition, snapshot.boardSize);
  drawBoard(ctx, boardRect, boardData);
  return canvas;
}
