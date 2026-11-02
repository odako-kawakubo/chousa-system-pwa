/**
 * 建材Record 1件の採取設定自動補完。
 *
 * このモジュールはStore/Firestoreへ触れない純粋な業務ロジックとして扱う。
 * 呼び出し元がRecordのコピーを渡し、戻り値のchangedFieldsを見て
 * Store更新・永続化の要否を決める。
 */

import { normalizeSampleParts } from '../records/material-record.js';

function splitDerivedList(value) {
  return [...new Set(
    String(value || '')
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

/**
 * 使用箇所が1つなら有効な採取場所の空欄へ同じ値を補完し、
 * 使用部位が1つなら採取部位の空欄へ補完する。
 * 既存値は上書きしない。
 *
 * @param {object} record 直接更新してよいRecordコピー
 * @returns {string[]} 実際に変更した業務フィールド名
 */
export function applySingleRecordSamplingAutofill(record, roomOptions = []) {
  const changedFields = [];
  const markChanged = (field) => {
    if (!changedFields.includes(field)) changedFields.push(field);
  };

  if (String(record.analysisRequired || '採取・分析') !== '採取・分析') {
    return changedFields;
  }

  let count = Number(record.sampleCount);
  if (!Number.isFinite(count) || count < 1) {
    count = 1;
    record.sampleCount = 1;
    markChanged('sampleCount');
  } else if (count > 3) {
    count = 3;
    record.sampleCount = 3;
    markChanged('sampleCount');
  }

  const places = splitDerivedList(record.usageLocation);
  const parts = splitDerivedList(record.part);

  if (places.length === 1) {
    for (let index = 1; index <= count; index += 1) {
      const field = `sampleLocation${index}`;
      if (!record[field]) {
        record[field] = places[0];
        markChanged(field);
      }
    }
  }

  const selectedParts = normalizeSampleParts(record.samplePart);
  if (parts.length === 1 && selectedParts.length === 0) {
    record.samplePart = [parts[0]];
    markChanged('samplePart');
  } else if (!Array.isArray(record.samplePart)) {
    record.samplePart = selectedParts;
    markChanged('samplePart');
  }

  // 場所の表示文字列は補助情報。参照先の同一性は部屋キーで管理する。
  // 同名の候補が複数ある場合は推測せず、選択操作まで空のまま残す。
  for (let branch = 1; branch <= count; branch += 1) {
    const field = `sampleRoomKey${branch}`;
    if (record[field]) continue;
    const raw = String(record[`sampleLocation${branch}`] || '').trim();
    if (!raw) continue;
    const matching = roomOptions.filter((item) =>
      item.value === raw || item.roomNo === raw || item.roomName === raw
    );
    if (matching.length !== 1 || !matching[0].key) continue;
    record[field] = matching[0].key;
    markChanged(field);
  }

  return changedFields;
}
