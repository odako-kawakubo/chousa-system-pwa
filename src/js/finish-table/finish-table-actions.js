import { roomIndexFromRoomPosition } from '../records/finish-record.js';

import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';

import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { roomCarrierRecord, persistSparseFinishRecord } from './finish-table-persistence.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';

const PART_COUNT = 6;

export function roomKeyOf(record) { return record?.roomUid || ''; }

export function findRepresentativeByRoomKey(roomKey) {
  if (!roomKey) return null;
  return finishRecordStore.getAll().find((record) => record.roomUid === roomKey && record.status === 'active') || null;
}

export function floorKeyOf(areaCode, floor) { return `floor-${areaCode}-${floor}`; }

export function isFirstNormalFloorFirstRoom(record) {
  return !!record && record.areaCode === 'I' && Number(record.floor) === 1
    && roomIndexFromRoomPosition(record.roomPosition) === 1;
}

export function getRoomRecords(roomKey) {
  return finishRecordStore.getAll()
    .filter((record) => record.roomUid === roomKey && record.status === 'active')
    .sort((a, b) => a.position - b.position);
}

export function commitRoomField(roomKey, field, rawValue) {
  const records = getRoomRecords(roomKey);
  if (!records.length) return;

  const fieldMap = {
    'room-no': 'roomNo',
    'room-name': 'roomName',
    'room-note': 'roomNote'
  };
  const dataField = fieldMap[field];
  if (!dataField) return;

  const value = dataField === 'roomNo' ? String(rawValue ?? '').trim() : String(rawValue ?? '');
  const changed = records.filter((record) => String(record[dataField] ?? '') !== value);
  if (!changed.length) return;

  const confirmedAt = Date.now();
  const nextRecords = changed.map((record) => ({
    ...record,
    [dataField]: value,
    fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, dataField, confirmedAt)
  }));
  finishRecordStore.batch(() => nextRecords.forEach((record) => finishRecordStore.set(record)));

  const project = getCurrentProject();
  const currentRoomRecords = getRoomRecords(roomKey);
  const carrier = roomCarrierRecord(currentRoomRecords);
  if (carrier) persistSparseFinishRecord(project, carrier, finishRecordStore.getAll());

  if (dataField === 'roomNo' || dataField === 'roomName') {
    refreshMaterialUsageDerivedFields('room-common-edit');
  }
}

export function runRecordTransaction(mutate) {
  finishRecordStore.batch(() => {
    materialRecordStore.batch(() => {
      photoRecordStore.batch(() => mutate());
    });
  });
}

export { finishRecordStore, materialRecordStore };
