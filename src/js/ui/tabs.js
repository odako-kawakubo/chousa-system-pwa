/**
 * src/js/ui/tabs.js
 *
 * このファイルの役割：
 *   上部タブ（仕上表・建材リスト・写真・調査図・同期・設定・レコード）の
 *   表示切り替えだけを行う。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js の起動処理から bindTabEvents() が呼ばれる。
 *   タブボタンのクリックイベントは、このファイル内で addEventListener により
 *   設定する。HTML側へインラインonclickは書かない。
 *
 * 何を取得しているか：
 *   ・[data-tab] を持つタブボタン一覧
 *   ・.content を持つ各タブの中身要素一覧
 *
 * 何を判定しているか：
 *   クリックされたボタンの data-tab 属性値と、各 .content 要素の id が
 *   一致するかどうかだけを判定する。
 *
 * どこへ書き込んでいるか：
 *   各 .content 要素の表示・非表示（style.display）と、
 *   タブボタンの active クラスのみ。
 *
 * どの処理とは分離しているか：
 *   ・このファイルはタブ表示の切り替えだけを担当する。各タブ固有の描画は
 *     各担当モジュールが初期化・更新する。
 *   ・保存・Firestore同期・OneDrive連携は一切行わない。
 */

/**
 * 指定したタブだけを表示し、それ以外を隠す。
 *
 * 手順：
 * 1. すべての .content 要素を非表示にする
 * 2. 指定された id を持つ .content 要素だけを表示する
 * 3. タブボタンの active クラスを、クリックされたタブに合わせて切り替える
 *
 * 注意：
 * ・この関数はDOM表示の切り替えだけを行う。
 * ・タブ固有の描画処理は各担当モジュールへ分離する。
 *
 * @param {string} tabId 表示したいタブの id（例: 'finish', 'materials'）
 */
export function showTab(tabId) {
  const requestedId = String(tabId || 'finish');

  // 画面描画：すべてのタブ中身を一旦隠す
  document.querySelectorAll('.content').forEach((section) => {
    section.style.display = 'none';
  });

  // 対象のタブ中身が存在しない場合は、既定として仕上表タブへフォールバックする
  const target =
    document.getElementById(requestedId) || document.getElementById('finish');
  if (!target) return;

  target.style.display = 'block';

  // 画面描画：タブボタンのハイライトを切り替える
  document.querySelectorAll('.tab').forEach((tabButton) => {
    tabButton.classList.toggle('active', tabButton.dataset.tab === target.id);
  });

  // ここでは画面表示だけを行う。
  // 各タブの中身（仕上表の表・建材リストの行など）を作る処理は
  // 今後、対応するモジュールが実装された時点でここから呼び出す。
}

/**
 * タブボタンへクリックイベントを設定する。
 *
 * 手順：
 * 1. [data-tab] を持つ全ボタンを取得する
 * 2. クリック時に、そのボタンの data-tab 値で showTab() を呼ぶ
 *
 * 注意：
 * ・この関数はイベント設定のみを行い、初期表示（最初にどのタブを開くか）は
 *   app-init.js 側の責務とする。
 */
export function bindTabEvents() {
  document.querySelectorAll('.tabs .tab[data-tab]').forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      showTab(tabButton.dataset.tab);
    });
  });
}
