/**
 * 写真タブのDOMイベント配線を担当する。
 * Record更新や表示用データ組立は持たず、Controllerから渡された操作を呼び出す。
 */
import { openPhotoViewer } from './photo-viewer.js';
import { openCamera } from '../camera/camera-controller.js';
import { setRepresentativePhoto } from './photo-record-actions.js';
import { isTutorialActionAllowed } from '../guide/tutorial-state.js';
import { notifyTutorialAction } from '../guide/tutorial-action.js';

let boundRoot = null;
let tabExitBound = false;

function interactionRule(target) {
  if (!target?.closest) return null;

  const mode = target.closest('[data-photo-mode]');
  if (mode) return { actionId:'photo.mode.change', context:{ mode:String(mode.dataset.photoMode || '') } };

  const room = target.closest('[data-photo-room]');
  if (room) return { actionId:'photo.room.select', context:{ roomUid:String(room.dataset.photoRoom || '') } };

  const material = target.closest('[data-photo-material]');
  if (material) return { actionId:'photo.material.select', context:{ materialId:String(material.dataset.photoMaterial || '') } };

  const cameraVisual = target.closest('[data-photo-camera-visual]');
  if (cameraVisual) return { actionId:'photo.camera.visual', context:{ key:String(cameraVisual.dataset.photoCameraVisual || '') } };

  const cameraSamplingStage = target.closest('[data-photo-camera-sampling-stage]');
  if (cameraSamplingStage) {
    return {
      actionId:'photo.camera.sampling-stage',
      context:{
        key:String(cameraSamplingStage.dataset.photoCameraSamplingStage || ''),
        stage:String(cameraSamplingStage.dataset.photoStage || '')
      }
    };
  }

  const cameraSampling = target.closest('[data-photo-camera-sampling]');
  if (cameraSampling) return { actionId:'photo.camera.sampling', context:{ key:String(cameraSampling.dataset.photoCameraSampling || '') } };

  if (target.closest('[data-photo-camera-global]')) return { actionId:'photo.camera.global', context:{} };
  if (target.closest('[data-photo-picker]')) return { actionId:'photo.picker.open', context:{} };

  const listGroup = target.closest('[data-photo-list-group]');
  if (listGroup) return { actionId:'photo.group.toggle', context:{ key:String(listGroup.dataset.photoListGroup || '') } };

  const visualToggle = target.closest('[data-photo-toggle]');
  if (visualToggle) return { actionId:'photo.visual.toggle', context:{ key:String(visualToggle.dataset.photoToggle || '') } };

  const sampleToggle = target.closest('[data-photo-toggle-sampling]');
  if (sampleToggle) return { actionId:'photo.sampling.toggle', context:{ key:String(sampleToggle.dataset.photoToggleSampling || '') } };

  const representative = target.closest('[data-photo-representative]');
  if (representative) {
    return { actionId:'photo.representative.set', context:{ photoId:String(representative.dataset.photoRepresentative || '') } };
  }

  const expand = target.closest('[data-photo-expand]');
  if (expand) return { actionId:'photo.viewer.open', context:{ photoId:String(expand.dataset.photoExpand || '') } };

  const selectionMode = target.closest('[data-photo-selection-mode]');
  if (selectionMode) return { actionId:'photo.selection.mode', context:{ mode:String(selectionMode.dataset.photoSelectionMode || '') } };

  const thumb = target.closest('.photo-thumb-card[data-photo-id]');
  if (thumb) return { actionId:'photo.selection.toggle', context:{ photoId:String(thumb.dataset.photoId || '') } };

  return null;
}

function tutorialAllows(target) {
  const rule = interactionRule(target);
  if (!rule) return true;
  return isTutorialActionAllowed(rule.actionId, rule.context);
}

function bindPhotoTabExitReset(state, clearSelectionMode) {
  if (tabExitBound) return;
  tabExitBound = true;

  window.addEventListener('chousa:tab-change', (event) => {
    const previousTab = String(event.detail?.previousTab || '');
    const currentTab = String(event.detail?.currentTab || '');
    if (previousTab === 'photos' && currentTab !== 'photos' && state.selectionMode) {
      clearSelectionMode();
    }
  });
}

export function bindPhotoInteractions({
  root,
  state,
  render,
  applySelectionUi,
  clearSelectionMode,
  togglePhotoSelection,
  deleteSelectedPhotos,
  startEditSequence,
  compareSelectedPhotos,
  visualContextFromKey,
  samplingContextFromKey,
  samplingDefaultContextFromKey,
  globalCameraContext,
  externalImportContext,
  openFilePicker,
  addPickedFiles
}) {
  if (!root || boundRoot === root) return;
  boundRoot = root;

  bindPhotoTabExitReset(state, clearSelectionMode);

  root.addEventListener('click', (event) => {
    if (!tutorialAllows(event.target)) {
      event.preventDefault();
      return;
    }

    const selectionButton = event.target.closest('[data-photo-selection-mode]');
    if (selectionButton) {
      const rawMode = String(selectionButton.dataset.photoSelectionMode || '');
      const requestedMode = rawMode === 'delete' ? 'delete' : (rawMode === 'compare' ? 'compare' : 'edit');
      if (state.selectionMode === requestedMode) {
        if (!state.selectedPhotoIds.size) {
          clearSelectionMode();
        } else if (requestedMode === 'delete') {
          deleteSelectedPhotos(state.selectedPhotoIds).catch((error) => {
            console.error(error);
            window.alert(`写真の削除に失敗しました。\n${error.message || error}`);
          });
        } else if (requestedMode === 'compare') {
          compareSelectedPhotos(state.selectedPhotoIds);
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
      openPhotoViewer(expandButton.dataset.photoExpand || '');
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
      notifyTutorialAction('photo.mode.change', { mode:state.mode });
      return;
    }

    const listGroup = event.target.closest('[data-photo-list-group]');
    if (listGroup) {
      const key = listGroup.dataset.photoListGroup || '';
      state.collapsedLocationGroups.has(key)
        ? state.collapsedLocationGroups.delete(key)
        : state.collapsedLocationGroups.add(key);
      render();
      return;
    }

    const room = event.target.closest('[data-photo-room]');
    if (room) {
      state.selectedRoomUid = room.dataset.photoRoom || '';
      state.reviewScrollTop.visual = 0;
      render();
      notifyTutorialAction('photo.room.select', { roomUid:state.selectedRoomUid });
      return;
    }

    const material = event.target.closest('[data-photo-material]');
    if (material) {
      state.selectedMaterialId = material.dataset.photoMaterial || '';
      state.reviewScrollTop.sampling = 0;
      render();
      notifyTutorialAction('photo.material.select', { materialId:state.selectedMaterialId });
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
      setRepresentativePhoto(photoId)
        .then((changed) => { if (changed.length) render(); })
        .catch((error) => {
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
      const context = samplingDefaultContextFromKey(cameraSampling.dataset.photoCameraSampling || '');
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
