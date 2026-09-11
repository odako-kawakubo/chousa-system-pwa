/**
 * src/js/finish-table/finish-table-actions.js
 *
 * 仕上表・建材の業務ロジック。
 *
 * v0.1.6.2 方針：
 * - 1入力枠 = 1 finishRecord。未入力枠も実レコードとして保持する。
 * - 独立した部屋レコード／代表レコード／rowCountsは持たない。
 * - 同一部屋のfinishRecordは内部補助ID roomUid で束ねる。
 * - 部屋追加・入力行追加は、必要なfinishRecordそのものを生成する。
 * - 建材の部位・使用箇所はfinishRecordStoreから派生してmaterialRecordへ反映する。
 * - 新規建材登録は登録ボタンをトリガーとし、末尾英字を A..Z, AA, AB... で自動採番する。
 *
 * v0.1.7.1:
 * - 登録ボタンを押していない建材名称もfinishRecordのmaterialNameへ保持する。
 * - materialNameは建材登録状態を増やすための別レコードではなく、仕上表セル自身の入力値。
 * - 通常部位はmaterialNameがあれば疎保存対象、その他はpart + materialNameが揃った時だけ疎保存対象とする。
 *
 * v0.1.7.2:
 * - roomNoteをroomNo / roomNameと同じ部屋共通情報として扱う。
 * - ローカルでは同一部屋の全finishRecordへ反映し、Firestoreは標準carrier 602だけを正として疎保存する。
 */

import {
  PART_POSITION,
  computeFinishId,
  computeCellPosition,
  buildFloorRoomPosition,
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  rowFromPosition,
  createFinishRecord,
  nextRoomUid
} from '../records/finish-record.js';
import {
  createMaterialRecord,
  normalizeMaterialName,
  splitBaseNameAndSuffix,
  nextMaterialSuffix,
  nextMaterialId
} from '../records/material-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import {
  INITIAL_ROW_COUNT,
  INTERNAL_PARTS,
  EXTERNAL_PARTS
} from './finish-table-constants.js';
import { INITIAL_STRUCTURE_SEED } from '../demo/sample-finish-data.js';
import { SAMPLE_MATERIALS_SEED } from '../demo/sample-materials.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import {
  deleteFinishForProject,
  persistFinishForProject,
  persistMaterialForProject,
  hasKnownFinishRecord
} from '../sync/project-record-persistence.js';
import { applySingleRecordSamplingAutofill } from '../materials/material-sampling-autofill.js';
import {
  getRequiredStructureRecordIds,
  defaultPartForRecord,
  defaultRoomFieldsForRecord
} from '../sync/finish-sparse-structure.js';

const ROOMS_PER_FLOOR = 10;
const PART_COUNT = 6;
const PERSISTED_FINISH_EDIT_FIELDS = new Set(['roomNo', 'roomName', 'roomNote', 'part', 'materialId', 'materialName']);

function pad(value, length) { return String(value).padStart(length, '0'); }
function nowIso() { return new Date().toISOString(); }

function partsForArea(areaCode) {
  return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
}

function defaultPartName(areaCode, partIndex) {
  const raw = partsForArea(areaCode)[partIndex - 1] || '';
  return partIndex >= 5 ? '' : raw;
}

function normalizeCandidateMaterialInput(rawValue) {
  const normalized = normalizeMaterialName(rawValue);
  return normalized.replace(/^【\d+】\s*/, '');
}

export function getMaterialPartOptions(materialRecord) {
  return [...new Set(
    String(materialRecord?.part || '')
      .split(/[、,，]/)
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function partPatchForExistingMaterial(currentCell, partIndex, materialRecord) {
  if (partIndex < 5) return {};
  const parts = getMaterialPartOptions(materialRecord);
  if (parts.length === 1) return { part: parts[0] };
  if (parts.length > 1) {
    const currentPart = String(currentCell?.part || '').trim();
    return parts.includes(currentPart) ? {} : { part: '' };
  }
  return {};
}

function appendSystemMemo(existing, message) {
  const text = String(existing || '').trim();
  const line = `${new Date().toISOString().slice(0, 10)} ${message}`;
  return text ? `${text}\n${line}` : line;
}

export function roomKeyOf(record) { return record?.roomUid || ''; }

export function findRepresentativeByRoomKey(roomKey) {
  if (!roomKey) return null;
  return finishRecordStore.getAll().find((record) => record.roomUid === roomKey && record.status === 'active') || null;
}

export function floorKeyOf(areaCode, floor) { return `floor-${areaCode}-${floor}`; }

function parseFloorKey(floorKey) {
  const match = /^floor-([IB])-(-?\d+)$/.exec(floorKey || '');
  return match ? { areaCode: match[1], floor: Number(match[2]) } : null;
}

export function isFirstNormalFloorFirstRoom(record) {
  return !!record && record.areaCode === 'I' && Number(record.floor) === 1
    && roomIndexFromRoomPosition(record.roomPosition) === 1;
}

export function getRoomRecords(roomKey) {
  return finishRecordStore.getAll()
    .filter((record) => record.roomUid === roomKey && record.status === 'active')
    .sort((a, b) => a.position - b.position);
}

export function snapshotRoomRecords(roomKey) {
  return getRoomRecords(roomKey).map((record) => ({ ...record }));
}

export function roomHasRecordedContent(roomKey) {
  return getRoomRecords(roomKey).some((record) => {
    if (record.materialId || record.inputId) return true;
    const partIndex = partIndexFromPosition(record.position);
    const materialName = String(record.materialName || '').trim();
    if (partIndex < 5 && materialName) return true;
    if (partIndex >= 5 && materialName && String(record.part || '').trim()) return true;
    return partIndex >= 5 && record.part && record.part !== 'その他';
  });
}

function uniqueRoomAnchors(areaCode, floor = undefined) {
  const byRoom = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.areaCode !== areaCode) return;
    if (floor !== undefined && Number(record.floor) !== Number(floor)) return;
    if (!byRoom.has(record.roomUid)) byRoom.set(record.roomUid, record);
  });
  return Array.from(byRoom.values());
}

function createRoomRecords({ areaCode, roomPosition, floor, roomNo, roomName, roomNote = '', rowCount = INITIAL_ROW_COUNT, roomUid = nextRoomUid() }) {
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    for (let row = 1; row <= rowCount; row += 1) {
      records.push(createFinishRecord({
        areaCode,
        roomPosition,
        floor,
        roomNo,
        roomName,
        roomNote,
        position: computeCellPosition(partIndex, row),
        part: defaultPartName(areaCode, partIndex),
        roomUid
      }));
    }
  }
  return records;
}

function buildFloorRoomSeed(areaCode, floor, index) {
  const roomPosition = buildFloorRoomPosition(floor, index);
  const prefix = areaCode === 'B' ? `B${floor}` : String(floor);
  const label = `${prefix}-${index}`;
  return createRoomRecords({ areaCode, roomPosition, floor, roomNo: label, roomName: '', roomNote: '' });
}

function buildFlatRoomSeed(areaCode, index, customName = '') {
  const roomPosition = pad(index, 3);
  let roomNo = customName;
  let roomName = customName;
  if (!customName && areaCode === 'S') { roomNo = `S-${index}`; roomName = `階段${index}`; }
  if (!customName && areaCode === 'R') { roomNo = `R-${index}`; roomName = index === 1 ? '屋上' : `屋上${index}`; }
  if (!customName && areaCode === 'E') { roomNo = `面${index}`; roomName = ''; }
  return createRoomRecords({ areaCode, roomPosition, floor: null, roomNo, roomName, roomNote: '' });
}

function rekeyRecordToRoomPosition(record, newRoomPosition) {
  const oldId = record.finishId;
  const nextId = computeFinishId(record.areaCode, newRoomPosition, record.position);
  if (oldId === nextId) return record;
  return {
    ...record,
    roomPosition: newRoomPosition,
    finishId: nextId,
    updatedAt: nowIso()
  };
}

function roomCarrierRecord(roomRecords = []) {
  const standardCarrierPosition = computeCellPosition(PART_COUNT, INITIAL_ROW_COUNT);
  return roomRecords.find((record) => Number(record.position) === standardCarrierPosition) || null;
}

function isFinishCellAtDefault(record) {
  if (!record) return true;
  if (String(record.materialId || '')) return false;

  const materialName = String(record.materialName || '').trim();
  const partIndex = partIndexFromPosition(record.position);
  if (partIndex >= 5) {
    return !(materialName && String(record.part || '').trim());
  }

  if (materialName) return false;
  return String(record.part || '') === String(defaultPartForRecord(record) || '');
}

function hasRoomCommonDifference(record) {
  if (!record) return false;
  const defaults = defaultRoomFieldsForRecord(record);
  return String(record.roomNo || '') !== String(defaults.roomNo || '')
    || String(record.roomName || '') !== String(defaults.roomName || '')
    || String(record.roomNote || '') !== String(defaults.roomNote || '');
}

function shouldKeepSparseFinishRecord(record, allRecords = finishRecordStore.getAll()) {
  if (!record?.finishId) return false;
  if (getRequiredStructureRecordIds(allRecords).has(record.finishId)) return true;
  if (!isFinishCellAtDefault(record)) return true;
  const carrier = roomCarrierRecord(allRecords.filter((item) => item.roomUid === record.roomUid && item.status === 'active'));
  if (carrier?.finishId === record.finishId && hasRoomCommonDifference(record)) return true;
  if (String(record.systemMemo || '').trim()) return true;
  return false;
}

function persistSparseFinishRecord(project, record, allRecords = finishRecordStore.getAll()) {
  if (!project?.projectId || project.isSample || !record?.finishId) return;
  if (shouldKeepSparseFinishRecord(record, allRecords)) {
    persistFinishForProject(project, record, 'finish-sparse-cell');
    return;
  }
  if (hasKnownFinishRecord(project.projectId, record.finishId)) deleteFinishForProject(project, record, 'finish-sparse-reset');
}

function persistAddedStructureMarker(records = []) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample || !records.length) return;
  const marker = roomCarrierRecord(records);
  if (marker) persistFinishForProject(project, marker, 'finish-structure-marker');
}

const STRUCTURE_COMPARE_FIELDS = Object.freeze([
  'finishId', 'areaCode', 'roomPosition', 'floor', 'roomNo', 'roomName', 'roomNote',
  'position', 'part', 'materialId', 'materialName'
]);

function sameStructureRecord(a, b) {
  if (!a || !b) return false;
  return STRUCTURE_COMPARE_FIELDS.every((field) => String(a[field] ?? '') === String(b[field] ?? ''));
}

function persistFinishStructureChange(beforeRecords, afterRecords) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return;

  const beforeMap = new Map(beforeRecords.map((record) => [record.finishId, record]));
  const afterMap = new Map(afterRecords.map((record) => [record.finishId, record]));

  const removed = beforeRecords.filter((record) => !afterMap.has(record.finishId));
  const changed = afterRecords.filter((record) => {
    const previous = beforeMap.get(record.finishId);
    return !previous || !sameStructureRecord(previous, record);
  });

  changed.forEach((record) => persistSparseFinishRecord(project, record, afterRecords));
  removed.forEach((record) => {
    if (hasKnownFinishRecord(project.projectId, record.finishId)) deleteFinishForProject(project, record, 'finish-sparse-reset');
  });
}

function listFloorNumbers(areaCode) {
  return [...new Set(uniqueRoomAnchors(areaCode).map((record) => Number(record.floor)))];
}

function countRoomsInFloor(areaCode, floor) { return uniqueRoomAnchors(areaCode, floor).length; }
function countFlatRooms(areaCode) { return uniqueRoomAnchors(areaCode).length; }

function insertFloorRoomAt(areaCode, floor, insertIndex) {
  const before = finishRecordStore.getAll();
  const shifted = before.map((record) => {
    if (record.areaCode !== areaCode || Number(record.floor) !== floor) return record;
    const idx = roomIndexFromRoomPosition(record.roomPosition);
    return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, buildFloorRoomPosition(floor, idx + 1));
  });
  finishRecordStore.replaceAll([...shifted, ...buildFloorRoomSeed(areaCode, floor, insertIndex)]);
  persistFinishStructureChange(before, finishRecordStore.getAll());
}

function insertFlatRoomAt(areaCode, insertIndex) {
  const before = finishRecordStore.getAll();
  const shifted = before.map((record) => {
    if (record.areaCode !== areaCode) return record;
    const idx = Number(record.roomPosition);
    return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, pad(idx + 1, 3));
  });
  finishRecordStore.replaceAll([...shifted, ...buildFlatRoomSeed(areaCode, insertIndex)]);
  persistFinishStructureChange(before, finishRecordStore.getAll());
}

export function addNormalFloor() {
  const floors = listFloorNumbers('I');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('I', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === ROOMS_PER_FLOOR));
  return `floor-I-${next}`;
}

export function addBasementFloor() {
  const floors = listFloorNumbers('B');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('B', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === ROOMS_PER_FLOOR));
  return `floor-B-${next}`;
}

export function addStairs() {
  const records = buildFlatRoomSeed('S', countFlatRooms('S') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
  return 'stairs-group';
}

export function addRoof() {
  const records = buildFlatRoomSeed('R', countFlatRooms('R') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
  return 'roof-group';
}

export function addExternalRoom() {
  const records = buildFlatRoomSeed('E', countFlatRooms('E') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addRoomToFloor(floorKey) {
  const parsed = parseFloorKey(floorKey);
  if (!parsed) return;
  const index = countRoomsInFloor(parsed.areaCode, parsed.floor) + 1;
  const records = buildFloorRoomSeed(parsed.areaCode, parsed.floor, index);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addRoomAfter(roomKey) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return;
  if (anchor.areaCode === 'I' || anchor.areaCode === 'B') {
    insertFloorRoomAt(anchor.areaCode, Number(anchor.floor), roomIndexFromRoomPosition(anchor.roomPosition) + 1);
  } else {
    insertFlatRoomAt(anchor.areaCode, Number(anchor.roomPosition) + 1);
  }
}

export function addInputRow(roomKey) {
  const before = finishRecordStore.getAll();
  const roomRecords = getRoomRecords(roomKey);
  const anchor = roomRecords[0];
  if (!anchor) return;
  const maxRow = Math.max(...roomRecords.map((record) => rowFromPosition(record.position)), 0);
  const nextRow = maxRow + 1;
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    records.push(createFinishRecord({
      areaCode: anchor.areaCode,
      roomPosition: anchor.roomPosition,
      floor: anchor.floor,
      roomNo: anchor.roomNo,
      roomName: anchor.roomName,
      roomNote: anchor.roomNote,
      position: computeCellPosition(partIndex, nextRow),
      part: defaultPartName(anchor.areaCode, partIndex),
      roomUid: anchor.roomUid
    }));
  }
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  const marker = records.find((record) => partIndexFromPosition(record.position) === PART_COUNT);
  if (marker) persistFinishForProject(getCurrentProject(), marker, 'finish-structure-marker');
}

export function commitRoomField(roomKey, field, rawValue) {
  const records = getRoomRecords(roomKey);
  if (!records.length) return;

  const fieldMap = {
    'room-no': 'roomNo',
    'room-name': 'roomName',
    'room-note': 'roomNote'
  };
  const dataField = fieldMap[field];
  if (!dataField) return;

  const value = dataField === 'roomNo' ? String(rawValue ?? '').trim() : String(rawValue ?? '');
  const changed = records.filter((record) => String(record[dataField] ?? '') !== value);
  if (!changed.length) return;

  const confirmedAt = Date.now();
  const nextRecords = changed.map((record) => ({
    ...record,
    [dataField]: value,
    fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, dataField, confirmedAt)
  }));
  finishRecordStore.batch(() => nextRecords.forEach((record) => finishRecordStore.set(record)));

  const project = getCurrentProject();
  const currentRoomRecords = getRoomRecords(roomKey);
  const carrier = roomCarrierRecord(currentRoomRecords);
  if (carrier) persistSparseFinishRecord(project, carrier, finishRecordStore.getAll());

  if (dataField === 'roomNo' || dataField === 'roomName') {
    refreshMaterialUsageDerivedFields('room-common-edit');
  }
}

function cellFinishId(anchor, partIndex, row) {
  return computeFinishId(anchor.areaCode, anchor.roomPosition, computeCellPosition(partIndex, row));
}

function writeCellPatch(anchor, partIndex, row, patch, options = {}) {
  const finishId = cellFinishId(anchor, partIndex, row);
  const existing = finishRecordStore.get(finishId);
  if (!existing) throw new Error(`仕上表レコードが存在しません: ${finishId}`);

  const changedFields = Object.keys(patch).filter((field) => String(existing[field] ?? '') !== String(patch[field] ?? ''));
  if (!changedFields.length) return existing;
  const syncFields = changedFields.filter((field) => PERSISTED_FINISH_EDIT_FIELDS.has(field));

  const next = {
    ...existing,
    ...patch,
    fieldEditedAt: syncFields.length
      ? touchFieldEditedAt(existing.fieldEditedAt, syncFields)
      : { ...(existing.fieldEditedAt || {}) }
  };
  finishRecordStore.set(next);
  if (syncFields.length) persistSparseFinishRecord(getCurrentProject(), next, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('finish-cell-patch', { persist: options.persistMaterialDerived !== false });
  return next;
}

export function commitCellId(roomKey, partIndex, row, rawInputId) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const inputId = String(rawInputId ?? '').trim();
  const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));

  if (!inputId) {
    writeCellPatch(anchor, partIndex, row, {
      inputId: '',
      materialId: '',
      materialName: '',
      ...(partIndex >= 5 ? { part: '' } : {})
    });
    return null;
  }

  const material = materialRecordStore.findByInputId(inputId);
  if (!material) {
    writeCellPatch(anchor, partIndex, row, { inputId, materialId: '', materialName: '' });
    return null;
  }

  writeCellPatch(anchor, partIndex, row, {
    inputId: String(material.inputId),
    materialId: material.materialId,
    materialName: '',
    ...partPatchForExistingMaterial(currentCell, partIndex, material)
  });
  return material;
}

export function commitCellName(roomKey, partIndex, row, rawName) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const name = normalizeCandidateMaterialInput(rawName);
  if (!name) {
    writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '', materialName: '' });
    return null;
  }
  const material = materialRecordStore.findByName(name);
  if (material) {
    writeCellPatch(anchor, partIndex, row, {
      inputId: String(material.inputId),
      materialId: material.materialId,
      materialName: ''
    });
    return material;
  }

  writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '', materialName: name });
  return null;
}

export function commitCellActualPart(roomKey, partIndex, row, rawValue) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return;
  writeCellPatch(anchor, partIndex, row, { part: String(rawValue ?? '') });
  refreshMaterialUsageDerivedFields('actual-part-edit');
}

export function isCellPendingRegistration(roomKey, partIndex, row) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return false;
  const record = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
  return Boolean(record?.materialName) && !record.materialId;
}

export function applyMaterialToCell(roomKey, partIndex, row, materialRecord) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor || !materialRecord) return;
  const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
  writeCellPatch(anchor, partIndex, row, {
    inputId: String(materialRecord.inputId),
    materialId: materialRecord.materialId,
    materialName: '',
    ...partPatchForExistingMaterial(currentCell, partIndex, materialRecord)
  });
}

function nextInputIdForMaterials() {
  const ids = materialRecordStore.getAll().map((m) => Number(m.inputId) || 0);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function registerMaterialForCell(roomKey, partIndex, row, rawName) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  const normalized = normalizeCandidateMaterialInput(rawName);
  if (!anchor || !normalized) return null;

  let material = materialRecordStore.findByName(normalized);
  let createdNewMaterial = false;
  let beforeMaterial = material ? { ...material } : null;

  runRecordTransaction(() => {
    if (!material) {
      const parsed = splitBaseNameAndSuffix(normalized);
      const suffix = parsed.suffixLetter || nextMaterialSuffix(parsed.baseName, materialRecordStore.getAll());
      const finalName = parsed.suffixLetter ? normalized : `${parsed.baseName}${suffix}`;

      material = materialRecordStore.findByName(finalName);
      if (material && !beforeMaterial) beforeMaterial = { ...material };
      if (!material) {
        const inputId = nextInputIdForMaterials();
        material = createMaterialRecord({
          materialId: nextMaterialId(materialRecordStore.getAll().map((m) => m.materialId)),
          inputId,
          materialNo: inputId,
          name: finalName,
          baseName: parsed.baseName,
          suffixLetter: suffix
        });
        material = {
          ...material,
          fieldEditedAt: touchFieldEditedAt(material.fieldEditedAt, ['name', 'analysisRequired', 'sampleCount'])
        };
        materialRecordStore.set(material);
        createdNewMaterial = true;
      }
    }

    const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
    const finishPatch = {
      inputId: String(material.inputId),
      materialId: material.materialId,
      materialName: ''
    };
    if (partIndex >= 5 && !String(currentCell?.part || '').trim()) {
      finishPatch.part = 'その他';
    }

    writeCellPatch(anchor, partIndex, row, finishPatch, { persistMaterialDerived: false });

    const derivedMaterial = materialRecordStore.get(material.materialId) || material;
    const finalMaterial = { ...derivedMaterial };
    const autofillFields = applySingleRecordSamplingAutofill(finalMaterial);
    if (autofillFields.length) {
      finalMaterial.fieldEditedAt = touchFieldEditedAt(derivedMaterial.fieldEditedAt, autofillFields);
      materialRecordStore.set(finalMaterial);
    }

    material = materialRecordStore.get(material.materialId) || finalMaterial;

    const materialChanged = createdNewMaterial
      || !beforeMaterial
      || String(beforeMaterial.part ?? '') !== String(material.part ?? '')
      || String(beforeMaterial.usageLocation ?? '') !== String(material.usageLocation ?? '')
      || autofillFields.length > 0;
    if (materialChanged) {
      persistMaterialForProject(getCurrentProject(), material, 'material-register-final');
    }
  });
  return material;
}

export function refreshMaterialUsageDerivedFields(source = 'usageLocation-recalc', options = {}) {
  const shouldPersist = options.persist !== false;
  const finishRecords = finishRecordStore.getAll().filter((record) => record.status === 'active' && record.materialId);
  const byMaterial = new Map();
  finishRecords.forEach((record) => {
    if (!byMaterial.has(record.materialId)) byMaterial.set(record.materialId, { parts: [], places: [] });
    const item = byMaterial.get(record.materialId);
    const part = String(record.part || '').trim();
    const place = String(record.roomNo || record.roomName || '').trim();
    if (part && !item.parts.includes(part)) item.parts.push(part);
    if (place && !item.places.includes(place)) item.places.push(place);
  });

  materialRecordStore.batch(() => {
    materialRecordStore.getAll().forEach((material) => {
      const derived = byMaterial.get(material.materialId) || { parts: [], places: [] };
      const part = derived.parts.join('、');
      const usageLocation = derived.places.join('、');
      if (material.part === part && material.usageLocation === usageLocation) return;
      const next = {
        ...material,
        part,
        usageLocation,
        fieldEditedAt: touchFieldEditedAt(material.fieldEditedAt, ['part', 'usageLocation'])
      };
      materialRecordStore.set(next);
      if (shouldPersist) persistMaterialForProject(getCurrentProject(), next, source);
    });
  });
}

function materialUsageSortKey(record) {
  const areaCode = String(record?.areaCode || '');
  const floor = Number(record?.floor);
  const position = String(record?.roomPosition || '');
  if (areaCode === 'E') return [0, 0, position];
  if (areaCode === 'B') return [1, Number.isFinite(floor) ? floor : 0, position];
  if (areaCode === 'I' && floor === 1) return [2, 1, position];
  if (areaCode === 'S') return [3, 0, position];
  if (areaCode === 'I') return [4, Number.isFinite(floor) ? floor : 9999, position];
  if (areaCode === 'R') return [5, 0, position];
  return [6, Number.isFinite(floor) ? floor : 9999, position];
}

function compareMaterialUsageRecords(a, b) {
  const ak = materialUsageSortKey(a);
  const bk = materialUsageSortKey(b);
  for (let i = 0; i < ak.length; i += 1) {
    if (ak[i] < bk[i]) return -1;
    if (ak[i] > bk[i]) return 1;
  }
  return 0;
}

export function getMaterialUsageRoomLabels(inputId, { preferRoomName = false } = {}) {
  const material = materialRecordStore.findByInputId(inputId);
  if (!material) return [];

  const byRoom = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.materialId !== material.materialId) return;
    const key = record.roomUid || `${record.areaCode}|${record.roomPosition}`;
    if (!byRoom.has(key)) byRoom.set(key, record);
  });

  return [...byRoom.values()]
    .sort(compareMaterialUsageRecords)
    .map((record) => {
      const roomNo = String(record.roomNo || '').trim();
      const roomName = String(record.roomName || '').trim();
      return preferRoomName ? (roomName || roomNo) : roomNo;
    })
    .filter(Boolean);
}

export function getMaterialUsageRoomNos(inputId) {
  return getMaterialUsageRoomLabels(inputId, { preferRoomName: false });
}

function sameAreaFamily(a, b) {
  const familyOf = (code) => (code === 'E' ? 'external' : 'internal');
  return !!a && !!b && familyOf(a) === familyOf(b);
}

export function getRoomCopyButtonState(roomCopyState, roomKey) {
  if (roomCopyState.done[roomKey]) return 'restore';
  if (roomCopyState.sourceRoomKey === roomKey) return 'source';
  if (roomCopyState.sourceRoomKey) return roomHasRecordedContent(roomKey) ? 'target-overwrite' : 'target-empty';
  return 'idle';
}

export function describeRoomCopyClick(roomCopyState, roomKey) {
  const target = findRepresentativeByRoomKey(roomKey);
  if (!target) return { type: 'none' };
  if (roomCopyState.done[roomKey]) return { type: 'restore' };
  if (!roomCopyState.sourceRoomKey) return { type: 'become-source' };
  if (roomCopyState.sourceRoomKey === roomKey) return { type: 'cancel-source' };
  const source = findRepresentativeByRoomKey(roomCopyState.sourceRoomKey);
  return {
    type: 'copy',
    crossFamily: !sameAreaFamily(source?.areaCode, target.areaCode),
    overwrite: roomHasRecordedContent(roomKey)
  };
}

export function executeRoomCopy(sourceRoomKey, targetRoomKey) {
  const before = finishRecordStore.getAll();
  const sourceRecords = getRoomRecords(sourceRoomKey);
  const targetRecords = getRoomRecords(targetRoomKey);
  const target = targetRecords[0];
  if (!sourceRecords.length || !target) return;

  const sourcePositions = new Set(sourceRecords.map((record) => record.position));
  const targetByPosition = new Map(targetRecords.map((record) => [record.position, record]));
  const confirmedAt = Date.now();

  finishRecordStore.batch(() => {
    targetRecords.forEach((record) => {
      if (!sourcePositions.has(record.position)) finishRecordStore.remove(record.finishId);
    });

    sourceRecords.forEach((source) => {
      const partIndex = partIndexFromPosition(source.position);
      const part = partIndex >= 5 ? String(source.part || '').trim() : defaultPartName(target.areaCode, partIndex);
      const existing = targetByPosition.get(source.position);

      if (existing) {
        const changedFields = [];
        if (String(existing.part || '') !== String(part || '')) changedFields.push('part');
        if (String(existing.materialId || '') !== String(source.materialId || '')) changedFields.push('materialId');
        if (String(existing.materialName || '') !== String(source.materialName || '')) changedFields.push('materialName');
        finishRecordStore.set({
          ...existing,
          part,
          materialId: source.materialId,
          materialName: String(source.materialName || ''),
          inputId: source.inputId,
          fieldEditedAt: changedFields.length
            ? touchFieldEditedAt(existing.fieldEditedAt, changedFields, confirmedAt)
            : { ...(existing.fieldEditedAt || {}) },
          updatedAt: nowIso()
        });
        return;
      }

      finishRecordStore.set(createFinishRecord({
        areaCode: target.areaCode,
        roomPosition: target.roomPosition,
        floor: target.floor,
        roomNo: target.roomNo,
        roomName: target.roomName,
        roomNote: target.roomNote,
        position: source.position,
        part,
        materialId: source.materialId,
        materialName: String(source.materialName || ''),
        inputId: source.inputId,
        fieldEditedAt: touchFieldEditedAt({}, ['part', 'materialId', 'materialName'], confirmedAt),
        roomUid: target.roomUid
      }));
    });
  });
  persistFinishStructureChange(before, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-copy');
}

export function restoreRoomCopy(roomKey, backupRecords) {
  if (!backupRecords?.length) return;
  const before = finishRecordStore.getAll();
  const current = getRoomRecords(roomKey);
  finishRecordStore.batch(() => {
    current.forEach((record) => finishRecordStore.remove(record.finishId));
    backupRecords.forEach((record) => finishRecordStore.set({ ...record }));
  });
  persistFinishStructureChange(before, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-copy-restore');
}

export function seedInitialMaterials() {
  const records = SAMPLE_MATERIALS_SEED.map(([materialId, inputId, name, note, photoCount]) => {
    const samplingDemo = materialId === 'R001'
      ? { analysisRequired: '採取・分析', sampleCount: 2, sampleLocation1: '1-1', sampleLocation2: '1-2', samplePart: '壁' }
      : materialId === 'R002'
        ? { analysisRequired: '採取・分析', sampleCount: 1, sampleLocation1: '北面', samplePart: '外壁' }
        : {};

    return createMaterialRecord({
      materialId,
      inputId,
      materialNo: inputId,
      name: normalizeMaterialName(name),
      note,
      photoCount,
      ...samplingDemo
    });
  });
  materialRecordStore.batch(() => records.forEach((record) => materialRecordStore.set(record)));
}

function assignSampleMaterialsToFinishRecords(records) {
  const materials = materialRecordStore.getAll().filter((material) => material.status === 'active');
  if (!materials.length || !records.length) return records;

  const sampleOtherParts = ['窓枠', '配管', '梁', '柱', '貫通部', '床下', '壁部'];

  let seed = 15103;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const applySampleMaterial = (record, material) => {
    const partIndex = partIndexFromPosition(record.position);
    const next = {
      ...record,
      materialId: material.materialId,
      materialName: '',
      inputId: String(material.inputId)
    };

    if (partIndex >= 5) {
      next.part = sampleOtherParts[Math.floor(random() * sampleOtherParts.length)];
    }
    return next;
  };

  const indices = records.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const used = new Set();
  materials.forEach((material, materialIndex) => {
    const index = indices[materialIndex % indices.length];
    records[index] = applySampleMaterial(records[index], material);
    used.add(index);
  });

  records.forEach((record, index) => {
    if (used.has(index) || random() >= 0.28) return;
    const material = materials[Math.floor(random() * materials.length)];
    records[index] = applySampleMaterial(record, material);
  });

  return records;
}

export function seedInitialFinishRecords() {
  const records = [];
  INITIAL_STRUCTURE_SEED.floors.forEach(({ areaCode, floor, roomCount }) => {
    for (let i = 1; i <= roomCount; i += 1) records.push(...buildFloorRoomSeed(areaCode, floor, i));
  });
  for (let i = 1; i <= INITIAL_STRUCTURE_SEED.stairsCount; i += 1) records.push(...buildFlatRoomSeed('S', i));
  for (let i = 1; i <= INITIAL_STRUCTURE_SEED.roofCount; i += 1) records.push(...buildFlatRoomSeed('R', i));
  INITIAL_STRUCTURE_SEED.externalRoomNames.forEach((name, index) => {
    records.push(...buildFlatRoomSeed('E', index + 1, name));
  });
  assignSampleMaterialsToFinishRecords(records);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  refreshMaterialUsageDerivedFields('seed-initial-finish');
}

export function runRecordTransaction(mutate) {
  finishRecordStore.batch(() => {
    materialRecordStore.batch(() => {
      photoRecordStore.batch(() => mutate());
    });
  });
}

export { finishRecordStore, materialRecordStore };
