/**
 * src/js/photos/photo-filename.js
 *
 * 写真ファイル名の正式ルールを1か所へ集約する。
 * カメラ撮影と撮影後の看板編集で同じ命名規則を使用する。
 */

import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';

const SHOOTING_CODE = Object.freeze({
  [SHOOTING_TYPES.BEFORE]: '1',
  [SHOOTING_TYPES.DURING]: '2',
  [SHOOTING_TYPES.AFTER]: '3',
  [SHOOTING_TYPES.SECTION]: '4'
});

function text(value) {
  return String(value ?? '').trim();
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
