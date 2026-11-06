/**
 * 部屋参照・表示の単一入口。名前ではなく areaCode|roomPosition を正本として識別する。
 * finishRecordの内容から常に最新の表示名を取得する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';

export function roomLocationKey(record = {}) {
  const area = String(record.areaCode || '').trim();
  const position = String(record.roomPosition || '').trim();
  return area && position ? `${area}|${position}` : '';
}

export function findRoomByLocationKey(key) {
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && roomLocationKey(record) === String(key || '')
  ) || null;
}

export function roomLocationDisplay(room = {}, { preferRoomName = false, context = 'list' } = {}) {
  const area = String(room.areaCode || '');
  const no = String(room.roomNo || '').trim();
  const name = String(room.roomName || '').trim();
  if (area === 'E') {
    const location = name || no;
    if (!location) return '';
    return preferRoomName && context === 'list' ? `外部 ${location}` : location;
  }
  return preferRoomName && name ? name : (no || name);
}

export function resolveRoomLocation(key, options = {}) {
  const record = findRoomByLocationKey(key);
  if (!record) return null;
  return {
    key: roomLocationKey(record),
    areaCode: record.areaCode,
    roomPosition: record.roomPosition,
    roomNo: String(record.roomNo || ''),
    roomName: String(record.roomName || ''),
    display: roomLocationDisplay(record, options)
  };
}

/**
 * 採取場所の帳票表示を共通化する。描画方法はPDF・Excelそれぞれに任せる。
 * 主表示と部屋No.補足を分けることで、PDFは補足を小さく描画できる。
 */
export function formatSamplingPlace(room = {}, { preferRoomName = false } = {}) {
  const roomNo = String(room.roomNo || '').trim();
  const roomName = String(room.roomName || '').trim();
  const fallback = String(room.fallback || '').trim();
  if (preferRoomName && roomName) {
    const supplement = roomNo ? `（部屋No.${roomNo}）` : '';
    return { primary:roomName, supplement, text:roomName + supplement };
  }
  const no = roomNo || fallback;
  const primary = no ? `部屋No.${no}` : '';
  return { primary, supplement:'', text:primary };
}
