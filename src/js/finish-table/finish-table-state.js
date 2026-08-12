/**
 * src/js/finish-table/finish-table-state.js
 *
 * 仕上表の状態管理と業務ロジックを集約する。
 * 現在はサンプル案件をメモリ上で扱い、部屋・建材入力・選択状態・部屋コピー・
 * 階折りたたみ・Undo/Redo用スナップショットを管理する。
 * 正式レコード保存とFirebase同期は別レイヤーとして追加する前提で分離している。
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

/** ＋階／＋地下階1回あたりに追加する部屋数。 */
const ROOMS_PER_FLOOR = 10;

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

    // 表示・選択状態（仕上表の入力選択に関するものだけを持つ）
    colorMode: true,
    chipInputMode: false,
    simpleListOpen: true,
    selectedRoomKey: null,
    selectedGroupKey: null,
    focusedInputKey: null,
    selectedMaterialInputId: null,

    // 部屋コピー専用状態。入力選択状態（selectedRoomKey等）とは意図的に分離する。
    // 「部屋を選んでいるだけなのにコピーの色が付く」事故を防ぐための設計。
    roomCopy: {
      sourceRoomKey: null,
      backups: {}, // { [対象roomKey]: コピー実行前のrowCount/cellsスナップショット }
      done: {}     // { [対象roomKey]: true } … 「戻す」操作が可能な対象
    },

    // 階の折りたたみ専用状態。floorGroupKey()の値の集合。
    // 表示の開閉だけに使い、Undo/Redo（戻る/進む）の対象にも含めない。
    collapsedFloors: new Set()
  };
  notify();
}

export function getState() {
  return state;
}

/* ============================================================
   Undo/Redo（戻る/進む）用のスナップショット
   finish-table-history.jsはこの2関数だけを介して状態を読み書きし、
   状態の中身そのものは知らない。
   ============================================================ */

/**
 * Undo/Redoの対象となる状態だけを取り出して複製する。
 * 対象：floors／stairs／roof／externalRooms／roomCopy
 * 対象外：selectedRoomKey等の選択状態、collapsedFloors（折りたたみ）、
 *         colorMode／chipInputMode／simpleListOpen／areaMode（表示設定）
 *
 * @returns {object}
 */
export function getUndoableSnapshot() {
  return clone({
    floors: state.floors,
    stairs: state.stairs,
    roof: state.roof,
    externalRooms: state.externalRooms,
    roomCopy: state.roomCopy
  });
}

/**
 * getUndoableSnapshot()で取得したスナップショットを状態へ戻す。
 * 折りたたみ状態・選択状態・表示設定には触れない。
 *
 * @param {object} snapshot
 */
export function restoreUndoableSnapshot(snapshot) {
  if (!snapshot) return;
  state.floors = snapshot.floors;
  state.stairs = snapshot.stairs;
  state.roof = snapshot.roof;
  state.externalRooms = snapshot.externalRooms;
  state.roomCopy = snapshot.roomCopy;
  notify();
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

/**
 * 部屋No./部屋名フィールド用の識別キー。
 * data系セルのinputKey（roomKey|partIndex|row|kind）とは形が異なり、
 * 衝突しないようにする。「現在編集中のフィールド」を判定する
 * getFocusedInputKey()の値として、data系セルのinputKeyと同じ変数で
 * 共用する（part-index/row を持たないだけの同じ役割）。
 *
 * @param {object} room
 * @param {'room-no'|'room-name'} field
 */
export function roomFieldKey(room, field) {
  return `${roomKey(room)}|${field}`;
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

/**
 * 名称入力確定時（フォーカスが外れたとき）の処理。
 *
 * 現在の動作：既存建材と一致すればその建材を参照するが、一致しない場合は
 * 「自動登録」をしない。未登録のまま（materialIdが空のまま）残し、
 * renderer側がID欄に「登録」ボタンを出す判定に使う。
 */
export function commitCellMaterialName(room, partIndex, row) {
  const cell = ensureCell(room, partIndex, row);
  const name = String(cell.materialName || '').trim();
  if (!name) {
    clearCellMaterial(room, partIndex, row);
    return null;
  }

  const material = findMaterialByName(name);
  if (material) {
    linkCellToMaterial(cell, material);
    notify();
    return material;
  }

  // 未登録：登録はせず、名称だけ保持する（自動登録の廃止）。
  cell.materialId = '';
  cell.inputId = '';
  notify();
  return null;
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

/**
 * ID欄の「登録」ボタン押下時だけ呼ばれる、明示的な新規建材登録。
 * 末尾英字の正式付与・建材ID正式採番は後続工程（4章「今回は触らない」）。
 */
export function registerCellMaterial(room, partIndex, row) {
  const cell = ensureCell(room, partIndex, row);
  const name = String(cell.materialName || '').trim();
  if (!name) return null;

  let material = findMaterialByName(name);
  if (!material) material = registerMaterial(name);
  linkCellToMaterial(cell, material);
  notify();
  return material;
}

/** 「登録」ボタンを表示すべきか（名称は入力済みだが、どの建材にも未リンク）。 */
export function isCellPendingRegistration(room, partIndex, row) {
  const cell = getCell(room, partIndex, row);
  return Boolean(cell.materialName && cell.materialName.trim()) && !cell.materialId;
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
    // 24色パレットを巡回させる（25件目以降は1番から再利用）。
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

/**
 * 階見出し行の開閉。
 * 表示・非表示だけを切り替える操作であり、部屋・建材データは変更しない。
 * Undo/Redo（戻る/進む）の対象には含めない（notify()で再描画はするが、
 * finish-table-history.jsのrecordHistory()は呼ばない）。
 *
 * @param {string} floorKeyValue floorGroupKey()の値
 */
export function toggleFloorCollapsed(floorKeyValue) {
  if (!floorKeyValue) return;
  if (state.collapsedFloors.has(floorKeyValue)) {
    state.collapsedFloors.delete(floorKeyValue);
  } else {
    state.collapsedFloors.add(floorKeyValue);
  }
  notify();
}

/** @returns {boolean} その階（floorGroupKey）が折りたたまれているか。 */
export function isFloorCollapsed(floorKeyValue) {
  return state.collapsedFloors.has(floorKeyValue);
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

/**
 * ＋階：通常階を追加する。
 * 1回の追加操作で10部屋ブロック（ROOMS_PER_FLOOR）を生成する。
 */
export function addNormalFloor() {
  const list = state.floors.filter((floor) => floor.areaCode === 'I');
  const next = list.length ? Math.max(...list.map((floor) => floor.floor)) + 1 : 1;
  const rooms = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) rooms.push(createFloorRoom('I', next, i));
  state.floors.push({ uid: uid('floor'), areaCode: 'I', floor: next, label: `${next}階`, rooms });
  notify();
}

/**
 * ＋B階（地下階追加）：地下階を追加する。
 * 1回の追加操作で10部屋ブロックを生成する。呼び出し元は「1-1」ブロックの
 * 階セル内ショートカットと、操作パネル（ドロワー）の2箇所（finish-table-controller.js）。
 * 地下階は「B${next}階」と表示し、部屋No.表記と揃える（
 * B1-1等は変更していない）。
 */
export function addBasementFloor() {
  const list = state.floors.filter((floor) => floor.areaCode === 'B');
  const next = list.length ? Math.max(...list.map((floor) => floor.floor)) + 1 : 1;
  const rooms = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) rooms.push(createFloorRoom('B', next, i));
  state.floors.push({ uid: uid('floor'), areaCode: 'B', floor: next, label: `B${next}階`, rooms });
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

/**
 * ＋挿入：指定した部屋の直後へ1部屋挿入する。
 * この操作は操作パネル（ドロワー）から
 * 「現在選択中の部屋（selectedRoomKey）」を対象に呼ばれる
 * （finish-table-controller.js）。この関数自体の挙動は変更していない。
 */
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

/**
 * 1-1ブロック（1階・1部屋目）判定。＋B階ショートカット表示に使う。
 */
export function isFirstNormalFloorFirstRoom(room, floor) {
  return !!floor && floor.areaCode === 'I' && floor.floor === 1
    && room.areaCode === 'I' && room.roomIndex === 1;
}

/* ============================================================
   部屋コピー
   ============================================================ */

function roomHasContent(room) {
  if (!room) return false;
  return Object.values(room.cells || {}).some((cell) =>
    (cell.materialName && String(cell.materialName).trim()) ||
    (cell.actualPart && String(cell.actualPart).trim()) ||
    (cell.inputId && String(cell.inputId).trim())
  );
}

function sameAreaFamily(source, target) {
  if (!source || !target) return false;
  const sourceFamily = source.areaCode === 'E' ? 'external' : 'internal';
  const targetFamily = target.areaCode === 'E' ? 'external' : 'internal';
  return sourceFamily === targetFamily;
}

/**
 * 部屋コピー用ボタンの表示状態を判定する（4種類＋idle）。
 * 'restore'   = 戻す（淡い緑） … このroomは既にコピー実行済みで元に戻せる
 * 'source'    = コピー元（淡い赤）
 * 'target-overwrite' = 上書き（淡いオレンジ） … コピー元選択中、この部屋に既存入力あり
 * 'target-empty'     = コピー可（淡い青）     … コピー元選択中、この部屋は空
 * 'idle'      = 通常の「コピー」（コピー元未選択、または対象外）
 */
export function getRoomCopyButtonState(roomKeyValue) {
  const copy = state.roomCopy;
  if (copy.done[roomKeyValue]) return 'restore';
  if (copy.sourceRoomKey === roomKeyValue) return 'source';
  if (copy.sourceRoomKey) {
    const room = findRoomByKey(roomKeyValue);
    return roomHasContent(room) ? 'target-overwrite' : 'target-empty';
  }
  return 'idle';
}

/**
 * コピーボタン押下時に「何が起きるか」だけを判定する（状態は変更しない）。
 * 確認ダイアログが必要かどうかをfinish-table-controller.jsが判断するために使う。
 *
 * @returns {{type:'none'|'become-source'|'cancel-source'|'restore'|'copy', crossFamily?:boolean, overwrite?:boolean}}
 */
export function describeRoomCopyClick(roomKeyValue) {
  const copy = state.roomCopy;
  const room = findRoomByKey(roomKeyValue);
  if (!room) return { type: 'none' };

  if (copy.done[roomKeyValue]) return { type: 'restore' };
  if (!copy.sourceRoomKey) return { type: 'become-source' };
  if (copy.sourceRoomKey === roomKeyValue) return { type: 'cancel-source' };

  const source = findRoomByKey(copy.sourceRoomKey);
  return {
    type: 'copy',
    crossFamily: !sameAreaFamily(source, room),
    overwrite: roomHasContent(room)
  };
}

/** コピー元として選択する。 */
export function startRoomCopySource(roomKeyValue) {
  state.roomCopy.sourceRoomKey = roomKeyValue;
  notify();
}

/**
 * コピー元の選択を解除する。
 * 解除時はdone／backupsも含めてコピー関連状態を全てクリアし、
 * 「戻す」表示が解除後も残る不具合を修正する。コピー先セルに既に反映済みの
 * 値そのものは変更しない（元に戻す操作だけができなくなる）。
 */
export function cancelRoomCopySource() {
  state.roomCopy = { sourceRoomKey: null, backups: {}, done: {} };
  notify();
}

/** 「戻す」：対象部屋をコピー実行前の状態へ戻す。 */
export function restoreRoomCopy(roomKeyValue) {
  const copy = state.roomCopy;
  const room = findRoomByKey(roomKeyValue);
  if (!room || !copy.backups[roomKeyValue]) return;

  const backup = clone(copy.backups[roomKeyValue]);
  room.rowCount = backup.rowCount;
  room.cells = backup.cells;
  delete copy.done[roomKeyValue];
  delete copy.backups[roomKeyValue];
  notify();
}

/**
 * コピーを実行する（確認ダイアログでの確定後にfinish-table-controller.jsから呼ぶ）。
 * 実行前のコピー先の内容はbackupsへ退避し、「戻す」で復元できるようにする。
 */
export function executeRoomCopy(roomKeyValue) {
  const copy = state.roomCopy;
  const source = findRoomByKey(copy.sourceRoomKey);
  const room = findRoomByKey(roomKeyValue);
  if (!source || !room) return;

  copy.backups[roomKeyValue] = clone({ rowCount: room.rowCount, cells: room.cells });
  room.rowCount = Math.max(room.rowCount, source.rowCount);
  room.cells = clone(source.cells);
  copy.done[roomKeyValue] = true;
  notify();
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
