/**
 * ヘッダーのFirestore通信表示と、手動オフライン切替確認を同期状態Storeへ接続する。
 * 実際の手動オフライン切替処理はproject-controller.jsの既存経路へ委譲する。
 *
 * v0.1.6.3C:
 *   未送信が残っている場合は「まとめて同期」を表示し、50件単位で明示同期する。
 *   バッチ失敗時は自動継続せず、再送するか閉じるかをユーザーへ返す。
 */
import { getSyncStatus, subscribeSyncStatus } from '../sync/sync-status.js';
import { getCurrentProject } from '../projects/project-store.js';
import { retryUnsentBatch, BULK_SYNC_BATCH_SIZE } from '../firestore/firestore-repository.js';
import { openModal, closeModal } from './modal.js';

const OFFLINE_MODAL_ID = 'manualOfflineModal';
const BULK_RETRY_MODAL_ID = 'bulkSyncRetryModal';
let unsubscribe = null;
let pendingManualOffline = null;
let bulkSyncRunning = false;

function communicationLabel(status) {
  if (status.networkOnline === false) return 'エラー';
  if (status.phase === 'error') return 'エラー';
  if (status.phase === 'reconnecting' || status.phase === 'connecting') return '不安定';
  return '良好';
}

function ensureCommunicationCaption() {
  const group = document.querySelector('.header-sync-group');
  const dot = document.getElementById('onlinePill');
  if (!group || !dot || group.querySelector('[data-sync-caption]')) return;

  const caption = document.createElement('span');
  caption.className = 'header-sync-caption';
  caption.dataset.syncCaption = '1';
  caption.textContent = '通信状態';
  group.insertBefore(caption, dot);
}

function ensureBulkSyncButton() {
  const group = document.querySelector('.header-sync-group');
  if (!group) return null;
  let button = document.getElementById('headerBulkSyncButton');
  if (button) return button;
  button = document.createElement('button');
  button.id = 'headerBulkSyncButton';
  button.type = 'button';
  button.className = 'header-offline-toggle header-bulk-sync';
  button.hidden = true;
  button.textContent = 'まとめて同期';
  group.appendChild(button);
  return button;
}

function ensureBulkRetryModal() {
  if (document.getElementById(BULK_RETRY_MODAL_ID)) return;
  const modal = document.createElement('div');
  modal.className = 'shared-project-modal';
  modal.id = BULK_RETRY_MODAL_ID;
  modal.dataset.modalClose = '';
  modal.dataset.modalTarget = BULK_RETRY_MODAL_ID;
  modal.innerHTML = `
    <div class="shared-project-card" data-modal-stop>
      <div class="shared-project-head">
        <b>未送信データがあります</b>
      </div>
      <div class="manual-offline-message" style="padding:16px">
        通信状態が不安定です。<br>
        未送信データが残っています。<br>
        通信状況の良い場所で、後ほど再送してください。
        <div id="bulkSyncRemaining" class="hint" style="margin-top:10px"></div>
      </div>
      <div class="new-project-actions">
        <button class="btn" id="closeBulkSyncRetryButton" type="button">閉じる</button>
        <button class="btn primary" id="retryBulkSyncButton" type="button">再送する</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function render(status) {
  ensureCommunicationCaption();

  const dot = document.getElementById('onlinePill');
  const label = document.getElementById('firebasePill');
  const toggle = document.getElementById('headerOfflineToggle');
  const bulkButton = ensureBulkSyncButton();

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
    toggle.textContent = status.manualOffline ? '解除' : 'オフラインモード';
    toggle.classList.toggle('active', status.manualOffline);
    toggle.setAttribute('aria-pressed', status.manualOffline ? 'true' : 'false');
  }

  if (bulkButton) {
    const canBulkSync = status.unsentCount > 0 && !status.manualOffline && status.networkOnline !== false;
    bulkButton.hidden = status.unsentCount <= 0;
    bulkButton.disabled = bulkSyncRunning || !canBulkSync;
    bulkButton.textContent = bulkSyncRunning
      ? '同期中…'
      : `まとめて同期 ${status.unsentCount}件`;
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

  title.textContent = 'オフラインモードを解除しますか？';
  message.innerHTML =
    `通信状況：<b>${communicationLabel(getSyncStatus())}</b><br><br>` +
    '解除するとFirestoreとの同期を再開します。';
}

/** ヘッダー・設定タブ共通の確認入口。 */
export function requestManualOfflineModeChange(enabled) {
  pendingManualOffline = Boolean(enabled);
  renderOfflineConfirmation(pendingManualOffline);
  openModal(OFFLINE_MODAL_ID);
}

function showBulkRetryModal(remaining) {
  ensureBulkRetryModal();
  const text = document.getElementById('bulkSyncRemaining');
  if (text) text.textContent = `未送信：${Number(remaining || 0)}件`;
  openModal(BULK_RETRY_MODAL_ID);
}

async function runBulkSync() {
  if (bulkSyncRunning) return;
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return;
  const projectId = String(project.projectId);

  bulkSyncRunning = true;
  render(getSyncStatus());
  try {
    while (true) {
      // 同期開始後に案件が切り替わった場合、旧案件の大量送信を画面裏で継続しない。
      if (String(getCurrentProject()?.projectId || '') !== projectId) return;

      const status = getSyncStatus();
      if (status.manualOffline || status.networkOnline === false) {
        showBulkRetryModal(status.unsentCount);
        return;
      }
      if (status.unsentCount <= 0) return;

      const result = await retryUnsentBatch({
        projectId,
        batchSize: BULK_SYNC_BATCH_SIZE
      });

      // 1バッチ中に案件切替が起きても、その50件の原子的commit完了後に止める。
      if (String(getCurrentProject()?.projectId || '') !== projectId) return;

      if (!result.ok) {
        showBulkRetryModal(result.remaining ?? getSyncStatus().unsentCount);
        return;
      }
      if (result.completed || Number(result.remaining || 0) <= 0) return;

      // 成功した50件ごとにUIへ処理を返し、長い同期でも画面を固めない。
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    bulkSyncRunning = false;
    render(getSyncStatus());
  }
}

function bindManualOfflineControls() {
  const headerToggle = document.getElementById('headerOfflineToggle');
  const confirmButton = document.getElementById('confirmManualOfflineButton');
  const cancelButton = document.getElementById('cancelManualOfflineButton');

  // 設定タブなど既存UIからの切替要求も、業務処理へ届く前に同じ確認へ集約する。
  window.addEventListener('chousa:manual-offline-change', (event) => {
    if (event.detail?.confirmed === true) return;
    event.stopImmediatePropagation();
    requestManualOfflineModeChange(Boolean(event.detail?.enabled));
  });

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
      detail: { enabled, confirmed: true }
    }));
  });
}

function bindBulkSyncControls() {
  ensureBulkRetryModal();
  ensureBulkSyncButton()?.addEventListener('click', () => {
    void runBulkSync();
  });
  document.getElementById('closeBulkSyncRetryButton')?.addEventListener('click', () => {
    closeModal(BULK_RETRY_MODAL_ID);
  });
  document.getElementById('retryBulkSyncButton')?.addEventListener('click', () => {
    closeModal(BULK_RETRY_MODAL_ID);
    void runBulkSync();
  });
}

export function bindSyncStatusUi() {
  ensureCommunicationCaption();
  ensureBulkSyncButton();
  ensureBulkRetryModal();
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeSyncStatus(render);

  if (document.documentElement.dataset.syncOfflineUiBound !== '1') {
    document.documentElement.dataset.syncOfflineUiBound = '1';
    bindManualOfflineControls();
    bindBulkSyncControls();
  }
}
