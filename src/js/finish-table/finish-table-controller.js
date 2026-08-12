/**
 * src/js/finish-table/finish-table-controller.js
 *
 * 仕上表のイベント配線とユーザー操作の入口を担当する。
 * DOM描画はrenderer、状態更新はstate、簡易リストはsimple-list、履歴はhistoryへ分離する。
 *
 * 現在の表構造は「1個の2Dスクロール領域 + 部屋単位の左固定ペイン」。
 * Apple Pencilは単純タップを通常操作として扱い、ドラッグ時だけ編集開始を抑止する。
 */

import {
  initFinishTableState,
  subscribe,
  setAreaMode,
  addNormalFloor,
  addBasementFloor,
  addStairs,
  addRoof,
  addExternalRoom,
  addRoomToFloor,
  addRoomAfter,
  addInputRow,
  updateRoomNo,
  updateRoomName,
  findRoomByKey,
  setCellDraftInputId,
  setCellDraftName,
  setCellActualPart,
  commitCellInputId,
  commitCellMaterialName,
  registerCellMaterial,
  setSelectedRoomKey,
  getSelectedRoomKey,
  setSelectedGroupKey,
  setFocusedInputKey,
  getSelectedMaterialInputId,
  findMaterialByInputId,
  applyMaterialToCell,
  toggleColorMode,
  toggleChipInputMode,
  getChipInputMode,
  toggleSimpleListOpen,
  toggleFloorCollapsed,
  describeRoomCopyClick,
  startRoomCopySource,
  cancelRoomCopySource,
  restoreRoomCopy,
  executeRoomCopy,
  getUndoableSnapshot,
  restoreUndoableSnapshot
} from './finish-table-state.js';
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

/** フォーカス中の文字入力について、編集開始前のスナップショットと値を覚えておく。 */
let pendingEditSnapshot = null;
let pendingEditBeforeValue = null;

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
  // state側でnotifyされた変更は、構造・操作列・簡易リストを一貫して再描画する。
  // renderRooms()が内部で全種類の選択表示を再適用するため、ここで個別関数を
  // 重ねて呼ぶ必要はない。
  subscribe(() => {
    renderToolbarState();
    renderRooms();
    renderSimpleList();
    updateDrawerInsertButtonState();
    updateStickyMetrics(finishSection);
  });
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
    withHistory(() => addBasementFloor());
  });
  document.getElementById('drawerAddStairs')?.addEventListener('click', () => {
    withHistory(() => addStairs());
  });
  document.getElementById('drawerAddRoof')?.addEventListener('click', () => {
    withHistory(() => addRoof());
  });
  document.getElementById('drawerInsertRoom')?.addEventListener('click', () => {
    const key = getSelectedRoomKey();
    if (key) withHistory(() => addRoomAfter(key));
  });
  updateDrawerInsertButtonState();
}

/** ドロワーの「＋挿入」は、部屋が選択されていない間は無効化する。 */
function updateDrawerInsertButtonState() {
  const button = document.getElementById('drawerInsertRoom');
  if (button) button.disabled = !getSelectedRoomKey();
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
 * Undo/Redo対象の操作を、操作前スナップショットの記録とセットで実行する。
 *
 * @param {() => void} mutate 実際に状態を変更する処理
 */
function withHistory(mutate) {
  const before = getUndoableSnapshot();
  mutate();
  recordHistory(before);
  updateUndoRedoButtons();
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
    // 新規建材登録はUndo/Redoの対象外（withHistoryを使わない）。
    const registerButton = target.closest('[data-action="register-material"]');
    if (registerButton) {
      const room = findRoomByKey(registerButton.dataset.roomKey);
      if (room) {
        registerCellMaterial(
          room,
          Number(registerButton.dataset.partIndex),
          Number(registerButton.dataset.inputRow)
        );
        renderRooms();
        renderSimpleList();
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
        const material = inputId != null ? findMaterialByInputId(inputId) : null;
        if (material) {
          const field = dataCell.querySelector('.finish-cell-display, .finish-cell-input') ||
            document.querySelector(`[data-group-key="${CSS.escape(dataCell.dataset.groupKey)}"] .finish-cell-display, [data-group-key="${CSS.escape(dataCell.dataset.groupKey)}"] .finish-cell-input`);
          if (field) {
            const room = findRoomByKey(field.dataset.roomKey);
            if (room) {
              withHistory(() => {
                applyMaterialToCell(room, Number(field.dataset.partIndex), Number(field.dataset.inputRow), material);
              });
              renderRooms();
              renderSimpleList();
              return;
            }
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
    // finish-table-state.jsのroomFieldKey()を参照）。
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

  root.addEventListener('focusout', (event) => {
    const roomNoInput = event.target.closest('.room-no-input');
    const roomNameInput = event.target.closest('.room-name-input');
    if (roomNoInput || roomNameInput) {
      const input = roomNoInput || roomNameInput;
      finalizePendingEdit(input.value);
      setFocusedInputKey(null);
      // renderRooms()が、focusedInputKeyと一致しなくなったこの欄を
      // 編集終了後は再描画で表示専用<span>へ戻す。
      renderRooms();
      renderSimpleList();
      return;
    }

    const input = event.target.closest('.finish-cell-input');
    if (!input) return;

    // 値が変わっていれば、実際の確定処理より先に履歴を積む
    // （記録するのは「確定前」の状態にするため）。
    finalizePendingEdit(input.value);

    const room = findRoomByKey(input.dataset.roomKey);
    if (!room) return;
    const partIndex = Number(input.dataset.partIndex);
    const row = Number(input.dataset.inputRow);

    if (input.dataset.kind === 'id') {
      const material = commitCellInputId(room, partIndex, row);
      if (!material && input.value.trim()) input.title = '登録済みの入力IDではありません';
    } else if (input.dataset.kind === 'name') {
      // 未登録名は自動登録しない。未登録のままならID欄に「登録」ボタンが出る。
      commitCellMaterialName(room, partIndex, row);
    }

    setFocusedInputKey(null);
    // renderRooms()は内部で全種類の選択表示を再適用するため、この後に
    // applyVisualState()等を重ねて呼ばず、同じ表示更新を二重実行しない。
    renderRooms();
    renderSimpleList();
  });

  root.addEventListener('input', (event) => {
    const roomNoInput = event.target.closest('.room-no-input');
    if (roomNoInput) {
      updateRoomNo(roomNoInput.dataset.roomKey, roomNoInput.value);
      return;
    }

    const roomNameInput = event.target.closest('.room-name-input');
    if (roomNameInput) {
      updateRoomName(roomNameInput.dataset.roomKey, roomNameInput.value);
      return;
    }

    const input = event.target.closest('.finish-cell-input');
    if (!input) return;
    const room = findRoomByKey(input.dataset.roomKey);
    if (!room) return;

    const partIndex = Number(input.dataset.partIndex);
    const row = Number(input.dataset.inputRow);

    if (input.dataset.kind === 'id') {
      setCellDraftInputId(room, partIndex, row, input.value);
    } else if (input.dataset.kind === 'part') {
      setCellActualPart(room, partIndex, row, input.value);
    } else if (input.dataset.kind === 'name') {
      setCellDraftName(room, partIndex, row, input.value);
    }
  });
}

/**
 * 部屋コピーボタンのクリックを処理する。
 *
 * @param {string} roomKeyValue
 */
async function handleCopyRoomClick(roomKeyValue) {
  const info = describeRoomCopyClick(roomKeyValue);

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
    restoreRoomCopy(roomKeyValue);
    return;
  }
  if (info.type !== 'copy') return;

  if (info.crossFamily) {
    const confirmed = await showFinishConfirm(
      '内部・外部をまたいでコピーします。\nコピーしてよろしいですか？',
      'コピーする'
    );
    if (!confirmed) return;
  }

  if (info.overwrite) {
    const confirmed = await showFinishConfirm(
      'この部屋にはすでに入力があります。\n上書きコピーしますか？',
      '上書きする'
    );
    if (!confirmed) return;
  }

  withHistory(() => executeRoomCopy(roomKeyValue));
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
