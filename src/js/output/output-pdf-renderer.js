/**
 * src/js/output/output-pdf-renderer.js
 *
 * PDF専用レンダラー。
 * HTMLを画像化せず、文字・罫線・塗りをjsPDFへ直接描画する。
 * 写真だけJPEG/PNGとして配置する。
 *
 * 日本語フォント:
 * BIZ UDPGothic (SIL Open Font License 1.1)
 * https://github.com/googlefonts/morisawa-biz-ud-gothic
 */

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const FONT_CACHE = 'chousa-pdf-fonts-bizudp-v1';
const FONT_FAMILY = 'BIZUDPGothic';
const FONT_FILES = Object.freeze({
  normal: {
    name: 'BIZUDPGothic-Regular.ttf',
    url: 'https://raw.githubusercontent.com/googlefonts/morisawa-biz-ud-gothic/main/fonts/ttf/BIZUDPGothic-Regular.ttf'
  },
  bold: {
    name: 'BIZUDPGothic-Bold.ttf',
    url: 'https://raw.githubusercontent.com/googlefonts/morisawa-biz-ud-gothic/main/fonts/ttf/BIZUDPGothic-Bold.ttf'
  }
});

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 10;
const RED = [192, 0, 0];
const BLACK = [17, 17, 17];
const HEADER_FILL = [230, 230, 230];
const MATERIAL_ROWS_PER_PAGE = 24;
const ROOM_ROWS_PER_PAGE = 24;
const VISUAL_ITEMS_PER_PAGE = 8;

function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  const existing = document.querySelector(`script[data-output-pdf-lib="${src}"]`);
  if (existing) return new Promise((resolve, reject) => {
    existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once:true });
    existing.addEventListener('error', reject, { once:true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.outputPdfLib = src;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => reject(new Error(`PDFライブラリを読み込めませんでした: ${src}`));
    document.head.appendChild(script);
  });
}

async function fetchFontResponse(url) {
  if ('caches' in window) {
    const cache = await caches.open(FONT_CACHE);
    const cached = await cache.match(url);
    if (cached) return cached;
    const response = await fetch(url, { mode:'cors' });
    if (!response.ok) throw new Error(`PDFフォントを取得できませんでした (${response.status})`);
    await cache.put(url, response.clone());
    return response;
  }
  const response = await fetch(url, { mode:'cors' });
  if (!response.ok) throw new Error(`PDFフォントを取得できませんでした (${response.status})`);
  return response;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function registerFonts(pdf) {
  for (const [style, file] of Object.entries(FONT_FILES)) {
    const response = await fetchFontResponse(file.url);
    const base64 = arrayBufferToBase64(await response.arrayBuffer());
    pdf.addFileToVFS(file.name, base64);
    pdf.addFont(file.name, FONT_FAMILY, style);
  }
}

function chunkRows(rows, size) {
  if (!rows.length) return [[]];
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function isPositive(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (text === '有') return true;
  if (text.includes('無') || text.includes('なし') || text === '-') return false;
  return text.includes('含有');
}

function roomKey(row) { return `${row.floor}\u0000${row.roomNo}`; }
function paginateRoomRows(rows) {
  if (!rows.length) return [[]];
  const groups = [];
  let current = [];
  let currentKey = '';
  rows.forEach((row) => {
    const key = roomKey(row);
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

function setFont(pdf, size, style = 'normal', color = BLACK) {
  pdf.setFont(FONT_FAMILY, style);
  pdf.setFontSize(size);
  pdf.setTextColor(...color);
}

function fitLines(pdf, value, width, maxLines = 2) {
  const text = String(value ?? '');
  if (!text) return [];
  const lines = pdf.splitTextToSize(text, Math.max(1, width));
  if (lines.length <= maxLines) return lines;
  const result = lines.slice(0, maxLines);
  let last = String(result[maxLines - 1] || '');
  while (last && pdf.getTextWidth(`${last}…`) > width) last = last.slice(0, -1);
  result[maxLines - 1] = `${last}…`;
  return result;
}

function drawCellText(pdf, value, x, y, width, height, options = {}) {
  const {
    align = 'left',
    size = 8,
    style = 'normal',
    color = BLACK,
    paddingX = 1.1,
    maxLines = 2,
    lineHeight = 1.12
  } = options;
  setFont(pdf, size, style, color);
  const usable = Math.max(1, width - paddingX * 2);
  const lines = Array.isArray(value) ? value.map(String) : fitLines(pdf, value, usable, maxLines);
  if (!lines.length) return;
  const mmPerPt = 0.352778;
  const step = size * mmPerPt * lineHeight;
  const total = step * lines.length;
  let baseline = y + (height - total) / 2 + size * mmPerPt * 0.82;
  lines.forEach((line) => {
    let tx = x + paddingX;
    if (align === 'center') tx = x + width / 2;
    else if (align === 'right') tx = x + width - paddingX;
    pdf.text(String(line), tx, baseline, { align });
    baseline += step;
  });
}

function drawRect(pdf, x, y, width, height, { fill = null, line = BLACK, lineWidth = 0.2 } = {}) {
  pdf.setLineWidth(lineWidth);
  pdf.setDrawColor(...line);
  if (fill) {
    pdf.setFillColor(...fill);
    pdf.rect(x, y, width, height, 'FD');
  } else {
    pdf.rect(x, y, width, height, 'S');
  }
}

function drawTitle(pdf, title, centered = false) {
  setFont(pdf, 18, 'bold');
  pdf.text(title, centered ? PAGE_W / 2 : MARGIN_X, 19, { align:centered ? 'center' : 'left' });
}

function addPage(pdf, state) {
  if (state.pageCount > 0) pdf.addPage('a4', 'portrait');
  state.pageCount += 1;
}

function drawMaterialHeader(pdf, x, y, widths, height) {
  const labels = [
    ['建','材','No.'], ['建材名'], ['部位'], null,
    ['建','材','Lv.'], ['分析の要否'], ['石綿含有','の有無'], ['調査備考']
  ];
  let cx = x;
  widths.forEach((width, index) => {
    drawRect(pdf, cx, y, width, height, { fill:HEADER_FILL });
    if (index === 3) {
      const topH = height / 3;
      pdf.setDrawColor(...BLACK);
      pdf.setLineWidth(0.2);
      pdf.line(cx, y + topH, cx + width, y + topH);
      drawCellText(pdf, '施工範囲', cx, y, width, topH, { align:'center', size:6.5, style:'bold', maxLines:1, paddingX:.3 });
      drawCellText(pdf, '部屋No.', cx, y + topH, width, height - topH, { align:'center', size:7, style:'bold', maxLines:1, paddingX:.3 });
    } else {
      drawCellText(pdf, labels[index], cx, y, width, height, { align:'center', size:7, style:'bold', maxLines:3, paddingX:.35, lineHeight:1 });
    }
    cx += width;
  });
}

function renderMaterialPages(pdf, vm, state) {
  const pages = chunkRows(vm.materialRows || [], MATERIAL_ROWS_PER_PAGE);
  const widths = [6,33,10,42,6,19,19,55];
  const headerH = 5;
  const rowH = 6.8;
  const x = 10;
  const startY = 27;

  pages.forEach((rows) => {
    addPage(pdf, state);
    drawTitle(pdf, '調査対象建材リスト');
    drawMaterialHeader(pdf, x, startY, widths, headerH);
    let y = startY + headerH;
    for (let index = 0; index < MATERIAL_ROWS_PER_PAGE; index += 1) {
      const row = rows[index] || null;
      const positive = row ? isPositive(row.analysisResult) : false;
      const values = row
        ? [row.materialNo,row.name,row.part,row.usageLocation,row.level,row.analysisRequired,row.analysisResult,row.note]
        : ['', index === rows.length ? '以下余白' : '', '', '', '', '', '', ''];
      let cx = x;
      widths.forEach((width, colIndex) => {
        drawRect(pdf, cx, y, width, rowH);
        const center = [0,2,4,5,6].includes(colIndex);
        drawCellText(pdf, values[colIndex], cx, y, width, rowH, {
          align:center ? 'center' : 'left',
          size:colIndex === 1 && !row ? 7 : 7.1,
          color:positive ? RED : BLACK,
          maxLines:2,
          paddingX:.8
        });
        cx += width;
      });
      y += rowH;
    }
  });
}

function drawRoomHeader(pdf, x, y, widths, height) {
  const labels = [
    ['階'],['部屋No.'],['部屋名'],['部位'],['建','材','No.'],['建材名称'],['調査備考'],['建','材','Lv.'],['分析結果'],['部屋備考']
  ];
  let cx = x;
  widths.forEach((width, index) => {
    drawRect(pdf, cx, y, width, height, { fill:HEADER_FILL });
    drawCellText(pdf, labels[index], cx, y, width, height, { align:'center', size:7, style:'bold', maxLines:3, paddingX:.3, lineHeight:1 });
    cx += width;
  });
}

function renderRoomPages(pdf, vm, state) {
  const pages = paginateRoomRows(vm.roomRows || []);
  const widths = [10,12,22,10,6,33,42,6,19,30];
  const headerH = 5;
  const rowH = 8;
  const x = 10;
  const startY = 27;
  const xs = [x];
  widths.forEach((width) => xs.push(xs[xs.length - 1] + width));

  pages.forEach((rows) => {
    addPage(pdf, state);
    drawTitle(pdf, '部屋別調査対象建材リスト');
    drawRoomHeader(pdf, x, startY, widths, headerH);
    const bodyY = startY + headerH;

    rows.forEach((row, index) => {
      const y = bodyY + index * rowH;
      const positive = isPositive(row.analysisResult);
      const color = positive ? RED : BLACK;

      const cells = [
        { col:3, value:row.part, center:true },
        { col:4, value:row.materialNo, center:true },
        { col:5, value:row.materialName },
        { col:6, value:row.note },
        { col:7, value:row.level, center:true },
        { col:8, value:row.analysisResult, center:true }
      ];
      cells.forEach((cell) => {
        drawRect(pdf, xs[cell.col], y, widths[cell.col], rowH);
        drawCellText(pdf, cell.value, xs[cell.col], y, widths[cell.col], rowH, {
          align:cell.center ? 'center' : 'left', size:7.1, color, maxLines:2, paddingX:.8
        });
      });

      if (shouldRenderGroupedCell(rows, index, 'floor')) {
        const span = spanLength(rows, index, 'floor');
        drawRect(pdf, xs[0], y, widths[0], rowH * span);
        drawCellText(pdf, row.floor, xs[0], y, widths[0], rowH * span, { align:'center', size:7.1, color, maxLines:2, paddingX:.4 });
      }
      if (shouldRenderGroupedCell(rows, index, 'roomNo', 'floor')) {
        const span = spanLength(rows, index, 'roomNo', 'floor');
        [
          { col:1, value:row.roomNo, center:true },
          { col:2, value:row.roomName, center:true },
          { col:9, value:row.roomNote, center:false }
        ].forEach((cell) => {
          drawRect(pdf, xs[cell.col], y, widths[cell.col], rowH * span);
          drawCellText(pdf, cell.value, xs[cell.col], y, widths[cell.col], rowH * span, {
            align:cell.center ? 'center' : 'left', size:7.1, color, maxLines:Math.max(2, span * 2), paddingX:.8
          });
        });
      }
    });
  });
}

function imageFormat(dataUrl) {
  return /^data:image\/png/i.test(String(dataUrl || '')) ? 'PNG' : 'JPEG';
}

function addContainedImage(pdf, dataUrl, x, y, width, height) {
  if (!dataUrl) return false;
  try {
    const props = pdf.getImageProperties(dataUrl);
    const iw = Number(props?.width || 1);
    const ih = Number(props?.height || 1);
    const scale = Math.min(width / iw, height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    pdf.addImage(dataUrl, imageFormat(dataUrl), x + (width - dw) / 2, y + (height - dh) / 2, dw, dh, undefined, 'FAST');
    return true;
  } catch (error) {
    console.warn('PDF写真配置に失敗しました', error);
    return false;
  }
}

function renderVisualPhotoPages(pdf, vm, photoSources, state) {
  const pages = chunkRows(vm.visualPhotoItems || [], VISUAL_ITEMS_PER_PAGE);
  const left = 10;
  const top = 31;
  const gapX = 5;
  const gapY = 4;
  const slotW = (190 - gapX) / 2;
  const slotH = (252 - gapY * 3) / 4;
  const captionH = 8;

  pages.forEach((items) => {
    addPage(pdf, state);
    drawTitle(pdf, '調査対象建材写真帳');
    for (let index = 0; index < VISUAL_ITEMS_PER_PAGE; index += 1) {
      const item = items[index];
      if (!item) continue;
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = left + col * (slotW + gapX);
      const y = top + row * (slotH + gapY);
      const photoH = slotH - captionH;
      const source = photoSources?.get?.(String(item.photoId || '')) || '';
      addContainedImage(pdf, source, x, y, slotW, photoH);
      const caption = [`建材No.${item.materialNo}`, item.part, item.name].filter((v) => String(v ?? '').trim()).join('　');
      drawCellText(pdf, caption, x, y + photoH, slotW, captionH, { size:11, style:'bold', maxLines:1, paddingX:0 });
    }
  });
}

function sampleCode(item) {
  const projectNo = String(item.projectNo ?? '').trim();
  const sampleNo = String(item.sampleNo ?? '').trim();
  const branch = String(item.branch ?? '').trim();
  return `${projectNo}${sampleNo}${branch ? `-${branch}` : ''}`;
}

function renderSamplingPages(pdf, vm, photoSources, state) {
  const pages = vm.samplingPhotoPages?.length ? vm.samplingPhotoPages : [{ projectName:'',projectNo:'',sampleNo:'',branch:'',sampleName:'',samplingPlace:'',capturedDate:'',stages:[] }];
  pages.forEach((item) => {
    addPage(pdf, state);
    drawTitle(pdf, '試料採取写真', true);

    setFont(pdf, 11, 'normal');
    const leftX = 10;
    const metaY = 32;
    const lineH = 8.5;
    const labelW = 15;
    const leftValues = [
      ['件名：', item.projectName],
      ['試料：', item.sampleName],
      ['場所：', item.samplingPlace ? `部屋No.${item.samplingPlace}` : '']
    ];
    leftValues.forEach(([label,value], index) => {
      setFont(pdf, 11, 'bold');
      pdf.text(label, leftX, metaY + index * lineH);
      setFont(pdf, 11, 'normal');
      pdf.text(String(value || ''), leftX + labelW, metaY + index * lineH);
    });
    setFont(pdf, 11, 'normal');
    pdf.text(sampleCode(item), 138, metaY);
    setFont(pdf, 11, 'bold');
    pdf.text('採取日：', 138, metaY + lineH);
    setFont(pdf, 11, 'normal');
    pdf.text(String(item.capturedDate || ''), 154, metaY + lineH);

    const stageMap = new Map((item.stages || []).map((stage) => [stage.type, stage]));
    const order = [
      ['before','施工前'],['during','施工中'],['after','施工後']
    ];
    order.forEach(([type,label], index) => {
      const stage = stageMap.get(type) || { label, photoId:'', memo:'' };
      const y = 57 + index * 72;
      const photoX = 38;
      const photoW = 92;
      const photoH = 69.5;
      const memoX = 133;
      const memoW = 53;
      const source = photoSources?.get?.(String(stage.photoId || '')) || '';
      addContainedImage(pdf, source, photoX, y, photoW, photoH);

      drawCellText(pdf, `撮影状況：${stage.label || label}`, memoX, y, memoW, 7, { size:11, style:'bold', maxLines:1, paddingX:0 });
      const memoTop = y + 7;
      const memoH = 62;
      const lineHeight = memoH / 9;
      const memoLines = String(stage.memo || '').split('\n').slice(0, 9);
      for (let line = 0; line < 9; line += 1) {
        const ly = memoTop + line * lineHeight;
        pdf.setDrawColor(70,70,70);
        pdf.setLineDashPattern([.6,.6], 0);
        pdf.line(memoX, ly + lineHeight, memoX + memoW, ly + lineHeight);
        pdf.setLineDashPattern([], 0);
        drawCellText(pdf, memoLines[line] || '', memoX, ly, memoW, lineHeight, { size:9, maxLines:1, paddingX:.4 });
      }
    });
  });
}

function renderTarget(pdf, target, vm, photoSources, state) {
  if (target === 'materials') renderMaterialPages(pdf, vm, state);
  else if (target === 'rooms') renderRoomPages(pdf, vm, state);
  else if (target === 'visual-photos') renderVisualPhotoPages(pdf, vm, photoSources, state);
  else if (target === 'sampling-photos') renderSamplingPages(pdf, vm, photoSources, state);
}

async function buildVectorPdf({ targets, vm, photoSources, onProgress = null }) {
  await loadScript(JSPDF_URL, 'jspdf');
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('PDF生成ライブラリを初期化できませんでした。');

  onProgress?.('PDFフォントを準備しています…', 0.05);
  const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4', compress:true, putOnlyUsedFonts:true });
  await registerFonts(pdf);
  const state = { pageCount:0 };
  const list = Array.isArray(targets) ? targets : [];
  list.forEach((target, index) => {
    onProgress?.(`PDFを作成中 ${index + 1} / ${list.length}`, (index + 1) / Math.max(1, list.length));
    renderTarget(pdf, target, vm, photoSources, state);
  });
  if (!state.pageCount) {
    addPage(pdf, state);
    setFont(pdf, 10, 'normal');
    pdf.text('出力対象がありません。', 10, 20);
  }
  if (pdf.getNumberOfPages() > state.pageCount) pdf.deletePage(1);
  return pdf;
}

export async function createVectorPdfBlob({ targets, vm, photoSources, onProgress = null }) {
  const pdf = await buildVectorPdf({ targets, vm, photoSources, onProgress });
  return pdf.output('blob');
}

export async function exportVectorPdf({ targets, vm, photoSources, filename, onProgress = null }) {
  const pdf = await buildVectorPdf({ targets, vm, photoSources, onProgress });
  pdf.save(filename);
}
