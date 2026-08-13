/**
 * src/js/record-view/record-view-controller.js
 *
 * レコード確認タブのイベント配線を担当する。
 * ・建材 / 仕上表 / 写真 のサブタブ切替
 * ・「再表示」ボタン
 * ・上部の「レコード」タブを開いたときの最新Store再読込
 *
 * 確認画面なので、ここからStoreを書き換える操作は行わない。
 */

import { buildRecordView, RECORD_VIEW_TABS } from './record-view-view-model.js';
import { renderRecordView } from './record-view-renderer.js';

let activeRecordViewTab = RECORD_VIEW_TABS.MATERIAL;

/** 現在選択中のサブタブをStoreから読み直して再描画する。 */
export function refreshRecordView() {
  renderRecordView(buildRecordView(activeRecordViewTab));
}

function selectRecordViewTab(tabId) {
  activeRecordViewTab = Object.values(RECORD_VIEW_TABS).includes(tabId)
    ? tabId
    : RECORD_VIEW_TABS.MATERIAL;
  refreshRecordView();
}

/** レコード確認UIのイベントを1回だけ配線する。 */
export function initializeRecordView() {
  document.querySelectorAll('[data-record-view-tab]').forEach((button) => {
    button.addEventListener('click', () => selectRecordViewTab(button.dataset.recordViewTab));
  });

  document.getElementById('recordViewRefreshButton')?.addEventListener('click', refreshRecordView);

  // 上部タブから「レコード」を開くたび、現在のStore内容を読み直す。
  document.querySelector('.tabs .tab[data-tab="records"]')?.addEventListener('click', refreshRecordView);

  // 初期DOMを空のままにしない。レコードタブ自体は非表示なので起動時コストは小さい。
  refreshRecordView();
}
