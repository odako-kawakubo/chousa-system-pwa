/**
 * 調査図の共通ラベル: 保存形式と表示内容の共通規則。
 * 内部図面単位は 100 units = 1 mm。
 */
export const LABEL_DEFAULTS = Object.freeze({
  roomLabel:{width:500,height:300,fontSize:6,textColor:'#dc2626',strokeColor:'#dc2626',borderEnabled:false,backgroundEnabled:false,backgroundColor:'#ffffff',padding:0},
  materialLabel:{width:2000,height:600,fontSize:4,textColor:'#111111',strokeColor:'#111111',borderEnabled:true,backgroundEnabled:false,backgroundColor:'#ffffff',padding:50},
  text:{width:2500,height:500,fontSize:6,textColor:'#111111',strokeColor:'#111111',borderEnabled:false,backgroundEnabled:false,backgroundColor:'#ffffff',padding:0},
  sampleMarker:{width:400,height:400,fontSize:6,textColor:'#dc2626',strokeColor:'#dc2626',borderEnabled:true,backgroundEnabled:false,backgroundColor:'#ffffff',padding:0}
});
export const LABEL_TYPES=new Set(Object.keys(LABEL_DEFAULTS));
export function isLabelType(type){return LABEL_TYPES.has(type);}
export function materialPalette(kind='none'){
  if(kind==='positive')return {textColor:'#dc2626',strokeColor:'#dc2626',backgroundEnabled:true,backgroundColor:'#fef08a'};
  if(kind==='assumed')return {textColor:'#dc2626',strokeColor:'#dc2626',backgroundEnabled:true,backgroundColor:'#fbcfe8'};
  return {textColor:'#111111',strokeColor:'#111111',backgroundEnabled:false,backgroundColor:'#ffffff'};
}
export function roomText(record){
  if(record.roomDisplay==='name')return String(record.roomNameSnapshot||record.roomNoSnapshot||record.roomPosition||'');
  return String(record.roomNoSnapshot||record.roomPosition||record.roomNameSnapshot||'');
}
export function labelText(record){
  if(record.type==='roomLabel')return record.customText===true?String(record.text||''):roomText(record);
  return String(record.text||'');
}
export function labelSettings(type,fields={}){
  return {...LABEL_DEFAULTS[type]||LABEL_DEFAULTS.text,...fields};
}
export function escapeLabel(value){
  return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
