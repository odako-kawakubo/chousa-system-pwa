/**
 * src/js/records/material-record.js
 *
 * materialRecordの型・生成・判定関数だけを持つ、状態を持たない純粋モジュール。
 * 正本（Map<materialId, materialRecord>）はsrc/js/store/material-record-store.js
 * が保持する。このファイルはそこに保存する「1件のmaterialRecordの形」だけを
 * 扱い、Storeの中身には一切触れない。
 *
 * 正式仕様書20章の項目をそのまま定義するが、以下2点は今回の実装都合で
 * 追加している（正式仕様書の20項目には含まれない）：
 *   ・color … 24色パレットの色（仕上表セルの背景色・簡易リストのチップ色に
 *     使う表示専用の値）。
 *   ・photoCount … 写真枚数のプレースホルダー。実際の写真枚数連携は
 *     photoRecord Store実装（v0.1.5.3予定）まで存在しないため、それまでの
 *     暫定値として持たせる。
 * 採取・分析関連の項目（分析の要否〜備考）は、対応するUIがまだ存在しない
 * ため、デフォルト値（未調査／0／空欄）を持たせるだけにする。
 * 「部位」「使用箇所」は、finishRecordStoreから派生計算する項目（正式仕様書
 * 27章）のため、ここでは空欄で初期化し、実際の解決はfinish-table-actions.js側の
 * 派生計算処理が行う（このファイルはStoreにもfinishRecordにも触れない）。
 */

/**
 * @typedef {object} MaterialRecord
 * @property {'active'|'deleted'} status              状態
 * @property {string} materialId                      建材ID（例："R001"）
 * @property {number} inputId                          入力ID
 * @property {number} materialNo                       建材No.
 * @property {string} name                              建材名称
 * @property {string} part                              部位（finishRecordStoreからの派生値）
 * @property {string} usageLocation                      使用箇所（finishRecordStoreからの派生値）
 * @property {string} note                               調査備考
 * @property {string} analysisRequired                   分析の要否（デフォルト："未調査"）
 * @property {number} sampleCount                        採取数
 * @property {string} sampleLocation1
 * @property {string} sampleLocation2
 * @property {string} sampleLocation3
 * @property {string} samplePart                         採取部位
 * @property {string} sampleDate                         採取日
 * @property {string} sampleName                         試料名称
 * @property {string} analysisResult                     分析結果
 * @property {string} remarks                             備考
 * @property {string} baseName                            ベース名（末尾英字を除いた名称）
 * @property {string} suffixLetter                        末尾英字
 * @property {string} systemMemo                          システムメモ
 * @property {string} updatedDevice                       更新端末
 * @property {string} updatedAt                            更新日時（ISO日時文字列）
 * @property {string} color         仕様書外・表示専用：24色パレットの色
 * @property {number} photoCount    仕様書外・表示専用：写真枚数プレースホルダー
 */

/** 仕上表で使用する淡い建材カラー（24色・確定パレット）。 */
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
 * 1. 前後の空白を削除する
 * 2. 全角英数字を半角化する
 * 3. 末尾の連続した半角英字だけを大文字化する（A〜Z / AA / AB...対応）
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeMaterialName(name) {
  let value = String(name ?? '').trim();
  value = value.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  value = value.replace(/\s+/g, ' ');
  const match = /([A-Za-z]+)$/.exec(value);
  if (match) {
    value = value.slice(0, -match[1].length) + match[1].toUpperCase();
  }
  return value;
}

/**
 * 正規化済みの名称から、ベース名（末尾英字を除いた部分）と末尾英字を分離する。
 * 末尾に連続した半角英大文字があり、その直前が非英字の場合にサフィックスとして分離する。
 * A〜ZだけでなくAA / AB...も対象。名称全体が英字だけの場合は分離しない。
 *
 * @param {string} normalizedName normalizeMaterialName()済みの名称
 * @returns {{ baseName: string, suffixLetter: string }}
 */
export function splitBaseNameAndSuffix(normalizedName) {
  const value = String(normalizedName ?? '');
  // 名称全体が英字だけの場合は製品名等の可能性があるため、末尾サフィックスとはみなさない。
  // 直前に非英字があり、その後ろに連続英字がある場合のみサフィックスとして分離する。
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

/**
 * 既存の建材IDの集合から、次の新規建材ID（"R001"形式）を採番する。
 *
 * @param {Iterable<string>} existingIds
 * @returns {string}
 */
export function nextMaterialId(existingIds) {
  let maxNum = 0;
  for (const id of existingIds) {
    const match = /^R(\d+)$/.exec(String(id || ''));
    if (match) maxNum = Math.max(maxNum, Number(match[1]));
  }
  return `R${pad(maxNum + 1, 3)}`;
}

/**
 * 24色パレットから、inputIdに応じた色を決定する（25件目以降は先頭から再利用）。
 *
 * @param {number} inputId
 * @returns {string}
 */
export function colorForInputId(inputId) {
  const index = (Number(inputId) - 1) % MATERIAL_COLOR_PALETTE.length;
  return MATERIAL_COLOR_PALETTE[index < 0 ? 0 : index];
}

/**
 * materialRecordを1件生成する。渡されなかった項目は仕様上のデフォルト値
 * （空欄／0／"未調査"等）で埋める。nameは事前にnormalizeMaterialName()済みの
 * 値を渡すこと（このファイルは正規化を強制しない。呼び出し側の責務）。
 *
 * @param {Partial<MaterialRecord>} fields
 * @returns {MaterialRecord}
 */
export function createMaterialRecord(fields) {
  const name = String(fields.name ?? '');
  const { baseName, suffixLetter } = splitBaseNameAndSuffix(name);
  const inputId = Number(fields.inputId);

  return {
    status: fields.status || 'active',
    materialId: fields.materialId,
    inputId,
    materialNo: fields.materialNo != null ? Number(fields.materialNo) : inputId,
    name,
    part: String(fields.part ?? ''),
    usageLocation: String(fields.usageLocation ?? ''),
    note: String(fields.note ?? ''),
    analysisRequired: fields.analysisRequired || '未調査',
    sampleCount: Number(fields.sampleCount) || 0,
    sampleLocation1: String(fields.sampleLocation1 ?? ''),
    sampleLocation2: String(fields.sampleLocation2 ?? ''),
    sampleLocation3: String(fields.sampleLocation3 ?? ''),
    samplePart: String(fields.samplePart ?? ''),
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
