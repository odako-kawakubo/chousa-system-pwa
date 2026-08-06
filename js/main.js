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

function setAuthUi(user) {
  currentUser = user;
  const graphTokenExists = Boolean(getGraphAccessToken());

  if (user) {
    const displayName = user.displayName || user.email || "Microsoftログイン済み";
    accountPill.textContent = displayName;
    accountPill.className = "pill auth-ok header-account";
    authButton.textContent = "ログアウト";
    authBanner.textContent = `Microsoftログイン確認済み：${displayName} / Graphトークン：${graphTokenExists ? "取得済み" : "未取得"}`;
    authBanner.className = graphTokenExists ? "auth-banner ok" : "auth-banner";
    return;
  }

  accountPill.textContent = "未ログイン";
  accountPill.className = "pill auth-warn header-account";
  authButton.textContent = "Microsoftログイン";
  authBanner.textContent = "Microsoftログイン・ログアウトとGraphトークン取得だけを実装した画面シェルです。業務処理はまだ未接続です。";
  authBanner.className = "auth-banner";
}

authButton.addEventListener("click", async () => {
  authButton.disabled = true;

  try {
    if (currentUser) {
      await logoutMicrosoft();
      setAuthUi(null);
    } else {
      const user = await loginWithMicrosoft();
      setAuthUi(user);
    }
  } catch (error) {
    console.error("Microsoft認証に失敗しました。", error);
    alert(`Microsoft認証に失敗しました。\n${error?.message || error}`);
  } finally {
    authButton.disabled = false;
  }
});

function bindPanel(openButtonId, panelId, backdropId, closeButtonId) {
  const openButton = document.getElementById(openButtonId);
  const panel = document.getElementById(panelId);
  const backdrop = document.getElementById(backdropId);
  const closeButton = document.getElementById(closeButtonId);

  const open = () => {
    panel.classList.add("open");
    backdrop.classList.add("open");
  };

  const close = () => {
    panel.classList.remove("open");
    backdrop.classList.remove("open");
  };

  openButton.addEventListener("click", open);
  backdrop.addEventListener("click", close);
  closeButton.addEventListener("click", close);
}

bindPanel("operationBtn", "drawer", "drawerBackdrop", "drawerClose");
bindPanel("projectPanelBtn", "projectPanel", "projectBackdrop", "projectPanelClose");

document.getElementById("headerVersion").textContent = appConfig.version;
watchAuthState(setAuthUi);
showTab("finish");
