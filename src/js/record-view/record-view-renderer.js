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
  ['roomNo', '部屋No.'],
  ['roomNo', '部屋No.'],
  ['materialId', '建材ID'],
  ['samplingPlace', '採取場所'],
  ['samplingBranch', '採取枝番'],
  ['sampleNo', '試料No.'],
  ['part', '部位'],
  ['shootingTypeLabel', '撮影区分']
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

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.join('、');
  if (key === 'isRepresentative') return value ? '代表' : '-';
  if (key === 'isEdited') return value ? 'あり' : 'なし';
  if (key === 'deleted') return value ? '削除' : '有効';
  if (key === 'samplingBranch' && Number(value) === 0) return '-';
  return String(value);
}


function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function renderTable(columns, records, emptyMessage, options = {}) {
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
        const formatted = formatValue(key, record[key]);
        td.textContent = options.emptyAsDash && formatted === '' ? '-' : formatted;
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
  if (activePill) activePill.style.display = '';

  const representativePill = document.getElementById('recordViewRepresentativePill');
  if (representativePill) {
    const showRepresentative = viewModel.type === RECORD_VIEW_TABS.PHOTO;
    representativePill.style.display = showRepresentative ? '' : 'none';
    if (showRepresentative) {
      setText('recordViewRepresentativeCount', String(viewModel.representativeCount || 0));
    }
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
