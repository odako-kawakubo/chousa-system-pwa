/**
 * src/js/sync/unsent-queue.js
 *
 * Firestore未送信の最新状態だけを端末へ保持する基盤。
 * キーは projectId + recordType + recordId。同じレコードは最新1件へ圧縮する。
 * 操作履歴はここへ積まず、systemMemoが担う。
 */

const STORAGE_KEY = 'chousa-firestore-unsent-v0161c';

export class UnsentStorageError extends Error {
  constructor(action, cause) {
    super(`未送信データの端末${action === 'read' ? '読み込み' : '保存'}に失敗しました。`, { cause });
    this.name = 'UnsentStorageError';
    this.action = action;
  }
}

function loadMap() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const raw = stored === null ? [] : JSON.parse(stored);
    if (!Array.isArray(raw)) throw new Error('Invalid queue format');
    const map = new Map();
    for (const item of raw) {
      if (!item?.projectId || !item.recordType || !item.recordId
        || item.key !== makeKey(item.projectId, item.recordType, item.recordId)
        || !['set', 'delete'].includes(item.operation)
        || map.has(item.key)) throw new Error('Invalid queue entry');
      map.set(item.key, item);
    }
    return map;
  } catch (cause) {
    throw new UnsentStorageError('read', cause);
  }
}

function persist(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(map.values())));
  } catch (cause) {
    throw new UnsentStorageError('write', cause);
  }
}

function makeKey(projectId, recordType, recordId) {
  return [projectId, recordType, recordId].map((value) => String(value || '')).join('|');
}

/** 同一案件の未送信項目パッチを失わないよう、ネストした項目も統合する。 */
function mergeProjectPatch(previous = {}, next = {}) {
  const result = { ...(previous || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeProjectPatch(result[key], value);
    } else result[key] = value;
  }
  return result;
}

export function putUnsent({
  projectId,
  environment = 'production',
  recordType,
  recordId,
  operation = 'set',
  record = null,
  meta = {}
}) {
  if (!projectId || !recordType || !recordId) throw new Error('未送信キー情報が不足しています。');
  const map = loadMap();
  const key = makeKey(projectId, recordType, recordId);
  const previous = map.get(key);
  if (previous && (previous.environment || 'production') !== environment) {
    throw new Error('未送信データの環境区分が一致しません。');
  }
  const mergedMeta = { ...(previous?.meta || {}), ...(meta || {}) };
  if (previous?.meta?.initializeChangeLog || meta?.initializeChangeLog) {
    mergedMeta.initializeChangeLog = true;
  }
  const isProjectUpdate = String(recordType) === 'project' && operation === 'set';
  const mergedRecord = isProjectUpdate && previous?.operation === 'set'
    ? mergeProjectPatch(previous.record, record)
    : record;
  if (isProjectUpdate && previous && (!previous.meta?.partialProjectMetadata || !meta?.partialProjectMetadata)) {
    mergedMeta.partialProjectMetadata = false;
  }
  // 新規案件の全項目が未送信の間に編集した項目は別途保持する。
  // 復帰時すでに案件Documentが存在する場合、初期全項目を再送せず、この差分だけ送る。
  if (isProjectUpdate && previous?.meta?.initializeChangeLog && meta?.partialProjectMetadata) {
    mergedMeta.subsequentPatch = mergeProjectPatch(previous.meta?.subsequentPatch, record);
  }
  map.set(key, {
    key,
    projectId: String(projectId),
    environment,
    recordType: String(recordType),
    recordId: String(recordId),
    operation,
    record: mergedRecord,
    meta: mergedMeta,
    queuedAt: Date.now()
  });
  persist(map);
  return map.get(key);
}

/** Compare the actual queued payload, including its environment. */
function matches(current, expected) {
  return Boolean(current && expected
    && (current.environment || 'production') === (expected.environment || 'production')
    && current.operation === expected.operation
    && JSON.stringify(current.record) === JSON.stringify(expected.record)
    && JSON.stringify(current.meta || {}) === JSON.stringify(expected.meta || {}));
}

/** Commit acknowledgement: remove only the exact entries sent, in one storage write. */
export function acknowledgeUnsentEntries(entries = []) {
  const map = loadMap();
  let removed = 0;
  for (const entry of entries) {
    const key = makeKey(entry.projectId, entry.recordType, entry.recordId);
    if (!matches(map.get(key), entry)) continue;
    map.delete(key);
    removed += 1;
  }
  if (removed) persist(map);
  return removed;
}

export function removeUnsentIfMatching(sentEntry) {
  if (!sentEntry?.projectId || !sentEntry?.recordType || !sentEntry?.recordId) return false;
  return acknowledgeUnsentEntries([sentEntry]) === 1;
}

/** Replace an already-committed project creation entry with only its later patch. */
export function replaceUnsentIfMatching(expected, replacement = null) {
  const map = loadMap();
  const key = makeKey(expected.projectId, expected.recordType, expected.recordId);
  if (!matches(map.get(key), expected)) return false;
  if (replacement) {
    map.set(key, {
      ...expected, ...replacement, key,
      projectId: expected.projectId, recordType: expected.recordType,
      recordId: expected.recordId, environment: expected.environment,
      queuedAt: Date.now()
    });
  } else map.delete(key);
  persist(map);
  return true;
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
