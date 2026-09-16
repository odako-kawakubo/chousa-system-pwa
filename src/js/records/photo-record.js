/**
 * src/js/records/photo-record.js
 *
 * photoRecordの正式な型・生成・判定だけを持つ純粋モジュール。
 * 写真データ本体ではなく、写真1枚ごとのメタ情報を1レコードとして扱う。
 * 正本（Map<photoId, photoRecord>）はphoto-record-store.jsが保持する。
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
 * @property {string} oneDrivePath 旧互換。新規OneDrive参照の正本には使わない。
 * @property {string} oneDriveDriveId OneDrive物理ファイル参照用driveId
 * @property {string} originalItemId 元画像のOneDrive itemId
 * @property {string} completedItemId 完成画像のOneDrive itemId
 * @property {string} syncStatus Firestore上のphotoRecord同期状態。画像本体のOneDrive送信状態とは分離する。
 * @property {boolean} isRepresentative
 * @property {string} capturedDevice
 * @property {string} capturedAt
 * @property {string} boardDate 看板表示専用日付（YYYY-MM-DD）。capturedAtとは分離する。
 * @property {boolean} isEdited
 * @property {string} lastEditedDevice
 * @property {string} lastEditedAt
 * @property {boolean} deleted
 * @property {'bottom-left'|'bottom-right'|'top-right'|'top-left'|''} boardPosition
 * @property {'small'|'medium'|'large'|''} boardSize
 * @property {string} localOriginalStatus
 * @property {string} localCompletedStatus
 * @property {string} systemMemo
 * @property {string} originalPath
 * @property {string} completedPath
 * @property {string} updatedAt Firestore最終反映時刻（同期用）
 * @property {Record<string, number>} fieldEditedAt 項目ごとの編集確定時刻（競合判定用・内部情報）
 */

/** @typedef {PhotoRecordCommon & {photoType:'visual',areaCode:string,roomPosition:string,partSlot:number,roomNo:string,part:string,materialId:'',samplingPlace:'',samplingBranch:0,sampleNo:'',shootingType:''}} VisualPhotoRecord */
/** @typedef {PhotoRecordCommon & {photoType:'sampling',areaCode:'',roomPosition:'',partSlot:0,roomNo:'',materialId:string,samplingPlace:string,samplingBranch:number,sampleNo:string,sampleBaseNo:string,part:string,shootingType:'before'|'during'|'after'|'section'}} SamplingPhotoRecord */
/** @typedef {VisualPhotoRecord|SamplingPhotoRecord} PhotoRecord */

function asText(value) { return String(value ?? '').trim(); }
function normalizeSamplingBranch(value) {
  const branch = Number(value);
  return Number.isInteger(branch) && branch >= 1 && branch <= 3 ? branch : 0;
}
function normalizeVisualPartSlot(value) {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= 6 ? slot : 0;
}

export function getVisualPhotoRoomKey({ areaCode, roomPosition } = {}) {
  const area = asText(areaCode);
  const room = asText(roomPosition);
  return area && room ? `${area}|${room}` : '';
}

export function getVisualPhotoTargetKey({ areaCode, roomPosition, partSlot } = {}) {
  const roomKey = getVisualPhotoRoomKey({ areaCode, roomPosition });
  const slot = normalizeVisualPartSlot(partSlot);
  return roomKey && slot ? `visual|${roomKey}|${slot}` : '';
}

export function isVisualPhotoUnorganized(record = {}) {
  if (record.photoType && record.photoType !== PHOTO_TYPES.VISUAL) return false;
  return !getVisualPhotoTargetKey(record);
}

export function isSamplingPhotoUnorganized(record = {}) {
  if (record.photoType && record.photoType !== PHOTO_TYPES.SAMPLING) return false;
  return normalizeSamplingBranch(record.samplingBranch) === 0 || !asText(record.shootingType);
}

export function createPhotoRecord(fields) {
  const photoType = fields.photoType;
  if (!Object.values(PHOTO_TYPES).includes(photoType)) throw new Error(`未対応のphotoTypeです: ${photoType}`);

  const photoId = asText(fields.photoId);
  if (!photoId) throw new Error('photoIdは必須です。');

  const common = {
    photoId,
    photoType,
    fileName: asText(fields.fileName),
    oneDrivePath: asText(fields.oneDrivePath),
    oneDriveDriveId: asText(fields.oneDriveDriveId),
    originalItemId: asText(fields.originalItemId),
    completedItemId: asText(fields.completedItemId),
    syncStatus: asText(fields.syncStatus) || '未同期',
    isRepresentative: Boolean(fields.isRepresentative),
    capturedDevice: asText(fields.capturedDevice) || 'local',
    capturedAt: asText(fields.capturedAt),
    boardDate: asText(fields.boardDate),
    isEdited: Boolean(fields.isEdited),
    lastEditedDevice: asText(fields.lastEditedDevice),
    lastEditedAt: asText(fields.lastEditedAt),
    deleted: Boolean(fields.deleted),
    boardPosition: asText(fields.boardPosition),
    boardSize: asText(fields.boardSize),
    localOriginalStatus: asText(fields.localOriginalStatus),
    localCompletedStatus: asText(fields.localCompletedStatus),
    systemMemo: String(fields.systemMemo ?? '').trim(),
    originalPath: asText(fields.originalPath),
    completedPath: asText(fields.completedPath),
    updatedAt: fields.updatedAt || '',
    fieldEditedAt: { ...(fields.fieldEditedAt || {}) }
  };

  if (photoType === PHOTO_TYPES.VISUAL) {
    return {
      ...common,
      areaCode: asText(fields.areaCode),
      roomPosition: asText(fields.roomPosition),
      partSlot: normalizeVisualPartSlot(fields.partSlot),
      roomNo: asText(fields.roomNo),
      part: asText(fields.part),
      materialId: '', samplingPlace: '', samplingBranch: 0, sampleNo: '', sampleBaseNo: '', shootingType: ''
    };
  }

  const shootingType = asText(fields.shootingType);
  if (shootingType && !Object.values(SHOOTING_TYPES).includes(shootingType)) throw new Error(`未対応のshootingTypeです: ${shootingType}`);

  return {
    ...common,
    areaCode: '', roomPosition: '', partSlot: 0, roomNo: '',
    materialId: asText(fields.materialId),
    samplingPlace: asText(fields.samplingPlace),
    samplingBranch: normalizeSamplingBranch(fields.samplingBranch),
    sampleNo: asText(fields.sampleNo),
    sampleBaseNo: asText(fields.sampleBaseNo) || asText(fields.sampleNo).split('-')[0],
    part: asText(fields.part),
    shootingType
  };
}

export function getPhotoRepresentativeGroupKey(record) {
  if (record.photoType === PHOTO_TYPES.VISUAL) return getVisualPhotoTargetKey(record) || `visual-unlinked|${record.photoId}`;
  return `sampling|${record.materialId}|${record.samplingBranch}|${record.shootingType}`;
}

export function isActivePhotoRecord(record) { return !record.deleted; }
export function getShootingTypeLabel(shootingType) { return SHOOTING_TYPE_LABELS[shootingType] || ''; }
