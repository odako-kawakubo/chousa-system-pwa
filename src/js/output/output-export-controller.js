/**
 * src/js/output/output-export-controller.js
 * PDF / 印刷 / Excel の共通選択画面と出力実行。
 *
 * v0.1.7.6 r4:
 * - PDFは専用ベクターレンダラーへ切替。
 * - html2canvasによるA4全面画像化は廃止。
 * - 印刷はHTML/CSS、ExcelはExcelJSの既存経路を維持する。
 */
import { buildOutputViewModel } from './output-view-model.js';
import { buildOutputPaperHtml, OUTPUT_TARGETS } from './output-report-renderer.js';
import { fitOutputPhotoImages } from './output-photo-layout.js';
import { exportVectorPdf } from './output-pdf-renderer.js';
import { resolveViewerCompletedPhoto } from '../photos/photo-viewer-source.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';

const TARGET_ORDER = ['materials', 'rooms', 'visual-photos', 'sampling-photos'];
let modal = null;
let method = 'pdf';
let running = false;

function esc(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function safeFilePart(value) {
  return String(value ?? '').trim().replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ');
}
function projectFileName(header, extension) {
  const project = getCurrentProject() || {};
  const no = safeFilePart(project.projectNo || project.projectId || '案件番号未設定');
  const name = safeFilePart(project.projectName || '案件名未設定');
  return `${safeFilePart(header)}　${no}　${name}.${extension}`;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  const existing = document.querySelector(`script[data-output-lib="${src}"]`);
  if (existing) return new Promise((resolve, reject) => {
    existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once:true });
    existing.addEventListener('error', reject, { once:true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.outputLib = src;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => reject(new Error(`出力ライブラリを読み込めませんでした: ${src}`));
    document.head.appendChild(script);
  });
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('写真変換に失敗しました。'));
    reader.readAsDataURL(blob);
  });
}
function selectedTargets() {
  return TARGET_ORDER.filter((key) => modal?.querySelector(`[data-output-target="${key}"]`)?.checked);
}
function collectPhotoIds(targets, vm) {
  const ids = new Set();
  if (targets.includes('visual-photos')) (vm.visualPhotoItems || []).forEach((item) => { if (item.photoId) ids.add(String(item.photoId)); });
  if (targets.includes('sampling-photos')) (vm.samplingPhotoPages || []).forEach((page) => (page.stages || []).forEach((stage) => { if (stage.photoId) ids.add(String(stage.photoId)); }));
  return [...ids];
}
function setStatus(text, progress = null) {
  const node = modal?.querySelector('[data-output-export-status]');
  if (node) node.textContent = text || '';
  const bar = modal?.querySelector('[data-output-export-progress]');
  if (bar && progress != null) bar.value = progress;
}
async function preparePhotoSources(targets, vm) {
  const ids = collectPhotoIds(targets, vm);
  const result = new Map();
  if (!ids.length) return result;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    setStatus(`写真を準備中 ${index + 1} / ${ids.length}`, (index + 1) / ids.length);
    const photo = photoRecordStore.get(id);
    if (!photo) continue;
    try {
      const blob = await resolveViewerCompletedPhoto(photo);
      if (blob instanceof Blob) result.set(id, await blobToDataUrl(blob));
    } catch (error) {
      console.warn('出力用写真の準備に失敗しました', { id, error });
    }
  }
  return result;
}
function ensureModal() {
  if (modal) return;
  modal = document.createElement('div');
  modal.className = 'output-export-modal';
  modal.innerHTML = `<div class="output-export-card">
    <div class="output-export-head"><b data-output-export-title>出力</b><button class="btn small" type="button" data-output-export-close>閉じる</button></div>
    <div class="output-export-targets">${TARGET_ORDER.map((key) => `<label><input type="checkbox" data-output-target="${key}" checked><span>${esc(OUTPUT_TARGETS[key].label)}</span></label>`).join('')}</div>
    <label class="output-export-combine" data-output-combine-row><input type="checkbox" data-output-combine><span>選択した帳票を1つのPDFにまとめる</span></label>
    <div class="output-export-status" data-output-export-status></div>
    <progress class="output-export-progress" data-output-export-progress max="1" value="0"></progress>
    <div class="output-export-actions"><button class="btn" type="button" data-output-export-close>キャンセル</button><button class="btn primary" type="button" data-output-export-run>実行</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-output-export-close]')) { if (!running) modal.classList.remove('open'); return; }
    if (event.target.closest('[data-output-export-run]')) void runExport();
  });
}
function openModal(nextMethod) {
  ensureModal();
  method = nextMethod;
  const title = modal.querySelector('[data-output-export-title]');
  if (title) title.textContent = method === 'pdf' ? 'PDF出力' : method === 'print' ? '印刷' : 'Excel出力';
  modal.querySelector('[data-output-combine-row]')?.toggleAttribute('hidden', method !== 'pdf');
  modal.querySelector('[data-output-export-progress]').value = 0;
  setStatus('出力する帳票を選択してください。');
  modal.classList.add('open');
}
function allPaperHtml(targets, vm, photoSources) {
  return targets.flatMap((target) => buildOutputPaperHtml(target, vm, { photoSources }));
}
async function exportPdf(targets, vm, photoSources) {
  const combine = Boolean(modal.querySelector('[data-output-combine]')?.checked);
  const onProgress = (text, progress) => setStatus(text, progress);
  if (combine) {
    await exportVectorPdf({
      targets,
      vm,
      photoSources,
      filename: projectFileName('調査資料', 'pdf'),
      onProgress
    });
    return;
  }
  for (const target of targets) {
    await exportVectorPdf({
      targets:[target],
      vm,
      photoSources,
      filename: projectFileName(OUTPUT_TARGETS[target].header, 'pdf'),
      onProgress
    });
  }
}
async function exportPrint(targets, vm, photoSources) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('印刷画面を開けませんでした。ポップアップを許可してください。');
  const title = projectFileName(targets.length === 1 ? OUTPUT_TARGETS[targets[0]].header : '調査資料', '').replace(/\.$/, '');
  const cssUrl = new URL('./css/output.css', window.location.href).href;
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${esc(cssUrl)}"></head><body><div class="output-preview"><div class="output-pages">${allPaperHtml(targets, vm, photoSources).map((paper, index) => `<section class="output-page-shell is-current" data-output-page="${index}">${paper}</section>`).join('')}</div></div></body></html>`);
  popup.document.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const images = [...popup.document.images];
  await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = img.onerror = resolve; })));
  fitOutputPhotoImages(popup.document);
  popup.focus();
  popup.print();
}
function imageExtension(dataUrl) { return /^data:image\/png/i.test(dataUrl) ? 'png' : 'jpeg'; }
function addExcelImage(workbook, sheet, dataUrl, range) {
  if (!dataUrl) return;
  const imageId = workbook.addImage({ base64:dataUrl, extension:imageExtension(dataUrl) });
  sheet.addImage(imageId, range);
}
function styleHeader(row) { row.font = { bold:true }; row.alignment = { vertical:'middle', horizontal:'center', wrapText:true }; }
function addMaterialSheet(workbook, rows) {
  const sheet = workbook.addWorksheet('建材リスト');
  sheet.addRow(['建材No.','建材名','部位','施工範囲 / 部屋No.','建材レベル','分析の要否','石綿含有の有無','調査備考']);
  styleHeader(sheet.getRow(1));
  rows.forEach((r) => sheet.addRow([r.materialNo,r.name,r.part,r.usageLocation,r.level,r.analysisRequired,r.analysisResult,r.note]));
  sheet.columns = [{width:10},{width:24},{width:12},{width:28},{width:12},{width:16},{width:18},{width:34}];
}
function addRoomSheet(workbook, rows) {
  const sheet = workbook.addWorksheet('部屋別リスト');
  sheet.addRow(['階','部屋No.','部屋名','部位','建材No.','建材名称','調査備考','建材レベル','分析結果','部屋備考']);
  styleHeader(sheet.getRow(1));
  rows.forEach((r) => sheet.addRow([r.floor,r.roomNo,r.roomName,r.part,r.materialNo,r.materialName,r.note,r.level,r.analysisResult,r.roomNote]));
  sheet.columns = [{width:8},{width:10},{width:18},{width:10},{width:8},{width:24},{width:30},{width:10},{width:16},{width:24}];
}
function addVisualPhotoSheet(workbook, items, photoSources) {
  const sheet = workbook.addWorksheet('建材写真帳');
  sheet.columns = [{width:4},{width:34},{width:4},{width:34}];
  items.forEach((item, index) => {
    const col = index % 2 === 0 ? 1 : 3;
    const row = Math.floor(index / 2) * 16 + 1;
    sheet.getCell(row, col).value = `建材No.${item.materialNo}　${item.part}　${item.name}`;
    sheet.getCell(row, col).font = { bold:true };
    for (let r = row + 1; r <= row + 14; r += 1) sheet.getRow(r).height = 18;
    const dataUrl = photoSources.get(String(item.photoId || ''));
    addExcelImage(workbook, sheet, dataUrl, { tl:{ col:col - 1, row }, br:{ col:col + 1, row:row + 14 } });
  });
}
function addSamplingPhotoSheet(workbook, pages, photoSources) {
  const sheet = workbook.addWorksheet('採取写真帳');
  sheet.columns = [{width:16},{width:58}];
  let row = 1;
  pages.forEach((page) => {
    sheet.getCell(row,1).value = '件名'; sheet.getCell(row,2).value = page.projectName; row += 1;
    sheet.getCell(row,1).value = '試料'; sheet.getCell(row,2).value = page.sampleName; row += 1;
    sheet.getCell(row,1).value = '試料No.'; sheet.getCell(row,2).value = `${page.projectNo || ''}${page.sampleNo || ''}${page.branch ? `-${page.branch}` : ''}`; row += 1;
    sheet.getCell(row,1).value = '採取日'; sheet.getCell(row,2).value = page.capturedDate; row += 1;
    sheet.getCell(row,1).value = '場所'; sheet.getCell(row,2).value = page.samplingPlace ? `部屋No.${page.samplingPlace}` : ''; row += 2;
    (page.stages || []).forEach((stage) => {
      sheet.getCell(row,1).value = `撮影状況：${stage.label}`;
      const start = row;
      for (let r = start; r < start + 14; r += 1) sheet.getRow(r).height = 18;
      const dataUrl = photoSources.get(String(stage.photoId || ''));
      addExcelImage(workbook, sheet, dataUrl, { tl:{ col:1, row:start - 1 }, br:{ col:2, row:start + 12 } });
      row += 14;
    });
    row += 2;
  });
}
async function exportExcel(targets, vm, photoSources) {
  await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', 'ExcelJS');
  const workbook = new window.ExcelJS.Workbook();
  if (targets.includes('materials')) addMaterialSheet(workbook, vm.materialRows || []);
  if (targets.includes('rooms')) addRoomSheet(workbook, vm.roomRows || []);
  if (targets.includes('visual-photos')) addVisualPhotoSheet(workbook, vm.visualPhotoItems || [], photoSources);
  if (targets.includes('sampling-photos')) addSamplingPhotoSheet(workbook, vm.samplingPhotoPages || [], photoSources);
  const buffer = await workbook.xlsx.writeBuffer();
  const header = targets.length === 1 ? OUTPUT_TARGETS[targets[0]].header : '調査資料';
  downloadBlob(new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), projectFileName(header, 'xlsx'));
}
async function runExport() {
  if (running) return;
  const targets = selectedTargets();
  if (!targets.length) { setStatus('出力対象を1つ以上選択してください。'); return; }
  const hasPhotos = targets.some((key) => key === 'visual-photos' || key === 'sampling-photos');
  if (hasPhotos && !window.confirm('写真を含む帳票を出力します。未取得の写真はOneDriveからダウンロードして準備します。続行しますか？')) return;
  running = true;
  modal.querySelector('[data-output-export-run]').disabled = true;
  try {
    const vm = buildOutputViewModel();
    const photoSources = await preparePhotoSources(targets, vm);
    setStatus('出力を作成しています…', 1);
    if (method === 'pdf') await exportPdf(targets, vm, photoSources);
    else if (method === 'print') await exportPrint(targets, vm, photoSources);
    else await exportExcel(targets, vm, photoSources);
    setStatus('完了しました。', 1);
    if (method !== 'print') setTimeout(() => modal.classList.remove('open'), 500);
  } catch (error) {
    console.error('出力に失敗しました', error);
    setStatus(`出力に失敗しました：${error?.message || error}`);
  } finally {
    running = false;
    modal.querySelector('[data-output-export-run]').disabled = false;
  }
}

export function initializeOutputExportController(root) {
  ensureModal();
  root?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-output-export]');
    if (!button) return;
    const requested = button.dataset.outputExport;
    if (!['pdf','print','excel'].includes(requested)) return;
    openModal(requested);
  });
}
