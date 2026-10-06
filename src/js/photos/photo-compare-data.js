/**
 * src/js/photos/photo-compare-data.js
 *
 * Photo Compare用の候補データを組み立てる。
 * Viewer DOM/状態は持たず、photo / finish / material Recordの関係だけを解決する。
 *
 * 目視比較は「部位 -> 建材ベース名 -> 場所」で絞り込めるよう、
 * 各比較targetへ part / baseNames / room情報を付与する。
 * targetの物理identityは従来どおり areaCode + roomPosition + partSlot を維持する。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import {
  PHOTO_TYPES,
  getVisualPhotoRoomKey,
  getVisualPhotoTargetKey
} from '../records/photo-record.js';

function text(value) {
  return String(value ?? '').trim();
}

function naturalCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ja', { numeric:true, sensitivity:'base' });
}

function finishPartSlot(record) {
  return Math.floor(Number(record?.position || 0) / 100);
}

function visualRoomInfo() {
  const rooms = new Map();

  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || !record.areaCode || !record.roomPosition) return;
    const key = getVisualPhotoRoomKey(record);
    if (rooms.has(key)) return;
    rooms.set(key, {
      areaCode: record.areaCode,
      roomPosition: record.roomPosition,
      roomNo: text(record.roomNo),
      roomName: text(record.roomName)
    });
  });

  return rooms;
}

function materialMap() {
  return new Map(
    materialRecordStore.getAll()
      .filter((record) => record.status === 'active')
      .map((record) => [String(record.materialId || ''), record])
  );
}

function finishRecordsByVisualTarget() {
  const groups = new Map();

  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || !record.areaCode || !record.roomPosition) return;
    const partSlot = finishPartSlot(record);
    if (!partSlot) return;
    const key = getVisualPhotoTargetKey({
      areaCode: record.areaCode,
      roomPosition: record.roomPosition,
      partSlot
    });
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  return groups;
}

function targetMaterials(records, materialsById) {
  const seen = new Set();
  const materials = [];

  records.forEach((record) => {
    const materialId = String(record.materialId || '');
    if (!materialId || seen.has(materialId)) return;
    const material = materialsById.get(materialId);
    if (!material) return;
    seen.add(materialId);
    materials.push({
      materialId,
      inputId: String(record.inputId || material.inputId || ''),
      name: text(material.name),
      baseName: text(material.baseName || material.name)
    });
  });

  return materials.sort((a, b) => {
    const inputDiff = Number(a.inputId || 0) - Number(b.inputId || 0);
    return inputDiff || naturalCompare(a.name, b.name);
  });
}

function roomLabel(room, fallbackPosition = '') {
  const no = text(room?.roomNo || fallbackPosition || '-');
  const name = text(room?.roomName);
  return name && name !== no ? `${no} ${name}` : no;
}

function uniqueOptions(values) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result.sort(naturalCompare);
}

/**
 * 現案件の整理済み目視写真を、比較用target単位へまとめる。
 * 写真自身にmaterialIdは無いため、建材/baseNameは同じ物理部位のfinishRecordから解決する。
 */
export function buildVisualCompareTargets() {
  const rooms = visualRoomInfo();
  const finishByTarget = finishRecordsByVisualTarget();
  const materialsById = materialMap();
  const photoGroups = new Map();

  photoRecordStore.getActive()
    .filter((photo) => photo.photoType === PHOTO_TYPES.VISUAL)
    .forEach((photo) => {
      const key = getVisualPhotoTargetKey(photo);
      if (!key) return;
      if (!photoGroups.has(key)) {
        photoGroups.set(key, {
          key,
          photoType: PHOTO_TYPES.VISUAL,
          areaCode: photo.areaCode,
          roomPosition: photo.roomPosition,
          partSlot: Number(photo.partSlot || 0),
          part: text(photo.part),
          photos: []
        });
      }
      const group = photoGroups.get(key);
      if (!group.part && photo.part) group.part = text(photo.part);
      group.photos.push(photo);
    });

  return [...photoGroups.values()].map((group) => {
    const room = rooms.get(getVisualPhotoRoomKey(group)) || {};
    const finishRecords = finishByTarget.get(group.key) || [];
    const materials = targetMaterials(finishRecords, materialsById);
    const finishPart = text(finishRecords.find((record) => text(record.part))?.part);
    const part = group.part || finishPart || `部位${group.partSlot}`;
    const label = roomLabel(room, group.roomPosition);
    const baseNames = uniqueOptions(materials.map((material) => material.baseName));

    return {
      ...group,
      roomNo: text(room.roomNo),
      roomName: text(room.roomName),
      roomLabel: label,
      part,
      partFilter: part,
      materials,
      baseNames,
      label: `${label} / ${part}`,
      photos: group.photos.slice().sort((a, b) =>
        naturalCompare(a.capturedAt, b.capturedAt) || naturalCompare(a.photoId, b.photoId)
      )
    };
  }).sort((a, b) =>
    naturalCompare(a.part, b.part)
    || naturalCompare(a.roomLabel, b.roomLabel)
    || Number(a.partSlot || 0) - Number(b.partSlot || 0)
  );
}

/**
 * 現行Viewer互換。preferredMaterialIdは候補を削らず先頭へ寄せるだけ。
 * Eで3連ソートUIへ移行するまで既存比較の挙動を維持する。
 */
export function visualCompareTargets(context = {}) {
  const preferredMaterialId = text(context.preferredMaterialId);
  const targets = buildVisualCompareTargets();
  if (!preferredMaterialId) {
    return targets.slice().sort((a, b) => naturalCompare(a.label, b.label));
  }

  return targets.slice().sort((a, b) => {
    const ap = a.materials.some((material) => material.materialId === preferredMaterialId);
    const bp = b.materials.some((material) => material.materialId === preferredMaterialId);
    if (ap !== bp) return ap ? -1 : 1;
    return naturalCompare(a.label, b.label);
  });
}

export function visualComparePartOptions(targets = buildVisualCompareTargets()) {
  return uniqueOptions(targets.map((target) => target.partFilter));
}

export function visualCompareBaseNameOptions(targets = buildVisualCompareTargets(), part = '') {
  const partValue = text(part);
  return uniqueOptions(
    targets
      .filter((target) => !partValue || target.partFilter === partValue)
      .flatMap((target) => target.baseNames)
  );
}

export function visualCompareLocationOptions(
  targets = buildVisualCompareTargets(),
  { part = '', baseName = '' } = {}
) {
  const partValue = text(part);
  const baseValue = text(baseName);

  return targets
    .filter((target) => !partValue || target.partFilter === partValue)
    .filter((target) => !baseValue || target.baseNames.includes(baseValue))
    .map((target) => ({
      key: target.key,
      roomLabel: target.roomLabel,
      part: target.part,
      materials: target.materials,
      label: target.roomLabel
    }));
}

export function findVisualCompareTarget(
  targets = buildVisualCompareTargets(),
  { key = '', part = '', baseName = '' } = {}
) {
  const keyValue = text(key);
  const partValue = text(part);
  const baseValue = text(baseName);

  return targets.find((target) => (
    (!keyValue || target.key === keyValue)
    && (!partValue || target.partFilter === partValue)
    && (!baseValue || target.baseNames.includes(baseValue))
  )) || null;
}
