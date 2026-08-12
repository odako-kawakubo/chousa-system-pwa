/**
 * src/js/finish-table/finish-table-renderer.js
 *
 * v0.1.4.3 仕上表のDOM描画専用モジュール。
 * 状態変更は行わず、stateを読み取ってテーブル・操作列・選択表示を描画する。
 *
 * v0.1.4.3 表示構造：
 *   仕上表は .finish-table-scroll 1個だけを縦横両方のネイティブ
 *   スクロール領域として使用する。ヘッダーも本体も同じscroll座標系に置き、
 *   scrollLeft→transform等のJS同期は行わない。
 *
 *   ・ヘッダー … top:0 にsticky
 *   ・左固定領域 … 1部屋につき1個の固定ペインをleft:0にsticky
 *   ・右入力領域 … rowCount分の28px行を持つ
 *   ・2行目以降の空固定セル、rowspan、clone overlay、absolute見せかけ結合は使わない
 *
 *   列幅はcomputeColumnLayout()を唯一の正本とし、ヘッダー・左固定ペイン・
 *   右入力領域へ同じlayout結果を適用する。
 *
 * v0.1.4.2 Phase 2（Apple Pencil / Scribble対策。今回のsticky構造再設計
 * では変更していない）：
 *   ID/建材名称/部位/部屋No./部屋名の各欄は、編集中（focusedInputKeyと
 *   一致する）のときだけ<input>を描画し、それ以外は
 *   <span class="finish-cell-display">（表示専用要素）を描画する。
 *   iPad SafariのScribbleは、Apple Pencilが<input>等の編集可能要素に
 *   触れると手書き認識を始めるため、「常時<input>が画面に露出している」
 *   こと自体が問題だった。表示専用のspanは非フォーカス要素であり、
 *   Scribbleが反応する対象がそもそも存在しない。表示→編集への切り替え
 *   （spanをinputへ差し替える処理）はfinish-table-controller.js側の
 *   clickハンドラが行い、pointerType==='pen'（直前のpointerdownで記録）
 *   のときは切り替えを一切行わない。swapDisplayToInput()がこの切り替え
 *   処理の中核。編集終了（blur）時は、対象フィールドだけをinputからspan
 *   へ戻すのではなく、focusedInputKeyをnullにしてrenderRooms()を呼ぶ
 *   （既存の「blurで全体再描画する」パターンをそのまま使う）ことで、
 *   再描画時の条件分岐が自動的にspanへ戻す。
 */

import {
  getState,
  getPartsForAreaCode,
  computeFinishId,
  roomKey,
  floorGroupKey,
  cellGroupKey,
  inputKey,
  roomFieldKey,
  getCell,
  getSelectedRoomKey,
  getSelectedGroupKey,
  getFocusedInputKey,
  getSelectedMaterialInputId,
  getRoomCopyButtonState,
  isFirstNormalFloorFirstRoom,
  isCellPendingRegistration,
  isFloorCollapsed,
  orderedInternalGroups
} from './finish-table-state.js';
import { formatProjectDisplayName } from '../demo/sample-project.js';

const OTHER_PART_INDEXES = new Set([5, 6]);

/** コピーボタンの状態→表示ラベル対応（4状態＋通常）。v0.1.3から変更なし。 */
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

        <!-- 仕上表全体のUndo/Redo。コピー専用の「戻す」とは別物。 -->
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

      <!-- 簡易リストは仕上表の上に表示する -->
      <section class="finish-simple-list-panel" id="finishSimpleListPanel"></section>

      <!--
        v0.1.4.3 再構成：仕上表は1個の2Dスクロール領域で動かす。
        左側は1部屋=1固定ブロック、右側だけが入力行を持つ。
        空固定セル・rowspan・clone overlay・JS横同期は使わない。
      -->
      <div class="finish-table-scroll" id="finishTableScroll">
        <div class="finish-table-host" id="finishRoomsArea"></div>
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
}

function currentRooms() {
  const state = getState();
  if (state.areaMode === 'external') return state.externalRooms;
  return orderedInternalGroups().flatMap((group) => group.rooms);
}

/** 階／コピー/部屋名の各固定列の幅（px）。部屋No.列だけが可変。 */
const FLOOR_COL_WIDTH = 30;
const COPY_COL_WIDTH = 35;
const ROOM_NAME_COL_WIDTH = 70;
/** ID列の幅（px）。建材名称・その他部位の列だけがセル内容に応じて可変。 */
const ID_COL_WIDTH = 30;

/**
 * 列構成・列幅・仕上表全体幅を一箇所で計算する。
 * ヘッダー・左固定ペイン・右入力領域は、この関数の1回の呼び出し結果だけから
 * 幅を組み立てる（別々に計算しない）。ブラウザの内容依存の自動幅計算には
 * 任せず、全て明示的なpx幅で揃える。
 *
 * @returns {{
 *   parts: string[],
 *   roomNoWidth: number,
 *   floorWidth: number,
 *   copyWidth: number,
 *   roomNameWidth: number,
 *   fixedRegionWidth: number,
 *   materialRegionWidth: number,
 *   totalTableWidth: number,
 *   groups: Array<{ label: string, groupWidth: number, cols: Array<{ kind: 'id'|'part'|'name', width: number }> }>
 * }}
 */
function computeColumnLayout() {
  const areaCode = getState().areaMode === 'external' ? 'E' : 'I';
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
  const roomNoWidth = Math.max(40, Math.min(90, 18 + longestRoomNo * 7));

  const fixedRegionWidth = FLOOR_COL_WIDTH + roomNoWidth + COPY_COL_WIDTH + ROOM_NAME_COL_WIDTH;

  // 建材ごとの列グループ（ID／[部位]／建材名称）。
  // ヘッダー・右入力行は、どちらもこの配列から同じgrid幅を組み立てる。
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
    fixedRegionWidth,
    materialRegionWidth,
    totalTableWidth,
    groups
  };
}

/**
 * 仕上表を「1個の2Dスクロール領域 + 部屋単位ブロック」で再描画する。
 *
 * v0.1.4.3 書き換え：
 * ・ヘッダーと本体は同じ .finish-sheet 幅・同じ computeColumnLayout() を共有する
 * ・左固定領域は、各入力行に空セルを作る方式を廃止する
 * ・左側は 1部屋 = 1つの .finish-room-fixed として生成する
 * ・右側だけが rowCount 分の入力行を持つ
 * ・部屋固定領域そのものを left:0 でstickyにし、4列個別stickyは使わない
 */
export function renderRooms() {
  const host = document.getElementById('finishRoomsArea');
  if (!host) return;

  const state = getState();
  const layout = computeColumnLayout();
  const { roomNoWidth, totalTableWidth } = layout;
  const sheetStyle = `--finish-roomno-w:${roomNoWidth}px;--finish-fixed-w:${layout.fixedRegionWidth}px;--finish-material-w:${layout.materialRegionWidth}px;width:${totalTableWidth}px`;

  host.innerHTML = `
    <div class="finish-table ${state.colorMode ? 'color-mode' : ''}" id="finishTable" style="${sheetStyle}">
      ${renderTableHeader(layout)}
      <div class="finish-table-body">
        ${state.areaMode === 'external' ? renderExternalRows(layout) : renderInternalRows(layout)}
      </div>
    </div>
  `;

  applyVisualState();
}

/**
 * 仕上表ヘッダー。
 * 左固定4列は1つの固定ペイン、建材側は同じ列幅定義のgridとして描画する。
 * 両方とも同じ2Dスクロール領域内にあるため、JS横同期は不要。
 */
function renderTableHeader(layout) {
  const fixedColumns = `${layout.floorWidth}px ${layout.roomNoWidth}px ${layout.copyWidth}px ${layout.roomNameWidth}px`;
  const materialColumns = layout.groups.flatMap((group) => group.cols.map((col) => `${col.width}px`)).join(' ');

  return `
    <div class="finish-sheet-header" style="grid-template-columns:${layout.fixedRegionWidth}px ${layout.materialRegionWidth}px">
      <div class="finish-header-fixed" style="grid-template-columns:${fixedColumns}">
        <div class="finish-header-fixed-cell">階</div>
        <div class="finish-header-fixed-cell">部屋No.</div>
        <div class="finish-header-fixed-cell">コピー</div>
        <div class="finish-header-fixed-cell">部屋名</div>
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
  const groups = orderedInternalGroups();
  const normalGroups = groups.filter((group) => group.areaCode === 'I');
  const lastNormalKey = normalGroups.length ? normalGroups[normalGroups.length - 1].uid : null;
  return groups.map((group) => renderGroupRows(group, layout, group.uid === lastNormalKey, true)).join('');
}

function renderExternalRows(layout) {
  const state = getState();
  const group = {
    uid: 'external-group',
    areaCode: 'E',
    label: '外部',
    rooms: state.externalRooms,
    virtual: true
  };
  // 外部は「階」の概念を持たないため、階見出し行（折りたたみ）の対象外とする。
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

/**
 * 階見出し行。
 * tableのcolspanは使わず、仕上表全幅を持つ1ブロックとして描画する。
 * ラベルだけleft:0へstickyさせ、横スクロールしても階名を見失わない。
 */
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

/**
 * 1部屋を、左固定ペイン1個 + 右入力行群として描画する。
 * 左側には2行目以降の空セルを一切作らない。rowCountが増えた場合は、
 * .finish-room-fixed 自体が右側の入力行群と同じ高さまで伸びる。
 */
function renderRoomBlock(room, group, layout, roomIsLast, isLastNormalFloor) {
  const key = roomKey(room);
  const floorText = group.areaCode === 'S' ? '階段' : group.areaCode === 'R' ? 'R階' : group.label;
  const fixedColumns = `${layout.floorWidth}px ${layout.roomNoWidth}px ${layout.copyWidth}px ${layout.roomNameWidth}px`;
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
        fixedColumns,
        roomIsLast,
        isLastNormalFloor
      })}
      <div class="finish-room-materials">${materialRows}</div>
    </div>
  `;
}

/**
 * 左固定領域は1部屋につきこの1要素だけを生成する。
 * 右側の入力行数と同じ高さは親gridのstretchで自動的に共有するため、
 * rowCount×28pxのabsolute重ね合わせや空セル生成は行わない。
 */
function renderRoomFixedPane(room, group, ctx) {
  const { key, floorText, fixedColumns, roomIsLast, isLastNormalFloor } = ctx;
  return `
    <div class="finish-room-fixed" data-room-key="${escapeHtml(key)}" style="grid-template-columns:${fixedColumns}">
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
    </div>
  `;
}

/** ＋階：通常階の最終部屋の階セルにだけ表示する。 */
function renderFloorAddButton(group, isLastNormalFloor, roomIsLast) {
  const state = getState();
  if (state.areaMode !== 'internal' || !isLastNormalFloor || !roomIsLast || group.areaCode !== 'I') return '';
  return '<button type="button" class="room-mini-btn floor-add" data-action="add-normal-floor">＋階</button>';
}

/** ＋B階（地下階追加）ショートカット：「1-1」ブロックの階セルにだけ表示する。 */
function renderBasementShortcutButton(room, group) {
  const state = getState();
  if (state.areaMode !== 'internal') return '';
  if (!isFirstNormalFloorFirstRoom(room, group)) return '';
  return '<button type="button" class="room-mini-btn basement-add" data-action="add-basement-floor">＋B階</button>';
}

/**
 * 部屋コピー用ボタン。4状態（コピー元／コピー可／上書き／戻す）＋
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

/**
 * 部屋No./部屋名の欄。
 *
 * v0.1.4.2 Phase 2：編集中（focusedInputKeyがこの欄のroomFieldKeyと一致する）
 * のときだけ<input>を描画し、それ以外は表示専用の<span class="finish-cell-display">
 * を描画する（常時<input>構造の廃止。ファイル冒頭のコメント参照）。
 *
 * @param {object} room
 * @param {'room-no'|'room-name'} field
 */
function renderRoomFieldControl(room, field) {
  const key = roomKey(room);
  const fieldKey = roomFieldKey(room, field);
  const value = field === 'room-no' ? room.roomNo : room.name;
  const inputClass = field === 'room-no' ? 'room-no-input' : 'room-name-input';
  const label = field === 'room-no' ? '部屋No.' : '';
  const placeholder = field === 'room-name' ? '部屋名' : '';
  const common = `data-field-key="${escapeHtml(fieldKey)}" data-room-key="${escapeHtml(key)}" data-field="${field}"`;

  if (getFocusedInputKey() === fieldKey) {
    return `<input class="finish-cell-input ${inputClass}" ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}">`;
  }

  return renderDisplaySpan(value, placeholder, inputClass, common, label);
}

/**
 * データセル1枠（ID／部位／建材名称のいずれか）を組み立てる。
 *
 * v0.1.4.2 Phase 2：編集中（focusedInputKeyがこの欄のinputKeyと一致する）
 * のときだけ<input>を描画し、それ以外は表示専用の<span class="finish-cell-display">
 * を描画する（常時<input>構造の廃止。ファイル冒頭のコメント参照）。
 *
 * @param {object} room
 * @param {number} partIndex
 * @param {number} row
 * @param {'id'|'part'|'name'} kind
 * @param {string} value
 * @param {string} placeholder
 * @param {string} inputClass
 */
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

/**
 * 表示専用<span class="finish-cell-display">を組み立てる共通処理。
 * 値が空のときはplaceholder文字列を薄く表示する（CSS側の.is-placeholder）。
 * data-placeholder属性は、swapDisplayToInput()がinputへ差し替える際に
 * placeholder属性として引き継ぐために持たせてある。
 *
 * @param {string} value
 * @param {string} placeholder
 * @param {string} inputClass
 * @param {string} commonAttrs すでに組み立て済みのdata-*属性文字列
 * @param {string} [label] aria-label（未指定なら付与しない）
 */
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
  const material = cell.inputId ? getState().materials.find((m) => String(m.inputId) === String(cell.inputId)) : null;
  const style = getState().colorMode && material ? ` style="--material-bg:${material.color}"` : '';

  const pendingRegistration = isCellPendingRegistration(room, partIndex, row);
  const registerButton = pendingRegistration
    ? `<button type="button" class="finish-register-btn" data-action="register-material" data-room-key="${escapeHtml(roomKey(room))}" data-part-index="${partIndex}" data-input-row="${row}" title="この名称を新規建材として登録します">登録</button>`
    : '';

  let html = `
    <div class="finish-data-cell group-first" data-group-key="${escapeHtml(groupKey)}" data-room-key="${escapeHtml(roomKey(room))}" data-finish-id="${escapeHtml(finishId)}" data-part-index="${partIndex}" data-input-row="${row}"${style}>
      ${renderFieldControl(room, partIndex, row, 'id', cell.inputId, 'ID', 'finish-id-input')}
      ${registerButton}
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

/**
 * 表示専用の<span class="finish-cell-display">を<input>へ差し替え、
 * フォーカスできる状態で返す。
 *
 * finish-table-controller.jsが、文字編集を開始できるタップ
 * （Apple Pencil以外）を検知したときにだけ呼ぶ。Pencilタップでは
 * 選択表示のみ更新し、この関数は呼ばない。テーブル全体を再描画せず、対象のフィールドだけを
 * 差し替えることで、タップのたびに仕上表全体が再描画される負荷・
 * ちらつきを避ける（v0.1.4.1で対応した「セル選択のたびに全体再描画しない」
 * 方針をPhase 2でも維持するため）。
 *
 * spanがis-placeholder（値が空でplaceholder文字列を表示中）の場合、
 * textContentはplaceholder文字列そのものなので、そのままinput.valueへ
 * コピーすると空欄のはずの欄にplaceholder文字列が実値として入ってしまう。
 * この場合はinput.valueを空文字にする。
 *
 * @param {HTMLElement} displaySpan .finish-cell-display要素
 * @returns {HTMLInputElement|null} 差し替え後のinput要素（対象でなければnull）
 */
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

/* ============================================================
   選択表示の再適用
   前回対象だった要素だけを覚えておき、その差分だけクラスを付け外しする。
   ============================================================ */

let lastRoomRows = [];
let lastGroupCells = [];
let lastMatchCells = [];
let lastFocusedInputEl = null;

function findTable() {
  return document.getElementById('finishTable');
}

/** 部屋選択（部屋全体の薄い水色表示）だけを更新する。 */
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

/** 入力グループ選択（外周枠）だけを更新する。 */
export function applyGroupSelection() {
  const table = findTable();
  if (!table) return;
  const key = getSelectedGroupKey();

  lastGroupCells.forEach((cell) => cell.classList.remove('is-group-selected'));
  lastGroupCells = key ? Array.from(table.querySelectorAll(`[data-group-key="${CSS.escape(key)}"]`)) : [];
  lastGroupCells.forEach((cell) => cell.classList.add('is-group-selected'));
}

/**
 * 簡易リストで選択中の建材と一致するセルの強調（is-material-match）だけを更新する。
 * 値の一致判定が必要なため、全セル走査が必要（IDの値を読むため）。
 * ID表示は編集中でなければ<span>（.finish-id-input兼用）になっているため、
 * value属性ではなくtextContentを読む。
 */
export function applyMaterialMatchHighlight() {
  const table = findTable();
  if (!table) return;

  lastMatchCells.forEach((cell) => cell.classList.remove('is-material-match'));
  lastMatchCells = [];

  const selectedMaterial = getSelectedMaterialInputId();
  if (selectedMaterial == null) return;

  table.querySelectorAll('[data-group-key]').forEach((td) => {
    const idField = td.querySelector('.finish-id-input');
    if (!idField) return;
    const idValue = 'value' in idField ? idField.value : idField.textContent;
    if (String(idValue) === String(selectedMaterial)) {
      td.classList.add('is-material-match');
      lastMatchCells.push(td);
    }
  });
}

/**
 * 入力中セルの青枠（is-focused-input）だけを更新する。
 *
 * データセル（data-input-key）・部屋No./部屋名欄（data-field-key）の
 * どちらも同じfocusedInputKeyを共用する（finish-table-state.jsの
 * roomFieldKey()を参照）ため、両方の属性を対象にする。
 */
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

/**
 * DOM再構築後（renderRooms()実行直後など）に、選択表示をすべて再適用する。
 */
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

/**
 * 操作バー・簡易リストの実際の高さを測定し、sticky位置用のCSS変数を更新する。
 *
 *   --finish-page-stack-h … アプリ既存ヘッダー＋上部タブバーの高さ。
 *   --finish-toolbar-h    … 仕上表の操作バー自身の高さ。
 *   --finish-list-h       … 簡易リストパネルの高さ（閉じていれば0）。
 *
 * .finish-table-scroll の最大高さは、この3変数を使って「画面内の残り高さ」
 * から算出する。仕上表ヘッダー自体はscroll領域内で top:0 にstickyするため、
 * ページ基準の大きなtop値は使わない。
 *
 * @param {HTMLElement} root #finish セクション要素
 */
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

/* ============================================================
   部屋コピー用の確認ダイアログ
   ブラウザ標準のconfirm()は使わず、自前の小型モーダルで完結させる。
   src/js/ui/modal.js（既存の汎用モーダル開閉）は使用・変更しない。
   ============================================================ */

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

/**
 * 部屋コピーの確認ダイアログを表示し、キャンセル／確定の結果をPromiseで返す。
 *
 * @param {string} message 確認文言（改行は\nで指定）
 * @param {string} okLabel 確定ボタンの文字列
 * @returns {Promise<boolean>}
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
