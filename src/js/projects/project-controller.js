/**
 * src/js/projects/project-controller.js
 *
 * 案件画面の保存・Firestore復元・リアルタイム購読の正式入口。
 * 案件一覧、新規作成、OneDrive案件選択などトップページ側の責務は持たない。
 */
import { openProjectSession, saveCurrentProjectSession, refreshOpenProjectSessionViews } from './project-session.js';
import {
  getCurrentProject,
  getProject,
  saveProjectSnapshot,
  getProjectSyncMeta,
  updateProjectSyncMeta
} from './project-store.js';
import {
  readProjectRecordsForProject,
  subscribeRealtimeProjectRecordsForProject,
  newestCursorsFromChanges,
  latestCursorValue,
  hydrateIncomingMaterialRecord,
  hydrateIncomingPhotoRecord,
  applyKnownFinishChange,
  restoreKnownFinishRecords,
  firestoreTimeToMillis,
  touchProjectSyncDeviceForProject,
  cleanupFinishChangeLogsForProject
} from '../sync/project-record-persistence.js';
import { refreshMaterialUsageDerivedFields } from '../finish-table/finish-table-actions.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
import { listUnsent } from '../sync/unsent-queue.js';
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
  syncDiagnosticLog('SYNC_STREAM_STOP_REQUEST', {
    hadActiveStream: Boolean(stopActiveProjectRecords),
    nextToken: activeProjectStreamToken + 1
  });
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
  return changes.reduce(
    (max, change) => Math.max(max, firestoreTimeToMillis(change?.record?.updatedAt)),
    0
  );
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
    console.warn('[v0.1.6.5F] finish変更履歴の整理に失敗', error);
  }
}

function getProjectRecordCursors(projectId) {
  return normalizeRecordCursors(getProjectSyncMeta(projectId)?.recordCursors || {});
}

function updateProjectSyncCursors(projectId, cursors = {}, { completed = false, source = 'unspecified' } = {}) {
  if (!projectId) return;
  const current = getProjectRecordCursors(projectId);
  const next = {
    finish: Math.max(current.finish, Number(cursors.finish || 0)),
    material: Math.max(current.material, Number(cursors.material || 0)),
    photo: Math.max(current.photo, Number(cursors.photo || 0))
  };
  syncDiagnosticLog('SYNC_CURSOR_BEFORE', {
    projectId,
    source,
    current,
    incoming: normalizeRecordCursors(cursors)
  });
  const lastSyncedAt = latestCursorValue(next);
  updateProjectSyncMeta(projectId, {
    recordCursors: next,
    lastSyncedAt,
    hasSyncedOnce: true,
    ...(completed ? { lastSyncCompletedAt: Date.now() } : {})
  });
  syncDiagnosticLog('SYNC_CURSOR_AFTER', { projectId, source, next, lastSyncedAt });
  if (getCurrentProject()?.projectId === projectId) setLastSyncedAt(lastSyncedAt);
}

function applyProjectRecordChanges(project, changes = []) {
  const currentProjectId = getCurrentProject()?.projectId || '';
  if (!project?.projectId || currentProjectId !== project.projectId) {
    syncDiagnosticLog('SYNC_APPLY_SKIPPED_PROJECT', {
      projectId: project?.projectId || '',
      currentProjectId,
      changeCount: changes.length,
      reason: 'wrongProject'
    });
    return { applied: 0, skipped: changes.length, persisted: false };
  }

  const unsentKeys = new Set(
    listUnsent({ projectId: project.projectId })
      .map((item) => `${item.recordType}|${item.recordId}`)
  );
  const safeChanges = [];
  let skipped = 0;

  syncDiagnosticLog('SYNC_APPLY_START', {
    projectId: project.projectId,
    incoming: changes.map((change) => ({
      recordType: change.recordType,
      changeType: change.changeType,
      id: String(change.id || '')
    })),
    materialIdsBefore: materialRecordStore.exportSnapshot()
      .map((record) => String(record.materialId || ''))
      .filter(Boolean),
    unsentKeys: [...unsentKeys],
    cursorBefore: getProjectRecordCursors(project.projectId)
  });

  changes.forEach((change) => {
    const key = `${change.recordType}|${change.id}`;
    if (unsentKeys.has(key)) {
      skipped += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: change.recordType,
        recordId: String(change.id || ''),
        result: 'skipped',
        reason: 'unsent'
      });
      return;
    }
    safeChanges.push(change);
  });

  let changed = false;
  let applied = 0;
  const materialChanges = safeChanges.filter((item) => item.recordType === 'material');
  if (materialChanges.length) {
    let rawMaterials = materialRecordStore.exportSnapshot();
    let materialChanged = false;
    materialChanges.forEach((change) => {
      const id = String(change.id || change.record?.materialId || '');
      if (!id) {
        skipped += 1;
        syncDiagnosticLog('SYNC_APPLY_CHANGE', {
          projectId: project.projectId,
          recordType: 'material',
          recordId: '',
          result: 'skipped',
          reason: 'invalidRecord'
        });
        return;
      }
      const current = materialRecordStore.get(id);
      if (change.changeType !== 'removed'
        && current
        && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) {
        skipped += 1;
        syncDiagnosticLog('SYNC_APPLY_CHANGE', {
          projectId: project.projectId,
          recordType: 'material',
          recordId: id,
          result: 'skipped',
          reason: 'sameFieldEditedAt'
        });
        return;
      }
      rawMaterials = rawMaterials.filter((record) => String(record.materialId) !== id);
      if (change.changeType !== 'removed' && change.record) rawMaterials.push(change.record);
      materialChanged = true;
      changed = true;
      applied += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'material',
        recordId: id,
        result: 'applied',
        changeType: change.changeType
      });
    });
    if (materialChanged) {
      materialRecordStore.replaceAll(hydrateIncomingMaterialRecord(null, rawMaterials), { notify: false });
    }
  }

  let finishChanged = false;
  safeChanges.filter((item) => item.recordType === 'finish').forEach((change) => {
    const id = String(change.id || change.record?.finishId || '');
    if (!id) {
      skipped += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'finish',
        recordId: '',
        result: 'skipped',
        reason: 'invalidRecord'
      });
      return;
    }
    const current = finishRecordStore.get(id);
    if (change.changeType !== 'removed'
      && current
      && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) {
      skipped += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'finish',
        recordId: id,
        result: 'skipped',
        reason: 'sameFieldEditedAt'
      });
      return;
    }
    applyKnownFinishChange(project.projectId, change);
    finishChanged = true;
    applied += 1;
    syncDiagnosticLog('SYNC_APPLY_CHANGE', {
      projectId: project.projectId,
      recordType: 'finish',
      recordId: id,
      result: 'applied',
      changeType: change.changeType
    });
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
    if (!id) {
      skipped += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'photo',
        recordId: '',
        result: 'skipped',
        reason: 'invalidRecord'
      });
      return;
    }
    const current = photoRecordStore.get(id);
    if (change.changeType !== 'removed'
      && current
      && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) {
      skipped += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'photo',
        recordId: id,
        result: 'skipped',
        reason: 'sameFieldEditedAt'
      });
      return;
    }
    if (change.changeType === 'removed') {
      photoRecordStore.replaceAll(
        photoRecordStore.exportSnapshot().filter((record) => record.photoId !== id),
        { notify: false }
      );
      changed = true;
      applied += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'photo',
        recordId: id,
        result: 'applied',
        changeType: 'removed'
      });
      return;
    }
    const normalized = hydrateIncomingPhotoRecord(change.record);
    if (normalized) {
      photoRecordStore.set(normalized);
      changed = true;
      applied += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'photo',
        recordId: id,
        result: 'applied',
        changeType: change.changeType
      });
    } else {
      skipped += 1;
      syncDiagnosticLog('SYNC_APPLY_CHANGE', {
        projectId: project.projectId,
        recordType: 'photo',
        recordId: id,
        result: 'skipped',
        reason: 'invalidRecord'
      });
    }
  });

  syncDiagnosticLog('SYNC_STORE_AFTER', {
    projectId: project.projectId,
    applied,
    skipped,
    changed,
    finishCount: finishRecordStore.exportSnapshot().length,
    materialCount: materialRecordStore.exportSnapshot().length,
    photoCount: photoRecordStore.exportSnapshot().length,
    materialIds: materialRecordStore.exportSnapshot()
      .map((record) => String(record.materialId || ''))
      .filter(Boolean)
  });

  if (!changed) return { applied, skipped, persisted: false };
  saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot(),
    source: 'listener-apply'
  });
  refreshOpenProjectSessionViews();
  return { applied, skipped, persisted: true };
}

function typeModeReasons(typeModes, storedCursors, target, remote) {
  return {
    finish: typeModes.finish === 'delta'
      ? `delta:${remote.finishHistoryMode || 'history'}'
      : `full:${remote.finishHistoryMode || 'baseline-unavailable'}`,
    material: typeModes.material === 'delta'
      ? `delta:local-baseline+cursor-${Number(storedCursors.material || 0)}`
      : `full:cursor-${Number(storedCursors.material || 0)}-snapshot-${target.materialRecords?.length || 0}`,
    photo: typeModes.photo === 'delta'
      ? `delta:local-baseline+cursor-${Number(storedCursors.photo || 0)}`
      : `full:cursor-${Number(storedCursors.photo || 0)}-snapshot-${target.photoRecords?.length || 0}`
  };
}

async function openFirestoreProjectSession(target) {
  const project = target.project;
  syncDiagnosticLog('SYNC_OPEN_START', {
    projectId: project?.projectId || '',
    projectName: project?.projectName || ''
  });
  const token = ++activeProjectStreamToken;
  const syncMeta = target.syncMeta || getProjectSyncMeta(project.projectId) || {};
  const storedCursors = normalizeRecordCursors(syncMeta.recordCursors || {});
  const finishChangeCursor = normalizeFinishChangeCursor(syncMeta.finishChangeCursor);
  const legacyLastSyncedAt = Number(syncMeta.lastSyncedAt || 0);
  const cursors = storedCursors;
  const hasSyncHistory = Boolean(syncMeta.hasSyncedOnce || legacyLastSyncedAt > 0);
  const hasFinishBaseline = Array.isArray(target.finishRecords) && target.finishRecords.length > 0;
  const useLocalSnapshot = hasSyncHistory && hasFinishBaseline;

  syncDiagnosticLog('SYNC_BASELINE_CHECK', {
    projectId: project.projectId,
    hasSyncHistory,
    hasFinishBaseline,
    useLocalSnapshot,
    finishSnapshotCount: target.finishRecords?.length || 0,
    materialSnapshotCount: target.materialRecords?.length || 0,
    photoSnapshotCount: target.photoRecords?.length || 0,
    storedCursors,
    finishChangeCursor,
    reason: useLocalSnapshot
      ? 'sync-history-and-finish-baseline'
      : (!hasSyncHistory ? 'no-sync-history' : 'no-finish-baseline')
  });

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
    const typeModes = remote.typeModes || {
      finish: remote.mode,
      material: remote.mode,
      photo: remote.mode
    };
    syncDiagnosticLog('SYNC_TYPE_READ_PLAN', {
      projectId: project.projectId,
      typeModes,
      reasons: typeModeReasons(typeModes, storedCursors, target, remote),
      snapshotCounts: {
        finish: target.finishRecords?.length || 0,
        material: target.materialRecords?.length || 0,
        photo: target.photoRecords?.length || 0
      },
      cursors: storedCursors
    });
    syncDiagnosticLog('SYNC_CATCHUP_RESULT', {
      projectId: project.projectId,
      mode: remote.mode,
      typeModes,
      changes: remote.changes?.length || 0,
      finishRecords: remote.finishRecords?.length || 0,
      materialRecords: remote.materialRecords?.length || 0,
      photoRecords: remote.photoRecords?.length || 0,
      finishHistoryMode: remote.finishHistoryMode || ''
    });
    if (token !== activeProjectStreamToken) {
      syncDiagnosticLog('SYNC_CATCHUP_DISCARDED_TOKEN', {
        projectId: project.projectId,
        token,
        activeProjectStreamToken
      });
      return target;
    }

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
        },
        source: 'initial-firestore-restore'
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
          },
          source: 'catchup-full-type-replace'
        });
        refreshOpenProjectSessionViews();
      }

      if (typeModes.finish === 'full') {
        refreshMaterialUsageDerivedFields('remote-rebuild', { persist: false });
        refreshMaterialList();
      }
    }

    const caughtUpCursors = normalizeRecordCursors(remote.cursors || cursors);
    updateProjectSyncCursors(project.projectId, caughtUpCursors, {
      completed: true,
      source: 'catchup'
    });
    if (remote.finishChangeCursor) {
      updateFinishChangeCursor(project.projectId, remote.finishChangeCursor);
    }

    void recordProjectDeviceContact(project, remote.finishChangeCursor || finishChangeCursor);
    void cleanupFinishChangeLogIfDue(project);

    const serverReadyTypes = new Set();
    syncDiagnosticLog('SYNC_LISTENER_START', {
      projectId: project.projectId,
      caughtUpCursors,
      finishChangeCursor: normalizeFinishChangeCursor(remote.finishChangeCursor || finishChangeCursor)
    });
    const stop = subscribeRealtimeProjectRecordsForProject(project, {
      afterByType: caughtUpCursors,
      finishChangeCursor: normalizeFinishChangeCursor(remote.finishChangeCursor || finishChangeCursor),
      onFinishCursor: (cursor) => {
        syncDiagnosticLog('SYNC_FINISH_CURSOR_ADVANCE', { projectId: project.projectId, cursor });
        if (token !== activeProjectStreamToken) return;
        updateFinishChangeCursor(project.projectId, cursor);
      },
      onState: ({ recordType, fromCache }) => {
        syncDiagnosticLog('SYNC_LISTENER_STATE', {
          projectId: project.projectId,
          recordType,
          fromCache
        });
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
        syncDiagnosticLog('SYNC_LISTENER_CHANGES', {
          projectId: project.projectId,
          count: changes?.length || 0,
          types: (changes || []).map((change) => `${change.recordType}:${change.changeType}`)
        });
        if (token !== activeProjectStreamToken) return;
        beginFirestoreActivity();
        try {
          const applyResult = applyProjectRecordChanges(project, changes);
          syncDiagnosticLog('SYNC_LISTENER_APPLY_RESULT', {
            projectId: project.projectId,
            ...applyResult
          });
          const nextCursors = newestCursorsFromChanges(
            changes,
            getProjectRecordCursors(project.projectId)
          );
          updateProjectSyncCursors(project.projectId, nextCursors, {
            source: 'listener-received-changes'
          });
        } finally {
          endFirestoreActivity(newestChangeUpdatedAt(changes));
        }
      },
      onError: (error) => {
        syncDiagnosticLog('SYNC_LISTENER_ERROR', {
          projectId: project.projectId,
          message: error?.message || String(error)
        });
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
    syncDiagnosticLog('SYNC_OPEN_ERROR', {
      projectId: project.projectId,
      message: error?.message || String(error)
    });
    if (token === activeProjectStreamToken) markError(error);
    throw error;
  } finally {
    if (token === activeProjectStreamToken) {
      endFirestoreActivity(latestCursorValue(getProjectRecordCursors(project.projectId)));
    }
  }
}

export async function openProjectById(projectId) {
  const targetId = String(projectId || '');
  const current = getCurrentProject();
  if (!targetId || targetId === current?.projectId) return;

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
  } catch (error) {
    stopProjectRecordStream();
    markError(error);
    console.error('[v0.1.6.5F] Firestore案件購読失敗', error);
    window.alert('Firestoreから案件を読み込めませんでした。通信状態を確認してください。端末内の状態は保持されています。');
  }
}

async function recoverCurrentProjectAfterNetworkReturn() {
  if (!canUseFirestore()) return;
  const current = getCurrentProject();
  if (!current?.projectId || current.isSample) return;

  saveCurrentProjectSession();
  const target = getProject(current.projectId);
  if (!target) return;

  stopProjectRecordStream();
  try {
    await openFirestoreProjectSession(target);
  } catch (error) {
    console.error('[v0.1.6.5F] 通信復帰後の差分回収失敗', error);
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
}

export function initializeProjectManagement() {
  if (getCurrentProject()?.isSample) markLocalOnly();

  if (document.documentElement.dataset.manualOfflineEventBound !== '1') {
    document.documentElement.dataset.manualOfflineEventBound = '1';
    window.addEventListener('chousa:manual-offline-change', (event) => {
      setProjectManualOfflineMode(Boolean(event.detail?.enabled)).catch((error) => {
        console.error('[v0.1.6.5F] オフラインモード切替失敗', error);
        window.alert('オフラインモードを切り替えられませんでした。');
      });
    });
  }

  if (document.documentElement.dataset.firestoreNetworkRecoveryBound !== '1') {
    document.documentElement.dataset.firestoreNetworkRecoveryBound = '1';
    window.addEventListener('offline', () => {
      syncDiagnosticLog('BROWSER_OFFLINE_EVENT', {
        projectId: getCurrentProject()?.projectId || ''
      });
      if (isManualOffline()) return;
      saveCurrentProjectSession();
      stopProjectRecordStream();
    });
    window.addEventListener('online', () => {
      syncDiagnosticLog('BROWSER_ONLINE_EVENT', {
        projectId: getCurrentProject()?.projectId || ''
      });
      void recoverCurrentProjectAfterNetworkReturn();
    });
  }
}
