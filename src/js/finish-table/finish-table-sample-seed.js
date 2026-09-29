/**
 * サンプル案件用の建材・仕上表初期データ生成。
 */
import { partIndexFromPosition } from '../records/finish-record.js';
import {
  createMaterialRecord,
  normalizeMaterialName
} from '../records/material-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { INITIAL_STRUCTURE_SEED } from '../demo/sample-finish-data.js';
import { SAMPLE_MATERIALS_SEED } from '../demo/sample-materials.js';
import { buildFloorRoomSeed, buildFlatRoomSeed } from './finish-table-structure-actions.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';

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
    if (partIndex >= 5) next.part = sampleOtherParts[Math.floor(random() * sampleOtherParts.length)];
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
