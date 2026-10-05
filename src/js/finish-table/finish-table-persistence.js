/**
 * 仕上表の疎保存と構造変更保存。
 */
import { computeCellPosition, partIndexFromPosition } from '../records/finish-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { INITIAL_ROW_COUNT } from './finish-table-constants.js';
import { getCurrentProject } from '../projects/project-store.js';
import { deleteFinishForProject, persistFinishForProject, hasKnownFinishRecord } from '../sync/project-record-persistence.js';
import { getRequiredStructureRecordIds, defaultPartForRecord, defaultRoomFieldsForRecord } from '../sync/finish-sparse-structure.js';

const PART_COUNT = 6;

export function roomCarrierRecord(roomRecords = []) {
  const standardCarrierPosition = computeCellPosition(PART_COUNT, INITIAL_ROW_COUNT);
  return roomRecords.find((record) => Number(record.position) === standardCarrierPosition) || null;
}

function isFinishCellAtDefault(record) {
  if (!record) return true;
  if (String(record.materialId || '')) return false;
  const materialName = String(record.materialName || '').trim();
  const partIndex = partIndexFromPosition(record.position);
  if (partIndex >= 5) {
    const actualPart = String(record.part || '').trim();
    return !materialName && !actualPart;
  }
  if (materialName) return false;
  return String(record.part || '') === String(defaultPartForRecord(record) || '');
}

function hasRoomCommonDifference(record) {
  if (!record) return false;
  const defaults = defaultRoomFieldsForRecord(record);
  return String(record.roomNo || '') !== String(defaults.roomNo || '')
    || String(record.roomName || '') !== String(defaults.roomName || '')
    || String(record.roomNote || '') !== String(defaults.roomNote || '');
}

function shouldKeepSparseFinishRecord(record, allRecords = finishRecordStore.getAll()) {
  if (!record?.finishId) return false;
  if (getRequiredStructureRecordIds(allRecords).has(record.finishId)) return true;
  if (!isFinishCellAtDefault(record)) return true;
  const carrier = roomCarrierRecord(allRecords.filter((item) => item.roomUid === record.roomUid && item.status === 'active'));
  if (carrier?.finishId === record.finishId && hasRoomCommonDifference(record)) return true;
  if (String(record.systemMemo || '').trim()) return true;
  return false;
}

export function persistSparseFinishRecord(
  project,
  record,
  allRecords = finishRecordStore.getAll(),
  previousRecord = null,
  previousAllRecords = null
) {
  if (!project?.projectId || project.isSample || !record?.finishId) {
    return Promise.resolve({ ok: true, skipped: true });
  }
  if (shouldKeepSparseFinishRecord(record, allRecords)) {
    return persistFinishForProject(project, record, 'finish-sparse-cell');
  }

  const previousWasPersistable = Boolean(
    previousRecord?.finishId === record.finishId
    && shouldKeepSparseFinishRecord(previousRecord, previousAllRecords || allRecords)
  );

  // M-01: 「非初期 → 初期」はknown集合の状態に依存せずdeleteする。
  // オフラインsetがまだknownへ入っていない場合でも、同一recordの未送信setをdeleteへ置き換えられる。
  if (previousWasPersistable || hasKnownFinishRecord(project.projectId, record.finishId)) {
    return deleteFinishForProject(project, record, 'finish-sparse-reset');
  }
  return Promise.resolve({ ok: true, skipped: true });
}

export function persistAddedStructureMarker(records = []) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample || !records.length) return;
  const marker = roomCarrierRecord(records);
  if (marker) persistFinishForProject(project, marker, 'finish-structure-marker');
}

const STRUCTURE_COMPARE_FIELDS = Object.freeze([
  'finishId','areaCode','roomPosition','floor','roomNo','roomName','roomNote',
  'position','part','materialId','materialName'
]);

function sameStructureRecord(a, b) {
  if (!a || !b) return false;
  return STRUCTURE_COMPARE_FIELDS.every((field) => String(a[field] ?? '') === String(b[field] ?? ''));
}

export function persistFinishStructureChange(beforeRecords, afterRecords) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return;
  const beforeMap = new Map(beforeRecords.map((record) => [record.finishId, record]));
  const afterMap = new Map(afterRecords.map((record) => [record.finishId, record]));
  const removed = beforeRecords.filter((record) => !afterMap.has(record.finishId));
  const changed = afterRecords.filter((record) => {
    const previous = beforeMap.get(record.finishId);
    return !previous || !sameStructureRecord(previous, record);
  });
  changed.forEach((record) => {
    persistSparseFinishRecord(
      project,
      record,
      afterRecords,
      beforeMap.get(record.finishId) || null,
      beforeRecords
    );
  });

  // beforeに存在しafterから消えたこと自体を削除根拠にする。
  // Firestore未到達のrecordへのdeleteは無害で、未送信setがあれば同一キーのdeleteへ置き換わる。
  removed.forEach((record) => {
    deleteFinishForProject(project, record, 'finish-sparse-reset');
  });
}
