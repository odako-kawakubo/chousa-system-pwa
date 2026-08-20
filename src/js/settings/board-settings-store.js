/**
 * src/js/settings/board-settings-store.js
 *
 * Firebase接続前のローカル案件情報 + 看板設定。
 * Firebase正本化前の1.5系では、案件情報入力と看板表示設定を同じ案件単位で
 * ローカル保持し、設定画面・撮影・撮影後編集から同じ値を参照する。
 */

import { sampleProject } from '../demo/sample-project.js';

const STORAGE_KEY = `chousa-board-settings:${sampleProject.projectId || 'project'}`;
const listeners = [];

const DEFAULTS = Object.freeze({
  projectNo: sampleProject.projectNo || '',
  projectName: sampleProject.projectName || '',
  address: sampleProject.address || '',
  surveyDate: sampleProject.surveyDate || '',
  surveyor: sampleProject.surveyor || '',
  subjectFontSize: 18,
  addressFontSize: 17,
  subjectText: sampleProject.projectName || '',
  addressText: sampleProject.address || ''
});

let state = load();

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalize(next = {}) {
  const projectNo = String(next.projectNo ?? DEFAULTS.projectNo);
  const projectName = String(next.projectName ?? DEFAULTS.projectName);
  const address = String(next.address ?? DEFAULTS.address);
  const surveyDate = String(next.surveyDate ?? DEFAULTS.surveyDate);
  const surveyor = String(next.surveyor ?? DEFAULTS.surveyor);
  return {
    projectNo,
    projectName,
    address,
    surveyDate,
    surveyor,
    subjectFontSize: clamp(next.subjectFontSize, 10, 34, DEFAULTS.subjectFontSize),
    addressFontSize: clamp(next.addressFontSize, 9, 30, DEFAULTS.addressFontSize),
    subjectText: String(next.subjectText ?? projectName),
    addressText: String(next.addressText ?? address)
  };
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return normalize(DEFAULTS);
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.slice().forEach((callback) => callback(get()));
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
    subjectFontSize: DEFAULTS.subjectFontSize,
    addressFontSize: DEFAULTS.addressFontSize,
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
