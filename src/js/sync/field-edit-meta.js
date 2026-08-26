/**
 * src/js/sync/field-edit-meta.js
 *
 * レコード内の「項目ごとの編集確定時刻」を扱う純粋ヘルパー。
 * fieldEditedAt は競合判定専用の内部メタ情報で、UI表示や業務帳票には使わない。
 * updatedAt（Firestore最終反映時刻）とは役割を分離する。
 */

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** fieldEditedAtを安全なプレーンObjectへ正規化する。 */
export function normalizeFieldEditedAt(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  Object.entries(source).forEach(([field, timestamp]) => {
    const normalized = asFiniteNumber(timestamp);
    if (field && normalized) out[field] = normalized;
  });
  return out;
}

/** 指定項目の編集確定時刻だけを更新した新しいObjectを返す。 */
export function touchFieldEditedAt(current, fields, timestamp = Date.now()) {
  const next = normalizeFieldEditedAt(current);
  const confirmedAt = asFiniteNumber(timestamp) || Date.now();
  const targets = Array.isArray(fields) ? fields : [fields];
  targets.filter(Boolean).forEach((field) => {
    next[String(field)] = confirmedAt;
  });
  return next;
}

/** 同じ値・同じ編集確定時刻かを判定するための時刻取得。 */
export function getFieldEditedAt(record, field) {
  return normalizeFieldEditedAt(record?.fieldEditedAt)[field] || 0;
}
