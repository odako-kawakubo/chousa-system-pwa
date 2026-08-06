/**
 * src/js/ui/auth-ui.js
 *
 * このファイルの役割：
 *   ヘッダー上のMicrosoftログインボタン・ログインユーザー名表示・
 *   Graphアクセストークン取得状態表示の「配線」だけを行う。
 *   ログイン処理そのもの（Firebase Authentication／Microsoft Graph）は
 *   src/js/auth/microsoft-auth.js が持ち、このファイルでは書き直さない。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js から bindAuthUiEvents() が呼ばれる。
 *
 * 何を取得しているか：
 *   #msAuthBtn（ログイン／ログアウトボタン）、#msPill（ログインユーザー名表示）、
 *   #graphTokenPill（Graphアクセストークン取得状態表示）
 *
 * 何を判定しているか：
 *   ・現在ログイン中かどうか（Firebase Authenticationのユーザー有無）
 *   ・Graphアクセストークンをsrc/js/auth/microsoft-auth.jsから取得できているか
 *
 * どこへ描画しているか：
 *   #msAuthBtn のボタン文言、#msPill のテキストとクラス、
 *   #graphTokenPill のテキストとクラスのみ。ヘッダーの他の表示
 *   （案件名・バージョン・同期状態・端末名）やタブ・ドロワー・案件パネルには
 *   一切手を加えない。
 *
 * 保存・外部通信について：
 *   Firestoreへの保存やSharePoint／Graphへの通信はここでは一切行わない。
 *   ログイン・ログアウト・トークン取得は、すべてsrc/js/auth/microsoft-auth.js
 *   （Firebase Authentication経由のMicrosoftログイン）に委譲するだけ。
 */

import {
  loginWithMicrosoft,
  logoutMicrosoft,
  watchAuthState,
  getGraphAccessToken
} from "../auth/microsoft-auth.js";

let currentUser = null;

/**
 * ログイン状態とGraphトークン取得状態を画面へ反映する。
 *
 * 手順：
 * 1. 引数のuserを現在のログインユーザーとして保持する
 * 2. Graphアクセストークンの有無を取得する
 * 3. #msPill・#msAuthBtn・#graphTokenPillの表示を更新する
 *
 * @param {import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js").User|null} user
 */
function renderAuthState(user) {
  currentUser = user;

  const authButton = document.getElementById("msAuthBtn");
  const accountPill = document.getElementById("msPill");
  const graphPill = document.getElementById("graphTokenPill");
  if (!authButton || !accountPill || !graphPill) return;

  const graphTokenExists = Boolean(getGraphAccessToken());

  if (user) {
    const displayName = user.displayName || user.email || "Microsoftログイン済み";

    accountPill.textContent = displayName;
    accountPill.className = "pill header-account ok";
    authButton.textContent = "ログアウト";

    // Graphトークンがまだ取得できていない場合は、ログイン済みでも注意表示にする。
    graphPill.textContent = graphTokenExists
      ? "Graphトークン：取得済み"
      : "Graphトークン：未取得";
    graphPill.className = graphTokenExists
      ? "pill header-graph-state ok"
      : "pill header-graph-state warn";
    return;
  }

  accountPill.textContent = "未ログイン";
  accountPill.className = "pill header-account";
  authButton.textContent = "Microsoftログイン";

  graphPill.textContent = "Graphトークン：未取得";
  graphPill.className = "pill header-graph-state";
}

/**
 * ログイン／ログアウトボタンのクリック処理。
 *
 * 注意：
 * ・ログアウト時はonAuthStateChangedの通知を待たず、即座に未ログイン表示へ戻す。
 * ・ログイン時はGraphトークンをsessionStorageへ保存し終えてから再描画することで、
 *   「ログイン済みだがトークン未取得」の表示が一瞬だけ出る競合を防ぐ。
 */
async function handleAuthButtonClick() {
  const authButton = document.getElementById("msAuthBtn");
  if (!authButton) return;

  authButton.disabled = true;
  try {
    if (currentUser) {
      await logoutMicrosoft();
      renderAuthState(null);
    } else {
      const user = await loginWithMicrosoft();
      renderAuthState(user);
    }
  } catch (error) {
    console.error("Microsoft認証に失敗しました。", error);
    alert(`Microsoft認証に失敗しました。\n${error?.message || error}`);
  } finally {
    authButton.disabled = false;
  }
}

/**
 * 認証UIのイベント配線と、Firebase Authenticationのログイン状態監視を開始する。
 *
 * 手順：
 * 1. #msAuthBtn へクリックイベントを設定する
 * 2. watchAuthState() でログイン状態の変化を監視し、変化のたびに画面表示を更新する
 *
 * 注意：
 * ・タブ切替・ドロワー・案件パネルの初期化には触れない（各専用モジュールの責務）。
 * ・案件データ・仕上表データの読込・保存はここでは一切行わない。
 */
export function bindAuthUiEvents() {
  const authButton = document.getElementById("msAuthBtn");
  if (authButton) {
    authButton.addEventListener("click", handleAuthButtonClick);
  }

  // Firebaseの認証状態を監視する。
  // 初回通知がGraphトークン保存より先に来る場合があるため、
  // ログインボタン処理側でも再描画する（handleAuthButtonClick参照）。
  watchAuthState(renderAuthState);
}
