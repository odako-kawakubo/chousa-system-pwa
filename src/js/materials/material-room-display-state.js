/**
 * 建材リストを起点に共有する部屋表示状態。
 * OFF=部屋No.、ON=部屋名優先（部屋名空欄は部屋No.へフォールバック）。
 */
let roomNameMode = false;

export function getMaterialRoomNameMode() {
  return roomNameMode;
}

export function setMaterialRoomNameMode(value) {
  const next = Boolean(value);
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
