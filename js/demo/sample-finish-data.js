/**
 * src/js/demo/sample-finish-data.js
 *
 * 本開発版の初期仕上表構成を定義する種データ。
 * 実際の正本はfinishRecordStoreで、seedInitialFinishRecords()が
 * 「1入力枠 = 1finishRecord」として未入力枠を含む全レコードを生成する。
 */

export const INITIAL_ROW_COUNT = 2;
export const INTERNAL_PARTS = ['床', '巾木', '壁', '天井', 'その他1', 'その他2'];
export const EXTERNAL_PARTS = ['床・犬走', '外壁', '屋根', '軒裏', 'その他1', 'その他2'];

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
