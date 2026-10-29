import { pageSize, objectPercentStyle } from './survey-map-geometry.js';
import { isLabelType,labelText,labelSettings,escapeLabel } from './survey-map-labels.js';
import { shapeSvgMarkup,shapeAdjusters,shapeVertices } from './survey-map-shapes.js';

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

function polylineHandleHtml(record,size,editMode='shape'){
  if(record.elbow){
    const start=record.points[0],end=record.points.at(-1);
    const mid={x:(record.points[1].x+record.points[2].x)/2,y:(record.points[1].y+record.points[2].y)/2};
    return [
      ['line-start',start,'始点'],['line-end',end,'終点'],['elbow-bend',mid,'折れ位置']
    ].map(([handle,p,label])=>`
      <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
        data-survey-handle="${handle}" style="left:${finite(p.x)/size.width*100}%;top:${finite(p.y)/size.height*100}%"
        aria-label="${label}を移動"></button>
    `).join('')+(editMode==='shape'?`<button type="button" class="survey-map-object-handle survey-map-line-endpoint survey-map-stroke-rotate-handle"
      data-survey-handle="stroke-rotate" style="left:${(finite(record.x)+finite(record.width)/2)/size.width*100}%;top:${(finite(record.y)-500)/size.height*100}%"
      aria-label="カギ線を回転"></button>`:'');
  }
  if(editMode==='shape'){
    const x=finite(record.x),y=finite(record.y),w=finite(record.width),h=finite(record.height);
    const handles=[
      ['nw',x,y],['ne',x+w,y],['sw',x,y+h],['se',x+w,y+h]
    ];
    return handles.map(([corner,px,py])=>`
      <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
        data-survey-handle="stroke-resize-${corner}"
        style="left:${px/size.width*100}%;top:${py/size.height*100}%"
        aria-label="${corner}から図形を拡大縮小"></button>
    `).join('')+`<button type="button"
      class="survey-map-object-handle survey-map-line-endpoint survey-map-stroke-rotate-handle"
      data-survey-handle="stroke-rotate"
      style="left:${(x+w/2)/size.width*100}%;top:${(y-500)/size.height*100}%"
      aria-label="図形を回転"></button>`;
  }
  const count=record.closed?record.points.length-1:record.points.length;
  return record.points.slice(0,count).map((p,index)=>`
    <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
      data-survey-handle="stroke-point" data-survey-point-index="${index}"
      style="left:${finite(p.x)/size.width*100}%;top:${finite(p.y)/size.height*100}%"
      aria-label="頂点${index+1}を移動"></button>
  `).join('');
}

function lineObjectHtml(record,drawing,selected,editMode,showHandles){
  const size=pageSize(drawing);
  const lineWidth=Math.max(20,finite(record.lineWidth,80));
  const pixelWidth=Math.max(.5,lineWidth/40);
  const color=escapeHtml(record.lineColor||record.strokeColor||'#334155');
  const dash=lineDashArray(String(record.lineStyle||'solid'),pixelWidth);
  const isPolyline=Array.isArray(record.points)&&record.points.length>1;
  if(isPolyline){
    const points=record.points.map(p=>`${finite(p.x)},${finite(p.y)}`).join(' ');
    return `
      <div class="survey-map-object survey-map-object-line survey-map-object-stroke ${selected?'selected':''}"
        data-survey-object-id="${escapeHtml(record.objectId)}" role="button"
        aria-label="${record.elbow?'カギ線':record.freehand?'手描きメモ':record.closed?'多角形':'手描き補正'}">
        <svg class="survey-map-line-svg" viewBox="0 0 ${size.width} ${size.height}"
          preserveAspectRatio="none" aria-hidden="true">
          ${record.closed && record.points.length>=4?
            `<polygon class="survey-map-stroke-fill-hit" points="${points}" fill="${record.fillEnabled?escapeHtml(record.fillColor||'#93c5fd'):'transparent'}" fill-opacity="${record.fillEnabled?Math.max(0,Math.min(1,finite(record.fillOpacity,1))):0}"></polygon>`:''}
          <polyline class="survey-map-stroke-hit" points="${points}"></polyline>
          <polyline class="survey-map-stroke-main" points="${points}" stroke="${record.lineEnabled===false?'none':color}"
            style="stroke-width:${pixelWidth}px" ${dash?`stroke-dasharray="${dash}"`:''}></polyline>
        </svg>
        ${showHandles?polylineHandleHtml(record,size,editMode):''}
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
          stroke="${color}" style="stroke-width:${pixelWidth}px" ${dash?`stroke-dasharray="${dash}"`:''}></line>
      </svg>
      ${showHandles?[
        ['line-start',startX,startY,'始点'],['line-end',endX,endY,'終点']
      ].map(([handle,x,y,label])=>`
        <button type="button" class="survey-map-object-handle survey-map-line-endpoint"
          data-survey-handle="${handle}" style="left:${x/size.width*100}%;top:${y/size.height*100}%"
          aria-label="${label}を移動"></button>
      `).join(''):''}
      ${showHandles&&editMode==='shape'?`<button type="button" class="survey-map-object-handle survey-map-line-endpoint survey-map-stroke-rotate-handle"
        data-survey-handle="line-rotate"
        style="left:${((startX+endX)/2)/size.width*100}%;top:${((startY+endY)/2-500)/size.height*100}%"
        aria-label="直線を回転"></button>`:''}
    </div>
  `;
}

function shapeFlipMarkup(record,markup){
  const x=record.flipX?-1:1,y=record.flipY?-1:1;
  return x===1&&y===1?markup:`<g transform="translate(${record.flipX?1000:0} ${record.flipY?1000:0}) scale(${x} ${y})">${markup}</g>`;
}
function flipHandle(record,p){
  return {x:record.flipX?1-p.x:p.x,y:record.flipY?1-p.y:p.y};
}
export function drawingObjectsHtml(records = [], drawing, selection = '',editMode='shape') {
  const selectedIds=selection instanceof Set ? selection :
    new Set(Array.isArray(selection)?selection:[String(selection)]);
  return records
    .filter((record)=>record && record.visible !== false && !record.deleted)
    .map((record)=>{
      const selected = selectedIds.has(String(record.objectId));
      const showHandles=selected && selectedIds.size===1;
      const shapeMode=['circle','rect'].includes(record.shapeType)?'shape':editMode;
      if(record.type==='line') return lineObjectHtml(record,drawing,selected,editMode,showHandles);

      const style = objectPercentStyle(record, drawing);
      if(isLabelType(record.type)){
        const cfg=labelSettings(record.type,record);
        const textMarkup=labelText(record).split('\n').map(line=>`<span class="survey-map-label-line">${escapeLabel(line)}</span>`).join('');
        const decoration=[
          `--survey-label-font:${Math.max(1,Number(cfg.fontSize)||6)}pt`,
          `--survey-label-color:${escapeHtml(cfg.textColor)}`,
          `--survey-label-padding:${Math.max(0,Number(cfg.padding)||0)/100}mm`,
          `--survey-label-border:${cfg.borderEnabled?Math.max(.25,Number(cfg.borderWidth)||1)+'px solid '+escapeHtml(cfg.strokeColor):'none'}`,
          `--survey-label-background:${cfg.backgroundEnabled?escapeHtml(cfg.backgroundColor):'transparent'}`
        ].join(';');
        return `
          <div class="survey-map-object survey-map-object-label survey-map-object-${escapeHtml(record.type)} ${selected?'selected':''}"
            data-survey-object-id="${escapeHtml(record.objectId)}"
            style="${style};${decoration}" role="button" aria-label="ラベル">
            <div class="survey-map-label-contents">${textMarkup}</div>
            ${showHandles?`<button type="button" class="survey-map-object-handle survey-map-object-resize-handle" data-survey-handle="resize" aria-label="サイズ変更"></button>`:''}
          </div>`;
      }
      const isTextRect=record.type==='shape'&&record.shapeType==='rect'&&record.text!==undefined;
      const textCfg=isTextRect?labelSettings('text',record):null;
      const textHtml=isTextRect?labelText(record).split('\n').map(line=>`<span class="survey-map-label-line">${escapeLabel(line)}</span>`).join(''):'';
      const textStyle=isTextRect?[
        `--survey-label-font:${Math.max(1,Number(textCfg.fontSize)||6)}pt`,
        `--survey-text-direction:${record.textDirection==='vertical'?'vertical-rl':'horizontal-tb'}`,
        `--survey-label-color:${escapeHtml(textCfg.textColor||'#111111')}`,
        `--survey-padding-top:${Math.max(0,Number(textCfg.paddingTop??textCfg.padding??0))/100}mm`,
        `--survey-padding-right:${Math.max(0,Number(textCfg.paddingRight??textCfg.padding??0))/100}mm`,
        `--survey-padding-bottom:${Math.max(0,Number(textCfg.paddingBottom??textCfg.padding??0))/100}mm`,
        `--survey-padding-left:${Math.max(0,Number(textCfg.paddingLeft??textCfg.padding??0))/100}mm`,
        `--survey-text-align:${escapeHtml(textCfg.alignH||'center')}`,
        `--survey-text-justify:${({top:'flex-start',middle:'center',bottom:'flex-end'})[textCfg.alignV]||'center'}`
      ].join(';'):'';
      const label = record.type === 'shape' ? '図形' : String(record.type || 'オブジェクト');
      return `
        <div
          class="survey-map-object survey-map-object-${escapeHtml(record.type)} ${['fine','normal','dash'].includes(record.strokeDash)?'survey-map-room-area':''} ${selected?'selected':''}"
          data-survey-object-id="${escapeHtml(record.objectId)}"
          style="${style};${textStyle}"
          role="button"
          aria-label="${escapeHtml(label)}"
        >
          ${record.type==='shape'
            ? `<svg class="survey-map-shape-svg survey-map-object-visual" viewBox="0 0 1000 1000"
              style="--survey-room-dash:${({fine:'8 5',normal:'16 9',dash:'32 18'})[record.strokeDash]||'none'};--survey-shape-stroke:${record.lineEnabled===false?'transparent':escapeHtml(record.strokeColor||'#334155')};
                --survey-shape-width:${Math.max(.5,finite(record.strokeWidth,80)/40)}px;
                --survey-shape-fill:${record.fillEnabled?escapeHtml(record.fillColor||'#93c5fd'):'transparent'};
                --survey-shape-opacity:${record.fillEnabled?Math.max(0,Math.min(1,finite(record.fillOpacity,1))):0}"
              preserveAspectRatio="none" aria-hidden="true">
              ${shapeFlipMarkup(record,shapeSvgMarkup(String(record.shapeType||'rect'),record.shapeParams,record.customVertices))}
              </svg>`
            : `<div class="survey-map-object-visual"></div>`}
          ${isTextRect?`<div class="survey-map-rect-text">${textHtml}</div>`:''}
          ${showHandles ? `
            ${record.type==='shape' && shapeMode==='points' ? shapeVertices(record.shapeType,record.shapeParams,record.customVertices).map(p=>flipHandle(record,p)).map((p,index)=>`
              <button type="button" class="survey-map-object-handle survey-map-shape-vertex"
                style="left:${p.x*100}%;top:${p.y*100}%"
                data-survey-handle="shape-vertex" data-survey-point-index="${index}"
                aria-label="図形頂点${index+1}を移動"></button>
            `).join(''):''}
            ${record.type==='shape' && shapeMode==='shape' && !record.customVertices ? shapeAdjusters(record.shapeType,record.shapeParams).map(h=>({...h,...flipHandle(record,h)})).map(handle=>`
              <button type="button" class="survey-map-object-handle survey-map-shape-adjuster"
                style="left:${handle.x*100}%;top:${handle.y*100}%"
                data-survey-handle="shape-adjust" data-survey-param="${handle.key}"
                aria-label="図形の${handle.key}を調整"></button>
            `).join(''):''}
            ${record.type==='shape' ? (shapeMode==='shape'?['nw','ne','sw','se']:[]).map(corner=>`
              <button type="button" class="survey-map-object-handle survey-map-corner-handle survey-map-corner-${corner}"
                data-survey-handle="resize-${corner}" aria-label="${corner}からサイズ変更"></button>
            `).join('') : `
              <button type="button" class="survey-map-object-handle survey-map-object-resize-handle"
                data-survey-handle="resize" aria-label="サイズ変更"></button>
            `}
            ${shapeMode==='shape'?`<button type="button" class="survey-map-object-handle survey-map-object-rotate-handle"
              data-survey-handle="rotate" aria-label="回転"></button>`:''}
          ` : ''}
        </div>
      `;
    }).join('');
}
