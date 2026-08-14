/**
 * src/js/materials/simple-list.js
 *
 * 簡易リスト専用モジュール。
 * チップ選択は「参照状態」として保持し、チップ入力ONのときだけ
 * controller側が仕上表へ建材を反映する。
 *
 * チップ選択時は仕上表全体を再描画せず、建材の一致強調だけを更新する。
 * 部屋選択・入力グループ選択・フォーカス枠とは独立した表示状態として扱う。
 *
 * v0.1.5.1でのデータ層移行：
 *   建材データの取得元を、state.materials（旧: finish-table-state.jsが持つ
 *   業務データ）からmaterialRecordStore（正本）へ切り替えた。
 *   チップ選択自体（selectedMaterialInputId）は引き続きUI専用状態
 *   （finish-table-state.js）のまま。
 */

import {
  getState,
  getSelectedMaterialInputId,
  setSelectedMaterialInputId
} from '../finish-table/finish-table-state.js';
import { materialRecordStore, getMaterialUsageRoomNos } from '../finish-table/finish-table-actions.js';
import { applyMaterialMatchHighlight } from '../finish-table/finish-table-renderer.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { openPhotoViewer } from '../photos/photo-viewer.js';

function findMaterialByInputId(inputId) {
  return materialRecordStore.findByInputId(inputId);
}

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
      if (material) openMaterialVisualPhotos(material);
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
      ${materialRecordStore.getAll()
        .filter((material) => material.status === 'active')
        .map((material) => renderChip(material, selected, state.colorMode))
        .join('')}
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

function visualPhotosForMaterial(material) {
  if (!material) return [];
  const keys = new Set();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || String(record.materialId || '') !== String(material.materialId || '')) return;
    const part = String(record.part || '').trim();
    if (record.roomPosition && part) keys.add(`${record.roomPosition}|${part}`);
  });
  return photoRecordStore.getActive()
    .filter((photo) => photo.photoType === 'visual' && keys.has(`${photo.roomPosition}|${photo.part}`))
    .sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')));
}

function openMaterialVisualPhotos(material) {
  const photos = visualPhotosForMaterial(material);
  if (!photos.length) {
    openPhotoConfirmModal(material, 'この建材が使われている部屋・部位の目視写真はまだありません。');
    return;
  }
  openPhotoViewer(photos[0].photoId, { preferredMaterialId: material.materialId });
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

function openPhotoConfirmModal(material, message = '') {
  const modal = document.getElementById('finishPhotoConfirmModal');
  if (!modal) return;
  document.getElementById('finishPhotoConfirmTitle').textContent = `写真確認：${material.name}`;
  document.getElementById('finishPhotoConfirmBody').textContent = message || '目視写真を確認できません。';
  modal.classList.add('open');
}

function closePhotoConfirmModal() {
  document.getElementById('finishPhotoConfirmModal')?.classList.remove('open');
}
