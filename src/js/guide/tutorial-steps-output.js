/**
 * 分析結果／出力セクションの基本チュートリアル。
 * 実ファイル取込・PDF/Excel生成は行わず、表示と帳票切替を確認する。
 */

function analysisToggleButton() {
  return document.querySelector('#materials [data-action="toggle-material-analysis-columns"]');
}

function analysisColumnsVisible() {
  return Boolean(document.querySelector('#materials .col-analysis-result, #materials .col-analysis-remarks'));
}

function analysisColumnTargets() {
  return [
    document.querySelector('#materials th.col-analysis-result'),
    document.querySelector('#materials th.col-analysis-remarks')
  ].filter(Boolean);
}

function operationButton() {
  return document.querySelector('[data-drawer-open="operation"]');
}

function outputToolbar() {
  return document.querySelector('#sync .output-toolbar');
}

function outputViewButton(view) {
  return document.querySelector(`#sync [data-output-view="${CSS.escape(view)}"]`);
}

function outputViewActive(view) {
  return Boolean(outputViewButton(view)?.classList.contains('active'));
}

function outputPreview() {
  return document.querySelector('#sync .output-pdf-review') || document.querySelector('#sync [data-output-pdf-host]');
}

function exportButtons() {
  return [...document.querySelectorAll('#sync [data-output-export]')];
}

export const OUTPUT_TUTORIAL_STEPS = [
  {
    id: 'analysis-intro',
    section: '分析結果',
    tab: 'materials',
    title: '分析結果',
    text: '分析結果と分析備考は、建材ごとに建材リストで管理します。',
    target: () => analysisToggleButton()
  },
  {
    id: 'analysis-show-columns',
    section: '分析結果',
    tab: 'materials',
    title: '分析欄を表示',
    text: '「分析欄を表示」を押して、分析結果と分析備考の列を表示します。',
    target: () => analysisToggleButton(),
    interactive: true,
    permissions: [{
      actionId: 'material.action.toggle-material-analysis-columns',
      context: {}
    }],
    completeWhen: ({ didAction }) =>
      analysisColumnsVisible()
      && didAction('material.action.toggle-material-analysis-columns')
  },
  {
    id: 'analysis-columns',
    section: '分析結果',
    tab: 'materials',
    title: '分析結果・分析備考',
    text: '分析結果と分析備考はここに表示されます。必要に応じて直接編集することもできます。',
    target: () => analysisColumnTargets()
  },
  {
    id: 'analysis-import-info',
    section: '分析結果',
    tab: 'materials',
    title: '分析結果取込',
    text: '定性速報PDFは、右上の「操作」→「分析結果取込」から読み込み、試料名称を照合して一括反映できます。',
    target: () => operationButton()
  },
  {
    id: 'output-intro',
    section: '出力',
    tab: 'sync',
    title: '出力',
    text: '入力した内容は、出力タブで実際の帳票プレビューとして確認できます。',
    target: () => [outputToolbar(), outputPreview()].filter(Boolean)
  },
  {
    id: 'output-rooms',
    section: '出力',
    tab: 'sync',
    title: '部屋別リスト',
    text: '「部屋別リスト」に切り替えます。',
    target: () => outputViewButton('rooms'),
    interactive: true,
    permissions: [{
      actionId: 'output.view.change',
      context: { view: 'rooms' }
    }],
    completeWhen: ({ didAction }) =>
      outputViewActive('rooms')
      && didAction('output.view.change', { view:'rooms' })
  },
  {
    id: 'output-visual-photos',
    section: '出力',
    tab: 'sync',
    title: '建材写真帳',
    text: '次に「建材写真帳」へ切り替えます。',
    target: () => outputViewButton('visual-photos'),
    interactive: true,
    permissions: [{
      actionId: 'output.view.change',
      context: { view: 'visual-photos' }
    }],
    completeWhen: ({ didAction }) =>
      outputViewActive('visual-photos')
      && didAction('output.view.change', { view:'visual-photos' })
  },
  {
    id: 'output-sampling-photos',
    section: '出力',
    tab: 'sync',
    title: '採取写真帳',
    text: '最後に「採取写真帳」へ切り替えます。',
    target: () => outputViewButton('sampling-photos'),
    interactive: true,
    permissions: [{
      actionId: 'output.view.change',
      context: { view: 'sampling-photos' }
    }],
    completeWhen: ({ didAction }) =>
      outputViewActive('sampling-photos')
      && didAction('output.view.change', { view:'sampling-photos' })
  },
  {
    id: 'output-export-info',
    section: '出力',
    tab: 'sync',
    title: 'PDF・印刷・Excel',
    text: 'PDF・印刷・Excelから、必要な帳票を選択して出力できます。基本チュートリアルでは実ファイルの出力は行いません。',
    target: () => exportButtons()
  },
  {
    id: 'tutorial-complete',
    section: '完了',
    tab: 'sync',
    title: '基本チュートリアル完了',
    text: '仕上表、建材リスト、写真、分析結果、出力までの基本操作は以上です。',
    target: () => document.querySelector('#sync .output-root') || document.getElementById('sync')
  }
];
