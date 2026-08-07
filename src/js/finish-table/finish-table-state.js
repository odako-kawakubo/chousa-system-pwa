/**
 * src/js/finish-table/finish-table-state.js
 *
 * このファイルの役割：
 *   仕上表タブのローカル状態（ブラウザのメモリ上だけに存在する一時状態）を
 *   一元管理する。内部／外部の部屋構成、各セルの入力値、選択中の部屋・セル・
 *   建材、建材カラー表示ON/OFFなどはすべてここに集約する。
 *   画面描画（finish-table-renderer.js）や簡易リスト（simple-list.js）は、
 *   この状態を読み書きするだけで、自分で状態を持たない。
 *
 * どこから呼ばれるか：
 *   src/js/finish-table/finish-table-controller.js から初期化される。
 *   src/js/finish-table/finish-table-renderer.js と
 *   src/js/materials/simple-list.js から、状態の参照・更新のために呼ばれる。
 *
 * 何を取得しているか：
 *   src/js/demo/sample-project.js・sample-materials.js・sample-finish-data.js の
 *   固定サンプルデータのみ。Firestore・OneDrive・Microsoft Graph等の外部データは
 *   一切取得しない。
 *
 * 何を判定しているか：
 *   ・仕上表IDの区分コード・部屋位置・位置番号の組み立て方
 *   ・内部／外部でどちらの部位リスト（INTERNAL_PARTS / EXTERNAL_PARTS）を使うか
 *
 * どこへ書き込んでいるか：
 *   このモジュール内のメモリ上の変数のみ。ブラウザのlocalStorage／
 *   sessionStorage、Firestore等への書き込みは一切行わない。
 *   ページを再読み込みすると、この状態はすべて初期サンプル状態へ戻る。
 *
 * 仕上表IDの再計算について：
 *   このモジュールは部屋・入力行の一覧を「現在の状態」として保持するだけで、
 *   仕上表ID（data-finish-id）は保存せず、描画のたびに現在の部屋位置・部位・
 *   入力行から都度計算し直す（finishId関数）。そのため部屋や入力行を追加した
 *   直後の再描画でも、常に画面上の現在位置と一致したIDになる
 *   （既存部屋の位置がずれるような並び替え・削除は今回実装しないため、
 *   追加済みの部屋のIDが後から変わることはない）。
 */

import { sampleProject } from '../demo/sample-project.js';
import { sampleMaterials } from '../demo/sample-materials.js';
import { createInitialFinishStructure, INTERNAL_PARTS, EXTERNAL_PARTS } from '../demo/sample-finish-data.js';

export { INTERNAL_PARTS, EXTERNAL_PARTS };

/** @type {object} 仕上表タブのローカル状態本体。init()で組み立てる。 */
let state = null;

/** @type {Array<() => void>} 状態が変わったときに呼ぶ購読者一覧。 */
const listeners = [];

/**
 * 状態変更を購読する。finish-table-renderer.js・simple-list.jsが、
 * 「構造が変わったので再描画する」タイミングを知るために使う。
 *
 * @param {() => void} callback
 * @returns {() => void} 購読解除用の関数
 */
export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const i = listeners.indexOf(callback);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notify() {
  listeners.forEach((callback) => callback());
}

/**
 * 仕上表タブの状態を初期サンプル状態へ（再）初期化する。
 * ページ再読込時や、初回起動時に呼ぶ。
 */
export function initFinishTableState() {
  const structure = createInitialFinishStructure();
  state = {
    project: sampleProject,
    materials: sampleMaterials,
    areaMode: 'internal', // 'internal' | 'external'
    floors: structure.floors,
    stairs: structure.stairs,
    roof: structure.roof,
    externalRooms: structure.externalRooms,
    colorMode: true, // 建材カラー表示のON/OFF
    selectedRoomKey: null,
    activeCellKey: null, // フォーカス中の入力枠のfinishId
    selectedMaterialInputId: null
  };
  notify();
}

/** @returns {object} 現在の状態（参照）。読み取り専用として扱うこと。 */
export function getState() {
  return state;
}

/* ============================================================
   仕上表ID・部屋位置の計算
   ============================================================ */

/**
 * 区分コードに応じた部位リストを返す。
 * 内部・地下階・階段・屋上は同じ部位構成（INTERNAL_PARTS）を共用し、
 * 外部だけ別の部位構成（EXTERNAL_PARTS）を使う。
 *
 * @param {string} areaCode
 * @returns {string[]}
 */
export function getPartsForAreaCode(areaCode) {
  return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
}

function pad(num, length) {
  return String(num).padStart(length, '0');
}

/**
 * 部屋データから「部屋位置」文字列を計算する。
 * 内部・地下階：階＋2桁の部屋番号（例：1階1部屋目 → "101"）
 * 外部・階段・屋上：3桁の連番（例：2件目 → "002"）
 *
 * @param {object} room
 * @returns {string}
 */
export function computeRoomPosition(room) {
  if (room.areaCode === 'I' || room.areaCode === 'B') {
    return `${room.floor}${pad(room.roomIndex, 2)}`;
  }
  return pad(room.index, 3);
}

/**
 * 仕上表IDを計算する（区分コード-部屋位置-位置）。
 * 位置＝部位番号（1始まり）×100＋入力行番号。
 * その他1/その他2は部位番号5/6になるため、1行目・2行目がそれぞれ
 * 501/502・601/602に自動的に一致する。
 *
 * @param {object} room
 * @param {number} partIndex 部位番号（1始まり）
 * @param {number} row 入力行番号（1始まり）
 * @returns {string}
 */
export function computeFinishId(room, partIndex, row) {
  const position = partIndex * 100 + row;
  return `${room.areaCode}-${computeRoomPosition(room)}-${position}`;
}

/**
 * 部屋を一意に識別するキーを作る（DOM検索・状態更新に使う。仕上表IDとは別物）。
 *
 * @param {object} room
 * @returns {string}
 */
export function roomKey(room) {
  if (room.areaCode === 'I' || room.areaCode === 'B') {
    return `${room.areaCode}:${room.floor}:${room.roomIndex}`;
  }
  return `${room.areaCode}:${room.index}`;
}

function floorGroupKey(floorGroup) {
  return `${floorGroup.areaCode}:${floorGroup.floor}`;
}

/**
 * roomKeyから部屋データ本体を探す（全フロア・階段・屋上・外部を横断検索）。
 *
 * @param {string} key
 * @returns {object|null}
 */
export function findRoomByKey(key) {
  if (!key || !state) return null;
  for (const floorGroup of state.floors) {
    const found = floorGroup.rooms.find((room) => roomKey(room) === key);
    if (found) return found;
  }
  const lists = [state.stairs, state.roof, state.externalRooms];
  for (const list of lists) {
    const found = list.find((room) => roomKey(room) === key);
    if (found) return found;
  }
  return null;
}

/* ============================================================
   セルの値（建材名称・実際の部位）
   ============================================================ */

function cellKeyOf(partIndex, row) {
  return `${partIndex}-${row}`;
}

/** @returns {string} 建材名称の入力値（未入力なら空文字） */
export function getCellValue(room, partIndex, row) {
  const cell = room.cells[cellKeyOf(partIndex, row)];
  return cell ? cell.value || '' : '';
}

/** @returns {string} その他欄の「実際の部位」入力値（未入力なら空文字） */
export function getCellActualPart(room, partIndex, row) {
  const cell = room.cells[cellKeyOf(partIndex, row)];
  return cell ? cell.actualPart || '' : '';
}

/**
 * セルの建材名称を更新する（画面の入力欄からの入力を反映するだけ。保存はしない）。
 */
export function setCellValue(room, partIndex, row, value) {
  const key = cellKeyOf(partIndex, row);
  const cell = room.cells[key] || (room.cells[key] = { value: '', actualPart: '' });
  cell.value = value;
}

/** その他欄の「実際の部位」を更新する（保存はしない）。 */
export function setCellActualPart(room, partIndex, row, value) {
  const key = cellKeyOf(partIndex, row);
  const cell = room.cells[key] || (room.cells[key] = { value: '', actualPart: '' });
  cell.actualPart = value;
}

/* ============================================================
   内部／外部切替
   ============================================================ */

export function setAreaMode(mode) {
  state.areaMode = mode === 'external' ? 'external' : 'internal';
  notify();
}

/* ============================================================
   階・部屋・入力行の追加（今回実装する基本挙動）
   ============================================================ */

/** 通常階を追加する。 */
export function addNormalFloor() {
  const normalFloors = state.floors.filter((f) => f.areaCode === 'I');
  const nextFloor = normalFloors.length
    ? Math.max(...normalFloors.map((f) => f.floor)) + 1
    : 1;
  state.floors.push({
    areaCode: 'I',
    floor: nextFloor,
    label: `${nextFloor}階`,
    rooms: [createFloorRoom('I', nextFloor, 1)]
  });
  notify();
}

/** 地下階を追加する。 */
export function addBasementFloor() {
  const basementFloors = state.floors.filter((f) => f.areaCode === 'B');
  const nextFloor = basementFloors.length
    ? Math.max(...basementFloors.map((f) => f.floor)) + 1
    : 1;
  state.floors.push({
    areaCode: 'B',
    floor: nextFloor,
    label: `地下${nextFloor}階`,
    rooms: [createFloorRoom('B', nextFloor, 1)]
  });
  notify();
}

/** 階段を追加する。 */
export function addStairs() {
  const nextIndex = state.stairs.length + 1;
  state.stairs.push(createFlatRoom('S', nextIndex, `階段${nextIndex}`));
  notify();
}

/** 屋上を追加する。 */
export function addRoof() {
  const nextIndex = state.roof.length + 1;
  const label = nextIndex === 1 ? '屋上' : `屋上${nextIndex}`;
  state.roof.push(createFlatRoom('R', nextIndex, label));
  notify();
}

/**
 * 指定した通常階／地下階フロアへ部屋を1つ追加する。
 *
 * @param {string} floorKey `${areaCode}:${floor}` 形式のフロア識別キー
 */
export function addRoomToFloor(floorKey) {
  const floorGroup = state.floors.find((f) => floorGroupKey(f) === floorKey);
  if (!floorGroup) return;
  const nextIndex = floorGroup.rooms.length + 1;
  floorGroup.rooms.push(createFloorRoom(floorGroup.areaCode, floorGroup.floor, nextIndex));
  notify();
}

/** 外部の面（部屋相当）を1つ追加する。 */
export function addExternalRoom() {
  const nextIndex = state.externalRooms.length + 1;
  state.externalRooms.push(createFlatRoom('E', nextIndex, `面${nextIndex}`));
  notify();
}

/**
 * 指定した部屋の入力行を1行追加する（全部位に共通で1行増える）。
 *
 * @param {string} key roomKey()で得られる部屋識別キー
 */
export function addInputRow(key) {
  const room = findRoomByKey(key);
  if (!room) return;
  room.rowCount += 1;
  notify();
}

// createInitialFinishStructure内のヘルパーと同じ形を、追加操作用にもここへ持つ。
// サンプル初期データ生成（sample-finish-data.js）とは責務を分け、
// 「追加操作でどんな部屋を作るか」は本処理側のこのファイルが決める。
function createFloorRoom(areaCode, floor, roomIndex) {
  const roomNo = floor * 100 + roomIndex;
  return { areaCode, floor, roomIndex, roomNo, name: `${roomNo}号室`, rowCount: 2, cells: {} };
}
function createFlatRoom(areaCode, index, label) {
  return { areaCode, index, name: label, rowCount: 2, cells: {} };
}

/* ============================================================
   部屋選択・セル選択・建材選択・カラーON/OFF
   ============================================================ */

export function setSelectedRoomKey(key) {
  state.selectedRoomKey = key;
}
export function getSelectedRoomKey() {
  return state.selectedRoomKey;
}

export function setActiveCellKey(finishId) {
  state.activeCellKey = finishId;
}
export function getActiveCellKey() {
  return state.activeCellKey;
}

export function setSelectedMaterialInputId(inputId) {
  state.selectedMaterialInputId = inputId;
}
export function getSelectedMaterialInputId() {
  return state.selectedMaterialInputId;
}

export function toggleColorMode() {
  state.colorMode = !state.colorMode;
  notify();
}
export function getColorMode() {
  return state.colorMode;
}

/** @returns {object|undefined} 名称が一致するサンプル建材（前後空白を無視した完全一致）。 */
export function findMaterialByName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return undefined;
  return state.materials.find((m) => m.name === normalized);
}

/** @returns {object|undefined} 入力IDが一致するサンプル建材。 */
export function findMaterialByInputId(inputId) {
  return state.materials.find((m) => m.inputId === inputId);
}
