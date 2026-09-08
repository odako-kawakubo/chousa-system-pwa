/**
 * src/js/materials/material-operations.js
 *
 * 建材の「統合・削除・削除済み建材からの再登録」業務ロジック。
 *
 * 方針：
 * - 正本は materialRecordStore / finishRecordStore / photoRecordStore。
 * - 複数Store更新は runRecordTransaction() 内で1つの業務操作として完成させる。
 * - Firestoreへは途中状態を送らず、業務操作完了後の最終差分をRecordごとに1回だけ送る。
 * - 統合元／削除元レコードは物理削除せず履歴として保持する。
 * - 削除済み建材の「再登録」は旧Recordをactiveへ戻さず、新しいmaterialId/inputIdで新規作成する。
 * - 再登録では仕上表・写真の旧紐付けは復元しない。
 * - 処理後は active 建材の建材No.と同一ベース名の末尾英字を整理する。
 */

import {
  finishRecordStore,
  materialRecordStore,
  runRecordTransaction,
  refreshMaterialUsageDerivedFields
} from '../finish-table/finish-table-actions.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { createMaterialRecord, nextMaterialId } from '../records/material-record.js';
import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import {
  persistFinishForProject,
  persistMaterialForProject,
  persistPhotoForProject
} from '../sync/project-record-persistence.js';

function nowIso() {
  return new Date().toISOString();
}

function appendSystemMemo(currentMemo, message) {
  const current = String(currentMemo || '').trim();
  const stamp = new Date().toLocaleString('ja-JP');
  const line = `${stamp} ${message}`;
  return current ? `${current}\n${line}` : line;
}

function numberToSuffix(value) {
  let n = Math.max(1, Number(value) || 1);
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function recordMap(records, idField) {
  return new Map((records || []).map((record) => [String(record?.[idField] || ''), record]));
}

function changedRecords(beforeRecords, afterRecords, idField) {
  const before = recordMap(beforeRecords, idField);
  return (afterRecords || []).filter((record) => {
    const id = String(record?.[idField] || '');
    if (!id) return false;
    const previous = before.get(id);
    return !previous || JSON.stringify(previous) !== JSON.stringify(record);
  });
}

function captureOperationSnapshot() {
  return {
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  };
}

/**
 * ローカルtransaction完成後の最終差分だけを既存1Record保存経路へ送る。
 * 統合・削除の途中で生じる派生値や再採番途中のRecordは送らない。
 */
function persistOperationSnapshotDiff(before, source) {
  const project = getCurrentProject();
  const finishChanges = changedRecords(before.finishRecords, finishRecordStore.exportSnapshot(), 'finishId');
  const materialChanges = changedRecords(before.materialRecords, materialRecordStore.exportSnapshot(), 'materialId');
  const photoChanges = changedRecords(before.photoRecords, photoRecordStore.exportSnapshot(), 'photoId');

  finishChanges.forEach((record) => {
    void persistFinishForProject(project, record, `${source}-finish`);
  });
  materialChanges.forEach((record) => {
    void persistMaterialForProject(project, record, `${source}-material`);
  });
  photoChanges.forEach((record) => {
    void persistPhotoForProject(project, record, `${source}-photo`);
  });

  return {
    finishCount: finishChanges.length,
    materialCount: materialChanges.length,
    photoCount: photoChanges.length
  };
}

function activeMaterialsSorted() {
  return materialRecordStore.getAll()
    .filter((record) => record.status === 'active')
    .slice()
    .sort((a, b) => {
      const aNo = Number(a.materialNo) || Number(a.inputId) || Number.MAX_SAFE_INTEGER;
      const bNo = Number(b.materialNo) || Number(b.inputId) || Number.MAX_SAFE_INTEGER;
      if (aNo !== bNo) return aNo - bNo;
      return String(a.materialId || '').localeCompare(String(b.materialId || ''), 'ja', { numeric: true });
    });
}

/** 操作パネル表示用のactive建材を現在の建材No.順で返す。 */
export function getActiveMaterialsForOperations() {
  return activeMaterialsSorted();
}

/** 削除済み建材を旧inputId順で返す。統合済みは再登録候補に含めない。 */
export function getDeletedMaterialsForOperations() {
  return materialRecordStore.getAll()
    .filter((record) => record.status === 'deleted')
    .slice()
    .sort((a, b) => {
      const aId = Number(a.inputId) || Number.MAX_SAFE_INTEGER;
      const bId = Number(b.inputId) || Number.MAX_SAFE_INTEGER;
      if (aId !== bId) return aId - bId;
      return String(a.materialId || '').localeCompare(String(b.materialId || ''), 'ja', { numeric: true });
    });
}

/**
 * 使用中の仕上表箇所（部屋No.）を重複なしで返す。
 */
export function getMaterialUsagePlaces(materialId) {
  const places = [];
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.materialId !== materialId) return;
    const label = String(record.roomNo || record.roomName || '').trim();
    if (label && !places.includes(label)) places.push(label);
  });
  return places;
}

/** 統合元に、統合先へ引き継がない採取・分析情報があるか。 */
export function hasSamplingOrAnalysisData(record) {
  if (!record) return false;
  const analysis = String(record.analysisRequired || '').trim();
  if (analysis && analysis !== '未調査') return true;
  if (Number(record.sampleCount) > 0) return true;
  if (record.sampleLocation1 || record.sampleLocation2 || record.sampleLocation3) return true;
  if ((Array.isArray(record.samplePart) ? record.samplePart.length : String(record.samplePart || '').trim()) || record.sampleDone || record.sampleDate || record.sampleName) return true;
  if (record.analysisResult || record.remarks) return true;
  return false;
}

/** 調査備考を行単位で重複排除しながら結合する。 */
function mergeSurveyNotes(targetNote, sourceNote) {
  const lines = [];
  [targetNote, sourceNote].forEach((value) => {
    String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (!lines.includes(line)) lines.push(line);
      });
  });
  return lines.join('\n');
}

/**
 * 建材統合で採取写真を未整理へ戻す前に、失われる採取情報をシステムメモへ残す。
 */
function buildMergedPhotoMemo(photo, sourceMaterialId, targetMaterialId) {
  const shootingCode = ({
    [SHOOTING_TYPES.BEFORE]: '1',
    [SHOOTING_TYPES.DURING]: '2',
    [SHOOTING_TYPES.AFTER]: '3',
    [SHOOTING_TYPES.SECTION]: '4'
  })[photo.shootingType] || '-';
  const sampleBaseNo = String(photo.sampleBaseNo || photo.sampleNo || '').trim().split('-')[0] || '-';
  const branch = Number(photo.samplingBranch) || '-';
  const place = String(photo.samplingPlace || '').trim() || '-';
  return [
    `建材統合：${sourceMaterialId} → ${targetMaterialId}`,
    `元情報：${sampleBaseNo}-${branch}-${shootingCode} / ${place}`,
    '未整理へ移動'
  ].join('\n');
}

function setMaterialPatch(record, patch, editedFields, updatedAt = nowIso()) {
  materialRecordStore.set({
    ...record,
    ...patch,
    fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, editedFields),
    updatedAt
  });
}

function setFinishPatch(record, patch, editedFields, updatedAt = nowIso()) {
  finishRecordStore.set({
    ...record,
    ...patch,
    fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, editedFields),
    updatedAt
  });
}

/**
 * active建材の現在位置に合わせて建材No.を1..Nへ振り直し、
 * 同一baseName内の末尾英字を A..Z,AA,AB... で整理する。
 * inputId / materialId は固定のため変更しない。
 */
function resequenceActiveMaterials() {
  const ordered = activeMaterialsSorted();
  const updatedAt = nowIso();

  ordered.forEach((record, index) => {
    const nextNo = index + 1;
    if (Number(record.materialNo) === nextNo) return;
    setMaterialPatch(record, { materialNo: nextNo }, ['materialNo'], updatedAt);
  });

  const refreshed = activeMaterialsSorted();
  const groups = new Map();
  refreshed.forEach((record) => {
    const base = String(record.baseName || record.name || '').trim();
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(record);
  });

  groups.forEach((items, baseName) => {
    items.forEach((record, index) => {
      const suffixLetter = numberToSuffix(index + 1);
      const nextName = `${baseName}${suffixLetter}`;
      if (record.name === nextName && record.suffixLetter === suffixLetter) return;
      setMaterialPatch(record, {
        name: nextName,
        suffixLetter,
        systemMemo: appendSystemMemo(record.systemMemo, `末尾英字再採番：${record.name} → ${nextName}`)
      }, ['name', 'suffixLetter', 'systemMemo'], updatedAt);
    });
  });
}

function nextInputIdForMaterials() {
  const ids = materialRecordStore.getAll().map((record) => Number(record.inputId) || 0);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function normalizeInsertPosition(position, activeCount) {
  const numeric = Number(position);
  if (!Number.isFinite(numeric)) return activeCount + 1;
  return Math.max(1, Math.min(activeCount + 1, Math.trunc(numeric)));
}

function shiftMaterialsForInsert(position) {
  const ordered = activeMaterialsSorted();
  const updatedAt = nowIso();
  ordered.forEach((record, index) => {
    const currentPosition = index + 1;
    const nextNo = currentPosition >= position ? currentPosition + 1 : currentPosition;
    if (Number(record.materialNo) === nextNo) return;
    setMaterialPatch(record, { materialNo: nextNo }, ['materialNo'], updatedAt);
  });
}

/**
 * 複数建材を1つの統合先へ統合する。
 */
export function mergeMaterials(targetId, sourceIds) {
  const target = materialRecordStore.get(targetId);
  if (!target || target.status !== 'active') throw new Error('統合先の建材を取得できません。');

  const uniqueSourceIds = [...new Set(sourceIds || [])].filter((id) => id && id !== targetId);
  const sources = uniqueSourceIds
    .map((id) => materialRecordStore.get(id))
    .filter((record) => record && record.status === 'active');
  if (!sources.length) throw new Error('統合する建材を選択してください。');

  const before = captureOperationSnapshot();

  runRecordTransaction(() => {
    const updatedAt = nowIso();
    let nextTarget = { ...target };

    sources.forEach((source) => {
      finishRecordStore.getAll().forEach((finish) => {
        if (finish.status !== 'active' || finish.materialId !== source.materialId) return;
        setFinishPatch(finish, {
          materialId: target.materialId,
          inputId: String(target.inputId),
          systemMemo: appendSystemMemo(finish.systemMemo, `建材統合：${source.materialId} → ${target.materialId}`)
        }, ['materialId', 'systemMemo'], updatedAt);
      });

      photoRecordStore.getAll().forEach((photo) => {
        if (photo.photoType !== PHOTO_TYPES.SAMPLING || photo.deleted || photo.materialId !== source.materialId) return;
        photoRecordStore.set({
          ...photo,
          materialId: target.materialId,
          samplingPlace: '',
          samplingBranch: 0,
          sampleNo: '',
          sampleBaseNo: '',
          part: '',
          shootingType: '',
          systemMemo: appendSystemMemo(photo.systemMemo, buildMergedPhotoMemo(photo, source.materialId, target.materialId)),
          fieldEditedAt: touchFieldEditedAt(photo.fieldEditedAt, [
            'materialId', 'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType', 'systemMemo'
          ])
        });
      });

      nextTarget.note = mergeSurveyNotes(nextTarget.note, source.note);
      nextTarget.systemMemo = appendSystemMemo(nextTarget.systemMemo, `建材統合受入：${source.materialId} ${source.name}`);

      setMaterialPatch(source, {
        status: 'merged',
        systemMemo: appendSystemMemo(
          source.systemMemo,
          `建材統合：${source.materialId} ${source.name} → ${target.materialId} ${target.name}`
        )
      }, ['status', 'systemMemo'], updatedAt);
    });

    setMaterialPatch(nextTarget, {
      note: nextTarget.note,
      systemMemo: nextTarget.systemMemo
    }, ['note', 'systemMemo'], updatedAt);

    // 派生値はローカルで完成させる。Firestore保存はoperation最終差分へ一本化する。
    refreshMaterialUsageDerivedFields('material-merge-recalc', { persist: false });
    resequenceActiveMaterials();
  });

  const persisted = persistOperationSnapshotDiff(before, 'material-merge-final');
  return { targetId, sourceIds: sources.map((source) => source.materialId), persisted };
}

/**
 * 建材を削除状態へする。写真レコードは触らず保持する。
 */
export function deleteMaterials(materialIds) {
  const uniqueIds = [...new Set(materialIds || [])].filter(Boolean);
  const targets = uniqueIds
    .map((id) => materialRecordStore.get(id))
    .filter((record) => record && record.status === 'active');
  if (!targets.length) throw new Error('削除する建材を選択してください。');

  const before = captureOperationSnapshot();

  runRecordTransaction(() => {
    const updatedAt = nowIso();

    targets.forEach((target) => {
      finishRecordStore.getAll().forEach((finish) => {
        if (finish.status !== 'active' || finish.materialId !== target.materialId) return;
        setFinishPatch(finish, {
          materialId: '',
          inputId: '',
          systemMemo: appendSystemMemo(finish.systemMemo, `建材削除：${target.materialId} ${target.name}`)
        }, ['materialId', 'systemMemo'], updatedAt);
      });

      setMaterialPatch(target, {
        status: 'deleted',
        systemMemo: appendSystemMemo(target.systemMemo, `削除：${target.name} を建材リストから除外`)
      }, ['status', 'systemMemo'], updatedAt);
    });

    refreshMaterialUsageDerivedFields('material-delete-recalc', { persist: false });
    resequenceActiveMaterials();
  });

  const persisted = persistOperationSnapshotDiff(before, 'material-delete-final');
  return { deletedIds: targets.map((target) => target.materialId), persisted };
}

/**
 * 削除済み建材を旧Recordの復帰ではなく、新しい建材として任意位置へ再登録する。
 * - 旧deleted Recordは変更しない。
 * - materialId / inputId / color は新規発番。
 * - 名称・レベル・調査備考・分析要否・採取設定は引き継ぐ。
 * - 採取済み/採取日/試料名称/分析結果/分析後備考は履歴実績なので引き継がない。
 * - 仕上表・写真は触らない。
 */
export function reregisterDeletedMaterial(sourceMaterialId, insertPosition) {
  const source = materialRecordStore.get(sourceMaterialId);
  if (!source || source.status !== 'deleted') throw new Error('削除済み建材を取得できません。');

  const activeCount = activeMaterialsSorted().length;
  const position = normalizeInsertPosition(insertPosition, activeCount);
  const before = captureOperationSnapshot();
  let created = null;

  runRecordTransaction(() => {
    shiftMaterialsForInsert(position);

    const inputId = nextInputIdForMaterials();
    const materialId = nextMaterialId(materialRecordStore.getAll().map((record) => record.materialId));
    const systemMemo = appendSystemMemo('', `削除済み建材 ${source.materialId} ${source.name} から新規再登録`);

    created = createMaterialRecord({
      status: 'active',
      materialId,
      inputId,
      materialNo: position,
      name: source.name,
      baseName: source.baseName,
      suffixLetter: source.suffixLetter,
      part: '',
      usageLocation: '',
      level: source.level,
      note: source.note,
      analysisRequired: source.analysisRequired,
      sampleCount: source.sampleCount,
      sampleLocation1: source.sampleLocation1,
      sampleLocation2: source.sampleLocation2,
      sampleLocation3: source.sampleLocation3,
      samplePart: source.samplePart,
      sampleDone: false,
      sampleDate: '',
      sampleName: '',
      analysisResult: '',
      remarks: '',
      systemMemo,
      fieldEditedAt: touchFieldEditedAt({}, [
        'status', 'materialNo', 'name', 'level', 'note', 'analysisRequired', 'sampleCount',
        'sampleLocation1', 'sampleLocation2', 'sampleLocation3', 'samplePart', 'systemMemo'
      ])
    });
    materialRecordStore.set(created);

    resequenceActiveMaterials();
    created = materialRecordStore.get(materialId) || created;
  });

  const persisted = persistOperationSnapshotDiff(before, 'material-reregister-final');
  return { material: created, sourceMaterialId: source.materialId, insertPosition: position, persisted };
}
