/**
 * 案件画面から独立トップ(index.html)へ戻る導線。
 * 保存・案件解除後にページ遷移する。
 */
import { closeProjectSession } from '../projects/project-session.js';
import { openHomePage } from '../projects/project-navigation.js';

export function ensureHomeReturnControl() {
  const header = document.querySelector('.app-header-compact');
  if (!header || header.querySelector('[data-home-return]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn header-home-btn';
  button.dataset.homeReturn = '1';
  button.title = 'トップへ戻る';
  button.setAttribute('aria-label', 'トップへ戻る');
  button.textContent = '←';
  button.addEventListener('click', () => {
    closeProjectSession();
    openHomePage();
  });

  header.prepend(button);
}
