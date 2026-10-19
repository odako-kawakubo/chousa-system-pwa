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

function polylineHandleHtml(record,size){
  if(record.elbow){
    const start=record.points[0],end=record.points.at(-1);
    const mid={x:(record.points[1].x+record.points[2].x)/2,y:(record.points[1].y+record.points[2].y)/2};
    return [
      ['line-start',start,'始点'],['line-end',end,'終点'],['elbow-bend',mid,'折れ位置']
    ].map(([handle,p,label])=>`
      <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
        data-survey-handle="${handle}" style="left:${finite(p.x)/size.width*100}%;top:${finite(p.y)/size.height*100}%"
        aria-label="${label}を移動"></button>
    `).join('');
  }
  const count=record.closed?record.points.length-1:record.points.length;
  return record.points.slice(0,count).map((p,index)=>`
    <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
      data-survey-handle="stroke-point" data-survey-point-index="${index}"
      style="left:${finite(p.x)/size.width*100}%;top:${finite(p.y)/size.height*100}%"
      aria-label="頂点${index+1}を移動"></button>
  `).join('');
}

function lineObjectHtml(record,drawing,selected){
  const size=pageSize(drawing);
  const lineWidth=Math.max(20,finite(record.lineWidth,80));
  const color=escapeHtml(record.lineColor||record.strokeColor||'#334155');
  const dash=lineDashArray(String(record.lineStyle||'solid'),lineWidth);
  const isPolyline=Array.isArray(record.points)&&record.points.length>1;
  if(isPolyline){
    const points=record.points.map(p=>`${finite(p.x)},${finite(p.y)}`).join(' ');
    return `
      <div class="survey-map-object survey-map-object-line survey-map-object-stroke ${selected?'selected':''}"
        data-survey-object-id="${escapeHtml(record.objectId)}" role="button"
        aria-label="${record.elbow?'カギ線':record.closed?'多角形':'補正線'}">
        <svg class="survey-map-line-svg" viewBox="0 0 ${size.width} ${size.height}"
          preserveAspectRatio="none" aria-hidden="true">
          <polyline class="survey-map-stroke-hit" points="${points}"></polyline>
          <polyline class="survey-map-stroke-main" points="${points}" stroke="${color}"
            stroke-width="${lineWidth}" ${dash?`stroke-dasharray="${dash}"`:''}></polyline>
        </svg>
        ${selected?polylineHandleHtml(record,size):''}
      </div>
    `;
  }
  const startX=finite(record.startX),startY=finite(record.startY);
  const endX=finite(record.endX),endY=finite(record.endY);
  return `
    <div class="survey-map-object survey-map-object-line ${selected?'selected':''}"
      data-survey-object-id="${escapeHtml(record.objectId)}" role="button" aria-label="直線">
      <svg class="survey-map-line-svg" viewBox="0 0 ${size.width} ${size.height}"
        preserveAspectRatio="none" aria-hidden="true">
        <line class="survey-map-line-hit" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"></line>
        <line class="survey-map-line-main" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"
          stroke="${color}" stroke-width="${lineWidth}" ${dash?`stroke-dasharray="${dash}"`:''}></line>
      </svg>
      ${selected?[
        ['line-start',startX,startY,'始点'],['line-end',endX,endY,'終点']
      ].map(([handle,x,y,label])=>`
        <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
          data-survey-handle="${handle}" style="left:${x/size.width*100}%;top:${y/size.height*100}%"
          aria-label="${label}を移動"></button>
      `).join(''):''}
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
