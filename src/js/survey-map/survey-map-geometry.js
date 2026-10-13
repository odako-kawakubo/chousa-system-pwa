/**
 * 調査図A4座標系と画面座標の変換。
 * Recordの座標は常にA4固定座標（29700 x 21000）で保持し、表示倍率から独立させる。
 */
export const DEFAULT_PAGE_WIDTH = 29700;
export const DEFAULT_PAGE_HEIGHT = 21000;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(finite(value), finite(min)), finite(max));
}

export function pageSize(drawing) {
  return {
    width: finite(drawing?.pageWidth, DEFAULT_PAGE_WIDTH) || DEFAULT_PAGE_WIDTH,
    height: finite(drawing?.pageHeight, DEFAULT_PAGE_HEIGHT) || DEFAULT_PAGE_HEIGHT
  };
}

/**
 * Pointerのclient座標をA4固定座標へ変換する。
 * sheetRectは回転なしの紙面DOMRectを渡す。
 */
export function clientToPagePoint(clientX, clientY, sheetRect, drawing) {
  const size = pageSize(drawing);
  const leftRatio = sheetRect?.width ? (finite(clientX) - sheetRect.left) / sheetRect.width : 0;
  const topRatio = sheetRect?.height ? (finite(clientY) - sheetRect.top) / sheetRect.height : 0;
  return {
    x: clamp(leftRatio * size.width, 0, size.width),
    y: clamp(topRatio * size.height, 0, size.height)
  };
}

export function clampObjectRect(rect, drawing, minimum = 120) {
  const size = pageSize(drawing);
  const width = clamp(rect?.width, minimum, size.width);
  const height = clamp(rect?.height, minimum, size.height);
  return {
    x: clamp(rect?.x, 0, Math.max(0, size.width - width)),
    y: clamp(rect?.y, 0, Math.max(0, size.height - height)),
    width,
    height
  };
}

export function objectPercentStyle(record, drawing) {
  const size = pageSize(drawing);
  const x = finite(record?.x);
  const y = finite(record?.y);
  const width = finite(record?.width);
  const height = finite(record?.height);
  return [
    `left:${(x / size.width) * 100}%`,
    `top:${(y / size.height) * 100}%`,
    `width:${(width / size.width) * 100}%`,
    `height:${(height / size.height) * 100}%`,
    `transform:rotate(${finite(record?.rotation)}deg)`
  ].join(';');
}

export function rotationFromPointer(record, pointer, sheetRect, drawing) {
  const size = pageSize(drawing);
  const center = {
    x: finite(record?.x) + finite(record?.width) / 2,
    y: finite(record?.y) + finite(record?.height) / 2
  };
  const centerClientX = sheetRect.left + (center.x / size.width) * sheetRect.width;
  const centerClientY = sheetRect.top + (center.y / size.height) * sheetRect.height;
  const angle = Math.atan2(finite(pointer?.clientY) - centerClientY, finite(pointer?.clientX) - centerClientX) * 180 / Math.PI;
  return Math.round(angle + 90);
}
