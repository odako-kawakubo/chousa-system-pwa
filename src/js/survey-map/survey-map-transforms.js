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
