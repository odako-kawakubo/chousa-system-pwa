/**
 * src/js/sync/unsent-queue.js
 *
 * Firestore未送信の最新状態だけを端末へ保持する基盤。
 * キーは projectId + recordType + recordId。同じレコードは最新1件へ圧縮する。
 * 操作履歴はここへ積まず、systemMemoが担う。
 */

const STORAGE_KEY = 'chousa-firestore-unsent-v0161c';

function loadMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return new Map();
    return new Map(raw.filter((item) => item?.key).map((item) => [item.key, item]));
  } catch {
    return new Map();
  }
}

function persist(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(map.values())));
  } catch {
    // localStorage容量等で失敗しても、呼び出し側の業務操作自体は止めない。
  }
}

function makeKey(projectId, recordType, recordId) {
  return [projectId, recordType, recordId].map((value) => String(value || '')).join('|');
}

export function putUnsent({ projectId, environment = 'production', recordType, recordId, operation = 'set', record = null }) {
  if (!projectId || !recordType || !recordId) throw new Error('未送信キー情報が不足しています。');
  const map = loadMap();
  const key = makeKey(projectId, recordType, recordId);
  map.set(key, {
    key,
    projectId: String(projectId),
    environment,
    recordType: String(recordType),
    recordId: String(recordId),
    operation,
    record,
    queuedAt: Date.now()
  });
  persist(map);
  return map.get(key);
}

export function removeUnsent(projectId, recordType, recordId) {
  const map = loadMap();
  const deleted = map.delete(makeKey(projectId, recordType, recordId));
  if (deleted) persist(map);
  return deleted;
}

export function listUnsent({ projectId = '', limit = 0 } = {}) {
  const values = Array.from(loadMap().values())
    .filter((item) => !projectId || item.projectId === String(projectId))
    .sort((a, b) => a.queuedAt - b.queuedAt);
  return limit > 0 ? values.slice(0, limit) : values;
}

export function clearUnsentForProject(projectId) {
  const map = loadMap();
  Array.from(map.entries()).forEach(([key, item]) => {
    if (item.projectId === String(projectId)) map.delete(key);
  });
  persist(map);
}
