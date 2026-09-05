/**
 * src/js/photos/photo-controller.js
 *
 * 写真タブの状態・イベント・photoRecordStore更新を担当する。
 * v0.1.6.5Lでは他端末写真の表示経路を追加する。
 * - サムネイルはOneDriveの軽量サムネイルを自動取得する。
 * - 拡大時だけ完成画像本体を取得し、IndexedDBへ保持する。
 * - 一度取得した完成画像は以後ローカル表示を優先する。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { createPhotoRecord, getVisualPhotoRoomKey, getVisualPhotoTargetKey, isSamplingPhotoUnorganized, isVisualPhotoUnorganized, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { buildVisualPhotoView, buildSamplingPhotoView } from './photo-view-model.js';
import { renderPhotoShell, renderVisualView, renderSamplingView } from './photo-renderer.js';
import { initializePhotoViewer, openPhotoViewer, closePhotoViewer } from './photo-viewer.js';
import { initializeCameraController, openCamera } from '../camera/camera-controller.js';
import { getPhotoBlob, saveCapturedPhoto, saveRemoteCompletedPhoto, updateCameraPhotoRecord } from './photo-local-store.js';
import { fetchRemoteCompletedPhoto, fetchRemotePhotoThumbnail, hasRemoteCompletedPhoto } from './photo-remote-reader.js';
import { initializePhotoBoardEditor, openPhotoBoardEditor, openPhotoBoardEditorSequence } from './photo-board-editor.js';
import { getDeviceCode } from '../device-code.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';

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

const localPreviewUrls = new Map();
const remoteThumbnailUrls = new Map();
const remoteThumbnailFetches = new Map();
const SAMPLE_STAGE_ORDER = [
  SHOOTING_TYPES.BEFORE,
  SHOOTING_TYPES.DURING,
  SHOOTING_TYPES.AFTER,
  SHOOTING_TYPES.SECTION
];

const PHOTO_COMMON_CREATE_EDIT_FIELDS = Object.freeze([
  'photoType', 'fileName', 'isRepresentative', 'capturedDevice', 'capturedAt',
  'isEdited', 'lastEditedDevice', 'lastEditedAt', 'deleted', 'systemMemo',
  'boardPosition', 'boardSize', 'originalPath', 'completedPath'
]);

function photoCreateEditFields(record) {
  return record?.photoType === PHOTO_TYPES.VISUAL
    ? [...PHOTO_COMMON_CREATE_EDIT_FIELDS, 'areaCode', 'roomPosition', 'partSlot']
    : [...PHOTO_COMMON_CREATE_EDIT_FIELDS, 'materialId', 'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType'];
}

function photoWithEditedFields(record, fields = null, confirmedAt = Date.now()) {
  return createPhotoRecord({
    ...record,
    fieldEditedAt: touchFieldEditedAt(record?.fieldEditedAt, fields || photoCreateEditFields(record), confirmedAt)
  });
}

function persistPhoto(record) {
  return persistPhotoForProject(getCurrentProject(), record, 'photo-controller-save');
}

let root = null;
let body = null;
let unsubscribePhotoStore = null;
let unsubscribeMaterialStore = null;
let unsubscribeFinishStore = null;
let storeRenderQueued = false;
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
    hydrateThumbnailImages();
    applySelectionUi();
    renderedMode = state.mode;
    restorePhotoScroll();
    return;
  }

  const view = buildVisualPhotoView(state.selectedRoomUid);
  state.selectedRoomUid = view.activeRoom?.roomUid || '';
  renderVisualView(body, view, state);
  hydrateThumbnailImages();
  applySelectionUi();
  renderedMode = state.mode;
  restorePhotoScroll();
}

function photoById(photoId) {
  return photoRecordStore.get(photoId);
}

function revokePreviewUrl(map, photoId) {
  const value = map.get(photoId);
  if (value && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value);
  map.delete(photoId);
}

function setLocalPreview(photoId, blob) {
  if (!photoId || !(blob instanceof Blob) || typeof URL.createObjectURL !== 'function') return;
  revokePreviewUrl(localPreviewUrls, photoId);
  revokePreviewUrl(remoteThumbnailUrls, photoId);
  localPreviewUrls.set(photoId, URL.createObjectURL(blob));
}

function setRemoteThumbnail(photoId, blob) {
  if (!photoId || !(blob instanceof Blob) || typeof URL.createObjectURL !== 'function') return;
  if (localPreviewUrls.has(photoId)) return;
  revokePreviewUrl(remoteThumbnailUrls, photoId);
  remoteThumbnailUrls.set(photoId, URL.createObjectURL(blob));
}

async function ensureRemoteThumbnail(photo) {
  const photoId = String(photo?.photoId || '');
  if (!photoId || photo.deleted || localPreviewUrls.has(photoId) || remoteThumbnailUrls.has(photoId)) return;
  if (!hasRemoteCompletedPhoto(photo) || remoteThumbnailFetches.has(photoId)) return;

  const fetchPromise = fetchRemotePhotoThumbnail(photo)
    .then((blob) => {
      if (!(blob instanceof Blob) || !photoById(photoId) || localPreviewUrls.has(photoId)) return;
      setRemoteThumbnail(photoId, blob);
      hydrateThumbnailImages();
    })
    .catch(() => undefined)
    .finally(() => remoteThumbnailFetches.delete(photoId));

  remoteThumbnailFetches.set(photoId, fetchPromise);
  await fetchPromise;
}

/**
 * サムネイルはローカル完成画像を最優先し、無い写真だけOneDriveサムネイルを非同期取得する。
 * 他端末写真の完成画像本体はここでは保存しない。
 */
function hydrateThumbnailImages() {
  if (!root) return;

  root.querySelectorAll('[data-photo-thumb-image]').forEach((image) => {
    const photoId = image.dataset.photoThumbImage || '';
    const photo = photoById(photoId);
    const card = image.closest('.photo-thumb-card');
    const source = photo ? previewSourceForPhoto(photo) : '';

    if (!source) {
      image.removeAttribute('src');
      card?.classList.remove('photo-thumb-ready');
      card?.classList.add('photo-thumb-loading');
      if (photo) void ensureRemoteThumbnail(photo);
      return;
    }

    if (image.getAttribute('src') !== source) image.src = source;
    image.onload = () => {
      card?.classList.add('photo-thumb-ready');
      card?.classList.remove('photo-thumb-loading');
    };
    image.onerror = () => {
      card?.classList.remove('photo-thumb-ready');
      card?.classList.add('photo-thumb-loading');
    };

    if (image.complete && image.naturalWidth > 0) {
      card?.classList.add('photo-thumb-ready');
      card?.classList.remove('photo-thumb-loading');
    }
  });
}

function nextPhotoId() {
  return `I-${getDeviceCode()}-${Date.now()}`;
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
  const files = [...(fileList || [])].filter((file) => file instanceof Blob);
  if (!context || !files.length) return;

  for (const file of files) {
    const photoId = nextPhotoId();
    const capturedAt = new Date().toISOString();
    const common = {
      photoId,
      fileName: String(file.name || `${photoId}.jpg`),
      capturedDevice: getDeviceCode(),
      capturedAt,
      syncStatus: 'pending',
      localOriginalStatus: 'saved',
      localCompletedStatus: 'saved'
    };

    const record = photoWithEditedFields(createPhotoRecord(context.photoType === PHOTO_TYPES.VISUAL
      ? {
          ...common,
          photoType: PHOTO_TYPES.VISUAL,
          areaCode: context.areaCode,
          roomPosition: context.roomPosition,
          partSlot: 0,
          roomNo: context.roomNo,
          part: ''
        }
      : {
          ...common,
          photoType: PHOTO_TYPES.SAMPLING,
          materialId: context.materialId,
          samplingPlace: '',
          samplingBranch: 0,
          sampleNo: '',
          sampleBaseNo: '',
          part: '',
          shootingType: ''
        }));

    await saveCapturedPhoto({ record, originalBlob: file, completedBlob: file });
    setLocalPreview(photoId, file);

    const stored = photoRecordStore.set(record);
    await updateCameraPhotoRecord(stored);
    await persistPhoto(stored);
  }
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

async function registerCameraPreview({ record, completedBlob }) {
  setLocalPreview(record?.photoId, completedBlob);

  if (record?.photoId) {
    await updateCameraPhotoRecord(record);
    await persistPhoto(record);
  }
}

async function hydrateCurrentPhotoPreviews() {
  try {
    const activeIds = new Set(photoRecordStore.getAll().map((record) => record.photoId));
    for (const map of [localPreviewUrls, remoteThumbnailUrls]) {
      for (const photoId of [...map.keys()]) {
        if (!activeIds.has(photoId)) revokePreviewUrl(map, photoId);
      }
    }

    for (const record of photoRecordStore.getAll()) {
      if (localPreviewUrls.has(record.photoId)) continue;
      const blob = await getPhotoBlob(record.photoId, 'completed');
      if (blob && typeof URL.createObjectURL === 'function') {
        setLocalPreview(record.photoId, blob);
        continue;
      }
      void ensureRemoteThumbnail(record);
    }
  } catch (error) {
    console.warn('現在案件の写真プレビュー復元に失敗しました', error);
  }
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

function photosForViewer(photoId) {
  const photo = photoById(photoId);
  if (!photo || photo.deleted) return [];

  if (photo.photoType === PHOTO_TYPES.VISUAL) {
    const photos = isVisualPhotoUnorganized(photo)
      ? photoRecordStore.getActive().filter((item) => (
          item.photoType === PHOTO_TYPES.VISUAL
          && item.areaCode === photo.areaCode
          && item.roomPosition === photo.roomPosition
          && isVisualPhotoUnorganized(item)
        ))
      : photoRecordStore.findVisual({ areaCode: photo.areaCode, roomPosition: photo.roomPosition, partSlot: photo.partSlot });

    return photos
      .sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId).localeCompare(String(b.photoId)));
  }

  const samplingPhotos = isSamplingPhotoUnorganized(photo)
    ? photoRecordStore.getActive().filter((item) => (
        item.photoType === PHOTO_TYPES.SAMPLING
        && item.materialId === photo.materialId
        && isSamplingPhotoUnorganized(item)
      ))
    : photoRecordStore.findSampling({ materialId: photo.materialId, samplingBranch: photo.samplingBranch });

  return samplingPhotos
    .sort((a, b) => {
      const stageDiff = SAMPLE_STAGE_ORDER.indexOf(a.shootingType) - SAMPLE_STAGE_ORDER.indexOf(b.shootingType);
      if (stageDiff) return stageDiff;
      return String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId).localeCompare(String(b.photoId));
    });
}

function demoPreviewSource(photo) {
  if (!String(photo?.photoId || '').startsWith('DEMO-PHOTO-')) return '';
  const label = photo.photoType === PHOTO_TYPES.VISUAL
    ? `${photo.roomNo || photo.roomPosition || '-'} / ${photo.part || '-'}`
    : `${photo.sampleNo || '-'} / ${photo.shootingType || '-'}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#dbe4ef"/><rect x="100" y="120" width="1000" height="560" rx="24" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="8"/><text x="600" y="390" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="700" fill="#0f172a">${label}</text><text x="600" y="465" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#334155">比較UI確認用デモ写真</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function previewSourceForPhoto(photo) {
  const local = localPreviewUrls.get(photo.photoId);
  if (local) return local;

  const demo = demoPreviewSource(photo);
  if (demo) return demo;

  return remoteThumbnailUrls.get(photo.photoId) || '';
}

async function openViewerForThumb(photoId) {
  const photo = photoById(photoId);
  if (!photo || photo.deleted) return;

  let completedBlob = await getPhotoBlob(photoId, 'completed');
  if (!completedBlob && hasRemoteCompletedPhoto(photo)) {
    try {
      completedBlob = await fetchRemoteCompletedPhoto(photo);
      if (completedBlob instanceof Blob) {
        await saveRemoteCompletedPhoto({
          record: photo,
          blob: completedBlob,
          projectId: String(getCurrentProject()?.projectId || '')
        });
        setLocalPreview(photoId, completedBlob);
        render();
      }
    } catch (error) {
      console.warn('他端末写真の完成画像取得に失敗しました', { photoId, error });
      window.alert('写真本体を取得できませんでした。通信状態を確認してもう一度お試しください。');
      return;
    }
  } else if (completedBlob && !localPreviewUrls.has(photoId)) {
    setLocalPreview(photoId, completedBlob);
  }

  openPhotoViewer(photoId);
}

async function startEditSequence(photoIds) {
  const ids = [...photoIds].filter((photoId) => photoById(photoId) && !photoById(photoId).deleted);
  clearSelectionMode();
  if (!ids.length) return;

  for (const photoId of ids) {
    const original = await getPhotoBlob(photoId, 'original');
    if (!original) {
      window.alert('この写真は他端末で撮影されたため、この端末では看板編集できません。');
      return;
    }
  }

  openPhotoBoardEditorSequence(ids).catch((error) => {
    console.error(error);
    window.alert(`看板編集を開始できませんでした。\n${error.message || error}`);
  });
}

async function deleteSelectedPhotos(photoIds) {
  const ids = [...photoIds].filter((photoId) => photoById(photoId) && !photoById(photoId).deleted);
  if (!ids.length) return;
  if (!window.confirm(`選択した${ids.length}枚の写真を削除しますか？`)) return;

  const before = new Map(photoRecordStore.getAll().map((record) => [record.photoId, { ...record }]));
  photoRecordStore.batch(() => {
    ids.forEach((photoId) => {
      revokePreviewUrl(localPreviewUrls, photoId);
      revokePreviewUrl(remoteThumbnailUrls, photoId);
      photoRecordStore.markDeleted(photoId);
    });
  });

  const changed = [];
  photoRecordStore.getAll().forEach((record) => {
    const previous = before.get(record.photoId);
    const fields = [];
    if (Boolean(previous?.deleted) !== Boolean(record.deleted)) fields.push('deleted');
    if (Boolean(previous?.isRepresentative) !== Boolean(record.isRepresentative)) fields.push('isRepresentative');
    if (!fields.length) return;
    const next = photoRecordStore.set({
      ...record,
      fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, fields)
    });
    changed.push(next);
  });

  await Promise.all(changed.map(async (record) => {
    await updateCameraPhotoRecord(record);
    await persistPhoto(record);
  }));
  clearSelectionMode({ renderNow: true });
}

function togglePhotoSelection(photoId) {
  if (!photoId || !state.selectionMode) return;
  if (state.selectedPhotoIds.has(photoId)) state.selectedPhotoIds.delete(photoId);
  else state.selectedPhotoIds.add(photoId);
  applySelectionUi();
}

function bindPhotoTabExitReset() {
  document.querySelectorAll('.tabs .tab[data-tab]').forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      if (tabButton.dataset.tab !== 'photos' && state.selectionMode) clearSelectionMode();
    });
  });
}

function bindEvents() {
  root.addEventListener('click', (event) => {
    const selectionButton = event.target.closest('[data-photo-selection-mode]');
    if (selectionButton) {
      const requestedMode = selectionButton.dataset.photoSelectionMode === 'delete' ? 'delete' : 'edit';
      if (state.selectionMode === requestedMode) {
        if (!state.selectedPhotoIds.size) {
          clearSelectionMode();
        } else if (requestedMode === 'delete') {
          deleteSelectedPhotos(state.selectedPhotoIds).catch((error) => {
            console.error(error);
            window.alert(`写真の削除に失敗しました。\n${error.message || error}`);
          });
        } else {
          void startEditSequence(state.selectedPhotoIds);
        }
      } else {
        state.selectionMode = requestedMode;
        state.selectedPhotoIds.clear();
        applySelectionUi();
      }
      return;
    }

    const expandButton = event.target.closest('[data-photo-expand]');
    if (expandButton) {
      void openViewerForThumb(expandButton.dataset.photoExpand || '');
      return;
    }

    if (state.selectionMode) {
      const selectableThumb = event.target.closest('.photo-thumb-card[data-photo-id]');
      if (selectableThumb) {
        togglePhotoSelection(selectableThumb.dataset.photoId || '');
        return;
      }
    }

    const mode = event.target.closest('[data-photo-mode]');
    if (mode) {
      state.mode = mode.dataset.photoMode === 'sampling' ? 'sampling' : 'visual';
      state.reviewScrollTop[state.mode] = 0;
      render();
      return;
    }

    const listGroup = event.target.closest('[data-photo-list-group]');
    if (listGroup) {
      const key = listGroup.dataset.photoListGroup || '';
      state.collapsedLocationGroups.has(key) ? state.collapsedLocationGroups.delete(key) : state.collapsedLocationGroups.add(key);
      render();
      return;
    }

    const room = event.target.closest('[data-photo-room]');
    if (room) {
      state.selectedRoomUid = room.dataset.photoRoom || '';
      state.reviewScrollTop.visual = 0;
      render();
      return;
    }

    const material = event.target.closest('[data-photo-material]');
    if (material) {
      state.selectedMaterialId = material.dataset.photoMaterial || '';
      state.reviewScrollTop.sampling = 0;
      render();
      return;
    }

    const visualToggle = event.target.closest('[data-photo-toggle]');
    if (visualToggle) {
      const key = visualToggle.dataset.photoToggle || '';
      state.openVisualKeys.has(key) ? state.openVisualKeys.delete(key) : state.openVisualKeys.add(key);
      render();
      return;
    }

    const sampleToggle = event.target.closest('[data-photo-toggle-sampling]');
    if (sampleToggle) {
      const key = sampleToggle.dataset.photoToggleSampling || '';
      state.openSamplingKeys.has(key) ? state.openSamplingKeys.delete(key) : state.openSamplingKeys.add(key);
      render();
      return;
    }

    const representative = event.target.closest('[data-photo-representative]');
    if (representative) {
      const photoId = representative.dataset.photoRepresentative || '';
      const before = new Map(photoRecordStore.getAll().map((record) => [record.photoId, { ...record }]));
      if (!photoRecordStore.setRepresentative(photoId)) return;

      const changed = [];
      photoRecordStore.getAll().forEach((record) => {
        const previous = before.get(record.photoId);
        if (Boolean(previous?.isRepresentative) === Boolean(record.isRepresentative)) return;
        const next = photoRecordStore.set({
          ...record,
          fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, 'isRepresentative')
        });
        changed.push(next);
      });
      Promise.all(changed.map((record) => persistPhoto(record))).catch((error) => {
        console.error('代表写真のFirestore保存に失敗しました', error);
      });
      return;
    }

    const cameraVisual = event.target.closest('[data-photo-camera-visual]');
    if (cameraVisual) {
      const context = visualContextFromKey(cameraVisual.dataset.photoCameraVisual || '');
      if (context) openCamera(context);
      return;
    }

    const cameraSamplingStage = event.target.closest('[data-photo-camera-sampling-stage]');
    if (cameraSamplingStage) {
      const context = samplingContextFromKey(
        cameraSamplingStage.dataset.photoCameraSamplingStage || '',
        cameraSamplingStage.dataset.photoStage || ''
      );
      if (context) openCamera(context);
      return;
    }

    const cameraSampling = event.target.closest('[data-photo-camera-sampling]');
    if (cameraSampling) {
      const view = buildSamplingPhotoView(state.selectedMaterialId);
      const point = view.activeMaterial?.points.find((item) => item.key === (cameraSampling.dataset.photoCameraSampling || ''));
      const nextStage = point?.stages.find((stage) => stage.shootingType !== SHOOTING_TYPES.SECTION && stage.count === 0)?.shootingType || SHOOTING_TYPES.BEFORE;
      const context = samplingContextFromKey(cameraSampling.dataset.photoCameraSampling || '', nextStage);
      if (context) openCamera(context);
      return;
    }

    if (event.target.closest('[data-photo-camera-global]')) {
      const context = globalCameraContext();
      if (context) openCamera(context);
      else window.alert('撮影対象がありません。');
      return;
    }

    if (event.target.closest('[data-photo-picker]')) {
      const context = externalImportContext();
      if (context) openFilePicker(context);
      else window.alert('写真の取り込み先がありません。');
    }
  });

  root.querySelector('#photoFilePicker')?.addEventListener('change', (event) => {
    addPickedFiles(event.target.files).catch((error) => {
      console.error(error);
      window.alert(`写真の取り込みに失敗しました。\n${error.message || error}`);
    });
  });
}

function compareTargetsForViewer(context = {}) {
  const preferredMaterialId = String(context.preferredMaterialId || '').trim();
  const roomInfo = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || !record.areaCode || !record.roomPosition) return;
    const roomKey = getVisualPhotoRoomKey(record);
    if (!roomInfo.has(roomKey)) {
      roomInfo.set(roomKey, { areaCode: record.areaCode, roomPosition: record.roomPosition, roomNo: record.roomNo, roomName: record.roomName });
    }
  });

  const groups = new Map();
  photoRecordStore.getActive().filter((photo) => photo.photoType === PHOTO_TYPES.VISUAL).forEach((photo) => {
    const key = getVisualPhotoTargetKey(photo);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { key, areaCode: photo.areaCode, roomPosition: photo.roomPosition, partSlot: photo.partSlot, part: photo.part, photos: [] });
    groups.get(key).photos.push(photo);
  });

  const usedByPreferred = new Set();
  if (preferredMaterialId) {
    finishRecordStore.getAll().forEach((record) => {
      if (record.status !== 'active' || String(record.materialId || '') !== preferredMaterialId) return;
      const partSlot = Math.floor(Number(record.position || 0) / 100);
      if (record.areaCode && record.roomPosition && partSlot) usedByPreferred.add(getVisualPhotoTargetKey({ areaCode: record.areaCode, roomPosition: record.roomPosition, partSlot }));
    });
  }

  return [...groups.values()].map((group) => {
    const room = roomInfo.get(getVisualPhotoRoomKey(group)) || {};
    const no = String(room.roomNo || group.roomPosition || '-').trim();
    const name = String(room.roomName || '').trim();
    const roomLabel = name && name !== no ? `${no} ${name}` : no;
    return {
      ...group,
      label: `${roomLabel} / ${group.part}`,
      preferred: usedByPreferred.has(group.key),
      photos: group.photos.sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')))
    };
  }).sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return a.label.localeCompare(b.label, 'ja', { numeric: true });
  });
}

function scheduleStoreRender() {
  if (storeRenderQueued) return;
  storeRenderQueued = true;
  queueMicrotask(() => {
    storeRenderQueued = false;
    render();
  });
}

export function refreshPhotoTab() {
  render();
  hydrateCurrentPhotoPreviews().then(render);
}

export function initializePhotoTab() {
  root = document.getElementById('photos');
  if (!root) return;

  renderPhotoShell(root, state.mode);
  body = root.querySelector('#photoModeBody');
  bindEvents();
  bindPhotoTabExitReset();

  initializePhotoViewer({
    getPhotosForPhoto: photosForViewer,
    getPhotoSource: previewSourceForPhoto,
    getCompareTargets: compareTargetsForViewer,
    onEditPhoto: async (photoId) => {
      const original = await getPhotoBlob(photoId, 'original');
      if (!original) {
        window.alert('この写真は他端末で撮影されたため、この端末では看板編集できません。');
        return;
      }
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
      for (const item of items) await registerCameraPreview(item);
      render();
    }
  });

  render();
  hydrateCurrentPhotoPreviews().then(render);
  window.addEventListener('online', () => {
    hydrateCurrentPhotoPreviews().then(render);
  });

  if (unsubscribePhotoStore) unsubscribePhotoStore();
  if (unsubscribeMaterialStore) unsubscribeMaterialStore();
  if (unsubscribeFinishStore) unsubscribeFinishStore();

  unsubscribePhotoStore = photoRecordStore.subscribe(scheduleStoreRender);
  unsubscribeMaterialStore = materialRecordStore.subscribe(scheduleStoreRender);
  unsubscribeFinishStore = finishRecordStore.subscribe(scheduleStoreRender);
}
