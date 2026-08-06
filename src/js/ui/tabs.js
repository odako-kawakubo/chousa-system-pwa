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
 *   設定する（v0.15.10のようにHTML側へ onclick を直接書かない）。
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
 *   ・タブを開いたときにそのタブの中身を「描画する」処理（例：仕上表の表を作る）は、
 *     このv0.1.0の時点ではまだ存在しないため、ここでは呼び出さない。
 *     本開発版がv0.3.0以降で各タブを実装する際に、このファイルから
 *     該当タブの render 関数を呼び出す形へ拡張する。
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
 * ・タブの中身をレンダリングする処理は、各タブの実装が追加された時点で
 *   この関数の末尾から呼び出す予定（v0.1.0では未実装）。
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
