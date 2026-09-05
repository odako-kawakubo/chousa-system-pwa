/**
 * src/js/record-view/record-view-view-model.js
 * Storeの実レコードを読み取り専用で表示するためのViewModel。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { getShootingTypeLabel } from '../records/photo-record.js';

export const RECORD_VIEW_TABS = Object.freeze({ MATERIAL: 'material', FINISH: 'finish', PHOTO: 'photo' });

export function buildMaterialRecordView() {
  const records = materialRecordStore.getAll().map((record) => ({ ...record }));
  return {
    type: RECORD_VIEW_TABS.MATERIAL,
    label: '建材',
    totalCount: records.length,
    activeCount: records.filter((record) => record.status === 'active').length,
    hint: 'materialRecordStore の実データです。部位・使用箇所は仕上表レコードから派生した値を保持します。',
    records
  };
}

const FINISH_AREA_ORDER = Object.freeze({ E: 0, B: 1, I: 2, S: 3, R: 4 });

function compareNatural(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ja', { numeric: true, sensitivity: 'base' });
}

function compareFinishRecords(a, b) {
  const areaDiff = (FINISH_AREA_ORDER[a.areaCode] ?? 99) - (FINISH_AREA_ORDER[b.areaCode] ?? 99);
  if (areaDiff) return areaDiff;

  if (a.areaCode === 'B') {
    const floorDiff = Number(b.floor || 0) - Number(a.floor || 0);
    if (floorDiff) return floorDiff;
  } else if (a.areaCode === 'I') {
    const floorDiff = Number(a.floor || 0) - Number(b.floor || 0);
    if (floorDiff) return floorDiff;
  }

  const roomDiff = compareNatural(a.roomPosition, b.roomPosition);
  if (roomDiff) return roomDiff;

  const positionDiff = Number(a.position || 0) - Number(b.position || 0);
  if (positionDiff) return positionDiff;

  return compareNatural(a.finishId, b.finishId);
}

export function buildFinishRecordView() {
  const materialById = new Map(
    materialRecordStore.getAll().map((record) => [record.materialId, record])
  );

  const records = finishRecordStore.getAll()
    .map((record) => ({
      ...record,
      materialName: record.materialId ? (materialById.get(record.materialId)?.name || '') : ''
    }))
    .sort(compareFinishRecords);

  return {
    type: RECORD_VIEW_TABS.FINISH,
    label: '仕上表',
    totalCount: records.length,
    activeCount: records.filter((record) => record.status === 'active').length,
    hint: '1入力枠 = 1仕上表レコード。表示順は外部 → 地下 → 地上階 → 階段 → 屋上です。',
    records
  };
}

function photoRoomNo(record) {
  if (record.roomNo) return record.roomNo;
  const finish = finishRecordStore.getAll().find((item) => (
    item.areaCode === record.areaCode
    && item.roomPosition === record.roomPosition
  ));
  return finish?.roomNo || '';
}

function comparePhotoRecords(a, b) {
  const typeDiff = (a.photoType === 'visual' ? 0 : 1) - (b.photoType === 'visual' ? 0 : 1);
  if (typeDiff) return typeDiff;

  if (a.photoType === 'visual') {
    const roomDiff = compareNatural(photoRoomNo(a), photoRoomNo(b));
    if (roomDiff) return roomDiff;
    const partDiff = compareNatural(a.part, b.part);
    if (partDiff) return partDiff;
  } else {
    const materialDiff = compareNatural(a.materialId, b.materialId);
    if (materialDiff) return materialDiff;
    const branchDiff = Number(a.samplingBranch || 0) - Number(b.samplingBranch || 0);
    if (branchDiff) return branchDiff;
    const stageOrder = { before: 0, during: 1, after: 2, section: 3 };
    const stageDiff = (stageOrder[a.shootingType] ?? 99) - (stageOrder[b.shootingType] ?? 99);
    if (stageDiff) return stageDiff;
  }

  const capturedDiff = compareNatural(a.capturedAt, b.capturedAt);
  if (capturedDiff) return capturedDiff;
  return compareNatural(a.photoId, b.photoId);
}

export function buildPhotoRecordView() {
  const records = photoRecordStore.getAll()
    .map((record) => ({
      ...record,
      roomNo: record.roomNo || photoRoomNo(record),
      photoTypeLabel: record.photoType === 'visual' ? '目視' : '採取',
      shootingTypeLabel: getShootingTypeLabel(record.shootingType),
      // レコード構造は増やさず、表示用だけ完成画像→元画像→旧互換の順で1列へまとめる。
      oneDrivePath: record.completedPath || record.originalPath || record.oneDrivePath || ''
    }))
    .sort(comparePhotoRecords);

  return {
    type: RECORD_VIEW_TABS.PHOTO,
    label: '写真',
    totalCount: records.length,
    activeCount: records.filter((record) => !record.deleted).length,
    representativeCount: records.filter((record) => !record.deleted && record.isRepresentative).length,
    hint: 'photoRecordStore の実データです。目視写真は区分＋部屋位置＋部位枠、採取写真は建材ID＋採取枝番＋撮影区分で管理します。',
    records
  };
}

export function buildRecordView(tabId) {
  if (tabId === RECORD_VIEW_TABS.FINISH) return buildFinishRecordView();
  if (tabId === RECORD_VIEW_TABS.PHOTO) return buildPhotoRecordView();
  return buildMaterialRecordView();
}
