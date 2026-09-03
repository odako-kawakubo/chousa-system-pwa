/**
 * src/js/finish-table/finish-table-controller.js
 *
 * 仕上表のイベント配線とユーザー操作の入口を担当する。
 * DOM描画はrenderer、UI専用状態はstate、業務ロジック（部屋・建材の
 * 読み書き）はfinish-table-actions.js（finishRecordStore／
 * materialRecordStore）、簡易リストはsimple-list、履歴はhistoryへ分離する。
 *
 * v0.1.5.1でのデータ層移行：
 *   これまでこのファイルはfinish-table-state.jsの業務ミューテーター
 *   （addNormalFloor・setCellDraftInputId等）を直接呼んでいたが、業務データの
 *   正本をfinishRecordStore／materialRecordStoreへ移したことに伴い、
 *   finish-table-actions.jsの関数を呼ぶ形へ置き換えた。DOM構造・イベント
 *   配線の対象（クラス名・data属性）自体は変更していない。
 *
 *   このファイルはfinishRecordStore／materialRecordStoreの購読（subscribe）
 *   を再描画のトリガーとしては使わない。業務操作はすべて
 *   「finish-table-actions.jsの関数を呼ぶ→refreshFromStores()を呼ぶ」という
 *   単一の経路に統一し（withHistory()／commitAndRefresh()がその経路）、
 *   Store単位・件単位で再描画が何度も走る経路を作らない。UI専用状態
 *   （finish-table-state.js）の変更だけは、従来どおりsubscribe経由で
 *   refreshFromStores()を呼ぶ（表示モード・折りたたみ等、業務データを
 *   伴わない変更のため）。
 *
 * Undo/Redo（戻る/進む）は、finishRecordStore／materialRecordStoreの
 * スナップショット（getUndoableSnapshot/restoreUndoableSnapshot、この
 * ファイルに定義）を対象にする。UI専用状態・階折りたたみ・コピー専用の
 * 「戻す」は対象に含めない（v0.1.4までと同じ方針。対象がRecordベースに
 * 変わっただけ）。
 *
 * 現在の表構造は「1個の2Dスクロール領域 + 部屋単位の左固定ペイン」。
 * Apple Pencilは単純タップを通常操作として扱い、ドラッグ時だけ編集開始を抑止する。
 */

import { formatProjectLabel } from '../projects/project-store.js';

import {
  initFinishTableState,
  getState,
  subscribe,
  setAreaMode,
  getSelectedRoomKey,
  setSelectedRoomKey,
  setSelectedGroupKey,
  setFocusedInputKey,
  getSelectedMaterialInputId,
  toggleColorMode,
  toggleChipInputMode,
  getChipInputMode,
  toggleSimpleListOpen,
  toggleFloorCollapsed,
  getRoomCopyState,
  startRoomCopySource,
  cancelRoomCopySource,
  recordRoomCopyBackup,
  clearRoomCopyBackup,
  getRoomCopyBackup,
  setPendingCellName,
  clearPendingCellName,
  getPendingCellName
} from './finish-table-state.js';
import {
  addNormalFloor,
  addBasementFloor,
  addStairs,
  addRoof,
  addExternalRoom,
  addRoomToFloor,
  addRoomAfter,
  addInputRow,
  commitRoomField,
  commitCellId,
  commitCellName,
  commitCellActualPart,
  applyMaterialToCell,
  registerMaterialForCell,
  getMaterialPartOptions,
  describeRoomCopyClick,
  executeRoomCopy,
  restoreRoomCopy,
  snapshotRoomRecords,
  runRecordTransaction,
  refreshMaterialUsageDerivedFields,
  finishRecordStore,
  materialRecordStore
} from './finish-table-actions.js';
import {
  renderFinishTab,
  renderToolbarState,
  renderRooms,
  applyRoomSelection,
  applyGroupSelection,
  applyFocusedInputHighlight,
  showFinishConfirm,
  updateStickyMetrics,
  swapDisplayToInput
} from './finish-table-renderer.js';
import { recordHistory, canUndo, canRedo, popUndo, popRedo, resetHistory } from './finish-table-history.js';
import { initSimpleList, renderSimpleList } from '../materials/simple-list.js';
import { getMaterialOptions, getOtherMaterialOptions, getOtherPartOptions } from '../store/survey-candidate-store.js';


function normalizeCandidateFilter(value) {
  return String(value ?? '').trim().toLowerCase();
}

function roomAnchorForInput(input) {
  const roomKeyValue = String(input?.dataset?.roomKey || '');
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && String(record.roomUid || '') === roomKeyValue
  ) || null;
}

let activeCandidateInput = null;
let activeCandidateOptions = [];

function candidatePopup() {
  return document.getElementById('finishCandidatePopup');
}

function closeCandidatePopup() {
  const popup = candidatePopup();
  if (!popup) return;
  popup.hidden = true;
  popup.innerHTML = '';
  activeCandidateInput = null;
  activeCandidateOptions = [];
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
    // その他1/2で既存建材が複数部位を持つ場合は、その建材が実際に持つ部位だけを候補にする。
    // 未紐付け時は従来どおり案件内の「その他」用候補を表示する。
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

  if (partIndex >= 5) {
    // その他1/2は共通候補。現在の実部位に限定せず、両枠で使用中の
    // 「部位/建材」候補を同じ順序で表示する。
    return getOtherMaterialOptions();
  }

  const anchor = roomAnchorForInput(input);
  if (!anchor) return [];
  const internalParts = ['床', '巾木', '壁', '天井'];
  const externalParts = ['床 犬走', '外壁', '屋根', '軒裏'];
  const parts = anchor.areaCode === 'E' ? externalParts : internalParts;
  const part = parts[partIndex - 1] || '';
  return getMaterialOptions(part, { defaultPart: part });
}

function renderCandidatePopup(input) {
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

function updateFinishInputCandidates(input) {
  if (!input || !['name', 'part'].includes(input.dataset.kind)) {
    closeCandidatePopup();
    return;
  }
  renderCandidatePopup(input);
}

function findGroupIdCell(input) {
  const cell = input?.closest('.finish-data-cell');
  const groupKey = cell?.dataset.groupKey;
  if (!groupKey) return null;
  return [...cell.closest('.finish-room-block')?.querySelectorAll('.finish-data-cell.group-first') || []]
    .find((candidate) => candidate.dataset.groupKey === groupKey) || null;
}

function restoreDynamicRegisterButton(input) {
  const idCell = findGroupIdCell(input);
  if (!idCell || idCell.dataset.dynamicRegister !== '1') return;
  idCell.innerHTML = idCell.dataset.dynamicRegisterOriginal || '';
  delete idCell.dataset.dynamicRegister;
  delete idCell.dataset.dynamicRegisterOriginal;
}

function syncDynamicRegisterButton(input) {
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

  // 編集開始直後から、未紐付けセルは内容が空でもIDセル全面を「登録」にする。
  // 既存建材に紐付いているセルでも、名称を別名へ編集し始めた時点で登録候補へ切り替える。
  const stillLinkedToCurrentMaterial = Boolean(
    linkedMaterial
    && normalizedName
    && String(linkedMaterial.name || '').trim() === normalizedName
  );
  const shouldShow = !stillLinkedToCurrentMaterial;

  if (!shouldShow) {
    restoreDynamicRegisterButton(input);
    return;
  }

  if (idCell.dataset.dynamicRegister !== '1') {
    idCell.dataset.dynamicRegisterOriginal = idCell.innerHTML;
    idCell.dataset.dynamicRegister = '1';
  }

  idCell.innerHTML = `<button type="button" class="finish-register-btn" data-action="register-material" data-room-key="${input.dataset.roomKey || ''}" data-part-index="${input.dataset.partIndex || ''}" data-input-row="${input.dataset.inputRow || ''}" title="この名称を建材レコードへ登録します">登録</button>`;
}

function commitCandidateSelection(option, input) {
  if (!option || !input) return;
  const roomKeyValue = input.dataset.roomKey;
  const partIndex = Number(input.dataset.partIndex);
  const row = Number(input.dataset.inputRow);
  const pendingKey = cellPendingKey(roomKeyValue, partIndex, row);

  if (input.dataset.kind === 'part') {
    completeCellEdit(input, () => {
      commitCellActualPart(roomKeyValue, partIndex, row, option.part || option.value);
    });
    focusOtherCompanionField(roomKeyValue, partIndex, row, 'name');
    return;
  }

  // 入力ID付きの既存建材は、その選択操作だけで確定して編集終了する。
  if (option.materialId) {
    const material = materialRecordStore.get(option.materialId);
    if (!material) return;
    completeCellEdit(input, () => {
      if (partIndex >= 5 && option.applyPart && option.part) {
        commitCellActualPart(roomKeyValue, partIndex, row, option.part);
      }
      applyMaterialToCell(roomKeyValue, partIndex, row, material);
      clearPendingCellName(pendingKey);
      refreshMaterialUsageDerivedFields('existing-material-select');
    });
    focusOtherCompanionField(roomKeyValue, partIndex, row, 'part');
    return;
  }

  // ベース名／デフォルト候補は「未登録名を編集中」のまま維持する。
  // ここでは建材レコードへ自動登録せず、入力値とpending名だけを更新する。
  // その他候補に部位が含まれる場合は、実部位だけRecordへ反映する。
  const name = String(option.name || option.baseName || option.value || '').trim();
  if (!name) return;

  if (partIndex >= 5 && option.applyPart && option.part) {
    runRecordTransaction(() => {
      commitCellActualPart(roomKeyValue, partIndex, row, option.part);
    });
  }

  input.value = name;
  setPendingCellName(pendingKey, name);
  syncDynamicRegisterButton(input);
  renderCandidatePopup(input);
  input.focus();
}

/** フォーカス中の文字入力について、編集開始前のスナップショットと値を覚えておく。 */
let pendingEditSnapshot = null;
let pendingEditBeforeValue = null;

/**
 * 候補選択／登録のような明示操作で確定した入力キー。
 * DOM再描画に伴って旧inputのfocusoutが後から発火しても、同じ値を二重確定しない。
 * ブラウザごとのfocusout発火順に依存しないよう、1イベントループ分だけ保持する。
 */
let explicitlyCommittedInputKey = null;
let explicitCommitReleaseTimer = null;

function markExplicitlyCommitted(input) {
  const key = String(input?.dataset?.inputKey || '');
  explicitlyCommittedInputKey = key || null;
  if (explicitCommitReleaseTimer) clearTimeout(explicitCommitReleaseTimer);
  explicitCommitReleaseTimer = setTimeout(() => {
    explicitlyCommittedInputKey = null;
    explicitCommitReleaseTimer = null;
  }, 250);
}

function consumeExplicitCommit(input) {
  const key = String(input?.dataset?.inputKey || '');
  if (!key || key !== explicitlyCommittedInputKey) return false;
  explicitlyCommittedInputKey = null;
  if (explicitCommitReleaseTimer) clearTimeout(explicitCommitReleaseTimer);
  explicitCommitReleaseTimer = null;
  return true;
}

/**
 * 候補選択／登録でセル編集を明示確定する共通経路。
 * 1操作につきStore確定と履歴記録を1回だけ行い、focusout側では再確定させない。
 */
function completeCellEdit(input, mutate) {
  if (!input || typeof mutate !== 'function') return;
  const before = pendingEditSnapshot || getUndoableSnapshot();
  markExplicitlyCommitted(input);
  closeCandidatePopup();
  restoreDynamicRegisterButton(input);
  setFocusedInputKey(null);
  runRecordTransaction(mutate);
  recordHistory(before);
  updateUndoRedoButtons();
  pendingEditSnapshot = null;
  pendingEditBeforeValue = null;
  refreshFromStores();
}

/**
 * その他1/2の「建材名 <-> 部位」入力を往復しやすくする。
 * 明示確定（候補選択／登録／Enter）の後だけ相手セルへ移動し、
 * 単なるblurや別セルタップではユーザーの移動先を奪わない。
 */
function focusOtherCompanionField(roomKeyValue, partIndex, row, targetKind) {
  if (partIndex < 5 || !['name', 'part'].includes(targetKind)) return;

  requestAnimationFrame(() => {
    const root = document.getElementById('finish');
    if (!root) return;
    const field = [...root.querySelectorAll(`[data-kind="${targetKind}"]`)].find((candidate) =>
      String(candidate.dataset.roomKey || '') === String(roomKeyValue || '')
      && Number(candidate.dataset.partIndex) === Number(partIndex)
      && Number(candidate.dataset.inputRow) === Number(row)
    );
    if (!field) return;

    const input = field.classList.contains('finish-cell-input') ? field : swapDisplayToInput(field);
    if (input) input.focus();
  });
}

export function initializeFinishTable() {
  const finishSection = document.getElementById('finish');
  if (!finishSection) return;

  initFinishTableState();
  resetHistory();
  renderFinishTab(finishSection);
  initSimpleList(document.getElementById('finishSimpleListPanel'));
  bindEvents(finishSection);
  bindDrawerFinishTools();
  bindUndoRedoButtons();
  updateUndoRedoButtons();
  setupStickyMetrics(finishSection);

  // UI専用状態（表示モード・選択・折りたたみ等）の変更は、ここで再描画に
  // 反映する。finishRecordStore／materialRecordStoreの変更はStore側の
  // subscribe()ではなく、各業務操作の直後にrefreshFromStores()を明示的に
  // 呼ぶことで反映する（withHistory()／commitAndRefresh()を参照）。
  subscribe(() => {
    refreshFromStores();
  });
}

/**
 * finishRecordStore／materialRecordStore（＋UI専用状態）の現在の内容を、
 * 画面（仕上表本体・操作列・簡易リスト・ドロワーの＋挿入ボタン・sticky計測）
 * へ一括反映する唯一の再描画経路。renderRooms()は内部でViewModelを
 * 再構築する（finish-table-view-model.jsのbuildFinishTableViewModel()）ため、
 * ここで個別に呼ぶ必要はない。
 */
function refreshFromStores() {
  const banner = document.getElementById('finishProjectBanner');
  if (banner) banner.textContent = formatProjectLabel(getState().project);
  renderToolbarState();
  renderRooms();
  renderSimpleList();
  updateDrawerInsertButtonState();
  const root = document.getElementById('finish');
  if (root) updateStickyMetrics(root);
}

/**
 * 他タブからmaterialRecordを更新した場合に、仕上表と簡易リストを
 * 現在のStore内容で再描画する公開入口。
 */
export function refreshFinishTableFromStores() {
  refreshFromStores();
}

/** 案件切替時にUndo/Redoと編集中状態を新案件向けに初期化する。 */
export function resetFinishTableForProject() {
  pendingEditSnapshot = null;
  pendingEditBeforeValue = null;
  explicitlyCommittedInputKey = null;
  resetHistory();
  updateUndoRedoButtons();
}

/**
 * 操作バー・簡易リストの高さ変化を監視し、sticky位置（renderer側のCSS変数）へ
 * 反映する。簡易リストの開閉・チップ数増減・画面幅変更のいずれでも高さが
 * 変わり得るため、固定pxで決め打ちせずResizeObserverで実測する。
 *
 * @param {HTMLElement} root #finish セクション要素
 */
function setupStickyMetrics(root) {
  updateStickyMetrics(root);

  const toolbar = root.querySelector('.finish-toolbar');
  const list = root.querySelector('.finish-simple-list-panel');
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => updateStickyMetrics(root));
    if (toolbar) observer.observe(toolbar);
    if (list) observer.observe(list);
  }
  window.addEventListener('resize', () => updateStickyMetrics(root));
}

/**
 * 操作パネル（ドロワー）内の仕上表用ボタンを配線する。
 * src/js/ui/drawer.js（開閉ロジック）は一切変更しない。
 */
function bindDrawerFinishTools() {
  document.getElementById('drawerAddBasementFloor')?.addEventListener('click', () => {
    scrollToAddedFloor(withHistory(() => addBasementFloor()));
  });
  document.getElementById('drawerAddNormalFloor')?.addEventListener('click', () => {
    scrollToAddedFloor(withHistory(() => addNormalFloor()));
  });
  document.getElementById('drawerAddStairs')?.addEventListener('click', () => {
    scrollToAddedFloor(withHistory(() => addStairs()));
  });
  document.getElementById('drawerAddRoof')?.addEventListener('click', () => {
    scrollToAddedFloor(withHistory(() => addRoof()));
  });
  document.getElementById('drawerInsertRoom')?.addEventListener('click', () => {
    const key = getSelectedRoomKey();
    if (key) withHistory(() => addRoomAfter(key));
  });
  updateDrawerInsertButtonState();
}

/**
 * 操作パネルから階を追加した直後、その階見出しまで仕上表の縦スクロールだけを移動する。
 * ドロワー自体は閉じない。スクロール対象は既存の data-floor-key を使い、
 * 新しい階識別DOMや一時ハイライトは追加しない。
 */
function scrollToAddedFloor(floorKey) {
  if (!floorKey) return;

  requestAnimationFrame(() => {
    const scrollHost = document.getElementById('finishTableScroll');
    if (!scrollHost) return;

    const target = Array.from(scrollHost.querySelectorAll('.finish-floor-heading[data-floor-key]'))
      .find((element) => element.dataset.floorKey === String(floorKey));
    if (!target) return;

    const hostRect = scrollHost.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = Math.max(0, scrollHost.scrollTop + targetRect.top - hostRect.top);
    scrollHost.scrollTo({ top, behavior: 'smooth' });
  });
}

/**
 * ドロワーの「＋挿入」は当面の保留機能。
 * 挿入ロジック本体は残すが、現行運用では常時押せない状態に固定する。
 */
function updateDrawerInsertButtonState() {
  const button = document.getElementById('drawerInsertRoom');
  if (button) button.disabled = true;
}

/** 「戻る／進む」ボタンを配線する。コピー専用の「戻す」とは別の履歴。 */
function bindUndoRedoButtons() {
  document.getElementById('finishUndoBtn')?.addEventListener('click', () => {
    const restored = popUndo(getUndoableSnapshot());
    if (restored) restoreUndoableSnapshot(restored);
    updateUndoRedoButtons();
  });
  document.getElementById('finishRedoBtn')?.addEventListener('click', () => {
    const restored = popRedo(getUndoableSnapshot());
    if (restored) restoreUndoableSnapshot(restored);
    updateUndoRedoButtons();
  });
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('finishUndoBtn');
  const redoBtn = document.getElementById('finishRedoBtn');
  if (undoBtn) undoBtn.disabled = !canUndo();
  if (redoBtn) redoBtn.disabled = !canRedo();
}

/**
 * Undo/Redo対象のスナップショットを組み立てる。対象はfinishRecordStore／
 * materialRecordStoreの内容だけ（UI専用状態・階折りたたみ・部屋コピーの
 * 進行状態は対象外。v0.1.4までと同じ方針）。
 */
function getUndoableSnapshot() {
  return {
    finish: finishRecordStore.exportSnapshot(),
    material: materialRecordStore.exportSnapshot()
  };
}

/**
 * getUndoableSnapshot()で取得したスナップショットへ両Storeを復元する。
 * runRecordTransaction()では両Storeの更新通知をbatch()でまとめる。
 * この仕上表自身は従来どおり復元完了後にrefreshFromStores()を1回だけ呼ぶ。
 * replaceAll()も通常通知を使い、外部ViewはStore.subscribe()だけで更新へ追従する。
 * 仕上表自身は従来どおり直後のrefreshFromStores()で1回だけ確定描画する。
 */
function restoreUndoableSnapshot(snapshot) {
  if (!snapshot) return;
  runRecordTransaction(() => {
    finishRecordStore.replaceAll(snapshot.finish);
    materialRecordStore.replaceAll(snapshot.material);
  });
  refreshFromStores();
}

/**
 * Undo/Redo対象の操作を、操作前スナップショットの記録とセットで実行する。
 * mutate自体はrunRecordTransaction()でくるみ、Store通知はbatch()でまとめる。
 * 実行後に仕上表自身はrefreshFromStores()を1回だけ呼ぶ。
 *
 * @param {() => any} mutate 実際にfinishRecordStore／materialRecordStoreを
 *   変更する処理（finish-table-actions.jsの関数を呼ぶ）
 * @returns {any} mutateの戻り値。階追加時は追加した既存floorGroupKeyを表示処理へ渡す。
 */
function withHistory(mutate) {
  const before = getUndoableSnapshot();
  let result;
  runRecordTransaction(() => {
    result = mutate();
  });
  recordHistory(before);
  updateUndoRedoButtons();
  refreshFromStores();
  return result;
}

/**
 * Undo/Redo履歴には積まない（finalizePendingEdit側が別途判定して積む、
 * または階折りたたみのように積む必要がない）Store書き込みのための、
 * withHistory()の対にあたる軽量版。runRecordTransaction()でまとめ、
 * refreshFromStores()を1回だけ呼ぶ。
 *
 * @param {() => void} mutate
 */
function commitAndRefresh(mutate) {
  runRecordTransaction(mutate);
  refreshFromStores();
}

/**
 * 文字入力の確定処理。focusinで保存しておいた「編集前スナップショット・
 * 編集前の値」と、確定時の値を比較し、変わっていた場合だけ1操作として
 * 履歴へ積む（1文字ごとには積まない）。
 *
 * @param {string} currentValue 確定時点の入力欄の値
 */
function finalizePendingEdit(currentValue) {
  if (pendingEditSnapshot && currentValue !== pendingEditBeforeValue) {
    recordHistory(pendingEditSnapshot);
    updateUndoRedoButtons();
  }
  pendingEditSnapshot = null;
  pendingEditBeforeValue = null;
}

/** セルの未登録名（pending名）を管理する際に使うキー。finish-table-view-model.jsのpendingKeyと同じ形式。 */
function cellPendingKey(roomKeyValue, partIndex, row) {
  return `${roomKeyValue}|${partIndex}|${row}`;
}

function bindEvents(root) {
  if (root.dataset.finishEventsBound === '1') return;
  root.dataset.finishEventsBound = '1';

  /*
   * Apple Pencil / Scribble対策。
   *
   * Pencilを禁止するのではなく、単純タップとドラッグを判別する。
   * ・単純タップ：指・マウスと同じ通常操作へ流す（選択／文字入力／チップ入力）。
   * ・ドラッグ：スクロールとして扱い、span→input化などの編集開始を行わない。
   *
   * 通常表示では編集欄をspanにしているため、スクロール中にScribbleが反応する
   * inputを作らない。Pencilタップ時だけpointerupで通常操作を直接実行し、
   * その直後にSafariが生成するclickは1回だけ抑止して二重実行を防ぐ。
   */
  const PEN_DRAG_THRESHOLD_PX = 12;
  const PEN_CLICK_SUPPRESS_MS = 500;
  let penPointer = null;
  let ignoreNextPenClick = false;
  let ignorePenClickUntil = 0;

  function handleFinishActivation(target) {
    const candidateButton = target.closest('[data-candidate-index]');
    if (candidateButton && activeCandidateInput) {
      const option = activeCandidateOptions[Number(candidateButton.dataset.candidateIndex)];
      if (option) commitCandidateSelection(option, activeCandidateInput);
      return;
    }

    const areaButton = target.closest('.finish-area-btn');
    if (areaButton) {
      setAreaMode(areaButton.dataset.areaMode);
      return;
    }

    if (target.closest('#finishColorToggleBtn')) {
      toggleColorMode();
      return;
    }

    if (target.closest('#finishChipInputToggleBtn')) {
      toggleChipInputMode();
      return;
    }

    if (target.closest('#finishSimpleListToggleBtn')) {
      toggleSimpleListOpen();
      return;
    }

    // 階見出し行の開閉：行全体をタップ判定にする（見た目のボタンは小さくても、
    // 行の横幅ぶんの当たり判定を確保するため）。表示だけの操作のため、
    // Undo/Redo履歴には積まない。
    const floorHeading = target.closest('.finish-floor-heading');
    if (floorHeading) {
      toggleFloorCollapsed(floorHeading.dataset.floorKey);
      return;
    }

    // ID欄の「登録」ボタン：未登録の建材名称を、押下されたときだけ新規登録する。
    // materialRecordStore（新規建材）とfinishRecordStore（対象セルの紐付け）の
    // 両方を書き換えるため、Undo/Redo対象として履歴へ積む
    // （v0.1.5.1より前は対象外だったが、指示に従いここから対象化した）。
    const registerButton = target.closest('[data-action="register-material"]');
    if (registerButton) {
      const roomKeyValue = registerButton.dataset.roomKey;
      const partIndex = Number(registerButton.dataset.partIndex);
      const row = Number(registerButton.dataset.inputRow);
      const pendingKey = cellPendingKey(roomKeyValue, partIndex, row);
      const editingNameInput = [...root.querySelectorAll('.finish-name-input')].find((input) =>
        input.dataset.roomKey === roomKeyValue
        && Number(input.dataset.partIndex) === partIndex
        && Number(input.dataset.inputRow) === row
      );
      const pendingName = String(editingNameInput?.value || getPendingCellName(pendingKey) || '').trim();
      if (pendingName && editingNameInput) {
        completeCellEdit(editingNameInput, () => {
          registerMaterialForCell(roomKeyValue, partIndex, row, pendingName);
          clearPendingCellName(pendingKey);
        });
        // 「登録」ボタンは新規建材登録の完了操作。部位が未入力なら登録処理内で
        // 「その他」まで確定するため、ここでは部位へ自動移動しない。
      }
      return;
    }

    // 部屋コピーボタン：確認ダイアログが必要な場合は非同期で処理する。
    const copyButton = target.closest('[data-action="copy-room"]');
    if (copyButton) {
      handleCopyRoomClick(copyButton.dataset.roomKey);
      return;
    }

    const actionButton = target.closest('[data-action]');
    if (actionButton) {
      if (handleAction(actionButton)) return;
    }

    const dataCell = target.closest('.finish-data-cell');
    if (dataCell) {
      // 入力デバイスに関係なく、先に部屋・入力グループの選択状態を確定する。
      setSelectedRoomKey(dataCell.dataset.roomKey);
      setSelectedGroupKey(dataCell.dataset.groupKey);
      updateDrawerInsertButtonState();

      // チップ入力ON＋建材選択中なら、クリックした入力グループへ建材を反映。
      // 対象欄は表示専用<span>・編集中<input>のどちらの場合もあるため、
      // どちらのクラスも対象にする共通セレクタで探す。
      if (getChipInputMode()) {
        const inputId = getSelectedMaterialInputId();
        const material = inputId != null ? materialRecordStore.findByInputId(inputId) : undefined;
        if (material) {
          const field = dataCell.querySelector('.finish-cell-display, .finish-cell-input');
          if (field) {
            const roomKeyValue = field.dataset.roomKey;
            const partIndex = Number(field.dataset.partIndex);
            const row = Number(field.dataset.inputRow);
            const pendingKey = cellPendingKey(roomKeyValue, partIndex, row);
            const currentRecord = finishRecordStore.get(dataCell.dataset.finishId || '');
            const currentMaterialId = String(currentRecord?.materialId || '');
            const currentInputId = String(currentRecord?.inputId || '');
            const pendingName = String(getPendingCellName(pendingKey) || '').trim();
            const selectedMaterialId = String(material.materialId || '');
            const cellIsEmpty = !currentMaterialId && !currentInputId && !pendingName;

            // チップ入力は「空欄へ入力 / 同じ建材なら解除 / 別建材なら保護」の3分岐。
            // 判定は名称ではなくmaterialIdで行い、別建材を誤上書きしない。
            if (cellIsEmpty) {
              withHistory(() => applyMaterialToCell(roomKeyValue, partIndex, row, material));
              clearPendingCellName(pendingKey);
              return;
            }

            if (currentMaterialId && currentMaterialId === selectedMaterialId) {
              // 削除専用の新経路は作らず、既存の正式な空ID確定処理を使う。
              withHistory(() => commitCellId(roomKeyValue, partIndex, row, ''));
              clearPendingCellName(pendingKey);
              return;
            }

            // 別materialId、未登録ID、未確定名称が既にあるセルは変更しない。
            return;
          }
        }
      }

      // 通常のセル選択：表示専用<span>をタップした場合だけ<input>へ
      // 差し替えてfocus()する。focus()が同期的に
      // 発火させるfocusinイベントを、下のfocusinハンドラがそのまま処理し、
      // 部屋・入力グループ選択／フォーカス枠／Undo用スナップショットの
      // 記録までを一括して行う。
      const displaySpan = target.closest('.finish-cell-display');
      if (displaySpan) {
        const input = swapDisplayToInput(displaySpan);
        if (input) input.focus();
      } else {
        // 既にinput化されている欄（編集中）をクリックした場合は、部屋・
        // 入力グループの表示だけ軽量に再適用する（仕上表全体は再描画しない）。
        applyRoomSelection();
        applyGroupSelection();
      }
      return;
    }

    // 部屋No./部屋名欄：表示専用<span>をタップした場合だけ<input>へ
    // 差し替える（dataCellと同じ理由・同じ仕組み）。この欄は
    // .finish-room-block[data-room-key] の内側にあるため、下のroomBlock分岐で
    // 部屋選択も行われる（従来と同じ操作意味を維持する）。
    const roomFieldDisplay = target.closest('.room-no-cell .finish-cell-display, .room-name-cell .finish-cell-display');
    if (roomFieldDisplay) {
      // spanをinputへ差し替える前に部屋選択を確定する。
      setSelectedRoomKey(roomFieldDisplay.dataset.roomKey);
      updateDrawerInsertButtonState();
      applyRoomSelection();

      const input = swapDisplayToInput(roomFieldDisplay);
      if (input) input.focus();
      return;
    }

    const roomBlock = target.closest('.finish-room-block[data-room-key]');
    if (roomBlock) {
      setSelectedRoomKey(roomBlock.dataset.roomKey);
      updateDrawerInsertButtonState();
      applyRoomSelection();
    }
  }

  // 候補／登録ボタンを押した瞬間に編集中inputがblurしてDOMが再描画されるのを防ぐ。
  // pointerup/click側で確定処理を行うため、指・Pencilとも押下中はfocusを維持する。
  root.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-candidate-index], [data-action="register-material"]')) {
      event.preventDefault();
    }
  }, { passive: false });

  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'pen') return;

    const scrollHost = event.target.closest('.finish-table-scroll');
    penPointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target: event.target,
      dragged: false,
      scrollHost,
      startScrollLeft: scrollHost ? scrollHost.scrollLeft : 0,
      startScrollTop: scrollHost ? scrollHost.scrollTop : 0
    };

    // 新しいPencil操作が始まったら、前回操作のclick抑止状態は破棄する。
    ignoreNextPenClick = false;
    ignorePenClickUntil = 0;
  }, { passive: true });

  root.addEventListener('pointermove', (event) => {
    if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;

    const dx = event.clientX - penPointer.startX;
    const dy = event.clientY - penPointer.startY;
    if (Math.hypot(dx, dy) >= PEN_DRAG_THRESHOLD_PX) {
      penPointer.dragged = true;
    }
  }, { passive: true });

  root.addEventListener('pointerup', (event) => {
    if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;

    const gesture = penPointer;
    penPointer = null;

    const scrollMoved = Boolean(
      gesture.scrollHost && (
        gesture.scrollHost.scrollLeft !== gesture.startScrollLeft ||
        gesture.scrollHost.scrollTop !== gesture.startScrollTop
      )
    );
    const wasDrag = gesture.dragged || scrollMoved;

    // Safariがpointerup後に生成するclickは、タップ・ドラッグのどちらでも
    // この1操作分だけ無視する。タップ処理はここで直接1回だけ実行する。
    ignoreNextPenClick = true;
    ignorePenClickUntil = performance.now() + PEN_CLICK_SUPPRESS_MS;

    if (wasDrag) return;

    handleFinishActivation(gesture.target);
  }, { passive: true });

  root.addEventListener('pointercancel', (event) => {
    if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;

    penPointer = null;
    ignoreNextPenClick = true;
    ignorePenClickUntil = performance.now() + PEN_CLICK_SUPPRESS_MS;
  }, { passive: true });

  root.addEventListener('click', (event) => {
    if (ignoreNextPenClick && performance.now() <= ignorePenClickUntil) {
      ignoreNextPenClick = false;
      ignorePenClickUntil = 0;
      return;
    }

    ignoreNextPenClick = false;
    ignorePenClickUntil = 0;
    handleFinishActivation(event.target);
  });

  root.addEventListener('focusin', (event) => {
    // 部屋No./部屋名：編集前の値をUndo/Redo用に控えておくほか、
    // 表示span⇔input切り替えの判定に使うfocusedInputKeyも設定する
    // （data系セルのinputKeyと衝突しない別形式のroomFieldKeyを共用する。
    // finish-table-view-model.jsのroomFieldKey()を参照）。
    const roomNoInput = event.target.closest('.room-no-input');
    const roomNameInput = event.target.closest('.room-name-input');
    if (roomNoInput || roomNameInput) {
      const input = roomNoInput || roomNameInput;
      setFocusedInputKey(input.dataset.fieldKey);
      applyFocusedInputHighlight();
      pendingEditSnapshot = getUndoableSnapshot();
      pendingEditBeforeValue = input.value;
      return;
    }

    const input = event.target.closest('.finish-cell-input');
    if (!input) return;

    // v0.1.5.4B: 編集セル直下へ案件内Record + 設定候補のポップを表示する。
    updateFinishInputCandidates(input);
    if (input.dataset.kind === 'name') syncDynamicRegisterButton(input);

    const td = input.closest('.finish-data-cell');
    if (!td) return;

    setSelectedRoomKey(input.dataset.roomKey);
    setSelectedGroupKey(td.dataset.groupKey);
    setFocusedInputKey(input.dataset.inputKey);
    updateDrawerInsertButtonState();

    // セル選択・フォーカス移動では、部屋選択・入力グループ選択・
    // フォーカス枠だけを更新する（建材一致判定＝全セル走査は行わない）。
    applyRoomSelection();
    applyGroupSelection();
    applyFocusedInputHighlight();

    pendingEditSnapshot = getUndoableSnapshot();
    pendingEditBeforeValue = input.value;
  });

  root.addEventListener('input', (event) => {
    const input = event.target.closest('.finish-cell-input');
    if (!input) return;

    if (input.dataset.kind === 'name' || input.dataset.kind === 'part') {
      renderCandidatePopup(input);
    }
    if (input.dataset.kind === 'name') {
      syncDynamicRegisterButton(input);
    }
  });

  // 候補ポップ自身のスクロールでは閉じない。仕上表側を動かした場合だけ閉じる。
  root.addEventListener('scroll', (event) => {
    if (event.target?.closest?.('#finishCandidatePopup')) return;
    closeCandidatePopup();
  }, true);

  // その他1/2ではEnter確定でも「建材名 <-> 部位」を往復できるようにする。
  // 通常のfocusoutでは移動させず、明示的にEnterを押した場合だけ適用する。
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('.finish-cell-input');
    if (!input || !['name', 'part'].includes(input.dataset.kind)) return;

    const partIndex = Number(input.dataset.partIndex);
    if (partIndex < 5) return;

    event.preventDefault();
    const roomKeyValue = input.dataset.roomKey;
    const row = Number(input.dataset.inputRow);
    const pendingKey = cellPendingKey(roomKeyValue, partIndex, row);

    if (input.dataset.kind === 'name') {
      const value = input.value;
      completeCellEdit(input, () => {
        const material = commitCellName(roomKeyValue, partIndex, row, value);
        if (material) clearPendingCellName(pendingKey);
        else setPendingCellName(pendingKey, value.trim());
      });
      focusOtherCompanionField(roomKeyValue, partIndex, row, 'part');
      return;
    }

    const value = input.value;
    completeCellEdit(input, () => commitCellActualPart(roomKeyValue, partIndex, row, value));
    focusOtherCompanionField(roomKeyValue, partIndex, row, 'name');
  });

  root.addEventListener('focusout', (event) => {
    const roomNoInput = event.target.closest('.room-no-input');
    const roomNameInput = event.target.closest('.room-name-input');
    if (roomNoInput || roomNameInput) {
      const input = roomNoInput || roomNameInput;
      finalizePendingEdit(input.value);
      setFocusedInputKey(null);
      commitAndRefresh(() => commitRoomField(input.dataset.roomKey, input.dataset.field, input.value));
      return;
    }

    const input = event.target.closest('.finish-cell-input');
    if (!input) return;

    // 候補選択／登録ですでに明示確定済みなら、DOM差し替え由来のfocusoutでは
    // Storeを書き直さない。PC/iPadでfocusout順が違っても結果を同一にする。
    if (consumeExplicitCommit(input)) {
      if (activeCandidateInput === input) closeCandidatePopup();
      restoreDynamicRegisterButton(input);
      return;
    }

    if (activeCandidateInput === input) closeCandidatePopup();
    if (input.dataset.kind === 'name') restoreDynamicRegisterButton(input);

    // 値が変わっていれば、実際の確定処理より先に履歴を積む
    // （記録するのは「確定前」の状態にするため）。
    finalizePendingEdit(input.value);
    setFocusedInputKey(null);

    const roomKeyValue = input.dataset.roomKey;
    const partIndex = Number(input.dataset.partIndex);
    const row = Number(input.dataset.inputRow);
    const pendingKey = cellPendingKey(roomKeyValue, partIndex, row);

    if (input.dataset.kind === 'id') {
      let material = null;
      commitAndRefresh(() => {
        material = commitCellId(roomKeyValue, partIndex, row, input.value);
        if (material) clearPendingCellName(pendingKey);
        else if (input.value.trim()) input.title = '登録済みの入力IDではありません';
      });

      // その他1/2で、入力IDから解決した建材が複数部位を持つ場合だけ、
      // 建材名は確定したまま部位欄へ移動してユーザーに実部位を選ばせる。
      if (partIndex >= 5 && material && getMaterialPartOptions(material).length > 1) {
        focusOtherCompanionField(roomKeyValue, partIndex, row, 'part');
      }
    } else if (input.dataset.kind === 'name') {
      commitAndRefresh(() => {
        // 未登録名は自動登録しない。未登録のままならID欄に「登録」ボタンが出る
        // （表示名はfinishRecordへ保持せず、pending名としてUI専用状態が持つ）。
        const material = commitCellName(roomKeyValue, partIndex, row, input.value);
        if (material) clearPendingCellName(pendingKey);
        else setPendingCellName(pendingKey, input.value.trim());
      });
    } else if (input.dataset.kind === 'part') {
      commitAndRefresh(() => commitCellActualPart(roomKeyValue, partIndex, row, input.value));
    }
  });
}

/**
 * 部屋コピーボタンのクリックを処理する。
 *
 * @param {string} roomKeyValue
 */
async function handleCopyRoomClick(roomKeyValue) {
  const info = describeRoomCopyClick(getRoomCopyState(), roomKeyValue);

  if (info.type === 'become-source') {
    startRoomCopySource(roomKeyValue);
    return;
  }
  if (info.type === 'cancel-source') {
    cancelRoomCopySource();
    return;
  }
  if (info.type === 'restore') {
    // コピー専用の「戻す」。仕上表全体のUndo/Redo（戻る/進む）とは別物のため、
    // ここではwithHistory()を使わない。
    const backup = getRoomCopyBackup(roomKeyValue);
    if (backup) commitAndRefresh(() => restoreRoomCopy(roomKeyValue, backup));
    clearRoomCopyBackup(roomKeyValue);
    return;
  }
  if (info.type !== 'copy') return;

  if (info.crossFamily) {
    const confirmed = await showFinishConfirm(
      '内部・外部をまたいでコピーします。',
      'コピーする'
    );
    if (!confirmed) return;
  }

  if (info.overwrite) {
    const confirmed = await showFinishConfirm(
      'この部屋にはすでに入力があります。\n現在の内容を上書きします。',
      '上書きする'
    );
    if (!confirmed) return;
  }

  const sourceKey = getRoomCopyState().sourceRoomKey;
  // コピー実行前の状態をバックアップとして記録する（「戻す」用。
  // バックアップの取得元はfinishRecordStore＝finish-table-actions.jsの
  // snapshotRoomRecords()）。
  recordRoomCopyBackup(roomKeyValue, snapshotRoomRecords(roomKeyValue));
  withHistory(() => executeRoomCopy(sourceKey, roomKeyValue));
}

function handleAction(button) {
  switch (button.dataset.action) {
    case 'add-normal-floor':
      withHistory(() => addNormalFloor());
      return true;
    case 'add-basement-floor':
      withHistory(() => addBasementFloor());
      return true;
    case 'add-stairs':
      withHistory(() => addStairs());
      return true;
    case 'add-roof':
      withHistory(() => addRoof());
      return true;
    case 'add-external-room':
      withHistory(() => addExternalRoom());
      return true;
    case 'add-row':
      withHistory(() => addInputRow(button.dataset.roomKey));
      return true;
    case 'add-room': {
      if (button.dataset.floorKey && !button.dataset.floorKey.includes('group')) {
        withHistory(() => addRoomToFloor(button.dataset.floorKey));
      } else {
        withHistory(() => addRoomAfter(button.dataset.roomKey));
      }
      return true;
    }
    default:
      return false;
  }
}
