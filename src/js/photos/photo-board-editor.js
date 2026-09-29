/**
 * src/js/photos/photo-board-editor.js
 *
 * v0.1.7.6 撮影済み写真の電子看板編集。
 *
 * - 複数写真編集は写真ごとの draft / Undo・Redo履歴 / dirty状態を保持する。
 * - 左右スワイプは表示写真の切替だけを行い、永続保存は発生させない。
 * - 「保存」押下時だけ、変更された写真を既存の1枚保存経路で順番に確定する。
 * - 看板日付は capturedAt と分離した boardDate（YYYY-MM-DD）として編集・同期する。
 * - 旧写真に boardDate が無い場合だけ capturedAt の日付へフォールバックする。
 * - 看板編集に必要な元画像はローカル優先、無ければOneDriveから取得してIndexedDBへ保持する。
 *
 * 確定経路は増やさず、photo-board-editor-persistence.js の persistBoardEditorEntry() を全保存の唯一の入口とする。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES, isSamplingPhotoUnorganized, isVisualPhotoUnorganized } from '../records/photo-record.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import {
  BOARD_POSITION_LABELS,
  BOARD_SIZE_LABELS,
  drawBoard,
  getBoardRect
} from '../camera/camera-board.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import {
  bindPhotoBoardEditorInteractions,
  resetPhotoBoardEditorInteractionState
} from './photo-board-editor-interactions.js';
import {
  createEmptyBoardEditorSession,
  createBoardEditorEntry,
  cloneEditorValue,
  refreshBoardEditorEntryDirty,
  boardEditorSessionHasUnsavedChanges,
  pushBoardEditorHistory,
  applyBoardEditorHistory,
} from './photo-board-editor-session.js';
import {
  persistBoardEditorEntry,
  formatBoardSampleNo
} from './photo-board-editor-persistence.js';
import {
  normalizeBoardEditorDateInput,
  boardEditorVisualRooms,
  boardEditorSamplingTargets,
  findBoardEditorVisualRoom,
  boardEditorSamplingMaterialTargets,
  boardEditorSamplingMaterials,
  renderBoardEditorForm,
  updateBoardEditorDraftFromEvent
} from './photo-board-editor-form.js';

const BOARD_POSITIONS = ['bottom-left', 'bottom-right', 'top-right', 'top-left'];
const BOARD_SIZES = ['small', 'medium', 'large'];
const STAGES = [SHOOTING_TYPES.BEFORE, SHOOTING_TYPES.DURING, SHOOTING_TYPES.AFTER];

let root = null;
let canvas = null;
let optionsProvider = () => ({ visualRooms: [], samplingTargets: [] });
let onSaved = null;
let onClosed = null;
let originalImage = null;
let originalUrl = '';
let renderToken = 0;
let saving = false;
let switching = false;

let session = createEmptyBoardEditorSession();
let active = null;

function dateInputValue(value) {
  return normalizeBoardEditorDateInput(value);
}

function boardDateFromRecord(record) {
  return dateInputValue(record?.boardDate) || dateInputValue(record?.capturedAt) || dateInputValue(new Date());
}

function dateText(value) {
  const iso = dateInputValue(value);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function sampleDisplay(base, branch) { return formatBoardSampleNo(base, branch); }

function currentStatusCode(entry = active) {
  if (!entry) return '1';
  if (entry.record.photoType === PHOTO_TYPES.VISUAL) return '5';
  if (entry.draft.shootingType === SHOOTING_TYPES.SECTION) return '4';
  return ({ before:'1', during:'2', after:'3' })[entry.draft.shootingType] || '';
}

function boardData(entry = active) {
  const settings = boardSettingsStore.get();
  return {
    photoType: entry.record.photoType,
    projectName: settings.subjectText || settings.projectName,
    address: settings.addressText || settings.address,
    subjectFontSize: settings.subjectFontSize,
    addressFontSize: settings.addressFontSize,
    roomNo: entry.draft.roomNo,
    part: entry.draft.part,
    samplingPlace: entry.draft.samplingPlace,
    sampleNo: sampleDisplay(entry.draft.sampleBaseNo, entry.draft.samplingBranch),
    statusCode: currentStatusCode(entry),
    date: dateText(entry.draft.boardDate)
  };
}

function visualRooms() { return boardEditorVisualRooms(optionsProvider); }
function samplingTargets() { return boardEditorSamplingTargets(optionsProvider); }
function visualRoomByIdentity(identity = {}) { return findBoardEditorVisualRoom(optionsProvider, identity); }
function samplingMaterialTargets(materialId) { return boardEditorSamplingMaterialTargets(optionsProvider, materialId); }
function samplingMaterials() { return boardEditorSamplingMaterials(optionsProvider); }

function snapshotVisualFromRecord_(record) {
  const room = visualRoomByIdentity(record);
  const unorganized = isVisualPhotoUnorganized(record);
  const target = unorganized ? null : room?.targets?.find((item) => Number(item.partSlot || 0) === Number(record.partSlot || 0)) || null;

  return {
    areaCode: record.areaCode || room?.areaCode || '',
    roomPosition: record.roomPosition || room?.roomPosition || '',
    partSlot: Number(record.partSlot || 0),
    roomNo: record.roomNo || room?.roomNo || '',
    part: record.part || target?.part || '',
    boardDate: boardDateFromRecord(record),
    boardPosition: record.boardPosition || 'bottom-left',
    boardSize: record.boardSize || 'medium'
  };
}

function snapshotSamplingFromRecord_(record) {
  const materials = samplingMaterials();
  const material = materials.find((item) => item.materialId === record.materialId) || null;
  const targets = samplingMaterialTargets(record.materialId);
  const unorganized = isSamplingPhotoUnorganized(record);
  const target = unorganized ? null : targets.find((item) => Number(item.branch) === Number(record.samplingBranch)) || null;

  return {
    materialId: record.materialId || material?.materialId || '',
    sampleBaseNo: record.sampleBaseNo || String(record.sampleNo || '').split('-')[0] || material?.sampleBaseNo || '',
    samplingBranch: Number(record.samplingBranch || 0),
    samplingPlace: record.samplingPlace || target?.samplingPlace || '',
    part: record.part || target?.part || '',
    shootingType: record.shootingType || '',
    boardDate: boardDateFromRecord(record),
    boardPosition: record.boardPosition || 'bottom-left',
    boardSize: record.boardSize || 'medium'
  };
}

function snapshotFromRecord(record) {
  return record.photoType === PHOTO_TYPES.VISUAL ? snapshotVisualFromRecord_(record) : snapshotSamplingFromRecord_(record);
}

function createEntry_(record) {
  return createBoardEditorEntry(record, snapshotFromRecord(record));
}

function refreshDirty_(entry = active) {
  return refreshBoardEditorEntryDirty(entry);
}
function hasUnsavedChanges_() {
  return boardEditorSessionHasUnsavedChanges(session);
}

function pushHistory() {
  if (!active) return;
  if (!pushBoardEditorHistory(active)) return;
  updateHistoryButtons();
}

function applyHistory(index) {
  if (!active || !applyBoardEditorHistory(active, index)) return;
  renderControls();
  renderPreview();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  root?.querySelector('[data-editor-undo]')?.toggleAttribute('disabled', !active || active.historyIndex <= 0);
  root?.querySelector('[data-editor-redo]')?.toggleAttribute('disabled', !active || active.historyIndex >= active.history.length - 1);
}

function updateNavigationHint_() {
  const hint = root?.querySelector('[data-editor-sequence-hint]');
  if (!hint) return;
  if (session.ids.length <= 1) {
    hint.textContent = '';
    hint.hidden = true;
    return;
  }
  hint.hidden = false;
  hint.textContent = `${session.index + 1} / ${session.ids.length}　左右スワイプで写真切替`;
}

function ensureRoot() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'photo-board-editor';
  root.hidden = true;
  root.innerHTML = `
    <div class="photo-board-editor-shell">
      <div class="photo-board-editor-stage"><canvas data-photo-board-editor-canvas></canvas></div>
      <aside class="photo-board-editor-controls">
        <div class="photo-board-editor-head"><b>看板編集</b><button class="btn small" type="button" data-editor-close>閉じる</button></div>
        <div class="photo-board-editor-sequence-hint" data-editor-sequence-hint hidden></div>
        <div data-editor-fields></div>
        <div class="photo-board-editor-common">
          <label>日付<input type="date" data-editor-date></label>
          <label>看板位置<select data-editor-position>${BOARD_POSITIONS.map((v)=>`<option value="${v}">${BOARD_POSITION_LABELS[v] || v}</option>`).join('')}</select></label>
          <label>看板サイズ<select data-editor-size>${BOARD_SIZES.map((v)=>`<option value="${v}">${BOARD_SIZE_LABELS[v] || v}</option>`).join('')}</select></label>
        </div>
        <div class="photo-board-editor-history">
          <button class="btn small" type="button" data-editor-undo>戻る</button>
          <button class="btn small" type="button" data-editor-redo>進む</button>
          <button class="btn small" type="button" data-editor-reset>リセット</button>
        </div>
        <button class="btn primary" type="button" data-editor-save>保存</button>
      </aside>
    </div>`;
  document.body.appendChild(root);
  canvas = root.querySelector('[data-photo-board-editor-canvas]');
  bindPhotoBoardEditorInteractions({
    root,
    isActive: () => Boolean(active),
    isSaving: () => saving,
    isSwitching: () => switching,
    getSessionIndex: () => session.index,
    updateDraftFromEvent,
    requestClose: requestClose_,
    applyHistory: (direction) => {
      if (!active) return;
      if (direction === 'reset') return applyHistory(0);
      return applyHistory(active.historyIndex + Number(direction || 0));
    },
    saveSession: saveSession_,
    setSaving: (value) => { saving = Boolean(value); },
    canNavigate,
    activateIndex: activateIndex_,
    renderPreview
  });
}

function renderControls() {
  if (!active || !root) return;
  renderBoardEditorForm(root, active, optionsProvider);
  updateNavigationHint_();
}

async function loadImageFromBlob(blob) {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = originalUrl;
  await image.decode();
  return image;
}

async function loadOriginalImageForEntry_(entry) {
  const originalBlob = await resolveEditorOriginalPhoto(entry.record);
  if (!originalBlob) return false;
  originalImage = await loadImageFromBlob(originalBlob);
  return true;
}

function renderPreview() {
  if (!active || !originalImage || !canvas) return;
  const token = ++renderToken;
  requestAnimationFrame(() => {
    if (token !== renderToken || !active) return;
    const wrap = canvas.parentElement;
    const width = Math.max(1, Math.floor(wrap.clientWidth || 900));
    const height = Math.max(1, Math.floor(wrap.clientHeight || 650));
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const ir = originalImage.width / originalImage.height;
    const cr = canvas.width / canvas.height;
    let dw, dh, dx, dy;
    if (ir > cr) { dw=canvas.width; dh=dw/ir; dx=0; dy=(canvas.height-dh)/2; }
    else { dh=canvas.height; dw=dh*ir; dy=0; dx=(canvas.width-dw)/2; }
    ctx.drawImage(originalImage, dx, dy, dw, dh);
    if (!(active.record.photoType === PHOTO_TYPES.SAMPLING && active.draft.shootingType === SHOOTING_TYPES.SECTION)) {
      const rect = getBoardRect(dw, dh, active.draft.boardPosition, active.draft.boardSize);
      drawBoard(ctx, { x: dx+rect.x, y: dy+rect.y, width: rect.width, height: rect.height }, boardData(active));
    }
  });
}

function updateDraftFromEvent(target) {
  if (!active) return;
  const result = updateBoardEditorDraftFromEvent(target, active, optionsProvider);
  if (!result.changed) return;
  if (result.rerenderControls) renderControls();
  pushHistory();
  renderPreview();
}

async function saveSession_() {
  if (!active || saving) return;
  saving = true;
  try {
    const dirtyEntries = session.ids.map((photoId) => session.entries.get(photoId)).filter((entry) => entry?.dirty);
    const items = [];
    for (const entry of dirtyEntries) items.push(await persistBoardEditorEntry(entry, { getBoardData: boardData }));
    closeEditorInternal_('saved');
    await onSaved?.({ items });
  } catch (error) {
    if (active) {
      await loadOriginalImageForEntry_(active);
      renderControls();
      updateHistoryButtons();
      renderPreview();
    }
    throw error;
  } finally {
    saving = false;
  }
}

function canNavigate(direction) {
  if (!session.ids.length) return false;
  const nextIndex = session.index + direction;
  return nextIndex >= 0 && nextIndex < session.ids.length;
}

async function activateIndex_(index) {
  if (switching || saving) return false;
  if (index < 0 || index >= session.ids.length) return false;
  const photoId = session.ids[index];
  const entry = session.entries.get(photoId);
  if (!entry) return false;

  switching = true;
  try {
    const loaded = await loadOriginalImageForEntry_(entry);
    if (!loaded) {
      window.alert('元写真を取得できませんでした。OneDrive上の元画像を確認してください。');
      return false;
    }
    session.index = index;
    active = entry;
    renderControls();
    updateHistoryButtons();
    renderPreview();
    return true;
  } finally {
    switching = false;
  }
}

function requestClose_() {
  if (saving) return;
  if (hasUnsavedChanges_() && !window.confirm('未保存の看板編集があります。\n変更を破棄して閉じますか？')) return;
  closeEditorInternal_('cancel');
}


export function initializePhotoBoardEditor(options={}) {
  optionsProvider = typeof options.getOptions === 'function' ? options.getOptions : optionsProvider;
  onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
  onClosed = typeof options.onClosed === 'function' ? options.onClosed : null;
  ensureRoot();
}

async function startSession_(photoIds) {
  ensureRoot();
  const ids = [...new Set(photoIds || [])].filter((photoId) => {
    const record = photoRecordStore.get(photoId);
    return Boolean(record && !record.deleted);
  });
  if (!ids.length) return false;

  const entries = new Map();
  for (const photoId of ids) {
    const record = photoRecordStore.get(photoId);
    entries.set(photoId, createEntry_(record));
  }

  session = { ids, index: 0, entries };
  root.hidden=false;
  document.body.classList.add('photo-board-edit-open');
  const opened = await activateIndex_(0);
  if (!opened) {
    closeEditorInternal_('cancel');
    return false;
  }
  return true;
}

export function openPhotoBoardEditor(photoId) { return startSession_([photoId]); }
export function openPhotoBoardEditorSequence(photoIds) { return startSession_(photoIds); }

function closeEditorInternal_(reason = 'cancel') {
  if (!root) return;
  root.hidden=true;
  document.body.classList.remove('photo-board-edit-open');
  active=null;
  session=createEmptyBoardEditorSession();
  originalImage=null;
  switching=false;
  resetPhotoBoardEditorInteractionState();
  if (originalUrl) { URL.revokeObjectURL(originalUrl); originalUrl=''; }
  onClosed?.(reason);
}

export function closePhotoBoardEditor(reason = 'cancel') {
  if (reason === 'cancel') return requestClose_();
  closeEditorInternal_(reason);
}
