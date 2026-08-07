/**
 * src/js/app-init.js
 *
 * このファイルの役割：
 *   本開発版の起動処理。各UIモジュール（タブ・ドロワー・案件パネル・
 *   モーダル・認証UI）へのイベント配線と、最初に表示するタブの指定だけを行う。
 *
 * どこから呼ばれるか：
 *   src/app.html の末尾から type="module" で読み込まれ、
 *   DOMContentLoaded のタイミングで自動的に実行される。
 *
 * 何を取得しているか：
 *   何も取得しない（各UIモジュール側がDOM要素を取得する）。
 *
 * 何を判定しているか：
 *   何も判定しない。案件データ・仕上表データはこの時点でまだ存在しないため。
 *   ログイン中かどうかの判定は src/js/ui/auth-ui.js 側の責務。
 *
 * どこへ書き込んでいるか：
 *   どこにも書き込まない。イベントを登録するだけ。
 *
 * どの処理とは分離しているか：
 *   ・案件の読込・状態の初期化（v0.2.0以降で追加予定の app-state.js）
 *   ・仕上表・建材リスト・写真タブの描画処理（v0.3.0以降で追加予定）
 *   ・ローカル保存／Firestore同期／OneDrive連携（v0.8〜v0.10で追加予定）
 *   これらはこのファイルには一切含まれていない。
 *   認証処理の中身（ログイン・ログアウト・トークン取得）は
 *   src/js/auth/microsoft-auth.js が持ち、ここでは呼び出すだけ。
 *
 * 今回の変更：
 *   1. タブ・ドロワー・案件パネル・モーダルのイベント配線のみ実装
 *   2. 起動時に仕上表タブをデフォルト表示
 *   3. 保存・状態管理・外部通信は未実装（意図的に何も行わない）
 *   4.（リポジトリ整理時に追加）認証UI（src/js/ui/auth-ui.js）の
 *      イベント配線を追加。既存のタブ・ドロワー・案件パネル・モーダルの
 *      初期化順序は変更していない。
 *
 * 動作確認手順：
 *   1. src/app.html をブラウザで開く
 *   2. 仕上表タブが最初から表示されていることを確認する
 *   3. 各タブ（建材リスト／写真／調査図／同期／設定／レコード）を
 *      クリックし、中身は空でも枠とタイトルが切り替わることを確認する
 *   4. ヘッダーの「案件」ボタンで案件選択パネルが左から開閉することを確認する
 *   5. 「操作」ボタンでドロワーが右から開閉することを確認する
 *   6. 案件選択パネル内の「既存案件を開く」ボタンでモーダルが開閉することを確認する
 *   7. ヘッダーの「Microsoftログイン」でログインし、ユーザー名と
 *      Graphトークン取得状態が表示されることを確認する
 *   8. 「ログアウト」で未ログイン表示へ戻ることを確認する
 *   9. 再読み込み後もログイン状態が維持されることを確認する
 *   10. ブラウザのコンソールに致命的エラーが出ていないことを確認する
 */

import { showTab, bindTabEvents } from './ui/tabs.js';
import { bindDrawerEvents } from './ui/drawer.js';
import { bindProjectPanelEvents } from './ui/project-panel.js';
import { bindModalEvents } from './ui/modal.js';
import { bindAuthUiEvents } from './ui/auth-ui.js';
import { initializeFinishTable } from './finish-table/finish-table-controller.js';

/**
 * UI骨格の起動処理。
 *
 * 手順：
 * 1. 各UIモジュールのイベントを配線する
 * 2. 起動時に表示するタブ（仕上表）を表示する
 *
 * 注意：
 * ・ここでは画面表示の準備だけを行う。案件データの読込や保存は行わない。
 */
function initUiSkeleton() {
  bindTabEvents();
  bindDrawerEvents();
  bindProjectPanelEvents();
  bindModalEvents();
  bindAuthUiEvents();
  initializeFinishTable();

  // 起動時は仕上表タブを表示する（v0.15.10と同じ既定タブ）
  showTab('finish');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUiSkeleton, { once: true });
} else {
  initUiSkeleton();
}
