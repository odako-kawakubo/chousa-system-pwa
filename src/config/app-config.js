/**
 * アプリ全体で共有する基本設定。
 * version は利用者へ表示する版、revision は同一version内の更新判定に使う。
 * HTMLへ番号を直書きしない。
 * v0.1.9.7 確定版。旧識別処理を整理し、出力帳票の数字を半角へ統一。
 */
export const appConfig = {
  appName: '調査システムPWA',
  version: '0.1.9.7',
  revision: '',
  mode: 'stable'
};
