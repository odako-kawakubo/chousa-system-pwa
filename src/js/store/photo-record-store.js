/**
 * src/js/store/photo-record-store.js
 *
 * Map<photoId, photoRecord>を保持する写真レコードのローカル正本。
 * 外部ストレージ・OneDrive・Firestoreとはまだ接続しない。
 *
 * 代表写真ルール:
 * - 同一グループの最初の有効写真を自動で代表にする。
 * - 2枚目以降の追加では代表を変えない。
 * - setRepresentative()でユーザー指定の代表へ変更できる。
 * - 代表写真を論理削除した場合、次の有効写真を代表へ繰り上げる。
 */

import {
  createPhotoRecord,
  getPhotoRepresentativeGroupKey,
  getVisualPhotoTargetKey,
  isActivePhotoRecord
} from '../records/photo-record.js';

/** @type {Map<string, import('../records/photo-record.js').PhotoRecord>} */
let records = new Map();

const listeners = [];
let batchDepth = 0;
let pendingNotify = false;

function notify() {
  if (batchDepth > 0) {
    pendingNotify = true;
    return;
  }
  listeners.forEach((callback) => callback());
}

function clone(record) {
  return { ...record };
}

function getGroupRecords(groupKey, { includeDeleted = false } = {}) {
  return Array.from(records.values()).filter((record) => {
    if (!includeDeleted && !isActivePhotoRecord(record)) return false;
    return getPhotoRepresentativeGroupKey(record) === groupKey;
  });
}

/** 同一グループの代表写真を必ず0件または1件に正規化する。 */
function normalizeRepresentativeForGroup(groupKey) {
  const active = getGroupRecords(groupKey);
  if (!active.length) return;

  const representatives = active.filter((record) => record.isRepresentative);
  const representativeId = representatives[0]?.photoId || active[0].photoId;

  active.forEach((record) => {
    const nextRepresentative = record.photoId === representativeId;
    if (record.isRepresentative === nextRepresentative) return;
    records.set(record.photoId, { ...record, isRepresentative: nextRepresentative });
  });
}

function normalizeAllRepresentatives() {
  const groupKeys = new Set(
    Array.from(records.values())
      .filter(isActivePhotoRecord)
      .map(getPhotoRepresentativeGroupKey)
  );
  groupKeys.forEach(normalizeRepresentativeForGroup);
}

export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

/** @returns {import('../records/photo-record.js').PhotoRecord[]} */
export function getAll() {
  return Array.from(records.values());
}

/** @returns {import('../records/photo-record.js').PhotoRecord[]} */
export function getActive() {
  return getAll().filter(isActivePhotoRecord);
}

/** @param {string} photoId */
export function get(photoId) {
  return records.get(photoId);
}

/**
 * 新規／更新を1つの入口で扱う。
 * 新規グループの最初の写真は自動で代表になる。
 * isRepresentative=trueを渡した場合は同一グループの代表をその写真へ切り替える。
 * @param {Partial<import('../records/photo-record.js').PhotoRecord> & {photoId:string, photoType:'visual'|'sampling'}} fields
 */
export function set(fields) {
  const previous = records.get(fields.photoId);
  const record = createPhotoRecord({ ...(previous || {}), ...fields });
  const previousGroupKey = previous ? getPhotoRepresentativeGroupKey(previous) : '';
  const nextGroupKey = getPhotoRepresentativeGroupKey(record);

  if (record.isRepresentative && !record.deleted) {
    getGroupRecords(nextGroupKey).forEach((candidate) => {
      if (candidate.photoId === record.photoId || !candidate.isRepresentative) return;
      records.set(candidate.photoId, { ...candidate, isRepresentative: false });
    });
  }

  records.set(record.photoId, record);

  if (previousGroupKey && previousGroupKey !== nextGroupKey) {
    normalizeRepresentativeForGroup(previousGroupKey);
  }
  normalizeRepresentativeForGroup(nextGroupKey);
  notify();
  return records.get(record.photoId);
}

/** @param {string} photoId */
export function setRepresentative(photoId) {
  const target = records.get(photoId);
  if (!target || target.deleted) return false;

  const groupKey = getPhotoRepresentativeGroupKey(target);
  getGroupRecords(groupKey).forEach((record) => {
    const nextValue = record.photoId === photoId;
    if (record.isRepresentative === nextValue) return;
    records.set(record.photoId, { ...record, isRepresentative: nextValue });
  });
  notify();
  return true;
}

/**
 * 写真を論理削除する。Recordも外部原本も物理削除しない。
 * 代表写真だった場合は同一グループの次の有効写真へ代表を移す。
 * @param {string} photoId
 */
export function markDeleted(photoId) {
  const target = records.get(photoId);
  if (!target || target.deleted) return false;

  const groupKey = getPhotoRepresentativeGroupKey(target);
  records.set(photoId, { ...target, deleted: true, isRepresentative: false });
  normalizeRepresentativeForGroup(groupKey);
  notify();
  return true;
}

/**
 * 目視写真は areaCode + roomPosition + partSlot の共通キーだけで検索する。
 *
 * 注意:
 * この方式はroomPositionが不変である現在運用を前提にしている。
 * ＋挿入機能を将来UIから再度有効化する場合は、roomUid基準へ再設計すること。
 * @param {{areaCode:string, roomPosition:string, partSlot:number, includeDeleted?:boolean}} criteria
 */
export function findVisual(criteria) {
  const targetKey = getVisualPhotoTargetKey(criteria);
  if (!targetKey) return [];
  return getAll().filter((record) => {
    if (record.photoType !== 'visual') return false;
    if (!criteria.includeDeleted && record.deleted) return false;
    return getVisualPhotoTargetKey(record) === targetKey;
  });
}

/** @param {{materialId:string, samplingBranch?:number, shootingType?:string, includeDeleted?:boolean}} criteria */
export function findSampling(criteria) {
  return getAll().filter((record) => {
    if (record.photoType !== 'sampling') return false;
    if (!criteria.includeDeleted && record.deleted) return false;
    if (record.materialId !== String(criteria.materialId ?? '')) return false;
    if (criteria.samplingBranch != null && record.samplingBranch !== Number(criteria.samplingBranch)) return false;
    if (criteria.shootingType != null && record.shootingType !== String(criteria.shootingType)) return false;
    return true;
  });
}

export function exportSnapshot() {
  return getAll().map(clone);
}

/** @param {import('../records/photo-record.js').PhotoRecord[]} snapshotRecords */
export function replaceAll(snapshotRecords, options = {}) {
  records = new Map(
    snapshotRecords.map((record) => {
      const normalized = createPhotoRecord(record);
      return [normalized.photoId, normalized];
    })
  );
  normalizeAllRepresentatives();
  if (options.notify !== false) notify();
}

export function batch(callback) {
  batchDepth += 1;
  try {
    callback();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0 && pendingNotify) {
      pendingNotify = false;
      notify();
    }
  }
}


export function clearAll() {
  records = new Map();
}
