/** 調査図のローカル編集履歴。同期は呼び出し側が担当する。 */
let projectId='';
let past=[];
let future=[];
function scope(id){
  const next=String(id||'');
  if(next!==projectId){projectId=next;past=[];future=[];}
}
function copy(record){return record==null?null:JSON.parse(JSON.stringify(record));}
export function rememberSurveyEdit(project,type,before,after,source){
  scope(project);
  if(JSON.stringify(before)===JSON.stringify(after))return;
  const now=Date.now(),change={type,before:copy(before),after:copy(after)};
  const last=past.at(-1);
  if(['survey-map-group-move','survey-map-group-resize','survey-map-group-delete'].includes(source) && last?.source===source && now-last.at<500){
    last.changes.push(change);
  }else{
    past.push({source,at:now,changes:[change]});
    if(past.length>50)past.shift();
  }
  future=[];
}
export function historyStatus(project){
  scope(project);
  return {undo:past.length>0,redo:future.length>0};
}
export function takeUndo(project){
  scope(project);
  const item=past.pop();
  if(item)future.push(item);
  return item||null;
}
export function takeRedo(project){
  scope(project);
  const item=future.pop();
  if(item)past.push(item);
  return item||null;
}
