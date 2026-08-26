/**
 * src/js/finish-table/finish-table-view-model.js
 *
 * finishRecordStore + materialRecordStore から仕上表表示用ViewModelを再構築する。
 * v0.1.5.1Dでは「1入力枠=1finishRecord」を正本とし、rowCountsや代表レコードは使わない。
 */

import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import {
  computeCellPosition,
  computeFinishId as computeFinishIdFromParts,
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  rowFromPosition
} from '../records/finish-record.js';
import {
  roomHasRecordedContent,
  getRoomCopyButtonState as computeCopyButtonState,
  describeRoomCopyClick as computeDescribeCopyClick
} from './finish-table-actions.js';
import { getState, getPendingCellName } from './finish-table-state.js';
import { INTERNAL_PARTS, EXTERNAL_PARTS } from './finish-table-constants.js';

export { INTERNAL_PARTS, EXTERNAL_PARTS };

export function roomKey(room) { return room?.uid || ''; }
export function floorGroupKey(floorGroup) { return floorGroup?.uid || ''; }
export function cellGroupKey(room, partIndex, row) { return `${roomKey(room)}|${partIndex}|${row}`; }
export function inputKey(room, partIndex, row, kind) { return `${cellGroupKey(room, partIndex, row)}|${kind}`; }
export function roomFieldKey(room, field) { return `${roomKey(room)}|${field}`; }

const EMPTY_CELL = Object.freeze({ inputId: '', materialId: '', materialName: '', actualPart: '' });
export function getCell(room, partIndex, row) { return room?.cells?.[`${partIndex}-${row}`] || EMPTY_CELL; }

export function computeFinishId(room, partIndex, row) {
  return computeFinishIdFromParts(room.areaCode, room.roomPosition, computeCellPosition(partIndex, row));
}

export function getPartsForAreaCode(areaCode) { return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS; }

export function isFirstNormalFloorFirstRoom(room, floor) {
  return !!floor && floor.areaCode === 'I' && floor.floor === 1
    && room.areaCode === 'I' && room.roomIndex === 1;
}

export function isCellPendingRegistration(room, partIndex, row) {
  const cell = getCell(room, partIndex, row);
  return Boolean(cell.materialName) && !cell.materialId;
}

export function getRoomCopyButtonState(roomKeyValue) {
  return computeCopyButtonState(getState().roomCopy, roomKeyValue);
}

export function describeRoomCopyClick(roomKeyValue) {
  return computeDescribeCopyClick(getState().roomCopy, roomKeyValue);
}

function floorLabel(areaCode, floor) { return areaCode === 'B' ? `B${floor}階` : `${floor}階`; }

function buildRoom(roomRecords, materialById) {
  const sorted = roomRecords.slice().sort((a, b) => a.position - b.position);
  const anchor = sorted[0];
  const rowCount = Math.max(...sorted.map((record) => rowFromPosition(record.position)), 0);
  const cells = {};

  sorted.forEach((record) => {
    const partIndex = partIndexFromPosition(record.position);
    const row = rowFromPosition(record.position);
    const pendingKey = `${anchor.roomUid}|${partIndex}|${row}`;
    const materialName = record.materialId
      ? (materialById.get(record.materialId)?.name || '')
      : (getPendingCellName(pendingKey) || '');
    cells[`${partIndex}-${row}`] = {
      inputId: record.inputId || '',
      materialId: record.materialId || '',
      materialName,
      // その他1/2の実部位未入力時はRecord正本の「その他」を画面にも表示する。
      actualPart: partIndex >= 5 ? (record.part || '') : ''
    };
  });

  const isFloorRoom = anchor.areaCode === 'I' || anchor.areaCode === 'B';
  return {
    uid: anchor.roomUid,
    areaCode: anchor.areaCode,
    roomPosition: anchor.roomPosition,
    floor: anchor.floor,
    roomIndex: isFloorRoom ? roomIndexFromRoomPosition(anchor.roomPosition) : undefined,
    index: isFloorRoom ? undefined : Number(anchor.roomPosition),
    roomNo: anchor.roomNo,
    name: anchor.roomName,
    rowCount,
    cells
  };
}

export function buildFinishTableViewModel() {
  const finishRecords = finishRecordStore.getAll().filter((record) => record.status === 'active');
  const materials = materialRecordStore.getAll();
  const materialById = new Map(materials.map((material) => [material.materialId, material]));

  const recordsByRoom = new Map();
  finishRecords.forEach((record) => {
    if (!recordsByRoom.has(record.roomUid)) recordsByRoom.set(record.roomUid, []);
    recordsByRoom.get(record.roomUid).push(record);
  });

  const floorMap = new Map();
  const stairs = [];
  const roof = [];
  const externalRooms = [];

  Array.from(recordsByRoom.values())
    .sort((a, b) => String(a[0].roomPosition).localeCompare(String(b[0].roomPosition), undefined, { numeric: true }))
    .forEach((roomRecords) => {
      const anchor = roomRecords[0];
      const room = buildRoom(roomRecords, materialById);
      if (anchor.areaCode === 'I' || anchor.areaCode === 'B') {
        const key = `${anchor.areaCode}|${anchor.floor}`;
        if (!floorMap.has(key)) {
          floorMap.set(key, {
            uid: `floor-${anchor.areaCode}-${anchor.floor}`,
            areaCode: anchor.areaCode,
            floor: Number(anchor.floor),
            label: floorLabel(anchor.areaCode, anchor.floor),
            rooms: []
          });
        }
        floorMap.get(key).rooms.push(room);
      } else if (anchor.areaCode === 'S') stairs.push(room);
      else if (anchor.areaCode === 'R') roof.push(room);
      else if (anchor.areaCode === 'E') externalRooms.push(room);
    });

  const floors = Array.from(floorMap.values()).sort((a, b) => {
    if (a.areaCode !== b.areaCode) return a.areaCode === 'B' ? -1 : 1;
    return a.floor - b.floor;
  });
  floors.forEach((floor) => floor.rooms.sort((a, b) => String(a.roomPosition).localeCompare(String(b.roomPosition), undefined, { numeric: true })));

  return { materials, floors, stairs, roof, externalRooms };
}

export function orderedInternalGroups(viewModel) {
  const basements = viewModel.floors.filter((floor) => floor.areaCode === 'B').sort((a, b) => b.floor - a.floor);
  const normals = viewModel.floors.filter((floor) => floor.areaCode === 'I').sort((a, b) => a.floor - b.floor);
  const result = [...basements];

  normals.forEach((floor, index) => {
    result.push(floor);
    if (floor.floor === 1 && viewModel.stairs.length) {
      result.push({ uid: 'stairs-group', areaCode: 'S', floor: 'stairs', label: '階段', rooms: viewModel.stairs, virtual: true });
    }
    if (index === normals.length - 1 && floor.floor !== 1 && !normals.some((f) => f.floor === 1) && viewModel.stairs.length) {
      result.push({ uid: 'stairs-group', areaCode: 'S', floor: 'stairs', label: '階段', rooms: viewModel.stairs, virtual: true });
    }
  });
  if (!normals.length && viewModel.stairs.length) {
    result.push({ uid: 'stairs-group', areaCode: 'S', floor: 'stairs', label: '階段', rooms: viewModel.stairs, virtual: true });
  }
  if (viewModel.roof.length) {
    result.push({ uid: 'roof-group', areaCode: 'R', floor: 'roof', label: '屋上', rooms: viewModel.roof, virtual: true });
  }
  return result;
}

export { roomHasRecordedContent };
