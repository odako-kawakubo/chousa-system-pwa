/**
 * Microsoft Graph専用セッション。
 *
 * Firebase Authenticationとは責任を分離し、v0.14系で実機利用していたMSAL構成を
 * Graphアクセス専用として復活させる。
 */
import { microsoftConfig } from '../../config/microsoft-config.js';

const PRIMARY_MSAL = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
const FALLBACK_MSAL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js';
const listeners = [];
let msalClient = null;
let initPromise = null;
let state = {
  initialized: false,
  account: null,
  tokenReady: false,
  error: ''
};

function cloneState() {
  return {
    ...state,
    account: state.account ? { ...state.account } : null
  };
}

function publish(patch = {}) {
  state = { ...state, ...patch };
  listeners.slice().forEach((callback) => callback(cloneState()));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src === src);
    if (existing && window.msal) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`MSALライブラリを読み込めませんでした: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureMsalLibrary() {
  if (window.msal) return;
  try {
    await loadScript(PRIMARY_MSAL);
  } catch {
    await loadScript(FALLBACK_MSAL);
  }
  if (!window.msal) throw new Error('MSALライブラリを読み込めませんでした。');
}

function activeAccount() {
  if (!msalClient) return null;
  const active = msalClient.getActiveAccount?.();
  if (active) return active;
  const account = msalClient.getAllAccounts?.()?.[0] || null;
  if (account) msalClient.setActiveAccount(account);
  return account;
}

export async function initializeGraphSession() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await ensureMsalLibrary();
    msalClient = new window.msal.PublicClientApplication({
      auth: {
        clientId: microsoftConfig.graphClientId,
        authority: `https://login.microsoftonline.com/${microsoftConfig.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
      }
    });

    try {
      const redirectResult = await msalClient.handleRedirectPromise();
      if (redirectResult?.account) msalClient.setActiveAccount(redirectResult.account);
    } catch (error) {
      publish({ error: error?.message || 'Microsoftログイン結果を処理できませんでした。' });
    }

    const account = activeAccount();
    publish({ initialized: true, account, tokenReady: false });
    return cloneState();
  })();
  return initPromise;
}

export function getGraphSessionState() {
  return cloneState();
}

export function subscribeGraphSession(callback) {
  listeners.push(callback);
  callback(cloneState());
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export async function loginGraph() {
  await initializeGraphSession();
  const account = activeAccount();
  if (account) {
    publish({ account, error: '' });
    return account;
  }
  await msalClient.loginRedirect({
    scopes: microsoftConfig.graphScopes,
    prompt: 'select_account'
  });
  return null;
}

export async function getGraphAccessToken({ allowInteractive = false } = {}) {
  await initializeGraphSession();
  const account = activeAccount();
  if (!account) {
    publish({ account: null, tokenReady: false });
    const error = new Error('Microsoft Graphへログインしていません。');
    error.code = 'GRAPH_LOGIN_REQUIRED';
    throw error;
  }

  try {
    const result = await msalClient.acquireTokenSilent({
      scopes: microsoftConfig.graphScopes,
      account
    });
    publish({ account, tokenReady: Boolean(result?.accessToken), error: '' });
    return result.accessToken;
  } catch (error) {
    publish({ account, tokenReady: false, error: error?.message || 'Graphトークンを取得できませんでした。' });
    if (allowInteractive) {
      await msalClient.acquireTokenRedirect({
        scopes: microsoftConfig.graphScopes,
        account
      });
      return '';
    }
    const wrapped = new Error('Microsoft Graphトークンを取得できませんでした。再接続してください。');
    wrapped.code = 'GRAPH_TOKEN_ACQUIRE_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function logoutGraph() {
  await initializeGraphSession();
  const account = activeAccount();
  publish({ account: null, tokenReady: false, error: '' });
  if (!account) return;
  await msalClient.logoutRedirect({
    account,
    postLogoutRedirectUri: window.location.origin + window.location.pathname
  });
}
