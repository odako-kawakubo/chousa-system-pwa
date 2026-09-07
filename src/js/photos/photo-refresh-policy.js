/**
 * src/js/photos/photo-refresh-policy.js
 *
 * 外部同期など、写真タブ自身の操作以外から写真画面の再描画を要求する時の
 * 判定を一元化する。Record種別そのものではなく、現在表示中の写真モードと
 * UIへの影響でrefreshPhotoTab()を呼ぶ。
 */
import { refreshPhotoTab } from './photo-controller.js';

let tabActivationBound = false;

function currentPhotoMode() {
  const active = document.querySelector('#photos [data-photo-mode].active');
  return active?.dataset?.photoMode === 'sampling' ? 'sampling' : 'visual';
}

function photosTabIsActive() {
  const section = document.getElementById('photos');
  if (!section) return false;
  if (section.hidden) return false;
  if (section.classList.contains('active')) return true;
  const activeTab = document.querySelector('.tabs .tab[data-tab="photos"].active');
  return Boolean(activeTab);
}

/**
 * 写真タブを開いた瞬間は、裏で省略していた更新があっても最新Storeから再構築する。
 * これにより、非表示中は無駄に描画せず、表示時の古い画面も残さない。
 */
export function initializePhotoRefreshOnTabActivation() {
  if (tabActivationBound) return;
  tabActivationBound = true;

  document.querySelectorAll('.tabs .tab[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.tab !== 'photos') return;
      queueMicrotask(() => refreshPhotoTab());
    });
  });
}

/**
 * project-controllerで分類済みの影響情報から、現在の写真画面に本当に必要な時だけ描画する。
 * 非表示中は描画せず、次に写真タブを開いた時に最新Storeから再構築する。
 */
export function refreshPhotoForImpact({
  visual = false,
  sampling = false,
  force = false
} = {}) {
  initializePhotoRefreshOnTabActivation();
  if (!photosTabIsActive()) return 'skipped-hidden';

  const mode = currentPhotoMode();
  if (!force) {
    if (mode === 'visual' && !visual) return 'skipped-unrelated-mode';
    if (mode === 'sampling' && !sampling) return 'skipped-unrelated-mode';
  }

  refreshPhotoTab();
  return 'rendered';
}
