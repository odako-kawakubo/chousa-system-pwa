/**
 * 仕上表の構造変更（階・部屋・入力行追加）。
 */
import {
  computeCellPosition,
  buildFloorRoomPosition,
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  rowFromPosition,
  createFinishRecord
} from '../records/finish-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { roomIdFor } from '../records/room-id.js';
import { INITIAL_ROW_COUNT, INTERNAL_PARTS, EXTERNAL_PARTS } from './finish-table-constants.js';
import { getCurrentProject } from '../projects/project-store.js';
import { persistFinishForProject } from '../sync/project-record-persistence.js';
import { persistAddedStructureMarker } from './finish-table-persistence.js';

const PART_COUNT = 6;

function pad(value, length) { return String(value).padStart(length, '0'); }
function partsForArea(areaCode) { return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS; }

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
    const id = roomIdFor(record.areaCode, record.roomPosition);
    if (!byRoom.has(id)) byRoom.set(id, record);
  });
  return Array.from(byRoom.values());
}

function createRoomRecords({ areaCode, roomPosition, floor, roomNo, roomName, roomNote = '', rowCount = INITIAL_ROW_COUNT }) {
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    for (let row = 1; row <= rowCount; row += 1) {
      records.push(createFinishRecord({
        areaCode, roomPosition, floor, roomNo, roomName, roomNote,
        position: computeCellPosition(partIndex, row),
        part: defaultPartName(areaCode, partIndex)
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
  if (areaCode === 'E') { roomNo = `E-${index}`; roomName = customName || ''; }
  return createRoomRecords({ areaCode, roomPosition, floor: null, roomNo, roomName, roomNote: '' });
}

function listFloorNumbers(areaCode) {
  return [...new Set(uniqueRoomAnchors(areaCode).map((record) => Number(record.floor)))];
}
function countRoomsInFloor(areaCode, floor) { return uniqueRoomAnchors(areaCode, floor).length; }
function countFlatRooms(areaCode) { return uniqueRoomAnchors(areaCode).length; }

function normalizeRoomCount(roomCount, fallback = 1) {
  const value = Number(roomCount);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(99, Math.trunc(value)));
}

export function getNextNormalFloorNumber() {
  const floors = listFloorNumbers('I');
  return floors.length ? Math.max(...floors) + 1 : 1;
}

export function getNextBasementFloorNumber() {
  const floors = listFloorNumbers('B');
  return floors.length ? Math.max(...floors) + 1 : 1;
}

export function addNormalFloor(roomCount = 10) {
  const next = getNextNormalFloorNumber();
  const count = normalizeRoomCount(roomCount, 10);
  const records = [];
  for (let i = 1; i <= count; i += 1) records.push(...buildFloorRoomSeed('I', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === count));
  return `floor-I-${next}`;
}

export function addBasementFloor(roomCount = 10) {
  const next = getNextBasementFloorNumber();
  const count = normalizeRoomCount(roomCount, 10);
  const records = [];
  for (let i = 1; i <= count; i += 1) records.push(...buildFloorRoomSeed('B', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === count));
  return `floor-B-${next}`;
}

function addFlatRooms(areaCode, roomCount = 1) {
  const count = normalizeRoomCount(roomCount, 1);
  const start = countFlatRooms(areaCode) + 1;
  const records = [];
  for (let offset = 0; offset < count; offset += 1) {
    records.push(...buildFlatRoomSeed(areaCode, start + offset));
  }
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addStairs(roomCount = 1) {
  addFlatRooms('S', roomCount);
  return 'stairs-group';
}

export function addRoof(roomCount = 1) {
  addFlatRooms('R', roomCount);
  return 'roof-group';
}

export function addExternalRoom() {
  const records = buildFlatRoomSeed('E', countFlatRooms('E') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addRoomToFloor(floorKey) {
  const parsed = parseFloorKey(floorKey);
  if (!parsed) return;
  const index = countRoomsInFloor(parsed.areaCode, parsed.floor) + 1;
  const records = buildFloorRoomSeed(parsed.areaCode, parsed.floor, index);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addInputRow(roomKey) {
  const roomRecords = finishRecordStore.getAll()
    .filter((record) => roomIdFor(record.areaCode, record.roomPosition) === roomKey && record.status === 'active')
    .sort((a, b) => a.position - b.position);
  const anchor = roomRecords[0];
  if (!anchor) return;
  const maxRow = Math.max(...roomRecords.map((record) => rowFromPosition(record.position)), 0);
  const nextRow = maxRow + 1;
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    records.push(createFinishRecord({
      areaCode: anchor.areaCode, roomPosition: anchor.roomPosition, floor: anchor.floor,
      roomNo: anchor.roomNo, roomName: anchor.roomName, roomNote: anchor.roomNote,
      position: computeCellPosition(partIndex, nextRow),
      part: defaultPartName(anchor.areaCode, partIndex),
      }));
  }
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  const marker = records.find((record) => partIndexFromPosition(record.position) === PART_COUNT);
  if (marker) persistFinishForProject(getCurrentProject(), marker, 'finish-structure-marker');
}
