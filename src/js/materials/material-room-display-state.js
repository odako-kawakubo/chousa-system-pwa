/**
 * 建材リストを起点に共有する部屋表示状態。
 * OFF=部屋No.、ON=部屋名優先（部屋名空欄は部屋No.へフォールバック）。
 *
 * この設定は案件固有ではなく端末UI設定として保持する。
 * 案件切替・再起動後も同じ表示モードを維持する。
 */
const STORAGE_KEY = 'chousa-material-room-name-mode-v1';

function loadStoredRoomNameMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistRoomNameMode(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // UI補助設定の保存失敗で本体操作を止めない。
  }
}

let roomNameMode = loadStoredRoomNameMode();

export function getMaterialRoomNameMode() {
  return roomNameMode;
}

export function setMaterialRoomNameMode(value, { persist = true } = {}) {
  const next = Boolean(value);
  if (persist) persistRoomNameMode(next);
  if (next === roomNameMode) return roomNameMode;

  roomNameMode = next;
  window.dispatchEvent(new CustomEvent('chousa:material-room-display-change', {
    detail: { roomNameMode }
  }));
  return roomNameMode;
}

export function toggleMaterialRoomNameMode() {
  return setMaterialRoomNameMode(!roomNameMode);
}
