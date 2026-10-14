/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.6 確定版。その他1/2の写真識別をViewer・比較・看板編集まで統一し、建材No採番を補強。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.6',
  revision: '',
  mode: 'stable'
};
