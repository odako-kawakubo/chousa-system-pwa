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

/**
 * ドラッグ開始点からの差分で変形する。ハンドル内の押下位置に依存しない。
 * Shift時は中心を固定し、縦横を必ず同一倍率で変える。
 */
export function resizeRectFromDrag(record,corner,startPoint,currentPoint,{centerFixed=false,ratioFixed=false}={}){
  const w=Math.max(120,finite(record.width)),h=Math.max(120,finite(record.height));
  const sx=corner.endsWith('e')?1:-1,sy=corner.startsWith('s')?1:-1;
  const angle=finite(record.rotation)*Math.PI/180,c=Math.cos(angle),sn=Math.sin(angle);
  const dx=finite(currentPoint.x)-finite(startPoint.x),dy=finite(currentPoint.y)-finite(startPoint.y);
  const localX=dx*c+dy*sn,localY=-dx*sn+dy*c;
  const factor=centerFixed?2:1;
  const lockRatio=centerFixed||ratioFixed;
  let nw,nh;
  if(lockRatio){
    // Drag difference projected onto the original diagonal; avoids jumping at pointerdown.
    const normalized=(sx*localX*w+sy*localY*h)/(w*w+h*h);
    const scale=Math.max(120/w,120/h,1+normalized*factor);
    nw=w*scale;nh=h*scale;
  }else{
    nw=Math.max(120,w+sx*localX);
    nh=Math.max(120,h+sy*localY);
  }
  const originalCenter={x:finite(record.x)+w/2,y:finite(record.y)+h/2};
  let center=originalCenter;
  if(!centerFixed){
    center={
      x:originalCenter.x+(sx*c*(nw-w)-sy*sn*(nh-h))/2,
      y:originalCenter.y+(sx*sn*(nw-w)+sy*c*(nh-h))/2
    };
  }
  return {...record,x:center.x-nw/2,y:center.y-nh/2,width:nw,height:nh};
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
