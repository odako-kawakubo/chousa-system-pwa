/** Connection anchors for survey drawing objects. 100 units = 1 mm. */
import {shapeVertices} from './survey-map-shapes.js';
import {elbowRecordWithPoints,lineRecordWithPoints} from './survey-map-transforms.js';

export const ANCHORS=Object.freeze(['right','bottomRight','bottom','bottomLeft','left','topLeft','top','topRight']);
const directions=[[1,0],[Math.SQRT1_2,Math.SQRT1_2],[0,1],[-Math.SQRT1_2,Math.SQRT1_2],[-1,0],[-Math.SQRT1_2,-Math.SQRT1_2],[0,-1],[Math.SQRT1_2,-Math.SQRT1_2]];
const num=(x)=>Number(x)||0;
const center=o=>({x:num(o.x)+num(o.width)/2,y:num(o.y)+num(o.height)/2});
const rotate=(p,c,a)=>({x:c.x+(p.x-c.x)*Math.cos(a)-(p.y-c.y)*Math.sin(a),y:c.y+(p.x-c.x)*Math.sin(a)+(p.y-c.y)*Math.cos(a)});
const polygonPoints=o=>{
  if(o.type==='line'&&o.closed&&Array.isArray(o.points))return o.points.slice(0,-1);
  const c=center(o),a=num(o.rotation)*Math.PI/180;
  return shapeVertices(o.shapeType,o.shapeParams,o.customVertices).map(p=>{
    const local={x:num(o.x)+(o.flipX?1-p.x:p.x)*num(o.width),y:num(o.y)+(o.flipY?1-p.y:p.y)*num(o.height)};
    return rotate(local,c,a);
  });
};
export function canAnchor(o){
  return Boolean(o&&!o.deleted&&o.visible!==false&&(
    o.type==='shape'||o.type==='roomLabel'||
    (o.type==='line'&&o.closed&&Array.isArray(o.points)&&o.points.length>=4)
  ));
}
export function anchorPoint(o,anchor){
  if(!canAnchor(o))return null;
  const i=ANCHORS.indexOf(anchor);
  if(i<0)return null;
  const [dx,dy]=directions[i],c=center(o);
  if(o.shapeType==='circle'&&o.type==='shape'&&!o.customVertices){
    const rx=Math.max(1,num(o.width)/2),ry=Math.max(1,num(o.height)/2),theta=num(o.rotation)*Math.PI/180;
    const ux=dx*Math.cos(theta)+dy*Math.sin(theta),uy=-dx*Math.sin(theta)+dy*Math.cos(theta);
    const scale=1/Math.sqrt(ux*ux/(rx*rx)+uy*uy/(ry*ry));
    return {x:c.x+dx*scale,y:c.y+dy*scale};
  }
  const vertices=(o.type==='roomLabel'
    ?[{x:num(o.x),y:num(o.y)},{x:num(o.x)+num(o.width),y:num(o.y)},
       {x:num(o.x)+num(o.width),y:num(o.y)+num(o.height)},{x:num(o.x),y:num(o.y)+num(o.height)}]
       .map(point=>rotate(point,c,num(o.rotation)*Math.PI/180))
    :polygonPoints(o));
  if(vertices.length<2)return c;
  // Intersect the ray with actual outline, not the shape's bounding rectangle.
  const hits=[];
  for(let j=0;j<vertices.length;j++){
    const a=vertices[j],b=vertices[(j+1)%vertices.length],ex=b.x-a.x,ey=b.y-a.y;
    const divisor=dx*ey-dy*ex;
    if(Math.abs(divisor)<1e-8)continue;
    const ax=a.x-c.x,ay=a.y-c.y;
    const t=(ax*ey-ay*ex)/divisor,u=(ax*dy-ay*dx)/divisor;
    if(t>=-1e-6&&u>=-1e-6&&u<=1+1e-6)hits.push(t);
  }
  if(!hits.length)return c;
  const t=Math.max(...hits);
  return {x:c.x+t*dx,y:c.y+t*dy};
}
export function nearestAnchor(point,objects,radius,excludeId=''){
  let nearest=null,dist=radius;
  for(const o of objects){
    if(!canAnchor(o)||o.objectId===excludeId)continue;
    for(const anchor of ANCHORS){
      const p=anchorPoint(o,anchor);
      if(!p)continue;
      const d=Math.hypot(p.x-point.x,p.y-point.y);
      if(d<=dist){dist=d;nearest={targetObjectId:o.objectId,anchor,point:p};}
    }
  }
  return nearest;
}
export function bestConnectionPair(a,b){
  let best=null,dist=Infinity;
  for(const first of ANCHORS)for(const second of ANCHORS){
    const p=anchorPoint(a,first),q=anchorPoint(b,second);
    if(!p||!q)continue;
    const d=Math.hypot(p.x-q.x,p.y-q.y);
    if(d<dist){dist=d;best={startConnection:{targetObjectId:a.objectId,anchor:first},
      endConnection:{targetObjectId:b.objectId,anchor:second},start:p,end:q};}
  }
  return best;
}
export function resolveConnectedLine(line,byId){
  if(line?.type!=='line')return line;
  const locate=conn=>conn&&anchorPoint(byId.get(conn.targetObjectId),conn.anchor);
  const start=locate(line.startConnection),end=locate(line.endConnection);
  if(!start&&!end)return line;
  const x=start?.x??num(line.startX),y=start?.y??num(line.startY);
  const ex=end?.x??num(line.endX),ey=end?.y??num(line.endY);
  if(line.elbow){
    // Preserve the stored bend position relative to the original endpoints.
    // This makes attached elbows move and resize with their target objects.
    const oldStart=num(line.startX),oldEnd=num(line.endX);
    const originalBend=num(line.bendX??(oldStart+oldEnd)/2);
    const span=oldEnd-oldStart;
    const fraction=Math.abs(span)>1e-6?(originalBend-oldStart)/span:.5;
    const bend=x+(ex-x)*fraction;
    return elbowRecordWithPoints(line,x,y,ex,ey,bend);
  }
  if(!Array.isArray(line.points)||line.points.length<2)return lineRecordWithPoints(line,x,y,ex,ey);
  return line;
}
