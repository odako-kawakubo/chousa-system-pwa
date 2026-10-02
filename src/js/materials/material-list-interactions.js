/**
 * Material ListのDOMイベント配線とApple Pencilジェスチャ判定を担当する。
 * Store更新・保存・描画状態は持たない。
 */

const PEN_DRAG_THRESHOLD_PX = 12;
const PEN_CLICK_SUPPRESS_MS = 500;

let outsideMultiSelectBound = false;
let penPointer = null;
let ignoreNextPenClick = false;
let ignorePenClickUntil = 0;

function notifyGuideLayoutChanged() {
  window.dispatchEvent(new CustomEvent('chousa:guide-layout-change'));
}

function handlePenPointerDown(event) {
  if (event.pointerType !== 'pen') return;

  const scrollHost = event.target.closest('.material-list-table-wrap');
  penPointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    target: event.target,
    dragged: false,
    scrollHost,
    startScrollLeft: scrollHost ? scrollHost.scrollLeft : 0,
    startScrollTop: scrollHost ? scrollHost.scrollTop : 0
  };

  ignoreNextPenClick = false;
  ignorePenClickUntil = 0;
}

function handlePenPointerMove(event) {
  if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;
  const dx = event.clientX - penPointer.startX;
  const dy = event.clientY - penPointer.startY;
  if (Math.hypot(dx, dy) >= PEN_DRAG_THRESHOLD_PX) penPointer.dragged = true;
}

function handlePenPointerUp(event, activateTarget, allowInteraction) {
  if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;

  const gesture = penPointer;
  penPointer = null;
  const scrollMoved = Boolean(
    gesture.scrollHost && (
      gesture.scrollHost.scrollLeft !== gesture.startScrollLeft
      || gesture.scrollHost.scrollTop !== gesture.startScrollTop
    )
  );
  const wasDrag = gesture.dragged || scrollMoved;

  ignoreNextPenClick = true;
  ignorePenClickUntil = performance.now() + PEN_CLICK_SUPPRESS_MS;
  if (wasDrag) return;
  if (!allowInteraction('activate', gesture.target)) return;

  activateTarget(gesture.target, { fromPen: true });
}

function handlePenPointerCancel(event) {
  if (!penPointer || event.pointerType !== 'pen' || event.pointerId !== penPointer.pointerId) return;
  penPointer = null;
  ignoreNextPenClick = true;
  ignorePenClickUntil = performance.now() + PEN_CLICK_SUPPRESS_MS;
}

function bindOutsideMultiSelectClose(rootProvider) {
  if (outsideMultiSelectBound) return;
  outsideMultiSelectBound = true;

  document.addEventListener('pointerdown', (event) => {
    const root = rootProvider();
    if (!root) return;
    if (event.target.closest('[data-material-multi-select]')) return;

    let changed = false;
    root.querySelectorAll('[data-material-multi-select][open]').forEach((details) => {
      details.removeAttribute('open');
      changed = true;
    });
    if (changed) notifyGuideLayoutChanged();
  }, { passive: true });
}

export function bindMaterialListInteractions({
  root,
  getRoot = () => root,
  activateTarget,
  activateTextDisplay,
  commitTextEditor,
  updateSampleParts,
  updateControl,
  allowInteraction = () => true
}) {
  if (!root || root.dataset.eventsBound === '1') return;
  root.dataset.eventsBound = '1';

  root.addEventListener('pointerdown', handlePenPointerDown, { passive: true });
  root.addEventListener('pointermove', handlePenPointerMove, { passive: true });
  root.addEventListener('pointerup', (event) => {
    handlePenPointerUp(event, activateTarget, allowInteraction);
  }, { passive: true });
  root.addEventListener('pointercancel', handlePenPointerCancel, { passive: true });

  root.addEventListener('click', (event) => {
    if (ignoreNextPenClick && performance.now() <= ignorePenClickUntil) {
      ignoreNextPenClick = false;
      ignorePenClickUntil = 0;
      return;
    }
    ignoreNextPenClick = false;
    ignorePenClickUntil = 0;

    if (!allowInteraction('activate', event.target)) {
      event.preventDefault();
      return;
    }

    const closeMultiSelect = event.target.closest('[data-action="close-material-multi-select"]');
    if (closeMultiSelect) {
      event.preventDefault();
      event.stopPropagation();
      closeMultiSelect.closest('[data-material-multi-select]')?.removeAttribute('open');
      notifyGuideLayoutChanged();
      return;
    }

    activateTarget(event.target);
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-material-text-input]')) {
      if (!allowInteraction('text', event.target)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      event.target.blur();
      return;
    }

    if (
      (event.key === 'Enter' || event.key === ' ')
      && event.target.matches('[data-material-text-display]')
    ) {
      if (!allowInteraction('activate', event.target)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      activateTextDisplay(event.target);
    }
  });

  root.addEventListener('focusout', (event) => {
    const input = event.target.closest('[data-material-text-input]');
    if (!input) return;
    if (!allowInteraction('text', input)) return;
    commitTextEditor(input);
  });

  root.addEventListener('change', (event) => {
    const multiPart = event.target.closest('[data-material-multi-part]');
    if (multiPart) {
      if (multiPart.disabled || !allowInteraction('change', multiPart)) return;
      updateSampleParts(multiPart.dataset.materialId);
      return;
    }

    const control = event.target.closest('[data-material-control]');
    if (!control || !allowInteraction('change', control)) return;
    updateControl(control);
  });

  root.addEventListener('toggle', (event) => {
    if (event.target.matches?.('[data-material-multi-select]')) {
      notifyGuideLayoutChanged();
    }
  }, true);

  bindOutsideMultiSelectClose(getRoot);
}

export function resetMaterialListInteractionState() {
  penPointer = null;
  ignoreNextPenClick = false;
  ignorePenClickUntil = 0;
}
