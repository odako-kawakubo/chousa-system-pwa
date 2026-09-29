/**
 * 部屋コピーの状態判定・実行・復元を担当する。
 */
import { partIndexFromPosition, createFinishRecord } from '../records/finish-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistFinishStructureChange } from './finish-table-persistence.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';
import { defaultPartName } from './finish-table-structure-actions.js';
import {
  findRepresentativeByRoomKey,
  getRoomRecords
} from './finish-table-actions.js';

function nowIso() { return new Date().toISOString(); }

export function snapshotRoomRecords(roomKey) {
  return getRoomRecords(roomKey).map((record) => ({ ...record }));
}

export function roomHasRecordedContent(roomKey) {
  return getRoomRecords(roomKey).some((record) => {
    if (record.materialId || record.inputId) return true;
    const partIndex = partIndexFromPosition(record.position);
    const materialName = String(record.materialName || '').trim();
    if (partIndex < 5 && materialName) return true;
    if (partIndex >= 5 && materialName && String(record.part || '').trim()) return true;
    return partIndex >= 5 && record.part && record.part !== 'その他';
  });
}

function sameAreaFamily(a, b) {
  const familyOf = (code) => (code === 'E' ? 'external' : 'internal');
  return !!a && !!b && familyOf(a) === familyOf(b);
}

export function getRoomCopyButtonState(roomCopyState, roomKey) {
  if (roomCopyState.done[roomKey]) return 'restore';
  if (roomCopyState.sourceRoomKey === roomKey) return 'source';
  if (roomCopyState.sourceRoomKey) return roomHasRecordedContent(roomKey) ? 'target-overwrite' : 'target-empty';
  return 'idle';
}

export function describeRoomCopyClick(roomCopyState, roomKey) {
  const target = findRepresentativeByRoomKey(roomKey);
  if (!target) return { type: 'none' };
  if (roomCopyState.done[roomKey]) return { type: 'restore' };
  if (!roomCopyState.sourceRoomKey) return { type: 'become-source' };
  if (roomCopyState.sourceRoomKey === roomKey) return { type: 'cancel-source' };

  const source = findRepresentativeByRoomKey(roomCopyState.sourceRoomKey);
  return {
    type: 'copy',
    crossFamily: !sameAreaFamily(source?.areaCode, target.areaCode),
    overwrite: roomHasRecordedContent(roomKey)
  };
}

export function executeRoomCopy(sourceRoomKey, targetRoomKey) {
  const before = finishRecordStore.getAll();
  const sourceRecords = getRoomRecords(sourceRoomKey);
  const targetRecords = getRoomRecords(targetRoomKey);
  const target = targetRecords[0];
  if (!sourceRecords.length || !target) return;

  const sourcePositions = new Set(sourceRecords.map((record) => record.position));
  const targetByPosition = new Map(targetRecords.map((record) => [record.position, record]));
  const confirmedAt = Date.now();

  finishRecordStore.batch(() => {
    targetRecords.forEach((record) => {
      if (!sourcePositions.has(record.position)) finishRecordStore.remove(record.finishId);
    });

    sourceRecords.forEach((source) => {
      const partIndex = partIndexFromPosition(source.position);
      const part = partIndex >= 5 ? String(source.part || '').trim() : defaultPartName(target.areaCode, partIndex);
      const existing = targetByPosition.get(source.position);

      if (existing) {
        const changedFields = [];
        if (String(existing.part || '') !== String(part || '')) changedFields.push('part');
        if (String(existing.materialId || '') !== String(source.materialId || '')) changedFields.push('materialId');
        if (String(existing.materialName || '') !== String(source.materialName || '')) changedFields.push('materialName');

        finishRecordStore.set({
          ...existing,
          part,
          materialId: source.materialId,
          materialName: String(source.materialName || ''),
          inputId: source.inputId,
          fieldEditedAt: changedFields.length
            ? touchFieldEditedAt(existing.fieldEditedAt, changedFields, confirmedAt)
            : { ...(existing.fieldEditedAt || {}) },
          updatedAt: nowIso()
        });
        return;
      }

      finishRecordStore.set(createFinishRecord({
        areaCode: target.areaCode,
        roomPosition: target.roomPosition,
        floor: target.floor,
        roomNo: target.roomNo,
        roomName: target.roomName,
        roomNote: target.roomNote,
        position: source.position,
        part,
        materialId: source.materialId,
        materialName: String(source.materialName || ''),
        inputId: source.inputId,
        fieldEditedAt: touchFieldEditedAt({}, ['part', 'materialId', 'materialName'], confirmedAt),
        roomUid: target.roomUid
      }));
    });
  });

  persistFinishStructureChange(before, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-copy');
}

export function restoreRoomCopy(roomKey, backupRecords) {
  if (!backupRecords?.length) return;

  const before = finishRecordStore.getAll();
  const current = getRoomRecords(roomKey);
  finishRecordStore.batch(() => {
    current.forEach((record) => finishRecordStore.remove(record.finishId));
    backupRecords.forEach((record) => finishRecordStore.set({ ...record }));
  });

  persistFinishStructureChange(before, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-copy-restore');
}
