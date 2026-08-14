/**
 * src/js/photos/photo-controller.js
 *
 * v0.1.5.3D 写真タブの状態・イベント・photoRecordStore更新を担当する。
 *
 * Dでの主な変更：
 * - 採取表示はmaterialRecordStoreの変更へ追従する。
 * - 目視表示はfinishRecordStore / materialRecordStoreの変更へ追従する。
 * - 写真サムネイルはダブルタップ／ダブルクリックで共通PhotoViewerを開く。
 * - ローカル写真選択時のObject URLはController内だけに保持し、photoRecordへ重複保存しない。
 *
 * カメラアプリ・OneDrive・Firestore同期はまだ接続しない。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import { createPhotoRecord, PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { buildVisualPhotoView, buildSamplingPhotoView } from './photo-view-model.js';
import { renderPhotoShell, renderVisualView, renderSamplingView } from './photo-renderer.js';
import { initializePhotoViewer, openPhotoViewer } from './photo-viewer.js';

const state = {
  mode: 'visual',
  selectedRoomUid: '',
  selectedMaterialId: '',
  openVisualKeys: new Set(),
  openSamplingKeys: new Set(),
  collapsedLocationGroups: new Set(),
  pendingAdd: null,
  lastThumbTap: null
};

const localPreviewUrls = new Map();
const SAMPLE_STAGE_ORDER = [
  SHOOTING_TYPES.BEFORE,
  SHOOTING_TYPES.DURING,
  SHOOTING_TYPES.AFTER,
  SHOOTING_TYPES.SECTION
];

let root = null;
let body = null;
let unsubscribePhotoStore = null;
let unsubscribeMaterialStore = null;
let unsubscribeFinishStore = null;
let storeRenderQueued = false;

function render() {
  if (!root) return;
  if (!body) body = root.querySelector('#photoModeBody');

  root.querySelectorAll('[data-photo-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.photoMode === state.mode);
  });

  if (state.mode === 'sampling') {
    const view = buildSamplingPhotoView(state.selectedMaterialId);
    state.selectedMaterialId = view.activeMaterial?.materialId || '';
    renderSamplingView(body, view, state);
    return;
  }

  const view = buildVisualPhotoView(state.selectedRoomUid);
  state.selectedRoomUid = view.activeRoom?.roomUid || '';
  renderVisualView(body, view, state);
}

function showCameraPending() {
  alert('カメラアプリとの接続は後続レビュー版で実装します。今回は写真タブUI・PhotoViewer・photoRecord接続の確認版です。');
}

function photoById(photoId) {
  return photoRecordStore.get(photoId);
}

function nextPhotoId() {
  const max = photoRecordStore.getAll().reduce((current, photo) => {
    const match = /^LOCAL-PHOTO-(\d+)$/.exec(photo.photoId || '');
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `LOCAL-PHOTO-${String(max + 1).padStart(3, '0')}`;
}

function openFilePicker(context) {
  const picker = root.querySelector('#photoFilePicker');
  if (!picker) return;
  state.pendingAdd = context;
  picker.value = '';
  picker.click();
}

function addPickedFile(file) {
  const context = state.pendingAdd;
  state.pendingAdd = null;
  if (!file || !context) return;

  const photoId = nextPhotoId();
  const common = {
    photoId,
    fileName: file.name,
    capturedDevice: 'local-browser',
    capturedAt: new Date().toISOString(),
    syncStatus: '未同期'
  };

  // 実画像はphotoRecordへ入れず、レビュー用の一時URLだけController内に保持する。
  // 後続版でOneDrive URLを解決する場合もPhotoViewerのsource resolverへ差し替えられる。
  if (typeof URL.createObjectURL === 'function') {
    localPreviewUrls.set(photoId, URL.createObjectURL(file));
  }

  if (context.photoType === PHOTO_TYPES.VISUAL) {
    photoRecordStore.set(createPhotoRecord({
      ...common,
      photoType: PHOTO_TYPES.VISUAL,
      roomPosition: context.roomPosition,
      part: context.part
    }));
    return;
  }

  photoRecordStore.set(createPhotoRecord({
    ...common,
    photoType: PHOTO_TYPES.SAMPLING,
    materialId: context.materialId,
    samplingPlace: context.samplingPlace,
    samplingBranch: context.branch,
    sampleNo: context.sampleNo,
    part: context.part,
    shootingType: context.shootingType
  }));
}

function visualContextFromKey(key) {
  const view = buildVisualPhotoView(state.selectedRoomUid);
  const target = view.targets.find((item) => item.key === key);
  if (!target) return null;
  return { photoType: PHOTO_TYPES.VISUAL, roomPosition: target.roomPosition, part: target.part };
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

/**
 * PhotoViewerで横送りする写真集合を返す。
 * 目視：同じ部屋位置 + 部位。
 * 採取：同じ建材 + 同じ採取枝番（施工前/中/後/断面をまとめる）。
 */
function photosForViewer(photoId) {
  const photo = photoById(photoId);
  if (!photo || photo.deleted) return [];

  if (photo.photoType === PHOTO_TYPES.VISUAL) {
    return photoRecordStore.findVisual({ roomPosition: photo.roomPosition, part: photo.part })
      .sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId).localeCompare(String(b.photoId)));
  }

  return photoRecordStore.findSampling({ materialId: photo.materialId, samplingBranch: photo.samplingBranch })
    .sort((a, b) => {
      const stageDiff = SAMPLE_STAGE_ORDER.indexOf(a.shootingType) - SAMPLE_STAGE_ORDER.indexOf(b.shootingType);
      if (stageDiff) return stageDiff;
      return String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')) || String(a.photoId).localeCompare(String(b.photoId));
    });
}

/** PhotoViewerへ渡す表示URL。photoRecord自体へ一時URLは保存しない。 */
function previewSourceForPhoto(photo) {
  const local = localPreviewUrls.get(photo.photoId);
  if (local) return local;

  const remote = String(photo.oneDrivePath || '').trim();
  if (/^(?:https?:|blob:|data:)/i.test(remote)) return remote;
  return '';
}

function openViewerForThumb(photoId) {
  if (!photoId || !photoById(photoId)) return;
  openPhotoViewer(photoId);
}

function bindEvents() {
  root.addEventListener('click', (event) => {
    const mode = event.target.closest('[data-photo-mode]');
    if (mode) {
      state.mode = mode.dataset.photoMode === 'sampling' ? 'sampling' : 'visual';
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
      render();
      return;
    }

    const material = event.target.closest('[data-photo-material]');
    if (material) {
      state.selectedMaterialId = material.dataset.photoMaterial || '';
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

    // 写真サムネイルの単タップではViewerを開かない。
    // iPadでの「選択」と「拡大」を分けるため、Viewerはダブルタップ専用にする。
    if (event.target.closest('[data-photo-preview]')) return;

    const representative = event.target.closest('[data-photo-representative]');
    if (representative) {
      photoRecordStore.setRepresentative(representative.dataset.photoRepresentative || '');
      return;
    }

    const deleteButton = event.target.closest('[data-photo-delete]');
    if (deleteButton) {
      const photo = photoById(deleteButton.dataset.photoDelete || '');
      if (photo && confirm(`${photo.fileName || photo.photoId} を一覧から削除しますか？\n写真Recordは論理削除として残ります。`)) {
        const localUrl = localPreviewUrls.get(photo.photoId);
        if (localUrl) {
          if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(localUrl);
          localPreviewUrls.delete(photo.photoId);
        }
        photoRecordStore.markDeleted(photo.photoId);
      }
      return;
    }

    const addVisual = event.target.closest('[data-photo-add-visual]');
    if (addVisual) {
      const context = visualContextFromKey(addVisual.dataset.photoAddVisual || '');
      if (context) openFilePicker(context);
      return;
    }

    const addSampling = event.target.closest('[data-photo-add-sampling]');
    if (addSampling) {
      const context = samplingContextFromKey(addSampling.dataset.photoAddSampling || '', addSampling.dataset.photoStage || '');
      if (context) openFilePicker(context);
      return;
    }

    if (event.target.closest('[data-photo-camera-global],[data-photo-camera-visual],[data-photo-camera-sampling]')) {
      showCameraPending();
      return;
    }

    if (event.target.closest('[data-photo-picker]')) {
      alert('写真を追加したい部位・採取区分の「＋」を押してください。');
    }
  });


  // iPad Safariでdblclickに依存しないよう、PointerEventでダブルタップも判定する。
  root.addEventListener('pointerup', (event) => {
    const thumb = event.target.closest('[data-photo-preview]');
    if (!thumb) return;

    const photoId = thumb.dataset.photoPreview || '';
    const now = Date.now();
    const point = { x: event.clientX, y: event.clientY };
    const previous = state.lastThumbTap;

    const isDoubleTap = previous
      && previous.photoId === photoId
      && now - previous.time <= 340
      && Math.hypot(point.x - previous.x, point.y - previous.y) <= 30;

    if (isDoubleTap) {
      state.lastThumbTap = null;
      openViewerForThumb(photoId);
      return;
    }

    state.lastThumbTap = { photoId, time: now, x: point.x, y: point.y };
  });

  root.querySelector('#photoFilePicker')?.addEventListener('change', (event) => {
    addPickedFile(event.target.files?.[0]);
  });
}


/**
 * 複数Storeが同じ業務操作で連続通知しても、写真タブの再描画は1回へまとめる。
 * 通知元はStore.subscribe()だけに統一し、transaction専用DOMイベントは使わない。
 */
function scheduleStoreRender() {
  if (storeRenderQueued) return;
  storeRenderQueued = true;
  queueMicrotask(() => {
    storeRenderQueued = false;
    render();
  });
}

export function initializePhotoTab() {
  root = document.getElementById('photos');
  if (!root) return;

  renderPhotoShell(root, state.mode);
  body = root.querySelector('#photoModeBody');
  bindEvents();


  initializePhotoViewer({
    getPhotosForPhoto: photosForViewer,
    getPhotoSource: previewSourceForPhoto
  });

  render();

  if (unsubscribePhotoStore) unsubscribePhotoStore();
  if (unsubscribeMaterialStore) unsubscribeMaterialStore();
  if (unsubscribeFinishStore) unsubscribeFinishStore();

  unsubscribePhotoStore = photoRecordStore.subscribe(scheduleStoreRender);
  unsubscribeMaterialStore = materialRecordStore.subscribe(scheduleStoreRender);
  unsubscribeFinishStore = finishRecordStore.subscribe(scheduleStoreRender);
}
