/**
 * src/js/finish-table/finish-table-state.js
 *
 * v0.1.2 仕上表の状態管理。
 * 保存・Firebase同期はまだ行わず、画面確認に必要な状態と業務ロジックを
 * このモジュールへ集約する。
 */

import { sampleProject } from '../demo/sample-project.js';
import { sampleMaterials, MATERIAL_COLOR_PALETTE } from '../demo/sample-materials.js';
import {
  createInitialFinishStructure,
  INTERNAL_PARTS,
  EXTERNAL_PARTS,
  INITIAL_ROW_COUNT
} from '../demo/sample-finish-data.js';

export { INTERNAL_PARTS, EXTERNAL_PARTS };

let state = null;
const listeners = [];
let uidSeed = 1000;

function uid(prefix) {
  uidSeed += 1;
  return `${prefix}-${uidSeed}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function notify() {
  listeners.forEach((callback) => callback());
}

export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function initFinishTableState() {
  const structure = createInitialFinishStructure();
  state = {
    project: sampleProject,
    materials: clone(sampleMaterials),
    areaMode: 'internal',
    floors: structure.floors,
    stairs: structure.stairs,
    roof: structure.roof,
    externalRooms: structure.externalRooms,

    // 表示・選択状態
    colorMode: true,
    chipInputMode: false,
    simpleListOpen: true,
    selectedRoomKey: null,
    selectedGroupKey: null,
    focusedInputKey: null,
    selectedMaterialInputId: null,

    // 部屋コピー専用状態（一般Undo/Redoではない）
    roomCopy: {
      sourceRoomKey: null,
      backups: {},
      done: {}
    }
  };
  notify();
}

export function getState() {
  return state;
}

/* ============================================================
   部屋・フロア識別
   ============================================================ */

export function roomKey(room) {
  return room?.uid || '';
}

export function floorGroupKey(floorGroup) {
  return floorGroup?.uid || '';
}

export function findRoomByKey(key) {
  if (!state || !key) return null;
  for (const floor of state.floors) {
    const room = floor.rooms.find((item) => item.uid === key);
    if (room) return room;
  }
  for (const list of [state.stairs, state.roof, state.externalRooms]) {
    const room = list.find((item) => item.uid === key);
    if (room) return room;
  }
  return null;
}

export function findFloorByKey(key) {
  return state?.floors.find((floor) => floor.uid === key) || null;
}

export function getPartsForAreaCode(areaCode) {
  return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
}

/* ============================================================
   仕上表ID
   ============================================================ */

function pad(value, length) {
  return String(value).padStart(length, '0');
}

/**
 * 仕上表ID用の「部屋位置」は現在の並びから毎回計算する。
 * 途中挿入後は位置が変わるため、仕上表IDも現在位置に追従する。
 */
export function computeRoomPosition(room) {
  if (!room) return '000';

  if (room.areaCode === 'I' || room.areaCode === 'B') {
    const floor = state.floors.find((item) => item.rooms.includes(room));
    const currentIndex = floor ? floor.rooms.indexOf(room) + 1 : room.roomIndex || 1;
    return `${room.floor}${pad(currentIndex, 2)}`;
  }

  const list = room.areaCode === 'S'
    ? state.stairs
    : room.areaCode === 'R'
      ? state.roof
      : state.externalRooms;
  return pad(list.indexOf(room) + 1, 3);
}

export function computeFinishId(room, partIndex, row) {
  const position = partIndex * 100 + row;
  return `${room.areaCode}-${computeRoomPosition(room)}-${position}`;
}

export function cellGroupKey(room, partIndex, row) {
  return `${roomKey(room)}|${partIndex}|${row}`;
}

export function inputKey(room, partIndex, row, kind) {
  return `${cellGroupKey(room, partIndex, row)}|${kind}`;
}

/* ============================================================
   セルデータ
   ============================================================ */

function cellKey(partIndex, row) {
  return `${partIndex}-${row}`;
}

function ensureCell(room, partIndex, row) {
  const key = cellKey(partIndex, row);
  if (!room.cells[key]) {
    room.cells[key] = {
      inputId: '',
      materialId: '',
      materialName: '',
      actualPart: ''
    };
  }
  return room.cells[key];
}

export function getCell(room, partIndex, row) {
  return ensureCell(room, partIndex, row);
}

export function getCellInputId(room, partIndex, row) {
  return String(getCell(room, partIndex, row).inputId || '');
}

export function getCellValue(room, partIndex, row) {
  return getCell(room, partIndex, row).materialName || '';
}

export function getCellActualPart(room, partIndex, row) {
  return getCell(room, partIndex, row).actualPart || '';
}

export function setCellActualPart(room, partIndex, row, value) {
  ensureCell(room, partIndex, row).actualPart = String(value ?? '');
}

export function setCellDraftName(room, partIndex, row, value) {
  const cell = ensureCell(room, partIndex, row);
  cell.materialName = String(value ?? '');
  const material = findMaterialByName(cell.materialName);
  if (material) {
    linkCellToMaterial(cell, material);
  } else {
    cell.materialId = '';
    cell.inputId = '';
  }
}

export function setCellDraftInputId(room, partIndex, row, value) {
  const cell = ensureCell(room, partIndex, row);
  const normalized = String(value ?? '').trim();
  cell.inputId = normalized;
  const material = findMaterialByInputId(normalized);
  if (material) linkCellToMaterial(cell, material);
  else cell.materialId = '';
}

function linkCellToMaterial(cell, material) {
  cell.inputId = String(material.inputId);
  cell.materialId = material.materialId;
  cell.materialName = material.name;
}

export function applyMaterialToCell(room, partIndex, row, material) {
  if (!room || !material) return;
  linkCellToMaterial(ensureCell(room, partIndex, row), material);
}

export function clearCellMaterial(room, partIndex, row) {
  const cell = ensureCell(room, partIndex, row);
  cell.inputId = '';
  cell.materialId = '';
  cell.materialName = '';
}

/** 名称入力確定時：既存参照、なければ新規建材登録。 */
export function commitCellMaterialName(room, partIndex, row) {
  const cell = ensureCell(room, partIndex, row);
  const name = String(cell.materialName || '').trim();
  if (!name) {
    clearCellMaterial(room, partIndex, row);
    return null;
  }

  let material = findMaterialByName(name);
  if (!material) material = registerMaterial(name);
  linkCellToMaterial(cell, material);
  notify();
  return material;
}

/** ID入力確定時：既存の入力IDならその建材を参照する。 */
export function commitCellInputId(room, partIndex, row) {
  const cell = ensureCell(room, partIndex, row);
  const material = findMaterialByInputId(cell.inputId);
  if (!material) {
    cell.materialId = '';
    cell.materialName = '';
    return null;
  }
  linkCellToMaterial(cell, material);
  notify();
  return material;
}

/* ============================================================
   建材
   ============================================================ */

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function findMaterialByName(name) {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return state.materials.find((material) => normalizeName(material.name) === normalized);
}

export function findMaterialByInputId(inputId) {
  const normalized = String(inputId ?? '').trim();
  if (!normalized) return undefined;
  return state.materials.find((material) => String(material.inputId) === normalized);
}

export function registerMaterial(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const existing = findMaterialByName(normalized);
  if (existing) return existing;

  const nextInputId = state.materials.length
    ? Math.max(...state.materials.map((m) => Number(m.inputId) || 0)) + 1
    : 1;
  const nextMaterialNo = state.materials.length + 1;
  const nextMaterialId = `R${String(nextInputId).padStart(3, '0')}`;

  const material = {
    materialId: nextMaterialId,
    inputId: nextInputId,
    no: nextMaterialNo,
    name: normalized,
    color: MATERIAL_COLOR_PALETTE[(nextInputId - 1) % MATERIAL_COLOR_PALETTE.length],
    note: '',
    photoCount: 0
  };
  state.materials.push(material);
  return material;
}

export function getMaterialUsageRoomNos(inputId) {
  const target = String(inputId ?? '');
  const roomNos = [];
  allRooms().forEach((room) => {
    const used = Object.values(room.cells || {}).some((cell) => String(cell.inputId || '') === target);
    if (used && room.roomNo && !roomNos.includes(room.roomNo)) roomNos.push(room.roomNo);
  });
  return roomNos;
}

/* ============================================================
   表示モード・選択状態
   ============================================================ */

export function setAreaMode(mode) {
  state.areaMode = mode === 'external' ? 'external' : 'internal';
  state.selectedRoomKey = null;
  state.selectedGroupKey = null;
  state.focusedInputKey = null;
  notify();
}

export function setSelectedRoomKey(key) {
  state.selectedRoomKey = key || null;
}
export function getSelectedRoomKey() {
  return state.selectedRoomKey;
}

export function setSelectedGroupKey(key) {
  state.selectedGroupKey = key || null;
}
export function getSelectedGroupKey() {
  return state.selectedGroupKey;
}

export function setFocusedInputKey(key) {
  state.focusedInputKey = key || null;
}
export function getFocusedInputKey() {
  return state.focusedInputKey;
}

export function setSelectedMaterialInputId(inputId) {
  state.selectedMaterialInputId = inputId == null ? null : Number(inputId);
}
export function getSelectedMaterialInputId() {
  return state.selectedMaterialInputId;
}

export function toggleColorMode() {
  state.colorMode = !state.colorMode;
  notify();
}
export function getColorMode() {
  return !!state.colorMode;
}

export function toggleChipInputMode() {
  state.chipInputMode = !state.chipInputMode;
  notify();
}
export function getChipInputMode() {
  return !!state.chipInputMode;
}

export function toggleSimpleListOpen() {
  state.simpleListOpen = !state.simpleListOpen;
  notify();
}
export function getSimpleListOpen() {
  return !!state.simpleListOpen;
}

/* ============================================================
   追加・挿入・部屋No.
   ============================================================ */

function createFloorRoom(areaCode, floor, roomIndex) {
  const prefix = areaCode === 'B' ? `B${floor}` : String(floor);
  return {
    uid: uid('room'), areaCode, floor, roomIndex,
    roomNo: `${prefix}-${roomIndex}`,
    name: `${prefix}-${roomIndex}`,
    rowCount: INITIAL_ROW_COUNT,
    cells: {}
  };
}

function createFlatRoom(areaCode, index, roomNo, name) {
  return {
    uid: uid('room'), areaCode, index, roomNo, name,
    rowCount: INITIAL_ROW_COUNT,
    cells: {}
  };
}

function renumberFloorRoomIndexes(floor) {
  floor.rooms.forEach((room, index) => {
    room.roomIndex = index + 1;
  });
}

function renumberFlat(list) {
  list.forEach((room, index) => {
    room.index = index + 1;
  });
}

export function addNormalFloor() {
  const list = state.floors.filter((floor) => floor.areaCode === 'I');
  const next = list.length ? Math.max(...list.map((floor) => floor.floor)) + 1 : 1;
  state.floors.push({
    uid: uid('floor'), areaCode: 'I', floor: next, label: `${next}階`,
    rooms: [createFloorRoom('I', next, 1)]
  });
  notify();
}

export function addBasementFloor() {
  const list = state.floors.filter((floor) => floor.areaCode === 'B');
  const next = list.length ? Math.max(...list.map((floor) => floor.floor)) + 1 : 1;
  state.floors.push({
    uid: uid('floor'), areaCode: 'B', floor: next, label: `地下${next}階`,
    rooms: [createFloorRoom('B', next, 1)]
  });
  notify();
}

export function addStairs() {
  const next = state.stairs.length + 1;
  state.stairs.push(createFlatRoom('S', next, `S-${next}`, `階段${next}`));
  notify();
}

export function addRoof() {
  const next = state.roof.length + 1;
  state.roof.push(createFlatRoom('R', next, `R-${next}`, next === 1 ? '屋上' : `屋上${next}`));
  notify();
}

export function addExternalRoom() {
  const next = state.externalRooms.length + 1;
  state.externalRooms.push(createFlatRoom('E', next, `面${next}`, `面${next}`));
  notify();
}

export function addRoomToFloor(floorKey) {
  const floor = findFloorByKey(floorKey);
  if (!floor) return;
  floor.rooms.push(createFloorRoom(floor.areaCode, floor.floor, floor.rooms.length + 1));
  renumberFloorRoomIndexes(floor);
  notify();
}

export function addRoomAfter(roomKeyValue) {
  const room = findRoomByKey(roomKeyValue);
  if (!room) return;

  const floor = state.floors.find((item) => item.rooms.includes(room));
  if (floor) {
    const index = floor.rooms.indexOf(room);
    floor.rooms.splice(index + 1, 0, createFloorRoom(floor.areaCode, floor.floor, index + 2));
    renumberFloorRoomIndexes(floor);
    notify();
    return;
  }

  const list = room.areaCode === 'S' ? state.stairs : room.areaCode === 'R' ? state.roof : state.externalRooms;
  const index = list.indexOf(room);
  const next = index + 2;
  if (room.areaCode === 'S') list.splice(index + 1, 0, createFlatRoom('S', next, `S-${next}`, `階段${next}`));
  else if (room.areaCode === 'R') list.splice(index + 1, 0, createFlatRoom('R', next, `R-${next}`, `屋上${next}`));
  else list.splice(index + 1, 0, createFlatRoom('E', next, `面${next}`, `面${next}`));
  renumberFlat(list);
  notify();
}

export function addInputRow(roomKeyValue) {
  const room = findRoomByKey(roomKeyValue);
  if (!room) return;
  room.rowCount += 1;
  notify();
}

export function updateRoomNo(roomKeyValue, value) {
  const room = findRoomByKey(roomKeyValue);
  if (!room) return;
  room.roomNo = String(value ?? '').trim();
}

export function updateRoomName(roomKeyValue, value) {
  const room = findRoomByKey(roomKeyValue);
  if (!room) return;
  room.name = String(value ?? '');
}

/* ============================================================
   部屋コピー / コピー前へ戻す
   ============================================================ */

function sameAreaFamily(source, target) {
  if (!source || !target) return false;
  const sourceFamily = source.areaCode === 'E' ? 'external' : 'internal';
  const targetFamily = target.areaCode === 'E' ? 'external' : 'internal';
  return sourceFamily === targetFamily;
}

export function getRoomCopyButtonState(roomKeyValue) {
  const copy = state.roomCopy;
  if (copy.done[roomKeyValue]) return 'restore';
  if (copy.sourceRoomKey === roomKeyValue) return 'source';
  if (copy.sourceRoomKey) return 'target';
  return 'idle';
}

export function handleRoomCopy(roomKeyValue) {
  const room = findRoomByKey(roomKeyValue);
  if (!room) return { ok: false };

  const copy = state.roomCopy;

  if (copy.done[roomKeyValue] && copy.backups[roomKeyValue]) {
    const backup = clone(copy.backups[roomKeyValue]);
    room.rowCount = backup.rowCount;
    room.cells = backup.cells;
    delete copy.done[roomKeyValue];
    delete copy.backups[roomKeyValue];
    notify();
    return { ok: true, action: 'restore' };
  }

  if (!copy.sourceRoomKey) {
    copy.sourceRoomKey = roomKeyValue;
    notify();
    return { ok: true, action: 'source' };
  }

  if (copy.sourceRoomKey === roomKeyValue) {
    copy.sourceRoomKey = null;
    notify();
    return { ok: true, action: 'cancel' };
  }

  const source = findRoomByKey(copy.sourceRoomKey);
  if (!sameAreaFamily(source, room)) {
    return { ok: false, reason: 'area-mismatch' };
  }

  copy.backups[roomKeyValue] = clone({ rowCount: room.rowCount, cells: room.cells });
  room.rowCount = Math.max(room.rowCount, source.rowCount);
  room.cells = clone(source.cells);
  copy.done[roomKeyValue] = true;
  notify();
  return { ok: true, action: 'copied' };
}

/* ============================================================
   一覧ヘルパー
   ============================================================ */

export function allRooms() {
  return [
    ...state.floors.flatMap((floor) => floor.rooms),
    ...state.stairs,
    ...state.roof,
    ...state.externalRooms
  ];
}

export function orderedInternalGroups() {
  const basements = state.floors
    .filter((floor) => floor.areaCode === 'B')
    .sort((a, b) => b.floor - a.floor);
  const normals = state.floors
    .filter((floor) => floor.areaCode === 'I')
    .sort((a, b) => a.floor - b.floor);

  const result = [...basements];
  normals.forEach((floor, index) => {
    result.push(floor);
    // 仕様：1階と2階の間へ階段ブロックを配置。
    if (floor.floor === 1 && state.stairs.length) {
      result.push({ uid: 'stairs-group', areaCode: 'S', floor: 'stairs', label: '階段', rooms: state.stairs, virtual: true });
    }
    if (index === normals.length - 1 && floor.floor !== 1 && !normals.some((f) => f.floor === 1) && state.stairs.length) {
      result.push({ uid: 'stairs-group', areaCode: 'S', floor: 'stairs', label: '階段', rooms: state.stairs, virtual: true });
    }
  });
  if (!normals.length && state.stairs.length) {
    result.push({ uid: 'stairs-group', areaCode: 'S', floor: 'stairs', label: '階段', rooms: state.stairs, virtual: true });
  }
  if (state.roof.length) {
    result.push({ uid: 'roof-group', areaCode: 'R', floor: 'roof', label: '屋上', rooms: state.roof, virtual: true });
  }
  return result;
}
