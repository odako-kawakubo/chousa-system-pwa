/**
 * src/js/materials/material-list-controller.js
 *
 * v0.1.5.2B 建材リストの入口。
 *
 * 方針：
 * - データ正本はmaterialRecordStore。
 * - 14.28の一覧性・集計・カラー切替を本開発構造へ載せ替える。
 * - 建材名称／調査備考の文字入力は、仕上表と同じく通常span・編集時だけinput。
 * - Apple Pencilは単純タップを通常操作、ドラッグをスクロールとして判定する。
 * - 行選択だけでは一覧全体を再描画しない。
 * - 全体再描画が必要な場合でも、案件ごとの建材リストスクロール位置を保持する。
 * - タブ離脱時に明示保存し、建材リストへ戻った時に復元する。
 * - v0.1.7.1 使用箇所は部屋No.を基本表示とし、部屋名表示ON時だけfinishRecordから表示値を再計算する。
 */

import { normalizeMaterialName, normalizeSampleParts, splitBaseNameAndSuffix } from '../records/material-record.js';
import { materialRecordStore, getMaterialUsageRoomLabels } from '../finish-table/finish-table-actions.js';
import { refreshFinishTableFromStores } from '../finish-table/finish-table-controller.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';
import { buildMaterialListRows } from './material-list-view-model.js';
import { renderMaterialList } from './material-list-renderer.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistMaterialForProject } from '../sync/project-record-persistence.js';
import { applySingleRecordSamplingAutofill } from './material-sampling-autofill.js';

let rootElement = null;
let selectedMaterialId = null;
let outsideMultiSelectBound = false;
let materialListTabScrollBound = false;
let renderedProjectId = '';
const scrollStateByProject = new Map();

const MATERIAL_META_FIELDS = new Set(['updatedAt', 'updatedDevice', 'fieldEditedAt', 'color', 'photoCount', 'materialNo', 'inputId', 'baseName', 'suffixLetter', 'systemMemo']);

function changedBusinessFields(previous, next) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  return [...keys].filter((field) => {
    if (MATERIAL_META_FIELDS.has(field)) return false;
    const a = previous?.[field];
    const b = next?.[field];
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) !== JSON.stringify(b || []);
    return String(a ?? '') !== String(b ?? '');
  });
}

function setAndPersistMaterial(previous, candidate, source = 'material-list-edit') {
  const fields = changedBusinessFields(previous, candidate);
  if (!fields.length) return previous;
  const next = {
    ...candidate,
    fieldEditedAt: touchFieldEditedAt(previous?.fieldEditedAt, fields)
  };
  materialRecordStore.set(next);
  persistMaterialForProject(getCurrentProject(), next, source);
  return next;
}

// 建材リスト専用の表示状態。仕上表／簡易リストとは独立して切り替える。
let materialListColorMode = false;
// OFF=部屋No.、ON=部屋名優先。部屋名空欄は常に部屋No.へフォールバックする。
let materialListRoomNameMode = false;

const PEN_DRAG_THRESHOLD_PX = 12;
const PEN_CLICK_SUPPRESS_MS = 500;
let penPointer = null;
let ignoreNextPenClick = false;
let ignorePenClickUntil = 0;

function captureMaterialListScroll() {
  if (!rootElement || !renderedProjectId) return;
  const wrap = rootElement.querySelector('.material-list-table-wrap');
  if (!wrap) return;
  scrollStateByProject.set(renderedProjectId, {
    top: Number(wrap.scrollTop || 0),
    left: Number(wrap.scrollLeft || 0)
  });
}

function restoreMaterialListScroll(projectId) {
  if (!rootElement) return;
  const wrap = rootElement.querySelector('.material-list-table-wrap');
  if (!wrap) return;
  const saved = scrollStateByProject.get(String(projectId || '')) || { top: 0, left: 0 };
  wrap.scrollTop = Number(saved.top || 0);
  wrap.scrollLeft = Number(saved.left || 0);
}

function bindMaterialListTabScrollState() {
  if (materialListTabScrollBound) return;
  materialListTabScrollBound = true;

  window.addEventListener('chousa:tab-change', (event) => {
    const previousTab = String(event.detail?.previousTab || '');
    const currentTab = String(event.detail?.currentTab || '');

    if (previousTab === 'materials') captureMaterialListScroll();
    if (currentTab === 'materials') {
      requestAnimationFrame(() => {
        restoreMaterialListScroll(String(getCurrentProject()?.projectId || ''));
      });
    }
  });
}

export function initializeMaterialList() {
  rootElement = document.getElementById('materials');
  if (!rootElement) return;

  bindMaterialListEvents();
  bindOutsideMultiSelectClose();
  bindMaterialListTabScrollState();
  document.querySelector('.tabs .tab[data-tab="materials"]')?.addEventListener('click', refreshMaterialList);
  refreshMaterialList();
}

export function refreshMaterialList() {
  if (!rootElement) rootElement = document.getElementById('materials');
  if (!rootElement) return;

  captureMaterialListScroll();
  applySamplingAutofill();

  // usageLocation正本は従来どおり部屋No.のまま維持する。
  // 部屋名表示は画面表示用だけfinishRecordから組み立て、採取場所候補等へ波及させない。
  const rows = buildMaterialListRows(materialRecordStore.getAll()).map((row) => ({
    ...row,
    usageLocationDisplay: getMaterialUsageRoomLabels(row.inputId, {
      preferRoomName: materialListRoomNameMode
    }).join('、') || row.usageLocation
  }));
  if (selectedMaterialId && !rows.some((row) => row.materialId === selectedMaterialId)) {
    selectedMaterialId = null;
  }

  const projectId = String(getCurrentProject()?.projectId || '');
  renderMaterialList(rootElement, rows, selectedMaterialId, {
    colorMode: materialListColorMode,
    roomNameMode: materialListRoomNameMode
  });
  renderedProjectId = projectId;
  restoreMaterialListScroll(projectId);
}

function bindMaterialListEvents() {
  if (!rootElement || rootElement.dataset.eventsBound === '1') return;
  rootElement.dataset.eventsBound = '1';

  rootElement.addEventListener('pointerdown', handlePenPointerDown, { passive: true });
  rootElement.addEventListener('pointermove', handlePenPointerMove, { passive: true });
  rootElement.addEventListener('pointerup', handlePenPointerUp, { passive: true });
  rootElement.addEventListener('pointercancel', handlePenPointerCancel, { passive: true });

  rootElement.addEventListener('click', (event) => {
    if (ignoreNextPenClick && performance.now() <= ignorePenClickUntil) {
      ignoreNextPenClick = false;
      ignorePenClickUntil = 0;
      return;
    }
    ignoreNextPenClick = false;
    ignorePenClickUntil = 0;

    const closeMultiSelect = event.target.closest('[data-action="close-material-multi-select"]');
    if (closeMultiSelect) {
      event.preventDefault();
      event.stopPropagation();
      closeMultiSelect.closest('[data-material-multi-select]')?.removeAttribute('open');
      return;
    }

    handleMaterialActivation(event.target);
  });

  rootElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-material-text-input]')) {
      event.preventDefault();
      event.target.blur();
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-material-text-display]')) {
      event.preventDefault();
      activateTextDisplay(event.target);
    }
  });

  rootElement.addEventListener('focusout', (event) => {
    const input = event.target.closest('[data-material-text-input]');
    if (!input) return;
    commitTextEditor(input);
  });

  rootElement.addEventListener('change', (event) => {
    const multiPart = event.target.closest('[data-material-multi-part]');
    if (multiPart) {
      if (multiPart.disabled) return;
      updateSamplePartsFromChecklist(multiPart.dataset.materialId);
      return;
    }

    const control = event.target.closest('[data-material-control]');
    if (!control) return;
    updateMaterialControl(control);
  });
}

function bindOutsideMultiSelectClose() {
  if (outsideMultiSelectBound) return;
  outsideMultiSelectBound = true;

  document.addEventListener('pointerdown', (event) => {
    if (!rootElement) return;
    if (event.target.closest('[data-material-multi-select]')) return;
    rootElement.querySelectorAll('[data-material-multi-select][open]').forEach((details) => {
      details.removeAttribute('open');
    });
  }, { passive: true });
}

function handlePenPointerDown(event) {
  if (event.pointerType !== 'pen') return;

  const scrollHost = event.target.closest('.material-list-table-wrap');
  penPointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    target: event.target,
    dragged: false,
    scrollHost,
    startScrollLeft: scrollHost ? scrollHost.scrollLeft : 0,
    startScrollTop: scrollHost ? scrollHost.scrollTop : 0
  };

  ignoreNextPenClick = false;
  ignorePenClickUntil = 0;
}

function handlePenPointerMove(event) {
  if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;
  const dx = event.clientX - penPointer.startX;
  const dy = event.clientY - penPointer.startY;
  if (Math.hypot(dx, dy) >= PEN_DRAG_THRESHOLD_PX) penPointer.dragged = true;
}

function handlePenPointerUp(event) {
  if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;

  const gesture = penPointer;
  penPointer = null;
  const scrollMoved = Boolean(
    gesture.scrollHost && (
      gesture.scrollHost.scrollLeft !== gesture.startScrollLeft ||
      gesture.scrollHost.scrollTop !== gesture.startScrollTop
    )
  );
  const wasDrag = gesture.dragged || scrollMoved;

  ignoreNextPenClick = true;
  ignorePenClickUntil = performance.now() + PEN_CLICK_SUPPRESS_MS;
  if (wasDrag) return;

  handleMaterialActivation(gesture.target, { fromPen: true });
}

function handlePenPointerCancel(event) {
  if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;
  penPointer = null;
  ignoreNextPenClick = true;
  ignorePenClickUntil = performance.now() + PEN_CLICK_SUPPRESS_MS;
}

function handleMaterialActivation(target, options = {}) {
  const closeMultiSelect = target.closest('[data-action="close-material-multi-select"]');
  if (closeMultiSelect) {
    closeMultiSelect.closest('[data-material-multi-select]')?.removeAttribute('open');
    return;
  }

  const colorButton = target.closest('[data-action="toggle-material-color"]');
  if (colorButton) {
    materialListColorMode = !materialListColorMode;
    refreshMaterialList();
    return;
  }

  const roomNameButton = target.closest('[data-action="toggle-material-room-name"]');
  if (roomNameButton) {
    materialListRoomNameMode = !materialListRoomNameMode;
    refreshMaterialList();
    return;
  }

  const row = target.closest('[data-material-row]');
  if (row) setSelectedMaterial(row.dataset.materialId);

  const textDisplay = target.closest('[data-material-text-display]');
  if (textDisplay) {
    activateTextDisplay(textDisplay);
    return;
  }

  if (options.fromPen) {
    const control = target.closest('[data-material-control]');
    if (control && !control.disabled) activateNativeControl(control);
  }
}

function setSelectedMaterial(materialId) {
  selectedMaterialId = materialId || null;
  applySelectedRowState();
}

function applySelectedRowState() {
  if (!rootElement) return;
  rootElement.querySelectorAll('[data-material-row]').forEach((row) => {
    row.classList.toggle('selected-material-row', row.dataset.materialId === selectedMaterialId);
  });

  const label = rootElement.querySelector('[data-material-selected-label]');
  if (!label) return;
  const record = selectedMaterialId ? materialRecordStore.get(selectedMaterialId) : null;
  label.textContent = record ? `選択中：【${record.inputId}】${record.name}` : '選択なし';
}

function activateTextDisplay(display) {
  const materialId = display.dataset.materialId;
  const kind = display.dataset.editorKind;
  if (!materialId || !kind) return;
  setSelectedMaterial(materialId);

  const record = materialRecordStore.get(materialId);
  if (!record) return;
  const value = kind === 'note' ? String(record.note || '') : String(record.name || '');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'material-cell-input';
  input.value = value;
  input.dataset.materialTextInput = '1';
  input.dataset.materialId = materialId;
  input.dataset.editorKind = kind;
  input.setAttribute('aria-label', display.getAttribute('aria-label') || kind);

  display.replaceWith(input);
  input.focus();
}

function commitTextEditor(input) {
  const materialId = input.dataset.materialId;
  const kind = input.dataset.editorKind;
  if (kind === 'name') updateMaterialName(materialId, input.value);
  else if (kind === 'note') updateMaterialNote(materialId, input.value);
  else refreshMaterialList();
}

function activateNativeControl(control) {
  control.focus({ preventScroll: true });

  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    control.click();
    return;
  }

  if (typeof control.showPicker === 'function') {
    try {
      control.showPicker();
      return;
    } catch (_) {
      // Safari等でshowPickerが拒否された場合は通常clickへフォールバック。
    }
  }
  control.click();
}

function updateMaterialControl(control) {
  const materialId = control.dataset.materialId;
  const field = control.dataset.field;
  const record = materialRecordStore.get(materialId);
  if (!record || !field) return;

  const now = new Date().toISOString();
  const next = { ...record, updatedAt: now };

  switch (field) {
    case 'level':
      next.level = String(control.value || '-');
      break;
    case 'analysisRequired':
      next.analysisRequired = String(control.value || '採取・分析');
      if (next.analysisRequired === '採取・分析') {
        const currentCount = Number(next.sampleCount);
        if (!Number.isFinite(currentCount) || currentCount < 1) next.sampleCount = 1;
        else next.sampleCount = Math.min(3, currentCount);
        applySingleRecordSamplingAutofill(next);
      }
      break;
    case 'sampleCount':
      next.sampleCount = Math.max(1, Math.min(3, Number(control.value) || 1));
      applySingleRecordSamplingAutofill(next);
      break;
    case 'sampleLocation1':
    case 'sampleLocation2':
    case 'sampleLocation3':
    case 'sampleDate':
      next[field] = String(control.value || '');
      break;
    case 'sampleDone':
      next.sampleDone = Boolean(control.checked);
      if (next.sampleDone && !next.sampleDate) next.sampleDate = todayIsoDate();
      break;
    default:
      return;
  }

  setAndPersistMaterial(record, next, 'material-control-edit');
  refreshMaterialList();
  refreshRecordView();
}

function updateSamplePartsFromChecklist(materialId) {
  const record = materialRecordStore.get(materialId);
  if (!record || !rootElement) return;

  const inputs = [...rootElement.querySelectorAll('[data-material-multi-part]')]
    .filter((input) => input.dataset.materialId === materialId);
  const selected = inputs
    .filter((input) => input.checked)
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);

  const current = normalizeSampleParts(record.samplePart);
  if (JSON.stringify(current) === JSON.stringify(selected)) return;

  setAndPersistMaterial(record, {
    ...record,
    samplePart: selected
  });

  const details = inputs[0]?.closest('[data-material-multi-select]');
  const summary = details?.querySelector('.material-multi-select-summary');
  if (summary) {
    const label = selected.length ? selected.join('、') : '選択';
    summary.textContent = label;
    summary.title = label;
  }
  refreshRecordView();
}

function updateMaterialName(materialId, rawValue) {
  const record = materialRecordStore.get(materialId);
  if (!record) return refreshMaterialList();

  const normalized = normalizeMaterialName(rawValue);
  if (!normalized) {
    window.alert('建材名称を入力してください。');
    return refreshMaterialList();
  }
  if (normalized === record.name) return refreshMaterialList();

  const duplicate = materialRecordStore.getAll().find((item) =>
    item.status === 'active' &&
    item.materialId !== materialId &&
    normalizeMaterialName(item.name) === normalized
  );
  if (duplicate) {
    window.alert(`「${normalized}」は入力ID ${duplicate.inputId} で登録済みです。`);
    return refreshMaterialList();
  }

  const parsed = splitBaseNameAndSuffix(normalized);
  setAndPersistMaterial(record, {
    ...record,
    name: normalized,
    baseName: parsed.baseName,
    suffixLetter: parsed.suffixLetter,
    systemMemo: appendSystemMemo(record.systemMemo, `建材名称変更：${record.name} → ${normalized}`)
  });

  refreshConnectedViews();
}

function updateMaterialNote(materialId, rawValue) {
  const record = materialRecordStore.get(materialId);
  if (!record) return refreshMaterialList();

  const note = String(rawValue ?? '').trim();
  if (note === record.note) return refreshMaterialList();

  setAndPersistMaterial(record, {
    ...record,
    note
  }, 'material-note-edit');
  refreshConnectedViews();
}

function applySamplingAutofill() {
  const records = materialRecordStore.getAll();
  const updates = [];

  records.forEach((record) => {
    if (record.status !== 'active') return;
    const next = { ...record };
    if (applySingleRecordSamplingAutofill(next).length) {
      updates.push({ previous: record, next });
    }
  });

  if (!updates.length) return;
  materialRecordStore.batch(() => updates.forEach(({ previous, next }) => setAndPersistMaterial(previous, next, 'sampling-autofill')));
}

function refreshConnectedViews() {
  refreshMaterialList();
  refreshFinishTableFromStores();
  refreshRecordView();
}

function appendSystemMemo(currentMemo, line) {
  const current = String(currentMemo || '').trim();
  const stamp = new Date().toLocaleString('ja-JP');
  const nextLine = `${stamp} ${line}`;
  return current ? `${current}\n${nextLine}` : nextLine;
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getSelectedMaterialId() {
  return selectedMaterialId;
}

export function selectMaterialInList(materialId) {
  selectedMaterialId = materialId || null;
  applySelectedRowState();
}
