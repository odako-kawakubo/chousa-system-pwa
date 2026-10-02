export const OPERATION_GUIDE_STEPS = [
  {
    id: 'guide-finish',
    section: '操作ガイド',
    tab: 'finish',
    title: '仕上表',
    text: '部屋名、新規/既存建材、その他建材、行・部屋・階追加が基本操作です。コピー・チップ入力・簡易リスト・カラー表示は効率操作として後続で詳しく追加します。',
    target: () => document.querySelector('#finish .finish-toolbar') || document.getElementById('finish')
  },
  {
    id: 'guide-materials',
    section: '操作ガイド',
    tab: 'materials',
    title: '建材リスト',
    text: '分析の要否、採取数、採取場所、採取部位、調査備考、採取チェック、採取日を管理します。統合・削除は詳細ガイドへ追加します。',
    target: () => document.querySelector('#materials .material-list-toolbar') || document.getElementById('materials')
  },
  {
    id: 'guide-photos',
    section: '操作ガイド',
    tab: 'photos',
    title: '写真',
    text: '目視調査と建材採取を切り替えて撮影します。採取写真では施工前・施工中・施工後・断面を区分して管理します。',
    target: () => document.querySelector('#photos .photo-mode-sticky') || document.getElementById('photos')
  },
  {
    id: 'guide-output',
    section: '操作ガイド',
    tab: 'sync',
    title: '出力',
    text: '建材リスト、部屋別リスト、建材写真帳、採取写真帳をプレビューし、PDF・印刷・Excelへ出力できます。',
    target: () => document.querySelector('#sync .output-toolbar') || document.getElementById('sync')
  }
];
