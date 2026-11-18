/**
 * 11G の棟追加・名称変更を実際のService/Store/未送信キューで検証する。
 * Firebase adapterのみ擬似化し、本番接続を行わない。
 * 実行: node tests/multi-building-11G-service.mjs
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Firestore SDKの代わりに永続化アダプターのみ置換。
// 棟追加の業務処理、Project Store、Finish Store、未送信キューは本物を使う。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../sync/project-record-persistence.js'
      && context.parentURL?.endsWith('/projects/project-building-service.js')) {
      return {
        url: 'data:text/javascript,export async function persistProjectMetadataForProject(project,options){return globalThis.__buildingTestPersist(project,options)}',
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

const disk = new Map();
globalThis.localStorage = {
  getItem(key) { return disk.get(key) ?? null; },
  setItem(key, value) { disk.set(key, String(value)); },
  removeItem(key) { disk.delete(key); }
};

let persistCalls = [];
globalThis.__buildingTestPersist = async (project, options) => {
  persistCalls.push({ projectId: project.projectId, patch: options.patch });
  return { ok: false, queued: true, reason: 'manual-offline' };
};

const projects = await import('../src/js/projects/project-store.js');
const finishes = await import('../src/js/store/finish-record-store.js');
const { listUnsent, removeUnsent } = await import('../src/js/sync/unsent-queue.js');
const { addBuildingForCurrentProject, renameBuildingForCurrentProject,
  ensureDeclaredBuildingFinishRecords } = await import('../src/js/projects/project-building-service.js');

let passed = 0;
async function test(title, callback) {
  await callback();
  passed += 1;
  console.log('PASS', title);
}

const project = {
  projectId: '11G-integration-offline',
  projectNo: '11G-test',
  projectName: '11Gオフライン保存確認',
  environment: 'test',
  buildings: { A: { name: '本館', order: 1 } }
};
projects.saveProjectSnapshot({ project, source:'11G-test-init' });
projects.setCurrentProject(project);

await test('通常案件をオフラインでB棟追加するとStore・未送信・空仕上表へ反映', async () => {
  const result = await addBuildingForCurrentProject('別館');
  assert.equal(result.ok, true);
  assert.equal(result.buildingId, 'B');
  assert.equal(result.queued, true);
  assert.equal(projects.getCurrentProject().buildings.B.name, '別館');
  assert.equal(projects.getProject(project.projectId).project.buildings.B.name, '別館');
  assert.equal(finishes.getAll().filter(r => r.buildingId === 'B').length, 456);
  assert.equal(finishes.getAll().some(r => r.finishId === 'B-I-101-101'), true);
  const queued = listUnsent({projectId:project.projectId});
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].record.buildings.B, {name:'別館',order:2});
  assert.equal(persistCalls.length, 1);
  assert.deepEqual(persistCalls[0].patch, {buildings:{B:{name:'別館',order:2}}});
});

await test('オフラインでC棟連続追加・B棟名称変更しても既存棟が残る', async () => {
  const added = await addBuildingForCurrentProject('管理棟');
  assert.equal(added.buildingId, 'C');
  const renamed = await renameBuildingForCurrentProject('B', '新別館');
  assert.equal(renamed.definition.name, '新別館');
  const buildings = projects.getCurrentProject().buildings;
  assert.equal(buildings.A.name, '本館');
  assert.equal(buildings.B.name, '新別館');
  assert.equal(buildings.C.name, '管理棟');
  assert.equal(finishes.getAll().filter(r=>r.buildingId === 'C').length, 456);
  const queued = listUnsent({projectId:project.projectId});
  assert.equal(queued.length, 1);
  assert.equal(queued[0].record.buildings.B.name, '新別館');
  assert.equal(queued[0].record.buildings.C.name, '管理棟');
  assert.equal(persistCalls.length, 3);
});

await test('端末Snapshotから再起動相当の仕上構造を復元できる', async () => {
  const stored = JSON.parse(disk.get('chousa-local-projects-v0161b'));
  const entry = stored.find(item => item.project?.projectId === project.projectId);
  assert.ok(entry, '端末Snapshotが保存されていない');
  assert.equal(entry.project.buildings.B.name, '新別館');
  assert.equal(entry.project.buildings.C.name, '管理棟');
  finishes.replaceAll(entry.finishRecords, {notify:false});
  const restoredCount=ensureDeclaredBuildingFinishRecords(entry.project,{notify:false});
  assert.ok(restoredCount >= 0);
  const records=finishes.getAll();
  assert.equal(records.filter(r=>r.buildingId === 'B').length, 456);
  assert.equal(records.filter(r=>r.buildingId === 'C').length, 456);
  assert.equal(records.some(r=>r.finishId === 'I-101-101'), false); // 現在のfixtureはB/Cの空構造のみ
  assert.equal(listUnsent({projectId:project.projectId}).length, 1);
});

await test('オフラインキューが書き込めない場合、棟を追加成功扱いにしない', async () => {
  const before = JSON.stringify(projects.getCurrentProject().buildings);
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (key, value) => {
    if (key === 'chousa-firestore-unsent-v0161c') throw new Error('storage full');
    return original(key, value);
  };
  try {
    await assert.rejects(addBuildingForCurrentProject('保存できない棟'),/棟情報の端末保存に失敗/);
    assert.equal(JSON.stringify(projects.getCurrentProject().buildings), before);
  } finally {
    globalThis.localStorage.setItem = original;
  }
});

await test('サンプル案件は端末内だけで棟追加・外部送信しない', async () => {
  const { sampleProject } = await import('../src/js/demo/sample-project.js');
  projects.setCurrentProject(sampleProject);
  const beforeCalls = persistCalls.length;
  const result=await addBuildingForCurrentProject('サンプル別棟');
  assert.equal(result.ok,true);
  assert.equal(result.localOnly,true);
  assert.equal(result.buildingId,'B');
  assert.equal(persistCalls.length,beforeCalls);
  assert.equal(listUnsent({projectId:sampleProject.projectId}).length,0);
});

removeUnsent(project.projectId,'project',project.projectId);
console.log(`v0.1.9.11G service: ${passed} tests passed`);
