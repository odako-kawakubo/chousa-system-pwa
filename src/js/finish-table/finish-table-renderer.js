/**
 * src/js/finish-table/finish-table-renderer.js
 *
 * このファイルの役割：
 *   仕上表タブの画面描画だけを行う。状態（finish-table-state.js）を読み取って
 *   DOM要素を組み立てるだけで、状態そのものを変更する判定・保存・外部通信は
 *   一切行わない。
 *
 * どこから呼ばれるか：
 *   src/js/finish-table/finish-table-controller.js から、初期描画・
 *   部屋や階の追加後の再描画・選択状態の見た目更新のために呼ばれる。
 *   src/js/materials/simple-list.js からも、建材選択時のセル反映後に
 *   ハイライト更新（updateHighlights / updateCellBadge）のために呼ばれる。
 *
 * 何を取得しているか：
 *   finish-table-state.js が持つ現在の状態（部屋構成・セルの値・選択状態・
 *   建材カラー表示ON/OFF）。
 *
 * 何を判定しているか：
 *   ・内部／外部のどちらを描画するか
 *   ・各セルが「選択中の建材」と一致しているか（ハイライト表示のため）
 *   ・その他欄に入力済みの建材名があるか（入力IDバッジ表示のため）
 *
 * どこへ描画しているか：
 *   #finish セクション内の #finishRoomsArea・#finishAddButtons・
 *   #finishProjectBanner・.finish-area-btn のみ。他タブのDOM・ヘッダー・
 *   ドロワー・案件パネル・既存モーダルには一切触れない。
 *
 * 保存・外部通信について：
 *   一切行わない。DOM組み立てのみ。
 */

import {
  getState,
  getPartsForAreaCode,
  computeRoomPosition,
  computeFinishId,
  roomKey,
  getCellValue,
  getCellActualPart,
  getSelectedRoomKey,
  getSelectedMaterialInputId,
  findMaterialByName,
  findMaterialByInputId
} from './finish-table-state.js';
import { formatProjectDisplayName } from '../demo/sample-project.js';

/**
 * 仕上表タブの枠組み（案件バナー・内部外部切替・追加ボタン・部屋一覧・
 * 簡易リストパネルの器）を1度だけ組み立てる。
 *
 * @param {HTMLElement} container #finish セクション要素
 */
export function renderFinishTab(container) {
  container.innerHTML = `
    <div class="finish-tab-root">
      <div class="finish-project-banner" id="finishProjectBanner"></div>
      <div class="finish-toolbar">
        <div class="finish-area-toggle" id="finishAreaToggle">
          <button type="button" class="btn small finish-area-btn active" data-area-mode="internal">内部</button>
          <button type="button" class="btn small finish-area-btn" data-area-mode="external">外部</button>
        </div>
        <div class="finish-add-buttons" id="finishAddButtons"></div>
      </div>
      <div class="finish-workspace">
        <div class="finish-rooms-area" id="finishRoomsArea"></div>
        <aside class="finish-simple-list-panel" id="finishSimpleListPanel"></aside>
      </div>
    </div>
  `;

  const banner = document.getElementById('finishProjectBanner');
  if (banner) banner.textContent = formatProjectDisplayName(getState().project);

  renderAddButtons();
  renderRooms();
}

/**
 * 内部／外部それぞれで表示すべき追加ボタン（通常階／地下階／階段／屋上／部屋）を描画する。
 */
export function renderAddButtons() {
  const container = document.getElementById('finishAddButtons');
  if (!container) return;
  container.innerHTML = '';

  const state = getState();
  if (state.areaMode === 'external') {
    container.appendChild(makeActionButton('＋部屋追加', 'add-external-room'));
    return;
  }

  container.appendChild(makeActionButton('＋通常階追加', 'add-normal-floor'));
  container.appendChild(makeActionButton('＋地下階追加', 'add-basement-floor'));
  container.appendChild(makeActionButton('＋階段追加', 'add-stairs'));
  container.appendChild(makeActionButton('＋屋上追加', 'add-roof'));
}

function makeActionButton(label, action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  btn.textContent = label;
  btn.dataset.action = action;
  return btn;
}

/** 内部／外部の切替ボタンのactive表示を、現在の状態に合わせて更新する。 */
export function updateAreaToggleButtons() {
  const state = getState();
  document.querySelectorAll('.finish-area-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.areaMode === state.areaMode);
  });
}

/**
 * 部屋一覧を現在の状態から丸ごと再描画する。
 * 部屋・階・入力行の追加、内部／外部切替のたびに呼ぶ。
 */
export function renderRooms() {
  const container = document.getElementById('finishRoomsArea');
  if (!container) return;
  container.innerHTML = '';

  const state = getState();
  if (state.areaMode === 'external') {
    container.appendChild(renderFlatGroupSection('外部', state.externalRooms));
    return;
  }

  state.floors.forEach((floorGroup) => {
    container.appendChild(renderFloorGroupSection(floorGroup));
  });
  container.appendChild(renderFlatGroupSection('階段', state.stairs));
  container.appendChild(renderFlatGroupSection('屋上', state.roof));
}

function renderFloorGroupSection(floorGroup) {
  const wrap = document.createElement('div');
  wrap.className = 'finish-floor-group';

  const head = document.createElement('div');
  head.className = 'finish-floor-group-head';

  const title = document.createElement('h4');
  title.textContent = floorGroup.label;
  head.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn small';
  addBtn.textContent = '＋部屋追加';
  addBtn.dataset.action = 'add-room';
  addBtn.dataset.floorKey = `${floorGroup.areaCode}:${floorGroup.floor}`;
  head.appendChild(addBtn);

  wrap.appendChild(head);

  const list = document.createElement('div');
  list.className = 'finish-room-list';
  floorGroup.rooms.forEach((room) => list.appendChild(renderRoomCard(room)));
  wrap.appendChild(list);

  return wrap;
}

function renderFlatGroupSection(title, rooms) {
  const wrap = document.createElement('div');
  wrap.className = 'finish-floor-group';

  const head = document.createElement('div');
  head.className = 'finish-floor-group-head';
  const h = document.createElement('h4');
  h.textContent = title;
  head.appendChild(h);
  wrap.appendChild(head);

  const list = document.createElement('div');
  list.className = 'finish-room-list';
  rooms.forEach((room) => list.appendChild(renderRoomCard(room)));
  wrap.appendChild(list);

  return wrap;
}

/**
 * 1部屋分のブロック（階／部屋No./コピー欄／部屋名／建材入力欄）を組み立てる。
 * data-area-code・data-room-position・data-floor・data-room-index を
 * 正式仕様のデータ属性として持たせる。
 */
function renderRoomCard(room) {
  const isFloorRoom = room.areaCode === 'I' || room.areaCode === 'B';
  const key = roomKey(room);

  const section = document.createElement('section');
  section.className = 'finish-room';
  section.dataset.areaCode = room.areaCode;
  section.dataset.roomPosition = computeRoomPosition(room);
  section.dataset.roomKey = key;
  if (isFloorRoom) {
    section.dataset.floor = String(room.floor);
    section.dataset.roomIndex = String(room.roomIndex);
  } else {
    section.dataset.roomIndex = String(room.index);
  }
  if (getSelectedRoomKey() === key) section.classList.add('selected');

  const head = document.createElement('div');
  head.className = 'finish-room-head';

  const floorLabel = document.createElement('span');
  floorLabel.className = 'finish-room-floor';
  floorLabel.textContent = isFloorRoom ? `${room.floor}F` : '－';
  head.appendChild(floorLabel);

  const noLabel = document.createElement('span');
  noLabel.className = 'finish-room-no';
  noLabel.textContent = isFloorRoom ? String(room.roomNo) : computeRoomPosition(room);
  head.appendChild(noLabel);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn small finish-room-copy';
  copyBtn.textContent = 'コピー';
  copyBtn.disabled = true;
  copyBtn.title = '部屋コピーは後続工程で実装します（今回は未実装）';
  head.appendChild(copyBtn);

  const nameInput = document.createElement('input');
  nameInput.className = 'finish-room-name';
  nameInput.value = room.name;
  nameInput.dataset.roomKey = key;
  head.appendChild(nameInput);

  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.className = 'btn small finish-room-add-row';
  addRowBtn.textContent = '＋入力行';
  addRowBtn.dataset.action = 'add-row';
  addRowBtn.dataset.roomKey = key;
  head.appendChild(addRowBtn);

  section.appendChild(head);

  const partsWrap = document.createElement('div');
  partsWrap.className = 'finish-room-parts';

  getPartsForAreaCode(room.areaCode).forEach((partLabel, i) => {
    const partIndex = i + 1;
    const isOther = partIndex >= 5;

    const partEl = document.createElement('div');
    partEl.className = isOther ? 'finish-part finish-part-other' : 'finish-part';
    partEl.dataset.partIndex = String(partIndex);

    const labelEl = document.createElement('div');
    labelEl.className = 'finish-part-label';
    labelEl.textContent = partLabel;
    partEl.appendChild(labelEl);

    for (let row = 1; row <= room.rowCount; row++) {
      partEl.appendChild(renderCell(room, partIndex, row, isOther));
    }

    partsWrap.appendChild(partEl);
  });

  section.appendChild(partsWrap);
  return section;
}

/**
 * 1つの入力枠（セル）を組み立てる。仕上表IDは保存せず、その場で計算する。
 * その他欄（部位番号5・6）は入力IDバッジ・実際の部位入力・建材名称入力の
 * 3要素を持つ構造にする。
 */
function renderCell(room, partIndex, row, isOther) {
  const finishId = computeFinishId(room, partIndex, row);
  const value = getCellValue(room, partIndex, row);

  const cell = document.createElement('div');
  cell.className = isOther ? 'finish-cell finish-cell-other' : 'finish-cell';
  cell.dataset.finishId = finishId;
  cell.dataset.areaCode = room.areaCode;
  cell.dataset.roomPosition = computeRoomPosition(room);
  cell.dataset.position = String(partIndex * 100 + row);
  cell.dataset.partIndex = String(partIndex);
  cell.dataset.inputRow = String(row);
  cell.dataset.roomKey = roomKey(room);

  if (isOther) {
    const actualPart = getCellActualPart(room, partIndex, row);
    cell.dataset.defaultPart = 'その他';
    cell.dataset.actualPart = actualPart;

    const badge = document.createElement('span');
    badge.className = 'finish-cell-id-badge';
    const matchedForBadge = findMaterialByName(value);
    badge.textContent = matchedForBadge ? `#${matchedForBadge.inputId}` : '';
    cell.appendChild(badge);

    const actualPartInput = document.createElement('input');
    actualPartInput.className = 'finish-actual-part-input';
    actualPartInput.placeholder = '実際の部位';
    actualPartInput.value = actualPart;
    cell.appendChild(actualPartInput);
  }

  const valueInput = document.createElement('input');
  valueInput.className = 'finish-value-input';
  valueInput.placeholder = '建材名称';
  valueInput.value = value;
  cell.appendChild(valueInput);

  const selectedMaterial = getSelectedMaterialInputId() != null
    ? findMaterialByInputId(getSelectedMaterialInputId())
    : null;
  if (selectedMaterial && value && value === selectedMaterial.name) {
    cell.classList.add('selected-match');
  }

  return cell;
}

/**
 * 選択中の建材名と一致するセルへ、選択中ハイライト（青枠）を付け外しする。
 * 建材の選択・セルへの反映・セルの直接編集のたびに呼ぶ。
 */
export function updateHighlights() {
  const selectedMaterial = getSelectedMaterialInputId() != null
    ? findMaterialByInputId(getSelectedMaterialInputId())
    : null;

  document.querySelectorAll('#finishRoomsArea .finish-cell').forEach((cellEl) => {
    const input = cellEl.querySelector('.finish-value-input');
    const matches = Boolean(selectedMaterial && input && input.value.trim() === selectedMaterial.name);
    cellEl.classList.toggle('selected-match', matches);
  });
}

/** その他欄の入力IDバッジを、現在の建材名称入力値から更新する。 */
export function updateCellBadge(cellEl) {
  const badge = cellEl.querySelector('.finish-cell-id-badge');
  if (!badge) return;
  const input = cellEl.querySelector('.finish-value-input');
  const matched = input ? findMaterialByName(input.value) : undefined;
  badge.textContent = matched ? `#${matched.inputId}` : '';
}

/** 部屋選択（部屋全体の薄い青表示＋左端の青線）の見た目を更新する。 */
export function updateRoomSelectionClasses() {
  const state = getState();
  document.querySelectorAll('#finishRoomsArea .finish-room').forEach((el) => {
    el.classList.toggle('selected', el.dataset.roomKey === state.selectedRoomKey);
  });
}

/** セル選択（入力中セルの青枠）の見た目を更新する。 */
export function updateCellActiveClasses() {
  const state = getState();
  document.querySelectorAll('#finishRoomsArea .finish-cell').forEach((el) => {
    el.classList.toggle('editing', el.dataset.finishId === state.activeCellKey);
  });
}
