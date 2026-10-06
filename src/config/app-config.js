/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.31 レビュー版。M-07 オフライン新規案件・通信復帰時UNSENT自動収束を確認する。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.31',
  revision: '',
  mode: 'review'
};
