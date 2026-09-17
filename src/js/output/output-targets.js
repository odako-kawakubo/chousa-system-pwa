/**
 * 出力帳票の種別定義。
 * 画面・PDF・印刷・Excelで同じ名称を使う。
 */
export const OUTPUT_TARGETS = Object.freeze({
  materials: { key:'materials', label:'建材リスト', header:'調査対象建材リスト' },
  rooms: { key:'rooms', label:'部屋別リスト', header:'部屋別調査対象建材リスト' },
  'visual-photos': { key:'visual-photos', label:'建材写真帳', header:'調査対象建材写真帳' },
  'sampling-photos': { key:'sampling-photos', label:'採取写真帳', header:'試料採取写真' }
});

export const OUTPUT_TARGET_ORDER = Object.freeze([
  'materials',
  'rooms',
  'visual-photos',
  'sampling-photos'
]);

export function outputTargetLabel(key) {
  return OUTPUT_TARGETS[key]?.label || '';
}
