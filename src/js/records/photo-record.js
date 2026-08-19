/**
 * src/js/records/photo-record.js
 *
 * photoRecordの正式な型・生成・判定だけを持つ純粋モジュール。
 * 写真データ本体ではなく、写真1枚ごとのメタ情報を1レコードとして扱う。
 * 正本（Map<photoId, photoRecord>）はphoto-record-store.jsが保持する。
 *
 * v0.1.5.3A:
 * - 旧仮定義（kind / finishId / caption / sampleName等）を廃止。
 * - 目視写真は roomPosition + part で紐付け、materialIdを持たない。
 * - 採取写真は materialId + samplingBranch + shootingType を軸に管理する。
 * - 写真削除はdeleted=trueの論理削除とし、物理削除は行わない。
 */

export const PHOTO_TYPES = Object.freeze({
  VISUAL: 'visual',
  SAMPLING: 'sampling'
});

export const SHOOTING_TYPES = Object.freeze({
  BEFORE: 'before',
  DURING: 'during',
  AFTER: 'after',
  SECTION: 'section'
});

export const SHOOTING_TYPE_LABELS = Object.freeze({
  [SHOOTING_TYPES.BEFORE]: '施工前',
  [SHOOTING_TYPES.DURING]: '施工中',
  [SHOOTING_TYPES.AFTER]: '施工後',
  [SHOOTING_TYPES.SECTION]: '断面'
});

/**
 * @typedef {object} PhotoRecordCommon
 * @property {string} photoId
 * @property {'visual'|'sampling'} photoType
 * @property {string} fileName
 * @property {string} oneDrivePath
 * @property {string} syncStatus
 * @property {boolean} isRepresentative
 * @property {string} capturedDevice
 * @property {string} capturedAt
 * @property {boolean} isEdited
 * @property {string} lastEditedDevice
 * @property {string} lastEditedAt
 * @property {boolean} deleted
 * @property {'bottom-left'|'bottom-right'|'top-right'|'top-left'|''} boardPosition
 * @property {'small'|'medium'|'large'|''} boardSize
 * @property {string} localOriginalStatus
 * @property {string} localCompletedStatus
 */

/**
 * 目視写真。
 * 建材は現在のfinishRecordから解決するため、materialIdは保持しない。
 * @typedef {PhotoRecordCommon & {
 *   photoType: 'visual',
 *   roomPosition: string,
 *   roomNo: string,
 *   part: string,
 *   materialId: '',
 *   samplingPlace: '',
 *   samplingBranch: 0,
 *   sampleNo: '',
 *   shootingType: ''
 * }} VisualPhotoRecord
 */

/**
 * 採取写真。
 * 同じ採取場所を複数枝番で選べる仕様のため、samplingBranchを独立して保持する。
 * @typedef {PhotoRecordCommon & {
 *   photoType: 'sampling',
 *   roomPosition: '',
 *   roomNo: '',
 *   materialId: string,
 *   samplingPlace: string,
 *   samplingBranch: number,
 *   sampleNo: string,
 *   sampleBaseNo: string,
 *   part: string,
 *   shootingType: 'before'|'during'|'after'|'section'
 * }} SamplingPhotoRecord
 */

/** @typedef {VisualPhotoRecord|SamplingPhotoRecord} PhotoRecord */

function asText(value) {
  return String(value ?? '').trim();
}

function normalizeSamplingBranch(value) {
  const branch = Number(value);
  return Number.isInteger(branch) && branch >= 1 && branch <= 3 ? branch : 0;
}

/**
 * photoRecordを1件生成する。
 * 該当しない種別固有項目は空値へ正規化し、Record形状を一定に保つ。
 * @param {Partial<PhotoRecord> & { photoId:string, photoType:'visual'|'sampling' }} fields
 * @returns {PhotoRecord}
 */
export function createPhotoRecord(fields) {
  const photoType = fields.photoType;
  if (!Object.values(PHOTO_TYPES).includes(photoType)) {
    throw new Error(`未対応のphotoTypeです: ${photoType}`);
  }

  const photoId = asText(fields.photoId);
  if (!photoId) throw new Error('photoIdは必須です。');

  const common = {
    photoId,
    photoType,
    fileName: asText(fields.fileName),
    oneDrivePath: asText(fields.oneDrivePath),
    syncStatus: asText(fields.syncStatus) || '未同期',
    isRepresentative: Boolean(fields.isRepresentative),
    capturedDevice: asText(fields.capturedDevice) || 'local',
    capturedAt: asText(fields.capturedAt),
    isEdited: Boolean(fields.isEdited),
    lastEditedDevice: asText(fields.lastEditedDevice),
    lastEditedAt: asText(fields.lastEditedAt),
    deleted: Boolean(fields.deleted),
    boardPosition: asText(fields.boardPosition),
    boardSize: asText(fields.boardSize),
    localOriginalStatus: asText(fields.localOriginalStatus),
    localCompletedStatus: asText(fields.localCompletedStatus)
  };

  if (photoType === PHOTO_TYPES.VISUAL) {
    return {
      ...common,
      roomPosition: asText(fields.roomPosition),
      roomNo: asText(fields.roomNo),
      part: asText(fields.part),
      materialId: '',
      samplingPlace: '',
      samplingBranch: 0,
      sampleNo: '',
      sampleBaseNo: '',
      shootingType: ''
    };
  }

  const shootingType = asText(fields.shootingType);
  if (shootingType && !Object.values(SHOOTING_TYPES).includes(shootingType)) {
    throw new Error(`未対応のshootingTypeです: ${shootingType}`);
  }

  return {
    ...common,
    roomPosition: '',
    roomNo: '',
    materialId: asText(fields.materialId),
    samplingPlace: asText(fields.samplingPlace),
    samplingBranch: normalizeSamplingBranch(fields.samplingBranch),
    sampleNo: asText(fields.sampleNo),
    sampleBaseNo: asText(fields.sampleBaseNo) || asText(fields.sampleNo).split('-')[0],
    part: asText(fields.part),
    shootingType
  };
}

/**
 * 代表写真を共有するグループキーをRecordから導出する。
 * 目視: 同じ部屋位置 + 部位
 * 採取: 同じ建材 + 採取枝番 + 撮影区分
 *
 * 採取場所は同じ値を複数枝番で選択できるため、枝番をグループ識別に使う。
 * @param {PhotoRecord} record
 */
export function getPhotoRepresentativeGroupKey(record) {
  if (record.photoType === PHOTO_TYPES.VISUAL) {
    return `visual|${record.roomPosition}|${record.part}`;
  }
  return `sampling|${record.materialId}|${record.samplingBranch}|${record.shootingType}`;
}

/** @param {PhotoRecord} record */
export function isActivePhotoRecord(record) {
  return !record.deleted;
}

/** @param {string} shootingType */
export function getShootingTypeLabel(shootingType) {
  return SHOOTING_TYPE_LABELS[shootingType] || '';
}
