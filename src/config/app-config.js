/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * 正式版では revision を空文字、mode を stable とする。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.7.3',
  revision: 'r4',
  mode: 'review'
};
