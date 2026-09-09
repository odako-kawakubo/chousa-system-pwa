/**
 * src/js/camera/camera-board.js
 *
 * v0.1.5.5 電子看板描画。
 *
 * 本開発ルール：旧描画へパッチを重ねず、v64 の看板構造を基準に全面再構成する。
 * - 中サイズは v64 の 390 x 242 を基準にする。
 * - 区分欄は常に「目視 / 施工前 / 施工中 / 施工後」の4項目。
 * - 断面(code=4)は撮影区分として保持するが、看板区分欄には表示しない。
 * - 目視は「試料No.」ラベルを表示せず、2行目に撮影部位だけを表示する。
 * - 部屋No.は写真タブから渡された roomNo を表示し、roomPosition を表示値に使わない。
 * - プレビューと完成画像で同じ drawBoard() / getBoardRect() を使う。
 */

// v0.1.5.7A 業務固定色：電子看板として写真へ焼き込む黒/白。
// アプリのライト/ダークテーマでは変更しない。
const BOARD_BASE = Object.freeze({ width: 390, height: 242 });
const BOARD_SCALE = Object.freeze({ small: 0.8, medium: 1.0, large: 1.2 });

// v0.1.6.7A 看板サイズ正本。
// 現行の内部カメラ実機保存で確認できる中サイズ相当（390 / 900 = 約43.33%）を基準に固定する。
// 小・大は従来どおり中サイズの0.8倍 / 1.2倍。実機確認後はこの定数だけを調整する。
const BOARD_MEDIUM_WIDTH_RATIO = 390 / 900;
const BOARD_MARGIN_RATIO = 4 / 900;

const BOARD_STATUS_ITEMS = Object.freeze([
  { code: '5', label: '目視' },
  { code: '1', label: '施工前' },
  { code: '2', label: '施工中' },
  { code: '3', label: '施工後' }
]);

export const BOARD_POSITIONS = Object.freeze([
  'bottom-left',
  'bottom-right',
  'top-right',
  'top-left'
]);

export const BOARD_POSITION_LABELS = Object.freeze({
  'bottom-left': '左下',
  'bottom-right': '右下',
  'top-right': '右上',
  'top-left': '左上'
});

export const BOARD_SIZE_LABELS = Object.freeze({
  small: '小',
  medium: '中',
  large: '大'
});

function setFont(ctx, size) {
  ctx.font = `900 ${size}px "Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif`;
}

function fitFont(ctx, text, maxWidth, initialSize, minSize = 8) {
  const value = String(text ?? '');
  let size = initialSize;
  while (size > minSize) {
    setFont(ctx, size);
    if (ctx.measureText(value).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function drawLine(ctx, x1, y1, x2, y2, width = 1.5) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

function drawCenteredText(ctx, text, x, y, width, height, fontSize, options = {}) {
  const value = String(text ?? '');
  const padding = options.padding ?? 5;
  const size = fitFont(ctx, value, Math.max(1, width - padding * 2), fontSize, options.minSize ?? 8);
  setFont(ctx, size);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x + width / 2, y + height / 2, Math.max(1, width - padding * 2));
}

function drawLeftMiddleText(ctx, text, x, y, width, height, fontSize, options = {}) {
  const value = String(text ?? '');
  const paddingLeft = options.paddingLeft ?? 0;
  const paddingRight = options.paddingRight ?? 4;
  const size = fitFont(
    ctx,
    value,
    Math.max(1, width - paddingLeft - paddingRight),
    fontSize,
    options.minSize ?? 8
  );
  setFont(ctx, size);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x + paddingLeft, y + height / 2, Math.max(1, width - paddingLeft - paddingRight));
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const sourceLines = String(text ?? '').split(/\r?\n/);
  const result = [];
  for (const sourceLine of sourceLines) {
    if (result.length >= maxLines) break;
    if (!sourceLine) {
      result.push('');
      continue;
    }
    let current = '';
    for (const char of [...sourceLine]) {
      const candidate = current + char;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        result.push(current);
        current = char;
        if (result.length >= maxLines) break;
      } else {
        current = candidate;
      }
    }
    if (current && result.length < maxLines) result.push(current);
  }
  return result.slice(0, maxLines);
}

function drawWrappedCenterText(ctx, text, x, y, width, height, fontSize, maxLines = 2) {
  const padding = 6;
  let size = fontSize;
  let lines = [];
  while (size >= 8) {
    setFont(ctx, size);
    lines = wrapLines(ctx, text, width - padding * 2, maxLines);
    const lineHeight = size * 1.2;
    const tooWide = lines.some((line) => ctx.measureText(line).width > width - padding * 2 + 1);
    const tooHigh = lines.length * lineHeight > height - 3;
    if (!tooWide && !tooHigh) break;
    size -= 1;
  }

  const lineHeight = size * 1.2;
  const totalHeight = lines.length * lineHeight;
  let currentY = y + (height - totalHeight) / 2 + lineHeight / 2;
  setFont(ctx, size);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const line of lines) {
    ctx.fillText(line, x + width / 2, currentY, width - padding * 2);
    currentY += lineHeight;
  }
}

function drawStatusRow(ctx, x, y, width, height, activeCode) {
  const segmentWidth = width / BOARD_STATUS_ITEMS.length;
  BOARD_STATUS_ITEMS.forEach((item, index) => {
    const checked = String(activeCode || '') === item.code;
    drawCenteredText(
      ctx,
      `${checked ? '■' : '□'}${item.label}`,
      x + segmentWidth * index,
      y,
      segmentWidth,
      height,
      13,
      { padding: 1, minSize: 8 }
    );
  });
}

/**
 * v64 の二重枠・表構造を基準に看板を描画する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {object} data
 */
export function drawBoard(ctx, rect, data) {
  const { x, y, width, height } = rect;
  const scaleX = width / BOARD_BASE.width;
  const scaleY = height / BOARD_BASE.height;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleX, scaleY);

  const boardW = BOARD_BASE.width;
  const boardH = BOARD_BASE.height;
  const outerLine = 2;
  const innerLine = 1.5;
  const frameInset = 6;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, boardW, boardH);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = outerLine;
  ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

  const tableX = frameInset;
  const tableY = frameInset;
  const tableW = boardW - frameInset * 2;
  const tableH = boardH - frameInset * 2;
  ctx.lineWidth = innerLine;
  ctx.strokeRect(tableX, tableY, tableW, tableH);

  // v64の行高 52 / 40 / 96 / 42 を、内側表高へ同比率で割り当てる。
  const baseTotal = 230;
  const rowSubject = tableH * (52 / baseTotal);
  const rowAddress = tableH * (40 / baseTotal);
  const rowRoom = tableH * (34 / baseTotal);
  const rowSecond = tableH * (34 / baseTotal);
  const rowStatus = tableH * (28 / baseTotal);
  const rowContent = rowRoom + rowSecond + rowStatus;
  const rowDate = tableH - rowSubject - rowAddress - rowContent;

  const leftW = tableW * (78 / 378);
  const rightW = tableW - leftW;
  const innerLabelW = rightW * 0.404;
  const contentY = tableY + rowSubject + rowAddress;
  const gridLeft = tableX;
  const gridRight = tableX + tableW;

  drawLine(ctx, tableX + leftW, tableY, tableX + leftW, tableY + tableH, innerLine);
  drawLine(ctx, gridLeft, tableY + rowSubject, gridRight, tableY + rowSubject, innerLine);
  drawLine(ctx, gridLeft, tableY + rowSubject + rowAddress, gridRight, tableY + rowSubject + rowAddress, innerLine);
  drawLine(ctx, gridLeft, contentY + rowContent, gridRight, contentY + rowContent, innerLine);
  drawLine(ctx, tableX + leftW, contentY + rowRoom, gridRight, contentY + rowRoom, innerLine);
  drawLine(ctx, tableX + leftW, contentY + rowRoom + rowSecond, gridRight, contentY + rowRoom + rowSecond, innerLine);

  drawCenteredText(ctx, '件名', tableX, tableY, leftW, rowSubject, 18);
  drawCenteredText(ctx, '採取場所', tableX, tableY + rowSubject, leftW, rowAddress, 17);
  drawCenteredText(ctx, '内容', tableX, contentY, leftW, rowContent, 18);
  drawCenteredText(ctx, '日付', tableX, contentY + rowContent, leftW, rowDate, 18);

  drawWrappedCenterText(ctx, data.projectName || '', tableX + leftW + 5, tableY, rightW - 10, rowSubject, Number(data.subjectFontSize) || 18, 2);
  drawWrappedCenterText(ctx, data.address || '', tableX + leftW + 5, tableY + rowSubject, rightW - 10, rowAddress, Number(data.addressFontSize) || 17, 2);

  // 部屋No.はラベルと値を分けるが、v64同様ラベル/値間の縦罫線は描かない。
  drawLeftMiddleText(ctx, '　部屋No.', tableX + leftW + 8, contentY, innerLabelW - 8, rowRoom, 17);
  drawLeftMiddleText(
    ctx,
    data.photoType === 'sampling' ? (data.samplingPlace || '-') : (data.roomNo || '-'),
    tableX + leftW + innerLabelW,
    contentY,
    rightW - innerLabelW,
    rowRoom,
    24
  );

  if (data.photoType === 'sampling') {
    drawLeftMiddleText(ctx, '　試料No.', tableX + leftW + 8, contentY + rowRoom, innerLabelW - 8, rowSecond, 17);
    drawLeftMiddleText(
      ctx,
      data.sampleNo || '-',
      tableX + leftW + innerLabelW,
      contentY + rowRoom,
      rightW - innerLabelW,
      rowSecond,
      24
    );
  } else {
    // 目視は「試料No.」ラベルを表示しない。撮影部位だけを中央表示する。
    drawCenteredText(ctx, data.part || '-', tableX + leftW, contentY + rowRoom, rightW, rowSecond, 24, {
      padding: 8,
      minSize: 10
    });
  }

  drawStatusRow(
    ctx,
    tableX + leftW + 3,
    contentY + rowRoom + rowSecond,
    rightW - 6,
    rowStatus,
    data.statusCode
  );

  drawCenteredText(ctx, data.date || '', tableX + leftW, contentY + rowContent, rightW, rowDate, 22);
  ctx.restore();
}

/**
 * 看板位置・サイズの唯一の計算入口。
 * 端末や画面幅ではなく、対象写真/Canvas自体の幅に対する固定比率で計算する。
 * これにより、内部カメラ保存・看板編集保存・各プレビューで同じ小/中/大になる。
 */
export function getBoardRect(canvasWidth, canvasHeight, position = 'bottom-left', size = 'medium') {
  const scale = BOARD_SCALE[size] ?? BOARD_SCALE.medium;
  const width = Math.min(canvasWidth * BOARD_MEDIUM_WIDTH_RATIO * scale, canvasWidth * 0.72);
  const height = width * (BOARD_BASE.height / BOARD_BASE.width);
  const margin = Math.max(1, canvasWidth * BOARD_MARGIN_RATIO);

  const left = margin;
  const right = canvasWidth - width - margin;
  const top = margin;
  const bottom = canvasHeight - height - margin;

  const positions = {
    'top-left': [left, top],
    'top-right': [right, top],
    'bottom-right': [right, bottom],
    'bottom-left': [left, bottom]
  };
  const [x, y] = positions[position] || positions['bottom-left'];
  return { x, y, width, height };
}

/** 撮影画面プレビューを再描画する。 */
export function renderBoardPreview(canvas, data, position, size) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width || canvas.clientWidth || 640);
  const cssHeight = Math.max(1, rect.height || canvas.clientHeight || 480);
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const boardRect = getBoardRect(canvas.width, canvas.height, position, size);
  drawBoard(ctx, boardRect, data);
}


/**
 * 設定タブ・看板編集画面で看板単体を描画する。
 * 撮影用プレビューと同じdrawBoard()を使用し、別デザインを作らない。
 */
export function renderBoardSample(canvas, data) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width || 390);
  const cssHeight = Math.max(1, rect.height || Math.round(cssWidth * 242 / 390));
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoard(ctx, { x: 0, y: 0, width: canvas.width, height: canvas.height }, data);
}
