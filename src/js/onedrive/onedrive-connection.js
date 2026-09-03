/**
 * OneDrive接続状態と「04 調査」業務ルートの唯一の正本。
 * 固定共有URLを第一経路とし、旧v0.14系と同じOneDrive内検索を予備経路にする。
 * 採用した候補のdriveId/itemIdへ実アクセスし、children取得まで成功した時だけ接続済みにする。
 */
import {
  initializeGraphSession,
  getGraphSessionState,
  subscribeGraphSession,
  getGraphAccessToken
} from '../auth/graph-session.js';
import {
  resolveSharedUrl,
  searchDriveFolders,
  getDriveItem,
  listDriveChildren
} from './onedrive-client.js';
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

async function verifyRoot(candidate, source) {
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

  // 「接続」はフォルダ本体のGETだけではなく、実際に案件一覧で使うchildrenまで読めた状態とする。
  await listDriveChildren(verified);
  return { ...verified, rootSource: source };
}

async function resolveByLegacySearch() {
  const expected = String(microsoftConfig.surveyRootName || '').trim();
  const keyword = expected.replace(/^\d+\s*/, '').trim() || expected;
  const folders = await searchDriveFolders(keyword);
  const exact = folders.find((item) => String(item.name || '').trim() === expected);
  const includesExpected = folders.find((item) => String(item.name || '').includes(expected));
  const includesKeyword = folders.find((item) => String(item.name || '').includes(keyword));
  const candidate = exact || includesExpected || includesKeyword || null;
  if (!candidate) {
    const error = new Error(`OneDrive内に「${expected}」が見つかりません。`);
    error.code = 'SURVEY_ROOT_SEARCH_NOT_FOUND';
    throw error;
  }
  return verifyRoot(candidate, 'legacy-search');
}

async function resolveAndVerifyRoot() {
  await getGraphAccessToken();

  let sharedUrlError = null;
  try {
    const shared = await resolveSharedUrl(microsoftConfig.surveyRootUrl);
    return await verifyRoot(shared, 'fixed-share');
  } catch (error) {
    sharedUrlError = error;
  }

  try {
    return await resolveByLegacySearch();
  } catch (searchError) {
    const error = new Error(
      `04 調査へ接続できませんでした。共有URL: ${sharedUrlError?.message || '失敗'} / 検索: ${searchError?.message || '失敗'}`
    );
    error.code = searchError?.code || sharedUrlError?.code || 'SURVEY_ROOT_RESOLVE_FAILED';
    error.sharedUrlError = sharedUrlError;
    error.searchError = searchError;
    throw error;
  }
}

/**
 * OneDriveを使う全機能の入口。
 * 案件一覧や案件保存側は共有URL・検索を直接行わず、必ずここから同じrootを取得する。
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
    root: rootCache,
    rootSource: rootCache?.rootSource || ''
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