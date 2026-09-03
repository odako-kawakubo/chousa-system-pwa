import {
  getAuth,
  OAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { firebaseApp } from "../../config/firebase-config.js";
import { microsoftConfig } from "../../config/microsoft-config.js";

const auth = getAuth(firebaseApp);
const provider = new OAuthProvider("microsoft.com");
const GRAPH_TOKEN_STORAGE_KEY = "graphAccessToken";

// Microsoft Graphで使用する委任スコープをログイン要求へ追加する。
for (const scope of microsoftConfig.scopes) {
  provider.addScope(scope);
}

// 小田原鉱石株式会社のMicrosoft Entraテナントへログイン先を限定する。
provider.setCustomParameters({
  tenant: microsoftConfig.tenantId,
  prompt: "select_account"
});

/**
 * Microsoftアカウントでログインする。
 *
 * Firebaseユーザー情報だけでなく、Microsoft Graph用アクセストークンも
 * sessionStorageへ保存する。sessionStorageのため、ブラウザタブを閉じると消える。
 *
 * @returns {Promise<import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js").User>}
 */
export async function loginWithMicrosoft() {
  const result = await signInWithPopup(auth, provider);
  const credential = OAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken || "";

  if (!accessToken) {
    // Firebaseログインだけ成功してGraphトークンがない状態を成功扱いにしない。
    await signOut(auth);
    throw new Error("Microsoft Graph用アクセストークンを取得できませんでした。");
  }

  sessionStorage.setItem(GRAPH_TOKEN_STORAGE_KEY, accessToken);
  return result.user;
}

/**
 * Microsoft/Firebaseからログアウトし、一時保存したGraphトークンも削除する。
 */
export async function logoutMicrosoft() {
  sessionStorage.removeItem(GRAPH_TOKEN_STORAGE_KEY);
  await signOut(auth);
}

/**
 * Firebase Authenticationのログイン状態を監視する。
 *
 * @param {(user: import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js").User|null) => void} callback
 */
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * 同じブラウザタブ内に一時保存したGraphアクセストークンを返す。
 *
 * @returns {string}
 */
export function getGraphAccessToken() {
  return sessionStorage.getItem(GRAPH_TOKEN_STORAGE_KEY) || "";
}

/** Microsoft認証とGraphトークンの両方が揃った時だけクラウド機能を許可する。 */
export function isMicrosoftCloudReady() {
  return Boolean(auth.currentUser && getGraphAccessToken());
}
