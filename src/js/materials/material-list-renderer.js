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
  const roomNameMode = Boolean(options.roomNameMode);
  const analysisColumnsOpen = Boolean(options.analysisColumnsOpen);
  const partWidth = computePartColumnWidth(rows);

  root.innerHTML = `
    <div class="panel material-list-panel">
      ${renderToolbar(rows, selectedMaterialId, stats, colorMode, roomNameMode, analysisColumnsOpen)}
      <div class="material-list-table-wrap">
        <table
          class="material-list-table${colorMode ? ' color-mode' : ''}"
          id="materialsTable"
          style="--material-part-width:${partWidth}px"
        >
          <thead>${renderHeader(analysisColumnsOpen)}</thead>
          <tbody>${renderRows(rows, selectedMaterialId, colorMode, analysisColumnsOpen)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderToolbar(rows, selectedMaterialId, stats, colorMode, roomNameMode, analysisColumnsOpen) {
  return `
    <div class="material-list-toolbar">
      <div class="material-list-toolbar-left">
        <button type="button" class="btn small material-list-color-toggle" data-action="toggle-material-color">
          カラー表示 ${colorMode ? 'ON' : 'OFF'}
        </button>
        <button type="button" class="btn small material-list-room-name-toggle" data-action="toggle-material-room-name">
          部屋名表示 ${roomNameMode ? 'ON' : 'OFF'}
        </button>
        <button type="button" class="btn small material-list-analysis-toggle" data-action="toggle-material-analysis-columns">
          分析欄を${analysisColumnsOpen ? '隠す' : '表示'}
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

function renderHeader(analysisColumnsOpen) {
  return `
    <tr>
      <th class="col-no">No.</th>
      <th class="col-id">ID</th>
      <th class="col-part">部位</th>
      <th class="col-name">建材名称</th>
      <th class="col-place">建材使用箇所</th>
      <th class="col-level">レベル</th>
      <th class="col-analysis">分析の要否</th>
      ${analysisColumnsOpen ? `
        <th class="col-analysis-result">分析結果</th>
        <th class="col-analysis-remarks">分析備考</th>
      ` : ''}
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

function renderRows(rows, selectedMaterialId, colorMode, analysisColumnsOpen) {
  if (!rows.length) {
    return `<tr><td colspan="${analysisColumnsOpen ? 17 : 15}" class="material-list-empty">対象建材はまだありません</td></tr>`;
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
        <td class="col-part material-color-cell"><div class="material-part-lines">${renderPartLines(row.part)}</div></td>
        <td class="col-name material-color-cell material-edit-cell">
          ${renderTextDisplay(row, 'name', row.name, '建材名称')}
        </td>
        <td class="col-place"><div class="wrap2">${displayText(row.usageLocationDisplay ?? row.usageLocation)}</div></td>
        <td class="col-level material-control-cell">
          ${renderSelect(row, 'level', MATERIAL_LEVEL_OPTIONS, row.level)}
        </td>
        <td class="col-analysis material-control-cell">
          ${renderAnalysisSelect(row)}
        </td>
        ${analysisColumnsOpen ? `
          <td class="col-analysis-result material-edit-cell">
            ${renderTextDisplay(row, 'analysisResult', row.analysisResult, '分析結果', '分析結果')}
          </td>
          <td class="col-analysis-remarks material-edit-cell">
            ${renderTextDisplay(row, 'remarks', row.remarks, '分析備考', '分析備考')}
          </td>
        ` : ''}
        <td class="col-note material-edit-cell">
          ${renderTextDisplay(row, 'note', row.note, '調査備考', '調査備考')}
        </td>
        <td class="col-sample-count material-control-cell${row.samplingEnabled ? '' : ' disabled-cell'}">
          ${renderSelect(row, 'sampleCount', row.samplingEnabled ? MATERIAL_SAMPLE_COUNT_OPTIONS : ['-', ...MATERIAL_SAMPLE_COUNT_OPTIONS], row.sampleCountLabel, !row.samplingEnabled)}
        </td>
        ${renderSamplePlaceCell(row, 1)}
        ${renderSamplePlaceCell(row, 2)}
        ${renderSamplePlaceCell(row, 3)}
        <td class="col-sample-part material-control-cell${row.samplingEnabled ? '' : ' disabled-cell'}">
          ${renderSamplePartMultiSelect(row, !row.samplingEnabled)}
        </td>
        <td class="col-sample-done material-control-cell${row.samplingEnabled ? '' : ' disabled-cell'}">
          <input
            type="checkbox"
            class="material-checkbox"
            data-material-control
            data-field="sampleDone"
            data-material-id="${escapeAttr(row.materialId)}"
            ${row.sampleDone ? 'checked' : ''}
            ${row.samplingEnabled ? '' : 'disabled'}
            aria-label="採取 ${escapeAttr(row.inputId)}"
          />
        </td>
        <td class="col-sample-date material-control-cell${row.samplingEnabled ? '' : ' disabled-cell'}">
          <input
            type="date"
            class="material-date-input"
            data-material-control
            data-field="sampleDate"
            data-material-id="${escapeAttr(row.materialId)}"
            value="${escapeAttr(row.sampleDate)}"
            ${row.samplingEnabled ? '' : 'disabled'}
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

function renderSelect(row, field, values, current, disabled = false) {
  return `
    <select
      class="material-select"
      data-material-control
      data-field="${escapeAttr(field)}"
      data-material-id="${escapeAttr(row.materialId)}"
      ${disabled ? 'disabled' : ''}
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
      ${renderCandidateSelect(row, field, row.sampleLocationOptions || row.usagePlaces, current, !enabled)}
    </td>
  `;
}

function renderSamplePartMultiSelect(row, disabled = false) {
  const selected = Array.isArray(row.samplePart) ? row.samplePart : [];
  const values = uniqueWithCurrent(row.usageParts, selected);
  const label = selected.length ? selected.join('、') : '選択';

  return `
    <details class="material-multi-select${disabled ? ' is-disabled' : ''}" data-material-multi-select data-disabled="${disabled ? '1' : '0'}">
      <summary class="material-multi-select-summary" title="${escapeAttr(label)}">${escapeHtml(label)}</summary>
      <div class="material-multi-select-menu">
        <div class="material-multi-select-menu-head">
          <span>採取部位</span>
          <button type="button" class="material-multi-select-close" data-action="close-material-multi-select" aria-label="閉じる">×</button>
        </div>
        ${values.length ? values.map((value) => `
          <label class="material-multi-select-option">
            <input
              type="checkbox"
              data-material-multi-part
              data-material-id="${escapeAttr(row.materialId)}"
              value="${escapeAttr(value)}"
              ${selected.includes(value) ? 'checked' : ''}
              ${disabled ? 'disabled' : ''}
            />
            <span>${escapeHtml(value)}</span>
          </label>
        `).join('') : '<span class="material-multi-select-empty">候補なし</span>'}
      </div>
    </details>
  `;
}

function renderPartLines(value) {
  const parts = String(value || '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parts.length) return '<span class="placeholder-value">－</span>';

  const lines = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push(parts.slice(index, index + 2).join('、'));
  }
  return lines.map((line) => `<span class="material-part-line">${escapeHtml(line)}</span>`).join('');
}

function renderCandidateSelect(row, field, candidates, current, disabled = false) {
  const options = [];
  (candidates || []).forEach((candidate) => {
    const value = String(candidate && typeof candidate === 'object' ? candidate.value : candidate || '').trim();
    if (!value || options.some((item) => item.value === value)) return;
    const label = String(candidate && typeof candidate === 'object' ? candidate.display : candidate || value).trim() || value;
    options.push({ value, label });
  });
  const currentValue = String(current || '').trim();
  if (currentValue && !options.some((item) => item.value === currentValue)) {
    options.push({ value: currentValue, label: currentValue });
  }
  return `
    <select
      class="material-select compact-select"
      data-material-control
      data-field="${escapeAttr(field)}"
      data-material-id="${escapeAttr(row.materialId)}"
      ${disabled ? 'disabled' : ''}
    >
      <option value=""></option>
      ${options.map((item) => `<option value="${escapeAttr(item.value)}" ${currentValue === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
    </select>
  `;
}

function uniqueWithCurrent(candidates, current) {
  const currentValues = Array.isArray(current) ? current : [current];
  const values = [];
  [...(candidates || []), ...currentValues]
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
    const parts = String(row.part || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
    for (let index = 0; index < parts.length; index += 2) {
      const line = parts.slice(index, index + 2).join('、');
      maxChars = Math.max(maxChars, Array.from(line).length);
    }
  });
  return Math.max(60, Math.min(100, 18 + maxChars * 9));
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
