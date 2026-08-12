/**
 * src/js/ui/drawer.js
 *
 * このファイルの役割：
 *   右からスライドインする「操作」ドロワーの開閉だけを行う。
 *   ドロワー本体の開閉だけを担当する。ドロワー内の各機能ボタンは、
 *   仕上表・更新機能などの担当モジュールが個別にイベント配線する。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js から bindDrawerEvents() が呼ばれる。
 *
 * 何を取得しているか：
 *   #drawer（ドロワー本体）、#drawerBackdrop（背景の半透明レイヤー）、
 *   [data-drawer-open]（ドロワーを開くボタン）、
 *   [data-drawer-close]（ドロワーを閉じるボタン群）
 *
 * どこへ書き込んでいるか：
 *   #drawer と #drawerBackdrop の open クラスのみ。
 *
 * どの処理とは分離しているか：
 *   ドロワー内の各ボタンが将来行う処理（建材の統合・削除、データ整合性
 *   チェックなど）とは完全に分離している。このファイルは「開く・閉じる」
 *   という表示の切り替えにのみ責任を持つ。
 */

/**
 * ドロワーを開く。
 *
 * 注意：
 * ・ここでは画面表示だけを行う。ドロワー内の各ボタンの処理は行わない。
 */
export function openDrawer() {
  document.getElementById('drawer')?.classList.add('open');
  document.getElementById('drawerBackdrop')?.classList.add('open');
}

/**
 * ドロワーを閉じる。
 */
export function closeDrawer() {
  document.getElementById('drawer')?.classList.remove('open');
  document.getElementById('drawerBackdrop')?.classList.remove('open');
}

/**
 * ドロワーの開閉ボタンへイベントを設定する。
 *
 * 手順：
 * 1. [data-drawer-open] を持つボタン（上部タブの「操作」ボタン）に
 *    クリックで openDrawer() を割り当てる
 * 2. [data-drawer-close] を持つボタン（閉じるボタン・背景クリック）に
 *    クリックで closeDrawer() を割り当てる
 */
export function bindDrawerEvents() {
  document.querySelectorAll('[data-drawer-open]').forEach((button) => {
    button.addEventListener('click', openDrawer);
  });
  document.querySelectorAll('[data-drawer-close]').forEach((el) => {
    el.addEventListener('click', closeDrawer);
  });
}
