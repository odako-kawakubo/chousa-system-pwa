/**
 * src/js/settings/settings-controller.js
 * 設定タブの入口。
 */

import { getCurrentProject } from '../projects/project-store.js';
import * as surveyCandidateStore from '../store/survey-candidate-store.js';
import { renderSettingsTab } from './settings-renderer.js';
import * as boardSettingsStore from './board-settings-store.js';
import { renderBoardSample } from '../camera/camera-board.js';
import { getSyncStatus, subscribeSyncStatus } from '../sync/sync-status.js';
import { listUnsent } from '../sync/unsent-queue.js';
import { getAuthUiState, subscribeAuthUiState } from '../ui/auth-ui.js';
import { getDeviceCode, getDeviceDisplayName, setDeviceName, subscribeDeviceName } from '../device-code.js';
import { formatSyncDiagnosticLog, clearSyncDiagnosticLog, subscribeSyncDiagnosticLog } from '../debug/sync-diagnostic-log.js';
import { getOneDriveConnectionState, subscribeOneDriveConnection } from '../onedrive/onedrive-connection.js';
import { listSystemDataBackups } from '../onedrive/system-data-backup.js';

let root = null;
let unsubscribe = null;
let unsubscribeSync = null;
let unsubscribeAuth = null;
let unsubscribeDevice = null;
let unsubscribeOneDrive = null;
let unsubscribeSyncDiagnosticLog = null;

function buildViewModel() {
  const board = boardSettingsStore.get();
  const currentProject = getCurrentProject() || {};
  return {
    project: {
      projectNo: board.projectNo || currentProject.projectNo || '',
      projectName: board.projectName || currentProject.projectName || '',
      address: board.address || currentProject.address || '',
      surveyDate: board.surveyDate || '',
      surveyor: board.surveyor || ''
    },
    materialCandidates: surveyCandidateStore.getConfiguredMaterialCandidates(),
    partCandidates: surveyCandidateStore.getConfiguredPartCandidates(),
    board,
    sync: {
      ...getSyncStatus(),
      unsentCount: currentProject.projectId ? listUnsent({ projectId: currentProject.projectId }).length : 0
    },
    auth: getAuthUiState(),
    oneDrive: getOneDriveConnectionState(),
    device: {
      code: getDeviceCode(),
      name: getDeviceDisplayName()
    }
  };
}

function formatSyncTime(value) {
  const time = Number(value || 0);
  if (!time) return '未同期';
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '未同期';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function refreshSyncStatusFields(status = getSyncStatus()) {
  if (!root) return;
  const statusPill = root.querySelector('[data-settings-sync-status]');
  const firestore = root.querySelector('[data-settings-sync-firestore]');
  const time = root.querySelector('[data-settings-sync-time]');
  const unsent = root.querySelector('[data-settings-sync-unsent]');
  const toggle = root.querySelector('[data-settings-offline-toggle]');
  const manualSync = root.querySelector('[data-settings-manual-sync]');
  if (statusPill) statusPill.textContent = status.text;
  if (firestore) firestore.textContent = status.text;
  if (time) time.textContent = formatSyncTime(status.lastSyncedAt);
  if (unsent) unsent.textContent = `${status.unsentCount || 0}件`;
  if (toggle) {
    toggle.textContent = status.manualOffline ? 'ON' : 'OFF';
    toggle.classList.toggle('active', status.manualOffline);
    toggle.setAttribute('aria-pressed', status.manualOffline ? 'true' : 'false');
  }
  if (manualSync) {
    manualSync.disabled = Boolean(status.manualOffline || status.networkOnline === false);
    manualSync.title = status.manualOffline
      ? 'オフラインモード中は同期できません'
      : status.networkOnline === false
        ? '通信できないため同期できません'
        : '';
  }
}

function refreshAuthStatusFields(auth = getAuthUiState()) {
  if (!root) return;
  const user = root.querySelector('[data-settings-auth-user]');
  const graph = root.querySelector('[data-settings-graph-state]');
  if (user) user.textContent = auth.displayName || '未ログイン';
  if (graph) graph.textContent = auth.graphTokenReady ? '取得済み' : '未取得';
}

function refreshOneDriveStatusFields(oneDrive = getOneDriveConnectionState()) {
  if (!root) return;
  const state = root.querySelector('[data-settings-onedrive-state]');
  const rootName = root.querySelector('[data-settings-onedrive-root]');
  const restoreButton = root.querySelector('[data-action="show-system-data-backups"]');
  if (state) {
    state.textContent = oneDrive.text;
    state.title = oneDrive.error || '';
  }
  if (rootName) rootName.textContent = oneDrive.connected ? (oneDrive.root?.name || '04 調査') : '-';
  if (restoreButton) restoreButton.disabled = !oneDrive.connected;
}

function refreshSyncDiagnosticLogView() {
  if (!root) return;
  const output = root.querySelector('[data-settings-sync-diagnostic-log]');
  if (output) {
    output.value = formatSyncDiagnosticLog();
    output.scrollTop = output.scrollHeight;
  }
}

function downloadSyncDiagnosticLog() {
  const blob = new Blob([formatSyncDiagnosticLog() || '(ログなし)'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'sync-diagnostic.log';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function refreshDeviceFields(name = getDeviceDisplayName()) {
  if (!root) return;
  const input = root.querySelector('[data-setting-device-name]');
  if (input && document.activeElement !== input) input.value = name;
}

function render() {
  if (!root) return;
  const activeSection = root.querySelector('.settings-subtab.active')?.dataset.settingsSection || 'survey';
  renderSettingsTab(root, buildViewModel());
  showInnerSection(activeSection);
  renderBoardPreview();
  refreshSyncDiagnosticLogView();
}

function showInnerSection(section) {
  if (!root) return;
  root.querySelectorAll('[data-settings-section]').forEach((button) => {
    button.classList.toggle('active', button.dataset.settingsSection === section);
  });
  root.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== section;
  });
}

function boardPreviewData() {
  const settings = boardSettingsStore.get();
  return {
    photoType: 'visual',
    projectName: settings.subjectText || settings.projectName,
    address: settings.addressText || settings.address,
    subjectFontSize: settings.subjectFontSize,
    addressFontSize: settings.addressFontSize,
    roomNo: '1-1',
    part: '壁',
    statusCode: '5',
    date: new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())
  };
}

function renderBoardPreview() {
  const canvas = root?.querySelector('[data-settings-board-preview]');
  if (canvas) renderBoardSample(canvas, boardPreviewData());
}

function syncBoardFromInputs(changedElement = null) {
  if (!root) return;

  const projectNoInput = root.querySelector('[data-setting-project-field="projectNo"]');
  const projectNameInput = root.querySelector('[data-setting-project-field="projectName"]');
  const addressInput = root.querySelector('[data-setting-project-field="address"]');
  const surveyDateInput = root.querySelector('[data-setting-project-field="surveyDate"]');
  const surveyorInput = root.querySelector('[data-setting-project-field="surveyor"]');
  const subjectTextInput = root.querySelector('[data-board-setting="subjectText"]');
  const addressTextInput = root.querySelector('[data-board-setting="addressText"]');

  const projectNo = projectNoInput?.value || '';
  const projectName = projectNameInput?.value || '';
  const address = addressInput?.value || '';
  const surveyDate = surveyDateInput?.value || '';
  const surveyor = surveyorInput?.value || '';

  if (changedElement?.matches('[data-setting-project-field="projectName"]') && subjectTextInput) {
    subjectTextInput.value = projectName;
  }
  if (changedElement?.matches('[data-setting-project-field="address"]') && addressTextInput) {
    addressTextInput.value = address;
  }

  const subjectText = subjectTextInput?.value ?? projectName;
  const addressText = addressTextInput?.value ?? address;
  const subjectFontSize = root.querySelector('[data-board-setting="subjectFontSize"]')?.value;
  const addressFontSize = root.querySelector('[data-board-setting="addressFontSize"]')?.value;

  boardSettingsStore.set({
    projectNo,
    projectName,
    address,
    surveyDate,
    surveyor,
    subjectText,
    addressText,
    subjectFontSize,
    addressFontSize
  });

  renderBoardPreview();
}

function adjustBoardFontSize(field, delta) {
  const input = root?.querySelector(`[data-board-setting="${field}"]`);
  if (!input) return;

  const min = Number(input.min || 0);
  const max = Number(input.max || 999);
  const current = Number(input.value || 0);
  const next = Math.max(min, Math.min(max, current + delta));

  input.value = String(next);
  syncBoardFromInputs(input);
}

async function showSystemDataBackups() {
  try {
    const backups = await listSystemDataBackups();
    if (!backups.length) {
      window.alert('この案件の復元データはまだありません。');
      return;
    }
    const names = backups.slice(0, 15).map((item) => `・${item.name}`).join('\n');
    window.alert(`復元データを確認しました。\n\n${names}\n\n復元処理は後続フェーズで接続します。`);
  } catch (error) {
    window.alert(error?.message || '復元データを確認できませんでした。');
  }
}

async function handleClick(event) {
  const subtab = event.target.closest('[data-settings-section]');
  if (subtab) {
    showInnerSection(subtab.dataset.settingsSection);
    return;
  }

  if (event.target.closest('[data-action="manual-sync"]')) {
    window.dispatchEvent(new CustomEvent('chousa:manual-sync-request'));
    return;
  }

  if (event.target.closest('[data-action="show-system-data-backups"]')) {
    await showSystemDataBackups();
    return;
  }

  if (event.target.closest('[data-action="toggle-manual-offline"]')) {
    const next = !getSyncStatus().manualOffline;
    window.dispatchEvent(new CustomEvent('chousa:manual-offline-change', { detail: { enabled: next } }));
    window.setTimeout(render, 0);
    return;
  }

  if (event.target.closest('[data-action="save-device-name"]')) {
    const value = root.querySelector('[data-setting-device-name]')?.value || '';
    if (!setDeviceName(value)) {
      window.alert('端末名を入力してください。');
      return;
    }
    render();
    return;
  }

  if (event.target.closest('[data-action="copy-sync-diagnostic-log"]')) {
    navigator.clipboard?.writeText(formatSyncDiagnosticLog()).then(() => {
      window.alert('同期ログをコピーしました。');
    }).catch(() => {
      window.alert('コピーできませんでした。診断ログ保存を使用してください。');
    });
    return;
  }

  if (event.target.closest('[data-action="download-sync-diagnostic-log"]')) {
    downloadSyncDiagnosticLog();
    return;
  }

  if (event.target.closest('[data-action="clear-sync-diagnostic-log"]')) {
    clearSyncDiagnosticLog();
    refreshSyncDiagnosticLogView();
    return;
  }

  const fontAdjust = event.target.closest('[data-board-font-adjust]');
  if (fontAdjust) {
    adjustBoardFontSize(
      fontAdjust.dataset.boardFontAdjust,
      Number(fontAdjust.dataset.boardFontDelta || 0)
    );
    return;
  }

  if (event.target.closest('[data-action="reset-board-settings"]')) {
    boardSettingsStore.resetFormatting();
    render();
    return;
  }

  if (event.target.closest('[data-action="add-setting-material"]')) {
    const part = root.querySelector('[data-setting-add-material-part]')?.value || '';
    const baseName = root.querySelector('[data-setting-add-material-name]')?.value || '';
    if (!part.trim() || !baseName.trim()) {
      window.alert('部位と建材名称を入力してください。');
      return;
    }
    if (!surveyCandidateStore.addMaterialCandidate(part, baseName)) {
      window.alert('同じ建材名称候補が登録済み、または入力内容が正しくありません。');
      return;
    }
    return;
  }

  if (event.target.closest('[data-action="add-setting-part"]')) {
    const name = root.querySelector('[data-setting-add-part-name]')?.value || '';
    if (!name.trim()) {
      window.alert('部位名称を入力してください。');
      return;
    }
    if (!surveyCandidateStore.addPartCandidate(name)) {
      window.alert('同じ部位名称候補が登録済みです。');
    }
  }
}

function handleChange(event) {
  const materialRow = event.target.closest('[data-setting-material-row]');
  if (materialRow && event.target.matches('[data-setting-material-field]')) {
    const candidateId = materialRow.dataset.settingMaterialRow;
    const fields = {};
    materialRow.querySelectorAll('[data-setting-material-field]').forEach((input) => {
      fields[input.dataset.settingMaterialField] = input.value;
    });
    if (!surveyCandidateStore.updateMaterialCandidate(candidateId, fields)) {
      window.alert('同じ候補が登録済み、または入力内容が正しくありません。');
      render();
    }
    return;
  }

  const partRow = event.target.closest('[data-setting-part-row]');
  if (partRow && event.target.matches('[data-setting-part-field]')) {
    const candidateId = partRow.dataset.settingPartRow;
    if (!surveyCandidateStore.updatePartCandidate(candidateId, event.target.value)) {
      window.alert('同じ候補が登録済み、または入力内容が正しくありません。');
      render();
    }
  }
}

export function refreshSettingsTab() {
  render();
}

export function initializeSettingsTab() {
  root = document.getElementById('settings');
  if (!root) return;

  render();

  if (root.dataset.settingsEventsBound !== '1') {
    root.dataset.settingsEventsBound = '1';
    root.addEventListener('click', (event) => void handleClick(event));
    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-board-setting], [data-setting-project-field]')) {
        syncBoardFromInputs(event.target);
      }
    });
    root.addEventListener('change', handleChange);
    window.addEventListener('resize', renderBoardPreview);
  }

  if (unsubscribe) unsubscribe();
  unsubscribe = surveyCandidateStore.subscribe(render);
  if (unsubscribeSync) unsubscribeSync();
  unsubscribeSync = subscribeSyncStatus(refreshSyncStatusFields);
  if (unsubscribeAuth) unsubscribeAuth();
  unsubscribeAuth = subscribeAuthUiState(refreshAuthStatusFields);
  if (unsubscribeOneDrive) unsubscribeOneDrive();
  unsubscribeOneDrive = subscribeOneDriveConnection(refreshOneDriveStatusFields);
  if (unsubscribeDevice) unsubscribeDevice();
  unsubscribeDevice = subscribeDeviceName(refreshDeviceFields);
  if (unsubscribeSyncDiagnosticLog) unsubscribeSyncDiagnosticLog();
  unsubscribeSyncDiagnosticLog = subscribeSyncDiagnosticLog(refreshSyncDiagnosticLogView);
  refreshSyncDiagnosticLogView();
}
