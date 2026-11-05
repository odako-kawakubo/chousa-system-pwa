/**
 * Excel転記の読み取り専用データ生成。
 * materialRecordを変更せず、プレビュー・検査・クリップボードを同一データから作る。
 */
import { getMaterialDisplayNo, samplePartsToText } from '../records/material-record.js';
import { getMaterialUsageRoomOptions, getMaterialSampleLocationDisplay } from '../finish-table/material-usage-derived.js';

export const EXCEL_COMPANIES = Object.freeze([
  '小田原鉱石株式会社',
  '株式会社Three Peace',
  '株式会社アイエック',
  '株式会社エヌワン環境サービス'
]);
export const EXCEL_SAMPLERS = Object.freeze([
  '濱舘　厚', '髙橋　淳', '濱舘　悟', '池田　翼', '木川田　一馬',
  '川久保　拡則', '佐藤　創太', '飯塚　祐二', '星野　史隆', '佐藤　修',
  '坂本　将平', '大槻　俊平', '齋藤　毅', '吉永　正信', '宮本　誠'
]);
export const EXCEL_FIELDS = Object.freeze({
  sampleCount:'採取数',
  sampleDate:'採取日',
  name:'建材名称',
  sampleLocation1:'採取場所1',
  sampleLocation2:'採取場所2',
  sampleLocation3:'採取場所3',
  samplePart:'採取部位'
});

const value = (input) => String(input ?? '').trim();
const countOf = (record) => Number(record.sampleCount);
const sampled = (record) => record?.status === 'active' && record?.analysisRequired === '採取・分析';

export function getExcelMaterialIssues(record) {
  if (!sampled(record)) return [];
  const issues = [];
  const count = countOf(record);
  if (!Number.isInteger(count) || count < 1 || count > 3) issues.push('sampleCount');
  if (!value(record.sampleDate)) issues.push('sampleDate');
  if (!value(record.name)) issues.push('name');
  if (!samplePartsToText(record.samplePart)) issues.push('samplePart');
  for (let branch = 1; branch <= (Number.isInteger(count) && count >= 1 && count <= 3 ? count : 0); branch += 1) {
    if (!value(record[`sampleLocation${branch}`]) && !value(record[`sampleRoomKey${branch}`])) {
      issues.push(`sampleLocation${branch}`);
    }
  }
  return issues;
}

export function getExcelMaterialWarnings(records = []) {
  const warnings = new Map();
  (records || []).filter(sampled).forEach((record) => {
    const fields = getExcelMaterialIssues(record);
    if (fields.length) warnings.set(String(record.materialId), fields);
  });
  return warnings;
}

export function formatExcelDate(raw) {
  const text = value(raw);
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : text;
}

/**
 * 採取場所の表示は部屋表示モードと無関係に、部屋キーから取得する。
 * E=外部 部屋名、I=部屋No.、B/S/R=既存の部屋No.(B/S/R表記)。
 */
export function formatExcelLocation(record, branch) {
  const key = value(record[`sampleRoomKey${branch}`]);
  const raw = value(record[`sampleLocation${branch}`]);
  if (!key && !raw) return '';

  const options = getMaterialUsageRoomOptions(record.inputId, { preferRoomName:false });
  const match = (key && options.find((item) => item.key === key))
    || options.find((item) => item.roomNo === raw || item.roomName === raw || item.value === raw);
  const fallback = getMaterialSampleLocationDisplay(record.inputId, raw, {
    roomKey:key,
    preferRoomName:false
  });
  const area = match?.areaCode || fallback.areaCode || (key.includes('|') ? key.split('|')[0] : '');
  const roomNo = value(match?.roomNo || fallback.roomNo || raw);
  const roomName = value(match?.roomName || fallback.roomName || raw);

  if (area === 'E') return `外部　${roomName || roomNo}`;
  if (area === 'I' || !area) return `部屋No.${roomNo}`;
  if (['S', 'R', 'B'].includes(area)) return `部屋No.${roomNo.startsWith(area) ? roomNo : `${area}${roomNo}`}`;
  return roomNo || raw;
}

function makeSampleName(record) {
  const no = getMaterialDisplayNo(record);
  return [
    no ? `建材No.${no}` : '',
    samplePartsToText(record.samplePart),
    value(record.name)
  ].filter(Boolean).join('　');
}

export function clipboardSafe(raw) {
  return String(raw ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export const formatExcelSampler = (company, person) => [value(company), value(person)].filter(Boolean).join('　');

export function buildExcelTransferSnapshot(records = [], { company = '', person = '' } = {}) {
  const all = (records || []).filter(sampled)
    .slice()
    .sort((a, b) => Number(getMaterialDisplayNo(a) || 0) - Number(getMaterialDisplayNo(b) || 0));
  const warnings = getExcelMaterialWarnings(all);
  const issues = [];
  all.forEach((record) => {
    (warnings.get(String(record.materialId)) || []).forEach((field) => {
      issues.push({ materialId:String(record.materialId), materialNo:getMaterialDisplayNo(record), name:value(record.name), field, label:EXCEL_FIELDS[field] || field });
    });
  });
  if (!value(company)) issues.push({ field:'company', label:'採取者の会社名' });
  if (!value(person)) issues.push({ field:'person', label:'採取者氏名' });

  const sampler = formatExcelSampler(company, person);
  const samples = all.filter((record) => {
    const count = countOf(record);
    return Number.isInteger(count) && count >= 1 && count <= 3;
  }).map((record, index) => {
    const count = countOf(record);
    const places = Array.from({ length:count }, (_, i) => formatExcelLocation(record, i + 1)).filter(Boolean);
    return {
      materialId:String(record.materialId),
      materialNo:getMaterialDisplayNo(record),
      sampleNo:index + 1,
      fields:{
        15:String(count),
        16:formatExcelDate(record.sampleDate),
        17:makeSampleName(record),
        18:places.join('、'),
        19:'', 20:'',
        21:samplePartsToText(record.samplePart),
        22:'', 23:'', 24:'',
        25:sampler
      }
    };
  });
  const rows = Array.from({ length:11 }, (_, index) => {
    const excelRow = index + 15;
    return {
      excelRow,
      values:samples.map((sample) => sample.fields[excelRow] || '')
    };
  });
  const tsv = rows.map((row) => row.values.map(clipboardSafe).join('\t')).join('\n');
  return { samples, rows, issues, warnings, tsv };
}
