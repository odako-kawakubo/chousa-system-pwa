/**
 * v0.1.10.11 調査図作図ツール一括レビュー。
 * iPad作図を優先し、中央キャンバスを押さないオーバーレイ式ツール/編集パネルを提供する。
 */
import * as drawingRecordStore from '../store/drawing-record-store.js';
import * as drawingObjectStore from '../store/drawing-object-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { createDrawingRecord } from '../records/drawing-record.js';
import { createDrawingObject, DRAWING_LAYERS } from '../records/drawing-object.js';
import { getCurrentProject, saveProjectSnapshot } from '../projects/project-store.js';
import { persistDrawingForProject, persistDrawingObjectForProject } from '../sync/project-record-persistence.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { clientToPagePoint, clamp, clampObjectRect, objectPercentStyle, pageSize, rotationFromPointer, resizeRectFromCorner } from './survey-map-geometry.js';
import { drawingObjectsHtml } from './survey-map-object-view.js';
import { correctStroke, traceLength } from './survey-map-stroke.js';
import { isShapeTool } from './survey-map-shapes.js';
import { rememberSurveyEdit,historyStatus,takeUndo,takeRedo } from './survey-map-history.js';
import { lineRecordWithPoints,elbowPath,strokeRecordWithPoints,elbowRecordWithPoints,translateObject } from './survey-map-transforms.js';

let initialized=false;
let selectedDrawingId='';
let boundProjectId='';
let gridVisible=true;
let focusMode=false;
let toolPanelOpen=false;
let editPanelOpen=false;
let pagesOpen=false;
let selectedObjectId='';
let selectedObjectIds=new Set();
function selectOnly(id){
  selectedObjectId=id||'';
  selectedObjectIds=new Set(id?[id]:[]);
}
function clearSelection(){selectOnly('');}
let activeTool='select';
let selectedRoomKey='';
let continuousTool='';
let lastToolTap=null;
let zoomLevel=1;
let pointerInteraction=null;
let polygonDraft=null;
let shiftPointerId=null;
let physicalShift=false;
let ratioLocked=false;
let strokeEditMode='shape';
function shiftActive(){return shiftPointerId!==null||physicalShift;}
function syncShiftButton(){
  root()?.querySelector('[data-survey-shift]')?.classList.toggle('active',shiftActive());
}
function snapLinePoint(start,end){
  const dx=end.x-start.x,dy=end.y-start.y,dist=Math.hypot(dx,dy);
  const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4);
  return {x:start.x+dist*Math.cos(angle),y:start.y+dist*Math.sin(angle)};
}

function root(){ return document.getElementById('survey-map'); }
function activeDrawings(){ return drawingRecordStore.getActive(); }

function selectedDrawing(){
  const projectId=String(getCurrentProject()?.projectId||'');
  if(boundProjectId!==projectId){
    boundProjectId=projectId;
    selectedDrawingId='';
    clearSelection();
    polygonDraft=null;
    strokeEditMode='shape';
  }
  const active=activeDrawings();
  if(!active.length) return null;
  const selected=active.find((item)=>item.drawingId===selectedDrawingId) || active[0];
  selectedDrawingId=selected.drawingId;
  return selected;
}

function availableRooms(){
  const rooms=new Map();
  for(const record of finishRecordStore.getAll()){
    const areaCode=String(record.areaCode||'');
    const roomPosition=String(record.roomPosition||'');
    if(!areaCode || !roomPosition || record.status==='deleted')continue;
    const key=`${areaCode}:${roomPosition}`;
    const existing=rooms.get(key);
    const name=String(record.roomName||'').trim();
    const no=String(record.roomNo||'').trim();
    if(!existing)rooms.set(key,{key,areaCode,roomPosition,roomNo:no,roomName:name});
    else{
      if(!existing.roomNo && no)existing.roomNo=no;
      if(!existing.roomName && name)existing.roomName=name;
    }
  }
  return [...rooms.values()].sort((a,b)=>a.key.localeCompare(b.key,'ja',{numeric:true}));
}
function roomLabel(room){
  const detail=room.roomName? `　${room.roomName}` : '';
  return `${room.roomNo||room.roomPosition}${detail}`;
}
function selectedRoom(){
  const rooms=availableRooms();
  if(!rooms.some(room=>room.key===selectedRoomKey))selectedRoomKey=rooms[0]?.key||'';
  return rooms.find(room=>room.key===selectedRoomKey)||null;
}
function drawingObjectsForSelected(){
  const drawing=selectedDrawing();
  if(!drawing) return [];
  return drawingObjectStore.getByDrawingId(drawing.drawingId);
}

function selectedObject(){
  if(!selectedObjectId) return null;
  const object=drawingObjectStore.get(selectedObjectId);
  if(!object || object.deleted || object.drawingId!==selectedDrawingId){
    selectedObjectIds.delete(selectedObjectId);
    selectedObjectId='';
    return null;
  }
  return object;
}

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,(m)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function newDrawingId(){
  if(globalThis.crypto?.randomUUID) return `D-${crypto.randomUUID()}`;
  return `D-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}

function newObjectId(){
  if(globalThis.crypto?.randomUUID) return `O-${crypto.randomUUID()}`;
  return `O-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}

function persistSnapshot(source='survey-map'){
  const project=getCurrentProject();
  if(!project?.projectId) return;
  saveProjectSnapshot({
    project,
    finishRecords:finishRecordStore.exportSnapshot(),
    materialRecords:materialRecordStore.exportSnapshot(),
    photoRecords:photoRecordStore.exportSnapshot(),
    drawingRecords:drawingRecordStore.exportSnapshot(),
    drawingObjects:drawingObjectStore.exportSnapshot(),
    source
  });
}

async function commitDrawing(record,source,{trackHistory=true}={}){
  const project=getCurrentProject();
  if(trackHistory)rememberSurveyEdit(project?.projectId,'drawing',
    drawingRecordStore.get(record.drawingId)||null,record,source);

  drawingRecordStore.set(record);
  persistSnapshot(source);
  if(project?.projectId && !project.isSample){
    await persistDrawingForProject(project,record,source);
  }
}

async function commitDrawingObject(record,source,{trackHistory=true}={}){
  const project=getCurrentProject();
  if(trackHistory)rememberSurveyEdit(project?.projectId,'drawingObject',
    drawingObjectStore.get(record.objectId)||null,record,source);

  drawingObjectStore.set(record);
  persistSnapshot(source);
  if(project?.projectId && !project.isSample){
    await persistDrawingObjectForProject(project,record,source);
  }
}

async function createRoomLabelAt(clientX,clientY){
  const drawing=selectedDrawing(),room=selectedRoom();
  const sheet=root()?.querySelector('.survey-map-sheet');
  if(!drawing||!room||!sheet)return;
  const point=clientToPagePoint(clientX,clientY,sheet.getBoundingClientRect(),drawing);
  const rect=clampObjectRect({x:point.x-1600,y:point.y-480,width:3200,height:960},drawing);
  const now=Date.now(),objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const record=createDrawingObject({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:'roomLabel',
    layer:DRAWING_LAYERS.TEXT,
    order:objects.length?Math.max(...objects.map(o=>Number(o.order)||0))+1:1,
    ...rect,rotation:0,visible:true,locked:false,deleted:false,
    areaCode:room.areaCode,roomPosition:room.roomPosition,
    roomNoSnapshot:room.roomNo,roomNameSnapshot:room.roomName,
    text:roomLabel(room),fontSize:14,textColor:'#334155',fontWeight:'700',
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'drawingId','type','layer','order','x','y','width','height','rotation','visible','locked','deleted',
      'areaCode','roomPosition','roomNoSnapshot','roomNameSnapshot','text','fontSize','textColor','fontWeight'
    ],now)
  });
  selectOnly(record.objectId);
  if(continuousTool!=='room')activeTool='select';
  await commitDrawingObject(record,'survey-map-room-label-create');
  renderSurveyMap();
}
async function createShapeAt(kind,clientX,clientY){
  const drawing=selectedDrawing();
  const sheet=root()?.querySelector('.survey-map-sheet');
  if(!drawing || !sheet) return;
  const point=clientToPagePoint(clientX,clientY,sheet.getBoundingClientRect(),drawing);
  const width=3600;
  const height=2400;
  const rect=clampObjectRect({
    x:point.x-width/2,
    y:point.y-height/2,
    width,
    height
  },drawing);
  const now=Date.now();
  const objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const record=createDrawingObject({
    objectId:newObjectId(),
    drawingId:drawing.drawingId,
    type:'shape',
    layer:DRAWING_LAYERS.SHAPE,
    order:objects.length?Math.max(...objects.map((item)=>Number(item.order)||0))+1:1,
    ...rect,
    rotation:0,
    visible:true,
    locked:false,
    deleted:false,
    shapeType:kind,
    fillEnabled:false,
    fillColor:'#ffffff',
    fillOpacity:0,
    lineEnabled:true,
    strokeColor:'#334155',
    strokeWidth:80,
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'drawingId','type','x','y','width','height','rotation','layer','order','visible','locked','deleted',
      'shapeType','fillEnabled','fillColor','fillOpacity','lineEnabled','strokeColor','strokeWidth'
    ],now)
  });
  selectOnly(record.objectId);
  if(continuousTool!==kind) activeTool='select';
  await commitDrawingObject(record,'survey-map-object-create');
  renderSurveyMap();
}

function createLineDraftPreview(sheet,drawing,point){
  const size=pageSize(drawing);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('survey-map-line-draft');
  svg.setAttribute('viewBox',`0 0 ${size.width} ${size.height}`);
  svg.setAttribute('preserveAspectRatio','none');
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1',String(point.x));
  line.setAttribute('y1',String(point.y));
  line.setAttribute('x2',String(point.x));
  line.setAttribute('y2',String(point.y));
  svg.appendChild(line);
  sheet.querySelector('.survey-map-object-layer')?.appendChild(svg);
  return svg;
}

function updateLineDraftPreview(svg,point){
  const line=svg?.querySelector('line');
  if(!line) return;
  line.setAttribute('x2',String(point.x));
  line.setAttribute('y2',String(point.y));
}

function updateLineObjectElement(objectEl,record,drawing){
  const size=pageSize(drawing);
  const startX=Number(record.startX)||0;
  const startY=Number(record.startY)||0;
  const endX=Number(record.endX)||0;
  const endY=Number(record.endY)||0;
  objectEl.querySelectorAll('.survey-map-line-svg line').forEach((line)=>{
    line.setAttribute('x1',String(startX));
    line.setAttribute('y1',String(startY));
    line.setAttribute('x2',String(endX));
    line.setAttribute('y2',String(endY));
  });
  const startHandle=objectEl.querySelector('[data-survey-handle="line-start"]');
  const endHandle=objectEl.querySelector('[data-survey-handle="line-end"]');
  if(startHandle){
    startHandle.style.left=`${(startX/size.width)*100}%`;
    startHandle.style.top=`${(startY/size.height)*100}%`;
  }
  if(endHandle){
    endHandle.style.left=`${(endX/size.width)*100}%`;
    endHandle.style.top=`${(endY/size.height)*100}%`;
  }
}

function updatePolylinePreview(svg,points){
  const line=svg?.querySelector('line');
  if(line)line.remove();
  let poly=svg?.querySelector('polyline');
  if(!poly){
    poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
    svg?.appendChild(poly);
  }
  poly.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));
}
function previewCorrectedStroke(svg,points){
  updatePolylinePreview(svg,points);
}

async function createCorrectedStroke(drawing,rawPoints,freehand=false,polygon=false){
  if(traceLength(rawPoints)<200) return null;
  const corrected=(freehand||polygon)?rawPoints:correctStroke(rawPoints,drawing);
  if(corrected.length<2) return null;
  const now=Date.now();
  const objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const closed=polygon || (corrected.length>3 && Math.hypot(corrected[0].x-corrected.at(-1).x,corrected[0].y-corrected.at(-1).y)<120);
  const record=createDrawingObject(strokeRecordWithPoints({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:'line',
    layer:DRAWING_LAYERS.SHAPE,
    order:objects.length?Math.max(...objects.map(o=>Number(o.order)||0))+1:1,
    rotation:0,closed,freehand,lineColor:'#334155',lineWidth:80,lineStyle:'solid',
    visible:true,locked:false,deleted:false,createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'drawingId','type','layer','order','x','y','width','height','rotation',
      'points','closed','freehand','lineColor','lineWidth','lineStyle','visible','locked','deleted'
    ],now)
  },corrected));
  selectOnly(record.objectId);
  if(continuousTool!==(polygon?'polygon':freehand?'hand':'correct')) activeTool='select';
  await commitDrawingObject(record,'survey-map-corrected-stroke-create');
  return record;
}

function addPolygonVertex(drawing,point,finish=false){
  if(!polygonDraft || polygonDraft.drawingId!==drawing.drawingId){
    polygonDraft={drawingId:drawing.drawingId,points:[]};
  }
  const points=polygonDraft.points;
  const last=points.at(-1);
  if(last && Math.hypot(last.x-point.x,last.y-point.y)<150 && !finish)return;
  if(finish && points.length>=3){
    void finishPolygon(drawing);
    return;
  }
  if(points.length>=3 && Math.hypot(points[0].x-point.x,points[0].y-point.y)<350){
    void finishPolygon(drawing);
    return;
  }
  points.push(point);
  renderSurveyMap();
}
async function finishPolygon(drawing=selectedDrawing()){
  const points=polygonDraft?.drawingId===drawing?.drawingId?polygonDraft.points:[];
  if(points.length<3)return;
  polygonDraft=null;
  await createCorrectedStroke(drawing,[...points,{...points[0]}],false,true);
  renderSurveyMap();
}
async function createElbowFromPoints(drawing,start,end){
  if(Math.hypot(end.x-start.x,end.y-start.y)<200)return null;
  const now=Date.now(),objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const base=elbowRecordWithPoints({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:'line',elbow:true,
    layer:DRAWING_LAYERS.SHAPE,order:objects.length?Math.max(...objects.map(o=>Number(o.order)||0))+1:1,
    visible:true,locked:false,deleted:false,lineColor:'#334155',lineWidth:80,lineStyle:'solid',
    createdAt:new Date(now).toISOString()
  },start.x,start.y,end.x,end.y,(start.x+end.x)/2);
  const record=createDrawingObject({...base,fieldEditedAt:touchFieldEditedAt({},[
    'drawingId','type','elbow','points','startX','startY','endX','endY','bendX',
    'x','y','width','height','layer','order','visible','locked','deleted','lineColor','lineWidth','lineStyle'
  ],now)});
  selectOnly(record.objectId);
  if(continuousTool!=='elbow')activeTool='select';
  await commitDrawingObject(record,'survey-map-elbow-create');
  return record;
}
async function createLineFromPoints(drawing,startPoint,endPoint){
  const dx=endPoint.x-startPoint.x;
  const dy=endPoint.y-startPoint.y;
  if(Math.hypot(dx,dy)<200) return null;

  const now=Date.now();
  const objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const base={
    objectId:newObjectId(),
    drawingId:drawing.drawingId,
    type:'line',
    layer:DRAWING_LAYERS.SHAPE,
    order:objects.length?Math.max(...objects.map((item)=>Number(item.order)||0))+1:1,
    visible:true,
    locked:false,
    deleted:false,
    lineColor:'#334155',
    lineWidth:80,
    lineStyle:'solid',
    createdAt:new Date(now).toISOString()
  };
  const withPoints=lineRecordWithPoints(base,startPoint.x,startPoint.y,endPoint.x,endPoint.y);
  const record=createDrawingObject({
    ...withPoints,
    fieldEditedAt:touchFieldEditedAt({},[
      'drawingId','type','x','y','width','height','rotation','layer','order','visible','locked','deleted',
      'startX','startY','endX','endY','lineColor','lineWidth','lineStyle'
    ],now)
  });
  selectOnly(record.objectId);
  if(continuousTool!=='line') activeTool='select';
  await commitDrawingObject(record,'survey-map-line-create');
  return record;
}

async function deleteSelectedObject(){
  const now=Date.now();
  const records=Array.from(selectedObjectIds)
    .map(id=>drawingObjectStore.get(id))
    .filter(item=>item && !item.deleted && item.drawingId===selectedDrawingId);
  if(!records.length)return;
  clearSelection();
  await Promise.all(records.map(record=>commitDrawingObject(createDrawingObject({
    ...record,deleted:true,
    fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,'deleted',now)
  }),'survey-map-object-delete')));
  renderSurveyMap();
}

async function applyHistory(redo=false){
  const project=getCurrentProject();
  if(!project?.projectId)return;
  const entry=redo?takeRedo(project.projectId):takeUndo(project.projectId);
  if(!entry)return;
  const changes=redo?entry.changes:[...entry.changes].reverse();
  for(const change of changes){
    const isObject=change.type==='drawingObject';
    const store=isObject?drawingObjectStore:drawingRecordStore;
    const raw=redo?change.after:change.before;
    const id=(raw||change.after||change.before)?.[isObject?'objectId':'drawingId'];
    const current=store.get(id);
    if(!current)continue;
    const target=raw||{...current,deleted:true};
    const fields=Object.keys(target).filter(key=>key!=='fieldEditedAt' &&
      key!=='objectId' && key!=='drawingId' && key!=='projectId' &&
      JSON.stringify(target[key])!==JSON.stringify(current[key]));
    if(!fields.length)continue;
    const updated={
      ...target,fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,fields,Date.now())
    };
    if(isObject)await commitDrawingObject(createDrawingObject(updated),'survey-map-history',{trackHistory:false});
    else await commitDrawing(createDrawingRecord(updated),'survey-map-history',{trackHistory:false});
  }
  clearSelection();
  renderSurveyMap();
}
function nextPageName(){
  const used=new Set(activeDrawings().map((item)=>String(item.name||'')));
  let index=1;
  while(used.has(`調査図${index}`)) index+=1;
  return `調査図${index}`;
}

async function createDrawing(){
  const project=getCurrentProject();
  if(!project?.projectId) return;
  const now=Date.now();
  const active=activeDrawings();
  const name=nextPageName();
  const record=createDrawingRecord({
    drawingId:newDrawingId(),
    projectId:project.projectId,
    name,
    order:active.length?Math.max(...active.map((item)=>Number(item.order)||0))+1:1,
    titleSettings:{text:'調査図'},
    nameSettings:{text:project.projectName||name},
    legendSettings:{visible:true,items:[]},
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'name','order','deleted','titleSettings','nameSettings','legendSettings'
    ],now)
  });
  selectedDrawingId=record.drawingId;
  pagesOpen=false;
  await commitDrawing(record,'survey-map-create');
  renderSurveyMap();
}

async function renameDrawing(value){
  const current=selectedDrawing();
  if(!current) return;
  const name=String(value||'').trim()||'調査図';
  if(name===current.name) return;
  const now=Date.now();
  await commitDrawing({
    ...current,
    name,
    fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,'name',now)
  },'survey-map-rename');
  renderSurveyMap();
}

async function renamePageDisplay(value){
  const current=selectedDrawing();
  if(!current) return;
  const text=String(value||'').trim();
  const now=Date.now();
  await commitDrawing({
    ...current,
    nameSettings:{...(current.nameSettings||{}),text},
    fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,'nameSettings',now)
  },'survey-map-name-display');
  renderSurveyMap();
}

async function deleteDrawing(){
  const current=selectedDrawing();
  if(!current || activeDrawings().length<=1) return;
  if(!window.confirm(`「${current.name}」を削除しますか？\n後から同期上は復活できる論理削除で保存します。`)) return;
  const now=Date.now();
  await commitDrawing({
    ...current,
    deleted:true,
    fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,'deleted',now)
  },'survey-map-delete');
  selectedDrawingId='';
  renderSurveyMap();
}

function setFocusMode(next){
  focusMode=Boolean(next);
  pagesOpen=false;
  toolPanelOpen=false;
  editPanelOpen=false;
  applyLayoutClasses();
  renderSurveyMap();
}

function applyLayoutClasses(){
  document.body.classList.toggle('survey-map-focus-mode',focusMode);
}

function svgIcon(name){
  const icons={
    select:'<path d="M5 3l13 9-6 1 3 6-3 1-3-6-4 4z"/>',
    range:'<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
    line:'<path d="M4 19L20 5"/>',
    correct:'<path d="M4 18L18 4"/><path d="M11 18h7v-7"/>',
    hand:'<path d="M8 20l-3-4 1-3c.5-.8 1.6-.8 2.3 0l1.1 1V5a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v5c0 3-2 5-5 5z"/>',
    elbow:'<path d="M5 5v10h14"/>',
    room:'<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 9h8M8 13h5"/>',
    material:'<path d="M4 7h10l6 5-6 5H4z"/><circle cx="8" cy="12" r="1"/>',
    sample:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    text:'<path d="M5 5h14M12 5v14M8 19h8"/>',
    eyedrop:'<path d="M15 4l5 5-9 9H6v-5z"/><path d="M13 6l5 5"/>',
    rect:'<rect x="4" y="5" width="16" height="14" rx="1"/>',
    circle:'<circle cx="12" cy="12" r="8"/>',
    triangle:'<path d="M5 19V5l14 14z"/>',
    lshape:'<path d="M5 4v15h14v-6h-8V4z"/>',
    tshape:'<path d="M4 5h16v6h-5v8H9v-8H4z"/>',
    cross:'<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
    concave:'<path d="M4 5h16v14H4v-5h7V9H4z"/>',
    polygon:'<path d="M8 4h8l5 7-4 9H7l-4-9z"/>',
    undo:'<path d="M9 7L4 12l5 5"/><path d="M5 12h8a6 6 0 016 6"/>',
    redo:'<path d="M15 7l5 5-5 5"/><path d="M19 12h-8a6 6 0 00-6 6"/>',
    grid:'<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16"/>',
    snap:'<path d="M6 4v10a6 6 0 0012 0V4M6 8h4M14 8h4"/>',
    fullscreen:'<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    exitfullscreen:'<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>',
    pages:'<rect x="6" y="4" width="12" height="15" rx="1"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    tools:'<path d="M14 6l4-4 4 4-4 4M3 21l8-8"/><circle cx="8" cy="8" r="4"/>',
    panel:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M14 4v16"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    close:'<path d="M5 5l14 14M19 5L5 19"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.select}</svg>`;
}

function iconButton({icon,label,attr='',active=false,disabled=false,className=''}) {
  return `<button type="button" class="survey-map-icon-btn ${active?'active':''} ${className}" ${attr} ${disabled?'disabled':''} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${svgIcon(icon)}</button>`;
}

function pageListHtml(){
  const pages=activeDrawings();
  if(!pages.length){
    return '<div class="survey-map-hint">調査図はまだありません。新規作成してください。</div>';
  }
  return pages.map((page)=>`
    <div class="survey-map-page-row">
      <button type="button" class="survey-map-page-btn ${page.drawingId===selectedDrawingId?'active':''}" data-survey-page="${escapeHtml(page.drawingId)}">${escapeHtml(page.name)}</button>
      <button type="button" class="btn small" data-survey-page-delete="${escapeHtml(page.drawingId)}" aria-label="削除" ${pages.length<=1?'disabled':''}>×</button>
    </div>
  `).join('');
}

function toolIconCell(icon,label,toolName,disabled=true){
  return `<div class="survey-map-tool-cell">${iconButton({
    icon,
    label,
    disabled,
    active:activeTool===toolName,
    className:continuousTool===toolName?'survey-map-tool-continuous':'',
    attr:disabled?'':`data-survey-draw-tool="${escapeHtml(toolName)}" aria-pressed="${activeTool===toolName}"`
  })}</div>`;
}

function roomPickerHtml(){
  const rooms=availableRooms();
  selectedRoom();
  return `<div class="survey-map-room-picker">
    <label for="survey-map-room-choice">部屋ツールの対象</label>
    <select id="survey-map-room-choice" data-survey-room-choice ${rooms.length?'':'disabled'}>
      ${rooms.map(room=>`<option value="${escapeHtml(room.key)}" ${room.key===selectedRoomKey?'selected':''}>${escapeHtml(roomLabel(room))}</option>`).join('')}
    </select>
    ${rooms.length?'':'<span class="survey-map-hint">仕上表に部屋がありません。</span>'}
  </div>`;
}
function toolsHtml(){
  const primary=[
    ['select','選択'],
    ['range','範囲選択'],
    ['line','直線'],
    ['correct','手描き補正'],
    ['hand','手描き'],
    ['elbow','カギ線'],
    ['room','部屋'],
    ['material','建材'],
    ['sample','採取位置'],
    ['text','テキスト'],
    ['eyedrop','色コピー']
  ];
  const shapes=[
    ['rect','四角'],
    ['circle','丸'],
    ['triangle','直角三角'],
    ['lshape','L字'],
    ['tshape','T字'],
    ['cross','十字'],
    ['concave','凹字'],
    ['polygon','多角形']
  ];
  return `
    <div class="survey-map-tool-section">
      <div class="survey-map-tool-grid">${primary.map(([icon,label])=>
        toolIconCell(icon,label,icon,!['select','line','correct','elbow','room','hand'].includes(icon))
      ).join('')}</div>
      <div class="survey-map-divider"></div>
      <div class="survey-map-tool-grid">${shapes.map(([icon,label])=>toolIconCell(icon,label,icon,!isShapeTool(icon))).join('')}</div>
      ${roomPickerHtml()}
      ${polygonDraft?.points?.length?`<div class="survey-map-polygon-actions"><span>多角形：${polygonDraft.points.length}点</span><button type="button" class="btn small" data-survey-polygon-finish ${polygonDraft.points.length<3?'disabled':''}>確定</button><button type="button" class="btn small" data-survey-polygon-cancel>取消</button></div>`:''}
    </div>
  `;
}

function sheetHtml(drawing){
  if(!drawing){
    return '<div class="survey-map-empty">図面ボタンから<br>新規調査図を作成してください</div>';
  }
  const title=escapeHtml(drawing.titleSettings?.text||'調査図');
  const name=escapeHtml(drawing.nameSettings?.text||drawing.name||'');
  const objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const draft=polygonDraft?.drawingId===drawing.drawingId?polygonDraft.points:[];
  const size=pageSize(drawing);
  const draftHtml=draft.length?`<svg class="survey-map-line-draft survey-map-polygon-draft"
    viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none">
    <polyline points="${draft.map(p=>`${p.x},${p.y}`).join(' ')}"></polyline>
  </svg>`:'';
  return `
    <div class="survey-map-fixed-title">${title}</div>
    <div class="survey-map-object-layer">${drawingObjectsHtml(objects,drawing,selectedObjectIds,strokeEditMode)}${draftHtml}</div>
    ${objects.length?'':'<div class="survey-map-empty">ツール → 四角 を選んで<br>A4上をタップすると配置できます</div>'}
    <div class="survey-map-fixed-name">${name}</div>
    <div class="survey-map-fixed-legend"><b>凡例</b><br>採取位置<br>含有 / 含有なし<br>みなし / 対象外</div>
  `;
}

function editorHtml(drawing){
  if(!drawing){
    return '<div class="survey-map-hint">ページを選択すると編集項目が表示されます。</div>';
  }
  const object=selectedObject();
  if(selectedObjectIds.size>1){
    return `<div class="survey-map-hint"><b>${selectedObjectIds.size}個のオブジェクトを選択中</b><br>ドラッグするとまとめて移動できます。</div>
      <button type="button" class="btn danger" data-survey-object-delete style="width:100%">選択オブジェクトをまとめて削除</button>`;
  }
  if(object){
    const modeControls=object.type==='line' && Array.isArray(object.points) && !object.elbow
      ? `<div class="survey-map-editor-row"><label>編集モード</label>
        <div class="survey-map-edit-mode-row">
          <button type="button" class="btn small ${strokeEditMode==='shape'?'active':''}"
            data-survey-stroke-edit-mode="shape">図形編集</button>
          <button type="button" class="btn small ${strokeEditMode==='points'?'active':''}"
            data-survey-stroke-edit-mode="points">頂点編集</button>
        </div></div>`:'';
    const styleControls=object.type==='line'||object.type==='shape'
      ? `<div class="survey-map-divider"></div>
        <div class="survey-map-editor-row"><label>線の色</label>
          <input type="color" data-survey-style-field="color"
            value="${escapeHtml(object.type==='line'?object.lineColor||'#334155':object.strokeColor||'#334155')}"></div>
        <div class="survey-map-editor-row"><label>線の太さ</label>
          <input type="number" min="20" max="500" step="20" data-survey-style-field="width"
            value="${Number(object.type==='line'?object.lineWidth||80:object.strokeWidth||80)}"></div>
        ${object.type==='shape'?`
          <label class="survey-map-fill-toggle"><input type="checkbox" data-survey-style-field="fill"
            ${object.fillEnabled?'checked':''}> 塗りつぶし</label>
          <div class="survey-map-editor-row"><label>塗りの色</label>
            <input type="color" data-survey-style-field="fillColor"
              value="${escapeHtml(object.fillColor||'#93c5fd')}"></div>`:''}
      `:'';
    const details=object.type==='line' && Array.isArray(object.points)
      ? `頂点：${object.points.length}　X：${Math.round(Number(object.x)||0)}　Y：${Math.round(Number(object.y)||0)}<br>
        W：${Math.round(Number(object.width)||0)}　H：${Math.round(Number(object.height)||0)}`
      : object.type==='line'
      ? `始点：${Math.round(Number(object.startX)||0)}, ${Math.round(Number(object.startY)||0)}<br>
        終点：${Math.round(Number(object.endX)||0)}, ${Math.round(Number(object.endY)||0)}`
      : `X：${Math.round(Number(object.x)||0)}　Y：${Math.round(Number(object.y)||0)}<br>
        W：${Math.round(Number(object.width)||0)}　H：${Math.round(Number(object.height)||0)}<br>
        回転：${Math.round(Number(object.rotation)||0)}°`;
    return `
      <div class="survey-map-hint">
        <b>選択オブジェクト</b><br>
        種類：${escapeHtml(object.type)} / ${escapeHtml(object.shapeType||'')}<br>
        ${details}
      </div>
      ${modeControls}
      ${styleControls}
      <div class="survey-map-divider"></div>
      <button type="button" class="btn danger" data-survey-object-delete style="width:100%">選択オブジェクトを削除</button>
    `;
  }
  return `
    <div class="survey-map-editor-row">
      <label>一覧名称</label>
      <input data-survey-name value="${escapeHtml(drawing.name)}">
    </div>
    <div class="survey-map-editor-row">
      <label>紙面左下の名称</label>
      <input data-survey-display-name value="${escapeHtml(drawing.nameSettings?.text||'')}">
    </div>
    <div class="survey-map-hint">図形を選択すると、位置・サイズ・回転の情報を表示します。</div>
    <div class="survey-map-divider"></div>
    <button type="button" class="btn danger" data-survey-delete-current style="width:100%" ${activeDrawings().length<=1?'disabled title="最後の1枚は削除できません"':''}>この調査図を削除</button>
  `;
}

function pagesPopoverHtml(){
  return `
    <div class="survey-map-pages-popover" ${pagesOpen?'':'hidden'}>
      <div class="survey-map-popover-head">
        <span>図面一覧</span>
        ${iconButton({icon:'plus',label:'新規調査図',attr:'data-survey-new',className:'primary'})}
      </div>
      <div class="survey-map-page-list">${pageListHtml()}</div>
    </div>
  `;
}

export function renderSurveyMap(){
  const mount=root();
  if(!mount) return;
  applyLayoutClasses();
  const drawing=selectedDrawing();
  const history=historyStatus(getCurrentProject()?.projectId);

  mount.innerHTML=`
    <div class="survey-map-root">
      <main class="survey-map-center">
        <div class="survey-map-topbar">
          <button type="button" class="btn small survey-map-text-btn ${focusMode?'active':''}" data-survey-focus-toggle>${focusMode?'全画面終了':'全画面'}</button>
          <button type="button" class="btn small survey-map-text-btn" data-survey-undo ${history.undo?'':'disabled'}>戻る</button>
          <button type="button" class="btn small survey-map-text-btn" data-survey-redo ${history.redo?'':'disabled'}>進む</button>
          <button type="button" class="btn small survey-map-text-btn ${pagesOpen?'active':''}" data-survey-pages-toggle>図面</button>
          <button type="button" class="btn small survey-map-text-btn ${gridVisible?'active':''}" data-survey-grid>グリッド</button>
          <button type="button" class="btn small survey-map-text-btn ${ratioLocked?'active':''}" data-survey-ratio-toggle>比率固定</button>
          <button type="button" class="btn small survey-map-text-btn" data-survey-zoom-out>−</button>
          <button type="button" class="btn small survey-map-text-btn" data-survey-zoom-reset>${Math.round(zoomLevel*100)}%</button>
          <button type="button" class="btn small survey-map-text-btn" data-survey-zoom-in>＋</button>
          <button type="button" class="btn small survey-map-text-btn" data-survey-zoom-fit>Fit</button>
          <button type="button" class="btn small survey-map-text-btn ${toolPanelOpen?'active':''}" data-survey-tool-toggle>ツール</button>
          <button type="button" class="btn small survey-map-text-btn ${editPanelOpen?'active':''}" data-survey-edit-toggle>編集</button>
          <span class="spacer"></span>
          <span class="survey-map-status">${drawing?escapeHtml(drawing.name):'ページ未選択'}</span>
        </div>

        <div class="survey-map-stage">
          ${pagesPopoverHtml()}
          <div class="survey-map-sheet ${gridVisible?'grid-on':''} ${activeTool!=='select'?'drawing-mode':''}" style="width:min(${Math.round(zoomLevel*100)}%,${Math.round(1180*zoomLevel)}px)">${sheetHtml(drawing)}</div>
        </div>
      </main>
      <button type="button" class="survey-map-shift-button ${shiftActive()?'active':''}"
        data-survey-shift aria-label="押している間Shift補助操作">Shift</button>

      <aside class="survey-map-overlay-panel survey-map-tools-panel ${toolPanelOpen?'open':''}" aria-hidden="${toolPanelOpen?'false':'true'}">
        <div class="survey-map-overlay-head">
          <b>ツール</b>
          <button type="button" class="btn small" data-survey-tool-close>閉じる</button>
        </div>
        <div class="survey-map-overlay-body">
          <div class="survey-map-overlay-page-actions">
            ${iconButton({icon:'pages',label:'図面一覧',attr:'data-survey-pages-toggle'})}
            ${iconButton({icon:'plus',label:'新規調査図',attr:'data-survey-new'})}
          </div>
          <div class="survey-map-divider"></div>
          ${toolsHtml()}
        </div>
      </aside>

      <aside class="survey-map-overlay-panel survey-map-edit-panel ${editPanelOpen?'open':''}" aria-hidden="${editPanelOpen?'false':'true'}">
        <div class="survey-map-overlay-head">
          <b>編集</b>
          <button type="button" class="btn small" data-survey-edit-close>閉じる</button>
        </div>
        <div class="survey-map-overlay-body">${editorHtml(drawing)}</div>
      </aside>
    </div>
  `;
}

function paintObjectDraft(objectEl,draft,drawing){
if(draft.type==='line' && Array.isArray(draft.points) && draft.points.length>1){
  const polyline=objectEl.querySelector('.survey-map-stroke-main');
  if(polyline)polyline.setAttribute('points',draft.points.map(p=>`${p.x},${p.y}`).join(' '));
  const hit=objectEl.querySelector('.survey-map-stroke-hit');
  if(hit)hit.setAttribute('points',draft.points.map(p=>`${p.x},${p.y}`).join(' '));
  if(draft.elbow){
    const size=pageSize(drawing);
    for(const [handleName,point] of [
      ['line-start',draft.points[0]],['line-end',draft.points[3]],
      ['elbow-bend',{x:draft.bendX,y:(draft.startY+draft.endY)/2}]
    ]){
      const button=objectEl.querySelector(`[data-survey-handle="${handleName}"]`);
      if(button){button.style.left=`${point.x/size.width*100}%`;button.style.top=`${point.y/size.height*100}%`;}
    }
  }else{
    const size=pageSize(drawing);
    const count=draft.closed?draft.points.length-1:draft.points.length;
    for(let i=0;i<count;i++){
      const handle=objectEl.querySelector(`[data-survey-point-index="${i}"]`);
      if(handle){
        handle.style.left=`${draft.points[i].x/size.width*100}%`;
        handle.style.top=`${draft.points[i].y/size.height*100}%`;
      }
    }
    const corners=[
      ['nw',draft.x,draft.y],
      ['ne',draft.x+draft.width,draft.y],
      ['sw',draft.x,draft.y+draft.height],
      ['se',draft.x+draft.width,draft.y+draft.height]
    ];
    for(const [corner,x,y] of corners){
      const handle=objectEl.querySelector(`[data-survey-handle="stroke-resize-${corner}"]`);
      if(handle){handle.style.left=`${x/size.width*100}%`;handle.style.top=`${y/size.height*100}%`;}
    }
    const rotateHandle=objectEl.querySelector('[data-survey-handle="stroke-rotate"]');
    if(rotateHandle){
      rotateHandle.style.left=`${(draft.x+draft.width/2)/size.width*100}%`;
      rotateHandle.style.top=`${(draft.y-500)/size.height*100}%`;
    }
  }
}else if(draft.type==='line') updateLineObjectElement(objectEl,draft,drawing);
else objectEl.setAttribute('style',objectPercentStyle(draft,drawing));
}
function bindEvents(){
  const mount=root();
  if(!mount) return;

  mount.addEventListener('click',(event)=>{
    if(event.target.closest('[data-survey-undo]')){void applyHistory(false);return;}
    if(event.target.closest('[data-survey-redo]')){void applyHistory(true);return;}
    if(event.target.closest('[data-survey-new]')){
      void createDrawing();
      return;
    }

    const pageButton=event.target.closest('[data-survey-page]');
    if(pageButton){
      selectedDrawingId=String(pageButton.dataset.surveyPage||'');
      clearSelection();
      selectedObjectId='';
      pagesOpen=false;
      renderSurveyMap();
      return;
    }

    const pageDelete=event.target.closest('[data-survey-page-delete]');
    if(pageDelete){
      selectedDrawingId=String(pageDelete.dataset.surveyPageDelete||'');
      void deleteDrawing();
      return;
    }

    if(event.target.closest('[data-survey-delete-current]')){
      void deleteDrawing();
      return;
    }

    if(event.target.closest('[data-survey-focus-toggle]')){
      setFocusMode(!focusMode);
      return;
    }

    if(event.target.closest('[data-survey-pages-toggle]')){
      pagesOpen=!pagesOpen;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-tool-toggle]')){
      toolPanelOpen=!toolPanelOpen;
      editPanelOpen=false;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-edit-toggle]')){
      editPanelOpen=!editPanelOpen;
      toolPanelOpen=false;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-tool-close]')){
      toolPanelOpen=false;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-edit-close]')){
      editPanelOpen=false;
      renderSurveyMap();
      return;
    }

    const drawTool=event.target.closest('[data-survey-draw-tool]');
    if(drawTool){
      const requested=String(drawTool.dataset.surveyDrawTool||'select');
      const hadPolygonDraft=requested!=='polygon'&&polygonDraft!==null;
      if(hadPolygonDraft)polygonDraft=null;
      const now=Date.now();
      const repeatedTap=(event.detail>=2 || (
        lastToolTap?.tool===requested && now-lastToolTap.at<380
      ));
      lastToolTap={tool:requested,at:now};
      if(repeatedTap && (['line','correct','elbow','room','hand'].includes(requested) || isShapeTool(requested))){
        continuousTool=continuousTool===requested?'':requested;
      }else if(requested!==continuousTool){
        continuousTool='';
      }else{
        continuousTool='';
      }
      activeTool=requested;
      mount.querySelector('.survey-map-sheet')?.classList.toggle('drawing-mode',activeTool!=='select');
      mount.querySelectorAll('[data-survey-draw-tool]').forEach((button)=>{
        const tool=button.dataset.surveyDrawTool;
        button.classList.toggle('active',tool===activeTool);
        button.classList.toggle('survey-map-tool-continuous',tool===continuousTool);
        button.setAttribute('aria-pressed',String(tool===activeTool));
      });
      if(hadPolygonDraft)renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-polygon-finish]')){
      void finishPolygon();
      return;
    }
    if(event.target.closest('[data-survey-polygon-cancel]')){
      polygonDraft=null;
      renderSurveyMap();
      return;
    }
    const editModeButton=event.target.closest('[data-survey-stroke-edit-mode]');
    if(editModeButton){
      strokeEditMode=editModeButton.dataset.surveyStrokeEditMode==='points'?'points':'shape';
      renderSurveyMap();
      return;
    }
    if(event.target.closest('[data-survey-ratio-toggle]')){
      ratioLocked=!ratioLocked;
      renderSurveyMap();
      return;
    }
    if(event.target.closest('[data-survey-object-delete]')){
      void deleteSelectedObject();
      return;
    }

    if(event.target.closest('[data-survey-zoom-out]')){
      zoomLevel=Math.max(.5,Math.round((zoomLevel-.25)*100)/100);
      renderSurveyMap();
      return;
    }
    if(event.target.closest('[data-survey-zoom-in]')){
      zoomLevel=Math.min(3,Math.round((zoomLevel+.25)*100)/100);
      renderSurveyMap();
      return;
    }
    if(event.target.closest('[data-survey-zoom-reset]') || event.target.closest('[data-survey-zoom-fit]')){
      zoomLevel=1;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-grid]')){
      gridVisible=!gridVisible;
      renderSurveyMap();
    }
  });

  mount.addEventListener('pointerdown',(event)=>{
    const shiftButton=event.target.closest('[data-survey-shift]');
    if(shiftButton){
      shiftPointerId=event.pointerId;
      shiftButton.setPointerCapture?.(event.pointerId);
      syncShiftButton();
      event.preventDefault();
      return;
    }
    const drawing=selectedDrawing();
    const sheet=event.target.closest('.survey-map-sheet');
    if(!drawing || !sheet) return;

    const objectEl=event.target.closest('[data-survey-object-id]');
    if(objectEl && activeTool==='select'){
      const objectId=String(objectEl.dataset.surveyObjectId||'');
      const object=drawingObjectStore.get(objectId);
      if(!object || object.locked) return;
      const additive=shiftActive()||event.shiftKey;
      const handle=event.target.closest('[data-survey-handle]')?.dataset?.surveyHandle || '';
      if(additive && !handle){
        if(selectedObjectIds.has(objectId)){
          selectedObjectIds.delete(objectId);
          selectedObjectId=Array.from(selectedObjectIds).at(-1)||'';
        }else{
          selectedObjectIds.add(objectId);
          selectedObjectId=objectId;
        }
        objectEl.classList.toggle('selected',selectedObjectIds.has(objectId));
        event.preventDefault();
        return;
      }
      const groupMove=!handle && selectedObjectIds.size>1 && selectedObjectIds.has(objectId);
      if(!groupMove)selectOnly(objectId);
      const mode=groupMove?'group-move':object.elbow
        ? (handle==='line-start'?'elbow-start':handle==='line-end'?'elbow-end':handle==='elbow-bend'?'elbow-bend':'elbow-move')
        : object.type==='line' && Array.isArray(object.points) && object.points.length>1
        ? (handle.startsWith('stroke-resize-')?'stroke-resize':
          handle==='stroke-rotate'?'stroke-rotate':
          handle==='stroke-point'?'stroke-point':'stroke-move')
        : object.type==='line'
        ? (handle==='line-start'?'line-start':handle==='line-end'?'line-end':'line-move')
        : (handle.startsWith('resize-')?'resize-corner':
          handle==='resize'?'resize':handle==='rotate'?'rotate':'move');
      const sheetRect=sheet.getBoundingClientRect();
      const startPoint=clientToPagePoint(event.clientX,event.clientY,sheetRect,drawing);
      pointerInteraction={
        pointerId:event.pointerId,
        objectId,
        mode,
        corner:handle.startsWith('stroke-resize-')?handle.slice(14):handle.startsWith('resize-')?handle.slice(7):'',
        original:{...object},
        draft:{...object},
        groupOriginals:groupMove?Array.from(selectedObjectIds).map(id=>drawingObjectStore.get(id)).filter(Boolean):[],
        groupDrafts:[],
        startPoint,
        pointIndex:handle==='stroke-point'?Number(event.target.closest('[data-survey-point-index]')?.dataset.surveyPointIndex):-1,
        sheetRect
      };
      objectEl.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if(activeTool==='room' && !objectEl){
      if(!selectedRoom())return;
      void createRoomLabelAt(event.clientX,event.clientY);
      event.preventDefault();
      return;
    }
    if(activeTool==='polygon' && !objectEl){
      const point=clientToPagePoint(event.clientX,event.clientY,sheet.getBoundingClientRect(),drawing);
      addPolygonVertex(drawing,point,event.detail>=2);
      event.preventDefault();
      return;
    }
    if(isShapeTool(activeTool) && !objectEl){
      event.preventDefault();
      void createShapeAt(activeTool,event.clientX,event.clientY);
      return;
    }

    if((activeTool==='line' || activeTool==='correct' || activeTool==='elbow' || activeTool==='hand') && !objectEl){
      const sheetRect=sheet.getBoundingClientRect();
      const startPoint=clientToPagePoint(event.clientX,event.clientY,sheetRect,drawing);
      const previewEl=createLineDraftPreview(sheet,drawing,startPoint);
      pointerInteraction={
        pointerId:event.pointerId,
        objectId:'',
        mode:activeTool==='correct'?'create-corrected':activeTool==='hand'?'create-hand':activeTool==='elbow'?'create-elbow':'create-line',
        original:null,
        draft:{startX:startPoint.x,startY:startPoint.y,endX:startPoint.x,endY:startPoint.y},
        startPoint,
        rawPoints:[startPoint],
        sheetRect,
        previewEl
      };
      sheet.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if(activeTool==='select' && !objectEl && selectedObjectIds.size){
      clearSelection();
      if(shiftActive()){
        mount.querySelectorAll('.survey-map-object.selected').forEach(el=>el.classList.remove('selected'));
      }else renderSurveyMap();
    }
  });

  mount.addEventListener('pointermove',(event)=>{
    const interaction=pointerInteraction;
    if(!interaction || interaction.pointerId!==event.pointerId) return;
    const drawing=selectedDrawing();
    if(!drawing) return;
    const currentPoint=clientToPagePoint(event.clientX,event.clientY,interaction.sheetRect,drawing);

    if(interaction.mode==='create-elbow'){
      updatePolylinePreview(interaction.previewEl,elbowPath(
        interaction.startPoint.x,interaction.startPoint.y,currentPoint.x,currentPoint.y));
      event.preventDefault();
      return;
    }
    if(interaction.mode==='create-corrected' || interaction.mode==='create-hand'){
      const previous=interaction.rawPoints.at(-1);
      if(Math.hypot(currentPoint.x-previous.x,currentPoint.y-previous.y)>=45){
        interaction.rawPoints.push(currentPoint);
        previewCorrectedStroke(interaction.previewEl,interaction.rawPoints);
      }
      event.preventDefault();
      return;
    }

    if(interaction.mode==='create-line'){
      const point=(shiftActive()||event.shiftKey)?snapLinePoint(interaction.startPoint,currentPoint):currentPoint;
      interaction.draft={...interaction.draft,endX:point.x,endY:point.y};
      updateLineDraftPreview(interaction.previewEl,point);
      event.preventDefault();
      return;
    }

    if(interaction.mode==='group-move'){
      const originals=interaction.groupOriginals;
      const size=pageSize(drawing);
      const minX=Math.min(...originals.map(o=>Number(o.x)||0));
      const minY=Math.min(...originals.map(o=>Number(o.y)||0));
      const maxX=Math.max(...originals.map(o=>(Number(o.x)||0)+(Number(o.width)||0)));
      const maxY=Math.max(...originals.map(o=>(Number(o.y)||0)+(Number(o.height)||0)));
      const dx=clamp(currentPoint.x-interaction.startPoint.x,-minX,size.width-maxX);
      const dy=clamp(currentPoint.y-interaction.startPoint.y,-minY,size.height-maxY);
      interaction.groupDrafts=originals.map(o=>translateObject(o,dx,dy));
      for(const draft of interaction.groupDrafts){
        const element=mount.querySelector(`[data-survey-object-id="${CSS.escape(draft.objectId)}"]`);
        if(element)paintObjectDraft(element,draft,drawing);
      }
      event.preventDefault();
      return;
    }
    const objectEl=mount.querySelector(`[data-survey-object-id="${CSS.escape(interaction.objectId)}"]`);
    if(!objectEl) return;
    const dx=currentPoint.x-interaction.startPoint.x;
    const dy=currentPoint.y-interaction.startPoint.y;
    let draft={...interaction.original};

    if(interaction.mode.startsWith('elbow-')){
      const original=interaction.original;
      const startX=Number(original.startX)||0,startY=Number(original.startY)||0;
      const endX=Number(original.endX)||0,endY=Number(original.endY)||0;
      const bendX=Number(original.bendX??(startX+endX)/2);
      if(interaction.mode==='elbow-start'){
        draft=elbowRecordWithPoints(original,currentPoint.x,currentPoint.y,endX,endY,bendX);
      }else if(interaction.mode==='elbow-end'){
        draft=elbowRecordWithPoints(original,startX,startY,currentPoint.x,currentPoint.y,bendX);
      }else if(interaction.mode==='elbow-bend'){
        draft=elbowRecordWithPoints(original,startX,startY,endX,endY,currentPoint.x);
      }else{
        const size=pageSize(drawing);
        const points=original.points;
        const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
        const moveX=clamp(dx,-Math.min(...xs),size.width-Math.max(...xs));
        const moveY=clamp(dy,-Math.min(...ys),size.height-Math.max(...ys));
        draft=elbowRecordWithPoints(original,startX+moveX,startY+moveY,endX+moveX,endY+moveY,bendX+moveX);
      }
    }else if(interaction.mode==='stroke-resize'){
      const original=interaction.original,rect=resizeRectFromCorner(original,interaction.corner,currentPoint,{
        centerFixed:shiftActive()||event.shiftKey,ratioFixed:ratioLocked
      });
      const oldW=Math.max(1,Number(original.width)||0),oldH=Math.max(1,Number(original.height)||0);
      draft=strokeRecordWithPoints(original,original.points.map(p=>({
        x:rect.x+(p.x-original.x)*rect.width/oldW,
        y:rect.y+(p.y-original.y)*rect.height/oldH
      })));
    }else if(interaction.mode==='stroke-rotate'){
      const original=interaction.original;
      const center={x:original.x+original.width/2,y:original.y+original.height/2};
      const a0=Math.atan2(interaction.startPoint.y-center.y,interaction.startPoint.x-center.x);
      const a1=Math.atan2(currentPoint.y-center.y,currentPoint.x-center.x);
      let rotation=a1-a0;
      if(shiftActive()||event.shiftKey)rotation=Math.round(rotation/(Math.PI/12))*(Math.PI/12);
      const cos=Math.cos(rotation),sin=Math.sin(rotation);
      draft=strokeRecordWithPoints(original,original.points.map(p=>{
        const x=p.x-center.x,y=p.y-center.y;
        return {x:center.x+x*cos-y*sin,y:center.y+x*sin+y*cos};
      }));
    }else if(interaction.mode==='stroke-point'){
      const points=interaction.original.points.map(p=>({...p}));
      const index=interaction.pointIndex;
      if(index>=0 && index<points.length){
        points[index]={x:currentPoint.x,y:currentPoint.y};
        if(interaction.original.closed && index===0)points[points.length-1]={...points[0]};
        draft=strokeRecordWithPoints(interaction.original,points);
      }
    }else if(interaction.mode==='stroke-move'){
      const size=pageSize(drawing);
      const pts=interaction.original.points;
      const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
      const moveX=clamp(dx,-Math.min(...xs),size.width-Math.max(...xs));
      const moveY=clamp(dy,-Math.min(...ys),size.height-Math.max(...ys));
      draft=strokeRecordWithPoints(interaction.original,pts.map(p=>({x:p.x+moveX,y:p.y+moveY})));
    }else if(interaction.mode==='line-move'){
      const size=pageSize(drawing);
      const minX=Math.min(Number(interaction.original.startX)||0,Number(interaction.original.endX)||0);
      const maxX=Math.max(Number(interaction.original.startX)||0,Number(interaction.original.endX)||0);
      const minY=Math.min(Number(interaction.original.startY)||0,Number(interaction.original.endY)||0);
      const maxY=Math.max(Number(interaction.original.startY)||0,Number(interaction.original.endY)||0);
      const moveX=clamp(dx,-minX,size.width-maxX);
      const moveY=clamp(dy,-minY,size.height-maxY);
      draft=lineRecordWithPoints(
        interaction.original,
        (Number(interaction.original.startX)||0)+moveX,
        (Number(interaction.original.startY)||0)+moveY,
        (Number(interaction.original.endX)||0)+moveX,
        (Number(interaction.original.endY)||0)+moveY
      );
    }else if(interaction.mode==='line-start'){
      draft=lineRecordWithPoints(
        interaction.original,currentPoint.x,currentPoint.y,
        Number(interaction.original.endX)||0,Number(interaction.original.endY)||0
      );
    }else if(interaction.mode==='line-end'){
      draft=lineRecordWithPoints(
        interaction.original,
        Number(interaction.original.startX)||0,Number(interaction.original.startY)||0,
        currentPoint.x,currentPoint.y
      );
    }else if(interaction.mode==='move'){
      const rect=clampObjectRect({
        x:Number(interaction.original.x||0)+dx,
        y:Number(interaction.original.y||0)+dy,
        width:Number(interaction.original.width||0),
        height:Number(interaction.original.height||0)
      },drawing);
      draft={...draft,...rect};
    }else if(interaction.mode==='resize-corner'){
      draft=resizeRectFromCorner(interaction.original,interaction.corner,currentPoint,{
        centerFixed:shiftActive()||event.shiftKey,ratioFixed:ratioLocked
      });
    }else if(interaction.mode==='resize'){
      const rect=clampObjectRect({
        x:Number(interaction.original.x||0),
        y:Number(interaction.original.y||0),
        width:Number(interaction.original.width||0)+dx,
        height:Number(interaction.original.height||0)+dy
      },drawing);
      draft={...draft,...rect};
    }else if(interaction.mode==='rotate'){
      const angle=rotationFromPointer(interaction.original,event,interaction.sheetRect,drawing);
      draft.rotation=(shiftActive()||event.shiftKey)?Math.round(angle/15)*15:angle;
    }

    interaction.draft=draft;
    paintObjectDraft(objectEl,draft,drawing);
    event.preventDefault();
  });

  const finishPointerInteraction=(event)=>{
    const interaction=pointerInteraction;
    if(!interaction || interaction.pointerId!==event.pointerId) return;
    pointerInteraction=null;

    if(interaction.mode==='group-move'){
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const now=Date.now();
      const updates=interaction.groupDrafts.map(draft=>{
        const current=drawingObjectStore.get(draft.objectId);
        return createDrawingObject({...current,...draft,
          fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,
            draft.type==='line'?['points','x','y','width','height','startX','startY','endX','endY','bendX']
              :['x','y'],now)});
      });
      void Promise.all(updates.map(record=>commitDrawingObject(record,'survey-map-group-move')))
        .then(()=>renderSurveyMap());
      return;
    }
    if(interaction.mode==='create-elbow'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const drawing=selectedDrawing();
      if(!drawing)return;
      const end=clientToPagePoint(event.clientX,event.clientY,interaction.sheetRect,drawing);
      void createElbowFromPoints(drawing,interaction.startPoint,end).then(()=>renderSurveyMap());
      return;
    }
    if(interaction.mode==='create-corrected' || interaction.mode==='create-hand'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const drawing=selectedDrawing();
      if(!drawing)return;
      const end=clientToPagePoint(event.clientX,event.clientY,interaction.sheetRect,drawing);
      const last=interaction.rawPoints.at(-1);
      if(Math.hypot(end.x-last.x,end.y-last.y)>20)interaction.rawPoints.push(end);
      void createCorrectedStroke(drawing,interaction.rawPoints,interaction.mode==='create-hand').then(()=>renderSurveyMap());
      return;
    }

    if(interaction.mode==='create-line'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){
        renderSurveyMap();
        return;
      }
      const drawing=selectedDrawing();
      if(!drawing) return;
      const rawEnd=clientToPagePoint(event.clientX,event.clientY,interaction.sheetRect,drawing);
      const endPoint=(shiftActive()||event.shiftKey)?snapLinePoint(interaction.startPoint,rawEnd):rawEnd;
      void createLineFromPoints(drawing,interaction.startPoint,endPoint).then(()=>renderSurveyMap());
      return;
    }

    const current=drawingObjectStore.get(interaction.objectId);
    if(!current) return;
    const draft=interaction.draft||interaction.original;
    if(event.type==='pointercancel'){renderSurveyMap();return;}
    const fields=interaction.mode.startsWith('elbow-')?['points','startX','startY','endX','endY','bendX','x','y','width','height']
      :['stroke-move','stroke-point','stroke-resize','stroke-rotate'].includes(interaction.mode)?['points','x','y','width','height']
      :interaction.mode==='move'?['x','y']
      :['resize','resize-corner'].includes(interaction.mode)?['x','y','width','height']
      :interaction.mode==='rotate'?['rotation']
      :['startX','startY','endX','endY','x','y','width','height'];
    if(!fields.some(field=>JSON.stringify(current[field])!==JSON.stringify(draft[field]))){
      renderSurveyMap();
      return;
    }
    const now=Date.now();
    const next=createDrawingObject({
      ...current,
      ...draft,
      fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,fields,now)
    });
    void commitDrawingObject(next,`survey-map-object-${interaction.mode}`).then(()=>renderSurveyMap());
  };

  function releaseShift(event){
    if(shiftPointerId===event.pointerId){
      shiftPointerId=null;syncShiftButton();
      if(!pointerInteraction)renderSurveyMap();
    }
  }
  window.addEventListener('pointerup',releaseShift);
  window.addEventListener('pointercancel',releaseShift);
  mount.addEventListener('pointerup',finishPointerInteraction);
  mount.addEventListener('pointercancel',finishPointerInteraction);

  mount.addEventListener('change',(event)=>{
    const styleInput=event.target.closest('[data-survey-style-field]');
    if(styleInput){
      const record=selectedObject();
      if(!record)return;
      const field=styleInput.dataset.surveyStyleField;
      const isLine=record.type==='line';
      const patch={};
      if(field==='color'){
        patch[isLine?'lineColor':'strokeColor']=String(styleInput.value||'#334155');
      }else if(field==='width'){
        patch[isLine?'lineWidth':'strokeWidth']=clamp(Number(styleInput.value)||80,20,500);
      }else if(field==='fill'){
        patch.fillEnabled=Boolean(styleInput.checked);
        patch.fillOpacity=patch.fillEnabled?.2:0;
      }else if(field==='fillColor'){
        patch.fillColor=String(styleInput.value||'#93c5fd');
      }else return;
      const now=Date.now();
      const next=createDrawingObject({...record,...patch,
        fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,Object.keys(patch),now)});
      void commitDrawingObject(next,'survey-map-style-change').then(()=>renderSurveyMap());
      return;
    }
    if(event.target.matches('[data-survey-room-choice]')){
      selectedRoomKey=String(event.target.value||'');
      return;
    }
    if(event.target.matches('[data-survey-name]')) void renameDrawing(event.target.value);
    if(event.target.matches('[data-survey-display-name]')) void renamePageDisplay(event.target.value);
  });

  window.addEventListener('keydown',(event)=>{
    if(event.key==='Shift'){physicalShift=true;syncShiftButton();}
    if(root()?.style.display==='none') return;
    if((event.ctrlKey||event.metaKey) && !event.target.matches('input,textarea')){
      const k=event.key.toLowerCase();
      if(k==='z' || k==='y'){
        event.preventDefault();
        void applyHistory(k==='y'||(k==='z'&&event.shiftKey));
        return;
      }
    }
    if((event.key==='Delete' || event.key==='Backspace') && selectedObjectId && !event.target.matches('input,textarea')){
      event.preventDefault();
      void deleteSelectedObject();
    }
  });

  window.addEventListener('keyup',(event)=>{
    if(event.key==='Shift'){physicalShift=false;syncShiftButton();if(!pointerInteraction)renderSurveyMap();}
  });
  window.addEventListener('blur',()=>{
    shiftPointerId=null;physicalShift=false;syncShiftButton();
  });
  window.addEventListener('chousa:tab-change',(event)=>{
    if(event.detail?.currentTab==='survey-map'){
      renderSurveyMap();
      return;
    }
    if(focusMode){
      focusMode=false;
      pagesOpen=false;
      toolPanelOpen=false;
      editPanelOpen=false;
      applyLayoutClasses();
    }
  });
}

export function refreshSurveyMap(){ renderSurveyMap(); }

export function initializeSurveyMap(){
  if(initialized) return;
  initialized=true;
  bindEvents();
  drawingRecordStore.subscribe(()=>{
    if(root()?.style.display!=='none') renderSurveyMap();
  });
  drawingObjectStore.subscribe(()=>{
    if(root()?.style.display!=='none' && !pointerInteraction) renderSurveyMap();
  });
  renderSurveyMap();
}
