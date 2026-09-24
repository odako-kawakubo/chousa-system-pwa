/**
 * camera-preferences.js
 * カメラ端末設定の保存・復元だけを担当する。
 */
import { BOARD_POSITIONS } from './camera-board.js';

export const CAMERA_QUALITY = Object.freeze({
  standard: { width: 3024, height: 2268, label: '標準' },
  high: { width: 3264, height: 2448, label: '高画質' }
});

export const BOARD_SIZE_ORDER = Object.freeze(['small', 'medium', 'large']);

const STORAGE_KEY = 'chousa-camera-preferences-v1';
const LEGACY_STORAGE_KEY = 'chousa-camera:SAMPLE-001';

export function loadCameraPreferences() {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    const legacyRaw = currentRaw ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
    const saved = JSON.parse(currentRaw || legacyRaw || '{}');

    if (!currentRaw && legacyRaw) {
      localStorage.setItem(STORAGE_KEY, legacyRaw);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    return {
      boardPosition: BOARD_POSITIONS.includes(saved.boardPosition) ? saved.boardPosition : 'bottom-left',
      boardSize: BOARD_SIZE_ORDER.includes(saved.boardSize) ? saved.boardSize : 'medium',
      quality: CAMERA_QUALITY[saved.quality] ? saved.quality : 'standard',
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

export function saveCameraPreferences(state = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    boardPosition: state.boardPosition,
    boardSize: state.boardSize,
    quality: state.quality,
    landscapeFlipped: Boolean(state.landscapeFlipped)
  }));
}
