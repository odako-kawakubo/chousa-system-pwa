/**
 * 調査図1ページのRecord定義。
 */
export const DRAWING_PAGE_WIDTH = 29700;
export const DRAWING_PAGE_HEIGHT = 21000;

function text(value){ return String(value ?? ''); }
function nowIso(){ return new Date().toISOString(); }

export function createDrawingRecord(fields = {}) {
  const createdAt = text(fields.createdAt) || nowIso();
  return {
    drawingId: text(fields.drawingId),
    projectId: text(fields.projectId),
    name: text(fields.name) || '調査図',
    pageWidth: Number(fields.pageWidth) || DRAWING_PAGE_WIDTH,
    pageHeight: Number(fields.pageHeight) || DRAWING_PAGE_HEIGHT,
    order: Number(fields.order) || 1,
    deleted: Boolean(fields.deleted),
    titleSettings: {
      text: text(fields.titleSettings?.text) || '調査図',
      ...(fields.titleSettings || {})
    },
    nameSettings: {
      text: text(fields.nameSettings?.text),
      ...(fields.nameSettings || {})
    },
    legendSettings: {
      visible: fields.legendSettings?.visible !== false,
      items: Array.isArray(fields.legendSettings?.items) ? [...fields.legendSettings.items] : [],
      ...(fields.legendSettings || {})
    },
    createdAt,
    updatedAt: fields.updatedAt || '',
    fieldEditedAt: { ...(fields.fieldEditedAt || {}) }
  };
}
