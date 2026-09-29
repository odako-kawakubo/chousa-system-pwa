/**
 * src/js/finish-table/finish-table-structure-actions.js
 * 階・部屋・入力行など、仕上表の構造変更を担当する。
 */
import {
  computeFinishId,
  computeCellPosition,
  buildFloorRoomPosition,
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  rowFromPosition,
  createFinishRecord,
  nextRoomUid
} from '../records/finish-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { INITIAL_ROW_COUNT, INTERNAL_PARTS, EXTERNAL_PARTS } from './finish-table-constants.js';
import { getCurrentProject } from '../projects/project-store.js';
import { persistFinishForProject } from '../sync/project-record-persistence.js';

const ROOMS_PER_FLOOR = 10;
const PART_COUNT = 6;

function pad(value, length) { return String(value).padStart(length, '0'); }
function nowIso() { return new Date().toISOString(); }

function partsForArea(areaCode) {
  return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
}

export function defaultPartName(areaCode, partIndex) {
  const raw = partsForArea(areaCode)[partIndex - 1] || '';
  return partIndex >= 5 ? '' : raw;
}

function parseFloorKey(floorKey) {
  const match = /^floor-([IB])-(-?\d+)$/.exec(floorKey || '');
  return match ? { areaCode: match[1], floor: Number(match[2]) } : null;
}

function uniqueRoomAnchors(areaCode, floor = undefined) {
  const byRoom = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.areaCode !== areaCode) return;
    if (floor !== undefined && Number(record.floor) !== Number(floor)) return;
    if (!byRoom.has(record.roomUid)) byRoom.set(record.roomUid, record);
  });
  return Array.from(byRoom.values());
}

function createRoomRecords({ areaCode, roomPosition, floor, roomNo, roomName, roomNote = '', rowCount = INITIAL_ROW_COUNT, roomUid = nextRoomUid() }) {
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    for (let row = 1; row <= rowCount; row += 1) {
      records.push(createFinishRecord({
        areaCode,
        roomPosition,
        floor,
        roomNo,
        roomName,
        roomNote,
        position: computeCellPosition(partIndex, row),
        part: defaultPartName(areaCode, partIndex),
        roomUid
      }));
    }
  }
  return records;
}

export function buildFloorRoomSeed(areaCode, floor, index) {
  const roomPosition = buildFloorRoomPosition(floor, index);
  const prefix = areaCode === 'B' ? `B${floor}` : String(floor);
  const label = `${prefix}-${index}`;
  return createRoomRecords({ areaCode, roomPosition, floor, roomNo: label, roomName: '', roomNote: '' });
}

export function buildFlatRoomSeed(areaCode, index, customName = '') {
  const roomPosition = pad(index, 3);
  let roomNo = customName;
  let roomName = customName;
  if (!customName && areaCode === 'S') { roomNo = `S-${index}`; roomName = `階段${index}`; }
  if (!customName && areaCode === 'R') { roomNo = `R-${index}`; roomName = index === 1 ? '屋上' : `屋上${index}`; }
  if (!customName && areaCode === 'E') { roomNo = `面${index}`; roomName = ''; }
  return createRoomRecords({ areaCode, roomPosition, floor: null, roomNo, roomName, roomNote: '' });
}

function rekeyRecordToRoomPosition(record, newRoomPosition) {
  const nextId = computeFinishId(record.areaCode, newRoomPosition, record.position);
  if (record.finishId === nextId) return record;
  return { ...record, roomPosition: newRoomPosition, finishId: nextId, updatedAt: nowIso() };
}

function listFloorNumbers(areaCode) {
  return [...new Set(uniqueRoomAnchors(areaCode).map((record) => Number(record.floor)))];
}

function countRoomsInFloor(areaCode, floor) {
  return uniqueRoomAnchors(areaCode, floor).length;
}

function countFlatRooms(areaCode) {
  return uniqueRoomAnchors(areaCode).length;
}

export function addNormalFloor(persistStructureMarker) {
  const floors = listFloorNumbers('I');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('I', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === ROOMS_PER_FLOOR));
  return `floor-I-${next}`;
}

export function addBasementFloor(persistStructureMarker) {
  const floors = listFloorNumbers('B');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('B', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === ROOMS_PER_FLOOR));
  return `floor-B-${next}`;
}

export function addStairs(persistStructureMarker) {
  const records = buildFlatRoomSeed('S', countFlatRooms('S') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistStructureMarker(records);
  return 'stairs-group';
}

export function addRoof(persistStructureMarker) {
  const records = buildFlatRoomSeed('R', countFlatRooms('R') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistStructureMarker(records);
  return 'roof-group';
}

export function addExternalRoom(persistStructureMarker) {
  const records = buildFlatRoomSeed('E', countFlatRooms('E') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistStructureMarker(records);
}

export function addRoomToFloor(floorKey, persistStructureMarker) {
  const parsed = parseFloorKey(floorKey);
  if (!parsed) return;
  const index = countRoomsInFloor(parsed.areaCode, parsed.floor) + 1;
  const records = buildFloorRoomSeed(parsed.areaCode, parsed.floor, index);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistStructureMarker(records);
}

export function addRoomAfter(roomKey, persistStructureChange) {
  const anchor = finishRecordStore.getAll().find((record) => record.roomUid === roomKey && record.status === 'active') || null;
  if (!anchor) return;

  const before = finishRecordStore.getAll();
  if (anchor.areaCode === 'I' || anchor.areaCode === 'B') {
    const insertIndex = roomIndexFromRoomPosition(anchor.roomPosition) + 1;
    const shifted = before.map((record) => {
      if (record.areaCode !== anchor.areaCode || Number(record.floor) !== Number(anchor.floor)) return record;
      const idx = roomIndexFromRoomPosition(record.roomPosition);
      return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, buildFloorRoomPosition(Number(anchor.floor), idx + 1));
    });
    finishRecordStore.replaceAll([...shifted, ...buildFloorRoomSeed(anchor.areaCode, Number(anchor.floor), insertIndex)]);
  } else {
    const insertIndex = Number(anchor.roomPosition) + 1;
    const shifted = before.map((record) => {
      if (record.areaCode !== anchor.areaCode) return record;
      const idx = Number(record.roomPosition);
      return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, pad(idx + 1, 3));
    });
    finishRecordStore.replaceAll([...shifted, ...buildFlatRoomSeed(anchor.areaCode, insertIndex)]);
  }
  persistStructureChange(before, finishRecordStore.getAll());
}

export function addInputRow(roomKey) {
  const roomRecords = finishRecordStore.getAll()
    .filter((record) => record.roomUid === roomKey && record.status === 'active')
    .sort((a, b) => a.position - b.position);
  const anchor = roomRecords[0];
  if (!anchor) return;

  const maxRow = Math.max(...roomRecords.map((record) => rowFromPosition(record.position)), 0);
  const nextRow = maxRow + 1;
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    records.push(createFinishRecord({
      areaCode: anchor.areaCode,
      roomPosition: anchor.roomPosition,
      floor: anchor.floor,
      roomNo: anchor.roomNo,
      roomName: anchor.roomName,
      roomNote: anchor.roomNote,
      position: computeCellPosition(partIndex, nextRow),
      part: defaultPartName(anchor.areaCode, partIndex),
      roomUid: anchor.roomUid
    }));
  }
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));

  const marker = records.find((record) => partIndexFromPosition(record.position) === PART_COUNT);
  if (marker) persistFinishForProject(getCurrentProject(), marker, 'finish-structure-marker');
}
