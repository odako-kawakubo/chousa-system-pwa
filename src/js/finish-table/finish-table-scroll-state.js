/**
 * src/js/finish-table/finish-table-scroll-state.js
 *
 * 仕上表タブのスクロール位置だけを保持するUI状態モジュール。
 * 業務Record・Firestore同期・仕上表選択状態は扱わない。
 *
 * 方針:
 * - #finishTableScroll の scrollTop / scrollLeft をスクロール中に記録する。
 * - 他タブへ移動しても値を保持する。
 * - 仕上表タブへ戻った時、同じ位置へ復元する。
 * - 案件切替時は旧案件の位置を引き継がない。
 * - DOMの再取得時は旧hostのscroll listenerを外し、常に1本だけ保持する。
 */

let scrollTop = 0;
let scrollLeft = 0;
let boundHost = null;
let tabEventBound = false;

function currentHost() {
  return document.getElementById('finishTableScroll');
}

function rememberFromHost(host = currentHost()) {
  if (!host) return;
  scrollTop = Number(host.scrollTop || 0);
  scrollLeft = Number(host.scrollLeft || 0);
}

function handleHostScroll(event) {
  rememberFromHost(event.currentTarget);
}

function unbindHostScroll() {
  if (!boundHost) return;
  boundHost.removeEventListener('scroll', handleHostScroll);
  boundHost = null;
}

function bindHostScroll() {
  const host = currentHost();
  if (!host) {
    unbindHostScroll();
    return;
  }
  if (host === boundHost) return;

  unbindHostScroll();
  boundHost = host;
  boundHost.addEventListener('scroll', handleHostScroll, { passive: true });
}

function restoreToHost() {
  bindHostScroll();
  const host = currentHost();
  if (!host) return;

  // タブ表示切替後のlayout確定を待ってから復元する。
  requestAnimationFrame(() => {
    bindHostScroll();
    const liveHost = currentHost();
    if (!liveHost) return;
    liveHost.scrollTop = scrollTop;
    liveHost.scrollLeft = scrollLeft;
  });
}

function bindTabChange() {
  if (tabEventBound) return;
  tabEventBound = true;

  window.addEventListener('chousa:tab-change', (event) => {
    const previousTab = String(event.detail?.previousTab || '');
    const currentTab = String(event.detail?.currentTab || '');

    if (previousTab === 'finish') rememberFromHost();
    if (currentTab === 'finish') restoreToHost();
  });
}

/** 案件画面の初期化時に1回呼ぶ。 */
export function initializeFinishTableScrollState() {
  bindTabChange();
  bindHostScroll();
}

/** 案件切替時に旧案件のスクロール位置を破棄する。 */
export function resetFinishTableScrollState() {
  scrollTop = 0;
  scrollLeft = 0;
  unbindHostScroll();
  bindHostScroll();
}

/** 外部再描画後など、現在のDOMへ明示的に復元したい場合の公開入口。 */
export function restoreFinishTableScrollState() {
  restoreToHost();
}
