/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.11.1 OneDrive接続方式の修正版。v0.1.9.10確定版を基にK版の部屋ID・写真・採取場所の改善を反映。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.11.1',
  revision: '',
  mode: 'stable'
};
