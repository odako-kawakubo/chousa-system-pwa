/**
 * Excel転記プレビュー・採取者選択・コピー。
 * Storeの内容は読み取るだけ。編集と永続化は建材リストの既存経路に任せる。
 */
import * as materialRecordStore from '../store/material-record-store.js';
import { buildExcelTransferSnapshot, EXCEL_COMPANIES, EXCEL_SAMPLERS } from './excel-transfer-data.js';
import { getCurrentProject } from '../projects/project-store.js';
import { closeDrawer } from '../ui/drawer.js';
import { showTab } from '../ui/tabs.js';
import { activateExcelTransferWarnings, focusExcelTransferMissing } from '../materials/material-list-controller.js';

let modal = null;
let stylesheetLoaded = false;
let companyChoice = EXCEL_COMPANIES[0];
let personChoice = '';
let customCompany = '';
let customPerson = '';

const escapeHtml = (input) => String(input ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const company = () => companyChoice === '__other__' ? customCompany.trim() : companyChoice;
const person = () => personChoice === '__other__' ? customPerson.trim() : personChoice;
const snapshot = () => buildExcelTransferSnapshot(materialRecordStore.getAll(), { company:company(), person:person() });

function ensureStyles() {
  if (stylesheetLoaded || document.querySelector('link[data-excel-transfer-styles]')) return;
  stylesheetLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/excel-transfer.css';
  link.dataset.excelTransferStyles = '1';
  document.head.appendChild(link);
}

function options(items, selected, withEmpty = false) {
  const list = [
    ...(withEmpty ? [{ value:'', label:'選択してください' }] : []),
    ...items.map((item) => ({ value:item, label:item })),
    { value:'__other__', label:'その他（自由入力）' }
  ];
  return list.map(({ value, label }) =>
    `<option value="${escapeHtml(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function ensureModal() {
  if (modal) return;
  ensureStyles();
  modal = document.createElement('div');
  modal.className = 'excel-transfer-modal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','Excel転記');
  modal.innerHTML = `
    <div class="excel-transfer-card">
      <div class="excel-transfer-head">
        <b>Excel転記</b>
        <button type="button" class="btn small" data-excel-close>閉じる</button>
      </div>
      <div class="excel-transfer-main">
        <p class="hint">貼り付け先：Excel「入力」シートの B15（値のみ貼り付け）</p>
        <div class="excel-transfer-sampler">
          <label>会社名<select data-excel-company></select><input type="text" data-excel-custom-company placeholder="会社名を入力" hidden></label>
          <label>採取者氏名<select data-excel-person></select><input type="text" data-excel-custom-person placeholder="氏名を入力" hidden></label>
        </div>
        <div class="excel-transfer-check" data-excel-check></div>
        <h4>コピー内容のプレビュー</h4>
        <div class="excel-transfer-table-wrap"><table class="excel-transfer-table" data-excel-table></table></div>
        <p class="hint">試料は建材No.順です。空欄の行もコピー対象に含みます。</p>
        <div class="excel-transfer-message" data-excel-message role="status"></div>
      </div>
      <div class="excel-transfer-actions">
        <button type="button" class="btn" data-excel-close>閉じる</button>
        <button type="button" class="btn" data-excel-fix>入力箇所へ移動</button>
        <button type="button" class="btn primary" data-excel-copy>コピー</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-excel-close]')) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-excel-fix]')) moveToMissing();
    if (event.target.closest('[data-excel-copy]')) void copyExcelData();
  });
  modal.addEventListener('change', (event) => {
    if (event.target.matches('[data-excel-company]')) companyChoice = event.target.value;
    else if (event.target.matches('[data-excel-person]')) personChoice = event.target.value;
    else return;
    syncSamplerControls();
    renderPreview();
  });
  modal.addEventListener('input', (event) => {
    if (event.target.matches('[data-excel-custom-company]')) customCompany = event.target.value;
    else if (event.target.matches('[data-excel-custom-person]')) customPerson = event.target.value;
    else return;
    renderPreview();
  });
}

function syncSamplerControls() {
  modal.querySelector('[data-excel-company]').innerHTML = options(EXCEL_COMPANIES, companyChoice);
  modal.querySelector('[data-excel-person]').innerHTML = options(EXCEL_SAMPLERS, personChoice, true);
  const customCompanyInput = modal.querySelector('[data-excel-custom-company]');
  const customPersonInput = modal.querySelector('[data-excel-custom-person]');
  customCompanyInput.hidden = companyChoice !== '__other__';
  customPersonInput.hidden = personChoice !== '__other__';
  customCompanyInput.value = customCompany;
  customPersonInput.value = customPerson;
}

function renderPreview() {
  const data = snapshot();
  const materialIssues = data.issues.filter((item) => item.materialId);
  const peopleIssues = data.issues.filter((item) => !item.materialId);
  const check = modal.querySelector('[data-excel-check]');
  if (!data.issues.length) {
    check.innerHTML = '<b class="excel-transfer-ok">入力チェック：未入力なし</b>';
  } else {
    const messages = data.issues.map((item) => {
      const prefix = item.materialId ? `建材No.${item.materialNo || '?'} ${item.name ? '（' + item.name + '）' : ''}：` : '';
      return `<li>${escapeHtml(prefix + item.label)}が未入力</li>`;
    }).join('');
    check.innerHTML = `<b>入力チェック：${data.issues.length}項目に確認が必要です</b><ul>${messages}</ul>`;
  }

  const labels = { 15:'採取数',16:'採取日',17:'試料名称',18:'採取場所',19:'',20:'',21:'採取部位',22:'',23:'',24:'',25:'採取者' };
  const excelColumn = (index) => {
    let n = index + 2;
    let label = '';
    while (n > 0) { n -= 1; label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26); }
    return label;
  };
  const heading = data.samples.map((sample, index) => `<th>${excelColumn(index)}列（建材No.${escapeHtml(sample.materialNo)}）</th>`).join('');
  const body = data.rows.map((row) => {
    const cells = row.values.map((cell, index) => {
      const materialId = data.samples[index].materialId;
      const problematic = materialIssues.some((issue) => issue.materialId === materialId &&
        ((row.excelRow === 15 && issue.field === 'sampleCount')
        || (row.excelRow === 16 && issue.field === 'sampleDate')
        || (row.excelRow === 17 && ['name', 'samplePart'].includes(issue.field))
        || (row.excelRow === 18 && issue.field.startsWith('sampleLocation'))
        || (row.excelRow === 21 && issue.field === 'samplePart')));
      const samplerMissing = row.excelRow === 25 && peopleIssues.length;
      return `<td${problematic || samplerMissing ? ' class="excel-transfer-missing"' : ''}>${escapeHtml(cell)}</td>`;
    }).join('');
    return `<tr><th>${row.excelRow}　${labels[row.excelRow]}</th>${cells}</tr>`;
  }).join('');
  modal.querySelector('[data-excel-table]').innerHTML =
    `<thead><tr><th>Excel行</th>${heading}</tr></thead><tbody>${body}</tbody>`;

  modal.querySelector('[data-excel-fix]').hidden = materialIssues.length === 0;
  modal.querySelector('[data-excel-copy]').disabled = data.samples.length === 0;
  modal.querySelector('[data-excel-message]').textContent = data.samples.length ? '' : '転記可能な採取対象建材がありません。';
}

function closeModal() {
  modal?.classList.remove('open');
}

function moveToMissing() {
  const data = snapshot();
  const issue = data.issues.find((item) => item.materialId);
  if (!issue) return;
  closeModal();
  activateExcelTransferWarnings(getCurrentProject()?.projectId);
  showTab('materials');
  closeDrawer('operation');
  requestAnimationFrame(() => focusExcelTransferMissing(issue.materialId, issue.field));
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly','');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('クリップボードへのコピーに失敗しました');
}

async function copyExcelData() {
  const data = snapshot();
  if (!data.samples.length) return;
  if (data.issues.length && !window.confirm(`未入力・確認事項が${data.issues.length}項目あります。このままコピーしますか？`)) return;
  const message = modal.querySelector('[data-excel-message]');
  try {
    await writeClipboard(data.tsv);
    message.textContent = 'コピーしました。Excel「入力」シートのB15へ値のみ貼り付けてください。';
  } catch (error) {
    message.textContent = `コピーできませんでした：${error?.message || error}`;
  }
}

export function openExcelTransfer() {
  ensureModal();
  // 案件を開き直した際に、前の氏名を引き継がない。
  companyChoice = EXCEL_COMPANIES[0];
  personChoice = '';
  customCompany = '';
  customPerson = '';
  syncSamplerControls();
  renderPreview();
  closeDrawer('operation');
  modal.classList.add('open');
}
