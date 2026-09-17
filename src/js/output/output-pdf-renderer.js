/**
 * src/js/output/output-pdf-renderer.js
 *
 * PDF専用ベクターレンダラー。
 * 文字・罫線・塗りはjsPDFで直接描画し、写真だけ画像として配置する。
 * 建材リスト / 部屋別リストは固定行数を使わず、実際の行高からページ分割する。
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
const VISUAL_ITEMS_PER_PAGE = 8;

const LIST_START_Y = 27;
const LIST_HEADER_H = 6.5;
const LIST_TABLE_BOTTOM_Y = 269;
const LIST_FOOTNOTE_Y = 274;
const MATERIAL_BASE_ROW_H = 6.8;
const ROOM_BASE_ROW_H = 8;
const LIST_BODY_SIZE = 7.5;
const LIST_HEADER_SIZE = 7.5;

const DEFAULT_LIST_FOOTNOTE = '※ケイ酸カルシウム板第１種は、飛散性の高いレベル３建材として、環境省、厚生労働省の告示で定められました。\nこれを切断等の方法で除去する場合、作業場をビニールシート等で隔離し、常時湿潤な状態を保ちながら作業することが必要になります。\nまた、建築用仕上塗材を電動工具を使用して除去を行う場合においても、大気汚染防止法施行令及び石綿障害予防規則にて作業場の隔離、常時湿潤な状態での作業が必要です。';

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

function setFont(pdf, size, style = 'normal', color = BLACK) {
  pdf.setFont(FONT_FAMILY, style);
  pdf.setFontSize(size);
  pdf.setTextColor(...color);
}

function textLines(pdf, value, width) {
  const text = String(value ?? '');
  if (!text) return [];
  return pdf.splitTextToSize(text, Math.max(1, width));
}

function roomNoTokens(value) {
  return String(value ?? '')
    .split(/[、，,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function wrapRoomNoLines(pdf, value, width, size = LIST_BODY_SIZE) {
  const tokens = roomNoTokens(value);
  if (!tokens.length) return [];
  setFont(pdf, size, 'normal');
  const lines = [];
  let current = '';
  tokens.forEach((token) => {
    const next = current ? `${current}、${token}` : token;
    if (!current || pdf.getTextWidth(next) <= width) {
      current = next;
      return;
    }
    lines.push(current);
    current = token;
  });
  if (current) lines.push(current);
  return lines;
}

function lineBlockHeight(size, lineCount, lineHeight = 1.12, paddingY = 1.2) {
  if (!lineCount) return 0;
  return lineCount * size * 0.352778 * lineHeight + paddingY * 2;
}

function requiredTextHeight(pdf, value, width, options = {}) {
  const {
    size = LIST_BODY_SIZE,
    lineHeight = 1.12,
    paddingX = .8,
    paddingY = 1.2,
    roomTokens = false
  } = options;
  setFont(pdf, size, 'normal');
  const usable = Math.max(1, width - paddingX * 2);
  const lines = roomTokens ? wrapRoomNoLines(pdf, value, usable, size) : textLines(pdf, value, usable);
  return Math.max(0, lineBlockHeight(size, lines.length, lineHeight, paddingY));
}

function drawCellText(pdf, value, x, y, width, height, options = {}) {
  const {
    align = 'left',
    size = 8,
    style = 'normal',
    color = BLACK,
    paddingX = 1.1,
    maxLines = Infinity,
    lineHeight = 1.12,
    roomTokens = false
  } = options;
  setFont(pdf, size, style, color);
  const usable = Math.max(1, width - paddingX * 2);
  let lines;
  if (Array.isArray(value)) lines = value.map(String);
  else if (roomTokens) lines = wrapRoomNoLines(pdf, value, usable, size);
  else lines = textLines(pdf, value, usable);
  if (Number.isFinite(maxLines)) lines = lines.slice(0, Math.max(0, maxLines));
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

function drawListFootnote(pdf) {
  setFont(pdf, 6.4, 'normal', BLACK);
  const lines = [];
  DEFAULT_LIST_FOOTNOTE.split('\n').forEach((paragraph) => {
    const wrapped = pdf.splitTextToSize(paragraph, 190);
    lines.push(...wrapped);
  });
  pdf.text(lines, MARGIN_X, LIST_FOOTNOTE_Y, { lineHeightFactor:1.25 });
}

function drawMaterialHeader(pdf, x, y, widths, height) {
  const labels = [
    ['建材','No.'], ['建材名'], ['部位'], null,
    ['建材','レベル'], ['分析の要否'], ['石綿含有','の有無'], ['調査備考']
  ];
  let cx = x;
  widths.forEach((width, index) => {
    drawRect(pdf, cx, y, width, height, { fill:HEADER_FILL });
    if (index === 3) {
      const topH = height * .38;
      pdf.setDrawColor(...BLACK);
      pdf.setLineWidth(0.2);
      pdf.line(cx, y + topH, cx + width, y + topH);
      drawCellText(pdf, '施工範囲', cx, y, width, topH, { align:'center', size:7, style:'bold', paddingX:.3, lineHeight:1 });
      drawCellText(pdf, '部屋No.', cx, y + topH, width, height - topH, { align:'center', size:LIST_HEADER_SIZE, style:'bold', paddingX:.3, lineHeight:1 });
    } else {
      drawCellText(pdf, labels[index], cx, y, width, height, { align:'center', size:LIST_HEADER_SIZE, style:'bold', paddingX:.25, lineHeight:1 });
    }
    cx += width;
  });
}

function materialRowHeight(pdf, row, widths) {
  const values = [row.materialNo,row.name,row.part,row.usageLocation,row.level,row.analysisRequired,row.analysisResult,row.note];
  let height = MATERIAL_BASE_ROW_H;
  values.forEach((value, index) => {
    const needed = requiredTextHeight(pdf, value, widths[index], {
      roomTokens:index === 3,
      paddingX:index === 3 ? .8 : .8,
      paddingY:.9
    });
    height = Math.max(height, needed);
  });
  return Math.min(24, height);
}

function paginateVariableRows(rows, heights, availableHeight) {
  const pages = [];
  let currentRows = [];
  let currentHeights = [];
  let used = 0;

  rows.forEach((row, index) => {
    const rowHeight = heights[index];
    if (currentRows.length && used + rowHeight > availableHeight) {
      pages.push({ rows:currentRows, heights:currentHeights });
      currentRows = [];
      currentHeights = [];
      used = 0;
    }
    currentRows.push(row);
    currentHeights.push(rowHeight);
    used += rowHeight;
  });

  if (currentRows.length || !pages.length) pages.push({ rows:currentRows, heights:currentHeights });
  return pages;
}

function drawMaterialBodyRow(pdf, row, y, rowH, widths, isBlank = false, blankLabel = '') {
  const positive = row ? isPositive(row.analysisResult) : false;
  const values = row
    ? [row.materialNo,row.name,row.part,row.usageLocation,row.level,row.analysisRequired,row.analysisResult,row.note]
    : ['', blankLabel, '', '', '', '', '', ''];

  let cx = MARGIN_X;
  widths.forEach((width, colIndex) => {
    drawRect(pdf, cx, y, width, rowH);
    const center = [0,2,4,5,6].includes(colIndex);
    drawCellText(pdf, values[colIndex], cx, y, width, rowH, {
      align:center ? 'center' : 'left',
      size:isBlank && colIndex === 1 ? 7 : LIST_BODY_SIZE,
      color:positive ? RED : BLACK,
      paddingX:.8,
      roomTokens:colIndex === 3
    });
    cx += width;
  });
}

function fillMaterialBlankRows(pdf, startY, widths) {
  let y = startY;
  let first = true;
  while (LIST_TABLE_BOTTOM_Y - y >= 3.2) {
    const remaining = LIST_TABLE_BOTTOM_Y - y;
    const rowH = Math.min(MATERIAL_BASE_ROW_H, remaining);
    drawMaterialBodyRow(pdf, null, y, rowH, widths, true, first ? '以下余白' : '');
    first = false;
    y += rowH;
  }
}

function renderMaterialPages(pdf, vm, state) {
  const widths = [6,33,10,42,6,19,19,55];
  const rows = vm.materialRows || [];
  const heights = rows.map((row) => materialRowHeight(pdf, row, widths));
  const available = LIST_TABLE_BOTTOM_Y - (LIST_START_Y + LIST_HEADER_H);
  const pages = paginateVariableRows(rows, heights, available);

  pages.forEach((page, pageIndex) => {
    addPage(pdf, state);
    drawTitle(pdf, '調査対象建材リスト');
    drawMaterialHeader(pdf, MARGIN_X, LIST_START_Y, widths, LIST_HEADER_H);
    let y = LIST_START_Y + LIST_HEADER_H;
    page.rows.forEach((row, index) => {
      const rowH = page.heights[index];
      drawMaterialBodyRow(pdf, row, y, rowH, widths);
      y += rowH;
    });
    if (pageIndex === pages.length - 1) fillMaterialBlankRows(pdf, y, widths);
    drawListFootnote(pdf);
  });
}

function drawRoomHeader(pdf, x, y, widths, height) {
  const labels = [
    ['階'],['部屋No.'],['部屋名'],['部位'],['建材','No.'],['建材名称'],['調査備考'],['建材','レベル'],['分析結果'],['部屋備考']
  ];
  let cx = x;
  widths.forEach((width, index) => {
    drawRect(pdf, cx, y, width, height, { fill:HEADER_FILL });
    drawCellText(pdf, labels[index], cx, y, width, height, { align:'center', size:LIST_HEADER_SIZE, style:'bold', paddingX:.25, lineHeight:1 });
    cx += width;
  });
}

function roomRowBaseHeight(pdf, row, widths) {
  const values = [
    { col:3, value:row.part },
    { col:4, value:row.materialNo },
    { col:5, value:row.materialName },
    { col:6, value:row.note },
    { col:7, value:row.level },
    { col:8, value:row.analysisResult }
  ];
  let height = ROOM_BASE_ROW_H;
  values.forEach(({ col, value }) => {
    height = Math.max(height, requiredTextHeight(pdf, value, widths[col], { paddingX:.8, paddingY:.9 }));
  });
  return Math.min(26, height);
}

function groupRanges(rows, keyFn) {
  const ranges = [];
  let start = 0;
  while (start < rows.length) {
    const key = keyFn(rows[start]);
    let end = start + 1;
    while (end < rows.length && keyFn(rows[end]) === key) end += 1;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function ensureGroupedCellHeight(pdf, rows, heights, range, value, width, options = {}) {
  const needed = requiredTextHeight(pdf, value, width, options);
  const current = heights.slice(range.start, range.end).reduce((sum, height) => sum + height, 0);
  if (needed <= current) return;
  heights[range.end - 1] += needed - current;
}

function calculateRoomHeights(pdf, rows, widths) {
  const heights = rows.map((row) => roomRowBaseHeight(pdf, row, widths));

  groupRanges(rows, (row) => String(row.floor ?? '')).forEach((range) => {
    ensureGroupedCellHeight(pdf, rows, heights, range, rows[range.start]?.floor, widths[0], { paddingX:.4, paddingY:.9 });
  });

  groupRanges(rows, (row) => `${row.floor}\u0000${row.roomNo}`).forEach((range) => {
    const first = rows[range.start] || {};
    ensureGroupedCellHeight(pdf, rows, heights, range, first.roomNo, widths[1], { paddingX:.6, paddingY:.9, roomTokens:true });
    ensureGroupedCellHeight(pdf, rows, heights, range, first.roomName, widths[2], { paddingX:.8, paddingY:.9 });
    ensureGroupedCellHeight(pdf, rows, heights, range, first.roomNote, widths[9], { paddingX:.8, paddingY:.9 });
  });

  return heights;
}

function paginateRoomVariableRows(rows, heights, availableHeight) {
  const pages = [];
  let start = 0;
  while (start < rows.length) {
    let used = 0;
    let end = start;
    while (end < rows.length) {
      const next = heights[end];
      if (end > start && used + next > availableHeight) break;
      used += next;
      end += 1;
    }
    pages.push({ rows:rows.slice(start, end), heights:heights.slice(start, end) });
    start = end;
  }
  return pages.length ? pages : [{ rows:[], heights:[] }];
}

function pageSpan(rows, index, keyFn) {
  const key = keyFn(rows[index]);
  let count = 1;
  for (let i = index + 1; i < rows.length; i += 1) {
    if (keyFn(rows[i]) !== key) break;
    count += 1;
  }
  return count;
}

function precedingSame(rows, index, keyFn) {
  return index > 0 && keyFn(rows[index - 1]) === keyFn(rows[index]);
}

function spanHeight(heights, index, span) {
  return heights.slice(index, index + span).reduce((sum, value) => sum + value, 0);
}

function renderRoomPageBody(pdf, rows, heights, widths) {
  const xs = [MARGIN_X];
  widths.forEach((width) => xs.push(xs[xs.length - 1] + width));
  let y = LIST_START_Y + LIST_HEADER_H;

  rows.forEach((row, index) => {
    const rowH = heights[index];
    const positive = isPositive(row.analysisResult);
    const color = positive ? RED : BLACK;

    [
      { col:3, value:row.part, center:true },
      { col:4, value:row.materialNo, center:true },
      { col:5, value:row.materialName },
      { col:6, value:row.note },
      { col:7, value:row.level, center:true },
      { col:8, value:row.analysisResult, center:true }
    ].forEach((cell) => {
      drawRect(pdf, xs[cell.col], y, widths[cell.col], rowH);
      drawCellText(pdf, cell.value, xs[cell.col], y, widths[cell.col], rowH, {
        align:cell.center ? 'center' : 'left', size:LIST_BODY_SIZE, color, paddingX:.8
      });
    });

    const floorKey = (item) => String(item.floor ?? '');
    if (!precedingSame(rows, index, floorKey)) {
      const span = pageSpan(rows, index, floorKey);
      const height = spanHeight(heights, index, span);
      drawRect(pdf, xs[0], y, widths[0], height);
      drawCellText(pdf, row.floor, xs[0], y, widths[0], height, { align:'center', size:LIST_BODY_SIZE, color, paddingX:.4 });
    }

    const roomKey = (item) => `${item.floor}\u0000${item.roomNo}`;
    if (!precedingSame(rows, index, roomKey)) {
      const span = pageSpan(rows, index, roomKey);
      const height = spanHeight(heights, index, span);
      [
        { col:1, value:row.roomNo, center:true, roomTokens:true },
        { col:2, value:row.roomName, center:true },
        { col:9, value:row.roomNote, center:false }
      ].forEach((cell) => {
        drawRect(pdf, xs[cell.col], y, widths[cell.col], height);
        drawCellText(pdf, cell.value, xs[cell.col], y, widths[cell.col], height, {
          align:cell.center ? 'center' : 'left', size:LIST_BODY_SIZE, color, paddingX:.8, roomTokens:cell.roomTokens
        });
      });
    }

    y += rowH;
  });

  return y;
}

function fillRoomBlankRows(pdf, startY, widths) {
  const xs = [MARGIN_X];
  widths.forEach((width) => xs.push(xs[xs.length - 1] + width));
  let y = startY;
  let first = true;
  while (LIST_TABLE_BOTTOM_Y - y >= 3.2) {
    const remaining = LIST_TABLE_BOTTOM_Y - y;
    const rowH = Math.min(ROOM_BASE_ROW_H, remaining);
    widths.forEach((width, index) => drawRect(pdf, xs[index], y, width, rowH));
    if (first) drawCellText(pdf, '以下余白', xs[5], y, widths[5], rowH, { size:7, paddingX:.8 });
    first = false;
    y += rowH;
  }
}

function renderRoomPages(pdf, vm, state) {
  const widths = [10,12,22,10,6,33,42,6,19,30];
  const rows = vm.roomRows || [];
  const heights = calculateRoomHeights(pdf, rows, widths);
  const available = LIST_TABLE_BOTTOM_Y - (LIST_START_Y + LIST_HEADER_H);
  const pages = paginateRoomVariableRows(rows, heights, available);

  pages.forEach((page, pageIndex) => {
    addPage(pdf, state);
    drawTitle(pdf, '部屋別調査対象建材リスト');
    drawRoomHeader(pdf, MARGIN_X, LIST_START_Y, widths, LIST_HEADER_H);
    const endY = renderRoomPageBody(pdf, page.rows, page.heights, widths);
    if (pageIndex === pages.length - 1) fillRoomBlankRows(pdf, endY, widths);
    drawListFootnote(pdf);
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
      drawCellText(pdf, caption, x, y + photoH, slotW, captionH, { size:11, style:'bold', paddingX:0 });
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
    const order = [['before','施工前'],['during','施工中'],['after','施工後']];
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

      drawCellText(pdf, `撮影状況：${stage.label || label}`, memoX, y, memoW, 7, { size:11, style:'bold', paddingX:0 });
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
