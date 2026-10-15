/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.9 レビュー版。建材リスト編集時の再描画ループ抑制と部屋名表示保持。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.9',
  revision: '',
  mode: 'stable'
};
