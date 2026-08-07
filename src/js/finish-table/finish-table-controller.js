/**
 * src/js/finish-table/finish-table-controller.js
 *
 * v0.1.2 仕上表のイベント配線。
 * DOM描画はrenderer、状態更新はstate、簡易リスト描画はsimple-listへ委譲する。
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
  getCell,
  setCellDraftInputId,
  setCellDraftName,
  setCellActualPart,
  commitCellInputId,
  commitCellMaterialName,
  setSelectedRoomKey,
  setSelectedGroupKey,
  setFocusedInputKey,
  getSelectedMaterialInputId,
  findMaterialByInputId,
  applyMaterialToCell,
  toggleColorMode,
  toggleChipInputMode,
  getChipInputMode,
  toggleSimpleListOpen,
  handleRoomCopy
} from './finish-table-state.js';
import {
  renderFinishTab,
  renderToolbarState,
  renderRooms,
  applyVisualState
} from './finish-table-renderer.js';
import { initSimpleList, renderSimpleList } from '../materials/simple-list.js';

export function initializeFinishTable() {
  const finishSection = document.getElementById('finish');
  if (!finishSection) return;

  initFinishTableState();
  renderFinishTab(finishSection);
  initSimpleList(document.getElementById('finishSimpleListPanel'));
  bindEvents(finishSection);

  // state側でnotifyされた変更は、構造・操作列・簡易リストを一貫して再描画する。
  subscribe(() => {
    renderToolbarState();
    renderRooms();
    renderSimpleList();
    applyVisualState();
  });
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

    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      if (handleAction(actionButton)) return;
    }

    const dataCell = event.target.closest('.finish-data-cell');
    if (dataCell) {
      setSelectedRoomKey(dataCell.dataset.roomKey);
      setSelectedGroupKey(dataCell.dataset.groupKey);

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

function handleAction(button) {
  switch (button.dataset.action) {
    case 'add-normal-floor':
      addNormalFloor();
      return true;
    case 'add-basement-floor':
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
    case 'insert-room':
      addRoomAfter(button.dataset.roomKey);
      return true;
    case 'copy-room': {
      const result = handleRoomCopy(button.dataset.roomKey);
      if (result?.reason === 'area-mismatch') {
        window.alert('内部と外部をまたいだ部屋コピーはできません。');
      }
      return true;
    }
    default:
      return false;
  }
}
