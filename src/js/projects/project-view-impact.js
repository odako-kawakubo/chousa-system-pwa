/**
 * Project同期差分が各画面へ与える影響を判定する純粋ロジック。
 * Store更新・Firestore接続・画面描画は行わない。
 */

function equalRecordValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  if ((a && typeof a === 'object') || (b && typeof b === 'object')) return JSON.stringify(a || {}) === JSON.stringify(b || {});
  return String(a ?? '') === String(b ?? '');
}

function changedFields(previous, next, fields = []) {
  return fields.filter((field) => !equalRecordValue(previous?.[field], next?.[field]));
}

const FINISH_IMPACT_FIELDS = [
  'areaCode', 'roomPosition', 'floor', 'roomNo', 'roomName', 'position',
  'part', 'materialId', 'status'
];
const FINISH_STRUCTURAL_FIELDS = new Set(['areaCode', 'roomPosition', 'floor', 'position', 'status']);
const FINISH_PHOTO_VISUAL_FIELDS = new Set([
  'areaCode', 'roomPosition', 'floor', 'roomNo', 'roomName', 'position', 'part', 'materialId', 'status'
]);
const FINISH_MATERIAL_VIEW_FIELDS = new Set([
  'areaCode', 'roomPosition', 'floor', 'roomNo', 'roomName', 'position', 'part', 'materialId', 'status'
]);

const MATERIAL_IMPACT_FIELDS = [
  'status', 'inputId', 'materialNo', 'name', 'part', 'usageLocation', 'level', 'note',
  'analysisRequired', 'sampleCount', 'sampleLocation1', 'sampleLocation2', 'sampleLocation3',
  'samplePart', 'sampleDone', 'sampleDate', 'sampleName', 'analysisResult', 'remarks', 'color', 'photoCount'
];
const MATERIAL_FINISH_VIEW_FIELDS = new Set(['status', 'inputId', 'name', 'note', 'color']);
const MATERIAL_PHOTO_VISUAL_FIELDS = new Set(['status', 'inputId', 'name']);
const MATERIAL_PHOTO_SAMPLING_FIELDS = new Set([
  'status', 'inputId', 'materialNo', 'name', 'part', 'analysisRequired', 'sampleCount',
  'sampleLocation1', 'sampleLocation2', 'sampleLocation3', 'samplePart', 'color'
]);

export function createEmptyProjectViewImpact() {
  return {
    finish: { changed: false, fields: new Set(), structural: false, materialView: false, photoVisual: false },
    material: { changed: false, fields: new Set(), finishView: false, photoVisual: false, photoSampling: false },
    photo: { changed: false, photoTypes: new Set(), fields: new Set(), forceRefresh: false }
  };
}

export function createFullTypeProjectViewImpact(typeModes = {}, photoRecords = []) {
  const impact = createEmptyProjectViewImpact();

  if (typeModes.finish === 'full') {
    impact.finish.changed = true;
    impact.finish.structural = true;
    impact.finish.materialView = true;
    impact.finish.photoVisual = true;
    FINISH_IMPACT_FIELDS.forEach((field) => impact.finish.fields.add(field));
  }

  if (typeModes.material === 'full') {
    impact.material.changed = true;
    impact.material.finishView = true;
    impact.material.photoVisual = true;
    impact.material.photoSampling = true;
    MATERIAL_IMPACT_FIELDS.forEach((field) => impact.material.fields.add(field));
  }

  if (typeModes.photo === 'full') {
    impact.photo.changed = true;
    photoRecords.forEach((record) => {
      const photoType = String(record?.photoType || '');
      if (photoType) impact.photo.photoTypes.add(photoType);
    });
    impact.photo.forceRefresh = true;
  }

  return impact;
}

export function registerFinishProjectViewImpact(impact, current, change) {
  const incoming = change.changeType === 'removed' ? null : change.record;
  const fields = change.changeType === 'removed' || !current
    ? FINISH_IMPACT_FIELDS
    : changedFields(current, incoming, FINISH_IMPACT_FIELDS);

  impact.finish.changed = true;
  fields.forEach((field) => impact.finish.fields.add(field));

  if (
    change.changeType === 'removed'
    || !current
    || fields.some((field) => FINISH_STRUCTURAL_FIELDS.has(field))
  ) {
    impact.finish.structural = true;
  }

  if (fields.some((field) => FINISH_MATERIAL_VIEW_FIELDS.has(field))) impact.finish.materialView = true;
  if (fields.some((field) => FINISH_PHOTO_VISUAL_FIELDS.has(field))) impact.finish.photoVisual = true;
}

export function registerMaterialProjectViewImpact(impact, current, change) {
  const incoming = change.changeType === 'removed' ? null : change.record;
  const fields = change.changeType === 'removed' || !current
    ? MATERIAL_IMPACT_FIELDS
    : changedFields(current, incoming, MATERIAL_IMPACT_FIELDS);

  impact.material.changed = true;
  fields.forEach((field) => impact.material.fields.add(field));

  if (fields.some((field) => MATERIAL_FINISH_VIEW_FIELDS.has(field))) impact.material.finishView = true;
  if (fields.some((field) => MATERIAL_PHOTO_VISUAL_FIELDS.has(field))) impact.material.photoVisual = true;
  if (fields.some((field) => MATERIAL_PHOTO_SAMPLING_FIELDS.has(field))) impact.material.photoSampling = true;
}

export function registerPhotoProjectViewImpact(impact, current, change) {
  const incoming = change.changeType === 'removed' ? null : change.record;
  impact.photo.changed = true;

  const photoType = String(incoming?.photoType || current?.photoType || '');
  if (photoType) impact.photo.photoTypes.add(photoType);
  if (change.changeType === 'removed') impact.photo.forceRefresh = true;

  const keys = new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})]);
  ['updatedAt', 'fieldEditedAt'].forEach((field) => keys.delete(field));
  [...keys]
    .filter((field) => !equalRecordValue(current?.[field], incoming?.[field]))
    .forEach((field) => impact.photo.fields.add(field));
}

export function serializeProjectViewImpact(impact) {
  return {
    finish: { ...impact.finish, fields: [...impact.finish.fields] },
    material: { ...impact.material, fields: [...impact.material.fields] },
    photo: {
      ...impact.photo,
      photoTypes: [...impact.photo.photoTypes],
      fields: [...impact.photo.fields]
    }
  };
}
