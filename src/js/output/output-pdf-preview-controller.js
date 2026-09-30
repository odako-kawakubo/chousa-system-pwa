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

/**
 * Previewのpage/pageCount/zoom/renderer有無を読み取り専用objectで返す。Output Controllerは内部変数を直接触らない。
 */
export function getOutputPdfPreviewState() {
  return {
    page: previewPage,
    pageCount: previewPageCount,
    zoom: previewZoom,
    hasRenderer: Boolean(previewRenderer)
  };
}

/**
 * 出力種別切替時などにpageとzoomを初期値へ戻す。renderer自体の生成/破棄は行わない。
 */
export function resetOutputPdfPreviewView({ page = 1, zoom = 100 } = {}) {
  previewPage = Math.max(1, Number(page) || 1);
  previewZoom = Math.max(50, Math.min(200, Number(zoom) || 100));
}

/**
 * 新しいPreview生成serialを発行し、旧rendererを破棄する。非同期生成結果の競合をserialで無効化する基点。
 */
export function beginOutputPdfPreviewRender() {
  renderSerial += 1;
  previewRenderer?.destroy();
  previewRenderer = null;
  return renderSerial;
}

/**
 * PDF生成中/完了/失敗のstatus文字列とerror classをPreview UIへ反映する内部helper。
 */
function setPreviewStatus(root, message, isError = false) {
  const node = root?.querySelector('[data-output-preview-status]');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('is-error', Boolean(isError));
}

/**
 * 現在page/pageCount/zoomをcounter・label・前後buttonへ反映する。
 */
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

/**
 * 現在rendererの表示pageを変更し、page counterとprev/next buttonを更新する。edge指定でスクロール位置も調整する。
 */
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

/**
 * 現在rendererのzoomを変更し、表示labelとscroll位置を更新する。
 */
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

/**
 * 写真source準備→Vector PDF生成→OutputPdfPreviewへloadまでを行う中核非同期処理。serialが古くなった結果はDOMへ反映しない。
 */
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

/**
 * 現在DOMをloading表示へ戻し、新しいserialでPreview再生成を開始する。
 */
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

/**
 * 設定入力や撮影メモ連続入力時のPreview再生成をdebounceする。delay後に最新contextだけを使う。
 */
export function scheduleOutputPdfPreviewRefresh(getContext, delay = 250) {
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer);

  previewRefreshTimer = setTimeout(() => {
    previewRefreshTimer = null;
    const context = getContext?.();
    if (!context) return;
    refreshOutputPdfPreview(context);
  }, delay);
}

/**
 * window resize等で既存rendererだけを再描画する。PDF自体は再生成しない。
 */
export function rerenderOutputPdfPreview() {
  if (previewRenderer) {
    void previewRenderer.render();
  }
}
