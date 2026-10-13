/**
 * 調査図上の1オブジェクトRecord定義。
 */
export const DRAWING_OBJECT_TYPES = Object.freeze([
  'roomLabel','materialLabel','sampleMarker','line','shape','text','underlay'
]);

export const DRAWING_LAYERS = Object.freeze({
  TEXT: 'text',
  NOTE: 'note',
  SHAPE: 'shape',
  UNDERLAY: 'underlay'
});

function text(value){ return String(value ?? ''); }
function number(value, fallback = 0){ const n = Number(value); return Number.isFinite(n) ? n : fallback; }

export function createDrawingObject(fields = {}) {
  const type = DRAWING_OBJECT_TYPES.includes(fields.type) ? fields.type : 'text';
  return {
    objectId: text(fields.objectId),
    drawingId: text(fields.drawingId),
    type,
    x: number(fields.x),
    y: number(fields.y),
    width: number(fields.width),
    height: number(fields.height),
    rotation: number(fields.rotation),
    layer: text(fields.layer),
    order: number(fields.order),
    visible: fields.visible !== false,
    locked: Boolean(fields.locked),
    deleted: Boolean(fields.deleted),
    ...fields,
    objectId: text(fields.objectId),
    drawingId: text(fields.drawingId),
    type,
    fieldEditedAt: { ...(fields.fieldEditedAt || {}) }
  };
}
