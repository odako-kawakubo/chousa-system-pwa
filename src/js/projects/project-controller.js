/**
 * src/js/projects/project-controller.js
 *
 * 案件管理の正式入口。
 * 端末内案件一覧・Firestore案件一覧・新規作成・通信復帰の各入口から、
 * 同じ案件切替／Firestore読込／リアルタイム購読経路を使う。
 */

import { createTemporaryProject, temporaryDateCode } from './project-factory.js';
import { openProjectSession, saveCurrentProjectSession, refreshOpenProjectSessionViews } from './project-session.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import {
  getCurrentProject,
  getProject,
  getProjectList,
  saveProjectSnapshot,
  getProjectSyncMeta,
  updateProjectSyncMeta,
  removeProject,
  formatProjectLabel,
  subscribe
} from './project-store.js';
import { closeModal } from '../ui/modal.js';
import { closeProjectPanel } from '../ui/project-panel.js';
import {
  getRemoteTemporaryProjectNos,
  readProjectRecordsForProject,
  subscribeRealtimeProjectRecordsForProject,
  newestCursorsFromChanges,
  latestCursorValue,
  hydrateIncomingMaterialRecord,
  hydrateIncomingPhotoRecord,
  applyKnownFinishChange,
  restoreKnownFinishRecords,
  firestoreTimeToMillis,
  persistProjectMetadataForProject,
  touchProjectSyncDeviceForProject,
  cleanupFinishChangeLogsForProject,
  deleteTestProjectFromFirestore
} from '../sync/project-record-persistence.js';
import { refreshMaterialUsageDerivedFields } from '../finish-table/finish-table-actions.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
import { listUnsent, clearUnsentForProject } from '../sync/unsent-queue.js';
import { deleteLocalPhotoData } from '../photos/photo-local-store.js';
import { sampleProject } from '../demo/sample-project.js';
import { clearProjectBoardSettings } from '../settings/board-settings-store.js';
import {
  isManualOffline,
  canUseFirestore,
  setManualOffline,
  markConnecting,
  markReconnecting,
  markReady,
  markError,
  markLocalOnly,
  beginFirestoreActivity,
  endFirestoreActivity,
  setSyncBaseline,
  setLastSyncedAt
} from '../sync/sync-status.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { getDeviceCode, getDeviceDisplayName } from '../device-code.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

let stopActiveProjectRecords = null;
let activeProjectStreamToken = 0;

function stopProjectRecordStream() {
  syncDiagnosticLog('SYNC_STREAM_STOP_REQUEST', { hadActiveStream: Boolean(stopActiveProjectRecords), nextToken: activeProjectStreamToken + 1 });
  activeProjectStreamToken += 1;
  if (stopActiveProjectRecords) {
    stopActiveProjectRecords();
    stopActiveProjectRecords = null;
  }
}

function sameFieldEditedAt(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function newestChangeUpdatedAt(changes = []) {
  return changes.reduce((max, change) => Math.max(max, firestoreTimeToMillis(change?.record?.updatedAt)), 0);
}

function normalizeRecordCursors(value = {}) {
  return {
    finish: Number(value.finish || 0),
    material: Number(value.material || 0),
    photo: Number(value.photo || 0)
  };
}

function normalizeFinishChangeCursor(value = null) {
  if (!value || typeof value.seconds !== 'number' || !value.changeId) return null;
  return {
    seconds: Number(value.seconds),
    nanoseconds: Number(value.nanoseconds || 0),
    changeId: String(value.changeId)
  };
}

function updateFinishChangeCursor(projectId, cursor) {
  const normalized = normalizeFinishChangeCursor(cursor);
  if (!projectId || !normalized) return;
  updateProjectSyncMeta(projectId, { finishChangeCursor: normalized, hasSyncedOnce: true });
}

async function recordProjectDeviceContact(project, finishChangeCursor) {
  if (!project?.projectId || project.isSample) return;
  syncDiagnosticLog('DEVICE_CONTACT_START', { projectId: project.projectId, finishChangeCursor });
  await touchProjectSyncDeviceForProject(project, {
    deviceCode: getDeviceCode(),
    deviceName: getDeviceDisplayName(),
    finishChangeCursor: normalizeFinishChangeCursor(finishChangeCursor)
  });
  syncDiagnosticLog('DEVICE_CONTACT_END', { projectId: project.projectId });
}

async function cleanupFinishChangeLogIfDue(project) {
  if (!project?.projectId || project.isSample) return;
  syncDiagnosticLog('CHANGELOG_CLEANUP_DUE_CHECK', { projectId: project.projectId });
  const meta = getProjectSyncMeta(project.projectId) || {};
  const last = Number(meta.finishChangeLogCleanedAt || 0);
  if (last && (Date.now() - last) < (24 * 60 * 60 * 1000)) {
    syncDiagnosticLog('CHANGELOG_CLEANUP_SKIP_RECENT', { projectId: project.projectId, last });
    return;
  }
  try {
    const cleanupResult = await cleanupFinishChangeLogsForProject(project);
    syncDiagnosticLog('CHANGELOG_CLEANUP_DONE', { projectId: project.projectId, cleanupResult });
    updateProjectSyncMeta(project.projectId, { finishChangeLogCleanedAt: Date.now() });
  } catch (error) {
    console.warn('[v0.1.6.2] finish変更履歴の整理に失敗', error);
  }
}

function getProjectRecordCursors(projectId) {
  return normalizeRecordCursors(getProjectSyncMeta(projectId)?.recordCursors || {});
}

function updateProjectSyncCursors(projectId, cursors = {}, { completed = false } = {}) {
  if (!projectId) return;
  const current = getProjectRecordCursors(projectId);
  const next = {
    finish: Math.max(current.finish, Number(cursors.finish || 0)),
    material: Math.max(current.material, Number(cursors.material || 0)),
    photo: Math.max(current.photo, Number(cursors.photo || 0))
  };
  const lastSyncedAt = latestCursorValue(next);
  updateProjectSyncMeta(projectId, {
    recordCursors: next,
    lastSyncedAt,
    hasSyncedOnce: true,
    ...(completed ? { lastSyncCompletedAt: Date.now() } : {})
  });
  if (getCurrentProject()?.projectId === projectId) setLastSyncedAt(lastSyncedAt);
}

function applyProjectRecordChanges(project, changes = []) {
  if (!project?.projectId || getCurrentProject()?.projectId !== project.projectId) return;

  const unsentKeys = new Set(listUnsent({ projectId: project.projectId }).map((item) => `${item.recordType}|${item.recordId}`));
  const safeChanges = changes.filter((change) => !unsentKeys.has(`${change.recordType}|${change.id}`));
  let changed = false;

  const materialChanges = safeChanges.filter((item) => item.recordType === 'material');
  if (materialChanges.length) {
    let rawMaterials = materialRecordStore.exportSnapshot();
    materialChanges.forEach((change) => {
      const id = String(change.id || change.record?.materialId || '');
      if (!id) return;
      const current = materialRecordStore.get(id);
      if (change.changeType !== 'removed' && current && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) return;
      rawMaterials = rawMaterials.filter((record) => String(record.materialId) !== id);
      if (change.changeType !== 'removed' && change.record) rawMaterials.push(change.record);
      changed = true;
    });
    if (changed) {
      const normalized = hydrateIncomingMaterialRecord(null, rawMaterials);
      materialRecordStore.replaceAll(normalized, { notify: false });
    }
  }

  let finishChanged = false;
  safeChanges.filter((item) => item.recordType === 'finish').forEach((change) => {
    const id = String(change.id || change.record?.finishId || '');
    if (!id) return;
    const current = finishRecordStore.get(id);
    if (change.changeType !== 'removed' && current && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) return;
    applyKnownFinishChange(project.projectId, change);
    finishChanged = true;
  });
  if (finishChanged) {
    finishRecordStore.replaceAll(
      restoreKnownFinishRecords(project.projectId, materialRecordStore.exportSnapshot()),
      { notify: false }
    );
    changed = true;
  }

  safeChanges.filter((item) => item.recordType === 'photo').forEach((change) => {
    const id = String(change.id || change.record?.photoId || '');
    if (!id) return;
    const current = photoRecordStore.get(id);
    if (change.changeType !== 'removed' && current && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) return;
    if (change.changeType === 'removed') {
      photoRecordStore.replaceAll(photoRecordStore.exportSnapshot().filter((record) => record.photoId !== id), { notify: false });
      changed = true;
      return;
    }
    const normalized = hydrateIncomingPhotoRecord(change.record);
    if (normalized) {
      photoRecordStore.set(normalized);
      changed = true;
    }
  });

  if (!changed) return;
  saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  });
  refreshOpenProjectSessionViews();
}

async function openFirestoreProjectSession(target) {
  const project = target.project;
  syncDiagnosticLog('SYNC_OPEN_START', { projectId: project?.projectId || '', projectName: project?.projectName || '' });
  const token = ++activeProjectStreamToken;
  const syncMeta = target.syncMeta || getProjectSyncMeta(project.projectId) || {};
  const storedCursors = normalizeRecordCursors(syncMeta.recordCursors || {});
  const finishChangeCursor = normalizeFinishChangeCursor(syncMeta.finishChangeCursor);
  const legacyLastSyncedAt = Number(syncMeta.lastSyncedAt || 0);
  const cursors = storedCursors;
  const useLocalSnapshot = Boolean(syncMeta.hasSyncedOnce || legacyLastSyncedAt > 0)
    && Array.isArray(target.finishRecords)
    && target.finishRecords.length > 0;
  syncDiagnosticLog('SYNC_OPEN_PLAN', { projectId: project.projectId, token, useLocalSnapshot, storedCursors, finishChangeCursor });

  setSyncBaseline(latestCursorValue(cursors));
  if (useLocalSnapshot) openProjectSession(target);

  if (!canUseFirestore()) {
    if (!useLocalSnapshot) openProjectSession(target);
    markLocalOnly();
    return target;
  }

  markConnecting();
  beginFirestoreActivity();

  try {
    syncDiagnosticLog('SYNC_CATCHUP_START', { projectId: project.projectId, useLocalSnapshot });
    const remote = await readProjectRecordsForProject(project, {
      cursors: useLocalSnapshot ? cursors : null,
      finishChangeCursor: useLocalSnapshot ? finishChangeCursor : null,
      baseRecords: useLocalSnapshot ? {
        finishRecords: target.finishRecords || [],
        materialRecords: target.materialRecords || [],
        photoRecords: target.photoRecords || []
      } : null
    });
    syncDiagnosticLog('SYNC_TYPE_READ_PLAN', { projectId: project.projectId, typeModes: remote.typeModes || {} });
    syncDiagnosticLog('SYNC_CATCHUP_RESULT', { projectId: project.projectId, mode: remote.mode, typeModes: remote.typeModes || {}, changes: remote.changes?.length || 0, finishRecords: remote.finishRecords?.length || 0, materialRecords: remote.materialRecords?.length || 0, photoRecords: remote.photoRecords?.length || 0, finishHistoryMode: remote.finishHistoryMode || '' });
    if (token !== activeProjectStreamToken) {
      syncDiagnosticLog('SYNC_CATCHUP_DISCARDED_TOKEN', { projectId: project.projectId, token, activeProjectStreamToken });
      return target;
    }

    const typeModes = remote.typeModes || { finish: remote.mode, material: remote.mode, photo: remote.mode };

    if (!useLocalSnapshot) {
      const restored = {
        project,
        finishRecords: remote.finishRecords?.length ? remote.finishRecords : target.finishRecords,
        materialRecords: remote.materialRecords || target.materialRecords,
        photoRecords: remote.photoRecords || target.photoRecords || [],
        syncMeta: {
          ...(target.syncMeta || {}),
          recordCursors: normalizeRecordCursors(remote.cursors),
          finishChangeCursor: normalizeFinishChangeCursor(remote.finishChangeCursor),
          lastSyncedAt: Number(remote.lastSyncedAt || 0),
          hasSyncedOnce: true,
          lastSyncCompletedAt: Date.now()
        }
      };
      saveProjectSnapshot(restored);
      openProjectSession(restored);
      refreshMaterialUsageDerivedFields('remote-rebuild');
      refreshMaterialList();
    } else {
      let replacedFullType = false;
      if (typeModes.material === 'full') {
        materialRecordStore.replaceAll(remote.materialRecords || [], { notify: false });
        replacedFullType = true;
      }
      if (typeModes.photo === 'full') {
        photoRecordStore.replaceAll(remote.photoRecords || [], { notify: false });
        replacedFullType = true;
      }
      if (typeModes.finish === 'full') {
        finishRecordStore.replaceAll(remote.finishRecords || [], { notify: false });
        replacedFullType = true;
      }

      if (remote.changes?.length) applyProjectRecordChanges(project, remote.changes);

      if (replacedFullType) {
        saveProjectSnapshot({
          project,
          finishRecords: finishRecordStore.exportSnapshot(),
          materialRecords: materialRecordStore.exportSnapshot(),
          photoRecords: photoRecordStore.exportSnapshot(),
          syncMeta: {
            ...(target.syncMeta || {}),
            recordCursors: normalizeRecordCursors(remote.cursors),
            finishChangeCursor: normalizeFinishChangeCursor(remote.finishChangeCursor),
            lastSyncedAt: Number(remote.lastSyncedAt || 0),
            hasSyncedOnce: true,
            lastSyncCompletedAt: Date.now()
          }
        });
        refreshOpenProjectSessionViews();
      }

      if (typeModes.finish === 'full') {
        refreshMaterialUsageDerivedFields('remote-rebuild', { persist: false });
        refreshMaterialList();
      }
    }

    const caughtUpCursors = normalizeRecordCursors(remote.cursors || cursors);
    updateProjectSyncCursors(project.projectId, caughtUpCursors, { completed: true });
    if (remote.finishChangeCursor) updateFinishChangeCursor(project.projectId, remote.finishChangeCursor);

    void recordProjectDeviceContact(project, remote.finishChangeCursor || finishChangeCursor);
    void cleanupFinishChangeLogIfDue(project);

    const serverReadyTypes = new Set();
    syncDiagnosticLog('SYNC_LISTENER_START', { projectId: project.projectId, caughtUpCursors, finishChangeCursor: normalizeFinishChangeCursor(remote.finishChangeCursor || finishChangeCursor) });
    const stop = subscribeRealtimeProjectRecordsForProject(project, {
      afterByType: caughtUpCursors,
      finishChangeCursor: normalizeFinishChangeCursor(remote.finishChangeCursor || finishChangeCursor),
      onFinishCursor: (cursor) => {
        syncDiagnosticLog('SYNC_FINISH_CURSOR_ADVANCE', { projectId: project.projectId, cursor });
        if (token !== activeProjectStreamToken) return;
        updateFinishChangeCursor(project.projectId, cursor);
      },
      onState: ({ recordType, fromCache }) => {
        syncDiagnosticLog('SYNC_LISTENER_STATE', { projectId: project.projectId, recordType, fromCache });
        if (token !== activeProjectStreamToken || !canUseFirestore()) return;
        if (fromCache) {
          serverReadyTypes.delete(recordType);
          if (navigator.onLine !== false) markReconnecting();
          return;
        }
        serverReadyTypes.add(recordType);
        if (serverReadyTypes.size === 3) {
          markReady(latestCursorValue(getProjectRecordCursors(project.projectId)));
        }
      },
      onChanges: (changes) => {
        syncDiagnosticLog('SYNC_LISTENER_CHANGES', { projectId: project.projectId, count: changes?.length || 0, types: (changes || []).map((c) => `${c.recordType}:${c.changeType}`) });
        if (token !== activeProjectStreamToken) return;
        beginFirestoreActivity();
        try {
          applyProjectRecordChanges(project, changes);
          const nextCursors = newestCursorsFromChanges(changes, getProjectRecordCursors(project.projectId));
          updateProjectSyncCursors(project.projectId, nextCursors);
        } finally {
          endFirestoreActivity(newestChangeUpdatedAt(changes));
        }
      },
      onError: (error) => {
        syncDiagnosticLog('SYNC_LISTENER_ERROR', { projectId: project.projectId, message: error?.message || String(error) });
        if (token !== activeProjectStreamToken) return;
        markError(error);
      }
    });

    stopActiveProjectRecords = () => {
      syncDiagnosticLog('SYNC_LISTENER_STOP', { projectId: project.projectId });
      stop();
    };
    syncDiagnosticLog('SYNC_OPEN_READY', { projectId: project.projectId });
    return getProject(project.projectId) || target;
  } catch (error) {
    syncDiagnosticLog('SYNC_OPEN_ERROR', { projectId: project.projectId, message: error?.message || String(error) });
    if (token === activeProjectStreamToken) markError(error);
    throw error;
  } finally {
    if (token === activeProjectStreamToken) {
      endFirestoreActivity(latestCursorValue(getProjectRecordCursors(project.projectId)));
    }
  }
}

function showStatus(message, type = '') {
  const status = document.getElementById('newProjectStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status show ${type}`.trim();
}

function clearForm() {
  const name = document.getElementById('newProjectNameInput');
  const address = document.getElementById('newProjectAddressInput');
  if (name) name.value = '';
  if (address) address.value = '';
  const status = document.getElementById('newProjectStatus');
  if (status) {
    status.textContent = '';
    status.className = 'project-restore-status';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderProjectList() {
  const current = getCurrentProject();
  const header = document.getElementById('caseHeaderTitle');
  if (header) header.textContent = formatProjectLabel(current);

  const list = document.getElementById('projectList');
  if (!list) return;

  const projects = getProjectList();
  if (!projects.length) {
    list.innerHTML = '<div class="hint" style="padding:16px 4px">案件がありません</div>';
    return;
  }

  list.innerHTML = projects.map((project) => {
    const active = project.projectId === current?.projectId;
    const address = project.address ? `<span>${escapeHtml(project.address)}</span>` : '';
    const deleteButton = project.isSample ? '' : `
      <button type="button"
        class="project-delete-btn"
        data-project-delete-id="${escapeHtml(project.projectId)}"
        title="${project.environment === 'test' ? 'テスト案件を完全削除' : '端末から削除'}"
        aria-label="${project.environment === 'test' ? 'テスト案件を完全削除' : '端末から削除'}">×</button>`;
    return `
      <div class="project-card${active ? ' active' : ''}">
        <button type="button"
          class="project-card-open"
          data-project-open-id="${escapeHtml(project.projectId)}"
          ${active ? 'aria-current="true"' : ''}>
          <strong>${escapeHtml(formatProjectLabel(project))}</strong>
          ${address}
        </button>
        ${deleteButton}
      </div>
    `;
  }).join('');
}

function isTestProject(project) {
  return project?.environment === 'test';
}

async function deleteProject(projectId) {
  const id = String(projectId || '');
  if (!id || id === sampleProject.projectId) return;

  const current = getCurrentProject();
  if (current?.projectId === id) {
    saveCurrentProjectSession();
    stopProjectRecordStream();
  }

  const entry = getProject(id);
  const project = entry?.project;
  if (!project) return;

  const unsentCount = listUnsent({ projectId: id }).length;
  const testProject = isTestProject(project);
  const scopeText = testProject
    ? 'このテスト案件を端末とFirestoreから完全に削除します。'
    : 'この案件をこの端末から削除します。Firestoreの案件データは残ります。';
  const unsentText = unsentCount
    ? `\n\n未送信の変更が${unsentCount}件あります。削除するとこの端末の未送信データは失われます。`
    : '';

  if (!window.confirm(`${formatProjectLabel(project)}\n\n${scopeText}${unsentText}\n\n削除しますか？`)) return;

  try {
    if (testProject) await deleteTestProjectFromFirestore(project);

    const photoIds = (entry.photoRecords || []).map((record) => record?.photoId).filter(Boolean);
    try {
      await deleteLocalPhotoData(photoIds);
    } catch (error) {
      console.warn('[v0.1.6.2] 写真キャッシュ削除失敗', error);
    }

    clearUnsentForProject(id);
    clearProjectBoardSettings(id);
    removeProject(id);

    if (current?.projectId === id) {
      const sample = getProject(sampleProject.projectId);
      if (sample) openProjectSession(sample);
    }

    renderProjectList();
  } catch (error) {
    console.error('[v0.1.6.2] 案件削除失敗', error);
    window.alert(testProject
      ? 'テスト案件をFirestoreから削除できませんでした。端末内の案件は残しています。'
      : '案件を端末から削除できませんでした。');
  }
}

/**
 * projectIdから案件を開く正式な共通入口。
 * 端末内案件一覧・Firestore案件一覧のどちらもこの関数を使う。
 */
export async function openProjectById(projectId) {
  const targetId = String(projectId || '');
  const current = getCurrentProject();
  if (!targetId || targetId === current?.projectId) {
    closeProjectPanel();
    return;
  }

  saveCurrentProjectSession();
  stopProjectRecordStream();

  const target = getProject(targetId);
  if (!target) return;

  try {
    if (target.project?.isSample) {
      openProjectSession(target);
      markLocalOnly();
    } else {
      await openFirestoreProjectSession(target);
    }
    closeProjectPanel();
  } catch (error) {
    stopProjectRecordStream();
    markError(error);
    console.error('[v0.1.6.2] Firestore案件購読失敗', error);
    window.alert('Firestoreから案件を読み込めませんでした。通信状態を確認してください。端末内の状態は保持されています。');
  }
}

async function createProjectFromForm() {
  const button = document.getElementById('createNewProjectButton');
  const projectName = document.getElementById('newProjectNameInput')?.value || '';
  const address = document.getElementById('newProjectAddressInput')?.value || '';

  try {
    if (button) button.disabled = true;
    showStatus('案件番号と初期仕上表を準備しています…');

    saveCurrentProjectSession();
    stopProjectRecordStream();

    const dateCode = temporaryDateCode();
    let remoteProjectNos = [];
    try {
      remoteProjectNos = await getRemoteTemporaryProjectNos(dateCode, 'production');
    } catch (error) {
      console.warn('[v0.1.6.2] Firestore仮番号確認失敗。端末内番号だけで採番します。', error);
    }

    const project = createTemporaryProject({
      projectName,
      address,
      existingProjects: getProjectList(),
      existingProjectNos: remoteProjectNos
    });
    const finishRecords = createDefaultFinishRecords();

    saveProjectSnapshot({
      project,
      finishRecords,
      materialRecords: [],
      photoRecords: []
    });

    openProjectSession({
      project,
      finishRecords,
      materialRecords: [],
      photoRecords: []
    });

    await persistProjectMetadataForProject(project, { initializeChangeLog: true });

    stopProjectRecordStream();
    const createdTarget = getProject(project.projectId);
    if (createdTarget) await openFirestoreProjectSession(createdTarget);

    closeModal('newProjectModal');
    closeProjectPanel();
    clearForm();
  } catch (error) {
    showStatus(error?.message || '新規案件を作成できませんでした。', 'warn');
  } finally {
    if (button) button.disabled = false;
  }
}

async function recoverCurrentProjectAfterNetworkReturn() {
  if (!canUseFirestore()) return;
  const current = getCurrentProject();
  if (!current?.projectId || current.isSample) return;

  // 圏外中の正式Storeを先に案件Storeへ退避し、古いSnapshotでの巻き戻りを防ぐ。
  saveCurrentProjectSession();
  const target = getProject(current.projectId);
  if (!target) return;

  stopProjectRecordStream();
  try {
    await openFirestoreProjectSession(target);
  } catch (error) {
    console.error('[v0.1.6.3C] 通信復帰後の差分回収失敗', error);
    markError(error);
  }
}

export async function setProjectManualOfflineMode(enabled) {
  const next = Boolean(enabled);
  const current = getCurrentProject();

  if (next) {
    saveCurrentProjectSession();
    stopProjectRecordStream();
    setManualOffline(true);
    return;
  }

  // 手動オフライン中の編集を解除前に案件Storeへ退避する。
  saveCurrentProjectSession();
  setManualOffline(false);
  if (!current?.projectId || current.isSample) {
    markLocalOnly();
    return;
  }

  const target = getProject(current.projectId);
  if (!target) return;
  stopProjectRecordStream();
  await openFirestoreProjectSession(target);
}

export function captureInitialProjectSession() {
  saveCurrentProjectSession();
  renderProjectList();
}

export function initializeProjectManagement() {
  if (getCurrentProject()?.isSample) markLocalOnly();

  if (document.documentElement.dataset.manualOfflineEventBound !== '1') {
    document.documentElement.dataset.manualOfflineEventBound = '1';
    window.addEventListener('chousa:manual-offline-change', (event) => {
      setProjectManualOfflineMode(Boolean(event.detail?.enabled)).catch((error) => {
        console.error('[v0.1.6.2] オフラインモード切替失敗', error);
        window.alert('オフラインモードを切り替えられませんでした。');
      });
    });
  }

  if (document.documentElement.dataset.cloudAuthRecoveryBound !== '1') {
    document.documentElement.dataset.cloudAuthRecoveryBound = '1';
    window.addEventListener('chousa:auth-state-change', (event) => {
      const cloudReady = Boolean(event.detail?.cloudReady);
      if (!cloudReady) {
        saveCurrentProjectSession();
        stopProjectRecordStream();
        markLocalOnly();
        return;
      }
      void recoverCurrentProjectAfterNetworkReturn();
    });
  }

  if (document.documentElement.dataset.firestoreNetworkRecoveryBound !== '1') {
    document.documentElement.dataset.firestoreNetworkRecoveryBound = '1';
    window.addEventListener('offline', () => {
      syncDiagnosticLog('BROWSER_OFFLINE_EVENT', { projectId: getCurrentProject()?.projectId || '' });
      if (isManualOffline()) return;
      saveCurrentProjectSession();
      stopProjectRecordStream();
    });
    window.addEventListener('online', () => {
      syncDiagnosticLog('BROWSER_ONLINE_EVENT', { projectId: getCurrentProject()?.projectId || '' });
      recoverCurrentProjectAfterNetworkReturn();
    });
  }

  const createButton = document.getElementById('createNewProjectButton');
  if (createButton && createButton.dataset.eventsBound !== '1') {
    createButton.dataset.eventsBound = '1';
    createButton.addEventListener('click', createProjectFromForm);
  }

  const modal = document.getElementById('newProjectModal');
  if (modal && modal.dataset.projectEventsBound !== '1') {
    modal.dataset.projectEventsBound = '1';
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        createProjectFromForm();
      }
    });
  }

  const list = document.getElementById('projectList');
  if (list && list.dataset.eventsBound !== '1') {
    list.dataset.eventsBound = '1';
    list.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('[data-project-delete-id]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        deleteProject(deleteButton.dataset.projectDeleteId);
        return;
      }

      const openButton = event.target.closest('[data-project-open-id]');
      if (!openButton) return;
      void openProjectById(openButton.dataset.projectOpenId);
    });
  }

  renderProjectList();
  subscribe(renderProjectList);
}
