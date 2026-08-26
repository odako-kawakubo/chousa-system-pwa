/**
 * src/js/demo/sample-finish-data.js
 *
 * 値入りデモ案件の仕上表構成を定義する種データ。
 * デモ表示時の正本はfinishRecordStoreで、seedInitialFinishRecords()が
 * 「1入力枠 = 1finishRecord」として未入力枠を含む全レコードを生成する。
 */

export { INITIAL_ROW_COUNT, INTERNAL_PARTS, EXTERNAL_PARTS } from '../finish-table/finish-table-constants.js';

/**
 * 初期構成の種データ。内部階（floors）・階段・屋上・外部の部屋数／名称だけを
 * 記述する（部屋オブジェクトそのものは持たない）。
 */
export const INITIAL_STRUCTURE_SEED = {
  floors: [
    { areaCode: 'I', floor: 1, roomCount: 5 },
    { areaCode: 'I', floor: 2, roomCount: 5 }
  ],
  stairsCount: 2,
  roofCount: 1,
  externalRoomNames: ['北面', '南面', '東面', '西面', '中庭']
};
