/**
 * src/js/output/output-controller.js
 * 「出力」タブの帳票プレビュー・ページ操作・出力写真選択を担当する。
 * 帳票HTMLはoutput-report-rendererへ集約し、PDF/印刷と共用する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';
import { renderOutputTarget } from './output-report-renderer.js';
import { fitOutputPhotoImage } from './output-photo-layout.js';
import { resolveViewerCompletedPhoto } from '../photos/photo-viewer-source.js';
import {
  initializeOutputPhotoSelectionBridge,
  openVisualOutputPhotoViewer,
  openSamplingOutputPhotoViewer
} from './output-photo-selection.js';
import { initializeOutputExportController } from './output-export-controller.js';

let activeView = 'materials';
let pageMode = 'continuous';
let currentPage = 0;
let initialized = false;
let renderSerial = 0;
let outputObjectUrls = [];
let currentVm = null;
let swipeStart = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function ensureOutputStyles() {
  if (document.querySelector('link[data-output-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/output.css';
  link.dataset.outputStyles = '1';
  document.head.appendChild(link);
}
function outputRoot() { return document.getElementById('sync'); }
function releaseOutputObjectUrls() {
  outputObjectUrls.forEach((url) => URL.revokeObjectURL?.(url));
  outputObjectUrls = [];
}
async function hydratePhotoImages(serial) {
  const root = outputRoot();
  if (!root || serial !== renderSerial) return;
  const frames = [...root.querySelectorAll('[data-output-photo-id]')].filter((frame) => frame.dataset.outputPhotoId);
  await Promise.all(frames.map(async (frame) => {
    const photoId = frame.dataset.outputPhotoId;
    const photo = photoRecordStore.get(photoId);
    if (!photo) return;
    try {
      const blob = await resolveViewerCompletedPhoto(photo);
      if (!(blob instanceof Blob) || serial !== renderSerial || !frame.isConnected) return;
      const url = URL.createObjectURL(blob);
      outputObjectUrls.push(url);
      frame.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(photo.fileName || photo.photoId)}">`;
      const image = frame.querySelector('img');
      if (image) {
        try { await image.decode(); } catch (_) { /* load完了後に寸法が取れればよい */ }
        if (serial === renderSerial && frame.isConnected) fitOutputPhotoImage(image);
      }
    } catch (error) {
      console.warn('出力写真の読込に失敗しました', { photoId, error });
      if (frame.isConnected) frame.innerHTML = '<span>写真を読み込めませんでした</span>';
    }
  }));
}
function pageCount() { return outputRoot()?.querySelectorAll('[data-output-page]').length || 1; }
function clampCurrentPage() { currentPage = Math.max(0, Math.min(currentPage, pageCount() - 1)); }
function applyPageMode() {
  const root = outputRoot();
  if (!root) return;
  clampCurrentPage();
  root.querySelector('.output-pages')?.classList.toggle('is-single-page', pageMode === 'single');
  root.querySelectorAll('[data-output-page]').forEach((page) => page.classList.toggle('is-current', Number(page.dataset.outputPage) === currentPage));
  root.querySelectorAll('[data-output-page-mode]').forEach((button) => button.classList.toggle('active', button.dataset.outputPageMode === pageMode));
  const counter = root.querySelector('[data-output-page-counter]');
  if (counter) counter.textContent = `${currentPage + 1} / ${pageCount()}`;
  root.querySelector('[data-output-page-prev]')?.toggleAttribute('disabled', pageMode !== 'single' || currentPage <= 0);
  root.querySelector('[data-output-page-next]')?.toggleAttribute('disabled', pageMode !== 'single' || currentPage >= pageCount() - 1);
}
function movePage(delta) {
  if (pageMode !== 'single') return;
  currentPage += delta;
  applyPageMode();
  outputRoot()?.querySelector('.output-preview')?.scrollTo({ top:0, behavior:'smooth' });
}
function openVisualSelection(materialId) {
  const item = currentVm?.visualPhotoItems?.find((row) => String(row.materialId) === String(materialId));
  if (!item) return;
  openVisualOutputPhotoViewer({
    materialId:item.materialId,
    selectedPhotoId:item.photoId,
    candidates:item.candidates,
    onSelection:() => renderOutputTab()
  });
}
function openSamplingSelection(materialId, branch, shootingType) {
  const page = currentVm?.samplingPhotoPages?.find((item) => String(item.materialId) === String(materialId) && Number(item.branch) === Number(branch));
  const stage = page?.stages?.find((item) => item.type === shootingType);
  if (!page || !stage) return;
  openSamplingOutputPhotoViewer({
    materialId:page.materialId,
    branch:page.branch,
    shootingType,
    selectedPhotoId:stage.photoId,
    candidates:stage.candidates,
    onSelection:() => renderOutputTab()
  });
}

export function renderOutputTab() {
  const root = outputRoot();
  if (!root) return;
  releaseOutputObjectUrls();
  renderSerial += 1;
  const serial = renderSerial;
  currentVm = buildOutputViewModel();
  const body = renderOutputTarget(activeView, currentVm);
  root.innerHTML = `<div class="output-root"><div class="output-toolbar">
    <button type="button" class="btn small output-view-btn ${activeView === 'materials' ? 'active' : ''}" data-output-view="materials">建材リスト</button>
    <button type="button" class="btn small output-view-btn ${activeView === 'rooms' ? 'active' : ''}" data-output-view="rooms">部屋別リスト</button>
    <button type="button" class="btn small output-view-btn ${activeView === 'visual-photos' ? 'active' : ''}" data-output-view="visual-photos">建材写真帳</button>
    <button type="button" class="btn small output-view-btn ${activeView === 'sampling-photos' ? 'active' : ''}" data-output-view="sampling-photos">採取写真帳</button>
    <span class="output-toolbar-separator"></span>
    <button type="button" class="btn small output-page-mode-btn" data-output-page-mode="continuous">連続表示</button>
    <button type="button" class="btn small output-page-mode-btn" data-output-page-mode="single">1ページ表示</button>
    <button type="button" class="btn small" data-output-page-prev>‹</button>
    <span class="output-page-counter" data-output-page-counter></span>
    <button type="button" class="btn small" data-output-page-next>›</button>
    <span class="output-toolbar-fill"></span>
    <button type="button" class="btn small" data-output-export="pdf">PDF</button>
    <button type="button" class="btn small" data-output-export="print">印刷</button>
    <button type="button" class="btn small" data-output-export="excel">Excel</button>
  </div><div class="output-preview">${body}</div></div>`;
  applyPageMode();
  if (activeView === 'visual-photos' || activeView === 'sampling-photos') void hydratePhotoImages(serial);
}

export function initializeOutputTab() {
  if (initialized) return;
  initialized = true;
  ensureOutputStyles();
  initializeOutputPhotoSelectionBridge();
  const root = outputRoot();
  if (!root) return;
  initializeOutputExportController(root);
  const tab = document.querySelector('.tab[data-tab="sync"]');
  if (tab) tab.textContent = '出力';

  root.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-output-view]');
    if (viewButton) { activeView = viewButton.dataset.outputView || 'materials'; currentPage = 0; renderOutputTab(); return; }
    const modeButton = event.target.closest('[data-output-page-mode]');
    if (modeButton) { pageMode = modeButton.dataset.outputPageMode === 'single' ? 'single' : 'continuous'; currentPage = 0; applyPageMode(); return; }
    if (event.target.closest('[data-output-page-prev]')) { movePage(-1); return; }
    if (event.target.closest('[data-output-page-next]')) { movePage(1); return; }
    const visual = event.target.closest('[data-output-visual-expand]');
    if (visual) { openVisualSelection(visual.dataset.outputVisualExpand); return; }
    const sampling = event.target.closest('[data-output-sampling-expand]');
    if (sampling) { openSamplingSelection(sampling.dataset.outputSamplingExpand, Number(sampling.dataset.outputBranch), sampling.dataset.outputStage); return; }
  });
  root.addEventListener('pointerdown', (event) => {
    if (pageMode !== 'single' || event.pointerType === 'mouse') return;
    swipeStart = { x:event.clientX, y:event.clientY };
  }, { passive:true });
  root.addEventListener('pointerup', (event) => {
    if (!swipeStart || pageMode !== 'single') return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.2) movePage(dx < 0 ? 1 : -1);
  }, { passive:true });

  finishRecordStore.subscribe(renderOutputTab);
  materialRecordStore.subscribe(renderOutputTab);
  photoRecordStore.subscribe(renderOutputTab);
  renderOutputTab();
}
