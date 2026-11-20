/**
 * Jレビュー差分: 外部の表示用「部屋No.=-」が
 * 部位別の実際の施工場所を消さないことを検証する。
 */
import assert from 'node:assert/strict';
import { groupPartRowsByFloor } from '../src/js/output/output-building-groups.js';
import { defaultTableWidths, tableWidthTotal } from '../src/js/output/output-table-layout.js';

const external={
  buildingId:'',areaCode:'E',floor:'外部',floorLabel:'外部',
  partIndex:1,materialId:'R001',materialNo:1,materialName:'屋外床材',
  roomNo:'-',roomName:'北面',note:'外部の備考'
};
for(const preferRoomName of [false,true]){
  const groups=groupPartRowsByFloor([external],()=>'本館',{preferRoomName});
  assert.equal(groups.length,1);
  assert.equal(groups[0].rows[0].location,'北面');
  assert.equal(groups[0].rows[0].note,'外部の備考');
}
const partWidths=defaultTableWidths('parts');
const floorWidth=tableWidthTotal('parts',partWidths,{includeFloor:false});
const buildingWidth=tableWidthTotal('parts',partWidths);
assert.equal((210-floorWidth)/2,19.5);
assert.equal((210-buildingWidth)/2,15.5);
console.log('11J external location and centered default widths: PASS');
