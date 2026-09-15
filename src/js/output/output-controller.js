/**
 * src/js/output/output-controller.js
 * 「出力」タブの帳票プレビュー・ページ操作・出力写真選択を担当する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';
import { resolveViewerCompletedPhoto } from '../photos/photo-viewer-source.js';
import {
  initializeOutputPhotoSelectionBridge,
  openVisualOutputPhotoViewer,
  openSamplingOutputPhotoViewer
} from './output-photo-selection.js';

const MATERIAL_ROWS_PER_PAGE = 24;
const ROOM_ROWS_PER_PAGE = 24;
const VISUAL_ITEMS_PER_PAGE = 8;

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
function chunkRows(rows, size) {
  if (!rows.length) return [[]];
  const pages = [];
  for (let index = 0; index < rows.length; index += size) pages.push(rows.slice(index, index + size));
  return pages;
}
function roomGroupKey(row) { return `${row.floor}\u0000${row.roomNo}`; }
function paginateRoomRows(rows) {
  if (!rows.length) return [[]];
  const groups = [];
  let current = [];
  let currentKey = null;
  rows.forEach((row) => {
    const key = roomGroupKey(row);
    if (current.length && key !== currentKey) { groups.push(current); current = []; }
    currentKey = key;
    current.push(row);
  });
  if (current.length) groups.push(current);

  const pages = [];
  let page = [];
  groups.forEach((group) => {
    if (group.length > ROOM_ROWS_PER_PAGE) {
      if (page.length) pages.push(page);
      page = [];
      for (let index = 0; index < group.length; index += ROOM_ROWS_PER_PAGE) pages.push(group.slice(index, index + ROOM_ROWS_PER_PAGE));
      return;
    }
    if (page.length && page.length + group.length > ROOM_ROWS_PER_PAGE) { pages.push(page); page = []; }
    page.push(...group);
  });
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}
function renderPageShell(content, pageIndex, pageCount) {
  return `<section class="output-page-shell" data-output-page="${pageIndex}"><div class="output-page-label">${pageIndex + 1} / ${pageCount}</div>${content}</section>`;
}
function emptyMaterialRows(count) {
  return Array.from({ length: count }, () => '<tr class="output-blank-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
}
function renderMaterialPage(rows) {
  const blankCount = Math.max(0, MATERIAL_ROWS_PER_PAGE - rows.length);
  return `<article class="output-paper output-paper-material"><h2 class="output-report-title">調査対象建材リスト</h2><table class="output-report-table output-material-report"><colgroup><col class="col-no"><col class="col-name"><col class="col-part"><col class="col-place"><col class="col-level"><col class="col-analysis"><col class="col-result"><col class="col-note"></colgroup><thead><tr><th>建材<br>No.</th><th>建材名</th><th>部位</th><th>施工範囲<br><span>部屋No.</span></th><th>建材<br>レベル</th><th>分析の要否</th><th>石綿含有<br>の有無</th><th>備考</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="center">${escapeHtml(row.materialNo)}</td><td>${escapeHtml(row.name)}</td><td class="center">${escapeHtml(row.part)}</td><td>${escapeHtml(row.usageLocation)}</td><td class="center">${escapeHtml(row.level)}</td><td class="center">${escapeHtml(row.analysisRequired)}</td><td class="center">${escapeHtml(row.analysisResult)}</td><td>${escapeHtml(row.note)}</td></tr>`).join('')}${emptyMaterialRows(blankCount)}</tbody></table><div class="output-report-footer">以下余白</div></article>`;
}
function renderMaterialTable(rows) {
  const pages = chunkRows(rows, MATERIAL_ROWS_PER_PAGE);
  return `<div class="output-pages">${pages.map((pageRows, index) => renderPageShell(renderMaterialPage(pageRows), index, pages.length)).join('')}</div>`;
}
function spanLength(rows, index, key, parentKey = null) {
  const value = rows[index]?.[key];
  const parentValue = parentKey ? rows[index]?.[parentKey] : null;
  let count = 1;
  for (let i = index + 1; i < rows.length; i += 1) {
    if (rows[i]?.[key] !== value) break;
    if (parentKey && rows[i]?.[parentKey] !== parentValue) break;
    count += 1;
  }
  return count;
}
function shouldRenderGroupedCell(rows, index, key, parentKey = null) {
  if (index === 0) return true;
  if (rows[index - 1]?.[key] !== rows[index]?.[key]) return true;
  return Boolean(parentKey && rows[index - 1]?.[parentKey] !== rows[index]?.[parentKey]);
}
function renderRoomPage(rows) {
  return `<article class="output-paper output-paper-room"><h2 class="output-report-title">部屋別調査対象建材リスト</h2><table class="output-report-table output-room-report"><colgroup><col class="col-floor"><col class="col-room"><col class="col-part"><col class="col-no"><col class="col-name"><col class="col-note"><col class="col-level"><col class="col-result"></colgroup><thead><tr><th>階</th><th>部屋No.</th><th>部位</th><th>建材<br>No.</th><th>建材名称</th><th>備考</th><th>建材<br>レベル</th><th>分析結果</th></tr></thead><tbody>${rows.map((row, index) => {
    const floorCell = shouldRenderGroupedCell(rows, index, 'floor') ? `<td class="center group-cell" rowspan="${spanLength(rows, index, 'floor')}">${escapeHtml(row.floor)}</td>` : '';
    const roomCell = shouldRenderGroupedCell(rows, index, 'roomNo', 'floor') ? `<td class="center group-cell" rowspan="${spanLength(rows, index, 'roomNo', 'floor')}">${escapeHtml(row.roomNo)}${row.roomName ? `<div class="output-room-name">${escapeHtml(row.roomName)}</div>` : ''}${row.roomNote ? `<div class="output-room-note">${escapeHtml(row.roomNote)}</div>` : ''}</td>` : '';
    return `<tr class="${row.registered ? '' : 'is-unregistered'}">${floorCell}${roomCell}<td class="center">${escapeHtml(row.part)}</td><td class="center">${escapeHtml(row.materialNo)}</td><td>${escapeHtml(row.materialName)}</td><td>${escapeHtml(row.note)}</td><td class="center">${escapeHtml(row.level)}</td><td class="center">${escapeHtml(row.analysisResult)}</td></tr>`;
  }).join('')}</tbody></table></article>`;
}
function renderRoomTable(rows) {
  const pages = paginateRoomRows(rows);
  return `<div class="output-pages">${pages.map((pageRows, index) => renderPageShell(renderRoomPage(pageRows), index, pages.length)).join('')}</div>`;
}
function visualPhotoSlot(item) {
  const canSelect = item.candidates?.length > 0;
  return `<div class="output-visual-slot"><div class="output-photo-frame-wrap"><div class="output-photo-frame" data-output-photo-id="${escapeHtml(item.photoId)}"><span>${item.photoId ? '写真読込中' : '写真なし'}</span></div>${canSelect ? `<button class="output-photo-expand" type="button" data-output-visual-expand="${escapeHtml(item.materialId)}">拡大</button>` : ''}</div><div class="output-visual-caption"><b>試料No. ${escapeHtml(item.materialNo)}</b><span>${escapeHtml(item.part)}${item.part && item.name ? '　' : ''}${escapeHtml(item.name)}</span></div></div>`;
}
function renderVisualPhotoBook(items) {
  const pages = chunkRows(items, VISUAL_ITEMS_PER_PAGE);
  return `<div class="output-pages">${pages.map((pageItems, pageIndex) => {
    const slots = [...pageItems];
    while (slots.length < VISUAL_ITEMS_PER_PAGE) slots.push(null);
    const paper = `<article class="output-paper output-photo-book-paper"><h2 class="output-report-title">調査対象建材写真帳</h2><div class="output-visual-grid">${slots.map((item) => item ? visualPhotoSlot(item) : '<div class="output-visual-slot is-empty"></div>').join('')}</div></article>`;
    return renderPageShell(paper, pageIndex, pages.length);
  }).join('')}</div>`;
}
function renderSamplingPhotoBook(pages) {
  const safePages = pages.length ? pages : [{ materialId:'', branch:0, projectName:'', projectNo:'', sampleNo:'', materialName:'', part:'', samplingPlace:'', capturedDate:'', stages:[] }];
  return `<div class="output-pages">${safePages.map((item, pageIndex) => {
    const stageMap = new Map((item.stages || []).map((stage) => [stage.type, stage]));
    const paper = `<article class="output-paper output-sampling-paper"><h2 class="output-report-title">試料採取写真</h2><table class="output-sampling-meta"><tbody><tr><th>件名：</th><td>${escapeHtml(item.projectName)}</td><th>試料：</th><td>${escapeHtml(item.projectNo)}${item.projectNo && item.sampleNo ? '-' : ''}${escapeHtml(item.sampleNo)}</td><th>採取日：</th><td>${escapeHtml(item.capturedDate)}</td></tr><tr><th>場所：</th><td colspan="5">${escapeHtml(item.part)}${item.part && item.materialName ? '　' : ''}${escapeHtml(item.materialName)}${item.samplingPlace ? `　部屋No.${escapeHtml(item.samplingPlace)}` : ''}</td></tr></tbody></table><div class="output-sampling-stages">${['before','during','after'].map((type) => {
      const stage = stageMap.get(type) || { label: type === 'before' ? '施工前' : type === 'during' ? '施工中' : '施工後', photoId:'', candidates:[] };
      const canSelect = stage.candidates?.length > 0;
      return `<div class="output-sampling-stage"><div class="output-stage-label">撮影状況：　${escapeHtml(stage.label)}</div><div class="output-photo-frame-wrap output-sampling-frame-wrap"><div class="output-sampling-frame output-photo-frame" data-output-photo-id="${escapeHtml(stage.photoId)}"><span>${stage.photoId ? '写真読込中' : '写真なし'}</span></div>${canSelect ? `<button class="output-photo-expand" type="button" data-output-sampling-expand="${escapeHtml(item.materialId)}" data-output-branch="${Number(item.branch)||0}" data-output-stage="${escapeHtml(type)}">拡大</button>` : ''}</div></div>`;
    }).join('')}</div></article>`;
    return renderPageShell(paper, pageIndex, safePages.length);
  }).join('')}</div>`;
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
  const pages = root.querySelector('.output-pages');
  pages?.classList.toggle('is-single-page', pageMode === 'single');
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
  openVisualOutputPhotoViewer({ materialId:item.materialId, selectedPhotoId:item.photoId, candidates:item.candidates, onSelection:() => renderOutputTab() });
}
function openSamplingSelection(materialId, branch, shootingType) {
  const page = currentVm?.samplingPhotoPages?.find((item) => String(item.materialId) === String(materialId) && Number(item.branch) === Number(branch));
  const stage = page?.stages?.find((item) => item.type === shootingType);
  if (!page || !stage) return;
  openSamplingOutputPhotoViewer({ materialId:page.materialId, branch:page.branch, shootingType, selectedPhotoId:stage.photoId, candidates:stage.candidates, onSelection:() => renderOutputTab() });
}

export function renderOutputTab() {
  const root = outputRoot();
  if (!root) return;
  releaseOutputObjectUrls();
  renderSerial += 1;
  const serial = renderSerial;
  currentVm = buildOutputViewModel();
  let body = '';
  if (activeView === 'rooms') body = renderRoomTable(currentVm.roomRows);
  else if (activeView === 'visual-photos') body = renderVisualPhotoBook(currentVm.visualPhotoItems);
  else if (activeView === 'sampling-photos') body = renderSamplingPhotoBook(currentVm.samplingPhotoPages);
  else body = renderMaterialTable(currentVm.materialRows);

  root.innerHTML = `<div class="output-root"><div class="output-toolbar"><button type="button" class="btn small output-view-btn ${activeView === 'materials' ? 'active' : ''}" data-output-view="materials">建材リスト</button><button type="button" class="btn small output-view-btn ${activeView === 'rooms' ? 'active' : ''}" data-output-view="rooms">部屋別リスト</button><button type="button" class="btn small output-view-btn ${activeView === 'visual-photos' ? 'active' : ''}" data-output-view="visual-photos">建材写真帳</button><button type="button" class="btn small output-view-btn ${activeView === 'sampling-photos' ? 'active' : ''}" data-output-view="sampling-photos">採取写真帳</button><span class="output-toolbar-separator"></span><button type="button" class="btn small output-page-mode-btn" data-output-page-mode="continuous">連続表示</button><button type="button" class="btn small output-page-mode-btn" data-output-page-mode="single">1ページ表示</button><button type="button" class="btn small" data-output-page-prev>‹</button><span class="output-page-counter" data-output-page-counter></span><button type="button" class="btn small" data-output-page-next>›</button><span class="output-toolbar-fill"></span><button type="button" class="btn small" data-output-export="pdf">PDF</button><button type="button" class="btn small" data-output-export="print">印刷</button><button type="button" class="btn small" data-output-export="excel">Excel</button></div><div class="output-preview">${body}</div></div>`;
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
