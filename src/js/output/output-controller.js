/**
 * src/js/output/output-controller.js
 * 「出力」タブの実PDFレビューと帳票外編集を担当する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';
import { setSamplingOutputMemo } from './output-state.js';
import { DEFAULT_OUTPUT_SETTINGS,getOutputSettings,saveOutputSettings,normalizeOutputSettings } from './output-settings-store.js';
import { collectOutputSettings } from './output-settings-ui.js';
import { initializeOutputPhotoSelectionBridge,openVisualOutputPhotoViewer,openSamplingOutputPhotoViewer } from './output-photo-selection.js';
import { initializeOutputExportController } from './output-export-controller.js';
import { renderOutputSidePanels, hasOutputSidePanel } from './output-side-panels.js';
import { isTutorialActionAllowed } from '../guide/tutorial-state.js';
import { notifyTutorialAction } from '../guide/tutorial-action.js';
import {
  getOutputPdfPreviewState,
  resetOutputPdfPreviewView,
  beginOutputPdfPreviewRender,
  setOutputPdfPreviewPage,
  setOutputPdfPreviewZoom,
  renderOutputPdfPreview,
  scheduleOutputPdfPreviewRefresh,
  rerenderOutputPdfPreview
} from './output-pdf-preview-controller.js';

let activeView='materials';
let initialized=false;
let currentVm=null;
let settingsOpen=false;
let settingsDraft=null;
let includeUnregisteredExcluded=true;
let wheelPageLockUntil=0;

/**
 * Output専用CSS linkが未挿入ならheadへ追加する。重複linkは作らない。
 */
function ensureOutputStyles(){if(document.querySelector('link[data-output-styles]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='./css/output.css';link.dataset.outputStyles='1';document.head.appendChild(link);}
/**
 * Outputタブのroot DOM要素を返す。未表示/未生成時はnullになり得る。
 */
function outputRoot(){return document.getElementById('sync');}
/**
 * 保存済み設定と編集中draftのどちらをPreview/Exportに使うか決め、正規化済み設定を返す。
 */
function effectiveSettings(){return normalizeOutputSettings(settingsOpen&&settingsDraft?settingsDraft:getOutputSettings());}
/**
 * 現在UI条件からOutput ViewModelを再構築する。部屋表示は建材リスト側の共有状態を参照する。
 */
function buildCurrentVm(){return buildOutputViewModel({includeUnregisteredExcluded});}

/**
 * 建材写真帳の対象materialをPhoto Viewer選択UIで開く。選択確定後はOutputタブを再描画する。
 */
function openVisualSelection(materialId){const item=currentVm?.visualPhotoItems?.find((row)=>String(row.materialId)===String(materialId));if(!item)return;openVisualOutputPhotoViewer({materialId:item.materialId,selectedPhotoId:item.photoId,candidates:item.candidates,onSelection:()=>renderOutputTab()});}
/**
 * 採取写真帳のmaterial/枝番/撮影区分をPhoto Viewer選択UIで開く。選択結果はOutput ViewModel再構築で反映する。
 */
function openSamplingSelection(materialId,branch,shootingType){const page=currentVm?.samplingPhotoPages?.find((item)=>String(item.materialId)===String(materialId)&&Number(item.branch)===Number(branch));const stage=page?.stages?.find((item)=>item.type===shootingType);if(!page||!stage)return;openSamplingOutputPhotoViewer({materialId:page.materialId,branch:page.branch,shootingType,selectedPhotoId:stage.photoId,candidates:stage.candidates,onSelection:()=>renderOutputTab()});}
/**
 * 保存済み出力設定をdraftへコピーして設定panelを開く。保存前変更はdraftだけに保持する。
 */
function openSettingsPanel(){settingsDraft=getOutputSettings();settingsOpen=true;renderOutputTab();}
/**
 * 設定panelを閉じてdraftを破棄し、保存済み設定へ戻す。
 */
function closeSettingsPanel(){settingsOpen=false;settingsDraft=null;renderOutputTab();}
/**
 * 設定panel DOMから現在値を収集してdraftへ反映し、debounce付きでPDF Previewだけを再生成する。
 */
function updateDraftFromPanel(){const panel=outputRoot()?.querySelector('[data-output-settings-panel]');if(!panel)return;settingsDraft=collectOutputSettings(panel,settingsDraft||getOutputSettings());scheduleOutputPdfPreviewRefresh(() => ({
    root: outputRoot(),
    activeView,
    vm: buildCurrentVm(),
    settings: effectiveSettings()
  }));}

/**
 * 建材リスト出力時の使用箇所表示を部屋No./部屋名で切り替えるtoolbar HTMLを返す。
 */
function outputClickAllowed(target){
  const view=target?.closest?.('[data-output-view]');
  if(view)return isTutorialActionAllowed('output.view.change',{view:String(view.dataset.outputView||'')});
  if(target?.closest?.('[data-output-unregistered-excluded]'))return isTutorialActionAllowed('output.view.change',{view:'rooms'});
  if(target?.closest?.('[data-output-page-prev],[data-output-page-next]'))return isTutorialActionAllowed('output.page.change',{});
  if(target?.closest?.('[data-output-zoom-reset],[data-output-zoom-out],[data-output-zoom-in]'))return isTutorialActionAllowed('output.zoom.change',{});
  if(target?.closest?.('[data-output-settings-open],[data-output-settings-close],[data-output-settings-undo],[data-output-settings-default],[data-output-settings-save]'))return isTutorialActionAllowed('output.settings.change',{});
  const visual=target?.closest?.('[data-output-visual-expand]');
  if(visual)return isTutorialActionAllowed('output.photo.visual.select',{materialId:String(visual.dataset.outputVisualExpand||'')});
  const sampling=target?.closest?.('[data-output-sampling-expand]');
  if(sampling)return isTutorialActionAllowed('output.photo.sampling.select',{
    materialId:String(sampling.dataset.outputSamplingExpand||''),
    branch:String(sampling.dataset.outputBranch||''),
    stage:String(sampling.dataset.outputStage||'')
  });
  return true;
}

function renderRoomUnregisteredSwitch(){if(activeView!=='rooms')return '';return `<span class="output-toolbar-label">未登録の対象外</span><button type="button" class="btn small ${includeUnregisteredExcluded?'active':''}" data-output-unregistered-excluded>表示 ${includeUnregisteredExcluded?'ON':'OFF'}</button><span class="output-toolbar-separator"></span>`;}

/**
 * 現在の出力種別・設定・ViewModelから出力タブ全体を再描画し、PDF Preview生成を開始する。Previewの内部状態は専用controllerへ委譲する。
 */
export function renderOutputTab(){const root=outputRoot();if(!root)return;const serial=beginOutputPdfPreviewRender();currentVm=buildCurrentVm();const previewState=getOutputPdfPreviewState();root.innerHTML=`<div class="output-root"><div class="output-toolbar">
  <button type="button" class="btn small output-view-btn ${activeView==='materials'?'active':''}" data-output-view="materials">建材リスト</button>
  <button type="button" class="btn small output-view-btn ${activeView==='rooms'?'active':''}" data-output-view="rooms">部屋別リスト</button>
  <button type="button" class="btn small output-view-btn ${activeView==='visual-photos'?'active':''}" data-output-view="visual-photos">建材写真帳</button>
  <button type="button" class="btn small output-view-btn ${activeView==='sampling-photos'?'active':''}" data-output-view="sampling-photos">採取写真帳</button>
  <span class="output-toolbar-separator"></span>${renderRoomUnregisteredSwitch()}
  <span class="output-page-counter" data-output-page-counter>${previewState.page} / ${previewState.pageCount}</span>
  <span class="output-toolbar-separator"></span>
  <button type="button" class="btn small" data-output-zoom-out>−</button><button type="button" class="btn small output-zoom-label" data-output-zoom-reset data-output-zoom-label>${previewState.zoom}%</button><button type="button" class="btn small" data-output-zoom-in>＋</button>
  <span class="output-toolbar-fill"></span><button type="button" class="btn small ${settingsOpen?'active':''}" data-output-settings-open>出力設定</button><button type="button" class="btn small" data-output-export="pdf">PDF</button><button type="button" class="btn small" data-output-export="print">印刷</button><button type="button" class="btn small" data-output-export="excel">Excel</button>
  </div><div class="output-review-layout ${hasOutputSidePanel({activeView,settingsOpen})?'has-editor':''}"><section class="output-pdf-review"><div class="output-preview-status" data-output-preview-status>実PDFを生成しています…</div><div class="output-pdf-stage"><button type="button" class="output-page-side output-page-side-prev" data-output-page-prev aria-label="前のページ">‹</button><div class="output-pdf-host" data-output-pdf-host><div class="output-preview-loading">実PDFを生成しています…</div></div><button type="button" class="output-page-side output-page-side-next" data-output-page-next aria-label="次のページ">›</button><span class="output-page-floating-counter" data-output-page-counter>${previewState.page} / ${previewState.pageCount}</span></div></section>${renderOutputSidePanels({vm:currentVm,activeView,settingsOpen,settingsDraft,savedSettings:getOutputSettings()})}</div></div>`;void renderOutputPdfPreview({
  serial,
  root,
  activeView,
  vm: currentVm,
  settings: effectiveSettings()
});window.dispatchEvent(new CustomEvent('chousa:guide-layout-change'));}

export function captureOutputUiState() {
  const preview = getOutputPdfPreviewState();
  return {
    activeView,
    settingsOpen,
    settingsDraft: settingsDraft ? { ...settingsDraft } : null,
    includeUnregisteredExcluded,
    page:Number(preview.page || 1),
    zoom:Number(preview.zoom || 100)
  };
}

export function restoreOutputUiState(snapshot, { renderNow = true } = {}) {
  if (!snapshot) return;
  activeView = ['materials','rooms','visual-photos','sampling-photos'].includes(snapshot.activeView)
    ? snapshot.activeView
    : 'materials';
  settingsOpen = Boolean(snapshot.settingsOpen);
  settingsDraft = snapshot.settingsDraft ? { ...snapshot.settingsDraft } : null;
  includeUnregisteredExcluded = snapshot.includeUnregisteredExcluded !== false;
  resetOutputPdfPreviewView({
    page:Math.max(1, Number(snapshot.page || 1)),
    zoom:Math.min(200, Math.max(50, Number(snapshot.zoom || 100)))
  });
  if (renderNow) renderOutputTab();
}

export function resetOutputUiStateForTutorial({ renderNow = true } = {}) {
  activeView = 'materials';
  settingsOpen = false;
  settingsDraft = null;
  includeUnregisteredExcluded = true;
  resetOutputPdfPreviewView({ page:1, zoom:100 });
  if (renderNow) renderOutputTab();
}

/**
 * 出力タブの初期化入口。PDF Preview Controller、写真選択、設定panel、Export Controller、Store購読、wheel/zoom/page操作を接続する。
 */
export function initializeOutputTab(){
  if(initialized)return;initialized=true;ensureOutputStyles();initializeOutputPhotoSelectionBridge();const root=outputRoot();if(!root)return;
  initializeOutputExportController(root,{getSettings:effectiveSettings,getViewModel:buildCurrentVm});
  const tab=document.querySelector('.tab[data-tab="sync"]');if(tab)tab.textContent='出力';
  root.addEventListener('click',(event)=>{
    if(!outputClickAllowed(event.target)){event.preventDefault();return;}
    const viewButton=event.target.closest('[data-output-view]');if(viewButton){activeView=viewButton.dataset.outputView||'materials';resetOutputPdfPreviewView({page:1,zoom:100});renderOutputTab();notifyTutorialAction('output.view.change',{view:activeView});return;}
    const unregisteredButton=event.target.closest('[data-output-unregistered-excluded]');if(unregisteredButton){includeUnregisteredExcluded=!includeUnregisteredExcluded;resetOutputPdfPreviewView({page:1,zoom:getOutputPdfPreviewState().zoom});renderOutputTab();return;}
    if(event.target.closest('[data-output-page-prev]')){const state=getOutputPdfPreviewState();void setOutputPdfPreviewPage(root,state.page-1,{edge:'bottom'});return;}
    if(event.target.closest('[data-output-page-next]')){const state=getOutputPdfPreviewState();void setOutputPdfPreviewPage(root,state.page+1,{edge:'top'});return;}
    if(event.target.closest('[data-output-zoom-reset]')){void setOutputPdfPreviewZoom(root,100);return;}
    if(event.target.closest('[data-output-zoom-out]')){const state=getOutputPdfPreviewState();void setOutputPdfPreviewZoom(root,Math.max(50,state.zoom-10));return;}
    if(event.target.closest('[data-output-zoom-in]')){const state=getOutputPdfPreviewState();void setOutputPdfPreviewZoom(root,Math.min(200,state.zoom+10));return;}
    if(event.target.closest('[data-output-settings-open]')){if(settingsOpen)closeSettingsPanel();else openSettingsPanel();return;}
    if(event.target.closest('[data-output-settings-close]')){closeSettingsPanel();return;}
    if(event.target.closest('[data-output-settings-undo]')){settingsDraft=getOutputSettings();renderOutputTab();return;}
    if(event.target.closest('[data-output-settings-default]')){settingsDraft={...DEFAULT_OUTPUT_SETTINGS};renderOutputTab();return;}
    if(event.target.closest('[data-output-settings-save]')){settingsDraft=saveOutputSettings(settingsDraft||getOutputSettings());renderOutputTab();return;}
    const visual=event.target.closest('[data-output-visual-expand]');if(visual){openVisualSelection(visual.dataset.outputVisualExpand);return;}
    const sampling=event.target.closest('[data-output-sampling-expand]');if(sampling){openSamplingSelection(sampling.dataset.outputSamplingExpand,Number(sampling.dataset.outputBranch),sampling.dataset.outputStage);}
  });
  root.addEventListener('wheel',(event)=>{
    const host=event.target.closest?.('[data-output-pdf-host]');
    const state=getOutputPdfPreviewState();
    if(!host||!state.hasRenderer||Math.abs(event.deltaY)<8)return;
    const now=performance.now();
    if(now<wheelPageLockUntil){event.preventDefault();return;}
    const atTop=host.scrollTop<=1;
    const atBottom=host.scrollTop+host.clientHeight>=host.scrollHeight-1;
    const canPrev=state.page>1;
    const canNext=state.page<state.pageCount;
    const shouldPrev=event.deltaY<0&&atTop&&canPrev;
    const shouldNext=event.deltaY>0&&atBottom&&canNext;
    if(state.zoom<=100){
      if(event.deltaY<0&&canPrev){event.preventDefault();wheelPageLockUntil=now+280;void setOutputPdfPreviewPage(root,state.page-1,{edge:'bottom'});}
      else if(event.deltaY>0&&canNext){event.preventDefault();wheelPageLockUntil=now+280;void setOutputPdfPreviewPage(root,state.page+1,{edge:'top'});}
      return;
    }
    if(shouldPrev){event.preventDefault();wheelPageLockUntil=now+280;void setOutputPdfPreviewPage(root,state.page-1,{edge:'bottom'});}
    else if(shouldNext){event.preventDefault();wheelPageLockUntil=now+280;void setOutputPdfPreviewPage(root,state.page+1,{edge:'top'});}
  },{passive:false});
  root.addEventListener('input',(event)=>{const editor=event.target.closest?.('[data-output-sampling-memo-editor]');if(editor){const materialId=editor.dataset.outputMaterialId;const branch=Number(editor.dataset.outputBranch)||0;const stage=editor.dataset.outputStage||'';if(materialId&&branch&&stage){setSamplingOutputMemo(materialId,branch,stage,String(editor.value||''));scheduleOutputPdfPreviewRefresh(() => ({
    root: outputRoot(),
    activeView,
    vm: buildCurrentVm(),
    settings: effectiveSettings()
  }));}return;}if(event.target.closest?.('[data-output-setting]'))updateDraftFromPanel();});
  root.addEventListener('change',(event)=>{if(event.target.closest?.('[data-output-setting]'))updateDraftFromPanel();});
  window.addEventListener('resize',()=>{rerenderOutputPdfPreview();});
  window.addEventListener('chousa:tab-change',(event)=>{
    if(event.detail?.currentTab!=='sync')return;
    // hidden状態で初期描画したPDFはhost寸法を正しく取れないため、
    // 出力タブが実際に表示された次のframeでViewModelとPDFを丸ごと再生成する。
    requestAnimationFrame(()=>requestAnimationFrame(()=>{renderOutputTab();}));
  });
  window.addEventListener('chousa:output-settings-change',()=>{if(!settingsOpen)renderOutputTab();});
  window.addEventListener('chousa:material-room-display-change',()=>renderOutputTab());
  finishRecordStore.subscribe(renderOutputTab);materialRecordStore.subscribe(renderOutputTab);photoRecordStore.subscribe(renderOutputTab);renderOutputTab();
}
