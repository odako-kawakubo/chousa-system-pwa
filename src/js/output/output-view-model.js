/**
 * src/js/output/output-view-model.js
 * 「出力」タブ専用の読み取りViewModel。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { partIndexFromPosition } from '../records/finish-record.js';
import { getCurrentProject } from '../projects/project-store.js';
import { samplePartsToText } from '../records/material-record.js';
import { SHOOTING_TYPES } from '../records/photo-record.js';
import { getVisualOutputPhotoId, getSamplingOutputPhotoId, clearInvalidOutputSelections } from './output-state.js';

const AREA_ORDER = Object.freeze({ E: 0, B: 1, I: 2, S: 3, R: 4 });

function text(value) { return String(value ?? '').trim(); }
function natural(a, b) { return String(a ?? '').localeCompare(String(b ?? ''), 'ja', { numeric: true, sensitivity: 'base' }); }
function photoSort(a, b) {
  const time = natural(a.capturedAt, b.capturedAt);
  return time || natural(a.photoId, b.photoId);
}
function compareRoomRecord(a, b) {
  const areaDiff = (AREA_ORDER[a.areaCode] ?? 99) - (AREA_ORDER[b.areaCode] ?? 99);
  if (areaDiff) return areaDiff;
  if (a.areaCode === 'B') {
    const floorDiff = Number(b.floor || 0) - Number(a.floor || 0);
    if (floorDiff) return floorDiff;
  } else if (a.areaCode === 'I') {
    const floorDiff = Number(a.floor || 0) - Number(b.floor || 0);
    if (floorDiff) return floorDiff;
  }
  const roomDiff = natural(a.roomPosition, b.roomPosition);
  if (roomDiff) return roomDiff;
  return Number(a.position || 0) - Number(b.position || 0);
}
function floorLabel(record) {
  if (record.areaCode === 'E') return '外部';
  if (record.areaCode === 'S') return '階段';
  if (record.areaCode === 'R') return '屋上';
  if (record.areaCode === 'B') return `B${record.floor}階`;
  return `${record.floor}階`;
}
function activeMaterials() {
  return materialRecordStore.getAll().filter((record) => record.status === 'active').slice()
    .sort((a, b) => Number(a.materialNo || a.inputId || 0) - Number(b.materialNo || b.inputId || 0));
}

export function buildMaterialListOutput() {
  return activeMaterials().map((record) => ({
    materialNo: record.materialNo || record.inputId || '', name: text(record.name), part: text(record.part),
    usageLocation: text(record.usageLocation), level: text(record.level) || '-', analysisRequired: text(record.analysisRequired),
    analysisResult: text(record.analysisResult), note: text(record.remarks || record.note)
  }));
}

export function buildRoomMaterialOutput() {
  const materialById = new Map(activeMaterials().map((record) => [String(record.materialId), record]));
  return finishRecordStore.getAll().filter((record) => record.status === 'active')
    .filter((record) => record.materialId || text(record.materialName)).slice().sort(compareRoomRecord)
    .map((record) => {
      const material = record.materialId ? materialById.get(String(record.materialId)) : null;
      const partIndex = partIndexFromPosition(record.position);
      return {
        floor: floorLabel(record), roomNo: text(record.roomNo), roomName: text(record.roomName), roomNote: text(record.roomNote),
        part: partIndex >= 5 ? (text(record.part) || 'その他') : text(record.part),
        materialNo: material ? (material.materialNo || material.inputId || '') : '',
        materialName: material ? text(material.name) : text(record.materialName), note: material ? text(material.remarks || material.note) : '',
        level: material ? (text(material.level) || '-') : '-', analysisResult: material ? text(material.analysisResult) : '調査対象外',
        registered: Boolean(material)
      };
    });
}

export function buildVisualPhotoOutput() {
  const finish = finishRecordStore.getAll().filter((record) => record.status === 'active' && record.materialId).slice().sort(compareRoomRecord);
  return activeMaterials().map((material) => {
    const usages = finish.filter((record) => String(record.materialId) === String(material.materialId));
    const candidates = [];
    const seen = new Set();
    usages.forEach((usage) => {
      const partSlot = partIndexFromPosition(usage.position);
      photoRecordStore.findVisual({ areaCode: usage.areaCode, roomPosition: usage.roomPosition, partSlot })
        .slice().sort(photoSort).forEach((photo) => {
          if (seen.has(photo.photoId)) return;
          seen.add(photo.photoId);
          candidates.push({
            photo,
            photoId: photo.photoId,
            roomNo: text(usage.roomNo),
            roomName: text(usage.roomName),
            part: text(usage.part || photo.part)
          });
        });
    });
    const storedId = getVisualOutputPhotoId(material.materialId);
    const selected = candidates.find((candidate) => candidate.photoId === storedId) || candidates[0] || null;
    return {
      // 建材写真帳の表示文字は建材レコードを正本とする。
      materialNo: material.materialNo || material.inputId || '', materialId: material.materialId,
      name: text(material.name), part: text(material.part),
      photoId: text(selected?.photoId), fileName: text(selected?.photo?.fileName), roomNo: text(selected?.roomNo),
      candidates
    };
  });
}

function samplingStageCandidates(materialId, branch, shootingType) {
  return photoRecordStore.findSampling({ materialId, samplingBranch: branch, shootingType }).slice().sort(photoSort);
}
function selectedSamplingStage(materialId, branch, shootingType, label) {
  const candidates = samplingStageCandidates(materialId, branch, shootingType);
  const storedId = getSamplingOutputPhotoId(materialId, branch, shootingType);
  const selected = candidates.find((photo) => photo.photoId === storedId) || candidates[0] || null;
  return { type: shootingType, label, photoId: text(selected?.photoId), fileName: text(selected?.fileName), candidates };
}
function formatCapturedDate(photo) {
  const raw = text(photo?.capturedAt);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function buildSamplingPhotoOutput() {
  const materials = activeMaterials().filter((record) => record.analysisRequired === '採取・分析')
    .filter((record) => Number(record.sampleCount) >= 1 && Number(record.sampleCount) <= 3);
  const pages = [];
  materials.forEach((material, materialIndex) => {
    const sampleCount = Math.max(1, Math.min(3, Number(material.sampleCount) || 1));
    for (let branch = 1; branch <= sampleCount; branch += 1) {
      const stages = [
        selectedSamplingStage(material.materialId, branch, SHOOTING_TYPES.BEFORE, '施工前'),
        selectedSamplingStage(material.materialId, branch, SHOOTING_TYPES.DURING, '施工中'),
        selectedSamplingStage(material.materialId, branch, SHOOTING_TYPES.AFTER, '施工後')
      ];
      const firstSelectedStage = stages.find((stage) => stage.photoId) || null;
      const firstPhoto = firstSelectedStage
        ? firstSelectedStage.candidates.find((photo) => String(photo.photoId) === String(firstSelectedStage.photoId)) || null
        : null;
      const recordSampleNo = text(firstPhoto?.sampleNo);
      pages.push({
        materialId: material.materialId, materialNo: material.materialNo || material.inputId || '', sampleNo: recordSampleNo || String(materialIndex + 1), branch,
        projectName: text(getCurrentProject()?.projectName), projectNo: text(getCurrentProject()?.projectNo || getCurrentProject()?.projectId),
        materialName: text(material.name), part: samplePartsToText(material.samplePart) || text(material.part),
        samplingPlace: text(material[`sampleLocation${branch}`]), capturedDate: formatCapturedDate(firstPhoto), stages
      });
    }
  });
  return pages;
}

export function buildOutputViewModel() {
  const validPhotoIds = new Set(photoRecordStore.getActive().map((photo) => String(photo.photoId)));
  clearInvalidOutputSelections(validPhotoIds);
  return {
    materialRows: buildMaterialListOutput(), roomRows: buildRoomMaterialOutput(),
    visualPhotoItems: buildVisualPhotoOutput(), samplingPhotoPages: buildSamplingPhotoOutput()
  };
}
