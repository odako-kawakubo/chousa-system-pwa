/**
 * 案件画面から中立トップへ戻るためのヘッダー導線だけを生成する。
 * 実際の保存・案件解除はhome-controllerが担当する。
 */
export function ensureHomeReturnControl() {
  const header = document.querySelector('.app-header-compact');
  if (!header || header.querySelector('[data-home-return]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn header-home-btn';
  button.dataset.homeReturn = '1';
  button.title = 'トップへ戻る';
  button.setAttribute('aria-label', 'トップへ戻る');
  button.textContent = 'しらべ';

  header.prepend(button);
}
