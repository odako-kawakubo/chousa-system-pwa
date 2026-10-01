/**
 * src/js/ui/drawer.js
 *
 * 右側ドロワー（操作／ガイド）の表示だけを管理する。
 * 各ドロワー内の業務処理は、それぞれの担当モジュールが配線する。
 */

const DRAWERS = {
  operation: { drawerId:'drawer', backdropId:'drawerBackdrop' },
  guide: { drawerId:'guideDrawer', backdropId:'guideDrawerBackdrop' }
};

function drawerConfig(name) {
  return DRAWERS[name] || DRAWERS.operation;
}

function setDrawerState(name, open) {
  const config = drawerConfig(name);
  document.getElementById(config.drawerId)?.classList.toggle('open', open);
  document.getElementById(config.backdropId)?.classList.toggle('open', open);
}

export function closeAllDrawers() {
  Object.keys(DRAWERS).forEach((name) => setDrawerState(name, false));
}

export function openDrawer(name = 'operation') {
  closeAllDrawers();
  setDrawerState(name, true);
}

export function closeDrawer(name = 'operation') {
  setDrawerState(name, false);
}

export function openGuideDrawer() {
  openDrawer('guide');
}

export function closeGuideDrawer() {
  closeDrawer('guide');
}

export function bindDrawerEvents() {
  document.querySelectorAll('[data-drawer-open]').forEach((button) => {
    button.addEventListener('click', () => {
      openDrawer(button.dataset.drawerOpen || 'operation');
    });
  });

  document.querySelectorAll('[data-drawer-close]').forEach((element) => {
    element.addEventListener('click', () => {
      closeDrawer(element.dataset.drawerClose || 'operation');
    });
  });
}
