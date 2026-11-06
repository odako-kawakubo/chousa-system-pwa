/**
 * 部屋共通情報の参照・確定を担当する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { roomCarrierRecord, persistSparseFinishRecord } from './finish-table-persistence.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';
import { roomLocationKey, roomLocationDisplay } from './room-location.js';
import { getMaterialRoomNameMode } from '../materials/material-room-display-state.js';
import { refreshSamplingLocationsForRoom } from '../photos/sampling-location-change.js';
import { refreshVisualPhotoBoardsForRoom } from '../photos/room-photo-regeneration.js';

export function findRepresentativeByRoomKey(roomKey) {
  if (!roomKey) return null;
  return finishRecordStore.getAll().find((record) =>
    record.roomUid === roomKey && record.status === 'active'
  ) || null;
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

  const beforeAllRecords = finishRecordStore.getAll();
  const previousCarrier = roomCarrierRecord(records);
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
  if (carrier) {
    persistSparseFinishRecord(
      project,
      carrier,
      finishRecordStore.getAll(),
      previousCarrier,
      beforeAllRecords
    );
  }

  if (dataField === 'roomNo' || dataField === 'roomName') {
    refreshMaterialUsageDerivedFields('room-common-edit');
    const locationKey = roomLocationKey(carrier || currentRoomRecords[0]);
    const previousRoom = previousCarrier || records[0];
    const currentRoom = carrier || currentRoomRecords[0];
    const preferRoomName = getMaterialRoomNameMode();
    const oldBoardName = roomLocationDisplay(previousRoom, { preferRoomName, context:'photo' });
    const newBoardName = roomLocationDisplay(currentRoom, { preferRoomName, context:'photo' });
    if (oldBoardName !== newBoardName) {
      void refreshSamplingLocationsForRoom(locationKey);
      void refreshVisualPhotoBoardsForRoom(locationKey);
    }
  }
}
