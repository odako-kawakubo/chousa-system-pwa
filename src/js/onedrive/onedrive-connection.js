/**
 * OneDrive接続状態と「04 調査」業務ルートの唯一の正本。
 * 固定共有URLを解決し、そのdriveId/itemIdへ実アクセスできた時だけ接続済みにする。
 */
import {
  initializeGraphSession,
  getGraphSessionState,
  subscribeGraphSession,
  getGraphAccessToken
} from '../auth/graph-session.js';
import { resolveSharedUrl, getDriveItem } from './onedrive-client.js';
import { microsoftConfig } from '../../config/microsoft-config.js';
import { isManualOffline } from '../sync/sync-status.js';

const listeners = [];
let generation = 0;
let initialized = false;
let rootCache = null;
let state = {
  phase: 'unconnected',
  connected: false,
  text: '未接続',
  error: '',
  errorCode: '',
  root: null
};

function cloneState() {
  return { ...state, root: state.root ? { ...state.root } : null };
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

function unavailableState(message = '', errorCode = '') {
  return {
    phase: 'unconnected',
    connected: false,
    text: '未接続',
    error: message,
    errorCode,
    root: null
  };
}

async function resolveAndVerifyRoot() {
  await getGraphAccessToken();
  const resolved = await resolveSharedUrl(microsoftConfig.surveyRootUrl);
  const verified = await getDriveItem(resolved);
  if (!verified?.folder || !verified.driveId || !verified.itemId) {
    const error = new Error('04 調査の実体へアクセスできませんでした。');
    error.code = 'SURVEY_ROOT_VERIFY_FAILED';
    throw error;
  }
  if (microsoftConfig.surveyRootName && verified.name && !verified.name.includes(microsoftConfig.surveyRootName)) {
    const error = new Error(`共有URLの接続先が「${microsoftConfig.surveyRootName}」ではありません。`);
    error.code = 'SURVEY_ROOT_NAME_MISMATCH';
    throw error;
  }
  return verified;
}

/**
 * OneDriveを使う全機能の入口。
 * 案件一覧や案件保存側は共有URLを直接解決せず、必ずここから同じrootを取得する。
 */
export async function getUsableSurveyRoot({ force = false } = {}) {
  if (navigator.onLine === false) throw Object.assign(new Error('圏外です。'), { code: 'NETWORK_OFFLINE' });
  if (isManualOffline()) throw Object.assign(new Error('オフラインモードです。'), { code: 'MANUAL_OFFLINE' });
  await initializeGraphSession();
  if (!getGraphSessionState().account) {
    throw Object.assign(new Error('Microsoft Graphへログインしていません。'), { code: 'GRAPH_LOGIN_REQUIRED' });
  }

  if (!force && rootCache?.driveId && rootCache?.itemId) return { ...rootCache };
  rootCache = await resolveAndVerifyRoot();
  return { ...rootCache };
}

export function clearSurveyRoot() {
  rootCache = null;
}

export async function refreshOneDriveConnection({ force = false } = {}) {
  const currentGeneration = ++generation;

  if (navigator.onLine === false || isManualOffline()) {
    clearSurveyRoot();
    publish(unavailableState());
    return cloneState();
  }

  await initializeGraphSession().catch(() => null);
  const graph = getGraphSessionState();
  if (!graph.account) {
    clearSurveyRoot();
    publish(unavailableState(graph.error || '', 'GRAPH_LOGIN_REQUIRED'));
    return cloneState();
  }

  publish({
    phase: 'checking',
    connected: false,
    text: '確認中',
    error: '',
    errorCode: '',
    root: rootCache
  });

  try {
    const root = await getUsableSurveyRoot({ force });
    if (currentGeneration !== generation) return cloneState();
    publish({ phase: 'connected', connected: true, text: '接続', error: '', errorCode: '', root });
  } catch (error) {
    if (currentGeneration !== generation) return cloneState();
    clearSurveyRoot();
    publish({
      phase: 'error',
      connected: false,
      text: '未接続',
      error: error?.message || 'OneDriveへ接続できません。',
      errorCode: error?.code || error?.graphCode || '',
      root: null
    });
  }
  return cloneState();
}

export function initializeOneDriveConnection() {
  if (initialized) return;
  initialized = true;
  subscribeGraphSession(() => void refreshOneDriveConnection({ force: true }));
  window.addEventListener('online', () => void refreshOneDriveConnection({ force: true }));
  window.addEventListener('offline', () => void refreshOneDriveConnection());
  window.addEventListener('chousa:manual-offline-change', () => void refreshOneDriveConnection({ force: true }));
  void refreshOneDriveConnection();
}
