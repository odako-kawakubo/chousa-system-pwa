/**
 * src/js/materials/material-operations-controller.js
 *
 * v0.1.5.2C 建材リストの統合・削除UI入口。
 *
 * 役割：
 * - 統合先：1件
 * - 統合元：複数件
 * - 削除：複数件
 * - 統合／削除アコーディオンの開閉状態を保持
 * - 建材選択中もピッカーの開閉状態を保持
 * - 統合候補は、統合先と同じベース名を優先表示
 * - 削除候補は、仕上表で未使用の建材を優先表示
 *
 * Storeの更新本体はmaterial-operations.jsへ分離する。
 */

import {
  deleteMaterials,
  getActiveMaterialsForOperations,
  getMaterialUsagePlaces,
  hasSamplingOrAnalysisData,
  mergeMaterials
} from './material-operations.js';
import { renderMaterialOperations } from './material-operations-renderer.js';
import {
  getSelectedMaterialId,
  refreshMaterialList,
  selectMaterialInList
} from './material-list-controller.js';
import { refreshFinishTableFromStores } from '../finish-table/finish-table-controller.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';

let rootElement = null;
let mergeTargetId = '';
const mergeSourceIds = new Set();
const deleteTargetIds = new Set();

// UIの開閉状態はデータ選択とは分離して保持する。
// 選択変更で再描画しても、統合／削除の▶や選択パネルを閉じない。
const operationUiState = {
  openAccordion: '',
  openPickerId: ''
};

export function initializeMaterialOperations() {
  rootElement = document.getElementById('materialOperationsMount');
  if (!rootElement) return;

  bindOperationEvents();

  // 操作パネルを開くたび、建材リストで現在選択中のactive建材を
  // 統合先の初期値として使う。
  document.querySelectorAll('[data-drawer-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = getSelectedMaterialId();
      const activeIds = new Set(getActiveMaterialsForOperations().map((m) => m.materialId));
      if (selected && activeIds.has(selected)) mergeTargetId = selected;
      normalizeSelectionState(activeIds);
      refreshMaterialOperations();
    });
  });

  refreshMaterialOperations();
}

export function refreshMaterialOperations() {
  if (!rootElement) rootElement = document.getElementById('materialOperationsMount');
  if (!rootElement) return;

  const materials = getActiveMaterialsForOperations();
  const activeIds = new Set(materials.map((m) => m.materialId));
  normalizeSelectionState(activeIds);

  const usageMap = new Map();
  materials.forEach((material) => {
    usageMap.set(material.materialId, getMaterialUsagePlaces(material.materialId));
  });

  renderMaterialOperations(rootElement, materials, {
    targetId: mergeTargetId,
    sourceIds: mergeSourceIds,
    deleteIds: deleteTargetIds,
    usageMap,
    openAccordion: operationUiState.openAccordion,
    openPickerId: operationUiState.openPickerId
  });
}

function bindOperationEvents() {
  if (!rootElement || rootElement.dataset.eventsBound === '1') return;
  rootElement.dataset.eventsBound = '1';

  rootElement.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;

    const action = actionTarget.dataset.action;

    if (action === 'toggle-material-op-accordion') {
      const accordion = actionTarget.closest('[data-material-op-accordion]');
      const type = accordion?.dataset.materialOpAccordion || '';
      operationUiState.openAccordion = operationUiState.openAccordion === type ? '' : type;

      // アコーディオンを閉じた場合、その中のピッカー状態も解除する。
      if (!operationUiState.openAccordion) operationUiState.openPickerId = '';
      refreshMaterialOperations();
      return;
    }

    if (action === 'toggle-material-picker') {
      const pickerId = actionTarget.dataset.pickerId || '';
      operationUiState.openPickerId = operationUiState.openPickerId === pickerId ? '' : pickerId;
      refreshMaterialOperations();
      return;
    }

    if (action === 'close-material-picker') {
      const pickerId = actionTarget.dataset.pickerId || '';
      if (operationUiState.openPickerId === pickerId) operationUiState.openPickerId = '';
      refreshMaterialOperations();
      return;
    }

    if (action === 'remove-material-op-choice') {
      removeChoice(actionTarget.dataset.role, actionTarget.dataset.materialId);
      refreshMaterialOperations();
      return;
    }

    if (action === 'execute-material-merge') {
      executeMerge();
      return;
    }

    if (action === 'execute-material-delete') {
      executeDelete();
    }
  });

  rootElement.addEventListener('change', (event) => {
    const input = event.target.closest('[data-material-op-choice]');
    if (!input) return;

    // 選択変更ではアコーディオン／ピッカーを閉じない。
    updateChoice(input);
    refreshMaterialOperations();
  });
}

function updateChoice(input) {
  const role = input.dataset.role;
  const id = input.value;
  if (!id) return;

  if (role === 'merge-target') {
    mergeTargetId = input.checked ? id : '';
    if (mergeTargetId) mergeSourceIds.delete(mergeTargetId);
    return;
  }

  const set = role === 'merge-source' ? mergeSourceIds : deleteTargetIds;
  if (input.checked) set.add(id);
  else set.delete(id);
}

function removeChoice(role, id) {
  if (role === 'merge-target') {
    if (mergeTargetId === id) mergeTargetId = '';
    return;
  }
  if (role === 'merge-source') mergeSourceIds.delete(id);
  if (role === 'delete-target') deleteTargetIds.delete(id);
}

function normalizeSelectionState(activeIds) {
  if (mergeTargetId && !activeIds.has(mergeTargetId)) mergeTargetId = '';

  [...mergeSourceIds].forEach((id) => {
    if (!activeIds.has(id) || id === mergeTargetId) mergeSourceIds.delete(id);
  });

  [...deleteTargetIds].forEach((id) => {
    if (!activeIds.has(id)) deleteTargetIds.delete(id);
  });
}

function executeMerge() {
  const activeMaterials = getActiveMaterialsForOperations();
  const target = activeMaterials.find((m) => m.materialId === mergeTargetId);
  const sources = activeMaterials.filter((m) => mergeSourceIds.has(m.materialId));

  if (!target) {
    window.alert('統合先の建材を選んでください。');
    return;
  }
  if (!sources.length) {
    window.alert('統合する建材を選んでください。');
    return;
  }

  const sourceNames = sources.map((m) => `No.${m.materialNo} ${m.name}`).join('、');
  const hasProtectedInfo = sources.some(hasSamplingOrAnalysisData);
  const warning = hasProtectedInfo
    ? `${sourceNames} を No.${target.materialNo} ${target.name} に統合します。\n\n統合元の建材に採取・分析情報があります。\n統合後は統合先の情報を使用し、統合元の情報は履歴として残します。\n\n統合しますか？`
    : `${sourceNames} を No.${target.materialNo} ${target.name} に統合します。\n仕上表上の該当建材も統合先へ置き換えます。\n\n統合しますか？`;

  if (!window.confirm(warning)) return;

  try {
    mergeMaterials(target.materialId, sources.map((m) => m.materialId));

    mergeSourceIds.clear();
    deleteTargetIds.clear();
    operationUiState.openPickerId = '';

    selectMaterialInList(target.materialId);
    refreshAllConnectedViews();
    refreshMaterialOperations();
  } catch (error) {
    console.error('建材統合失敗', error);
    window.alert(error?.message || '建材統合に失敗しました。');
  }
}

function executeDelete() {
  const targets = getActiveMaterialsForOperations().filter((m) => deleteTargetIds.has(m.materialId));
  if (!targets.length) {
    window.alert('削除する建材を選んでください。');
    return;
  }

  const usedLines = [];
  targets.forEach((material) => {
    const places = getMaterialUsagePlaces(material.materialId);
    if (places.length) {
      usedLines.push(`No.${material.materialNo} ${material.name} は ${places.join('、')} にあります。`);
    }
  });

  const message = usedLines.length
    ? `${usedLines.join('\n')}\n\n仕上表からも消しますか？`
    : `${targets.map((m) => `No.${m.materialNo} ${m.name}`).join('、')} を削除しますか？`;

  if (!window.confirm(message)) return;

  try {
    const selected = getSelectedMaterialId();
    const deletingSelected = selected && deleteTargetIds.has(selected);

    deleteMaterials(targets.map((m) => m.materialId));

    if (deletingSelected) selectMaterialInList(null);

    deleteTargetIds.clear();
    mergeSourceIds.clear();
    operationUiState.openPickerId = '';

    if (mergeTargetId && targets.some((m) => m.materialId === mergeTargetId)) {
      mergeTargetId = '';
    }

    refreshAllConnectedViews();
    refreshMaterialOperations();
  } catch (error) {
    console.error('建材削除失敗', error);
    window.alert(error?.message || '建材削除に失敗しました。');
  }
}

function refreshAllConnectedViews() {
  refreshMaterialList();
  refreshFinishTableFromStores();
  refreshRecordView();
}
