/**
 * Photo Board Editorの完成画像生成と永続保存を担当する。
 * DOMイベント・編集セッション遷移・画面描画は持たない。
 */
import * as photoRecordStore from '../store/photo-record-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES, getShootingTypeLabel } from '../records/photo-record.js';
import { savePhotoBlob, updateCameraPhotoRecord } from './photo-local-store.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import { getAvailablePhotoFileName } from './photo-filename.js';
import {
  BOARD_POSITION_LABELS,
  BOARD_SIZE_LABELS,
  drawBoard,
  getBoardRect
} from '../camera/camera-board.js';
import { getDeviceCode } from '../device-code.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';
import { settleBoardEditorEntry } from './photo-board-editor-session.js';

const MARKS = { 1: '①', 2: '②', 3: '③' };

const PHOTO_SYNC_EDIT_FIELDS = new Set([
  'fileName', 'isRepresentative', 'isEdited', 'lastEditedDevice', 'lastEditedAt',
  'deleted', 'systemMemo', 'boardPosition', 'boardSize', 'boardDate', 'originalPath', 'completedPath',
  'areaCode', 'roomPosition', 'partSlot', 'roomNo',
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
    const roomChanged = before.areaCode !== after.areaCode || before.roomPosition !== after.roomPosition || before.roomNo !== after.roomNo;
    if (roomChanged) lines.push(`部屋：${memoValue(before.roomNo || before.roomPosition)} → ${memoValue(after.roomNo || after.roomPosition)}`);

    const partChanged = Number(before.partSlot || 0) !== Number(after.partSlot || 0) || before.part !== after.part;
    if (partChanged) lines.push(`部位：${before.part ? memoValue(before.part) : '未整理'} → ${after.part ? memoValue(after.part) : '未整理'}`);
  } else {
    const materialChanged = before.materialId !== after.materialId || before.sampleBaseNo !== after.sampleBaseNo;
    if (materialChanged) lines.push(`検体No.：${memoValue(before.sampleBaseNo)} → ${memoValue(after.sampleBaseNo)}`);

    const branchChanged = Number(before.samplingBranch || 0) !== Number(after.samplingBranch || 0);
    if (branchChanged) lines.push(`箇所：${Number(before.samplingBranch || 0) ? memoValue(before.samplingBranch) : '未整理'} → ${Number(after.samplingBranch || 0) ? memoValue(after.samplingBranch) : '未整理'}`);

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

async function loadImageForComposition(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // decode後は画像データが保持されるためURLは解放する。
    URL.revokeObjectURL(url);
  }
}

async function composeCompletedBlob(entry, getBoardData) {
  const originalBlob = await resolveEditorOriginalPhoto(entry.record);
  if (!originalBlob) throw new Error(`元写真を取得できませんでした。 (${entry.record.photoId})`);

  const image = await loadImageForComposition(originalBlob);
  const out = document.createElement('canvas');
  out.width = image.width;
  out.height = image.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(image, 0, 0);

  if (!(entry.record.photoType === PHOTO_TYPES.SAMPLING && entry.draft.shootingType === SHOOTING_TYPES.SECTION)) {
    const rect = getBoardRect(out.width, out.height, entry.draft.boardPosition, entry.draft.boardSize);
    drawBoard(ctx, rect, getBoardData(entry));
  }

  const completedBlob = await new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('完成画像を生成できませんでした。')),
      'image/jpeg',
      0.82
    );
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

  const record = photoRecordStore.set({
    ...entry.record,
    ...nextRecordFields,
    fieldEditedAt: touchFieldEditedAt(entry.record.fieldEditedAt, editedFields),
    syncStatus: 'pending',
    localOriginalStatus: 'saved',
    localCompletedStatus: 'saved'
  });

  await savePhotoBlob(record.photoId, 'original', originalBlob, {
    createdAt: record.capturedAt,
    fileName,
    uploadStatus: 'pending'
  });
  await savePhotoBlob(record.photoId, 'completed', completedBlob, {
    createdAt: now,
    fileName,
    uploadStatus: 'pending'
  });
  await updateCameraPhotoRecord(record);
  await persistPhotoForProject(getCurrentProject(), record, 'photo-board-editor-save');

  settleBoardEditorEntry(entry, record);
  return { record, completedBlob };
}
