/**
 * src/js/records/finish-record.js
 *
 * 仕上表レコードの純粋な定義モジュール。
 *
 * 正式仕様：
 * - 1入力枠 = 1 finishRecord
 * - 未入力の入力枠も active レコードとして実在する
 * - finishId は「区分コード-部屋位置-位置」で、現在位置を表す可変ID
 * - 部屋構成は finishRecord の集合から復元する（独立した部屋レコードは作らない）
 *
 * roomUid はUIが同一部屋を追跡するための内部補助ID。業務上の仕上表IDとは別物で、
 * 部屋挿入によって finishId / roomPosition が変わっても同じ部屋を追跡するためだけに使う。
 */

/** @typedef {'I'|'E'|'S'|'R'|'B'} FinishAreaCode */

/**
 * @typedef {object} FinishRecord
 * @property {string} finishId
 * @property {FinishAreaCode} areaCode
 * @property {string} roomPosition
 * @property {number|string|null} floor
 * @property {string} roomNo
 * @property {string} roomName
 * @property {number} position
 * @property {string} part
 * @property {string} materialId
 * @property {string} inputId
 * @property {'active'|'deleted'} status
 * @property {string} systemMemo
 * @property {string} updatedDevice
 * @property {string} updatedAt
 * @property {string} roomUid 内部補助ID
 */

export const PART_POSITION = Object.freeze({
  floor: 1,
  baseboard: 2,
  wall: 3,
  ceiling: 4,
  other1: 5,
  other2: 6
});

export const PART_KEYS = Object.freeze(['floor', 'baseboard', 'wall', 'ceiling', 'other1', 'other2']);

let roomUidSeed = 0;
export function nextRoomUid() {
  roomUidSeed += 1;
  return `room-${roomUidSeed}`;
}

function pad(value, length) {
  return String(value).padStart(length, '0');
}

export function computeFinishId(areaCode, roomPosition, position) {
  return `${areaCode}-${roomPosition}-${position}`;
}

export function buildFloorRoomPosition(floor, indexInFloor) {
  return `${floor}${pad(indexInFloor, 2)}`;
}

export function roomIndexFromRoomPosition(roomPosition) {
  return Number(String(roomPosition).slice(-2));
}

export function computeCellPosition(partPosition, row) {
  return partPosition * 100 + row;
}

export function partIndexFromPosition(position) {
  return Math.floor(Number(position) / 100);
}

export function rowFromPosition(position) {
  return Number(position) % 100;
}

export function createFinishRecord(fields) {
  const areaCode = fields.areaCode;
  const roomPosition = String(fields.roomPosition);
  const position = Number(fields.position);
  return {
    finishId: fields.finishId || computeFinishId(areaCode, roomPosition, position),
    areaCode,
    roomPosition,
    floor: fields.floor ?? null,
    roomNo: String(fields.roomNo ?? ''),
    roomName: String(fields.roomName ?? ''),
    position,
    part: String(fields.part ?? ''),
    materialId: String(fields.materialId ?? ''),
    inputId: String(fields.inputId ?? ''),
    status: fields.status || 'active',
    systemMemo: String(fields.systemMemo ?? ''),
    updatedDevice: fields.updatedDevice || 'local',
    updatedAt: fields.updatedAt || new Date().toISOString(),
    roomUid: fields.roomUid || nextRoomUid()
  };
}
