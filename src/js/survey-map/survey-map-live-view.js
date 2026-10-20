/**
 * 調査図の描画中プレビューと選択オブジェクトの一時表示。
 * 状態・保存・イベント登録はcontroller側に集約する。
 */
import { pageSize, objectPercentStyle } from './survey-map-geometry.js';
import { shapeAdjusters, defaultShapeParams, shapeVertices } from './survey-map-shapes.js';

export function createLineDraftPreview(sheet,drawing,point){
  const size=pageSize(drawing);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('survey-map-line-draft');
  svg.setAttribute('viewBox',`0 0 ${size.width} ${size.height}`);
  svg.setAttribute('preserveAspectRatio','none');
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1',String(point.x));
  line.setAttribute('y1',String(point.y));
  line.setAttribute('x2',String(point.x));
  line.setAttribute('y2',String(point.y));
  svg.appendChild(line);
  sheet.querySelector('.survey-map-object-layer')?.appendChild(svg);
  return svg;
}

export function updateLineDraftPreview(svg,point){
  const line=svg?.querySelector('line');
  if(!line) return;
  line.setAttribute('x2',String(point.x));
  line.setAttribute('y2',String(point.y));
}

export function updateLineObjectElement(objectEl,record,drawing){
  const size=pageSize(drawing);
  const startX=Number(record.startX)||0;
  const startY=Number(record.startY)||0;
  const endX=Number(record.endX)||0;
  const endY=Number(record.endY)||0;
  objectEl.querySelectorAll('.survey-map-line-svg line').forEach((line)=>{
    line.setAttribute('x1',String(startX));
    line.setAttribute('y1',String(startY));
    line.setAttribute('x2',String(endX));
    line.setAttribute('y2',String(endY));
  });
  const startHandle=objectEl.querySelector('[data-survey-handle="line-start"]');
  const endHandle=objectEl.querySelector('[data-survey-handle="line-end"]');
  if(startHandle){
    startHandle.style.left=`${(startX/size.width)*100}%`;
    startHandle.style.top=`${(startY/size.height)*100}%`;
  }
  if(endHandle){
    endHandle.style.left=`${(endX/size.width)*100}%`;
    endHandle.style.top=`${(endY/size.height)*100}%`;
  }
}

export function updatePolylinePreview(svg,points){
  const line=svg?.querySelector('line');
  if(line)line.remove();
  let poly=svg?.querySelector('polyline');
  if(!poly){
    poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
    svg?.appendChild(poly);
  }
  poly.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));
}
export function previewCorrectedStroke(svg,points){
  updatePolylinePreview(svg,points);
}

export function highlightAdjustedEdges(objectEl,record,key){
  const svg=objectEl.querySelector('.survey-map-shape-svg');
  if(!svg)return;
  svg.querySelectorAll('.survey-map-adjust-highlight').forEach(el=>el.remove());
  const adjuster=shapeAdjusters(record.shapeType,record.shapeParams).find(item=>item.key===key);
  if(!adjuster)return;
  const axis=adjuster.axis;
  const target=(record.shapeParams||{})[key]??defaultShapeParams(record.shapeType)[key];
  const points=shapeVertices(record.shapeType,record.shapeParams,record.customVertices);
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.abs(a[axis]-target)>0.002||Math.abs(b[axis]-target)>0.002)continue;
    const ax=(record.flipX?1-a.x:a.x)*1000,ay=(record.flipY?1-a.y:a.y)*1000;
    const bx=(record.flipX?1-b.x:b.x)*1000,by=(record.flipY?1-b.y:b.y)*1000;
    const line=document.createElementNS('http://www.w3.org/2000/svg','path');
    line.classList.add('survey-map-adjust-highlight');
    line.setAttribute('d',`M${ax} ${ay} L${bx} ${by}`);
    svg.appendChild(line);
  }
}
export function paintObjectDraft(objectEl,draft,drawing){
if(draft.type==='line' && Array.isArray(draft.points) && draft.points.length>1){
  const polyline=objectEl.querySelector('.survey-map-stroke-main');
  if(polyline)polyline.setAttribute('points',draft.points.map(p=>`${p.x},${p.y}`).join(' '));
  const hit=objectEl.querySelector('.survey-map-stroke-hit');
  if(hit)hit.setAttribute('points',draft.points.map(p=>`${p.x},${p.y}`).join(' '));
  if(draft.elbow){
    const size=pageSize(drawing);
    for(const [handleName,point] of [
      ['line-start',draft.points[0]],['line-end',draft.points[3]],
      ['elbow-bend',{x:draft.bendX,y:(draft.startY+draft.endY)/2}]
    ]){
      const button=objectEl.querySelector(`[data-survey-handle="${handleName}"]`);
      if(button){button.style.left=`${point.x/size.width*100}%`;button.style.top=`${point.y/size.height*100}%`;}
    }
  }else{
    const size=pageSize(drawing);
    const count=draft.closed?draft.points.length-1:draft.points.length;
    for(let i=0;i<count;i++){
      const handle=objectEl.querySelector(`[data-survey-point-index="${i}"]`);
      if(handle){
        handle.style.left=`${draft.points[i].x/size.width*100}%`;
        handle.style.top=`${draft.points[i].y/size.height*100}%`;
      }
    }
    const corners=[
      ['nw',draft.x,draft.y],
      ['ne',draft.x+draft.width,draft.y],
      ['sw',draft.x,draft.y+draft.height],
      ['se',draft.x+draft.width,draft.y+draft.height]
    ];
    for(const [corner,x,y] of corners){
      const handle=objectEl.querySelector(`[data-survey-handle="stroke-resize-${corner}"]`);
      if(handle){handle.style.left=`${x/size.width*100}%`;handle.style.top=`${y/size.height*100}%`;}
    }
    const rotateHandle=objectEl.querySelector('[data-survey-handle="stroke-rotate"]');
    if(rotateHandle){
      rotateHandle.style.left=`${(draft.x+draft.width/2)/size.width*100}%`;
      rotateHandle.style.top=`${(draft.y-500)/size.height*100}%`;
    }
  }
}else if(draft.type==='line') updateLineObjectElement(objectEl,draft,drawing);
else objectEl.setAttribute('style',objectPercentStyle(draft,drawing));
}
