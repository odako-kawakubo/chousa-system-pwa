/**
 * Photo Viewerのズーム・パン・ダブルタップ・スワイプ操作を担当する。
 * Viewerの写真選択や比較状態は持たない。
 */

export function createPhotoViewerTransformState() {
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

export function resetPhotoViewerTransform(state) {
  if (!state) return;
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

export function applyPhotoViewerTransform(stage, state) {
  const image = stage?.querySelector('img');
  if (!image || !state) return;
  image.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
  image.classList.toggle('is-zoomed', state.scale > 1.01);
}

function toggleZoom(stage, state) {
  if (state.scale > 1.01) resetPhotoViewerTransform(state);
  else state.scale = 2.5;
  applyPhotoViewerTransform(stage, state);
}

/**
 * stage単位のタッチ・Pencil・マウス操作。
 * allowSwipe=trueの通常Viewerだけ、1倍時の横スワイプで写真送りする。
 */
export function bindPhotoViewerGestureStage(stage, state, { allowSwipe = false, onSwipe = null } = {}) {
  if (!stage || !state) return;

  const tap = (point, inputType) => {
    const now = Date.now();
    const previous = state.lastTap;
    const maxInterval = inputType === 'pen' ? 480 : 350;
    const maxDistance = inputType === 'pen' ? 48 : 34;
    if (
      previous
      && previous.inputType === inputType
      && now - previous.time <= maxInterval
      && pointDistance(previous, point) <= maxDistance
    ) {
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
      applyPhotoViewerTransform(stage, state);
    } else if (state.swipe && pointDistance(point, state.swipe) >= 10) {
      state.swipe.moved = true;
    }
  }, { passive: false });

  stage.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') return;

    const point = state.pointers.get(event.pointerId) || { x: event.clientX, y: event.clientY };
    state.pointers.delete(event.pointerId);
    const swipe = state.swipe;

    if (
      state.scale <= 1.01
      && swipe
      && !swipe.moved
      && tap(point, event.pointerType === 'pen' ? 'pen' : 'mouse')
    ) {
      state.start = null;
      state.swipe = null;
      return;
    }

    if (allowSwipe && state.scale <= 1.01 && swipe) {
      const dx = point.x - swipe.x;
      const dy = point.y - swipe.y;
      if (
        Date.now() - swipe.time < 700
        && Math.abs(dx) >= 55
        && Math.abs(dx) > Math.abs(dy) * 1.2
      ) {
        onSwipe?.(dx < 0 ? 1 : -1);
      }
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

    if (state.scale > 1.01) {
      state.start = { ...point, x0: state.x, y0: state.y };
    } else if (allowSwipe) {
      state.swipe = { ...point, time: Date.now(), moved: false };
    }
  }, { passive: false });

  stage.addEventListener('touchmove', (event) => {
    if (event.touches.length >= 2 && state.pinch) {
      event.preventDefault();
      const a = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      const b = { x: event.touches[1].clientX, y: event.touches[1].clientY };
      state.scale = clamp(
        state.pinch.scale * pointDistance(a, b) / Math.max(1, state.pinch.distance),
        1,
        4
      );
      if (state.scale <= 1.01) {
        state.scale = 1;
        state.x = 0;
        state.y = 0;
      }
      applyPhotoViewerTransform(stage, state);
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;
    const point = { x: touch.clientX, y: touch.clientY };

    if (state.scale > 1.01 && state.start) {
      event.preventDefault();
      state.x = state.start.x0 + (point.x - state.start.x);
      state.y = state.start.y0 + (point.y - state.start.y);
      applyPhotoViewerTransform(stage, state);
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
      if (
        Date.now() - swipe.time < 700
        && Math.abs(dx) >= 55
        && Math.abs(dx) > Math.abs(dy) * 1.2
      ) {
        onSwipe?.(dx < 0 ? 1 : -1);
      }
    }

    state.start = null;
    state.swipe = null;
  }, { passive: false });
}
