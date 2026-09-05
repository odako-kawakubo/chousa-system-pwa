/**
 * src/js/record-view/record-view-renderer.js
 *
 * レコード確認タブのDOM描画だけを担当する。
 * Storeへは直接アクセスせず、record-view-view-model.jsが返したデータだけを描画する。
 */

import { RECORD_VIEW_TABS } from './record-view-view-model.js';

const MATERIAL_COLUMNS = [
  ['status', '状態'],
  ['materialId', '建材ID'],
  ['inputId', '入力ID'],
  ['materialNo', '建材No.'],
  ['name', '建材名称'],
  ['part', '部位'],
  ['usageLocation', '使用箇所'],
  ['note', '調査備考'],
  ['analysisRequired', '分析の要否'],
  ['sampleCount', '採取数'],
  ['sampleLocation1', '採取場所1'],
  ['sampleLocation2', '採取場所2'],
  ['sampleLocation3', '採取場所3'],
  ['samplePart', '採取部位'],
  ['sampleDate', '採取日'],
  ['sampleName', '試料名称'],
  ['analysisResult', '分析結果'],
  ['remarks', '備考'],
  ['baseName', 'ベース名'],
  ['suffixLetter', '末尾英字'],
  ['systemMemo', 'システムメモ'],
  ['updatedDevice', '更新端末'],
  ['updatedAt', '更新日時']
];

const PHOTO_COLUMNS = [
  ['photoId', '写真ID'],
  ['photoTypeLabel', '区分'],
  ['fileName', 'ファイル名'],
  ['oneDrivePath', 'OneDrive保存先'],
  ['syncStatus', '同期状態'],
  ['isRepresentative', '代表写真'],
  ['capturedDevice', '撮影端末'],
  ['capturedAt', '撮影日時'],
  ['isEdited', '編集有無'],
  ['lastEditedDevice', '最終編集端末'],
  ['lastEditedAt', '最終編集日時'],
  ['deleted', '削除状態'],
  ['areaCode', '区分コード'],
  ['roomPosition', '部屋位置'],
  ['partSlot', '部位枠'],
  ['roomNo', '部屋No.'],
  ['materialId', '建材ID'],
  ['samplingPlace', '採取場所'],
  ['samplingBranch', '採取枝番'],
  ['sampleNo', '試料No.'],
  ['part', '部位'],
  ['shootingTypeLabel', '撮影区分'],
  ['systemMemo', 'システムメモ']
];

const FINISH_COLUMNS = [
  ['finishId', '仕上表ID'],
  ['roomUid', '内部部屋ID'],
  ['areaCode', '区分'],
  ['floor', '階'],
  ['roomNo', '部屋No.'],
  ['roomName', '部屋名'],
  ['position', '位置'],
  ['part', '部位'],
  ['materialId', '建材ID'],
  ['inputId', '入力ID'],
  ['materialName', '建材名称'],
  ['status', '状態'],
  ['systemMemo', 'システムメモ'],
  ['updatedDevice', '更新端末'],
  ['updatedAt', '更新日時']
];

const VALUE_LABELS = Object.freeze({
  active: '有効',
  deleted: '削除',
  pending: '未同期',
  synced: '同期済み',
  uploaded: '送信済み',
  saved: '保存済み',
  visual: '目視',
  sampling: '採取',
  before: '施工前',
  during: '施工中',
  after: '施工後',
  section: '断面'
});

const DATE_TIME_KEYS = new Set(['updatedAt', 'capturedAt', 'lastEditedAt']);

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.join('、');
  if (key === 'isRepresentative') return value ? '代表' : '-';
  if (key === 'isEdited') return value ? 'あり' : 'なし';
  if (key === 'deleted') return value ? '削除' : '有効';
  if (key === 'samplingBranch' && Number(value) === 0) return '-';
  if (DATE_TIME_KEYS.has(key)) return formatDateTime(value);
  const text = String(value);
  return VALUE_LABELS[text] || text;
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function ensureSystemMemoModal_() {
  let modal = document.getElementById('recordSystemMemoModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'recordSystemMemoModal';
  modal.className = 'record-system-memo-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="record-system-memo-card" role="dialog" aria-modal="true" aria-labelledby="recordSystemMemoTitle">
      <div class="record-system-memo-head">
        <h3 id="recordSystemMemoTitle">システムメモ</h3>
        <button type="button" class="btn small" data-system-memo-close>閉じる</button>
      </div>
      <pre class="record-system-memo-body" data-system-memo-body></pre>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.hidden = true;
    modal.classList.remove('open');
  };
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-system-memo-close]')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
  return modal;
}

function openSystemMemoModal_(memo) {
  const modal = ensureSystemMemoModal_();
  const body = modal.querySelector('[data-system-memo-body]');
  if (body) body.textContent = String(memo || '').trim();
  modal.hidden = false;
  modal.classList.add('open');
}

function renderSystemMemoCell_(td, memo) {
  const value = String(memo || '').trim();
  td.classList.add('record-view-system-memo');
  if (!value) {
    td.textContent = '-';
    td.title = '-';
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small record-view-memo-button';
  button.textContent = '表示';
  button.addEventListener('click', () => openSystemMemoModal_(value));
  td.replaceChildren(button);
  td.title = '';
}

function renderOneDrivePathCell_(td, value, emptyAsDash = false) {
  const url = String(value || '').trim();
  td.classList.add('record-view-url');
  if (!url) {
    td.textContent = emptyAsDash ? '-' : '';
    return;
  }

  const link = document.createElement('a');
  link.className = 'record-view-url-link';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = url;
  link.title = url;
  td.replaceChildren(link);
}

function renderTable(columns, records, emptyMessage, options = {}) {
  const table = document.getElementById('recordViewTable');
  if (!table) return;

  table.replaceChildren();

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach(([key, label], index) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (index === 0) th.classList.add('record-view-sticky-first');
    if (key === 'oneDrivePath') th.classList.add('record-view-url');
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (!records.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.className = 'record-view-empty';
    td.textContent = emptyMessage;
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    records.forEach((record) => {
      const tr = document.createElement('tr');
      columns.forEach(([key], index) => {
        const td = document.createElement('td');
        const formatted = formatValue(key, record[key]);
        if (key === 'systemMemo') {
          renderSystemMemoCell_(td, record[key]);
        } else if (key === 'oneDrivePath') {
          renderOneDrivePathCell_(td, formatted, options.emptyAsDash);
        } else {
          td.textContent = options.emptyAsDash && formatted === '' ? '-' : formatted;
          td.title = td.textContent;
        }
        if (index === 0) td.classList.add('record-view-sticky-first');
        if (key === 'note' || key === 'remarks' || key === 'usageLocation') td.classList.add('record-view-wrap');
        if (key === 'finishId' || key === 'roomUid' || key === 'roomPosition' || key === 'position' || key === 'materialId') td.classList.add('record-view-code');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
}

export function renderRecordView(viewModel) {
  document.querySelectorAll('[data-record-view-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.recordViewTab === viewModel.type);
  });

  setText('recordViewCountLabel', `${viewModel.label}レコード`);
  setText('recordViewTotalCount', String(viewModel.totalCount));
  setText('recordViewActiveCount', String(viewModel.activeCount));
  setText('recordViewHint', viewModel.hint);

  const activePill = document.getElementById('recordViewActivePill');
  if (activePill) activePill.style.display = '';

  const representativePill = document.getElementById('recordViewRepresentativePill');
  if (representativePill) {
    const showRepresentative = viewModel.type === RECORD_VIEW_TABS.PHOTO;
    representativePill.style.display = showRepresentative ? '' : 'none';
    if (showRepresentative) setText('recordViewRepresentativeCount', String(viewModel.representativeCount || 0));
  }

  if (viewModel.type === RECORD_VIEW_TABS.PHOTO) {
    renderTable(PHOTO_COLUMNS, viewModel.records, '写真レコードはまだありません。', { emptyAsDash: true });
    return;
  }

  if (viewModel.type === RECORD_VIEW_TABS.FINISH) {
    renderTable(FINISH_COLUMNS, viewModel.records, '仕上表レコードはまだありません。');
    return;
  }

  renderTable(MATERIAL_COLUMNS, viewModel.records, '建材レコードはまだありません。');
}
