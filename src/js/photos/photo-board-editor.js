/**
 * src/js/photos/photo-board-editor.js
 *
 * v0.1.7.5 撮影済み写真の電子看板編集。
 *
 * - 複数写真編集は写真ごとの draft / Undo・Redo履歴 / dirty状態を保持する。
 * - 左右スワイプは表示写真の切替だけを行い、永続保存は発生させない。
 * - 「保存」押下時だけ、変更された写真を既存の1枚保存経路で順番に確定する。
 * - 看板日付は capturedAt と分離した boardDate（YYYY-MM-DD）として編集・同期する。
 * - 旧写真に boardDate が無い場合だけ capturedAt の日付へフォールバックする。
 *
 * 確定経路は増やさず、persistEntry_() を全保存の唯一の入口とする。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES, getShootingTypeLabel, getVisualPhotoRoomKey, isSamplingPhotoUnorganized, isVisualPhotoUnorganized } from '../records/photo-record.js';
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
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';

const BOARD_POSITIONS = ['bottom-left', 'bottom-right', 'top-right', 'top-left'];
const BOARD_SIZES = ['small', 'medium', 'large'];
const STAGES = [SHOOTING_TYPES.BEFORE, SHOOTING_TYPES.DURING, SHOOTING_TYPES.AFTER];
const MARKS = { 1: '①', 2: '②', 3: '③' };

const PHOTO_SYNC_EDIT_FIELDS = new Set([
  'fileName', 'isRepresentative', 'isEdited', 'lastEditedDevice', 'lastEditedAt',
  'deleted', 'systemMemo', 'boardPosition', 'boardSize', 'boardDate', 'originalPath', 'completedPath',
  'areaCode', 'roomPosition', 'partSlot',
  'materialId', 'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType'
]);

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

let session = createEmptySession_();
let active = null;

function createEmptySession_() {
  return { ids: [], index: -1, entries: new Map() };
}

function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sameDraft_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function dateInputValue(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function sampleDisplay(base, branch) { return `${base || ''}${MARKS[branch] ? `-${MARKS[branch]}` : ''}`; }

function memoValue_(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function appendSystemMemo_(currentMemo, message) {
  const current = String(currentMemo || '').trim();
  const stamp = new Date().toLocaleString('ja-JP');
  const line = `${stamp} ${message}`;
  return current ? `${current}\n${line}` : line;
}

function buildBoardEditMemo_(entry) {
  const before = entry.initialDraft || {};
  const after = entry.draft || {};
  const lines = [];

  if (entry.record.photoType === PHOTO_TYPES.VISUAL) {
    const roomChanged = before.areaCode !== after.areaCode || before.roomPosition !== after.roomPosition || before.roomNo !== after.roomNo;
    if (roomChanged) lines.push(`部屋：${memoValue_(before.roomNo || before.roomPosition)} → ${memoValue_(after.roomNo || after.roomPosition)}`);

    const partChanged = Number(before.partSlot || 0) !== Number(after.partSlot || 0) || before.part !== after.part;
    if (partChanged) lines.push(`部位：${before.part ? memoValue_(before.part) : '未整理'} → ${after.part ? memoValue_(after.part) : '未整理'}`);
  } else {
    const materialChanged = before.materialId !== after.materialId || before.sampleBaseNo !== after.sampleBaseNo;
    if (materialChanged) lines.push(`検体No.：${memoValue_(before.sampleBaseNo)} → ${memoValue_(after.sampleBaseNo)}`);

    const branchChanged = Number(before.samplingBranch || 0) !== Number(after.samplingBranch || 0);
    if (branchChanged) lines.push(`箇所：${Number(before.samplingBranch || 0) ? memoValue_(before.samplingBranch) : '未整理'} → ${Number(after.samplingBranch || 0) ? memoValue_(after.samplingBranch) : '未整理'}`);

    if (before.shootingType !== after.shootingType) {
      lines.push(`撮影区分：${before.shootingType ? memoValue_(getShootingTypeLabel(before.shootingType)) : '未整理'} → ${after.shootingType ? memoValue_(getShootingTypeLabel(after.shootingType)) : '未整理'}`);
    }
  }

  if (before.boardDate !== after.boardDate) {
    lines.push(`日付：${memoValue_(dateText(before.boardDate))} → ${memoValue_(dateText(after.boardDate))}`);
  }
  if (before.boardPosition !== after.boardPosition) {
    lines.push(`看板位置：${memoValue_(BOARD_POSITION_LABELS[before.boardPosition])} → ${memoValue_(BOARD_POSITION_LABELS[after.boardPosition])}`);
  }
  if (before.boardSize !== after.boardSize) {
    lines.push(`看板サイズ：${memoValue_(BOARD_SIZE_LABELS[before.boardSize])} → ${memoValue_(BOARD_SIZE_LABELS[after.boardSize])}`);
  }

  return lines.length ? ['看板編集', ...lines].join('\n') : '';
}

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

function visualRooms() { return optionsProvider()?.visualRooms || []; }
function samplingTargets() { return optionsProvider()?.samplingTargets || []; }
function visualRoomByIdentity(identity = {}) {
  const key = getVisualPhotoRoomKey(identity);
  return visualRooms().find((room) => getVisualPhotoRoomKey(room) === key) || null;
}
function samplingMaterialTargets(materialId) { return samplingTargets().filter((t) => t.materialId === materialId); }
function samplingMaterials() {
  const map = new Map();
  samplingTargets().forEach((t) => {
    if (!map.has(t.materialId)) map.set(t.materialId, { materialId:t.materialId, sampleBaseNo:String(t.sampleBaseNo || ''), targets:[] });
    map.get(t.materialId).targets.push(t);
  });
  return [...map.values()];
}

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
function hasUnsavedChanges_() { return [...session.entries.values()].some((entry) => entry.dirty); }

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
  bindEvents();
}

function visualFields() {
  const rooms = visualRooms();
  const room = visualRoomByIdentity(active.draft);
  const parts = room?.targets || [];
  const activeRoomKey = getVisualPhotoRoomKey(active.draft);
  const hasActiveRoom = rooms.some((item) => getVisualPhotoRoomKey(item) === activeRoomKey);
  return `<div class="photo-board-editor-fields">
    <label>部屋No.<select data-editor-room>
      ${hasActiveRoom ? '' : '<option value="" selected>選択してください</option>'}
      ${rooms.map((r)=>{ const key=getVisualPhotoRoomKey(r); return `<option value="${esc(key)}" ${key===activeRoomKey?'selected':''}>${esc(r.roomNo || r.roomPosition)}</option>`; }).join('')}
    </select></label>
    <label>部位<select data-editor-part>
      <option value="" ${Number(active.draft.partSlot || 0)===0?'selected':''}>選択してください</option>
      ${parts.map((p)=>`<option value="${Number(p.partSlot || 0)}" ${Number(p.partSlot || 0)===Number(active.draft.partSlot || 0)?'selected':''}>${esc(p.part)}</option>`).join('')}
    </select></label>
  </div>`;
}

function samplingFields() {
  const materials = samplingMaterials();
  const selectedMaterialId = active.draft.materialId || active.record.materialId || '';
  const targets = samplingMaterialTargets(selectedMaterialId);
  const branches = [...new Set(targets.map((t)=>Number(t.branch)).filter(Boolean))];
  const hasMaterial = materials.some((item) => item.materialId === selectedMaterialId);
  return `<div class="photo-board-editor-fields">
    <label>検体No.<select data-editor-sample>
      ${hasMaterial ? '' : '<option value="" selected>選択してください</option>'}
      ${materials.map((m)=>`<option value="${esc(m.materialId)}" ${m.materialId===selectedMaterialId?'selected':''}>${esc(m.sampleBaseNo)}</option>`).join('')}
    </select></label>
    <label>箇所<select data-editor-branch>
      <option value="" ${Number(active.draft.samplingBranch || 0)===0?'selected':''}>選択してください</option>
      ${branches.map((b)=>`<option value="${b}" ${b===Number(active.draft.samplingBranch)?'selected':''}>${MARKS[b] || b}</option>`).join('')}
    </select></label>
    <label>撮影区分<select data-editor-stage>
      <option value="" ${!active.draft.shootingType?'selected':''}>選択してください</option>
      ${STAGES.map((v)=>`<option value="${v}" ${v===active.draft.shootingType?'selected':''}>${({before:'施工前',during:'施工中',after:'施工後'})[v]}</option>`).join('')}
      <option value="section" ${active.draft.shootingType==='section'?'selected':''}>断面</option>
    </select></label>
  </div>`;
}

function renderControls() {
  if (!active || !root) return;
  root.querySelector('[data-editor-fields]').innerHTML = active.record.photoType === PHOTO_TYPES.VISUAL ? visualFields() : samplingFields();
  root.querySelector('[data-editor-date]').value = active.draft.boardDate || '';
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
      const rect = getBoardRect(dw, dh, active.draft.boardPosition, active.draft.boardSize);
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
    const room = visualRooms().find((item) => getVisualPhotoRoomKey(item) === target.value);
    active.draft.areaCode = room?.areaCode || '';
    active.draft.roomPosition = room?.roomPosition || '';
    active.draft.roomNo = room?.roomNo || '';
    active.draft.partSlot = 0;
    active.draft.part = '';
    renderControls();
  } else if (target.matches('[data-editor-part]')) {
    const room = visualRoomByIdentity(active.draft);
    const partTarget = target.value ? room?.targets?.find((item) => Number(item.partSlot || 0) === Number(target.value)) || null : null;
    active.draft.partSlot = Number(partTarget?.partSlot || 0);
    active.draft.part = partTarget?.part || '';
  }
  else if (target.matches('[data-editor-sample]')) {
    const material = samplingMaterials().find((m)=>m.materialId===target.value);
    active.draft.materialId = material?.materialId || target.value;
    active.draft.sampleBaseNo = material?.sampleBaseNo || '';
    active.draft.samplingBranch = 0;
    active.draft.samplingPlace = '';
    active.draft.part = '';
    renderControls();
  }
  else if (target.matches('[data-editor-branch]')) {
    active.draft.samplingBranch = Number(target.value || 0);
    if (active.draft.samplingBranch) syncSamplingPlace();
    else { active.draft.samplingPlace = ''; active.draft.part = ''; }
  }
  else if (target.matches('[data-editor-stage]')) active.draft.shootingType = target.value;
  else if (target.matches('[data-editor-date]')) active.draft.boardDate = dateInputValue(target.value);
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
    const rect = getBoardRect(out.width,out.height,entry.draft.boardPosition,entry.draft.boardSize);
    drawBoard(ctx,rect,boardData(entry));
  }
  return new Promise((resolve,reject)=>out.toBlob((blob)=>blob?resolve(blob):reject(new Error('完成画像を生成できませんでした。')),'image/jpeg',0.82));
}

async function persistEntry_(entry) {
  const originalBlob = await getPhotoBlob(entry.record.photoId, 'original');
  if (!originalBlob) throw new Error(`元写真が端末内にありません。 (${entry.record.photoId})`);

  const completedBlob = await composeCompletedBlob_(entry);
  const now = new Date().toISOString();
  const nextFields = entry.record.photoType === PHOTO_TYPES.VISUAL
    ? { areaCode:entry.draft.areaCode, roomPosition:entry.draft.roomPosition, partSlot:entry.draft.partSlot, roomNo:entry.draft.roomNo, part:entry.draft.part }
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
  const editMemo = buildBoardEditMemo_(entry);
  const nextSystemMemo = editMemo ? appendSystemMemo_(entry.record.systemMemo, editMemo) : entry.record.systemMemo;
  const nextRecordFields = {
    ...nextFields,
    fileName,
    systemMemo: nextSystemMemo,
    boardDate:entry.draft.boardDate,
    boardPosition:entry.draft.boardPosition,
    boardSize:entry.draft.boardSize,
    isEdited:true,
    lastEditedDevice:getDeviceCode(),
    lastEditedAt:now
  };
  const editedFields = Object.keys(nextRecordFields).filter((field) =>
    PHOTO_SYNC_EDIT_FIELDS.has(field)
    && String(entry.record?.[field] ?? '') !== String(nextRecordFields[field] ?? '')
  );

  const record = photoRecordStore.set({
    ...entry.record,
    ...nextRecordFields,
    fieldEditedAt: touchFieldEditedAt(entry.record.fieldEditedAt, editedFields),
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

async function saveSession_() {
  if (!active || saving) return;
  saving = true;
  try {
    const dirtyEntries = session.ids.map((photoId) => session.entries.get(photoId)).filter((entry) => entry?.dirty);
    const items = [];
    for (const entry of dirtyEntries) items.push(await persistEntry_(entry));
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

export function openPhotoBoardEditor(photoId) { return startSession_([photoId]); }
export function openPhotoBoardEditorSequence(photoIds) { return startSession_(photoIds); }

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

export function closePhotoBoardEditor(reason = 'cancel') {
  if (reason === 'cancel') return requestClose_();
  closeEditorInternal_(reason);
}
