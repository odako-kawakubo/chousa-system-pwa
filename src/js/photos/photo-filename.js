/**
 * src/js/photos/photo-filename.js
 *
 * 写真ファイル名の正式ルールを1か所へ集約する。
 * カメラ撮影・撮影後編集・OneDrive送信で同じ命名判断を使用する。
 */

import {
  PHOTO_TYPES,
  SHOOTING_TYPES,
  isSamplingPhotoUnorganized,
  isVisualPhotoUnorganized
} from '../records/photo-record.js';

const SHOOTING_CODE = Object.freeze({
  [SHOOTING_TYPES.BEFORE]: '1',
  [SHOOTING_TYPES.DURING]: '2',
  [SHOOTING_TYPES.AFTER]: '3',
  [SHOOTING_TYPES.SECTION]: '4'
});

function text(value) {
  return String(value ?? '').trim();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function uploadTimestamp(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '00000000-000000';
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function getPhotoFileBase(fields) {
  if (fields.photoType === PHOTO_TYPES.SAMPLING) {
    const sampleBaseNo = text(fields.sampleBaseNo) || text(fields.sampleNo).split('-')[0] || '未整理';
    const branch = Number(fields.samplingBranch || 0) || '未整理';
    const code = SHOOTING_CODE[fields.shootingType] || '1';
    return `${sampleBaseNo}-${branch}-${code}`;
  }

  return `${text(fields.roomNo) || '未整理'}-${text(fields.part) || '未整理'}-5`;
}

export function isPhotoUnorganized(fields = {}) {
  return fields.photoType === PHOTO_TYPES.SAMPLING
    ? isSamplingPhotoUnorganized(fields)
    : isVisualPhotoUnorganized(fields);
}

/**
 * OneDriveへ送る名前。
 * 未整理写真は元ファイル名を使わず、端末コード＋撮影時刻で一意な一時名にする。
 * 整理済み写真はphotoRecordに確定済みの正式fileNameを使用する。
 */
export function getPhotoUploadFileName(fields = {}) {
  if (!isPhotoUnorganized(fields)) {
    const current = text(fields.fileName);
    if (current) return current;
    return `${getPhotoFileBase(fields)}.jpg`;
  }

  const device = text(fields.capturedDevice) || 'LOCAL';
  return `未整理_${device}_${uploadTimestamp(fields.capturedAt)}.jpg`;
}

/**
 * 既存Recordのファイル名と重複しない名称を返す。
 * 編集対象自身はexcludePhotoIdで除外する。
 */
export function getAvailablePhotoFileName(fields, records = [], excludePhotoId = '') {
  const base = getPhotoFileBase(fields);
  const names = new Set(
    records
      .filter((record) => !record.deleted && record.photoId !== excludePhotoId)
      .map((record) => text(record.fileName))
      .filter(Boolean)
  );

  if (!names.has(`${base}.jpg`)) return `${base}.jpg`;

  let number = 2;
  while (names.has(`${base}_${String(number).padStart(2, '0')}.jpg`)) number += 1;
  return `${base}_${String(number).padStart(2, '0')}.jpg`;
}
