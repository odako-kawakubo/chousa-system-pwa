/**
 * src/js/finish-table/finish-table-interactions.js
 *
 * 仕上表本体のDOMイベントと直接操作を担当する。
 * click / Pencil / focus / input / keydown / scroll / チップ入力をここへ集約し、
 * controllerは初期化・履歴・再描画・部屋コピー等の司令塔に限定する。
 */

import {
  setAreaMode,
  setSelectedRoomKey,
  setSelectedGroupKey,
  setFocusedInputKey,
  toggleColorMode,
  toggleChipInputMode,
  getChipInputMode,
  getChipInputMaterialInputId,
  toggleSimpleListOpen,
  toggleFloorCollapsed,
  setPendingCellName,
  clearPendingCellName,
  getPendingCellName
} from './finish-table-state.js';
import {
  commitRoomField,
  commitCellId,
  commitCellName,
  commitCellActualPart,
  applyMaterialToCell,
  registerMaterialForCell,
  getMaterialPartOptions,
  runRecordTransaction,
  refreshMaterialUsageDerivedFields,
  finishRecordStore,
  materialRecordStore
} from './finish-table-actions.js';
import {
  applyRoomSelection,
  applyGroupSelection,
  applyFocusedInputHighlight,
  swapDisplayToInput
} from './finish-table-renderer.js';
import {
  closeCandidatePopup,
  renderCandidatePopup,
  updateFinishInputCandidates,
  restoreDynamicRegisterButton,
  syncDynamicRegisterButton,
  getActiveCandidateSelection,
  isActiveCandidateInput
} from './finish-table-candidate-input.js';
import {
  beginFinishEdit,
  consumeExplicitCommit,
  completeCellEdit,
  finalizePendingEdit
} from './finish-table-edit-session.js';

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

function cellPendingKey(roomKeyValue, partIndex, row) {
  return `${roomKeyValue}|${partIndex}|${row}`;
}

export function bindFinishTableInteractions(root, {
  withHistory,
  commitAndRefresh,
  getUndoableSnapshot,
  handleCopyRoomClick,
  handleAction,
  updateDrawerInsertButtonState
} = {}) {
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
    if (candidateButton) {
      const selection = getActiveCandidateSelection(candidateButton.dataset.candidateIndex);
      if (selection) commitCandidateSelection(selection.option, selection.input);
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

      // チップ入力は「モードON」と「入力ターゲット選択済み」の両方が揃った時だけ実行する。
      // 簡易リストの通常参照 selectedMaterialInputId はここでは参照しない。
      // 対象欄は表示専用<span>・編集中<input>のどちらの場合もあるため、
      // どちらのクラスも対象にする共通セレクタで探す。
      if (getChipInputMode()) {
        const inputId = getChipInputMaterialInputId();
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
      beginFinishEdit(input, getUndoableSnapshot());
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

    beginFinishEdit(input, getUndoableSnapshot());
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
      if (isActiveCandidateInput(input)) closeCandidatePopup();
      restoreDynamicRegisterButton(input);
      return;
    }

    if (isActiveCandidateInput(input)) closeCandidatePopup();
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
