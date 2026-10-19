/** 座標ベースの線・折れ線変形を共通化。DOMと保存処理に依存しない。 */
export function lineBounds(startX,startY,endX,endY){
  return {
    x:Math.min(Number(startX)||0,Number(endX)||0),
    y:Math.min(Number(startY)||0,Number(endY)||0),
    width:Math.abs((Number(endX)||0)-(Number(startX)||0)),
    height:Math.abs((Number(endY)||0)-(Number(startY)||0))
  };
}

export function lineRecordWithPoints(record,startX,startY,endX,endY){
  return {
    ...record,
    startX,
    startY,
    endX,
    endY,
    ...lineBounds(startX,startY,endX,endY),
    rotation:0
  };
}

export function elbowPath(startX,startY,endX,endY,bendX=(startX+endX)/2){
  return [
    {x:startX,y:startY},{x:bendX,y:startY},
    {x:bendX,y:endY},{x:endX,y:endY}
  ];
}
export function strokeRecordWithPoints(record,points){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return {...record,points,x:Math.min(...xs),y:Math.min(...ys),
    width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
export function elbowRecordWithPoints(record,startX,startY,endX,endY,bendX){
  return strokeRecordWithPoints({...record,startX,startY,endX,endY,bendX},
    elbowPath(startX,startY,endX,endY,bendX));
}

export function translateObject(record,dx,dy){
  if(record.elbow){
    return elbowRecordWithPoints(record,
      record.startX+dx,record.startY+dy,record.endX+dx,record.endY+dy,record.bendX+dx);
  }
  if(record.type==='line' && Array.isArray(record.points) && record.points.length>1){
    return strokeRecordWithPoints(record,record.points.map(p=>({x:p.x+dx,y:p.y+dy})));
  }
  if(record.type==='line'){
    return lineRecordWithPoints(record,
      (Number(record.startX)||0)+dx,(Number(record.startY)||0)+dy,
      (Number(record.endX)||0)+dx,(Number(record.endY)||0)+dy);
  }
  return {...record,x:(Number(record.x)||0)+dx,y:(Number(record.y)||0)+dy};
}

/** 共通の幾何変換。線は実座標、図形は中心と寸法を変換する。 */
export function objectBounds(record){
  return {x:Number(record.x)||0,y:Number(record.y)||0,width:Number(record.width)||0,height:Number(record.height)||0};
}
function transformPoints(record,transform){
  const points=Array.isArray(record.points)&&record.points.length>1?record.points:
    [{x:Number(record.startX)||0,y:Number(record.startY)||0},{x:Number(record.endX)||0,y:Number(record.endY)||0}];
  const mapped=points.map(transform);
  if(record.elbow){
    return strokeRecordWithPoints({...record,elbow:false,rotation:(Number(record.rotation)||0)},mapped);
  }
  if(Array.isArray(record.points)&&record.points.length>1){
    return strokeRecordWithPoints({...record,rotation:(Number(record.rotation)||0)},mapped);
  }
  return lineRecordWithPoints(record,mapped[0].x,mapped[0].y,mapped[1].x,mapped[1].y);
}
export function rotateSingleObject(record,angle){
  const delta=Number(angle)||0;
  if(record.type!=='line')return {...record,rotation:((Number(record.rotation)||0)+delta)%360};
  const b=objectBounds(record),cx=b.x+b.width/2,cy=b.y+b.height/2;
  const r=delta*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  return {...transformPoints(record,p=>({x:cx+(p.x-cx)*c-(p.y-cy)*s,y:cy+(p.x-cx)*s+(p.y-cy)*c})),rotation:((Number(record.rotation)||0)+delta)%360};
}
export function flipSingleObject(record,axis){
  if(record.type!=='line'){
    const name=axis==='horizontal'?'flipX':'flipY';
    return {...record,[name]:!record[name]};
  }
  const b=objectBounds(record),cx=b.x+b.width/2,cy=b.y+b.height/2;
  return transformPoints(record,p=>({
    x:axis==='horizontal'?2*cx-p.x:p.x,
    y:axis==='vertical'?2*cy-p.y:p.y
  }));
}
export function scaleObjectInGroup(record,bounds,nextBounds){
  const sx=nextBounds.width/Math.max(1,bounds.width),sy=nextBounds.height/Math.max(1,bounds.height);
  const map=p=>({x:nextBounds.x+(p.x-bounds.x)*sx,y:nextBounds.y+(p.y-bounds.y)*sy});
  if(record.elbow){
    const start=map({x:record.startX,y:record.startY});
    const end=map({x:record.endX,y:record.endY});
    const bend=map({x:record.bendX,y:record.startY});
    return elbowRecordWithPoints(record,start.x,start.y,end.x,end.y,bend.x);
  }
  if(record.type==='line')return transformPoints(record,map);
  const topLeft=map({x:record.x,y:record.y});
  return {...record,x:topLeft.x,y:topLeft.y,width:(Number(record.width)||0)*sx,height:(Number(record.height)||0)*sy};
}
