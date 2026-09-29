import {
  roomIndexFromRoomPosition,
  partIndexFromPosition
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
import { roomCarrierRecord, persistSparseFinishRecord } from './finish-table-persistence.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';
import { buildFloorRoomSeed, buildFlatRoomSeed } from './finish-table-structure-actions.js';

const PART_COUNT = 6;

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
