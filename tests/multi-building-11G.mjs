/**
 * v0.1.9.11G: 棟名称・既存ID互換・オフライン棟メタデータキューの回帰確認。
 * 実行: node tests/multi-building-11G.mjs
 * Firestore実通信やiPadテストは含まない。
 */
import assert from 'node:assert/strict';
import { nextBuildingId, makeBuildingDefinition, reportBuildingName } from '../src/js/projects/project-buildings.js';
import { computeFinishId } from '../src/js/records/finish-record.js';
import { restoreFinishRecordsFromSparse } from '../src/js/sync/finish-sparse-structure.js';
import { putUnsent, listUnsent, removeUnsent, removeUnsentIfMatching } from '../src/js/sync/unsent-queue.js';

let passed = 0;
function test(title, callback) {
  callback();
  passed += 1;
  console.log('PASS', title);
}

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key)
};

test('棟名称は登録名を優先し、未設定はA棟/B棟を返す', () => {
  const project = { buildings:{ A:{name:'本館',order:1}, B:{name:'別館',order:2}, C:{name:'',order:3} } };
  assert.equal(reportBuildingName(project), '本館');
  assert.equal(reportBuildingName(project,'A'), '本館');
  assert.equal(reportBuildingName(project,'B'), '別館');
  assert.equal(reportBuildingName(project,'C'), 'C棟');
  assert.equal(reportBuildingName({},''), 'A棟');
  assert.equal(reportBuildingName({},'B'), 'B棟');
});

test('オフライン採番は既存棟の次を選び既存仕上IDを変更しない', () => {
  const project = { buildings:{ A:{name:'本館',order:1}, B:{name:'別館',order:2} } };
  const id = nextBuildingId(project);
  assert.equal(id,'C');
  assert.deepEqual(makeBuildingDefinition(id), {name:'C棟',order:3});
  assert.equal(computeFinishId('I','101',101),'I-101-101');
  assert.equal(computeFinishId('I','101',101,id),'C-I-101-101');
});

test('棟の連続オフライン追加と名称変更は1つの差分キューに保持', () => {
  const base = {projectId:'11G-offline-queue',environment:'test',recordType:'project',recordId:'11G-offline-queue',operation:'set',meta:{partialProjectMetadata:true}};
  putUnsent({ ...base, record:{buildings:{B:makeBuildingDefinition('B','別館')}} });
  putUnsent({ ...base, record:{buildings:{C:makeBuildingDefinition('C','倉庫')}} });
  putUnsent({ ...base, record:{buildings:{B:{name:'新別館'}}} });
  const items = listUnsent({projectId:base.projectId});
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].record.buildings.B, {name:'新別館',order:2});
  assert.deepEqual(items[0].record.buildings.C, {name:'倉庫',order:3});
  assert.equal(items[0].meta.partialProjectMetadata,true);
  removeUnsent(base.projectId,'project',base.recordId);
});

test('棟の空仕上表はFirestoreの仕上レコードが無くても復元', () => {
  const records=restoreFinishRecordsFromSparse([],['B','C']);
  assert.ok(records.some((record)=>record.finishId==='B-I-101-101'));
  assert.ok(records.some((record)=>record.finishId==='C-I-101-101'));
  assert.ok(records.some((record)=>record.finishId==='I-101-101'));
});

test('送信中に棟名を再変更しても古い送信成功で未送信を消さない', () => {
  const base={projectId:'11G-send-race',environment:'test',recordType:'project',recordId:'11G-send-race',operation:'set',meta:{partialProjectMetadata:true}};
  const first=putUnsent({...base,record:{buildings:{B:{name:'別館'}}}});
  putUnsent({...base,record:{buildings:{B:{name:'新別館'}}}});
  assert.equal(removeUnsentIfMatching(first),false);
  assert.equal(listUnsent({projectId:base.projectId})[0].record.buildings.B.name,'新別館');
  const latest=listUnsent({projectId:base.projectId})[0];
  assert.equal(removeUnsentIfMatching(latest),true);
  assert.equal(listUnsent({projectId:base.projectId}).length,0);
});

console.log(`v0.1.9.11G: ${passed} tests passed`);
