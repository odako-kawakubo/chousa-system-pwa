/**
 * src/js/guide/guide-overlay.js
 *
 * 実画面上へ重ねる共通ガイドUI。
 * 業務データやタブ状態は持たず、指定された対象DOMの強調表示と説明カードだけを担当する。
 */

let layer = null;
let spotlight = null;
let card = null;
let blockers = [];
let observer = null;
let repositionCallback = null;
let currentLockTargets = [];
let currentLocked = false;

function ensureLayer() {
  if (layer) return layer;

  layer = document.createElement('div');
  layer.className = 'guide-layer';
  layer.hidden = true;
  layer.innerHTML = `
    <div class="guide-blocker guide-blocker-top" data-guide-blocker="top"></div>
    <div class="guide-blocker guide-blocker-right" data-guide-blocker="right"></div>
    <div class="guide-blocker guide-blocker-bottom" data-guide-blocker="bottom"></div>
    <div class="guide-blocker guide-blocker-left" data-guide-blocker="left"></div>
    <div class="guide-dim" data-guide-dim></div>
    <div class="guide-spotlight" data-guide-spotlight></div>
    <section class="guide-card" data-guide-card role="dialog" aria-live="polite">
      <div class="guide-card-meta">
        <span data-guide-section></span>
        <span data-guide-progress></span>
      </div>
      <h3 data-guide-title></h3>
      <p data-guide-text></p>
      <div class="guide-card-actions">
        <button type="button" class="btn small" data-guide-close>閉じる</button>
        <span class="guide-card-fill"></span>
        <button type="button" class="btn small" data-guide-prev>戻る</button>
        <button type="button" class="btn small primary" data-guide-next>次へ</button>
      </div>
    </section>`;
  document.body.appendChild(layer);
  spotlight = layer.querySelector('[data-guide-spotlight]');
  card = layer.querySelector('[data-guide-card]');
  blockers = [...layer.querySelectorAll('[data-guide-blocker]')];
  blockers.forEach((blocker) => {
    blocker.addEventListener('wheel', (event) => event.preventDefault(), { passive:false });
    blocker.addEventListener('contextmenu', (event) => event.preventDefault());
  });
  return layer;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function visibleCollisionRects() {
  return [...document.querySelectorAll('#finishCandidatePopup:not([hidden])')]
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function placeCardForTarget(target) {
  if (!card) return;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardRect = card.getBoundingClientRect();
  const margin = 12;

  if (!target) {
    card.style.left = `${Math.max(margin, (viewportWidth - cardRect.width) / 2)}px`;
    card.style.top = `${Math.max(margin, (viewportHeight - cardRect.height) / 2)}px`;
    return;
  }

  const rect = target.getBoundingClientRect();
  const gap = 12;
  const maxLeft = Math.max(margin, viewportWidth - cardRect.width - margin);
  const maxTop = Math.max(margin, viewportHeight - cardRect.height - margin);
  const candidates = [
    { left: clamp(rect.left, margin, maxLeft), top: clamp(rect.bottom + gap, margin, maxTop) },
    { left: clamp(rect.left, margin, maxLeft), top: clamp(rect.top - cardRect.height - gap, margin, maxTop) },
    { left: clamp(rect.right + gap, margin, maxLeft), top: clamp(rect.top, margin, maxTop) },
    { left: clamp(rect.left - cardRect.width - gap, margin, maxLeft), top: clamp(rect.top, margin, maxTop) }
  ];
  const collisions = visibleCollisionRects();
  const chosen = candidates.find((candidate) => {
    const candidateRect = {
      left:candidate.left,
      top:candidate.top,
      right:candidate.left + cardRect.width,
      bottom:candidate.top + cardRect.height
    };
    return !collisions.some((collision) => rectsOverlap(candidateRect, collision));
  }) || candidates[0];

  card.style.left = `${chosen.left}px`;
  card.style.top = `${chosen.top}px`;
}

function visibleRectFor(node) {
  if (!node?.isConnected) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: clamp(rect.left, 0, window.innerWidth),
    top: clamp(rect.top, 0, window.innerHeight),
    right: clamp(rect.right, 0, window.innerWidth),
    bottom: clamp(rect.bottom, 0, window.innerHeight)
  };
}

function combinedLockRect(targets = []) {
  const rects = targets.map(visibleRectFor).filter(Boolean);
  if (!rects.length) return null;
  return rects.reduce((result, rect) => ({
    left: Math.min(result.left, rect.left),
    top: Math.min(result.top, rect.top),
    right: Math.max(result.right, rect.right),
    bottom: Math.max(result.bottom, rect.bottom)
  }));
}

function setBlockerRect(blocker, left, top, width, height) {
  if (!blocker) return;
  blocker.hidden = width <= 0 || height <= 0;
  blocker.style.left = `${Math.max(0, left)}px`;
  blocker.style.top = `${Math.max(0, top)}px`;
  blocker.style.width = `${Math.max(0, width)}px`;
  blocker.style.height = `${Math.max(0, height)}px`;
}

function positionGuideBlockers() {
  if (!layer || layer.hidden) return;
  blockers.forEach((blocker) => { blocker.hidden = !currentLocked; });
  if (!currentLocked) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = combinedLockRect(currentLockTargets);

  if (!rect) {
    setBlockerRect(blockers[0], 0, 0, viewportWidth, viewportHeight);
    blockers.slice(1).forEach((blocker) => { blocker.hidden = true; });
    return;
  }

  const pad = 7;
  const left = clamp(rect.left - pad, 0, viewportWidth);
  const top = clamp(rect.top - pad, 0, viewportHeight);
  const right = clamp(rect.right + pad, 0, viewportWidth);
  const bottom = clamp(rect.bottom + pad, 0, viewportHeight);

  setBlockerRect(blockers[0], 0, 0, viewportWidth, top);
  setBlockerRect(blockers[1], right, top, viewportWidth - right, bottom - top);
  setBlockerRect(blockers[2], 0, bottom, viewportWidth, viewportHeight - bottom);
  setBlockerRect(blockers[3], 0, top, left, bottom - top);
}

export function positionGuideOverlay(target, { locked = currentLocked, lockTargets = currentLockTargets } = {}) {
  if (!layer || layer.hidden) return;
  currentLocked = Boolean(locked);
  currentLockTargets = (Array.isArray(lockTargets) ? lockTargets : [lockTargets]).filter((node) => node?.isConnected);
  positionGuideBlockers();
  const dim = layer.querySelector('[data-guide-dim]');

  if (!target || !target.isConnected) {
    spotlight.hidden = true;
    dim.hidden = false;
    placeCardForTarget(null);
    return;
  }

  const rect = target.getBoundingClientRect();
  const pad = 6;
  spotlight.hidden = false;
  dim.hidden = true;
  spotlight.style.left = `${Math.max(4, rect.left - pad)}px`;
  spotlight.style.top = `${Math.max(4, rect.top - pad)}px`;
  spotlight.style.width = `${Math.max(18, rect.width + pad * 2)}px`;
  spotlight.style.height = `${Math.max(18, rect.height + pad * 2)}px`;
  placeCardForTarget(target);
}

export function showGuideOverlay({ step, index, total, target, interactive = false, locked = false, lockTargets = [], onPrev, onNext, onClose }) {
  ensureLayer();
  layer.hidden = false;

  layer.querySelector('[data-guide-section]').textContent = step.section || '';
  layer.querySelector('[data-guide-progress]').textContent = `${index + 1} / ${total}`;
  layer.querySelector('[data-guide-title]').textContent = step.title || '';
  layer.querySelector('[data-guide-text]').textContent = step.text || '';

  const prev = layer.querySelector('[data-guide-prev]');
  const next = layer.querySelector('[data-guide-next]');
  const close = layer.querySelector('[data-guide-close]');
  prev.disabled = index <= 0;
  next.hidden = Boolean(interactive);
  next.disabled = Boolean(interactive);
  next.textContent = index >= total - 1 ? '完了' : '次へ';
  prev.onclick = onPrev;
  next.onclick = onNext;
  close.onclick = onClose;

  positionGuideOverlay(target, { locked, lockTargets });
}

export function watchGuideOverlayPosition(callback) {
  repositionCallback = callback;
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => repositionCallback?.());
  // targetが再描画で差し替わった時だけ追従する。style属性まで監視すると\n  // 自身の位置更新を再検知してループするため、childListに限定する。\n  observer.observe(document.body, { childList: true, subtree: true });
}

export function initializeGuideOverlayPositionEvents() {
  const reposition = () => repositionCallback?.();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
}

export function hideGuideOverlay() {
  if (layer) layer.hidden = true;
  currentLocked = false;
  currentLockTargets = [];
  blockers.forEach((blocker) => { blocker.hidden = true; });
  if (observer) observer.disconnect();
  observer = null;
  repositionCallback = null;
}
