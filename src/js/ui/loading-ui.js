/**
 * アプリ全体で共通利用する待機オーバーレイ。
 * 長い処理だけを表示するため、既定では250ms遅延してから表示する。
 * 呼び出し元ごとにtokenを持ち、別処理のhideで先に消えないようにする。
 */
const DEFAULT_DELAY_MS = 250;
const active = new Map();
let sequence = 0;

function ensureStyle() {
  if (document.getElementById('globalLoadingStyle')) return;
  const style = document.createElement('style');
  style.id = 'globalLoadingStyle';
  style.textContent = `
    .global-loading-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      background: var(--overlay-modal, rgba(15, 23, 42, .28));
      padding: 24px;
    }
    .global-loading-overlay[hidden] { display: none; }
    .global-loading-card {
      min-width: min(320px, calc(100vw - 48px));
      max-width: 460px;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 20px;
      border: 1px solid var(--line, #d6dce8);
      border-radius: 14px;
      background: var(--panel, #fff);
      color: var(--text, #1f2937);
      box-shadow: 0 16px 42px var(--shadow-dialog, rgba(15, 23, 42, .25));
      font-weight: 700;
    }
    .global-loading-spinner {
      width: 24px;
      height: 24px;
      flex: 0 0 24px;
      border: 3px solid var(--line-strong, #cbd5e1);
      border-top-color: var(--main, #2563eb);
      border-radius: 50%;
      animation: global-loading-spin .8s linear infinite;
    }
    .global-loading-message { line-height: 1.5; }
    @keyframes global-loading-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}

function ensureOverlay() {
  ensureStyle();
  let overlay = document.getElementById('globalLoadingOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'globalLoadingOverlay';
  overlay.className = 'global-loading-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="global-loading-card" role="status" aria-live="polite" aria-busy="true">
      <span class="global-loading-spinner" aria-hidden="true"></span>
      <div class="global-loading-message" data-global-loading-message>処理中です…</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function latestEntry() {
  const entries = Array.from(active.values());
  return entries[entries.length - 1] || null;
}

function render() {
  const overlay = ensureOverlay();
  const entry = latestEntry();
  const message = overlay.querySelector('[data-global-loading-message]');

  if (!entry) {
    overlay.hidden = true;
    return;
  }

  if (message) message.textContent = entry.message;
  overlay.hidden = !entry.visible;
}

export function beginLoading(message = '処理中です…', { delay = DEFAULT_DELAY_MS } = {}) {
  const token = `loading-${Date.now()}-${++sequence}`;
  const entry = {
    message: String(message || '処理中です…'),
    visible: delay <= 0,
    timer: null
  };

  active.set(token, entry);
  if (delay > 0) {
    entry.timer = setTimeout(() => {
      const current = active.get(token);
      if (!current) return;
      current.visible = true;
      render();
    }, delay);
  }
  render();
  return token;
}

export function updateLoading(token, message) {
  const entry = active.get(token);
  if (!entry) return;
  entry.message = String(message || '処理中です…');
  render();
}

export function endLoading(token) {
  const entry = active.get(token);
  if (entry?.timer) clearTimeout(entry.timer);
  active.delete(token);
  render();
}

export async function withLoading(message, task, options = {}) {
  const token = beginLoading(message, options);
  try {
    return await task(token);
  } finally {
    endLoading(token);
  }
}
