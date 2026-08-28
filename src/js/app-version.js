/**
 * src/js/app-version.js
 *
 * アプリのバージョン表示を app-config.js の値へ統一する。
 * HTMLへバージョン番号を直書きせず、表示箇所はすべてこのモジュールから更新する。
 */

import { appConfig } from '../config/app-config.js';

/**
 * 現在実行中のアプリバージョンを画面へ反映する。
 */
export function applyAppVersionDisplay() {
  const version = appConfig.version;
  const versionText = `v${version}`;

  document.title = `${appConfig.appName} ${versionText}`;

  const textTargets = {
    headerVersion: versionText,
    drawerMaintenanceVersion: versionText,
    settingsVersionValue: versionText
  };

  Object.entries(textTargets).forEach(([id, text]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  });
}
