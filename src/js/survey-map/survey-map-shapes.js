/** 調査図の共通図形定義。正規化した寸法パラメータから頂点と調整点を導出する。 */
export const SHAPE_TOOLS=Object.freeze(['rect','circle','triangle','lshape','tshape','cross','concave','polygon']);
const clamp=(v,a=.12,b=.88)=>Math.min(b,Math.max(a,Number(v)));
export function defaultShapeParams(kind){
  if(kind==='lshape')return {barX:.42,barY:.58};
  if(kind==='tshape')return {left:.33,right:.67,barY:.34};
  if(kind==='cross')return {left:.33,right:.67,top:.33,bottom:.67};
  if(kind==='concave')return {depth:.55,top:.35,bottom:.65};
  return {};
}
/** 作成時だけ、図形内の折れ点を紙面共通グリッドへ合わせる。 */
export function initialGridShapeParams(kind,rect,spacing){
  const params=defaultShapeParams(kind);
  if(!spacing||!Object.keys(params).length)return params;
  const horizontal=new Set(['barX','left','right','depth']);
  const result={...params};
  for(const [key,ratio] of Object.entries(params)){
    const isX=horizontal.has(key),origin=isX?rect.x:rect.y;
    const extent=isX?rect.width:rect.height;
    if(extent<=0)continue;
    const aligned=Math.round((origin+extent*ratio)/spacing)*spacing;
    result[key]=Math.min(.95,Math.max(.05,(aligned-origin)/extent));
  }
  return result;
}
export function isShapeTool(kind){return SHAPE_TOOLS.includes(kind)&&kind!=='polygon';}
export function shapeVertices(kind,params={},customVertices=null){
  if(Array.isArray(customVertices)&&customVertices.length>=3){
    return customVertices.map(p=>({x:clamp(p.x,0,1),y:clamp(p.y,0,1)}));
  }
  const p={...defaultShapeParams(kind),...params};
  const x=clamp(p.barX),y=clamp(p.barY);
  const l=clamp(p.left),r=clamp(p.right,l+.12,.95);
  const t=clamp(p.top),b=clamp(p.bottom,t+.12,.95);
  const vertices={
    rect:[[0,0],[1,0],[1,1],[0,1]],
    triangle:[[0,0],[0,1],[1,1]],
    lshape:[[0,0],[x,0],[x,y],[1,y],[1,1],[0,1]],
    tshape:[[0,0],[1,0],[1,clamp(p.barY)],[r,clamp(p.barY)],[r,1],[l,1],[l,clamp(p.barY)],[0,clamp(p.barY)]],
    cross:[[l,0],[r,0],[r,t],[1,t],[1,b],[r,b],[r,1],[l,1],[l,b],[0,b],[0,t],[l,t]],
    concave:[[0,0],[1,0],[1,1],[0,1],[0,clamp(p.bottom)],[clamp(p.depth),clamp(p.bottom)],[clamp(p.depth),clamp(p.top)],[0,clamp(p.top)]],
    polygon:[[.22,0],[.78,0],[1,.38],[.82,1],[.18,1],[0,.38]]
  }[kind]||[[0,0],[1,0],[1,1],[0,1]];
  return vertices.map(([px,py])=>({x:px,y:py}));
}
export function shapeAdjusters(kind,params={}){
  const p={...defaultShapeParams(kind),...params};
  if(kind==='lshape')return [{key:'barX',axis:'x',x:p.barX,y:0},{key:'barY',axis:'y',x:1,y:p.barY}];
  if(kind==='tshape')return [{key:'left',axis:'x',x:p.left,y:1},{key:'right',axis:'x',x:p.right,y:1},{key:'barY',axis:'y',x:1,y:p.barY}];
  if(kind==='cross')return [
    {key:'left',axis:'x',x:p.left,y:.5},{key:'right',axis:'x',x:p.right,y:.5},
    {key:'top',axis:'y',x:.5,y:p.top},{key:'bottom',axis:'y',x:.5,y:p.bottom}
  ];
  if(kind==='concave')return [{key:'depth',axis:'x',x:p.depth,y:.5},{key:'top',axis:'y',x:0,y:p.top},{key:'bottom',axis:'y',x:0,y:p.bottom}];
  return [];
}
export function updatedShapeParams(kind,params,key,ratio){
  const current={...defaultShapeParams(kind),...params};
  if(!Object.hasOwn(current,key))return current;
  let min=.12,max=.88;
  if(key==='left')max=(current.right||.67)-.12;
  if(key==='right')min=(current.left||.33)+.12;
  if(key==='top')max=(current.bottom||.67)-.12;
  if(key==='bottom')min=(current.top||.33)+.12;
  return {...current,[key]:clamp(ratio,min,max)};
}
export function shapeSvgMarkup(kind,params={},customVertices=null){
  if(kind==='circle' && !customVertices)return '<ellipse cx="500" cy="500" rx="500" ry="500"/>';
  return `<polygon points="${shapeVertices(kind,params,customVertices).map(p=>`${p.x*1000},${p.y*1000}`).join(' ')}"/>`;
}
