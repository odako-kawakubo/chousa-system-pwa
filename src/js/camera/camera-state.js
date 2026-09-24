/**
 * camera-state.js
 * 目視/採取の選択状態と撮影対象の遷移だけを担当する。
 */
import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { loadCameraPreferences } from './camera-preferences.js';

const STAGE_ORDER = Object.freeze([
  SHOOTING_TYPES.BEFORE,
  SHOOTING_TYPES.DURING,
  SHOOTING_TYPES.AFTER
]);

export const STAGE_INFO = Object.freeze({
  [SHOOTING_TYPES.BEFORE]: { code: '1', label: '施工前' },
  [SHOOTING_TYPES.DURING]: { code: '2', label: '施工中' },
  [SHOOTING_TYPES.AFTER]: { code: '3', label: '施工後' }
});

function cycleIndex(index, length, delta) {
  if (!length) return 0;
  return (index + delta + length) % length;
}

export function currentVisualTarget(state) {
  const room = state?.visualRooms?.[state.visualRoomIndex] || {};
  const target = room.targets?.[state.visualPartIndex] || {};
  return { room, target };
}

export function currentSamplingTarget(state) {
  return state?.samplingTargets?.[state.samplingIndex] || {};
}

export function samplingDisplayNo(target = {}) {
  const marks = { 1: '①', 2: '②', 3: '③' };
  const base = String(target.sampleBaseNo || target.sampleNo || '').trim();
  const mark = marks[Number(target.branch || 0)] || '';
  return `${base}${mark ? `-${mark}` : ''}`;
}

export function currentStageInfo(state) {
  return STAGE_INFO[state?.stage] || STAGE_INFO[SHOOTING_TYPES.BEFORE];
}

export function currentShootingType(state) {
  if (state?.photoType !== PHOTO_TYPES.SAMPLING) return '';
  return state.sectionMode ? SHOOTING_TYPES.SECTION : state.stage;
}

export function currentStatusCode(state) {
  if (state?.photoType === PHOTO_TYPES.VISUAL) return '5';
  if (state?.sectionMode) return '4';
  return currentStageInfo(state).code;
}

export function createCaptureSnapshot(state) {
  const common = {
    photoType: state.photoType,
    boardPosition: state.boardPosition,
    boardSize: state.boardSize,
    quality: state.quality,
    capturedAt: new Date().toISOString()
  };

  if (state.photoType === PHOTO_TYPES.SAMPLING) {
    const target = currentSamplingTarget(state);
    return {
      ...common,
      materialId: target.materialId || '',
      samplingPlace: target.samplingPlace || '',
      samplingBranch: Number(target.branch || 0),
      sampleNo: samplingDisplayNo(target),
      sampleBaseNo: String(target.sampleBaseNo || target.sampleNo || ''),
      part: target.part || '',
      shootingType: currentShootingType(state),
      sectionMode: Boolean(state.sectionMode)
    };
  }

  const { room, target } = currentVisualTarget(state);
  return {
    ...common,
    roomUid: room.roomUid || '',
    roomPosition: room.roomPosition || '',
    roomNo: room.roomNo || '',
    roomName: room.roomName || '',
    areaCode: room.areaCode || '',
    partSlot: Number(target.partSlot || 0),
    part: target.part || ''
  };
}

export function locateInitialCameraState(initialContext = {}, options = {}) {
  const next = {
    photoType: initialContext.photoType === PHOTO_TYPES.SAMPLING ? PHOTO_TYPES.SAMPLING : PHOTO_TYPES.VISUAL,
    visualRooms: Array.isArray(options.visualRooms) ? options.visualRooms : [],
    samplingTargets: Array.isArray(options.samplingTargets) ? options.samplingTargets : [],
    visualRoomIndex: 0,
    visualPartIndex: 0,
    samplingIndex: 0,
    stage: STAGE_ORDER.includes(initialContext.shootingType) ? initialContext.shootingType : SHOOTING_TYPES.BEFORE,
    sectionMode: initialContext.shootingType === SHOOTING_TYPES.SECTION,
    ...loadCameraPreferences()
  };

  if (next.photoType === PHOTO_TYPES.VISUAL) {
    const roomIndex = next.visualRooms.findIndex((room) => (
      room.areaCode === initialContext.areaCode
      && room.roomPosition === initialContext.roomPosition
    ));
    next.visualRoomIndex = Math.max(0, roomIndex);
    const room = next.visualRooms[next.visualRoomIndex];
    const partIndex = room?.targets?.findIndex((target) => Number(target.partSlot || 0) === Number(initialContext.partSlot || 0)) ?? -1;
    next.visualPartIndex = Math.max(0, partIndex);
  } else {
    const samplingIndex = next.samplingTargets.findIndex((target) => (
      target.materialId === initialContext.materialId
      && Number(target.branch) === Number(initialContext.samplingBranch || initialContext.branch)
    ));
    next.samplingIndex = Math.max(0, samplingIndex);
  }

  return next;
}

export function cycleVisualRoom(state, delta) {
  state.visualRoomIndex = cycleIndex(state.visualRoomIndex, state.visualRooms.length, delta);
  state.visualPartIndex = 0;
}

export function cycleVisualPart(state, delta) {
  const { room } = currentVisualTarget(state);
  state.visualPartIndex = cycleIndex(state.visualPartIndex, room.targets?.length || 0, delta);
}

export function cycleSamplingSample(state, delta) {
  const current = currentSamplingTarget(state);
  const numbers = [...new Set(state.samplingTargets.map((item) => String(item.sampleBaseNo || item.sampleNo || '')))];
  const currentValue = String(current.sampleBaseNo || current.sampleNo || '');
  const currentIndex = Math.max(0, numbers.indexOf(currentValue));
  const nextValue = numbers[cycleIndex(currentIndex, numbers.length, delta)];
  const nextIndex = state.samplingTargets.findIndex((item) => String(item.sampleBaseNo || item.sampleNo || '') === nextValue);
  state.samplingIndex = Math.max(0, nextIndex);
}

export function cycleSamplingBranch(state, delta) {
  const current = currentSamplingTarget(state);
  if (!current) return;
  const currentSample = String(current.sampleBaseNo || current.sampleNo || '');
  const sameSample = state.samplingTargets
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.sampleBaseNo || item.sampleNo || '') === currentSample);
  const localIndex = Math.max(0, sameSample.findIndex(({ index }) => index === state.samplingIndex));
  const next = sameSample[cycleIndex(localIndex, sameSample.length, delta)];
  if (next) state.samplingIndex = next.index;
}

export function cycleStage(state) {
  state.sectionMode = false;
  const index = Math.max(0, STAGE_ORDER.indexOf(state.stage));
  state.stage = STAGE_ORDER[cycleIndex(index, STAGE_ORDER.length, 1)];
}

export function toggleSectionMode(state) {
  state.sectionMode = !state.sectionMode;
}
