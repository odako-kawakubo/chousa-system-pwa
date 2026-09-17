/**
 * src/js/output/output-controller.js
 * 「出力」タブの実PDFレビューと帳票外編集を担当する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';
import { createVectorPdfPreview } from './output-pdf-renderer.js';
import { OutputPdfPreview } from './output-pdf-preview.js';
import { prepareOutputPhotoSources } from './output-photo-source.js';
import { setSamplingOutputMemo } from './output-state.js';
import { DEFAULT_OUTPUT_SETTINGS,getOutputSettings,saveOutputSettings,normalizeOutputSettings } from './output-settings-store.js';
import { renderOutputSettingsControls,collectOutputSettings } from './output-settings-ui.js';
import { initializeOutputPhotoSelectionBridge,openVisualOutputPhotoViewer,openSamplingOutputPhotoViewer } from './output-photo-selection.js';
import { initializeOutputExportController } from './output-export-controller.js';

let activeView='materials';
let initialized=false;
let renderSerial=0;
let currentVm=null;
let previewRefreshTimer=null;
let previewPage=1;
let previewPageCount=1;
let previewZoom=100;
let previewRenderer=null;
let settingsOpen=false;
let settingsDraft=null;
let materialLocationMode='room-no';
let wheelPageLockUntil=0;

function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function ensureOutputStyles(){if(document.querySelector('link[data-output-styles]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='./css/output.css';link.dataset.outputStyles='1';document.head.appendChild(link);}
function outputRoot(){return document.getElementById('sync');}
function effectiveSettings(){return normalizeOutputSettings(settingsOpen&&settingsDraft?settingsDraft:getOutputSettings());}
function buildCurrentVm(){return buildOutputViewModel({materialLocationMode});}

function renderVisualEditor(vm){const items=vm?.visualPhotoItems||[];if(!items.length)return '<div class="output-editor-empty">写真帳の対象建材がありません。</div>';return `<div class="output-editor-list">${items.map((item)=>{const label=[`建材No.${item.materialNo}`,item.part,item.name].filter((v)=>String(v??'').trim()).join('　');const state=item.photoId?'選択済み':'未選択';return `<div class="output-editor-row"><div class="output-editor-row-main"><b>${escapeHtml(label)}</b><span>${escapeHtml(state)}</span></div><button type="button" class="btn small" data-output-visual-expand="${escapeHtml(item.materialId)}">写真選択</button></div>`;}).join('')}</div>`;}
function renderSamplingEditor(vm){const pages=vm?.samplingPhotoPages||[];if(!pages.length)return '<div class="output-editor-empty">採取写真帳の対象がありません。</div>';return `<div class="output-editor-list">${pages.map((page)=>{const sampleLabel=[page.sampleName,page.samplingPlace?`部屋No.${page.samplingPlace}`:''].filter(Boolean).join('　');const stages=(page.stages||[]).map((stage)=>`<div class="output-sampling-editor-stage"><div class="output-sampling-editor-head"><b>${escapeHtml(stage.label||stage.type)}</b><button type="button" class="btn small" data-output-sampling-expand="${escapeHtml(page.materialId)}" data-output-branch="${Number(page.branch)||0}" data-output-stage="${escapeHtml(stage.type)}">写真選択</button></div><textarea class="output-sampling-editor-memo" rows="3" placeholder="撮影メモ" data-output-sampling-memo-editor data-output-material-id="${escapeHtml(page.materialId)}" data-output-branch="${Number(page.branch)||0}" data-output-stage="${escapeHtml(stage.type)}">${escapeHtml(stage.memo||'')}</textarea></div>`).join('');return `<section class="output-editor-group"><div class="output-editor-group-title">${escapeHtml(sampleLabel||`建材No.${page.materialNo||''}`)}</div>${stages}</section>`;}).join('')}</div>`;}
function renderEditorPanel(vm){if(activeView==='visual-photos')return `<aside class="output-editor-panel"><div class="output-editor-title">写真帳編集</div>${renderVisualEditor(vm)}</aside>`;if(activeView==='sampling-photos')return `<aside class="output-editor-panel"><div class="output-editor-title">採取写真帳編集</div>${renderSamplingEditor(vm)}</aside>`;return '';}
function renderSettingsPanel(){if(!settingsOpen)return '';return `<aside class="output-settings-panel" data-output-settings-panel><div class="output-settings-panel-head"><b>出力設定</b><button type="button" class="btn small" data-output-settings-close>閉じる</button></div><div class="output-settings-panel-body">${renderOutputSettingsControls(settingsDraft||getOutputSettings())}</div><div class="output-settings-panel-actions"><button type="button" class="btn small" data-output-settings-undo>元に戻す</button><button type="button" class="btn small" data-output-settings-default>初期値</button><span></span><button type="button" class="btn primary small" data-output-settings-save>保存</button></div></aside>`;}
function renderSidePanels(vm){const settings=renderSettingsPanel();const editor=renderEditorPanel(vm);if(!settings&&!editor)return '';return `<div class="output-side-stack">${settings}${editor}</div>`;}
function hasSidePanel(){return settingsOpen||activeView==='visual-photos'||activeView==='sampling-photos';}

function setPreviewStatus(message,isError=false){const node=outputRoot()?.querySelector('[data-output-preview-status]');if(!node)return;node.textContent=message||'';node.classList.toggle('is-error',Boolean(isError));}
function updatePreviewControls(){const root=outputRoot();if(!root)return;root.querySelectorAll('[data-output-page-counter]').forEach((node)=>{node.textContent=`${previewPage} / ${previewPageCount}`;});root.querySelectorAll('[data-output-zoom-label]').forEach((node)=>{node.textContent=`${previewZoom}%`;});root.querySelectorAll('[data-output-page-prev]').forEach((node)=>{node.disabled=previewPage<=1;});root.querySelectorAll('[data-output-page-next]').forEach((node)=>{node.disabled=previewPage>=previewPageCount;});}
async function applyPreviewPage(page,{edge='top'}={}){if(!previewRenderer)return;previewPage=await previewRenderer.setPage(page);const host=outputRoot()?.querySelector('[data-output-pdf-host]');if(host){if(edge==='bottom')host.scrollTop=Math.max(0,host.scrollHeight-host.clientHeight);else host.scrollTop=0;}updatePreviewControls();}
async function applyPreviewZoom(zoom){if(!previewRenderer)return;previewZoom=await previewRenderer.setZoom(zoom);const host=outputRoot()?.querySelector('[data-output-pdf-host]');if(host){host.scrollTop=0;host.scrollLeft=0;}updatePreviewControls();}

async function renderPdfPreview(serial,vm){const root=outputRoot();const host=root?.querySelector('[data-output-pdf-host]');if(!root||!host||serial!==renderSerial)return;try{setPreviewStatus('実PDFを生成しています…');const photoSources=await prepareOutputPhotoSources([activeView],vm,{onProgress:(text)=>{if(serial===renderSerial)setPreviewStatus(text);}});if(serial!==renderSerial)return;const result=await createVectorPdfPreview({targets:[activeView],vm,photoSources,settings:effectiveSettings(),onProgress:(text)=>{if(serial===renderSerial)setPreviewStatus(text);}});if(serial!==renderSerial)return;previewRenderer?.destroy();previewRenderer=new OutputPdfPreview(host);const state=await previewRenderer.load(result.blob,{page:previewPage,zoom:previewZoom});if(serial!==renderSerial)return;previewPageCount=state.pageCount;previewPage=state.page;previewZoom=state.zoom;setPreviewStatus('実際に出力されるPDFを1ページずつ表示しています。');updatePreviewControls();}catch(error){console.error('実PDFレビュー生成に失敗しました',error);if(serial!==renderSerial)return;host.innerHTML='<div class="output-preview-error">PDFレビューを生成できませんでした。</div>';setPreviewStatus(`PDFレビュー生成に失敗しました：${error?.message||error}`,true);}}
function refreshPdfPreviewOnly(){const root=outputRoot();if(!root)return;renderSerial+=1;const serial=renderSerial;currentVm=buildCurrentVm();const host=root.querySelector('[data-output-pdf-host]');previewRenderer?.destroy();previewRenderer=null;if(host)host.innerHTML='<div class="output-preview-loading">実PDFを更新しています…</div>';void renderPdfPreview(serial,currentVm);}
function schedulePdfPreviewRefresh(){if(previewRefreshTimer)clearTimeout(previewRefreshTimer);previewRefreshTimer=setTimeout(()=>{previewRefreshTimer=null;refreshPdfPreviewOnly();},250);}

function openVisualSelection(materialId){const item=currentVm?.visualPhotoItems?.find((row)=>String(row.materialId)===String(materialId));if(!item)return;openVisualOutputPhotoViewer({materialId:item.materialId,selectedPhotoId:item.photoId,candidates:item.candidates,onSelection:()=>renderOutputTab()});}
function openSamplingSelection(materialId,branch,shootingType){const page=currentVm?.samplingPhotoPages?.find((item)=>String(item.materialId)===String(materialId)&&Number(item.branch)===Number(branch));const stage=page?.stages?.find((item)=>item.type===shootingType);if(!page||!stage)return;openSamplingOutputPhotoViewer({materialId:page.materialId,branch:page.branch,shootingType,selectedPhotoId:stage.photoId,candidates:stage.candidates,onSelection:()=>renderOutputTab()});}
function openSettingsPanel(){settingsDraft=getOutputSettings();settingsOpen=true;renderOutputTab();}
function closeSettingsPanel(){settingsOpen=false;settingsDraft=null;renderOutputTab();}
function updateDraftFromPanel(){const panel=outputRoot()?.querySelector('[data-output-settings-panel]');if(!panel)return;settingsDraft=collectOutputSettings(panel,settingsDraft||getOutputSettings());schedulePdfPreviewRefresh();}

function renderLocationSwitch(){if(activeView!=='materials')return '';return `<span class="output-toolbar-label">使用箇所</span><div class="output-segmented"><button type="button" class="btn small ${materialLocationMode==='room-no'?'active':''}" data-output-location-mode="room-no">部屋No.</button><button type="button" class="btn small ${materialLocationMode==='room-name'?'active':''}" data-output-location-mode="room-name">部屋名</button></div><span class="output-toolbar-separator"></span>`;}

export function renderOutputTab(){const root=outputRoot();if(!root)return;renderSerial+=1;const serial=renderSerial;currentVm=buildCurrentVm();previewRenderer?.destroy();previewRenderer=null;root.innerHTML=`<div class="output-root"><div class="output-toolbar">
  <button type="button" class="btn small output-view-btn ${activeView==='materials'?'active':''}" data-output-view="materials">建材リスト</button>
  <button type="button" class="btn small output-view-btn ${activeView==='rooms'?'active':''}" data-output-view="rooms">部屋別リスト</button>
  <button type="button" class="btn small output-view-btn ${activeView==='visual-photos'?'active':''}" data-output-view="visual-photos">建材写真帳</button>
  <button type="button" class="btn small output-view-btn ${activeView==='sampling-photos'?'active':''}" data-output-view="sampling-photos">採取写真帳</button>
  <span class="output-toolbar-separator"></span>${renderLocationSwitch()}
  <span class="output-page-counter" data-output-page-counter>${previewPage} / ${previewPageCount}</span>
  <span class="output-toolbar-separator"></span>
  <button type="button" class="btn small" data-output-zoom-out>−</button><button type="button" class="btn small output-zoom-label" data-output-zoom-reset data-output-zoom-label>${previewZoom}%</button><button type="button" class="btn small" data-output-zoom-in>＋</button>
  <span class="output-toolbar-fill"></span><button type="button" class="btn small ${settingsOpen?'active':''}" data-output-settings-open>出力設定</button><button type="button" class="btn small" data-output-export="pdf">PDF</button><button type="button" class="btn small" data-output-export="print">印刷</button><button type="button" class="btn small" data-output-export="excel">Excel</button>
  </div><div class="output-review-layout ${hasSidePanel()?'has-editor':''}"><section class="output-pdf-review"><div class="output-preview-status" data-output-preview-status>実PDFを生成しています…</div><div class="output-pdf-stage"><button type="button" class="output-page-side output-page-side-prev" data-output-page-prev aria-label="前のページ">‹</button><div class="output-pdf-host" data-output-pdf-host><div class="output-preview-loading">実PDFを生成しています…</div></div><button type="button" class="output-page-side output-page-side-next" data-output-page-next aria-label="次のページ">›</button><span class="output-page-floating-counter" data-output-page-counter>${previewPage} / ${previewPageCount}</span></div></section>${renderSidePanels(currentVm)}</div></div>`;void renderPdfPreview(serial,currentVm);}

export function initializeOutputTab(){
  if(initialized)return;initialized=true;ensureOutputStyles();initializeOutputPhotoSelectionBridge();const root=outputRoot();if(!root)return;
  initializeOutputExportController(root,{getSettings:effectiveSettings,getViewModel:buildCurrentVm});
  const tab=document.querySelector('.tab[data-tab="sync"]');if(tab)tab.textContent='出力';
  root.addEventListener('click',(event)=>{
    const viewButton=event.target.closest('[data-output-view]');if(viewButton){activeView=viewButton.dataset.outputView||'materials';previewPage=1;previewZoom=100;renderOutputTab();return;}
    const locationButton=event.target.closest('[data-output-location-mode]');if(locationButton){materialLocationMode=locationButton.dataset.outputLocationMode==='room-name'?'room-name':'room-no';previewPage=1;renderOutputTab();return;}
    if(event.target.closest('[data-output-page-prev]')){void applyPreviewPage(previewPage-1,{edge:'bottom'});return;}
    if(event.target.closest('[data-output-page-next]')){void applyPreviewPage(previewPage+1,{edge:'top'});return;}
    if(event.target.closest('[data-output-zoom-reset]')){void applyPreviewZoom(100);return;}
    if(event.target.closest('[data-output-zoom-out]')){void applyPreviewZoom(Math.max(50,previewZoom-10));return;}
    if(event.target.closest('[data-output-zoom-in]')){void applyPreviewZoom(Math.min(200,previewZoom+10));return;}
    if(event.target.closest('[data-output-settings-open]')){if(settingsOpen)closeSettingsPanel();else openSettingsPanel();return;}
    if(event.target.closest('[data-output-settings-close]')){closeSettingsPanel();return;}
    if(event.target.closest('[data-output-settings-undo]')){settingsDraft=getOutputSettings();renderOutputTab();return;}
    if(event.target.closest('[data-output-settings-default]')){settingsDraft={...DEFAULT_OUTPUT_SETTINGS};renderOutputTab();return;}
    if(event.target.closest('[data-output-settings-save]')){settingsDraft=saveOutputSettings(settingsDraft||getOutputSettings());renderOutputTab();return;}
    const visual=event.target.closest('[data-output-visual-expand]');if(visual){openVisualSelection(visual.dataset.outputVisualExpand);return;}
    const sampling=event.target.closest('[data-output-sampling-expand]');if(sampling){openSamplingSelection(sampling.dataset.outputSamplingExpand,Number(sampling.dataset.outputBranch),sampling.dataset.outputStage);}
  });
  root.addEventListener('wheel',(event)=>{
    const host=event.target.closest?.('[data-output-pdf-host]');if(!host||!previewRenderer||Math.abs(event.deltaY)<8)return;
    const now=performance.now();if(now<wheelPageLockUntil){event.preventDefault();return;}
    const atTop=host.scrollTop<=1;
    const atBottom=host.scrollTop+host.clientHeight>=host.scrollHeight-1;
    const canPrev=previewPage>1;
    const canNext=previewPage<previewPageCount;
    const shouldPrev=event.deltaY<0&&atTop&&canPrev;
    const shouldNext=event.deltaY>0&&atBottom&&canNext;
    if(previewZoom<=100){
      if(event.deltaY<0&&canPrev){event.preventDefault();wheelPageLockUntil=now+280;void applyPreviewPage(previewPage-1,{edge:'bottom'});}
      else if(event.deltaY>0&&canNext){event.preventDefault();wheelPageLockUntil=now+280;void applyPreviewPage(previewPage+1,{edge:'top'});}
      return;
    }
    if(shouldPrev){event.preventDefault();wheelPageLockUntil=now+280;void applyPreviewPage(previewPage-1,{edge:'bottom'});}
    else if(shouldNext){event.preventDefault();wheelPageLockUntil=now+280;void applyPreviewPage(previewPage+1,{edge:'top'});}
  },{passive:false});
  root.addEventListener('input',(event)=>{const editor=event.target.closest?.('[data-output-sampling-memo-editor]');if(editor){const materialId=editor.dataset.outputMaterialId;const branch=Number(editor.dataset.outputBranch)||0;const stage=editor.dataset.outputStage||'';if(materialId&&branch&&stage){setSamplingOutputMemo(materialId,branch,stage,String(editor.value||''));schedulePdfPreviewRefresh();}return;}if(event.target.closest?.('[data-output-setting]'))updateDraftFromPanel();});
  root.addEventListener('change',(event)=>{if(event.target.closest?.('[data-output-setting]'))updateDraftFromPanel();});
  window.addEventListener('resize',()=>{if(previewRenderer)void previewRenderer.render();});
  window.addEventListener('chousa:output-settings-change',()=>{if(!settingsOpen)renderOutputTab();});
  finishRecordStore.subscribe(renderOutputTab);materialRecordStore.subscribe(renderOutputTab);photoRecordStore.subscribe(renderOutputTab);renderOutputTab();
}
