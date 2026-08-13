/**
 * src/js/materials/material-list-view-model.js
 *
 * materialRecordStoreのレコードを建材リスト表示用へ整形する純粋モジュール。
 * DOM操作・Store書込みは行わない。
 *
 * v0.1.5.2B:
 * - 14.28準拠の上部集計を追加。
 * - 採取場所候補＝建材使用箇所、採取部位候補＝使用部位を生成。
 * - 採取数0はUIでは「-」として扱う。
 */

export const MATERIAL_LEVEL_OPTIONS = ['-', '3', '2', '1'];
export const MATERIAL_ANALYSIS_OPTIONS = ['採取・分析', '目視', 'みなし', '対象外'];
export const MATERIAL_SAMPLE_COUNT_OPTIONS = ['-', '1', '2', '3'];

/** 有効建材を建材No.順に並べ、表示用オブジェクトへ変換する。 */
export function buildMaterialListRows(records) {
  return (records || [])
    .filter((record) => record.status === 'active')
    .slice()
    .sort(compareMaterialRecords)
    .map((record) => {
      const sampleCount = Math.max(0, Math.min(3, Number(record.sampleCount) || 0));
      const usagePlaces = splitDerivedList(record.usageLocation);
      const usageParts = splitDerivedList(record.part);

      return {
        materialId: String(record.materialId || ''),
        materialNo: Number(record.materialNo) || Number(record.inputId) || 0,
        inputId: record.inputId,
        part: String(record.part || ''),
        name: String(record.name || ''),
        usageLocation: String(record.usageLocation || ''),
        usageParts,
        usagePlaces,
        level: normalizeLevel(record.level),
        analysisRequired: String(record.analysisRequired || '未調査'),
        note: String(record.note || ''),
        sampleCount,
        sampleCountLabel: sampleCount > 0 ? String(sampleCount) : '-',
        sampleLocation1: String(record.sampleLocation1 || ''),
        sampleLocation2: String(record.sampleLocation2 || ''),
        sampleLocation3: String(record.sampleLocation3 || ''),
        sampleLocationEnabled: [sampleCount >= 1, sampleCount >= 2, sampleCount >= 3],
        samplePart: String(record.samplePart || ''),
        sampleDone: Boolean(record.sampleDone),
        sampleDate: String(record.sampleDate || ''),
        color: String(record.color || '')
      };
    });
}

/** v0.14.28と同じ分析区分集計。 */
export function buildMaterialListStats(rows) {
  const stats = {
    total: rows.length,
    sample: 0,
    assume: 0,
    visual: 0,
    unset: 0
  };

  rows.forEach((row) => {
    const value = String(row.analysisRequired || '').trim();
    if (value === '採取・分析') stats.sample += 1;
    else if (value === 'みなし') stats.assume += 1;
    else if (value === '目視' || value === '未調査' || value === '対象外') stats.visual += 1;
    else stats.unset += 1;
  });

  return stats;
}

/** 「、」区切りの派生値を重複なし候補へ変換する。 */
export function splitDerivedList(value) {
  const out = [];
  String(value || '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (!out.includes(item)) out.push(item);
    });
  return out;
}

function normalizeLevel(value) {
  const normalized = String(value || '-');
  return MATERIAL_LEVEL_OPTIONS.includes(normalized) ? normalized : '-';
}

function compareMaterialRecords(a, b) {
  const aNo = Number(a.materialNo) || Number(a.inputId) || Number.MAX_SAFE_INTEGER;
  const bNo = Number(b.materialNo) || Number(b.inputId) || Number.MAX_SAFE_INTEGER;
  if (aNo !== bNo) return aNo - bNo;
  return String(a.materialId || '').localeCompare(String(b.materialId || ''), 'ja', { numeric: true });
}
