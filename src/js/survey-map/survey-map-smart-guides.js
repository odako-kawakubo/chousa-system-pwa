/**
 * 調査図の移動中スマートガイド。座標はA4固定値(100=1mm)。
 * 候補: 紙端・他の図形/ラベルの左・中心・右、上・中心・下。
 */
const THRESHOLD=125;
const positions=(o,axis)=>axis==='x'?
  [Number(o.x)||0,(Number(o.x)||0)+(Number(o.width)||0)/2,(Number(o.x)||0)+(Number(o.width)||0)]:
  [Number(o.y)||0,(Number(o.y)||0)+(Number(o.height)||0)/2,(Number(o.y)||0)+(Number(o.height)||0)];
export function snapToGuides(draft,objects,page,omit=[]){
  const excluded=new Set(omit);
  const targets=objects.filter(o=>o&&!o.deleted&&o.visible!==false&&!excluded.has(o.objectId));
  const result={...draft},guides=[];
  for(const [axis,extent] of [['x',page.width],['y',page.height]]){
    const own=positions(result,axis);
    const candidates=[0,extent,...targets.flatMap(o=>positions(o,axis))];
    let best={dist:THRESHOLD+1,delta:0,target:null};
    for(const source of own)for(const target of candidates){
      const delta=target-source,dist=Math.abs(delta);
      if(dist<best.dist)best={dist,delta,target};
    }
    if(best.target!==null && best.dist<=THRESHOLD){
      result[axis]+=best.delta;
      guides.push({axis,value:best.target});
    }
  }
  return {rect:result,guides};
}
export function guideSvg(guides,page){
  if(!guides.length)return '';
  const lines=guides.map(g=>g.axis==='x'?
    `<line x1="${g.value}" y1="0" x2="${g.value}" y2="${page.height}"/>`:
    `<line x1="0" y1="${g.value}" x2="${page.width}" y2="${g.value}"/>`).join('');
  return `<svg class="survey-map-smart-guides" viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`;
}
