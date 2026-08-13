/**
 * src/js/store/material-record-store.js
 *
 * materialRecordのローカルStore（正本）。Map<materialId, materialRecord>を
 * メモリ上に保持するだけで、Firebase・OneDrive等の外部接続は一切行わない
 * （ローカル完結。v0.1.5.1の禁止事項）。
 *
 * finish-record-store.jsと同じCRUD・購読・batch()・通知抑制の形を持つ独立した
 * 別モジュール。互いに相手のStoreを参照・importせず、複数Storeにまたがる
 * 操作の調整はfinish-table-actions.jsのrunRecordTransaction()が行う。
 */

/** @type {Map<string, import('../records/material-record.js').MaterialRecord>} */
let records = new Map();

const listeners = [];
let batchDepth = 0;
let pendingNotify = false;
let notificationMuteDepth = 0;

function notify() {
  // 複数Storeをまたぐtransaction中はStore個別の通知を発火しない。
  // transaction完了後の画面更新は呼び出し側が1回だけ行う。
  if (notificationMuteDepth > 0) return;

  if (batchDepth > 0) {
    pendingNotify = true;
    return;
  }
  listeners.forEach((callback) => callback());
}

/**
 * 変更を購読する。
 * @param {() => void} callback
 * @returns {() => void} 購読解除関数
 */
export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

/** @returns {import('../records/material-record.js').MaterialRecord[]} 全レコード（Map挿入順）。 */
export function getAll() {
  return Array.from(records.values());
}

/**
 * @param {string} materialId
 * @returns {import('../records/material-record.js').MaterialRecord|undefined}
 */
export function get(materialId) {
  return records.get(materialId);
}

/**
 * 入力ID（inputId）から建材を検索する。
 * @param {number|string} inputId
 * @returns {import('../records/material-record.js').MaterialRecord|undefined}
 */
export function findByInputId(inputId) {
  const normalized = String(inputId ?? '').trim();
  if (!normalized) return undefined;
  for (const record of records.values()) {
    if (record.status !== 'active') continue;
    if (String(record.inputId) === normalized) return record;
  }
  return undefined;
}

/**
 * 正規化済みの建材名称から検索する（呼び出し側で
 * material-record.jsのnormalizeMaterialName()を通した値を渡すこと）。
 * @param {string} normalizedName
 * @returns {import('../records/material-record.js').MaterialRecord|undefined}
 */
export function findByName(normalizedName) {
  if (!normalizedName) return undefined;
  for (const record of records.values()) {
    if (record.status !== 'active') continue;
    if (record.name === normalizedName) return record;
  }
  return undefined;
}

/**
 * レコードを1件書き込む（新規／上書きの両方を兼ねる）。
 * @param {import('../records/material-record.js').MaterialRecord} record
 */
export function set(record) {
  records.set(record.materialId, record);
  notify();
}

/**
 * レコードを1件削除する。materialRecordには代表レコードの概念がないため、
 * finish-record-store.jsのような削除無効化は行わない。
 * @param {string} materialId
 */
export function remove(materialId) {
  if (!records.has(materialId)) return;
  records.delete(materialId);
  notify();
}

/**
 * 現在の全レコードのスナップショットを返す（各レコードを複製した配列）。
 * @returns {import('../records/material-record.js').MaterialRecord[]}
 */
export function exportSnapshot() {
  return Array.from(records.values()).map((record) => ({ ...record }));
}

/**
 * スナップショットから全体を復元する。
 * @param {import('../records/material-record.js').MaterialRecord[]} snapshotRecords
 * @param {{ notify?: boolean }} [options] notify:falseのときはsubscribeへの通知を抑制する
 *   （finish-table-actions.jsのrunRecordTransaction()経由で使う）。
 */
export function replaceAll(snapshotRecords, options = {}) {
  const shouldNotify = options.notify !== false;
  records = new Map(snapshotRecords.map((record) => [record.materialId, { ...record }]));
  if (shouldNotify) notify();
}

/**
 * callback内で行われた複数回のset/remove/replaceAllの通知をまとめ、
 * callback完了後に1回だけsubscribeへ通知する（finish-record-store.jsと
 * 同じ設計。batchDepthでネストに対応する）。
 *
 * @param {() => void} callback
 */
export function batch(callback) {
  batchDepth += 1;
  try {
    callback();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0 && pendingNotify) {
      pendingNotify = false;
      notify();
    }
  }
}

/**
 * callback中だけsubscribe通知を完全に抑制する。
 * batch()の「最後に1回通知」とは異なり、ここでは遅延通知も残さない。
 * finish/materialの複数Store transactionを1つの業務操作として扱うために使う。
 *
 * @param {() => void} callback
 */
export function runWithoutNotification(callback) {
  notificationMuteDepth += 1;
  try {
    callback();
  } finally {
    notificationMuteDepth -= 1;
  }
}

/** 初期化時に呼ぶ。全レコードを空にする（通知はしない。呼び出し側が初期投入後に行う）。 */
export function clearAll() {
  records = new Map();
}
