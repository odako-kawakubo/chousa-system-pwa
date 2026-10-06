/**
 * Undo/RedoでStore全体を復元した後、復元前後の差分だけをFirestoreへ反映する。
 * 履歴snapshot内の古いfieldEditedAtはそのまま戻さず、
 * Undo/Redo自体を新しい編集として変更項目だけ現在時刻でtouchする。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import {
  persistFinishForProject,
  deleteFinishForProject,
  persistMaterialForProject,
  deleteMaterialForProject
} from '../sync/project-record-persistence.js';
import { persistSparseFinishRecord } from './finish-table-persistence.js';

const FINISH_META_FIELDS = new Set([
  'updatedAt','updatedDevice','fieldEditedAt','roomUid','inputId','finishId'
]);
const MATERIAL_META_FIELDS = new Set([
  'updatedAt','updatedDevice','fieldEditedAt','color','photoCount',
  'materialId','materialNo','inputId','baseName','suffixLetter'
]);

function recordMap(records, idField) {
  return new Map((records || []).map((record) => [String(record?.[idField] || ''), record]));
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  if (a && typeof a === 'object' || b && typeof b === 'object') return JSON.stringify(a || {}) === JSON.stringify(b || {});
  return String(a ?? '') === String(b ?? '');
}

function changedBusinessFields(previous, next, metaFields) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  return [...keys].filter((field) => !metaFields.has(field) && !sameValue(previous?.[field], next?.[field]));
}

function stampRestoredRecord(previousCurrent, restored, metaFields) {
  const fields = changedBusinessFields(previousCurrent, restored, metaFields);
  if (!fields.length) return { record: restored, fields };
  return {
    record: {
      ...restored,
      fieldEditedAt: touchFieldEditedAt(previousCurrent?.fieldEditedAt, fields),
      updatedAt: new Date().toISOString()
    },
    fields
  };
}

export async function persistUndoRedoSnapshotDiff(before, restored, source = 'finish-history-restore') {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return { ok:true, skipped:true, finishCount:0, materialCount:0 };

  const beforeFinish = recordMap(before?.finish, 'finishId');
  const restoredFinish = recordMap(restored?.finish, 'finishId');
  const beforeMaterial = recordMap(before?.material, 'materialId');
  const restoredMaterial = recordMap(restored?.material, 'materialId');

  const finishTasks = [];
  const materialTasks = [];

  // Store上の復元後Recordを、新しいUndo/Redo編集時刻で更新してから永続化する。
  restoredFinish.forEach((restoredRecord, id) => {
    const previous = beforeFinish.get(id);
    if (!previous) {
      const stamped = stampRestoredRecord(null, restoredRecord, FINISH_META_FIELDS).record;
      finishRecordStore.set(stamped);
      finishTasks.push(persistSparseFinishRecord(project, stamped, finishRecordStore.getAll(), null, before?.finish || []));
      return;
    }
    const { record, fields } = stampRestoredRecord(previous, restoredRecord, FINISH_META_FIELDS);
    if (!fields.length) return;
    finishRecordStore.set(record);
    finishTasks.push(persistSparseFinishRecord(project, record, finishRecordStore.getAll(), previous, before?.finish || []));
  });

  beforeFinish.forEach((previous, id) => {
    if (restoredFinish.has(id)) return;
    finishTasks.push(deleteFinishForProject(project, previous, `${source}-finish-delete`));
  });

  restoredMaterial.forEach((restoredRecord, id) => {
    const previous = beforeMaterial.get(id);
    if (!previous) {
      const stamped = stampRestoredRecord(null, restoredRecord, MATERIAL_META_FIELDS).record;
      materialRecordStore.set(stamped);
      materialTasks.push(persistMaterialForProject(project, stamped, `${source}-material-set`));
      return;
    }
    const { record, fields } = stampRestoredRecord(previous, restoredRecord, MATERIAL_META_FIELDS);
    if (!fields.length) return;
    materialRecordStore.set(record);
    materialTasks.push(persistMaterialForProject(project, record, `${source}-material-set`));
  });

  beforeMaterial.forEach((previous, id) => {
    if (restoredMaterial.has(id)) return;
    materialTasks.push(deleteMaterialForProject(project, previous, `${source}-material-delete`));
  });

  const results = await Promise.all([...finishTasks, ...materialTasks]);
  return {
    ok: results.every((result) => result == null || result.ok || result.queued || result.skipped),
    finishCount: finishTasks.length,
    materialCount: materialTasks.length,
    queuedCount: results.filter((result) => result?.queued).length
  };
}
