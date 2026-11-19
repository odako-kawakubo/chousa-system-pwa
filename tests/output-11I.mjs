/**
 * 11Iの純粋データテスト。PDFの実レンダリング・タッチUIは実機で別途確認。
 */
import assert from 'node:assert/strict';
import {
  OUTPUT_TABLE_MAX_WIDTH, OUTPUT_TABLE_COLUMNS,
  defaultTableWidths, normalizeTableWidths, tableWidthValues, tableWidthTotal
} from '../src/js/output/output-table-layout.js';
import {groupPartRowsByFloor,groupPartRowsByBuilding} from '../src/js/output/output-building-groups.js';

const sum=list=>list.reduce((a,b)=>a+b,0);
assert.equal(OUTPUT_TABLE_MAX_WIDTH,190);
assert.equal(sum(tableWidthValues('materials',{tableWidths:{materials:defaultTableWidths('materials')}})),190);
assert.equal(sum(tableWidthValues('rooms',{tableWidths:{rooms:defaultTableWidths('rooms')}})),190);
const widths=defaultTableWidths('parts');
assert.equal(tableWidthTotal('parts',widths),179);
assert.equal(tableWidthTotal('parts',widths,{includeFloor:false}),171);
assert.equal(OUTPUT_TABLE_COLUMNS.parts[0][2],12);
assert.equal(OUTPUT_TABLE_COLUMNS.parts[1][2],8);
assert.equal(widths.note,53);
assert.deepEqual(normalizeTableWidths('parts',{...widths,note:100}),widths);
assert.equal(normalizeTableWidths('parts',{...widths,note:54}).note,54);

const rows=[
 {buildingId:'',areaCode:'I',floor:'1階',partIndex:1,materialId:'a',materialNo:1,materialName:'床材',roomNo:'1-1',roomName:'会議室',note:'床備考',level:3,analysisResult:'不検出'},
 {buildingId:'',areaCode:'I',floor:'1階',partIndex:1,materialId:'a',materialNo:1,materialName:'床材',roomNo:'1-2',roomName:'廊下',note:'床備考',level:3,analysisResult:'不検出'},
 {buildingId:'',areaCode:'I',floor:'2階',partIndex:1,materialId:'b',materialNo:2,materialName:'床材B',roomNo:'2-1',roomName:'応接室',note:'床備考B'},
 {buildingId:'',areaCode:'I',floor:'1階',partIndex:3,materialId:'c',materialNo:3,materialName:'壁材',roomNo:'1-1',roomName:'会議室',note:'壁備考'},
 {buildingId:'B',areaCode:'I',floor:'1階',partIndex:1,materialId:'d',materialNo:4,materialName:'別館床',roomNo:'1-1',roomName:'倉庫',note:'別館備考'}
];
const label=id=>id==='B'?'別館':'本館';
const floorGroups=groupPartRowsByFloor(rows,label,{preferRoomName:true});
assert.equal(floorGroups[0].rows[0].location,'会議室、廊下');
assert.equal(floorGroups[0].rows[0].note,'床備考');
const buildings=groupPartRowsByBuilding(floorGroups);
assert.equal(buildings.length,2);
assert.deepEqual(buildings[0].rows.map(row=>[row.part,row.floor,row.materialNo]),[
 ['床','1階',1],['床','2階',2],['壁','1階',3]
]);
assert.equal(buildings[1].rows.length,1);
assert.equal(buildings[1].rows[0].note,'別館備考');
const crossArea=groupPartRowsByFloor([
  {...rows[0],roomNo:'1-3',roomName:'本館室',areaCode:'I'},
  {...rows[0],roomNo:'1-4',roomName:'外側室',areaCode:'E'}
],label,{preferRoomName:true});
const dedup=groupPartRowsByBuilding(crossArea);
assert.equal(dedup[0].rows.length,1);
assert.equal(dedup[0].rows[0].location,'本館室、外側室');
console.log('11I table widths and two-level part grouping: PASS');
