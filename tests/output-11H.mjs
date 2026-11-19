/**
 * 11H表示用の純粋な帳票集約テスト。
 * 実PDF/Excelのレイアウトおよび端末上の印刷はレビューで確認する。
 */
import assert from 'node:assert/strict';
import {
  groupMaterialUsageLocations,
  groupRoomRowsByBuilding,
  groupPartRowsByFloor
} from '../src/js/output/output-building-groups.js';

let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}
const label=id=>({ '':'本館', B:'別館' }[id]||id+'棟');
const fixture=[
  {buildingId:'',areaCode:'I',floorLabel:'1階',floor:'1階',partIndex:1,part:'床',materialId:'R003',materialNo:3,materialName:'床材A',roomNo:'1-1',level:3,analysisResult:'不検出'},
  {buildingId:'',areaCode:'I',floorLabel:'1階',floor:'1階',partIndex:1,part:'床',materialId:'R003',materialNo:3,materialName:'床材A',roomNo:'1-2',level:3,analysisResult:'不検出'},
  {buildingId:'',areaCode:'I',floorLabel:'1階',floor:'1階',partIndex:3,part:'壁',materialId:'R001',materialNo:1,materialName:'壁材A',roomNo:'1-2',level:3,analysisResult:'石綿含有',positive:true},
  {buildingId:'',areaCode:'I',floorLabel:'2階',floor:'2階',partIndex:3,part:'壁',materialId:'R001',materialNo:1,materialName:'壁材A',roomNo:'2-1'},
  {buildingId:'B',areaCode:'I',floorLabel:'1階',floor:'1階',partIndex:1,part:'床',materialId:'R003',materialNo:3,materialName:'床材A',roomNo:'1-1'},
  {buildingId:'B',areaCode:'I',floorLabel:'1階',floor:'1階',partIndex:5,part:'配管',materialId:'R007',materialNo:7,materialName:'配管A',roomNo:'1-2'},
  {buildingId:'B',areaCode:'I',floorLabel:'1階',floor:'1階',partIndex:6,part:'その他',materialId:'R007',materialNo:7,materialName:'配管A',roomNo:'1-3'},
  {buildingId:'B',areaCode:'E',floorLabel:'外部',floor:'外部',partIndex:4,part:'天井',materialId:'R008',materialNo:8,materialName:'庇材A',roomNo:'E-1'}
];

test('建材使用箇所は棟名を1回だけ表示し棟間で区切る',()=>{
  const rooms=[{buildingId:'',rawDisplay:'1-1'},{buildingId:'',rawDisplay:'1-2'},
    {buildingId:'B',rawDisplay:'1-1'},{buildingId:'B',rawDisplay:'1-2'}];
  assert.equal(groupMaterialUsageLocations(rooms,label),'本館：1-1、1-2\n別館：1-1、1-2');
  assert.equal(groupMaterialUsageLocations([{buildingId:'',rawDisplay:'1-1'}],()=>''),'1-1');
  assert.equal(groupMaterialUsageLocations([{buildingId:'B',rawDisplay:'1-1'}],label),'別館：1-1');
});

test('部屋別は同名の階でも棟を別グループにする',()=>{
  const groups=groupRoomRowsByBuilding(fixture,label);
  assert.equal(groups.length,2);
  assert.equal(groups[0].rows.length,4);
  assert.equal(groups[1].rows.length,4);
  assert.equal(groups[0].label,'本館');
  assert.equal(groups[1].label,'別館');
});

test('部位別は棟・階・部位・建材IDで重複を集約する',()=>{
  const groups=groupPartRowsByFloor(fixture,label);
  assert.deepEqual(groups.map(g=>[g.buildingLabel,g.floor]),[
    ['本館','1階'],['本館','2階'],['別館','1階'],['別館','外部']
  ]);
  const first=groups[0].rows;
  assert.deepEqual(first.map(r=>r.part),['床','壁']);
  assert.equal(first[0].location,'1-1、1-2');
  assert.equal(first[0].materialNo,3);
  assert.equal(first[1].positive,true);
  assert.equal(groups[2].rows.find(r=>r.part==='その他').location,'1-2、1-3');
  assert.equal(groups[3].rows[0].part,'天井');
});

test('同じ部位でも建材IDが異なれば別の行に残す',()=>{
  const rows=[fixture[0],{...fixture[0],materialId:'R099',materialNo:99,roomNo:'1-3'}];
  const groups=groupPartRowsByFloor(rows,label);
  assert.equal(groups[0].rows.length,2);
  assert.deepEqual(groups[0].rows.map(row=>row.materialNo),[3,99]);
});

console.log(`v0.1.9.11H: ${passed} tests passed`);
