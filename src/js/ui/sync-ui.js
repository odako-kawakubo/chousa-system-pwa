/**
 * ヘッダーのFirestore通信表示と、手動オフライン切替確認を同期状態Storeへ接続する。
 * 実際の切替処理はproject-controller.jsの既存経路へ委譲する。
 */
import { getSyncStatus, subscribeSyncStatus } from '../sync/sync-status.js';
import { openModal, closeModal } from './modal.js';

const OFFLINE_MODAL_ID = 'manualOfflineModal';
let unsubscribe = null;
let pendingManualOffline = null;

function communicationLabel(status) {
  if (status.networkOnline === false) return 'エラー';
  if (status.phase === 'error') return 'エラー';
  if (status.phase === 'reconnecting' || status.phase === 'connecting') return '不安定';
  return '良好';
}

function render(status) {
  const dot = document.getElementById('onlinePill');
  const label = document.getElementById('firebasePill');
  const toggle = document.getElementById('headerOfflineToggle');

  if (dot) {
    dot.className = `connection-dot ${status.lamp}${status.blinking ? ' blinking' : ''}`;
    dot.title = `Firestore：${status.text}`;
    dot.setAttribute('aria-label', `Firestore ${status.text}`);
  }

  if (label) {
    label.textContent = status.text;
    label.className = `pill header-sync-state sync-${status.lamp}`;
  }

  if (toggle) {
    toggle.textContent = status.manualOffline ? '解除' : 'オフライン';
    toggle.classList.toggle('active', status.manualOffline);
    toggle.setAttribute('aria-pressed', status.manualOffline ? 'true' : 'false');
  }
}

function renderOfflineConfirmation(enabled) {
  const title = document.getElementById('manualOfflineModalTitle');
  const message = document.getElementById('manualOfflineModalMessage');
  if (!title || !message) return;

  if (enabled) {
    title.textContent = 'オフラインモードに切り替えますか？';
    message.innerHTML =
      'オフライン中の変更は端末内に保存され、<br>' +
      'Firestoreには送信されません。';
    return;
  }

  const status = getSyncStatus();
  title.textContent = 'オフラインモードを解除しますか？';
  message.innerHTML =
    `通信状況：<b>${communicationLabel(status)}</b><br><br>` +
    '解除するとFirestoreとの同期を再開します。';
}

/**
 * ヘッダー・設定タブ共通の手動オフライン切替入口。
 * 確認OK時だけ既存chousa:manual-offline-changeイベントを発火する。
 */
export function requestManualOfflineModeChange(enabled) {
  pendingManualOffline = Boolean(enabled);
  renderOfflineConfirmation(pendingManualOffline);
  openModal(OFFLINE_MODAL_ID);
}

function bindManualOfflineControls() {
  const headerToggle = document.getElementById('headerOfflineToggle');
  const confirmButton = document.getElementById('confirmManualOfflineButton');
  const cancelButton = document.getElementById('cancelManualOfflineButton');

  headerToggle?.addEventListener('click', () => {
    requestManualOfflineModeChange(!getSyncStatus().manualOffline);
  });

  cancelButton?.addEventListener('click', () => {
    pendingManualOffline = null;
    closeModal(OFFLINE_MODAL_ID);
  });

  confirmButton?.addEventListener('click', () => {
    if (pendingManualOffline === null) return;
    const enabled = pendingManualOffline;
    pendingManualOffline = null;
    closeModal(OFFLINE_MODAL_ID);
    window.dispatchEvent(new CustomEvent('chousa:manual-offline-change', {
      detail: { enabled }
    }));
  });
}

export function bindSyncStatusUi() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeSyncStatus(render);

  if (document.documentElement.dataset.syncOfflineUiBound !== '1') {
    document.documentElement.dataset.syncOfflineUiBound = '1';
    bindManualOfflineControls();
  }
}
