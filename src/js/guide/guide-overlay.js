/**
 * src/js/guide/guide-overlay.js
 *
 * チュートリアル／操作ガイドの表示専用。
 * 操作制限・DOM監視・完了判定は持たない。
 * targetは1要素または複数要素を受け取り、複数時は外接矩形を1つの青枠として表示する。
 */

let visualLayer = null;
let spotlight = null;
let card = null;
let currentTargets = [];

function ensureOverlay() {
  if (visualLayer && card) return;

  visualLayer = document.createElement('div');
  visualLayer.className = 'guide-visual-layer';
  visualLayer.hidden = true;
  visualLayer.innerHTML = `
    <div class="guide-dim" data-guide-dim></div>
    <div class="guide-spotlight" data-guide-spotlight></div>`;
  document.body.appendChild(visualLayer);

  card = document.createElement('section');
  card.className = 'guide-card';
  card.dataset.guideCard = '';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  card.hidden = true;
  card.innerHTML = `
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
    </div>`;
  document.body.appendChild(card);

  spotlight = visualLayer.querySelector('[data-guide-spotlight]');
}

function normalizeTargets(target) {
  const list = Array.isArray(target) ? target : [target];
  return list.filter((node) => node?.isConnected);
}

function combinedRect(targets) {
  const rects = targets
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (!rects.length) return null;

  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
    width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
    height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top))
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function visibleCandidateRects() {
  return [...document.querySelectorAll('#finishCandidatePopup:not([hidden])')]
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function placeCard(targetRect) {
  if (!card || card.hidden) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardRect = card.getBoundingClientRect();
  const margin = 12;

  if (!targetRect) {
    card.style.left = `${Math.max(margin, (viewportWidth - cardRect.width) / 2)}px`;
    card.style.top = `${Math.max(margin, (viewportHeight - cardRect.height) / 2)}px`;
    return;
  }

  const gap = 12;
  const maxLeft = Math.max(margin, viewportWidth - cardRect.width - margin);
  const maxTop = Math.max(margin, viewportHeight - cardRect.height - margin);
  const candidates = [
    { left: clamp(targetRect.left, margin, maxLeft), top: clamp(targetRect.bottom + gap, margin, maxTop) },
    { left: clamp(targetRect.left, margin, maxLeft), top: clamp(targetRect.top - cardRect.height - gap, margin, maxTop) },
    { left: clamp(targetRect.right + gap, margin, maxLeft), top: clamp(targetRect.top, margin, maxTop) },
    { left: clamp(targetRect.left - cardRect.width - gap, margin, maxLeft), top: clamp(targetRect.top, margin, maxTop) }
  ];
  const collisions = visibleCandidateRects();
  const chosen = candidates.find((candidate) => {
    const candidateRect = {
      left: candidate.left,
      top: candidate.top,
      right: candidate.left + cardRect.width,
      bottom: candidate.top + cardRect.height
    };
    return !collisions.some((collision) => rectsOverlap(candidateRect, collision));
  }) || candidates[0];

  card.style.left = `${chosen.left}px`;
  card.style.top = `${chosen.top}px`;
}

export function positionGuideOverlay(target = currentTargets) {
  if (!visualLayer || visualLayer.hidden || !card || card.hidden) return;

  currentTargets = normalizeTargets(target);
  const targetRect = combinedRect(currentTargets);
  const dim = visualLayer.querySelector('[data-guide-dim]');

  if (!targetRect) {
    spotlight.hidden = true;
    dim.hidden = false;
    placeCard(null);
    return;
  }

  const pad = 6;
  spotlight.hidden = false;
  dim.hidden = true;
  spotlight.style.left = `${Math.max(4, targetRect.left - pad)}px`;
  spotlight.style.top = `${Math.max(4, targetRect.top - pad)}px`;
  spotlight.style.width = `${Math.max(18, targetRect.width + pad * 2)}px`;
  spotlight.style.height = `${Math.max(18, targetRect.height + pad * 2)}px`;
  placeCard(targetRect);
}

export function showGuideOverlay({
  step,
  index,
  total,
  target,
  interactive = false,
  onPrev,
  onNext,
  onClose,
  closeLabel = '閉じる'
}) {
  ensureOverlay();
  currentTargets = normalizeTargets(target);
  visualLayer.hidden = false;
  card.hidden = false;

  card.querySelector('[data-guide-section]').textContent = step.section || '';
  card.querySelector('[data-guide-progress]').textContent = `${index + 1} / ${total}`;
  card.querySelector('[data-guide-title]').textContent = step.title || '';
  card.querySelector('[data-guide-text]').textContent = step.text || '';

  const prev = card.querySelector('[data-guide-prev]');
  const next = card.querySelector('[data-guide-next]');
  const close = card.querySelector('[data-guide-close]');

  close.textContent = closeLabel;
  prev.disabled = index <= 0;
  next.hidden = Boolean(interactive);
  next.disabled = Boolean(interactive);
  next.textContent = index >= total - 1 ? '完了' : '次へ';

  prev.onclick = onPrev;
  next.onclick = onNext;
  close.onclick = onClose;

  positionGuideOverlay(currentTargets);
}

export function initializeGuideOverlayPositionEvents() {
  const reposition = () => positionGuideOverlay(currentTargets);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
}

export function hideGuideOverlay() {
  if (visualLayer) visualLayer.hidden = true;
  if (card) card.hidden = true;
  currentTargets = [];
}
