/**
 * src/js/projects/project-controller.js
 *
 * 案件画面の保存・Firestore復元・リアルタイム購読の正式入口。
 * 案件一覧、新規作成、OneDrive案件選択などトップページ側の責務は持たない。
 */
import {
  openProjectSession,
  saveCurrentProjectSession,
  refreshProjectViewsForChanges
} from './project-session.js';
import {
  getCurrentProject,
  getProject,
  getProjectList,
  saveProjectSnapshot,
  getProjectSyncMeta,
  updateProjectFields
} from './project-store.js';
import {
  readProjectRecordsForProject,
  subscribeRealtimeProjectRecordsForProject,
  newestCursorsFromChanges,
  latestCursorValue,
  readProjectMetadataForProject,
  subscribeProjectMetadataForProject,
  persistProjectMetadataForProject,
  getRemoteTemporaryProjectEntries,
  syncQueuedProjectMetadataOnRecovery,
  syncQueuedRecordsOnRecovery
} from '../sync/project-record-persistence.js';
import { refreshMaterialUsageDerivedFields } from '../finish-table/material-usage-derived.js';
import { nextTemporaryProjectNo } from './project-factory.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
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
  setSyncBaseline
} from '../sync/sync-status.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';
import { applyProjectRecordChanges } from './project-record-apply.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import { refreshSettingsTab } from '../settings/settings-controller.js';
import {
  createFullTypeProjectViewImpact
} from './project-view-impact.js';
import {
  newestProjectChangeUpdatedAt,
  normalizeProjectRecordCursors,
  normalizeProjectFinishChangeCursor,
  updateProjectFinishChangeCursor,
  recordProjectSyncDeviceContact,
  cleanupProjectFinishChangeLogIfDue,
  getProjectRecordCursors,
  updateProjectRecordCursors
} from './project-sync-meta.js';

let stopActiveProjectRecords = null;
let activeProjectStreamToken = 0;

/**
 * 現在のFirestore Realtime購読を停止し、購読解除関数を破棄する。案件切替・手動オフライン化・再接続前に必ず呼ぶ。
 */
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

/**
 * 初回読込結果からRecord種別ごとにfull/deltaになった理由を診断用に整理する。同期挙動のログ確認用。
 */
function typeModeReasons(typeModes, storedCursors, target, remote) {
  return {
    finish: typeModes.finish === 'delta'
      ? `delta:${remote.finishHistoryMode || 'history'}`
      : `full:${remote.finishHistoryMode || 'baseline-unavailable'}`,
    material: typeModes.material === 'delta'
      ? `delta:local-baseline+cursor-${Number(storedCursors.material || 0)}`
      : `full:cursor-${Number(storedCursors.material || 0)}-snapshot-${target.materialRecords?.length || 0}`,
    photo: typeModes.photo === 'delta'
      ? `delta:local-baseline+cursor-${Number(storedCursors.photo || 0)}`
      : `full:cursor-${Number(storedCursors.photo || 0)}-snapshot-${target.photoRecords?.length || 0}`
  };
}

async function resolveTemporaryProjectNoCollision(project) {
  if (!project?.isTemporary || !canUseFirestore()) return project;
  const match = /^(\d{6})-\d+$/.exec(String(project.projectNo || ''));
  if (!match) return project;

  const dateCode = match[1];
  try {
    const remoteEntries = await getRemoteTemporaryProjectEntries(
      dateCode,
      project.environment === 'test' ? 'test' : 'production'
    );
    const conflict = remoteEntries.some((item) =>
      String(item.projectNo || '') === String(project.projectNo || '')
      && String(item.projectId || '') !== String(project.projectId || '')
    );
    if (!conflict) return project;

    const localProjects = getProjectList()
      .filter((item) => String(item.projectId || '') !== String(project.projectId || ''));
    const nextProjectNo = nextTemporaryProjectNo(
      dateCode,
      localProjects,
      remoteEntries.map((item) => item.projectNo)
    );
    const nextProject = updateProjectFields(project.projectId, { projectNo: nextProjectNo }) || {
      ...project,
      projectNo: nextProjectNo
    };
    boardSettingsStore.applyProjectMetadata(nextProject);
    syncDiagnosticLog('TEMP_PROJECT_NO_REASSIGNED', {
      projectId: project.projectId,
      before: project.projectNo,
      after: nextProjectNo
    });
    return nextProject;
  } catch (error) {
    syncDiagnosticLog('TEMP_PROJECT_NO_COLLISION_CHECK_ERROR', {
      projectId: project.projectId,
      projectNo: project.projectNo,
      message: error?.message || String(error)
    });
    return project;
  }
}

/**
 * 選択案件をFirestore正本として開く中核処理。初回Record読込→Store反映→cursor保存→Realtime購読開始→端末接触/履歴整理まで一連で行う。
 */
async function openFirestoreProjectSession(target) {
  let project = target.project;
  const token = ++activeProjectStreamToken;
  syncDiagnosticLog('SYNC_OPEN_START', {
    projectId: project?.projectId || '',
    projectName: project?.projectName || ''
  });

  if (canUseFirestore()) {
    project = await resolveTemporaryProjectNoCollision(project);
    target.project = project;

    const projectQueueResult = await syncQueuedProjectMetadataOnRecovery(project);
    syncDiagnosticLog('PROJECT_UNSENT_RECOVERY_RESULT', {
      projectId: project.projectId,
      ...projectQueueResult
    });

    try {
      const remoteProject = await readProjectMetadataForProject(project);
      if (token !== activeProjectStreamToken) return target;
      if (remoteProject) {
        project = {
          ...project,
          ...remoteProject,
          projectId: project.projectId,
          environment: project.environment || remoteProject.environment || 'production'
        };
        target.project = project;
        updateProjectFields(project.projectId, project);
        syncDiagnosticLog('PROJECT_METADATA_INITIAL_APPLY', {
          projectId: project.projectId,
          projectNo: project.projectNo,
          projectName: project.projectName
        });
      }
    } catch (error) {
      syncDiagnosticLog('PROJECT_METADATA_INITIAL_READ_ERROR', {
        projectId: project?.projectId || '',
        message: error?.message || String(error)
      });
    }
  }

  const syncMeta = target.syncMeta || getProjectSyncMeta(project.projectId) || {};
  const storedCursors = normalizeProjectRecordCursors(syncMeta.recordCursors || {});
  const finishChangeCursor = normalizeProjectFinishChangeCursor(syncMeta.finishChangeCursor);
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
          recordCursors: normalizeProjectRecordCursors(remote.cursors),
          finishChangeCursor: normalizeProjectFinishChangeCursor(remote.finishChangeCursor),
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
      const fullImpact = createFullTypeProjectViewImpact(typeModes, remote.photoRecords || []);

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
        // finish全件復元に伴う建材の使用箇所等を、画面振り分けより先に最新化する。
        refreshMaterialUsageDerivedFields('remote-rebuild', { persist: false });
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
            recordCursors: normalizeProjectRecordCursors(remote.cursors),
            finishChangeCursor: normalizeProjectFinishChangeCursor(remote.finishChangeCursor),
            lastSyncedAt: Number(remote.lastSyncedAt || 0),
            hasSyncedOnce: true,
            lastSyncCompletedAt: Date.now()
          },
          source: 'catchup-full-type-replace'
        });
        // full取得でも全画面refreshへ戻さない。置換されたRecord種別の影響だけを反映する。
        refreshProjectViewsForChanges(fullImpact);
      }
    }

    // M-06: 旧案件でFirestoreにboardSettingsがまだ無い場合だけ、
    // 現端末の従来localStorage看板設定を正本へ1回昇格する。
    if (!project.boardSettings) {
      const cachedBoard = boardSettingsStore.get();
      const migratedBoard = {
        surveyDate: String(cachedBoard.surveyDate || ''),
        surveyor: String(cachedBoard.surveyor || ''),
        subjectText: String(cachedBoard.subjectText || project.projectName || ''),
        addressText: String(cachedBoard.addressText || project.address || ''),
        subjectFontSize: Number(cachedBoard.subjectFontSize) || 18,
        addressFontSize: Number(cachedBoard.addressFontSize) || 17
      };
      project = {
        ...project,
        surveyDate: migratedBoard.surveyDate,
        surveyor: migratedBoard.surveyor,
        boardSettings: migratedBoard
      };
      target.project = project;
      updateProjectFields(project.projectId, project);
      try {
        await persistProjectMetadataForProject(project);
        syncDiagnosticLog('PROJECT_METADATA_BOARD_MIGRATED', {
          projectId: project.projectId
        });
      } catch (error) {
        syncDiagnosticLog('PROJECT_METADATA_BOARD_MIGRATE_ERROR', {
          projectId: project.projectId,
          message: error?.message || String(error)
        });
      }
    }

    const recordQueueResult = await syncQueuedRecordsOnRecovery(project);
    syncDiagnosticLog('RECORD_UNSENT_RECOVERY_RESULT', {
      projectId: project.projectId,
      ...recordQueueResult
    });

    const caughtUpCursors = normalizeProjectRecordCursors(remote.cursors || cursors);
    updateProjectRecordCursors(project.projectId, caughtUpCursors, {
      completed: true,
      source: 'catchup'
    });
    if (remote.finishChangeCursor) {
      updateProjectFinishChangeCursor(project.projectId, remote.finishChangeCursor);
    }

    void recordProjectSyncDeviceContact(project, remote.finishChangeCursor || finishChangeCursor);
    void cleanupProjectFinishChangeLogIfDue(project);

    const serverReadyTypes = new Set();
    syncDiagnosticLog('SYNC_LISTENER_START', {
      projectId: project.projectId,
      caughtUpCursors,
      finishChangeCursor: normalizeProjectFinishChangeCursor(remote.finishChangeCursor || finishChangeCursor)
    });
    const stop = subscribeRealtimeProjectRecordsForProject(project, {
      afterByType: caughtUpCursors,
      finishChangeCursor: normalizeProjectFinishChangeCursor(remote.finishChangeCursor || finishChangeCursor),
      onFinishCursor: (cursor) => {
        syncDiagnosticLog('SYNC_FINISH_CURSOR_ADVANCE', { projectId: project.projectId, cursor });
        if (token !== activeProjectStreamToken) return;
        updateProjectFinishChangeCursor(project.projectId, cursor);
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
          updateProjectRecordCursors(project.projectId, nextCursors, {
            source: 'listener-received-changes'
          });
        } finally {
          endFirestoreActivity(newestProjectChangeUpdatedAt(changes));
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

    const stopMetadata = subscribeProjectMetadataForProject(project, {
      onProject: (remoteProject) => {
        if (token !== activeProjectStreamToken) return;
        const current = getCurrentProject();
        if (!current?.projectId || current.projectId !== project.projectId) return;
        const nextProject = updateProjectFields(project.projectId, {
          ...remoteProject,
          projectId: project.projectId,
          environment: project.environment
        });
        if (!nextProject) return;
        boardSettingsStore.applyProjectMetadata(nextProject);
        refreshSettingsTab();
        syncDiagnosticLog('PROJECT_METADATA_REALTIME_APPLY', {
          projectId: project.projectId,
          projectNo: nextProject.projectNo,
          projectName: nextProject.projectName
        });
      },
      onState: ({ fromCache }) => {
        syncDiagnosticLog('PROJECT_METADATA_LISTENER_STATE', {
          projectId: project.projectId,
          fromCache
        });
      },
      onError: (error) => {
        syncDiagnosticLog('PROJECT_METADATA_LISTENER_ERROR', {
          projectId: project.projectId,
          message: error?.message || String(error)
        });
      }
    });

    stopActiveProjectRecords = () => {
      syncDiagnosticLog('SYNC_LISTENER_STOP', { projectId: project.projectId });
      stopMetadata();
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

/**
 * 案件ID指定で案件を開く公開入口。ローカル案件情報を解決し、sample/Firestore案件など種別に応じたsession開始へ振り分ける。
 */
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

/**
 * オフラインからネットワーク復帰した時、現在案件の差分取得とRealtime購読を再開する。手動オフライン中は復帰しない。
 */
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

/**
 * ユーザー指定の手動オフライン状態を切り替える。ON時はRealtime購読を止め、OFF時は現在案件の同期回復を試みる。
 */
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

/**
 * アプリ起動時に現在案件の初期session状態を確定する。前回案件の復元や初期表示の基準を作る。
 */
export function captureInitialProjectSession() {
  saveCurrentProjectSession();
}

/**
 * 案件管理機能の初期化入口。ネットワークイベント・Store連携・初期案件sessionを一度だけ設定する。
 */
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
