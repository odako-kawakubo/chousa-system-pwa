/**
 * src/js/default/default-finish-data.js
 *
 * 新規案件で使用する正式な仕上表初期状態。
 * デモ案件とは分離し、「何も編集していない案件」の基準データを生成する。
 */

import {
  createFinishRecord,
  computeCellPosition,
  buildFloorRoomPosition,
  nextRoomUid
} from '../records/finish-record.js';
import {
  INITIAL_ROW_COUNT,
  INTERNAL_PARTS,
  EXTERNAL_PARTS
} from '../finish-table/finish-table-constants.js';

const PART_COUNT = 6;

export const DEFAULT_FINISH_STRUCTURE = Object.freeze({
  floors: Object.freeze([
    Object.freeze({ areaCode: 'I', floor: 1, roomCount: 10 }),
    Object.freeze({ areaCode: 'I', floor: 2, roomCount: 10 }),
    Object.freeze({ areaCode: 'I', floor: 3, roomCount: 10 })
  ]),
  stairsCount: 2,
  roofCount: 2,
  externalRoomNos: Object.freeze(['東面', '西面', '南面', '北面'])
});

function pad(value, length) {
  return String(value).padStart(length, '0');
}

function defaultPartName(areaCode, partIndex) {
  const parts = areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
  const name = parts[partIndex - 1] || '';
  return partIndex >= 5 ? '' : name;
}

function createRoomRecords({ areaCode, roomPosition, floor, roomNo }) {
  const roomUid = nextRoomUid();
  const records = [];

  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    for (let row = 1; row <= INITIAL_ROW_COUNT; row += 1) {
      records.push(createFinishRecord({
        areaCode,
        roomPosition,
        floor,
        roomNo,
        roomName: '',
        position: computeCellPosition(partIndex, row),
        part: defaultPartName(areaCode, partIndex),
        roomUid
      }));
    }
  }

  return records;
}

/** 新規案件用の正式初期finishRecord一式を新しく生成する。 */
export function createDefaultFinishRecords() {
  const records = [];

  DEFAULT_FINISH_STRUCTURE.floors.forEach(({ areaCode, floor, roomCount }) => {
    for (let index = 1; index <= roomCount; index += 1) {
      records.push(...createRoomRecords({
        areaCode,
        floor,
        roomPosition: buildFloorRoomPosition(floor, index),
        roomNo: `${floor}-${index}`
      }));
    }
  });

  for (let index = 1; index <= DEFAULT_FINISH_STRUCTURE.stairsCount; index += 1) {
    records.push(...createRoomRecords({
      areaCode: 'S',
      floor: null,
      roomPosition: pad(index, 3),
      roomNo: `S-${index}`
    }));
  }

  for (let index = 1; index <= DEFAULT_FINISH_STRUCTURE.roofCount; index += 1) {
    records.push(...createRoomRecords({
      areaCode: 'R',
      floor: null,
      roomPosition: pad(index, 3),
      roomNo: `R-${index}`
    }));
  }

  DEFAULT_FINISH_STRUCTURE.externalRoomNos.forEach((roomNo, index) => {
    records.push(...createRoomRecords({
      areaCode: 'E',
      floor: null,
      roomPosition: pad(index + 1, 3),
      roomNo
    }));
  });

  return records;
}
