/**
 * src/js/finish-table/finish-table-state.js
 *
 * 仕上表のUI専用状態だけを保持する。業務データの正本は
 * finishRecordStore／materialRecordStore（src/js/store/）であり、ここでは
 * 選択・フォーカス・表示モード・部屋コピー途中状態などだけを持つ。
 */

import { getCurrentProject } from '../projects/project-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';

let state = null;
const listeners = [];
let tabChangeBound = false;
let roomIdentityBound = false;

function notify() {
  listeners.forEach((callback) => callback());
}

function emptyRoomCopyState() {
  return { sourceRoomKey: null, sourceStableKey: null, backups: {}, done: {} };
}

/** roomUidではなく、同期復元後も同じ論理部屋を指せる構造キー。 */
function stableRoomKey(record) {
  if (!record) return '';
  const areaCode = String(record.areaCode || '');
  const roomPosition = String(record.roomPosition || '');
  return areaCode && roomPosition ? `${areaCode}|${roomPosition}` : '';
}

function recordForRoomUid(roomUid) {
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && String(record.roomUid || '') === String(roomUid || '')
  ) || null;
}

function roomUidForStableKey(key) {
  if (!key) return '';
  const record = finishRecordStore.getAll().find((item) =>
    item.status === 'active' && stableRoomKey(item) === key
  );
  return String(record?.roomUid || '');
}

/**
 * Firestoreの疎finish復元でroomUidが再生成されても、コピー途中状態だけは
 * areaCode + roomPosition を使って現在のroomUidへ付け替える。
 * Store購読はUI再描画には使わず、状態の参照先補正だけを行う。
 */
function reconcileRoomCopyIdentity() {
  if (!state?.roomCopy) return;
  const copy = state.roomCopy;

  if (copy.sourceStableKey) {
    const nextSourceUid = roomUidForStableKey(copy.sourceStableKey);
    if (nextSourceUid) copy.sourceRoomKey = nextSourceUid;
  }

  const nextBackups = {};
  const nextDone = {};
  Object.entries(copy.backups || {}).forEach(([oldUid, records]) => {
    const anchor = Array.isArray(records) ? records[0] : null;
    const key = stableRoomKey(anchor) || stableRoomKey(recordForRoomUid(oldUid));
    const nextUid = roomUidForStableKey(key) || oldUid;
    nextBackups[nextUid] = records;
    if (copy.done?.[oldUid]) nextDone[nextUid] = true;
  });
  Object.keys(copy.done || {}).forEach((oldUid) => {
    if (nextDone[oldUid]) return;
    const key = stableRoomKey(recordForRoomUid(oldUid));
    const nextUid = roomUidForStableKey(key) || oldUid;
    nextDone[nextUid] = true;
  });
  copy.backups = nextBackups;
  copy.done = nextDone;
}

function bindRoomIdentityReconciliation() {
  if (roomIdentityBound) return;
  roomIdentityBound = true;
  finishRecordStore.subscribe(() => {
    reconcileRoomCopyIdentity();
  });
}

/**
 * 仕上表から別タブへ移った時点でコピー操作を完全終了する。
 * コピー済みデータ自体は変更しない。コピー専用「戻す」は終了するが、
 * 上部の通常Undo/Redo履歴は別管理なので残る。
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
    roomCopy: emptyRoomCopyState(),
    collapsedFloors: new Set(),
    pendingCellNames: new Map()
  };
  bindTabChangeReset();
  bindRoomIdentityReconciliation();
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
  if (state.collapsedFloors.has(floorKeyValue)) state.collapsedFloors.delete(floorKeyValue);
  else state.collapsedFloors.add(floorKeyValue);
  notify();
}

export function isFloorCollapsed(floorKeyValue) {
  return state.collapsedFloors.has(floorKeyValue);
}

/* ============================================================
   部屋コピー専用状態
   ============================================================ */

export function getRoomCopyState() {
  reconcileRoomCopyIdentity();
  return state.roomCopy;
}

/** コピー元として選択する。同期復元に備え、構造キーも同時に保持する。 */
export function startRoomCopySource(roomKeyValue) {
  const anchor = recordForRoomUid(roomKeyValue);
  state.roomCopy.sourceRoomKey = roomKeyValue;
  state.roomCopy.sourceStableKey = stableRoomKey(anchor) || null;
  notify();
}

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
  reconcileRoomCopyIdentity();
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
