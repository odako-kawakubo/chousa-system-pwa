/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.2 確定版。住所読み仮名修正・部屋表示共通化・未登録対象外切替・採取写真帳部屋名表記・陽性行赤表示を反映。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.2',
  revision: '',
  mode: 'stable'
};
