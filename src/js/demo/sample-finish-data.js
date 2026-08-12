/**
 * src/js/demo/sample-finish-data.js
 *
 * 仕上表の初期確認データ。
 * 1部屋2入力行を基本とし、表示用部屋No.と内部位置IDを分離する。
 */

export const INITIAL_ROW_COUNT = 2;
export const INTERNAL_PARTS = ['床', '巾木', '壁', '天井', 'その他1', 'その他2'];
export const EXTERNAL_PARTS = ['床・犬走', '外壁', '屋根', '軒裏', 'その他1', 'その他2'];

let uidSeed = 0;
function uid(prefix) {
  uidSeed += 1;
  return `${prefix}-${uidSeed}`;
}

function createFloorRoom(areaCode, floor, roomIndex) {
  const floorPrefix = areaCode === 'B' ? `B${floor}` : String(floor);
  return {
    uid: uid('room'),
    areaCode,
    floor,
    roomIndex,
    roomNo: `${floorPrefix}-${roomIndex}`,
    name: `${floorPrefix}-${roomIndex}`,
    rowCount: INITIAL_ROW_COUNT,
    cells: {}
  };
}

function createFlatRoom(areaCode, index, roomNo, name) {
  return {
    uid: uid('room'),
    areaCode,
    index,
    roomNo,
    name,
    rowCount: INITIAL_ROW_COUNT,
    cells: {}
  };
}

export function createInitialFinishStructure() {
  uidSeed = 0;

  const floors = [
    {
      uid: uid('floor'), areaCode: 'I', floor: 1, label: '1階',
      rooms: [1, 2, 3, 4, 5].map((i) => createFloorRoom('I', 1, i))
    },
    {
      uid: uid('floor'), areaCode: 'I', floor: 2, label: '2階',
      rooms: [1, 2, 3, 4, 5].map((i) => createFloorRoom('I', 2, i))
    }
  ];

  const stairs = [
    createFlatRoom('S', 1, 'S-1', '階段1'),
    createFlatRoom('S', 2, 'S-2', '階段2')
  ];

  const roof = [createFlatRoom('R', 1, 'R-1', '屋上')];

  const externalRooms = ['北面', '南面', '東面', '西面', '中庭'].map((name, i) =>
    createFlatRoom('E', i + 1, name, name)
  );

  return { floors, stairs, roof, externalRooms };
}
