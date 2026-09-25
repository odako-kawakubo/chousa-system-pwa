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

import {
  initFinishTableState,
  getState,
  subscribe,
  getSelectedRoomKey,
  getRoomCopyState,
  startRoomCopySource,
  cancelRoomCopySource,
  recordRoomCopyBackup,
  clearRoomCopyBackup,
  getRoomCopyBackup
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

  describeRoomCopyClick,
  executeRoomCopy,
  restoreRoomCopy,
  snapshotRoomRecords,
  runRecordTransaction,
  finishRecordStore,
  materialRecordStore
} from './finish-table-actions.js';
import {
  renderFinishTab,
  renderToolbarState,
  renderRooms,
  showFinishConfirm,
  updateStickyMetrics
} from './finish-table-renderer.js';
import { recordHistory, canUndo, canRedo, popUndo, popRedo, resetHistory } from './finish-table-history.js';
import { initSimpleList, renderSimpleList } from '../materials/simple-list.js';
import {
  configureFinishTableEditSession,
  resetFinishTableEditSession
} from './finish-table-edit-session.js';
import { bindFinishTableInteractions } from './finish-table-interactions.js';




/**
 * その他1/2の「建材名 <-> 部位」入力を往復しやすくする。
 * 明示確定（候補選択／登録／Enter）の後だけ相手セルへ移動し、
 * 単なるblurや別セルタップではユーザーの移動先を奪わない。
 */


export function initializeFinishTable() {
  const finishSection = document.getElementById('finish');
  if (!finishSection) return;

  initFinishTableState();
  resetHistory();
  configureFinishTableEditSession({
    getUndoableSnapshot,
    onHistoryChanged: updateUndoRedoButtons,
    onRefresh: refreshFromStores
  });
  renderFinishTab(finishSection);
  initSimpleList(document.getElementById('finishSimpleListPanel'));
  bindFinishTableInteractions(finishSection, {
    withHistory,
    commitAndRefresh,
    getUndoableSnapshot,
    handleCopyRoomClick,
    handleAction,
    updateDrawerInsertButtonState
  });
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
  resetFinishTableEditSession();
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

/** セルの未登録名（pending名）を管理する際に使うキー。finish-table-view-model.jsのpendingKeyと同じ形式。 */




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
