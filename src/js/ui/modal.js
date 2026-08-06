/**
 * src/js/ui/modal.js
 *
 * このファイルの役割：
 *   汎用モーダル（更新確認モーダル／既存案件を開くモーダル／写真拡大
 *   プレビューモーダル）の開閉だけを行う。各モーダルの中身（実際の
 *   更新処理・案件検索・写真表示）は、対応する機能が本開発版へ
 *   実装された時点で個別に追加する。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js から bindModalEvents() が呼ばれる。
 *
 * 対象モーダル（HTML側で data-modal="モーダルid" を付与する想定）：
 *   #updateModal          最新版に更新の確認
 *   #sharedProjectModal   既存案件を開く／正式案件に切替
 *   #photoPreviewModal    写真拡大プレビュー
 *
 * 何を取得しているか：
 *   [data-modal-open] を持つボタン（開きたいモーダルのidをdata-modal-target
 *   に持つ）、[data-modal-close] を持つボタン・背景要素
 *   （閉じたいモーダルのidをdata-modal-targetに持つ）
 *
 * どこへ書き込んでいるか：
 *   対象モーダル要素の open クラスのみ。
 *
 * どの処理とは分離しているか：
 *   各モーダルが将来行う実処理（PWAキャッシュ更新、案件検索・切替、
 *   写真データの表示）とは完全に分離している。このファイルは
 *   「開く・閉じる」という表示の切り替えにのみ責任を持つ。
 */

/**
 * 指定したidのモーダルを開く。
 *
 * @param {string} modalId 開きたいモーダル要素のid
 */
export function openModal(modalId) {
  document.getElementById(modalId)?.classList.add('open');
}

/**
 * 指定したidのモーダルを閉じる。
 *
 * @param {string} modalId 閉じたいモーダル要素のid
 */
export function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('open');
}

/**
 * モーダルの開閉ボタン・背景クリックへイベントを設定する。
 *
 * 手順：
 * 1. [data-modal-open] を持つボタンに、data-modal-target が指す
 *    モーダルを開くクリックイベントを設定する
 * 2. [data-modal-close] を持つ要素（閉じるボタン・背景）に、
 *    data-modal-target が指すモーダルを閉じるクリックイベントを設定する
 */
export function bindModalEvents() {
  document.querySelectorAll('[data-modal-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.modalTarget;
      if (targetId) openModal(targetId);
    });
  });
  document.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const targetId = el.dataset.modalTarget;
      if (targetId) closeModal(targetId);
    });
  });

  // モーダル本体（背景オーバーレイ）のクリックで閉じる仕様のため、
  // カード部分（[data-modal-stop]）のクリックが背景まで伝播して
  // 誤って閉じないようにする。
  document.querySelectorAll('[data-modal-stop]').forEach((card) => {
    card.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });
}
