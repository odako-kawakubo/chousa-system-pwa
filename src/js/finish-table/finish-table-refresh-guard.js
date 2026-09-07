/**
 * src/js/finish-table/finish-table-refresh-guard.js
 *
 * 外部同期など「仕上表自身の操作ではない理由」から再描画を要求された時、
 * 文字入力中のDOMを差し替えないためのガード。
 *
 * 重要:
 * - Store更新・Firestore送受信は止めない。
 * - 保留するのは仕上表DOMの再描画だけ。
 * - 編集終了後、最新Storeを使う再描画を1回だけ実行する。
 * - 仕上表セル、部屋No./部屋名、簡易リストの調査備考を同じ編集状態として扱う。
 */

const EDITOR_SELECTOR = [
  '.finish-cell-input',
  '.room-no-input',
  '.room-name-input',
  '[data-simple-note-input]'
].join(',');

let pendingRefresh = null;
let eventsBound = false;

function activeFinishEditor() {
  const active = document.activeElement;
  if (!(active instanceof Element)) return null;
  if (!active.closest('#finish')) return null;
  return active.matches(EDITOR_SELECTOR) ? active : null;
}

function flushPendingRefreshIfReady() {
  if (!pendingRefresh || activeFinishEditor()) return false;
  const refresh = pendingRefresh;
  pendingRefresh = null;
  refresh();
  return true;
}

function bindEditCompletionWatcher() {
  if (eventsBound) return;
  eventsBound = true;

  // focusout直後は次のinputへfocusが移る途中の場合があるため、
  // 1 microtask待ってから「仕上表の入力が本当に終わったか」を判定する。
  document.addEventListener('focusout', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('#finish')) return;
    if (!event.target.matches(EDITOR_SELECTOR)) return;
    queueMicrotask(flushPendingRefreshIfReady);
  });
}

/**
 * 外部要因による仕上表再描画を要求する。
 * 入力中なら同じ要求を積み上げず、最新Storeから描画する1回分だけを保留する。
 *
 * @param {() => void} refresh
 * @returns {'rendered'|'deferred'}
 */
export function requestFinishTableExternalRefresh(refresh) {
  if (typeof refresh !== 'function') return 'rendered';
  bindEditCompletionWatcher();

  if (activeFinishEditor()) {
    pendingRefresh = refresh;
    return 'deferred';
  }

  pendingRefresh = null;
  refresh();
  return 'rendered';
}

/** 案件切替など、保留中の旧案件描画要求を破棄したい時に使う。 */
export function resetFinishTableExternalRefresh() {
  pendingRefresh = null;
}
