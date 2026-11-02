/**
 * 共通「未整理写真」タブの所属判定（純粋関数）。
 * 既存の目視/採取タブ内の未整理写真は対象にしない。
 * PhotoRecordの参照情報を書き換えず、現在の建材・仕上表の状態だけで判定する。
 */

const value = (input) => String(input ?? '').trim();
const roomKey = (record) => `${value(record.areaCode)}|${value(record.roomPosition)}`;
const visualPartSlot = (record) => Math.floor(Number(record.position || 0) / 100);

export function classifyOrphanPhoto(photo, { rooms = new Map(), materials = new Map() } = {}) {
  if (!photo || photo.deleted) return null;
  if (photo.photoType === 'visual') {
    const key = roomKey(photo);
    if (!value(photo.areaCode) || !value(photo.roomPosition)) return '調査場所が未設定';
    const room = rooms.get(key);
    if (!room) return '調査場所が存在しない';
    const slot = Number(photo.partSlot || 0);
    // 有効な部屋の部位未指定写真は、従来どおり部屋内の未整理に置く。
    if (!slot) return null;
    if (!room.some((record) => visualPartSlot(record) === slot
      && (slot <= 4 || value(record.part) === value(photo.part)))) {
      return '調査部位が存在しない';
    }
    return null;
  }
  if (photo.photoType === 'sampling') {
    if (!value(photo.materialId)) return '建材が未設定';
    const material = materials.get(value(photo.materialId));
    if (!material || material.status !== 'active') return '建材が存在しない';
    if (material.analysisRequired !== '採取・分析') return '採取対象外';
    const branch = Number(photo.samplingBranch || 0);
    // 採取枝番/区分未設定は、従来どおり建材内の未整理に置く。
    if (!branch) return null;
    if (branch > Number(material.sampleCount || 0) || branch < 0 || !Number.isInteger(branch)) {
      return '採取箇所が対象外';
    }
    return null;
  }
  return null;
}

export function classifyOrphanPhotos(photos = [], finishRecords = [], materialRecords = []) {
  const rooms = new Map();
  finishRecords.forEach((record) => {
    if (record.status !== 'active') return;
    const key = roomKey(record);
    if (!rooms.has(key)) rooms.set(key, []);
    rooms.get(key).push(record);
  });
  const materials = new Map(materialRecords.map((record) => [value(record.materialId), record]));
  return photos.flatMap((photo) => {
    const reason = classifyOrphanPhoto(photo, { rooms, materials });
    return reason ? [{ photo, reason }] : [];
  });
}
