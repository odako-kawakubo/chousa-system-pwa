/**
 * 設定タブ内の「出力」セクション。
 * 設定タブ本体の描画責務から帳票設定を分離する。
 */
import { DEFAULT_OUTPUT_SETTINGS, getOutputSettings, saveOutputSettings } from '../output/output-settings-store.js';
import { renderOutputSettingsControls, collectOutputSettings } from '../output/output-settings-ui.js';

let draft = null;

function ensureSection(root) {
  const subtabs = root.querySelector('.settings-subtabs');
  const settingsRoot = root.querySelector('.settings-root');
  if (!subtabs || !settingsRoot) return;

  if (!subtabs.querySelector('[data-settings-section="output"]')) {
    subtabs.insertAdjacentHTML('beforeend', '<button type="button" class="btn settings-subtab" data-settings-section="output">出力</button>');
  }

  let panel = settingsRoot.querySelector('[data-settings-panel="output"]');
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'settings-section';
    panel.dataset.settingsPanel = 'output';
    panel.hidden = true;
    settingsRoot.appendChild(panel);
  }
  return panel;
}

function renderPanel(panel) {
  if (!panel) return;
  const settings = draft || getOutputSettings();
  panel.innerHTML = `<div class="settings-grid"><section class="settings-card settings-output-card"><div class="settings-card-head"><div><h3>出力設定</h3><div class="hint">PDF帳票の文字サイズ、タイトル追記、注記、写真帳表示を設定します。出力タブでは実PDFを見ながら同じ項目を調整できます。</div></div><span class="pill">ローカル</span></div>${renderOutputSettingsControls(settings)}<div class="settings-action-row settings-output-actions"><button type="button" class="btn" data-settings-output-reset>初期値に戻す</button><button type="button" class="btn" data-settings-output-undo>元に戻す</button><button type="button" class="btn primary" data-settings-output-save>保存</button></div></section></div>`;
}

export function mountOutputSettingsSection(root) {
  const panel = ensureSection(root);
  renderPanel(panel);
}

export function bindOutputSettingsSection(root) {
  if (!root || root.dataset.outputSettingsEventsBound === '1') return;
  root.dataset.outputSettingsEventsBound = '1';

  root.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-settings-panel="output"] [data-output-setting]');
    if (!input) return;
    const panel = root.querySelector('[data-settings-panel="output"]');
    draft = collectOutputSettings(panel, draft || getOutputSettings());
  });

  root.addEventListener('change', (event) => {
    const input = event.target.closest?.('[data-settings-panel="output"] [data-output-setting]');
    if (!input) return;
    const panel = root.querySelector('[data-settings-panel="output"]');
    draft = collectOutputSettings(panel, draft || getOutputSettings());
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-settings-output-reset]')) {
      draft = { ...DEFAULT_OUTPUT_SETTINGS };
      renderPanel(root.querySelector('[data-settings-panel="output"]'));
      return;
    }
    if (event.target.closest('[data-settings-output-undo]')) {
      draft = getOutputSettings();
      renderPanel(root.querySelector('[data-settings-panel="output"]'));
      return;
    }
    if (event.target.closest('[data-settings-output-save]')) {
      const panel = root.querySelector('[data-settings-panel="output"]');
      draft = saveOutputSettings(collectOutputSettings(panel, draft || getOutputSettings()));
      renderPanel(panel);
    }
  });
}
