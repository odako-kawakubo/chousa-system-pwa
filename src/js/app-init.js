/**
 * src/js/app-init.js
 *
 * アプリ起動時の初期化順序をまとめる入口モジュール。
 * バージョン表示、タブ、ドロワー、案件パネル、モーダル、更新機能、認証UI、
 * 仕上表、photoRecord基盤、写真タブ、レコード確認UIを順に初期化し、最後に仕上表タブを表示する。
 *
 * 業務データの保存・同期そのものは各担当モジュールへ分離し、ここでは行わない。
 */

import { applyAppVersionDisplay } from './app-version.js';
import { bindAppUpdateEvents } from './app-update.js';
import { showTab, bindTabEvents } from './ui/tabs.js';
import { bindDrawerEvents } from './ui/drawer.js';
import { bindProjectPanelEvents } from './ui/project-panel.js';
import { initializeProjectManagement, captureInitialProjectSession } from './projects/project-controller.js';
import { bindModalEvents } from './ui/modal.js';
import { bindAuthUiEvents } from './ui/auth-ui.js';
import { initializeFinishTable } from './finish-table/finish-table-controller.js';
import { initializeRecordView } from './record-view/record-view-controller.js';
import { initializeMaterialList } from './materials/material-list-controller.js';
import { initializeMaterialOperations } from './materials/material-operations-controller.js';
import { initializePhotoTab } from './photos/photo-controller.js';
import * as photoRecordStore from './store/photo-record-store.js';
import { seedInitialPhotoRecords } from './demo/sample-photos.js';
import { initializeSettingsTab } from './settings/settings-controller.js';
import { initializeTheme, bindThemeControls } from './ui/theme.js';
import { bindSyncStatusUi } from './ui/sync-ui.js';
import { bindDeviceUi } from './ui/device-ui.js';
import { initializeDeviceIdentity } from './device-code.js';
import { initializeNetworkStatusEvents } from './sync/sync-status.js';


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
  // 端末保存済みのテーマを最初に適用し、各タブ描画時の色を揃える。
  initializeTheme();
  initializeDeviceIdentity();
  applyAppVersionDisplay();
  initializeNetworkStatusEvents();
  bindSyncStatusUi();
  bindDeviceUi();
  bindTabEvents();
  bindDrawerEvents();
  bindThemeControls();
  bindProjectPanelEvents();
  bindModalEvents();
  initializeProjectManagement();
  bindAppUpdateEvents();
  bindAuthUiEvents();
  initializeFinishTable();
  initializeMaterialList();
  initializeMaterialOperations();

  // v0.1.5.3D: 写真タブD版UI・PhotoViewer・photoRecordStore接続を確認するため、
  // レコード確認UI・写真タブ共通の最小サンプルをローカルStoreへ投入する。
  photoRecordStore.clearAll();
  seedInitialPhotoRecords();

  initializeRecordView();
  initializePhotoTab();
  initializeSettingsTab();

  // finish/material/photoのデモ初期投入がすべて終わった時点で、
  // サンプル案件の完全スナップショットを案件一覧Storeへ登録する。
  captureInitialProjectSession();

  // ページ離脱時も現在案件のローカル確認用スナップショットを退避する。
  window.addEventListener('pagehide', captureInitialProjectSession);

  // 起動時は仕上表タブを既定表示する。
  showTab('finish');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUiSkeleton, { once: true });
} else {
  initUiSkeleton();
}
