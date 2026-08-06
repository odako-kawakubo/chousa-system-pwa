import { appConfig } from "../config/app-config.js";
import {
  loginWithMicrosoft,
  logoutMicrosoft,
  watchAuthState,
  getGraphAccessToken
} from "./auth/microsoft-auth.js";

const sections = [...document.querySelectorAll("main > section.content")];
const tabs = [...document.querySelectorAll("[data-tab]")];
const authButton = document.getElementById("msAuthBtn");
const accountPill = document.getElementById("msPill");
const authBanner = document.getElementById("authBanner");
let currentUser = null;

/**
 * 指定したタブだけを表示する。
 *
 * @param {string} tabName
 */
function showTab(tabName) {
  sections.forEach(section => {
    section.hidden = section.id !== tabName;
  });

  tabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

/**
 * ログインユーザーとGraphトークンの取得状態を画面へ反映する。
 *
 * @param {import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js").User|null} user
 */
function setAuthUi(user) {
  currentUser = user;
  const graphTokenExists = Boolean(getGraphAccessToken());

  if (user) {
    const displayName = user.displayName || user.email || "Microsoftログイン済み";

    accountPill.textContent = displayName;
    accountPill.className = "pill auth-ok";
    authButton.textContent = "ログアウト";

    authBanner.textContent =
      `Microsoftログイン確認済み：${displayName} / ` +
      `Graphトークン：${graphTokenExists ? "取得済み" : "未取得"}`;

    // Graphトークンがない場合は、ログイン済みでも注意表示にする。
    authBanner.className = graphTokenExists ? "auth-banner ok" : "auth-banner warn";
    return;
  }

  accountPill.textContent = "未ログイン";
  accountPill.className = "pill auth-warn";
  authButton.textContent = "Microsoftログイン";
  authBanner.textContent =
    "この確認版では、Microsoftログインとログアウトだけが実際に動作します。" +
    "その他の画面は構成確認用です。";
  authBanner.className = "auth-banner";
}

authButton.addEventListener("click", async () => {
  authButton.disabled = true;

  try {
    if (currentUser) {
      await logoutMicrosoft();
      // onAuthStateChangedを待たず、ログアウト表示を直ちに反映する。
      setAuthUi(null);
    } else {
      const user = await loginWithMicrosoft();
      // トークン保存後に再描画することで「未取得」の競合表示を防ぐ。
      setAuthUi(user);
    }
  } catch (error) {
    console.error("Microsoft認証に失敗しました。", error);
    alert(`Microsoft認証に失敗しました。\n${error?.message || error}`);
  } finally {
    authButton.disabled = false;
  }
});

const drawer = document.getElementById("drawer");
const backdrop = document.getElementById("drawerBackdrop");

document.getElementById("operationBtn").addEventListener("click", () => {
  drawer.classList.add("open");
  backdrop.classList.add("open");
});

for (const element of [backdrop, document.getElementById("drawerClose")]) {
  element.addEventListener("click", () => {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
  });
}

document.getElementById("headerVersion").textContent = appConfig.version;

// Firebaseの認証状態を監視する。
// 初回通知がトークン保存より先に来る場合があるため、ログインボタン処理でも再描画する。
watchAuthState(setAuthUi);
showTab("finish");
