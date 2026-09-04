/**
 * 独立トップ(index.html)専用の初期化入口。
 * 仕上表・建材・写真など案件画面の機能は読み込まない。
 */
import { initializePwa } from '../pwa/pwa-controller.js';
import { bindAppUpdateEvents } from '../app-update.js';
import { initializeDeviceIdentity } from '../device-code.js';
import { initializeNetworkStatusEvents } from '../sync/sync-status.js';
import { initializeSampleProjectSnapshot } from '../demo/sample-session.js';
import { initializeProjectEntryUi } from '../projects/project-entry-ui.js';
import { initializeFirestoreProjectBrowser } from '../projects/firestore-project-browser.js';
import { initializeOneDriveProjectBrowser } from '../projects/onedrive-project-browser.js';
import { bindModalEvents } from '../ui/modal.js';
import { bindAuthUiEvents } from '../ui/auth-ui.js';
import { initializeOneDriveConnection } from '../onedrive/onedrive-connection.js';
import { initializeHome } from './home-controller.js';

function initHome() {
  void initializePwa();
  bindAppUpdateEvents();
  initializeDeviceIdentity();
  initializeNetworkStatusEvents();
  initializeSampleProjectSnapshot();

  initializeProjectEntryUi();
  bindModalEvents();
  initializeFirestoreProjectBrowser();
  initializeOneDriveProjectBrowser();

  bindAuthUiEvents();
  initializeOneDriveConnection();
  initializeHome();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHome, { once: true });
} else {
  initHome();
}
