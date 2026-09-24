/**
 * src/js/ui/header-visibility.js
 *
 * 横スマホ時の通常ヘッダー表示 / 非表示を端末単位で管理する。
 * タブ固有処理や同期処理は持たず、bodyクラスと切替ボタン表示だけを担当する。
 */

const STORAGE_KEY = 'chousa-header-collapsed';
const COMPACT_QUERY = '(orientation: landscape) and (max-width: 850px) and (max-height: 500px)';

function readStoredState() {
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === '0') return false;
  if (value === '1') return true;
  return true;
}

function isCompactViewport() {
  return window.matchMedia(COMPACT_QUERY).matches;
}

function applyState(collapsed) {
  const active = isCompactViewport() && collapsed;
  document.body.classList.toggle('header-collapsed', active);

  const button = document.getElementById('headerCollapseToggle');
  if (!button) return;
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.textContent = active ? '▼' : '▲';
  const label = active ? '通常ヘッダーを表示' : '通常ヘッダーを隠す';
  button.title = label;
  button.setAttribute('aria-label', label);
}

export function initializeHeaderVisibility() {
  let collapsed = readStoredState();
  applyState(collapsed);

  const button = document.getElementById('headerCollapseToggle');
  button?.addEventListener('click', () => {
    collapsed = !collapsed;
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    applyState(collapsed);
  });

  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener?.('change', () => applyState(collapsed));
  window.addEventListener('orientationchange', () => window.setTimeout(() => applyState(collapsed), 50));
}
