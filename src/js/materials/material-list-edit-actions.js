/**
 * Material Listの建材編集ルールを担当する。
 * DOMイベント配線や一覧全体の描画状態は持たない。
 */
import { normalizeMaterialName, normalizeSampleParts, splitBaseNameAndSuffix } from '../records/material-record.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { applySingleRecordSamplingAutofill } from './material-sampling-autofill.js';
import {
  setAndPersistMaterialRecord,
  appendMaterialSystemMemo,
  todayMaterialIsoDate
} from './material-list-persistence.js';

export function updateMaterialControlValue(control) {
  const materialId = control?.dataset?.materialId;
  const field = control?.dataset?.field;
  const record = materialRecordStore.get(materialId);
  if (!record || !field) return { changed: false, materialId };

  const next = { ...record, updatedAt: new Date().toISOString() };

  switch (field) {
    case 'level':
      next.level = String(control.value || '-');
      break;
    case 'analysisRequired':
      next.analysisRequired = String(control.value || '採取・分析');
      if (next.analysisRequired === '採取・分析') {
        const currentCount = Number(next.sampleCount);
        if (!Number.isFinite(currentCount) || currentCount < 1) next.sampleCount = 1;
        else next.sampleCount = Math.min(3, currentCount);
        applySingleRecordSamplingAutofill(next);
      }
      break;
    case 'sampleCount':
      next.sampleCount = Math.max(1, Math.min(3, Number(control.value) || 1));
      applySingleRecordSamplingAutofill(next);
      break;
    case 'sampleLocation1':
    case 'sampleLocation2':
    case 'sampleLocation3':
    case 'sampleDate':
      next[field] = String(control.value || '');
      break;
    case 'sampleDone':
      next.sampleDone = Boolean(control.checked);
      if (next.sampleDone && !next.sampleDate) next.sampleDate = todayMaterialIsoDate();
      break;
    default:
      return { changed: false, materialId };
  }

  const saved = setAndPersistMaterialRecord(record, next, 'material-control-edit');
  return { changed: saved !== record, materialId, record: saved };
}

export function updateMaterialSampleParts(materialId, selectedValues = []) {
  const record = materialRecordStore.get(materialId);
  if (!record) return { changed: false, materialId, selected: [] };

  const selected = normalizeSampleParts(selectedValues);
  const current = normalizeSampleParts(record.samplePart);
  if (JSON.stringify(current) === JSON.stringify(selected)) {
    return { changed: false, materialId, selected };
  }

  const saved = setAndPersistMaterialRecord(record, {
    ...record,
    samplePart: selected
  });

  return { changed: saved !== record, materialId, selected, record: saved };
}

export function updateMaterialNameValue(materialId, rawValue) {
  const record = materialRecordStore.get(materialId);
  if (!record) return { changed: false, refreshList: true, materialId };

  const normalized = normalizeMaterialName(rawValue);
  if (!normalized) {
    return {
      changed: false,
      refreshList: true,
      materialId,
      error: '建材名称を入力してください。'
    };
  }

  if (normalized === record.name) {
    return { changed: false, refreshList: true, materialId };
  }

  const duplicate = materialRecordStore.getAll().find((item) =>
    item.status === 'active'
    && item.materialId !== materialId
    && normalizeMaterialName(item.name) === normalized
  );

  if (duplicate) {
    return {
      changed: false,
      refreshList: true,
      materialId,
      error: `「${normalized}」は入力ID ${duplicate.inputId} で登録済みです。`
    };
  }

  const parsed = splitBaseNameAndSuffix(normalized);
  const saved = setAndPersistMaterialRecord(record, {
    ...record,
    name: normalized,
    baseName: parsed.baseName,
    suffixLetter: parsed.suffixLetter,
    systemMemo: appendMaterialSystemMemo(
      record.systemMemo,
      `建材名称変更：${record.name} → ${normalized}`
    )
  });

  return { changed: saved !== record, refreshConnected: true, materialId, record: saved };
}

export function updateMaterialNoteValue(materialId, rawValue) {
  const record = materialRecordStore.get(materialId);
  if (!record) return { changed: false, refreshList: true, materialId };

  const note = String(rawValue ?? '').trim();
  if (note === record.note) {
    return { changed: false, refreshList: true, materialId };
  }

  const saved = setAndPersistMaterialRecord(record, {
    ...record,
    note
  }, 'material-note-edit');

  return { changed: saved !== record, refreshConnected: true, materialId, record: saved };
}

export function updateMaterialAnalysisTextValue(materialId, field, rawValue) {
  if (!['analysisResult', 'remarks'].includes(field)) {
    return { changed: false, refreshList: true, materialId };
  }

  const record = materialRecordStore.get(materialId);
  if (!record) return { changed: false, refreshList: true, materialId };

  const value = String(rawValue ?? '').trim();
  if (value === String(record[field] || '')) {
    return { changed: false, refreshList: true, materialId };
  }

  const saved = setAndPersistMaterialRecord(record, {
    ...record,
    [field]: value
  }, field === 'analysisResult'
    ? 'material-analysis-result-edit'
    : 'material-analysis-remarks-edit'
  );

  return {
    changed: saved !== record,
    refreshList: true,
    refreshRecordView: true,
    materialId,
    record: saved
  };
}

export function applyMaterialSamplingAutofill() {
  const updates = [];

  materialRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active') return;
    const next = { ...record };
    if (applySingleRecordSamplingAutofill(next).length) {
      updates.push({ previous: record, next });
    }
  });

  if (!updates.length) return 0;

  materialRecordStore.batch(() => {
    updates.forEach(({ previous, next }) => {
      setAndPersistMaterialRecord(previous, next, 'sampling-autofill');
    });
  });

  return updates.length;
}
