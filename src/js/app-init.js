/**
 * src/js/app-init.js
 *
 * アプリ起動時の初期化順序をまとめる入口モジュール。
 * 業務データの保存・同期そのものは各担当モジュールへ分離し、ここでは行わない。
 */

import { applyAppVersionDisplay } from './app-version.js';
import { bindAppUpdateEvents } from './app-update.js';
import { initializePwa } from './pwa/pwa-controller.js';
import { showTab, bindTabEvents } from './ui/tabs.js';
import { bindDrawerEvents } from './ui/drawer.js';
import { bindProjectPanelEvents } from './ui/project-panel.js';
import { initializeProjectManagement, captureInitialProjectSession } from './projects/project-controller.js';
import { initializeFirestoreProjectBrowser } from './projects/firestore-project-browser.js';
import { initializeProjectTransfer } from './projects/project-transfer.js';
import { bindModalEvents } from './ui/modal.js';
import { bindAuthUiEvents } from './ui/auth-ui.js';
import { initializeFinishTable } from './finish-table/finish-table-controller.js';
import { initializeRecordView } from './record-view/record-view-controller.js';
import { initializeMaterialList } from './materials/material-list-controller.js';
import { initializeMaterialOperations } from './materials/material-operations-controller.js';
import { initializePhotoTab } from './photos/photo-controller.js';
import { initializeSettingsTab } from './settings/settings-controller.js';
import { initializeTheme, bindThemeControls } from './ui/theme.js';
import { bindSyncStatusUi } from './ui/sync-ui.js';
import { bindDeviceUi } from './ui/device-ui.js';
import { bindHeaderEditUi } from './ui/header-edit-ui.js';
import { initializeDeviceIdentity } from './device-code.js';
import { initializeNetworkStatusEvents } from './sync/sync-status.js';
import { initializeSampleProjectSnapshot } from './demo/sample-session.js';
import { initializeOneDriveProjectIntegration } from './onedrive/onedrive-project.js';

function initUiSkeleton() {
  // SW登録は通常UIの初期化を待たせない。圏外cold start時は前回activeになったSWが起動資産を供給する。
  void initializePwa();

  initializeTheme();
  initializeDeviceIdentity();
  applyAppVersionDisplay();
  initializeNetworkStatusEvents();
  bindSyncStatusUi();
  bindDeviceUi();
  bindHeaderEditUi();
  bindTabEvents();
  bindDrawerEvents();
  bindThemeControls();
  bindProjectPanelEvents();
  bindModalEvents();

  // 公式サンプル案件の3レコードはこの入口で一度だけ組み立てる。
  initializeSampleProjectSnapshot();

  initializeProjectManagement();
  initializeFirestoreProjectBrowser();
  initializeProjectTransfer();
  bindAppUpdateEvents();
  bindAuthUiEvents();
  initializeOneDriveProjectIntegration();
  initializeFinishTable();
  initializeMaterialList();
  initializeMaterialOperations();
  initializeRecordView();
  initializePhotoTab();
  initializeSettingsTab();
  captureInitialProjectSession();

  window.addEventListener('pagehide', captureInitialProjectSession);
  showTab('finish');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUiSkeleton, { once: true });
} else {
  initUiSkeleton();
}
