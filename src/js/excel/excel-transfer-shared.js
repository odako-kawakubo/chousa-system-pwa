/**
 * Excel連携の共通UI状態と純粋な表示・コピー処理。
 * Recordや永続化へは書き込まない。
 */
import { EXCEL_COMPANIES, EXCEL_SAMPLERS } from './excel-transfer-data.js';

export const samplerState = {
  companyChoice: EXCEL_COMPANIES[0],
  personChoice: '',
  customCompany: '',
  customPerson: ''
};

export const samplerValues = () => ({
  company:samplerState.companyChoice === '__other__' ? samplerState.customCompany.trim() : samplerState.companyChoice,
  person:samplerState.personChoice === '__other__' ? samplerState.customPerson.trim() : samplerState.personChoice
});

export const escapeExcelHtml = (input) => String(input ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

export function samplerOptions(items, selected, withEmpty = false) {
  const options = [
    ...(withEmpty ? [{ value:'', label:'選択してください' }] : []),
    ...items.map((item) => ({ value:item, label:item })),
    { value:'__other__', label:'その他（自由入力）' }
  ];
  return options.map(({value,label}) =>
    `<option value="${escapeExcelHtml(value)}"${selected === value ? ' selected' : ''}>${escapeExcelHtml(label)}</option>`).join('');
}

export function syncExcelSamplerControls(root) {
  root.querySelector('[data-excel-company]').innerHTML = samplerOptions(EXCEL_COMPANIES, samplerState.companyChoice);
  root.querySelector('[data-excel-person]').innerHTML = samplerOptions(EXCEL_SAMPLERS, samplerState.personChoice, true);
  const company = root.querySelector('[data-excel-custom-company]');
  const person = root.querySelector('[data-excel-custom-person]');
  company.hidden = samplerState.companyChoice !== '__other__';
  person.hidden = samplerState.personChoice !== '__other__';
  company.value = samplerState.customCompany;
  person.value = samplerState.customPerson;
}

export function updateExcelSamplerSelection(target) {
  if (target.matches('[data-excel-company]')) samplerState.companyChoice = target.value;
  else if (target.matches('[data-excel-person]')) samplerState.personChoice = target.value;
  else return false;
  return true;
}

export function updateExcelSamplerInput(target) {
  if (target.matches('[data-excel-custom-company]')) samplerState.customCompany = target.value;
  else if (target.matches('[data-excel-custom-person]')) samplerState.customPerson = target.value;
  else return false;
  return true;
}

export function ensureExcelTransferStyles() {
  if (document.querySelector('link[data-excel-transfer-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/excel-transfer.css';
  link.dataset.excelTransferStyles = '1';
  document.head.appendChild(link);
}

export async function writeExcelClipboard(text) {
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
