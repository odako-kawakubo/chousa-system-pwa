/**
 * src/js/photos/photo-viewer.js
 *
 * v0.1.5.3D 共通PhotoViewer。
 * 写真タブ内のサムネイルをダブルタップ／ダブルクリックしたときに、
 * 画面中央の大きめモーダルで写真を確認する。
 *
 * 対応操作：
 * - 背景（画像外）タップで閉じる
 * - ×／閉じるボタンで閉じる
 * - 1 / 4形式の現在位置表示
 * - 通常倍率で左右スワイプ → 前後写真
 * - ピンチ → 拡大／縮小
 * - 拡大中ドラッグ → 画像移動
 * - ダブルタップ → 1倍 / 2.5倍を切替
 *
 * 写真本体URLはphotoRecordへ重複保持しない。
 * getPhotoSource()から一時URLや将来のOneDrive表示URLを受け取る。
 */

const viewerState = {
  photos: [],
  index: 0,
  scale: 1,
  translateX: 0,
  translateY: 0,
  pointers: new Map(),
  dragStart: null,
  swipeStart: null,
  pinchStart: null,
  lastTap: null
};

let getPhotosForPhoto = () => [];
let getPhotoSource = () => '';
let modal = null;
let title = null;
let body = null;
let bound = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resetTransform() {
  viewerState.scale = 1;
  viewerState.translateX = 0;
  viewerState.translateY = 0;
  viewerState.pointers.clear();
  viewerState.dragStart = null;
  viewerState.swipeStart = null;
  viewerState.pinchStart = null;
}

function currentPhoto() {
  return viewerState.photos[viewerState.index] || null;
}

function transformImage() {
  const image = body?.querySelector('.photo-viewer-image');
  if (!image) return;
  image.style.transform = `translate3d(${viewerState.translateX}px, ${viewerState.translateY}px, 0) scale(${viewerState.scale})`;
  image.classList.toggle('is-zoomed', viewerState.scale > 1.01);
}

function renderCurrent() {
  const photo = currentPhoto();
  if (!modal || !title || !body || !photo) return;

  resetTransform();
  title.textContent = photo.fileName || photo.photoId || '写真プレビュー';
  const source = getPhotoSource(photo) || '';

  body.innerHTML = `<div class="photo-viewer-shell">
    <div class="photo-viewer-stage" data-photo-viewer-stage>
      ${source
        ? `<img class="photo-viewer-image" src="${String(source).replaceAll('"', '&quot;')}" alt="${String(photo.fileName || photo.photoId || '写真').replaceAll('"', '&quot;')}" draggable="false">`
        : `<div class="photo-viewer-no-image"><div class="photo-preview-icon">📷</div><b>${photo.fileName || photo.photoId}</b><span>この確認版では画像本体が端末内にない写真です。</span></div>`}
    </div>
    <button class="photo-viewer-nav photo-viewer-prev" type="button" data-photo-viewer-prev aria-label="前の写真">‹</button>
    <button class="photo-viewer-nav photo-viewer-next" type="button" data-photo-viewer-next aria-label="次の写真">›</button>
    <div class="photo-viewer-counter">${viewerState.index + 1} / ${viewerState.photos.length}</div>
  </div>`;

  const hasMultiple = viewerState.photos.length > 1;
  body.querySelector('[data-photo-viewer-prev]')?.toggleAttribute('hidden', !hasMultiple);
  body.querySelector('[data-photo-viewer-next]')?.toggleAttribute('hidden', !hasMultiple);
  bindStageEvents();
}

function moveTo(index) {
  if (!viewerState.photos.length) return;
  viewerState.index = (index + viewerState.photos.length) % viewerState.photos.length;
  renderCurrent();
}

function previous() {
  if (viewerState.scale > 1.01) return;
  moveTo(viewerState.index - 1);
}

function next() {
  if (viewerState.scale > 1.01) return;
  moveTo(viewerState.index + 1);
}

function toggleDoubleTapZoom() {
  if (viewerState.scale > 1.01) {
    resetTransform();
  } else {
    viewerState.scale = 2.5;
    viewerState.translateX = 0;
    viewerState.translateY = 0;
  }
  transformImage();
}

function bindStageEvents() {
  const stage = body?.querySelector('[data-photo-viewer-stage]');
  if (!stage) return;

  stage.addEventListener('pointerdown', (event) => {
    if (!stage.querySelector('.photo-viewer-image')) return;
    stage.setPointerCapture?.(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    viewerState.pointers.set(event.pointerId, point);

    if (viewerState.pointers.size === 2) {
      const points = [...viewerState.pointers.values()];
      viewerState.pinchStart = {
        distance: distance(points[0], points[1]),
        scale: viewerState.scale
      };
      viewerState.dragStart = null;
      viewerState.swipeStart = null;
      return;
    }

    if (viewerState.scale > 1.01) {
      viewerState.dragStart = {
        x: event.clientX,
        y: event.clientY,
        translateX: viewerState.translateX,
        translateY: viewerState.translateY
      };
    } else {
      viewerState.swipeStart = { x: event.clientX, y: event.clientY, time: Date.now() };
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!viewerState.pointers.has(event.pointerId)) return;
    viewerState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (viewerState.pointers.size >= 2 && viewerState.pinchStart) {
      event.preventDefault();
      const points = [...viewerState.pointers.values()].slice(0, 2);
      const ratio = distance(points[0], points[1]) / Math.max(1, viewerState.pinchStart.distance);
      viewerState.scale = clamp(viewerState.pinchStart.scale * ratio, 1, 4);
      if (viewerState.scale <= 1.01) {
        viewerState.scale = 1;
        viewerState.translateX = 0;
        viewerState.translateY = 0;
      }
      transformImage();
      return;
    }

    if (viewerState.scale > 1.01 && viewerState.dragStart) {
      event.preventDefault();
      viewerState.translateX = viewerState.dragStart.translateX + (event.clientX - viewerState.dragStart.x);
      viewerState.translateY = viewerState.dragStart.translateY + (event.clientY - viewerState.dragStart.y);
      transformImage();
    }
  }, { passive: false });

  stage.addEventListener('pointerup', (event) => {
    const point = viewerState.pointers.get(event.pointerId) || { x: event.clientX, y: event.clientY };
    viewerState.pointers.delete(event.pointerId);

    // 2本指操作終了後は単指ドラッグ状態を作り直さず、そのまま終了する。
    if (viewerState.pinchStart) {
      if (viewerState.pointers.size < 2) viewerState.pinchStart = null;
      viewerState.dragStart = null;
      viewerState.swipeStart = null;
      return;
    }

    const now = Date.now();
    const previousTap = viewerState.lastTap;
    const isDoubleTap = previousTap
      && now - previousTap.time <= 320
      && Math.hypot(point.x - previousTap.x, point.y - previousTap.y) <= 28;

    if (isDoubleTap) {
      viewerState.lastTap = null;
      toggleDoubleTapZoom();
      viewerState.swipeStart = null;
      viewerState.dragStart = null;
      return;
    }
    viewerState.lastTap = { time: now, x: point.x, y: point.y };

    if (viewerState.scale <= 1.01 && viewerState.swipeStart) {
      const dx = event.clientX - viewerState.swipeStart.x;
      const dy = event.clientY - viewerState.swipeStart.y;
      const elapsed = now - viewerState.swipeStart.time;
      if (elapsed < 700 && Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        dx < 0 ? next() : previous();
      }
    }

    viewerState.swipeStart = null;
    viewerState.dragStart = null;
  });

  stage.addEventListener('pointercancel', (event) => {
    viewerState.pointers.delete(event.pointerId);
    viewerState.dragStart = null;
    viewerState.swipeStart = null;
    if (viewerState.pointers.size < 2) viewerState.pinchStart = null;
  });

}

function bindViewerChrome() {
  if (bound || !modal || !body) return;
  bound = true;

  body.addEventListener('click', (event) => {
    if (event.target.closest('[data-photo-viewer-prev]')) {
      event.stopPropagation();
      previous();
      return;
    }
    if (event.target.closest('[data-photo-viewer-next]')) {
      event.stopPropagation();
      next();
    }
  });

  // 汎用modal.jsでも背景クリックでopenクラスは外れるが、
  // Viewer内部状態も同時に初期化して次回表示へ持ち越さない。
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closePhotoViewer();
  });

  modal.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => closePhotoViewer());
  });
}

export function initializePhotoViewer(options = {}) {
  getPhotosForPhoto = typeof options.getPhotosForPhoto === 'function' ? options.getPhotosForPhoto : (() => []);
  getPhotoSource = typeof options.getPhotoSource === 'function' ? options.getPhotoSource : (() => '');
  modal = document.getElementById('photoPreviewModal');
  title = document.getElementById('photoPreviewTitle');
  body = document.getElementById('photoPreviewBody');
  bindViewerChrome();
}

export function openPhotoViewer(photoId) {
  if (!modal || !body) return;
  const photos = getPhotosForPhoto(photoId) || [];
  const index = photos.findIndex((photo) => photo.photoId === photoId);
  if (!photos.length || index < 0) return;

  viewerState.photos = photos;
  viewerState.index = index;
  renderCurrent();
  modal.classList.add('open');
}

export function closePhotoViewer() {
  if (!modal) return;
  modal.classList.remove('open');
  resetTransform();
  viewerState.photos = [];
  viewerState.index = 0;
  if (body) body.innerHTML = '';
}
