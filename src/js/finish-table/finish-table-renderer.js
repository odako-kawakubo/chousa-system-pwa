/**
 * src/js/finish-table/finish-table-renderer.js
 *
 * v0.1.3 仕上表のDOM描画専用モジュール。
 * 状態変更は行わず、stateを読み取ってテーブル・操作列・選択表示を描画する。
 *
 * v0.1.3の変更点：
 *   1. 簡易リストパネルを仕上表テーブルの上へ移動（テンプレート内の順序を変更）
 *   2. 右上ツールバーの「＋地下階／＋階段／＋屋上」を撤去（ドロワーへ移動。
 *      renderer側は何も描画しない。finish-table-controller.js側でドロワーの
 *      .drawer-body内マークアップとして配線する）
 *   3. 「1-1」ブロック（1階・1部屋目）の階セルへ「＋B階」ショートカットボタンを追加
 *   4. 部屋ブロック側の「＋挿入」ボタンを撤去（ドロワーへ移動）
 *   5. コピーボタンを4状態（コピー元／コピー可／上書き／戻す）表示に対応
 *   6. ID欄に、未登録建材名称が入力されているときだけ「登録」ボタンを表示
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
  isFirstNormalFloorFirstRoom,
  isCellPendingRegistration,
  orderedInternalGroups
} from './finish-table-state.js';
import { formatProjectDisplayName } from '../demo/sample-project.js';

const OTHER_PART_INDEXES = new Set([5, 6]);

/** コピーボタンの状態→表示ラベル対応（4状態＋通常）。 */
const COPY_STATE_LABEL = {
  idle: 'コピー',
  source: 'コピー元',
  restore: '戻す',
  'target-empty': 'コピー可',
  'target-overwrite': '上書き'
};

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
      </div>

      <!-- v0.1.3：簡易リストは仕上表の上に表示する -->
      <section class="finish-simple-list-panel" id="finishSimpleListPanel"></section>

      <div class="finish-table-scroll" id="finishTableScroll">
        <div class="finish-table-track">
          <div class="finish-table-host" id="finishRoomsArea"></div>
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

  // v0.1.3：＋地下階／＋階段／＋屋上はドロワー（操作パネル）側へ移動したため、
  // ここでは右上ツールバーに何も描画しない。
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
            ${renderBasementShortcutButton(room, group)}
          </div>
        </td>
        <td class="finish-meta room-no-cell" rowspan="${span}">
          <div class="room-control">
            <input class="room-no-input" data-room-key="${escapeHtml(key)}" value="${escapeHtml(room.roomNo)}" aria-label="部屋No.">
            <div class="room-action-stack">
              <button type="button" class="room-mini-btn" data-action="add-row" data-room-key="${escapeHtml(key)}">＋行</button>
              ${roomIsLast ? `<button type="button" class="room-mini-btn" data-action="add-room" data-room-key="${escapeHtml(key)}" data-floor-key="${escapeHtml(floorGroupKey(group))}">＋部屋</button>` : ''}
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

/** ＋階：通常階の最終部屋の階セルにだけ表示する（v0.1.2から変更なし）。 */
function renderFloorAddButton(group, isLastNormalFloor, roomIsLast) {
  const state = getState();
  if (state.areaMode !== 'internal' || !isLastNormalFloor || !roomIsLast || group.areaCode !== 'I') return '';
  return '<button type="button" class="room-mini-btn floor-add" data-action="add-normal-floor">＋階</button>';
}

/**
 * ＋B階（地下階追加）ショートカット：v0.1.3で追加。
 * 「1-1」ブロック（1階・1部屋目）の階セルにだけ表示する、普段使い用の近道。
 * 同じ処理を呼ぶボタンは、操作パネル（ドロワー）側にも別途用意する
 * （finish-table-controller.js＋src/app.htmlの.drawer-body側）。
 */
function renderBasementShortcutButton(room, group) {
  const state = getState();
  if (state.areaMode !== 'internal') return '';
  if (!isFirstNormalFloorFirstRoom(room, group)) return '';
  return '<button type="button" class="room-mini-btn basement-add" data-action="add-basement-floor">＋B階</button>';
}

/**
 * 部屋コピー用ボタン。v0.1.3で4状態（コピー元／コピー可／上書き／戻す）＋
 * 通常時の「コピー」を、状態ごとのCSSクラス（state-xxx）で描き分ける。
 */
function renderCopyButton(key) {
  const status = getRoomCopyButtonState(key);
  const label = COPY_STATE_LABEL[status] || 'コピー';
  return `
    <div class="room-control">
      <button type="button" class="room-copy-btn state-${status}" data-action="copy-room" data-room-key="${escapeHtml(key)}">${label}</button>
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

  // v0.1.3：名称は入力済みだがどの建材にもリンクされていない（＝未登録）場合、
  // ID欄へ「登録」ボタンを出す。自動登録は行わない。
  const pendingRegistration = isCellPendingRegistration(room, partIndex, row);
  const registerButton = pendingRegistration
    ? `<button type="button" class="finish-register-btn" data-action="register-material" data-room-key="${escapeHtml(roomKey(room))}" data-part-index="${partIndex}" data-input-row="${row}" title="この名称を新規建材として登録します">登録</button>`
    : '';

  let html = `
    <td class="finish-data-cell group-first" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}"${style}>
      <input class="finish-cell-input finish-id-input" data-input-key="${escapeHtml(inputKey(room, partIndex, row, 'id'))}" data-kind="id" data-room-key="${escapeHtml(roomKey(room))}" data-part-index="${partIndex}" data-input-row="${row}" value="${escapeHtml(cell.inputId)}" placeholder="ID" inputmode="numeric">
      ${registerButton}
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
 *
 * グループ強調枠（is-material-match／is-group-selected）は、CSS側で
 * 「全セル共通の上辺・下辺」＋「先頭セルだけ左辺／最終セルだけ右辺」を
 * 青にする方式のまま（v0.1.3でも変更していない。内部の境界線＝ID/部位/
 * 建材名称の間は通常のグレーを残す）。ここでは対象セルへクラスを
 * 付け外しするだけで、枠の描き方自体（CSS）には触れない。
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

/* ============================================================
   部屋コピー用の確認ダイアログ（v0.1.3で新設）
   ブラウザ標準のconfirm()は使わず、自前の小型モーダルで完結させる。
   src/js/ui/modal.js（既存の汎用モーダル開閉）は使用・変更しない。
   ============================================================ */

/** 呼び出し中のPromiseのresolve関数（同時に1件だけを想定）。 */
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

  // 背景（カード外側）クリックはキャンセル扱い。カード内クリックは伝播を止める。
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

/**
 * 部屋コピーの確認ダイアログを表示し、キャンセル／確定の結果をPromiseで返す。
 * 上書きコピー・内部外部またぎコピーの両方でこの関数を再利用する
 * （文言と確定ボタンの文字列だけを差し替える）。
 *
 * @param {string} message 確認文言（改行は\nで指定）
 * @param {string} okLabel 確定ボタンの文字列（例：「上書きする」「コピーする」）
 * @returns {Promise<boolean>} 確定=true、キャンセル・背景クリック=false
 */
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
