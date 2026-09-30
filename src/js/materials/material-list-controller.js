/**
 * src/js/materials/material-list-controller.js
 *
 * 建材リスト全体の画面状態・選択・編集UI進行・再描画を調整するController。
 * - データ正本は materialRecordStore。
 * - DOM / Apple Pencilイベントは material-list-interactions.js。
 * - 建材の編集ルールは material-list-edit-actions.js。
 * - 単一Record保存は material-list-persistence.js。
 * - 表示データはViewModel、DOM生成はRendererへ分離する。
 * - 案件ごとのスクロール位置を保持し、行選択だけでは一覧全体を再描画しない。
 */

import { normalizeSampleParts } from '../records/material-record.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { getMaterialUsageRoomLabels } from '../finish-table/material-usage-derived.js';
import { getCurrentProject } from '../projects/project-store.js';
import { refreshFinishTableFromStores } from '../finish-table/finish-table-controller.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';
import { buildMaterialListRows } from './material-list-view-model.js';
import { renderMaterialList } from './material-list-renderer.js';
import {
  updateMaterialControlValue,
  updateMaterialSampleParts,
  updateMaterialNameValue,
  updateMaterialNoteValue,
  updateMaterialAnalysisTextValue,
  applyMaterialSamplingAutofill
} from './material-list-edit-actions.js';
import { bindMaterialListInteractions } from './material-list-interactions.js';

let rootElement = null;
let selectedMaterialId = null;
let materialListTabScrollBound = false;
let renderedProjectId = '';
const scrollStateByProject = new Map();

// 建材リスト専用の表示状態。仕上表／簡易リストとは独立して切り替える。
let materialListColorMode = false;
// OFF=部屋No.、ON=部屋名優先。部屋名空欄は常に部屋No.へフォールバックする。
let materialListRoomNameMode = false;
// 調査中は横幅を圧迫しないよう、分析結果／分析備考は初期非表示。
let materialListAnalysisColumnsOpen = false;


function captureMaterialListScroll() {
  if (!rootElement || !renderedProjectId) return;
  const wrap = rootElement.querySelector('.material-list-table-wrap');
  if (!wrap) return;
  scrollStateByProject.set(renderedProjectId, {
    top: Number(wrap.scrollTop || 0),
    left: Number(wrap.scrollLeft || 0)
  });
}

function restoreMaterialListScroll(projectId) {
  if (!rootElement) return;
  const wrap = rootElement.querySelector('.material-list-table-wrap');
  if (!wrap) return;
  const saved = scrollStateByProject.get(String(projectId || '')) || { top: 0, left: 0 };
  wrap.scrollTop = Number(saved.top || 0);
  wrap.scrollLeft = Number(saved.left || 0);
}

function bindMaterialListTabScrollState() {
  if (materialListTabScrollBound) return;
  materialListTabScrollBound = true;

  window.addEventListener('chousa:tab-change', (event) => {
    const previousTab = String(event.detail?.previousTab || '');
    const currentTab = String(event.detail?.currentTab || '');

    if (previousTab === 'materials') captureMaterialListScroll();
    if (currentTab === 'materials') {
      requestAnimationFrame(() => {
        restoreMaterialListScroll(String(getCurrentProject()?.projectId || ''));
      });
    }
  });
}

/**
 * 建材リストタブの初期化入口。DOMイベント・Store購読・スクロール保持を設定し、初回一覧を描画する。
 */
export function initializeMaterialList() {
  rootElement = document.getElementById('materials');
  if (!rootElement) return;

  bindMaterialListInteractions({
    root: rootElement,
    getRoot: () => rootElement,
    activateTarget: handleMaterialActivation,
    activateTextDisplay,
    commitTextEditor,
    updateSampleParts: updateSamplePartsFromChecklist,
    updateControl: updateMaterialControl
  });
  bindMaterialListTabScrollState();
  document.querySelector('.tabs .tab[data-tab="materials"]')?.addEventListener('click', refreshMaterialList);
  refreshMaterialList();
}

/**
 * material Storeから最新ViewModelを作り一覧を再描画する。選択材・スクロール位置・カラー表示等のUI状態を維持する。
 */
export function refreshMaterialList() {
  if (!rootElement) rootElement = document.getElementById('materials');
  if (!rootElement) return;

  captureMaterialListScroll();
  applySamplingAutofill();

  // usageLocation正本は従来どおり部屋No.のまま維持する。
  // 部屋名表示は画面表示用だけfinishRecordから組み立て、採取場所候補等へ波及させない。
  const rows = buildMaterialListRows(materialRecordStore.getAll()).map((row) => ({
    ...row,
    usageLocationDisplay: getMaterialUsageRoomLabels(row.inputId, {
      preferRoomName: materialListRoomNameMode
    }).join('、') || row.usageLocation
  }));
  if (selectedMaterialId && !rows.some((row) => row.materialId === selectedMaterialId)) {
    selectedMaterialId = null;
  }

  const projectId = String(getCurrentProject()?.projectId || '');
  renderMaterialList(rootElement, rows, selectedMaterialId, {
    colorMode: materialListColorMode,
    roomNameMode: materialListRoomNameMode,
    analysisColumnsOpen: materialListAnalysisColumnsOpen
  });
  renderedProjectId = projectId;
  restoreMaterialListScroll(projectId);
}

/**
 * 行/セルの操作対象を判定し、テキスト編集・select操作・行選択へ振り分ける。業務ルール自体はedit-actionsへ委譲する。
 */
function handleMaterialActivation(target, options = {}) {
  const closeMultiSelect = target.closest('[data-action="close-material-multi-select"]');
  if (closeMultiSelect) {
    closeMultiSelect.closest('[data-material-multi-select]')?.removeAttribute('open');
    return;
  }

  const colorButton = target.closest('[data-action="toggle-material-color"]');
  if (colorButton) {
    materialListColorMode = !materialListColorMode;
    refreshMaterialList();
    return;
  }

  const roomNameButton = target.closest('[data-action="toggle-material-room-name"]');
  if (roomNameButton) {
    materialListRoomNameMode = !materialListRoomNameMode;
    refreshMaterialList();
    return;
  }

  const analysisColumnsButton = target.closest('[data-action="toggle-material-analysis-columns"]');
  if (analysisColumnsButton) {
    materialListAnalysisColumnsOpen = !materialListAnalysisColumnsOpen;
    refreshMaterialList();
    return;
  }

  const row = target.closest('[data-material-row]');
  if (row) setSelectedMaterial(row.dataset.materialId);

  const textDisplay = target.closest('[data-material-text-display]');
  if (textDisplay) {
    activateTextDisplay(textDisplay);
    return;
  }

  if (options.fromPen) {
    const control = target.closest('[data-material-control]');
    if (control && !control.disabled) activateNativeControl(control);
  }
}

/**
 * 選択中materialIdを更新し、一覧・簡易リスト等の選択強調へ反映する。
 */
function setSelectedMaterial(materialId) {
  selectedMaterialId = materialId || null;
  applySelectedRowState();
}

function applySelectedRowState() {
  if (!rootElement) return;
  rootElement.querySelectorAll('[data-material-row]').forEach((row) => {
    row.classList.toggle('selected-material-row', row.dataset.materialId === selectedMaterialId);
  });

  const label = rootElement.querySelector('[data-material-selected-label]');
  if (!label) return;
  const record = selectedMaterialId ? materialRecordStore.get(selectedMaterialId) : null;
  label.textContent = record ? `選択中：【${record.inputId}】${record.name}` : '選択なし';
}

/**
 * 通常span表示のセルをinput/textarea編集状態へ切り替える。値保存はcommitTextEditor側で行う。
 */
function activateTextDisplay(display) {
  const materialId = display.dataset.materialId;
  const kind = display.dataset.editorKind;
  if (!materialId || !kind) return;
  setSelectedMaterial(materialId);

  const record = materialRecordStore.get(materialId);
  if (!record) return;
  const value = kind === 'note'
    ? String(record.note || '')
    : kind === 'analysisResult'
      ? String(record.analysisResult || '')
      : kind === 'remarks'
        ? String(record.remarks || '')
        : String(record.name || '');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'material-cell-input';
  input.value = value;
  input.dataset.materialTextInput = '1';
  input.dataset.materialId = materialId;
  input.dataset.editorKind = kind;
  input.setAttribute('aria-label', display.getAttribute('aria-label') || kind);

  display.replaceWith(input);
  input.focus();
}

/**
 * 編集UIの値を種類別の更新関数へ渡し、保存後に表示状態へ戻す。建材名/備考/分析欄で更新規則が異なる。
 */
function commitTextEditor(input) {
  const materialId = input.dataset.materialId;
  const kind = input.dataset.editorKind;
  if (kind === 'name') updateMaterialName(materialId, input.value);
  else if (kind === 'note') updateMaterialNote(materialId, input.value);
  else if (kind === 'analysisResult') updateMaterialAnalysisText(materialId, 'analysisResult', input.value);
  else if (kind === 'remarks') updateMaterialAnalysisText(materialId, 'remarks', input.value);
  else refreshMaterialList();
}

/**
 * select/date/checkbox等のネイティブcontrolを操作可能状態にする。Record更新はchangeイベント側で行う。
 */
function activateNativeControl(control) {
  control.focus({ preventScroll: true });

  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    control.click();
    return;
  }

  if (typeof control.showPicker === 'function') {
    try {
      control.showPicker();
      return;
    } catch (_) {
      // Safari等でshowPickerが拒否された場合は通常clickへフォールバック。
    }
  }
  control.click();
}

/**
 * level・分析要否・採取数・採取場所・採取日等のcontrol値をedit-actionsへ渡し、必要な画面を再描画する。
 */
function updateMaterialControl(control) {
  const result = updateMaterialControlValue(control);
  if (!result.changed) return;
  refreshMaterialList();
  refreshRecordView();
}

/**
 * 採取部位の複数checkboxを配列へ集約してedit-actionsへ渡す。保存後はsummary表示とRecord Viewを更新する。
 */
function updateSamplePartsFromChecklist(materialId) {
  if (!rootElement) return;

  const inputs = [...rootElement.querySelectorAll('[data-material-multi-part]')]
    .filter((input) => input.dataset.materialId === materialId);
  const selected = inputs
    .filter((input) => input.checked)
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);

  const result = updateMaterialSampleParts(materialId, selected);
  if (!result.changed) return;

  const details = inputs[0]?.closest('[data-material-multi-select]');
  const summary = details?.querySelector('.material-multi-select-summary');
  if (summary) {
    const label = result.selected.length ? result.selected.join('、') : '選択';
    summary.textContent = label;
    summary.title = label;
  }
  refreshRecordView();
}

/**
 * 建材名称変更をedit-actionsへ委譲し、重複/未入力エラーをUI表示する。成功時は仕上表等の関連画面も更新する。
 */
function updateMaterialName(materialId, rawValue) {
  const result = updateMaterialNameValue(materialId, rawValue);
  if (result.error) window.alert(result.error);
  if (result.refreshConnected) {
    refreshConnectedViews();
    return;
  }
  if (result.refreshList) refreshMaterialList();
}

/**
 * 調査備考の更新をedit-actionsへ委譲し、変更があれば関連画面を再描画する。
 */
function updateMaterialNote(materialId, rawValue) {
  const result = updateMaterialNoteValue(materialId, rawValue);
  if (result.refreshConnected) {
    refreshConnectedViews();
    return;
  }
  if (result.refreshList) refreshMaterialList();
}

/**
 * 分析結果/分析備考の文字列更新をedit-actionsへ渡す。保存後は一覧とRecord Viewを同期表示する。
 */
function updateMaterialAnalysisText(materialId, field, rawValue) {
  const result = updateMaterialAnalysisTextValue(materialId, field, rawValue);
  if (result.refreshList) refreshMaterialList();
  if (result.refreshRecordView) refreshRecordView();
}

/**
 * 建材の使用箇所・部位から採取場所/採取部位を補完する処理をedit-actionsへ委譲する。
 */
function applySamplingAutofill() {
  applyMaterialSamplingAutofill();
}

function refreshConnectedViews() {
  refreshMaterialList();
  refreshFinishTableFromStores();
  refreshRecordView();
}

export function getSelectedMaterialId() {
  return selectedMaterialId;
}

export function selectMaterialInList(materialId) {
  selectedMaterialId = materialId || null;
  applySelectedRowState();
}
