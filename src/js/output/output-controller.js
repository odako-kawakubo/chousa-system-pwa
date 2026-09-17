/**
 * src/js/output/output-controller.js
 * 「出力」タブの実PDFレビューと、帳票外の写真・採取メモ編集を担当する。
 *
 * v0.1.7.6 r6:
 * - 実PDFレビューはA4全体が見えるページフィット表示を基本とする。
 * - PDF保存と同じベクターレンダラーのBlobをそのまま表示する。
 * - 写真選択 / 採取メモ編集は帳票外の編集パネルに残す。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';
import { createVectorPdfBlob } from './output-pdf-renderer.js';
import { prepareOutputPhotoSources } from './output-photo-source.js';
import { setSamplingOutputMemo } from './output-state.js';
import {
  initializeOutputPhotoSelectionBridge,
  openVisualOutputPhotoViewer,
  openSamplingOutputPhotoViewer
} from './output-photo-selection.js';
import { initializeOutputExportController } from './output-export-controller.js';

let activeView = 'materials';
let initialized = false;
let renderSerial = 0;
let currentVm = null;
let previewObjectUrl = '';
let previewRefreshTimer = null;

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
function releasePreviewObjectUrl() {
  if (!previewObjectUrl) return;
  URL.revokeObjectURL?.(previewObjectUrl);
  previewObjectUrl = '';
}
function activeViewLabel() {
  if (activeView === 'materials') return '建材リスト';
  if (activeView === 'rooms') return '部屋別リスト';
  if (activeView === 'visual-photos') return '建材写真帳';
  return '採取写真帳';
}

function renderVisualEditor(vm) {
  const items = vm?.visualPhotoItems || [];
  if (!items.length) return '<div class="output-editor-empty">写真帳の対象建材がありません。</div>';
  return `<div class="output-editor-list">${items.map((item) => {
    const label = [`建材No.${item.materialNo}`, item.part, item.name].filter((v) => String(v ?? '').trim()).join('　');
    const state = item.photoId ? '選択済み' : '未選択';
    return `<div class="output-editor-row">
      <div class="output-editor-row-main"><b>${escapeHtml(label)}</b><span>${escapeHtml(state)}</span></div>
      <button type="button" class="btn small" data-output-visual-expand="${escapeHtml(item.materialId)}">写真選択</button>
    </div>`;
  }).join('')}</div>`;
}

function renderSamplingEditor(vm) {
  const pages = vm?.samplingPhotoPages || [];
  if (!pages.length) return '<div class="output-editor-empty">採取写真帳の対象がありません。</div>';
  return `<div class="output-editor-list">${pages.map((page) => {
    const sampleLabel = [page.sampleName, page.samplingPlace ? `部屋No.${page.samplingPlace}` : ''].filter(Boolean).join('　');
    const stages = (page.stages || []).map((stage) => `<div class="output-sampling-editor-stage">
      <div class="output-sampling-editor-head">
        <b>${escapeHtml(stage.label || stage.type)}</b>
        <button type="button" class="btn small"
          data-output-sampling-expand="${escapeHtml(page.materialId)}"
          data-output-branch="${Number(page.branch) || 0}"
          data-output-stage="${escapeHtml(stage.type)}">写真選択</button>
      </div>
      <textarea class="output-sampling-editor-memo" rows="3"
        placeholder="撮影メモ"
        data-output-sampling-memo-editor
        data-output-material-id="${escapeHtml(page.materialId)}"
        data-output-branch="${Number(page.branch) || 0}"
        data-output-stage="${escapeHtml(stage.type)}">${escapeHtml(stage.memo || '')}</textarea>
    </div>`).join('');
    return `<section class="output-editor-group"><div class="output-editor-group-title">${escapeHtml(sampleLabel || `建材No.${page.materialNo || ''}`)}</div>${stages}</section>`;
  }).join('')}</div>`;
}

function renderEditorPanel(vm) {
  if (activeView === 'visual-photos') {
    return `<aside class="output-editor-panel"><div class="output-editor-title">写真帳編集</div>${renderVisualEditor(vm)}</aside>`;
  }
  if (activeView === 'sampling-photos') {
    return `<aside class="output-editor-panel"><div class="output-editor-title">採取写真帳編集</div>${renderSamplingEditor(vm)}</aside>`;
  }
  return '';
}

function setPreviewStatus(message, isError = false) {
  const node = outputRoot()?.querySelector('[data-output-preview-status]');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('is-error', Boolean(isError));
}

async function renderPdfPreview(serial, vm) {
  const root = outputRoot();
  const host = root?.querySelector('[data-output-pdf-host]');
  if (!root || !host || serial !== renderSerial) return;

  try {
    setPreviewStatus('実PDFを生成しています…');
    const photoSources = await prepareOutputPhotoSources([activeView], vm, {
      onProgress:(text) => {
        if (serial === renderSerial) setPreviewStatus(text);
      }
    });
    if (serial !== renderSerial) return;

    const blob = await createVectorPdfBlob({
      targets:[activeView],
      vm,
      photoSources,
      onProgress:(text) => {
        if (serial === renderSerial) setPreviewStatus(text);
      }
    });
    if (serial !== renderSerial) return;

    releasePreviewObjectUrl();
    previewObjectUrl = URL.createObjectURL(blob);
    host.innerHTML = `<iframe class="output-pdf-frame" title="${escapeHtml(activeViewLabel())} 実PDFレビュー" src="${escapeHtml(previewObjectUrl)}#toolbar=0&navpanes=0&view=Fit"></iframe>`;
    setPreviewStatus('実際に出力されるPDFをページ全体表示しています。');
  } catch (error) {
    console.error('実PDFレビュー生成に失敗しました', error);
    if (serial !== renderSerial) return;
    host.innerHTML = '<div class="output-preview-error">PDFレビューを生成できませんでした。</div>';
    setPreviewStatus(`PDFレビュー生成に失敗しました：${error?.message || error}`, true);
  }
}

function refreshPdfPreviewOnly() {
  const root = outputRoot();
  if (!root) return;
  renderSerial += 1;
  const serial = renderSerial;
  currentVm = buildOutputViewModel();
  const host = root.querySelector('[data-output-pdf-host]');
  if (host) host.innerHTML = '<div class="output-preview-loading">実PDFを更新しています…</div>';
  void renderPdfPreview(serial, currentVm);
}

function schedulePdfPreviewRefresh() {
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer);
  previewRefreshTimer = setTimeout(() => {
    previewRefreshTimer = null;
    refreshPdfPreviewOnly();
  }, 300);
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
  renderSerial += 1;
  const serial = renderSerial;
  currentVm = buildOutputViewModel();

  root.innerHTML = `<div class="output-root">
    <div class="output-toolbar">
      <button type="button" class="btn small output-view-btn ${activeView === 'materials' ? 'active' : ''}" data-output-view="materials">建材リスト</button>
      <button type="button" class="btn small output-view-btn ${activeView === 'rooms' ? 'active' : ''}" data-output-view="rooms">部屋別リスト</button>
      <button type="button" class="btn small output-view-btn ${activeView === 'visual-photos' ? 'active' : ''}" data-output-view="visual-photos">建材写真帳</button>
      <button type="button" class="btn small output-view-btn ${activeView === 'sampling-photos' ? 'active' : ''}" data-output-view="sampling-photos">採取写真帳</button>
      <span class="output-toolbar-fill"></span>
      <button type="button" class="btn small" data-output-export="pdf">PDF</button>
      <button type="button" class="btn small" data-output-export="print">印刷</button>
      <button type="button" class="btn small" data-output-export="excel">Excel</button>
    </div>
    <div class="output-review-layout ${activeView === 'visual-photos' || activeView === 'sampling-photos' ? 'has-editor' : ''}">
      <section class="output-pdf-review">
        <div class="output-preview-status" data-output-preview-status>実PDFを生成しています…</div>
        <div class="output-pdf-host" data-output-pdf-host><div class="output-preview-loading">実PDFを生成しています…</div></div>
      </section>
      ${renderEditorPanel(currentVm)}
    </div>
  </div>`;

  void renderPdfPreview(serial, currentVm);
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
    if (viewButton) {
      activeView = viewButton.dataset.outputView || 'materials';
      renderOutputTab();
      return;
    }
    const visual = event.target.closest('[data-output-visual-expand]');
    if (visual) {
      openVisualSelection(visual.dataset.outputVisualExpand);
      return;
    }
    const sampling = event.target.closest('[data-output-sampling-expand]');
    if (sampling) {
      openSamplingSelection(sampling.dataset.outputSamplingExpand, Number(sampling.dataset.outputBranch), sampling.dataset.outputStage);
    }
  });

  root.addEventListener('input', (event) => {
    const editor = event.target.closest?.('[data-output-sampling-memo-editor]');
    if (!editor) return;
    const materialId = editor.dataset.outputMaterialId;
    const branch = Number(editor.dataset.outputBranch) || 0;
    const stage = editor.dataset.outputStage || '';
    if (!materialId || !branch || !stage) return;
    setSamplingOutputMemo(materialId, branch, stage, String(editor.value || ''));
    schedulePdfPreviewRefresh();
  });

  finishRecordStore.subscribe(renderOutputTab);
  materialRecordStore.subscribe(renderOutputTab);
  photoRecordStore.subscribe(renderOutputTab);
  renderOutputTab();
}
