/**
 * src/js/settings/board-settings-store.js
 *
 * 案件単位のローカル案件情報 + 看板設定。
 * v0.1.6.1Aから、固定サンプル案件キーではなく「現在開いている案件ID」ごとに
 * localStorageを分離する。Firestore正本化前のローカル暫定保存として使用する。
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

/** 案件切替時に、その案件専用の設定へ切り替える。 */
export function activateProject(project) {
  activeProject = project ? { ...project } : null;
  defaults = buildDefaults(activeProject);
  state = loadForProject(activeProject);
  notify();
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

export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}
