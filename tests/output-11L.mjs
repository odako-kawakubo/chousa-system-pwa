/** v0.1.9.11L 部位別リスト集計の仕様回帰テスト。
 * 固定部位、その他の自由入力、未入力、棟・階・エリア、建材IDごとの
 * 統合条件を独立に検証する。PDF/Excel実ファイル描画は実機レビュー対象。
 */
import assert from 'node:assert/strict';
import {
  groupPartRowsByFloor,
  groupPartRowsByBuilding
} from '../src/js/output/output-building-groups.js';

const label = id => id === 'B' ? '別館' : '本館';
const makeRow = (overrides={}) => ({
  buildingId:'',areaCode:'I',floor:'1階',partIndex:5,part:'配管',
  materialId:'R007',materialNo:7,materialName:'保温材',
  roomNo:'1-1',roomName:'室A',note:'備考', ...overrides
});
const findPart=(rows,part,materialId='R007') =>
  rows.find(row=>row.part===part&&row.materialId===materialId);

function check(name,fn) {
  fn();
  console.log('PASS',name);
}

check('その他の入力名・空欄・固定部位の表示',()=>{
  const rows=[
    makeRow({partIndex:1,part:'不一致入力',materialId:'床',roomNo:'1-0'}),
    makeRow({partIndex:2,part:'巾木',materialId:'巾木',roomNo:'1-0'}),
    makeRow({partIndex:3,part:'壁',materialId:'壁',roomNo:'1-0'}),
    makeRow({partIndex:4,part:'天井',materialId:'天井',roomNo:'1-0'}),
    makeRow({partIndex:5,part:'配管'}),
    makeRow({partIndex:5,part:'   ',materialId:'R008',roomNo:'1-2'}),
    makeRow({partIndex:6,part:'梁',materialId:'R009',roomNo:'1-3'})
  ];
  const result=groupPartRowsByFloor(rows,label)[0].rows;
  assert.deepEqual(result.slice(0,4).map(row=>row.part),['床','巾木','壁','天井']);
  assert.deepEqual(result.map(row=>row.partOrder),[0,1,2,3,4,4,4]);
  assert.deepEqual(new Set(result.slice(4).map(row=>row.part)),new Set(['配管','その他','梁']));
  assert.equal(findPart(result,'その他','R008').location,'1-2');
  assert.equal(findPart(result,'配管').location,'1-1');
});

check('同じ建材でも部位名が異なれば結合しない',()=>{
  const grouped=groupPartRowsByFloor([
    makeRow({part:'配管',roomNo:'1-1'}),
    makeRow({part:'その他',roomNo:'1-2'}),
    makeRow({part:'梁',roomNo:'1-3'})
  ],label);
  const rows=grouped[0].rows;
  assert.equal(rows.length,3);
  for(const [part,location] of [['配管','1-1'],['その他','1-2'],['梁','1-3']]){
    assert.equal(findPart(rows,part)?.location,location);
  }
});

check('同じ部位名・同じ建材IDなら使用箇所を重複なく結合',()=>{
  const grouped=groupPartRowsByFloor([
    makeRow({roomNo:'1-1'}),
    makeRow({roomNo:'1-2'}),
    makeRow({roomNo:'1-2'})
  ],label);
  assert.equal(grouped[0].rows.length,1);
  assert.equal(grouped[0].rows[0].location,'1-1、1-2');
});

check('部位名が同じでも建材ID・棟・階は混同しない',()=>{
  const grouped=groupPartRowsByFloor([
    makeRow({roomNo:'1-1'}),
    makeRow({materialId:'R099',materialNo:99,roomNo:'1-2'}),
    makeRow({buildingId:'B',roomNo:'1-1'}),
    makeRow({floor:'2階',roomNo:'2-1'})
  ],label);
  assert.deepEqual(grouped.map(g=>[g.buildingId,g.floor,g.rows.length]),[
    ['', '1階',2], ['B','1階',1], ['','2階',1]
  ]);
  const buildings=groupPartRowsByBuilding(grouped);
  assert.equal(buildings.length,2);
  const main=buildings.find(g=>g.buildingId==='');
  const annex=buildings.find(g=>g.buildingId==='B');
  assert.deepEqual(main.rows.map(r=>[r.floor,r.materialId]).sort(),[
    ['1階','R007'],['1階','R099'],['2階','R007']
  ]);
  assert.equal(annex.rows.length,1);
  assert.equal(annex.rows[0].location,'1-1');
});

check('全階まとめでも部位名を維持し、同一階・建材・部位のみ集約',()=>{
  const grouped=groupPartRowsByBuilding(groupPartRowsByFloor([
    makeRow({areaCode:'I',roomNo:'1-1',roomName:'室A'}),
    makeRow({areaCode:'E',roomNo:'-',roomName:'北面'}),
    makeRow({areaCode:'I',roomNo:'1-2',roomName:'室B'}),
    makeRow({areaCode:'I',part:'梁',roomNo:'1-3'}),
    makeRow({areaCode:'I',part:'配管',floor:'2階',roomNo:'2-1'})
  ],label,{preferRoomName:true}));
  const rows=grouped[0].rows;
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.floor==='1階'&&r.part==='配管').location,'室A、室B、北面');
  assert.equal(rows.find(r=>r.floor==='1階'&&r.part==='梁').location,'室A');
  assert.equal(rows.find(r=>r.floor==='2階'&&r.part==='配管').location,'室A');
});

check('入力レコードを変更しない',()=>{
  const records=[makeRow({part:'庇'}),makeRow({part:'',roomNo:'1-2'})];
  const before=structuredClone(records);
  groupPartRowsByBuilding(groupPartRowsByFloor(records,label));
  assert.deepEqual(records,before);
});

console.log('11L named and unnamed other-part grouping contracts: PASS');
