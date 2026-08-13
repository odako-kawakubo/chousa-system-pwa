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
 */

import { normalizeMaterialName, splitBaseNameAndSuffix } from '../records/material-record.js';
import { materialRecordStore } from '../finish-table/finish-table-actions.js';
import { refreshFinishTableFromStores } from '../finish-table/finish-table-controller.js';
import { getColorMode, toggleColorMode } from '../finish-table/finish-table-state.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';
import { buildMaterialListRows, splitDerivedList } from './material-list-view-model.js';
import { renderMaterialList } from './material-list-renderer.js';

let rootElement = null;
let selectedMaterialId = null;

const PEN_DRAG_THRESHOLD_PX = 12;
const PEN_CLICK_SUPPRESS_MS = 500;
let penPointer = null;
let ignoreNextPenClick = false;
let ignorePenClickUntil = 0;

export function initializeMaterialList() {
  rootElement = document.getElementById('materials');
  if (!rootElement) return;

  bindMaterialListEvents();
  document.querySelector('.tabs .tab[data-tab="materials"]')?.addEventListener('click', refreshMaterialList);
  refreshMaterialList();
}

export function refreshMaterialList() {
  if (!rootElement) rootElement = document.getElementById('materials');
  if (!rootElement) return;

  // 使用箇所・部位が1候補だけの場合、未入力の採取欄へ自動補完する。
  // 候補が複数の場合や既存値がある場合は触らない。
  applySamplingAutofill();

  const rows = buildMaterialListRows(materialRecordStore.getAll());
  if (selectedMaterialId && !rows.some((row) => row.materialId === selectedMaterialId)) {
    selectedMaterialId = null;
  }
  renderMaterialList(rootElement, rows, selectedMaterialId, { colorMode: getColorMode() });
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
    handleMaterialActivation(event.target);
  });

  rootElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-material-text-input]')) {
      event.preventDefault();
      event.target.blur();
      return;
    }

    // 表示spanへキーボードで入る場合もEnter/Spaceで編集開始する。
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
    const control = event.target.closest('[data-material-control]');
    if (!control) return;
    updateMaterialControl(control);
  });
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
  const colorButton = target.closest('[data-action="toggle-material-color"]');
  if (colorButton) {
    toggleColorMode();
    refreshMaterialList();
    // colorModeは仕上表・簡易リストと共通状態なので、そちらも同時に反映する。
    refreshFinishTableFromStores();
    return;
  }

  const row = target.closest('[data-material-row]');
  if (row) setSelectedMaterial(row.dataset.materialId);

  const textDisplay = target.closest('[data-material-text-display]');
  if (textDisplay) {
    activateTextDisplay(textDisplay);
    return;
  }

  // Pencil単純タップ時はSafariの後続clickを抑止するため、native controlの
  // 通常動作をここで1回だけ起動する。ドラッグ時にはこの処理へ来ない。
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
  // select()は呼ばない。タップ位置・キーボード操作で通常の部分編集を可能にする。
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
      next.analysisRequired = String(control.value || '未調査');
      break;
    case 'sampleCount':
      next.sampleCount = control.value === '-' ? 0 : Math.max(1, Math.min(3, Number(control.value) || 0));
      applySingleRecordSamplingAutofill(next);
      // 採取数を減らしても2・3の既存値は消さない。表示だけグレーアウトする。
      break;
    case 'sampleLocation1':
    case 'sampleLocation2':
    case 'sampleLocation3':
    case 'samplePart':
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

  materialRecordStore.set(next);
  refreshMaterialList();
  refreshRecordView();
}

function updateMaterialName(materialId, rawValue) {
  const record = materialRecordStore.get(materialId);
  if (!record) return refreshMaterialList();

  const normalized = normalizeMaterialName(rawValue);
  if (!normalized) {
    window.alert('建材名称は空欄にできません。');
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
  materialRecordStore.set({
    ...record,
    name: normalized,
    baseName: parsed.baseName,
    suffixLetter: parsed.suffixLetter,
    systemMemo: appendSystemMemo(record.systemMemo, `建材名称変更：${record.name} → ${normalized}`),
    updatedAt: new Date().toISOString()
  });

  refreshConnectedViews();
}

function updateMaterialNote(materialId, rawValue) {
  const record = materialRecordStore.get(materialId);
  if (!record) return refreshMaterialList();

  const note = String(rawValue ?? '').trim();
  if (note === record.note) return refreshMaterialList();

  materialRecordStore.set({
    ...record,
    note,
    updatedAt: new Date().toISOString()
  });
  refreshConnectedViews();
}

function applySamplingAutofill() {
  const records = materialRecordStore.getAll();
  const updates = [];

  records.forEach((record) => {
    if (record.status !== 'active') return;
    const next = { ...record };
    if (applySingleRecordSamplingAutofill(next)) {
      next.updatedAt = new Date().toISOString();
      updates.push(next);
    }
  });

  if (!updates.length) return;
  materialRecordStore.batch(() => updates.forEach((record) => materialRecordStore.set(record)));
}

/**
 * 使用箇所が1つなら、採取数で有効な採取場所の空欄へ同じ値を自動入力する。
 * 使用部位が1つなら採取部位の空欄へ自動入力する。
 * 既存値は上書きしない。
 */
function applySingleRecordSamplingAutofill(record) {
  let changed = false;
  const places = splitDerivedList(record.usageLocation);
  const parts = splitDerivedList(record.part);
  const count = Math.max(0, Math.min(3, Number(record.sampleCount) || 0));

  if (places.length === 1) {
    for (let index = 1; index <= count; index += 1) {
      const field = `sampleLocation${index}`;
      if (!record[field]) {
        record[field] = places[0];
        changed = true;
      }
    }
  }

  if (parts.length === 1 && !record.samplePart) {
    record.samplePart = parts[0];
    changed = true;
  }

  return changed;
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

/** 操作パネル等から現在の建材リスト選択を参照するための公開API。 */
export function getSelectedMaterialId() {
  return selectedMaterialId;
}

/**
 * 統合・削除後など、建材リスト外の操作から選択状態を更新する。
 * 一覧全体の再描画は呼び出し側で行い、ここでは選択値だけを確定する。
 */
export function selectMaterialInList(materialId) {
  selectedMaterialId = materialId || null;
  applySelectedRowState();
}
