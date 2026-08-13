/**
 * src/js/materials/material-list-renderer.js
 *
 * 建材リストのDOM描画だけを担当する。
 * Store取得・更新・入力確定などの業務処理はcontroller側で行う。
 */

import {
  MATERIAL_LEVEL_OPTIONS,
  MATERIAL_ANALYSIS_OPTIONS,
  MATERIAL_SAMPLE_COUNT_OPTIONS,
  buildMaterialListStats
} from './material-list-view-model.js';

export function renderMaterialList(root, rows, selectedMaterialId, options = {}) {
  if (!root) return;

  const stats = buildMaterialListStats(rows);
  const colorMode = options.colorMode !== false;
  const partWidth = computePartColumnWidth(rows);

  root.innerHTML = `
    <div class="panel material-list-panel">
      ${renderToolbar(rows, selectedMaterialId, stats, colorMode)}
      <div class="material-list-table-wrap">
        <table
          class="material-list-table${colorMode ? ' color-mode' : ''}"
          id="materialsTable"
          style="--material-part-width:${partWidth}px"
        >
          <thead>${renderHeader()}</thead>
          <tbody>${renderRows(rows, selectedMaterialId, colorMode)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderToolbar(rows, selectedMaterialId, stats, colorMode) {
  return `
    <div class="material-list-toolbar">
      <div class="material-list-toolbar-left">
        <button type="button" class="btn small material-list-color-toggle" data-action="toggle-material-color">
          カラー表示 ${colorMode ? 'ON' : 'OFF'}
        </button>
        <span class="pill">対象建材 <b>${stats.total}</b>件</span>
        <span class="pill">採取 <b>${stats.sample}</b></span>
        <span class="pill">みなし <b>${stats.assume}</b></span>
        <span class="pill">目視等 <b>${stats.visual}</b></span>
        <span class="pill warn">未設定 <b>${stats.unset}</b></span>
      </div>
      <div class="material-list-toolbar-right">
        <span class="pill material-list-selected" data-material-selected-label>
          ${renderSelectedLabel(rows, selectedMaterialId)}
        </span>
      </div>
    </div>
  `;
}

function renderHeader() {
  return `
    <tr>
      <th class="col-no">No.</th>
      <th class="col-id">ID</th>
      <th class="col-part">部位</th>
      <th class="col-name">建材名称</th>
      <th class="col-place">建材使用箇所</th>
      <th class="col-level">レベル</th>
      <th class="col-analysis">分析の要否</th>
      <th class="col-note">調査備考</th>
      <th class="col-sample-count">採取数</th>
      <th class="col-sample-place">採取場所1</th>
      <th class="col-sample-place">採取場所2</th>
      <th class="col-sample-place">採取場所3</th>
      <th class="col-sample-part">採取部位</th>
      <th class="col-sample-done">採取</th>
      <th class="col-sample-date">採取日</th>
    </tr>
  `;
}

function renderRows(rows, selectedMaterialId, colorMode) {
  if (!rows.length) {
    return '<tr><td colspan="15" class="material-list-empty">対象建材はまだありません</td></tr>';
  }

  return rows.map((row) => {
    const selected = String(row.materialId) === String(selectedMaterialId)
      ? ' selected-material-row'
      : '';
    const rowColorStyle = colorMode && row.color
      ? ` style="--material-row-color:${escapeAttr(row.color)}"`
      : '';

    return `
      <tr class="${selected.trim()}" data-material-row data-material-id="${escapeAttr(row.materialId)}"${rowColorStyle}>
        <td class="col-no material-color-cell">${escapeHtml(row.materialNo)}</td>
        <td class="col-id material-color-cell">${escapeHtml(row.inputId)}</td>
        <td class="col-part material-color-cell"><div class="wrap2">${displayText(row.part)}</div></td>
        <td class="col-name material-color-cell material-edit-cell">
          ${renderTextDisplay(row, 'name', row.name, '建材名称')}
        </td>
        <td class="col-place"><div class="wrap2">${displayText(row.usageLocation)}</div></td>
        <td class="col-level material-control-cell">
          ${renderSelect(row, 'level', MATERIAL_LEVEL_OPTIONS, row.level)}
        </td>
        <td class="col-analysis material-control-cell">
          ${renderAnalysisSelect(row)}
        </td>
        <td class="col-note material-edit-cell">
          ${renderTextDisplay(row, 'note', row.note, '調査備考', '調査備考')}
        </td>
        <td class="col-sample-count material-control-cell">
          ${renderSelect(row, 'sampleCount', MATERIAL_SAMPLE_COUNT_OPTIONS, row.sampleCountLabel)}
        </td>
        ${renderSamplePlaceCell(row, 1)}
        ${renderSamplePlaceCell(row, 2)}
        ${renderSamplePlaceCell(row, 3)}
        <td class="col-sample-part material-control-cell">
          ${renderCandidateSelect(row, 'samplePart', row.usageParts, row.samplePart)}
        </td>
        <td class="col-sample-done material-control-cell">
          <input
            type="checkbox"
            class="material-checkbox"
            data-material-control
            data-field="sampleDone"
            data-material-id="${escapeAttr(row.materialId)}"
            ${row.sampleDone ? 'checked' : ''}
            aria-label="採取 ${escapeAttr(row.inputId)}"
          />
        </td>
        <td class="col-sample-date material-control-cell">
          <input
            type="date"
            class="material-date-input"
            data-material-control
            data-field="sampleDate"
            data-material-id="${escapeAttr(row.materialId)}"
            value="${escapeAttr(row.sampleDate)}"
            aria-label="採取日 ${escapeAttr(row.inputId)}"
          />
        </td>
      </tr>
    `;
  }).join('');
}

function renderTextDisplay(row, kind, value, label, placeholder = '') {
  const text = String(value || '');
  const visible = text || placeholder || '－';
  const placeholderClass = text ? '' : ' placeholder-value';
  return `
    <span
      class="material-cell-display${placeholderClass}"
      data-material-text-display
      data-editor-kind="${escapeAttr(kind)}"
      data-material-id="${escapeAttr(row.materialId)}"
      data-value="${escapeAttr(text)}"
      aria-label="${escapeAttr(`${label} ${row.inputId}`)}"
      tabindex="0"
    >${escapeHtml(visible)}</span>
  `;
}

function renderSelect(row, field, values, current) {
  return `
    <select
      class="material-select"
      data-material-control
      data-field="${escapeAttr(field)}"
      data-material-id="${escapeAttr(row.materialId)}"
    >
      ${values.map((value) => `<option value="${escapeAttr(value)}" ${String(current) === String(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
    </select>
  `;
}

function renderAnalysisSelect(row) {
  const current = String(row.analysisRequired || '');
  const isLegacyUnsurveyed = current === '未調査' || !current;
  return `
    <select
      class="material-select"
      data-material-control
      data-field="analysisRequired"
      data-material-id="${escapeAttr(row.materialId)}"
    >
      ${isLegacyUnsurveyed ? '<option value="未調査" selected>未調査</option>' : ''}
      ${MATERIAL_ANALYSIS_OPTIONS.map((value) => `<option value="${escapeAttr(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
    </select>
  `;
}

function renderSamplePlaceCell(row, index) {
  const field = `sampleLocation${index}`;
  const current = row[field];
  const enabled = row.sampleLocationEnabled[index - 1];
  return `
    <td class="col-sample-place material-control-cell${enabled ? '' : ' disabled-cell'}">
      ${renderCandidateSelect(row, field, row.usagePlaces, current, !enabled)}
    </td>
  `;
}

function renderCandidateSelect(row, field, candidates, current, disabled = false) {
  const values = uniqueWithCurrent(candidates, current);
  return `
    <select
      class="material-select compact-select"
      data-material-control
      data-field="${escapeAttr(field)}"
      data-material-id="${escapeAttr(row.materialId)}"
      ${disabled ? 'disabled' : ''}
    >
      <option value=""></option>
      ${values.map((value) => `<option value="${escapeAttr(value)}" ${String(current) === String(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
    </select>
  `;
}

function uniqueWithCurrent(candidates, current) {
  const values = [];
  [...(candidates || []), current]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .forEach((value) => {
      if (!values.includes(value)) values.push(value);
    });
  return values;
}

function renderSelectedLabel(rows, selectedMaterialId) {
  const row = rows.find((item) => String(item.materialId) === String(selectedMaterialId));
  if (!row) return '選択なし';
  return `選択中：【${escapeHtml(row.inputId)}】${escapeHtml(row.name)}`;
}

function computePartColumnWidth(rows) {
  let maxChars = 0;
  rows.forEach((row) => {
    const chunks = String(row.part || '').split('、');
    chunks.forEach((chunk) => {
      maxChars = Math.max(maxChars, Array.from(chunk).length);
    });
  });
  return Math.max(60, Math.min(100, 18 + maxChars * 11));
}

function displayText(value) {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text) : '<span class="placeholder-value">－</span>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
