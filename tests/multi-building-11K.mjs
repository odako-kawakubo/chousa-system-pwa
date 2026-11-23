import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roomIdFor } from '../src/js/records/room-id.js';
import { projectBuildingIds, reportBuildingName } from '../src/js/projects/project-buildings.js';

function loadFunctions(path, names, injections = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^export\s+/gm, '');
  const keys = Object.keys(injections);
  return new Function(...keys, source + ';return {' + names.join(',') + '};')(...keys.map(key => injections[key]));
}

const finishes = [
  { finishId:'E-1-101', areaCode:'E',roomPosition:'1',position:101,roomName:'東面',roomNo:'',status:'active',buildingId:'', materialId:'R1' },
  { finishId:'E-2-101', areaCode:'E',roomPosition:'2',position:101,roomName:'西面',roomNo:'',status:'active',buildingId:'', materialId:'R2' },
  { finishId:'I-101-101',areaCode:'I',roomPosition:'101',position:101,roomNo:'1-1',status:'active',buildingId:'', materialId:'R3' },
  { finishId:'B-I-101-101',areaCode:'I',roomPosition:'101',position:101,roomNo:'1-1B',status:'active',buildingId:'B',materialId:'R4' }
];
const photos = [
  { photoType:'visual',photoId:'A',areaCode:'I',roomPosition:'101',buildingId:'',roomNo:'',partSlot:1 },
  { photoType:'visual',photoId:'B',areaCode:'I',roomPosition:'101',buildingId:'B',roomNo:'',partSlot:1 },
  { photoType:'sampling',photoId:'S',materialId:'R4',samplingBranch:1,shootingType:'before' }
];
const materialById = new Map([['R1','東面'],['R2','西面'],['R3','事務室'],['R4','倉庫']]);
const vm = loadFunctions('../src/js/record-view/record-view-view-model.js',
  ['buildFinishRecordView','buildPhotoRecordView'], {
  finishRecordStore:{getAll:()=>finishes},
  materialRecordStore:{getAll:()=>[...materialById].map(([materialId,name])=>({materialId,name}))},
  photoRecordStore:{getAll:()=>photos},
  getShootingTypeLabel:x=>x,
  roomIdFor, projectBuildingIds, reportBuildingName,
  getCurrentProject:()=>({buildings:{B:{name:'別館',order:2}}})
});
const a = vm.buildFinishRecordView('A');
const b = vm.buildFinishRecordView('B');
assert.deepEqual(a.records.map(x=>x.roomId),['E-1','E-2','I-101']);
assert.deepEqual(b.records.map(x=>x.roomId),['B-I-101']);
assert.equal(b.buildings.find(x=>x.id==='B').label,'別館');
assert.equal(vm.buildFinishRecordView('Z').selectedBuilding,'A');
assert.equal(vm.buildPhotoRecordView().records.find(x=>x.photoId==='A').roomNo,'1-1');
assert.equal(vm.buildPhotoRecordView().records.find(x=>x.photoId==='B').roomNo,'1-1B');
assert.equal(vm.buildPhotoRecordView().records.find(x=>x.photoId==='S').buildingId,'');
assert.equal(finishes[0].roomId,undefined);

const pdf=loadFunctions('../src/js/output/output-pdf-renderer.js',
  ['roomGroupKey','groupRanges','paginateRoomGroups']);
const rows=[
  {roomId:'E-1',floor:'外部',roomNo:'-',roomName:'東面'},
  {roomId:'E-1',floor:'外部',roomNo:'-',roomName:'東面'},
  {roomId:'E-2',floor:'外部',roomNo:'-',roomName:'西面'},
  {roomId:'E-3',floor:'外部',roomNo:'-',roomName:'南面'}
];
assert.deepEqual(pdf.groupRanges(rows,pdf.roomGroupKey).map(x=>x.end-x.start),[2,1,1]);
assert.equal(pdf.paginateRoomGroups(rows,[8,8,8,8],24).length,2);
assert.ok(rows.every(x=>x.roomNo==='-'));

const renderer=readFileSync(new URL('../src/js/record-view/record-view-renderer.js',import.meta.url),'utf8');
assert.ok(renderer.includes("['roomId', '部屋ID']"));
assert.ok(!renderer.includes("['roomUid', '内部部屋ID']"));
assert.ok(renderer.includes("['buildingId', '棟ID']"));
console.log('11K: building-aware record views, photo lookup, external PDF grouping PASS');
