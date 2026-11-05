/**
 * 建材リスト転記の読み取り専用プレビュー。
 * コピーはF5からAE列までの連続したTSV。画面上は施工範囲を一欄にまとめて表示する。
 */
import * as materialRecordStore from '../store/material-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { closeDrawer } from '../ui/drawer.js';
import { showTab } from '../ui/tabs.js';
import { activateExcelTransferWarnings, focusExcelTransferMissing } from '../materials/material-list-controller.js';
import { buildMaterialExcelSnapshot } from './material-excel-transfer-data.js';
import { escapeExcelHtml, ensureExcelTransferStyles, writeExcelClipboard } from './excel-transfer-shared.js';

let modal;
const preview = () => buildMaterialExcelSnapshot(materialRecordStore.getAll());
const labels = {
  F:'建材名称',G:'使用部位',H:'分析の要否',I:'含有結果',J:'調査備考',
  K:'建材レベル'
};
const USAGE_START = 6;
const USAGE_END = 26;


function render() {
  const data = preview();
  const warnings = data.issues.filter((item) => item.materialId);
  const check = modal.querySelector('[data-material-excel-check]');
  check.innerHTML = !data.issues.length
    ? '<b class="excel-transfer-ok">入力チェック：確認事項なし</b>'
    : `<b>入力チェック：${data.issues.length}項目に確認が必要です</b><ul>${data.issues.map((item) => {
        const name = item.materialId ? `建材No.${item.materialNo || '?'}：` : '';
        return `<li>${escapeExcelHtml(name + item.label + '：' + (item.detail || '未入力'))}</li>`;
      }).join('')}</ul>`;

  const basicColumns = data.columns.slice(0, USAGE_START);
  const headings = basicColumns.map((column) =>
    `<th>${escapeExcelHtml(column)}列　${escapeExcelHtml(labels[column])}</th>`).join('')
    + '<th>L～AE列　施工範囲（部屋No.）</th>';
  const body = data.rows.map((row, index) => {
    const basicCells = row.values.slice(0, USAGE_START).map((cell, col) => {
      const column = basicColumns[col];
      const fieldsByColumn = {
        F:['name'],H:['analysisRequired'],I:['analysisResult'],K:['level']
      };
      const invalid = warnings.some((issue) =>
        issue.materialId === row.materialId && (fieldsByColumn[column] || []).includes(issue.field));
      return `<td${invalid ? ' class="excel-transfer-missing"' : ''}>${escapeExcelHtml(cell)}</td>`;
    }).join('');
    const usage = row.values.slice(USAGE_START, USAGE_END).filter(Boolean).join('、');
    return `<tr><th>${index + 5}行（建材No.${escapeExcelHtml(row.materialNo)}）</th>${basicCells}<td>${escapeExcelHtml(usage)}</td></tr>`;
  }).join('');

  modal.querySelector('[data-material-excel-table]').innerHTML =
    `<thead><tr><th>Excel行</th>${headings}</tr></thead><tbody>${body}</tbody>`;
  modal.querySelector('[data-material-excel-fix]').hidden = warnings.length === 0;
  modal.querySelector('[data-material-excel-copy]').disabled = !data.rows.length;
  modal.querySelector('[data-material-excel-message]').textContent =
    data.rows.length ? '' : '転記対象の建材がありません。';
}

function close() {
  modal?.classList.remove('open');
}

function moveToFirstIssue() {
  const data = preview();
  const first = data.issues.find((item) => item.materialId);
  if (!first) return;
  close();
  activateExcelTransferWarnings(getCurrentProject()?.projectId, data.warnings);
  showTab('materials');
  closeDrawer('operation');
  requestAnimationFrame(() => focusExcelTransferMissing(first.materialId, first.field));
}

async function copy() {
  const data = preview();
  if (!data.rows.length) return;
  if (data.issues.length && !window.confirm(`確認事項が${data.issues.length}項目あります。このままコピーしますか？`)) return;
  const message = modal.querySelector('[data-material-excel-message]');
  try {
    await writeExcelClipboard(data.tsv);
    message.textContent = 'コピーしました。Excel「建材入力」シートのF5へ値のみ貼り付けてください。';
  } catch (error) {
    message.textContent = `コピーできませんでした：${error?.message || error}`;
  }
}

function ensureModal() {
  if (modal) return;
  ensureExcelTransferStyles();
  modal = document.createElement('div');
  modal.className = 'excel-transfer-modal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','建材リスト転記');
  modal.innerHTML = `
    <div class="excel-transfer-card">
      <div class="excel-transfer-head">
        <b>建材リスト転記</b>
        <button type="button" class="btn small" data-material-excel-close>閉じる</button>
      </div>
      <div class="excel-transfer-main">
        <p class="hint">貼り付け先：Excel「建材入力」シートの F5（値のみ貼り付け）</p>
        <div class="excel-transfer-check" data-material-excel-check></div>
        <h4>コピー内容のプレビュー</h4>
        <div class="excel-transfer-table-wrap"><table class="excel-transfer-table" data-material-excel-table></table></div>
        <p class="hint">建材No.順に1行ずつ転記します。画面上は施工範囲を1欄にまとめていますが、コピー時はL～AEの20列に分けて転記します。20件目以降はAE列にまとめます。</p>
        <div class="excel-transfer-message" data-material-excel-message role="status"></div>
      </div>
      <div class="excel-transfer-actions">
        <button type="button" class="btn" data-material-excel-close>閉じる</button>
        <button type="button" class="btn" data-material-excel-fix>入力箇所へ移動</button>
        <button type="button" class="btn primary" data-material-excel-copy>コピー</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',(event) => {
    if (event.target === modal || event.target.closest('[data-material-excel-close]')) close();
    else if (event.target.closest('[data-material-excel-fix]')) moveToFirstIssue();
    else if (event.target.closest('[data-material-excel-copy]')) void copy();
  });

}

export function openMaterialExcelTransfer() {
  ensureModal();
  render();
  closeDrawer('operation');
  modal.classList.add('open');
}
