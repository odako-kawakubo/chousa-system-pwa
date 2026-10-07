/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.38 レビュー版。正式版 v0.1.9.3 を基準に採取写真帳の場所表示を確認する。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.38',
  revision: '',
  mode: 'review'
};
