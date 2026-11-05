/**
 * 建材リスト転記の読み取り専用プレビュー。
 * コピーはF5からAK列までの連続したTSV。空欄セルも意図した転記対象。
 */
import * as materialRecordStore from '../store/material-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { closeDrawer } from '../ui/drawer.js';
import { showTab } from '../ui/tabs.js';
import { activateExcelTransferWarnings, focusExcelTransferMissing } from '../materials/material-list-controller.js';
import { buildMaterialExcelSnapshot } from './material-excel-transfer-data.js';
import {
  samplerValues, escapeExcelHtml, syncExcelSamplerControls,
  updateExcelSamplerSelection, updateExcelSamplerInput,
  ensureExcelTransferStyles, writeExcelClipboard
} from './excel-transfer-shared.js';

let modal;
const preview = () => buildMaterialExcelSnapshot(materialRecordStore.getAll(), samplerValues());
const labels = {
  F:'建材名称',G:'使用部位',H:'分析の要否',I:'含有結果',J:'調査備考',
  K:'建材レベル',L:'施工範囲1',AE:'施工範囲20',
  AF:'採取数',AG:'採取場所1',AH:'採取場所2',AI:'採取場所3',
  AJ:'採取日',AK:'採取者'
};

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

  const headings = data.columns.map((column) =>
    `<th>${escapeExcelHtml(column)}列　${escapeExcelHtml(labels[column] || (column >= 'L' && column <= 'Z' || /A[A-E]/.test(column) ? '施工範囲' : ''))}</th>`).join('');
  const body = data.rows.map((row, index) =>
    `<tr><th>${index + 5}行（建材No.${escapeExcelHtml(row.materialNo)}）</th>${row.values.map((cell, col) => {
      const column = data.columns[col];
      const fieldsByColumn = {
        F:['name'],H:['analysisRequired'],I:['analysisResult'],K:['level'],
        AF:['sampleCount'],AG:['sampleLocation1'],AH:['sampleLocation2'],AI:['sampleLocation3'],
        AJ:['sampleDate']
      };
      const fields = fieldsByColumn[column] || [];
      const invalid = warnings.some((issue) => issue.materialId === row.materialId && fields.includes(issue.field));
      const samplerMissing = column === 'AK' && data.issues.some((issue) => !issue.materialId);
      return `<td${invalid || samplerMissing ? ' class="excel-transfer-missing"' : ''}>${escapeExcelHtml(cell)}</td>`;
    }).join('')}</tr>`).join('');
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
    message.textContent = 'コピーしました。Excel「建材リスト」シートのF5へ値のみ貼り付けてください。';
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
        <p class="hint">貼り付け先：Excel「建材リスト」シートの F5（値のみ貼り付け）</p>
        <div class="excel-transfer-sampler">
          <label>会社名<select data-excel-company></select><input type="text" data-excel-custom-company placeholder="会社名を入力" hidden></label>
          <label>採取者氏名<select data-excel-person></select><input type="text" data-excel-custom-person placeholder="氏名を入力" hidden></label>
        </div>
        <div class="excel-transfer-check" data-material-excel-check></div>
        <h4>コピー内容のプレビュー</h4>
        <div class="excel-transfer-table-wrap"><table class="excel-transfer-table" data-material-excel-table></table></div>
        <p class="hint">建材No.順に1行ずつ転記します。施工範囲はL〜AEの20列で、20件目以降はAE列にまとめます。</p>
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
  modal.addEventListener('change',(event) => {
    if (!updateExcelSamplerSelection(event.target)) return;
    syncExcelSamplerControls(modal);
    render();
  });
  modal.addEventListener('input',(event) => {
    if (!updateExcelSamplerInput(event.target)) return;
    render();
  });
}

export function openMaterialExcelTransfer() {
  ensureModal();
  syncExcelSamplerControls(modal);
  render();
  closeDrawer('operation');
  modal.classList.add('open');
}
