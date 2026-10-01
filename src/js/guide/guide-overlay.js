/**
 * src/js/guide/guide-overlay.js
 *
 * チュートリアル／操作ガイドの表示専用。
 * 操作制限・DOM監視・完了判定は持たない。
 */

let visualLayer = null;
let spotlight = null;
let card = null;
let currentTarget = null;

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

function placeCard(target) {
  if (!card || card.hidden) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardRect = card.getBoundingClientRect();
  const margin = 12;

  if (!target?.isConnected) {
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

export function positionGuideOverlay(target = currentTarget) {
  if (!visualLayer || visualLayer.hidden || !card || card.hidden) return;

  currentTarget = target?.isConnected ? target : null;
  const dim = visualLayer.querySelector('[data-guide-dim]');

  if (!currentTarget) {
    spotlight.hidden = true;
    dim.hidden = false;
    placeCard(null);
    return;
  }

  const rect = currentTarget.getBoundingClientRect();
  const pad = 6;
  spotlight.hidden = false;
  dim.hidden = true;
  spotlight.style.left = `${Math.max(4, rect.left - pad)}px`;
  spotlight.style.top = `${Math.max(4, rect.top - pad)}px`;
  spotlight.style.width = `${Math.max(18, rect.width + pad * 2)}px`;
  spotlight.style.height = `${Math.max(18, rect.height + pad * 2)}px`;
  placeCard(currentTarget);
}

export function showGuideOverlay({
  step,
  index,
  total,
  target,
  interactive = false,
  onPrev,
  onNext,
  onClose
}) {
  ensureOverlay();
  currentTarget = target?.isConnected ? target : null;
  visualLayer.hidden = false;
  card.hidden = false;

  card.querySelector('[data-guide-section]').textContent = step.section || '';
  card.querySelector('[data-guide-progress]').textContent = `${index + 1} / ${total}`;
  card.querySelector('[data-guide-title]').textContent = step.title || '';
  card.querySelector('[data-guide-text]').textContent = step.text || '';

  const prev = card.querySelector('[data-guide-prev]');
  const next = card.querySelector('[data-guide-next]');
  const close = card.querySelector('[data-guide-close]');

  prev.disabled = index <= 0;
  next.hidden = Boolean(interactive);
  next.disabled = Boolean(interactive);
  next.textContent = index >= total - 1 ? '完了' : '次へ';

  prev.onclick = onPrev;
  next.onclick = onNext;
  close.onclick = onClose;

  positionGuideOverlay(currentTarget);
}

export function initializeGuideOverlayPositionEvents() {
  const reposition = () => positionGuideOverlay(currentTarget);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
}

export function hideGuideOverlay() {
  if (visualLayer) visualLayer.hidden = true;
  if (card) card.hidden = true;
  currentTarget = null;
}
