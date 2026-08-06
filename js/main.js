import { appConfig } from "../config/app-config.js";
import { loginWithMicrosoft, logoutMicrosoft, watchAuthState, getGraphAccessToken } from "./auth/microsoft-auth.js";

const sections = [...document.querySelectorAll("main > section.content")];
const tabs = [...document.querySelectorAll("[data-tab]")];
const authButton = document.getElementById("msAuthBtn");
const accountPill = document.getElementById("msPill");
const authBanner = document.getElementById("authBanner");
let currentUser = null;

function showTab(tabName) {
  sections.forEach(section => section.hidden = section.id !== tabName);
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === tabName));
}

tabs.forEach(tab => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

function setAuthUi(user) {
  currentUser = user;
  if (user) {
    const displayName = user.displayName || user.email || "Microsoftログイン済み";
    accountPill.textContent = displayName;
    accountPill.className = "pill auth-ok";
    authButton.textContent = "ログアウト";
    authBanner.textContent = `Microsoftログイン確認済み：${displayName} / Graphトークン：${getGraphAccessToken() ? "取得済み" : "未取得"}`;
    authBanner.className = "auth-banner ok";
  } else {
    accountPill.textContent = "未ログイン";
    accountPill.className = "pill auth-warn";
    authButton.textContent = "Microsoftログイン";
    authBanner.textContent = "この確認版では、Microsoftログインとログアウトだけが実際に動作します。その他の画面は構成確認用です。";
    authBanner.className = "auth-banner";
  }
}

authButton.addEventListener("click", async () => {
  authButton.disabled = true;
  try {
    if (currentUser) await logoutMicrosoft();
    else await loginWithMicrosoft();
  } catch (error) {
    console.error(error);
    alert(`Microsoft認証に失敗しました。\n${error?.message || error}`);
  } finally {
    authButton.disabled = false;
  }
});

const drawer = document.getElementById("drawer");
const backdrop = document.getElementById("drawerBackdrop");
document.getElementById("operationBtn").addEventListener("click", () => { drawer.classList.add("open"); backdrop.classList.add("open"); });
for (const el of [backdrop, document.getElementById("drawerClose")]) el.addEventListener("click", () => { drawer.classList.remove("open"); backdrop.classList.remove("open"); });

document.getElementById("headerVersion").textContent = appConfig.version;
watchAuthState(setAuthUi);
showTab("finish");
