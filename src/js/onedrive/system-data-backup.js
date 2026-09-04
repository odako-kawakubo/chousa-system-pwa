/**
 * src/js/onedrive/system-data-backup.js
 *
 * OneDrive「しらべ/システムデータ」へ案件の文字データを保存する。
 * Firestoreの代替正本ではなく、災害復旧・ロールバック用の退避データ。
 * 通常起動では読込まず、復元は明示操作から行う。
 */
import {
  listDriveChildren,
  uploadDriveFile,
  deleteDriveItem
} from './onedrive-client.js';
import { getCurrentOneDriveState } from './onedrive-project.js';
import {
  getCurrentProject,
  getProject,
  subscribe as subscribeProjects
} from '../projects/project-store.js';
import { getDeviceCode } from '../device-code.js';
import { isManualOffline } from '../sync/sync-status.js';
import { appConfig } from '../../config/app-config.js';

const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_GENERATIONS_PER_DEVICE = 15;

let activeProjectId = '';
let lastSuccessfulSignature = '';
let timer = null;
let inFlight = false;
let initialized = false;

function cloneForBackup(entry) {
  if (!entry?.project?.projectId) return null;
  return {
    schemaVersion: 1,
    appVersion: appConfig.version,
    project: { ...entry.project },
    finishRecords: Array.isArray(entry.finishRecords) ? entry.finishRecords.map((item) => ({ ...item })) : [],
    materialRecords: Array.isArray(entry.materialRecords) ? entry.materialRecords.map((item) => ({ ...item })) : [],
    photoRecords: Array.isArray(entry.photoRecords) ? entry.photoRecords.map((item) => ({ ...item })) : []
  };
}

function currentBackupPayload() {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return null;
  return cloneForBackup(getProject(project.projectId));
}

function payloadSignature(payload) {
  if (!payload) return '';
  return JSON.stringify({
    project: payload.project,
    finishRecords: payload.finishRecords,
    materialRecords: payload.materialRecords,
    photoRecords: payload.photoRecords
  });
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function timestampToken(date = new Date()) {
  return `${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

function generationPrefix(date = new Date()) {
  return `sd_${getDeviceCode()}_${timestampToken(date)}`;
}

function toCsv(records = []) {
  const columns = [];
  const seen = new Set();
  records.forEach((record) => {
    Object.keys(record || {}).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      columns.push(key);
    });
  });

  const encode = (value) => {
    let text = '';
    if (value === null || value === undefined) text = '';
    else if (typeof value === 'object') text = JSON.stringify(value);
    else text = String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [columns.map(encode).join(',')];
  records.forEach((record) => {
    lines.push(columns.map((key) => encode(record?.[key])).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}`;
}

function systemFolderRef() {
  const state = getCurrentOneDriveState();
  const binding = state?.binding || {};
  const driveId = String(binding.driveId || binding.rootDriveId || '');
  const itemId = String(binding.systemFolderId || '');
  if (!driveId || !itemId) return null;
  return { driveId, itemId };
}

function canUseOneDriveBackup() {
  if (isManualOffline()) return false;
  const state = getCurrentOneDriveState();
  return Boolean(
    (state?.phase === 'formal' || state?.phase === 'temporary')
    && state?.binding?.systemFolderId
  );
}

async function trimOldGenerations(folderRef) {
  const deviceCode = getDeviceCode();
  const pattern = new RegExp(`^sd_${deviceCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{4}-\\d{4}\\.json$`);
  const items = await listDriveChildren(folderRef);
  const jsonItems = items
    .filter((item) => item.file && pattern.test(String(item.name || '')))
    .sort((a, b) => {
      const at = Date.parse(a.createdDateTime || a.lastModifiedDateTime || '') || 0;
      const bt = Date.parse(b.createdDateTime || b.lastModifiedDateTime || '') || 0;
      if (at !== bt) return bt - at;
      return String(b.name || '').localeCompare(String(a.name || ''));
    });

  const expired = jsonItems.slice(MAX_GENERATIONS_PER_DEVICE);
  if (!expired.length) return;

  for (const jsonItem of expired) {
    const prefix = String(jsonItem.name || '').replace(/\.json$/i, '');
    const generationItems = items.filter((item) => String(item.name || '').startsWith(prefix));
    for (const item of generationItems) {
      await deleteDriveItem(item);
    }
  }
}

async function saveGeneration(payload) {
  const folderRef = systemFolderRef();
  if (!folderRef) throw new Error('この案件のOneDrive保存先を確認できません。');

  const prefix = generationPrefix();
  const json = JSON.stringify({
    ...payload,
    systemData: {
      savedAt: new Date().toISOString(),
      deviceCode: getDeviceCode(),
      generation: prefix
    }
  }, null, 2);

  // JSONを世代の完成マーカーにするため、CSV3種を先に保存する。
  await uploadDriveFile(folderRef, `${prefix}_finish.csv`, toCsv(payload.finishRecords), 'text/csv;charset=utf-8');
  await uploadDriveFile(folderRef, `${prefix}_material.csv`, toCsv(payload.materialRecords), 'text/csv;charset=utf-8');
  await uploadDriveFile(folderRef, `${prefix}_photo.csv`, toCsv(payload.photoRecords), 'text/csv;charset=utf-8');
  await uploadDriveFile(folderRef, `${prefix}.json`, json, 'application/json;charset=utf-8');
  await trimOldGenerations(folderRef);
  return prefix;
}

async function saveCurrentSystemData({ requireChange = true } = {}) {
  if (inFlight) return { ok: false, reason: 'busy' };
  const payload = currentBackupPayload();
  if (!payload) return { ok: false, reason: 'no-project' };
  if (!canUseOneDriveBackup()) return { ok: false, reason: 'onedrive-unavailable' };

  const signature = payloadSignature(payload);
  if (!signature) return { ok: false, reason: 'no-data' };
  if (requireChange && signature === lastSuccessfulSignature) {
    return { ok: true, saved: false, reason: 'unchanged' };
  }

  inFlight = true;
  try {
    const generation = await saveGeneration(payload);
    lastSuccessfulSignature = signature;
    return { ok: true, saved: true, generation };
  } finally {
    inFlight = false;
  }
}

async function runScheduledBackup() {
  try {
    await saveCurrentSystemData({ requireChange: true });
  } catch (error) {
    console.warn('[v0.1.6.5H] システムデータ保存失敗', error);
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    await runScheduledBackup();
    scheduleNext();
  }, BACKUP_INTERVAL_MS);
}

function resetForProject(projectId) {
  activeProjectId = String(projectId || '');
  const payload = currentBackupPayload();
  lastSuccessfulSignature = payloadSignature(payload);
  scheduleNext();
}

/**
 * 案件を開いた後に1回だけ初期化する。
 * 初回保存は10分後。案件切替時はその時点を新しい比較基準にする。
 */
export function initializeSystemDataBackup() {
  if (initialized) return;
  initialized = true;

  resetForProject(getCurrentProject()?.projectId || '');
  subscribeProjects((project) => {
    const nextId = String(project?.projectId || '');
    if (nextId === activeProjectId) return;
    resetForProject(nextId);
  });
}

/**
 * 設定 > 同期システム > システムデータの手動保存入口。
 * 定期保存と同じ生成処理を使い、変更有無にかかわらず明示的に1世代保存する。
 */
export async function saveSystemDataNow() {
  return saveCurrentSystemData({ requireChange: false });
}

/** 復元入口用。実際の差分確認・復元処理は後段で接続する。 */
export async function listSystemDataBackups() {
  const folderRef = systemFolderRef();
  if (!folderRef || !canUseOneDriveBackup()) return [];
  const items = await listDriveChildren(folderRef);
  return items
    .filter((item) => item.file && /^sd_.+_\d{4}-\d{4}\.json$/.test(String(item.name || '')))
    .sort((a, b) => {
      const at = Date.parse(a.createdDateTime || a.lastModifiedDateTime || '') || 0;
      const bt = Date.parse(b.createdDateTime || b.lastModifiedDateTime || '') || 0;
      return bt - at;
    });
}
