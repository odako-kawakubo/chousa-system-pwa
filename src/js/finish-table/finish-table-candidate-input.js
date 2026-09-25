/**
 * src/js/finish-table/finish-table-candidate-input.js
 *
 * 仕上表の候補入力UIだけを担当する。
 * - 建材名／その他部位の候補生成・絞り込み
 * - 候補ポップアップの表示・位置・選択状態
 * - 未登録名称編集中のIDセル「登録」ボタン表示
 *
 * Storeの業務確定やUndo/Redoは担当しない。
 * 候補を選んだ後の確定処理はcontrollerへ返し、既存の1操作=1commit経路を維持する。
 */

import {
  finishRecordStore,
  materialRecordStore,
  getMaterialPartOptions
} from './finish-table-actions.js';
import {
  getMaterialOptions,
  getOtherMaterialOptions,
  getOtherPartOptions
} from '../store/survey-candidate-store.js';

let activeCandidateInput = null;
let activeCandidateOptions = [];

function normalizeCandidateFilter(value) {
  return String(value ?? '').trim().toLowerCase();
}

function roomAnchorForInput(input) {
  const roomKeyValue = String(input?.dataset?.roomKey || '');
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && String(record.roomUid || '') === roomKeyValue
  ) || null;
}

function candidatePopup() {
  return document.getElementById('finishCandidatePopup');
}

function positionCandidatePopup(input) {
  const popup = candidatePopup();
  if (!popup || popup.hidden || !input) return;

  const rect = input.getBoundingClientRect();
  const gap = 4;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const desiredWidth = Math.min(360, Math.max(240, rect.width * 2.4));
  const left = Math.max(8, Math.min(rect.left, viewportWidth - desiredWidth - 8));

  popup.style.width = `${desiredWidth}px`;
  popup.style.left = `${left}px`;
  popup.style.top = `${rect.bottom + gap}px`;
  popup.style.bottom = 'auto';

  const popupHeight = Math.min(popup.scrollHeight || 260, 300);
  if (rect.bottom + gap + popupHeight > viewportHeight - 8 && rect.top > popupHeight + gap + 8) {
    popup.style.top = 'auto';
    popup.style.bottom = `${Math.max(8, viewportHeight - rect.top + gap)}px`;
  }
}

function getCandidateOptionsForInput(input) {
  if (!input) return [];

  const kind = input.dataset.kind;
  const partIndex = Number(input.dataset.partIndex);

  if (kind === 'part') {
    const roomKeyValue = String(input.dataset.roomKey || '');
    const row = Number(input.dataset.inputRow);
    const position = partIndex * 100 + row;
    const finishRecord = finishRecordStore.getAll().find((record) =>
      record.status === 'active'
      && String(record.roomUid || '') === roomKeyValue
      && Number(record.position) === position
    ) || null;
    const material = finishRecord?.materialId ? materialRecordStore.get(finishRecord.materialId) : null;
    const materialParts = getMaterialPartOptions(material);
    const values = materialParts.length > 1 ? materialParts : getOtherPartOptions();

    return values.map((value) => ({
      kind: 'part',
      value,
      name: value,
      part: value,
      applyPart: true
    }));
  }

  if (kind !== 'name') return [];

  if (partIndex >= 5) return getOtherMaterialOptions();

  const anchor = roomAnchorForInput(input);
  if (!anchor) return [];

  const internalParts = ['床', '巾木', '壁', '天井'];
  const externalParts = ['床 犬走', '外壁', '屋根', '軒裏'];
  const parts = anchor.areaCode === 'E' ? externalParts : internalParts;
  const part = parts[partIndex - 1] || '';
  return getMaterialOptions(part, { defaultPart: part });
}

function findGroupIdCell(input) {
  const cell = input?.closest('.finish-data-cell');
  const groupKey = cell?.dataset.groupKey;
  if (!groupKey) return null;

  return [...cell.closest('.finish-room-block')?.querySelectorAll('.finish-data-cell.group-first') || []]
    .find((candidate) => candidate.dataset.groupKey === groupKey) || null;
}

export function closeCandidatePopup() {
  const popup = candidatePopup();
  if (!popup) return;

  popup.hidden = true;
  popup.innerHTML = '';
  activeCandidateInput = null;
  activeCandidateOptions = [];
}

export function renderCandidatePopup(input) {
  const popup = candidatePopup();
  if (!popup || !input || !document.contains(input)) return;

  const filter = normalizeCandidateFilter(input.value);
  const all = getCandidateOptionsForInput(input);
  const visible = filter
    ? all.filter((item) => normalizeCandidateFilter(item.value).includes(filter))
    : all;

  activeCandidateInput = input;
  activeCandidateOptions = visible.slice(0, 60);

  if (!activeCandidateOptions.length) {
    closeCandidatePopup();
    return;
  }

  popup.innerHTML = activeCandidateOptions.map((item, index) =>
    `<button type="button" class="finish-candidate-item" data-candidate-index="${index}">${String(item.value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')}</button>`
  ).join('');
  popup.hidden = false;
  positionCandidatePopup(input);
}

export function updateFinishInputCandidates(input) {
  if (!input || !['name', 'part'].includes(input.dataset.kind)) {
    closeCandidatePopup();
    return;
  }
  renderCandidatePopup(input);
}

export function restoreDynamicRegisterButton(input) {
  const idCell = findGroupIdCell(input);
  if (!idCell || idCell.dataset.dynamicRegister !== '1') return;

  idCell.innerHTML = idCell.dataset.dynamicRegisterOriginal || '';
  delete idCell.dataset.dynamicRegister;
  delete idCell.dataset.dynamicRegisterOriginal;
}

export function syncDynamicRegisterButton(input) {
  if (!input || input.dataset.kind !== 'name') return;

  const idCell = findGroupIdCell(input);
  if (!idCell) return;

  const roomKeyValue = String(input.dataset.roomKey || '');
  const partIndex = Number(input.dataset.partIndex);
  const row = Number(input.dataset.inputRow);
  const position = partIndex * 100 + row;
  const finishRecord = finishRecordStore.getAll().find((record) =>
    record.status === 'active'
    && String(record.roomUid || '') === roomKeyValue
    && Number(record.position) === position
  ) || null;

  const raw = String(input.value || '').trim();
  const normalizedName = raw.replace(/^【\d+】\s*/, '').replace(/^.+?\//, '');
  const linkedMaterial = finishRecord?.materialId
    ? materialRecordStore.get(finishRecord.materialId)
    : null;

  const stillLinkedToCurrentMaterial = Boolean(
    linkedMaterial
    && normalizedName
    && String(linkedMaterial.name || '').trim() === normalizedName
  );

  if (stillLinkedToCurrentMaterial) {
    restoreDynamicRegisterButton(input);
    return;
  }

  if (idCell.dataset.dynamicRegister !== '1') {
    idCell.dataset.dynamicRegisterOriginal = idCell.innerHTML;
    idCell.dataset.dynamicRegister = '1';
  }

  idCell.innerHTML = `<button type="button" class="finish-register-btn" data-action="register-material" data-room-key="${input.dataset.roomKey || ''}" data-part-index="${input.dataset.partIndex || ''}" data-input-row="${input.dataset.inputRow || ''}" title="この名称を建材レコードへ登録します">登録</button>`;
}

export function getActiveCandidateSelection(index) {
  if (!activeCandidateInput) return null;

  const option = activeCandidateOptions[Number(index)];
  return option ? { option, input: activeCandidateInput } : null;
}

export function isActiveCandidateInput(input) {
  return Boolean(input && activeCandidateInput === input);
}
