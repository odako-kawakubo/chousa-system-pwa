/**
 * 帳票間で共有する文字列整形。
 */

export function formatSamplingCode(item = {}) {
  const projectNo = String(item.projectNo ?? '').trim();
  const sampleNo = String(item.sampleNo ?? '').trim();
  const placeCount = String(item.branch ?? '').trim();
  const base = [projectNo, sampleNo].filter(Boolean).join('-');
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
