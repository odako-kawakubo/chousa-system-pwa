/**
 * src/js/camera/camera-controller.js
 *
 * v0.1.5.5 内蔵カメラ。
 *
 * 本開発ルール：BのUIへパッチを重ねず、v64の撮影UI構造を母体に全面再構成する。
 * - 左：撮影済み / 上下反転 / メインパネル -> 展開パネル
 * - 中央：4:3撮影領域 + 電子看板
 * - 右：撮影 / 断面 / 区分
 * - 目視・採取の値は写真タブViewModelから受け取り、カメラ独自の表示番号を生成しない。
 * - 断面は通常区分の循環から分離し、独立ボタンとして扱う。
 * - OneDrive実接続は行わず、photoRecordはpendingで止める。
 */

import * as boardSettingsStore from '../settings/board-settings-store.js';
import { getAvailablePhotoFileName } from '../photos/photo-filename.js';
import { getDeviceCode } from '../device-code.js';
import { createPhotoRecord, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { saveCapturedPhoto } from '../photos/photo-local-store.js';
import { BOARD_POSITIONS, renderBoardPreview } from './camera-board.js';
import { BOARD_SIZE_ORDER, saveCameraPreferences } from './camera-preferences.js';
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

function buildBoardData() {
  return buildCameraBoardData(state, boardSettingsStore.get());
}

function ensureCameraScreen() {
  if (root) return;

  root = document.createElement('div');
  root.className = 'camera-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="camera-orientation-shell" data-camera-orientation-shell>
      <div class="camera-screen">
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

        <main class="camera-capture-frame">
          <video class="camera-video" data-camera-video playsinline muted autoplay></video>
          <div class="camera-guide" data-camera-guide>カメラを準備しています</div>
          <div class="camera-board-layer" data-camera-board-layer>
            <canvas class="camera-board-canvas" data-camera-board></canvas>
          </div>
          <div class="camera-flash" data-camera-flash></div>
        </main>

        <aside class="camera-controls" aria-label="撮影操作">
          <button type="button" class="camera-control-button camera-shoot-button" data-camera-shutter disabled>撮影</button>
          <button type="button" class="camera-control-button camera-section-button" data-camera-section>断面</button>
          <button type="button" class="camera-control-button camera-mode-button" data-camera-stage>目視</button>
        </aside>
      </div>
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
}

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

function closeSidePanel() {
  activePanel = null;
  root.querySelectorAll('[data-camera-panel-slot]').forEach((slot) => slot.classList.remove('active'));
  root.querySelectorAll('[data-camera-panel]').forEach((panel) => panel.classList.remove('show'));
  root.querySelectorAll('[data-open-camera-panel]').forEach((button) => button.classList.remove('active'));
}

function handleCameraClick(event) {
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

function toggleLandscapeFlip() {
  state.landscapeFlipped = !state.landscapeFlipped;
  saveCameraPreferences(state);
  applyLandscapeFlip();
  setTimeout(handleResize, 80);
}

function applyLandscapeFlip() {
  orientationShell?.classList.toggle('flipped', Boolean(state?.landscapeFlipped));
  root?.querySelector('[data-camera-landscape-flip]')?.setAttribute(
    'aria-pressed',
    state?.landscapeFlipped ? 'true' : 'false'
  );
}

function updatePhotoCount() {
  const count = photoRecordStore.getAll().filter((photo) => !photo.deleted && photo.photoType === state.photoType).length;
  const target = root?.querySelector('[data-camera-photo-count]');
  if (target) target.textContent = `撮影済み\n${count}枚`;
}

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

function cycleVisualRoom(delta) {
  moveVisualRoom(state, delta);
  updateCameraUi();
}

function cycleVisualPart(delta) {
  moveVisualPart(state, delta);
  updateCameraUi();
}

function cycleSamplingSample(delta) {
  moveSamplingSample(state, delta);
  updateCameraUi();
}

function cycleSamplingBranch(delta) {
  moveSamplingBranch(state, delta);
  updateCameraUi();
}

function cycleStage() {
  moveStage(state);
  updateCameraUi();
}

function toggleSectionMode() {
  changeSectionMode(state);
  updateCameraUi();
}

function cycleBoardPosition() {
  const index = Math.max(0, BOARD_POSITIONS.indexOf(state.boardPosition));
  state.boardPosition = BOARD_POSITIONS[(index + 1) % BOARD_POSITIONS.length];
  saveCameraPreferences(state);
  updateCameraUi();
}

function changeBoardSize(delta) {
  const index = Math.max(0, BOARD_SIZE_ORDER.indexOf(state.boardSize));
  const nextIndex = Math.max(0, Math.min(BOARD_SIZE_ORDER.length - 1, index + delta));
  state.boardSize = BOARD_SIZE_ORDER[nextIndex];
  saveCameraPreferences(state);
  updateCameraUi();
}

function setCameraReady(ready, guideText = '') {
  const shutter = root?.querySelector('[data-camera-shutter]');
  const guide = root?.querySelector('[data-camera-guide]');
  if (shutter) shutter.disabled = !ready;
  if (guide) {
    guide.hidden = ready;
    if (!ready && guideText) guide.textContent = guideText;
  }
}

function showReview(dataUrl) {
  reviewImage.src = dataUrl;
  review.hidden = false;
  return new Promise((resolve) => {
    pendingReviewResolve = resolve;
  });
}

function resolveReview(accepted) {
  if (!pendingReviewResolve) return;
  const resolve = pendingReviewResolve;
  pendingReviewResolve = null;
  review.hidden = true;
  reviewImage.removeAttribute('src');
  resolve(Boolean(accepted));
}

async function takePhoto() {
  if (taking || !cameraSession?.isReady() || video.readyState < 2) return;
  taking = true;
  const shutter = root.querySelector('[data-camera-shutter]');
  if (shutter) shutter.disabled = true;

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

    await saveCapturedPhoto({ record, originalBlob, completedBlob });
    const stored = photoRecordStore.set(record);
    await onPhotoSaved?.({ record: stored, originalBlob, completedBlob });
    updatePhotoCount();
  } catch (error) {
    console.error('Capture save failed:', error);
    window.alert(`撮影データの保存に失敗しました。\n${error?.message || error}`);
  } finally {
    taking = false;
    if (shutter) shutter.disabled = !cameraSession?.isReady();
  }
}

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
  root.hidden = false;
  document.body.classList.add('camera-open');
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

export function closeCamera() {
  if (!root || root.hidden) return;
  if (pendingReviewResolve) resolveReview(false);
  closeSidePanel();

  cameraSession?.invalidate();
  cameraSession?.stop();
  root.hidden = true;
  document.body.classList.remove('camera-open');
}

async function resumeCameraIfNeeded() {
  if (!root || root.hidden || document.hidden || !state) return;
  await cameraSession?.resume();
}

function handleResize() {
  if (root && !root.hidden && state) updateCameraUi();
}

export function initializeCameraController(options = {}) {
  optionsProvider = options.getOptions || (() => ({ visualRooms: [], samplingTargets: [] }));
  onPhotoSaved = options.onPhotoSaved || null;
  ensureCameraScreen();
  if (!cameraSession) {
    cameraSession = createCameraSession({
      getRoot: () => root,
      getVideo: () => video,
      setReady: setCameraReady,
      onReady: updateCameraUi
    });
  }

  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('visibilitychange', resumeCameraIfNeeded);
  window.addEventListener('pageshow', resumeCameraIfNeeded);
  window.addEventListener('resize', handleResize);
}
