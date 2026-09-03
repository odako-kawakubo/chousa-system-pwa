/**
 * OneDrive接続状態の正本。
 * 「04 調査」の解決・キャッシュはonedrive-root、Graph認証はgraph-sessionが担当する。
 * ここでは取得済みrootの実アクセスとchildren取得を確認し、接続状態だけを公開する。
 */
import {
  initializeGraphSession,
  getGraphSessionState,
  subscribeGraphSession,
  getGraphAccessToken
} from '../auth/graph-session.js';
import { getDriveItem, listDriveChildren } from './onedrive-client.js';
import { getSurveyRoot, clearSurveyRoot, getCachedSurveyRoot } from './onedrive-root.js';
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
  errorCode: '',
  root: null,
  rootSource: ''
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
    root: null,
    rootSource: ''
  };
}

function isExpectedRootName(name) {
  const expected = String(microsoftConfig.surveyRootName || '').trim();
  const actual = String(name || '').trim();
  if (!expected || !actual) return false;
  return actual === expected || actual.includes(expected);
}

async function verifyResolvedRoot(candidate) {
  const verified = await getDriveItem(candidate);
  if (!verified?.folder || !verified.driveId || !verified.itemId) {
    const error = new Error('04 調査の実体へアクセスできませんでした。');
    error.code = 'SURVEY_ROOT_VERIFY_FAILED';
    throw error;
  }
  if (!isExpectedRootName(verified.name)) {
    const error = new Error(`接続先「${verified.name || '-'}」は「${microsoftConfig.surveyRootName}」ではありません。`);
    error.code = 'SURVEY_ROOT_NAME_MISMATCH';
    throw error;
  }

  // 案件一覧で実際に使うchildrenまで読めることを接続条件にする。
  await listDriveChildren(verified);
  return { ...verified, rootSource: candidate.rootSource || '' };
}

/**
 * OneDriveを使う全機能の入口。
 * 案件一覧/案件保存側はルート解決を行わず、必ずここから同じrootを取得する。
 */
export async function getUsableSurveyRoot({ force = false } = {}) {
  if (navigator.onLine === false) throw Object.assign(new Error('圏外です。'), { code: 'NETWORK_OFFLINE' });
  if (isManualOffline()) throw Object.assign(new Error('オフラインモードです。'), { code: 'MANUAL_OFFLINE' });
  await initializeGraphSession();
  if (!getGraphSessionState().account) {
    throw Object.assign(new Error('Microsoft Graphへログインしていません。'), { code: 'GRAPH_LOGIN_REQUIRED' });
  }

  await getGraphAccessToken();
  const candidate = await getSurveyRoot({ force });
  return verifyResolvedRoot(candidate);
}

export { clearSurveyRoot };

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

  const cached = getCachedSurveyRoot();
  publish({
    phase: 'checking',
    connected: false,
    text: '確認中',
    error: '',
    errorCode: '',
    root: cached,
    rootSource: cached?.rootSource || ''
  });

  try {
    const root = await getUsableSurveyRoot({ force });
    if (currentGeneration !== generation) return cloneState();
    publish({
      phase: 'connected',
      connected: true,
      text: '接続',
      error: '',
      errorCode: '',
      root,
      rootSource: root.rootSource || ''
    });
  } catch (error) {
    if (currentGeneration !== generation) return cloneState();
    clearSurveyRoot();
    publish({
      phase: 'error',
      connected: false,
      text: '未接続',
      error: error?.message || 'OneDriveへ接続できません。',
      errorCode: error?.code || error?.graphCode || '',
      root: null,
      rootSource: ''
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
