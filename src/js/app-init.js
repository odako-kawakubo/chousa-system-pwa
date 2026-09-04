/**
 * src/js/app-init.js
 * 案件画面(app.html)専用の初期化入口。
 * 独立トップ(index.html)で選択された projectId が無い場合はトップへ戻す。
 * 案件画面内の案件サイドパネルはトップと重複する作業中導線として維持する。
 */
import { applyAppVersionDisplay } from './app-version.js';
import { bindAppUpdateEvents } from './app-update.js';
import { initializePwa } from './pwa/pwa-controller.js';
import { showTab, bindTabEvents } from './ui/tabs.js';
import { bindDrawerEvents } from './ui/drawer.js';
import { bindProjectPanelEvents } from './ui/project-panel.js';
import { beginLoading, endLoading } from './ui/loading-ui.js';
import { initializeProjectManagement, captureInitialProjectSession, openProjectById } from './projects/project-controller.js';
import { initializeProjectSidePanelController } from './projects/project-side-panel-controller.js';
import { initializeProjectEntryUi } from './projects/project-entry-ui.js';
import { initializeFirestoreProjectBrowser } from './projects/firestore-project-browser.js';
import { initializeOneDriveProjectBrowser } from './projects/onedrive-project-browser.js';
import { initializeProjectTransfer } from './projects/project-transfer.js';
import { getOpenProjectId, openHomePage } from './projects/project-navigation.js';
import { getProject } from './projects/project-store.js';
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
import { ensureHomeReturnControl } from './home/home-return-control.js';

async function initProjectApp() {
  const projectId = getOpenProjectId();
  if (!projectId) {
    openHomePage({ replace: true });
    return;
  }

  const loadingToken = beginLoading('起動しています…', { delay: 0 });
  try {
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

    initializeProjectEntryUi();
    bindModalEvents();

    initializeSampleProjectSnapshot();
    initializeProjectManagement();
    initializeProjectSidePanelController();
    initializeFirestoreProjectBrowser();
    initializeOneDriveProjectBrowser();
    initializeProjectTransfer();
    bindAppUpdateEvents();
    bindAuthUiEvents();

    initializeOneDriveConnection();
    initializeOneDriveProjectIntegration();

    initializeFinishTable();
    initializeMaterialList();
    initializeMaterialOperations();
    initializeRecordView();
    initializePhotoTab();
    initializeSettingsTab();

    ensureHomeReturnControl();
    showTab('finish');

    if (!getProject(projectId)) {
      openHomePage({ replace: true });
      return;
    }

    await openProjectById(projectId);
    window.addEventListener('pagehide', captureInitialProjectSession);
  } finally {
    endLoading(loadingToken);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initProjectApp(), { once: true });
} else {
  void initProjectApp();
}
