/** 新旧案件共通の調査図初期レコード。同案件・複数端末で同一IDになる。 */
import {createDrawingRecord} from '../records/drawing-record.js';
import {touchFieldEditedAt} from '../sync/field-edit-meta.js';
export function createInitialSurveyMap(project){
  const now=Date.now();
  return createDrawingRecord({
    drawingId:`D-initial-${String(project.projectId)}`,
    projectId:String(project.projectId),
    name:'調査図1',order:1,
    titleSettings:{text:'調査図'},
    nameSettings:{text:project.projectName||'調査図1'},
    legendSettings:{visible:true,items:[]},
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'name','order','deleted','titleSettings','nameSettings','legendSettings'
    ],now)
  });
}
export function needsInitialSurveyMap(records=[]){
  return !(records||[]).some(record=>record&&!record.deleted);
}
