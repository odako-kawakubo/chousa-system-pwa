/**
 * src/js/guide/guide-overlay.js
 *
 * 実画面上へ重ねる共通ガイドUI。
 * 業務データやタブ状態は持たず、指定された対象DOMの強調表示と説明カードだけを担当する。
 */

let layer = null;
let spotlight = null;
let card = null;
let observer = null;
let repositionCallback = null;

function ensureLayer() {
  if (layer) return layer;

  layer = document.createElement('div');
  layer.className = 'guide-layer';
  layer.hidden = true;
  layer.innerHTML = `
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
  return layer;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function visibleCollisionRects() {
  return [...document.querySelectorAll('.finish-candidate-popup:not([hidden])')]
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

export function positionGuideOverlay(target) {
  if (!layer || layer.hidden) return;
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

export function showGuideOverlay({ step, index, total, target, interactive = false, onPrev, onNext, onClose }) {
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

  positionGuideOverlay(target);
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
  if (observer) observer.disconnect();
  observer = null;
  repositionCallback = null;
}
