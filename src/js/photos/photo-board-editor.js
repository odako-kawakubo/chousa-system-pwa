/**
 * src/js/photos/photo-board-editor.js
 *
 * v0.1.5.6A 撮影済み写真の電子看板編集。
 * v64の「元写真 + 看板を同じ画面で確認し、Undo/Redo後に再合成」の流れを採用し、
 * 本PWAでは写真固有項目だけを編集する。
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
let active = null;
let originalImage = null;
let originalUrl = '';
let history = [];
let historyIndex = -1;
let renderToken = 0;
let saving = false;
let swipeStart = null;

function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function dateText(value) {
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}
function sampleDisplay(base, branch) { return `${base || ''}${MARKS[branch] ? `-${MARKS[branch]}` : ''}`; }
function currentStatusCode() {
  if (active.record.photoType === PHOTO_TYPES.VISUAL) return '5';
  if (active.draft.shootingType === SHOOTING_TYPES.SECTION) return '4';
  return ({ before:'1', during:'2', after:'3' })[active.draft.shootingType] || '1';
}
function boardData() {
  const settings = boardSettingsStore.get();
  return {
    photoType: active.record.photoType,
    projectName: settings.subjectText || settings.projectName,
    address: settings.addressText || settings.address,
    subjectFontSize: settings.subjectFontSize,
    addressFontSize: settings.addressFontSize,
    roomNo: active.draft.roomNo,
    part: active.draft.part,
    samplingPlace: active.draft.samplingPlace,
    sampleNo: sampleDisplay(active.draft.sampleBaseNo, active.draft.samplingBranch),
    statusCode: currentStatusCode(),
    date: dateText(active.record.capturedAt)
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

function pushHistory() {
  const snap = clone(active.draft);
  const current = history[historyIndex];
  if (current && JSON.stringify(current) === JSON.stringify(snap)) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  historyIndex = history.length - 1;
  updateHistoryButtons();
}
function applyHistory(index) {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  active.draft = clone(history[index]);
  renderControls();
  renderPreview();
  updateHistoryButtons();
}
function updateHistoryButtons() {
  root?.querySelector('[data-editor-undo]')?.toggleAttribute('disabled', historyIndex <= 0);
  root?.querySelector('[data-editor-redo]')?.toggleAttribute('disabled', historyIndex >= history.length - 1);
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
}

async function loadImageFromBlob(blob) {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = originalUrl;
  await image.decode();
  return image;
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
      drawBoard(ctx, { x: dx+rect.x, y: dy+rect.y, width: rect.width, height: rect.height }, boardData());
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

async function composeCompletedBlob() {
  const originalBlob = await getPhotoBlob(active.record.photoId, 'original');
  if (!originalBlob) throw new Error('元写真が端末内にありません。');
  const img = await loadImageFromBlob(originalBlob);
  const out = document.createElement('canvas'); out.width=img.width; out.height=img.height;
  const ctx=out.getContext('2d'); ctx.drawImage(img,0,0);
  if (!(active.record.photoType === PHOTO_TYPES.SAMPLING && active.draft.shootingType === SHOOTING_TYPES.SECTION)) {
    const rect=getBoardRect(out.width,out.height,active.draft.boardPosition,active.draft.boardSize,780);
    drawBoard(ctx,rect,boardData());
  }
  return new Promise((resolve,reject)=>out.toBlob((blob)=>blob?resolve(blob):reject(new Error('完成画像を生成できませんでした。')),'image/jpeg',0.82));
}

async function saveEdit(navigateDirection = 0) {
  if (!active || saving) return;
  saving = true;
  const originalBlob = await getPhotoBlob(active.record.photoId, 'original');
  if (!originalBlob) throw new Error('元写真が端末内にありません。');
  const completedBlob = await composeCompletedBlob();
  const now = new Date().toISOString();
  const nextFields = active.record.photoType === PHOTO_TYPES.VISUAL
    ? { roomPosition:active.draft.roomPosition, roomNo:active.draft.roomNo, part:active.draft.part }
    : { materialId:active.draft.materialId || active.record.materialId, samplingPlace:active.draft.samplingPlace, samplingBranch:active.draft.samplingBranch, sampleNo:sampleDisplay(active.draft.sampleBaseNo, active.draft.samplingBranch), sampleBaseNo:active.draft.sampleBaseNo, part:active.draft.part, shootingType:active.draft.shootingType };
  const fileName = getAvailablePhotoFileName({ photoType:active.record.photoType, ...nextFields }, photoRecordStore.getAll(), active.record.photoId);
  const record = photoRecordStore.set({
    ...active.record,
    ...nextFields,
    fileName,
    boardPosition:active.draft.boardPosition,
    boardSize:active.draft.boardSize,
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
  closePhotoBoardEditor('saved');
  saving = false;
  await onSaved?.({ record, completedBlob, navigateDirection });
}

function canNavigate(direction) {
  if (!active?.navigation) return false;
  return direction < 0 ? Boolean(active.navigation.canNavigatePrev) : Boolean(active.navigation.canNavigateNext);
}

function handleEditorSwipeStart(event) {
  if (!active || saving || event.pointerType === 'mouse' && event.button !== 0) return;
  swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
}

function handleEditorSwipeEnd(event) {
  if (!swipeStart || swipeStart.pointerId !== event.pointerId || !active || saving) {
    swipeStart = null;
    return;
  }
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;

  // 横方向が明確なスワイプだけを写真移動として扱う。
  if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
  const direction = dx < 0 ? 1 : -1;
  if (!canNavigate(direction)) return;

  // 写真切替前に必ず既存のsaveEdit()で現在写真を確定する。
  // 未保存のまま次写真へ移動する経路は作らない。
  saveEdit(direction).catch((error) => {
    saving = false;
    console.error(error);
    alert(`看板編集の保存に失敗しました。\n${error.message || error}`);
  });
}

function bindEvents() {
  root.addEventListener('change',(event)=>updateDraftFromEvent(event.target));
  const stage = root.querySelector('.photo-board-editor-stage');
  stage?.addEventListener('pointerdown', handleEditorSwipeStart);
  stage?.addEventListener('pointerup', handleEditorSwipeEnd);
  stage?.addEventListener('pointercancel', () => { swipeStart = null; });
  root.addEventListener('click',(event)=>{
    if (event.target.closest('[data-editor-close]')) return closePhotoBoardEditor();
    if (event.target.closest('[data-editor-undo]')) return applyHistory(historyIndex-1);
    if (event.target.closest('[data-editor-redo]')) return applyHistory(historyIndex+1);
    if (event.target.closest('[data-editor-reset]')) return applyHistory(0);
    if (event.target.closest('[data-editor-save]')) saveEdit().catch((error)=>{saving=false;console.error(error);alert(`看板編集の保存に失敗しました。\n${error.message||error}`);});
  });
  window.addEventListener('resize',renderPreview);
}

export function initializePhotoBoardEditor(options={}) {
  optionsProvider = typeof options.getOptions === 'function' ? options.getOptions : optionsProvider;
  onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
  onClosed = typeof options.onClosed === 'function' ? options.onClosed : null;
  ensureRoot();
}

export async function openPhotoBoardEditor(photoId, navigation = {}) {
  ensureRoot();
  const record = photoRecordStore.get(photoId);
  if (!record || record.deleted) return false;
  const originalBlob = await getPhotoBlob(photoId,'original');
  if (!originalBlob) { alert('この写真の元写真が端末内にありません。'); return false; }
  originalImage = await loadImageFromBlob(originalBlob);
  active = {
    record:{...record},
    draft:snapshotFromRecord(record),
    navigation:{
      canNavigatePrev:Boolean(navigation.canNavigatePrev),
      canNavigateNext:Boolean(navigation.canNavigateNext)
    }
  };
  saving = false;
  swipeStart = null;
  history=[clone(active.draft)]; historyIndex=0;
  renderControls(); updateHistoryButtons();
  root.hidden=false; document.body.classList.add('photo-board-edit-open');
  renderPreview();
  return true;
}

export function closePhotoBoardEditor(reason = 'cancel') {
  if (!root) return;
  root.hidden=true; document.body.classList.remove('photo-board-edit-open');
  active=null; history=[]; historyIndex=-1; originalImage=null; saving=false; swipeStart=null;
  if (originalUrl) { URL.revokeObjectURL(originalUrl); originalUrl=''; }
  onClosed?.(reason);
}
