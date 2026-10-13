/**
 * v0.1.10.1 調査図タブ基盤。
 * v0.9b.3モックの3カラムUIを本開発構成へ移し、ページRecordの作成/選択/名称変更/論理削除を扱う。
 */
import * as drawingRecordStore from '../store/drawing-record-store.js';
import * as drawingObjectStore from '../store/drawing-object-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { createDrawingRecord } from '../records/drawing-record.js';
import { getCurrentProject, saveProjectSnapshot } from '../projects/project-store.js';
import { persistDrawingForProject } from '../sync/project-record-persistence.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';

let initialized=false;
let selectedDrawingId='';
let gridVisible=false;

function root(){ return document.getElementById('survey-map'); }
function activeDrawings(){ return drawingRecordStore.getActive(); }
function selectedDrawing(){
  const active=activeDrawings();
  if(!active.length) return null;
  const selected=active.find((item)=>item.drawingId===selectedDrawingId) || active[0];
  selectedDrawingId=selected.drawingId;
  return selected;
}
function escapeHtml(value){ return String(value??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function newDrawingId(){
  if(globalThis.crypto?.randomUUID) return `D-${crypto.randomUUID()}`;
  return `D-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
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
async function commitDrawing(record,source){
  const project=getCurrentProject();
  drawingRecordStore.set(record);
  persistSnapshot(source);
  if(project?.projectId && !project.isSample) await persistDrawingForProject(project,record,source);
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
    fieldEditedAt:touchFieldEditedAt({},['name','order','deleted','titleSettings','nameSettings','legendSettings'],now)
  });
  selectedDrawingId=record.drawingId;
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
  if(!current) return;
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
function pageListHtml(){
  const pages=activeDrawings();
  if(!pages.length) return '<div class="survey-map-hint">調査図はまだありません。<br>「＋新規調査図」から作成します。</div>';
  return pages.map((page)=>`<div class="survey-map-page-row"><button type="button" class="survey-map-page-btn ${page.drawingId===selectedDrawingId?'active':''}" data-survey-page="${escapeHtml(page.drawingId)}">${escapeHtml(page.name)}</button><button type="button" class="btn small" data-survey-page-delete="${escapeHtml(page.drawingId)}" aria-label="削除">×</button></div>`).join('');
}
function disabledToolsHtml(){
  const labels=['選択/範囲','直線','補正線','カギ線','部屋','建材','採取位置','テキスト','色コピー'];
  const shapeLabels=['四角','丸','直角三角','L字','T字','十字','凹字','多角形'];
  return `<div class="survey-map-tool-grid">${labels.map((label,index)=>`<button type="button" ${index===0?'class="active"':'disabled'}>${label}</button>`).join('')}</div>
    <div class="survey-map-divider"></div>
    <div class="survey-map-panel-head" style="margin:0 -10px 8px;border-top:1px solid #d6dce5">基本図形</div>
    <div class="survey-map-tool-grid">${shapeLabels.map((label)=>`<button type="button" disabled>${label}</button>`).join('')}</div>
    <div class="survey-map-hint" style="margin-top:10px">v0.1.10.1ではページ基盤まで。作図機能は次の枝番から順に接続します。</div>`;
}
function sheetHtml(drawing){
  if(!drawing) return '<div class="survey-map-empty">左の「＋新規調査図」からページを作成してください</div>';
  const title=escapeHtml(drawing.titleSettings?.text||'調査図');
  const name=escapeHtml(drawing.nameSettings?.text||drawing.name||'');
  return `<div class="survey-map-fixed-title">${title}</div>
    <div class="survey-map-empty">A4横 29700 × 21000<br>作図オブジェクトは次段階で追加</div>
    <div class="survey-map-fixed-name">${name}</div>
    <div class="survey-map-fixed-legend"><b>凡例</b><br>採取位置<br>含有 / 含有なし<br>みなし / 対象外</div>`;
}
function editorHtml(drawing){
  if(!drawing) return '<div class="survey-map-hint">ページを選択すると編集項目が表示されます。</div>';
  return `<div class="survey-map-editor-row"><label>一覧名称</label><input data-survey-name value="${escapeHtml(drawing.name)}"></div>
    <div class="survey-map-editor-row"><label>紙面左下の名称</label><input data-survey-display-name value="${escapeHtml(drawing.nameSettings?.text||'')}"></div>
    <div class="survey-map-hint">固定表示：左上=タイトル、左下=名称、右下=凡例。細かな寸法・文字サイズは実機確認後に調整します。</div>
    <div class="survey-map-divider"></div>
    <button type="button" class="btn danger" data-survey-delete-current style="width:100%">この調査図を削除</button>`;
}
export function renderSurveyMap(){
  const mount=root();
  if(!mount) return;
  const drawing=selectedDrawing();
  mount.innerHTML=`<div class="survey-map-root">
    <aside class="survey-map-panel">
      <div class="survey-map-panel-head"><span>図面一覧</span><button type="button" class="btn small primary" data-survey-new>＋新規調査図</button></div>
      <div class="survey-map-panel-body">
        <div class="survey-map-page-list">${pageListHtml()}</div>
        <div class="survey-map-divider"></div>
        <div class="survey-map-panel-head" style="margin:0 -10px 8px">ツール</div>
        ${disabledToolsHtml()}
      </div>
    </aside>
    <main class="survey-map-center">
      <div class="survey-map-topbar">
        <button type="button" class="btn small" disabled>戻る</button>
        <button type="button" class="btn small" disabled>進む</button>
        <button type="button" class="btn small ${gridVisible?'active':''}" data-survey-grid>グリッド${gridVisible?'ON':'OFF'}</button>
        <button type="button" class="btn small" disabled>スナップON</button>
        <span class="spacer"></span>
        <span class="survey-map-status">${drawing?escapeHtml(drawing.name):'ページ未選択'}</span>
      </div>
      <div class="survey-map-stage"><div class="survey-map-sheet ${gridVisible?'grid-on':''}">${sheetHtml(drawing)}</div></div>
    </main>
    <aside class="survey-map-panel survey-map-right">
      <div class="survey-map-panel-head"><span>選択中</span><span class="pill">${drawing?'ページ':'未選択'}</span></div>
      <div class="survey-map-panel-body">${editorHtml(drawing)}</div>
    </aside>
  </div>`;
}
function bindEvents(){
  const mount=root();
  if(!mount) return;
  mount.addEventListener('click',(event)=>{
    const newButton=event.target.closest('[data-survey-new]');
    if(newButton){ void createDrawing(); return; }
    const pageButton=event.target.closest('[data-survey-page]');
    if(pageButton){ selectedDrawingId=String(pageButton.dataset.surveyPage||''); renderSurveyMap(); return; }
    const pageDelete=event.target.closest('[data-survey-page-delete]');
    if(pageDelete){ selectedDrawingId=String(pageDelete.dataset.surveyPageDelete||''); void deleteDrawing(); return; }
    if(event.target.closest('[data-survey-delete-current]')){ void deleteDrawing(); return; }
    if(event.target.closest('[data-survey-grid]')){ gridVisible=!gridVisible; renderSurveyMap(); }
  });
  mount.addEventListener('change',(event)=>{
    if(event.target.matches('[data-survey-name]')) void renameDrawing(event.target.value);
    if(event.target.matches('[data-survey-display-name]')) void renamePageDisplay(event.target.value);
  });
  window.addEventListener('chousa:tab-change',(event)=>{
    if(event.detail?.currentTab==='survey-map') renderSurveyMap();
  });
}
export function refreshSurveyMap(){ renderSurveyMap(); }
export function initializeSurveyMap(){
  if(initialized) return;
  initialized=true;
  bindEvents();
  drawingRecordStore.subscribe(()=>{ if(root()?.style.display!=='none') renderSurveyMap(); });
  renderSurveyMap();
}
