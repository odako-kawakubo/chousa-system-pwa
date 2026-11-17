/**
 * v0.1.9.11E: 棟別の建材入力・採取位置表示・コピー解除・ヘッダー色の回帰検査。
 * iPadでの実機操作・Firebase同期の実行検証は別途行う。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roomIdFor } from '../src/js/records/room-id.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const candidate = read('src/js/finish-table/finish-table-candidate-input.js');
const materialController = read('src/js/materials/material-list-controller.js');
const materialRenderer = read('src/js/materials/material-list-renderer.js');
const finishRenderer = read('src/js/finish-table/finish-table-renderer.js');
const finishCss = read('src/css/finish-table.css');
const finishController = read('src/js/finish-table/finish-table-controller.js');
const finishState = read('src/js/finish-table/finish-table-state.js');
let passed = 0;
function test(title, fn) { fn(); passed += 1; console.log('PASS', title); }

function sourceBetween(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'function boundaries must exist: ' + start);
  return text.slice(a, b);
}
const records = [
  {status:'active',areaCode:'I',roomPosition:'101',buildingId:'',position:101,materialId:'A-material'},
  {status:'active',areaCode:'I',roomPosition:'101',buildingId:'B',position:101,materialId:'B-material'},
  {status:'active',areaCode:'I',roomPosition:'101',buildingId:'B',position:501,materialId:'B-other'}
];
const roomLocationKey = (record) => roomIdFor(record.areaCode,record.roomPosition,record.buildingId);
const findRoomByLocationKey = (key) => records.find(record => record.status === 'active' && roomLocationKey(record) === key) || null;
const functions = new Function(
  'finishRecordStore','roomLocationKey','findRoomByLocationKey',
  sourceBetween(candidate,'function roomAnchorForInput(input) {','function candidatePopup() {')
    + '\nreturn {roomAnchorForInput,cellRecordForInput};'
)({getAll:()=>records},roomLocationKey,findRoomByLocationKey);
const input = (roomKey,partIndex,row) => ({dataset:{roomKey,partIndex:String(partIndex),inputRow:String(row)}});

test('通常棟とB棟は同じ部屋番号でも別々のレコードを参照', () => {
  assert.equal(functions.roomAnchorForInput(input('I-101',1,1))?.buildingId, '');
  assert.equal(functions.roomAnchorForInput(input('B-I-101',1,1))?.buildingId, 'B');
  assert.equal(functions.cellRecordForInput(input('I-101',1,1))?.materialId, 'A-material');
  assert.equal(functions.cellRecordForInput(input('B-I-101',1,1))?.materialId, 'B-material');
  assert.equal(functions.cellRecordForInput(input('B-I-101',5,1))?.materialId, 'B-other');
});

test('候補表示・部位候補・登録判定は同じ棟対応の共通検索を使う', () => {
  assert.equal((candidate.match(/cellRecordForInput\(input\)/g)||[]).length,3);
  assert.doesNotMatch(candidate,/roomIdFor\(record\.areaCode,\s*record\.roomPosition\)/);
  assert.match(candidate,/findRoomByLocationKey/);
});

test('採取位置ラベルのみ複数棟時に棟記号を付け、保存・看板ラベルは維持', () => {
  assert.match(materialController, /projectBuildingIds\(project\)\.length > 1/);
  assert.match(materialController,/\$\{option\.buildingId \|\| 'A'\}：\$\{option\.selectDisplay\}/);
  assert.match(materialController,/\:\s*option\.selectDisplay/);
  assert.match(materialRenderer, /candidate\.key \|\| candidate\.value/);
  assert.match(materialRenderer, /candidate\.areaCode === 'E' \? \(candidate\.roomName \|\| candidate\.roomNo\) : \(candidate\.value \|\| candidate\.display\)/);
});

test('コピー解除はコピー元選択だけでなく戻すバックアップも破棄する', () => {
  assert.match(finishController,/finishCopyCancelBtn'\)\?\.addEventListener\('click', cancelRoomCopySource\)/);
  assert.match(finishState,/export function cancelRoomCopySource\(\) \{\s*state\.roomCopy = emptyRoomCopyState\(\);/);
  assert.doesNotMatch(finishState,/clearRoomCopySourceOnly/);
});

test('棟Aは既存色、BからJはライト・ダーク別のヘッダー配色', () => {
  assert.match(finishRenderer,/data-building-id=/);
  assert.match(finishCss,/background: var\(--finish-building-header-bg, var\(--surface-table-head\)\)/);
  assert.doesNotMatch(finishCss,/\.finish-table\[data-building-id="A"\]/);
  for(const id of 'BCDEFGHIJ') {
    // 11Fでは仕上表と写真タブが同じ棟別CSS変数を共有する。
    assert.ok(finishCss.includes(':is(.finish-table, .photo-target-list)[data-building-id="'+id+'"]'));
    assert.ok(finishCss.includes('[data-theme="dark"] :is(.finish-table, .photo-target-list)[data-building-id="'+id+'"]'));
  }
});

console.log('v0.1.9.11E: ' + passed + ' tests passed');
