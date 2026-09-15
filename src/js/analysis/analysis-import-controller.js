/**
 * src/js/analysis/analysis-import-controller.js
 * 操作パネルの「分析結果取込」。
 * 定性速報PDFを読み、試料名称でmaterialRecordへ照合して
 * analysisResult / remarks を確認後に反映する。
 */
import * as materialRecordStore from '../store/material-record-store.js';
import { buildMaterialSampleName, normalizeMaterialSampleName } from '../materials/material-sample-name.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistMaterialForProject } from '../sync/project-record-persistence.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';

let initialized = false;
let modal = null;
let fileInput = null;
let parsedRows = [];
let matches = [];
let pdfjsPromise = null;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function ensureStyles() {
  if (document.querySelector('link[data-analysis-import-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/analysis-import.css';
  link.dataset.analysisImportStyles = '1';
  document.head.appendChild(link);
}
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        return pdfjs;
      });
  }
  return pdfjsPromise;
}
function lineGroups(items = []) {
  const groups = [];
  const sorted = items
    .filter((item) => String(item.str || '').trim())
    .map((item) => ({ text:String(item.str || '').trim(), x:Number(item.transform?.[4] || 0), y:Number(item.transform?.[5] || 0) }))
    .sort((a,b) => b.y - a.y || a.x - b.x);

  sorted.forEach((item) => {
    let group = groups.find((row) => Math.abs(row.y - item.y) <= 2.4);
    if (!group) { group = { y:item.y, items:[] }; groups.push(group); }
    group.items.push(item);
  });
  groups.forEach((row) => row.items.sort((a,b) => a.x - b.x));
  return groups.sort((a,b) => b.y - a.y);
}
function compactText(items) {
  return items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
}
function headerPositions(lines) {
  for (const line of lines) {
    const all = compactText(line.items);
    if (!all.includes('分析結果') || !all.includes('備考')) continue;
    const resultItem = line.items.find((item) => item.text.includes('分析結果'));
    const remarksItem = line.items.find((item) => item.text.includes('備考'));
    if (resultItem && remarksItem) return { y:line.y, resultX:resultItem.x, remarksX:remarksItem.x };
  }
  return null;
}
function parseResultRowsFromPage(lines) {
  const header = headerPositions(lines);
  if (!header) return [];
  const result = [];
  let current = null;

  lines.filter((line) => line.y < header.y - 2).forEach((line) => {
    const items = line.items;
    if (!items.length) return;
    const firstText = String(items[0]?.text || '').trim();
    const numberMatch = /^(\d{1,3})$/.exec(firstText);
    const nameItems = items.filter((item, index) => index !== 0 || !numberMatch).filter((item) => item.x < header.resultX - 3);
    const analysisItems = items.filter((item) => item.x >= header.resultX - 3 && item.x < header.remarksX - 3);
    const remarkItems = items.filter((item) => item.x >= header.remarksX - 3);
    const lineText = compactText(items);

    if (numberMatch) {
      const sampleName = compactText(nameItems);
      const analysisResult = compactText(analysisItems);
      const remarks = compactText(remarkItems);
      if (!sampleName || sampleName.includes('以下余白')) return;
      current = { sampleNo:Number(numberMatch[1]), sampleName, analysisResult, remarks };
      result.push(current);
      return;
    }

    if (!current || /以下余白/.test(lineText)) return;
    const continuedRemark = compactText(remarkItems.length ? remarkItems : items.filter((item) => item.x >= header.remarksX - 8));
    if (continuedRemark) current.remarks = `${current.remarks} ${continuedRemark}`.trim();
  });
  return result;
}
async function parsePdf(file) {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const rows = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const text = await page.getTextContent();
    rows.push(...parseResultRowsFromPage(lineGroups(text.items)));
  }
  return rows;
}
function activeMaterials() {
  return materialRecordStore.getAll().filter((record) => record.status === 'active');
}
function buildMatches(rows) {
  const materials = activeMaterials();
  const byName = new Map();
  materials.forEach((material) => {
    const candidates = [buildMaterialSampleName(material), material.sampleName]
      .map(normalizeMaterialSampleName)
      .filter(Boolean);
    candidates.forEach((name) => {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(material);
    });
  });

  return rows.map((row, index) => {
    const normalized = normalizeMaterialSampleName(row.sampleName);
    const candidates = byName.get(normalized) || [];
    const material = candidates.length === 1 ? candidates[0] : null;
    const status = candidates.length === 1 ? 'matched' : candidates.length > 1 ? 'review' : 'unmatched';
    return { ...row, index, normalized, candidates, material, status, selected:status === 'matched' };
  });
}
function renderRows() {
  const body = modal?.querySelector('[data-analysis-import-body]');
  const summary = modal?.querySelector('[data-analysis-import-summary]');
  if (!body || !summary) return;
  const counts = {
    matched:matches.filter((item) => item.status === 'matched').length,
    review:matches.filter((item) => item.status === 'review').length,
    unmatched:matches.filter((item) => item.status === 'unmatched').length
  };
  summary.textContent = `一致 ${counts.matched}件 / 要確認 ${counts.review}件 / 未一致 ${counts.unmatched}件`;
  body.innerHTML = matches.map((item) => {
    const label = item.status === 'matched' ? '一致' : item.status === 'review' ? '要確認' : '未一致';
    const materialName = item.material ? buildMaterialSampleName(item.material) : '';
    return `<tr>
      <td><input type="checkbox" data-analysis-row="${item.index}" ${item.selected ? 'checked' : ''} ${item.status !== 'matched' ? 'disabled' : ''}></td>
      <td><span class="analysis-import-status ${item.status}">${label}</span></td>
      <td>${esc(item.sampleName)}</td>
      <td>${esc(materialName || '-')}</td>
      <td>${esc(item.analysisResult)}</td>
      <td>${esc(item.remarks)}</td>
    </tr>`;
  }).join('');
}
function setMessage(message) {
  const node = modal?.querySelector('[data-analysis-import-message]');
  if (node) node.textContent = message || '';
}
function ensureModal() {
  if (modal) return;
  modal = document.createElement('div');
  modal.className = 'analysis-import-modal';
  modal.innerHTML = `<div class="analysis-import-card">
    <div class="analysis-import-head"><b>分析結果取込</b><button class="btn small" type="button" data-analysis-import-close>閉じる</button></div>
    <div class="analysis-import-meta"><div data-analysis-import-summary></div><div class="hint" data-analysis-import-message></div></div>
    <div class="analysis-import-table-wrap"><table class="analysis-import-table"><thead><tr><th>反映</th><th>照合</th><th>PDF試料名称</th><th>しらべ試料名称</th><th>分析結果</th><th>備考</th></tr></thead><tbody data-analysis-import-body></tbody></table></div>
    <div class="analysis-import-actions"><button class="btn" type="button" data-analysis-import-close>キャンセル</button><button class="btn primary" type="button" data-analysis-import-apply>選択した結果を反映</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-analysis-import-close]')) { modal.classList.remove('open'); return; }
    if (event.target.closest('[data-analysis-import-apply]')) void applyMatches();
  });
  modal.addEventListener('change', (event) => {
    const input = event.target.closest('[data-analysis-row]');
    if (!input) return;
    const row = matches[Number(input.dataset.analysisRow)];
    if (row) row.selected = Boolean(input.checked);
  });
}
async function applyMatches() {
  const selected = matches.filter((item) => item.selected && item.material);
  if (!selected.length) { setMessage('反映対象がありません。'); return; }
  const button = modal.querySelector('[data-analysis-import-apply]');
  button.disabled = true;
  try {
    const project = getCurrentProject();
    const writes = [];
    materialRecordStore.batch(() => {
      selected.forEach((item) => {
        const previous = materialRecordStore.get(item.material.materialId);
        if (!previous) return;
        const next = {
          ...previous,
          analysisResult:item.analysisResult,
          remarks:item.remarks,
          fieldEditedAt:touchFieldEditedAt(previous.fieldEditedAt, ['analysisResult','remarks'])
        };
        materialRecordStore.set(next);
        writes.push(persistMaterialForProject(project, next, 'analysis-result-import'));
      });
    });
    await Promise.all(writes);
    refreshMaterialList();
    refreshRecordView();
    setMessage(`${selected.length}件を反映しました。`);
    setTimeout(() => modal.classList.remove('open'), 600);
  } catch (error) {
    console.error('分析結果取込に失敗しました', error);
    setMessage(`反映に失敗しました：${error?.message || error}`);
  } finally {
    button.disabled = false;
  }
}
async function handleFile(file) {
  if (!file) return;
  ensureModal();
  modal.classList.add('open');
  setMessage('PDFを解析しています…');
  modal.querySelector('[data-analysis-import-body]').innerHTML = '';
  modal.querySelector('[data-analysis-import-summary]').textContent = '';
  try {
    parsedRows = await parsePdf(file);
    matches = buildMatches(parsedRows);
    renderRows();
    setMessage(parsedRows.length ? '一致した項目は自動選択済みです。未一致は反映しません。' : '分析結果の行を読み取れませんでした。');
  } catch (error) {
    console.error('PDF解析に失敗しました', error);
    matches = [];
    setMessage(`PDF解析に失敗しました：${error?.message || error}`);
  }
}
function mountOperationButton() {
  const drawerBody = document.querySelector('#drawer .drawer-body');
  if (!drawerBody || document.getElementById('analysisImportButton')) return;
  const box = document.createElement('div');
  box.className = 'drawer-box';
  box.id = 'analysisImportTools';
  box.innerHTML = `<h4>分析</h4><div class="hint">定性速報PDFの試料名称を照合し、分析結果と備考を建材レコードへ反映します。</div><button type="button" class="btn" id="analysisImportButton">分析結果取込</button>`;
  const maintenance = document.getElementById('drawerMaintenanceTools');
  drawerBody.insertBefore(box, maintenance || null);
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/pdf,.pdf';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);
  box.querySelector('#analysisImportButton').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
  fileInput.addEventListener('change', () => void handleFile(fileInput.files?.[0]));
}

export function initializeAnalysisImport() {
  if (initialized) return;
  initialized = true;
  ensureStyles();
  ensureModal();
  mountOperationButton();
}
