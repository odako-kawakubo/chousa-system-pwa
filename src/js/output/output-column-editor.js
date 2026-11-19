/**
 * 共通の列幅ドラッグ操作。出力タブ・設定タブの双方から同じ操作を利用する。
 * 表示時だけDOMを変更し、確定時に保存用draftとPDFを更新する。
 */
import { collectOutputSettings } from './output-settings-ui.js';
import { getOutputSettings } from './output-settings-store.js';
import { OUTPUT_TABLE_MAX_WIDTH, tableWidthTotal } from './output-table-layout.js';

export function bindOutputColumnEditor(root,{getPanel,getDraft,setDraft,onCommit=()=>{}}){
  let drag=null;
  function changeWidth(kind,key,requested,{commit=true}={}){
    const panel=getPanel();
    if(!panel)return false;
    const current=getDraft()||getOutputSettings();
    const widths=current.tableWidths?.[kind];
    if(!widths||!(key in widths))return false;
    const other=tableWidthTotal(kind,widths)-widths[key];
    const limit=Math.min(100,OUTPUT_TABLE_MAX_WIDTH-other);
    const candidate=Number(requested);
    const value=Math.round(Math.max(5,Math.min(limit,Number.isFinite(candidate)?candidate:widths[key]))*10)/10;
    if(limit<5||!Number.isFinite(value))return false;
    setDraft({...collectOutputSettings(panel,current),tableWidths:{
      ...current.tableWidths,[kind]:{...widths,[key]:value}
    }});
    const editor=panel.querySelector(`[data-output-column-editor="${kind}"]`);
    const target=`${kind}:${key}`;
    const cell=[...editor?.querySelectorAll('[data-output-column-cell]')||[]].find(node=>node.dataset.outputColumnCell===target);
    if(cell)cell.style.width=`${value*3}px`;
    const input=[...editor?.querySelectorAll('[data-output-column-input]')||[]].find(node=>node.dataset.outputColumnInput===target);
    if(input)input.value=String(value);
    const total=editor?.querySelector('[data-output-column-total]');
    if(total)total.textContent=`合計 ${tableWidthTotal(kind,{...widths,[key]:value}).toFixed(1)} / ${OUTPUT_TABLE_MAX_WIDTH}mm`;
    if(commit)onCommit();
    return true;
  }
  root.addEventListener('pointerdown',event=>{
    const handle=event.target.closest?.('[data-output-column-handle]');
    if(!handle||event.button!==0)return;
    const [kind,key]=handle.dataset.outputColumnHandle.split(':');
    const width=getDraft()?.tableWidths?.[kind]?.[key]??getOutputSettings()?.tableWidths?.[kind]?.[key];
    if(!width)return;
    event.preventDefault();
    drag={pointerId:event.pointerId,kind,key,startX:event.clientX,startWidth:width};
    handle.setPointerCapture?.(event.pointerId);
  });
  root.addEventListener('pointermove',event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;
    changeWidth(drag.kind,drag.key,drag.startWidth+(event.clientX-drag.startX)/3,{commit:false});
  });
  const finish=event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;
    drag=null;
    onCommit();
  };
  root.addEventListener('pointerup',finish);
  root.addEventListener('pointercancel',finish);
  root.addEventListener('change',event=>{
    const input=event.target.closest?.('[data-output-column-input]');
    if(!input)return;
    const [kind,key]=input.dataset.outputColumnInput.split(':');
    changeWidth(kind,key,input.value);
  });
}
