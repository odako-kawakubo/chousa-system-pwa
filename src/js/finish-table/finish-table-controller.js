/**
 * src/js/finish-table/finish-table-controller.js
 *
 * このファイルの役割：
 *   仕上表タブの初期化と、画面上の操作（クリック・入力・フォーカス）を
 *   状態の更新・再描画へつなぐ配線だけを行う。業務データの計算式は
 *   finish-table-state.js、DOM組み立てはfinish-table-renderer.jsに
 *   任せ、このファイルはそれらを呼び出すだけにする。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js から initializeFinishTable() が1度だけ呼ばれる。
 *
 * 何を取得しているか：
 *   #finish セクション要素（既存のタブ枠。src/app.html側で用意済み）。
 *   それ以外のDOM（他タブ・ヘッダー・ドロワー・案件パネル・既存モーダル）は
 *   一切取得・操作しない。
 *
 * 何を判定しているか：
 *   クリックされた要素が「どの操作ボタンか」「どのセルか」「どの部屋か」
 *   だけをdata属性から判定する。
 *
 * どこへ描画しているか：
 *   finish-table-renderer.js・simple-list.js経由で#finish内のみ。
 *
 * 保存・外部通信について：
 *   一切行わない（addEventListenerでのイベント配線のみ。インラインonclickは
 *   使用しない）。Firestore・OneDrive・Microsoft Graph等への通信も行わない。
 */

import {
  initFinishTableState,
  subscribe,
  setAreaMode,
  addNormalFloor,
  addBasementFloor,
  addStairs,
  addRoof,
  addRoomToFloor,
  addExternalRoom,
  addInputRow,
  setSelectedRoomKey,
  setActiveCellKey,
  findRoomByKey,
  setCellValue,
  setCellActualPart
} from './finish-table-state.js';
import {
  renderFinishTab,
  renderRooms,
  renderAddButtons,
  updateAreaToggleButtons,
  updateRoomSelectionClasses,
  updateCellActiveClasses,
  updateHighlights,
  updateCellBadge
} from './finish-table-renderer.js';
import { initSimpleList, syncSelectionFromCellValue } from '../materials/simple-list.js';

/**
 * 仕上表タブを初期化する。src/js/app-init.jsから1度だけ呼ぶ。
 *
 * 手順：
 * 1. サンプル案件・サンプル建材・初期部屋構成で状態を初期化する
 * 2. #finish セクションへ枠組みを描画する
 * 3. 簡易リストパネルを初期化する
 * 4. #finishセクション内のクリック・入力・フォーカスを配線する
 * 5. 状態変化（階・部屋・入力行の追加、内部/外部切替）を購読し、再描画する
 */
export function initializeFinishTable() {
  const finishSection = document.getElementById('finish');
  if (!finishSection) return;

  initFinishTableState();
  renderFinishTab(finishSection);

  const simpleListPanel = document.getElementById('finishSimpleListPanel');
  initSimpleList(simpleListPanel);

  bindFinishTabEvents(finishSection);

  // 構造が変わる操作（階・部屋・入力行の追加、内部/外部切替）のたびに
  // 部屋一覧・追加ボタンを再描画し、選択中の見た目を再適用する。
  subscribe(() => {
    renderAddButtons();
    updateAreaToggleButtons();
    renderRooms();
    updateRoomSelectionClasses();
    updateCellActiveClasses();
    updateHighlights();
  });
}

/**
 * #finish セクション内のイベントをまとめて配線する（addEventListenerのみ、
 * インラインonclickは使わない）。部屋一覧は再描画されても要素自体
 * （#finishRoomsArea等）は差し替わらないため、ここでの配線は1度だけでよい。
 *
 * @param {HTMLElement} finishSection
 */
function bindFinishTabEvents(finishSection) {
  // 内部／外部切替ボタン
  document.getElementById('finishAreaToggle').addEventListener('click', (event) => {
    const btn = event.target.closest('.finish-area-btn');
    if (!btn) return;
    setAreaMode(btn.dataset.areaMode);
  });

  // 通常階／地下階／階段／屋上／外部の部屋追加ボタン（内部・外部で表示切替）
  document.getElementById('finishAddButtons').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'add-normal-floor':
        addNormalFloor();
        break;
      case 'add-basement-floor':
        addBasementFloor();
        break;
      case 'add-stairs':
        addStairs();
        break;
      case 'add-roof':
        addRoof();
        break;
      case 'add-external-room':
        addExternalRoom();
        break;
      default:
        break;
    }
  });

  const roomsArea = document.getElementById('finishRoomsArea');

  // 部屋ブロック内の「＋部屋追加」「＋入力行」ボタン、および部屋選択
  roomsArea.addEventListener('click', (event) => {
    const addRoomBtn = event.target.closest('[data-action="add-room"]');
    if (addRoomBtn) {
      addRoomToFloor(addRoomBtn.dataset.floorKey);
      return;
    }

    const addRowBtn = event.target.closest('[data-action="add-row"]');
    if (addRowBtn) {
      addInputRow(addRowBtn.dataset.roomKey);
      return;
    }

    // 判定：部屋ブロックの中がクリックされたら、その部屋を選択状態にする（部屋選択）。
    const roomEl = event.target.closest('.finish-room');
    if (roomEl) {
      setSelectedRoomKey(roomEl.dataset.roomKey);
      updateRoomSelectionClasses();
    }
  });

  // セル選択（フォーカス）：入力中セルへ青枠を付け、簡易リストの選択状態も合わせる。
  roomsArea.addEventListener('focusin', (event) => {
    const cellEl = event.target.closest('.finish-cell');
    if (!cellEl) return;

    setActiveCellKey(cellEl.dataset.finishId);
    updateCellActiveClasses();

    if (event.target.classList.contains('finish-value-input')) {
      syncSelectionFromCellValue(event.target.value);
    }
  });

  // 建材名称の直接入力：状態を更新し、その他欄バッジと選択ハイライトを更新する。
  roomsArea.addEventListener('input', (event) => {
    if (event.target.classList.contains('finish-room-name')) {
      // 部屋名の入力欄。仕上表IDの計算には使わない表示用の名称のみ更新する。
      const room = findRoomByKey(event.target.dataset.roomKey);
      if (room) room.name = event.target.value;
      return;
    }

    const cellEl = event.target.closest('.finish-cell');
    if (!cellEl) return;

    const room = findRoomByKey(cellEl.dataset.roomKey);
    if (!room) return;
    const partIndex = Number(cellEl.dataset.partIndex);
    const row = Number(cellEl.dataset.inputRow);

    if (event.target.classList.contains('finish-value-input')) {
      setCellValue(room, partIndex, row, event.target.value);
      updateCellBadge(cellEl);
      updateHighlights();
    } else if (event.target.classList.contains('finish-actual-part-input')) {
      setCellActualPart(room, partIndex, row, event.target.value);
      // 実際の部位名は別属性として仕上表IDとは切り離して保持する。
      cellEl.dataset.actualPart = event.target.value;
    }
  });
}
