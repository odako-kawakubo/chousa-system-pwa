/**
 * OutputタブのPDF Preview状態と生成・ページ送り・Zoomを管理する。
 * Outputタブ全体の画面状態や写真選択/設定編集は持たない。
 */
import { createVectorPdfPreview } from './output-pdf-renderer.js';
import { OutputPdfPreview } from './output-pdf-preview.js';
import { prepareOutputPhotoSources } from './output-photo-source.js';

let renderSerial = 0;
let previewRefreshTimer = null;
let previewPage = 1;
let previewPageCount = 1;
let previewZoom = 100;
let previewRenderer = null;

export function getOutputPdfPreviewState() {
  return {
    page: previewPage,
    pageCount: previewPageCount,
    zoom: previewZoom,
    hasRenderer: Boolean(previewRenderer)
  };
}

export function resetOutputPdfPreviewView({ page = 1, zoom = 100 } = {}) {
  previewPage = Math.max(1, Number(page) || 1);
  previewZoom = Math.max(50, Math.min(200, Number(zoom) || 100));
}

export function beginOutputPdfPreviewRender() {
  renderSerial += 1;
  previewRenderer?.destroy();
  previewRenderer = null;
  return renderSerial;
}

function setPreviewStatus(root, message, isError = false) {
  const node = root?.querySelector('[data-output-preview-status]');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('is-error', Boolean(isError));
}

function updatePreviewControls(root) {
  if (!root) return;
  root.querySelectorAll('[data-output-page-counter]').forEach((node) => {
    node.textContent = `${previewPage} / ${previewPageCount}`;
  });
  root.querySelectorAll('[data-output-zoom-label]').forEach((node) => {
    node.textContent = `${previewZoom}%`;
  });
  root.querySelectorAll('[data-output-page-prev]').forEach((node) => {
    node.disabled = previewPage <= 1;
  });
  root.querySelectorAll('[data-output-page-next]').forEach((node) => {
    node.disabled = previewPage >= previewPageCount;
  });
}

export async function setOutputPdfPreviewPage(root, page, { edge = 'top' } = {}) {
  if (!previewRenderer) return previewPage;

  previewPage = await previewRenderer.setPage(page);
  const host = root?.querySelector('[data-output-pdf-host]');
  if (host) {
    if (edge === 'bottom') {
      host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
    } else {
      host.scrollTop = 0;
    }
  }
  updatePreviewControls(root);
  return previewPage;
}

export async function setOutputPdfPreviewZoom(root, zoom) {
  if (!previewRenderer) return previewZoom;

  previewZoom = await previewRenderer.setZoom(zoom);
  const host = root?.querySelector('[data-output-pdf-host]');
  if (host) {
    host.scrollTop = 0;
    host.scrollLeft = 0;
  }
  updatePreviewControls(root);
  return previewZoom;
}

export async function renderOutputPdfPreview({
  serial,
  root,
  activeView,
  vm,
  settings
}) {
  const host = root?.querySelector('[data-output-pdf-host]');
  if (!root || !host || serial !== renderSerial) return;

  try {
    setPreviewStatus(root, '実PDFを生成しています…');

    const photoSources = await prepareOutputPhotoSources(
      [activeView],
      vm,
      {
        onProgress: (text) => {
          if (serial === renderSerial) setPreviewStatus(root, text);
        }
      }
    );

    if (serial !== renderSerial) return;

    const result = await createVectorPdfPreview({
      targets: [activeView],
      vm,
      photoSources,
      settings,
      onProgress: (text) => {
        if (serial === renderSerial) setPreviewStatus(root, text);
      }
    });

    if (serial !== renderSerial) return;

    previewRenderer?.destroy();
    previewRenderer = new OutputPdfPreview(host);

    const state = await previewRenderer.load(result.blob, {
      page: previewPage,
      zoom: previewZoom
    });

    if (serial !== renderSerial) return;

    previewPageCount = state.pageCount;
    previewPage = state.page;
    previewZoom = state.zoom;

    setPreviewStatus(root, '実際に出力されるPDFを1ページずつ表示しています。');
    updatePreviewControls(root);
  } catch (error) {
    console.error('実PDFレビュー生成に失敗しました', error);
    if (serial !== renderSerial) return;

    host.innerHTML = '<div class="output-preview-error">PDFレビューを生成できませんでした。</div>';
    setPreviewStatus(
      root,
      `PDFレビュー生成に失敗しました：${error?.message || error}`,
      true
    );
  }
}

export function refreshOutputPdfPreview({
  root,
  activeView,
  vm,
  settings
}) {
  if (!root) return;

  const serial = beginOutputPdfPreviewRender();
  const host = root.querySelector('[data-output-pdf-host]');
  if (host) {
    host.innerHTML = '<div class="output-preview-loading">実PDFを更新しています…</div>';
  }

  void renderOutputPdfPreview({
    serial,
    root,
    activeView,
    vm,
    settings
  });

  return serial;
}

export function scheduleOutputPdfPreviewRefresh(getContext, delay = 250) {
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer);

  previewRefreshTimer = setTimeout(() => {
    previewRefreshTimer = null;
    const context = getContext?.();
    if (!context) return;
    refreshOutputPdfPreview(context);
  }, delay);
}

export function rerenderOutputPdfPreview() {
  if (previewRenderer) {
    void previewRenderer.render();
  }
}
