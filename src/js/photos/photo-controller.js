/**
 * src/js/photos/photo-controller.js
 *
 * 写真タブ全体の状態・描画・初期化を調整するController。
 * - DOMイベントは photo-interactions.js
 * - Record操作/保存は photo-record-actions.js
 * - サムネイル/プレビュー管理は photo-preview-manager.js
 * - Viewer用写真集合は photo-viewer-data.js
 * - 看板編集は photo-board-editor.js 以下の専用module
 * に分離し、このControllerは画面状態と各機能の接続を担当する。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { buildVisualPhotoView, buildSamplingPhotoView } from './photo-view-model.js';
import { renderPhotoShell, renderVisualView, renderSamplingView, renderVisualTargetBlock, renderSamplingPointBlock } from './photo-renderer.js';
import { initializePhotoViewer, closePhotoViewer } from './photo-viewer.js';
import { photosForViewer, compareTargetsForViewer } from './photo-viewer-data.js';
import {
  previewSourceForPhoto,
  hydrateThumbnailImages,
  hydrateCurrentPhotoPreviews,
  resetPhotoPreviewManager,
  getLocalPreviewCount
} from './photo-preview-manager.js';
import { initializeCameraController } from '../camera/camera-controller.js';
import { initializePhotoBoardEditor, openPhotoBoardEditor } from './photo-board-editor.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';
import {
  importPickedPhotoFiles,
  registerCapturedPhoto,
  startPhotoEditSequence,
  deletePhotos
} from './photo-record-actions.js';
import { bindPhotoInteractions } from './photo-interactions.js';

const state = {
  mode: 'visual',
  selectedRoomUid: '',
  selectedMaterialId: '',
  openVisualKeys: new Set(),
  openSamplingKeys: new Set(),
  collapsedLocationGroups: new Set(),
  pendingImportContext: null,
  listScrollTop: { visual: 0, sampling: 0 },
  reviewScrollTop: { visual: 0, sampling: 0 },
  selectionMode: null,
  selectedPhotoIds: new Set()
};

let root = null;
let body = null;
let renderedMode = 'visual';

function rememberPhotoScroll(mode = renderedMode) {
  if (!body) return;
  const list = body.querySelector('.photo-target-list');
  const review = body.querySelector('.photo-review-panel');
  if (list) state.listScrollTop[mode] = list.scrollTop;
  if (review) state.reviewScrollTop[mode] = review.scrollTop;
}

function restorePhotoScroll() {
  if (!body) return;
  const list = body.querySelector('.photo-target-list');
  const review = body.querySelector('.photo-review-panel');
  const listTop = Number(state.listScrollTop[state.mode] || 0);
  const reviewTop = Number(state.reviewScrollTop[state.mode] || 0);
  requestAnimationFrame(() => {
    if (list) list.scrollTop = listTop;
    if (review) review.scrollTop = reviewTop;
  });
}

function applySelectionUi() {
  if (!root) return;
  const panel = root.querySelector('.photo-panel');
  const mode = state.selectionMode;
  panel?.classList.toggle('photo-selection-mode', Boolean(mode));
  panel?.classList.toggle('photo-selection-edit', mode === 'edit');
  panel?.classList.toggle('photo-selection-delete', mode === 'delete');

  root.querySelectorAll('[data-photo-selection-mode]').forEach((button) => {
    const buttonMode = button.dataset.photoSelectionMode;
    const active = mode === buttonMode;
    const count = state.selectedPhotoIds.size;
    button.classList.toggle('active', active);
    button.textContent = active && count
      ? `${buttonMode === 'delete' ? '削除する' : '編集する'}（${count}）`
      : (buttonMode === 'delete' ? '削除' : '編集');
  });

  root.querySelectorAll('.photo-thumb-card[data-photo-id]').forEach((card) => {
    card.classList.toggle('photo-selected', state.selectedPhotoIds.has(card.dataset.photoId || ''));
  });
}

function clearSelectionMode({ renderNow = false } = {}) {
  state.selectionMode = null;
  state.selectedPhotoIds.clear();
  if (renderNow) render();
  else applySelectionUi();
}

function render() {
  if (!root) return;
  rememberPhotoScroll(renderedMode);
  if (!body) body = root.querySelector('#photoModeBody');

  root.querySelectorAll('[data-photo-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.photoMode === state.mode);
  });

  if (state.mode === 'sampling') {
    const view = buildSamplingPhotoView(state.selectedMaterialId);
    state.selectedMaterialId = view.activeMaterial?.materialId || '';
    renderSamplingView(body, view, state);
    hydrateThumbnailImages(root);
    applySelectionUi();
    renderedMode = state.mode;
    restorePhotoScroll();
    return;
  }

  const view = buildVisualPhotoView(state.selectedRoomUid);
  state.selectedRoomUid = view.activeRoom?.roomUid || '';
  renderVisualView(body, view, state);
  hydrateThumbnailImages(root);
  applySelectionUi();
  renderedMode = state.mode;
  restorePhotoScroll();
}

function photoById(photoId) {
  return photoRecordStore.get(photoId);
}

function openFilePicker(context) {
  const picker = root.querySelector('#photoFilePicker');
  if (!picker || !context) return;
  state.pendingImportContext = context;
  picker.value = '';
  picker.click();
}

function externalImportContext() {
  if (state.mode === 'sampling') {
    const view = buildSamplingPhotoView(state.selectedMaterialId);
    const material = view.activeMaterial;
    if (!material) return null;
    return { photoType: PHOTO_TYPES.SAMPLING, materialId: material.materialId };
  }

  const view = buildVisualPhotoView(state.selectedRoomUid);
  if (!view.activeRoom) return null;
  return {
    photoType: PHOTO_TYPES.VISUAL,
    areaCode: view.activeRoom.areaCode,
    roomPosition: view.activeRoom.roomPosition,
    roomNo: view.activeRoom.roomNo || ''
  };
}

async function addPickedFiles(fileList) {
  const context = state.pendingImportContext;
  state.pendingImportContext = null;
  const stored = await importPickedPhotoFiles(context, fileList);
  if (stored.length) render();
}

function visualContextFromKey(key) {
  const view = buildVisualPhotoView(state.selectedRoomUid);
  const target = view.targets.find((item) => item.key === key);
  if (!target) return null;
  return { photoType: PHOTO_TYPES.VISUAL, areaCode: target.areaCode, roomPosition: target.roomPosition, partSlot: target.partSlot, roomNo: view.activeRoom?.roomNo || '', part: target.part };
}

function samplingContextFromKey(key, shootingType) {
  const view = buildSamplingPhotoView(state.selectedMaterialId);
  const material = view.activeMaterial;
  const point = material?.points.find((item) => item.key === key);
  if (!material || !point) return null;

  return {
    photoType: PHOTO_TYPES.SAMPLING,
    materialId: material.materialId,
    samplingPlace: point.samplingPlace,
    branch: point.branch,
    sampleNo: point.sampleNo,
    part: point.part,
    shootingType
  };
}

function samplingDefaultContextFromKey(key) {
  const view = buildSamplingPhotoView(state.selectedMaterialId);
  const point = view.activeMaterial?.points.find((item) => item.key === key);
  const nextStage = point?.stages.find((stage) => stage.shootingType !== SHOOTING_TYPES.SECTION && stage.count === 0)?.shootingType || SHOOTING_TYPES.BEFORE;
  return samplingContextFromKey(key, nextStage);
}

function buildCameraOptions() {
  const visual = buildVisualPhotoView('');
  const visualRooms = visual.rooms.map((room) => {
    const roomView = buildVisualPhotoView(room.roomUid);
    return {
      roomUid: room.roomUid,
      areaCode: room.areaCode,
      roomPosition: room.roomPosition,
      roomNo: room.roomNo,
      roomName: room.roomName,
      targets: roomView.targets.map((target) => ({ partSlot: target.partSlot, part: target.part }))
    };
  });

  const sampling = buildSamplingPhotoView('');
  const samplingTargets = sampling.materials.flatMap((material) => material.points.map((point) => ({
    materialId: material.materialId,
    materialNo: material.materialNo,
    sampleBaseNo: String(material.sampleNo || ''),
    sampleNo: point.sampleNo,
    samplingPlace: point.samplingPlace,
    branch: point.branch,
    part: point.part
  })));

  return { visualRooms, samplingTargets };
}

async function registerCameraPreview(item, { renderAfter = true } = {}) {
  return registerCapturedPhoto(item, {
    renderAfter,
    refreshBlock: refreshCameraPhotoBlock
  });
}

function globalCameraContext() {
  if (state.mode === 'sampling') {
    const view = buildSamplingPhotoView(state.selectedMaterialId);
    const material = view.activeMaterial;
    const point = material?.points?.[0];
    if (!material || !point) return null;
    return {
      photoType: PHOTO_TYPES.SAMPLING,
      materialId: material.materialId,
      branch: point.branch,
      samplingBranch: point.branch,
      shootingType: SHOOTING_TYPES.BEFORE
    };
  }
  const view = buildVisualPhotoView(state.selectedRoomUid);
  const target = view.targets?.[0];
  if (!view.activeRoom || !target) return null;
  return { photoType: PHOTO_TYPES.VISUAL, areaCode: view.activeRoom.areaCode, roomPosition: view.activeRoom.roomPosition, partSlot: target.partSlot, part: target.part };
}

function findElementByDataValue(selector, datasetKey, value) {
  return [...(root?.querySelectorAll(selector) || [])]
    .find((element) => String(element.dataset?.[datasetKey] || '') === String(value || '')) || null;
}

function refreshCameraPhotoBlock(record) {
  if (!root || !record?.photoId) return false;

  if (record.photoType === PHOTO_TYPES.VISUAL) {
    const view = buildVisualPhotoView(state.selectedRoomUid);
    if (!view.activeRoom
      || view.activeRoom.areaCode !== record.areaCode
      || view.activeRoom.roomPosition !== record.roomPosition) {
      return false;
    }

    const target = view.targets.find((item) => Number(item.partSlot) === Number(record.partSlot));
    if (!target) return false;
    const current = findElementByDataValue('[data-photo-target-key]', 'photoTargetKey', target.key);
    if (!current) return false;
    current.outerHTML = renderVisualTargetBlock(target, state.openVisualKeys);
    const updated = findElementByDataValue('[data-photo-target-key]', 'photoTargetKey', target.key);
    hydrateThumbnailImages(updated);
    return Boolean(updated);
  }

  if (record.photoType === PHOTO_TYPES.SAMPLING) {
    const view = buildSamplingPhotoView(state.selectedMaterialId);
    if (!view.activeMaterial || view.activeMaterial.materialId !== record.materialId) return false;
    const point = view.activeMaterial.points.find((item) => Number(item.branch) === Number(record.samplingBranch));
    if (!point) return false;
    const current = findElementByDataValue('[data-photo-sampling-point-key]', 'photoSamplingPointKey', point.key);
    if (!current) return false;
    current.outerHTML = renderSamplingPointBlock(point, state.openSamplingKeys);
    const updated = findElementByDataValue('[data-photo-sampling-point-key]', 'photoSamplingPointKey', point.key);
    hydrateThumbnailImages(updated);
    return Boolean(updated);
  }

  return false;
}

async function startEditSequence(photoIds) {
  clearSelectionMode();
  try {
    await startPhotoEditSequence(photoIds);
  } catch (error) {
    console.error(error);
    window.alert(`看板編集を開始できませんでした。\n${error.message || error}`);
  }
}

async function deleteSelectedPhotos(photoIds) {
  const ids = [...photoIds].filter((photoId) => {
    const record = photoById(photoId);
    return record && !record.deleted;
  });
  if (!ids.length) return;
  if (!window.confirm(`選択した${ids.length}枚の写真を削除しますか？`)) return;

  await deletePhotos(ids);
  clearSelectionMode({ renderNow: true });
}

function togglePhotoSelection(photoId) {
  if (!photoId || !state.selectionMode) return;
  if (state.selectedPhotoIds.has(photoId)) state.selectedPhotoIds.delete(photoId);
  else state.selectedPhotoIds.add(photoId);
  applySelectionUi();
}

/** 案件切替時だけ呼ぶ。写真UI状態と案件依存プレビューを次案件へ持ち越さない。 */
export function resetPhotoUiStateForProject() {
  resetPhotoPreviewManager();

  state.mode = 'visual';
  state.selectedRoomUid = '';
  state.selectedMaterialId = '';
  state.openVisualKeys = new Set();
  state.openSamplingKeys = new Set();
  state.collapsedLocationGroups = new Set();
  state.pendingImportContext = null;
  state.listScrollTop = { visual: 0, sampling: 0 };
  state.reviewScrollTop = { visual: 0, sampling: 0 };
  state.selectionMode = null;
  state.selectedPhotoIds = new Set();
  renderedMode = 'visual';

  const visual = buildVisualPhotoView('');
  state.selectedRoomUid = visual.activeRoom?.roomUid || '';
  if (state.selectedRoomUid) buildVisualPhotoView(state.selectedRoomUid);
  const sampling = buildSamplingPhotoView('');
  state.selectedMaterialId = sampling.activeMaterial?.materialId || '';
}

export function refreshPhotoTab() {
  syncDiagnosticLog('PHOTO_REFRESH_TAB', {
    mode: state.mode,
    selectedRoomUid: state.selectedRoomUid,
    selectedMaterialId: state.selectedMaterialId,
    localPreviewCount: getLocalPreviewCount()
  });
  render();
  void hydrateCurrentPhotoPreviews(root).then(() => hydrateThumbnailImages(root));
}

export function initializePhotoTab() {
  root = document.getElementById('photos');
  if (!root) return;

  renderPhotoShell(root, state.mode);
  body = root.querySelector('#photoModeBody');
  bindPhotoInteractions({
    root,
    state,
    render,
    applySelectionUi,
    clearSelectionMode,
    togglePhotoSelection,
    deleteSelectedPhotos,
    startEditSequence,
    visualContextFromKey,
    samplingContextFromKey,
    samplingDefaultContextFromKey,
    globalCameraContext,
    externalImportContext,
    openFilePicker,
    addPickedFiles
  });

  initializePhotoViewer({
    getPhotosForPhoto: photosForViewer,
    getPhotoSource: previewSourceForPhoto,
    getCompareTargets: compareTargetsForViewer,
    onEditPhoto: async (photoId) => {
      const opened = await openPhotoBoardEditor(photoId);
      if (opened) closePhotoViewer();
    }
  });

  initializeCameraController({
    getOptions: buildCameraOptions,
    onPhotoSaved: registerCameraPreview
  });

  initializePhotoBoardEditor({
    getOptions: buildCameraOptions,
    onSaved: async ({ items = [] } = {}) => {
      for (const item of items) await registerCameraPreview(item, { renderAfter: false });
      render();
    }
  });

  render();
  void hydrateCurrentPhotoPreviews(root).then(() => hydrateThumbnailImages(root));
  window.addEventListener('online', () => {
    void hydrateCurrentPhotoPreviews(root).then(() => hydrateThumbnailImages(root));
  });
}