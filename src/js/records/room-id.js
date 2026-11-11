/** 棟別の共通部屋ID。A棟は旧形式を維持。旧 E|001 は読み取りのみ互換。 */
export function roomIdFor(areaCode, roomPosition, buildingId = '') {
  const area = String(areaCode || '').trim();
  const position = String(roomPosition ?? '').trim();
  const building = String(buildingId || '').trim().toUpperCase();
  if (!/^[EIBSR]$/.test(area) || !/^\d+$/.test(position)) return '';
  if (building && !/^[A-Z]$/.test(building)) return '';
  return `${building && building !== 'A' ? `${building}-` : ''}${area}-${position}`;
}

export function normalizeRoomId(value) {
  const match = /^(?:([A-Z])-)?([EIBSR])[-|](\d+)$/.exec(String(value || '').trim());
  return match ? roomIdFor(match[2], match[3], match[1] || '') : '';
}
