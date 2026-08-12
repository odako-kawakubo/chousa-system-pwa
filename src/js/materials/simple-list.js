/**
 * src/js/materials/simple-list.js
 *
 * 簡易リスト専用モジュール。
 * チップ選択は「参照状態」として保持し、チップ入力ONのときだけ
 * controller側が仕上表へ建材を反映する。
 *
 * チップ選択時は仕上表全体を再描画せず、建材の一致強調だけを更新する。
 * 部屋選択・入力グループ選択・フォーカス枠とは独立した表示状態として扱う。
 */

import {
  getState,
  getSelectedMaterialInputId,
  setSelectedMaterialInputId,
  findMaterialByInputId,
  getMaterialUsageRoomNos
} from '../finish-table/finish-table-state.js';
import { applyMaterialMatchHighlight } from '../finish-table/finish-table-renderer.js';

let boundContainer = null;

export function initSimpleList(container) {
  if (!container) return;
  boundContainer = container;
  renderSimpleList();

  if (container.dataset.eventsBound === '1') return;
  container.dataset.eventsBound = '1';

  container.addEventListener('click', (event) => {
    const chip = event.target.closest('.finish-simple-item');
    if (chip) {
      const inputId = Number(chip.dataset.inputId);
      const current = getSelectedMaterialInputId();

      // 同じチップをもう一度押したら選択解除。
      setSelectedMaterialInputId(current === inputId ? null : inputId);
      renderSimpleList();
      applyMaterialMatchHighlight();
      return;
    }

    const photoButton = event.target.closest('[data-action="show-finish-photo-confirm"]');
    if (photoButton && !photoButton.disabled) {
      const material = findMaterialByInputId(getSelectedMaterialInputId());
      if (material) openPhotoConfirmModal(material);
    }
  });

  ensurePhotoConfirmModal();
}

export function renderSimpleList() {
  const container = boundContainer || document.getElementById('finishSimpleListPanel');
  if (!container) return;

  const state = getState();
  container.hidden = !state.simpleListOpen;
  if (!state.simpleListOpen) {
    container.innerHTML = '';
    return;
  }

  const selected = getSelectedMaterialInputId();
  container.innerHTML = `
    <div class="finish-simple-list-items" id="finishSimpleListItems">
      ${state.materials.map((material) => renderChip(material, selected, state.colorMode)).join('')}
    </div>
    <div class="finish-selected-info">${renderSelectedInfo(selected)}</div>
  `;
}

function renderChip(material, selectedInputId, colorMode) {
  const selected = Number(selectedInputId) === Number(material.inputId);
  const classes = ['finish-simple-item'];
  if (selected) classes.push('selected');
  if (colorMode) classes.push('color-on');

  const style = colorMode ? ` style="--chip-bg:${material.color}"` : '';
  return `
    <button type="button" class="${classes.join(' ')}" data-input-id="${material.inputId}"${style}>
      【${material.inputId}】${escapeHtml(material.name)}
    </button>
  `;
}

function renderSelectedInfo(inputId) {
  const material = inputId != null ? findMaterialByInputId(inputId) : null;
  if (!material) {
    return '<span class="hint">建材チップを選択すると、使用部屋・調査備考・写真枚数を表示します。</span>';
  }

  const rooms = getMaterialUsageRoomNos(inputId);
  const roomText = rooms.length ? rooms.join('、') : '使用箇所なし';
  const note = material.note || '－';
  const photoDisabled = material.photoCount ? '' : ' disabled';

  return `
    <strong>【${material.inputId}】${escapeHtml(material.name)}</strong>
    <span class="finish-selected-rooms">${escapeHtml(roomText)}</span>
    <span>【調査備考】${escapeHtml(note)}</span>
    <button type="button" class="finish-photo-link" data-action="show-finish-photo-confirm"${photoDisabled}>📷 ${material.photoCount}枚</button>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
  modal.addEventListener('click', closePhotoConfirmModal);
  modal.querySelector('.finish-photo-confirm-card').addEventListener('click', (event) => event.stopPropagation());
  modal.querySelector('#finishPhotoConfirmClose').addEventListener('click', closePhotoConfirmModal);
}

function openPhotoConfirmModal(material) {
  const modal = document.getElementById('finishPhotoConfirmModal');
  if (!modal) return;
  document.getElementById('finishPhotoConfirmTitle').textContent = `写真確認：${material.name}`;
  document.getElementById('finishPhotoConfirmBody').textContent =
    `目視調査写真 ${material.photoCount}枚（サンプル件数）。写真本体の読込は後続実装です。`;
  modal.classList.add('open');
}

function closePhotoConfirmModal() {
  document.getElementById('finishPhotoConfirmModal')?.classList.remove('open');
}
