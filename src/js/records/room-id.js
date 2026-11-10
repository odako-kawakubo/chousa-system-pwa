/**
 * 区分コード＋部屋位置による共通部屋ID。部屋No.や部屋名とは独立する。
 * 旧形式(areaCode|roomPosition)は読み取り時だけ正規化する。
 */
export function roomIdFor(areaCode, roomPosition) {
  const area = String(areaCode || '').trim();
  const position = String(roomPosition ?? '').trim();
  return /^[EIBSR]$/.test(area) && /^\d+$/.test(position)
    ? `${area}-${position}` : '';
}

export function normalizeRoomId(value) {
  const match = /^([EIBSR])[-|](\d+)$/.exec(String(value || '').trim());
  return match ? roomIdFor(match[1], match[2]) : '';
}
