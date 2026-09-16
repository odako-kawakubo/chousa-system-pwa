/**
 * src/js/output/output-state.js
 *
 * 出力専用の端末設定。
 * 写真タブの代表写真(isRepresentative)とは分離し、案件ごとに
 * 「今回の帳票へ採用する写真」と採取写真帳のメモを保持する。
 * Firestoreの3レコード正本には混ぜない。
 */
import { getCurrentProject } from '../projects/project-store.js';

const STORAGE_KEY = 'chousa-output-state-v0174';

function projectId() {
  return String(getCurrentProject()?.projectId || '').trim();
}

function loadAll() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveAll(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 出力設定の保存失敗で通常の調査入力を止めない。
  }
}

function projectState() {
  const id = projectId();
  if (!id) return { visual: {}, sampling: {}, samplingMemo: {} };
  const all = loadAll();
  const current = all[id] || {};
  return {
    visual: { ...(current.visual || {}) },
    sampling: { ...(current.sampling || {}) },
    samplingMemo: { ...(current.samplingMemo || {}) }
  };
}

function updateProjectState(mutator) {
  const id = projectId();
  if (!id) return;
  const all = loadAll();
  const current = {
    visual: { ...(all[id]?.visual || {}) },
    sampling: { ...(all[id]?.sampling || {}) },
    samplingMemo: { ...(all[id]?.samplingMemo || {}) }
  };
  mutator(current);
  all[id] = current;
  saveAll(all);
}

export function getVisualOutputPhotoId(materialId) {
  return String(projectState().visual[String(materialId || '')] || '');
}

export function setVisualOutputPhotoId(materialId, photoId) {
  const key = String(materialId || '').trim();
  if (!key) return;
  updateProjectState((state) => {
    if (photoId) state.visual[key] = String(photoId);
    else delete state.visual[key];
  });
}

function samplingKey(materialId, branch, shootingType) {
  return `${String(materialId || '')}|${Number(branch) || 0}|${String(shootingType || '')}`;
}

export function getSamplingOutputPhotoId(materialId, branch, shootingType) {
  return String(projectState().sampling[samplingKey(materialId, branch, shootingType)] || '');
}

export function setSamplingOutputPhotoId(materialId, branch, shootingType, photoId) {
  const key = samplingKey(materialId, branch, shootingType);
  updateProjectState((state) => {
    if (photoId) state.sampling[key] = String(photoId);
    else delete state.sampling[key];
  });
}

export function getSamplingOutputMemo(materialId, branch, shootingType) {
  return String(projectState().samplingMemo[samplingKey(materialId, branch, shootingType)] || '');
}

export function setSamplingOutputMemo(materialId, branch, shootingType, value) {
  const key = samplingKey(materialId, branch, shootingType);
  updateProjectState((state) => {
    const next = String(value ?? '').replace(/\r/g, '').replace(/\n{10,}/g, '\n'.repeat(9));
    if (next.trim()) state.samplingMemo[key] = next;
    else delete state.samplingMemo[key];
  });
}

export function clearInvalidOutputSelections(validPhotoIds = new Set()) {
  updateProjectState((state) => {
    Object.keys(state.visual).forEach((key) => {
      if (!validPhotoIds.has(String(state.visual[key]))) delete state.visual[key];
    });
    Object.keys(state.sampling).forEach((key) => {
      if (!validPhotoIds.has(String(state.sampling[key]))) delete state.sampling[key];
    });
  });
}
