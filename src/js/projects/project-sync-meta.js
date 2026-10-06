/**
 * Project同期のメタ情報・cursor・端末接触・change log整理を担当する。
 * Record Store更新やRealtime購読の開始停止は行わない。
 */
import {
  getCurrentProject,
  getProjectSyncMeta,
  updateProjectSyncMeta
} from './project-store.js';
import {
  latestCursorValue,
  firestoreTimeToMillis,
  touchProjectSyncDeviceForProject,
  cleanupFinishChangeLogsForProject
} from '../sync/project-record-persistence.js';
import { getDeviceCode, getDeviceDisplayName } from '../device-code.js';
import { setLastSyncedAt } from '../sync/sync-status.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

export function sameProjectFieldEditedAt(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export function newestProjectChangeUpdatedAt(changes = []) {
  return changes.reduce(
    (max, change) => Math.max(max, firestoreTimeToMillis(change?.record?.updatedAt)),
    0
  );
}

export function normalizeProjectRecordCursors(value = {}) {
  return {
    finish: Number(value.finish || 0),
    material: Number(value.material || 0),
    photo: Number(value.photo || 0)
  };
}

export function normalizeProjectFinishChangeCursor(value = null) {
  if (!value || typeof value.seconds !== 'number' || !value.changeId) return null;
  return {
    seconds: Number(value.seconds),
    nanoseconds: Number(value.nanoseconds || 0),
    changeId: String(value.changeId)
  };
}

export function updateProjectFinishChangeCursor(projectId, cursor) {
  const normalized = normalizeProjectFinishChangeCursor(cursor);
  if (!projectId || !normalized) return;
  updateProjectSyncMeta(projectId, {
    finishChangeCursor: normalized,
    hasSyncedOnce: true
  });
}

export async function recordProjectSyncDeviceContact(project, finishChangeCursor) {
  if (!project?.projectId || project.isSample) return;

  syncDiagnosticLog('DEVICE_CONTACT_START', {
    projectId: project.projectId,
    finishChangeCursor
  });

  const result = await touchProjectSyncDeviceForProject(project, {
    deviceCode: getDeviceCode(),
    deviceName: getDeviceDisplayName(),
    finishChangeCursor: normalizeProjectFinishChangeCursor(finishChangeCursor)
  });

  syncDiagnosticLog('DEVICE_CONTACT_END', {
    projectId: project.projectId,
    ok: result?.ok !== false
  });
  return result;
}

export async function cleanupProjectFinishChangeLogIfDue(project) {
  if (!project?.projectId || project.isSample) return;

  syncDiagnosticLog('CHANGELOG_CLEANUP_DUE_CHECK', {
    projectId: project.projectId
  });

  const meta = getProjectSyncMeta(project.projectId) || {};
  const last = Number(meta.finishChangeLogCleanedAt || 0);

  if (last && (Date.now() - last) < (24 * 60 * 60 * 1000)) {
    syncDiagnosticLog('CHANGELOG_CLEANUP_SKIP_RECENT', {
      projectId: project.projectId,
      last
    });
    return;
  }

  try {
    const cleanupResult = await cleanupFinishChangeLogsForProject(project);
    syncDiagnosticLog('CHANGELOG_CLEANUP_DONE', {
      projectId: project.projectId,
      cleanupResult
    });
    updateProjectSyncMeta(project.projectId, {
      finishChangeLogCleanedAt: Date.now()
    });
  } catch (error) {
    console.warn('finish変更履歴の整理に失敗', error);
  }
}

export function getProjectRecordCursors(projectId) {
  return normalizeProjectRecordCursors(
    getProjectSyncMeta(projectId)?.recordCursors || {}
  );
}

export function updateProjectRecordCursors(
  projectId,
  cursors = {},
  { completed = false, source = 'unspecified' } = {}
) {
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
    incoming: normalizeProjectRecordCursors(cursors)
  });

  const lastSyncedAt = latestCursorValue(next);

  updateProjectSyncMeta(projectId, {
    recordCursors: next,
    lastSyncedAt,
    hasSyncedOnce: true,
    ...(completed ? { lastSyncCompletedAt: Date.now() } : {})
  });

  syncDiagnosticLog('SYNC_CURSOR_AFTER', {
    projectId,
    source,
    next,
    lastSyncedAt
  });

  if (getCurrentProject()?.projectId === projectId) {
    setLastSyncedAt(lastSyncedAt);
  }
}
