/**
 * src/js/projects/project-transfer.js
 *
 * 圏外／手動オフライン時に、現在の案件を1つのJSONへ書き出し、
 * 別端末で同じprojectIdの案件として読み込むための共通入口。
 *
 * AirDrop・LINE・Teams等はOS側の共有手段として扱い、このモジュールは依存しない。
 * 写真本体は含めず、photoRecord（写真管理情報）までを共有する。
 */

import {
  getCurrentProject,
  getProject,
  getProjectSyncMeta,
  saveProjectSnapshot,
  subscribe
} from './project-store.js';
import {
  openProjectSession,
  saveCurrentProjectSession
} from './project-session.js';
import {
  clearUnsentForProject,
  listUnsent,
  putUnsent
} from '../sync/unsent-queue.js';
import { canUseFirestore } from '../sync/sync-status.js';

const TRANSFER_FORMAT = 'chousa-system-project-json';
const TRANSFER_VERSION = 1;
const VALID_RECORD_TYPES = new Set(['finish', 'material', 'photo']);

function transferAvailable() {
  return !canUseFirestore();
}

function statusElement() {
  return document.getElementById('projectRestoreStatus');
}

function showStatus(message = '', kind = '') {
  const el = statusElement();
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('show', Boolean(message));
  el.classList.toggle('warn', kind === 'warn');
  el.classList.toggle('ok', kind === 'ok');
}

function safeFilePart(value, fallback = '案件') {
  const text = String(value || '').trim() || fallback;
  return text.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80);
}

function clonePending(item) {
  return {
    projectId: String(item?.projectId || ''),
    environment: item?.environment === 'test' ? 'test' : 'production',
    recordType: String(item?.recordType || ''),
    recordId: String(item?.recordId || ''),
    operation: item?.operation === 'delete' ? 'delete' : 'set',
    record: item?.record ?? null,
    queuedAt: Number(item?.queuedAt || Date.now())
  };
}

function transferableSyncBaseline(projectId) {
  const meta = getProjectSyncMeta(projectId) || {};
  return {
    hasSyncedOnce: Boolean(meta.hasSyncedOnce),
    recordCursors: {
      finish: Number(meta.recordCursors?.finish || 0),
      material: Number(meta.recordCursors?.material || 0),
      photo: Number(meta.recordCursors?.photo || 0)
    },
    finishChangeCursor: meta.finishChangeCursor || null,
    lastSyncedAt: Number(meta.lastSyncedAt || 0)
  };
}

function createTransferPayload(entry) {
  const projectId = String(entry.project.projectId);
  return {
    format: TRANSFER_FORMAT,
    formatVersion: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    project: { ...entry.project },
    finishRecords: entry.finishRecords || [],
    materialRecords: entry.materialRecords || [],
    photoRecords: entry.photoRecords || [],
    pendingWrites: listUnsent({ projectId }).map(clonePending),
    syncBaseline: transferableSyncBaseline(projectId)
  };
}

function validatePayload(payload) {
  if (!payload || payload.format !== TRANSFER_FORMAT || Number(payload.formatVersion) !== TRANSFER_VERSION) {
    throw new Error('調査システムの案件JSONではありません。');
  }
  if (!payload.project?.projectId) throw new Error('案件IDがありません。');
  if (payload.project.isSample) throw new Error('サンプル案件は読み込めません。');
  ['finishRecords', 'materialRecords', 'photoRecords'].forEach((key) => {
    if (!Array.isArray(payload[key])) throw new Error(`${key} が正しくありません。`);
  });
  return payload;
}

function recordIdFor(type, record) {
  if (type === 'finish') return String(record?.finishId || '');
  if (type === 'material') return String(record?.materialId || '');
  return String(record?.photoId || '');
}

function applyPendingToRecords(records, pending, type) {
  const map = new Map((records || []).map((record) => [recordIdFor(type, record), record]));
  pending
    .filter((item) => item.recordType === type)
    .forEach((item) => {
      if (!item.recordId) return;
      if (item.operation === 'delete') map.delete(item.recordId);
      else if (item.record) map.set(item.recordId, item.record);
    });
  return [...map.values()];
}

function normalizeImportedPending(projectId, pending = []) {
  return pending
    .filter((item) => String(item?.projectId || projectId) === projectId)
    .filter((item) => VALID_RECORD_TYPES.has(String(item?.recordType || '')))
    .filter((item) => item?.recordId)
    .map((item) => ({ ...clonePending(item), projectId }));
}

async function shareOrDownload(file, project) {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: `${project.projectNo || ''} ${project.projectName || ''}`.trim(),
      files: [file]
    });
    return 'shared';
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

async function exportCurrentProject() {
  if (!transferAvailable()) {
    showStatus('案件ファイル共有は圏外またはオフラインモードで使用できます。', 'warn');
    return;
  }

  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) {
    showStatus('共有する案件を開いてください。', 'warn');
    return;
  }

  const entry = saveCurrentProjectSession();
  if (!entry) {
    showStatus('案件データを書き出せませんでした。', 'warn');
    return;
  }

  const payload = createTransferPayload(entry);
  const json = JSON.stringify(payload, null, 2);
  const fileName = `${safeFilePart(project.projectNo || project.projectId)}_${safeFilePart(project.projectName)}.json`;
  const file = new File([json], fileName, { type: 'application/json' });

  try {
    showStatus('案件ファイルを準備しています…');
    const result = await shareOrDownload(file, project);
    showStatus(result === 'shared' ? '共有画面を開きました。' : '案件JSONを書き出しました。', 'ok');
  } catch (error) {
    if (error?.name === 'AbortError') {
      showStatus('共有をキャンセルしました。');
      return;
    }
    console.error('[v0.1.6.4B] 案件JSON書き出し失敗', error);
    showStatus('案件JSONを書き出せませんでした。', 'warn');
  }
}

async function importProjectFile(file) {
  if (!transferAvailable()) {
    showStatus('案件ファイル読込は圏外またはオフラインモードで使用できます。', 'warn');
    return;
  }
  if (!file) return;

  try {
    const payload = validatePayload(JSON.parse(await file.text()));
    const projectId = String(payload.project.projectId);
    const existing = getProject(projectId);
    const localPending = normalizeImportedPending(projectId, listUnsent({ projectId }));
    const incomingPending = normalizeImportedPending(projectId, payload.pendingWrites || []);

    if (existing && !window.confirm('同じ案件が端末内にあります。受信した案件データを反映しますか？\nこの端末の未送信変更は優先して保持します。')) {
      showStatus('案件ファイルの読込をキャンセルしました。');
      return;
    }

    saveCurrentProjectSession();

    // 同一案件にこの端末の未送信変更がある場合は、受信Snapshotの上に戻して消失を防ぐ。
    const finishRecords = applyPendingToRecords(payload.finishRecords, localPending, 'finish');
    const materialRecords = applyPendingToRecords(payload.materialRecords, localPending, 'material');
    const photoRecords = applyPendingToRecords(payload.photoRecords, localPending, 'photo');
    const syncBaseline = payload.syncBaseline || {};

    const imported = saveProjectSnapshot({
      project: { ...payload.project, projectId, isSample: false },
      finishRecords,
      materialRecords,
      photoRecords,
      syncMeta: {
        hasSyncedOnce: Boolean(syncBaseline.hasSyncedOnce),
        recordCursors: {
          finish: Number(syncBaseline.recordCursors?.finish || 0),
          material: Number(syncBaseline.recordCursors?.material || 0),
          photo: Number(syncBaseline.recordCursors?.photo || 0)
        },
        finishChangeCursor: syncBaseline.finishChangeCursor || null,
        lastSyncedAt: Number(syncBaseline.lastSyncedAt || 0),
        importedAt: Date.now(),
        importedFromJson: true
      }
    });

    clearUnsentForProject(projectId);
    [...incomingPending, ...localPending].forEach((item) => {
      putUnsent({
        projectId,
        environment: item.environment,
        recordType: item.recordType,
        recordId: item.recordId,
        operation: item.operation,
        record: item.record
      });
    });

    openProjectSession(imported);
    showStatus(`案件を読み込みました。未送信 ${listUnsent({ projectId }).length}件`, 'ok');
  } catch (error) {
    console.error('[v0.1.6.4B] 案件JSON読込失敗', error);
    showStatus(error?.message || '案件JSONを読み込めませんでした。', 'warn');
  }
}

function updateButtons() {
  const enabled = transferAvailable();
  const project = getCurrentProject();
  const exportButton = document.getElementById('exportProjectJsonButton');
  const importButton = document.getElementById('importProjectJsonButton');
  if (exportButton) exportButton.disabled = !enabled || !project?.projectId || Boolean(project.isSample);
  if (importButton) importButton.disabled = !enabled;
}

export function initializeProjectTransfer() {
  const tools = document.querySelector('.project-side-tools');
  if (!tools || document.getElementById('exportProjectJsonButton')) return;

  const exportButton = document.createElement('button');
  exportButton.className = 'btn';
  exportButton.id = 'exportProjectJsonButton';
  exportButton.type = 'button';
  exportButton.textContent = '案件を書き出す';

  const importButton = document.createElement('button');
  importButton.className = 'btn';
  importButton.id = 'importProjectJsonButton';
  importButton.type = 'button';
  importButton.textContent = '案件ファイルを読み込む';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  input.id = 'projectJsonFileInput';

  tools.append(exportButton, importButton, input);

  exportButton.addEventListener('click', exportCurrentProject);
  importButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0] || null;
    input.value = '';
    await importProjectFile(file);
  });

  window.addEventListener('online', updateButtons);
  window.addEventListener('offline', updateButtons);
  window.addEventListener('chousa:manual-offline-change', updateButtons);
  subscribe(updateButtons);
  updateButtons();
}
