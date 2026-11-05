/**
 * 建材リスト転記 (F5:AK)。
 * material / finish Record を読み取るだけで、Excelの入力規則に合わせて変換する。
 */
import { getMaterialDisplayNo } from '../records/material-record.js';
import { getMaterialUsageRoomOptions } from '../finish-table/material-usage-derived.js';
import { formatExcelLocation, formatExcelDate, clipboardSafe, formatExcelSampler } from './excel-transfer-data.js';

const text = (value) => String(value ?? '').trim();
const COLUMNS = Object.freeze(['F','G','H','I','J','K','L',...'MNOPQRSTUVWXYZ','AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK']);
const VALID_LEVELS = new Set(['-','3','2','1']);
const VALID_RESULTS = new Set(['未採取','分析中','無','石綿含有','石綿含有みなし']);
const VALID_REQUIRED = new Set(['採取・分析','目視','みなし','対象外']);

function requiredForExcel(required) {
  return required === '採取・分析' ? '採取・分析' : '目視';
}

function resultForExcel(record) {
  const required = text(record.analysisRequired);
  if (required === 'みなし') return '石綿含有みなし';
  if (required === '対象外') return '未採取';
  const result = text(record.analysisResult);
  if (!result) return required === '採取・分析' ? '分析中' : '未採取';
  return result;
}

function usageCells(record) {
  const locations = getMaterialUsageRoomOptions(record.inputId, { preferRoomName:false })
    .map((room) => text(room.areaCode === 'E' ? (room.roomName || room.roomNo) : (room.roomNo || room.roomName)))
    .filter(Boolean);
  const cells = Array(20).fill('');
  locations.slice(0, 19).forEach((room, index) => { cells[index] = room; });
  if (locations.length >= 20) cells[19] = locations.slice(19).join(',');
  return cells;
}

function buildRow(record, sampler) {
  const required = text(record.analysisRequired);
  const sampling = required === '採取・分析';
  const count = Number(record.sampleCount);
  const places = [1,2,3].map((branch) =>
    sampling && Number.isInteger(count) && count >= branch ? formatExcelLocation(record, branch) : '');
  const values = [
    text(record.name), text(record.part),
    requiredForExcel(required), resultForExcel(record), text(record.note),
    text(record.level || '-'), ...usageCells(record),
    sampling ? (Number.isInteger(count) && count > 0 ? String(count) : '') : '',
    ...places, sampling ? formatExcelDate(record.sampleDate) : '', sampler
  ];
  return { materialId:String(record.materialId), materialNo:getMaterialDisplayNo(record), values, record };
}

function validateRow(row) {
  const issues = [];
  const { record, values } = row;
  const add = (field, label, detail = '未入力または転記不可') =>
    issues.push({ materialId:row.materialId, materialNo:row.materialNo, name:text(record.name), field, label, detail });
  if (!values[0]) add('name','建材名称');
  if (!VALID_REQUIRED.has(text(record.analysisRequired))) add('analysisRequired','分析の要否');
  if (!VALID_RESULTS.has(values[3])) add('analysisResult','含有結果', `Excelの入力規則外：${values[3] || '空欄'}`);
  if (!VALID_LEVELS.has(values[5])) add('level','建材レベル', `Excelの入力規則外：${values[5] || '空欄'}`);
  if (text(record.analysisRequired) === '採取・分析') {
    const count = Number(record.sampleCount);
    if (!Number.isInteger(count) || count < 1 || count > 3) add('sampleCount','採取数');
    for (let index=1; index<=Math.min(3, Number.isInteger(count) ? count : 0); index++) {
      if (!row.values[26 + index]) add(`sampleLocation${index}`,`採取場所${index}`);
    }
    if (!text(record.sampleDate)) add('sampleDate','採取日');
  }
  return issues;
}

export function buildMaterialExcelSnapshot(records = [], { company='', person='' } = {}) {
  const sampler = formatExcelSampler(company, person);
  const materials = (records || []).filter((record) => record?.status === 'active')
    .slice().sort((a,b) => Number(getMaterialDisplayNo(a) || 0) - Number(getMaterialDisplayNo(b) || 0));
  const rows = materials.map((record) => buildRow(record, sampler));
  const issues = rows.flatMap(validateRow);
  if (rows.length && !text(company)) issues.push({ field:'company', label:'採取者の会社名', detail:'未入力' });
  if (rows.length && !text(person)) issues.push({ field:'person', label:'採取者氏名', detail:'未入力' });
  const warningMap = new Map();
  for (const issue of issues) {
    if (!issue.materialId) continue;
    if (!warningMap.has(issue.materialId)) warningMap.set(issue.materialId, []);
    warningMap.get(issue.materialId).push(issue.field);
  }
  const tsv = rows.map((row) => row.values.map(clipboardSafe).join('\t')).join('\n');
  return { rows, issues, warnings:warningMap, columns:COLUMNS, tsv, start:'F5' };
}
