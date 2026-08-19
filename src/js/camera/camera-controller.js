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

import { sampleProject } from '../demo/sample-project.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import { getAvailablePhotoFileName } from '../photos/photo-filename.js';
import { getDeviceCode } from '../device-code.js';
import { createPhotoRecord, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { saveCapturedPhoto } from '../photos/photo-local-store.js';
import {
  BOARD_POSITIONS,
  drawBoard,
  getBoardRect,
  renderBoardPreview
} from './camera-board.js';

const QUALITY = Object.freeze({
  standard: { width: 3024, height: 2268, label: '標準' },
  high: { width: 3264, height: 2448, label: '高画質' }
});

const STAGE_ORDER = Object.freeze([
  SHOOTING_TYPES.BEFORE,
  SHOOTING_TYPES.DURING,
  SHOOTING_TYPES.AFTER
]);

const STAGE_INFO = Object.freeze({
  [SHOOTING_TYPES.BEFORE]: { code: '1', label: '施工前' },
  [SHOOTING_TYPES.DURING]: { code: '2', label: '施工中' },
  [SHOOTING_TYPES.AFTER]: { code: '3', label: '施工後' }
});

const BOARD_SIZE_ORDER = Object.freeze(['small', 'medium', 'large']);
const JPEG_QUALITY = 0.82;
const STORAGE_KEY = `chousa-camera:${sampleProject.projectId || 'project'}`;
const COUNTER_KEY = 'chousa-photo-counter';

let root = null;
let orientationShell = null;
let video = null;
let boardCanvas = null;
let review = null;
let reviewImage = null;
let stream = null;

// カメラ取得の世代番号。close後に遅れて返った古いStreamを採用しないために使う。
let cameraSessionId = 0;

// null以外ならgetUserMedia実行中。世代番号を保持して多重起動を防ぐ。
let cameraStartingSessionId = null;

let state = null;
let optionsProvider = null;
let onPhotoSaved = null;
let taking = false;
let pendingReviewResolve = null;
let listenersBound = false;
let activePanel = null;

function cycleIndex(index, length, delta) {
  if (!length) return 0;
  return (index + delta + length) % length;
}

function loadPersistentState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      boardPosition: BOARD_POSITIONS.includes(saved.boardPosition) ? saved.boardPosition : 'bottom-left',
      boardSize: BOARD_SIZE_ORDER.includes(saved.boardSize) ? saved.boardSize : 'medium',
      quality: QUALITY[saved.quality] ? saved.quality : 'standard',
      landscapeFlipped: Boolean(saved.landscapeFlipped)
    };
  } catch {
    return {
      boardPosition: 'bottom-left',
      boardSize: 'medium',
      quality: 'standard',
      landscapeFlipped: false
    };
  }
}

function persistCameraPreferences() {
  if (!state) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    boardPosition: state.boardPosition,
    boardSize: state.boardSize,
    quality: state.quality,
    landscapeFlipped: Boolean(state.landscapeFlipped)
  }));
}


function nextPhotoId(photoType) {
  const key = `${COUNTER_KEY}:${photoType}`;
  const next = Number(localStorage.getItem(key) || 0) + 1;
  localStorage.setItem(key, String(next));
  return `${photoType === PHOTO_TYPES.SAMPLING ? 'S' : 'V'}-${getDeviceCode()}-${String(next).padStart(4, '0')}`;
}

function currentVisualTarget() {
  const room = state?.visualRooms?.[state.visualRoomIndex] || {};
  const target = room.targets?.[state.visualPartIndex] || {};
  return { room, target };
}

function currentSamplingTarget() {
  return state?.samplingTargets?.[state.samplingIndex] || {};
}

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

function samplingDisplayNo(target) {
  const marks = { 1: '①', 2: '②', 3: '③' };
  const base = String(target.sampleBaseNo || target.sampleNo || '').trim();
  const mark = marks[Number(target.branch || 0)] || '';
  return `${base}${mark ? `-${mark}` : ''}`;
}

function currentStageInfo() {
  return STAGE_INFO[state?.stage] || STAGE_INFO[SHOOTING_TYPES.BEFORE];
}

function currentShootingType() {
  if (state?.photoType !== PHOTO_TYPES.SAMPLING) return '';
  return state.sectionMode ? SHOOTING_TYPES.SECTION : state.stage;
}

function currentStatusCode() {
  if (state?.photoType === PHOTO_TYPES.VISUAL) return '5';
  if (state?.sectionMode) return '4';
  return currentStageInfo().code;
}

/** 写真タブの正式値だけを使って看板表示データを作る。 */
function buildBoardData() {
  const boardSettings = boardSettingsStore.get();
  if (state.photoType === PHOTO_TYPES.SAMPLING) {
    const target = currentSamplingTarget();
    return {
      photoType: 'sampling',
      projectName: boardSettings.subjectText || boardSettings.projectName || sampleProject.projectName || '',
      address: boardSettings.addressText || boardSettings.address || '',
      subjectFontSize: boardSettings.subjectFontSize,
      addressFontSize: boardSettings.addressFontSize,
      samplingPlace: target.samplingPlace || '',
      sampleNo: samplingDisplayNo(target),
      statusCode: currentStatusCode(),
      date: todayText()
    };
  }

  const { room, target } = currentVisualTarget();
  return {
    photoType: 'visual',
    projectName: boardSettings.subjectText || boardSettings.projectName || sampleProject.projectName || '',
    address: boardSettings.addressText || boardSettings.address || '',
    subjectFontSize: boardSettings.subjectFontSize,
    addressFontSize: boardSettings.addressFontSize,
    roomNo: room.roomNo || '',
    part: target.part || '',
    statusCode: '5',
    date: todayText()
  };
}

/** シャッターを押した瞬間の撮影対象を固定する。 */
function createCaptureSnapshot() {
  const common = {
    photoType: state.photoType,
    boardPosition: state.boardPosition,
    boardSize: state.boardSize,
    quality: state.quality,
    capturedAt: new Date().toISOString()
  };

  if (state.photoType === PHOTO_TYPES.SAMPLING) {
    const target = currentSamplingTarget();
    return {
      ...common,
      materialId: target.materialId || '',
      samplingPlace: target.samplingPlace || '',
      samplingBranch: Number(target.branch || 0),
      sampleNo: samplingDisplayNo(target),
      sampleBaseNo: String(target.sampleBaseNo || target.sampleNo || ''),
      part: target.part || '',
      shootingType: currentShootingType(),
      sectionMode: Boolean(state.sectionMode)
    };
  }

  const { room, target } = currentVisualTarget();
  return {
    ...common,
    roomUid: room.roomUid || '',
    roomPosition: room.roomPosition || '',
    roomNo: room.roomNo || '',
    roomName: room.roomName || '',
    areaCode: room.areaCode || '',
    part: target.part || ''
  };
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
  persistCameraPreferences();
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
    const target = currentSamplingTarget();
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
      stageButton.textContent = currentStageInfo().label;
    }
  } else {
    const { room, target } = currentVisualTarget();
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
  state.visualRoomIndex = cycleIndex(state.visualRoomIndex, state.visualRooms.length, delta);
  state.visualPartIndex = 0;
  updateCameraUi();
}

function cycleVisualPart(delta) {
  const { room } = currentVisualTarget();
  state.visualPartIndex = cycleIndex(state.visualPartIndex, room.targets?.length || 0, delta);
  updateCameraUi();
}

function sampleNumbers() {
  return [...new Set(state.samplingTargets.map((item) => String(item.sampleBaseNo || item.sampleNo || '')))];
}

function cycleSamplingSample(delta) {
  const current = currentSamplingTarget();
  const numbers = sampleNumbers();
  const currentValue = String(current.sampleBaseNo || current.sampleNo || '');
  const currentIndex = Math.max(0, numbers.indexOf(currentValue));
  const nextValue = numbers[cycleIndex(currentIndex, numbers.length, delta)];
  const nextIndex = state.samplingTargets.findIndex((item) => String(item.sampleBaseNo || item.sampleNo || '') === nextValue);
  state.samplingIndex = Math.max(0, nextIndex);
  updateCameraUi();
}

function cycleSamplingBranch(delta) {
  const current = currentSamplingTarget();
  if (!current) return;
  const currentSample = String(current.sampleBaseNo || current.sampleNo || '');
  const sameSample = state.samplingTargets
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.sampleBaseNo || item.sampleNo || '') === currentSample);
  const localIndex = Math.max(0, sameSample.findIndex(({ index }) => index === state.samplingIndex));
  const next = sameSample[cycleIndex(localIndex, sameSample.length, delta)];
  if (next) state.samplingIndex = next.index;
  updateCameraUi();
}

function cycleStage() {
  state.sectionMode = false;
  const index = Math.max(0, STAGE_ORDER.indexOf(state.stage));
  state.stage = STAGE_ORDER[cycleIndex(index, STAGE_ORDER.length, 1)];
  updateCameraUi();
}

function toggleSectionMode() {
  state.sectionMode = !state.sectionMode;
  updateCameraUi();
}

function cycleBoardPosition() {
  const index = Math.max(0, BOARD_POSITIONS.indexOf(state.boardPosition));
  state.boardPosition = BOARD_POSITIONS[cycleIndex(index, BOARD_POSITIONS.length, 1)];
  persistCameraPreferences();
  updateCameraUi();
}

function changeBoardSize(delta) {
  const index = Math.max(0, BOARD_SIZE_ORDER.indexOf(state.boardSize));
  const nextIndex = Math.max(0, Math.min(BOARD_SIZE_ORDER.length - 1, index + delta));
  state.boardSize = BOARD_SIZE_ORDER[nextIndex];
  persistCameraPreferences();
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

async function requestFullscreenSafe() {
  const target = document.documentElement;
  if (document.fullscreenElement || !target.requestFullscreen) return;
  try {
    await target.requestFullscreen();
  } catch {
    // iOS等でFullscreen APIが拒否されてもカメラ起動は継続する。
  }
}

function stopCameraStream() {
  // 既存Streamの全Trackを止め、端末のカメラ利用を明示的に終了する。
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  // video側も停止・切断する。iPadで画面を閉じた後に録画状態が残るのを防ぐ。
  if (video) {
    try {
      video.pause();
    } catch {
      // pause()失敗は終了処理を妨げない。
    }
    video.srcObject = null;
  }

  setCameraReady(false, 'カメラ停止中');
}

/**
 * v0.14.13で現場テスト実績のある取得条件を基準にしつつ、
 * getUserMediaの多重実行と、close後に遅れて返るStreamを防止する。
 */
async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('この環境ではカメラAPIを利用できません。');
  }

  // 権限ダイアログ中など、すでに1本の取得処理が走っている間は2本目を開始しない。
  if (cameraStartingSessionId !== null) return;

  const sessionId = ++cameraSessionId;
  cameraStartingSessionId = sessionId;
  setCameraReady(false, 'カメラを準備しています');

  try {
    // 以前のStreamが残っていた場合は、次の取得前に完全停止する。
    stopCameraStream();
    await requestFullscreenSafe();

    const acquiredStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    // getUserMedia待機中にカメラが閉じられた、または別世代が開始された場合、
    // このStreamは古いので採用せず即停止する。
    if (sessionId !== cameraSessionId || !root || root.hidden) {
      acquiredStream.getTracks().forEach((track) => track.stop());
      return;
    }

    stream = acquiredStream;
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();

    // play()待機中にもcloseされ得るため、採用直後にも世代を再確認する。
    if (sessionId !== cameraSessionId || !root || root.hidden) {
      stopCameraStream();
      return;
    }

    setCameraReady(true);
    updateCameraUi();
  } finally {
    // 古い非同期処理のfinallyで、新しい取得処理の起動中状態を解除しない。
    if (cameraStartingSessionId === sessionId) {
      cameraStartingSessionId = null;
    }
  }
}

async function getVideoInputCount() {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    return null;
  }
}

function getCameraErrorMessage(error, cameraCount) {
  const suffix = Number.isInteger(cameraCount) ? `\n認識中のカメラ：${cameraCount}台` : '';
  switch (error?.name) {
    case 'NotAllowedError': return `カメラの使用が許可されていません。ブラウザのカメラ権限を確認してください。${suffix}`;
    case 'NotFoundError': return `利用可能なカメラが見つかりませんでした。${suffix}`;
    case 'NotReadableError': return `カメラを他のアプリが使用している可能性があります。${suffix}`;
    case 'OverconstrainedError': return `指定した条件に合うカメラが見つかりませんでした。${suffix}`;
    case 'SecurityError': return `現在の接続方法ではカメラを利用できません。HTTPS環境を確認してください。${suffix}`;
    default: return `カメラを起動できませんでした。\n${error?.name || ''}\n${error?.message || error || ''}${suffix}`;
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('画像Blobを生成できませんでした。')),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

/** 中央4:3プレビューと同じ範囲を元写真Canvasへ切り出す。 */
function captureOriginalCanvas() {
  const quality = QUALITY[state.quality] || QUALITY.standard;
  const canvas = document.createElement('canvas');
  canvas.width = quality.width;
  canvas.height = quality.height;
  const ctx = canvas.getContext('2d');

  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createCompletedCanvas(originalCanvas, boardData, snapshot) {
  const canvas = document.createElement('canvas');
  canvas.width = originalCanvas.width;
  canvas.height = originalCanvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(originalCanvas, 0, 0);

  // v64の断面モードは看板なし。ファイル区分は4として保持する。
  if (snapshot.photoType === PHOTO_TYPES.SAMPLING && snapshot.sectionMode) return canvas;

  const previewWidth = root?.querySelector('.camera-capture-frame')?.clientWidth || 780;
  const boardRect = getBoardRect(
    canvas.width,
    canvas.height,
    snapshot.boardPosition,
    snapshot.boardSize,
    previewWidth
  );
  drawBoard(ctx, boardRect, boardData);
  return canvas;
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
  if (taking || !stream || video.readyState < 2) return;
  taking = true;
  const shutter = root.querySelector('[data-camera-shutter]');
  if (shutter) shutter.disabled = true;

  const snapshot = createCaptureSnapshot();
  const boardData = { ...buildBoardData() };

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const originalCanvas = captureOriginalCanvas();
    const completedCanvas = createCompletedCanvas(originalCanvas, boardData, snapshot);
    const reviewUrl = completedCanvas.toDataURL('image/jpeg', JPEG_QUALITY);

    const flash = root.querySelector('[data-camera-flash]');
    flash?.classList.add('flash');
    setTimeout(() => flash?.classList.remove('flash'), 120);

    const accepted = await showReview(reviewUrl);
    if (!accepted) return;

    const [originalBlob, completedBlob] = await Promise.all([
      canvasToBlob(originalCanvas),
      canvasToBlob(completedCanvas)
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
      roomPosition: snapshot.roomPosition,
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
      localCompletedStatus: 'saved'
    });

    await saveCapturedPhoto({ record, originalBlob, completedBlob });
    await onPhotoSaved?.({ record, originalBlob, completedBlob });
    photoRecordStore.set(record);
    updatePhotoCount();
  } catch (error) {
    console.error('Capture save failed:', error);
    window.alert(`撮影データの保存に失敗しました。\n${error?.message || error}`);
  } finally {
    taking = false;
    if (shutter) shutter.disabled = !stream;
  }
}

function locateInitialState(initialContext, options) {
  const preferences = loadPersistentState();
  const next = {
    photoType: initialContext.photoType === PHOTO_TYPES.SAMPLING ? PHOTO_TYPES.SAMPLING : PHOTO_TYPES.VISUAL,
    visualRooms: Array.isArray(options.visualRooms) ? options.visualRooms : [],
    samplingTargets: Array.isArray(options.samplingTargets) ? options.samplingTargets : [],
    visualRoomIndex: 0,
    visualPartIndex: 0,
    samplingIndex: 0,
    stage: [SHOOTING_TYPES.BEFORE, SHOOTING_TYPES.DURING, SHOOTING_TYPES.AFTER].includes(initialContext.shootingType)
      ? initialContext.shootingType
      : SHOOTING_TYPES.BEFORE,
    sectionMode: initialContext.shootingType === SHOOTING_TYPES.SECTION,
    ...preferences
  };

  if (next.photoType === PHOTO_TYPES.VISUAL) {
    const roomIndex = next.visualRooms.findIndex((room) => room.roomPosition === initialContext.roomPosition);
    next.visualRoomIndex = Math.max(0, roomIndex);
    const room = next.visualRooms[next.visualRoomIndex];
    const partIndex = room?.targets?.findIndex((target) => target.part === initialContext.part) ?? -1;
    next.visualPartIndex = Math.max(0, partIndex);
  } else {
    const samplingIndex = next.samplingTargets.findIndex((target) => (
      target.materialId === initialContext.materialId &&
      Number(target.branch) === Number(initialContext.samplingBranch || initialContext.branch)
    ));
    next.samplingIndex = Math.max(0, samplingIndex);
  }

  return next;
}

export async function openCamera(initialContext = {}) {
  ensureCameraScreen();
  const options = optionsProvider?.() || { visualRooms: [], samplingTargets: [] };
  state = locateInitialState(initialContext, options);

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
    await startCameraStream();
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

  // 現在待機中のgetUserMediaを論理的に無効化する。
  // API自体は途中キャンセルできないため、後から返ったStreamはstartCameraStream側で破棄する。
  cameraSessionId++;
  cameraStartingSessionId = null;

  stopCameraStream();
  root.hidden = true;
  document.body.classList.remove('camera-open');
}

/**
 * iOS / iPadOS復帰処理。
 * v0.14.13と同じくlive trackは再利用し、失われた場合だけ再取得する。
 */
async function resumeCameraIfNeeded() {
  if (!root || root.hidden || document.hidden || !state) return;

  // 初回起動・再取得の途中なら、その処理を優先して横からgetUserMediaを重ねない。
  if (cameraStartingSessionId !== null) return;

  const liveTrack = stream?.getVideoTracks?.().find((track) => track.readyState === 'live');
  if (liveTrack) {
    try {
      if (video.srcObject !== stream) video.srcObject = stream;
      if (video.paused) await video.play();
      setCameraReady(true);
      return;
    } catch (error) {
      console.warn('Existing camera stream resume failed:', error);
    }
  }

  // live trackが存在しない時だけ新しいStreamを取得する。
  try {
    await startCameraStream();
  } catch (error) {
    console.warn('Camera resume failed:', error);
    setCameraReady(false, 'カメラを再起動してください');
  }
}

function handleResize() {
  if (root && !root.hidden && state) updateCameraUi();
}

export function initializeCameraController(options = {}) {
  optionsProvider = options.getOptions || (() => ({ visualRooms: [], samplingTargets: [] }));
  onPhotoSaved = options.onPhotoSaved || null;
  ensureCameraScreen();

  if (listenersBound) return;
  listenersBound = true;
  document.addEventListener('visibilitychange', resumeCameraIfNeeded);
  window.addEventListener('pageshow', resumeCameraIfNeeded);
  window.addEventListener('resize', handleResize);
}
