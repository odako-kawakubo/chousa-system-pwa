/**
 * src/js/finish-table/finish-table-renderer.js
 *
 * 仕上表のDOM描画専用モジュール。
 * 表は1個の2Dスクロール領域で描画し、左側は1部屋につき1個の固定ペイン、
 * 右側は入力行を持つ。空固定セル・rowspan・clone overlay・JS横同期は使わない。
 *
 * 通常時の編集欄はspanとして描画し、実際に編集を開始した欄だけinputへ差し替える。
 * これによりApple Pencilでスクロール中にScribbleが編集欄へ反応することを避ける。
 */

import {
  getState,
  getSelectedRoomKey,
  getSelectedGroupKey,
  getFocusedInputKey,
  getSelectedMaterialInputId,
  getChipInputMode,
  getChipInputMaterialInputId,
  isFloorCollapsed
} from './finish-table-state.js';
import {
  buildFinishTableViewModel,
  getPartsForAreaCode,
  computeFinishId,
  roomKey,
  floorGroupKey,
  cellGroupKey,
  inputKey,
  roomFieldKey,
  getCell,
  getRoomCopyButtonState,
  isFirstNormalFloorFirstRoom,
  orderedInternalGroups
} from './finish-table-view-model.js';
import { formatProjectLabel } from '../projects/project-store.js';

const OTHER_PART_INDEXES = new Set([5, 6]);

const COPY_STATE_LABEL = {
  idle: 'コピー',
  source: 'コピー元',
  restore: '戻す',
  'target-empty': 'コピー可',
  'target-overwrite': '上書き'
};

let currentViewModel = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderFinishTab(container) {
  container.innerHTML = `
    <div class="finish-tab-root">
      <div class="finish-project-banner" id="finishProjectBanner"></div>

      <div class="finish-toolbar" id="finishToolbar">
        <div class="finish-toolbar-group" id="finishAreaToggle">
          <button type="button" class="btn small finish-area-btn" data-area-mode="internal">内部</button>
          <button type="button" class="btn small finish-area-btn" data-area-mode="external">外部</button>
        </div>

        <div class="finish-toolbar-spacer"></div>

        <div class="finish-toolbar-group">
          <button type="button" class="btn small finish-mode-btn" id="finishColorToggleBtn"></button>
          <button type="button" class="btn small finish-mode-btn" id="finishChipInputToggleBtn"></button>
        </div>

        <div class="finish-toolbar-spacer"></div>

        <div class="finish-toolbar-group">
          <button type="button" class="btn small" id="finishUndoBtn" disabled>戻る</button>
          <button type="button" class="btn small" id="finishRedoBtn" disabled>進む</button>
        </div>

        <div class="finish-toolbar-spacer"></div>

        <div class="finish-toolbar-group">
          <button type="button" class="btn small finish-mode-btn" id="finishSimpleListToggleBtn"></button>
        </div>

        <div class="finish-toolbar-fill"></div>
      </div>

      <section class="finish-simple-list-panel" id="finishSimpleListPanel"></section>

      <div class="finish-table-scroll" id="finishTableScroll">
        <div class="finish-table-host" id="finishRoomsArea"></div>
      </div>

      <div class="finish-candidate-popup" id="finishCandidatePopup" hidden></div>
    </div>
  `;

  const banner = document.getElementById('finishProjectBanner');
  if (banner) banner.textContent = formatProjectLabel(getState().project);

  renderToolbarState();
  renderRooms();
}

export function renderToolbarState() {
  const state = getState();

  document.querySelectorAll('.finish-area-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.areaMode === state.activeAreaMode);
  });

  const colorBtn = document.getElementById('finishColorToggleBtn');
  if (colorBtn) {
    colorBtn.textContent = `カラー表示 ${state.colorMode ? 'ON' : 'OFF'}`;
    colorBtn.classList.toggle('active', state.colorMode);
  }

  const chipBtn = document.getElementById('finishChipInputToggleBtn');
  if (chipBtn) {
    chipBtn.textContent = `チップ入力 ${state.chipInputMode ? 'ON' : 'OFF'}`;
    chipBtn.classList.toggle('active', state.chipInputMode);
  }

  const listBtn = document.getElementById('finishSimpleListToggleBtn');
  if (listBtn) listBtn.textContent = `簡易リスト ${state.simpleListOpen ? '▼' : '▶'}`;
}

function currentRooms() {
  const state = getState();
  if (state.activeAreaMode === 'external') return currentViewModel.externalRooms;
  return orderedInternalGroups(currentViewModel).flatMap((group) => group.rooms);
}

/** 固定列。部屋No.列だけ内容に応じて可変。 */
const FLOOR_COL_WIDTH = 30;
const COPY_COL_WIDTH = 38;
const ROOM_NAME_COL_WIDTH = 70;
const ROOM_NOTE_COL_WIDTH = 110;
const ID_COL_WIDTH = 30;

function computeColumnLayout() {
  const areaCode = getState().activeAreaMode === 'external' ? 'E' : 'I';
  const parts = getPartsForAreaCode(areaCode);
  const rooms = currentRooms();

  const widths = parts.map((_, index) => ({ name: 120, actualPart: 45, other: OTHER_PART_INDEXES.has(index + 1) }));
  rooms.forEach((room) => {
    for (let row = 1; row <= room.rowCount; row += 1) {
      parts.forEach((_, index) => {
        const cell = getCell(room, index + 1, row);
        widths[index].name = Math.max(widths[index].name, Math.min(260, 24 + String(cell.materialName || '').length * 11));
        if (widths[index].other) {
          widths[index].actualPart = Math.max(widths[index].actualPart, Math.min(150, 20 + String(cell.actualPart || '').length * 10));
        }
      });
    }
  });

  const longestRoomNo = rooms.reduce((max, room) => Math.max(max, String(room.roomNo || '').length), 0);
  const roomNoWidth = Math.max(54, Math.min(160, 22 + longestRoomNo * 8));

  const fixedRegionWidth = FLOOR_COL_WIDTH + roomNoWidth + COPY_COL_WIDTH + ROOM_NAME_COL_WIDTH + ROOM_NOTE_COL_WIDTH;

  const groups = parts.map((label, index) => {
    const item = widths[index];
    const cols = [{ kind: 'id', width: ID_COL_WIDTH }];
    if (item.other) cols.push({ kind: 'part', width: item.actualPart });
    cols.push({ kind: 'name', width: item.name });
    const groupWidth = cols.reduce((sum, col) => sum + col.width, 0);
    return { label, groupWidth, cols };
  });

  const materialRegionWidth = groups.reduce((sum, group) => sum + group.groupWidth, 0);
  const totalTableWidth = fixedRegionWidth + materialRegionWidth;

  return {
    parts,
    roomNoWidth,
    floorWidth: FLOOR_COL_WIDTH,
    copyWidth: COPY_COL_WIDTH,
    roomNameWidth: ROOM_NAME_COL_WIDTH,
    roomNoteWidth: ROOM_NOTE_COL_WIDTH,
    fixedRegionWidth,
    materialRegionWidth,
    totalTableWidth,
    groups
  };
}

export function renderRooms() {
  const host = document.getElementById('finishRoomsArea');
  if (!host) return;

  currentViewModel = buildFinishTableViewModel();

  const state = getState();
  const layout = computeColumnLayout();
  const { roomNoWidth, totalTableWidth } = layout;
  const sheetStyle = `--finish-roomno-w:${roomNoWidth}px;--finish-fixed-w:${layout.fixedRegionWidth}px;--finish-material-w:${layout.materialRegionWidth}px;width:${totalTableWidth}px`;

  host.innerHTML = `
    <div class="finish-table ${state.colorMode ? 'color-mode' : ''}" id="finishTable" style="${sheetStyle}">
      ${renderTableHeader(layout)}
      <div class="finish-table-body">
        ${state.activeAreaMode === 'external' ? renderExternalRows(layout) : renderInternalRows(layout)}
      </div>
    </div>
  `;

  applyVisualState();
}

function fixedColumns(layout) {
  return `${layout.floorWidth}px ${layout.roomNoWidth}px ${layout.copyWidth}px ${layout.roomNameWidth}px ${layout.roomNoteWidth}px`;
}

function renderTableHeader(layout) {
  const materialColumns = layout.groups.flatMap((group) => group.cols.map((col) => `${col.width}px`)).join(' ');

  return `
    <div class="finish-sheet-header" style="grid-template-columns:${layout.fixedRegionWidth}px ${layout.materialRegionWidth}px">
      <div class="finish-header-fixed" style="grid-template-columns:${fixedColumns(layout)}">
        <div class="finish-header-fixed-cell">階</div>
        <div class="finish-header-fixed-cell">部屋No.</div>
        <div class="finish-header-fixed-cell">コピー</div>
        <div class="finish-header-fixed-cell">部屋名</div>
        <div class="finish-header-fixed-cell">備考</div>
      </div>
      <div class="finish-header-materials" style="grid-template-columns:${materialColumns}">
        ${layout.groups.map((group) => renderMaterialHeaderGroup(group)).join('')}
      </div>
    </div>
  `;
}

function renderMaterialHeaderGroup(group) {
  const width = group.groupWidth;
  const children = group.cols.map((col) => `<span class="finish-header-child-cell" style="width:${col.width}px">${escapeHtml(headerChildLabel(col.kind))}</span>`).join('');
  return `
    <div class="finish-head-material-group" style="width:${width}px;grid-column:span ${group.cols.length}">
      <div class="finish-header-group-label">${escapeHtml(group.label)}</div>
      <div class="finish-header-group-children">${children}</div>
    </div>
  `;
}

function headerChildLabel(kind) {
  if (kind === 'id') return 'ID';
  if (kind === 'part') return '部位';
  return '建材名称';
}

function renderInternalRows(layout) {
  const groups = orderedInternalGroups(currentViewModel);
  const normalGroups = groups.filter((group) => group.areaCode === 'I');
  const lastNormalKey = normalGroups.length ? normalGroups[normalGroups.length - 1].uid : null;
  return groups.map((group) => renderGroupRows(group, layout, group.uid === lastNormalKey, true)).join('');
}

function renderExternalRows(layout) {
  const group = {
    uid: 'external-group',
    areaCode: 'E',
    label: '外部',
    rooms: currentViewModel.externalRooms,
    virtual: true
  };
  return renderGroupRows(group, layout, false, false);
}

function renderGroupRows(group, layout, isLastNormalFloor, showHeading) {
  const heading = showHeading ? renderFloorHeadingRow(group, layout.totalTableWidth) : '';
  if (!group.rooms.length) return heading;
  if (showHeading && isFloorCollapsed(floorGroupKey(group))) return heading;

  const rooms = group.rooms.map((room, roomIndex) => {
    const roomIsLast = roomIndex === group.rooms.length - 1;
    return renderRoomBlock(room, group, layout, roomIsLast, isLastNormalFloor);
  }).join('');
  return heading + rooms;
}

function renderFloorHeadingRow(group, totalTableWidth) {
  const key = floorGroupKey(group);
  const collapsed = isFloorCollapsed(key);
  const icon = collapsed ? '▶' : '▼';
  const label = group.areaCode === 'R' ? 'R階' : (group.areaCode === 'S' ? '階段' : group.label);
  return `
    <div class="finish-floor-heading" data-floor-key="${escapeHtml(key)}" style="width:${totalTableWidth}px">
      <span class="finish-floor-heading-inner">
        <span class="finish-floor-toggle" aria-hidden="true">${icon}</span>
        <span class="finish-floor-heading-label">${escapeHtml(label)}　${group.rooms.length}部屋</span>
      </span>
    </div>
  `;
}

function renderRoomBlock(room, group, layout, roomIsLast, isLastNormalFloor) {
  const key = roomKey(room);
  const floorText = group.areaCode === 'S' ? '階段' : group.areaCode === 'R' ? 'R階' : group.label;
  const materialColumns = layout.groups.flatMap((item) => item.cols.map((col) => `${col.width}px`)).join(' ');

  let materialRows = '';
  for (let row = 1; row <= room.rowCount; row += 1) {
    materialRows += `<div class="finish-material-row" data-room-key="${escapeHtml(key)}" data-input-row="${row}" style="grid-template-columns:${materialColumns}">`;
    layout.parts.forEach((_, partOffset) => {
      materialRows += renderPartCells(room, partOffset + 1, row);
    });
    materialRows += '</div>';
  }

  return `
    <div class="finish-room-block" data-room-key="${escapeHtml(key)}" style="grid-template-columns:${layout.fixedRegionWidth}px ${layout.materialRegionWidth}px">
      ${renderRoomFixedPane(room, group, {
        key,
        floorText,
        fixedColumns: fixedColumns(layout),
        roomIsLast,
        isLastNormalFloor
      })}
      <div class="finish-room-materials">${materialRows}</div>
    </div>
  `;
}

function renderRoomFixedPane(room, group, ctx) {
  const { key, floorText, fixedColumns: columns, roomIsLast, isLastNormalFloor } = ctx;
  return `
    <div class="finish-room-fixed" data-room-key="${escapeHtml(key)}" style="grid-template-columns:${columns}">
      <div class="finish-meta floor-cell">
        <div class="room-control">
          <strong>${escapeHtml(floorText)}</strong>
          ${renderFloorAddButton(group, isLastNormalFloor, roomIsLast)}
          ${renderBasementShortcutButton(room, group)}
        </div>
      </div>
      <div class="finish-meta room-no-cell">
        <div class="room-control">
          ${renderRoomFieldControl(room, 'room-no')}
          <div class="room-action-stack">
            <button type="button" class="room-mini-btn" data-action="add-row" data-room-key="${escapeHtml(key)}">＋行</button>
          </div>
        </div>
      </div>
      <div class="finish-meta copy-cell">
        ${renderCopyButton(key)}
      </div>
      <div class="finish-meta room-name-cell">
        <div class="room-control room-name-control">
          ${renderRoomFieldControl(room, 'room-name')}
          ${roomIsLast ? `<button type="button" class="room-mini-btn" data-action="add-room" data-room-key="${escapeHtml(key)}" data-floor-key="${escapeHtml(floorGroupKey(group))}">＋部屋</button>` : ''}
        </div>
      </div>
      <div class="finish-meta room-name-cell room-note-cell">
        <div class="room-control room-name-control">
          ${renderRoomFieldControl(room, 'room-note')}
        </div>
      </div>
    </div>
  `;
}

function renderFloorAddButton(group, isLastNormalFloor, roomIsLast) {
  const state = getState();
  if (state.activeAreaMode !== 'internal' || !isLastNormalFloor || !roomIsLast || group.areaCode !== 'I') return '';
  return '<button type="button" class="room-mini-btn floor-add" data-action="add-normal-floor">＋階</button>';
}

function renderBasementShortcutButton(room, group) {
  const state = getState();
  if (state.activeAreaMode !== 'internal') return '';
  if (!isFirstNormalFloorFirstRoom(room, group)) return '';
  return '<button type="button" class="room-mini-btn basement-add" data-action="add-basement-floor">＋B階</button>';
}

function renderCopyButton(key) {
  const status = getRoomCopyButtonState(key);
  const label = COPY_STATE_LABEL[status] || 'コピー';
  return `
    <div class="room-control">
      <button type="button" class="room-copy-btn state-${status}" data-action="copy-room" data-room-key="${escapeHtml(key)}">${label}</button>
    </div>
  `;
}

/** roomNo / roomName / roomNote は同じ部屋共通編集経路を使う。 */
function renderRoomFieldControl(room, field) {
  const key = roomKey(room);
  const fieldKey = roomFieldKey(room, field);
  const fieldConfig = {
    'room-no': { value: room.roomNo, inputClass: 'room-no-input', label: '部屋No.', placeholder: '' },
    'room-name': { value: room.name, inputClass: 'room-name-input', label: '部屋名', placeholder: '部屋名' },
    // controllerの既存room-name-inputイベント経路を共用し、data-fieldだけroom-noteにする。
    'room-note': { value: room.note, inputClass: 'room-name-input room-note-input', label: '備考', placeholder: '備考' }
  };
  const config = fieldConfig[field];
  if (!config) return '';
  const common = `data-field-key="${escapeHtml(fieldKey)}" data-room-key="${escapeHtml(key)}" data-field="${field}"`;

  if (getFocusedInputKey() === fieldKey) {
    return `<input class="finish-cell-input ${config.inputClass}" ${common} value="${escapeHtml(config.value)}" placeholder="${escapeHtml(config.placeholder)}" aria-label="${escapeHtml(config.label)}">`;
  }

  return renderDisplaySpan(config.value, config.placeholder, config.inputClass, common, config.label);
}

function renderFieldControl(room, partIndex, row, kind, value, placeholder, inputClass) {
  const fieldKey = inputKey(room, partIndex, row, kind);
  const roomKeyValue = roomKey(room);
  const common = `data-input-key="${escapeHtml(fieldKey)}" data-kind="${kind}" data-room-key="${escapeHtml(roomKeyValue)}" data-part-index="${partIndex}" data-input-row="${row}"`;

  if (getFocusedInputKey() === fieldKey) {
    const inputMode = kind === 'id' ? ' inputmode="numeric"' : '';
    return `<input class="finish-cell-input ${inputClass}" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"${inputMode}>`;
  }

  return renderDisplaySpan(value, placeholder, inputClass, common);
}

function renderDisplaySpan(value, placeholder, inputClass, commonAttrs, label) {
  const hasValue = value != null && String(value) !== '';
  const displayText = hasValue ? String(value) : placeholder;
  const placeholderClass = hasValue ? '' : ' is-placeholder';
  const ariaAttr = label ? ` aria-label="${escapeHtml(label)}"` : '';
  return `<span class="finish-cell-display ${inputClass}${placeholderClass}" ${commonAttrs} data-placeholder="${escapeHtml(placeholder)}"${ariaAttr}>${escapeHtml(displayText)}</span>`;
}

function renderPartCells(room, partIndex, row) {
  const cell = getCell(room, partIndex, row);
  const groupKey = cellGroupKey(room, partIndex, row);
  const finishId = computeFinishId(room, partIndex, row);
  const other = OTHER_PART_INDEXES.has(partIndex);
  const material = cell.materialId ? currentViewModel.materials.find((m) => String(m.materialId) === String(cell.materialId)) : null;
  const style = getState().colorMode && material ? ` style="--material-bg:${material.color}"` : '';

  let html = `
    <div class="finish-data-cell group-first" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}" data-part-index="${partIndex}" data-input-row="${row}"${style}>
      ${renderFieldControl(room, partIndex, row, 'id', cell.inputId, 'ID', 'finish-id-input')}
    </div>
  `;

  if (other) {
    html += `
      <div class="finish-data-cell group-middle" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}" data-part-index="${partIndex}" data-input-row="${row}"${style}>
        ${renderFieldControl(room, partIndex, row, 'part', cell.actualPart, '部位', 'finish-part-input')}
      </div>
    `;
  }

  html += `
    <div class="finish-data-cell group-last" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}" data-part-index="${partIndex}" data-input-row="${row}"${style}>
      ${renderFieldControl(room, partIndex, row, 'name', cell.materialName, '建材名称', 'finish-name-input')}
    </div>
  `;
  return html;
}

export function swapDisplayToInput(displaySpan) {
  if (!displaySpan || !displaySpan.classList.contains('finish-cell-display')) return null;

  const input = document.createElement('input');
  input.className = displaySpan.className.replace('finish-cell-display', 'finish-cell-input').replace(/\s*is-placeholder\s*/, ' ').trim();
  Array.from(displaySpan.attributes).forEach((attr) => {
    if (attr.name === 'data-placeholder') {
      input.setAttribute('placeholder', attr.value);
    } else if (attr.name.startsWith('data-') || attr.name === 'aria-label') {
      input.setAttribute(attr.name, attr.value);
    }
  });
  input.value = displaySpan.classList.contains('is-placeholder') ? '' : displaySpan.textContent;
  if (displaySpan.dataset.kind === 'id') input.setAttribute('inputmode', 'numeric');

  displaySpan.replaceWith(input);
  return input;
}

let lastRoomRows = [];
let lastGroupCells = [];
let lastMatchCells = [];
let lastFocusedInputEl = null;

function findTable() {
  return document.getElementById('finishTable');
}

export function applyRoomSelection() {
  const table = findTable();
  if (!table) return;
  const key = getSelectedRoomKey();

  lastRoomRows.forEach((row) => row.classList.remove('is-room-selected'));
  if (!key) {
    lastRoomRows = [];
    return;
  }

  const selector = `.finish-room-block[data-room-key="${CSS.escape(key)}"]`;
  lastRoomRows = Array.from(table.querySelectorAll(selector));
  lastRoomRows.forEach((row) => row.classList.add('is-room-selected'));
}

export function applyGroupSelection() {
  const table = findTable();
  if (!table) return;
  const key = getSelectedGroupKey();

  lastGroupCells.forEach((cell) => cell.classList.remove('is-group-selected'));
  lastGroupCells = key ? Array.from(table.querySelectorAll(`[data-group-key="${CSS.escape(key)}"]`)) : [];
  lastGroupCells.forEach((cell) => cell.classList.add('is-group-selected'));
}

export function applyMaterialMatchHighlight() {
  const table = findTable();
  if (!table) return;

  lastMatchCells.forEach((cell) => cell.classList.remove('is-material-match'));
  lastMatchCells = [];

  const selectedMaterial = getChipInputMode()
    ? getChipInputMaterialInputId()
    : getSelectedMaterialInputId();
  if (selectedMaterial == null) return;

  const matchedGroupKeys = new Set();

  table.querySelectorAll('[data-group-key]').forEach((cell) => {
    const idField = cell.querySelector('.finish-id-input');
    if (!idField) return;

    const idValue = 'value' in idField ? idField.value : idField.textContent;
    if (String(idValue).trim() !== String(selectedMaterial).trim()) return;

    const groupKey = cell.dataset.groupKey;
    if (groupKey) matchedGroupKeys.add(groupKey);
  });

  matchedGroupKeys.forEach((groupKey) => {
    const groupCells = Array.from(
      table.querySelectorAll(`[data-group-key="${CSS.escape(groupKey)}"]`),
    );

    groupCells.forEach((cell) => cell.classList.add('is-material-match'));
    lastMatchCells.push(...groupCells);
  });
}

export function applyFocusedInputHighlight() {
  const table = findTable();
  if (!table) return;
  const key = getFocusedInputKey();

  if (lastFocusedInputEl) lastFocusedInputEl.classList.remove('is-focused-input');
  if (!key) {
    lastFocusedInputEl = null;
    return;
  }

  const selector = `.finish-cell-input[data-input-key="${CSS.escape(key)}"], .finish-cell-input[data-field-key="${CSS.escape(key)}"]`;
  lastFocusedInputEl = table.querySelector(selector);
  if (lastFocusedInputEl) lastFocusedInputEl.classList.add('is-focused-input');
}

export function applyVisualState() {
  const table = findTable();
  if (!table) return;

  table.classList.toggle('color-mode', getState().colorMode);

  lastRoomRows = [];
  lastGroupCells = [];
  lastMatchCells = [];
  lastFocusedInputEl = null;

  applyRoomSelection();
  applyGroupSelection();
  applyMaterialMatchHighlight();
  applyFocusedInputHighlight();
}

export function updateStickyMetrics(root) {
  const toolbar = root.querySelector('.finish-toolbar');
  const list = root.querySelector('.finish-simple-list-panel');
  if (!toolbar) return;

  const appHeader = document.querySelector('header.app-header-compact');
  const appToolbar = document.querySelector('.app .toolbar');
  const pageStackHeight = (appHeader ? appHeader.offsetHeight : 0)
    + (appToolbar ? appToolbar.offsetHeight : 0);
  root.style.setProperty('--finish-page-stack-h', `${pageStackHeight}px`);

  root.style.setProperty('--finish-toolbar-h', `${toolbar.offsetHeight}px`);
  root.style.setProperty('--finish-list-h', `${list ? list.offsetHeight : 0}px`);
}

let pendingConfirmResolve = null;

function ensureConfirmModal() {
  if (document.getElementById('finishConfirmModal')) return;

  const modal = document.createElement('div');
  modal.className = 'finish-confirm-modal';
  modal.id = 'finishConfirmModal';
  modal.innerHTML = `
    <div class="finish-confirm-card">
      <div class="finish-confirm-body" id="finishConfirmBody"></div>
      <div class="finish-confirm-actions">
        <button type="button" class="btn small" id="finishConfirmCancel">キャンセル</button>
        <button type="button" class="btn small primary" id="finishConfirmOk"></button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) resolveConfirm(false);
  });
  modal.querySelector('.finish-confirm-card').addEventListener('click', (event) => {
    event.stopPropagation();
  });
  document.getElementById('finishConfirmCancel').addEventListener('click', () => resolveConfirm(false));
  document.getElementById('finishConfirmOk').addEventListener('click', () => resolveConfirm(true));
}

function resolveConfirm(result) {
  document.getElementById('finishConfirmModal')?.classList.remove('open');
  const resolve = pendingConfirmResolve;
  pendingConfirmResolve = null;
  if (resolve) resolve(result);
}

export function showFinishConfirm(message, okLabel) {
  ensureConfirmModal();

  const body = document.getElementById('finishConfirmBody');
  body.innerHTML = '';
  String(message).split('\n').forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    body.appendChild(p);
  });

  document.getElementById('finishConfirmOk').textContent = okLabel;
  document.getElementById('finishConfirmModal').classList.add('open');

  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}
