/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.24 レビュー版。部屋表示共通化・未登録対象外切替・Excel住所読み仮名修正を確認する。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.24',
  revision: '',
  mode: 'review'
};
