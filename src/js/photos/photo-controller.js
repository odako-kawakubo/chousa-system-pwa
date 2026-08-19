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
import { initializePhotoViewer, openPhotoViewer, closePhotoViewer } from './photo-viewer.js';
import { initializeCameraController, openCamera } from '../camera/camera-controller.js';
import { getPhotoBlob, getCameraPhotoRecords } from './photo-local-store.js';
import { initializePhotoBoardEditor, openPhotoBoardEditor } from './photo-board-editor.js';

const state = {
  mode: 'visual',
  selectedRoomUid: '',
  selectedMaterialId: '',
  openVisualKeys: new Set(),
  openSamplingKeys: new Set(),
  collapsedLocationGroups: new Set(),
  pendingAdd: null,
  listScrollTop: { visual: 0, sampling: 0 },
  editMode: false
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
let renderedMode = 'visual';

function rememberPhotoListScroll(mode = renderedMode) {
  if (!body) return;
  const list = body.querySelector('.photo-target-list');
  if (list) state.listScrollTop[mode] = list.scrollTop;
}

function restorePhotoListScroll() {
  if (!body) return;
  const list = body.querySelector('.photo-target-list');
  if (!list) return;
  const top = Number(state.listScrollTop[state.mode] || 0);
  requestAnimationFrame(() => { list.scrollTop = top; });
}

function render() {
  if (!root) return;
  rememberPhotoListScroll(renderedMode);
  if (!body) body = root.querySelector('#photoModeBody');

  root.querySelector('.photo-panel')?.classList.toggle('photo-edit-mode', state.editMode);
  const editButton = root.querySelector('[data-photo-edit-mode]');
  if (editButton) { editButton.classList.toggle('active', state.editMode); editButton.textContent = state.editMode ? '編集終了' : '編集'; }

  root.querySelectorAll('[data-photo-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.photoMode === state.mode);
  });

  if (state.mode === 'sampling') {
    const view = buildSamplingPhotoView(state.selectedMaterialId);
    state.selectedMaterialId = view.activeMaterial?.materialId || '';
    renderSamplingView(body, view, state);
    hydrateThumbnailImages();
    renderedMode = state.mode;
    restorePhotoListScroll();
    return;
  }

  const view = buildVisualPhotoView(state.selectedRoomUid);
  state.selectedRoomUid = view.activeRoom?.roomUid || '';
  renderVisualView(body, view, state);
  hydrateThumbnailImages();
  renderedMode = state.mode;
  restorePhotoListScroll();
}

function photoById(photoId) {
  return photoRecordStore.get(photoId);
}

/**
 * 写真タブ内のサムネイルimgへ、Record外で管理している表示URLを差し込む。
 * 画像URLはphotoRecordへ保存しない。ローカル撮影画像はIndexedDBから復元済みの
 * Object URL、デモは一時Data URL、将来OneDrive接続後はremote URLを使う。
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
      roomNo: context.roomNo || '',
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
    sampleBaseNo: String(context.sampleNo || '').split('-')[0],
    part: context.part,
    shootingType: context.shootingType
  }));
}

function visualContextFromKey(key) {
  const view = buildVisualPhotoView(state.selectedRoomUid);
  const target = view.targets.find((item) => item.key === key);
  if (!target) return null;
  return { photoType: PHOTO_TYPES.VISUAL, roomPosition: target.roomPosition, roomNo: view.activeRoom?.roomNo || '', part: target.part };
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
 * カメラへ渡す候補一覧。
 * 目視はfinishRecordから作られた部屋/部位ViewModelをそのまま利用するため、
 * 内部・外部それぞれの実部位候補と現在の仕上表構成が一致する。
 * 採取はmaterialRecordの採取数・採取場所1〜3から全撮影点を平坦化する。
 */
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
      targets: roomView.targets.map((target) => ({ part: target.part }))
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
  const previous = localPreviewUrls.get(record.photoId);
  if (previous && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previous);
  if (completedBlob && typeof URL.createObjectURL === 'function') {
    localPreviewUrls.set(record.photoId, URL.createObjectURL(completedBlob));
  }
}

async function hydrateLocalCameraPhotos() {
  try {
    const records = await getCameraPhotoRecords();
    for (const record of records) {
      photoRecordStore.set(record);
      const blob = await getPhotoBlob(record.photoId, 'completed');
      if (blob && typeof URL.createObjectURL === 'function') {
        const previous = localPreviewUrls.get(record.photoId);
        if (previous && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previous);
        localPreviewUrls.set(record.photoId, URL.createObjectURL(blob));
      }
    }
  } catch (error) {
    console.warn('ローカル撮影写真の復元に失敗しました', error);
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
  return { photoType: PHOTO_TYPES.VISUAL, roomPosition: view.activeRoom.roomPosition, part: target.part };
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

/** デモ写真だけはRecord外でSVGプレビューを生成する。OneDrive保存先には入れない。 */
function demoPreviewSource(photo) {
  if (!String(photo?.photoId || '').startsWith('DEMO-PHOTO-')) return '';
  const label = photo.photoType === PHOTO_TYPES.VISUAL
    ? `${photo.roomNo || photo.roomPosition || '-'} / ${photo.part || '-'}`
    : `${photo.sampleNo || '-'} / ${photo.shootingType || '-'}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#dbe4ef"/><rect x="100" y="120" width="1000" height="560" rx="24" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="8"/><text x="600" y="390" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="700" fill="#0f172a">${label}</text><text x="600" y="465" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#334155">比較UI確認用デモ写真</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** PhotoViewerへ渡す表示URL。photoRecord自体へ一時URLは保存しない。 */
function previewSourceForPhoto(photo) {
  const local = localPreviewUrls.get(photo.photoId);
  if (local) return local;

  const demo = demoPreviewSource(photo);
  if (demo) return demo;

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
    if (event.target.closest('[data-photo-edit-mode]')) { state.editMode = !state.editMode; render(); return; }

    const editThumb = state.editMode ? event.target.closest('.photo-thumb-card[data-photo-id]') : null;
    if (editThumb && !event.target.closest('button')) { openPhotoBoardEditor(editThumb.dataset.photoId || ''); return; }

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

    // v0.1.5.4B: Pencilのダブルタップ精度に依存せず、明示的な「拡大」ボタンでViewerを開く。
    const expandButton = event.target.closest('[data-photo-expand]');
    if (expandButton) {
      openViewerForThumb(expandButton.dataset.photoExpand || '');
      return;
    }

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

    const cameraVisual = event.target.closest('[data-photo-camera-visual]');
    if (cameraVisual) {
      const context = visualContextFromKey(cameraVisual.dataset.photoCameraVisual || '');
      if (context) openCamera(context);
      return;
    }

    const cameraSampling = event.target.closest('[data-photo-camera-sampling]');
    if (cameraSampling) {
      const context = samplingContextFromKey(cameraSampling.dataset.photoCameraSampling || '', SHOOTING_TYPES.BEFORE);
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
      alert('写真を追加したい部位・採取区分の「＋」を押してください。');
    }
  });


  root.querySelector('#photoFilePicker')?.addEventListener('change', (event) => {
    addPickedFile(event.target.files?.[0]);
  });
}


/**
 * 複数Storeが同じ業務操作で連続通知しても、写真タブの再描画は1回へまとめる。
 * 通知元はStore.subscribe()だけに統一し、transaction専用DOMイベントは使わない。
 */
function compareTargetsForViewer(context = {}) {
  const preferredMaterialId = String(context.preferredMaterialId || '').trim();
  const materialsById = new Map(materialRecordStore.getAll().map((item) => [String(item.materialId || ''), item]));
  const roomInfo = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || !record.roomPosition) return;
    if (!roomInfo.has(record.roomPosition)) {
      roomInfo.set(record.roomPosition, { roomPosition: record.roomPosition, roomNo: record.roomNo, roomName: record.roomName });
    }
  });

  const groups = new Map();
  photoRecordStore.getActive().filter((photo) => photo.photoType === PHOTO_TYPES.VISUAL).forEach((photo) => {
    const key = `${photo.roomPosition}|${photo.part}`;
    if (!groups.has(key)) groups.set(key, { key, roomPosition: photo.roomPosition, part: photo.part, photos: [] });
    groups.get(key).photos.push(photo);
  });

  const usedByPreferred = new Set();
  if (preferredMaterialId) {
    finishRecordStore.getAll().forEach((record) => {
      if (record.status !== 'active' || String(record.materialId || '') !== preferredMaterialId) return;
      const part = String(record.part || '').trim();
      if (record.roomPosition && part) usedByPreferred.add(`${record.roomPosition}|${part}`);
    });
  }

  return [...groups.values()].map((group) => {
    const room = roomInfo.get(group.roomPosition) || {};
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

export function initializePhotoTab() {
  root = document.getElementById('photos');
  if (!root) return;

  renderPhotoShell(root, state.mode);
  body = root.querySelector('#photoModeBody');
  bindEvents();


  initializePhotoViewer({
    getPhotosForPhoto: photosForViewer,
    getPhotoSource: previewSourceForPhoto,
    getCompareTargets: compareTargetsForViewer,
    onEditPhoto: (photoId) => { closePhotoViewer(); openPhotoBoardEditor(photoId); }
  });

  initializeCameraController({
    getOptions: buildCameraOptions,
    onPhotoSaved: registerCameraPreview
  });

  initializePhotoBoardEditor({
    getOptions: buildCameraOptions,
    onSaved: registerCameraPreview
  });

  render();
  hydrateLocalCameraPhotos().then(render);

  if (unsubscribePhotoStore) unsubscribePhotoStore();
  if (unsubscribeMaterialStore) unsubscribeMaterialStore();
  if (unsubscribeFinishStore) unsubscribeFinishStore();

  unsubscribePhotoStore = photoRecordStore.subscribe(scheduleStoreRender);
  unsubscribeMaterialStore = materialRecordStore.subscribe(scheduleStoreRender);
  unsubscribeFinishStore = finishRecordStore.subscribe(scheduleStoreRender);
}
