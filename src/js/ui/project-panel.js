/**
 * src/js/ui/project-panel.js
 *
 * このファイルの役割：
 *   左からスライドインする「案件選択パネル」の開閉だけを行う。
 *   案件一覧の中身（案件データ表示・案件切替・仮案件作成）は案件管理
 *   モジュールへ分離し、このファイルはパネルの開閉だけを担当する。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js から bindProjectPanelEvents() が呼ばれる。
 *
 * 何を取得しているか：
 *   #projectSidePanel（パネル本体）、#projectSideBackdrop（背景レイヤー）、
 *   [data-project-panel-open]（ヘッダーの「案件」ボタン）、
 *   [data-project-panel-close]（閉じるボタン・背景クリック）
 *
 * どこへ書き込んでいるか：
 *   #projectSidePanel と #projectSideBackdrop の open クラス、
 *   および aria-hidden 属性のみ。
 *
 * どの処理とは分離しているか：
 *   案件一覧の取得・案件切替・仮案件作成・正式案件化といった業務処理とは
 *   完全に分離している。このファイルは「開く・閉じる」という表示の
 *   切り替えにのみ責任を持つ。
 */

/**
 * 案件選択パネルを開く。
 *
 * 注意：
 * ・ここでは画面表示だけを行う。案件一覧の取得・描画は行わない。
 */
export function openProjectPanel() {
  const panel = document.getElementById('projectSidePanel');
  const backdrop = document.getElementById('projectSideBackdrop');
  panel?.classList.add('open');
  panel?.setAttribute('aria-hidden', 'false');
  backdrop?.classList.add('open');
}

/**
 * 案件選択パネルを閉じる。
 */
export function closeProjectPanel() {
  const panel = document.getElementById('projectSidePanel');
  const backdrop = document.getElementById('projectSideBackdrop');
  panel?.classList.remove('open');
  panel?.setAttribute('aria-hidden', 'true');
  backdrop?.classList.remove('open');
}

/**
 * 案件選択パネルの開閉ボタンへイベントを設定する。
 */
export function bindProjectPanelEvents() {
  document.querySelectorAll('[data-project-panel-open]').forEach((button) => {
    button.addEventListener('click', openProjectPanel);
  });
  document.querySelectorAll('[data-project-panel-close]').forEach((el) => {
    el.addEventListener('click', closeProjectPanel);
  });
}
