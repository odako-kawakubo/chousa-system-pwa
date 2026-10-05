/**
 * 建材の部位・使用箇所など、finishRecordから派生する値を担当する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistMaterialForProject } from '../sync/project-record-persistence.js';

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

export function getMaterialUsageRoomOptions(inputId, { preferRoomName = false } = {}) {
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
      const useRoomName = Boolean(preferRoomName && roomName);
      const value = roomNo || roomName;
      if (!value) return null;
      return {
        value,
        display: useRoomName ? roomName : value,
        label: useRoomName ? '部屋名' : '部屋No.',
        roomNo,
        roomName
      };
    })
    .filter(Boolean);
}

export function getMaterialUsageRoomLabels(inputId, { preferRoomName = false } = {}) {
  return getMaterialUsageRoomOptions(inputId, { preferRoomName }).map((item) => item.display);
}

export function getMaterialSampleLocationDisplay(inputId, location, { preferRoomName = false } = {}) {
  const raw = String(location || '').trim();
  if (!raw) return { value:'', label: preferRoomName ? '部屋名' : '部屋No.', roomNo:'', roomName:'' };

  const options = getMaterialUsageRoomOptions(inputId, { preferRoomName });
  const matched = options.find((item) => item.roomNo === raw || item.roomName === raw || item.value === raw);
  if (matched) return { value: matched.display, label: matched.label, roomNo: matched.roomNo, roomName: matched.roomName };
  return { value: raw, label:'部屋No.', roomNo:raw, roomName:'' };
}

export function getMaterialUsageRoomNos(inputId) {
  return getMaterialUsageRoomLabels(inputId, { preferRoomName: false });
}
