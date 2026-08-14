/**
 * src/js/store/finish-record-store.js
 *
 * Map<finishId, finishRecord> を保持するローカル正本。
 * 1入力枠=1レコードのため、空欄レコードも通常レコードとして保持する。
 */
let records = new Map();
const listeners = [];
let batchDepth = 0;
let pendingNotify = false;

function notify() {
  if (batchDepth > 0) { pendingNotify = true; return; }
  listeners.forEach((callback) => callback());
}

export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function getAll() { return Array.from(records.values()); }
export function get(finishId) { return records.get(finishId); }

export function set(record) {
  records.set(record.finishId, record);
  notify();
}

export function remove(finishId) {
  if (!records.has(finishId)) return;
  records.delete(finishId);
  notify();
}

export function exportSnapshot() {
  return Array.from(records.values()).map((record) => ({ ...record }));
}

export function replaceAll(snapshotRecords, options = {}) {
  records = new Map(snapshotRecords.map((record) => [record.finishId, { ...record }]));
  if (options.notify !== false) notify();
}

export function batch(callback) {
  batchDepth += 1;
  try { callback(); }
  finally {
    batchDepth -= 1;
    if (batchDepth === 0 && pendingNotify) {
      pendingNotify = false;
      notify();
    }
  }
}


export function clearAll() { records = new Map(); }
