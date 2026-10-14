/**
 * 帳票間で共有する文字列整形。
 */

/** 番号・日付など指定項目だけ全角数字を半角へ統一する。元Recordの値自体は変更しない。 */
export function normalizeOutputDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

export function formatSamplingCode(item = {}) {
  const projectNo = normalizeOutputDigits(item.projectNo).trim();
  const materialNo = normalizeOutputDigits(item.materialNo).trim();
  const placeCount = normalizeOutputDigits(item.branch).trim();
  const base = [projectNo, materialNo].filter(Boolean).join('-');
  return placeCount ? `${base} ${placeCount}`.trim() : base;
}

/**
 * 部位表示ルール。
 * - 単独部位は1行のまま。4文字以上は描画側で縮小する。
 * - 複数部位は、区切り込みの表示が4文字以上なら「、」を消して部位ごとに改行する。
 * - 「壁、床」のように3文字で収まるものは1行のまま。
 */
export function formatPartDisplay(value) {
  const text = String(value ?? '').trim().replace(/[，,]/g, '、');
  if (!text) return { text:'', lines:[], split:false };

  const tokens = text.split('、').map((token) => token.trim()).filter(Boolean);
  const split = tokens.length > 1 && text.length >= 4;
  return {
    text,
    lines: split ? tokens : [text],
    split
  };
}
