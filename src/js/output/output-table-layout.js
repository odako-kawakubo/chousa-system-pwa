/**
 * 帳票列の唯一の定義。編集画面とPDF描画が同じキー・順番・初期幅を参照する。
 * mm はA4縦、左右10mmの印刷可能幅 (190mm) を基準にする。
 */
export const OUTPUT_TABLE_MAX_WIDTH=190;
export const OUTPUT_TABLE_COLUMNS=Object.freeze({
  materials:Object.freeze([
    ['no','建材No.',6],['name','建材名称',33],['part','部位',12],
    ['location','施工範囲',42],['level','建材Lv.',6],['required','分析の要否',19],
    ['result','分析結果',19],['note','調査備考',53]
  ]),
  rooms:Object.freeze([
    ['floor','階',10],['roomNo','部屋No.',12],['roomName','部屋名',22],
    ['part','部位',12],['no','建材No.',6],['name','建材名称',38],
    ['note','調査備考',35],['level','建材Lv.',6],['result','分析結果',19],['roomNote','部屋備考',30]
  ]),
  parts:Object.freeze([
    ['part','部位',12],['floor','階',8],['no','建材No.',6],['name','建材名称',33],
    ['location','施工範囲',42],['level','建材Lv.',6],['result','分析結果',19],['note','調査備考',53]
  ])
});
export function defaultTableWidths(kind){
  return Object.fromEntries((OUTPUT_TABLE_COLUMNS[kind]||[]).map(([key,,width])=>[key,width]));
}
export function normalizeTableWidths(kind,value){
  const defaults=defaultTableWidths(kind),input=value&&typeof value==='object'?value:{};
  const result={};
  for(const [key,,original] of OUTPUT_TABLE_COLUMNS[kind]||[]){
    const raw=Number(input[key]),number=Number.isFinite(raw)&&raw>0?raw:original;
    result[key]=Math.round(Math.max(5,Math.min(100,number))*10)/10;
  }
  // 旧・不正値でもページ幅をはみ出さないようにする。編集時は超過を拒否する。
  if(Object.values(result).reduce((a,b)=>a+b,0)>OUTPUT_TABLE_MAX_WIDTH){
    return defaults;
  }
  return result;
}
export function tableWidthValues(kind,settings,{includeFloor=true}={}){
  return (OUTPUT_TABLE_COLUMNS[kind]||[])
    .filter(([key])=>kind!=='parts'||includeFloor||key!=='floor')
    .map(([key])=>settings?.tableWidths?.[kind]?.[key]??defaultTableWidths(kind)[key]);
}
export function tableWidthTotal(kind,widths,{includeFloor=true}={}){
  return (OUTPUT_TABLE_COLUMNS[kind]||[])
    .filter(([key])=>kind!=='parts'||includeFloor||key!=='floor')
    .reduce((sum,[key])=>sum+(Number(widths?.[key])||0),0);
}
