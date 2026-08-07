/**
 * src/js/materials/simple-list.js
 *
 * このファイルの役割：
 *   仕上表タブ内の「簡易リスト」（サンプル建材20件の一覧）・建材カラー
 *   ON/OFF切替・選択建材情報（調査備考／写真枚数／画像表示ボタン）・
 *   写真確認用の簡易モーダルを描画し、操作を受け付ける。
 *
 * どこから呼ばれるか：
 *   src/js/finish-table/finish-table-controller.js の initializeFinishTable()
 *   から initSimpleList(containerEl) が呼ばれる。
 *
 * 何を取得しているか：
 *   finish-table-state.js が持つサンプル建材データ（20件）と、現在の
 *   選択状態・建材カラー表示ON/OFF。
 *
 * 何を判定しているか：
 *   ・建材カラー表示がON/OFFどちらか（一覧の色表示の出し分け）
 *   ・選択中の建材に調査備考があるか（無ければ「－」表示）
 *   ・選択中の建材の写真枚数が0件か（0件なら画像表示ボタンを無効化）
 *
 * どこへ描画しているか：
 *   渡されたコンテナ要素（#finishSimpleListPanel）の中だけ。
 *   仕上表の部屋一覧（#finishRoomsArea）へは、建材を選択中セルへ反映する
 *   ときだけ finish-table-state.js 経由で値を書き込む（DOM構造自体は
 *   finish-table-renderer.js側の関数を呼んで更新する）。
 *
 * 写真確認モーダルについて：
 *   既存の写真プレビューモーダル（#photoPreviewModal）・src/js/ui/modal.js
 *   には一切手を加えず、仕上表タブ専用の確認用モーダル
 *   （#finishPhotoConfirmModal）をこのファイル内だけで完結する形で
 *   新規に持つ。実際の写真表示（画像の読込・表示）は行わない
 *   （後続工程）。
 *
 * 保存・外部通信について：
 *   一切行わない。建材の選択・セルへの反映は、すべてブラウザの
 *   メモリ上の状態（finish-table-state.js）を書き換えるだけ。
 */

import {
  getState,
  getColorMode,
  toggleColorMode,
  getSelectedMaterialInputId,
  setSelectedMaterialInputId,
  findMaterialByInputId,
  findMaterialByName,
  getActiveCellKey,
  findRoomByKey,
  setCellValue
} from '../finish-table/finish-table-state.js';
import { updateHighlights, updateCellBadge } from '../finish-table/finish-table-renderer.js';

/**
 * 簡易リスト・選択建材情報・確認モーダルの枠を描画し、イベントを配線する。
 *
 * @param {HTMLElement} container #finishSimpleListPanel 要素
 */
export function initSimpleList(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="finish-simple-list-head">
      <h4>簡易リスト</h4>
      <button type="button" class="btn small" id="finishColorToggleBtn"></button>
    </div>
    <div class="finish-simple-list-items" id="finishSimpleListItems"></div>
    <div class="finish-selected-info" id="finishSelectedInfo"></div>
  `;

  renderColorToggleButton();
  renderItems();
  renderSelectedInfo();
  ensurePhotoConfirmModal();

  document.getElementById('finishColorToggleBtn').addEventListener('click', () => {
    // 判定：建材カラー表示のON/OFFを反転する。保存・外部通信は行わない。
    toggleColorMode();
    renderColorToggleButton();
    renderItems();
  });

  document.getElementById('finishSimpleListItems').addEventListener('click', (event) => {
    const item = event.target.closest('.finish-simple-item');
    if (!item) return;
    selectMaterial(Number(item.dataset.inputId));
  });

  document.getElementById('finishSelectedInfo').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="show-finish-photo-confirm"]');
    if (!btn || btn.disabled) return;
    const inputId = getSelectedMaterialInputId();
    const material = inputId != null ? findMaterialByInputId(inputId) : null;
    if (material) openPhotoConfirmModal(material);
  });
}

/**
 * 建材を選択する（簡易リストの選択）。
 * フォーカス中の入力枠があれば、その枠へ建材名称を反映する
 * （選択建材を仕上表セルへ反映）。
 *
 * @param {number} inputId
 */
function selectMaterial(inputId) {
  // 判定：この入力IDの建材がサンプルデータに存在するかどうか。
  const material = findMaterialByInputId(inputId);
  if (!material) return;

  setSelectedMaterialInputId(inputId);

  // 判定：現在フォーカス中（選択中）の仕上表セルがあるかどうか。
  const activeCellKey = getActiveCellKey();
  if (activeCellKey) {
    applyMaterialToCell(activeCellKey, material);
  }

  renderItems();
  renderSelectedInfo();
  updateHighlights();
}

/**
 * 指定した仕上表IDのセルへ、建材名称を書き込む（選択建材をセルへ反映）。
 * 建材本来の色をセルに塗りつぶすことはしない（簡易リスト側の色表示のみ）。
 *
 * @param {string} finishId
 * @param {object} material
 */
function applyMaterialToCell(finishId, material) {
  const cellEl = document.querySelector(`#finishRoomsArea .finish-cell[data-finish-id="${finishId}"]`);
  if (!cellEl) return;

  const room = findRoomByKey(cellEl.dataset.roomKey);
  if (!room) return;

  const partIndex = Number(cellEl.dataset.partIndex);
  const row = Number(cellEl.dataset.inputRow);

  // 更新：状態（メモリ上）とDOM（入力欄の表示）の両方へ建材名称を反映する。
  setCellValue(room, partIndex, row, material.name);
  const input = cellEl.querySelector('.finish-value-input');
  if (input) input.value = material.name;

  updateCellBadge(cellEl);
}

/**
 * 仕上表セルにフォーカスが移ったとき、その値が既知の建材名と一致すれば、
 * 簡易リスト側の選択状態を合わせる（簡易リストの該当建材と連動）。
 * 一致しない場合は、直前の選択状態をそのまま保つ。
 *
 * finish-table-controller.js から、セルのfocusin時に呼ばれる。
 *
 * @param {string} value 仕上表セルの現在の入力値
 */
export function syncSelectionFromCellValue(value) {
  const material = findMaterialByName(value);
  if (!material) return;
  setSelectedMaterialInputId(material.inputId);
  renderItems();
  renderSelectedInfo();
}

function renderColorToggleButton() {
  const btn = document.getElementById('finishColorToggleBtn');
  if (!btn) return;
  btn.textContent = getColorMode() ? '建材カラー：ON' : '建材カラー：OFF';
}

/** 簡易リストの20項目を描画する（入力ID・建材名称・建材カラー）。 */
function renderItems() {
  const container = document.getElementById('finishSimpleListItems');
  if (!container) return;
  container.innerHTML = '';

  const state = getState();
  state.materials.forEach((material) => {
    const isSelected = state.selectedMaterialInputId === material.inputId;

    const item = document.createElement('button');
    item.type = 'button';
    item.className = isSelected ? 'finish-simple-item selected' : 'finish-simple-item';
    item.dataset.inputId = String(material.inputId);

    const swatch = document.createElement('span');
    swatch.className = 'finish-simple-color-swatch';
    // 判定：カラー表示ONなら常に色を出す。OFFなら選択中の建材だけ一時的に色を出す。
    const showColor = state.colorMode || isSelected;
    swatch.style.background = showColor ? material.color : 'transparent';
    item.appendChild(swatch);

    const idEl = document.createElement('span');
    idEl.className = 'finish-simple-item-id';
    idEl.textContent = `#${material.inputId}`;
    item.appendChild(idEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'finish-simple-item-name';
    nameEl.textContent = material.name;
    item.appendChild(nameEl);

    container.appendChild(item);
  });
}

/** 選択中建材の調査備考・写真枚数・画像表示ボタンを描画する。 */
function renderSelectedInfo() {
  const container = document.getElementById('finishSelectedInfo');
  if (!container) return;

  const inputId = getSelectedMaterialInputId();
  const material = inputId != null ? findMaterialByInputId(inputId) : null;

  if (!material) {
    container.innerHTML = '<div class="hint">簡易リストで建材を選択すると、調査備考・写真枚数を表示します。</div>';
    return;
  }

  container.innerHTML = '';

  const noteRow = document.createElement('div');
  noteRow.className = 'finish-selected-info-row';
  // 判定：調査備考が空文字かどうか。空なら「－」を表示する。
  noteRow.textContent = `調査備考：${material.note ? material.note : '－'}`;
  container.appendChild(noteRow);

  const photoRow = document.createElement('div');
  photoRow.className = 'finish-selected-info-row';
  photoRow.textContent = `調査写真：📷 ${material.photoCount}枚`;
  container.appendChild(photoRow);

  const showBtn = document.createElement('button');
  showBtn.type = 'button';
  showBtn.className = 'btn small';
  showBtn.textContent = '画像表示';
  // 判定：写真0枚なら画像表示ボタンを無効化する。
  showBtn.disabled = material.photoCount === 0;
  showBtn.dataset.action = 'show-finish-photo-confirm';
  container.appendChild(showBtn);
}

/**
 * 仕上表タブ専用の写真確認モーダルをbody直下に1つだけ用意する。
 * 既存の#photoPreviewModal・src/js/ui/modal.jsとは完全に独立して
 * 開閉を自前で行う（同じ仕組みを流用しない）。
 */
function ensurePhotoConfirmModal() {
  if (document.getElementById('finishPhotoConfirmModal')) return;

  const modal = document.createElement('div');
  modal.className = 'finish-photo-confirm-modal';
  modal.id = 'finishPhotoConfirmModal';
  modal.innerHTML = `
    <div class="finish-photo-confirm-card">
      <div class="finish-photo-confirm-head">
        <b id="finishPhotoConfirmTitle">写真確認</b>
        <button type="button" class="btn small" id="finishPhotoConfirmClose">閉じる</button>
      </div>
      <div class="finish-photo-confirm-body" id="finishPhotoConfirmBody"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // 背景（カード外側）クリックで閉じる。カード内クリックは伝播を止める。
  modal.addEventListener('click', () => closePhotoConfirmModal());
  modal.querySelector('.finish-photo-confirm-card').addEventListener('click', (event) => {
    event.stopPropagation();
  });
  document.getElementById('finishPhotoConfirmClose').addEventListener('click', closePhotoConfirmModal);
}

/**
 * 写真確認モーダルを開く。実際の写真の読込・表示は行わず、
 * 件数だけを文言で示す確認用の表示にとどめる（後続工程で実装）。
 *
 * @param {object} material
 */
function openPhotoConfirmModal(material) {
  const modal = document.getElementById('finishPhotoConfirmModal');
  const title = document.getElementById('finishPhotoConfirmTitle');
  const body = document.getElementById('finishPhotoConfirmBody');
  if (!modal || !title || !body) return;

  title.textContent = `写真確認：${material.name}`;
  body.textContent =
    `目視調査写真 ${material.photoCount}枚（仮データ）。実際の写真表示は後続工程で実装します。`;
  modal.classList.add('open');
}

function closePhotoConfirmModal() {
  document.getElementById('finishPhotoConfirmModal')?.classList.remove('open');
}
