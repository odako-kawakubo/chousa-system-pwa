/**
 * src/js/finish-table/finish-table-renderer.js
 *
 * v0.1.2 仕上表のDOM描画専用モジュール。
 * 状態変更は行わず、stateを読み取ってテーブル・操作列・選択表示を描画する。
 */

import {
  getState,
  getPartsForAreaCode,
  computeFinishId,
  roomKey,
  floorGroupKey,
  cellGroupKey,
  inputKey,
  getCell,
  getSelectedRoomKey,
  getSelectedGroupKey,
  getFocusedInputKey,
  getSelectedMaterialInputId,
  getRoomCopyButtonState,
  orderedInternalGroups
} from './finish-table-state.js';
import { formatProjectDisplayName } from '../demo/sample-project.js';

const OTHER_PART_INDEXES = new Set([5, 6]);

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
          <button type="button" class="btn small finish-mode-btn" id="finishSimpleListToggleBtn"></button>
        </div>

        <div class="finish-toolbar-fill"></div>

        <!-- 地下階・階段・屋上の追加だけは専用操作として残す。
             通常の＋行／＋部屋／＋階は表セル内へ配置する。 -->
        <div class="finish-toolbar-group finish-structure-tools" id="finishStructureTools"></div>
      </div>

      <div class="finish-table-scroll" id="finishTableScroll">
        <div class="finish-table-track">
          <div class="finish-table-host" id="finishRoomsArea"></div>
          <section class="finish-simple-list-panel" id="finishSimpleListPanel"></section>
        </div>
      </div>
    </div>
  `;

  const banner = document.getElementById('finishProjectBanner');
  if (banner) banner.textContent = formatProjectDisplayName(getState().project);

  renderToolbarState();
  renderRooms();
}

export function renderToolbarState() {
  const state = getState();

  document.querySelectorAll('.finish-area-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.areaMode === state.areaMode);
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
  if (listBtn) {
    listBtn.textContent = `簡易リスト ${state.simpleListOpen ? '▼' : '▶'}`;
  }

  const tools = document.getElementById('finishStructureTools');
  if (tools) {
    tools.innerHTML = state.areaMode === 'internal'
      ? `
        <button type="button" class="btn small" data-action="add-basement-floor">＋地下階</button>
        <button type="button" class="btn small" data-action="add-stairs">＋階段</button>
        <button type="button" class="btn small" data-action="add-roof">＋屋上</button>
      `
      : '';
  }
}

function currentRooms() {
  const state = getState();
  if (state.areaMode === 'external') return state.externalRooms;
  return orderedInternalGroups().flatMap((group) => group.rooms);
}

/**
 * 建材名称・その他部位は列単位で最長文字を見て広げる。
 * ID列・左固定列は固定幅のまま。
 */
function computeDynamicWidths(parts) {
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
  return widths;
}

export function renderRooms() {
  const host = document.getElementById('finishRoomsArea');
  if (!host) return;

  const state = getState();
  const areaCode = state.areaMode === 'external' ? 'E' : 'I';
  const parts = getPartsForAreaCode(areaCode);
  const widths = computeDynamicWidths(parts);

  host.innerHTML = `
    <table class="finish-table ${state.colorMode ? 'color-mode' : ''}" id="finishTable">
      ${renderColGroup(widths)}
      ${renderHeader(parts)}
      <tbody>${state.areaMode === 'external' ? renderExternalRows(parts) : renderInternalRows(parts)}</tbody>
    </table>
  `;

  applyVisualState();
}

function renderColGroup(widths) {
  let html = '<colgroup>';
  html += '<col class="col-floor"><col class="col-room-no"><col class="col-copy"><col class="col-room-name">';
  widths.forEach((item) => {
    html += '<col class="col-id">';
    if (item.other) html += `<col style="width:${item.actualPart}px;min-width:${item.actualPart}px">`;
    html += `<col style="width:${item.name}px;min-width:${item.name}px">`;
  });
  html += '</colgroup>';
  return html;
}

function renderHeader(parts) {
  let parent = '<thead><tr class="finish-head-parent">';
  parent += '<th rowspan="2">階</th><th rowspan="2">部屋No.</th><th rowspan="2">コピー</th><th rowspan="2">部屋名</th>';
  parts.forEach((part, index) => {
    parent += `<th colspan="${OTHER_PART_INDEXES.has(index + 1) ? 3 : 2}">${escapeHtml(part)}</th>`;
  });
  parent += '</tr><tr class="finish-head-child">';
  parts.forEach((_, index) => {
    parent += '<th>ID</th>';
    if (OTHER_PART_INDEXES.has(index + 1)) parent += '<th>部位</th>';
    parent += '<th>建材名称</th>';
  });
  parent += '</tr></thead>';
  return parent;
}

function renderInternalRows(parts) {
  const groups = orderedInternalGroups();
  const normalGroups = groups.filter((group) => group.areaCode === 'I');
  const lastNormalKey = normalGroups.length ? normalGroups[normalGroups.length - 1].uid : null;
  return groups.map((group) => renderGroupRows(group, parts, group.uid === lastNormalKey)).join('');
}

function renderExternalRows(parts) {
  const state = getState();
  const group = {
    uid: 'external-group',
    areaCode: 'E',
    label: '外部',
    rooms: state.externalRooms,
    virtual: true
  };
  return renderGroupRows(group, parts, false);
}

function renderGroupRows(group, parts, isLastNormalFloor) {
  if (!group.rooms.length) return '';
  return group.rooms.map((room, roomIndex) => {
    const roomIsLast = roomIndex === group.rooms.length - 1;
    return renderRoomRows(room, group, parts, roomIsLast, isLastNormalFloor);
  }).join('');
}

function renderRoomRows(room, group, parts, roomIsLast, isLastNormalFloor) {
  const key = roomKey(room);
  const span = room.rowCount;
  const floorText = group.areaCode === 'S' ? '階段' : group.areaCode === 'R' ? '屋上' : group.label;
  let html = '';

  for (let row = 1; row <= room.rowCount; row += 1) {
    html += `<tr class="${row === 1 ? 'room-start' : 'room-sub'}" data-room-key="${escapeHtml(key)}">`;

    if (row === 1) {
      html += `
        <td class="finish-meta floor-cell" rowspan="${span}">
          <div class="room-control">
            <strong>${escapeHtml(floorText)}</strong>
            ${renderFloorAddButton(group, isLastNormalFloor, roomIsLast)}
          </div>
        </td>
        <td class="finish-meta room-no-cell" rowspan="${span}">
          <div class="room-control">
            <input class="room-no-input" data-room-key="${escapeHtml(key)}" value="${escapeHtml(room.roomNo)}" aria-label="部屋No.">
            <div class="room-action-stack">
              <button type="button" class="room-mini-btn" data-action="add-row" data-room-key="${escapeHtml(key)}">＋行</button>
              ${roomIsLast ? `<button type="button" class="room-mini-btn" data-action="add-room" data-room-key="${escapeHtml(key)}" data-floor-key="${escapeHtml(floorGroupKey(group))}">＋部屋</button>` : ''}
              <button type="button" class="room-mini-btn insert" data-action="insert-room" data-room-key="${escapeHtml(key)}">＋挿入</button>
            </div>
          </div>
        </td>
        <td class="finish-meta copy-cell" rowspan="${span}">${renderCopyButton(key)}</td>
        <td class="finish-meta room-name-cell" rowspan="${span}">
          <input class="room-name-input" data-room-key="${escapeHtml(key)}" value="${escapeHtml(room.name)}" placeholder="部屋名">
        </td>
      `;
    }

    parts.forEach((_, partOffset) => {
      html += renderPartCells(room, partOffset + 1, row);
    });
    html += '</tr>';
  }
  return html;
}

function renderFloorAddButton(group, isLastNormalFloor, roomIsLast) {
  const state = getState();
  if (state.areaMode !== 'internal' || !isLastNormalFloor || !roomIsLast || group.areaCode !== 'I') return '';
  return '<button type="button" class="room-mini-btn floor-add" data-action="add-normal-floor">＋階</button>';
}

function renderCopyButton(key) {
  const status = getRoomCopyButtonState(key);
  const label = status === 'restore' ? '戻す' : status === 'source' ? 'コピー元' : status === 'target' ? 'コピー' : 'コピー';
  return `
    <div class="room-control">
      <button type="button" class="room-copy-btn ${status}" data-action="copy-room" data-room-key="${escapeHtml(key)}">${label}</button>
    </div>
  `;
}

function renderPartCells(room, partIndex, row) {
  const cell = getCell(room, partIndex, row);
  const groupKey = cellGroupKey(room, partIndex, row);
  const finishId = computeFinishId(room, partIndex, row);
  const other = OTHER_PART_INDEXES.has(partIndex);
  const material = cell.inputId ? getState().materials.find((m) => String(m.inputId) === String(cell.inputId)) : null;
  const style = getState().colorMode && material ? ` style="--material-bg:${material.color}"` : '';

  let html = `
    <td class="finish-data-cell group-first" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}"${style}>
      <input class="finish-cell-input finish-id-input" data-input-key="${escapeHtml(inputKey(room, partIndex, row, 'id'))}" data-kind="id" data-room-key="${escapeHtml(roomKey(room))}" data-part-index="${partIndex}" data-input-row="${row}" value="${escapeHtml(cell.inputId)}" placeholder="ID" inputmode="numeric">
    </td>
  `;

  if (other) {
    html += `
      <td class="finish-data-cell group-middle" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}"${style}>
        <input class="finish-cell-input finish-part-input" data-input-key="${escapeHtml(inputKey(room, partIndex, row, 'part'))}" data-kind="part" data-room-key="${escapeHtml(roomKey(room))}" data-part-index="${partIndex}" data-input-row="${row}" value="${escapeHtml(cell.actualPart)}" placeholder="部位">
      </td>
    `;
  }

  html += `
    <td class="finish-data-cell group-last" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}"${style}>
      <input class="finish-cell-input finish-name-input" data-input-key="${escapeHtml(inputKey(room, partIndex, row, 'name'))}" data-kind="name" data-room-key="${escapeHtml(roomKey(room))}" data-part-index="${partIndex}" data-input-row="${row}" value="${escapeHtml(cell.materialName)}" placeholder="建材名称">
    </td>
  `;
  return html;
}

/**
 * DOM再構築なしで、部屋選択・入力グループ・簡易リスト一致・フォーカスを再適用する。
 */
export function applyVisualState() {
  const table = document.getElementById('finishTable');
  if (!table) return;

  const state = getState();
  table.classList.toggle('color-mode', state.colorMode);

  table.querySelectorAll('tr[data-room-key]').forEach((row) => {
    row.classList.toggle('is-room-selected', row.dataset.roomKey === getSelectedRoomKey());
  });

  table.querySelectorAll('[data-group-key]').forEach((cell) => {
    cell.classList.remove('is-group-selected', 'is-material-match');
    if (cell.dataset.groupKey === getSelectedGroupKey()) cell.classList.add('is-group-selected');
  });

  const selectedMaterial = getSelectedMaterialInputId();
  if (selectedMaterial != null) {
    table.querySelectorAll('[data-group-key]').forEach((td) => {
      const group = td.dataset.groupKey;
      const idInput = table.querySelector(`[data-group-key="${CSS.escape(group)}"] .finish-id-input`);
      if (idInput && String(idInput.value) === String(selectedMaterial)) td.classList.add('is-material-match');
    });
  }

  table.querySelectorAll('.finish-cell-input').forEach((input) => {
    input.classList.toggle('is-focused-input', input.dataset.inputKey === getFocusedInputKey());
  });
}
