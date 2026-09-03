/**
 * src/js/ui/auth-ui.js
 *
 * Microsoft認証のヘッダー表示を管理する。
 * Microsoftシンボルはアプリ内ローカル資産を使い、圏外起動でも表示を維持する。
 * ログアウトはユーザー名タップ時の確認から行う。
 */

import {
  loginWithMicrosoft,
  logoutMicrosoft,
  watchAuthState,
  getGraphAccessToken
} from '../auth/microsoft-auth.js';

let currentUser = null;
let bound = false;
const listeners = [];

function snapshot() {
  return {
    user: currentUser,
    displayName: currentUser?.displayName || currentUser?.email || '',
    email: currentUser?.email || '',
    loggedIn: Boolean(currentUser),
    graphTokenReady: Boolean(getGraphAccessToken()),
    cloudReady: Boolean(currentUser && getGraphAccessToken())
  };
}

function notify() {
  const value = snapshot();
  listeners.slice().forEach((callback) => callback(value));
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

function renderAuthState(user) {
  currentUser = user;
  ensureMicrosoftBranding();

  const signInButton = document.getElementById('msAuthBtn');
  const accountButton = document.getElementById('msPill');
  const accountName = accountButton?.querySelector('[data-ms-account-name]');
  if (!signInButton || !accountButton || !accountName) {
    notify();
    return;
  }

  if (user) {
    signInButton.hidden = true;
    accountButton.hidden = false;
    accountName.textContent = user.displayName || user.email || 'Microsoftログイン済み';
    accountButton.title = 'タップしてログアウト';
  } else {
    signInButton.hidden = false;
    accountButton.hidden = true;
    accountName.textContent = '';
    accountButton.removeAttribute('title');
  }

  notify();
  window.dispatchEvent(new CustomEvent('chousa:auth-state-change', { detail: snapshot() }));
}

async function handleSignIn() {
  if (currentUser) return;
  const button = document.getElementById('msAuthBtn');
  if (!button) return;

  button.disabled = true;
  try {
    const user = await loginWithMicrosoft();
    renderAuthState(user);
  } catch (error) {
    console.error('Microsoft認証に失敗しました。', error);
    window.alert(`Microsoft認証に失敗しました。\n${error?.message || error}`);
  } finally {
    button.disabled = false;
  }
}

async function handleAccountClick() {
  if (!currentUser) return;
  if (!window.confirm('ログアウトしますか？')) return;

  const button = document.getElementById('msPill');
  if (button) button.disabled = true;
  try {
    await logoutMicrosoft();
    renderAuthState(null);
  } catch (error) {
    console.error('Microsoftログアウトに失敗しました。', error);
    window.alert(`Microsoftログアウトに失敗しました。\n${error?.message || error}`);
  } finally {
    if (button) button.disabled = false;
  }
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
}
