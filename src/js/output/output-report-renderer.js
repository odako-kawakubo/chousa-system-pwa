/**
 * src/js/output/output-report-renderer.js
 *
 * 出力4帳票のHTML生成を一元化する。
 * 画面プレビュー・PDF・印刷は必ずこのレンダラーを共用する。
 */

export const OUTPUT_TARGETS = Object.freeze({
  materials: { key: 'materials', label: '建材リスト', header: '調査対象建材リスト' },
  rooms: { key: 'rooms', label: '部屋別リスト', header: '部屋別調査対象建材リスト' },
  'visual-photos': { key: 'visual-photos', label: '建材写真帳', header: '調査対象建材写真帳' },
  'sampling-photos': { key: 'sampling-photos', label: '採取写真帳', header: '試料採取写真' }
});

const MATERIAL_ROWS_PER_PAGE = 24;
const ROOM_ROWS_PER_PAGE = 24;
const VISUAL_ITEMS_PER_PAGE = 8;
const SAMPLING_MEMO_LINES = 9;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function chunkRows(rows, size) {
  if (!rows.length) return [[]];
  const pages = [];
  for (let index = 0; index < rows.length; index += size) pages.push(rows.slice(index, index + size));
  return pages;
}
function isAsbestosPositive(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (text === '有') return true;
  if (text.includes('無') || text.includes('なし') || text === '-') return false;
  return text.includes('含有');
}
function roomGroupKey(row) { return `${row.floor}\u0000${row.roomNo}`; }
function paginateRoomRows(rows) {
  if (!rows.length) return [[]];
  const groups = [];
  let current = [];
  let currentKey = null;
  rows.forEach((row) => {
    const key = roomGroupKey(row);
    if (current.length && key !== currentKey) { groups.push(current); current = []; }
    currentKey = key;
    current.push(row);
  });
  if (current.length) groups.push(current);

  const pages = [];
  let page = [];
  groups.forEach((group) => {
    if (group.length > ROOM_ROWS_PER_PAGE) {
      if (page.length) pages.push(page);
      page = [];
      for (let index = 0; index < group.length; index += ROOM_ROWS_PER_PAGE) pages.push(group.slice(index, index + ROOM_ROWS_PER_PAGE));
      return;
    }
    if (page.length && page.length + group.length > ROOM_ROWS_PER_PAGE) { pages.push(page); page = []; }
    page.push(...group);
  });
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}
function pageShell(content, pageIndex, pageCount) {
  return `<section class="output-page-shell" data-output-page="${pageIndex}"><div class="output-page-label">${pageIndex + 1} / ${pageCount}</div>${content}</section>`;
}
function emptyMaterialRows(count) {
  return Array.from({ length: count }, (_, index) => `<tr class="output-blank-row"><td>&nbsp;</td><td>${index === 0 ? '<span class="output-blank-label">以下余白</span>' : ''}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
}
function materialPage(rows) {
  const blankCount = Math.max(0, MATERIAL_ROWS_PER_PAGE - rows.length);
  return `<article class="output-paper output-paper-material"><h2 class="output-report-title">調査対象建材リスト</h2><table class="output-report-table output-material-report"><colgroup><col class="col-no"><col class="col-name"><col class="col-part"><col class="col-place"><col class="col-level"><col class="col-analysis"><col class="col-result"><col class="col-note"></colgroup><thead><tr><th>建材<br>No.</th><th>建材名</th><th>部位</th><th class="output-place-head"><span class="output-place-head-top">施工範囲</span><span class="output-place-head-bottom">部屋No.</span></th><th>建材<br>レベル</th><th>分析の要否</th><th>石綿含有<br>の有無</th><th>調査備考</th></tr></thead><tbody>${rows.map((row) => `<tr class="${isAsbestosPositive(row.analysisResult) ? 'is-asbestos-positive' : ''}"><td class="center">${esc(row.materialNo)}</td><td>${esc(row.name)}</td><td class="center">${esc(row.part)}</td><td>${esc(row.usageLocation)}</td><td class="center">${esc(row.level)}</td><td class="center">${esc(row.analysisRequired)}</td><td class="center">${esc(row.analysisResult)}</td><td>${esc(row.note)}</td></tr>`).join('')}${emptyMaterialRows(blankCount)}</tbody></table></article>`;
}
function spanLength(rows, index, key, parentKey = null) {
  const value = rows[index]?.[key];
  const parentValue = parentKey ? rows[index]?.[parentKey] : null;
  let count = 1;
  for (let i = index + 1; i < rows.length; i += 1) {
    if (rows[i]?.[key] !== value) break;
    if (parentKey && rows[i]?.[parentKey] !== parentValue) break;
    count += 1;
  }
  return count;
}
function shouldRenderGroupedCell(rows, index, key, parentKey = null) {
  if (index === 0) return true;
  if (rows[index - 1]?.[key] !== rows[index]?.[key]) return true;
  return Boolean(parentKey && rows[index - 1]?.[parentKey] !== rows[index]?.[parentKey]);
}
function roomPage(rows) {
  return `<article class="output-paper output-paper-room"><h2 class="output-report-title">部屋別調査対象建材リスト</h2><table class="output-report-table output-room-report"><colgroup><col class="col-floor"><col class="col-room-no"><col class="col-room-name"><col class="col-part"><col class="col-no"><col class="col-name"><col class="col-note"><col class="col-level"><col class="col-result"><col class="col-room-note"></colgroup><thead><tr><th>階</th><th>部屋No.</th><th>部屋名</th><th>部位</th><th>建材<br>No.</th><th>建材名称</th><th>調査備考</th><th>建材<br>レベル</th><th>分析結果</th><th>部屋備考</th></tr></thead><tbody>${rows.map((row, index) => {
    const floorCell = shouldRenderGroupedCell(rows, index, 'floor') ? `<td class="center group-cell" rowspan="${spanLength(rows, index, 'floor')}">${esc(row.floor)}</td>` : '';
    const renderRoom = shouldRenderGroupedCell(rows, index, 'roomNo', 'floor');
    const roomSpan = renderRoom ? spanLength(rows, index, 'roomNo', 'floor') : 0;
    const roomNoCell = renderRoom ? `<td class="center group-cell" rowspan="${roomSpan}">${esc(row.roomNo)}</td>` : '';
    const roomNameCell = renderRoom ? `<td class="center group-cell" rowspan="${roomSpan}">${esc(row.roomName)}</td>` : '';
    const roomNoteCell = renderRoom ? `<td class="group-cell" rowspan="${roomSpan}">${esc(row.roomNote)}</td>` : '';
    const classes = [row.registered ? '' : 'is-unregistered', isAsbestosPositive(row.analysisResult) ? 'is-asbestos-positive' : ''].filter(Boolean).join(' ');
    return `<tr class="${classes}">${floorCell}${roomNoCell}${roomNameCell}<td class="center">${esc(row.part)}</td><td class="center">${esc(row.materialNo)}</td><td>${esc(row.materialName)}</td><td>${esc(row.note)}</td><td class="center">${esc(row.level)}</td><td class="center">${esc(row.analysisResult)}</td>${roomNoteCell}</tr>`;
  }).join('')}</tbody></table></article>`;
}
function photoFrame(photoId, photoSources, extraClass = '') {
  const source = photoSources?.get?.(String(photoId || '')) || '';
  if (source) return `<div class="output-photo-frame ${extraClass}" data-output-photo-id="${esc(photoId)}"><img src="${esc(source)}" alt="写真"></div>`;
  return `<div class="output-photo-frame is-empty-photo ${extraClass}" data-output-photo-id="${esc(photoId)}"><span>${photoId ? '写真読込中' : '写真なし'}</span></div>`;
}
function visualPhotoSlot(item, photoSources) {
  const canSelect = item.candidates?.length > 0;
  const hasPhoto = Boolean(item.photoId);
  const caption = [`建材No.${item.materialNo}`, item.part, item.name].filter((value) => String(value ?? '').trim()).join('　');
  return `<div class="output-visual-slot ${hasPhoto ? 'has-photo' : 'is-no-photo'}"><div class="output-photo-frame-wrap">${photoFrame(item.photoId, photoSources)}${canSelect ? `<button class="output-photo-expand" type="button" data-output-visual-expand="${esc(item.materialId)}">拡大</button>` : ''}</div><div class="output-visual-caption">${esc(caption)}</div></div>`;
}
function visualPages(items, photoSources) {
  const pages = chunkRows(items, VISUAL_ITEMS_PER_PAGE);
  return pages.map((pageItems) => {
    const slots = [...pageItems];
    while (slots.length < VISUAL_ITEMS_PER_PAGE) slots.push(null);
    return `<article class="output-paper output-photo-book-paper"><h2 class="output-report-title">調査対象建材写真帳</h2><div class="output-visual-grid">${slots.map((item) => item ? visualPhotoSlot(item, photoSources) : '<div class="output-visual-slot is-empty"></div>').join('')}</div></article>`;
  });
}
function samplingMemo(item, stage) {
  const values = String(stage.memo || '').split('\n').slice(0, SAMPLING_MEMO_LINES);
  while (values.length < SAMPLING_MEMO_LINES) values.push('');
  return `<div class="output-sampling-memo"><div class="output-stage-label">撮影状況：${esc(stage.label)}</div><div class="output-sampling-memo-lines">${values.map((value, lineIndex) => `<div class="output-sampling-memo-line" contenteditable="true" spellcheck="false" data-output-sampling-memo-line data-output-material-id="${esc(item.materialId)}" data-output-branch="${Number(item.branch) || 0}" data-output-stage="${esc(stage.type)}" data-output-line-index="${lineIndex}">${esc(value)}</div>`).join('')}</div></div>`;
}
function samplingPages(items, photoSources) {
  const safe = items.length ? items : [{ materialId:'', branch:0, projectName:'', projectNo:'', sampleNo:'', sampleName:'', samplingPlace:'', capturedDate:'', stages:[] }];
  return safe.map((item) => {
    const stageMap = new Map((item.stages || []).map((stage) => [stage.type, stage]));
    const sampleCode = [item.projectNo, item.sampleNo, item.branch].filter((value) => String(value ?? '').trim()).join('-');
    return `<article class="output-paper output-sampling-paper"><h2 class="output-report-title">試料採取写真</h2><div class="output-sampling-meta"><div class="output-sampling-meta-left"><div><b>件名：</b><span>${esc(item.projectName)}</span></div><div><b>試料：</b><span>${esc(item.sampleName)}</span></div><div><b>場所：</b><span>${item.samplingPlace ? `部屋No.${esc(item.samplingPlace)}` : ''}</span></div></div><div class="output-sampling-meta-right"><div><span>${esc(sampleCode)}</span></div><div><b>採取日：</b><span>${esc(item.capturedDate)}</span></div></div></div><div class="output-sampling-stages">${['before','during','after'].map((type) => {
      const stage = stageMap.get(type) || { type, label:type === 'before' ? '施工前' : type === 'during' ? '施工中' : '施工後', photoId:'', candidates:[], memo:'' };
      const canSelect = stage.candidates?.length > 0;
      return `<div class="output-sampling-stage"><div class="output-photo-frame-wrap output-sampling-frame-wrap">${photoFrame(stage.photoId, photoSources, 'output-sampling-frame')}${canSelect ? `<button class="output-photo-expand" type="button" data-output-sampling-expand="${esc(item.materialId)}" data-output-branch="${Number(item.branch)||0}" data-output-stage="${esc(type)}">拡大</button>` : ''}</div>${samplingMemo(item, stage)}</div>`;
    }).join('')}</div></article>`;
  });
}

export function buildOutputPaperHtml(target, vm, { photoSources = null } = {}) {
  if (target === 'materials') return chunkRows(vm.materialRows || [], MATERIAL_ROWS_PER_PAGE).map(materialPage);
  if (target === 'rooms') return paginateRoomRows(vm.roomRows || []).map(roomPage);
  if (target === 'visual-photos') return visualPages(vm.visualPhotoItems || [], photoSources);
  if (target === 'sampling-photos') return samplingPages(vm.samplingPhotoPages || [], photoSources);
  return [];
}

export function renderOutputTarget(target, vm, options = {}) {
  const papers = buildOutputPaperHtml(target, vm, options);
  return `<div class="output-pages">${papers.map((paper, index) => pageShell(paper, index, papers.length)).join('')}</div>`;
}
