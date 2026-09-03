/**
 * Microsoft認証UI。
 * Firebase Authentication（Firestore利用者）とMSAL Graphセッション（OneDrive）を
 * 別責任で保持し、画面上では同じMicrosoftアカウント領域に状態をまとめる。
 */
import {
  loginWithMicrosoft,
  logoutMicrosoft,
  watchAuthState
} from '../auth/microsoft-auth.js';
import {
  initializeGraphSession,
  getGraphSessionState,
  subscribeGraphSession,
  loginGraph,
  getGraphAccessToken,
  logoutGraph
} from '../auth/graph-session.js';

let currentUser = null;
let bound = false;
const listeners = [];

function snapshot() {
  const graph = getGraphSessionState();
  const graphAccount = graph.account || null;
  return {
    user: currentUser,
    displayName: graphAccount?.name || currentUser?.displayName || currentUser?.email || graphAccount?.username || '',
    email: currentUser?.email || graphAccount?.username || '',
    loggedIn: Boolean(currentUser),
    graphLoggedIn: Boolean(graphAccount),
    graphTokenReady: Boolean(graph.tokenReady),
    graphError: graph.error || ''
  };
}

function notify() {
  const value = snapshot();
  listeners.slice().forEach((callback) => callback(value));
  window.dispatchEvent(new CustomEvent('chousa:auth-state-change', { detail: value }));
}

function ensureMicrosoftBranding() {
  const signInButton = document.getElementById('msAuthBtn');
  const accountButton = document.getElementById('msPill');

  if (signInButton && signInButton.dataset.microsoftBrandReady !== '1') {
    signInButton.dataset.microsoftBrandReady = '1';
    signInButton.innerHTML = `
      <img src="./assets/microsoft-symbol.svg" alt="" aria-hidden="true">
      <span>Log in</span>
    `;
  }

  if (accountButton && accountButton.dataset.microsoftBrandReady !== '1') {
    accountButton.dataset.microsoftBrandReady = '1';
    accountButton.innerHTML = `
      <img src="./assets/microsoft-symbol.svg" alt="" aria-hidden="true">
      <span data-ms-account-name></span>
    `;
  }
}

function renderAuthState(user = currentUser) {
  currentUser = user;
  ensureMicrosoftBranding();

  const auth = snapshot();
  const signInButton = document.getElementById('msAuthBtn');
  const accountButton = document.getElementById('msPill');
  const accountName = accountButton?.querySelector('[data-ms-account-name]');
  if (!signInButton || !accountButton || !accountName) {
    notify();
    return;
  }

  if (auth.loggedIn || auth.graphLoggedIn) {
    signInButton.hidden = true;
    accountButton.hidden = false;
    accountName.textContent = auth.displayName || 'Microsoftログイン済み';
    accountButton.title = 'タップしてログアウト';
  } else {
    signInButton.hidden = false;
    accountButton.hidden = true;
    accountName.textContent = '';
    accountButton.removeAttribute('title');
  }

  notify();
}

async function ensureFirebaseLogin() {
  if (currentUser) return currentUser;
  return loginWithMicrosoft();
}

async function ensureGraphLogin() {
  await initializeGraphSession();
  const graph = getGraphSessionState();
  if (!graph.account) return loginGraph();
  try {
    await getGraphAccessToken({ allowInteractive: true });
  } catch {
    return loginGraph();
  }
  return graph.account;
}

async function performSignIn(button = null) {
  if (button) button.disabled = true;
  try {
    // Firestore用Firebase認証を先に確保し、その後Graph/OneDrive用MSAL認証を確保する。
    // MSAL側がredirectした場合は、この関数はページ遷移で終了する。
    const user = await ensureFirebaseLogin();
    currentUser = user;
    renderAuthState(user);
    await ensureGraphLogin();
    renderAuthState(user);
    return user;
  } catch (error) {
    console.error('Microsoft認証に失敗しました。', error);
    window.alert(`Microsoft認証に失敗しました。\n${error?.message || error}`);
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleSignIn() {
  const button = document.getElementById('msAuthBtn');
  if (!button) return;
  try {
    await performSignIn(button);
  } catch {
    // performSignInで通知済み。
  }
}

async function handleAccountClick() {
  const auth = snapshot();
  if (!auth.loggedIn && !auth.graphLoggedIn) return;
  if (!window.confirm('ログアウトしますか？')) return;

  const button = document.getElementById('msPill');
  if (button) button.disabled = true;
  try {
    // Firebaseを先にログアウトし、最後にMSAL redirectでMicrosoftセッションを閉じる。
    if (auth.loggedIn) await logoutMicrosoft();
    currentUser = null;
    renderAuthState(null);
    if (auth.graphLoggedIn) await logoutGraph();
  } catch (error) {
    console.error('Microsoftログアウトに失敗しました。', error);
    window.alert(`Microsoftログアウトに失敗しました。\n${error?.message || error}`);
  } finally {
    if (button) button.disabled = false;
  }
}

export async function reconnectMicrosoftAuth() {
  return performSignIn(null);
}

export function getAuthUiState() {
  return snapshot();
}

export function subscribeAuthUiState(callback) {
  listeners.push(callback);
  callback(snapshot());
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function bindAuthUiEvents() {
  if (bound) return;
  bound = true;

  ensureMicrosoftBranding();
  document.getElementById('msAuthBtn')?.addEventListener('click', handleSignIn);
  document.getElementById('msPill')?.addEventListener('click', handleAccountClick);
  watchAuthState(renderAuthState);
  subscribeGraphSession(() => renderAuthState(currentUser));
  void initializeGraphSession().then(() => renderAuthState(currentUser)).catch((error) => {
    console.warn('Graphセッション初期化に失敗しました。', error);
    renderAuthState(currentUser);
  });
}
