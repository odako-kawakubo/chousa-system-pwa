/**
 * src/js/output/output-controller.js
 * 「出力」タブの表示とStore購読を担当する。
 * 出力専用の保存状態は持たず、毎回Record StoreからViewModelを再構築する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { buildOutputViewModel } from './output-view-model.js';

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

function renderMaterialTable(rows) {
  if (!rows.length) return '<div class="output-empty">建材レコードはまだありません。</div>';
  return `
    <div class="output-sheet-wrap">
      <div class="output-sheet-title">調査対象建材リスト</div>
      <table class="output-table output-material-table">
        <thead><tr><th>建材No.</th><th>建材名称</th><th>部位</th><th>施工範囲</th><th>レベル</th><th>分析の要否</th><th>分析結果</th><th>備考</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td>${escapeHtml(row.materialNo)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.part)}</td>
          <td>${escapeHtml(row.usageLocation)}</td>
          <td>${escapeHtml(row.level)}</td>
          <td>${escapeHtml(row.analysisRequired)}</td>
          <td>${escapeHtml(row.analysisResult)}</td>
          <td>${escapeHtml(row.note)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function renderRoomTable(rows) {
  if (!rows.length) return '<div class="output-empty">仕上表レコードはまだありません。</div>';
  return `
    <div class="output-sheet-wrap">
      <div class="output-sheet-title">部屋別調査対象建材リスト</div>
      <table class="output-table output-room-table">
        <thead><tr><th>階</th><th>部屋No.</th><th>部屋名</th><th>部屋備考</th><th>部位</th><th>建材No.</th><th>建材名称</th><th>備考</th><th>レベル</th><th>分析結果</th></tr></thead>
        <tbody>${rows.map((row) => `<tr class="${row.registered ? '' : 'is-unregistered'}">
          <td>${escapeHtml(row.floor)}</td>
          <td>${escapeHtml(row.roomNo)}</td>
          <td>${escapeHtml(row.roomName)}</td>
          <td>${escapeHtml(row.roomNote)}</td>
          <td>${escapeHtml(row.part)}</td>
          <td>${escapeHtml(row.materialNo)}</td>
          <td>${escapeHtml(row.materialName)}</td>
          <td>${escapeHtml(row.note)}</td>
          <td>${escapeHtml(row.level)}</td>
          <td>${escapeHtml(row.analysisResult)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function renderPhotoPlaceholder(title, count, description) {
  return `
    <div class="output-sheet-wrap output-placeholder-sheet">
      <div class="output-sheet-title">${escapeHtml(title)}</div>
      <div class="output-placeholder-count">写真レコード ${count}件</div>
      <div class="output-empty">${escapeHtml(description)}<br>帳票レイアウトは次段階で接続します。</div>
    </div>`;
}

export function renderOutputTab() {
  const root = document.getElementById('output');
  if (!root) return;
  const vm = buildOutputViewModel();

  let body = '';
  if (activeView === 'rooms') body = renderRoomTable(vm.roomRows);
  else if (activeView === 'visual-photos') body = renderPhotoPlaceholder('調査対象建材写真帳', vm.visualPhotoCount, '代表写真を建材単位に並べる予定です。');
  else if (activeView === 'sampling-photos') body = renderPhotoPlaceholder('採取写真帳', vm.samplingPhotoCount, '施工前・施工中・施工後を試料単位に並べる予定です。');
  else body = renderMaterialTable(vm.materialRows);

  root.innerHTML = `
    <div class="output-root">
      <div class="output-toolbar">
        <button type="button" class="btn small output-view-btn ${activeView === 'materials' ? 'active' : ''}" data-output-view="materials">建材リスト</button>
        <button type="button" class="btn small output-view-btn ${activeView === 'rooms' ? 'active' : ''}" data-output-view="rooms">部屋別リスト</button>
        <button type="button" class="btn small output-view-btn ${activeView === 'visual-photos' ? 'active' : ''}" data-output-view="visual-photos">建材写真帳</button>
        <button type="button" class="btn small output-view-btn ${activeView === 'sampling-photos' ? 'active' : ''}" data-output-view="sampling-photos">採取写真帳</button>
        <span class="output-toolbar-fill"></span>
        <button type="button" class="btn small" disabled title="PDF出力は帳票レイアウト確定後に接続します">PDF出力</button>
      </div>
      <div class="output-preview">${body}</div>
    </div>`;
}

export function initializeOutputTab() {
  if (initialized) return;
  initialized = true;
  const root = document.getElementById('output');
  if (!root) return;

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-output-view]');
    if (!button) return;
    activeView = button.dataset.outputView || 'materials';
    renderOutputTab();
  });

  // 出力タブを開いたままでも、正本Storeが変われば現在表示を更新する。
  finishRecordStore.subscribe(renderOutputTab);
  materialRecordStore.subscribe(renderOutputTab);
  photoRecordStore.subscribe(renderOutputTab);
  renderOutputTab();
}
