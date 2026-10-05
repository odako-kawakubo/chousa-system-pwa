/**
 * 仕上表セルの確定・建材適用・新規建材登録を担当する。
 */
import {
  computeFinishId,
  computeCellPosition
} from '../records/finish-record.js';
import {
  createMaterialRecord,
  normalizeMaterialName,
  splitBaseNameAndSuffix,
  nextMaterialSuffix,
  nextMaterialId
} from '../records/material-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistMaterialForProject } from '../sync/project-record-persistence.js';
import { applySingleRecordSamplingAutofill } from '../materials/material-sampling-autofill.js';
import { persistSparseFinishRecord } from './finish-table-persistence.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';

const PERSISTED_FINISH_EDIT_FIELDS = new Set(['roomNo', 'roomName', 'roomNote', 'part', 'materialId', 'materialName']);

function normalizeCandidateMaterialInput(rawValue) {
  const normalized = normalizeMaterialName(rawValue);
  return normalized.replace(/^【\d+】\s*/, '');
}

export function getMaterialPartOptions(materialRecord) {
  return [...new Set(
    String(materialRecord?.part || '')
      .split(/[、,，]/)
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function partPatchForExistingMaterial(currentCell, partIndex, materialRecord) {
  if (partIndex < 5) return {};
  const parts = getMaterialPartOptions(materialRecord);
  if (parts.length === 1) return { part: parts[0] };
  if (parts.length > 1) {
    const currentPart = String(currentCell?.part || '').trim();
    return parts.includes(currentPart) ? {} : { part: '' };
  }
  return {};
}

function findRepresentativeByRoomKey(roomKey) {
  if (!roomKey) return null;
  return finishRecordStore.getAll().find((record) => record.roomUid === roomKey && record.status === 'active') || null;
}

function cellFinishId(anchor, partIndex, row) {
  return computeFinishId(anchor.areaCode, anchor.roomPosition, computeCellPosition(partIndex, row));
}

function writeCellPatch(anchor, partIndex, row, patch, options = {}) {
  const finishId = cellFinishId(anchor, partIndex, row);
  const existing = finishRecordStore.get(finishId);
  if (!existing) throw new Error(`仕上表レコードが存在しません: ${finishId}`);

  const changedFields = Object.keys(patch).filter((field) => String(existing[field] ?? '') !== String(patch[field] ?? ''));
  if (!changedFields.length) return existing;
  const syncFields = changedFields.filter((field) => PERSISTED_FINISH_EDIT_FIELDS.has(field));

  const next = {
    ...existing,
    ...patch,
    fieldEditedAt: syncFields.length
      ? touchFieldEditedAt(existing.fieldEditedAt, syncFields)
      : { ...(existing.fieldEditedAt || {}) }
  };
  finishRecordStore.set(next);
  if (syncFields.length) {
    persistSparseFinishRecord(
      getCurrentProject(),
      next,
      finishRecordStore.getAll(),
      existing
    );
  }
  refreshMaterialUsageDerivedFields('finish-cell-patch', { persist: options.persistMaterialDerived !== false });
  return next;
}

export function commitCellId(roomKey, partIndex, row, rawInputId) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const inputId = String(rawInputId ?? '').trim();
  const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));

  if (!inputId) {
    writeCellPatch(anchor, partIndex, row, {
      inputId: '',
      materialId: '',
      materialName: '',
      ...(partIndex >= 5 ? { part: '' } : {})
    });
    return null;
  }

  const material = materialRecordStore.findByInputId(inputId);
  if (!material) {
    writeCellPatch(anchor, partIndex, row, { inputId, materialId: '', materialName: '' });
    return null;
  }

  writeCellPatch(anchor, partIndex, row, {
    inputId: String(material.inputId),
    materialId: material.materialId,
    materialName: '',
    ...partPatchForExistingMaterial(currentCell, partIndex, material)
  });
  return material;
}

export function commitCellName(roomKey, partIndex, row, rawName) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const name = normalizeCandidateMaterialInput(rawName);
  if (!name) {
    writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '', materialName: '' });
    return null;
  }

  const material = materialRecordStore.findByName(name);
  if (material) {
    writeCellPatch(anchor, partIndex, row, {
      inputId: String(material.inputId),
      materialId: material.materialId,
      materialName: ''
    });
    return material;
  }

  writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '', materialName: name });
  return null;
}

export function commitCellActualPart(roomKey, partIndex, row, rawValue) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return;
  writeCellPatch(anchor, partIndex, row, { part: String(rawValue ?? '') });
  refreshMaterialUsageDerivedFields('actual-part-edit');
}

export function isCellPendingRegistration(roomKey, partIndex, row) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return false;
  const record = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
  return Boolean(record?.materialName) && !record.materialId;
}

export function applyMaterialToCell(roomKey, partIndex, row, materialRecord) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor || !materialRecord) return;
  const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
  writeCellPatch(anchor, partIndex, row, {
    inputId: String(materialRecord.inputId),
    materialId: materialRecord.materialId,
    materialName: '',
    ...partPatchForExistingMaterial(currentCell, partIndex, materialRecord)
  });
}

function nextInputIdForMaterials() {
  const ids = materialRecordStore.getAll().map((m) => Number(m.inputId) || 0);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function registerMaterialForCell(roomKey, partIndex, row, rawName, runRecordTransaction) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  const normalized = normalizeCandidateMaterialInput(rawName);
  if (!anchor || !normalized) return null;

  let material = materialRecordStore.findByName(normalized);
  let createdNewMaterial = false;
  let beforeMaterial = material ? { ...material } : null;

  runRecordTransaction(() => {
    if (!material) {
      const parsed = splitBaseNameAndSuffix(normalized);
      const suffix = parsed.suffixLetter || nextMaterialSuffix(parsed.baseName, materialRecordStore.getAll());
      const finalName = parsed.suffixLetter ? normalized : `${parsed.baseName}${suffix}`;

      material = materialRecordStore.findByName(finalName);
      if (material && !beforeMaterial) beforeMaterial = { ...material };
      if (!material) {
        const inputId = nextInputIdForMaterials();
        material = createMaterialRecord({
          materialId: nextMaterialId(materialRecordStore.getAll().map((m) => m.materialId)),
          inputId,
          materialNo: inputId,
          name: finalName,
          baseName: parsed.baseName,
          suffixLetter: suffix
        });
        material = {
          ...material,
          fieldEditedAt: touchFieldEditedAt(material.fieldEditedAt, ['name', 'analysisRequired', 'sampleCount'])
        };
        materialRecordStore.set(material);
        createdNewMaterial = true;
      }
    }

    const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
    const finishPatch = {
      inputId: String(material.inputId),
      materialId: material.materialId,
      materialName: ''
    };
    if (partIndex >= 5 && !String(currentCell?.part || '').trim()) finishPatch.part = 'その他';

    writeCellPatch(anchor, partIndex, row, finishPatch, { persistMaterialDerived: false });

    const derivedMaterial = materialRecordStore.get(material.materialId) || material;
    const finalMaterial = { ...derivedMaterial };
    const autofillFields = applySingleRecordSamplingAutofill(finalMaterial);
    if (autofillFields.length) {
      finalMaterial.fieldEditedAt = touchFieldEditedAt(derivedMaterial.fieldEditedAt, autofillFields);
      materialRecordStore.set(finalMaterial);
    }

    material = materialRecordStore.get(material.materialId) || finalMaterial;
    const materialChanged = createdNewMaterial
      || !beforeMaterial
      || String(beforeMaterial.part ?? '') !== String(material.part ?? '')
      || String(beforeMaterial.usageLocation ?? '') !== String(material.usageLocation ?? '')
      || autofillFields.length > 0;

    if (materialChanged) {
      persistMaterialForProject(getCurrentProject(), material, 'material-register-final');
    }
  });

  return material;
}
