/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.10H レビュー版。設定シート保存修正の反映・採取場所のExcel/PDF表記統一。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.10H',
  revision: '',
  mode: 'stable'
};
