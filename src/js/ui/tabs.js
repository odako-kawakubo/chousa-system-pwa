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
 *
 * v0.1.6.6:
 *   表示切替後に chousa:tab-change を通知する。
 *   タブ固有処理はここへ直接書かず、各担当モジュールが通知を購読する。
 */

/** 現在activeになっている上部タブIDを返す。 */
function activeTabId() {
  return document.querySelector('.tabs .tab[data-tab].active')?.dataset?.tab || '';
}

/**
 * 指定したタブだけを表示し、それ以外を隠す。
 *
 * @param {string} tabId 表示したいタブの id（例: 'finish', 'materials'）
 */
export function showTab(tabId) {
  const requestedId = String(tabId || 'finish');
  const previousId = activeTabId();

  document.querySelectorAll('.content').forEach((section) => {
    section.style.display = 'none';
  });

  const target = document.getElementById(requestedId) || document.getElementById('finish');
  if (!target) return;

  target.style.display = 'block';

  document.querySelectorAll('.tab').forEach((tabButton) => {
    tabButton.classList.toggle('active', tabButton.dataset.tab === target.id);
  });

  const nextId = target.id;
  if (previousId !== nextId) {
    window.dispatchEvent(new CustomEvent('chousa:tab-change', {
      detail: { previousTab: previousId, currentTab: nextId }
    }));
  }
}

/**
 * タブボタンへクリックイベントを設定する。
 */
export function bindTabEvents() {
  document.querySelectorAll('.tabs .tab[data-tab]').forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      showTab(tabButton.dataset.tab);
    });
  });
}
