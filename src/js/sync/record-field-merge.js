/**
 * fieldEditedAtを使ったRecord項目単位の競合マージ。
 * Firestoreへ保存する業務項目だけを比較し、ID・updatedAt・端末ローカル専用値は対象外にする。
 */
import { normalizeFieldEditedAt, getFieldEditedAt } from './field-edit-meta.js';

export const RECORD_MERGE_FIELDS = Object.freeze({
  finish: Object.freeze([
    'roomNo','roomName','roomNote','part','materialId','materialName','systemMemo'
  ]),
  material: Object.freeze([
    'status','materialNo','name','part','usageLocation','level','note','analysisRequired',
    'sampleCount','sampleLocation1','sampleLocation2','sampleLocation3','samplePart',
    'sampleDone','sampleDate','sampleName','analysisResult','remarks','systemMemo'
  ]),
  photo: Object.freeze([
    'photoType','fileName','isRepresentative','capturedDevice','capturedAt','boardDate',
    'isEdited','lastEditedDevice','lastEditedAt','deleted','systemMemo','boardPosition',
    'boardSize','oneDriveDriveId','originalItemId','completedItemId','originalPath',
    'completedPath','areaCode','roomPosition','partSlot','materialId','samplingPlace',
    'samplingBranch','sampleNo','part','shootingType'
  ])
});

function sameValue(a,b){
  if(Array.isArray(a)||Array.isArray(b)) return JSON.stringify(a||[])===JSON.stringify(b||[]);
  if(a&&typeof a==='object'||b&&typeof b==='object') return JSON.stringify(a||{})===JSON.stringify(b||{});
  return String(a??'')===String(b??'');
}

function mergeEditedAt(local,incoming){
  const a=normalizeFieldEditedAt(local?.fieldEditedAt);
  const b=normalizeFieldEditedAt(incoming?.fieldEditedAt);
  const out={...a};
  Object.entries(b).forEach(([field,stamp])=>{
    out[field]=Math.max(Number(out[field]||0),Number(stamp||0));
  });
  return out;
}

/**
 * local/incomingの同一Recordを項目単位でマージする。
 * 同時刻で値が異なる場合だけprefer側を採用する。
 */
export function mergeRecordByFieldEditedAt(recordType,local,incoming,{prefer='incoming'}={}){
  if(!local) return {record:incoming?{...incoming}:null,localWins:[],incomingWins:[],conflicts:[]};
  if(!incoming) return {record:{...local},localWins:[],incomingWins:[],conflicts:[]};

  const fields=RECORD_MERGE_FIELDS[recordType]||[];
  const merged={...incoming};
  const localWins=[];
  const incomingWins=[];
  const conflicts=[];

  fields.forEach((field)=>{
    const localStamp=getFieldEditedAt(local,field);
    const incomingStamp=getFieldEditedAt(incoming,field);
    const equalValue=sameValue(local?.[field],incoming?.[field]);

    if(localStamp>incomingStamp){
      merged[field]=local?.[field];
      if(!equalValue)localWins.push(field);
      return;
    }
    if(incomingStamp>localStamp){
      merged[field]=incoming?.[field];
      if(!equalValue)incomingWins.push(field);
      return;
    }

    if(!equalValue){
      conflicts.push(field);
      if(prefer==='local'){
        merged[field]=local?.[field];
        localWins.push(field);
      }else{
        merged[field]=incoming?.[field];
        incomingWins.push(field);
      }
    }
  });

  merged.fieldEditedAt=mergeEditedAt(local,incoming);
  return {record:merged,localWins,incomingWins,conflicts};
}

export function sameMergedBusinessRecord(recordType,a,b){
  if(!a||!b)return a===b;
  return (RECORD_MERGE_FIELDS[recordType]||[]).every((field)=>sameValue(a?.[field],b?.[field]))
    && JSON.stringify(normalizeFieldEditedAt(a.fieldEditedAt))===JSON.stringify(normalizeFieldEditedAt(b.fieldEditedAt));
}
