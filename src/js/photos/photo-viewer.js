/**
 * src/js/photos/photo-viewer.js
 *
 * 共通PhotoViewer。
 * 通常表示に加え、v0.1.5.4Eで2〜4枠の比較モードへ拡張する。
 * 写真本体はRecordへ重複保持せず、getPhotoSource()で表示URLを解決する。
 */

let getPhotosForPhoto = () => [];
let getPhotoSource = () => '';
let getCompareTargets = () => [];
let onEditPhoto = null;
let modal = null;
let title = null;
let body = null;
let bound = false;

const viewerState = {
  photos: [],
  index: 0,
  context: {},
  compareMode: false,
  normalTransform: createTransformState(),
  compare: {
    targets: [],
    panes: []
  }
};

function createTransformState() {
  return {
    scale: 1,
    x: 0,
    y: 0,
    pointers: new Map(),
    start: null,
    pinch: null,
    swipe: null,
    lastTap: null
  };
}

function resetTransform(state) {
  state.scale = 1;
  state.x = 0;
  state.y = 0;
  state.pointers.clear();
  state.start = null;
  state.pinch = null;
  state.swipe = null;
  state.lastTap = null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function currentPhoto() {
  return viewerState.photos[viewerState.index] || null;
}

function sourceFor(photo) {
  return photo ? String(getPhotoSource(photo) || '') : '';
}

function applyTransform(stage, state) {
  const image = stage?.querySelector('img');
  if (!image) return;
  image.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
  image.classList.toggle('is-zoomed', state.scale > 1.01);
}

function renderImage(photo, className = 'photo-viewer-image') {
  const source = sourceFor(photo);
  if (!photo) {
    return '<div class="photo-viewer-no-image"><div class="photo-preview-icon">📷</div><b>写真なし</b></div>';
  }
  if (!source) {
    return `<div class="photo-viewer-no-image"><div class="photo-preview-icon">📷</div><b>${esc(photo.fileName || photo.photoId)}</b><span>画像本体はまだ接続されていません。</span></div>`;
  }
  return `<img class="${className}" src="${esc(source)}" alt="${esc(photo.fileName || photo.photoId || '写真')}" draggable="false">`;
}

function toggleZoom(stage, state) {
  if (state.scale > 1.01) resetTransform(state);
  else state.scale = 2.5;
  applyTransform(stage, state);
}

/**
 * stage単位のタッチ・Pencil・マウス操作。
 * allowSwipe=trueの通常Viewerだけ、1倍時の横スワイプで写真送りする。
 */
function bindGestureStage(stage, state, { allowSwipe = false, onSwipe = null } = {}) {
  if (!stage) return;

  const tap = (point, inputType) => {
    const now = Date.now();
    const previous = state.lastTap;
    const maxInterval = inputType === 'pen' ? 480 : 350;
    const maxDistance = inputType === 'pen' ? 48 : 34;
    if (previous && previous.inputType === inputType && now - previous.time <= maxInterval && pointDistance(previous, point) <= maxDistance) {
      state.lastTap = null;
      toggleZoom(stage, state);
      return true;
    }
    state.lastTap = { ...point, time: now, inputType };
    return false;
  };

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || !stage.querySelector('img')) return;
    stage.setPointerCapture?.(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    state.pointers.set(event.pointerId, point);
    if (state.scale > 1.01) {
      state.start = { ...point, x0: state.x, y0: state.y };
      state.swipe = null;
    } else if (allowSwipe) {
      state.swipe = { ...point, time: Date.now(), moved: false };
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || !state.pointers.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    state.pointers.set(event.pointerId, point);
    if (state.scale > 1.01 && state.start) {
      event.preventDefault();
      state.x = state.start.x0 + (point.x - state.start.x);
      state.y = state.start.y0 + (point.y - state.start.y);
      applyTransform(stage, state);
    } else if (state.swipe && pointDistance(point, state.swipe) >= 10) {
      state.swipe.moved = true;
    }
  }, { passive: false });

  stage.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') return;
    const point = state.pointers.get(event.pointerId) || { x: event.clientX, y: event.clientY };
    state.pointers.delete(event.pointerId);
    const swipe = state.swipe;
    if (state.scale <= 1.01 && swipe && !swipe.moved && tap(point, event.pointerType === 'pen' ? 'pen' : 'mouse')) {
      state.start = null;
      state.swipe = null;
      return;
    }
    if (allowSwipe && state.scale <= 1.01 && swipe) {
      const dx = point.x - swipe.x;
      const dy = point.y - swipe.y;
      if (Date.now() - swipe.time < 700 && Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.2) onSwipe?.(dx < 0 ? 1 : -1);
    }
    state.start = null;
    state.swipe = null;
  });

  stage.addEventListener('pointercancel', () => {
    state.pointers.clear();
    state.start = null;
    state.swipe = null;
  });

  stage.addEventListener('touchstart', (event) => {
    if (!stage.querySelector('img')) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      const a = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      const b = { x: event.touches[1].clientX, y: event.touches[1].clientY };
      state.pinch = { distance: pointDistance(a, b), scale: state.scale };
      state.start = null;
      state.swipe = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const point = { x: touch.clientX, y: touch.clientY };
    if (state.scale > 1.01) state.start = { ...point, x0: state.x, y0: state.y };
    else if (allowSwipe) state.swipe = { ...point, time: Date.now(), moved: false };
  }, { passive: false });

  stage.addEventListener('touchmove', (event) => {
    if (event.touches.length >= 2 && state.pinch) {
      event.preventDefault();
      const a = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      const b = { x: event.touches[1].clientX, y: event.touches[1].clientY };
      state.scale = clamp(state.pinch.scale * pointDistance(a, b) / Math.max(1, state.pinch.distance), 1, 4);
      if (state.scale <= 1.01) {
        state.scale = 1;
        state.x = 0;
        state.y = 0;
      }
      applyTransform(stage, state);
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const point = { x: touch.clientX, y: touch.clientY };
    if (state.scale > 1.01 && state.start) {
      event.preventDefault();
      state.x = state.start.x0 + (point.x - state.start.x);
      state.y = state.start.y0 + (point.y - state.start.y);
      applyTransform(stage, state);
    } else if (state.swipe && pointDistance(point, state.swipe) >= 10) {
      state.swipe.moved = true;
    }
  }, { passive: false });

  stage.addEventListener('touchend', (event) => {
    if (state.pinch) {
      if (event.touches.length < 2) state.pinch = null;
      state.start = null;
      state.swipe = null;
      return;
    }
    if (event.touches.length) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const point = { x: touch.clientX, y: touch.clientY };
    const swipe = state.swipe;
    if (state.scale <= 1.01 && swipe && !swipe.moved && tap(point, 'touch')) {
      state.start = null;
      state.swipe = null;
      return;
    }
    if (allowSwipe && state.scale <= 1.01 && swipe) {
      const dx = point.x - swipe.x;
      const dy = point.y - swipe.y;
      if (Date.now() - swipe.time < 700 && Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.2) onSwipe?.(dx < 0 ? 1 : -1);
    }
    state.start = null;
    state.swipe = null;
  }, { passive: false });
}

function moveNormal(delta) {
  if (!viewerState.photos.length || viewerState.normalTransform.scale > 1.01) return;
  viewerState.index = (viewerState.index + delta + viewerState.photos.length) % viewerState.photos.length;
  renderNormal();
}

function renderNormal() {
  const photo = currentPhoto();
  if (!photo || !body || !title) return;
  viewerState.compareMode = false;
  resetTransform(viewerState.normalTransform);
  title.textContent = photo.fileName || photo.photoId || '写真プレビュー';
  const hasMultiple = viewerState.photos.length > 1;
  const canCompare = photo.photoType === 'visual' && getCompareTargets(viewerState.context).length >= 2;
  body.innerHTML = `<div class="photo-viewer-shell">
    <div class="photo-viewer-tools">
      <button type="button" class="btn small" data-photo-edit>看板編集</button>
      ${canCompare ? '<button type="button" class="btn small" data-photo-compare-open>比較</button>' : ''}
    </div>
    <div class="photo-viewer-stage" data-photo-viewer-stage>${renderImage(photo)}</div>
    <button class="photo-viewer-nav photo-viewer-prev" type="button" data-photo-viewer-prev ${hasMultiple ? '' : 'hidden'}>‹</button>
    <button class="photo-viewer-nav photo-viewer-next" type="button" data-photo-viewer-next ${hasMultiple ? '' : 'hidden'}>›</button>
    <div class="photo-viewer-counter">${viewerState.index + 1} / ${viewerState.photos.length}</div>
  </div>`;
  bindGestureStage(body.querySelector('[data-photo-viewer-stage]'), viewerState.normalTransform, { allowSwipe: true, onSwipe: moveNormal });
}

function createComparePane(key = '') {
  return {
    key,
    index: 0,
    transform: createTransformState()
  };
}

function compareTarget(key) {
  return viewerState.compare.targets.find((item) => item.key === key) || null;
}

function comparePane(paneIndex) {
  return viewerState.compare.panes[paneIndex] || null;
}

function comparePhoto(paneIndex) {
  const pane = comparePane(paneIndex);
  return pane ? compareTarget(pane.key)?.photos?.[pane.index] || null : null;
}

function moveComparePhoto(paneIndex, delta) {
  const pane = comparePane(paneIndex);
  if (!pane) return;
  const target = compareTarget(pane.key);
  if (!target?.photos?.length) return;
  pane.index = (pane.index + delta + target.photos.length) % target.photos.length;
  resetTransform(pane.transform);
  renderCompare();
}

function selectedCompareKeys(exceptIndex = -1) {
  return new Set(
    viewerState.compare.panes
      .map((pane, index) => index === exceptIndex ? '' : pane.key)
      .filter(Boolean)
  );
}

function compareSelectOptions(paneIndex) {
  const pane = comparePane(paneIndex);
  if (!pane) return '';
  const blocked = selectedCompareKeys(paneIndex);
  return viewerState.compare.targets
    .filter((item) => item.key === pane.key || !blocked.has(item.key))
    .map((item) => `<option value="${esc(item.key)}" ${item.key === pane.key ? 'selected' : ''}>${esc(item.label)}</option>`)
    .join('');
}

function renderCompareControls(paneIndex) {
  const pane = comparePane(paneIndex);
  if (!pane) return '';
  const target = compareTarget(pane.key);
  const count = target?.photos?.length || 0;
  const canRemove = paneIndex >= 2;
  return `<div class="photo-compare-controls" data-compare-controls="${paneIndex}">
    <select data-compare-target="${paneIndex}" aria-label="比較対象${paneIndex + 1}">${compareSelectOptions(paneIndex)}</select>
    <div class="photo-compare-photo-nav">
      <button type="button" class="btn small" data-compare-prev="${paneIndex}" ${count > 1 ? '' : 'disabled'}>‹</button>
      <span>${count ? pane.index + 1 : 0} / ${count}</span>
      <button type="button" class="btn small" data-compare-next="${paneIndex}" ${count > 1 ? '' : 'disabled'}>›</button>
      ${canRemove ? `<button type="button" class="btn small photo-compare-remove" data-compare-remove="${paneIndex}" title="比較枠を削除">×</button>` : ''}
    </div>
  </div>`;
}

function renderComparePane(paneIndex) {
  const pane = comparePane(paneIndex);
  if (!pane) return '';
  const photo = comparePhoto(paneIndex);
  const controls = renderCompareControls(paneIndex);
  const controlsOnBottom = paneIndex >= 2;
  return `<section class="photo-compare-pane ${controlsOnBottom ? 'controls-bottom' : 'controls-top'}" data-compare-pane="${paneIndex}">
    ${controlsOnBottom ? '' : controls}
    <div class="photo-compare-stage" data-compare-stage="${paneIndex}">${renderImage(photo, 'photo-viewer-image photo-compare-image')}</div>
    ${controlsOnBottom ? controls : ''}
  </section>`;
}

function availableCompareTarget() {
  const used = selectedCompareKeys();
  return viewerState.compare.targets.find((item) => !used.has(item.key)) || null;
}

function addComparePane() {
  if (viewerState.compare.panes.length >= 4) return;
  const target = availableCompareTarget();
  if (!target) return;
  viewerState.compare.panes.push(createComparePane(target.key));
  renderCompare();
}

function removeComparePane(paneIndex) {
  if (paneIndex < 2 || paneIndex >= viewerState.compare.panes.length) return;
  viewerState.compare.panes.splice(paneIndex, 1);
  renderCompare();
}

function renderCompare() {
  if (!body || !title) return;
  viewerState.compareMode = true;
  title.textContent = '写真比較';
  const count = viewerState.compare.panes.length;
  const canAdd = count < 4 && Boolean(availableCompareTarget());
  body.innerHTML = `<div class="photo-compare-shell">
    <div class="photo-compare-toolbar">
      <button type="button" class="btn small" data-photo-compare-back>通常表示へ戻る</button>
      ${canAdd ? '<button type="button" class="btn small" data-compare-add>＋比較追加</button>' : ''}
    </div>
    <div class="photo-compare-grid count-${count}">${viewerState.compare.panes.map((_, index) => renderComparePane(index)).join('')}</div>
  </div>`;

  viewerState.compare.panes.forEach((pane, index) => {
    bindGestureStage(body.querySelector(`[data-compare-stage="${index}"]`), pane.transform);
  });
}

function openCompare() {
  const targets = getCompareTargets(viewerState.context) || [];
  if (targets.length < 2) return;
  viewerState.compare.targets = targets;
  const current = currentPhoto();
  const currentKey = current?.photoType === 'visual' ? `${current.roomPosition}|${current.part}` : '';
  const firstKey = targets.find((item) => item.key === currentKey)?.key || targets[0].key;
  const secondKey = targets.find((item) => item.key !== firstKey)?.key || '';
  if (!secondKey) return;
  viewerState.compare.panes = [createComparePane(firstKey), createComparePane(secondKey)];
  renderCompare();
}

function bindChrome() {
  if (bound || !modal || !body) return;
  bound = true;
  body.addEventListener('click', (event) => {
    if (event.target.closest('[data-photo-edit]')) { const photo=currentPhoto(); if (photo) onEditPhoto?.(photo.photoId); return; }
    if (event.target.closest('[data-photo-viewer-prev]')) return moveNormal(-1);
    if (event.target.closest('[data-photo-viewer-next]')) return moveNormal(1);
    if (event.target.closest('[data-photo-compare-open]')) return openCompare();
    if (event.target.closest('[data-photo-compare-back]')) return renderNormal();
    if (event.target.closest('[data-compare-add]')) return addComparePane();

    const remove = event.target.closest('[data-compare-remove]');
    if (remove) return removeComparePane(Number(remove.dataset.compareRemove));

    const prev = event.target.closest('[data-compare-prev]');
    if (prev) return moveComparePhoto(Number(prev.dataset.comparePrev), -1);
    const next = event.target.closest('[data-compare-next]');
    if (next) return moveComparePhoto(Number(next.dataset.compareNext), 1);
  });

  body.addEventListener('change', (event) => {
    const select = event.target.closest('[data-compare-target]');
    if (!select) return;
    const paneIndex = Number(select.dataset.compareTarget);
    const pane = comparePane(paneIndex);
    if (!pane) return;

    // 他枠で選択済みの対象は選択肢自体から除外しているが、DOM改変等でも
    // 重複しないよう最終防御する。
    const blocked = selectedCompareKeys(paneIndex);
    if (blocked.has(select.value)) {
      renderCompare();
      return;
    }

    pane.key = select.value;
    pane.index = 0;
    resetTransform(pane.transform);
    renderCompare();
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closePhotoViewer();
  });
  modal.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', closePhotoViewer));
}

export function initializePhotoViewer(options = {}) {
  getPhotosForPhoto = typeof options.getPhotosForPhoto === 'function' ? options.getPhotosForPhoto : (() => []);
  getPhotoSource = typeof options.getPhotoSource === 'function' ? options.getPhotoSource : (() => '');
  getCompareTargets = typeof options.getCompareTargets === 'function' ? options.getCompareTargets : (() => []);
  onEditPhoto = typeof options.onEditPhoto === 'function' ? options.onEditPhoto : null;
  modal = document.getElementById('photoPreviewModal');
  title = document.getElementById('photoPreviewTitle');
  body = document.getElementById('photoPreviewBody');
  bindChrome();
}

export function openPhotoViewer(photoId, context = {}) {
  if (!modal || !body) return;
  const photos = getPhotosForPhoto(photoId) || [];
  const index = photos.findIndex((photo) => photo.photoId === photoId);
  if (!photos.length || index < 0) return;
  viewerState.photos = photos;
  viewerState.index = index;
  viewerState.context = { ...context };
  viewerState.compareMode = false;
  renderNormal();
  modal.classList.add('open');
}

export function closePhotoViewer() {
  if (!modal) return;
  modal.classList.remove('open');
  viewerState.photos = [];
  viewerState.index = 0;
  viewerState.context = {};
  viewerState.compareMode = false;
  resetTransform(viewerState.normalTransform);
  viewerState.compare.panes.forEach((pane) => resetTransform(pane.transform));
  viewerState.compare.panes = [];
  viewerState.compare.targets = [];
  if (body) body.innerHTML = '';
}
