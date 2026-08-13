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

export function buildFinishRecordView() {
  const records = finishRecordStore.getAll().map((record) => ({ ...record }));
  return {
    type: RECORD_VIEW_TABS.FINISH,
    label: '仕上表',
    totalCount: records.length,
    activeCount: records.filter((record) => record.status === 'active').length,
    hint: '1入力枠 = 1仕上表レコード。未入力枠も実レコードとして保存されています。',
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
