/**
 * v0.1.10.21 文字入り四角形・ズーム保持・初期配置。
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
import { clientToPagePoint, clamp, clampObjectRect, pageSize, rotationFromPointer, resizeRectFromDrag } from './survey-map-geometry.js';
import { drawingObjectsHtml } from './survey-map-object-view.js';
import { LABEL_DEFAULTS,materialPalette,isLabelType } from './survey-map-labels.js';
import { paperLayoutFields } from './survey-map-paper-layout.js';
import { labelEditorHtml } from './survey-map-label-editor.js';
import { alignmentGuides,guideSvg } from './survey-map-smart-guides.js';
import { createLineDraftPreview, updateLineDraftPreview, updatePolylinePreview, previewCorrectedStroke, highlightAdjustedEdges, paintObjectDraft } from './survey-map-live-view.js';
import { correctStroke, traceLength } from './survey-map-stroke.js';
import { isShapeTool,defaultShapeParams,shapeAdjusters,updatedShapeParams,shapeSvgMarkup,shapeVertices,initialGridShapeParams } from './survey-map-shapes.js';
import { rememberSurveyEdit,rememberSurveyOperation,historyStatus,takeUndo,takeRedo } from './survey-map-history.js';
import { joinRegions,splitRegion,polygonRecordGeometry } from './survey-map-region-operations.js';
import { lineRecordWithPoints,elbowPath,strokeRecordWithPoints,elbowRecordWithPoints,translateObject,rotateSingleObject,flipSingleObject,scaleObjectInGroup } from './survey-map-transforms.js';
import {canAnchor,anchorPoint,nearestAnchor,bestConnectionPair,resolveConnectedLine} from './survey-map-connections.js';

let initialized=false;
let selectedDrawingId='';
let boundProjectId='';
let gridVisible=true;
let focusMode=false;
let toolCategory='採取';
let shapeMenuOpen=false;
let drawingSettingsOpen=false;
let pagesOpen=false;
let selectedObjectId='';
let selectedObjectIds=new Set();
function selectOnly(id){
  selectedObjectId=id||'';
  selectedObjectIds=new Set(id?[id]:[]);
}
function clearSelection(){selectOnly('');}
let activeTool='select';
let lastShapeTool='rect';
let selectedRoomKey='';
let roomDisplay='number';
let selectedMaterialId='';
let smartGuideEnabled=true;
function clearSmartGuides(){root()?.querySelector('.survey-map-smart-guides')?.remove();}
function showSmartGuides(guides,drawing){
  clearSmartGuides();
  if(!smartGuideEnabled||!guides.length)return;
  const layer=root()?.querySelector('.survey-map-sheet');
  if(layer)layer.insertAdjacentHTML('beforeend',guideSvg(guides,pageSize(drawing)));
}
let zoomLevel=1;
const touchPoints=new Map();
let pinchGesture=null;
let pendingTouchCreate=null;
let inlineTextEdit=null;
let lastTextTouch=null;
let pointerInteraction=null;
let polygonDraft=null;
let pendingConnectionStart=null;
let regionPreview=null;
let regionCommitPending=false;
let shiftPointerId=null;
let physicalShift=false;
let shiftLatched=false;
let shiftMoveMode=false;
let shiftGesture=null;
let shiftTapTimer=null;
let shiftPosition=null;
const SHIFT_POSITION_KEY='survey-map-shift-position-v1';
try{
  const stored=JSON.parse(localStorage.getItem(SHIFT_POSITION_KEY)||'null');
  if(stored&&Number.isFinite(stored.left)&&Number.isFinite(stored.bottom))shiftPosition=stored;
}catch(_error){ /* Private browsing may not expose storage. */ }
function shiftButtonPositionStyle(){
  if(!shiftPosition)return '';
  return `left:${shiftPosition.left}px;bottom:${shiftPosition.bottom}px`;
}
function placeShiftButton(left,bottom,save=false){
  const mount=root();
  const btn=mount?.querySelector('[data-survey-shift]');
  if(!mount||!btn)return;
  const bounds=mount.getBoundingClientRect();
  const maxLeft=Math.max(8,bounds.width-btn.offsetWidth-8);
  const maxBottom=Math.max(8,bounds.height-btn.offsetHeight-8);
  shiftPosition={left:Math.max(8,Math.min(maxLeft,left)),bottom:Math.max(8,Math.min(maxBottom,bottom))};
  btn.style.left=`${shiftPosition.left}px`;
  btn.style.bottom=`${shiftPosition.bottom}px`;
  if(save)try{localStorage.setItem(SHIFT_POSITION_KEY,JSON.stringify(shiftPosition));}catch(_error){}
}
function cancelShiftTap(){if(shiftTapTimer!==null){clearTimeout(shiftTapTimer);shiftTapTimer=null;}}
function refreshShiftButton(){
  const btn=root()?.querySelector('[data-survey-shift]');
  if(!btn)return;
  btn.classList.toggle('active',shiftActive());
  btn.classList.toggle('moving',shiftMoveMode);
  btn.setAttribute('aria-pressed',String(shiftLatched));
  btn.textContent=shiftMoveMode?'完了':shiftActive()?'Shift ON':'Shift';
}
const DEFAULT_STROKE_WIDTH=80;
const GRID_SPACINGS=[250,500];
let gridSpacing=250;
let gridSnap=true;
let strokeEditMode='shape';
let roomAreaDash='fine';
const ROOM_DASH_OPTIONS=[['fine','細かい点線'],['normal','標準'],['dash','粗い点線'],['solid','実線']];
function roomDashSelect(value,attribute){
  return `<label class="survey-map-toolbar-option">線種 <select ${attribute}>${ROOM_DASH_OPTIONS.map(([key,label])=>`<option value="${key}" ${key===value?'selected':''}>${label}</option>`).join('')}</select></label>`;
}
function shiftActive(){return shiftLatched||shiftPointerId!==null||physicalShift;}
function syncShiftButton(){refreshShiftButton();}
function snapGridValue(value){return gridSnap?Math.round(value/gridSpacing)*gridSpacing:value;}
function snapGridPoint(point){return {x:snapGridValue(point.x),y:snapGridValue(point.y)};}
function pagePointer(x,y,rect,drawing,{snap=true}={}){
  const point=clientToPagePoint(x,y,rect,drawing);
  return snap?snapGridPoint(point):point;
}
function snapCreationPoint(point,drawing,show=false){
  if(show&&smartGuideEnabled){
    const guides=alignmentGuides({x:point.x,y:point.y,width:0,height:0},
      drawingObjectStore.getByDrawingId(drawing.drawingId),pageSize(drawing));
    showSmartGuides(guides,drawing);
  }
  return point;
}
/** 図形の座標そのものをグリッドへ揃える。ポインターの押下位置には依存しない。 */
function alignPositionToGrid(rect,drawing){
  const page=pageSize(drawing);
  const maxX=Math.max(0,page.width-rect.width),maxY=Math.max(0,page.height-rect.height);
  const limitX=gridSnap?Math.floor(maxX/gridSpacing)*gridSpacing:maxX;
  const limitY=gridSnap?Math.floor(maxY/gridSpacing)*gridSpacing:maxY;
  return {...rect,x:clamp(snapGridValue(rect.x),0,limitX),y:clamp(snapGridValue(rect.y),0,limitY)};
}
/** 回転なしのサイズ変更は、操作する側の輪郭をグリッド交点へ揃える。 */
function alignResizeToGrid(rect,original,mode,corner,drawing,centerFixed=false){
  if(!gridSnap||Math.abs(Number(original.rotation)||0)>0.001||centerFixed)return rect;
  const page=pageSize(drawing);
  const left=corner.includes('w'),top=corner.includes('n');
  const right=mode==='resize'||corner.includes('e');
  const bottom=mode==='resize'||corner.includes('s');
  const x1=left?snapGridValue(rect.x):Number(original.x)||0;
  const y1=top?snapGridValue(rect.y):Number(original.y)||0;
  const x2=right?snapGridValue(rect.x+rect.width):(Number(original.x)||0)+(Number(original.width)||0);
  const y2=bottom?snapGridValue(rect.y+rect.height):(Number(original.y)||0)+(Number(original.height)||0);
  return {...rect,x:clamp(x1,0,page.width),y:clamp(y1,0,page.height),
    width:Math.max(120,Math.min(page.width,x2)-x1),
    height:Math.max(120,Math.min(page.height,y2)-y1)};
}
function shapeDragBounds(start,end,constrain=false){
  let dx=end.x-start.x,dy=end.y-start.y;
  if(constrain){
    const side=Math.max(Math.abs(dx),Math.abs(dy));
    dx=(dx<0?-1:1)*side;
    dy=(dy<0?-1:1)*side;
  }
  return {x:Math.min(start.x,start.x+dx),y:Math.min(start.y,start.y+dy),width:Math.abs(dx),height:Math.abs(dy)};
}
function multiBounds(objects){
  if(!objects.length)return null;
  const x=Math.min(...objects.map(o=>Number(o.x)||0));
  const y=Math.min(...objects.map(o=>Number(o.y)||0));
  const right=Math.max(...objects.map(o=>(Number(o.x)||0)+(Number(o.width)||0)));
  const bottom=Math.max(...objects.map(o=>(Number(o.y)||0)+(Number(o.height)||0)));
  return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};
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
    selectedRoomKey='';
    clearSelection();
    polygonDraft=null;
    pendingConnectionStart=null;
    strokeEditMode='shape';
  }
  const active=activeDrawings();
  if(!active.length) return null;
  const selected=active.find((item)=>item.drawingId===selectedDrawingId) || active[0];
  selectedDrawingId=selected.drawingId;
  return selected;
}

function placedRoomNumbers(drawing=selectedDrawing()){
  return new Set(drawingObjectStore.getByDrawingId(drawing?.drawingId||'')
    .filter(o=>o.type==='roomLabel'&&!o.deleted)
    .map(o=>String(o.roomNoSnapshot||o.text||'').trim()).filter(Boolean));
}
function normalizeRoomNumber(value){
  return String(value||'').trim().replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).replace(/[－ー]/g,'-');
}
const ROOM_AREAS=['東面','西面','南面','北面','B2','B1','1','2','3','4','5','6','7','8','9','10','S','R'];
function roomAreaOf(value){
  const v=normalizeRoomNumber(value);
  if(ROOM_AREAS.slice(0,4).includes(v))return v;
  const m=v.match(/^(B\d+|\d+|R|S)-\d+$/);
  return m?m[1]:'';
}
function nextRoomNumber(current,used){
  const v=normalizeRoomNumber(current),m=v.match(/^(B\d+|\d+|R|S)-(\d+)$/);
  if(!m)return v;
  for(let n=Number(m[2])+1;n<10000;n++){
    const next=m[1]+'-'+n;
    if(!used.has(next))return next;
  }
  return v;
}
function selectedRoomNumber(){
  if(!selectedRoomKey)selectedRoomKey=nextRoomNumber('1-0',placedRoomNumbers());
  return selectedRoomKey;
}
function advanceRoomSelection(){
  selectedRoomKey=nextRoomNumber(selectedRoomNumber(),placedRoomNumbers());
}
function stepRoomArea(delta){
  const current=roomAreaOf(selectedRoomNumber());
  const index=ROOM_AREAS.indexOf(current);
  const next=ROOM_AREAS[Math.max(0,Math.min(ROOM_AREAS.length-1,(index<0?6:index)+delta))];
  selectedRoomKey=ROOM_AREAS.slice(0,4).includes(next)?next:nextRoomNumber(next+'-0',placedRoomNumbers());
}
function stepRoomNumber(delta){
  const current=selectedRoomNumber(),match=current.match(/^(B\d+|\d+|R|S)-(\d+)$/);
  if(match)selectedRoomKey=match[1]+'-'+Math.max(1,Number(match[2])+delta);
  else if(ROOM_AREAS.slice(0,4).includes(current)){
    const areas=ROOM_AREAS.slice(0,4);
    selectedRoomKey=areas[(areas.indexOf(current)+delta+areas.length)%areas.length];
  }
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

/** Commit a logical multi-object operation with one local snapshot and history entry. */
async function commitDrawingObjects(records,source){
  const project=getCurrentProject();
  const changes=records.map(after=>({
    type:'drawingObject',before:drawingObjectStore.get(after.objectId)||null,after
  }));
  drawingObjectStore.batch(()=>records.forEach(record=>drawingObjectStore.set(record)));
  persistSnapshot(source);
  rememberSurveyOperation(project?.projectId,source,changes);
  if(project?.projectId&&!project.isSample){
    for(const record of records)await persistDrawingObjectForProject(project,record,source);
  }
}
function availableMaterials(){
  return materialRecordStore.getAll().filter(m=>m.status==='active')
    .sort((a,b)=>(Number(a.materialNo)||0)-(Number(b.materialNo)||0));
}
function selectedMaterial(){
  const materials=availableMaterials();
  if(!materials.some(m=>m.materialId===selectedMaterialId))selectedMaterialId=materials[0]?.materialId||'';
  return materials.find(m=>m.materialId===selectedMaterialId)||null;
}
function newLabelFields(type,point,drawing,extra={}){
  const settings=LABEL_DEFAULTS[type]||LABEL_DEFAULTS.text;
  const rect=alignPositionToGrid(clampObjectRect({x:point.x-settings.width/2,y:point.y-settings.height/2,
    width:settings.width,height:settings.height},drawing),drawing);
  return {...settings,...rect,...extra};
}
function buildLabelRecordAt(type,clientX,clientY,extra={}){
  const drawing=selectedDrawing(),sheet=root()?.querySelector('.survey-map-sheet');
  if(!drawing||!sheet)return;
  const point=pagePointer(clientX,clientY,sheet.getBoundingClientRect(),drawing,{snap:false});
  const now=Date.now(),objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const fields=newLabelFields(type,point,drawing,extra);
  const rectangular=type==='text'||type==='materialLabel';
  const rectFields=rectangular?{
    type:'shape',shapeType:'rect',shapeParams:defaultShapeParams('rect'),
    fillEnabled:Boolean(fields.backgroundEnabled),fillColor:fields.backgroundColor||'#ffffff',
    fillOpacity:1,lineEnabled:Boolean(fields.borderEnabled),
    strokeColor:fields.strokeColor||'#111111',strokeWidth:40,
    alignH:type==='materialLabel'?'left':'center',alignV:'middle',
    ...fields
  }:fields;
  const record=createDrawingObject({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:rectangular?'shape':type,
    layer:DRAWING_LAYERS.TEXT,order:Math.max(0,...objects.map(o=>Number(o.order)||0))+1,
    rotation:0,visible:true,locked:false,deleted:false,...rectFields,
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},Object.keys(rectFields).concat(['drawingId','type','layer','order','rotation']),now)
  });
  return record;
}
async function createLabelAt(type,clientX,clientY,extra={}){
  const record=buildLabelRecordAt(type,clientX,clientY,extra);
  if(!record)return;
  selectOnly(record.objectId);
  await commitDrawingObject(record,'survey-map-label-create');
  renderSurveyMap();
  return record;
}
async function createRoomLabelAt(clientX,clientY){
  const roomNo=selectedRoomNumber();
  const record=await createLabelAt('roomLabel',clientX,clientY,{
    roomNoSnapshot:roomNo,roomNameSnapshot:'',
    roomDisplay:'number',text:roomNo,customText:true
  });
  if(record){
    advanceRoomSelection();
    activeTool='room';
    renderSurveyMap();
  }
  return record;
}
function materialLabelFields(material){
  const no=material.materialNo||material.inputId||'';
  const part=material.part||'';
  const kind=/みなし/.test(material.analysisRequired||'')?'assumed':
    /含有/.test(material.analysisResult||'')&&!/なし|不検出/.test(material.analysisResult||'')?'positive':'none';
  return {
    materialId:material.materialId,materialKind:kind,
    text:`建材No.${no}${kind==='assumed'?'':'-①'}\n${part} ${material.name||''}`,
    ...materialPalette(kind)
  };
}
async function createMaterialLabelAt(clientX,clientY){
  const material=selectedMaterial();
  return material?createLabelAt('materialLabel',clientX,clientY,materialLabelFields(material)):null;
}
function buildSampleMarkerAt(clientX,clientY){
  const drawing=selectedDrawing(),sheet=root()?.querySelector('.survey-map-sheet');
  if(!drawing||!sheet)return null;
  const point=pagePointer(clientX,clientY,sheet.getBoundingClientRect(),drawing,{snap:false});
  const rect=alignPositionToGrid(clampObjectRect({
    x:point.x-200,y:point.y-200,width:400,height:400
  },drawing),drawing);
  const objects=drawingObjectStore.getByDrawingId(drawing.drawingId),now=Date.now();
  const fields={
    ...rect,shapeType:'circle',shapeParams:defaultShapeParams('circle'),sampleRole:'marker',
    fillEnabled:true,fillColor:'#dc2626',fillOpacity:1,
    lineEnabled:false,strokeColor:'#dc2626',strokeWidth:DEFAULT_STROKE_WIDTH
  };
  return createDrawingObject({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:'shape',
    layer:DRAWING_LAYERS.TEXT,order:Math.max(0,...objects.map(o=>Number(o.order)||0))+1,
    rotation:0,visible:true,locked:false,deleted:false,...fields,
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},Object.keys(fields).concat([
      'drawingId','type','layer','order','rotation'
    ]),now)
  });
}
async function createSampleMarkerAt(clientX,clientY){
  const marker=buildSampleMarkerAt(clientX,clientY);
  if(!marker)return null;
  selectOnly(marker.objectId);
  await commitDrawingObject(marker,'survey-map-sample-create');
  renderSurveyMap();
  return marker;
}
function startInlineTextEdit(id){
  const record=drawingObjectStore.get(id);
  if(!record||record.type!=='shape'||record.shapeType!=='rect'||record.materialId)return;
  if(inlineTextEdit&&inlineTextEdit.objectId!==id)void finishInlineTextEdit();
  selectOnly(id);
  const resumeTool=activeTool==='text'?'text':'';
  activeTool='select';
  renderSurveyMap();
  const target=root()?.querySelector('[data-survey-object-id="'+CSS.escape(id)+'"] .survey-map-rect-text');
  if(!target)return;
  const input=document.createElement('textarea');
  input.className='survey-map-inline-textarea';
  input.setAttribute('aria-label','図面上でテキスト入力');
  input.value=String(record.text||'');
  target.replaceChildren(input);
  inlineTextEdit={objectId:id,input,original:input.value,composing:false,resumeTool};
  input.addEventListener('compositionstart',()=>{if(inlineTextEdit?.input===input)inlineTextEdit.composing=true;});
  input.addEventListener('compositionend',()=>{if(inlineTextEdit?.input===input)inlineTextEdit.composing=false;});
  input.addEventListener('blur',()=>{if(inlineTextEdit?.input===input)void finishInlineTextEdit();});
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.isComposing){input.value=inlineTextEdit?.original||'';input.blur();}
    event.stopPropagation();
  });
  input.focus();
  input.setSelectionRange(input.value.length,input.value.length);
}
async function finishInlineTextEdit(){
  const session=inlineTextEdit;
  if(!session)return;
  inlineTextEdit=null;
  const record=drawingObjectStore.get(session.objectId);
  if(record&&record.text!==session.input.value){
    const next=createDrawingObject({...record,text:session.input.value,
      fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,['text'],Date.now())});
    await commitDrawingObject(next,'survey-map-text-direct-edit');
  }
  if(session.resumeTool && activeTool==='select')activeTool=session.resumeTool;
  renderSurveyMap();
}
async function createFreeTextAt(clientX,clientY){
  const created=await createLabelAt('text',clientX,clientY,{text:'',textDirection:'horizontal'});
  if(created)startInlineTextEdit(created.objectId);
  return created;
}
/** One logical sample-set operation; each member remains independently editable. */
async function createSampleSetAt(clientX,clientY){
  const drawing=selectedDrawing(),sheet=root()?.querySelector('.survey-map-sheet');
  const material=selectedMaterial();
  if(!drawing||!sheet||!material)return;
  const rect=sheet.getBoundingClientRect();
  const dx=Math.min(170,rect.width*.22),dy=Math.min(65,rect.height*.12);
  const marker=buildSampleMarkerAt(clientX,clientY);
  const box=buildLabelRecordAt('materialLabel',clientX+dx,clientY+dy,materialLabelFields(material));
  if(!marker||!box)return;
  const sampleSetId=newObjectId(),now=Date.now();
  const withSet=record=>createDrawingObject({
    ...record,sampleSetId,
    fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,['sampleSetId'],now)
  });
  const linkedMarker=withSet(marker),linkedBox=withSet(box);
  const pair=bestConnectionPair(linkedMarker,linkedBox);
  if(!pair)return;
  const elbow=buildElbowRecord(drawing,pair.start,pair.end,{
    ...pair,sampleSetId
  },{allowShort:true,lineColor:'#dc2626'});
  const records=[linkedMarker,linkedBox,elbow];
  await commitDrawingObjects(records,'survey-map-sample-set-create');
  selectedObjectIds=new Set(records.map(record=>record.objectId));
  selectedObjectId=linkedBox.objectId;
  renderSurveyMap();
}
async function createShapeAt(kind,clientX,clientY,otherPoint=null,constrain=false){
  const roomArea=kind==='room-area';
  if(roomArea)kind='rect';
  const drawing=selectedDrawing();
  const sheet=root()?.querySelector('.survey-map-sheet');
  if(!drawing || !sheet) return;
  const point=pagePointer(clientX,clientY,sheet.getBoundingClientRect(),drawing);
  const bounds=otherPoint?shapeDragBounds(point,otherPoint,constrain):null;
  const defaultSide=kind==='circle'||constrain;
  const defaultWidth=3600,defaultHeight=defaultSide?3600:2400;
  const dragRect=bounds&&bounds.width>120&&bounds.height>120;
  const width=gridSnap?snapGridValue(defaultWidth):defaultWidth;
  const height=gridSnap?snapGridValue(defaultHeight):defaultHeight;
  const rawRect=clampObjectRect(dragRect?bounds:{
    x:point.x-width/2,y:point.y-height/2,width,height
  },drawing);
  const rect=gridSnap?(()=>{
    const size=pageSize(drawing);
    const x=Math.max(0,Math.min(size.width-gridSpacing,snapGridValue(rawRect.x)));
    const y=Math.max(0,Math.min(size.height-gridSpacing,snapGridValue(rawRect.y)));
    const right=Math.max(x+gridSpacing,Math.min(size.width,snapGridValue(rawRect.x+rawRect.width)));
    const bottom=Math.max(y+gridSpacing,Math.min(size.height,snapGridValue(rawRect.y+rawRect.height)));
    return {x,y,width:right-x,height:bottom-y};
  })():alignPositionToGrid(rawRect,drawing);
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
    shapeParams:gridSnap?initialGridShapeParams(kind,rect,gridSpacing):defaultShapeParams(kind),
    fillEnabled:false,
    fillColor:'#ffffff',
    fillOpacity:0,
    lineEnabled:true,
    strokeColor:roomArea?'#dc2626':'#334155',
    strokeDash:roomArea?roomAreaDash:'solid',
    strokeWidth:DEFAULT_STROKE_WIDTH,
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'drawingId','type','x','y','width','height','rotation','layer','order','visible','locked','deleted',
      'shapeType','shapeParams','fillEnabled','fillColor','fillOpacity','lineEnabled','strokeColor','strokeWidth'
    ],now)
  });
  selectOnly(record.objectId);
  await commitDrawingObject(record,'survey-map-object-create');
  renderSurveyMap();
}

async function createCorrectedStroke(drawing,rawPoints,freehand=false,polygon=false,pen=false){
  if(traceLength(rawPoints)<(pen?12:200)) return null;
  const corrected=(freehand||polygon)?rawPoints:correctStroke(rawPoints,drawing);
  if(corrected.length<2) return null;
  const now=Date.now();
  const objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const closed=polygon || (!pen && corrected.length>3 && Math.hypot(corrected[0].x-corrected.at(-1).x,corrected[0].y-corrected.at(-1).y)<120);
  const record=createDrawingObject(strokeRecordWithPoints({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:'line',
    layer:(freehand||pen)?DRAWING_LAYERS.NOTE:DRAWING_LAYERS.SHAPE,
    order:objects.length?Math.max(...objects.map(o=>Number(o.order)||0))+1:1,
    rotation:0,closed,freehand:freehand||pen,lineColor:'#334155',lineWidth:DEFAULT_STROKE_WIDTH,lineStyle:'solid',
    lineEnabled:true,fillEnabled:false,fillColor:'#93c5fd',fillOpacity:1,
    visible:true,locked:false,deleted:false,createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'drawingId','type','layer','order','x','y','width','height','rotation',
      'points','closed','freehand','lineColor','lineWidth','lineStyle','lineEnabled',
      'fillEnabled','fillColor','fillOpacity','visible','locked','deleted'
    ],now)
  },corrected));
  if(!pen)selectOnly(record.objectId);
  await commitDrawingObject(record,'survey-map-corrected-stroke-create');
  return record;
}

function addPolygonVertex(drawing,point){
  if(!polygonDraft || polygonDraft.drawingId!==drawing.drawingId){
    polygonDraft={drawingId:drawing.drawingId,points:[]};
  }
  const points=polygonDraft.points;
  const last=points.at(-1);
  if(last && Math.hypot(last.x-point.x,last.y-point.y)<150)return;
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
function buildElbowRecord(drawing,start,end,connections={},options={}){
  if(!options.allowShort&&Math.hypot(end.x-start.x,end.y-start.y)<200)return null;
  const now=Date.now(),objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const base=elbowRecordWithPoints({
    objectId:newObjectId(),drawingId:drawing.drawingId,type:'line',elbow:true,
    startConnection:connections.startConnection||null,endConnection:connections.endConnection||null,
    ...(connections.sampleSetId?{sampleSetId:connections.sampleSetId}:{}),
    layer:DRAWING_LAYERS.SHAPE,order:objects.length?Math.max(...objects.map(o=>Number(o.order)||0))+1:1,
    visible:true,locked:false,deleted:false,lineColor:options.lineColor||'#334155',lineWidth:DEFAULT_STROKE_WIDTH,lineStyle:'solid',
    createdAt:new Date(now).toISOString()
  },start.x,start.y,end.x,end.y,(start.x+end.x)/2);
  const record=createDrawingObject({...base,fieldEditedAt:touchFieldEditedAt({},[
    'drawingId','type','elbow','points','startX','startY','endX','endY','bendX',
    'x','y','width','height','layer','order','visible','locked','deleted','lineColor','lineWidth','lineStyle','startConnection','endConnection','sampleSetId'
  ],now)});
  return record;
}
async function createElbowFromPoints(drawing,start,end,connections={},options={}){
  const record=buildElbowRecord(drawing,start,end,connections,options);
  if(!record)return null;
  selectOnly(record.objectId);
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
    lineWidth:DEFAULT_STROKE_WIDTH,
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
  await commitDrawingObject(record,'survey-map-line-create');
  return record;
}

function drawingConnectionObjects(drawing){
  return drawingObjectStore.getByDrawingId(drawing.drawingId).filter(o=>!o.deleted);
}
function connectionPoint(event,drawing,sheetRect,except=''){
  const p=pagePointer(event.clientX,event.clientY,sheetRect,drawing,{snap:false});
  const threshold=24*pageSize(drawing).width/Math.max(1,sheetRect.width);
  return nearestAnchor(p,drawingConnectionObjects(drawing),threshold,except);
}
async function createConnectedElbow(drawing,startObject,endObject){
  const pair=bestConnectionPair(startObject,endObject);
  if(!pair)return null;
  return createElbowFromPoints(drawing,pair.start,pair.end,pair);
}
function regionPreviewMarkup(drawing){
  const operation=regionPreview;
  if(!drawing||!operation||operation.drawingId!==drawing.drawingId)return '';
  const size=pageSize(drawing);
  const polygon=points=>points.map(p=>p.x+','+p.y).join(' ');
  return `<div class="survey-map-region-preview">
    <svg viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none">
      ${operation.result.outlines.map(points=>`<polygon points="${polygon(points)}"/>`).join('')}
      ${operation.result.partitions.map(([a,b])=>`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`).join('')}
    </svg>
    <div class="survey-map-region-confirm">
      <strong>${operation.type==='merge'?'統合':'分割'}プレビュー</strong>
      <button type="button" class="btn small primary" data-survey-region-confirm>確定</button>
      <button type="button" class="btn small" data-survey-region-cancel>戻る</button>
    </div>
  </div>`;
}
function startRegionOperation(type){
  const drawing=selectedDrawing();
  if(!drawing||regionCommitPending)return;
  const records=Array.from(selectedObjectIds).map(id=>drawingObjectStore.get(id))
    .filter(record=>record&&!record.deleted&&record.drawingId===drawing.drawingId);
  try{
    let result;
    if(type==='merge'){
      if(records.length<2||records.some(r=>r.type!=='shape'))throw new Error('統合する図形を2つ以上選択してください');
      result=joinRegions(records);
    }else{
      const shapes=records.filter(r=>r.type==='shape'),lines=records.filter(r=>r.type==='line');
      if(records.length!==2||shapes.length!==1||lines.length!==1)throw new Error('図形1つと直線1本を選択してください');
      result=splitRegion(shapes[0],lines[0]);
    }
    regionPreview={type,drawingId:drawing.drawingId,ids:records.map(r=>r.objectId),
      originals:records.map(r=>JSON.stringify(r)),result};
    renderSurveyMap();
  }catch(error){
    window.alert(error.message||'図形を処理できませんでした');
  }
}
async function confirmRegionOperation(){
  if(!regionPreview||regionCommitPending)return;
  const op=regionPreview,drawing=selectedDrawing();
  if(!drawing||drawing.drawingId!==op.drawingId)return;
  const originals=op.ids.map(id=>drawingObjectStore.get(id));
  if(originals.some((r,i)=>!r||JSON.stringify(r)!==op.originals[i])){
    regionPreview=null;renderSurveyMap();
    window.alert('図形が変更されています。もう一度選択して実行してください。');
    return;
  }
  regionCommitPending=true;
  const now=Date.now(),source='survey-map-region-'+op.type;
  const active=drawingObjectStore.getByDrawingId(drawing.drawingId);
  let order=Math.max(0,...active.map(r=>Number(r.order)||0));
  const template=originals.find(r=>r.type==='shape');
  const geometryGroupId=op.type==='merge'?newObjectId():'';
  const create=(fields,changed)=>createDrawingObject({
    objectId:newObjectId(),drawingId:drawing.drawingId,
    layer:DRAWING_LAYERS.SHAPE,order:++order,visible:true,locked:false,deleted:false,
    createdAt:new Date(now).toISOString(),...fields,
    fieldEditedAt:touchFieldEditedAt({},changed,now)
  });
  const newShapes=op.result.outlines.map(points=>create({
    type:'shape',...polygonRecordGeometry(points),geometryGroupId,
    fillEnabled:Boolean(template.fillEnabled),fillColor:template.fillColor||'#ffffff',
    fillOpacity:Number(template.fillOpacity)||0,lineEnabled:true,
    strokeColor:template.strokeColor||'#334155',strokeWidth:template.strokeWidth||80
  },['drawingId','type','layer','order','x','y','width','height','rotation','flipX','flipY',
    'shapeType','shapeParams','customVertices','fillEnabled','fillColor','fillOpacity',
    'lineEnabled','strokeColor','strokeWidth','geometryGroupId','deleted']));
  const newLines=op.result.partitions.map(([a,b])=>create({
    type:'line',geometryGroupId,startX:a.x,startY:a.y,endX:b.x,endY:b.y,
    x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),
    width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y),
    lineColor:template.strokeColor||'#334155',lineWidth:template.strokeWidth||80,lineStyle:'solid'
  },['drawingId','type','layer','order','x','y','width','height','startX','startY','endX','endY','lineColor','lineWidth','lineStyle','geometryGroupId','deleted']));
  const disabled=originals.filter(r=>op.type==='merge'||r.type==='shape').map(r=>createDrawingObject({
    ...r,deleted:true,fieldEditedAt:touchFieldEditedAt(r.fieldEditedAt,'deleted',now)
  }));
  const changes=[...disabled.map(after=>({
    type:'drawingObject',before:drawingObjectStore.get(after.objectId),after
  })),...[...newShapes,...newLines].map(after=>({type:'drawingObject',before:null,after}))];
  const updates=changes.map(c=>c.after);
  try{
    drawingObjectStore.batch(()=>updates.forEach(r=>drawingObjectStore.set(r)));
    persistSnapshot(source);
    rememberSurveyOperation(getCurrentProject()?.projectId,source,changes);
    regionPreview=null;
    selectOnly(newShapes[0]?.objectId||'');
    renderSurveyMap();
    // 保存結果は各Recordの既存未送信キューへも残る。統合処理専用の
    // Firestore原子バッチ／遠隔での一括表示は後続の同期改修で扱う。
    const project=getCurrentProject();
    if(project&&!project.isSample){
      for(const record of updates){
        await persistDrawingObjectForProject(project,record,source);
      }
    }
  }catch(error){
    window.alert('図形の保存に失敗しました。同期状態を確認してください。');
  }finally{
    regionCommitPending=false;
  }
}
async function deleteSelectedObject(){
  const now=Date.now();
  const records=Array.from(selectedObjectIds)
    .map(id=>drawingObjectStore.get(id))
    .filter(item=>item && !item.deleted && item.drawingId===selectedDrawingId);
  if(!records.length)return;
  const drawing=selectedDrawing();
  const deletedIds=new Set(records.map(o=>o.objectId));
  const active=drawingConnectionObjects(drawing);
  const byId=new Map(active.map(o=>[o.objectId,o]));
  const detached=active.filter(line=>line.type==='line'&&!deletedIds.has(line.objectId) &&
    (deletedIds.has(line.startConnection?.targetObjectId)||deletedIds.has(line.endConnection?.targetObjectId)))
    .map(line=>{
      const resolved=resolveConnectedLine(line,byId);
      const patch={
        ...resolved,
        startConnection:deletedIds.has(line.startConnection?.targetObjectId)?null:line.startConnection||null,
        endConnection:deletedIds.has(line.endConnection?.targetObjectId)?null:line.endConnection||null
      };
      return createDrawingObject({...patch,
        fieldEditedAt:touchFieldEditedAt(line.fieldEditedAt,
          ['startConnection','endConnection','startX','startY','endX','endY','points','x','y','width','height'],now)});
    });
  const deleted=records.map(record=>createDrawingObject({...record,deleted:true,
    fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,'deleted',now)}));
  const updates=[...detached,...deleted];
  const changes=updates.map(after=>({type:'drawingObject',before:drawingObjectStore.get(after.objectId),after}));
  clearSelection();
  const source=records.length>1?'survey-map-group-delete':'survey-map-object-delete';
  drawingObjectStore.batch(()=>updates.forEach(record=>drawingObjectStore.set(record)));
  persistSnapshot(source);
  rememberSurveyOperation(getCurrentProject()?.projectId,source,changes);
  const project=getCurrentProject();
  if(project&&!project.isSample)for(const record of updates)await persistDrawingObjectForProject(project,record,source);
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
function paperObjects(drawing){
  return drawingObjectStore.getByDrawingId(drawing.drawingId).filter(o=>o.paperRole||o.legendGroupId);
}
async function ensurePaperLayout(drawing=selectedDrawing(),reset=false){
  if(!drawing)return;
  const existing=paperObjects(drawing);
  if(existing.length&&!reset)return;
  const defaults=paperLayoutFields(drawing);
  const now=Date.now(),source=reset?'survey-map-paper-reset':'survey-map-paper-layout';
  const all=drawingObjectStore.getByDrawingId(drawing.drawingId);
  let order=Math.max(0,...all.map(o=>Number(o.order)||0));
  const changes=[];
  const updates=defaults.map(fields=>{
    const previous=existing.find(o=>o.paperRole===fields.paperRole);
    const updatedFields=reset&&previous?{x:fields.x,y:fields.y}:fields;
    const next=createDrawingObject({
      ...previous,
      objectId:previous?.objectId||newObjectId(),drawingId:drawing.drawingId,
      layer:fields.type==='shape'?DRAWING_LAYERS.SHAPE:DRAWING_LAYERS.TEXT,
      order:previous?.order||++order,visible:true,locked:false,deleted:false,rotation:0,
      ...updatedFields,
      fieldEditedAt:touchFieldEditedAt(previous?.fieldEditedAt||{},Object.keys(updatedFields),now)
    });
    changes.push({type:'drawingObject',before:previous||null,after:next});
    return next;
  });
  drawingObjectStore.batch(()=>updates.forEach(o=>drawingObjectStore.set(o)));
  persistSnapshot(source);
  rememberSurveyOperation(getCurrentProject()?.projectId,source,changes);
  const project=getCurrentProject();
  if(project&&!project.isSample){
    for(const next of updates)await persistDrawingObjectForProject(project,next,source);
  }
  renderSurveyMap();
}
function selectLegend(){
  const drawing=selectedDrawing();
  if(!drawing)return;
  const ids=paperObjects(drawing).filter(o=>o.legendGroupId==='legend').map(o=>o.objectId);
  selectedObjectIds=new Set(ids);
  selectedObjectId=ids.at(-1)||'';
  activeTool='select';
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
  await ensurePaperLayout(record);
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
  const label=paperObjects(current).find(o=>o.paperRole==='name');
  if(label){
    await commitDrawingObject(createDrawingObject({...label,text,
      fieldEditedAt:touchFieldEditedAt(label.fieldEditedAt,'text',now)}),
      'survey-map-paper-name-change');
  }
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
  applyLayoutClasses();
  renderSurveyMap();
}

function applyLayoutClasses(){
  document.body.classList.toggle('survey-map-focus-mode',focusMode);
}

function svgIcon(name){
  // Survey drawing-specific pictograms share one 24px viewBox.
  const icons={
    select:'<path d="M5 3l13 9-6 1 3 6-3 1-3-6-4 4z"/>',
    range:'<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
    line:'<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.3" fill="currentColor"/><circle cx="20" cy="4" r="1.3" fill="currentColor"/>',
    correct:'<path d="M3 19Q7 3 11 13T21 5" stroke-dasharray="2 3" opacity=".5"/><path d="M3 19L11 13L21 5"/>',
    hand:'<path d="M3 19Q6 3 10 12T16 12T21 5"/><path d="M14 19l4-4 3 3-4 4-4 1z"/>',
    elbow:'<path d="M4 5H12V19H20"/><circle cx="4" cy="5" r="1.2" fill="currentColor"/><circle cx="20" cy="19" r="1.2" fill="currentColor"/>',
    room:'<rect x="5" y="3" width="14" height="18"/><path d="M10 3v18M14 12h2"/>',
    material:'<rect x="2" y="4" width="20" height="16" rx="1"/><rect x="4" y="6" width="16" height="12" fill="#fef08a" stroke="none"/><path d="M6 10H18M6 13H15M6 16H18" stroke="#b91c1c"/>',
    sample:'<circle cx="12" cy="12" r="7" fill="#dc2626" stroke="#dc2626"/>',
    'sample-set':'<circle cx="5" cy="5" r="3" fill="#dc2626"/><path d="M8 5h5v13h3"/><rect x="16" y="13" width="7" height="9"/>',
    pen:'<path d="M4 19L18 5l2 2L6 21H4zM13 9l4 4"/>',
    'room-area':'<rect x="4" y="4" width="16" height="16" stroke="#dc2626" stroke-dasharray="3 2"/>',
    text:'<rect x="2" y="4" width="20" height="16" rx="1"/><path d="M6 8h12M12 8v9M9 17h6"/>',
    eyedrop:'<path d="M15 4l5 5-9 9H6v-5z"/><path d="M13 6l5 5"/>',
    rect:'<rect x="4" y="5" width="16" height="14"/>',
    circle:'<circle cx="12" cy="12" r="8"/>',
    triangle:'<path d="M5 19V5l14 14z"/>',
    lshape:'<path d="M4 4h8v9h8v7H4z"/>',
    tshape:'<path d="M3 4h18v8h-6v9H9v-9H3z"/>',
    cross:'<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>',
    concave:'<path d="M3 4h18v17h-7V11H9v10H3z"/>',
    polygon:'<path d="M8 3l10 3 4 9-8 7-11-5L4 8z"/>',
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
    attr:disabled?'':`data-survey-draw-tool="${escapeHtml(toolName)}" aria-pressed="${activeTool===toolName}"`
  })}</div>`;
}

function roomPickerHtml(){
  return `<div class="survey-map-room-picker survey-map-room-controls">
    <button type="button" class="btn small" data-survey-room-area-step="-1" aria-label="前の階・エリア">◀</button>
    <span class="survey-map-room-area-label">${escapeHtml(roomAreaOf(selectedRoomNumber())||'自由')}</span>
    <button type="button" class="btn small" data-survey-room-area-step="1" aria-label="次の階・エリア">▶</button>
    <button type="button" class="btn small" data-survey-room-number-step="-1" aria-label="前の番号">−</button>
    <input id="survey-map-room-choice" data-survey-room-choice type="text" value="${escapeHtml(selectedRoomNumber())}" aria-label="部屋No.を自由入力">
    <button type="button" class="btn small" data-survey-room-number-step="1" aria-label="次の番号">＋</button>
  </div>`;
}
const TOOL_CATEGORIES={
  '作図':[['rect','四角'],['circle','丸'],['triangle','直角三角'],['lshape','L字'],['tshape','T字'],['cross','十字'],['concave','凹字'],['polygon','多角形'],['line','直線'],['correct','手書き線'],['room-area','部屋分け']],
  '採取':[['sample','マーカー'],['elbow','カギ線'],['material','建材ボックス'],['pen','ペン'],['sample-set','採取セット']],
  '調査':[['room','部屋No.'],['room-area','部屋分け'],['pen','ペン']],
  'テキスト':[['text','テキスト']]
};
function toolsHtml(){
  const entries=TOOL_CATEGORIES[toolCategory]||TOOL_CATEGORIES['採取'];
  const figureTools=['rect','circle','triangle','lshape','tshape','cross','concave','polygon'];
  const visible=toolCategory==='作図'?entries.filter(([name])=>!figureTools.includes(name)):entries;
  const selectedShape=figureTools.includes(activeTool)?activeTool:null;
  const shapesButton=toolCategory==='作図'?'<div class="survey-map-tool-cell">'+
    iconButton({icon:selectedShape||lastShapeTool,label:'図形を選択',attr:'data-survey-shapes-toggle',active:Boolean(selectedShape)})+'</div>':'';
  const options=toolCategory==='作図'?roomDashSelect(roomAreaDash,'data-survey-room-dash'):toolCategory==='採取'?'<label class="survey-map-toolbar-option">建材 <select data-survey-material-choice>'+
    availableMaterials().map(m=>'<option value="'+escapeHtml(m.materialId)+'" '+(m.materialId===selectedMaterial()?.materialId?'selected':'')+'>'+escapeHtml(String(m.materialNo||m.inputId||'')+' '+String(m.name||''))+'</option>').join('')+
    '</select></label>':toolCategory==='調査'?roomPickerHtml()+roomDashSelect(roomAreaDash,'data-survey-room-dash'):'';
  const polygonActions=polygonDraft?.points?.length?'<div class="survey-map-polygon-actions"><span>'+polygonDraft.points.length+'点</span><button class="btn small" data-survey-polygon-finish>確定</button><button class="btn small" data-survey-polygon-cancel>取消</button></div>':'';
  return '<div class="survey-map-toolbar-tools">'+shapesButton+visible.map(([icon,label])=>toolIconCell(icon,label,icon,false)).join('')+polygonActions+options+'</div>';
}
function shapeMenuHtml(){
  if(!shapeMenuOpen||toolCategory!=='作図')return '';
  const figs=TOOL_CATEGORIES['作図'].filter(([name])=>['rect','circle','triangle','lshape','tshape','cross','concave','polygon'].includes(name));
  return '<div class="survey-map-shape-popup" role="group" aria-label="図形一覧">'+figs.map(([icon,label])=>iconButton({icon,label,attr:'data-survey-draw-tool="'+icon+'"',active:activeTool===icon})).join('')+'</div>';
}
function sheetHtml(drawing){
  if(!drawing){
    return '<div class="survey-map-empty">図面ボタンから<br>新規調査図を作成してください</div>';
  }
  const title=escapeHtml(drawing.titleSettings?.text||'調査図');
  const name=escapeHtml(drawing.nameSettings?.text||drawing.name||'');
  const rawObjects=drawingObjectStore.getByDrawingId(drawing.drawingId);
  const byId=new Map(rawObjects.filter(o=>!o.deleted).map(o=>[o.objectId,o]));
  const objects=rawObjects.map(o=>{
    if(o.type==='line')return resolveConnectedLine(o,byId);
    if(o.type!=='shape'||o.shapeType!=='rect'||!o.materialId)return o;
    const material=materialRecordStore.get(o.materialId);
    if(!material)return o;
    const kind=/みなし/.test(material.analysisRequired||'')?'assumed':
      /含有/.test(material.analysisResult||'')&&!/なし|不検出/.test(material.analysisResult||'')?'positive':'none';
    const palette=materialPalette(kind);
    return {...o,materialKind:kind,textColor:palette.textColor,strokeColor:palette.strokeColor,
      fillEnabled:Boolean(palette.backgroundEnabled),fillColor:palette.backgroundColor,fillOpacity:1};
  });
  const hasPaper=objects.some(o=>o.paperRole&&!o.deleted);
  const draft=polygonDraft?.drawingId===drawing.drawingId?polygonDraft.points:[];
  const size=pageSize(drawing);
  const gridHtml=gridVisible?`<svg class="survey-map-grid-lines" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${Array.from({length:Math.floor(size.width/gridSpacing)+1},(_,i)=>`M ${i*gridSpacing} 0 V ${size.height}`).join(' ')} ${Array.from({length:Math.floor(size.height/gridSpacing)+1},(_,i)=>`M 0 ${i*gridSpacing} H ${size.width}`).join(' ')}"/>
  </svg>`:'';
  const draftHtml=draft.length?`<svg class="survey-map-line-draft survey-map-polygon-draft"
    viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none">
    <polyline points="${draft.map(p=>`${p.x},${p.y}`).join(' ')}"></polyline>
    <line class="survey-map-polygon-tail" x1="${draft.at(-1).x}" y1="${draft.at(-1).y}"
      x2="${draft.at(-1).x}" y2="${draft.at(-1).y}"></line>
  </svg>`:'';
  return `
    ${gridHtml}
    ${hasPaper?'':`<div class="survey-map-fixed-title">${title}</div>`}
    <div class="survey-map-object-layer">${drawingObjectsHtml(objects,drawing,selectedObjectIds,strokeEditMode)}${draftHtml}${multiSelectionHandles(drawing,objects)}</div>
    ${regionPreviewMarkup(drawing)}
    ${objects.length?'':'<div class="survey-map-empty">ツール → 四角 を選んで<br>A4上をタップすると配置できます</div>'}
    ${hasPaper?'':`<div class="survey-map-fixed-name">${name}</div><div class="survey-map-fixed-legend"><b>凡例</b><br>採取位置<br>含有 / 含有なし<br>みなし / 対象外</div>`}
  `;
}

function multiSelectionHandles(drawing,objects){
  if(selectedObjectIds.size<2)return '';
  const chosen=objects.filter(o=>selectedObjectIds.has(o.objectId)&&!o.deleted);
  const b=multiBounds(chosen);
  if(!b)return '';
  const size=pageSize(drawing);
  return `<div class="survey-map-group-bounds" style="left:${b.x/size.width*100}%;top:${b.y/size.height*100}%;width:${b.width/size.width*100}%;height:${b.height/size.height*100}%">
    ${['nw','ne','sw','se'].map(c=>`<button class="survey-map-group-handle" type="button" data-survey-group-corner="${c}" aria-label="複数選択を${c}から拡大縮小"></button>`).join('')}
  </div>`;
}
function editorHtml(drawing){
  if(!drawing){
    return '<div class="survey-map-hint">ページを選択すると編集項目が表示されます。</div>';
  }
  const object=selectedObject();
  if(selectedObjectIds.size>1){
    const chosen=Array.from(selectedObjectIds).map(id=>drawingObjectStore.get(id)).filter(Boolean);
    const canMerge=chosen.length>=2&&chosen.every(r=>r.type==='shape');
    const canSplit=chosen.length===2&&chosen.filter(r=>r.type==='shape').length===1&&chosen.filter(r=>r.type==='line').length===1;
    return `<div class="survey-map-hint"><b>${selectedObjectIds.size}個のオブジェクトを選択中</b><br>ドラッグでまとめて移動、四隅のハンドルで拡大縮小できます。</div>
      <div class="survey-map-edit-mode-row"><button type="button" class="btn small" data-survey-region-start="merge" ${canMerge?'':'disabled'}>統合</button><button type="button" class="btn small" data-survey-region-start="split" ${canSplit?'':'disabled'}>分割</button></div>
      <button type="button" class="btn danger" data-survey-object-delete style="width:100%">選択オブジェクトをまとめて削除</button>`;
  }
  if(object){
    const modeControls=(object.type==='line' && Array.isArray(object.points) && !object.elbow) || (object.type==='shape' && !['circle','rect'].includes(object.shapeType))
      ? `<div class="survey-map-editor-row"><label>編集モード</label>
        <div class="survey-map-edit-mode-row">
          <button type="button" class="btn small ${strokeEditMode==='shape'?'active':''}"
            data-survey-stroke-edit-mode="shape">図形編集</button>
          <button type="button" class="btn small ${strokeEditMode==='points'?'active':''}"
            data-survey-stroke-edit-mode="points">頂点編集</button>
        </div></div>`:'';
    const dashControls=object.type==='shape'&&['fine','normal','dash','solid'].includes(object.strokeDash)
      ? roomDashSelect(object.strokeDash,'data-survey-object-dash'):'';
    const styleControls=object.type==='shape'&&object.materialId
      ? '<div class="survey-map-hint">建材の色は分析結果・判定から自動反映されます。</div>'
      : object.type==='line'||object.type==='shape'
      ? `<div class="survey-map-divider"></div>
        <div class="survey-map-editor-row"><label>線の色</label>
          <input type="color" data-survey-style-field="color"
            value="${escapeHtml(object.type==='line'?object.lineColor||'#334155':object.strokeColor||'#334155')}"></div>
        <div class="survey-map-editor-row"><label>線の太さ</label>
          <input type="number" min="20" max="500" step="20" data-survey-style-field="width"
            value="${Number(object.type==='line'?object.lineWidth||80:object.strokeWidth||80)}"></div>
        ${object.type==='line'&&object.closed?`<label class="survey-map-fill-toggle"><input type="checkbox" data-survey-style-field="lineEnabled" ${object.lineEnabled!==false?'checked':''}> 枠線を表示</label>`:''}
        ${(object.type==='shape'||(object.type==='line'&&object.closed))?`
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
      ${object.type==='line'||object.type==='shape'?`<div class="survey-map-editor-row"><label>回転・反転（単体選択）</label>
        <div class="survey-map-edit-mode-row">
          <button type="button" class="btn small" data-survey-transform="ccw">左90°</button>
          <button type="button" class="btn small" data-survey-transform="cw">右90°</button>
          <button type="button" class="btn small" data-survey-transform="flipX">左右反転</button>
          <button type="button" class="btn small" data-survey-transform="flipY">上下反転</button>
        </div>
        <label>回転角度（°）</label>
        <input type="number" step="1" data-survey-angle value="${Math.round(Number(object.rotation)||0)}">
      </div>` : ''}
      ${styleControls}
      ${dashControls}
      ${(isLabelType(object.type)||(object.type==='shape'&&object.shapeType==='rect'))?labelEditorHtml(object):''}
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
    <div class="survey-map-paper-actions"><button type="button" class="btn small" data-survey-paper-layout>紙面レイアウト配置</button><button type="button" class="btn small" data-survey-legend-select>凡例をまとめて選択</button><button type="button" class="btn small" data-survey-paper-reset>紙面位置を初期化</button></div>
    <div class="survey-map-hint">図形を選択すると、位置・サイズ・回転の情報を表示します。</div>
    <div class="survey-map-divider"></div>
    <button type="button" class="btn danger" data-survey-delete-current style="width:100%" ${activeDrawings().length<=1?'disabled title="最後の1枚は削除できません"':''}>この調査図を削除</button>
  `;
}

function compactEditHtml(drawing){
  if(!drawing)return '';
  if(!selectedObjectIds.size)return '<button class="btn small survey-map-detail-button" data-survey-drawing-settings>図面設定</button>';
  const object=selectedObject();if(!object)return '';
  const isLine=object.type==='line',isShape=object.type==='shape';
  const isMaterial=isShape&&Boolean(object.materialId);
  const isText=isShape&&object.shapeType==='rect'&&object.text!==undefined&&!isMaterial;
  const color=(label,field,value)=>'<label class="survey-map-compact-color" title="'+label+'"><span>'+label+'</span><input type="color" '+field+' value="'+escapeHtml(value)+'"></label>';
  const number=(label,field,value)=>'<label class="survey-map-compact-number"><span>'+label+'</span><input type="number" '+field+' value="'+Number(value||0)+'"></label>';
  let html='';
  if(isText||isMaterial||object.type==='roomLabel'){
    html+=number('文字pt','data-survey-label-field="fontSize" min="1" step=".5"',object.fontSize||6);
    if(!isMaterial)html+=color('文字色','data-survey-label-field="textColor"',object.textColor||'#111111');
  }
  if(isLine||isShape){
    if(!isMaterial){
      html+=number(isText?'枠太さ':'線幅','data-survey-style-field="width" min="20" max="500" step="20"',isLine?object.lineWidth||80:object.strokeWidth||80);
      const dash=isLine?object.lineStyle||'solid':object.strokeDash||'solid';
      const options=isLine?[['solid','━━━━'],['dash','┄┄┄'],['dot','····']]:[['solid','━━━━'],['fine','····'],['normal','┄┄┄'],['dash','━ ━']];
      html+='<label class="survey-map-compact-dash"><span>線種</span><select data-survey-compact-dash="'+(isLine?'line':'shape')+'">'+options.map(([v,label])=>'<option value="'+v+'" '+(dash===v?'selected':'')+'>'+label+'</option>').join('')+'</select></label>';
      html+=color(isText?'枠色':'線色','data-survey-style-field="color"',isLine?object.lineColor||'#334155':object.strokeColor||'#334155');
      if(isLine&&object.closed){html+='<label class="survey-map-compact-check"><input type="checkbox" data-survey-style-field="lineEnabled" '+(object.lineEnabled!==false?'checked':'')+'>枠</label>';html+=color('塗色','data-survey-style-field="fillColor"',object.fillColor||'#93c5fd');html+='<label class="survey-map-compact-check"><input type="checkbox" data-survey-style-field="fill" '+(object.fillEnabled?'checked':'')+'>塗</label>';}
      if(isShape){
        html+='<label class="survey-map-compact-check"><input type="checkbox" data-survey-style-field="lineEnabled" '+(object.lineEnabled!==false?'checked':'')+'>枠</label>';
        html+=color(isText?'背景色':'塗色','data-survey-style-field="fillColor"',object.fillColor||'#ffffff');
        html+='<label class="survey-map-compact-check"><input type="checkbox" data-survey-style-field="fill" '+(object.fillEnabled?'checked':'')+'>塗</label>';
      }
    }
  }
  return '<div class="survey-map-compact-edit">'+html+'</div><button class="btn small survey-map-detail-button" data-survey-drawing-settings>詳細</button>';
}
function drawingSettingsHtml(drawing){
  if(!drawingSettingsOpen)return '';
  return '<div class="survey-map-settings-popover"><div class="survey-map-settings-heading"><strong>'+(selectedObjectIds.size?'詳細設定':'図面設定')+'</strong><button type="button" class="btn small" data-survey-drawing-settings>閉じる</button></div><div class="survey-map-settings-fields">'+editorHtml(drawing)+'</div></div>';
}
function surveySheetWidth(){
  const percent=Math.round(zoomLevel*100);
  if(!focusMode)return 'min('+percent+'%,'+Math.round(1180*zoomLevel)+'px)';
  // At 100%, fit the sheet to the fullscreen viewport; above 100%, allow overflow.
  const heightRatio=Number((zoomLevel*297/210).toFixed(5));
  return 'min('+percent+'%,calc((100dvh - 195px) * '+heightRatio+'))';
}
function updateSurveyZoom(value,center=null){
  const stage=root()?.querySelector('.survey-map-stage');
  const sheet=stage?.querySelector('.survey-map-sheet');
  const before=sheet?.getBoundingClientRect();
  const stageRect=stage?.getBoundingClientRect();
  const oldScrollX=stage?.scrollLeft||0,oldScrollY=stage?.scrollTop||0;
  const focus=center||(stageRect?{x:stageRect.left+stageRect.width/2,y:stageRect.top+stageRect.height/2}:null);
  const beforeX=before&&focus?(focus.x-before.left)/Math.max(1,before.width):.5;
  const beforeY=before&&focus?(focus.y-before.top)/Math.max(1,before.height):.5;
  const desired=Math.max(.5,Math.min(3,Math.round(value*100)/100));
  if(Math.abs(desired-zoomLevel)<.005)return;
  zoomLevel=desired;
  renderSurveyMap();
  const updated=root()?.querySelector('.survey-map-stage');
  const updatedSheet=updated?.querySelector('.survey-map-sheet');
  const nextRect=updatedSheet?.getBoundingClientRect();
  if(updated&&updatedSheet&&nextRect&&focus){
    const rect=updated.getBoundingClientRect();
    const padX=focus.x-rect.left,padY=focus.y-rect.top;
    updated.scrollLeft+=beforeX*nextRect.width+nextRect.left-focus.x;
    updated.scrollTop+=beforeY*nextRect.height+nextRect.top-focus.y;
    if(!Number.isFinite(updated.scrollLeft))updated.scrollLeft=oldScrollX;
    if(!Number.isFinite(updated.scrollTop))updated.scrollTop=oldScrollY;
  }
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
  if(!mount||inlineTextEdit)return;
  applyLayoutClasses();
  const drawing=selectedDrawing();
  const history=historyStatus(getCurrentProject()?.projectId);
  const oldStage=mount.querySelector('.survey-map-stage');
  const scroll=oldStage?{drawingId:oldStage.dataset.drawingId,x:oldStage.scrollLeft,y:oldStage.scrollTop,width:oldStage.scrollWidth,height:oldStage.scrollHeight}:null;

  mount.innerHTML=`
    <div class="survey-map-root"><main class="survey-map-center">
        <div class="survey-map-topbar" aria-label="調査図操作">
          ${iconButton({icon:focusMode?'exitfullscreen':'fullscreen',label:focusMode?'全画面終了':'全画面',attr:'data-survey-focus-toggle',active:focusMode})}
          ${iconButton({icon:'undo',label:'戻る',attr:'data-survey-undo',disabled:!history.undo})}
          ${iconButton({icon:'redo',label:'進む',attr:'data-survey-redo',disabled:!history.redo})}
          ${iconButton({icon:'plus',label:'図面一覧・追加',attr:'data-survey-pages-toggle',active:pagesOpen})}
          ${iconButton({icon:'grid',label:'グリッド',attr:'data-survey-grid',active:gridVisible})}
          <div class="survey-map-zoom-bar"><button type="button" class="btn small" data-survey-zoom-out aria-label="縮小">−</button><button type="button" class="btn small survey-map-zoom-readout" data-survey-zoom-reset title="100%に戻す">${Math.round(zoomLevel*100)}%</button><button type="button" class="btn small" data-survey-zoom-in aria-label="拡大">＋</button><button type="button" class="btn small" data-survey-zoom-fit>Fit</button></div>
          <span class="survey-map-topbar-separator"></span>
          ${Object.keys(TOOL_CATEGORIES).map(category=>`<button type="button" class="btn small survey-map-text-btn ${toolCategory===category?'active':''}" data-survey-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}
          <span class="survey-map-topbar-separator"></span>
          ${iconButton({icon:'select',label:'選択',attr:'data-survey-draw-tool="select"',active:activeTool==='select'})}
          ${iconButton({icon:'range',label:'範囲選択',attr:'data-survey-draw-tool="range"',active:activeTool==='range'})}
          ${iconButton({icon:'eyedrop',label:'色コピー',attr:'data-survey-draw-tool="eyedrop"',active:activeTool==='eyedrop'})}
        </div>
        <section class="survey-map-workbar" aria-label="ツールと編集">
          <div class="survey-map-workbar-left">${toolsHtml()}</div>
          <div class="survey-map-workbar-right">${compactEditHtml(drawing)}</div>
          ${shapeMenuHtml()}
          ${drawingSettingsHtml(drawing)}
        </section>
        <div class="survey-map-stage" data-drawing-id="${escapeHtml(drawing?.drawingId||'')}">
        ${pagesPopoverHtml()}
        <div class="survey-map-sheet ${gridVisible?'grid-on':''} ${activeTool!=='select'?'drawing-mode':''}" style="width:${surveySheetWidth()};--survey-grid-x:${gridSpacing/pageSize(drawing).width*100}%;--survey-grid-y:${gridSpacing/pageSize(drawing).height*100}%">${sheetHtml(drawing)}</div>
      </div>
    </main>
    <button type="button" class="survey-map-shift-button ${shiftActive()?'active':''} ${shiftMoveMode?'moving':''}" style="${shiftButtonPositionStyle()}" data-survey-shift aria-pressed="${shiftLatched}" aria-label="Shift: タップで固定、長押しで一時、ダブルタップで移動">${shiftMoveMode?'完了':shiftActive()?'Shift ON':'Shift'}</button>
    </div>`;
  const stage=mount.querySelector('.survey-map-stage');
  if(stage&&scroll&&scroll.drawingId===(drawing?.drawingId||'')){
    stage.scrollLeft=scroll.x;
    stage.scrollTop=scroll.y;
  }
}

async function commitChangedObject(current,draft,source){
  if(!current)return;
  const keys=['x','y','width','height','rotation','points','startX','startY','endX','endY','bendX','elbow','flipX','flipY'];
  const changed=keys.filter(key=>JSON.stringify(current[key])!==JSON.stringify(draft[key]));
  if(!changed.length)return;
  const next=createDrawingObject({...current,...draft,fieldEditedAt:touchFieldEditedAt(current.fieldEditedAt,changed,Date.now())});
  await commitDrawingObject(next,source);
}
function bindEvents(){
  const mount=root();
  if(!mount) return;

  // Two-finger viewport manipulation, independent from object geometry.
  mount.addEventListener('pointerdown',(event)=>{
    if(event.pointerType!=='touch'||!event.target.closest('.survey-map-sheet'))return;
    touchPoints.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(touchPoints.size!==2)return;
    pendingTouchCreate=null;
    const interaction=pointerInteraction;
    if(interaction?.previewEl)interaction.previewEl.remove();
    pointerInteraction=null;
    clearSmartGuides();
    const stage=mount.querySelector('.survey-map-stage');
    const sheet=stage?.querySelector('.survey-map-sheet');
    const pts=Array.from(touchPoints.values());
    const x=(pts[0].x+pts[1].x)/2,y=(pts[0].y+pts[1].y)/2;
    pinchGesture={initialDistance:Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)),
      startCenter:{x,y},initialZoom:zoomLevel,initialScrollX:stage?.scrollLeft||0,initialScrollY:stage?.scrollTop||0,
      initialWidth:sheet?.getBoundingClientRect().width||1,initialHeight:sheet?.getBoundingClientRect().height||1,
      sheetLeft:sheet?.getBoundingClientRect().left||0,sheetTop:sheet?.getBoundingClientRect().top||0,
      stageLeft:stage?.getBoundingClientRect().left||0,stageTop:stage?.getBoundingClientRect().top||0};
    event.preventDefault();
  },true);
  window.addEventListener('pointermove',(event)=>{
    if(event.pointerType!=='touch'||!touchPoints.has(event.pointerId))return;
    touchPoints.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(!pinchGesture||touchPoints.size<2)return;
    const pts=Array.from(touchPoints.values());
    const x=(pts[0].x+pts[1].x)/2,y=(pts[0].y+pts[1].y)/2;
    const distance=Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y));
    const gesture=pinchGesture;
    const desired=Math.max(.5,Math.min(3,Math.round(gesture.initialZoom*distance/gesture.initialDistance*100)/100));
    if(desired!==zoomLevel){
      zoomLevel=desired;
      const liveSheet=mount.querySelector('.survey-map-sheet');
      if(liveSheet)liveSheet.style.width=surveySheetWidth();
      const readout=mount.querySelector('.survey-map-zoom-readout');
      if(readout)readout.textContent=Math.round(zoomLevel*100)+'%';
    }
    const stage=mount.querySelector('.survey-map-stage');
    const sheet=stage?.querySelector('.survey-map-sheet');
    if(stage&&sheet){
      const width=sheet.getBoundingClientRect().width,height=sheet.getBoundingClientRect().height;
      const scaleX=width/gesture.initialWidth,scaleY=height/gesture.initialHeight;
      stage.scrollLeft=gesture.initialScrollX+(gesture.startCenter.x-gesture.sheetLeft)*(scaleX-1)-(x-gesture.startCenter.x);
      stage.scrollTop=gesture.initialScrollY+(gesture.startCenter.y-gesture.sheetTop)*(scaleY-1)-(y-gesture.startCenter.y);
    }
    event.preventDefault();
  },{capture:true,passive:false});
  const endTouchGesture=(event)=>{
    if(event.pointerType!=='touch'||!touchPoints.has(event.pointerId))return;
    touchPoints.delete(event.pointerId);
    if(pinchGesture){
      if(!touchPoints.size){pinchGesture=null;renderSurveyMap();}
      pendingTouchCreate=null;
      return;
    }
    const pending=pendingTouchCreate;
    if(pending?.pointerId===event.pointerId){
      pendingTouchCreate=null;
      if(event.type==='pointerup')void pending.create(event.clientX,event.clientY);
    }
  };
  window.addEventListener('pointerup',endTouchGesture,true);
  window.addEventListener('pointercancel',endTouchGesture,true);
  mount.addEventListener('contextmenu',(event)=>{
    if(event.target.closest('.survey-map-shift-button,.survey-map-sheet'))event.preventDefault();
  });
  mount.addEventListener('click',(event)=>{
    if(event.target.closest('[data-survey-region-cancel]')){regionPreview=null;renderSurveyMap();return;}
    if(event.target.closest('[data-survey-region-confirm]')){void confirmRegionOperation();return;}
    const regionButton=event.target.closest('[data-survey-region-start]');
    if(regionButton){startRegionOperation(regionButton.dataset.surveyRegionStart);return;}
    if(regionPreview)return;
    if(event.target.closest('[data-survey-undo]')){void applyHistory(false);return;}
    if(event.target.closest('[data-survey-redo]')){void applyHistory(true);return;}
    if(event.target.closest('[data-survey-new]')){
      void createDrawing();
      return;
    }

    const pageButton=event.target.closest('[data-survey-page]');
    if(pageButton){
      selectedDrawingId=String(pageButton.dataset.surveyPage||'');
      selectedRoomKey='';
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

    const categoryButton=event.target.closest('[data-survey-category]');
    if(categoryButton){
      toolCategory=categoryButton.dataset.surveyCategory;
      shapeMenuOpen=false;drawingSettingsOpen=false;
      renderSurveyMap();return;
    }
    if(event.target.closest('[data-survey-shapes-toggle]')){
      shapeMenuOpen=!shapeMenuOpen;renderSurveyMap();return;
    }
    if(event.target.closest('[data-survey-drawing-settings]')){
      drawingSettingsOpen=!drawingSettingsOpen;
      renderSurveyMap();
      return;
    }
    const drawTool=event.target.closest('[data-survey-draw-tool]');
    if(drawTool){
      const requested=String(drawTool.dataset.surveyDrawTool||'select');
      pendingConnectionStart=null;
      const hadPolygonDraft=requested!=='polygon'&&polygonDraft!==null;
      if(hadPolygonDraft)polygonDraft=null;
      // A single selected tool controls placement; all creation tools remain active.
      if(inlineTextEdit)inlineTextEdit.resumeTool='';
      activeTool=requested;
      if(isShapeTool(requested)||requested==='polygon')lastShapeTool=requested;
      shapeMenuOpen=false;
      renderSurveyMap();
      return;
    }

    const areaStep=event.target.closest('[data-survey-room-area-step]');
    if(areaStep){stepRoomArea(Number(areaStep.dataset.surveyRoomAreaStep));renderSurveyMap();return;}
    const roomStep=event.target.closest('[data-survey-room-number-step]');
    if(roomStep){stepRoomNumber(Number(roomStep.dataset.surveyRoomNumberStep));renderSurveyMap();return;}
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
    const transformButton=event.target.closest('[data-survey-transform]');
    if(transformButton){
      const mode=transformButton.dataset.surveyTransform;
      const record=selectedObject();
      if(!record||selectedObjectIds.size!==1||!['line','shape'].includes(record.type))return;
      const updated=mode==='cw'?rotateSingleObject(record,90):
        mode==='ccw'?rotateSingleObject(record,-90):
        flipSingleObject(record,mode==='flipX'?'horizontal':'vertical');
      void commitChangedObject(record,updated,'survey-map-transform').then(()=>renderSurveyMap());
      return;
    }
    if(event.target.closest('[data-survey-paper-layout]')){void ensurePaperLayout();return;}
    if(event.target.closest('[data-survey-paper-reset]')){void ensurePaperLayout(selectedDrawing(),true);return;}
    if(event.target.closest('[data-survey-legend-select]')){selectLegend();return;}
    if(event.target.closest('[data-survey-object-delete]')){
      void deleteSelectedObject();
      return;
    }

    if(event.target.closest('[data-survey-zoom-out]')){
      updateSurveyZoom(zoomLevel-.25);
      return;
    }
    if(event.target.closest('[data-survey-zoom-in]')){
      updateSurveyZoom(zoomLevel+.25);
      return;
    }
    if(event.target.closest('[data-survey-zoom-reset]') || event.target.closest('[data-survey-zoom-fit]')){
      updateSurveyZoom(1);
      return;
    }

    if(event.target.closest('[data-survey-grid]')){
      gridVisible=!gridVisible;
      renderSurveyMap();
      return;
    }
  });

  mount.addEventListener('pointerdown',(event)=>{
    if(event.pointerType==='touch'&&(pinchGesture||touchPoints.size>=2)){event.preventDefault();return;}
    if(inlineTextEdit){
      if(event.target.closest('.survey-map-inline-textarea'))return;
      inlineTextEdit.input.blur();
      return;
    }
    const shiftButton=event.target.closest('[data-survey-shift]');
    if(shiftButton){
      if(shiftGesture)return;
      const start={x:event.clientX,y:event.clientY};
      shiftGesture={pointerId:event.pointerId,start,move:shiftMoveMode,long:false,moved:false,timer:null,
        initialPosition:shiftPosition||{left:16,bottom:18}};
      if(!shiftMoveMode){
        shiftGesture.timer=setTimeout(()=>{
          if(shiftGesture?.pointerId!==event.pointerId||shiftGesture.moved)return;
          shiftGesture.long=true;
          shiftPointerId=event.pointerId;
          syncShiftButton();
        },450);
      }
      shiftButton.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if(regionPreview)return;
    const drawing=selectedDrawing();
    const sheet=event.target.closest('.survey-map-sheet');
    if(!drawing || !sheet) return;

    if(activeTool==='range'){
      const sheetRect=sheet.getBoundingClientRect();
      const start=pagePointer(event.clientX,event.clientY,sheetRect,drawing,{snap:false});
      const overlay=document.createElement('div');
      overlay.className='survey-map-range-preview';
      sheet.appendChild(overlay);
      pointerInteraction={pointerId:event.pointerId,mode:'range-select',startPoint:start,sheetRect,previewEl:overlay};
      sheet.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const groupHandle=event.target.closest('[data-survey-group-corner]');
    if(groupHandle && activeTool==='select' && selectedObjectIds.size>1){
      const originals=Array.from(selectedObjectIds).map(id=>drawingObjectStore.get(id)).filter(o=>o&&!o.deleted);
      const bounds=multiBounds(originals);
      pointerInteraction={pointerId:event.pointerId,mode:'group-resize',corner:groupHandle.dataset.surveyGroupCorner,
        groupOriginals:originals,groupDrafts:originals,startPoint:pagePointer(event.clientX,event.clientY,sheet.getBoundingClientRect(),drawing),
        original:{...bounds},sheetRect:sheet.getBoundingClientRect()};
      groupHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault();return;
    }
    const objectEl=event.target.closest('[data-survey-object-id]');
    if(objectEl && activeTool==='select'){
      const targetRecord=drawingObjectStore.get(String(objectEl.dataset.surveyObjectId||''));
      const isFreeText=targetRecord?.type==='shape'&&targetRecord.shapeType==='rect'&&targetRecord.text!==undefined&&!targetRecord.materialId;
      if(isFreeText&&!event.target.closest('[data-survey-handle]')){
        const now=Date.now();
        const doubleTouch=event.pointerType==='touch'&&lastTextTouch?.id===targetRecord.objectId&&now-lastTextTouch.at<420;
        lastTextTouch={id:targetRecord.objectId,at:now};
        if(doubleTouch){startInlineTextEdit(targetRecord.objectId);event.preventDefault();return;}
      }

      const objectId=String(objectEl.dataset.surveyObjectId||'');
      const rawObject=drawingObjectStore.get(objectId);
      const object=rawObject?.type==='line'?resolveConnectedLine(rawObject,new Map(drawingConnectionObjects(drawing).map(o=>[o.objectId,o]))):rawObject;
      if(!object || object.locked) return;
      const additive=shiftActive()||event.shiftKey||event.ctrlKey||event.metaKey;
      const handle=event.target.closest('[data-survey-handle]')?.dataset?.surveyHandle || '';
      if(additive && !handle){
        if(selectedObjectIds.has(objectId)){
          selectedObjectIds.delete(objectId);
          selectedObjectId=Array.from(selectedObjectIds).at(-1)||'';
        }else{
          selectedObjectIds.add(objectId);
          selectedObjectId=objectId;
        }
        renderSurveyMap();
        event.preventDefault();
        return;
      }
      const groupMove=!handle && selectedObjectIds.size>1 && selectedObjectIds.has(objectId);
      if(!groupMove)selectOnly(objectId);
      const mode=groupMove?'group-move':object.elbow
        ? (handle==='stroke-rotate'?'stroke-rotate':handle==='line-start'?'elbow-start':handle==='line-end'?'elbow-end':handle==='elbow-bend'?'elbow-bend':'elbow-move')
        : object.type==='line' && Array.isArray(object.points) && object.points.length>1
        ? (handle.startsWith('stroke-resize-')?'stroke-resize':
          handle==='stroke-rotate'?'stroke-rotate':
          handle==='stroke-point'?'stroke-point':'stroke-move')
        : object.type==='line'
        ? (handle==='line-rotate'?'line-rotate':handle==='line-start'?'line-start':handle==='line-end'?'line-end':'line-move')
        : (handle.startsWith('resize-')?'resize-corner':
          handle==='shape-vertex'?'shape-vertex':handle==='shape-adjust'?'shape-adjust':
          handle==='resize'?'resize':handle==='rotate'?'rotate':'move');
      const sheetRect=sheet.getBoundingClientRect();
      const startPoint=pagePointer(event.clientX,event.clientY,sheetRect,drawing);
      pointerInteraction={
        pointerId:event.pointerId,
        objectId,
        mode,
        corner:handle.startsWith('stroke-resize-')?handle.slice(14):handle.startsWith('resize-')?handle.slice(7):'',
        paramKey:handle==='shape-adjust'?String(event.target.closest('[data-survey-param]')?.dataset.surveyParam||''):'',
        original:{...object},
        draft:{...object},
        groupOriginals:groupMove?Array.from(selectedObjectIds).map(id=>drawingObjectStore.get(id)).filter(Boolean):[],
        groupDrafts:[],
        linkedOriginals:!groupMove && object.type==='shape' && object.geometryGroupId
          ?drawingObjectStore.getByDrawingId(object.drawingId).filter(record=>
            record.type==='line'&&record.geometryGroupId===object.geometryGroupId):[],
        linkedDrafts:[],
        startPoint,
        pointIndex:handle==='stroke-point'?Number(event.target.closest('[data-survey-point-index]')?.dataset.surveyPointIndex):-1,
        sheetRect
      };
      objectEl.setPointerCapture?.(event.pointerId);
      if(mode==='shape-adjust')highlightAdjustedEdges(objectEl,object,pointerInteraction.paramKey);
      event.preventDefault();
      return;
    }

    if(activeTool==='sample-set'){
      if(event.pointerType==='touch')pendingTouchCreate={pointerId:event.pointerId,x:event.clientX,y:event.clientY,create:createSampleSetAt};
      else void createSampleSetAt(event.clientX,event.clientY);
      event.preventDefault();
      return;
    }
    if(['room','material','sample','text'].includes(activeTool)){
      const create={room:createRoomLabelAt,material:createMaterialLabelAt,sample:createSampleMarkerAt,text:createFreeTextAt}[activeTool];
      if(event.pointerType==='touch')pendingTouchCreate={pointerId:event.pointerId,x:event.clientX,y:event.clientY,create};
      else void create(event.clientX,event.clientY);
      event.preventDefault();
      return;
    }
    if(activeTool==='elbow' && objectEl){
      const object=drawingObjectStore.get(String(objectEl.dataset.surveyObjectId||''));
      if(canAnchor(object)){
        if(!pendingConnectionStart || pendingConnectionStart.drawingId!==drawing.drawingId){
          pendingConnectionStart={drawingId:drawing.drawingId,objectId:object.objectId};
          objectEl.classList.add('survey-map-connect-pending');
        }else{
          const first=drawingObjectStore.get(pendingConnectionStart.objectId);
          pendingConnectionStart=null;
          if(first && first.objectId!==object.objectId){
            void createConnectedElbow(drawing,first,object).then(()=>renderSurveyMap());
          }else renderSurveyMap();
        }
        event.preventDefault();
        return;
      }
    }
    if(activeTool==='polygon'){
      const sheetRect=sheet.getBoundingClientRect();
      const point=pagePointer(event.clientX,event.clientY,sheetRect,drawing);
      if(!polygonDraft || polygonDraft.drawingId!==drawing.drawingId){
        polygonDraft={drawingId:drawing.drawingId,points:[point]};
      }
      const start=polygonDraft.points.at(-1);
      const previewEl=createLineDraftPreview(sheet,drawing,start);
      pointerInteraction={pointerId:event.pointerId,mode:'create-polygon-edge',
        objectId:'',startPoint:start,downPoint:point,sheetRect,previewEl};
      sheet.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if(isShapeTool(activeTool)||activeTool==='room-area'){
      const sheetRect=sheet.getBoundingClientRect();
      const startPoint=snapCreationPoint(pagePointer(event.clientX,event.clientY,sheetRect,drawing),drawing);
      const previewEl=createLineDraftPreview(sheet,drawing,startPoint);
      previewEl?.querySelector('line')?.remove();
      const previewShape=document.createElementNS('http://www.w3.org/2000/svg',activeTool==='circle'?'ellipse':'rect');
      previewShape.setAttribute('class','survey-map-shape-draft-rect');
      previewEl?.appendChild(previewShape);
      pointerInteraction={pointerId:event.pointerId,mode:'create-shape',kind:activeTool,
        objectId:'',startPoint,sheetRect,previewEl};
      sheet.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if(['line','correct','elbow','hand','pen'].includes(activeTool)){
      if(activeTool==='elbow')pendingConnectionStart=null;
      const sheetRect=sheet.getBoundingClientRect();
      const rawStart=pagePointer(event.clientX,event.clientY,sheetRect,drawing,
        {snap:!['correct','hand','pen'].includes(activeTool)});
      const startPoint=(['correct','hand','pen'].includes(activeTool))?rawStart:snapCreationPoint(rawStart,drawing);
      const previewEl=createLineDraftPreview(sheet,drawing,startPoint);
      pointerInteraction={
        pointerId:event.pointerId,
        objectId:'',
        mode:activeTool==='correct'?'create-corrected':(['hand','pen'].includes(activeTool))?'create-hand':activeTool==='elbow'?'create-elbow':'create-line',
        pen:activeTool==='pen',
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

  mount.addEventListener('dblclick',(event)=>{
    const item=event.target.closest('[data-survey-object-id]');
    const record=item&&drawingObjectStore.get(item.dataset.surveyObjectId);
    if(record?.type==='shape'&&record.shapeType==='rect'&&record.text!==undefined&&!record.materialId){
      startInlineTextEdit(record.objectId);event.preventDefault();
    }
  });
  mount.addEventListener('pointermove',(event)=>{
    if(pinchGesture&&event.pointerType==='touch')return;
    const interaction=pointerInteraction;
    if(!interaction && activeTool==='polygon' && polygonDraft?.points?.length){
      const drawing=selectedDrawing();
      const sheet=mount.querySelector('.survey-map-sheet');
      const tail=sheet?.querySelector('.survey-map-polygon-tail');
      if(drawing && sheet && tail && polygonDraft.drawingId===drawing.drawingId){
        const point=pagePointer(event.clientX,event.clientY,sheet.getBoundingClientRect(),drawing);
        const end=(shiftActive()||event.shiftKey)?snapLinePoint(polygonDraft.points.at(-1),point):point;
        tail.setAttribute('x2',String(end.x));
        tail.setAttribute('y2',String(end.y));
      }
      return;
    }
    if(!interaction || interaction.pointerId!==event.pointerId) return;
    const drawing=selectedDrawing();
    if(!drawing) return;
    const rawPoint=pagePointer(event.clientX,event.clientY,interaction.sheetRect,drawing,{
      snap:interaction.mode!=='create-corrected'&&interaction.mode!=='create-hand'
    });
    const currentPoint=['create-shape','create-line','create-elbow','create-polygon-edge']
      .includes(interaction.mode)?snapCreationPoint(rawPoint,drawing,true):rawPoint;

    if(interaction.mode==='range-select'){
      const a=interaction.startPoint,b=pagePointer(event.clientX,event.clientY,interaction.sheetRect,drawing,{snap:false});
      const size=pageSize(drawing);
      Object.assign(interaction.previewEl.style,{
        left:(Math.min(a.x,b.x)/size.width*100)+'%',
        top:(Math.min(a.y,b.y)/size.height*100)+'%',
        width:(Math.abs(b.x-a.x)/size.width*100)+'%',
        height:(Math.abs(b.y-a.y)/size.height*100)+'%'
      });
      event.preventDefault();return;
    }
    if(interaction.mode==='create-polygon-edge'){
      const point=(shiftActive()||event.shiftKey)?snapLinePoint(interaction.startPoint,currentPoint):currentPoint;
      updateLineDraftPreview(interaction.previewEl,point);
      event.preventDefault();
      return;
    }
    if(interaction.mode==='create-shape'){
      const shape=interaction.previewEl?.querySelector('.survey-map-shape-draft-rect');
      if(shape){
        const bounds=shapeDragBounds(interaction.startPoint,currentPoint,shiftActive()||event.shiftKey);
        if(interaction.kind==='circle'){
          shape.setAttribute('cx',String(bounds.x+bounds.width/2));
          shape.setAttribute('cy',String(bounds.y+bounds.height/2));
          shape.setAttribute('rx',String(bounds.width/2));
          shape.setAttribute('ry',String(bounds.height/2));
        }else{
          shape.setAttribute('x',String(bounds.x));
          shape.setAttribute('y',String(bounds.y));
          shape.setAttribute('width',String(bounds.width));
          shape.setAttribute('height',String(bounds.height));
        }
      }
      event.preventDefault();
      return;
    }
    if(interaction.mode==='create-elbow'){
      updatePolylinePreview(interaction.previewEl,elbowPath(
        interaction.startPoint.x,interaction.startPoint.y,currentPoint.x,currentPoint.y));
      event.preventDefault();
      return;
    }
    if(interaction.mode==='create-corrected' || interaction.mode==='create-hand'){
      const previous=interaction.rawPoints.at(-1);
      if(Math.hypot(currentPoint.x-previous.x,currentPoint.y-previous.y)>=(interaction.pen?5:45)){
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

    if(interaction.mode==='group-resize'){
      const bounds=interaction.original;
      const shifted=shiftActive()||event.shiftKey;
      const resized=resizeRectFromDrag(bounds,interaction.corner,interaction.startPoint,currentPoint,{
        centerFixed:shifted,ratioFixed:false
      });
      const next=alignResizeToGrid(resized,bounds,'resize-corner',interaction.corner,drawing,shifted);
      interaction.groupDrafts=interaction.groupOriginals.map(o=>scaleObjectInGroup(o,bounds,next));
      if(smartGuideEnabled){
        showSmartGuides(alignmentGuides(next,drawingObjectStore.getByDrawingId(drawing.drawingId),
          pageSize(drawing),interaction.groupOriginals.map(o=>o.objectId)),drawing);
      }else clearSmartGuides();
      for(const draft of interaction.groupDrafts){
        const element=mount.querySelector(`[data-survey-object-id="${CSS.escape(draft.objectId)}"]`);
        if(element)paintObjectDraft(element,draft,drawing);
      }
      const outline=mount.querySelector('.survey-map-group-bounds');
      if(outline){
        const size=pageSize(drawing);
        outline.style.left=`${next.x/size.width*100}%`;
        outline.style.top=`${next.y/size.height*100}%`;
        outline.style.width=`${next.width/size.width*100}%`;
        outline.style.height=`${next.height/size.height*100}%`;
      }
      event.preventDefault();return;
    }
    if(interaction.mode==='group-move'){
      const originals=interaction.groupOriginals;
      const size=pageSize(drawing);
      const minX=Math.min(...originals.map(o=>Number(o.x)||0));
      const minY=Math.min(...originals.map(o=>Number(o.y)||0));
      const maxX=Math.max(...originals.map(o=>(Number(o.x)||0)+(Number(o.width)||0)));
      const maxY=Math.max(...originals.map(o=>(Number(o.y)||0)+(Number(o.height)||0)));
      const rawX=minX+currentPoint.x-interaction.startPoint.x;
      const rawY=minY+currentPoint.y-interaction.startPoint.y;
      const anchor=alignPositionToGrid({x:rawX,y:rawY,width:maxX-minX,height:maxY-minY},drawing);
      const dx=anchor.x-minX,dy=anchor.y-minY;
      if(smartGuideEnabled){
        showSmartGuides(alignmentGuides(anchor,drawingObjectStore.getByDrawingId(drawing.drawingId),
          size,originals.map(o=>o.objectId)),drawing);
      }else clearSmartGuides();
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
        const hit=connectionPoint(event,drawing,interaction.sheetRect,original.objectId);
        const p=hit?.point||currentPoint;
        draft=elbowRecordWithPoints({...original,startConnection:hit?{targetObjectId:hit.targetObjectId,anchor:hit.anchor}:null},p.x,p.y,endX,endY,bendX);
      }else if(interaction.mode==='elbow-end'){
        const hit=connectionPoint(event,drawing,interaction.sheetRect,original.objectId);
        const p=hit?.point||currentPoint;
        draft=elbowRecordWithPoints({...original,endConnection:hit?{targetObjectId:hit.targetObjectId,anchor:hit.anchor}:null},startX,startY,p.x,p.y,bendX);
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
      const original=interaction.original,rect=resizeRectFromDrag(original,interaction.corner,interaction.startPoint,currentPoint,{
        centerFixed:shiftActive()||event.shiftKey,ratioFixed:false
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
      draft=strokeRecordWithPoints({...original,elbow:false,
        rotation:(Number(original.rotation)||0)+rotation*180/Math.PI},original.points.map(p=>{
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
    }else if(interaction.mode==='line-rotate'){
      const original=interaction.original;
      const cx=(original.startX+original.endX)/2,cy=(original.startY+original.endY)/2;
      const a0=Math.atan2(interaction.startPoint.y-cy,interaction.startPoint.x-cx);
      const a1=Math.atan2(currentPoint.y-cy,currentPoint.x-cx);
      const delta=(a1-a0)*180/Math.PI;
      draft=rotateSingleObject(original,(shiftActive()||event.shiftKey)?Math.round(delta/15)*15:delta);
    }else if(interaction.mode==='line-start'){
      const hit=connectionPoint(event,drawing,interaction.sheetRect,interaction.original.objectId);
      const p=hit?.point||currentPoint;
      draft=lineRecordWithPoints({...interaction.original,
        startConnection:hit?{targetObjectId:hit.targetObjectId,anchor:hit.anchor}:null},
        p.x,p.y,Number(interaction.original.endX)||0,Number(interaction.original.endY)||0);
    }else if(interaction.mode==='line-end'){
      const hit=connectionPoint(event,drawing,interaction.sheetRect,interaction.original.objectId);
      const p=hit?.point||currentPoint;
      draft=lineRecordWithPoints({...interaction.original,
        endConnection:hit?{targetObjectId:hit.targetObjectId,anchor:hit.anchor}:null},
        Number(interaction.original.startX)||0,Number(interaction.original.startY)||0,p.x,p.y);
    }else if(interaction.mode==='move'){
      const rect=clampObjectRect({
        x:Number(interaction.original.x||0)+dx,
        y:Number(interaction.original.y||0)+dy,
        width:Number(interaction.original.width||0),
        height:Number(interaction.original.height||0)
      },drawing);
      draft={...draft,...alignPositionToGrid(rect,drawing)};
    }else if(interaction.mode==='shape-vertex'){
      const original=interaction.original;
      const center={x:original.x+original.width/2,y:original.y+original.height/2};
      const angle=-(Number(original.rotation)||0)*Math.PI/180;
      const ddx=currentPoint.x-center.x,ddy=currentPoint.y-center.y;
      const localX=center.x+ddx*Math.cos(angle)-ddy*Math.sin(angle);
      const localY=center.y+ddx*Math.sin(angle)+ddy*Math.cos(angle);
      const vertices=shapeVertices(original.shapeType,original.shapeParams,original.customVertices);
      if(interaction.pointIndex>=0 && interaction.pointIndex<vertices.length){
        vertices[interaction.pointIndex]={
          x:clamp(original.flipX?1-(localX-original.x)/Math.max(1,original.width):(localX-original.x)/Math.max(1,original.width),0,1),
          y:clamp(original.flipY?1-(localY-original.y)/Math.max(1,original.height):(localY-original.y)/Math.max(1,original.height),0,1)
        };
        draft.customVertices=vertices;
      }
    }else if(interaction.mode==='shape-adjust'){
      const original=interaction.original;
      const key=interaction.paramKey;
      const adjuster=shapeAdjusters(original.shapeType,original.shapeParams).find(item=>item.key===key);
      if(adjuster){
        const center={x:original.x+original.width/2,y:original.y+original.height/2};
        const angle=-(Number(original.rotation)||0)*Math.PI/180;
        const ddx=currentPoint.x-center.x,ddy=currentPoint.y-center.y;
        const localX=center.x+ddx*Math.cos(angle)-ddy*Math.sin(angle);
        const localY=center.y+ddx*Math.sin(angle)+ddy*Math.cos(angle);
        let ratio=adjuster.axis==='x'?(localX-original.x)/Math.max(1,original.width):
          (localY-original.y)/Math.max(1,original.height);
        if((adjuster.axis==='x'&&original.flipX)||(adjuster.axis==='y'&&original.flipY))ratio=1-ratio;
        draft.shapeParams=updatedShapeParams(original.shapeType,original.shapeParams,key,ratio);
      }
    }else if(interaction.mode==='resize-corner'){
      const shifted=shiftActive()||event.shiftKey;
      const resized=resizeRectFromDrag(interaction.original,interaction.corner,interaction.startPoint,currentPoint,{
        centerFixed:shifted,ratioFixed:false
      });
      draft=alignResizeToGrid(resized,interaction.original,'resize-corner',interaction.corner,drawing,shifted);
    }else if(interaction.mode==='resize'){
      const rect=clampObjectRect({
        x:Number(interaction.original.x||0),
        y:Number(interaction.original.y||0),
        width:Number(interaction.original.width||0)+dx,
        height:Number(interaction.original.height||0)+dy
      },drawing);
      draft={...draft,...alignResizeToGrid(rect,interaction.original,'resize','se',drawing)};
    }else if(interaction.mode==='rotate'){
      const angle=rotationFromPointer(interaction.original,event,interaction.sheetRect,drawing);
      draft.rotation=(shiftActive()||event.shiftKey)?Math.round(angle/15)*15:angle;
    }

    if(smartGuideEnabled && ['move','resize','resize-corner'].includes(interaction.mode)){
      const objects=drawingObjectStore.getByDrawingId(drawing.drawingId);
      showSmartGuides(alignmentGuides(draft,objects,pageSize(drawing),
        [interaction.objectId,...(interaction.linkedOriginals||[]).map(o=>o.objectId)]),drawing);
    }else clearSmartGuides();
    interaction.draft=draft;
    if(interaction.linkedOriginals?.length && ['move','resize','resize-corner'].includes(interaction.mode)){
      const original=interaction.original;
      const before={x:original.x,y:original.y,width:original.width,height:original.height};
      const after={x:draft.x,y:draft.y,width:draft.width,height:draft.height};
      interaction.linkedDrafts=interaction.linkedOriginals.map(record=>
        interaction.mode==='move'?translateObject(record,draft.x-original.x,draft.y-original.y):
          scaleObjectInGroup(record,before,after));
      for(const linked of interaction.linkedDrafts){
        const el=mount.querySelector(`[data-survey-object-id="${CSS.escape(linked.objectId)}"]`);
        if(el)paintObjectDraft(el,linked,drawing);
      }
    }
    if(interaction.mode==='shape-adjust' || interaction.mode==='shape-vertex'){
      const polygon=objectEl.querySelector('.survey-map-shape-svg polygon');
      if(polygon){
        const markup=shapeSvgMarkup(draft.shapeType,draft.shapeParams,draft.customVertices);
        const points=markup.match(/points="([^"]+)"/)?.[1];
        if(points)polygon.setAttribute('points',points);
      }
      const handles=interaction.mode==='shape-vertex'?[]:shapeAdjusters(draft.shapeType,draft.shapeParams);
      if(interaction.mode==='shape-vertex'){
        const points=shapeVertices(draft.shapeType,draft.shapeParams,draft.customVertices);
        for(let i=0;i<points.length;i++){
          const grip=objectEl.querySelector(`[data-survey-handle="shape-vertex"][data-survey-point-index="${i}"]`);
          if(grip){grip.style.left=`${(draft.flipX?1-points[i].x:points[i].x)*100}%`;grip.style.top=`${(draft.flipY?1-points[i].y:points[i].y)*100}%`;}
        }
      }
      if(interaction.mode==='shape-adjust')highlightAdjustedEdges(objectEl,draft,interaction.paramKey);
      for(const adjuster of handles){
        const grip=objectEl.querySelector(`[data-survey-param="${adjuster.key}"]`);
        if(grip){grip.style.left=`${(draft.flipX?1-adjuster.x:adjuster.x)*100}%`;grip.style.top=`${(draft.flipY?1-adjuster.y:adjuster.y)*100}%`;}
      }
    }
    paintObjectDraft(objectEl,draft,drawing);
    // Connected lines derive their endpoints from the draft geometry while dragging.
    if(draft.type!=='line'){
      const records=drawingConnectionObjects(drawing);
      const byId=new Map(records.map(o=>[o.objectId,o]));byId.set(draft.objectId,draft);
      for(const line of records){
        if(line.type!=='line'||!(line.startConnection?.targetObjectId===draft.objectId||line.endConnection?.targetObjectId===draft.objectId))continue;
        const lineEl=mount.querySelector('[data-survey-object-id="'+CSS.escape(line.objectId)+'"]');
        if(lineEl)paintObjectDraft(lineEl,resolveConnectedLine(line,byId),drawing);
      }
    }
    event.preventDefault();
  });

  const finishPointerInteraction=(event)=>{
    if(pinchGesture&&event.pointerType==='touch')return;
    const interaction=pointerInteraction;
    if(!interaction || interaction.pointerId!==event.pointerId) return;
    pointerInteraction=null;
    clearSmartGuides();

    if(interaction.mode==='range-select'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const drawing=selectedDrawing();
      if(!drawing)return;
      const a=interaction.startPoint,b=pagePointer(event.clientX,event.clientY,interaction.sheetRect,drawing,{snap:false});
      const area={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),right:Math.max(a.x,b.x),bottom:Math.max(a.y,b.y)};
      if(area.right-area.x>15&&area.bottom-area.y>15){
        const matches=drawingObjectStore.getByDrawingId(drawing.drawingId).filter(o=>{
          if(o.deleted||o.locked||o.visible===false)return false;
          const x=Number(o.x)||0,y=Number(o.y)||0,w=Math.max(0,Number(o.width)||0),h=Math.max(0,Number(o.height)||0);
          return x<=area.right&&x+w>=area.x&&y<=area.bottom&&y+h>=area.y;
        }).map(o=>o.objectId);
        if(!shiftActive()&&!event.shiftKey)selectedObjectIds.clear();
        for(const id of matches)selectedObjectIds.add(id);
        selectedObjectId=Array.from(selectedObjectIds).at(-1)||'';
      }
      activeTool='select';
      renderSurveyMap();return;
    }
    if(interaction.mode==='create-polygon-edge'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const drawing=selectedDrawing();
      if(!drawing)return;
      const raw=pagePointer(event.clientX,event.clientY,interaction.sheetRect,drawing);
      const end=(shiftActive()||event.shiftKey)?snapLinePoint(interaction.startPoint,raw):raw;
      if(Math.hypot(end.x-interaction.startPoint.x,end.y-interaction.startPoint.y)>=150){
        addPolygonVertex(drawing,end);
      }else if(Math.hypot(raw.x-interaction.downPoint.x,raw.y-interaction.downPoint.y)<100){
        if(polygonDraft?.points.length>1)addPolygonVertex(drawing,raw);
        else renderSurveyMap();
      }
      return;
    }
    if(interaction.mode==='create-shape'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const drawing=selectedDrawing();
      if(!drawing)return;
      const end=snapCreationPoint(pagePointer(event.clientX,event.clientY,
        interaction.sheetRect,drawing),drawing);
      const x=interaction.sheetRect.left+interaction.startPoint.x/pageSize(drawing).width*interaction.sheetRect.width;
      const y=interaction.sheetRect.top+interaction.startPoint.y/pageSize(drawing).height*interaction.sheetRect.height;
      void createShapeAt(interaction.kind,x,y,end,shiftActive()||event.shiftKey).then(()=>renderSurveyMap());
      return;
    }
    if(interaction.mode==='group-resize'){
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      void Promise.all(interaction.groupDrafts.map(draft=>{
        const old=drawingObjectStore.get(draft.objectId);
        return commitChangedObject(old,draft,'survey-map-group-resize');
      })).then(()=>renderSurveyMap());
      return;
    }
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
      const end=snapCreationPoint(pagePointer(event.clientX,event.clientY,
        interaction.sheetRect,drawing),drawing);
      void createElbowFromPoints(drawing,interaction.startPoint,end).then(()=>renderSurveyMap());
      return;
    }
    if(interaction.mode==='create-corrected' || interaction.mode==='create-hand'){
      interaction.previewEl?.remove();
      if(event.type==='pointercancel'){renderSurveyMap();return;}
      const drawing=selectedDrawing();
      if(!drawing)return;
      const end=pagePointer(event.clientX,event.clientY,interaction.sheetRect,drawing,{snap:false});
      const last=interaction.rawPoints.at(-1);
      if(Math.hypot(end.x-last.x,end.y-last.y)>(interaction.pen?3:20))interaction.rawPoints.push(end);
      void createCorrectedStroke(drawing,interaction.rawPoints,interaction.mode==='create-hand',false,Boolean(interaction.pen)).then(()=>renderSurveyMap());
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
      const rawEnd=snapCreationPoint(pagePointer(event.clientX,event.clientY,
        interaction.sheetRect,drawing),drawing);
      const endPoint=(shiftActive()||event.shiftKey)?snapLinePoint(interaction.startPoint,rawEnd):rawEnd;
      void createLineFromPoints(drawing,interaction.startPoint,endPoint).then(()=>renderSurveyMap());
      return;
    }

    const current=drawingObjectStore.get(interaction.objectId);
    if(!current) return;
    const draft=interaction.draft||interaction.original;
    if(event.type==='pointercancel'){renderSurveyMap();return;}
    const fields=interaction.mode.startsWith('elbow-')?['points','startX','startY','endX','endY','bendX','x','y','width','height','startConnection','endConnection']
      :['stroke-move','stroke-point','stroke-resize','stroke-rotate'].includes(interaction.mode)?['points','x','y','width','height','rotation','elbow']
      :['line-start','line-end'].includes(interaction.mode)?['startX','startY','endX','endY','x','y','width','height','startConnection','endConnection']
      :interaction.mode==='line-rotate'?['startX','startY','endX','endY','x','y','width','height','rotation']
      :interaction.mode==='move'?['x','y']
      :interaction.mode==='shape-adjust'?['shapeParams']
      :interaction.mode==='shape-vertex'?['customVertices']
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
    if(interaction.linkedDrafts?.length){
      const source='survey-map-region-related-transform';
      const records=[next,...interaction.linkedDrafts.map(d=>{
        const before=drawingObjectStore.get(d.objectId);
        const changed=['points','startX','startY','endX','endY','x','y','width','height'];
        return createDrawingObject({...before,...d,fieldEditedAt:touchFieldEditedAt(before.fieldEditedAt,changed,now)});
      })];
      const changes=records.map(after=>({type:'drawingObject',before:drawingObjectStore.get(after.objectId),after}));
      drawingObjectStore.batch(()=>records.forEach(record=>drawingObjectStore.set(record)));
      persistSnapshot(source);
      rememberSurveyOperation(getCurrentProject()?.projectId,source,changes);
      const project=getCurrentProject();
      void (async()=>{
        if(project&&!project.isSample)for(const record of records)await persistDrawingObjectForProject(project,record,source);
        renderSurveyMap();
      })();
    }else{
      void commitDrawingObject(next,`survey-map-object-${interaction.mode}`).then(()=>renderSurveyMap());
    }
  };

  function finishShiftGesture(event){
    if(!shiftGesture||shiftGesture.pointerId!==event.pointerId)return;
    const gesture=shiftGesture;
    shiftGesture=null;
    if(gesture.timer!==null)clearTimeout(gesture.timer);
    if(shiftPointerId===event.pointerId)shiftPointerId=null;
    if(gesture.move){
      if(gesture.moved)placeShiftButton(shiftPosition?.left??16,shiftPosition?.bottom??18,true);
      else if(event.type!=='pointercancel')shiftMoveMode=false;
    }else if(event.type!=='pointercancel'&&!gesture.long&&!gesture.moved){
      if(shiftTapTimer!==null){
        cancelShiftTap();
        shiftMoveMode=!shiftMoveMode;
        shiftPointerId=null;
        shiftLatched=false;
      }else{
        shiftTapTimer=setTimeout(()=>{
          shiftTapTimer=null;
          if(!shiftMoveMode){shiftLatched=!shiftLatched;syncShiftButton();}
        },320);
      }
    }
    syncShiftButton();
  }
  mount.addEventListener('pointermove',(event)=>{
    const gesture=shiftGesture;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    const dx=event.clientX-gesture.start.x;
    const dy=event.clientY-gesture.start.y;
    if(Math.hypot(dx,dy)>9){
      gesture.moved=true;
      if(gesture.timer!==null){clearTimeout(gesture.timer);gesture.timer=null;}
    }
    if(gesture.move){
      placeShiftButton(gesture.initialPosition.left+dx,gesture.initialPosition.bottom-dy);
      event.preventDefault();
    }
  });
  window.addEventListener('pointerup',finishShiftGesture);
  window.addEventListener('pointercancel',finishShiftGesture);
  mount.addEventListener('pointerup',finishPointerInteraction);
  mount.addEventListener('pointercancel',finishPointerInteraction);

  mount.addEventListener('change',(event)=>{
    const compactDash=event.target.closest('[data-survey-compact-dash]');
    if(compactDash){
      const object=selectedObject(),kind=compactDash.dataset.surveyCompactDash,value=compactDash.value;
      const valid=kind==='line'?['solid','dash','dot']:['solid','fine','normal','dash'];
      if(object&&valid.includes(value)&&((kind==='line'&&object.type==='line')||(kind==='shape'&&object.type==='shape'))){
        const key=kind==='line'?'lineStyle':'strokeDash';
        const next=createDrawingObject({...object,[key]:value,fieldEditedAt:touchFieldEditedAt(object.fieldEditedAt,[key],Date.now())});
        void commitDrawingObject(next,'survey-map-line-style').then(()=>renderSurveyMap());
      }
      return;
    }
    if(event.target.matches('[data-survey-room-dash]')){
      const value=String(event.target.value);
      if(ROOM_DASH_OPTIONS.some(([key])=>key===value))roomAreaDash=value;
      return;
    }
    if(event.target.matches('[data-survey-object-dash]')){
      const record=selectedObject();
      const value=String(event.target.value);
      if(record?.type==='shape'&&['fine','normal','dash','solid'].includes(record.strokeDash)&&ROOM_DASH_OPTIONS.some(([key])=>key===value)){
        const now=Date.now();
        void commitDrawingObject(createDrawingObject({...record,strokeDash:value,
          fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,['strokeDash'],now)}),'survey-map-room-dash-change').then(()=>renderSurveyMap());
      }
      return;
    }
    if(event.target.matches('[data-survey-grid-spacing]')){
      gridSpacing=GRID_SPACINGS.includes(Number(event.target.value))?Number(event.target.value):250;
      renderSurveyMap();return;
    }
    if(event.target.matches('[data-survey-grid-snap]')){
      gridSnap=Boolean(event.target.checked);
      renderSurveyMap();return;
    }
    if(event.target.matches('[data-survey-smart-guide]')){
      smartGuideEnabled=Boolean(event.target.checked);
      clearSmartGuides();renderSurveyMap();return;
    }
    if(event.target.matches('[data-survey-angle]')){
      const record=selectedObject();
      if(record&&selectedObjectIds.size===1){
        const desired=Number(event.target.value)||0;
        const updated=rotateSingleObject(record,desired-(Number(record.rotation)||0));
        void commitChangedObject(record,updated,'survey-map-angle').then(()=>renderSurveyMap());
      }
      return;
    }
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
      }else if(field==='lineEnabled'&&(!isLine||record.closed)){
        patch.lineEnabled=Boolean(styleInput.checked);
      }else if(field==='fill'&&(record.type==='shape'||record.closed)){
        patch.fillEnabled=Boolean(styleInput.checked);
        patch.fillOpacity=patch.fillEnabled?1:0;
      }else if(field==='fillColor'&&(record.type==='shape'||record.closed)){
        patch.fillColor=String(styleInput.value||'#93c5fd');
        if(record.fillEnabled)patch.fillOpacity=1;
      }else return;
      const now=Date.now();
      const next=createDrawingObject({...record,...patch,
        fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,Object.keys(patch),now)});
      void commitDrawingObject(next,'survey-map-style-change').then(()=>renderSurveyMap());
      return;
    }
    const colorCode=event.target.closest('[data-survey-label-hex]');
    if(colorCode){
      const record=selectedObject();
      if(!record||!(isLabelType(record.type)||(record.type==='shape'&&record.shapeType==='rect')))return;
      const key=colorCode.dataset.surveyLabelHex,color=String(colorCode.value||'').trim();
      if(!['textColor','strokeColor','backgroundColor'].includes(key)||!/^#[0-9a-fA-F]{6}$/.test(color))return;
      const patch={[key]:color};
      const next=createDrawingObject({...record,...patch,
        fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,[key],Date.now())});
      void commitDrawingObject(next,'survey-map-label-hex').then(()=>renderSurveyMap());
      return;
    }
    const labelInput=event.target.closest('[data-survey-label-field]');
    if(labelInput){
      const record=selectedObject();
      if(!record||!(isLabelType(record.type)||(record.type==='shape'&&record.shapeType==='rect')))return;
      const key=labelInput.dataset.surveyLabelField;
      const patch={};
      if(key==='roomDisplay'){
        patch.roomDisplay=labelInput.value==='name'?'name':'number';
        patch.customText=false;
        patch.text=patch.roomDisplay==='name'?String(record.roomNameSnapshot||record.roomNoSnapshot||''):
          String(record.roomNoSnapshot||record.roomPosition||'');
      }else if(key==='text'){
        patch.text=String(labelInput.value||'');
        if(record.type==='roomLabel'){patch.customText=true;patch.roomNoSnapshot=patch.text;}
      }else if(key==='textDirection'){
        patch.textDirection=labelInput.value==='vertical'?'vertical':'horizontal';
      }else if(key==='widthMm'||key==='heightMm'){
        patch[key==='widthMm'?'width':'height']=Math.max(100,Math.round(Number(labelInput.value||1)*100));
      }else if(key==='paddingMm'){
        patch.padding=Math.max(0,Math.round(Number(labelInput.value||0)*100));
      }else if(/^padding(Top|Right|Bottom|Left)Mm$/.test(key)){
        patch[key.slice(0,-2)]=Math.max(0,Math.round(Number(labelInput.value||0)*100));
      }else if(key==='alignH'){
        patch.alignH=['left','center','right'].includes(labelInput.value)?labelInput.value:'center';
      }else if(key==='alignV'){
        patch.alignV=['top','middle','bottom'].includes(labelInput.value)?labelInput.value:'middle';
      }else if(key==='fontSize'){
        patch.fontSize=Math.max(1,Number(labelInput.value)||6);
      }else if(key==='borderWidth'){
        patch.borderWidth=Math.max(.25,Number(labelInput.value)||1);
      }else if(['borderEnabled','backgroundEnabled'].includes(key)){
        patch[key]=Boolean(labelInput.checked);
      }else if(['textColor','strokeColor','backgroundColor'].includes(key)){
        patch[key]=String(labelInput.value||'#111111');
      }else return;
      const next=createDrawingObject({...record,...patch,
        fieldEditedAt:touchFieldEditedAt(record.fieldEditedAt,Object.keys(patch),Date.now())});
      void commitDrawingObject(next,'survey-map-label-edit').then(()=>renderSurveyMap());
      return;
    }
    if(event.target.matches('[data-survey-room-choice]')){
      selectedRoomKey=normalizeRoomNumber(event.target.value)||'1-1';return;
    }
    if(event.target.matches('[data-survey-material-choice]')){
      selectedMaterialId=String(event.target.value||'');return;
    }
    if(event.target.matches('[data-survey-name]')) void renameDrawing(event.target.value);
    if(event.target.matches('[data-survey-display-name]')) void renamePageDisplay(event.target.value);
  });

  window.addEventListener('keydown',(event)=>{
    if(event.key==='Shift'){physicalShift=true;syncShiftButton();}
    if(root()?.style.display==='none') return;
    if(inlineTextEdit||event.isComposing||event.target.closest('input,textarea,[contenteditable]'))return;
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
    if(shiftGesture?.timer!==null)clearTimeout(shiftGesture.timer);
    shiftGesture=null;shiftPointerId=null;physicalShift=false;cancelShiftTap();syncShiftButton();
  });
  window.addEventListener('chousa:tab-change',(event)=>{
    if(event.detail?.currentTab==='survey-map'){
      renderSurveyMap();
      return;
    }
    if(focusMode){
      focusMode=false;
      pagesOpen=false;
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
  materialRecordStore.subscribe(()=>{
    if(root()?.style.display!=='none' && !pointerInteraction) renderSurveyMap();
  });
  renderSurveyMap();
}
