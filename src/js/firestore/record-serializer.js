/**
 * src/js/firestore/record-serializer.js
 *
 * Firestoreへ書き込む3レコードの形を一元化する純粋モジュール。
 * finishRecordは疎保存し、入力差分と追加構造の復元に必要な最小レコードだけを送る。
 */

import { normalizeFieldEditedAt } from '../sync/field-edit-meta.js';

function text(value) { return String(value ?? ''); }
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

export function serializeFinishRecord(record, { updatedAt }) {
  if (!record?.finishId) throw new Error('finishRecord.finishIdは必須です。');
  return {
    areaCode: text(record.areaCode),
    roomPosition: text(record.roomPosition),
    floor: record.floor ?? null,
    roomNo: text(record.roomNo),
    roomName: text(record.roomName),
    roomNote: text(record.roomNote),
    position: Number(record.position) || 0,
    part: text(record.part),
    materialId: text(record.materialId),
    materialName: text(record.materialName),
    systemMemo: text(record.systemMemo),
    updatedDevice: text(record.updatedDevice) || 'local',
    fieldEditedAt: normalizeFieldEditedAt(record.fieldEditedAt),
    updatedAt
  };
}

export function serializeMaterialRecord(record, { updatedAt }) {
  if (!record?.materialId) throw new Error('materialRecord.materialIdは必須です。');
  return {
    status: text(record.status) || 'active',
    materialId: text(record.materialId),
    sortOrder: Number(record.materialNo) || Number(record.inputId) || 0,
    name: text(record.name),
    part: text(record.part),
    usageLocation: text(record.usageLocation),
    level: text(record.level) || '-',
    note: text(record.note),
    analysisRequired: text(record.analysisRequired),
    sampleCount: Number(record.sampleCount) || 0,
    sampleLocation1: text(record.sampleLocation1),
    sampleLocation2: text(record.sampleLocation2),
    sampleLocation3: text(record.sampleLocation3),
    samplePart: stringArray(record.samplePart),
    sampleDone: Boolean(record.sampleDone),
    sampleDate: text(record.sampleDate),
    sampleName: text(record.sampleName),
    analysisResult: text(record.analysisResult),
    remarks: text(record.remarks),
    systemMemo: text(record.systemMemo),
    updatedDevice: text(record.updatedDevice) || 'local',
    fieldEditedAt: normalizeFieldEditedAt(record.fieldEditedAt),
    updatedAt
  };
}

export function serializePhotoRecord(record, { updatedAt }) {
  if (!record?.photoId) throw new Error('photoRecord.photoIdは必須です。');
  const common = {
    photoId: text(record.photoId),
    photoType: text(record.photoType),
    fileName: text(record.fileName),
    isRepresentative: Boolean(record.isRepresentative),
    capturedDevice: text(record.capturedDevice) || 'local',
    capturedAt: text(record.capturedAt),
    boardDate: text(record.boardDate),
    isEdited: Boolean(record.isEdited),
    lastEditedDevice: text(record.lastEditedDevice),
    lastEditedAt: text(record.lastEditedAt),
    deleted: Boolean(record.deleted),
    systemMemo: text(record.systemMemo),
    boardPosition: text(record.boardPosition),
    boardSize: text(record.boardSize),
    oneDriveDriveId: text(record.oneDriveDriveId),
    originalItemId: text(record.originalItemId),
    completedItemId: text(record.completedItemId),
    originalPath: text(record.originalPath),
    completedPath: text(record.completedPath),
    fieldEditedAt: normalizeFieldEditedAt(record.fieldEditedAt),
    updatedAt
  };

  if (record.photoType === 'visual') {
    return {
      ...common,
      areaCode: text(record.areaCode),
      roomPosition: text(record.roomPosition),
      partSlot: Number(record.partSlot) || 0,
      roomNo: text(record.roomNo),
      part: text(record.part)
    };
  }

  return {
    ...common,
    materialId: text(record.materialId),
    samplingPlace: text(record.samplingPlace),
    samplingBranch: Number(record.samplingBranch) || 0,
    sampleNo: text(record.sampleNo),
    part: text(record.part),
    shootingType: text(record.shootingType)
  };
}

function plainValue(value) {
  if (Array.isArray(value)) return value.map(plainValue).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      const normalized = plainValue(item);
      if (normalized !== undefined) out[key] = normalized;
    });
    return out;
  }
  return value === undefined ? undefined : value;
}

export function serializeDrawingRecord(record, { updatedAt }) {
  if (!record?.drawingId) throw new Error('drawingRecord.drawingIdは必須です。');
  return {
    drawingId: text(record.drawingId),
    projectId: text(record.projectId),
    name: text(record.name) || '調査図',
    pageWidth: Number(record.pageWidth) || 29700,
    pageHeight: Number(record.pageHeight) || 21000,
    order: Number(record.order) || 0,
    deleted: Boolean(record.deleted),
    titleSettings: plainValue(record.titleSettings || {}),
    nameSettings: plainValue(record.nameSettings || {}),
    legendSettings: plainValue(record.legendSettings || {}),
    createdAt: text(record.createdAt),
    fieldEditedAt: normalizeFieldEditedAt(record.fieldEditedAt),
    updatedAt
  };
}

export function serializeDrawingObject(record, { updatedAt }) {
  if (!record?.objectId) throw new Error('drawingObject.objectIdは必須です。');
  const payload = plainValue({ ...record });
  delete payload.id;
  delete payload.updatedAt;
  return {
    ...payload,
    objectId: text(record.objectId),
    drawingId: text(record.drawingId),
    type: text(record.type),
    fieldEditedAt: normalizeFieldEditedAt(record.fieldEditedAt),
    updatedAt
  };
}
