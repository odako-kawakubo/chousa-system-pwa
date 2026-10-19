/** 手描き軌跡を平滑化し、角度を15度単位へ補正する。A4固定座標を使用。 */
import { pageSize, clamp } from './survey-map-geometry.js';
export function traceLength(points){
  return points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
}
function distanceToSegment(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=dx*dx+dy*dy ? clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy),0,1):0;
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function simplify(points,tolerance){
  if(points.length<3)return points;
  let max=0,split=0;
  for(let i=1;i<points.length-1;i++){
    const d=distanceToSegment(points[i],points[0],points.at(-1));
    if(d>max){max=d;split=i;}
  }
  if(max<=tolerance)return [points[0],points.at(-1)];
  const left=simplify(points.slice(0,split+1),tolerance);
  return left.slice(0,-1).concat(simplify(points.slice(split),tolerance));
}
export function correctStroke(raw,drawing){
  if(!Array.isArray(raw)||raw.length<2)return [];
  const size=pageSize(drawing),first=raw[0],last=raw.at(-1);
  const close=raw.length>5 && Math.hypot(first.x-last.x,first.y-last.y)<450 && traceLength(raw)>1800;
  const source=close?[...raw.slice(0,-1),{...first}]:raw;
  const coarse=simplify(source,200);
  const out=[{x:first.x,y:first.y}];
  for(let i=1;i<coarse.length;i++){
    const prev=out.at(-1),target=coarse[i];
    const dx=target.x-prev.x,dy=target.y-prev.y,length=Math.hypot(dx,dy);
    if(length<120)continue;
    const snapped=Math.round(Math.atan2(dy,dx)/(Math.PI/12))*(Math.PI/12);
    out.push({x:clamp(prev.x+Math.cos(snapped)*length,0,size.width),
      y:clamp(prev.y+Math.sin(snapped)*length,0,size.height)});
  }
  if(close && out.length>=4)out[out.length-1]={...out[0]};
  return out;
}
