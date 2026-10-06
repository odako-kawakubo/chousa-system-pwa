/**
 * src/js/settings/board-settings-store.js
 *
 * 案件単位の看板設定キャッシュ。
 * M-06以降の正本はFirestore案件Documentのproject fields + boardSettings。
 * localStorageは旧案件移行・オフライン表示用の端末キャッシュとしてのみ保持する。
 */

import { getCurrentProject } from '../projects/project-store.js';

const STORAGE_PREFIX = 'chousa-board-settings:';
const listeners = [];

let activeProject = getCurrentProject();
let defaults = buildDefaults(activeProject);
let state = loadForProject(activeProject);

function storageKey(project = activeProject) {
  return `${STORAGE_PREFIX}${project?.projectId || 'project'}`;
}

function buildDefaults(project = {}) {
  return {
    projectNo: project?.projectNo || '',
    projectName: project?.projectName || '',
    address: project?.address || '',
    surveyDate: project?.surveyDate || '',
    surveyor: project?.surveyor || '',
    subjectFontSize: 18,
    addressFontSize: 17,
    subjectText: project?.projectName || '',
    addressText: project?.address || ''
  };
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalize(next = {}, base = defaults) {
  const projectNo = String(next.projectNo ?? base.projectNo);
  const projectName = String(next.projectName ?? base.projectName);
  const address = String(next.address ?? base.address);
  const surveyDate = String(next.surveyDate ?? base.surveyDate);
  const surveyor = String(next.surveyor ?? base.surveyor);
  return {
    projectNo,
    projectName,
    address,
    surveyDate,
    surveyor,
    subjectFontSize: clamp(next.subjectFontSize, 10, 34, base.subjectFontSize),
    addressFontSize: clamp(next.addressFontSize, 9, 30, base.addressFontSize),
    subjectText: String(next.subjectText ?? projectName),
    addressText: String(next.addressText ?? address)
  };
}

function loadForProject(project) {
  const base = buildDefaults(project);
  try {
    return normalize(JSON.parse(localStorage.getItem(storageKey(project)) || '{}'), base);
  } catch {
    return normalize(base, base);
  }
}

function notify() {
  listeners.slice().forEach((callback) => callback(get()));
}

function persist() {
  localStorage.setItem(storageKey(), JSON.stringify(state));
  notify();
}

function applyProjectSource(project, currentState) {
  const remoteBoard = project?.boardSettings && typeof project.boardSettings === 'object'
    ? project.boardSettings
    : null;
  const base = buildDefaults(project);
  const source = currentState || base;
  return normalize({
    ...source,
    projectNo: project?.projectNo ?? source.projectNo,
    projectName: project?.projectName ?? source.projectName,
    address: project?.address ?? source.address,
    ...(remoteBoard || {})
  }, base);
}

/** 案件切替時に、その案件専用の設定へ切り替える。Firestore値があれば旧ローカルcacheより優先する。 */
export function activateProject(project) {
  activeProject = project ? { ...project } : null;
  defaults = buildDefaults(activeProject);
  const cached = loadForProject(activeProject);
  state = applyProjectSource(activeProject, cached);
  persist();
  return get();
}

/** Firestore案件DocumentのRealtime受信値を現在の看板cacheへ反映する。 */
export function applyProjectMetadata(project) {
  if (!project?.projectId || String(project.projectId) !== String(activeProject?.projectId || '')) return get();
  activeProject = { ...activeProject, ...project };
  defaults = buildDefaults(activeProject);
  state = applyProjectSource(activeProject, state);
  persist();
  return get();
}

export function get() {
  return { ...state };
}

export function set(fields = {}) {
  state = normalize({ ...state, ...fields });
  persist();
  return get();
}

export function resetFormatting() {
  state = normalize({
    ...state,
    subjectFontSize: defaults.subjectFontSize,
    addressFontSize: defaults.addressFontSize,
    subjectText: state.projectName,
    addressText: state.address
  });
  persist();
  return get();
}


/** 案件を端末から削除するとき、その案件専用の看板設定も破棄する。 */
export function clearProjectBoardSettings(projectId) {
  const id = String(projectId || '');
  if (!id) return false;
  localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  return true;
}

export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}
