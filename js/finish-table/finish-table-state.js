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

import { sampleProject } from '../demo/sample-project.js';

let state = null;
const listeners = [];

function notify() {
  listeners.forEach((callback) => callback());
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
    project: sampleProject,

    activeAreaMode: 'internal',
    colorMode: true,
    chipInputMode: false,
    simpleListOpen: true,

    activeRoomKey: null,
    activeGroupKey: null,
    focusedInputKey: null,
    selectedMaterialInputId: null,

    // 部屋コピー専用状態。入力選択状態（activeRoomKey等）とは意図的に分離する
    // （「部屋を選んでいるだけなのにコピーの色が付く」事故を防ぐための設計。
    // v0.1.4までと変わらない）。backups[roomKey]は
    // finish-table-actions.jsのsnapshotRoomRecords()が返すfinishRecordの
    // 配列（旧room.cellsのスナップショットではない）。
    roomCopy: {
      sourceRoomKey: null,
      backups: {}, // { [対象roomKey]: コピー実行前のfinishRecord[]スナップショット }
      done: {}     // { [対象roomKey]: true } … 「戻す」操作が可能な対象
    },

    // 階の折りたたみ専用状態。floorGroupKey()の値の集合。表示の開閉だけに使う。
    collapsedFloors: new Set(),

    // 建材に未リンクのまま確定された（「登録」ボタンが必要な）セルの表示名。
    // finishRecordは意味のある内容（materialId等）を持たないレコードを
    // 保持しないため、この名称はfinishRecordStoreへは書き込まず、ここへ
    // 一時的に持たせる。real linkが成立した時点（ID一致・登録実行）で消す。
    pendingCellNames: new Map()
  };
  notify();
}

export function getState() {
  return state;
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

/**
 * 階見出し行の開閉。表示・非表示だけを切り替える操作であり、部屋・建材
 * データは変更しない。Undo/Redo（戻る/進む）の対象には含めない。
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
 * 全てクリアする（「戻す」表示が解除後も残る不具合を防ぐ、v0.1.3からの
 * 既存仕様）。コピー先セルに既に反映済みの値そのものは変更しない
 * （元に戻す操作だけができなくなる）。
 */
export function cancelRoomCopySource() {
  state.roomCopy = { sourceRoomKey: null, backups: {}, done: {} };
  notify();
}

/**
 * コピー実行の直前に、対象部屋の現状（finish-table-actions.jsの
 * snapshotRoomRecords()の戻り値）をバックアップとして記録し、
 * 「戻す」操作を可能にする。
 * @param {string} roomKeyValue
 * @param {import('../records/finish-record.js').FinishRecord[]} records
 */
export function recordRoomCopyBackup(roomKeyValue, records) {
  state.roomCopy.backups[roomKeyValue] = records;
  state.roomCopy.done[roomKeyValue] = true;
  notify();
}

/** 「戻す」実行後、その部屋のバックアップ・done状態を消す。 */
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

/**
 * @param {string} cellKeyValue finish-table-view-model.jsのcellGroupKey()等と
 *   同じ形式で呼び出し側が組み立てるキー（roomKey|partIndex|row）。
 * @param {string} name
 */
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
