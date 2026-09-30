/**
 * Outputタブの写真編集/設定サイドパネルHTMLを生成する。
 * 状態変更・イベント処理・PDF生成は行わない。
 */
import { renderOutputSettingsControls } from './output-settings-ui.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderVisualEditor(vm) {
  const items = vm?.visualPhotoItems || [];
  if (!items.length) {
    return '<div class="output-editor-empty">写真帳の対象建材がありません。</div>';
  }

  return `<div class="output-editor-list">${items.map((item) => {
    const label = [
      `建材No.${item.materialNo}`,
      item.part,
      item.name
    ].filter((value) => String(value ?? '').trim()).join('　');
    const state = item.photoId ? '選択済み' : '未選択';

    return `<div class="output-editor-row">
      <div class="output-editor-row-main">
        <b>${escapeHtml(label)}</b>
        <span>${escapeHtml(state)}</span>
      </div>
      <button type="button" class="btn small" data-output-visual-expand="${escapeHtml(item.materialId)}">写真選択</button>
    </div>`;
  }).join('')}</div>`;
}

function renderSamplingEditor(vm) {
  const pages = vm?.samplingPhotoPages || [];
  if (!pages.length) {
    return '<div class="output-editor-empty">採取写真帳の対象がありません。</div>';
  }

  return `<div class="output-editor-list">${pages.map((page) => {
    const sampleLabel = [
      page.sampleName,
      page.samplingPlace ? `部屋No.${page.samplingPlace}` : ''
    ].filter(Boolean).join('　');

    const stages = (page.stages || []).map((stage) => `
      <div class="output-sampling-editor-stage">
        <div class="output-sampling-editor-head">
          <b>${escapeHtml(stage.label || stage.type)}</b>
          <button
            type="button"
            class="btn small"
            data-output-sampling-expand="${escapeHtml(page.materialId)}"
            data-output-branch="${Number(page.branch) || 0}"
            data-output-stage="${escapeHtml(stage.type)}"
          >写真選択</button>
        </div>
        <textarea
          class="output-sampling-editor-memo"
          rows="3"
          placeholder="撮影メモ"
          data-output-sampling-memo-editor
          data-output-material-id="${escapeHtml(page.materialId)}"
          data-output-branch="${Number(page.branch) || 0}"
          data-output-stage="${escapeHtml(stage.type)}"
        >${escapeHtml(stage.memo || '')}</textarea>
      </div>
    `).join('');

    return `<section class="output-editor-group">
      <div class="output-editor-group-title">${escapeHtml(sampleLabel || `建材No.${page.materialNo || ''}`)}</div>
      ${stages}
    </section>`;
  }).join('')}</div>`;
}

function renderEditorPanel(vm, activeView) {
  if (activeView === 'visual-photos') {
    return `<aside class="output-editor-panel">
      <div class="output-editor-title">写真帳編集</div>
      ${renderVisualEditor(vm)}
    </aside>`;
  }

  if (activeView === 'sampling-photos') {
    return `<aside class="output-editor-panel">
      <div class="output-editor-title">採取写真帳編集</div>
      ${renderSamplingEditor(vm)}
    </aside>`;
  }

  return '';
}

function renderSettingsPanel({ settingsOpen, settingsDraft, savedSettings }) {
  if (!settingsOpen) return '';

  return `<aside class="output-settings-panel" data-output-settings-panel>
    <div class="output-settings-panel-head">
      <b>出力設定</b>
      <button type="button" class="btn small" data-output-settings-close>閉じる</button>
    </div>
    <div class="output-settings-panel-body">
      ${renderOutputSettingsControls(settingsDraft || savedSettings)}
    </div>
    <div class="output-settings-panel-actions">
      <button type="button" class="btn small" data-output-settings-undo>元に戻す</button>
      <button type="button" class="btn small" data-output-settings-default>初期値</button>
      <span></span>
      <button type="button" class="btn primary small" data-output-settings-save>保存</button>
    </div>
  </aside>`;
}

export function hasOutputSidePanel({ activeView, settingsOpen }) {
  return Boolean(
    settingsOpen
    || activeView === 'visual-photos'
    || activeView === 'sampling-photos'
  );
}

export function renderOutputSidePanels({
  vm,
  activeView,
  settingsOpen,
  settingsDraft,
  savedSettings
}) {
  const settings = renderSettingsPanel({
    settingsOpen,
    settingsDraft,
    savedSettings
  });
  const editor = renderEditorPanel(vm, activeView);

  if (!settings && !editor) return '';
  return `<div class="output-side-stack">${settings}${editor}</div>`;
}
