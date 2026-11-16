/**
 * v0.1.9.12A: 写真の複数棟ID互換・所属・表示導線の回帰検証。
 * iPad実機とFirebase / OneDriveの実接続確認は別段階。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPhotoRecord, getVisualPhotoRoomKey, getVisualPhotoTargetKey,
  getPhotoRepresentativeGroupKey
} from '../src/js/records/photo-record.js';
import { classifyOrphanPhotos } from '../src/js/photos/photo-orphan-classifier.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}
const visual = (photoId,buildingId,partSlot=3) => createPhotoRecord({
  photoId,photoType:'visual',buildingId,areaCode:'I',roomPosition:'101',roomNo:'1-1',partSlot,part:'壁'
});
const a = visual('A','','3');
const b = visual('B','B',3);
const legacyA=visual('legacy-A',undefined,3);

test('既存A棟のグループキーは新モデルでも不変',()=>{
  assert.equal(getVisualPhotoRoomKey(a),'I|101');
  assert.equal(getVisualPhotoRoomKey({areaCode:'I',roomPosition:'101',buildingId:'A'}),'I|101');
  assert.equal(getVisualPhotoTargetKey(a),'visual|I|101|3');
  assert.equal(getVisualPhotoTargetKey(legacyA),getVisualPhotoTargetKey(a));
});
test('B棟以降は同じ部屋番号・部位でも独立',()=>{
  assert.equal(getVisualPhotoRoomKey(b),'B|I|101');
  assert.equal(getVisualPhotoTargetKey(b),'visual|B|I|101|3');
  assert.notEqual(getPhotoRepresentativeGroupKey(a),getPhotoRepresentativeGroupKey(b));
});
test('その他の実部位の区別も維持',()=>{
  assert.notEqual(getVisualPhotoTargetKey({...b,partSlot:5,part:'梁'}),
    getVisualPhotoTargetKey({...b,partSlot:5,part:'柱'}));
});
test('B棟の写真だけをA棟の部屋へ誤所属させない',()=>{
  const finish=(buildingId)=>({status:'active',buildingId,areaCode:'I',roomPosition:'101',position:301,part:'壁'});
  assert.deepEqual(classifyOrphanPhotos([a,b],[finish('')],[]).map(x=>x.photo.photoId),['B']);
  assert.deepEqual(classifyOrphanPhotos([a,b],[finish('B')],[]).map(x=>x.photo.photoId),['A']);
  assert.equal(classifyOrphanPhotos([a,b],[finish(''),finish('B')],[]).length,0);
});
test('写真レコードをFirestoreへ保存する際にB棟IDを保持',()=>{
  const serializer=read('src/js/firestore/record-serializer.js');
  assert.match(serializer,/record\.photoType === 'visual'[\s\S]*record\.buildingId\s*\?\s*\{ buildingId:/);
});
test('カメラ・写真取込・看板編集の棟ID伝搬が接続されている',()=>{
  const camera=read('src/js/camera/camera-controller.js');
  const state=read('src/js/camera/camera-state.js');
  const actions=read('src/js/photos/photo-record-actions.js');
  const persistence=read('src/js/photos/photo-board-editor-persistence.js');
  const form=read('src/js/photos/photo-board-editor-form.js');
  assert.match(camera,/buildingId: snapshot\.buildingId/);
  assert.match(state,/buildingId: room\.buildingId \|\| ''/);
  assert.match(actions,/buildingId: context\.buildingId/);
  assert.match(persistence,/buildingId: entry\.draft\.buildingId/);
  assert.match(form,/entry\.draft\.buildingId = room\?\.buildingId/);
});
test('写真タブの棟切替と採取場所選択は共通部屋IDを使う',()=>{
  const controller=read('src/js/photos/photo-controller.js');
  const renderer=read('src/js/photos/photo-renderer.js');
  const model=read('src/js/photos/photo-view-model.js');
  assert.match(renderer,/data-photo-building-select/);
  assert.match(controller,/\[data-photo-building-select\]/);
  assert.match(controller,/nextRoomKey: normalizeRoomId/);
  assert.match(model,/\$\{option\.buildingId \|\| 'A'\}：\$\{option\.selectDisplay\}/);
});
test('ビューワ・比較画面で棟IDを参照する',()=>{
  const viewer=read('src/js/photos/photo-viewer-data.js');
  const compare=read('src/js/photos/photo-compare-data.js');
  assert.match(viewer,/String\(item\.buildingId \|\| ''\) === String\(photo\.buildingId \|\| ''\)/);
  assert.match(compare,/buildingId: record\.buildingId \|\| ''/);
  assert.match(compare,/buildingId: photo\.buildingId \|\| ''/);
});
console.log('v0.1.9.12A: '+passed+' tests passed');
