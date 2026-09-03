/**
 * src/js/app-init.js
 * アプリ起動時の初期化順序をまとめる入口モジュール。
 */
import { applyAppVersionDisplay } from './app-version.js';
import { bindAppUpdateEvents } from './app-update.js';
import { initializePwa } from './pwa/pwa-controller.js';
import { showTab, bindTabEvents } from './ui/tabs.js';
import { bindDrawerEvents } from './ui/drawer.js';
import { bindProjectPanelEvents } from './ui/project-panel.js';
import { initializeProjectManagement, captureInitialProjectSession } from './projects/project-controller.js';
import { initializeProjectEntryUi } from './projects/project-entry-ui.js';
import { initializeFirestoreProjectBrowser } from './projects/firestore-project-browser.js';
import { initializeOneDriveProjectBrowser } from './projects/onedrive-project-browser.js';
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
import { initializeOneDriveConnection } from './onedrive/onedrive-connection.js';
import { initializeOneDriveProjectIntegration } from './onedrive/onedrive-project.js';
import { initializeHome } from './home/home-controller.js';

function initUiSkeleton() {
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

  // モーダル内部DOMを先に確定してから、汎用開閉イベントを配線する。
  initializeProjectEntryUi();
  bindModalEvents();

  // サンプルはSnapshotだけ準備し、起動案件にはしない。
  initializeSampleProjectSnapshot();

  initializeProjectManagement();
  initializeFirestoreProjectBrowser();
  initializeOneDriveProjectBrowser();
  initializeProjectTransfer();
  bindAppUpdateEvents();
  bindAuthUiEvents();

  // OneDrive接続状態を先に開始し、トップ・設定・案件連携が同じ状態を参照する。
  initializeOneDriveConnection();
  initializeOneDriveProjectIntegration();

  initializeFinishTable();
  initializeMaterialList();
  initializeMaterialOperations();
  initializeRecordView();
  initializePhotoTab();
  initializeSettingsTab();
  captureInitialProjectSession();
  initializeHome();

  window.addEventListener('pagehide', captureInitialProjectSession);
  showTab('finish');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUiSkeleton, { once: true });
} else {
  initUiSkeleton();
}
