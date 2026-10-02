/**
 * src/js/camera/camera-controller.js
 *
 * 内蔵カメラ全体の進行を調整するController。
 * - 左：撮影済み / 上下反転 / メインパネル
 * - 中央：4:3撮影領域 + 電子看板
 * - 右：撮影 / 断面 / 区分
 * - 目視・採取の候補は写真タブ側のViewModelから受け取り、独自番号を生成しない。
 * - 断面は通常撮影区分とは分離して扱う。
 * - 写真Record作成後の永続化・OneDrive同期は写真保存/同期moduleへ委譲する。
 */

import * as boardSettingsStore from '../settings/board-settings-store.js';
import { getAvailablePhotoFileName } from '../photos/photo-filename.js';
import { getDeviceCode } from '../device-code.js';
import { createPhotoRecord, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { BOARD_POSITIONS, getBoardRect, renderBoardPreview } from './camera-board.js';
import { BOARD_SIZE_ORDER, saveCameraPreferences } from './camera-preferences.js';
import { bindCameraOrientationChange, isCameraLandscape } from './camera-orientation.js';
import { playShutterSound } from './camera-shutter-sound.js';
import {
  currentVisualTarget,
  currentSamplingTarget,
  currentStageInfo,
  createCaptureSnapshot,
  locateInitialCameraState,
  cycleVisualRoom as moveVisualRoom,
  cycleVisualPart as moveVisualPart,
  cycleSamplingSample as moveSamplingSample,
  cycleSamplingBranch as moveSamplingBranch,
  cycleStage as moveStage,
  toggleSectionMode as changeSectionMode
} from './camera-state.js';
import {
  JPEG_QUALITY,
  buildCameraBoardData,
  canvasToJpegBlob,
  captureOriginalCanvas,
  createCompletedCanvas
} from './camera-capture.js';
import { createCameraSession, getVideoInputCount, getCameraErrorMessage } from './camera-session.js';
import { nextPhotoId } from './camera-photo-id.js';

let root = null;
let orientationShell = null;
let video = null;
let boardCanvas = null;
let review = null;
let reviewImage = null;
let cameraSession = null;

let state = null;
let optionsProvider = null;
let onPhotoSaved = null;
let taking = false;
let pendingReviewResolve = null;
let listenersBound = false;
let activePanel = null;
let cameraReady = false;
let cameraLandscape = true;
let lastTorchTapAt = 0;
let lastTorchTapPoint = null;
let cameraToastTimer = null;

/**
 * Camera stateと案件contextから電子看板描画用データを組み立てる。目視/採取で表示項目を切り替える。
 */
function buildBoardData() {
  return buildCameraBoardData(state, boardSettingsStore.get());
}

/**
 * Camera画面DOMが未生成なら作成し、既存なら再利用して返す。
 */
function ensureCameraScreen() {
  if (root) return;

  root = document.createElement('div');
  root.className = 'camera-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="camera-orientation-shell" data-camera-orientation-shell>
      <div class="camera-screen">
        <button type="button" class="camera-settings-button" data-camera-settings-open aria-label="カメラ設定">⚙</button>
        <div class="camera-settings-panel" data-camera-settings-panel hidden>
          <div class="camera-settings-head">
            <b>撮影音設定</b>
            <button type="button" class="camera-settings-close" data-camera-settings-close aria-label="閉じる">×</button>
          </div>
          <label class="camera-settings-row">
            <span>撮影音</span>
            <select data-camera-sound>
              <option value="off">無音</option>
              <option value="camera1">カメラ1</option>
              <option value="camera2">カメラ2</option>
              <option value="click">クリック</option>
              <option value="chime">チャイム</option>
            </select>
          </label>
          <label class="camera-settings-row">
            <span>音量</span>
            <select data-camera-volume>
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </label>
          <button type="button" class="camera-settings-preview" data-camera-sound-preview>試聴</button>
        </div>
        <aside class="camera-left-panel" aria-label="撮影補助操作">
          <button type="button" class="camera-close-button" data-camera-close>戻る</button>
          <div class="camera-photo-count" data-camera-photo-count>撮影済み\n0枚</div>
          <button type="button" class="camera-panel-mini-button camera-landscape-flip" data-camera-landscape-flip>上下<br>反転</button>

          <div class="camera-board-control-panel">
            <div class="camera-panel-slot" data-camera-panel-slot="room">
              <button type="button" class="camera-panel-main-button" data-open-camera-panel="room">部屋</button>
              <div class="camera-panel-expanded" data-camera-panel="room">
                <button type="button" class="camera-panel-active-title" data-open-camera-panel="room">部屋</button>
                <div class="camera-panel-single" data-camera-room-single>
                  <button type="button" class="camera-panel-mini-button" data-room-prev>▲</button>
                  <button type="button" class="camera-panel-center-button" data-room-value>部屋</button>
                  <button type="button" class="camera-panel-mini-button" data-room-next>▼</button>
                </div>
              </div>
            </div>

            <div class="camera-panel-slot" data-camera-panel-slot="sample">
              <button type="button" class="camera-panel-main-button" data-open-camera-panel="sample">検体</button>
              <div class="camera-panel-expanded" data-camera-panel="sample">
                <button type="button" class="camera-panel-active-title" data-open-camera-panel="sample">検体</button>
                <div class="camera-panel-pair" data-camera-sample-pair>
                  <div class="camera-panel-vertical">
                    <button type="button" class="camera-panel-mini-button" data-sample-prev>▲</button>
                    <button type="button" class="camera-panel-center-button" data-sample-value>検体</button>
                    <button type="button" class="camera-panel-mini-button" data-sample-next>▼</button>
                  </div>
                  <div class="camera-panel-vertical" data-camera-point-column>
                    <button type="button" class="camera-panel-mini-button" data-point-prev>▲</button>
                    <button type="button" class="camera-panel-center-button" data-point-value>箇所</button>
                    <button type="button" class="camera-panel-mini-button" data-point-next>▼</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="camera-panel-slot" data-camera-panel-slot="board">
              <button type="button" class="camera-panel-main-button" data-open-camera-panel="board">看板</button>
              <div class="camera-panel-expanded" data-camera-panel="board">
                <button type="button" class="camera-panel-active-title" data-open-camera-panel="board">看板</button>
                <div class="camera-panel-single">
                  <button type="button" class="camera-panel-mini-button" data-board-larger>▲</button>
                  <button type="button" class="camera-panel-center-button" data-board-position>🪧</button>
                  <button type="button" class="camera-panel-mini-button" data-board-smaller>▼</button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main class="camera-capture-frame" data-camera-capture-frame>
          <video class="camera-video" data-camera-video playsinline muted autoplay></video>
          <div class="camera-guide" data-camera-guide>カメラを準備しています</div>
          <div class="camera-board-layer" data-camera-board-layer>
            <canvas class="camera-board-canvas" data-camera-board></canvas>
          </div>
          <div class="camera-flash" data-camera-flash></div>
          <div class="camera-toast" data-camera-toast hidden></div>
        </main>

        <aside class="camera-controls" aria-label="撮影操作">
          <button type="button" class="camera-control-button camera-shoot-button" data-camera-shutter disabled>撮影</button>
          <button type="button" class="camera-control-button camera-section-button" data-camera-section>断面</button>
          <button type="button" class="camera-control-button camera-mode-button" data-camera-stage>目視</button>
        </aside>
      </div>
    </div>

    <div class="camera-orientation-blocker" data-camera-orientation-blocker hidden>
      <div>端末を横向きにしてください</div>
    </div>

    <div class="camera-review" data-camera-review hidden>
      <img class="camera-review-image" data-camera-review-image alt="撮影確認">
      <div class="camera-review-actions">
        <button type="button" class="camera-review-button" data-camera-retake>撮り直し</button>
        <button type="button" class="camera-review-button primary" data-camera-accept>OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  orientationShell = root.querySelector('[data-camera-orientation-shell]');
  video = root.querySelector('[data-camera-video]');
  boardCanvas = root.querySelector('[data-camera-board]');
  review = root.querySelector('[data-camera-review]');
  reviewImage = root.querySelector('[data-camera-review-image]');
  root.addEventListener('click', handleCameraClick);
  root.addEventListener('change', handleCameraChange);
  root.querySelector('[data-camera-capture-frame]')?.addEventListener('pointerup', handleCameraCapturePointerUp);
}

/**
 * Camera左/右の補助panelを開き、現在panel種別をstateへ反映する。
 */
function openSidePanel(name) {
  // 同じ項目を再押下したら通常ボタンへ戻す。
  // 別項目なら現在の操作パネルを閉じ、その項目のボタン領域を操作パネルへ置き換える。
  activePanel = activePanel === name ? null : name;

  root.querySelectorAll('[data-camera-panel-slot]').forEach((slot) => {
    slot.classList.toggle('active', slot.dataset.cameraPanelSlot === activePanel);
  });

  root.querySelectorAll('[data-camera-panel]').forEach((panel) => {
    panel.classList.toggle('show', panel.dataset.cameraPanel === activePanel);
  });

  root.querySelectorAll('[data-open-camera-panel]').forEach((button) => {
    button.classList.toggle('active', button.dataset.openCameraPanel === activePanel);
  });

  updateCameraUi();
}

/**
 * 開いている補助panelを閉じ、メイン撮影画面へ戻す。
 */
function closeSidePanel() {
  activePanel = null;
  root.querySelectorAll('[data-camera-panel-slot]').forEach((slot) => slot.classList.remove('active'));
  root.querySelectorAll('[data-camera-panel]').forEach((panel) => panel.classList.remove('show'));
  root.querySelectorAll('[data-open-camera-panel]').forEach((button) => button.classList.remove('active'));
}

/**
 * Camera画面内clickを撮影・区分切替・panel操作・完了等へ振り分けるイベント入口。
 */
function handleCameraClick(event) {
  if (event.target.closest('[data-camera-settings-open]')) {
    toggleCameraSettings();
    return;
  }
  if (event.target.closest('[data-camera-settings-close]')) {
    setCameraSettingsOpen(false);
    return;
  }
  if (event.target.closest('[data-camera-sound-preview]')) {
    void playShutterSound(state?.shutterSound, state?.shutterVolume);
    return;
  }

  const openButton = event.target.closest('[data-open-camera-panel]');
  if (openButton) {
    openSidePanel(openButton.dataset.openCameraPanel);
    return;
  }
  if (event.target.closest('[data-camera-close]')) {
    closeCamera();
    return;
  }
  if (event.target.closest('[data-camera-landscape-flip]')) {
    toggleLandscapeFlip();
    return;
  }
  if (event.target.closest('[data-room-prev]')) {
    state.photoType === PHOTO_TYPES.SAMPLING ? cycleSamplingBranch(-1) : cycleVisualRoom(-1);
    return;
  }
  if (event.target.closest('[data-room-next]')) {
    state.photoType === PHOTO_TYPES.SAMPLING ? cycleSamplingBranch(1) : cycleVisualRoom(1);
    return;
  }
  if (event.target.closest('[data-sample-prev]')) {
    state.photoType === PHOTO_TYPES.SAMPLING ? cycleSamplingSample(-1) : cycleVisualPart(-1);
    return;
  }
  if (event.target.closest('[data-sample-next]')) {
    state.photoType === PHOTO_TYPES.SAMPLING ? cycleSamplingSample(1) : cycleVisualPart(1);
    return;
  }
  if (event.target.closest('[data-point-prev]')) {
    cycleSamplingBranch(-1);
    return;
  }
  if (event.target.closest('[data-point-next]')) {
    cycleSamplingBranch(1);
    return;
  }
  if (event.target.closest('[data-board-larger]')) {
    changeBoardSize(1);
    return;
  }
  if (event.target.closest('[data-board-smaller]')) {
    changeBoardSize(-1);
    return;
  }
  if (event.target.closest('[data-board-position]')) {
    cycleBoardPosition();
    return;
  }
  if (event.target.closest('[data-camera-section]')) {
    toggleSectionMode();
    return;
  }
  if (event.target.closest('[data-camera-stage]')) {
    if (state.photoType === PHOTO_TYPES.SAMPLING) cycleStage();
    return;
  }
  if (event.target.closest('[data-camera-shutter]')) {
    takePhoto();
    return;
  }
  if (event.target.closest('[data-camera-retake]')) {
    resolveReview(false);
    return;
  }
  if (event.target.closest('[data-camera-accept]')) resolveReview(true);
}

function syncCameraSettingsUi() {
  if (!root || !state) return;
  const sound = root.querySelector('[data-camera-sound]');
  const volume = root.querySelector('[data-camera-volume]');
  if (sound) sound.value = state.shutterSound || 'camera1';
  if (volume) volume.value = state.shutterVolume || 'medium';
}

function setCameraSettingsOpen(open) {
  const panel = root?.querySelector('[data-camera-settings-panel]');
  if (!panel) return;
  panel.hidden = !open;
  root?.querySelector('[data-camera-settings-open]')?.classList.toggle('active', Boolean(open));
  if (open) syncCameraSettingsUi();
}

function toggleCameraSettings() {
  const panel = root?.querySelector('[data-camera-settings-panel]');
  if (!panel) return;
  setCameraSettingsOpen(panel.hidden);
}

function handleCameraChange(event) {
  if (!state) return;
  const sound = event.target.closest?.('[data-camera-sound]');
  if (sound) {
    state.shutterSound = String(sound.value || 'camera1');
    saveCameraPreferences(state);
    return;
  }

  const volume = event.target.closest?.('[data-camera-volume]');
  if (volume) {
    state.shutterVolume = String(volume.value || 'medium');
    saveCameraPreferences(state);
  }
}

function showCameraToast(text) {
  const toast = root?.querySelector('[data-camera-toast]');
  if (!toast) return;
  if (cameraToastTimer) clearTimeout(cameraToastTimer);
  toast.textContent = String(text || '');
  toast.hidden = false;
  cameraToastTimer = setTimeout(() => {
    toast.hidden = true;
    cameraToastTimer = null;
  }, 850);
}

function pointInsideRect(x, y, rect) {
  return Boolean(
    rect
    && x >= rect.x
    && x <= rect.x + rect.width
    && y >= rect.y
    && y <= rect.y + rect.height
  );
}

function isTorchTapArea(event) {
  const frame = root?.querySelector('[data-camera-capture-frame]');
  if (!frame || !state || !cameraSession?.supportsTorch()) return false;
  const rect = frame.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const x = Number(event.clientX) - rect.left;
  const y = Number(event.clientY) - rect.top;
  if (x < 0 || x > rect.width || y < 0 || y > rect.height / 2) return false;

  const boardHidden = Boolean(state.sectionMode && state.photoType === PHOTO_TYPES.SAMPLING);
  if (!boardHidden) {
    const boardRect = getBoardRect(rect.width, rect.height, state.boardPosition, state.boardSize);
    if (pointInsideRect(x, y, boardRect)) return false;
  }
  return true;
}

async function toggleTorchFromDoubleTap() {
  if (!cameraSession?.supportsTorch()) return;
  const next = !cameraSession.isTorchEnabled();
  const changed = await cameraSession.setTorch(next);
  if (changed) showCameraToast(next ? 'ライト ON' : 'ライト OFF');
}

function handleCameraCapturePointerUp(event) {
  if (!root || root.hidden || review?.hidden === false) return;
  if (!isTorchTapArea(event)) {
    lastTorchTapAt = 0;
    lastTorchTapPoint = null;
    return;
  }

  const now = performance.now();
  const point = { x:Number(event.clientX), y:Number(event.clientY) };
  const withinTime = lastTorchTapAt > 0 && now - lastTorchTapAt <= 350;
  const withinDistance = lastTorchTapPoint
    ? Math.hypot(point.x - lastTorchTapPoint.x, point.y - lastTorchTapPoint.y) <= 48
    : false;

  if (withinTime && withinDistance) {
    lastTorchTapAt = 0;
    lastTorchTapPoint = null;
    void toggleTorchFromDoubleTap();
    return;
  }

  lastTorchTapAt = now;
  lastTorchTapPoint = point;
}

function syncShutterAvailability() {
  const shutter = root?.querySelector('[data-camera-shutter]');
  if (shutter) shutter.disabled = !cameraReady || !cameraLandscape || taking;
}

function syncCameraOrientation(isLandscape = isCameraLandscape()) {
  cameraLandscape = Boolean(isLandscape);
  const blocker = root?.querySelector('[data-camera-orientation-blocker]');
  if (blocker) blocker.hidden = cameraLandscape || review?.hidden === false;
  root?.classList.toggle('camera-portrait-blocked', !cameraLandscape);
  syncShutterAvailability();
}

/**
 * 横向き撮影時の上下反転設定を切り替え、previewと設定Storeへ反映する。
 */
function toggleLandscapeFlip() {
  state.landscapeFlipped = !state.landscapeFlipped;
  saveCameraPreferences(state);
  applyLandscapeFlip();
  setTimeout(handleResize, 80);
}

/**
 * 現在flip設定をvideo previewのCSS transformへ反映する。画像Record値は変更しない。
 */
function applyLandscapeFlip() {
  orientationShell?.classList.toggle('flipped', Boolean(state?.landscapeFlipped));
  root?.querySelector('[data-camera-landscape-flip]')?.setAttribute(
    'aria-pressed',
    state?.landscapeFlipped ? 'true' : 'false'
  );
}

/**
 * 現在targetで撮影済みの写真件数をUIへ反映する。
 */
function updatePhotoCount() {
  const count = photoRecordStore.getAll().filter((photo) => !photo.deleted && photo.photoType === state.photoType).length;
  const target = root?.querySelector('[data-camera-photo-count]');
  if (target) target.textContent = `撮影済み\n${count}枚`;
}

/**
 * Camera state全体からbutton活性・ラベル・電子看板・撮影済み件数などを一括更新する。
 */
function updateCameraUi() {
  if (!root || !state) return;

  const roomButtons = root.querySelectorAll('[data-open-camera-panel="room"]');
  const sampleButtons = root.querySelectorAll('[data-open-camera-panel="sample"]');
  const roomValue = root.querySelector('[data-room-value]');
  const sampleValue = root.querySelector('[data-sample-value]');
  const pointValue = root.querySelector('[data-point-value]');
  const pointColumn = root.querySelector('[data-camera-point-column]');
  const sectionButton = root.querySelector('[data-camera-section]');
  const stageButton = root.querySelector('[data-camera-stage]');
  const boardPosition = root.querySelector('[data-board-position]');

  updatePhotoCount();
  applyLandscapeFlip();
  syncCameraSettingsUi();
  syncCameraOrientation();

  if (state.photoType === PHOTO_TYPES.SAMPLING) {
    const target = currentSamplingTarget(state);
    roomButtons.forEach((button) => { button.textContent = '部屋'; });
    sampleButtons.forEach((button) => { button.textContent = '検体'; });
    if (roomValue) roomValue.textContent = '箇所';
    if (sampleValue) sampleValue.textContent = '検体';
    if (pointValue) pointValue.textContent = '箇所';
    if (pointColumn) pointColumn.hidden = false;
    if (sectionButton) {
      sectionButton.hidden = false;
      sectionButton.classList.toggle('active', Boolean(state.sectionMode));
    }
    if (stageButton) {
      stageButton.disabled = false;
      stageButton.textContent = currentStageInfo(state).label;
    }
  } else {
    const { room, target } = currentVisualTarget(state);
    roomButtons.forEach((button) => { button.textContent = '部屋'; });
    sampleButtons.forEach((button) => { button.textContent = '部位'; });
    if (roomValue) roomValue.textContent = '部屋';
    if (sampleValue) sampleValue.textContent = '部位';
    if (pointColumn) pointColumn.hidden = true;
    if (sectionButton) sectionButton.hidden = true;
    if (stageButton) {
      stageButton.disabled = true;
      stageButton.textContent = '目視';
    }
  }

  if (boardPosition) boardPosition.textContent = '🪧';

  const boardLayer = root.querySelector('[data-camera-board-layer]');
  if (boardLayer) boardLayer.hidden = Boolean(state.sectionMode && state.photoType === PHOTO_TYPES.SAMPLING);

  requestAnimationFrame(() => {
    if (state.sectionMode && state.photoType === PHOTO_TYPES.SAMPLING) {
      const ctx = boardCanvas?.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
      return;
    }
    renderBoardPreview(boardCanvas, buildBoardData(), state.boardPosition, state.boardSize);
  });
}

/**
 * 目視撮影対象の部屋候補を次/前へ循環し、part候補と電子看板を追従更新する。
 */
function cycleVisualRoom(delta) {
  moveVisualRoom(state, delta);
  updateCameraUi();
}

/**
 * 現在部屋内の目視部位候補を次/前へ循環する。
 */
function cycleVisualPart(delta) {
  moveVisualPart(state, delta);
  updateCameraUi();
}

/**
 * 採取対象materialを次/前へ循環し、枝番/区分/看板情報を同期する。
 */
function cycleSamplingSample(delta) {
  moveSamplingSample(state, delta);
  updateCameraUi();
}

/**
 * 現在採取materialの枝番①②③を有効範囲内で循環する。
 */
function cycleSamplingBranch(delta) {
  moveSamplingBranch(state, delta);
  updateCameraUi();
}

/**
 * 採取撮影区分の施工前/施工中/施工後を循環する。断面はsection modeとして別管理。
 */
function cycleStage() {
  moveStage(state);
  updateCameraUi();
}

/**
 * 断面撮影modeのON/OFFを切り替える。通常stage値を壊さず一時的にsectionへ切り替える。
 */
function toggleSectionMode() {
  changeSectionMode(state);
  updateCameraUi();
}

/**
 * 電子看板の固定4位置を順番に切り替え、ユーザー設定へ保存する。
 */
function cycleBoardPosition() {
  const index = Math.max(0, BOARD_POSITIONS.indexOf(state.boardPosition));
  state.boardPosition = BOARD_POSITIONS[(index + 1) % BOARD_POSITIONS.length];
  saveCameraPreferences(state);
  updateCameraUi();
}

/**
 * 電子看板サイズを許容範囲で変更し、previewとユーザー設定へ保存する。
 */
function changeBoardSize(delta) {
  const index = Math.max(0, BOARD_SIZE_ORDER.indexOf(state.boardSize));
  const nextIndex = Math.max(0, Math.min(BOARD_SIZE_ORDER.length - 1, index + delta));
  state.boardSize = BOARD_SIZE_ORDER[nextIndex];
  saveCameraPreferences(state);
  updateCameraUi();
}

/**
 * MediaStream準備完了状態を更新し、撮影button等の活性を切り替える。
 */
function setCameraReady(ready, guideText = '') {
  cameraReady = Boolean(ready);
  const guide = root?.querySelector('[data-camera-guide]');
  syncShutterAvailability();
  if (guide) {
    guide.hidden = cameraReady;
    if (!cameraReady && guideText) guide.textContent = guideText;
  }
}

/**
 * 撮影直後画像を確認画面へ表示し、採用/撮り直しの判断待ち状態へ移行する。
 */
function showReview(dataUrl) {
  reviewImage.src = dataUrl;
  review.hidden = false;
  syncCameraOrientation();
  return new Promise((resolve) => {
    pendingReviewResolve = resolve;
  });
}

/**
 * 撮影確認画面の採用/破棄結果を確定し、待機中Promiseを解決する。
 */
function resolveReview(accepted) {
  if (!pendingReviewResolve) return;
  const resolve = pendingReviewResolve;
  pendingReviewResolve = null;
  review.hidden = true;
  reviewImage.removeAttribute('src');
  syncCameraOrientation();
  resolve(Boolean(accepted));
}

/**
 * 現在video frameをCanvasへ取り込みBlob化し、確認画面→Photo Record登録までの撮影1回分を実行する。
 */
async function takePhoto() {
  if (taking || !cameraLandscape || !cameraSession?.isReady() || video.readyState < 2) return;
  taking = true;
  syncShutterAvailability();

  void playShutterSound(state?.shutterSound, state?.shutterVolume);

  const snapshot = createCaptureSnapshot(state);
  const boardData = { ...buildBoardData() };

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const originalCanvas = captureOriginalCanvas(video, snapshot.quality);
    const completedCanvas = createCompletedCanvas(originalCanvas, boardData, snapshot);
    const reviewUrl = completedCanvas.toDataURL('image/jpeg', JPEG_QUALITY);

    const flash = root.querySelector('[data-camera-flash]');
    flash?.classList.add('flash');
    setTimeout(() => flash?.classList.remove('flash'), 120);

    const accepted = await showReview(reviewUrl);
    if (!accepted) return;

    const [originalBlob, completedBlob] = await Promise.all([
      canvasToJpegBlob(originalCanvas),
      canvasToJpegBlob(completedCanvas)
    ]);

    const photoId = nextPhotoId(snapshot.photoType);
    const fileName = getAvailablePhotoFileName(snapshot, photoRecordStore.getAll());
    const record = createPhotoRecord({
      photoId,
      photoType: snapshot.photoType,
      fileName,
      syncStatus: 'pending',
      capturedDevice: getDeviceCode(),
      capturedAt: snapshot.capturedAt,
      areaCode: snapshot.areaCode,
      roomPosition: snapshot.roomPosition,
      partSlot: snapshot.partSlot,
      roomNo: snapshot.roomNo,
      materialId: snapshot.materialId,
      samplingPlace: snapshot.samplingPlace,
      samplingBranch: snapshot.samplingBranch,
      sampleNo: snapshot.sampleNo,
      sampleBaseNo: snapshot.sampleBaseNo,
      part: snapshot.part,
      shootingType: snapshot.shootingType,
      boardPosition: snapshot.boardPosition,
      boardSize: snapshot.boardSize,
      localOriginalStatus: 'saved',
      localCompletedStatus: 'saved',
      fieldEditedAt: touchFieldEditedAt({}, [
        'photoType', 'fileName', 'capturedDevice', 'capturedAt', 'boardPosition', 'boardSize',
        ...(snapshot.photoType === PHOTO_TYPES.VISUAL
          ? ['areaCode', 'roomPosition', 'partSlot']
          : ['materialId', 'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType'])
      ])
    });

    if (typeof onPhotoSaved !== 'function') {
      throw new Error('写真保存処理が設定されていません。');
    }
    await onPhotoSaved({ record, originalBlob, completedBlob });
    updatePhotoCount();
  } catch (error) {
    console.error('Capture save failed:', error);
    window.alert(`撮影データの保存に失敗しました。\n${error?.message || error}`);
  } finally {
    taking = false;
    syncShutterAvailability();
  }
}

/**
 * 写真タブから渡されたcontext/optionsでCameraを開く公開API。目視/採取対象・案件情報・前回設定をsessionへ反映する。
 */
export async function openCamera(initialContext = {}) {
  ensureCameraScreen();
  const options = optionsProvider?.() || { visualRooms: [], samplingTargets: [] };
  state = locateInitialCameraState(initialContext, options);

  if (state.photoType === PHOTO_TYPES.VISUAL && !state.visualRooms.length) {
    window.alert('撮影できる部屋がありません。');
    return;
  }
  if (state.photoType === PHOTO_TYPES.SAMPLING && !state.samplingTargets.length) {
    window.alert('撮影できる採取対象がありません。');
    return;
  }

  closeSidePanel();
  setCameraSettingsOpen(false);
  lastTorchTapAt = 0;
  lastTorchTapPoint = null;
  root.hidden = false;
  document.body.classList.add('camera-open');
  syncCameraOrientation();
  updateCameraUi();

  try {
    await cameraSession.start();
  } catch (error) {
    console.error('Camera start failed:', error);
    const count = await getVideoInputCount();
    setCameraReady(false, 'カメラを起動できません');
    window.alert(getCameraErrorMessage(error, count));
  }
}

/**
 * Cameraを閉じ、MediaStream・session一時状態・UIを解放する。
 */
export function closeCamera() {
  if (!root || root.hidden) return;
  if (pendingReviewResolve) resolveReview(false);
  closeSidePanel();

  cameraSession?.invalidate();
  cameraSession?.stop();
  cameraReady = false;
  setCameraSettingsOpen(false);
  lastTorchTapAt = 0;
  lastTorchTapPoint = null;
  root.hidden = true;
  document.body.classList.remove('camera-open');
}

/**
 * 確認画面や端末状態変化後に必要ならMediaStream previewを再開する。
 */
async function resumeCameraIfNeeded() {
  if (!root || root.hidden || document.hidden || !state) return;
  await cameraSession?.resume();
}

/**
 * 画面回転/resize時に撮影領域・看板位置・preview transformを再計算する。
 */
function handleResize() {
  if (root && !root.hidden && state) {
    syncCameraOrientation();
    updateCameraUi();
  }
}

/**
 * Camera Controllerの初期化入口。DOM生成、click/resizeイベント、state購読を一度だけ接続する。
 */
export function initializeCameraController(options = {}) {
  optionsProvider = options.getOptions || (() => ({ visualRooms: [], samplingTargets: [] }));
  onPhotoSaved = options.onPhotoSaved || null;
  ensureCameraScreen();
  if (!cameraSession) {
    cameraSession = createCameraSession({
      getRoot: () => root,
      getVideo: () => video,
      setReady: setCameraReady,
      onReady: () => {
        syncCameraOrientation();
        updateCameraUi();
      }
    });
  }

  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('visibilitychange', resumeCameraIfNeeded);
  window.addEventListener('pageshow', resumeCameraIfNeeded);
  window.addEventListener('resize', handleResize);
  bindCameraOrientationChange((landscape) => {
    if (!root || root.hidden) {
      cameraLandscape = Boolean(landscape);
      return;
    }
    syncCameraOrientation(landscape);
    updateCameraUi();
  });
}
