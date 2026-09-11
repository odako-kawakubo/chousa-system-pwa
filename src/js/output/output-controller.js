/**
 * src/js/output/output-controller.js
 * 「出力」タブの表示とStore購読を担当する。
 * 旧「同期」タブのDOM枠を再利用し、出力専用の保存状態は持たない。
 * 帳票プレビューは既存報告書の「調査対象建材リスト」「部屋別調査対象建材リスト」の書式を基準にする。
 * 画面上でもA4を1ページ単位で分割し、印刷時と同じページ境界を確認できるようにする。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';

const MATERIAL_ROWS_PER_PAGE = 24;
const ROOM_ROWS_PER_PAGE = 24;

let activeView = 'materials';
let initialized = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureOutputStyles() {
  if (document.querySelector('link[data-output-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/output.css';
  link.dataset.outputStyles = '1';
  document.head.appendChild(link);
}

function outputRoot() { return document.getElementById('sync'); }

function chunkRows(rows, size) {
  if (!rows.length) return [[]];
  const pages = [];
  for (let index = 0; index < rows.length; index += size) pages.push(rows.slice(index, index + size));
  return pages;
}

function roomGroupKey(row) {
  return `${row.floor}\u0000${row.roomNo}`;
}

/**
 * 部屋別リストは原則として同一部屋を同じページへ置く。
 * 1部屋だけで上限を超える場合に限り、その部屋内で分割する。
 */
function paginateRoomRows(rows) {
  if (!rows.length) return [[]];

  const groups = [];
  let current = [];
  let currentKey = null;
  rows.forEach((row) => {
    const key = roomGroupKey(row);
    if (current.length && key !== currentKey) {
      groups.push(current);
      current = [];
    }
    currentKey = key;
    current.push(row);
  });
  if (current.length) groups.push(current);

  const pages = [];
  let page = [];

  groups.forEach((group) => {
    if (group.length > ROOM_ROWS_PER_PAGE) {
      if (page.length) {
        pages.push(page);
        page = [];
      }
      for (let index = 0; index < group.length; index += ROOM_ROWS_PER_PAGE) {
        pages.push(group.slice(index, index + ROOM_ROWS_PER_PAGE));
      }
      return;
    }

    if (page.length && page.length + group.length > ROOM_ROWS_PER_PAGE) {
      pages.push(page);
      page = [];
    }
    page.push(...group);
  });

  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

function renderPageShell(content, pageIndex, pageCount) {
  return `
    <section class="output-page-shell">
      <div class="output-page-label">${pageIndex + 1} / ${pageCount}</div>
      ${content}
    </section>`;
}

function emptyMaterialRows(count) {
  return Array.from({ length: count }, () => '<tr class="output-blank-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
}

function renderMaterialPage(rows) {
  const blankCount = Math.max(0, MATERIAL_ROWS_PER_PAGE - rows.length);
  return `
    <article class="output-paper output-paper-material">
      <h2 class="output-report-title">調査対象建材リスト</h2>
      <table class="output-report-table output-material-report">
        <colgroup>
          <col class="col-no"><col class="col-name"><col class="col-part"><col class="col-place">
          <col class="col-level"><col class="col-analysis"><col class="col-result"><col class="col-note">
        </colgroup>
        <thead>
          <tr>
            <th>建材<br>No.</th>
            <th>建材名</th>
            <th>部位</th>
            <th>施工範囲<br><span>部屋No.</span></th>
            <th>建材<br>レベル</th>
            <th>分析の要否</th>
            <th>石綿含有<br>の有無</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>
            <td class="center">${escapeHtml(row.materialNo)}</td>
            <td>${escapeHtml(row.name)}</td>
            <td class="center">${escapeHtml(row.part)}</td>
            <td>${escapeHtml(row.usageLocation)}</td>
            <td class="center">${escapeHtml(row.level)}</td>
            <td class="center">${escapeHtml(row.analysisRequired)}</td>
            <td class="center">${escapeHtml(row.analysisResult)}</td>
            <td>${escapeHtml(row.note)}</td>
          </tr>`).join('')}
          ${emptyMaterialRows(blankCount)}
        </tbody>
      </table>
      <div class="output-report-footer">以下余白</div>
    </article>`;
}

function renderMaterialTable(rows) {
  const pages = chunkRows(rows, MATERIAL_ROWS_PER_PAGE);
  return `<div class="output-pages">${pages.map((pageRows, index) => renderPageShell(renderMaterialPage(pageRows), index, pages.length)).join('')}</div>`;
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

function renderRoomPage(rows) {
  return `
    <article class="output-paper output-paper-room">
      <h2 class="output-report-title">部屋別調査対象建材リスト</h2>
      <table class="output-report-table output-room-report">
        <colgroup>
          <col class="col-floor"><col class="col-room"><col class="col-part"><col class="col-no">
          <col class="col-name"><col class="col-note"><col class="col-level"><col class="col-result">
        </colgroup>
        <thead>
          <tr>
            <th>階</th><th>部屋No.</th><th>部位</th><th>建材<br>No.</th><th>建材名称</th><th>備考</th><th>建材<br>レベル</th><th>分析結果</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => {
            const floorCell = shouldRenderGroupedCell(rows, index, 'floor')
              ? `<td class="center group-cell" rowspan="${spanLength(rows, index, 'floor')}">${escapeHtml(row.floor)}</td>` : '';
            const roomCell = shouldRenderGroupedCell(rows, index, 'roomNo', 'floor')
              ? `<td class="center group-cell" rowspan="${spanLength(rows, index, 'roomNo', 'floor')}">${escapeHtml(row.roomNo)}${row.roomName ? `<div class="output-room-name">${escapeHtml(row.roomName)}</div>` : ''}${row.roomNote ? `<div class="output-room-note">${escapeHtml(row.roomNote)}</div>` : ''}</td>` : '';
            return `<tr class="${row.registered ? '' : 'is-unregistered'}">
              ${floorCell}${roomCell}
              <td class="center">${escapeHtml(row.part)}</td>
              <td class="center">${escapeHtml(row.materialNo)}</td>
              <td>${escapeHtml(row.materialName)}</td>
              <td>${escapeHtml(row.note)}</td>
              <td class="center">${escapeHtml(row.level)}</td>
              <td class="center">${escapeHtml(row.analysisResult)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </article>`;
}

function renderRoomTable(rows) {
  const pages = paginateRoomRows(rows);
  return `<div class="output-pages">${pages.map((pageRows, index) => renderPageShell(renderRoomPage(pageRows), index, pages.length)).join('')}</div>`;
}

function renderPhotoPlaceholder(title, count, description) {
  const page = `<article class="output-paper output-placeholder-sheet"><h2 class="output-report-title">${escapeHtml(title)}</h2><div class="output-placeholder-count">写真レコード ${count}件</div><div class="output-empty">${escapeHtml(description)}<br>帳票レイアウトは次段階で接続します。</div></article>`;
  return `<div class="output-pages">${renderPageShell(page, 0, 1)}</div>`;
}

export function renderOutputTab() {
  const root = outputRoot();
  if (!root) return;
  const vm = buildOutputViewModel();
  let body = '';
  if (activeView === 'rooms') body = renderRoomTable(vm.roomRows);
  else if (activeView === 'visual-photos') body = renderPhotoPlaceholder('調査対象建材写真帳', vm.visualPhotoCount, '報告書の写真帳書式へ接続予定です。');
  else if (activeView === 'sampling-photos') body = renderPhotoPlaceholder('試料採取写真', vm.samplingPhotoCount, '施工前・施工中・施工後の報告書書式へ接続予定です。');
  else body = renderMaterialTable(vm.materialRows);

  root.innerHTML = `<div class="output-root"><div class="output-toolbar"><button type="button" class="btn small output-view-btn ${activeView === 'materials' ? 'active' : ''}" data-output-view="materials">建材リスト</button><button type="button" class="btn small output-view-btn ${activeView === 'rooms' ? 'active' : ''}" data-output-view="rooms">部屋別リスト</button><button type="button" class="btn small output-view-btn ${activeView === 'visual-photos' ? 'active' : ''}" data-output-view="visual-photos">建材写真帳</button><button type="button" class="btn small output-view-btn ${activeView === 'sampling-photos' ? 'active' : ''}" data-output-view="sampling-photos">採取写真帳</button><span class="output-toolbar-fill"></span><button type="button" class="btn small" disabled title="PDF出力は帳票レイアウト確定後に接続します">PDF出力</button></div><div class="output-preview">${body}</div></div>`;
}

export function initializeOutputTab() {
  if (initialized) return;
  initialized = true;
  ensureOutputStyles();
  const root = outputRoot();
  if (!root) return;
  const tab = document.querySelector('.tab[data-tab="sync"]');
  if (tab) tab.textContent = '出力';

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-output-view]');
    if (!button) return;
    activeView = button.dataset.outputView || 'materials';
    renderOutputTab();
  });

  finishRecordStore.subscribe(renderOutputTab);
  materialRecordStore.subscribe(renderOutputTab);
  photoRecordStore.subscribe(renderOutputTab);
  renderOutputTab();
}
