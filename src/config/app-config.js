/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.28 レビュー版。M-04 fieldEditedAtによる項目単位競合マージを確認する。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.28',
  revision: '',
  mode: 'review'
};
