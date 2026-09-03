/**
 * OneDrive接続状態の正本。
 * 「04 調査」の実体へGraph APIでアクセスできた時だけ接続済みとする。
 */
import { getAuthUiState, subscribeAuthUiState } from '../ui/auth-ui.js';
import { getGraphAccessToken } from '../auth/microsoft-auth.js';
import { resolveSharedRoot, clearSharedRootCache } from './onedrive-client.js';
import { microsoftConfig } from '../../config/microsoft-config.js';
import { isManualOffline } from '../sync/sync-status.js';

const listeners = [];
let generation = 0;
let initialized = false;
let state = {
  phase: 'unconnected',
  connected: false,
  text: '未接続',
  error: '',
  root: null
};

function cloneState() {
  return {
    ...state,
    root: state.root ? { ...state.root } : null
  };
}

function publish(next) {
  state = { ...next, root: next.root ? { ...next.root } : null };
  listeners.slice().forEach((callback) => callback(cloneState()));
}

export function getOneDriveConnectionState() {
  return cloneState();
}

export function subscribeOneDriveConnection(callback) {
  listeners.push(callback);
  callback(cloneState());
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export async function refreshOneDriveConnection({ force = false } = {}) {
  const currentGeneration = ++generation;
  const auth = getAuthUiState();

  if (navigator.onLine === false || isManualOffline()) {
    publish({ phase: 'unconnected', connected: false, text: '未接続', error: '', root: null });
    return cloneState();
  }
  if (!auth.loggedIn || !getGraphAccessToken()) {
    publish({ phase: 'unconnected', connected: false, text: '未接続', error: '', root: null });
    return cloneState();
  }

  publish({ phase: 'checking', connected: false, text: '確認中', error: '', root: state.root });
  if (force) clearSharedRootCache(microsoftConfig.surveyRootName);

  try {
    const root = await resolveSharedRoot(microsoftConfig.surveyRootName);
    if (currentGeneration !== generation) return cloneState();
    publish({ phase: 'connected', connected: true, text: '接続', error: '', root });
  } catch (error) {
    if (currentGeneration !== generation) return cloneState();
    publish({
      phase: 'error',
      connected: false,
      text: '未接続',
      error: error?.message || 'OneDriveへ接続できません。',
      root: null
    });
  }
  return cloneState();
}

export function initializeOneDriveConnection() {
  if (initialized) return;
  initialized = true;
  subscribeAuthUiState(() => void refreshOneDriveConnection({ force: true }));
  window.addEventListener('online', () => void refreshOneDriveConnection({ force: true }));
  window.addEventListener('offline', () => void refreshOneDriveConnection());
  window.addEventListener('chousa:manual-offline-change', () => void refreshOneDriveConnection({ force: true }));
  void refreshOneDriveConnection();
}
