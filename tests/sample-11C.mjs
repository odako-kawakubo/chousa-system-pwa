/**
 * 11C サンプル案件の生成・棟操作回帰テスト。
 * 実行: node tests/sample-11C.mjs
 * Firestore実通信・ブラウザ/端末表示は対象外。
 */
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem:(key)=>memory.get(key)??null,
  setItem:(key,value)=>memory.set(key,String(value)),
  removeItem:(key)=>memory.delete(key)
};

const { initializeSampleProjectSnapshot } = await import('../src/js/demo/sample-session.js');
const { sampleProject } = await import('../src/js/demo/sample-project.js');
const projectStore = await import('../src/js/projects/project-store.js');
const finishStore = await import('../src/js/store/finish-record-store.js');
const materialStore = await import('../src/js/store/material-record-store.js');
const photoStore = await import('../src/js/store/photo-record-store.js');
const { getConfiguredMaterialCandidates } = await import('../src/js/store/survey-candidate-store.js');
const { addBuildingForCurrentProject, renameBuildingForCurrentProject } =
  await import('../src/js/projects/project-building-service.js');
const { nextBuildingId, projectBuildingIds } = await import('../src/js/projects/project-buildings.js');
const { listUnsent } = await import('../src/js/sync/unsent-queue.js');

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log('PASS',name);
}
const sample = initializeSampleProjectSnapshot();
assert.ok(sample);
await test('サンプルは20建材を持ち、全名称が既定候補のA枝番',()=>{
  const materials = sample.materialRecords;
  const candidates = new Set(getConfiguredMaterialCandidates().filter((x)=>x.source==='default').map((x)=>x.baseName));
  assert.equal(materials.length,20);
  for(const m of materials) {
    assert.ok(m.name.endsWith('A'),m.name);
    assert.ok(candidates.has(m.name.slice(0,-1)),m.name);
  }
  assert.ok(materials.some((m)=>m.name==='けい酸カルシウム板第1種A'));
  assert.ok(materials.some((m)=>m.name==='けい酸カルシウム板第2種A'));
});
await test('仕上表は空行を含み、写真の目視対象と対応',()=>{
  const records=sample.finishRecords;
  assert.ok(records.length>100);
  assert.equal(new Set(records.map((r)=>r.finishId)).size,records.length);
  const visual=sample.photoRecords.filter((p)=>p.photoType==='visual');
  for(const p of visual) {
    assert.ok(records.some((r)=>r.areaCode===p.areaCode && r.roomPosition===p.roomPosition &&
      Math.floor(r.position/100)===Number(p.partSlot) && Boolean(r.materialId)),p.photoId);
  }
});
await test('採取対象建材の採取場所キーは実在する使用箇所を参照',()=>{
  const records=sample.finishRecords;
  for(const m of sample.materialRecords) {
    if(m.analysisRequired!=='採取・分析') {
      assert.equal(m.sampleCount,0);
      continue;
    }
    assert.ok(m.sampleCount>=1&&m.sampleCount<=3);
    for(let i=1;i<=m.sampleCount;i++) {
      const key=m['sampleRoomKey'+i];
      if(!key)continue;
      assert.ok(records.some((r)=>r.materialId===m.materialId &&
        (r.areaCode+'-'+r.roomPosition===key)),m.name+' '+key);
    }
  }
});
await test('サンプルの棟追加と名称変更は端末メモリのみ',async()=>{
  finishStore.replaceAll(sample.finishRecords);
  materialStore.replaceAll(sample.materialRecords);
  photoStore.replaceAll(sample.photoRecords);
  projectStore.setCurrentProject(sampleProject);
  assert.equal(nextBuildingId(projectStore.getCurrentProject()),'B');
  const result=await addBuildingForCurrentProject();
  assert.equal(result.ok,true);
  assert.equal(result.buildingId,'B');
  assert.equal(result.localOnly,true);
  assert.deepEqual(projectBuildingIds(projectStore.getCurrentProject()),['','B']);
  assert.ok(finishStore.getAll().some((r)=>r.buildingId==='B'));
  const renamed=await renameBuildingForCurrentProject('B','別館');
  assert.equal(renamed.ok,true);
  assert.equal(projectStore.getCurrentProject().buildings.B.name,'別館');
  assert.deepEqual(listUnsent({projectId:sampleProject.projectId}),[]);
  assert.equal(memory.size,0);
});
await test('新しいサンプル初期化はB棟編集を引き継がない',()=>{
  const reset=initializeSampleProjectSnapshot();
  assert.ok(!reset.project.buildings?.B);
  assert.equal(reset.materialRecords.length,20);
  assert.ok(!reset.finishRecords.some((r)=>r.buildingId==='B'));
});
console.log('v0.1.9.11C: '+passed+' tests passed');
