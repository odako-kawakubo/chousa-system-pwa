import assert from 'node:assert/strict';
import { groupPartRowsByFloor, groupPartRowsByBuilding } from '../src/js/output/output-building-groups.js';

const label = id => id === 'B' ? '別館' : '本館';
const rows = [
  { buildingId:'',areaCode:'I',floor:'1階',partIndex:1,part:'床',materialId:'a',materialNo:1,materialName:'床材',roomNo:'1-1' },
  { buildingId:'',areaCode:'I',floor:'1階',partIndex:5,part:'配管',materialId:'b',materialNo:2,materialName:'保温材',roomNo:'1-1' },
  { buildingId:'',areaCode:'I',floor:'1階',partIndex:5,part:'',materialId:'c',materialNo:3,materialName:'その他の建材',roomNo:'1-2' },
  { buildingId:'',areaCode:'I',floor:'1階',partIndex:6,part:'梁',materialId:'d',materialNo:4,materialName:'耐火材',roomNo:'1-3' },
  { buildingId:'B',areaCode:'I',floor:'1階',partIndex:5,part:'庇',materialId:'e',materialNo:5,materialName:'仕上材',roomNo:'1-1' }
];
const floors = groupPartRowsByFloor(rows, label);
const partsA = floors.find(group => group.buildingId === '').rows;
assert.deepEqual(partsA.map(row => row.part), ['床','その他','配管','梁']);
assert.deepEqual(partsA.map(row => row.partOrder), [0,4,4,4]);
assert.equal(partsA.find(row => row.materialNo === 2).part, '配管');
assert.equal(partsA.find(row => row.materialNo === 3).part, 'その他');
assert.equal(floors.find(group => group.buildingId === 'B').rows[0].part,'庇');

const buildings = groupPartRowsByBuilding(floors);
assert.deepEqual(buildings.find(group => group.buildingId === '').rows.map(row => row.part), ['床','その他','配管','梁']);
assert.equal(buildings.find(group => group.buildingId === 'B').rows[0].part, '庇');

const crossFloor = groupPartRowsByBuilding(groupPartRowsByFloor([
  { ...rows[1], floor:'1階', roomNo:'1-1' },
  { ...rows[1], floor:'2階', roomNo:'2-1' },
  { ...rows[1], floor:'2階', roomNo:'2-2' }
], label));
assert.equal(crossFloor[0].rows.length, 2);
assert.equal(crossFloor[0].rows[1].location, '2-1、2-2');

console.log('11L custom other-part names in floor/building lists: PASS');
