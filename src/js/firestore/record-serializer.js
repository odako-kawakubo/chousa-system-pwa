/**
 * src/js/firestore/record-serializer.js
 *
 * Firestoreへ書き込む3レコードの形を一元化する純粋モジュール。
 * UI/Store用の派生項目をここで除外し、保存対象だけを返す。
 * updatedAt は呼び出し側Repositoryから serverTimestamp() を注入する。
 */

import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import { normalizeFieldEditedAt } from '../sync/field-edit-meta.js';

const DEFAULT_FINISH_COMPARE_FIELDS = Object.freeze(['roomNo', 'roomName', 'part', 'materialId']);

let defaultFinishMap = null;
function getDefaultFinishMap() {
  if (!defaultFinishMap) {
    defaultFinishMap = new Map(createDefaultFinishRecords().map((record) => [record.finishId, record]));
  }
  return defaultFinishMap;
}

function text(value) {
  return String(value ?? '');
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

export function isDefaultFinishRecordId(finishId) {
  return getDefaultFinishMap().has(String(finishId || ''));
}

/**
 * 初期テンプレートに存在するfinishRecordが、保存判定対象4項目で初期値と一致するか。
 * 追加構造はfalse（=保存対象）を返す。
 */
export function isFinishRecordAtDefault(record) {
  const baseline = getDefaultFinishMap().get(String(record?.finishId || ''));
  if (!baseline) return false;
  return DEFAULT_FINISH_COMPARE_FIELDS.every((field) => text(record?.[field]) === text(baseline[field]));
}

export function getFinishPersistenceDecision(record) {
  if (!record?.finishId) throw new Error('finishRecord.finishIdは必須です。');
  if (!isDefaultFinishRecordId(record.finishId)) return 'save';
  return isFinishRecordAtDefault(record) ? 'delete' : 'save';
}

export function serializeFinishRecord(record, { updatedAt }) {
  return {
    areaCode: text(record.areaCode),
    roomPosition: text(record.roomPosition),
    floor: record.floor ?? null,
    roomNo: text(record.roomNo),
    roomName: text(record.roomName),
    position: Number(record.position) || 0,
    part: text(record.part),
    materialId: text(record.materialId),
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
    isEdited: Boolean(record.isEdited),
    lastEditedDevice: text(record.lastEditedDevice),
    lastEditedAt: text(record.lastEditedAt),
    deleted: Boolean(record.deleted),
    systemMemo: text(record.systemMemo),
    boardPosition: text(record.boardPosition),
    boardSize: text(record.boardSize),
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
      partSlot: Number(record.partSlot) || 0
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
