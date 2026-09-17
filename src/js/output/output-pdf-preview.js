/**
 * 実PDFをPDF.jsで1ページずつ描画するレビュー専用モジュール。
 * ブラウザ内蔵PDFビューアへ倍率・ページ制御を委ねない。
 */
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

let pdfJsPromise = null;

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_URL).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjsLib;
    });
  }
  return pdfJsPromise;
}

export class OutputPdfPreview {
  constructor(host) {
    this.host = host;
    this.pdf = null;
    this.page = 1;
    this.zoom = 'fit';
    this.renderToken = 0;
  }

  async load(blob, { page = 1, zoom = 'fit' } = {}) {
    const pdfjsLib = await loadPdfJs();
    const data = await blob.arrayBuffer();
    this.pdf = await pdfjsLib.getDocument({ data }).promise;
    this.page = Math.max(1, Math.min(Number(page) || 1, this.pageCount));
    this.zoom = zoom;
    await this.render();
    return { pageCount:this.pageCount, page:this.page, zoom:this.zoom };
  }

  get pageCount() {
    return this.pdf?.numPages || 1;
  }

  async setPage(page) {
    this.page = Math.max(1, Math.min(Number(page) || 1, this.pageCount));
    await this.render();
    return this.page;
  }

  async setZoom(zoom) {
    this.zoom = zoom === 'fit' ? 'fit' : Math.max(30, Math.min(200, Number(zoom) || 100));
    await this.render();
    return this.zoom;
  }

  async render() {
    if (!this.host || !this.pdf) return;
    const token = ++this.renderToken;
    const page = await this.pdf.getPage(this.page);
    if (token !== this.renderToken) return;

    const baseViewport = page.getViewport({ scale:1 });
    const availableWidth = Math.max(120, this.host.clientWidth - 24);
    const availableHeight = Math.max(200, this.host.clientHeight - 24);
    const cssScale = this.zoom === 'fit'
      ? Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height)
      : Number(this.zoom) / 100;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const viewport = page.getViewport({ scale:cssScale * dpr });

    let canvas = this.host.querySelector('canvas.output-pdf-canvas');
    if (!canvas) {
      this.host.innerHTML = '<div class="output-pdf-canvas-wrap"><canvas class="output-pdf-canvas" aria-label="実PDFレビュー"></canvas></div>';
      canvas = this.host.querySelector('canvas.output-pdf-canvas');
    }
    const wrap = canvas.closest('.output-pdf-canvas-wrap');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.ceil(viewport.height / dpr)}px`;
    if (wrap) {
      wrap.style.width = canvas.style.width;
      wrap.style.height = canvas.style.height;
    }

    const context = canvas.getContext('2d', { alpha:false });
    await page.render({ canvasContext:context, viewport }).promise;
  }

  destroy() {
    this.renderToken += 1;
    this.pdf?.destroy?.();
    this.pdf = null;
    if (this.host) this.host.innerHTML = '';
  }
}
