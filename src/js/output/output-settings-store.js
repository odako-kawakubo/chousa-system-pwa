/**
 * src/js/output/output-settings-store.js
 * 帳票出力専用設定。
 * 共通設定は端末全体、タイトル追記は案件単位で保持する。
 */
import { getCurrentProject } from '../projects/project-store.js';

const STORAGE_KEY = 'chousa-output-settings-v0176';

export const DEFAULT_OUTPUT_SETTINGS = Object.freeze({
  titleSize: 18,
  materialBodySize: 7.5,
  materialHeaderSize: 7.5,
  materialHeaderHeight: 6.5,
  roomBodySize: 7.5,
  roomHeaderSize: 7.5,
  roomHeaderHeight: 6.5,
  noteSize: 6.4,
  noteText: '※ケイ酸カルシウム板第１種は、飛散性の高いレベル３建材として、環境省、厚生労働省の告示で定められました。\nこれを切断等の方法で除去する場合、作業場をビニールシート等で隔離し、常時湿潤な状態を保ちながら作業することが必要になります。\nまた、建築用仕上塗材を電動工具を使用して除去を行う場合においても、大気汚染防止法施行令及び石綿障害予防規則にて作業場の隔離、常時湿潤な状態での作業が必要です。',
  visualCaptionSize: 9,
  visualCaptionLayout: 'one-line',
  samplingMetaSize: 9,
  samplingStatusSize: 9,
  samplingMemoSize: 8,
  materialTitleSuffix: '',
  roomTitleSuffix: ''
});

function projectId() {
  return String(getCurrentProject()?.projectId || '').trim();
}

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* no-op */ }
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeOutputSettings(value = {}) {
  const base = { ...DEFAULT_OUTPUT_SETTINGS, ...(value || {}) };
  return {
    titleSize: clamp(base.titleSize, 14, 24, DEFAULT_OUTPUT_SETTINGS.titleSize),
    materialBodySize: clamp(base.materialBodySize, 6.5, 10, DEFAULT_OUTPUT_SETTINGS.materialBodySize),
    materialHeaderSize: clamp(base.materialHeaderSize, 6.5, 10, DEFAULT_OUTPUT_SETTINGS.materialHeaderSize),
    materialHeaderHeight: clamp(base.materialHeaderHeight, 5.5, 10, DEFAULT_OUTPUT_SETTINGS.materialHeaderHeight),
    roomBodySize: clamp(base.roomBodySize, 6.5, 10, DEFAULT_OUTPUT_SETTINGS.roomBodySize),
    roomHeaderSize: clamp(base.roomHeaderSize, 6.5, 10, DEFAULT_OUTPUT_SETTINGS.roomHeaderSize),
    roomHeaderHeight: clamp(base.roomHeaderHeight, 5.5, 10, DEFAULT_OUTPUT_SETTINGS.roomHeaderHeight),
    noteSize: clamp(base.noteSize, 5.5, 9, DEFAULT_OUTPUT_SETTINGS.noteSize),
    noteText: String(base.noteText ?? DEFAULT_OUTPUT_SETTINGS.noteText),
    visualCaptionSize: clamp(base.visualCaptionSize, 7, 12, DEFAULT_OUTPUT_SETTINGS.visualCaptionSize),
    visualCaptionLayout: base.visualCaptionLayout === 'two-line' ? 'two-line' : 'one-line',
    samplingMetaSize: clamp(base.samplingMetaSize, 7, 12, DEFAULT_OUTPUT_SETTINGS.samplingMetaSize),
    samplingStatusSize: clamp(base.samplingStatusSize, 7, 12, DEFAULT_OUTPUT_SETTINGS.samplingStatusSize),
    samplingMemoSize: clamp(base.samplingMemoSize, 6.5, 10, DEFAULT_OUTPUT_SETTINGS.samplingMemoSize),
    materialTitleSuffix: String(base.materialTitleSuffix ?? ''),
    roomTitleSuffix: String(base.roomTitleSuffix ?? '')
  };
}

export function getOutputSettings() {
  const stored = readStore();
  const common = stored.common || {};
  const id = projectId();
  const project = id ? (stored.projects?.[id] || {}) : {};
  return normalizeOutputSettings({ ...common, ...project });
}

export function saveOutputSettings(settings) {
  const next = normalizeOutputSettings(settings);
  const stored = readStore();
  const id = projectId();
  stored.common = {
    titleSize: next.titleSize,
    materialBodySize: next.materialBodySize,
    materialHeaderSize: next.materialHeaderSize,
    materialHeaderHeight: next.materialHeaderHeight,
    roomBodySize: next.roomBodySize,
    roomHeaderSize: next.roomHeaderSize,
    roomHeaderHeight: next.roomHeaderHeight,
    noteSize: next.noteSize,
    noteText: next.noteText,
    visualCaptionSize: next.visualCaptionSize,
    visualCaptionLayout: next.visualCaptionLayout,
    samplingMetaSize: next.samplingMetaSize,
    samplingStatusSize: next.samplingStatusSize,
    samplingMemoSize: next.samplingMemoSize
  };
  if (!stored.projects || typeof stored.projects !== 'object') stored.projects = {};
  if (id) {
    stored.projects[id] = {
      materialTitleSuffix: next.materialTitleSuffix,
      roomTitleSuffix: next.roomTitleSuffix
    };
  }
  writeStore(stored);
  window.dispatchEvent(new CustomEvent('chousa:output-settings-change', { detail:{ settings:next } }));
  return next;
}

export function resetOutputSettings() {
  return saveOutputSettings(DEFAULT_OUTPUT_SETTINGS);
}
