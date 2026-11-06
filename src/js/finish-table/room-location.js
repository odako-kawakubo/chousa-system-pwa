/**
 * 部屋共通IDの参照と表示。部屋の共通情報はfinishRecordの末尾602を優先する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import { roomIdFor, normalizeRoomId } from '../records/room-id.js';

export { normalizeRoomId as normalizeRoomLocationKey };

export function roomLocationKey(record = {}) {
  return roomIdFor(record.areaCode, record.roomPosition);
}

export function findRoomByLocationKey(key) {
  const id = normalizeRoomId(key);
  if (!id) return null;
  const carrier = finishRecordStore.get(`${id}-602`);
  if (carrier?.status === 'active' && roomLocationKey(carrier) === id) return carrier;
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && roomLocationKey(record) === id
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

/**
 * 建材リストと写真タブで共用する部屋の入力欄ラベル。
 * 外部は部屋名／部屋No.ではなく場所名として扱う。
 */
export function roomLocationFieldLabel(room = {}, { preferRoomName = false } = {}) {
  if (room.areaCode === 'E') return '外部';
  return preferRoomName && String(room.roomName || '').trim() ? '部屋名' : '部屋No.';
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
  if (room.areaCode === 'E') {
    const location = roomName || roomNo || fallback;
    const primary = location ? `外部 ${location}` : '外部';
    return { primary, supplement:'', text:primary };
  }
  if (preferRoomName && roomName) {
    const supplement = roomNo ? `（部屋No.${roomNo}）` : '';
    return { primary:roomName, supplement, text:roomName + supplement };
  }
  const no = roomNo || fallback;
  const primary = no ? `部屋No.${no}` : '';
  return { primary, supplement:'', text:primary };
}

/**
 * 採取看板の表示場所は部屋IDから解決し、部屋名表示モードとは独立させる。
 * 旧形式のIDが表示キャッシュに残っていても、そのID自体を描画しない。
 * 参照不明のIDは別の部屋へ推測で紐付けず、空表示にする。
 */
export function resolveSamplingBoardPlace(location = '', roomKey = '') {
  const raw = String(location || '').trim();
  const key = normalizeRoomId(roomKey) || normalizeRoomId(raw);
  if (!key) return { display:raw, areaCode:'', roomKey:'' };
  const room = resolveRoomLocation(key, { preferRoomName:false, context:'photo' });
  return { display:room?.display || '', areaCode:room?.areaCode || '', roomKey:key };
}
