/**
 * v0.1.10.15 調査図の直交領域演算。
 * DOM / Store / Firestoreには触れず、図形から新しい輪郭と共有辺を計算する。
 * 円、斜辺、斜め回転、穴、接点のみの接続は安全のため対象外。
 */
import { shapeVertices } from './survey-map-shapes.js';

const EPS=1e-6;
const near=(a,b)=>Math.abs(a-b)<EPS;
const key=(x,y)=>x+','+y;
const signedArea=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const unique=items=>[...new Set(items)].sort((a,b)=>a-b);
const between=(a,b,c)=>Math.min(a,b)-EPS<=c&&c<=Math.max(a,b)+EPS;

export function objectPolygon(record){
  if(record.type!=='shape' || record.shapeType==='circle') throw new Error('円・楕円は統合・分割の対象外です');
  const x=Number(record.x),y=Number(record.y),w=Number(record.width),h=Number(record.height);
  if(![x,y,w,h].every(Number.isFinite)||w<EPS||h<EPS)throw new Error('図形の寸法が不正です');
  const angle=(Number(record.rotation)||0)*Math.PI/180;
  const cs=Math.cos(angle),sn=Math.sin(angle),cx=x+w/2,cy=y+h/2;
  const points=shapeVertices(record.shapeType,record.shapeParams,record.customVertices).map(p=>{
    const px=x+(record.flipX?1-p.x:p.x)*w,py=y+(record.flipY?1-p.y:p.y)*h;
    const dx=px-cx,dy=py-cy;
    return {x:cx+dx*cs-dy*sn,y:cy+dx*sn+dy*cs};
  });
  if(points.length<3||Math.abs(signedArea(points))<EPS)throw new Error('閉じた領域ではありません');
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(!near(a.x,b.x)&&!near(a.y,b.y))throw new Error('斜辺を含む図形は次の段階で対応します');
  }
  return points;
}
function contains(points,x,y){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function gridFrom(polygons,cut=null){
  const xs=unique(polygons.flatMap(p=>p.map(q=>q.x)).concat(cut?.axis==='x'?[cut.value]:[]));
  const ys=unique(polygons.flatMap(p=>p.map(q=>q.y)).concat(cut?.axis==='y'?[cut.value]:[]));
  if(xs.length<2||ys.length<2)throw new Error('領域を生成できません');
  const owners=[];
  for(let j=0;j<ys.length-1;j++){
    const row=[];
    for(let i=0;i<xs.length-1;i++){
      const mx=(xs[i]+xs[i+1])/2,my=(ys[j]+ys[j+1])/2;
      row.push(polygons.map((p,k)=>contains(p,mx,my)?k:-1).filter(k=>k>=0));
    }
    owners.push(row);
  }
  return {xs,ys,owners};
}
function boundary(grid,chosen){
  const {xs,ys}=grid,nx=xs.length-1,ny=ys.length-1;
  const enabled=(i,j)=>i>=0&&j>=0&&i<nx&&j<ny&&chosen(i,j);
  const edges=[];
  function edge(a,b){edges.push({a,b});}
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    if(!enabled(i,j))continue;
    const x0=xs[i],x1=xs[i+1],y0=ys[j],y1=ys[j+1];
    if(!enabled(i,j-1))edge({x:x0,y:y0},{x:x1,y:y0});
    if(!enabled(i+1,j))edge({x:x1,y:y0},{x:x1,y:y1});
    if(!enabled(i,j+1))edge({x:x1,y:y1},{x:x0,y:y1});
    if(!enabled(i-1,j))edge({x:x0,y:y1},{x:x0,y:y0});
  }
  if(!edges.length)throw new Error('領域が空です');
  const outgoing=new Map();
  edges.forEach((e,i)=>{const k=key(e.a.x,e.a.y);if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(i);});
  const used=new Set(),loops=[];
  for(let start=0;start<edges.length;start++){
    if(used.has(start))continue;
    const ring=[],origin=edges[start].a;let cursor=start;
    for(let step=0;step<=edges.length;step++){
      if(used.has(cursor))throw new Error('輪郭が閉じていません');
      used.add(cursor);
      const e=edges[cursor];ring.push(e.a);
      if(near(e.b.x,origin.x)&&near(e.b.y,origin.y))break;
      const choices=(outgoing.get(key(e.b.x,e.b.y))||[]).filter(i=>!used.has(i));
      if(choices.length!==1)throw new Error('角で接する図形または複雑な輪郭は未対応です');
      cursor=choices[0];
      if(step===edges.length)throw new Error('輪郭が閉じていません');
    }
    // 中間の直線上の頂点を取り除く。
    const compact=ring.filter((p,i)=>{
      const prev=ring[(i+ring.length-1)%ring.length],next=ring[(i+1)%ring.length];
      return !((near(prev.x,p.x)&&near(p.x,next.x))||(near(prev.y,p.y)&&near(p.y,next.y)));
    });
    if(compact.length<4)throw new Error('輪郭の頂点数が不足しています');
    loops.push(compact);
  }
  if(loops.length!==1)throw new Error('離れた図形・穴のある図形は未対応です');
  return loops[0];
}
function internalEdges(grid){
  const {xs,ys,owners}=grid,edges=[];
  const occupied=(i,j)=>owners[j]?.[i]?.length>0;
  for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
    if(!occupied(i,j))continue;
    if(i+1<xs.length-1&&occupied(i+1,j)&&owners[j][i].some(a=>!owners[j][i+1].includes(a))&&owners[j][i+1].some(a=>!owners[j][i].includes(a))){
      edges.push([{x:xs[i+1],y:ys[j]},{x:xs[i+1],y:ys[j+1]}]);
    }
    if(j+1<ys.length-1&&occupied(i,j+1)&&owners[j][i].some(a=>!owners[j+1][i].includes(a))&&owners[j+1][i].some(a=>!owners[j][i].includes(a))){
      edges.push([{x:xs[i],y:ys[j+1]},{x:xs[i+1],y:ys[j+1]}]);
    }
  }
  const merged=[];
  for(const vertical of [true,false]){
    const segments=edges.filter(([a,b])=>vertical?near(a.x,b.x):near(a.y,b.y))
      .map(([a,b])=>({fixed:vertical?a.x:a.y,from:Math.min(vertical?a.y:a.x,vertical?b.y:b.x),to:Math.max(vertical?a.y:a.x,vertical?b.y:b.x)}))
      .sort((a,b)=>a.fixed-b.fixed||a.from-b.from);
    for(const s of segments){
      const prev=merged.at(-1);
      if(prev&&prev.vertical===vertical&&near(prev.fixed,s.fixed)&&s.from<=prev.to+EPS)prev.to=Math.max(prev.to,s.to);
      else merged.push({...s,vertical});
    }
  }
  return merged.map(s=>s.vertical?
    [{x:s.fixed,y:s.from},{x:s.fixed,y:s.to}]:
    [{x:s.from,y:s.fixed},{x:s.to,y:s.fixed}]);
}
export function joinRegions(records){
  if(records.length<2)throw new Error('2つ以上の図形を選択してください');
  const polygons=records.map(objectPolygon),grid=gridFrom(polygons);
  if(grid.owners.some(row=>row.some(owners=>owners.length>1))){
    throw new Error('重なった領域の統合は未対応です。辺を接するように配置してください');
  }
  const outline=boundary(grid,(i,j)=>grid.owners[j][i].length>0);
  const partitions=internalEdges(grid);
  return {outlines:[outline],partitions};
}
export function splitRegion(shape,line){
  const poly=objectPolygon(shape);
  if(line.type!=='line'||line.freehand||line.elbow||line.points?.length>2)throw new Error('通常の直線を選択してください');
  const a={x:Number(line.startX),y:Number(line.startY)},b={x:Number(line.endX),y:Number(line.endY)};
  const vertical=near(a.x,b.x),horizontal=near(a.y,b.y);
  if(!vertical&&!horizontal)throw new Error('まずは水平・垂直の分割線に対応しています');
  const cut={axis:vertical?'x':'y',value:vertical?a.x:a.y};
  const grid=gridFrom([poly],cut);
  const left=(i,j)=>grid.owners[j][i].length>0&&((vertical?(grid.xs[i]+grid.xs[i+1])/2:(grid.ys[j]+grid.ys[j+1])/2)<cut.value);
  const right=(i,j)=>grid.owners[j][i].length>0&&!left(i,j);
  const first=boundary(grid,left),second=boundary(grid,right);
  // 分割線は外周との交点を結ぶ必要があり、図形の内側だけの線は拒否する。
  const intersections=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length];
    if(vertical&&near(p.y,q.y)&&between(p.x,q.x,cut.value))intersections.push({x:cut.value,y:p.y});
    if(horizontal&&near(p.x,q.x)&&between(p.y,q.y,cut.value))intersections.push({x:p.x,y:cut.value});
  }
  const coords=unique(intersections.map(p=>vertical?p.y:p.x));
  if(coords.length!==2)throw new Error('分割線と外周の交点が2つ必要です');
  const from=vertical?a.y:a.x,to=vertical?b.y:b.x;
  if(Math.min(from,to)>coords[0]+EPS||Math.max(from,to)<coords[1]-EPS)throw new Error('分割線を図形の両端まで伸ばしてください');
  return {outlines:[first,second],partitions:[]};
}
export function polygonRecordGeometry(points){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
  if(width<EPS||height<EPS)throw new Error('図形サイズが不正です');
  return {x,y,width,height,rotation:0,flipX:false,flipY:false,shapeType:'polygon',shapeParams:{},
    customVertices:points.map(p=>({x:(p.x-x)/width,y:(p.y-y)/height}))};
}
