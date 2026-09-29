import {
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  createFinishRecord
} from '../records/finish-record.js';
import {
  createMaterialRecord,
  normalizeMaterialName
} from '../records/material-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';

import { INITIAL_STRUCTURE_SEED } from '../demo/sample-finish-data.js';
import { SAMPLE_MATERIALS_SEED } from '../demo/sample-materials.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { roomCarrierRecord, persistSparseFinishRecord, persistFinishStructureChange } from './finish-table-persistence.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';
import { buildFloorRoomSeed, buildFlatRoomSeed, defaultPartName } from './finish-table-structure-actions.js';

const PART_COUNT = 6;

function nowIso() { return new Date().toISOString(); }

export function roomKeyOf(record) { return record?.roomUid || ''; }

export function findRepresentativeByRoomKey(roomKey) {
  if (!roomKey) return null;
  return finishRecordStore.getAll().find((record) => record.roomUid === roomKey && record.status === 'active') || null;
}

export function floorKeyOf(areaCode, floor) { return `floor-${areaCode}-${floor}`; }

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

) {
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

) {
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

 = {}) {
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
