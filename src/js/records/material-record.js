/**
 * src/js/records/material-record.js
 *
 * materialRecordの型・生成・判定関数だけを持つ、状態を持たない純粋モジュール。
 * 正本（Map<materialId, materialRecord>）はsrc/js/store/material-record-store.jsが保持する。
 *
 * v0.1.5.2B:
 * - 建材リストから正式に扱う「レベル」「採取済み」をRecord項目へ追加。
 * - 採取数は内部値0をUI上の「-」として扱い、1〜3は数値で保持する。
 * - 部位・使用箇所は引き続きfinishRecordStoreからの派生値であり、ここでは計算しない。
 */

/**
 * @typedef {object} MaterialRecord
 * @property {'active'|'merged'|'deleted'} status
 * @property {string} materialId
 * @property {number} inputId
 * @property {number} materialNo
 * @property {string} name
 * @property {string} part
 * @property {string} usageLocation
 * @property {'-'|'3'|'2'|'1'|string} level
 * @property {string} note
 * @property {string} analysisRequired
 * @property {number} sampleCount
 * @property {string} sampleLocation1
 * @property {string} sampleLocation2
 * @property {string} sampleLocation3
 * @property {string[]} samplePart 複数選択された採取部位。旧string入力もcreate時に配列へ正規化する。
 * @property {boolean} sampleDone
 * @property {string} sampleDate
 * @property {string} sampleName
 * @property {string} analysisResult
 * @property {string} remarks
 * @property {string} baseName
 * @property {string} suffixLetter
 * @property {string} systemMemo
 * @property {string} updatedDevice
 * @property {string} updatedAt
 * @property {string} color
 * @property {number} photoCount
 */

/** 仕上表・建材リストで使用する淡い建材カラー（24色・確定パレット）。
 * v0.1.5.7A 業務固定色：テーマ変更時も建材ごとの色対応を維持するため変更しない。
 */
export const MATERIAL_COLOR_PALETTE = [
  '#dbeafe', '#dcfce7', '#fef3c7', '#fae8ff', '#ffe4e6', '#ccfbf1',
  '#ede9fe', '#ffedd5', '#ecfccb', '#fce7f3', '#e0f2fe', '#f1f5f9',
  '#e2f0d9', '#fff1cc', '#f5e1ff', '#ffdede', '#d9f2f2', '#e7e3ff',
  '#ffe7cc', '#e8f5d0', '#f7dff0', '#dff1f7', '#eee8dc', '#e6ecef'
];

function pad(value, length) {
  return String(value).padStart(length, '0');
}

/**
 * 名称を正規化する。
 * 1. 前後の空白を削除
 * 2. 全角英数字を半角化
 * 3. 末尾の連続した半角英字だけ大文字化（A〜Z / AA / AB...）
 */
export function normalizeMaterialName(name) {
  let value = String(name ?? '').trim();
  value = value.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  value = value.replace(/\s+/g, ' ');
  const match = /([A-Za-z]+)$/.exec(value);
  if (match) value = value.slice(0, -match[1].length) + match[1].toUpperCase();
  return value;
}

/** 正規化済み名称をベース名と末尾英字へ分ける。 */
export function splitBaseNameAndSuffix(normalizedName) {
  const value = String(normalizedName ?? '');
  const match = /^(.*[^A-Za-z])([A-Z]+)$/.exec(value);
  if (!match) return { baseName: value, suffixLetter: '' };
  return { baseName: match[1], suffixLetter: match[2] };
}

function suffixToNumber(suffix) {
  let value = 0;
  for (const ch of String(suffix || '').toUpperCase()) {
    if (ch < 'A' || ch > 'Z') return 0;
    value = value * 26 + (ch.charCodeAt(0) - 64);
  }
  return value;
}

function numberToSuffix(value) {
  let n = Number(value) || 0;
  if (n < 1) return 'A';
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** 同一ベース名の既存建材から次の末尾英字をExcel列方式で返す。 */
export function nextMaterialSuffix(baseName, materials) {
  let max = 0;
  for (const material of materials || []) {
    if (material.status === 'deleted') continue;
    const normalized = normalizeMaterialName(material.name || '');
    const parsed = splitBaseNameAndSuffix(normalized);
    if (parsed.baseName !== baseName || !parsed.suffixLetter) continue;
    max = Math.max(max, suffixToNumber(parsed.suffixLetter));
  }
  return numberToSuffix(max + 1);
}

/** 既存ID集合から次のR001形式IDを返す。 */
export function nextMaterialId(existingIds) {
  let maxNum = 0;
  for (const id of existingIds) {
    const match = /^R(\d+)$/.exec(String(id || ''));
    if (match) maxNum = Math.max(maxNum, Number(match[1]));
  }
  return `R${pad(maxNum + 1, 3)}`;
}

/** 24色パレットからinputIdに対応する色を返す。 */
export function colorForInputId(inputId) {
  const index = (Number(inputId) - 1) % MATERIAL_COLOR_PALETTE.length;
  return MATERIAL_COLOR_PALETTE[index < 0 ? 0 : index];
}


/** 採取部位を重複なし配列へ正規化する。旧stringレコードも互換で受ける。 */
export function normalizeSampleParts(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[、,，]/);
  const out = [];
  source
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .forEach((item) => {
      if (!out.includes(item)) out.push(item);
    });
  return out;
}

/** 表示・写真Record連携用に「、」区切り文字列へ変換する。 */
export function samplePartsToText(value) {
  return normalizeSampleParts(value).join('、');
}

/** materialRecordを1件生成する。 */
export function createMaterialRecord(fields) {
  const name = String(fields.name ?? '');
  const { baseName, suffixLetter } = splitBaseNameAndSuffix(name);
  const inputId = Number(fields.inputId);
  const analysisRequired = fields.analysisRequired || '採取・分析';
  const rawSampleCount = Number(fields.sampleCount);
  const sampleCount = analysisRequired === '採取・分析'
    ? Math.max(1, Math.min(3, Number.isFinite(rawSampleCount) && rawSampleCount > 0 ? rawSampleCount : 1))
    : Math.max(0, Math.min(3, Number.isFinite(rawSampleCount) ? rawSampleCount : 0));

  return {
    status: fields.status || 'active',
    materialId: fields.materialId,
    inputId,
    materialNo: fields.materialNo != null ? Number(fields.materialNo) : inputId,
    name,
    part: String(fields.part ?? ''),
    usageLocation: String(fields.usageLocation ?? ''),
    level: String(fields.level ?? '-'),
    note: String(fields.note ?? ''),
    analysisRequired,
    sampleCount,
    sampleLocation1: String(fields.sampleLocation1 ?? ''),
    sampleLocation2: String(fields.sampleLocation2 ?? ''),
    sampleLocation3: String(fields.sampleLocation3 ?? ''),
    samplePart: normalizeSampleParts(fields.samplePart),
    sampleDone: Boolean(fields.sampleDone),
    sampleDate: String(fields.sampleDate ?? ''),
    sampleName: String(fields.sampleName ?? ''),
    analysisResult: String(fields.analysisResult ?? ''),
    remarks: String(fields.remarks ?? ''),
    baseName: fields.baseName ?? baseName,
    suffixLetter: fields.suffixLetter ?? suffixLetter,
    systemMemo: String(fields.systemMemo ?? ''),
    updatedDevice: fields.updatedDevice || 'local',
    updatedAt: fields.updatedAt || new Date().toISOString(),
    color: fields.color || colorForInputId(inputId),
    photoCount: Number(fields.photoCount) || 0
  };
}
