/**
 * Material Listの単一Record保存と共通編集補助を担当する。
 * DOM操作や画面再描画は行わない。
 */
import * as materialRecordStore from '../store/material-record-store.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistMaterialForProject } from '../sync/project-record-persistence.js';

const MATERIAL_META_FIELDS = new Set([
  'updatedAt', 'updatedDevice', 'fieldEditedAt', 'color', 'photoCount',
  'materialNo', 'inputId', 'baseName', 'suffixLetter', 'systemMemo'
]);

export function changedMaterialBusinessFields(previous, next) {
  const keys = new Set([
    ...Object.keys(previous || {}),
    ...Object.keys(next || {})
  ]);

  return [...keys].filter((field) => {
    if (MATERIAL_META_FIELDS.has(field)) return false;
    const a = previous?.[field];
    const b = next?.[field];
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a || []) !== JSON.stringify(b || []);
    }
    return String(a ?? '') !== String(b ?? '');
  });
}

export function setAndPersistMaterialRecord(
  previous,
  candidate,
  source = 'material-list-edit'
) {
  const fields = changedMaterialBusinessFields(previous, candidate);
  if (!fields.length) return previous;

  const next = {
    ...candidate,
    fieldEditedAt: touchFieldEditedAt(previous?.fieldEditedAt, fields)
  };

  materialRecordStore.set(next);
  persistMaterialForProject(getCurrentProject(), next, source);
  return next;
}

export function appendMaterialSystemMemo(currentMemo, line) {
  const current = String(currentMemo || '').trim();
  const stamp = new Date().toLocaleString('ja-JP');
  const nextLine = `${stamp} ${line}`;
  return current ? `${current}\n${nextLine}` : nextLine;
}

export function todayMaterialIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
