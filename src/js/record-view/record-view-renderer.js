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

const FINISH_COLUMNS = [
  ['finishId', 'finishId'],
  ['roomUid', 'roomUid（内部）'],
  ['areaCode', '区分'],
  ['roomPosition', 'roomPosition'],
  ['floor', '階'],
  ['roomNo', '部屋No.'],
  ['roomName', '部屋名'],
  ['position', 'position'],
  ['part', '部位'],
  ['materialId', 'materialId'],
  ['inputId', 'inputId'],
  ['status', '状態'],
  ['systemMemo', 'システムメモ'],
  ['updatedDevice', '更新端末'],
  ['updatedAt', '更新日時']
];

function formatValue(key, value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function renderTable(columns, records, emptyMessage) {
  const table = document.getElementById('recordViewTable');
  if (!table) return;

  table.replaceChildren();

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach(([, label], index) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (index === 0) th.classList.add('record-view-sticky-first');
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
        td.textContent = formatValue(key, record[key]);
        td.title = td.textContent;
        if (index === 0) td.classList.add('record-view-sticky-first');
        if (key === 'systemMemo' || key === 'note' || key === 'remarks' || key === 'usageLocation') {
          td.classList.add('record-view-wrap');
        }
        if (key === 'finishId' || key === 'roomUid' || key === 'roomPosition' || key === 'position' || key === 'materialId') {
          td.classList.add('record-view-code');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
}

/**
 * サブタブ、件数、ヒント、一覧表をまとめて描画する。
 */
export function renderRecordView(viewModel) {
  document.querySelectorAll('[data-record-view-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.recordViewTab === viewModel.type);
  });

  setText('recordViewCountLabel', `${viewModel.label}レコード`);
  setText('recordViewTotalCount', String(viewModel.totalCount));
  setText('recordViewActiveCount', String(viewModel.activeCount));
  setText('recordViewHint', viewModel.hint);

  const activePill = document.getElementById('recordViewActivePill');
  if (activePill) activePill.style.display = viewModel.unavailable ? 'none' : '';

  const representativePill = document.getElementById('recordViewRepresentativePill');
  if (representativePill) {
    representativePill.style.display = 'none';
  }

  if (viewModel.type === RECORD_VIEW_TABS.PHOTO) {
    renderTable([['status', '状態']], [], 'photoRecordStoreは未実装です。');
    return;
  }

  if (viewModel.type === RECORD_VIEW_TABS.FINISH) {
    renderTable(FINISH_COLUMNS, viewModel.records, '仕上表レコードはまだありません。');
    return;
  }

  renderTable(MATERIAL_COLUMNS, viewModel.records, '建材レコードはまだありません。');
}
