/**
 * 帳票設定フォームの共通UI。
 * スタイルは css/output.css に集約する。
 */
import { normalizeOutputSettings } from './output-settings-store.js';
import { OUTPUT_TABLE_COLUMNS, tableWidthTotal } from './output-table-layout.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function numberField(label,key,value,min,max,step=.5) {
  return `<label class="output-setting-field"><span>${esc(label)}</span><div class="output-setting-number"><input type="number" min="${min}" max="${max}" step="${step}" value="${esc(value)}" data-output-setting="${key}"><em>pt</em></div></label>`;
}
function mmField(label,key,value,min,max,step=.5) {
  return `<label class="output-setting-field"><span>${esc(label)}</span><div class="output-setting-number"><input type="number" min="${min}" max="${max}" step="${step}" value="${esc(value)}" data-output-setting="${key}"><em>mm</em></div></label>`;
}

/**
 * 編集専用の表。表示サイズはmm比例の固定スケール。
 * ハンドル操作はControllerへ委譲し、画面DOMに旧幅の複製を持たない。
 */
function renderColumnEditor(kind,settings) {
  const columns=OUTPUT_TABLE_COLUMNS[kind]||[];
  const widths=settings.tableWidths[kind];
  const total=tableWidthTotal(kind,widths);
  return `<div class="output-column-editor" data-output-column-editor="${kind}">
    <div class="output-column-editor-heading"><b>列幅編集</b><small>境界線をドラッグ、またはmm入力</small></div>
    <div class="output-column-editor-scroll"><div class="output-column-editor-table">
      ${columns.map(([key,label])=>`<div class="output-column-editor-cell" data-output-column-cell="${kind}:${key}" style="width:${Number(widths[key])*3}px">
        <span>${esc(label)}</span><span class="output-column-editor-handle" role="separator" aria-label="${esc(label)}の列幅" data-output-column-handle="${kind}:${key}"></span>
      </div>`).join('')}
    </div></div>
    <div class="output-column-editor-fields">
      ${columns.map(([key,label])=>`<label><span>${esc(label)}</span><input type="number" min="5" max="100" step=".1" value="${widths[key]}" data-output-column-input="${kind}:${key}"><em>mm</em></label>`).join('')}
    </div>
    <div class="output-column-editor-total" data-output-column-total="${kind}">合計 ${total.toFixed(1)} / 190mm</div>
  </div>`;
}

export function renderOutputSettingsControls(settings) {
  const s=normalizeOutputSettings(settings);
  return `<div class="output-settings-controls">
    <section class="output-settings-group"><h4>共通</h4><label class="output-setting-field output-setting-wide"><span>PDFフォント</span><select data-output-setting="pdfFont"><option value="udp"${s.pdfFont==='udp'?' selected':''}>BIZ UDPゴシック</option><option value="ud"${s.pdfFont==='ud'?' selected':''}>BIZ UDゴシック</option></select></label><div class="output-settings-grid">${numberField('タイトル文字','titleSize',s.titleSize,14,24)}${numberField('注記文字','noteSize',s.noteSize,5.5,9)}</div><label class="output-setting-field output-setting-wide"><span>下部注記</span><textarea rows="6" data-output-setting="noteText">${esc(s.noteText)}</textarea></label></section>
    <section class="output-settings-group"><h4>建材リスト</h4><div class="output-settings-grid">${numberField('本文文字','materialBodySize',s.materialBodySize,6.5,10)}${numberField('ヘッダー文字','materialHeaderSize',s.materialHeaderSize,6.5,10)}${mmField('ヘッダー高さ','materialHeaderHeight',s.materialHeaderHeight,5.5,10)}</div>${renderColumnEditor('materials',s)}<label class="output-setting-field output-setting-wide"><span>タイトル追記</span><input value="${esc(s.materialTitleSuffix)}" data-output-setting="materialTitleSuffix" placeholder="例：E棟"></label></section>
    <section class="output-settings-group"><h4>部屋別リスト</h4><div class="output-settings-grid">${numberField('本文文字','roomBodySize',s.roomBodySize,6.5,10)}${numberField('ヘッダー文字','roomHeaderSize',s.roomHeaderSize,6.5,10)}${mmField('ヘッダー高さ','roomHeaderHeight',s.roomHeaderHeight,5.5,10)}</div>${renderColumnEditor('rooms',s)}<label class="output-setting-field output-setting-wide"><span>タイトル追記</span><input value="${esc(s.roomTitleSuffix)}" data-output-setting="roomTitleSuffix" placeholder="例：E棟"></label></section>
    <section class="output-settings-group"><h4>部位別リスト</h4>
      <label class="output-setting-field output-setting-wide"><span>出力形式</span><select data-output-setting="partListMode"><option value="floor"${s.partListMode==='floor'?' selected':''}>階ごと版</option><option value="building"${s.partListMode==='building'?' selected':''}>全階まとめ版</option></select></label>
      <div class="output-settings-grid">${numberField('本文文字','partBodySize',s.partBodySize,6.5,10)}${numberField('ヘッダー文字','partHeaderSize',s.partHeaderSize,6.5,10)}${mmField('ヘッダー高さ','partHeaderHeight',s.partHeaderHeight,5.5,10)}</div>
      ${renderColumnEditor('parts',s)}
    </section>
    <section class="output-settings-group"><h4>建材写真帳</h4><div class="output-settings-grid">${numberField('キャプション文字','visualCaptionSize',s.visualCaptionSize,7,12)}<label class="output-setting-field"><span>キャプション表示</span><select data-output-setting="visualCaptionLayout"><option value="one-line"${s.visualCaptionLayout==='one-line'?' selected':''}>1行</option><option value="two-line"${s.visualCaptionLayout==='two-line'?' selected':''}>2行</option></select></label></div></section>
    <section class="output-settings-group"><h4>採取写真帳</h4><div class="output-settings-grid">${numberField('基本情報','samplingMetaSize',s.samplingMetaSize,7,12)}${numberField('撮影状況','samplingStatusSize',s.samplingStatusSize,7,12)}${numberField('メモ','samplingMemoSize',s.samplingMemoSize,6.5,10)}</div></section>
  </div>`;
}

export function collectOutputSettings(container,base={}) {
  const next={...base};
  container?.querySelectorAll?.('[data-output-setting]').forEach((input)=>{const key=input.dataset.outputSetting;if(!key)return;next[key]=input.type==='number'?Number(input.value):input.value;});
  return normalizeOutputSettings(next);
}
