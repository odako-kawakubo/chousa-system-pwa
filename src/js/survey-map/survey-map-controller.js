/**
 * v0.1.10.2 調査図タブ基盤。
 * iPad作図を優先し、全画面モード・左右パネル開閉・アイコン中心UIを提供する。
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
let focusMode=false;
let leftCollapsed=false;
let rightCollapsed=false;
let pagesOpen=false;

function root(){ return document.getElementById('survey-map'); }
function activeDrawings(){ return drawingRecordStore.getActive(); }

function selectedDrawing(){
  const active=activeDrawings();
  if(!active.length) return null;
  const selected=active.find((item)=>item.drawingId===selectedDrawingId) || active[0];
  selectedDrawingId=selected.drawingId;
  return selected;
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
  if(project?.projectId && !project.isSample){
    await persistDrawingForProject(project,record,source);
  }
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

function setFocusMode(next){
  focusMode=Boolean(next);
  if(!focusMode){
    leftCollapsed=false;
    rightCollapsed=false;
    pagesOpen=false;
  }
  applyLayoutClasses();
  renderSurveyMap();
}

function applyLayoutClasses(){
  document.body.classList.toggle('survey-map-focus-mode',focusMode);
  document.body.classList.toggle('survey-map-left-collapsed',focusMode&&leftCollapsed);
  document.body.classList.toggle('survey-map-right-collapsed',focusMode&&rightCollapsed);
}

function svgIcon(name){
  const icons={
    select:'<path d="M5 3l13 9-6 1 3 6-3 1-3-6-4 4z"/>',
    range:'<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
    line:'<path d="M4 19L20 5"/>',
    correct:'<path d="M4 18L18 4"/><path d="M11 18h7v-7"/>',
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
      <button type="button" class="btn small" data-survey-page-delete="${escapeHtml(page.drawingId)}" aria-label="削除">×</button>
    </div>
  `).join('');
}

function toolIconCell(icon,label,disabled=true){
  return `<div class="survey-map-tool-cell">${iconButton({icon,label,disabled})}</div>`;
}

function toolsHtml(){
  const primary=[
    ['select','選択'],
    ['range','範囲選択'],
    ['line','直線'],
    ['correct','補正線'],
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
      <div class="survey-map-tool-grid">${primary.map(([icon,label],index])=>
        toolIconCell(icon,label,index!==0)
      ).join('')}</div>
      <div class="survey-map-divider"></div>
      <div class="survey-map-tool-grid">${shapes.map(([icon,label])=>toolIconCell(icon,label,true)).join('')}</div>
    </div>
  `;
}

function sheetHtml(drawing){
  if(!drawing){
    return '<div class="survey-map-empty">図面ボタンから<br>新規調査図を作成してください</div>';
  }
  const title=escapeHtml(drawing.titleSettings?.text||'調査図');
  const name=escapeHtml(drawing.nameSettings?.text||drawing.name||'');
  return `
    <div class="survey-map-fixed-title">${title}</div>
    <div class="survey-map-empty">A4横 29700 × 21000<br>作図オブジェクトは次段階で追加</div>
    <div class="survey-map-fixed-name">${name}</div>
    <div class="survey-map-fixed-legend"><b>凡例</b><br>採取位置<br>含有 / 含有なし<br>みなし / 対象外</div>
  `;
}

function editorHtml(drawing){
  if(!drawing){
    return '<div class="survey-map-hint">ページを選択すると編集項目が表示されます。</div>';
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
    <div class="survey-map-hint">固定表示：左上=タイトル、左下=名称、右下=凡例。</div>
    <div class="survey-map-divider"></div>
    <button type="button" class="btn danger" data-survey-delete-current style="width:100%">この調査図を削除</button>
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

  mount.innerHTML=`
    <div class="survey-map-root">
      <aside class="survey-map-panel survey-map-left">
        <div class="survey-map-panel-head">
          ${iconButton({icon:'pages',label:'図面一覧',attr:'data-survey-pages-toggle'})}
          ${iconButton({icon:'plus',label:'新規調査図',attr:'data-survey-new'})}
        </div>
        <div class="survey-map-panel-body">${toolsHtml()}</div>
      </aside>

      <main class="survey-map-center">
        <div class="survey-map-topbar">
          ${iconButton({
            icon:focusMode?'exitfullscreen':'fullscreen',
            label:focusMode?'全画面を終了':'全画面',
            attr:'data-survey-focus-toggle',
            active:focusMode,
            className:'survey-map-focus-toggle'
          })}
          ${iconButton({icon:'pages',label:'図面一覧',attr:'data-survey-pages-toggle'})}
          ${iconButton({icon:'tools',label:'ツール表示切替',attr:'data-survey-left-toggle',active:!leftCollapsed})}
          ${iconButton({icon:'panel',label:'編集パネル表示切替',attr:'data-survey-right-toggle',active:!rightCollapsed})}
          ${iconButton({icon:'undo',label:'元に戻す',disabled:true})}
          ${iconButton({icon:'redo',label:'やり直す',disabled:true})}
          ${iconButton({icon:'grid',label:'グリッド',attr:'data-survey-grid',active:gridVisible})}
          ${iconButton({icon:'snap',label:'スナップ',disabled:true})}
          <span class="spacer"></span>
          <span class="survey-map-status">${drawing?escapeHtml(drawing.name):'ページ未選択'}</span>
        </div>

        <div class="survey-map-stage">
          ${pagesPopoverHtml()}
          <div class="survey-map-sheet ${gridVisible?'grid-on':''}">${sheetHtml(drawing)}</div>
        </div>
      </main>

      <aside class="survey-map-panel survey-map-right">
        <div class="survey-map-panel-head">
          <span>選択中</span>
          <span class="pill">${drawing?'ページ':'未選択'}</span>
        </div>
        <div class="survey-map-panel-body">${editorHtml(drawing)}</div>
      </aside>
    </div>
  `;
}

function bindEvents(){
  const mount=root();
  if(!mount) return;

  mount.addEventListener('click',(event)=>{
    if(event.target.closest('[data-survey-new]')){
      void createDrawing();
      return;
    }

    const pageButton=event.target.closest('[data-survey-page]');
    if(pageButton){
      selectedDrawingId=String(pageButton.dataset.surveyPage||'');
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

    if(event.target.closest('[data-survey-left-toggle]')){
      leftCollapsed=!leftCollapsed;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-right-toggle]')){
      rightCollapsed=!rightCollapsed;
      renderSurveyMap();
      return;
    }

    if(event.target.closest('[data-survey-grid]')){
      gridVisible=!gridVisible;
      renderSurveyMap();
    }
  });

  mount.addEventListener('change',(event)=>{
    if(event.target.matches('[data-survey-name]')) void renameDrawing(event.target.value);
    if(event.target.matches('[data-survey-display-name]')) void renamePageDisplay(event.target.value);
  });

  window.addEventListener('chousa:tab-change',(event)=>{
    if(event.detail?.currentTab==='survey-map'){
      renderSurveyMap();
      return;
    }
    if(focusMode){
      focusMode=false;
      leftCollapsed=false;
      rightCollapsed=false;
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
  renderSurveyMap();
}
