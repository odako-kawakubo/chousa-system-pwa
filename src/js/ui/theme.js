/**
 * src/js/ui/theme.js
 *
 * v0.1.5.7C: 端末単位のダークモードON/OFFを管理する。
 * - 案件データとは分離し、localStorageへ端末設定として保存する。
 * - テーマ変更は <html data-theme="dark"> の付け外しだけを担当する。
 * - 建材24色、電子看板、カメラ、PhotoViewer等の業務固定色はCSS側でテーマ対象外とする。
 */

const STORAGE_KEY = 'chousa-dark-mode';

function readStoredEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function writeStoredEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch (_) {
    // localStorageが利用できない環境でも、そのセッション中の表示切替は継続する。
  }
}

function applyTheme(enabled) {
  const root = document.documentElement;
  if (enabled) {
    root.dataset.theme = 'dark';
  } else {
    root.dataset.theme = 'light';
  }
}

export function initializeTheme() {
  applyTheme(readStoredEnabled());
}

export function isDarkModeEnabled() {
  return document.documentElement.dataset.theme === 'dark';
}

export function setDarkModeEnabled(enabled) {
  const next = Boolean(enabled);
  applyTheme(next);
  writeStoredEnabled(next);
}

export function toggleDarkMode() {
  const next = !isDarkModeEnabled();
  setDarkModeEnabled(next);
  return next;
}

function syncThemeToggleButton() {
  const button = document.getElementById('drawerDarkModeToggle');
  if (!button) return;
  const enabled = isDarkModeEnabled();
  button.textContent = enabled ? 'ON' : 'OFF';
  button.classList.toggle('active', enabled);
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

/** 操作パネル内のダークモード切替だけを配線する。 */
export function bindThemeControls() {
  const button = document.getElementById('drawerDarkModeToggle');
  if (!button) return;
  syncThemeToggleButton();
  button.addEventListener('click', () => {
    toggleDarkMode();
    syncThemeToggleButton();
  });
}
