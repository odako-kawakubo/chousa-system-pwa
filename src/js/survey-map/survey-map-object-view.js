import { pageSize, objectPercentStyle } from './survey-map-geometry.js';

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,(m)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function finite(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}

function lineDashArray(style,width){
  if(style==='dash') return `${width*4} ${width*3}`;
  if(style==='dot') return `${width} ${width*2}`;
  return '';
}

function lineObjectHtml(record,drawing,selected){
  const size=pageSize(drawing);
  if(Array.isArray(record.points) && record.points.length>1){
    const points=record.points.map(p=>`${finite(p.x)},${finite(p.y)}`).join(' ');
    const lineWidth=Math.max(20,finite(record.lineWidth,80));
    const color=escapeHtml(record.lineColor||'#334155');
    const closed=Boolean(record.closed);
    return `
      <div class="survey-map-object survey-map-object-line survey-map-object-stroke ${selected?'selected':''}"
        data-survey-object-id="${escapeHtml(record.objectId)}" role="button" aria-label="補正線">
        <svg class="survey-map-line-svg" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-hidden="true">
          <polyline class="survey-map-stroke-hit" points="${points}" ${closed?'data-closed="true"':''}></polyline>
          <polyline class="survey-map-stroke-main" points="${points}" stroke="${color}" stroke-width="${lineWidth}" ${closed?'data-closed="true"':''}></polyline>
        </svg>
      </div>
    `;
  }
  const startX=finite(record.startX);
  const startY=finite(record.startY);
  const endX=finite(record.endX);
  const endY=finite(record.endY);
  const lineWidth=Math.max(20,finite(record.lineWidth,80));
  const color=escapeHtml(record.lineColor||record.strokeColor||'#334155');
  const dash=lineDashArray(String(record.lineStyle||'solid'),lineWidth);
  const startLeft=(startX/size.width)*100;
  const startTop=(startY/size.height)*100;
  const endLeft=(endX/size.width)*100;
  const endTop=(endY/size.height)*100;

  return `
    <div
      class="survey-map-object survey-map-object-line ${selected?'selected':''}"
      data-survey-object-id="${escapeHtml(record.objectId)}"
      role="button"
      aria-label="直線"
    >
      <svg class="survey-map-line-svg" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-hidden="true">
        <line class="survey-map-line-hit" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"></line>
        <line class="survey-map-line-main" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"
          stroke="${color}" stroke-width="${lineWidth}" ${dash?`stroke-dasharray="${dash}"`:''}></line>
      </svg>
      ${selected?`
        <button type="button" class="survey-map-object-handle survey-map-line-endpoint" data-survey-handle="line-start"
          style="left:${startLeft}%;top:${startTop}%" aria-label="始点を移動"></button>
        <button type="button" class="survey-map-object-handle survey-map-line-endpoint" data-survey-handle="line-end"
          style="left:${endLeft}%;top:${endTop}%" aria-label="終点を移動"></button>
      `:''}
    </div>
  `;
}

export function drawingObjectsHtml(records = [], drawing, selectedObjectId = '') {
  return records
    .filter((record)=>record && record.visible !== false && !record.deleted)
    .map((record)=>{
      const selected = String(record.objectId) === String(selectedObjectId);
      if(record.type==='line') return lineObjectHtml(record,drawing,selected);

      const style = objectPercentStyle(record, drawing);
      const label = record.type === 'shape' ? '図形' : String(record.type || 'オブジェクト');
      return `
        <div
          class="survey-map-object survey-map-object-${escapeHtml(record.type)} ${selected?'selected':''}"
          data-survey-object-id="${escapeHtml(record.objectId)}"
          style="${style}"
          role="button"
          aria-label="${escapeHtml(label)}"
        >
          <div class="survey-map-object-visual"></div>
          ${selected ? `
            <button type="button" class="survey-map-object-handle survey-map-object-resize-handle" data-survey-handle="resize" aria-label="サイズ変更"></button>
            <button type="button" class="survey-map-object-handle survey-map-object-rotate-handle" data-survey-handle="rotate" aria-label="回転"></button>
          ` : ''}
        </div>
      `;
    }).join('');
}
