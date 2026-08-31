/**
 * finishRecord疎保存の構造復元ルール。
 * Firestoreには入力差分と、追加構造を復元できる最小レコードだけを置く。
 * 画面上の完全な仕上表は、初期構造 + 保存済み位置から毎回ローカル生成する。
 */
import { createDefaultFinishRecords, DEFAULT_FINISH_STRUCTURE } from '../default/default-finish-data.js';
import {
  createFinishRecord,
  computeCellPosition,
  buildFloorRoomPosition,
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  rowFromPosition,
  nextRoomUid
} from '../records/finish-record.js';
import { INITIAL_ROW_COUNT, INTERNAL_PARTS, EXTERNAL_PARTS } from '../finish-table/finish-table-constants.js';

const PART_COUNT = 6;
const ROOMS_PER_ADDED_FLOOR = 10;
const DEFAULT_NORMAL_MAX_FLOOR = Math.max(...DEFAULT_FINISH_STRUCTURE.floors.filter((item) => item.areaCode === 'I').map((item) => Number(item.floor)), 0);
const DEFAULT_STAIRS_COUNT = Number(DEFAULT_FINISH_STRUCTURE.stairsCount || 0);
const DEFAULT_ROOF_COUNT = Number(DEFAULT_FINISH_STRUCTURE.roofCount || 0);
const DEFAULT_EXTERNAL_COUNT = DEFAULT_FINISH_STRUCTURE.externalRoomNos.length;

function pad(value, length) { return String(value).padStart(length, '0'); }

function defaultPartName(areaCode, partIndex) {
  const parts = areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
  const name = parts[partIndex - 1] || '';
  return partIndex >= 5 ? '' : name;
}

function roomDefaults(areaCode, floor, index) {
  if (areaCode === 'I') return { roomNo: `${floor}-${index}`, roomName: '' };
  if (areaCode === 'B') return { roomNo: `B${floor}-${index}`, roomName: '' };
  if (areaCode === 'S') return { roomNo: `S-${index}`, roomName: index <= DEFAULT_STAIRS_COUNT ? '' : `階段${index}` };
  if (areaCode === 'R') return { roomNo: `R-${index}`, roomName: index <= DEFAULT_ROOF_COUNT ? '' : (index === 1 ? '屋上' : `屋上${index}`) };
  if (areaCode === 'E') {
    return {
      roomNo: DEFAULT_FINISH_STRUCTURE.externalRoomNos[index - 1] || `面${index}`,
      roomName: ''
    };
  }
  return { roomNo: '', roomName: '' };
}

function roomPositionFor(areaCode, floor, index) {
  return areaCode === 'I' || areaCode === 'B'
    ? buildFloorRoomPosition(floor, index)
    : pad(index, 3);
}

function addRoomToMap(map, { areaCode, floor = null, index, rowCount = INITIAL_ROW_COUNT }) {
  const roomPosition = roomPositionFor(areaCode, floor, index);
  const existing = [...map.values()].find((record) => record.areaCode === areaCode && String(record.roomPosition) === roomPosition);
  const roomUid = existing?.roomUid || nextRoomUid();
  const defaults = roomDefaults(areaCode, floor, index);
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    for (let row = 1; row <= rowCount; row += 1) {
      const position = computeCellPosition(partIndex, row);
      const finishId = `${areaCode}-${roomPosition}-${position}`;
      if (map.has(finishId)) continue;
      map.set(finishId, createFinishRecord({
        areaCode,
        roomPosition,
        floor,
        roomNo: defaults.roomNo,
        roomName: defaults.roomName,
        position,
        part: defaultPartName(areaCode, partIndex),
        roomUid
      }));
    }
  }
}

function roomDescriptor(record) {
  const areaCode = String(record?.areaCode || '');
  const roomPosition = String(record?.roomPosition || '');
  const floor = record?.floor == null || record.floor === '' ? null : Number(record.floor);
  const index = areaCode === 'I' || areaCode === 'B'
    ? roomIndexFromRoomPosition(roomPosition)
    : Number(roomPosition);
  return { areaCode, roomPosition, floor, index };
}

function roomKey(record) {
  return `${String(record?.areaCode || '')}|${String(record?.roomPosition || '')}`;
}

function ensureStructureFromSparse(map, sparseRecords) {
  const roomNeeds = new Map();
  sparseRecords.forEach((record) => {
    const info = roomDescriptor(record);
    if (!info.areaCode || !Number.isFinite(info.index) || info.index <= 0) return;
    const key = roomKey(record);
    const current = roomNeeds.get(key) || { ...info, maxRow: INITIAL_ROW_COUNT };
    current.maxRow = Math.max(current.maxRow, rowFromPosition(record.position));
    roomNeeds.set(key, current);
  });

  const maxIFloor = Math.max(DEFAULT_NORMAL_MAX_FLOOR, ...[...roomNeeds.values()].filter((item) => item.areaCode === 'I').map((item) => Number(item.floor) || 0));
  for (let floor = 1; floor <= maxIFloor; floor += 1) {
    const inFloor = [...roomNeeds.values()].filter((item) => item.areaCode === 'I' && Number(item.floor) === floor);
    const maxRoom = Math.max(ROOMS_PER_ADDED_FLOOR, ...inFloor.map((item) => item.index));
    for (let index = 1; index <= maxRoom; index += 1) addRoomToMap(map, { areaCode: 'I', floor, index });
  }

  const maxBFloor = Math.max(0, ...[...roomNeeds.values()].filter((item) => item.areaCode === 'B').map((item) => Number(item.floor) || 0));
  for (let floor = 1; floor <= maxBFloor; floor += 1) {
    const inFloor = [...roomNeeds.values()].filter((item) => item.areaCode === 'B' && Number(item.floor) === floor);
    const maxRoom = Math.max(ROOMS_PER_ADDED_FLOOR, ...inFloor.map((item) => item.index));
    for (let index = 1; index <= maxRoom; index += 1) addRoomToMap(map, { areaCode: 'B', floor, index });
  }

  for (const [areaCode, defaultCount] of [['S', DEFAULT_STAIRS_COUNT], ['R', DEFAULT_ROOF_COUNT], ['E', DEFAULT_EXTERNAL_COUNT]]) {
    const maxIndex = Math.max(defaultCount, ...[...roomNeeds.values()].filter((item) => item.areaCode === areaCode).map((item) => item.index));
    for (let index = 1; index <= maxIndex; index += 1) addRoomToMap(map, { areaCode, index });
  }

  // ＋行は部屋全体の6部位へ同じ行番号を追加するため、保存済み603等から部屋全体を補完する。
  roomNeeds.forEach((item) => {
    if (item.maxRow <= INITIAL_ROW_COUNT) return;
    addRoomToMap(map, { areaCode: item.areaCode, floor: item.floor, index: item.index, rowCount: item.maxRow });
  });
}

function carrierForRoom(records) {
  // 部屋No. / 部屋名は標準末尾602だけを正として扱う。
  // 603以降は＋行の存在を示す構造レコードなので、部屋共通情報を上書きさせない。
  const standardCarrierPosition = computeCellPosition(PART_COUNT, INITIAL_ROW_COUNT);
  return records.find((record) => Number(record.position) === standardCarrierPosition) || null;
}

/** Firestoreの疎finishRecordから、画面用の完全なfinishRecord集合を復元する。 */
export function restoreFinishRecordsFromSparse(rawSparseRecords = []) {
  const sparse = rawSparseRecords.filter((record) => record && (record.finishId || record.id)).map((record) => ({ ...record, finishId: String(record.finishId || record.id) }));
  const map = new Map(createDefaultFinishRecords().map((record) => [record.finishId, record]));
  ensureStructureFromSparse(map, sparse);

  // 入力枠固有の内容差分を先に上書きする。
  sparse.forEach((raw) => {
    const base = map.get(raw.finishId);
    map.set(raw.finishId, base ? { ...base, ...raw, finishId: raw.finishId, roomUid: base.roomUid } : { ...raw, finishId: raw.finishId });
  });

  // roomNo / roomName は部屋共通情報。6番目部位の最終行を優先して部屋全体へ展開する。
  const sparseByRoom = new Map();
  sparse.forEach((record) => {
    const key = roomKey(record);
    if (!sparseByRoom.has(key)) sparseByRoom.set(key, []);
    sparseByRoom.get(key).push(record);
  });
  sparseByRoom.forEach((records, key) => {
    const carrier = carrierForRoom(records);
    if (!carrier) return;
    map.forEach((record, finishId) => {
      if (roomKey(record) !== key) return;
      map.set(finishId, {
        ...record,
        roomNo: String(carrier.roomNo ?? record.roomNo ?? ''),
        roomName: String(carrier.roomName ?? record.roomName ?? '')
      });
    });
  });

  return [...map.values()].sort((a, b) => String(a.finishId).localeCompare(String(b.finishId), 'ja', { numeric: true }));
}

/** 現在の画面構造から、空欄でもFirestoreに残す必要がある構造保持レコードIDを算出する。 */
export function getRequiredStructureRecordIds(records = []) {
  const active = records.filter((record) => record?.status === 'active');
  const ids = new Set();
  const rooms = new Map();
  active.forEach((record) => {
    const key = roomKey(record);
    if (!rooms.has(key)) rooms.set(key, []);
    rooms.get(key).push(record);
  });

  const maxFloor = (areaCode) => Math.max(0, ...active.filter((record) => record.areaCode === areaCode).map((record) => Number(record.floor) || 0));
  const maxI = maxFloor('I');
  const maxB = maxFloor('B');

  function roomMarker(roomRecords) {
    const standardCarrierPosition = computeCellPosition(PART_COUNT, INITIAL_ROW_COUNT);
    return roomRecords.find((record) => Number(record.position) === standardCarrierPosition) || null;
  }

  rooms.forEach((roomRecords) => {
    const anchor = roomRecords[0];
    const info = roomDescriptor(anchor);
    const maxRow = Math.max(...roomRecords.map((record) => rowFromPosition(record.position)), INITIAL_ROW_COUNT);
    if (maxRow > INITIAL_ROW_COUNT) {
      const rowMarker = roomRecords.find((record) => Number(record.position) === computeCellPosition(PART_COUNT, maxRow));
      if (rowMarker) ids.add(rowMarker.finishId);
    }

    if (info.areaCode === 'I' || info.areaCode === 'B') {
      const floorRooms = active.filter((record) => record.areaCode === info.areaCode && Number(record.floor) === Number(info.floor));
      const maxRoom = Math.max(...floorRooms.map((record) => roomIndexFromRoomPosition(record.roomPosition)), 0);
      const defaultFloor = info.areaCode === 'I' && Number(info.floor) <= DEFAULT_NORMAL_MAX_FLOOR;
      const isAddedFloorTip = !defaultFloor && Number(info.floor) === (info.areaCode === 'I' ? maxI : maxB) && info.index === maxRoom;
      const isAddedRoomTip = maxRoom > ROOMS_PER_ADDED_FLOOR && info.index === maxRoom;
      if (isAddedFloorTip || isAddedRoomTip) {
        const marker = roomMarker(roomRecords);
        if (marker) ids.add(marker.finishId);
      }
      return;
    }

    const defaultCount = info.areaCode === 'S' ? DEFAULT_STAIRS_COUNT : info.areaCode === 'R' ? DEFAULT_ROOF_COUNT : DEFAULT_EXTERNAL_COUNT;
    const maxIndex = Math.max(...active.filter((record) => record.areaCode === info.areaCode).map((record) => Number(record.roomPosition) || 0), 0);
    if (maxIndex > defaultCount && info.index === maxIndex) {
      const marker = roomMarker(roomRecords);
      if (marker) ids.add(marker.finishId);
    }
  });

  return ids;
}

export function defaultPartForRecord(record) {
  return defaultPartName(record?.areaCode, partIndexFromPosition(record?.position));
}

export function defaultRoomFieldsForRecord(record) {
  const info = roomDescriptor(record);
  return roomDefaults(info.areaCode, info.floor, info.index);
}
