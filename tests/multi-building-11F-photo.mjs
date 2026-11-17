/**
 * v0.1.9.11F: 写真の複数棟ID互換・所属・表示導線の回帰検証。
 * iPad実機とFirebase / OneDriveの実接続確認は別段階。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPhotoRecord, getVisualPhotoRoomKey, getVisualPhotoTargetKey,
  getPhotoRepresentativeGroupKey
} from '../src/js/records/photo-record.js';
import { classifyOrphanPhotos } from '../src/js/photos/photo-orphan-classifier.js';
import * as photoRecordStore from '../src/js/store/photo-record-store.js';
import { mergeRecordByFieldEditedAt, RECORD_MERGE_FIELDS } from '../src/js/sync/record-field-merge.js';

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
  const interactions=read('src/js/photos/photo-interactions.js');
  assert.match(interactions,/event\.target\.matches\('\[data-photo-building-select\]'\)/);
  assert.doesNotMatch(controller,/root\.addEventListener\('change'/);
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
test('棟IDの表記ゆれは写真レコードと検索キーで同一視',()=>{
  assert.equal(visual('test-a','a').buildingId,'');
  assert.equal(visual('test-b','b').buildingId,'B');
  assert.equal(getVisualPhotoTargetKey({ ...b, buildingId:'b' }),getVisualPhotoTargetKey(b));
});
test('同じ部屋・部位でもA棟とB棟の写真検索結果を分離',()=>{
  photoRecordStore.replaceAll([a,b],{notify:false});
  try {
    const criteria={areaCode:'I',roomPosition:'101',partSlot:3};
    assert.deepEqual(photoRecordStore.findVisual(criteria).map(p=>p.photoId),['A']);
    assert.deepEqual(photoRecordStore.findVisual({...criteria,buildingId:'B'}).map(p=>p.photoId),['B']);
  } finally { photoRecordStore.clearAll(); }
});
test('同期マージは棟変更を編集確定時刻に基づき判定',()=>{
  assert.ok(RECORD_MERGE_FIELDS.photo.includes('buildingId'));
  const local={...a,buildingId:'',fieldEditedAt:{buildingId:100}};
  const incoming={...a,buildingId:'B',fieldEditedAt:{buildingId:200}};
  assert.equal(mergeRecordByFieldEditedAt('photo',local,incoming).record.buildingId,'B');
  assert.equal(mergeRecordByFieldEditedAt('photo',incoming,local).record.buildingId,'B');
});
test('部屋情報の写真看板再生成は棟別共通部屋IDで対象を限定',()=>{
  const regen=read('src/js/photos/room-photo-regeneration.js');
  assert.match(regen,/roomLocationKey\(photo\) === room\.key/);
});
test('棟切替は共通イベント管理に統合し仕上表の配色を再利用',()=>{
  const css=read('src/css/finish-table.css');
  const photoCss=read('src/css/photos.css');
  const renderer=read('src/js/photos/photo-renderer.js');
  for(const id of ['B','C','D','E','F','G','H','I','J']){
    assert.ok(css.includes(`:is(.finish-table, .photo-target-list)[data-building-id="${id}"]`));
  }
  assert.match(photoCss,/justify-content:space-between/);
  assert.match(photoCss,/var\(--finish-building-header-bg/);
  assert.match(renderer,/data-building-id="/);
});
test('目視の撮影対象と取込先がいずれも棟IDを引き継ぐ',()=>{
  const controller=read('src/js/photos/photo-controller.js');
  const camera=read('src/js/camera/camera-state.js');
  const actions=read('src/js/photos/photo-record-actions.js');
  assert.match(controller,/function externalImportContext\([\s\S]*?buildingId: view\.activeRoom\.buildingId/);
  assert.match(controller,/function buildCameraOptions\([\s\S]*?buildingId: room\.buildingId/);
  assert.match(camera,/function createCaptureSnapshot\([\s\S]*?buildingId: room\.buildingId/);
  assert.match(actions,/buildingId: context\.buildingId/);
});
test('外部取込IDは同一ミリ秒でも重複せず従来のI-接頭辞を維持',()=>{
  const actions=read('src/js/photos/photo-record-actions.js');
  assert.match(actions,/lastImportPhotoTimestamp = Math\.max\(Date\.now\(\), lastImportPhotoTimestamp \+ 1\)/);
  assert.match(actions,/return `I-\$\{getDeviceCode\(\)\}-\$\{lastImportPhotoTimestamp\}`/);
});
test('撮影・外部取込は同じ後追いメタデータ同期処理を使う',()=>{
  const actions=read('src/js/photos/photo-record-actions.js');
  assert.match(actions,/storedRecords\.push\(stored\);\s*queuePhotoMetadataPersistence\(stored, 'photo-import-save'\)/);
  assert.match(actions,/queuePhotoMetadataPersistence\(stored, 'photo-camera-save'\)/);
  assert.doesNotMatch(actions,/await persistPhoto\(stored, 'photo-import-save'\)/);
});
test('看板編集・再生成は同じローカル一括確定経路へ集約',()=>{
  const editor=read('src/js/photos/photo-board-editor-persistence.js');
  const shared=read('src/js/photos/photo-completed-update.js');
  const local=read('src/js/photos/photo-local-store.js');
  assert.match(editor,/await persistCompletedPhotoUpdate\(/);
  assert.match(shared,/await saveEditedPhotoLocally\(/);
  assert.match(local,/db\.transaction\(\[BLOB_STORE, RECORD_STORE\], 'readwrite'\)/);
  assert.match(shared,/photoRecordStore\.planSet\(/);
  assert.match(shared,/notifyEditedPhotoSaved\(\)/);
  assert.doesNotMatch(editor,/await persistPhotoForProject\(/);
  assert.match(editor,/before\.buildingId \|\| 'A'/);
});
test('看板編集は複数棟の場合だけA棟にも識別名を表示',()=>{
  const source=read('src/js/photos/photo-board-editor-form.js');
  assert.match(source,/multipleBuildings \? `\$\{room\.buildingId \|\| 'A'\}：` : ''/);
});
test('写真比較の部屋表示は仕上表の共通部屋情報を使用',()=>{
  const source=read('src/js/photos/photo-compare-data.js');
  assert.match(source,/findRoomByLocationKey\(key\) \|\| record/);
});
test('代表写真の移動予定をStoreへ適用せず安全に計算する',()=>{
  const photos=[visual('old-A',''),visual('remain-A',''),visual('old-B','B')];
  photoRecordStore.replaceAll(photos,{notify:false});
  try {
    const before=photoRecordStore.getAll().map((p)=>[p.photoId,p.isRepresentative]);
    const planned=photoRecordStore.planSet({...photoRecordStore.get('old-A'),buildingId:'B'});
    assert.deepEqual(photoRecordStore.getAll().map((p)=>[p.photoId,p.isRepresentative]),before);
    assert.equal(planned.record.buildingId,'B');
    assert.equal(planned.changed.find((p)=>p.photoId==='remain-A').isRepresentative,true);
    assert.equal(planned.changed.find((p)=>p.photoId==='old-B').isRepresentative,false);
  } finally { photoRecordStore.clearAll(); }
});
test('目視写真名はA棟互換・B棟識別・採取既存形式',()=>{
  const filename=read('src/js/photos/photo-filename.js');
  assert.match(filename,/buildingId && buildingId !== 'A'/);
  assert.match(filename,/\$\{buildingId\}棟_/);
  assert.match(filename,/fields\.photoType === PHOTO_TYPES\.SAMPLING/);
});
test('撮影・編集・自動再生成の看板で棟と外部表示を共用',()=>{
  const board=read('src/js/camera/camera-board.js');
  const capture=read('src/js/camera/camera-capture.js');
  const editor=read('src/js/photos/photo-board-editor.js');
  const regen=read('src/js/photos/room-photo-regeneration.js');
  assert.match(board,/buildingPrefix/);
  assert.match(board,/data\.areaCode === 'E'/);
  assert.match(capture,/buildingId: room\.buildingId/);
  assert.match(capture,/showBuildingName:/);
  assert.match(editor,/buildingId: entry\.record\.photoType === PHOTO_TYPES\.VISUAL/);
  assert.match(regen,/showBuildingName: projectBuildingIds\(getCurrentProject\(\)\)\.length > 1/);
});
test('Firestore通信はローカル保存済み写真を巻き戻さない',()=>{
  const shared=read('src/js/photos/photo-completed-update.js');
  const locallySaved=shared.indexOf('await saveEditedPhotoLocally(');
  const queued=shared.lastIndexOf('queueMetadata(project');
  assert.ok(locallySaved >= 0 && queued > locallySaved);
  assert.match(shared,/void persistPhotoForProject\(/);
});
console.log('v0.1.9.11F: '+passed+' tests passed');
