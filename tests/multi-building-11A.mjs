/**
 * v0.1.9.11A 複数棟基盤の回帰テスト。
 * 実行: node tests/multi-building-11A.mjs
 * Firestore実通信・iPad実機は別途検証する。
 */
import assert from 'node:assert/strict';
import { computeFinishId, createFinishRecord } from '../src/js/records/finish-record.js';
import { roomIdFor, normalizeRoomId } from '../src/js/records/room-id.js';
import { createDefaultFinishRecords } from '../src/js/default/default-finish-data.js';
import { restoreFinishRecordsFromSparse, getRequiredStructureRecordIds } from '../src/js/sync/finish-sparse-structure.js';
import { normalizeProjectBuildings, nextBuildingId, projectBuildingIds, makeBuildingDefinition } from '../src/js/projects/project-buildings.js';
import { putUnsent, listUnsent, removeUnsent } from '../src/js/sync/unsent-queue.js';

let passed = 0;
function test(name, run) {
  run();
  console.log('PASS', name);
  passed += 1;
}

test('既存A棟のセルIDと部屋IDを変更しない', () => {
  assert.equal(computeFinishId('I', '101', 101), 'I-101-101');
  assert.equal(computeFinishId('B', '101', 602), 'B-101-602'); // 地下のareaCode
  assert.equal(roomIdFor('I', '101'), 'I-101');
  assert.equal(roomIdFor('E', '001'), 'E-001');
  assert.equal(normalizeRoomId('E|001'), 'E-001');
  assert.equal(normalizeRoomId('A-I-101'), 'I-101');
});

test('B棟・C棟IDは地下階区分と衝突しない', () => {
  assert.equal(computeFinishId('I', '101', 101, 'B'), 'B-I-101-101');
  assert.equal(computeFinishId('B', '101', 101, 'B'), 'B-B-101-101');
  assert.equal(roomIdFor('B', '101', 'B'), 'B-B-101');
  assert.equal(normalizeRoomId('C-E-001'), 'C-E-001');
});

test('棟名称変更と採番は固定IDを保つ', () => {
  const buildings = normalizeProjectBuildings({ A: { name:'本館', order:1 }, B: { name:'別館', order:2 }, C: { name:'管理棟', order:3 } });
  assert.equal(buildings.A.name, '本館');
  assert.equal(buildings.B.name, '別館');
  assert.deepEqual(projectBuildingIds({ buildings }), ['', 'B', 'C']);
  assert.equal(nextBuildingId({ buildings }), 'D');
  assert.equal(makeBuildingDefinition('D', '管理棟').name, '管理棟');
  assert.deepEqual(normalizeProjectBuildings(null), {});
});

test('A棟456セルとB棟456セルのIDが重ならない', () => {
  const a = createDefaultFinishRecords();
  const b = createDefaultFinishRecords('B');
  assert.equal(a.length, 456);
  assert.equal(b.length, a.length);
  assert.equal(a[0].finishId, 'I-101-101');
  assert.equal(b[0].finishId, 'B-I-101-101');
  assert.equal(a[0].buildingId, undefined);
  assert.equal(b[0].buildingId, 'B');
  assert.equal(new Set([...a, ...b].map((x)=>x.finishId)).size, a.length+b.length);
});

test('入力差分なしのB棟・C棟も棟情報から復元される', () => {
  const rebuilt = restoreFinishRecordsFromSparse([], ['B', 'C']);
  assert.equal(rebuilt.length, 456*3);
  assert.ok(rebuilt.some((r)=>r.finishId === 'B-I-101-101'));
  assert.ok(rebuilt.some((r)=>r.finishId === 'C-E-001-101'));
});

test('B棟の追加4階はA棟に混ざらず復元できる', () => {
  const marker = createFinishRecord({buildingId:'B',areaCode:'I',roomPosition:'403',floor:4,roomNo:'4-3',position:602,part:''});
  const records = restoreFinishRecordsFromSparse([marker], ['B']);
  assert.ok(records.some((r)=>r.finishId === 'B-I-403-602'));
  assert.ok(!records.some((r)=>r.finishId === 'I-403-602'));
  assert.ok(getRequiredStructureRecordIds(records).has('B-I-403-602'));
});

test('B棟の追加行603はA棟を変更しない', () => {
  const marker = createFinishRecord({buildingId:'B',areaCode:'I',roomPosition:'101',floor:1,roomNo:'1-1',position:603,part:''});
  const records = restoreFinishRecordsFromSparse([marker], ['B']);
  assert.ok(records.some((r)=>r.finishId === 'B-I-101-603'));
  assert.ok(!records.some((r)=>r.finishId === 'I-101-603'));
  assert.ok(getRequiredStructureRecordIds(records).has('B-I-101-603'));
});

test('旧形式を含む未送信仕上レコードから棟IDを復元する', () => {
  const legacy = {finishId:'B-I-101-101',areaCode:'I',roomPosition:'101',floor:1,roomNo:'1-1',position:101,part:'床'};
  const records = restoreFinishRecordsFromSparse([legacy]);
  assert.equal(records.find((r)=>r.finishId === legacy.finishId)?.buildingId, 'B');
});

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key)
};
const queueBase = { projectId:'11A-test', recordType:'project', recordId:'11A-test', operation:'set', environment:'test' };
test('オフラインの案件情報パッチは項目と看板設定を失わず統合する', () => {
  putUnsent({ ...queueBase, record:{projectName:'案件A',boardSettings:{subjectText:'案件A'}},meta:{partialProjectMetadata:true} });
  putUnsent({ ...queueBase, record:{address:'住所B',boardSettings:{addressText:'住所B'},buildings:{B:{name:'別館'}}},meta:{partialProjectMetadata:true} });
  const queued = listUnsent({projectId:'11A-test'});
  assert.equal(queued.length, 1);
  assert.equal(queued[0].record.projectName, '案件A');
  assert.equal(queued[0].record.address, '住所B');
  assert.equal(queued[0].record.boardSettings.subjectText, '案件A');
  assert.equal(queued[0].record.boardSettings.addressText, '住所B');
  assert.equal(queued[0].record.buildings.B.name, '別館');
  assert.equal(queued[0].meta.partialProjectMetadata, true);
  removeUnsent('11A-test','project','11A-test');
});

test('新規案件の未送信全項目とは後の差分を区別する', () => {
  putUnsent({ ...queueBase, record:{createdAt:'2026-11-11',projectName:'旧名称'},meta:{initializeChangeLog:true,partialProjectMetadata:false} });
  putUnsent({ ...queueBase, record:{projectName:'新名称'},meta:{partialProjectMetadata:true} });
  const queued = listUnsent({projectId:'11A-test'})[0];
  assert.equal(queued.meta.partialProjectMetadata,false);
  assert.equal(queued.meta.subsequentPatch.projectName,'新名称');
  assert.equal(queued.record.projectName,'新名称');
  removeUnsent('11A-test','project','11A-test');
});

console.log(`v0.1.9.11A: ${passed} tests passed`);
