/**
 * Realtime/差分取得で受けたProject Record変更をローカル3Storeへ適用する。
 * Realtime購読の開始停止やcursor更新は行わない。
 */
import {
  getCurrentProject,
  saveProjectSnapshot
} from './project-store.js';
import { refreshProjectViewsForChanges } from './project-session.js';
import {
  hydrateIncomingMaterialRecord,
  hydrateIncomingPhotoRecord,
  applyKnownFinishChange,
  restoreKnownFinishRecords
} from '../sync/project-record-persistence.js';
import { listUnsent } from '../sync/unsent-queue.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';
import {
  sameProjectFieldEditedAt,
  getProjectRecordCursors
} from './project-sync-meta.js';
import {
  createEmptyProjectViewImpact,
  registerFinishProjectViewImpact,
  registerMaterialProjectViewImpact,
  registerPhotoProjectViewImpact,
  serializeProjectViewImpact
} from './project-view-impact.js';

export function applyProjectRecordChanges(project, changes = []) {
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
  const viewImpact = createEmptyProjectViewImpact();

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
      if (
        change.changeType !== 'removed'
        && current
        && sameProjectFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)
      ) {
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

      registerMaterialProjectViewImpact(viewImpact, current, change);
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
      materialRecordStore.replaceAll(
        hydrateIncomingMaterialRecord(null, rawMaterials),
        { notify: false }
      );
    }
  }

  let finishChanged = false;
  safeChanges
    .filter((item) => item.recordType === 'finish')
    .forEach((change) => {
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
      if (
        change.changeType !== 'removed'
        && current
        && sameProjectFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)
      ) {
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

      registerFinishProjectViewImpact(viewImpact, current, change);
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
      restoreKnownFinishRecords(
        project.projectId,
        materialRecordStore.exportSnapshot()
      ),
      { notify: false }
    );
    changed = true;
  }

  safeChanges
    .filter((item) => item.recordType === 'photo')
    .forEach((change) => {
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
      if (
        change.changeType !== 'removed'
        && current
        && sameProjectFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)
      ) {
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

      // updatedAt cursor付きListenerでは同一docの更新で一時removedが届くことがある。
      // 写真の正式な削除正本はphotoRecord.deleted=trueなので、query removedだけでは消さない。
      if (change.changeType === 'removed') {
        skipped += 1;
        syncDiagnosticLog('SYNC_APPLY_PHOTO', {
          projectId: project.projectId,
          photoId: id,
          result: 'skipped',
          changeType: 'removed',
          reason: 'listener-query-removed-not-record-delete',
          currentDeleted: Boolean(current?.deleted),
          currentOriginalItemId: Boolean(current?.originalItemId),
          currentCompletedItemId: Boolean(current?.completedItemId)
        });
        syncDiagnosticLog('SYNC_APPLY_CHANGE', {
          projectId: project.projectId,
          recordType: 'photo',
          recordId: id,
          result: 'skipped',
          reason: 'listener-query-removed-not-record-delete'
        });
        return;
      }

      syncDiagnosticLog('SYNC_APPLY_PHOTO', {
        projectId: project.projectId,
        photoId: id,
        result: 'apply',
        changeType: change.changeType,
        currentOriginalItemId: Boolean(current?.originalItemId),
        currentCompletedItemId: Boolean(current?.completedItemId),
        incomingOriginalItemId: Boolean(change.record?.originalItemId),
        incomingCompletedItemId: Boolean(change.record?.completedItemId)
      });

      registerPhotoProjectViewImpact(viewImpact, current, change);
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
      .filter(Boolean),
    viewImpact: serializeProjectViewImpact(viewImpact)
  });

  if (!changed) {
    return { applied, skipped, persisted: false };
  }

  saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot(),
    source: 'listener-apply'
  });

  refreshProjectViewsForChanges(viewImpact);

  return {
    applied,
    skipped,
    persisted: true,
    impact: serializeProjectViewImpact(viewImpact)
  };
}
