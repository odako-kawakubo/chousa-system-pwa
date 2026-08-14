/**
 * src/js/photos/photo-view-model.js
 *
 * v0.1.5.3D 写真タブ表示用ViewModel。
 *
 * 役割：
 * - 目視側は finishRecordStore を起点に「部屋・部位・使用建材」を組み立てる。
 * - 採取側は materialRecordStore の正式項目をそのまま読み、
 *   採取数 / 採取場所1〜3 / 採取部位を写真側で別管理しない。
 * - photoRecordStore から各写真グループの代表写真・追加写真を解決する。
 * - DOM操作やRecord更新は行わない。
 *
 * v0.1.5.3Dでの重要方針：
 * 1. 採取数・採取場所・採取部位の正本は建材レコード。
 * 2. 試料No.だけは採取対象建材の並びから表示用に付与する。
 * 3. 目視の「部位・使用建材」は仕上表レコードを起点に表示する。
 */

import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { getShootingTypeLabel, SHOOTING_TYPES } from '../records/photo-record.js';
import { samplePartsToText } from '../records/material-record.js';

const AREA_ORDER = Object.freeze({ E: 0, B: 1, I: 2, S: 3, R: 4 });
const SAMPLE_BRANCH_LABELS = Object.freeze(['①', '②', '③']);

export const SAMPLE_STAGE_ORDER = Object.freeze([
  SHOOTING_TYPES.BEFORE,
  SHOOTING_TYPES.DURING,
  SHOOTING_TYPES.AFTER,
  SHOOTING_TYPES.SECTION
]);

function naturalCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ja', { numeric: true, sensitivity: 'base' });
}

function compareRoom(a, b) {
  const areaDiff = (AREA_ORDER[a.areaCode] ?? 99) - (AREA_ORDER[b.areaCode] ?? 99);
  if (areaDiff) return areaDiff;

  if (a.areaCode === 'B') {
    const floorDiff = Number(b.floor || 0) - Number(a.floor || 0);
    if (floorDiff) return floorDiff;
  } else if (a.areaCode === 'I') {
    const floorDiff = Number(a.floor || 0) - Number(b.floor || 0);
    if (floorDiff) return floorDiff;
  }
  return naturalCompare(a.roomPosition, b.roomPosition);
}

function representativeFirst(photos) {
  return [...photos].sort((a, b) => {
    if (a.isRepresentative !== b.isRepresentative) return a.isRepresentative ? -1 : 1;
    const timeDiff = naturalCompare(a.capturedAt, b.capturedAt);
    if (timeDiff) return timeDiff;
    return naturalCompare(a.photoId, b.photoId);
  });
}

function getRoomRecords(roomUid) {
  return finishRecordStore.getAll().filter((record) => record.status === 'active' && record.roomUid === roomUid);
}

function buildRoomList() {
  const byRoom = new Map();

  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || !record.roomUid || byRoom.has(record.roomUid)) return;
    byRoom.set(record.roomUid, {
      roomUid: record.roomUid,
      areaCode: record.areaCode,
      roomPosition: record.roomPosition,
      floor: record.floor,
      roomNo: record.roomNo,
      roomName: record.roomName
    });
  });

  return [...byRoom.values()].sort(compareRoom).map((room) => {
    const count = photoRecordStore.getActive().filter((photo) => (
      photo.photoType === 'visual' && photo.roomPosition === room.roomPosition
    )).length;
    return { ...room, photoCount: count };
  });
}

function partIndex(record) {
  return Math.floor(Number(record.position || 0) / 100);
}

/**
 * 仕上表レコードに入っているinputId / materialIdを起点に、現在の建材名称を解決する。
 * finishRecord自体には建材名称を重複保持しないため、名称だけmaterialRecordStoreから取得する。
 * ただし「その部屋・その部位に何が使われているか」という関係の正本はfinishRecord側。
 */
function finishMaterialDisplay(record) {
  if (!record?.materialId && !record?.inputId) return null;

  const material = record.materialId
    ? materialRecordStore.get(record.materialId)
    : materialRecordStore.findByInputId(record.inputId);

  if (!material || material.status !== 'active') return null;

  const inputId = String(record.inputId || material.inputId || '').trim();
  return {
    materialId: material.materialId,
    inputId,
    name: material.name,
    label: `【${inputId}】${material.name}`
  };
}

function buildVisualTargets(room) {
  const records = getRoomRecords(room.roomUid);
  const targets = [];

  // 基本4部位は仕上表の物理枠に対応するため、入力の有無に関係なく必ず表示する。
  for (let index = 1; index <= 4; index += 1) {
    const partRecords = records.filter((record) => partIndex(record) === index);
    const label = String(partRecords[0]?.part || '').trim() || `部位${index}`;
    targets.push(buildVisualTarget(room, label, partRecords));
  }

  // その他は実際に入力された部位名単位で分ける。
  // 何も入力されていない場合でも「その他」枠を1つ表示する。
  const otherRecords = records.filter((record) => partIndex(record) >= 5);
  const otherLabels = [...new Set(otherRecords.map((record) => String(record.part || '').trim() || 'その他'))];
  if (!otherLabels.length) otherLabels.push('その他');

  otherLabels.forEach((label) => {
    const matching = otherRecords.filter((record) => (String(record.part || '').trim() || 'その他') === label);
    targets.push(buildVisualTarget(room, label, matching));
  });

  return targets;
}

function buildVisualTarget(room, part, finishRecords) {
  const materials = [];
  const seen = new Set();

  finishRecords.forEach((record) => {
    const display = finishMaterialDisplay(record);
    if (!display) return;

    // 同じ建材が同一部位の複数入力行にあっても表示は1回だけにする。
    const uniqueKey = display.materialId || display.inputId;
    if (seen.has(uniqueKey)) return;
    seen.add(uniqueKey);
    materials.push(display);
  });

  const photos = representativeFirst(photoRecordStore.findVisual({ roomPosition: room.roomPosition, part }));

  return {
    key: `visual|${room.roomPosition}|${part}`,
    roomPosition: room.roomPosition,
    part,
    materials,
    // v0.1.5.3D: 入力済みの場合だけ簡易リストと同じ【入力ID】建材名称表記を返す。
    // 未入力時はRenderer側で「未入力」だけを表示する。
    materialText: materials.map((item) => item.label).join('、'),
    photos,
    representative: photos.find((photo) => photo.isRepresentative) || photos[0] || null,
    photoCount: photos.length
  };
}

export function buildVisualPhotoView(selectedRoomUid = '') {
  const rooms = buildRoomList();
  const activeRoom = rooms.find((room) => room.roomUid === selectedRoomUid) || rooms[0] || null;
  return {
    mode: 'visual',
    rooms,
    activeRoom,
    targets: activeRoom ? buildVisualTargets(activeRoom) : []
  };
}

/** 建材レコードの採取場所1〜3を枝番に応じてそのまま読む。 */
function samplingPlaceAt(material, branch) {
  return String(material[`sampleLocation${branch}`] || '').trim();
}

function findSamplingStagePhotos(materialId, branch, shootingType) {
  return representativeFirst(photoRecordStore.findSampling({ materialId, samplingBranch: branch, shootingType }));
}

/**
 * 1採取箇所分のViewModelを作る。
 * sampleCount / sampleLocation1〜3 / samplePartはmaterialRecordから直接参照する。
 */
function buildSamplePoint(material, branch, sampleNo) {
  const samplingPlace = samplingPlaceAt(material, branch);
  const stages = SAMPLE_STAGE_ORDER.map((shootingType) => {
    const photos = findSamplingStagePhotos(material.materialId, branch, shootingType);
    return {
      shootingType,
      label: getShootingTypeLabel(shootingType),
      photos,
      representative: photos.find((photo) => photo.isRepresentative) || photos[0] || null,
      count: photos.length
    };
  });

  // 施工前→施工中→施工後のみ必須。断面は任意なので次撮影判定から外す。
  const requiredStages = stages.filter((stage) => stage.shootingType !== SHOOTING_TYPES.SECTION);
  const nextStage = requiredStages.find((stage) => stage.count === 0)?.label || '完了';

  const branchLabel = SAMPLE_BRANCH_LABELS[branch - 1] || String(branch);

  return {
    key: `sampling|${material.materialId}|${branch}`,
    branch,
    samplingPlace,
    part: samplePartsToText(material.samplePart),
    // v0.1.5.3D: 試料No.は「採取対象建材の連番-枝番」で表示用に組み立てる。
    // 例: 1-① / 1-② / 1-③
    sampleNo: `${sampleNo}-${branchLabel}`,
    stages,
    nextStage,
    totalCount: stages.reduce((sum, stage) => sum + stage.count, 0)
  };
}

export function buildSamplingPhotoView(selectedMaterialId = '') {
  // 採取対象の抽出条件のみ写真ViewModel側で行う。
  // 採取数・採取場所・採取部位そのものはmaterialRecordの値をそのまま使用する。
  const samplingMaterials = materialRecordStore.getAll()
    .filter((record) => record.status === 'active')
    .filter((record) => record.analysisRequired === '採取・分析')
    .filter((record) => Number(record.sampleCount) >= 1 && Number(record.sampleCount) <= 3)
    .sort((a, b) => Number(a.materialNo || 0) - Number(b.materialNo || 0));

  const materials = samplingMaterials.map((material, index) => {
    const sampleNo = index + 1;
    const sampleCount = Math.max(1, Math.min(3, Number(material.sampleCount) || 1));
    const points = [];

    for (let branch = 1; branch <= sampleCount; branch += 1) {
      points.push(buildSamplePoint(material, branch, sampleNo));
    }

    return {
      materialId: material.materialId,
      materialNo: material.materialNo,
      inputId: material.inputId,
      sampleNo,
      sampleCount,
      name: material.name,
      part: material.part,
      samplePart: samplePartsToText(material.samplePart),
      sampleLocation1: material.sampleLocation1,
      sampleLocation2: material.sampleLocation2,
      sampleLocation3: material.sampleLocation3,
      color: material.color,
      points,
      photoCount: points.reduce((sum, point) => sum + point.totalCount, 0)
    };
  });

  const activeMaterial = materials.find((material) => material.materialId === selectedMaterialId) || materials[0] || null;
  return { mode: 'sampling', materials, activeMaterial };
}
