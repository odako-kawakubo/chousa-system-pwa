/** v0.1.10.18 調査図の独立した表示・定義モジュール。 */
import {escapeLabel} from './survey-map-labels.js';

export function labelEditorHtml(record){
  const isRoom=record.type==='roomLabel';
  const isMaterial=record.type==='materialLabel'||(record.type==='shape'&&Boolean(record.materialId));
  const isRect=record.type==='shape'&&record.shapeType==='rect';
  const colorField=(key,title,fallback)=>`<div class="survey-map-editor-row"><label>${title}</label>
    <input type="color" data-survey-label-field="${key}" value="${escapeLabel(record[key]||fallback)}">
    <input type="text" data-survey-label-hex="${key}" aria-label="${title}の色コード" value="${escapeLabel(record[key]||fallback)}" placeholder="#RRGGBB"></div>`;
  const numField=(key,title,value,step='1')=>`<div class="survey-map-editor-row"><label>${title}</label>
    <input type="number" step="${step}" min="0" data-survey-label-field="${key}" value="${Number(value)||0}"></div>`;
  return `<div class="survey-map-label-edit">
    ${isRoom?`<div class="survey-map-editor-row"><label>表示項目</label>
      <select data-survey-label-field="roomDisplay">
        <option value="number" ${record.roomDisplay!=='name'?'selected':''}>部屋No.</option>
        <option value="name" ${record.roomDisplay==='name'?'selected':''}>部屋名</option>
      </select></div>`:''}
    <div class="survey-map-editor-row"><label>表示テキスト</label>
      <textarea data-survey-label-field="text">${escapeLabel(record.text||'')}</textarea></div>
    <div class="survey-map-editor-row"><label>幅 (mm)</label>
      <input type="number" min="1" step=".5" data-survey-label-field="widthMm" value="${(Number(record.width)||500)/100}"></div>
    <div class="survey-map-editor-row"><label>高さ (mm)</label>
      <input type="number" min="1" step=".5" data-survey-label-field="heightMm" value="${(Number(record.height)||300)/100}"></div>
    ${numField('fontSize','文字サイズ (pt)',record.fontSize||6,'.5')}
    ${isRect?'':numField('borderWidth','枠線の太さ (px)',record.borderWidth||1,'.25')}
    ${isRect?['Top','Right','Bottom','Left'].map((side)=>numField('padding'+side+'Mm',({Top:'上',Right:'右',Bottom:'下',Left:'左'})[side]+'余白 (mm)',(Number(record['padding'+side]??record.padding??0))/100,'.5')).join(''):numField('paddingMm','余白 (mm)',(Number(record.padding)||0)/100,'.5')}
    ${isRect?`<div class="survey-map-editor-row"><label>文字の左右配置</label><select data-survey-label-field="alignH">${[['left','左'],['center','中央'],['right','右']].map(([v,t])=>`<option value="${v}" ${record.alignH===v||(!record.alignH&&v==='center')?'selected':''}>${t}</option>`).join('')}</select></div><div class="survey-map-editor-row"><label>文字の上下配置</label><select data-survey-label-field="alignV">${[['top','上'],['middle','中央'],['bottom','下']].map(([v,t])=>`<option value="${v}" ${record.alignV===v||(!record.alignV&&v==='middle')?'selected':''}>${t}</option>`).join('')}</select></div>`:''}
    ${colorField('textColor','文字色','#111111')}
    ${isRect?'':`<label class="survey-map-fill-toggle"><input type="checkbox" data-survey-label-field="borderEnabled" ${record.borderEnabled?'checked':''}> 枠線を付ける</label>${colorField('strokeColor','枠線色','#111111')}<label class="survey-map-fill-toggle"><input type="checkbox" data-survey-label-field="backgroundEnabled" ${record.backgroundEnabled?'checked':''}> 背景色を付ける</label>${colorField('backgroundColor','背景色','#ffffff')}`}
    ${isMaterial?`<div class="survey-map-editor-row"><label>判定別の初期配色</label>
      <select data-survey-material-palette>
      <option value="">現在の配色を維持</option><option value="none">未確定・含有なし</option>
      <option value="positive">含有</option><option value="assumed">みなし</option></select></div>`:''}
  </div>`;
}
