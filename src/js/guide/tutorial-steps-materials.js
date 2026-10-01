/**
 * 建材リストセクションの基本チュートリアル。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';

function tutorialMaterialId(partIndex) {
  const position = Number(partIndex) * 100 + 1;
  const record = finishRecordStore.getAll()
    .filter((item) =>
      item.status === 'active'
      && item.areaCode === 'I'
      && Number(item.floor) === 1
      && Number(item.position) === position
      && item.materialId
    )
    .sort((a, b) => String(a.roomPosition).localeCompare(String(b.roomPosition), undefined, { numeric:true }))[0];
  return String(record?.materialId || '');
}

function floorMaterialId() {
  return tutorialMaterialId(1);
}

function otherMaterialId() {
  return tutorialMaterialId(5);
}

function materialRow(materialId) {
  if (!materialId) return null;
  return document.querySelector(`#materials [data-material-row][data-material-id="${CSS.escape(materialId)}"]`);
}

function materialControl(materialId, field) {
  return materialRow(materialId)?.querySelector(
    `[data-material-control][data-field="${CSS.escape(field)}"]`
  ) || null;
}

function materialText(materialId, kind) {
  return materialRow(materialId)?.querySelector(
    `[data-material-text-display][data-editor-kind="${CSS.escape(kind)}"], [data-material-text-input][data-editor-kind="${CSS.escape(kind)}"]`
  ) || null;
}

function materialMultiSelect(materialId) {
  return materialRow(materialId)?.querySelector('[data-material-multi-select]') || null;
}

function openMaterialMultiMenu(materialId) {
  const details = materialMultiSelect(materialId);
  return details?.open ? details.querySelector('.material-multi-select-menu') : null;
}

function tutorialRows() {
  return [floorMaterialId(), otherMaterialId()]
    .map(materialRow)
    .filter(Boolean);
}

function record(materialId) {
  return materialRecordStore.get(materialId) || null;
}

function snapshotRecord(snapshot, materialId) {
  return (snapshot?.materialRecords || []).find((item) => String(item.materialId) === String(materialId)) || null;
}

export const MATERIAL_TUTORIAL_STEPS = [
  {
    id: 'finish-complete-material-list',
    section: '仕上表',
    tab: 'materials',
    title: '仕上表の基本操作は完了です',
    text: '仕上表で登録した建材は、建材リストへ一覧として反映されます。',
    target: () => tutorialRows()
  },
  {
    id: 'materials-intro',
    section: '建材リスト',
    tab: 'materials',
    title: '建材リスト',
    text: 'ここでは建材ごとに、分析の要否や採取に必要な情報を設定します。',
    target: () => document.querySelector('#materials .material-list-table-wrap') || document.getElementById('materials')
  },
  {
    id: 'materials-analysis-required',
    section: '建材リスト',
    tab: 'materials',
    title: '分析の要否',
    text: 'その他1で登録した建材の「分析の要否」を「目視」に変更してみます。',
    target: () => materialControl(otherMaterialId(), 'analysisRequired'),
    interactive: true,
    watchStores: ['material'],
    permissions: () => [{
      actionId: 'material.control.change',
      context: { materialId: otherMaterialId(), field: 'analysisRequired' }
    }],
    completeWhen: () => record(otherMaterialId())?.analysisRequired === '目視'
  },
  {
    id: 'materials-sample-count',
    section: '建材リスト',
    tab: 'materials',
    title: '採取数',
    text: '床の建材の採取数を「2」に変更してみます。採取・分析する建材は1〜3検体で設定できます。',
    target: () => materialControl(floorMaterialId(), 'sampleCount'),
    interactive: true,
    watchStores: ['material'],
    permissions: () => [{
      actionId: 'material.control.change',
      context: { materialId: floorMaterialId(), field: 'sampleCount' }
    }],
    completeWhen: () => Number(record(floorMaterialId())?.sampleCount) === 2
  },
  {
    id: 'materials-sample-location',
    section: '建材リスト',
    tab: 'materials',
    title: '採取場所',
    text: '採取場所1を選択します。仕上表で使用した部屋が候補として表示されます。',
    target: () => materialControl(floorMaterialId(), 'sampleLocation1'),
    interactive: true,
    watchStores: ['material'],
    permissions: () => [{
      actionId: 'material.control.change',
      context: { materialId: floorMaterialId(), field: 'sampleLocation1' }
    }],
    completeWhen: ({ snapshot }) => {
      const id = floorMaterialId();
      const before = String(snapshotRecord(snapshot, id)?.sampleLocation1 || '');
      const after = String(record(id)?.sampleLocation1 || '');
      return Boolean(after) && after !== before;
    }
  },
  {
    id: 'materials-sample-part',
    section: '建材リスト',
    tab: 'materials',
    title: '採取部位',
    text: '採取部位は使用部位から候補が作られます。使用部位が1つの場合は自動で補完されます。',
    target: () => materialMultiSelect(floorMaterialId()),
    extraTargets: () => openMaterialMultiMenu(floorMaterialId())
  },
  {
    id: 'materials-note',
    section: '建材リスト',
    tab: 'materials',
    title: '調査備考',
    text: '調査備考へ任意の内容を入力します。',
    target: () => materialText(floorMaterialId(), 'note'),
    interactive: true,
    watchStores: ['material'],
    permissions: () => [{
      actionId: 'material.text.edit',
      context: { materialId: floorMaterialId(), kind: 'note' }
    }],
    completeWhen: ({ snapshot }) => {
      const id = floorMaterialId();
      const before = String(snapshotRecord(snapshot, id)?.note || '');
      const after = String(record(id)?.note || '');
      return Boolean(after.trim()) && after !== before;
    }
  },
  {
    id: 'materials-sample-done',
    section: '建材リスト',
    tab: 'materials',
    title: '採取チェック',
    text: '採取が完了したら「採取」にチェックを入れます。',
    target: () => materialControl(floorMaterialId(), 'sampleDone'),
    interactive: true,
    watchStores: ['material'],
    permissions: () => [{
      actionId: 'material.control.change',
      context: { materialId: floorMaterialId(), field: 'sampleDone' }
    }],
    completeWhen: () => Boolean(record(floorMaterialId())?.sampleDone)
  },
  {
    id: 'materials-sample-date-result',
    section: '建材リスト',
    tab: 'materials',
    title: '採取日',
    text: '採取チェックを入れると、採取日が未入力の場合は当日の日付が自動で入ります。',
    target: () => [
      materialControl(floorMaterialId(), 'sampleDone'),
      materialControl(floorMaterialId(), 'sampleDate')
    ].filter(Boolean)
  },
  {
    id: 'materials-complete',
    section: '建材リスト',
    tab: 'materials',
    title: '建材リストの基本操作は完了です',
    text: '分析・採取に必要な基本情報の設定はここまでです。次は写真の操作へ進みます。',
    target: () => materialRow(floorMaterialId())
  }
];
