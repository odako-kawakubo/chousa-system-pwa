/**
 * src/js/sync/sync-status.js
 *
 * Firestoreとの通信・同期状態を1か所で管理する。
 * ヘッダーと設定タブはこの状態だけを参照し、各所で独自判定しない。
 *
 * v0.1.6.7A:
 * - 手動オフラインは端末全体ではなく projectId ごとの端末ローカル設定として保持する。
 * - 案件未選択（トップ）では手動オフラインを適用せず、実際のネットワーク状態を扱う。
 * - 案件A/Bは互いに独立し、再度開いた時にその案件の設定だけを復元する。
 */

import { listUnsent } from './unsent-queue.js';
import { getCurrentProject } from '../projects/project-store.js';

const OFFLINE_BY_PROJECT_KEY = 'chousa-manual-offline-by-project';
const LEGACY_OFFLINE_KEY = 'chousa-manual-offline';

const listeners = [];
let state = {
  phase: 'idle', // idle | local | connecting | ready | activity | reconnecting | error
  lastSyncedAt: 0,
  serverConnected: false,
  error: null
};
let activityDepth = 0;
let activityTimer = null;

function readOfflineMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFLINE_BY_PROJECT_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOfflineMap(map) {
  try {
    localStorage.setItem(OFFLINE_BY_PROJECT_KEY, JSON.stringify(map || {}));
    // 旧グローバル設定は6.7以降の判定には使わない。新形式へ書いた時点で掃除する。
    localStorage.removeItem(LEGACY_OFFLINE_KEY);
    return true;
  } catch {
    return false;
  }
}

function resetActivityState() {
  activityDepth = 0;
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = null;
}

function notify() {
  const snapshot = getSyncStatus();
  listeners.slice().forEach((callback) => callback(snapshot));
}

function setState(patch) {
  state = { ...state, ...patch };
  notify();
}

export function isNetworkOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** 指定案件の端末ローカル手動オフライン設定を返す。案件未指定は常にfalse。 */
export function isProjectManualOffline(projectId) {
  const id = String(projectId || '');
  if (!id) return false;
  return readOfflineMap()[id] === true;
}

/** 現在開いている案件にだけ手動オフラインを適用する。トップでは常にfalse。 */
export function isManualOffline() {
  const currentProjectId = String(getCurrentProject()?.projectId || '');
  return currentProjectId ? isProjectManualOffline(currentProjectId) : false;
}

export function canUseFirestoreForProject(projectId) {
  return !isProjectManualOffline(projectId) && isNetworkOnline();
}

export function canUseFirestore() {
  const currentProjectId = String(getCurrentProject()?.projectId || '');
  if (!currentProjectId) return isNetworkOnline();
  return canUseFirestoreForProject(currentProjectId);
}

export function getSyncStatus() {
  const networkOnline = isNetworkOnline();
  const currentProject = getCurrentProject();
  const currentProjectId = currentProject?.projectId || '';
  const manualOffline = currentProjectId ? isProjectManualOffline(currentProjectId) : false;
  const unsentCount = currentProjectId ? listUnsent({ projectId: currentProjectId }).length : 0;
  let lamp = 'neutral';
  let text = '未接続';
  let blinking = false;

  if (manualOffline) {
    lamp = 'offline-mode';
    text = 'オフライン';
  } else if (currentProject?.isSample || state.phase === 'local' && !currentProjectId) {
    lamp = 'neutral';
    text = '対象外';
  } else if (!networkOnline) {
    lamp = 'network-offline';
    text = '圏外';
  } else if (state.phase === 'local') {
    lamp = 'neutral';
    text = '対象外';
  } else if (state.phase === 'error') {
    lamp = 'error';
    text = 'エラー';
  } else if (state.phase === 'reconnecting') {
    lamp = 'unstable';
    text = '不安定';
    blinking = true;
  } else if (state.phase === 'connecting' || state.phase === 'activity') {
    lamp = state.phase === 'connecting' ? 'unstable' : 'connected';
    text = state.phase === 'connecting' ? '不安定' : '通信中';
    blinking = true;
  } else if (state.phase === 'ready') {
    lamp = 'connected';
    text = '良好';
  }

  return {
    ...state,
    manualOffline,
    networkOnline,
    firestoreAvailable: !manualOffline && networkOnline,
    lamp,
    text,
    blinking,
    unsentCount
  };
}

export function subscribeSyncStatus(callback) {
  listeners.push(callback);
  callback(getSyncStatus());
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

/**
 * 現在案件が切り替わった時に同期表示・通信状態をその案件向けへ切り替える。
 * 保存済みの手動オフライン設定自体は変更しない。
 */
export function activateProjectSyncStatus(projectId) {
  const id = String(projectId || '');
  const manualOffline = id ? isProjectManualOffline(id) : false;
  resetActivityState();
  setState({
    phase: manualOffline ? 'idle' : (id && isNetworkOnline() ? 'connecting' : 'idle'),
    serverConnected: false,
    error: null,
    ...(!id ? { lastSyncedAt: 0 } : {})
  });
}

/** 現在案件の手動オフライン設定を保存する。案件未選択時は保存しない。 */
export function setManualOffline(enabled) {
  const currentProjectId = String(getCurrentProject()?.projectId || '');
  if (!currentProjectId) {
    activateProjectSyncStatus('');
    return false;
  }

  const next = Boolean(enabled);
  const map = readOfflineMap();
  if (next) map[currentProjectId] = true;
  else delete map[currentProjectId];
  writeOfflineMap(map);

  resetActivityState();
  setState({
    phase: next ? 'idle' : (isNetworkOnline() ? 'connecting' : 'idle'),
    serverConnected: false,
    error: null
  });
  return true;
}

export function markLocalOnly() {
  if (isManualOffline()) return;
  setState({ phase: 'local', serverConnected: false, lastSyncedAt: 0, error: null });
}

export function markConnecting() {
  if (isManualOffline()) return;
  setState({ phase: isNetworkOnline() ? 'connecting' : 'idle', serverConnected: false, error: null });
}

export function markReconnecting() {
  if (isManualOffline()) return;
  setState({ phase: isNetworkOnline() ? 'reconnecting' : 'idle', serverConnected: false, error: null });
}

export function markReady(lastSyncedAt = 0) {
  if (isManualOffline() || !isNetworkOnline()) return;
  setState({
    phase: 'ready',
    serverConnected: true,
    lastSyncedAt: Math.max(Number(state.lastSyncedAt || 0), Number(lastSyncedAt || 0)),
    error: null
  });
}

export function markError(error) {
  if (isManualOffline()) return;
  if (!isNetworkOnline()) {
    setState({ phase: 'idle', serverConnected: false, error: error || null });
    return;
  }
  setState({ phase: 'error', serverConnected: false, error: error || null });
}

export function beginFirestoreActivity() {
  if (!canUseFirestore()) return;
  activityDepth += 1;
  if (activityTimer) {
    clearTimeout(activityTimer);
    activityTimer = null;
  }
  if (state.serverConnected) setState({ phase: 'activity', error: null });
}

export function endFirestoreActivity(lastSyncedAt = 0) {
  if (isManualOffline()) return;
  activityDepth = Math.max(0, activityDepth - 1);
  if (activityDepth > 0) return;
  const synced = Math.max(Number(state.lastSyncedAt || 0), Number(lastSyncedAt || 0));
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    activityTimer = null;
    if (activityDepth === 0 && !isManualOffline()) {
      const phase = !isNetworkOnline()
        ? 'idle'
        : (state.serverConnected ? 'ready' : (state.phase === 'reconnecting' ? 'reconnecting' : 'connecting'));
      setState({ phase, lastSyncedAt: synced, error: null });
    }
  }, 220);
}

export function setSyncBaseline(value) {
  const next = Number(value || 0);
  setState({ lastSyncedAt: Number.isFinite(next) ? Math.max(0, next) : 0 });
}

export function setLastSyncedAt(value) {
  const next = Number(value || 0);
  if (!next || next <= Number(state.lastSyncedAt || 0)) return;
  setState({ lastSyncedAt: next });
}

export function initializeNetworkStatusEvents() {
  window.addEventListener('offline', () => {
    if (isManualOffline()) return;
    setState({ phase: 'idle', serverConnected: false });
  });
  window.addEventListener('online', () => {
    if (isManualOffline()) return;
    setState({ phase: getCurrentProject()?.projectId ? 'reconnecting' : 'idle', serverConnected: false, error: null });
  });
}
