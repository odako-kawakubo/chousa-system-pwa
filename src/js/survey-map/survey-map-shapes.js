/** 調査図の図形定義。形状は0〜1に正規化した頂点で管理する。 */
export const SHAPE_TOOLS=Object.freeze(['rect','circle','triangle','lshape','tshape','cross','concave','polygon']);
const V={
 rect:[[0,0],[1,0],[1,1],[0,1]],
 triangle:[[0,0],[0,1],[1,1]],
 lshape:[[0,0],[.42,0],[.42,.58],[1,.58],[1,1],[0,1]],
 tshape:[[0,0],[1,0],[1,.34],[.67,.34],[.67,1],[.33,1],[.33,.34],[0,.34]],
 cross:[[.33,0],[.67,0],[.67,.33],[1,.33],[1,.67],[.67,.67],[.67,1],[.33,1],[.33,.67],[0,.67],[0,.33],[.33,.33]],
 concave:[[0,0],[1,0],[1,1],[0,1],[0,.65],[.55,.65],[.55,.35],[0,.35]],
 polygon:[[.22,0],[.78,0],[1,.38],[.82,1],[.18,1],[0,.38]]
};
export function isShapeTool(kind){return SHAPE_TOOLS.includes(kind);}
export function shapeVertices(kind){return (V[kind]||V.rect).map(([x,y])=>({x,y}));}
export function shapeSvgMarkup(kind){
 if(kind==='circle')return '<ellipse cx="500" cy="500" rx="500" ry="500"/>';
 return `<polygon points="${shapeVertices(kind).map(p=>`${p.x*1000},${p.y*1000}`).join(' ')}"/>`;
}
