/**
 * 帳票設定フォームの共通UI。
 */
import { normalizeOutputSettings } from './output-settings-store.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

export function ensureOutputSettingsStyles() {
  if (document.querySelector('style[data-output-settings-ui-style]')) return;
  const style = document.createElement('style');
  style.dataset.outputSettingsUiStyle = '1';
  style.textContent = `
    .output-side-stack{display:flex;flex-direction:column;gap:10px;min-width:0}
    .output-settings-panel{position:sticky;top:calc(var(--finish-page-stack-h,96px) + 44px);max-height:calc(100vh - 170px);overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
    .output-settings-panel-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--panel);font-size:13px}
    .output-settings-panel-body{padding:10px}
    .output-settings-panel-actions{position:sticky;bottom:0;display:grid;grid-template-columns:auto auto 1fr auto;gap:6px;padding:9px 10px;border-top:1px solid var(--line);background:var(--panel)}
    .output-settings-controls{display:flex;flex-direction:column;gap:10px}
    .output-settings-group{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--surface-soft)}
    .output-settings-group h4{margin:0;font-size:12px}
    .output-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .output-setting-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;color:var(--text-subtle)}
    .output-setting-field>input,.output-setting-field>textarea,.output-setting-field>select,.output-setting-number input{box-sizing:border-box;width:100%;border:1px solid var(--line-strong);border-radius:6px;background:var(--panel);color:var(--text);font:inherit;padding:7px 8px}
    .output-setting-field>textarea{resize:vertical;line-height:1.45}
    .output-setting-wide{grid-column:1/-1}
    .output-setting-number{display:grid;grid-template-columns:minmax(0,1fr) 28px;align-items:center;gap:4px}
    .output-setting-number em{font-style:normal;text-align:center;font-size:10px;color:var(--text-subtle)}
    .settings-output-card{grid-column:1/-1}
    .settings-output-actions{justify-content:flex-end}
    .settings-output-card .output-settings-controls{margin-top:8px}
    .settings-output-card .output-settings-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
    .output-zoom-label{min-width:52px}
    .output-toolbar .btn.active{background:var(--main);border-color:var(--main);color:var(--text-on-accent)}
    @media (max-width:1100px){.output-settings-panel{position:static;max-height:none}.settings-output-card .output-settings-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:700px){.output-settings-grid,.settings-output-card .output-settings-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function numberField(label,key,value,min,max,step=.5) {
  return `<label class="output-setting-field"><span>${esc(label)}</span><div class="output-setting-number"><input type="number" min="${min}" max="${max}" step="${step}" value="${esc(value)}" data-output-setting="${key}"><em>pt</em></div></label>`;
}

function mmField(label,key,value,min,max,step=.5) {
  return `<label class="output-setting-field"><span>${esc(label)}</span><div class="output-setting-number"><input type="number" min="${min}" max="${max}" step="${step}" value="${esc(value)}" data-output-setting="${key}"><em>mm</em></div></label>`;
}

export function renderOutputSettingsControls(settings) {
  const s = normalizeOutputSettings(settings);
  return `<div class="output-settings-controls">
    <section class="output-settings-group">
      <h4>共通</h4>
      <div class="output-settings-grid">${numberField('タイトル文字','titleSize',s.titleSize,14,24)}${numberField('注記文字','noteSize',s.noteSize,5.5,9)}</div>
      <label class="output-setting-field output-setting-wide"><span>下部注記</span><textarea rows="6" data-output-setting="noteText">${esc(s.noteText)}</textarea></label>
    </section>
    <section class="output-settings-group">
      <h4>建材リスト</h4>
      <div class="output-settings-grid">${numberField('本文文字','materialBodySize',s.materialBodySize,6.5,10)}${numberField('ヘッダー文字','materialHeaderSize',s.materialHeaderSize,6.5,10)}${mmField('ヘッダー高さ','materialHeaderHeight',s.materialHeaderHeight,5.5,10)}</div>
      <label class="output-setting-field output-setting-wide"><span>タイトル追記</span><input value="${esc(s.materialTitleSuffix)}" data-output-setting="materialTitleSuffix" placeholder="例：E棟"></label>
    </section>
    <section class="output-settings-group">
      <h4>部屋別リスト</h4>
      <div class="output-settings-grid">${numberField('本文文字','roomBodySize',s.roomBodySize,6.5,10)}${numberField('ヘッダー文字','roomHeaderSize',s.roomHeaderSize,6.5,10)}${mmField('ヘッダー高さ','roomHeaderHeight',s.roomHeaderHeight,5.5,10)}</div>
      <label class="output-setting-field output-setting-wide"><span>タイトル追記</span><input value="${esc(s.roomTitleSuffix)}" data-output-setting="roomTitleSuffix" placeholder="例：E棟"></label>
    </section>
    <section class="output-settings-group">
      <h4>建材写真帳</h4>
      <div class="output-settings-grid">${numberField('キャプション文字','visualCaptionSize',s.visualCaptionSize,7,12)}
        <label class="output-setting-field"><span>キャプション表示</span><select data-output-setting="visualCaptionLayout"><option value="one-line"${s.visualCaptionLayout==='one-line'?' selected':''}>1行</option><option value="two-line"${s.visualCaptionLayout==='two-line'?' selected':''}>2行</option></select></label>
      </div>
    </section>
    <section class="output-settings-group">
      <h4>採取写真帳</h4>
      <div class="output-settings-grid">${numberField('基本情報','samplingMetaSize',s.samplingMetaSize,7,12)}${numberField('撮影状況','samplingStatusSize',s.samplingStatusSize,7,12)}${numberField('メモ','samplingMemoSize',s.samplingMemoSize,6.5,10)}</div>
    </section>
  </div>`;
}

export function collectOutputSettings(container, base = {}) {
  const next = { ...base };
  container?.querySelectorAll?.('[data-output-setting]').forEach((input) => {
    const key = input.dataset.outputSetting;
    if (!key) return;
    next[key] = input.type === 'number' ? Number(input.value) : input.value;
  });
  return normalizeOutputSettings(next);
}
