/**
 * v0.1.6.2H.log 同期診断ログ。
 * 読み取り/書き込みそのものの正確な課金件数ではなく、アプリが何を何回実行したかを追跡する。
 * 直近800件だけlocalStorageへ保持し、設定 > 同期から確認/コピーできる。
 */

const STORAGE_KEY = 'chousa-sync-debug-log-v0162hlog';
const MAX_ENTRIES = 800;
const listeners = new Set();

function safeParse() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let entries = safeParse();
let seq = entries.reduce((max, item) => Math.max(max, Number(item?.seq || 0)), 0);

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // 診断ログ保存失敗で本体処理を止めない。
  }
}

function emit() {
  listeners.forEach((callback) => {
    try { callback(getHLogEntries()); } catch { /* no-op */ }
  });
}

function normalizeDetail(detail) {
  if (detail == null) return null;
  if (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean') return detail;
  try {
    return JSON.parse(JSON.stringify(detail, (_key, value) => {
      if (typeof value === 'function') return undefined;
      if (value && typeof value.toMillis === 'function') return { timestampMs: value.toMillis() };
      return value;
    }));
  } catch {
    return String(detail);
  }
}

export function hlog(event, detail = null) {
  const entry = {
    seq: ++seq,
    at: new Date().toISOString(),
    event: String(event || 'UNKNOWN'),
    detail: normalizeDetail(detail)
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persist();
  emit();
  // DevToolsでも同じ内容を追えるようにする。
  console.info(`[H.log #${entry.seq}] ${entry.event}`, entry.detail ?? '');
  return entry;
}

export function getHLogEntries() {
  return entries.map((item) => ({ ...item }));
}

export function clearHLog() {
  entries = [];
  persist();
  emit();
  console.info('[H.log] cleared');
}

export function formatHLog() {
  return entries.map((item) => {
    const detail = item.detail == null ? '' : ` ${JSON.stringify(item.detail)}`;
    return `${String(item.seq).padStart(4, '0')} ${item.at} ${item.event}${detail}`;
  }).join('\n');
}

export function subscribeHLog(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// コンソールから window.HLOG.text() / clear() でも確認できる。
if (typeof window !== 'undefined') {
  window.HLOG = {
    entries: getHLogEntries,
    text: formatHLog,
    clear: clearHLog
  };
}
