/**
 * src/js/photos/photo-board-editor.js
 *
 * v0.1.5.6H 撮影済み写真の電子看板編集。
 *
 * Hでの主な変更：
 * - 複数写真編集は「移動時保存」を廃止し、写真ごとのドラフトを編集セッション中に保持する。
 * - 左右スワイプは表示写真の切替だけを行い、永続保存は発生させない。
 * - 各写真ごとに draft / Undo・Redo履歴 / dirty状態を保持する。
 * - 「保存」押下時だけ、変更された写真を既存の1枚保存経路で順番に確定する。
 * - 閉じる時に未保存変更があれば確認してから破棄する。
 *
 * 確定経路は増やさず、persistEntry_() を全保存の唯一の入口とする。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { getPhotoBlob, savePhotoBlob, updateCameraPhotoRecord } from './photo-local-store.js';
import {
  BOARD_POSITION_LABELS,
  BOARD_SIZE_LABELS,
  drawBoard,
  getBoardRect
} from '../camera/camera-board.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import { getAvailablePhotoFileName } from './photo-filename.js';
import { getDeviceCode } from '../device-code.js';

const BOARD_POSITIONS = ['bottom-left', 'bottom-right', 'top-right', 'top-left'];
const BOARD_SIZES = ['small', 'medium', 'large'];
const STAGES = [SHOOTING_TYPES.BEFORE, SHOOTING_TYPES.DURING, SHOOTING_TYPES.AFTER];
const MARKS = { 1: '①', 2: '②', 3: '③' };

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
let swipeStart = null;

/**
 * 編集セッション。
 * entries は写真ごとに独立した draft / history / dirty を持つ。
 * スワイプで写真を移動しても内容はここに残るため、前の写真へ戻しても復元できる。
 */
let session = createEmptySession_();
let active = null;

function createEmptySession_() {
  return {
    ids: [],
    index: -1,
    entries: new Map()
  };
}

// v0.1.5.7A 業務固定色：完成写真へ合成する電子看板色。
// アプリのライト/ダークテーマでは変更しない。
function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sameDraft_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function dateText(value) {
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}
function sampleDisplay(base, branch) { return `${base || ''}${MARKS[branch] ? `-${MARKS[branch]}` : ''}`; }

function currentStatusCode(entry = active) {
  if (!entry) return '1';
  if (entry.record.photoType === PHOTO_TYPES.VISUAL) return '5';
  if (entry.draft.shootingType === SHOOTING_TYPES.SECTION) return '4';
  return ({ before:'1', during:'2', after:'3' })[entry.draft.shootingType] || '1';
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
    date: dateText(entry.record.capturedAt)
  };
}

function visualRooms() { return optionsProvider()?.visualRooms || []; }
function samplingTargets() { return optionsProvider()?.samplingTargets || []; }
function visualRoomByPosition(position) { return visualRooms().find((r) => r.roomPosition === position) || visualRooms()[0] || null; }
function samplingMaterialTargets(materialId) { return samplingTargets().filter((t) => t.materialId === materialId); }
function samplingMaterials() {
  const map = new Map();
  samplingTargets().forEach((t) => {
    if (!map.has(t.materialId)) map.set(t.materialId, { materialId:t.materialId, sampleBaseNo:String(t.sampleBaseNo || ''), targets:[] });
    map.get(t.materialId).targets.push(t);
  });
  return [...map.values()];
}

function snapshotFromRecord(record) {
  if (record.photoType === PHOTO_TYPES.VISUAL) {
    const room = visualRoomByPosition(record.roomPosition);
    return {
      roomPosition: room?.roomPosition || record.roomPosition || '',
      roomNo: room?.roomNo || record.roomNo || '',
      part: record.part || room?.targets?.[0]?.part || '',
      boardPosition: record.boardPosition || 'bottom-left',
      boardSize: record.boardSize || 'medium'
    };
  }
  const targets = samplingMaterialTargets(record.materialId);
  const target = targets.find((t) => Number(t.branch) === Number(record.samplingBranch)) || targets[0] || {};
  return {
    materialId: record.materialId || target.materialId || '',
    sampleBaseNo: record.sampleBaseNo || target.sampleBaseNo || String(record.sampleNo || '').split('-')[0] || '',
    samplingBranch: Number(record.samplingBranch || target.branch || 1),
    samplingPlace: record.samplingPlace || target.samplingPlace || '',
    part: record.part || target.part || '',
    shootingType: record.shootingType || SHOOTING_TYPES.BEFORE,
    boardPosition: record.boardPosition || 'bottom-left',
    boardSize: record.boardSize || 'medium'
  };
}

function createEntry_(record) {
  const initialDraft = snapshotFromRecord(record);
  return {
    record: { ...record },
    initialDraft: clone(initialDraft),
    draft: clone(initialDraft),
    history: [clone(initialDraft)],
    historyIndex: 0,
    dirty: false
  };
}

function refreshDirty_(entry = active) {
  if (!entry) return;
  entry.dirty = !sameDraft_(entry.draft, entry.initialDraft);
}

function hasUnsavedChanges_() {
  return [...session.entries.values()].some((entry) => entry.dirty);
}

function pushHistory() {
  if (!active) return;
  const snap = clone(active.draft);
  const current = active.history[active.historyIndex];
  if (current && sameDraft_(current, snap)) return;
  active.history = active.history.slice(0, active.historyIndex + 1);
  active.history.push(snap);
  active.historyIndex = active.history.length - 1;
  refreshDirty_();
  updateHistoryButtons();
}

function applyHistory(index) {
  if (!active || index < 0 || index >= active.history.length) return;
  active.historyIndex = index;
  active.draft = clone(active.history[index]);
  refreshDirty_();
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
  bindEvents();
}

function visualFields() {
  const rooms = visualRooms();
  const room = rooms.find((r) => r.roomPosition === active.draft.roomPosition) || rooms[0];
  const parts = room?.targets || [];
  return `<div class="photo-board-editor-fields">
    <label>部屋No.<select data-editor-room>${rooms.map((r)=>`<option value="${esc(r.roomPosition)}" ${r.roomPosition===active.draft.roomPosition?'selected':''}>${esc(r.roomNo || r.roomPosition)}</option>`).join('')}</select></label>
    <label>部位<select data-editor-part>${parts.map((p)=>`<option value="${esc(p.part)}" ${p.part===active.draft.part?'selected':''}>${esc(p.part)}</option>`).join('')}</select></label>
  </div>`;
}

function samplingFields() {
  const materials = samplingMaterials();
  const targets = samplingMaterialTargets(active.draft.materialId || active.record.materialId);
  const branches = [...new Set(targets.map((t)=>Number(t.branch)).filter(Boolean))];
  return `<div class="photo-board-editor-fields">
    <label>検体No.<select data-editor-sample>${materials.map((m)=>`<option value="${esc(m.materialId)}" ${m.materialId===(active.draft.materialId || active.record.materialId)?'selected':''}>${esc(m.sampleBaseNo)}</option>`).join('')}</select></label>
    <label>箇所<select data-editor-branch>${branches.map((b)=>`<option value="${b}" ${b===Number(active.draft.samplingBranch)?'selected':''}>${MARKS[b] || b}</option>`).join('')}</select></label>
    <label>撮影区分<select data-editor-stage>
      ${STAGES.map((v)=>`<option value="${v}" ${v===active.draft.shootingType?'selected':''}>${({before:'施工前',during:'施工中',after:'施工後'})[v]}</option>`).join('')}
      <option value="section" ${active.draft.shootingType==='section'?'selected':''}>断面</option>
    </select></label>
  </div>`;
}

function renderControls() {
  if (!active || !root) return;
  root.querySelector('[data-editor-fields]').innerHTML = active.record.photoType === PHOTO_TYPES.VISUAL ? visualFields() : samplingFields();
  root.querySelector('[data-editor-position]').value = active.draft.boardPosition;
  root.querySelector('[data-editor-size]').value = active.draft.boardSize;
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
  const originalBlob = await getPhotoBlob(entry.record.photoId, 'original');
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
      const rect = getBoardRect(dw, dh, active.draft.boardPosition, active.draft.boardSize, wrap.clientWidth || 780);
      drawBoard(ctx, { x: dx+rect.x, y: dy+rect.y, width: rect.width, height: rect.height }, boardData(active));
    }
  });
}

function syncSamplingPlace() {
  const target = samplingMaterialTargets(active.draft.materialId || active.record.materialId).find((t)=> Number(t.branch) === Number(active.draft.samplingBranch));
  if (target) {
    active.draft.samplingPlace = target.samplingPlace || '';
    active.draft.part = target.part || active.draft.part;
  }
}

function updateDraftFromEvent(target) {
  if (!active) return;
  if (target.matches('[data-editor-room]')) {
    const room = visualRooms().find((r)=>r.roomPosition===target.value);
    active.draft.roomPosition = room?.roomPosition || '';
    active.draft.roomNo = room?.roomNo || '';
    active.draft.part = room?.targets?.[0]?.part || '';
    renderControls();
  } else if (target.matches('[data-editor-part]')) active.draft.part = target.value;
  else if (target.matches('[data-editor-sample]')) {
    const material = samplingMaterials().find((m)=>m.materialId===target.value);
    active.draft.materialId = material?.materialId || target.value;
    active.draft.sampleBaseNo = material?.sampleBaseNo || '';
    const first = material?.targets?.[0];
    active.draft.samplingBranch = Number(first?.branch || 1);
    active.draft.samplingPlace = first?.samplingPlace || '';
    active.draft.part = first?.part || '';
    renderControls();
  }
  else if (target.matches('[data-editor-branch]')) { active.draft.samplingBranch = Number(target.value); syncSamplingPlace(); }
  else if (target.matches('[data-editor-stage]')) active.draft.shootingType = target.value;
  else if (target.matches('[data-editor-position]')) active.draft.boardPosition = target.value;
  else if (target.matches('[data-editor-size]')) active.draft.boardSize = target.value;
  else return;
  pushHistory();
  renderPreview();
}

async function composeCompletedBlob_(entry) {
  const originalBlob = await getPhotoBlob(entry.record.photoId, 'original');
  if (!originalBlob) throw new Error(`元写真が端末内にありません。 (${entry.record.photoId})`);
  const img = await loadImageFromBlob(originalBlob);
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(img,0,0);
  if (!(entry.record.photoType === PHOTO_TYPES.SAMPLING && entry.draft.shootingType === SHOOTING_TYPES.SECTION)) {
    const rect = getBoardRect(out.width,out.height,entry.draft.boardPosition,entry.draft.boardSize,780);
    drawBoard(ctx,rect,boardData(entry));
  }
  return new Promise((resolve,reject)=>out.toBlob((blob)=>blob?resolve(blob):reject(new Error('完成画像を生成できませんでした。')),'image/jpeg',0.82));
}

/**
 * 1枚分の正式な保存処理。
 * 単独編集も複数編集の一括保存も必ずこの関数だけを通す。
 */
async function persistEntry_(entry) {
  const originalBlob = await getPhotoBlob(entry.record.photoId, 'original');
  if (!originalBlob) throw new Error(`元写真が端末内にありません。 (${entry.record.photoId})`);

  const completedBlob = await composeCompletedBlob_(entry);
  const now = new Date().toISOString();
  const nextFields = entry.record.photoType === PHOTO_TYPES.VISUAL
    ? { roomPosition:entry.draft.roomPosition, roomNo:entry.draft.roomNo, part:entry.draft.part }
    : {
        materialId:entry.draft.materialId || entry.record.materialId,
        samplingPlace:entry.draft.samplingPlace,
        samplingBranch:entry.draft.samplingBranch,
        sampleNo:sampleDisplay(entry.draft.sampleBaseNo, entry.draft.samplingBranch),
        sampleBaseNo:entry.draft.sampleBaseNo,
        part:entry.draft.part,
        shootingType:entry.draft.shootingType
      };

  const fileName = getAvailablePhotoFileName(
    { photoType:entry.record.photoType, ...nextFields },
    photoRecordStore.getAll(),
    entry.record.photoId
  );

  const record = photoRecordStore.set({
    ...entry.record,
    ...nextFields,
    fileName,
    boardPosition:entry.draft.boardPosition,
    boardSize:entry.draft.boardSize,
    isEdited:true,
    lastEditedDevice:getDeviceCode(),
    lastEditedAt:now,
    syncStatus:'pending',
    localOriginalStatus:'saved',
    localCompletedStatus:'saved'
  });

  await savePhotoBlob(record.photoId,'original',originalBlob,{createdAt:record.capturedAt,fileName,uploadStatus:'pending'});
  await savePhotoBlob(record.photoId,'completed',completedBlob,{createdAt:now,fileName,uploadStatus:'pending'});
  await updateCameraPhotoRecord(record);

  entry.record = { ...record };
  entry.initialDraft = clone(entry.draft);
  entry.history = [clone(entry.draft)];
  entry.historyIndex = 0;
  entry.dirty = false;

  return { record, completedBlob };
}

/**
 * 保存ボタンの処理。
 * 変更された写真だけを、上の1枚保存処理へ順番に渡す。
 */
async function saveSession_() {
  if (!active || saving) return;
  saving = true;
  try {
    const dirtyEntries = session.ids
      .map((photoId) => session.entries.get(photoId))
      .filter((entry) => entry?.dirty);

    const items = [];
    for (const entry of dirtyEntries) {
      items.push(await persistEntry_(entry));
    }

    closeEditorInternal_('saved');
    await onSaved?.({ items });
  } catch (error) {
    // 一括保存の途中で失敗しても、現在編集中写真のプレビューへ戻してEditorを維持する。
    // 既に確定した写真はdirty=falseになっているため、再度「保存」しても二重保存しない。
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
      window.alert('この写真の元写真が端末内にありません。');
      return false;
    }
    session.index = index;
    active = entry;
    swipeStart = null;
    renderControls();
    updateHistoryButtons();
    renderPreview();
    return true;
  } finally {
    switching = false;
  }
}

function handleEditorSwipeStart(event) {
  if (!active || saving || switching || event.pointerType === 'mouse' && event.button !== 0) return;
  swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
}

function handleEditorSwipeEnd(event) {
  if (!swipeStart || swipeStart.pointerId !== event.pointerId || !active || saving || switching) {
    swipeStart = null;
    return;
  }
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;

  if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
  const direction = dx < 0 ? 1 : -1;
  if (!canNavigate(direction)) return;

  // Hではスワイプは表示切替だけ。永続保存は保存ボタンでのみ行う。
  activateIndex_(session.index + direction).catch((error) => {
    console.error(error);
    window.alert(`写真の切り替えに失敗しました。\n${error.message || error}`);
  });
}

function requestClose_() {
  if (saving) return;
  if (hasUnsavedChanges_() && !window.confirm('未保存の看板編集があります。\n変更を破棄して閉じますか？')) return;
  closeEditorInternal_('cancel');
}

function bindEvents() {
  root.addEventListener('change',(event)=>updateDraftFromEvent(event.target));
  const stage = root.querySelector('.photo-board-editor-stage');
  stage?.addEventListener('pointerdown', handleEditorSwipeStart);
  stage?.addEventListener('pointerup', handleEditorSwipeEnd);
  stage?.addEventListener('pointercancel', () => { swipeStart = null; });
  root.addEventListener('click',(event)=>{
    if (event.target.closest('[data-editor-close]')) return requestClose_();
    if (event.target.closest('[data-editor-undo]')) return applyHistory(active?.historyIndex - 1);
    if (event.target.closest('[data-editor-redo]')) return applyHistory(active?.historyIndex + 1);
    if (event.target.closest('[data-editor-reset]')) return applyHistory(0);
    if (event.target.closest('[data-editor-save]')) {
      saveSession_().catch((error)=>{
        saving=false;
        console.error(error);
        window.alert(`看板編集の保存に失敗しました。\n${error.message||error}`);
      });
    }
  });
  window.addEventListener('resize',renderPreview);
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

/** 単独写真編集。PhotoViewerからの編集もこの経路を使う。 */
export function openPhotoBoardEditor(photoId) {
  return startSession_([photoId]);
}

/** 複数写真編集。写真ごとのドラフトと履歴を1セッション内で保持する。 */
export function openPhotoBoardEditorSequence(photoIds) {
  return startSession_(photoIds);
}

function closeEditorInternal_(reason = 'cancel') {
  if (!root) return;
  root.hidden=true;
  document.body.classList.remove('photo-board-edit-open');
  active=null;
  session=createEmptySession_();
  originalImage=null;
  swipeStart=null;
  switching=false;
  if (originalUrl) { URL.revokeObjectURL(originalUrl); originalUrl=''; }
  onClosed?.(reason);
}

/** 外部から強制的に閉じる必要がある場合の既存互換入口。 */
export function closePhotoBoardEditor(reason = 'cancel') {
  if (reason === 'cancel') return requestClose_();
  closeEditorInternal_(reason);
}
