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

    const visualButton = event.target.closest('[data-action="show-finish-visual-photos"]');
    if (visualButton && !visualButton.disabled) {
      const material = findMaterialByInputId(getSelectedMaterialInputId());
      if (material) openMaterialVisualPhotos(material);
      return;
    }

    const samplingButton = event.target.closest('[data-action="show-finish-sampling-photos"]');
    if (samplingButton && !samplingButton.disabled) {
      const material = findMaterialByInputId(getSelectedMaterialInputId());
      if (material) openMaterialSamplingPhotos(material);
    }
  });
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
    return '<span class="hint">建材チップを選択すると、使用箇所・調査備考・写真を表示します。</span>';
  }

  const rooms = getMaterialUsageRoomNos(inputId);
  const roomText = rooms.length ? rooms.join('、') : '使用箇所なし';
  const hasRoomOverflow = rooms.length > 10;
  const note = material.note || '－';
  const visualPhotos = visualPhotosForMaterial(material);
  const samplingPhotos = samplingPhotosForMaterial(material);

  return `
    <strong>【${material.inputId}】${escapeHtml(material.name)}</strong>
    <span class="finish-selected-rooms-wrap ${hasRoomOverflow ? 'has-overflow' : ''}">
      <span class="finish-selected-rooms" tabindex="0" aria-label="使用箇所：${escapeHtml(roomText)}">${escapeHtml(roomText)}</span>
      ${hasRoomOverflow ? '<span class="finish-selected-rooms-ellipsis" aria-hidden="true">…</span>' : ''}
    </span>
    <span class="finish-selected-note">【調査備考】${escapeHtml(note)}</span>
    <span class="finish-selected-photo-actions">写真：
      <button type="button" class="finish-photo-link" data-action="show-finish-visual-photos"${visualPhotos.length ? '' : ' disabled'}>目視</button>
      <button type="button" class="finish-photo-link" data-action="show-finish-sampling-photos"${samplingPhotos.length ? '' : ' disabled'}>採取</button>
    </span>
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

function samplingPhotosForMaterial(material) {
  if (!material) return [];
  return photoRecordStore.getActive()
    .filter((photo) => photo.photoType === 'sampling' && String(photo.materialId || '') === String(material.materialId || ''))
    .sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId || '').localeCompare(String(b.photoId || '')));
}

function openMaterialVisualPhotos(material) {
  const photos = visualPhotosForMaterial(material);
  if (!photos.length) return;
  openPhotoViewer(photos[0].photoId, { preferredMaterialId: material.materialId, photos });
}

function openMaterialSamplingPhotos(material) {
  const photos = samplingPhotosForMaterial(material);
  if (!photos.length) return;
  openPhotoViewer(photos[0].photoId, { photos });
}

