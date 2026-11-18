/**
 * 11C のNode.js回帰テスト。ブラウザ専用SDKは読み込まず、
 * 実際のサンプル定義・建材候補・写真定義・棟ID/初期構造を検証する。
 * ※Firebase通信・サンプル画面での一連の操作は別途ブラウザ実機で確認する。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getConfiguredMaterialCandidates } from '../src/js/store/survey-candidate-store.js';
import { createDefaultFinishRecords } from '../src/js/default/default-finish-data.js';
import { makeBuildingDefinition, nextBuildingId, projectBuildingIds } from '../src/js/projects/project-buildings.js';
import { sampleProject } from '../src/js/demo/sample-project.js';
import { SAMPLE_MATERIALS_SEED } from '../src/js/demo/sample-materials.js';
import { seedInitialPhotoRecords } from '../src/js/demo/sample-photos.js';
import * as photoStore from '../src/js/store/photo-record-store.js';

const seedSource = readFileSync(new URL('../src/js/finish-table/finish-table-sample-seed.js', import.meta.url),'utf8');
const match = seedSource.match(/const SAMPLE_PLACEMENTS = (\[[\s\S]*?\]);/);
assert.ok(match,'サンプル配置定義が見つからない');
const placements = JSON.parse(match[1]);

let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}

test('20建材は既定の建材候補を採用し第1種・第2種を区別する',()=>{
  const available=new Set(getConfiguredMaterialCandidates().filter((x)=>x.source==='default').map((x)=>x.part+'|'+x.baseName));
  assert.equal(SAMPLE_MATERIALS_SEED.length,20);
  for(const [part,name] of SAMPLE_MATERIALS_SEED) assert.ok(available.has(part+'|'+name),name);
  assert.ok(SAMPLE_MATERIALS_SEED.some((x)=>x[1]==='けい酸カルシウム板第1種'));
  assert.ok(SAMPLE_MATERIALS_SEED.some((x)=>x[1]==='けい酸カルシウム板第2種'));
  assert.match(seedSource,/resolveCandidateName\(part,name\)\+'A'/);
});

test('20建材すべてに配置があり、使用箇所・採取数が矛盾しない',()=>{
  const byId=new Map();
  for(const [inputId,area,room,part] of placements){
    assert.ok(Number.isInteger(inputId)&&inputId>=1&&inputId<=20);
    assert.ok(['I','E','R'].includes(area));
    assert.ok(/^([12]-[1-5]|E-[1-5]|R-1)$/.test(room),room);
    assert.ok(Number.isInteger(part)&&part>=1&&part<=6);
    byId.set(inputId,(byId.get(inputId)||0)+1);
  }
  for(let index=0;index<SAMPLE_MATERIALS_SEED.length;index++){
    const [part,name,note,required,count]=SAMPLE_MATERIALS_SEED[index];
    assert.ok(byId.has(index+1),name);
    if(required==='採取・分析')assert.ok(count>=1&&count<=3,name);
    else assert.equal(count,0,name);
  }
});

test('配置枠は既定入力行数以内で重複なく割り当てられる',()=>{
  const counters=new Map();
  for(const [,area,room,part] of placements){
    const key=[area,room,part].join('|');
    counters.set(key,(counters.get(key)||0)+1);
  }
  assert.ok([...counters.values()].every((x)=>x<=2));
  assert.match(seedSource,/!occupied\.has\(record\.finishId\)/);
});

test('写真の目視対象が仕上表配置に含まれ、採取対象R001/R002を維持',()=>{
  seedInitialPhotoRecords();
  const photos=photoStore.getAll();
  for(const photo of photos.filter((p)=>p.photoType==='visual')){
    const room = photo.areaCode==='E' ? 'E-'+Number(photo.roomPosition) :
      String(photo.roomPosition)[0]+'-'+Number(String(photo.roomPosition).slice(1));
    assert.ok(placements.some((p)=>p[1]===photo.areaCode&&p[2]===room&&p[3]===photo.partSlot),photo.photoId);
  }
  for(const id of ['R001','R002'])assert.ok(photos.some((p)=>p.photoType==='sampling'&&p.materialId===id),id);
  photoStore.clearAll();
});

test('A棟互換と空のB棟構造を維持する',()=>{
  assert.equal(nextBuildingId(sampleProject),'B');
  const b=makeBuildingDefinition('B');
  assert.equal(b.name,'B棟');
  assert.deepEqual(projectBuildingIds({buildings:{B:b}}),['','B']);
  assert.deepEqual(projectBuildingIds(null),['']);
  const records=createDefaultFinishRecords('B');
  assert.equal(records.length,456);
  assert.ok(records.every((x)=>!x.materialId));
});
console.log('v0.1.9.11C: '+passed+' tests passed');
