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
