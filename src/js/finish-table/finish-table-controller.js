/**
 * src/js/finish-table/finish-table-controller.js
 *
 * v0.1.3 仕上表のイベント配線。
 * DOM描画はrenderer、状態更新はstate、簡易リスト描画はsimple-listへ委譲する。
 *
 * v0.1.3の変更点：
 *   1. 部屋コピーのクリックを、確認ダイアログ（上書き／内部外部またぎ）を
 *      経由してから状態を更新する非同期フローへ変更
 *   2. ID欄の「登録」ボタン（未登録建材の明示的な新規登録）を配線
 *   3. ドロワー（操作パネル）内の「＋挿入／＋地下階／＋階段／＋屋上」を配線。
 *      src/js/ui/drawer.jsは一切変更せず、開閉ロジック以外の部分
 *      （src/app.htmlの.drawer-body内マークアップ）にだけイベントを足す。
 *   4. 「＋挿入」はコピー等と同様に、既存の選択状態（selectedRoomKey）を
 *      そのまま利用する（新しい状態は追加していない）
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
  describeRoomCopyClick,
  startRoomCopySource,
  cancelRoomCopySource,
  restoreRoomCopy,
  executeRoomCopy
} from './finish-table-state.js';
import {
  renderFinishTab,
  renderToolbarState,
  renderRooms,
  applyVisualState,
  showFinishConfirm
} from './finish-table-renderer.js';
import { initSimpleList, renderSimpleList } from '../materials/simple-list.js';

export function initializeFinishTable() {
  const finishSection = document.getElementById('finish');
  if (!finishSection) return;

  initFinishTableState();
  renderFinishTab(finishSection);
  initSimpleList(document.getElementById('finishSimpleListPanel'));
  bindEvents(finishSection);
  bindDrawerFinishTools();

  // state側でnotifyされた変更は、構造・操作列・簡易リストを一貫して再描画する。
  subscribe(() => {
    renderToolbarState();
    renderRooms();
    renderSimpleList();
    applyVisualState();
    updateDrawerInsertButtonState();
  });
}

/**
 * 操作パネル（ドロワー）内の仕上表用ボタンを配線する。
 * src/js/ui/drawer.js（開閉ロジック）は一切変更しない。ここではボタンの
 * クリック処理だけを追加する。対象ボタンはsrc/app.htmlの.drawer-body内。
 */
function bindDrawerFinishTools() {
  document.getElementById('drawerAddBasementFloor')?.addEventListener('click', () => {
    addBasementFloor();
  });
  document.getElementById('drawerAddStairs')?.addEventListener('click', () => {
    addStairs();
  });
  document.getElementById('drawerAddRoof')?.addEventListener('click', () => {
    addRoof();
  });
  document.getElementById('drawerInsertRoom')?.addEventListener('click', () => {
    // 「現在選択中の部屋」は新しい状態を作らず、既存のselectedRoomKeyをそのまま使う。
    const key = getSelectedRoomKey();
    if (key) addRoomAfter(key);
  });
  updateDrawerInsertButtonState();
}

/** ドロワーの「＋挿入」は、部屋が選択されていない間は無効化する。 */
function updateDrawerInsertButtonState() {
  const button = document.getElementById('drawerInsertRoom');
  if (button) button.disabled = !getSelectedRoomKey();
}

function bindEvents(root) {
  if (root.dataset.finishEventsBound === '1') return;
  root.dataset.finishEventsBound = '1';

  root.addEventListener('click', (event) => {
    const areaButton = event.target.closest('.finish-area-btn');
    if (areaButton) {
      setAreaMode(areaButton.dataset.areaMode);
      return;
    }

    if (event.target.closest('#finishColorToggleBtn')) {
      toggleColorMode();
      return;
    }

    if (event.target.closest('#finishChipInputToggleBtn')) {
      toggleChipInputMode();
      return;
    }

    if (event.target.closest('#finishSimpleListToggleBtn')) {
      toggleSimpleListOpen();
      return;
    }

    // ID欄の「登録」ボタン：未登録の建材名称を、押下されたときだけ新規登録する。
    const registerButton = event.target.closest('[data-action="register-material"]');
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
        applyVisualState();
      }
      return;
    }

    // 部屋コピーボタン：確認ダイアログが必要な場合は非同期で処理する。
    const copyButton = event.target.closest('[data-action="copy-room"]');
    if (copyButton) {
      handleCopyRoomClick(copyButton.dataset.roomKey);
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      if (handleAction(actionButton)) return;
    }

    const dataCell = event.target.closest('.finish-data-cell');
    if (dataCell) {
      setSelectedRoomKey(dataCell.dataset.roomKey);
      setSelectedGroupKey(dataCell.dataset.groupKey);
      updateDrawerInsertButtonState();

      // チップ入力ON＋建材選択中なら、クリックした入力グループへ建材を反映。
      if (getChipInputMode()) {
        const inputId = getSelectedMaterialInputId();
        const material = inputId != null ? findMaterialByInputId(inputId) : null;
        if (material) {
          const input = dataCell.querySelector('.finish-cell-input') ||
            document.querySelector(`[data-group-key="${CSS.escape(dataCell.dataset.groupKey)}"] .finish-cell-input`);
          if (input) {
            const room = findRoomByKey(input.dataset.roomKey);
            if (room) {
              applyMaterialToCell(room, Number(input.dataset.partIndex), Number(input.dataset.inputRow), material);
              renderRooms();
              renderSimpleList();
              applyVisualState();
            }
          }
        }
      }

      applyVisualState();
      return;
    }

    const roomRow = event.target.closest('tr[data-room-key]');
    if (roomRow) {
      setSelectedRoomKey(roomRow.dataset.roomKey);
      updateDrawerInsertButtonState();
      applyVisualState();
    }
  });

  root.addEventListener('focusin', (event) => {
    const input = event.target.closest('.finish-cell-input');
    if (!input) return;
    const td = input.closest('.finish-data-cell');
    if (!td) return;

    setSelectedRoomKey(input.dataset.roomKey);
    setSelectedGroupKey(td.dataset.groupKey);
    setFocusedInputKey(input.dataset.inputKey);
    updateDrawerInsertButtonState();
    applyVisualState();
  });

  root.addEventListener('focusout', (event) => {
    const input = event.target.closest('.finish-cell-input');
    if (!input) return;

    const room = findRoomByKey(input.dataset.roomKey);
    if (!room) return;
    const partIndex = Number(input.dataset.partIndex);
    const row = Number(input.dataset.inputRow);

    if (input.dataset.kind === 'id') {
      const material = commitCellInputId(room, partIndex, row);
      if (!material && input.value.trim()) input.title = '登録済みの入力IDではありません';
    } else if (input.dataset.kind === 'name') {
      // v0.1.3：未登録名は自動登録しない（commitCellMaterialName側の変更）。
      // 未登録のままならID欄に「登録」ボタンが出る。
      commitCellMaterialName(room, partIndex, row);
    }

    setFocusedInputKey(null);
    renderRooms();
    renderSimpleList();
    applyVisualState();
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
 * 部屋コピーボタンのクリックを処理する（v0.1.3で新設）。
 *
 * 手順：
 * 1. describeRoomCopyClick()で「何が起きるか」を判定する（状態はまだ変更しない）
 * 2. 種別に応じて即時実行 or 確認ダイアログを経由する
 *    - 内部／外部をまたぐ場合は先に「またぎコピー」確認
 *    - 対象に既存入力がある場合は「上書き」確認
 *    - どちらかでキャンセルされたら、コピーは実行しない
 * 3. 確認が揃ったらexecuteRoomCopy()で実際にコピーする
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

  executeRoomCopy(roomKeyValue);
}

function handleAction(button) {
  switch (button.dataset.action) {
    case 'add-normal-floor':
      addNormalFloor();
      return true;
    case 'add-basement-floor':
      // 「1-1」ブロックの階セル・ドロワーいずれのボタンもこの同じ処理を呼ぶ。
      addBasementFloor();
      return true;
    case 'add-stairs':
      addStairs();
      return true;
    case 'add-roof':
      addRoof();
      return true;
    case 'add-external-room':
      addExternalRoom();
      return true;
    case 'add-row':
      addInputRow(button.dataset.roomKey);
      return true;
    case 'add-room': {
      // 通常階はフロア末尾へ追加。階段・屋上・外部は現在部屋の直後へ追加。
      if (button.dataset.floorKey && !button.dataset.floorKey.includes('group')) {
        addRoomToFloor(button.dataset.floorKey);
      } else {
        addRoomAfter(button.dataset.roomKey);
      }
      return true;
    }
    default:
      return false;
  }
}
