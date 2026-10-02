/**
 * camera-orientation.js
 * 撮影画面の横向き判定とorientation変化通知だけを担当する。
 * Screen Orientation APIがない環境ではviewport比率へフォールバックする。
 */

export function isCameraLandscape() {
  const type = String(screen.orientation?.type || '');
  if (type) return type.startsWith('landscape');
  if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
  return window.innerWidth >= window.innerHeight;
}

export function bindCameraOrientationChange(callback) {
  if (typeof callback !== 'function') return () => {};
  const handler = () => callback(isCameraLandscape());

  window.addEventListener('orientationchange', handler);
  window.addEventListener('resize', handler);

  const orientation = screen.orientation;
  if (orientation?.addEventListener) orientation.addEventListener('change', handler);

  return () => {
    window.removeEventListener('orientationchange', handler);
    window.removeEventListener('resize', handler);
    if (orientation?.removeEventListener) orientation.removeEventListener('change', handler);
  };
}
