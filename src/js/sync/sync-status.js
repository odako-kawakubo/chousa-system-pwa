/**
 * src/js/sync/sync-status.js
 *
 * Firestoreとの通信・同期状態を1か所で管理する。
 * ヘッダーと設定タブはこの状態だけを参照し、各所で独自判定しない。
 *
 * v0.1.6.3C:
 *   「手動オフライン」と「物理的な通信可否」を別概念として扱う。
 *   isManualOffline() はユーザーが明示的に選んだモードだけを返し、
 *   Firestore通信可否は canUseFirestore() で判定する。
 */

import { listUnsent } from './unsent-queue.js';
import { getCurrentProject } from '../projects/project-store.js';
import { isMicrosoftCloudReady } from '../auth/microsoft-auth.js';

const OFFLINE_KEY = 'chousa-manual-offline';

const listeners = [];
let state = {
  phase: 'idle', // idle | local | connecting | ready | activity | reconnecting | error
  manualOffline: readManualOffline(),
  lastSyncedAt: 0,
  serverConnected: false,
  error: null
};
let activityDepth = 0;
let activityTimer = null;

function readManualOffline() {
  try {
    return localStorage.getItem(OFFLINE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeManualOffline(enabled) {
  try {
    localStorage.setItem(OFFLINE_KEY, enabled ? '1' : '0');
  } catch {
    // 端末設定保存失敗でも、そのセッション中の状態は維持する。
  }
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

export function isManualOffline() {
  return Boolean(state.manualOffline);
}

export function canUseFirestore() {
  return !isManualOffline() && isNetworkOnline() && isMicrosoftCloudReady();
}

export function getSyncStatus() {
  const networkOnline = isNetworkOnline();
  const cloudReady = isMicrosoftCloudReady();
  const currentProject = getCurrentProject();
  const currentProjectId = currentProject?.projectId || '';
  const unsentCount = currentProjectId ? listUnsent({ projectId: currentProjectId }).length : 0;
  let lamp = 'neutral';
  let text = '未接続';
  let blinking = false;

  if (state.manualOffline) {
    lamp = 'offline-mode';
    text = 'オフライン';
  } else if (currentProject?.isSample || state.phase === 'local' && !currentProjectId) {
    lamp = 'neutral';
    text = '対象外';
  } else if (!cloudReady) {
    lamp = 'neutral';
    text = 'ローカル';
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
    text = unsentCount > 0 ? `未送信 ${unsentCount}件` : '良好';
  }

  return {
    ...state,
    networkOnline,
    cloudReady,
    firestoreAvailable: !state.manualOffline && networkOnline && cloudReady,
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

export function setManualOffline(enabled) {
  const next = Boolean(enabled);
  writeManualOffline(next);
  activityDepth = 0;
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = null;
  setState({
    manualOffline: next,
    phase: next ? 'idle' : (isNetworkOnline() ? 'connecting' : 'idle'),
    serverConnected: false,
    error: null
  });
}

export function markLocalOnly() {
  if (state.manualOffline) return;
  setState({ phase: 'local', serverConnected: false, lastSyncedAt: 0, error: null });
}

export function markConnecting() {
  if (state.manualOffline) return;
  setState({ phase: isNetworkOnline() ? 'connecting' : 'idle', serverConnected: false, error: null });
}

export function markReconnecting() {
  if (state.manualOffline) return;
  setState({ phase: isNetworkOnline() ? 'reconnecting' : 'idle', serverConnected: false, error: null });
}

export function markReady(lastSyncedAt = 0) {
  if (state.manualOffline || !isNetworkOnline()) return;
  setState({
    phase: 'ready',
    serverConnected: true,
    lastSyncedAt: Math.max(Number(state.lastSyncedAt || 0), Number(lastSyncedAt || 0)),
    error: null
  });
}

export function markError(error) {
  if (state.manualOffline) return;
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
  if (state.manualOffline) return;
  activityDepth = Math.max(0, activityDepth - 1);
  if (activityDepth > 0) return;
  const synced = Math.max(Number(state.lastSyncedAt || 0), Number(lastSyncedAt || 0));
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    activityTimer = null;
    if (activityDepth === 0 && !state.manualOffline) {
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
    if (state.manualOffline) return;
    setState({ phase: 'idle', serverConnected: false });
  });
  window.addEventListener('online', () => {
    if (state.manualOffline) return;
    setState({ phase: isMicrosoftCloudReady() ? 'reconnecting' : 'local', serverConnected: false, error: null });
  });
  window.addEventListener('chousa:auth-state-change', (event) => {
    if (state.manualOffline) return;
    const cloudReady = Boolean(event.detail?.cloudReady);
    setState({
      phase: cloudReady && isNetworkOnline() ? 'connecting' : 'local',
      serverConnected: false,
      error: null
    });
  });
}
