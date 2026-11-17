/**
 * Photo Board Editorの完成画像生成と永続保存を担当する。
 * DOMイベント・編集セッション遷移・画面描画は持たない。
 */

import { PHOTO_TYPES, getShootingTypeLabel } from '../records/photo-record.js';

import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import { getAvailablePhotoFileName } from './photo-filename.js';
import { getCurrentProject } from '../projects/project-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { persistCompletedPhotoUpdate } from './photo-completed-update.js';
import {
  BOARD_POSITION_LABELS,
  BOARD_SIZE_LABELS
} from '../camera/camera-board.js';
import { composeCompletedPhotoBlob } from './photo-completed-composer.js';
import { getDeviceCode } from '../device-code.js';

import { touchFieldEditedAt } from '../sync/field-edit-meta.js';

import { settleBoardEditorEntry } from './photo-board-editor-session.js';

const MARKS = { 1: '①', 2: '②', 3: '③' };

const PHOTO_SYNC_EDIT_FIELDS = new Set([
  'fileName', 'isRepresentative', 'isEdited', 'lastEditedDevice', 'lastEditedAt',
  'deleted', 'systemMemo', 'boardPosition', 'boardSize', 'boardDate', 'originalPath', 'completedPath',
  'buildingId', 'areaCode', 'roomPosition', 'partSlot', 'roomNo',
  'materialId', 'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType'
]);

export function formatBoardSampleNo(base, branch) {
  return `${base || ''}${MARKS[branch] ? `-${MARKS[branch]}` : ''}`;
}

function memoValue(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function dateInputValue(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateText(value) {
  const iso = dateInputValue(value);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function appendSystemMemo(currentMemo, message) {
  const current = String(currentMemo || '').trim();
  const stamp = new Date().toLocaleString('ja-JP');
  const line = `${stamp} ${message}`;
  return current ? `${current}\n${line}` : line;
}

function buildBoardEditMemo(entry) {
  const before = entry.initialDraft || {};
  const after = entry.draft || {};
  const lines = [];

  if (entry.record.photoType === PHOTO_TYPES.VISUAL) {
    const roomChanged = before.buildingId !== after.buildingId || before.areaCode !== after.areaCode || before.roomPosition !== after.roomPosition || before.roomNo !== after.roomNo;
    if (roomChanged) {
      const beforeLocation = `${before.buildingId || 'A'}：${memoValue(before.roomNo || before.roomPosition)}`;
      const afterLocation = `${after.buildingId || 'A'}：${memoValue(after.roomNo || after.roomPosition)}`;
      lines.push(`部屋：${beforeLocation} → ${afterLocation}`);
    }

    const partChanged = Number(before.partSlot || 0) !== Number(after.partSlot || 0) || before.part !== after.part;
    if (partChanged) lines.push(`部位：${before.part ? memoValue(before.part) : '未整理'} → ${after.part ? memoValue(after.part) : '未整理'}`);
  } else {
    const materialChanged = before.materialId !== after.materialId || before.sampleBaseNo !== after.sampleBaseNo;
    if (materialChanged) lines.push(`検体No.：${memoValue(before.sampleBaseNo)} → ${memoValue(after.sampleBaseNo)}`);

    const branchChanged = Number(before.samplingBranch || 0) !== Number(after.samplingBranch || 0);
    if (branchChanged) lines.push(`箇所：${Number(before.samplingBranch || 0) ? memoValue(before.samplingBranch) : '未整理'} → ${Number(after.samplingBranch || 0) ? memoValue(after.samplingBranch) : '未整理'}`);

    if (before.samplingPlace !== after.samplingPlace) {
      lines.push(`部屋No.：${before.samplingPlace ? memoValue(before.samplingPlace) : '未整理'} → ${after.samplingPlace ? memoValue(after.samplingPlace) : '未整理'}`);
    }
    if (before.part !== after.part) {
      lines.push(`採取部位：${before.part ? memoValue(before.part) : '未整理'} → ${after.part ? memoValue(after.part) : '未整理'}`);
    }

    if (before.shootingType !== after.shootingType) {
      lines.push(`撮影区分：${before.shootingType ? memoValue(getShootingTypeLabel(before.shootingType)) : '未整理'} → ${after.shootingType ? memoValue(getShootingTypeLabel(after.shootingType)) : '未整理'}`);
    }
  }

  if (before.boardDate !== after.boardDate) {
    lines.push(`日付：${memoValue(dateText(before.boardDate))} → ${memoValue(dateText(after.boardDate))}`);
  }
  if (before.boardPosition !== after.boardPosition) {
    lines.push(`看板位置：${memoValue(BOARD_POSITION_LABELS[before.boardPosition])} → ${memoValue(BOARD_POSITION_LABELS[after.boardPosition])}`);
  }
  if (before.boardSize !== after.boardSize) {
    lines.push(`看板サイズ：${memoValue(BOARD_SIZE_LABELS[before.boardSize])} → ${memoValue(BOARD_SIZE_LABELS[after.boardSize])}`);
  }

  return lines.length ? ['看板編集', ...lines].join('\n') : '';
}

async function composeCompletedBlob(entry, getBoardData) {
  const originalBlob = await resolveEditorOriginalPhoto(entry.record);
  if (!originalBlob) throw new Error(`元写真を取得できませんでした。 (${entry.record.photoId})`);

  const completedBlob = await composeCompletedPhotoBlob({
    originalBlob,
    photoType: entry.record.photoType,
    shootingType: entry.draft.shootingType,
    boardPosition: entry.draft.boardPosition,
    boardSize: entry.draft.boardSize,
    boardData: getBoardData(entry)
  });

  return { originalBlob, completedBlob };
}

export async function persistBoardEditorEntry(entry, { getBoardData }) {
  if (!entry?.record?.photoId) throw new Error('保存対象の写真がありません。');
  if (typeof getBoardData !== 'function') throw new Error('看板データ生成処理がありません。');

  const { originalBlob, completedBlob } = await composeCompletedBlob(entry, getBoardData);
  const now = new Date().toISOString();

  const nextFields = entry.record.photoType === PHOTO_TYPES.VISUAL
    ? {
        areaCode: entry.draft.areaCode,
        buildingId: entry.draft.buildingId || '',
        roomPosition: entry.draft.roomPosition,
        partSlot: entry.draft.partSlot,
        roomNo: entry.draft.roomNo,
        part: entry.draft.part
      }
    : {
        materialId: entry.draft.materialId || entry.record.materialId,
        samplingPlace: entry.draft.samplingPlace,
        samplingBranch: entry.draft.samplingBranch,
        sampleNo: formatBoardSampleNo(entry.draft.sampleBaseNo, entry.draft.samplingBranch),
        sampleBaseNo: entry.draft.sampleBaseNo,
        part: entry.draft.part,
        shootingType: entry.draft.shootingType
      };

  const fileName = getAvailablePhotoFileName(
    { photoType: entry.record.photoType, ...nextFields },
    photoRecordStore.getAll(),
    entry.record.photoId
  );

  const editMemo = buildBoardEditMemo(entry);
  const nextRecordFields = {
    ...nextFields,
    fileName,
    systemMemo: editMemo ? appendSystemMemo(entry.record.systemMemo, editMemo) : entry.record.systemMemo,
    boardDate: entry.draft.boardDate,
    boardPosition: entry.draft.boardPosition,
    boardSize: entry.draft.boardSize,
    isEdited: true,
    lastEditedDevice: getDeviceCode(),
    lastEditedAt: now
  };

  const editedFields = Object.keys(nextRecordFields).filter((field) =>
    PHOTO_SYNC_EDIT_FIELDS.has(field)
    && String(entry.record?.[field] ?? '') !== String(nextRecordFields[field] ?? '')
  );

  const projectId = String(getCurrentProject()?.projectId || '');
  if (!projectId) throw new Error('写真の保存先案件がありません。');
  const record = await persistCompletedPhotoUpdate({
    photo: entry.record,
    projectId,
    completedBlob
  }, {
    ...nextRecordFields,
    fieldEditedAt: touchFieldEditedAt(entry.record.fieldEditedAt, editedFields)
  }, 'photo-board-editor-save', {
    originalBlob,
    editedAt: now
  });

  settleBoardEditorEntry(entry, record);
  return { record, completedBlob };
}
