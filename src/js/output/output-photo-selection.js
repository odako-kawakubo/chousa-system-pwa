/**
 * src/js/output/output-photo-selection.js
 *
 * 出力帳票から既存PhotoViewerを開き、Viewerで現在表示中の写真を
 * 出力用写真として確定する橋渡し。
 * 写真タブ側の代表写真は変更しない。
 */
import { openPhotoViewer } from '../photos/photo-viewer.js';
import { setVisualOutputPhotoId, setSamplingOutputPhotoId } from './output-state.js';

let activeSession = null;
let observer = null;

function stopObserver() {
  observer?.disconnect();
  observer = null;
}

function counterIndex() {
  const text = document.querySelector('#photoPreviewBody .photo-viewer-counter')?.textContent || '';
  const match = /^(\d+)\s*\/\s*(\d+)/.exec(text.trim());
  return match ? Math.max(0, Number(match[1]) - 1) : -1;
}

function applyCurrentViewerPhoto() {
  if (!activeSession) return;
  const index = counterIndex();
  const photo = activeSession.photos[index];
  if (!photo?.photoId) return;
  if (activeSession.kind === 'visual') {
    setVisualOutputPhotoId(activeSession.materialId, photo.photoId);
  } else {
    setSamplingOutputPhotoId(activeSession.materialId, activeSession.branch, activeSession.shootingType, photo.photoId);
  }
  activeSession.onSelection?.(photo.photoId);
}

function watchViewer() {
  stopObserver();
  const body = document.getElementById('photoPreviewBody');
  if (!body) return;
  observer = new MutationObserver(() => queueMicrotask(applyCurrentViewerPhoto));
  observer.observe(body, { childList: true, subtree: true, characterData: true });
  queueMicrotask(applyCurrentViewerPhoto);
}

function openSelectionViewer(session) {
  const photos = (session.photos || []).filter((photo) => photo?.photoId);
  if (!photos.length) return false;
  const selectedId = String(session.selectedPhotoId || photos[0].photoId);
  const start = photos.find((photo) => String(photo.photoId) === selectedId) || photos[0];
  activeSession = { ...session, photos };
  openPhotoViewer(start.photoId, {
    photos,
    preferredMaterialId: session.materialId,
    outputSelection: true
  });
  watchViewer();
  return true;
}

export function openVisualOutputPhotoViewer({ materialId, selectedPhotoId, candidates, onSelection } = {}) {
  return openSelectionViewer({
    kind: 'visual',
    materialId: String(materialId || ''),
    selectedPhotoId,
    photos: (candidates || []).map((item) => item?.photo || item).filter(Boolean),
    onSelection
  });
}

export function openSamplingOutputPhotoViewer({ materialId, branch, shootingType, selectedPhotoId, candidates, onSelection } = {}) {
  return openSelectionViewer({
    kind: 'sampling',
    materialId: String(materialId || ''),
    branch: Number(branch) || 0,
    shootingType: String(shootingType || ''),
    selectedPhotoId,
    photos: candidates || [],
    onSelection
  });
}

export function initializeOutputPhotoSelectionBridge() {
  const modal = document.getElementById('photoPreviewModal');
  if (!modal || modal.dataset.outputSelectionBound === '1') return;
  modal.dataset.outputSelectionBound = '1';
  const clear = () => {
    if (modal.classList.contains('open')) return;
    stopObserver();
    activeSession = null;
  };
  new MutationObserver(clear).observe(modal, { attributes: true, attributeFilter: ['class'] });
}
