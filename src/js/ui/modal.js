/**
 * src/js/ui/modal.js
 *
 * このファイルの役割：
 *   汎用モーダルの開閉だけを行う。更新処理は app-update.js、案件検索や
 *   写真表示は各担当モジュールへ分離し、このファイルでは実処理を持たない。
 *
 * どこから呼ばれるか：
 *   src/js/app-init.js から bindModalEvents() が呼ばれる。
 *
 * 対象モーダル（HTML側で data-modal="モーダルid" を付与する想定）：
 *   #updateModal          アップデート確認
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
 *   更新、案件検索・切替、写真表示などの実処理とは分離している。このファイルは
 *   「開く・閉じる」という表示の切り替えにのみ責任を持つ。
 */

/**
 * 指定したidのモーダルを開く。
 *
 * @param {string} modalId 開きたいモーダル要素のid
 */
const PROJECT_MODAL_ID = 'sharedProjectModal';
let projectModalScrollState = null;

function lockProjectModalBackground() {
  if (projectModalScrollState) return;
  const body = document.body;
  const root = document.documentElement;
  const scrollY = window.scrollY;
  projectModalScrollState = {
    scrollY,
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
    overflow: body.style.overflow,
    rootOverflow: root.style.overflow
  };
  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  root.style.overflow = 'hidden';
}

function unlockProjectModalBackground() {
  const previous = projectModalScrollState;
  if (!previous) return;
  projectModalScrollState = null;
  const body = document.body;
  body.style.position = previous.position;
  body.style.top = previous.top;
  body.style.width = previous.width;
  body.style.overflow = previous.overflow;
  document.documentElement.style.overflow = previous.rootOverflow;
  window.scrollTo(0, previous.scrollY);
}

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  if (modalId === PROJECT_MODAL_ID) lockProjectModalBackground();
  modal.classList.add('open');
}

/**
 * 指定したidのモーダルを閉じる。
 *
 * @param {string} modalId 閉じたいモーダル要素のid
 */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('open');
  if (modalId === PROJECT_MODAL_ID) unlockProjectModalBackground();
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
