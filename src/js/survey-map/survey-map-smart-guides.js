/**
 * 調査図の表示専用スマートガイド。座標はA4固定値(100=1mm)。
 * 位置は一切変更しない。グリッドへの吸着とは独立した視覚補助。
 */
const THRESHOLD=125;
const positions=(o,axis)=>axis==='x'?
  [Number(o.x)||0,(Number(o.x)||0)+(Number(o.width)||0)/2,(Number(o.x)||0)+(Number(o.width)||0)]:
  [Number(o.y)||0,(Number(o.y)||0)+(Number(o.height)||0)/2,(Number(o.y)||0)+(Number(o.height)||0)];
export function alignmentGuides(draft,objects,page,omit=[]){
  const excluded=new Set(omit);
  const targets=objects.filter(o=>o&&!o.deleted&&o.visible!==false&&!excluded.has(o.objectId));
  const guides=[];
  for(const [axis,extent] of [['x',page.width],['y',page.height]]){
    const own=positions(draft,axis);
    const candidates=[0,extent,...targets.flatMap(o=>positions(o,axis))];
    let best={dist:THRESHOLD+1,target:null};
    for(const source of own)for(const target of candidates){
      const dist=Math.abs(target-source);
      if(dist<best.dist)best={dist,target};
    }
    if(best.target!==null&&best.dist<=THRESHOLD)guides.push({axis,value:best.target});
  }
  return guides;
}
export function guideSvg(guides,page){
  if(!guides.length)return '';
  const lines=guides.map(g=>g.axis==='x'?
    `<line x1="${g.value}" y1="0" x2="${g.value}" y2="${page.height}"/>`:
    `<line x1="0" y1="${g.value}" x2="${page.width}" y2="${g.value}"/>`).join('');
  return `<svg class="survey-map-smart-guides" viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`;
}
