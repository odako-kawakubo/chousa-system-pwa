/**
 * src/js/record-view/record-view-view-model.js
 * Storeの実レコードを読み取り専用で表示するためのViewModel。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';

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

/**
 * レコード確認用の仕上表順。
 * 正式な表示順は「外部 → 地下 → 地上階 → 階段 → 屋上」。
 * 外部は仕上表上の roomPosition 順をそのまま使い、地下は深い階から、
 * 地上階は低い階から並べる。各部屋の中は position 順。
 */
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
      // 仕上表レコードの確認画面では、建材IDに紐づく現在の建材名称も表示する。
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

export function buildPhotoRecordView() {
  return {
    type: RECORD_VIEW_TABS.PHOTO,
    label: '写真',
    totalCount: 0,
    activeCount: 0,
    hint: 'photoRecordStore は未実装です。写真レコードは後続段階で接続します。',
    records: [],
    unavailable: true
  };
}

export function buildRecordView(tabId) {
  if (tabId === RECORD_VIEW_TABS.FINISH) return buildFinishRecordView();
  if (tabId === RECORD_VIEW_TABS.PHOTO) return buildPhotoRecordView();
  return buildMaterialRecordView();
}
