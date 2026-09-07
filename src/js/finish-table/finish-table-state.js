/**
 * src/js/finish-table/finish-table-state.js
 *
 * 仕上表のUI専用状態だけを保持する。v0.1.5.1より前はここに部屋・建材の
 * 業務データ（floors/stairs/roof/externalRooms/materials/room.cells等）も
 * 同居していたが、正本はfinishRecordStore／materialRecordStore
 * （src/js/store/）へ移した。このファイルは、finishRecordStore／
 * materialRecordStoreの中身だけでは判定できない「今の画面状態」
 * （どのタブ・どの部屋・どの入力欄を見ているか、部屋コピーの途中経過等）
 * だけを持つ。
 *
 * 何を保持しているか：
 *   project（案件情報。今回のRecord移行の対象外）、activeAreaMode（内部／外部）、
 *   colorMode／chipInputMode／simpleListOpen（表示・操作モード）、
 *   activeRoomKey／activeGroupKey／focusedInputKey（選択・フォーカス）、
 *   selectedMaterialInputId（簡易リストのチップ選択）、roomCopy（部屋コピー
 *   専用状態。バックアップの中身はfinishRecordStoreのスナップショット）、
 *   collapsedFloors（階折りたたみ）、pendingCellNames（建材に未リンクの
 *   まま確定されたセルの表示名。finishRecordには保持しない一時キャッシュ）。
 *
 * Undo/Redo（戻る/進む）の対象にしないもの：
 *   このファイルが持つ状態はすべてUndo/Redoの対象外。対象は
 *   finishRecordStore／materialRecordStoreだけ（finish-table-controller.jsの
 *   getUndoableSnapshot()を参照）。
 */

import { getCurrentProject } from '../projects/project-store.js';

let state = null;
const listeners = [];
let tabChangeBound = false;

function notify() {
  listeners.forEach((callback) => callback());
}

function emptyRoomCopyState() {
  return { sourceRoomKey: null, backups: {}, done: {} };
}

/**
 * v0.1.6.6: 仕上表から別タブへ移った時点でコピー操作を完全終了する。
 * コピー済みの業務データ自体は変更しない。コピー専用の「戻す」だけは終了するが、
 * 仕上表上部の通常Undo/Redo履歴は別管理なのでそのまま利用できる。
 */
function bindTabChangeReset() {
  if (tabChangeBound) return;
  tabChangeBound = true;
  window.addEventListener('chousa:tab-change', (event) => {
    if (!state) return;
    const previousTab = String(event.detail?.previousTab || '');
    const currentTab = String(event.detail?.currentTab || '');
    if (previousTab !== 'finish' || currentTab === 'finish') return;

    const copy = state.roomCopy || emptyRoomCopyState();
    const copyActive = Boolean(copy.sourceRoomKey)
      || Object.keys(copy.backups || {}).length > 0
      || Object.keys(copy.done || {}).length > 0;
    if (!copyActive) return;

    state.roomCopy = emptyRoomCopyState();
    notify();
  });
}

/**
 * UI状態の変更を購読する。finishRecordStore／materialRecordStoreの
 * 購読とは別物（Storeの変更はfinish-table-controller.jsが個別のアクション
 * 呼び出し後に明示的な再描画で反映するため、Store側の購読を描画には
 * 使わない。詳細はfinish-table-actions.jsのrunRecordTransaction()を参照）。
 *
 * @param {() => void} callback
 * @returns {() => void} 購読解除関数
 */
export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function initFinishTableState() {
  state = {
    project: getCurrentProject(),

    activeAreaMode: 'internal',
    colorMode: false,
    chipInputMode: false,
    simpleListOpen: true,

    activeRoomKey: null,
    activeGroupKey: null,
    focusedInputKey: null,
    selectedMaterialInputId: null,

    // 部屋コピー専用状態。入力選択状態（activeRoomKey等）とは意図的に分離する。
    // backups[roomKey]はコピー実行前のfinishRecord[]、doneは「戻す」可能な対象。
    roomCopy: emptyRoomCopyState(),

    collapsedFloors: new Set(),
    pendingCellNames: new Map()
  };
  bindTabChangeReset();
  notify();
}

export function getState() {
  return state;
}

export function setProject(project) {
  if (!state) return;
  state.project = project ? { ...project } : null;
  state.activeAreaMode = 'internal';
  state.activeRoomKey = null;
  state.activeGroupKey = null;
  state.focusedInputKey = null;
  state.selectedMaterialInputId = null;
  state.roomCopy = emptyRoomCopyState();
  state.collapsedFloors = new Set();
  state.pendingCellNames = new Map();
  notify();
}

/* ============================================================
   表示モード
   ============================================================ */

export function setAreaMode(mode) {
  state.activeAreaMode = mode === 'external' ? 'external' : 'internal';
  state.activeRoomKey = null;
  state.activeGroupKey = null;
  state.focusedInputKey = null;
  notify();
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
   選択・フォーカス
   ============================================================ */

export function setSelectedRoomKey(key) {
  state.activeRoomKey = key || null;
}
export function getSelectedRoomKey() {
  return state.activeRoomKey;
}

export function setSelectedGroupKey(key) {
  state.activeGroupKey = key || null;
}
export function getSelectedGroupKey() {
  return state.activeGroupKey;
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

/* ============================================================
   階折りたたみ
   ============================================================ */

export function toggleFloorCollapsed(floorKeyValue) {
  if (!floorKeyValue) return;
  if (state.collapsedFloors.has(floorKeyValue)) {
    state.collapsedFloors.delete(floorKeyValue);
  } else {
    state.collapsedFloors.add(floorKeyValue);
  }
  notify();
}

export function isFloorCollapsed(floorKeyValue) {
  return state.collapsedFloors.has(floorKeyValue);
}

/* ============================================================
   部屋コピー専用状態
   ============================================================ */

export function getRoomCopyState() {
  return state.roomCopy;
}

/** コピー元として選択する。 */
export function startRoomCopySource(roomKeyValue) {
  state.roomCopy.sourceRoomKey = roomKeyValue;
  notify();
}

/**
 * コピー元の選択を解除する。解除時はdone／backupsも含めてコピー関連状態を
 * 全てクリアする。コピー先セルに反映済みの値そのものは変更しない。
 */
export function cancelRoomCopySource() {
  state.roomCopy = emptyRoomCopyState();
  notify();
}

export function recordRoomCopyBackup(roomKeyValue, records) {
  state.roomCopy.backups[roomKeyValue] = records;
  state.roomCopy.done[roomKeyValue] = true;
  notify();
}

export function clearRoomCopyBackup(roomKeyValue) {
  delete state.roomCopy.backups[roomKeyValue];
  delete state.roomCopy.done[roomKeyValue];
  notify();
}

export function getRoomCopyBackup(roomKeyValue) {
  return state.roomCopy.backups[roomKeyValue] || null;
}

/* ============================================================
   未登録建材名の一時表示（pending名）
   ============================================================ */

export function setPendingCellName(cellKeyValue, name) {
  if (!name) {
    state.pendingCellNames.delete(cellKeyValue);
    return;
  }
  state.pendingCellNames.set(cellKeyValue, name);
}

export function clearPendingCellName(cellKeyValue) {
  state.pendingCellNames.delete(cellKeyValue);
}

export function getPendingCellName(cellKeyValue) {
  return state.pendingCellNames?.get(cellKeyValue) || '';
}
