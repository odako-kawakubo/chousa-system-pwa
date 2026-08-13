/**
 * src/js/app-init.js
 *
 * アプリ起動時の初期化順序をまとめる入口モジュール。
 * バージョン表示、タブ、ドロワー、案件パネル、モーダル、更新機能、認証UI、
 * 仕上表、レコード確認UIを順に初期化し、最後に仕上表タブを表示する。
 *
 * 業務データの保存・同期そのものは各担当モジュールへ分離し、ここでは行わない。
 */

import { applyAppVersionDisplay } from './app-version.js';
import { bindAppUpdateEvents } from './app-update.js';
import { showTab, bindTabEvents } from './ui/tabs.js';
import { bindDrawerEvents } from './ui/drawer.js';
import { bindProjectPanelEvents } from './ui/project-panel.js';
import { bindModalEvents } from './ui/modal.js';
import { bindAuthUiEvents } from './ui/auth-ui.js';
import { initializeFinishTable } from './finish-table/finish-table-controller.js';
import { initializeRecordView } from './record-view/record-view-controller.js';


/**
 * UI骨格の起動処理。
 *
 * 手順：
 * 1. 各UIモジュールのイベントを配線する
 * 2. 起動時に表示するタブ（仕上表）を表示する
 *
 * 注意：
 * ・ここでは画面表示の準備だけを行う。案件データの読込や保存は行わない。
 */
function initUiSkeleton() {
  applyAppVersionDisplay();
  bindTabEvents();
  bindDrawerEvents();
  bindProjectPanelEvents();
  bindModalEvents();
  bindAppUpdateEvents();
  bindAuthUiEvents();
  initializeFinishTable();
  initializeRecordView();

  // 起動時は仕上表タブを既定表示する。
  showTab('finish');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUiSkeleton, { once: true });
} else {
  initUiSkeleton();
}
