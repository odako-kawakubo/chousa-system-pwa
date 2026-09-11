/**
 * src/js/output/output-view-model.js
 *
 * 「出力」タブ専用の読み取りViewModel。
 * finish/material/photoの各Record Storeを正本として、その時点の表示用データだけを組み立てる。
 * 帳票用の別保存データは持たない。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { partIndexFromPosition } from '../records/finish-record.js';

const AREA_ORDER = Object.freeze({ E: 0, B: 1, I: 2, S: 3, R: 4 });

function text(value) { return String(value ?? '').trim(); }

function natural(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ja', { numeric: true, sensitivity: 'base' });
}

function compareRoomRecord(a, b) {
  const areaDiff = (AREA_ORDER[a.areaCode] ?? 99) - (AREA_ORDER[b.areaCode] ?? 99);
  if (areaDiff) return areaDiff;
  if (a.areaCode === 'B') {
    const floorDiff = Number(b.floor || 0) - Number(a.floor || 0);
    if (floorDiff) return floorDiff;
  } else if (a.areaCode === 'I') {
    const floorDiff = Number(a.floor || 0) - Number(b.floor || 0);
    if (floorDiff) return floorDiff;
  }
  const roomDiff = natural(a.roomPosition, b.roomPosition);
  if (roomDiff) return roomDiff;
  return Number(a.position || 0) - Number(b.position || 0);
}

function floorLabel(record) {
  if (record.areaCode === 'E') return '外部';
  if (record.areaCode === 'S') return '階段';
  if (record.areaCode === 'R') return '屋上';
  if (record.areaCode === 'B') return `B${record.floor}階`;
  return `${record.floor}階`;
}

export function buildMaterialListOutput() {
  return materialRecordStore.getAll()
    .filter((record) => record.status === 'active')
    .slice()
    .sort((a, b) => Number(a.materialNo || a.inputId || 0) - Number(b.materialNo || b.inputId || 0))
    .map((record) => ({
      materialNo: record.materialNo || record.inputId || '',
      name: text(record.name),
      part: text(record.part),
      usageLocation: text(record.usageLocation),
      level: text(record.level) || '-',
      analysisRequired: text(record.analysisRequired),
      analysisResult: text(record.analysisResult),
      note: text(record.note || record.remarks)
    }));
}

export function buildRoomMaterialOutput() {
  const materialById = new Map(
    materialRecordStore.getAll()
      .filter((record) => record.status === 'active')
      .map((record) => [String(record.materialId), record])
  );

  return finishRecordStore.getAll()
    .filter((record) => record.status === 'active')
    .filter((record) => record.materialId || text(record.materialName))
    .slice()
    .sort(compareRoomRecord)
    .map((record) => {
      const material = record.materialId ? materialById.get(String(record.materialId)) : null;
      const partIndex = partIndexFromPosition(record.position);
      return {
        floor: floorLabel(record),
        roomNo: text(record.roomNo),
        roomName: text(record.roomName),
        roomNote: text(record.roomNote),
        part: partIndex >= 5 ? (text(record.part) || 'その他') : text(record.part),
        materialNo: material ? (material.materialNo || material.inputId || '') : '',
        materialName: material ? text(material.name) : text(record.materialName),
        note: material ? text(material.note || material.remarks) : '',
        level: material ? (text(material.level) || '-') : '-',
        analysisResult: material ? text(material.analysisResult) : '調査対象外',
        registered: Boolean(material)
      };
    });
}

export function buildOutputViewModel() {
  const photos = photoRecordStore.getAll().filter((record) => !record.deleted);
  return {
    materialRows: buildMaterialListOutput(),
    roomRows: buildRoomMaterialOutput(),
    visualPhotoCount: photos.filter((record) => record.photoType === 'visual').length,
    samplingPhotoCount: photos.filter((record) => record.photoType === 'sampling').length
  };
}
