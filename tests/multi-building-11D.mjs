/**
 * v0.1.9.11D: 棟別使用箇所・建材ID共有・右側操作パネルの回帰検査。
 * UIの最終的な幅と操作感はiPhone実機で別途確認する。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProjectBuildings, projectBuildingIds } from '../src/js/projects/project-buildings.js';
import { renderMaterialListRow } from '../src/js/materials/material-list-renderer.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const controller = read('src/js/materials/material-list-controller.js');
const usage = read('src/js/finish-table/material-usage-derived.js');
const finishCss = read('src/css/finish-table.css');
const materialCss = read('src/css/material-list.css');
const renderer = read('src/js/materials/material-list-renderer.js');

const start = controller.indexOf('function buildUsageLocationLines(');
const end = controller.indexOf('\nfunction buildMaterialListDisplayRows(', start);
assert.ok(start >= 0 && end > start, '現行の棟別使用箇所生成関数が存在すること');
const source = controller.slice(start, end);
const buildLines = new Function('projectBuildingIds', 'normalizeProjectBuildings', source + '\nreturn buildUsageLocationLines;')(
  projectBuildingIds, normalizeProjectBuildings
);
let passed = 0;
function test(title, fn) { fn(); passed += 1; console.log('PASS', title); }
const room = (buildingId, display) => ({buildingId, display});
const buildings = {B:{name:'別館'}, C:{name:'管理棟'}, D:{name:'倉庫棟'}};

test('1棟では棟名を付けず、従来の部屋番号表示を維持する', () => {
  assert.deepEqual(buildLines([room('', '1-1'), room('', '1-2')], {}, ''), ['1-1、1-2']);
  assert.deepEqual(buildLines([], {}, '旧記録'), ['旧記録']);
});

test('2棟でAとBの使用箇所を各1行にまとめる', () => {
  assert.deepEqual(
    buildLines([room('B','1-1'), room('','1-2'), room('','1-1'), room('B','1-1')], {buildings:{B:buildings.B}}),
    ['A棟：1-2、1-1', '別館：1-1']
  );
});

test('2棟で片方にしか使われていない建材にも棟名を付ける', () => {
  assert.deepEqual(buildLines([room('B','2-1')], {buildings:{B:buildings.B}}), ['別館：2-1']);
  assert.deepEqual(buildLines([room('','1-1')], {buildings:{B:buildings.B}}), ['A棟：1-1']);
});

test('4棟以上で存在する箇所を全件表示し、空棟は増やさない', () => {
  assert.deepEqual(
    buildLines([room('D','4-1'),room('B','2-2'),room('C','3-3'),room('','1-1')], {buildings}),
    ['A棟：1-1','別館：2-2','管理棟：3-3','倉庫棟：4-1']
  );
});

test('棟名変更は保存IDを変えず次の表示に反映する', () => {
  const original = buildLines([room('B','2-2')], {buildings:{B:{name:'別館'}}});
  const renamed = buildLines([room('B','2-2')], {buildings:{B:{name:'新別館'}}});
  assert.deepEqual(original, ['別館：2-2']);
  assert.deepEqual(renamed, ['新別館：2-2']);
});

test('A棟の旧形式buildingId空欄とA表記を同じ棟として扱う', () => {
  assert.deepEqual(buildLines([room('A','1-1'),room('','1-2')], {buildings:{B:buildings.B}}), ['A棟：1-1、1-2']);
});

test('使用箇所の棟IDは仕上レコードから取得し、採取候補の生成は残る', () => {
  assert.match(usage, /buildingId:\s*String\(record\.buildingId \|\| ''\)/);
  assert.match(controller, /sampleLocationOptions:\s*roomOptions\.map/);
  assert.match(controller, /usageLocationLines,/);
});

test('描画は棟ごとに行を分け、HTML文字をエスケープする', () => {
  assert.match(renderer, /material-usage-line/);
  const row = {
    materialId:'R001',materialNo:1,inputId:1,part:'壁',name:'建材',
    usageLocationLines:['A棟：1-1','別館：<2-1>'],
    sampleLocationOptions:[],sampleLocationEnabled:[false,false,false],
    sampleCount:0, sampleCountLabel:'-',samplePart:[],samplingEnabled:false,
    analysisRequired:'目視',level:'3'
  };
  const html = renderMaterialListRow(row, null, {colorMode:false});
  assert.match(html, /A棟：1-1/);
  assert.match(html, /別館：&lt;2-1&gt;/);
  assert.doesNotMatch(html, /別館：<2-1>/);
  assert.equal((html.match(/class="material-usage-line"/g) || []).length, 2);
});

test('4棟以上でも使用箇所を3行で切らない', () => {
  assert.match(materialCss, /\.material-list-table \.material-usage-lines\s*\{[^}]*white-space:\s*normal/s);
  assert.match(materialCss, /\.material-list-table \.material-usage-line \+ \.material-usage-line/);
  assert.doesNotMatch(materialCss.match(/\.material-list-table \.material-usage-lines\s*\{[^}]*\}/s)?.[0] || '', /line-clamp|overflow:\s*hidden/);
});

test('右操作パネルの棟ヘッダーと各棟の横幅をグリッド管理する', () => {
  assert.match(finishCss, /\.finish-building-head,\s*\.finish-building-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(finishCss, /#finishDrawerTools \.finish-building-row \.btn\s*\{[^}]*width:\s*auto/s);
  assert.match(finishCss, /\.finish-building-head b\s*\{\s*white-space:\s*nowrap/s);
  assert.match(finishCss, /\.finish-building-row \[data-finish-building-select\]/);
});

console.log('v0.1.9.11D: ' + passed + ' tests passed');
