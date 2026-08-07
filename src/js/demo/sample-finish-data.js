/**
 * src/js/demo/sample-finish-data.js
 *
 * このファイルの役割：
 *   仕上表タブの初期表示に使う「公式サンプル案件」の初期部屋構成
 *   （内部：1階5部屋・2階5部屋・階段2・屋上1／外部：北面・南面・東面・西面・中庭）
 *   を組み立てる。本処理（正式な部屋レコード生成）とは分離した、
 *   確認専用の初期データ生成のみを行う。
 *
 * どこから呼ばれるか：
 *   src/js/finish-table/finish-table-state.js の初期化処理から呼ばれる。
 *   部屋・階・入力行の「追加」操作そのものは、ここではなく
 *   finish-table-state.js側の責務（本処理側の状態更新ロジック）とする。
 *
 * 何を取得しているか：
 *   何も取得しない。
 *
 * 何を判定しているか：
 *   何も判定しない。
 *
 * どこへ描画しているか：
 *   このファイル自身は描画を行わない。
 *
 * 保存・外部通信について：
 *   一切行わない。生成するのはブラウザのメモリ上だけに存在する
 *   一時データであり、Firestore等への保存は行わない。
 */

/** 1部屋あたりの初期入力行数。 */
export const INITIAL_ROW_COUNT = 2;

/**
 * 内部（通常階・地下階・階段・屋上）で共通して使う部位リスト。
 * 配列の並び順がそのまま部位番号（1〜6）になる
 * （仕上表IDの「位置」＝部位番号×100＋入力行、の計算に使う）。
 */
export const INTERNAL_PARTS = ['床', '巾木', '壁', '天井', 'その他1', 'その他2'];

/** 外部で使う部位リスト（内部とは別の部位構成）。 */
export const EXTERNAL_PARTS = ['床・犬走', '外壁', '屋根', '軒裏', 'その他1', 'その他2'];

/**
 * 通常階・地下階の1部屋分データを作る。
 *
 * @param {'I'|'B'} areaCode 区分コード（I=内部・通常階、B=地下階）
 * @param {number} floor 階番号（地下階も1,2,...で数える。表示側で「地下◯階」に変換する）
 * @param {number} roomIndex 同じ階の中での部屋番号（1始まり）
 * @returns {object} 部屋データ
 */
function createFloorRoom(areaCode, floor, roomIndex) {
  const roomNo = floor * 100 + roomIndex; // 例：1階1部屋目 → 101
  return {
    areaCode,
    floor,
    roomIndex,
    roomNo,
    name: `${roomNo}号室`,
    rowCount: INITIAL_ROW_COUNT,
    cells: {}
  };
}

/**
 * 階段・屋上・外部で使う「フロアを持たないルーム」1件分データを作る。
 *
 * @param {'S'|'R'|'E'} areaCode 区分コード（S=階段、R=屋上、E=外部）
 * @param {number} index 区分内での連番（1始まり）
 * @param {string} label 画面表示用ラベル（例：階段1、北面）
 * @returns {object} 部屋データ
 */
function createFlatRoom(areaCode, index, label) {
  return {
    areaCode,
    index,
    name: label,
    rowCount: INITIAL_ROW_COUNT,
    cells: {}
  };
}

/**
 * サンプル案件の初期仕上表構成一式を作る。
 * 呼び出すたびに新しいオブジェクトを返す（再読込時の初期化に使うため）。
 *
 * @returns {{
 *   floors: object[],
 *   stairs: object[],
 *   roof: object[],
 *   externalRooms: object[]
 * }}
 */
export function createInitialFinishStructure() {
  const floor1Rooms = [1, 2, 3, 4, 5].map((i) => createFloorRoom('I', 1, i));
  const floor2Rooms = [1, 2, 3, 4, 5].map((i) => createFloorRoom('I', 2, i));

  const floors = [
    { areaCode: 'I', floor: 1, label: '1階', rooms: floor1Rooms },
    { areaCode: 'I', floor: 2, label: '2階', rooms: floor2Rooms }
  ];

  const stairs = [
    createFlatRoom('S', 1, '階段1'),
    createFlatRoom('S', 2, '階段2')
  ];

  const roof = [createFlatRoom('R', 1, '屋上')];

  const externalRooms = ['北面', '南面', '東面', '西面', '中庭'].map((label, i) =>
    createFlatRoom('E', i + 1, label)
  );

  return { floors, stairs, roof, externalRooms };
}
