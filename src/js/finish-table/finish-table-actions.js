/**
 * src/js/finish-table/finish-table-actions.js
 *
 * 仕上表・建材の業務ロジック。
 *
 * v0.1.6.2 方針：
 * - 1入力枠 = 1 finishRecord。未入力枠も実レコードとして保持する。
 * - 独立した部屋レコード／代表レコード／rowCountsは持たない。
 * - 同一部屋のfinishRecordは内部補助ID roomUid で束ねる。
 * - 部屋追加・入力行追加は、必要なfinishRecordそのものを生成する。
 * - 建材の部位・使用箇所はfinishRecordStoreから派生してmaterialRecordへ反映する。
 * - 新規建材登録は登録ボタンをトリガーとし、末尾英字を A..Z, AA, AB... で自動採番する。
 */

import {
  PART_POSITION,
  computeFinishId,
  computeCellPosition,
  buildFloorRoomPosition,
  roomIndexFromRoomPosition,
  partIndexFromPosition,
  rowFromPosition,
  createFinishRecord,
  nextRoomUid
} from '../records/finish-record.js';
import {
  createMaterialRecord,
  normalizeMaterialName,
  splitBaseNameAndSuffix,
  nextMaterialSuffix,
  nextMaterialId
} from '../records/material-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import {
  INITIAL_ROW_COUNT,
  INTERNAL_PARTS,
  EXTERNAL_PARTS
} from './finish-table-constants.js';
import { INITIAL_STRUCTURE_SEED } from '../demo/sample-finish-data.js';
import { SAMPLE_MATERIALS_SEED } from '../demo/sample-materials.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import {
  deleteFinishForProject,
  persistFinishForProject,
  persistMaterialForProject,
  hasKnownFinishRecord
} from '../sync/project-record-persistence.js';
import { applySingleRecordSamplingAutofill } from '../materials/material-sampling-autofill.js';
import {
  getRequiredStructureRecordIds,
  defaultPartForRecord,
  defaultRoomFieldsForRecord
} from '../sync/finish-sparse-structure.js';

const ROOMS_PER_FLOOR = 10;
const PART_COUNT = 6;
const PERSISTED_FINISH_EDIT_FIELDS = new Set(['roomNo', 'roomName', 'part', 'materialId']);

function pad(value, length) { return String(value).padStart(length, '0'); }
function nowIso() { return new Date().toISOString(); }

function partsForArea(areaCode) {
  return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
}

function defaultPartName(areaCode, partIndex) {
  const raw = partsForArea(areaCode)[partIndex - 1] || '';

  // その他1/2は、建材の有無に関係なく実部位が未入力なら空欄のまま保持する。
  // 業務上の「その他」扱いはmaterialRecordの部位集計時だけ行う。
  return partIndex >= 5 ? '' : raw;
}

function normalizeCandidateMaterialInput(rawValue) {
  const normalized = normalizeMaterialName(rawValue);
  // 候補の優先1は「【入力ID】建材名称」で表示するため、確定時は表示用IDを外して名称だけ扱う。
  return normalized.replace(/^【\d+】\s*/, '');
}


/** materialRecord.part を仕上表で選択できる実部位一覧へ分解する。 */
export function getMaterialPartOptions(materialRecord) {
  return [...new Set(
    String(materialRecord?.part || '')
      .split(/[、,，]/)
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

/**
 * その他1/2へ既存建材を紐付けるときの部位反映。
 * 1部位なら自動反映、複数部位なら既存の有効選択だけを維持し、
 * 未選択・不一致なら空欄にしてUI側で選択させる。
 */
function partPatchForExistingMaterial(currentCell, partIndex, materialRecord) {
  if (partIndex < 5) return {};
  const parts = getMaterialPartOptions(materialRecord);
  if (parts.length === 1) return { part: parts[0] };
  if (parts.length > 1) {
    const currentPart = String(currentCell?.part || '').trim();
    return parts.includes(currentPart) ? {} : { part: '' };
  }
  return {};
}

function appendSystemMemo(existing, message) {
  const text = String(existing || '').trim();
  const line = `${new Date().toISOString().slice(0, 10)} ${message}`;
  return text ? `${text}\n${line}` : line;
}

/* ============================================================
   部屋識別・取得
   ============================================================ */

export function roomKeyOf(record) { return record?.roomUid || ''; }

/**
 * 互換API名。旧「代表レコード」ではなく、roomUidに属する最初の有効レコードを返す。
 * controller/view-model側の呼び出し名を変えず、内部設計だけ正式仕様へ置き換える。
 */
export function findRepresentativeByRoomKey(roomKey) {
  if (!roomKey) return null;
  return finishRecordStore.getAll().find((record) => record.roomUid === roomKey && record.status === 'active') || null;
}

export function floorKeyOf(areaCode, floor) { return `floor-${areaCode}-${floor}`; }

function parseFloorKey(floorKey) {
  const match = /^floor-([IB])-(-?\d+)$/.exec(floorKey || '');
  return match ? { areaCode: match[1], floor: Number(match[2]) } : null;
}

export function isFirstNormalFloorFirstRoom(record) {
  return !!record && record.areaCode === 'I' && Number(record.floor) === 1
    && roomIndexFromRoomPosition(record.roomPosition) === 1;
}

export function getRoomRecords(roomKey) {
  return finishRecordStore.getAll()
    .filter((record) => record.roomUid === roomKey && record.status === 'active')
    .sort((a, b) => a.position - b.position);
}

export function snapshotRoomRecords(roomKey) {
  return getRoomRecords(roomKey).map((record) => ({ ...record }));
}

export function roomHasRecordedContent(roomKey) {
  return getRoomRecords(roomKey).some((record) => {
    if (record.materialId || record.inputId) return true;
    const partIndex = partIndexFromPosition(record.position);
    return partIndex >= 5 && record.part && record.part !== 'その他';
  });
}

function uniqueRoomAnchors(areaCode, floor = undefined) {
  const byRoom = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.areaCode !== areaCode) return;
    if (floor !== undefined && Number(record.floor) !== Number(floor)) return;
    if (!byRoom.has(record.roomUid)) byRoom.set(record.roomUid, record);
  });
  return Array.from(byRoom.values());
}

/* ============================================================
   finishRecord生成
   ============================================================ */

function createRoomRecords({ areaCode, roomPosition, floor, roomNo, roomName, rowCount = INITIAL_ROW_COUNT, roomUid = nextRoomUid() }) {
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    for (let row = 1; row <= rowCount; row += 1) {
      records.push(createFinishRecord({
        areaCode,
        roomPosition,
        floor,
        roomNo,
        roomName,
        position: computeCellPosition(partIndex, row),
        part: defaultPartName(areaCode, partIndex),
        roomUid
      }));
    }
  }
  return records;
}

function buildFloorRoomSeed(areaCode, floor, index) {
  const roomPosition = buildFloorRoomPosition(floor, index);
  const prefix = areaCode === 'B' ? `B${floor}` : String(floor);
  const label = `${prefix}-${index}`;
  return createRoomRecords({ areaCode, roomPosition, floor, roomNo: label, roomName: '' });
}

function buildFlatRoomSeed(areaCode, index, customName = '') {
  const roomPosition = pad(index, 3);
  let roomNo = customName;
  let roomName = customName;
  if (!customName && areaCode === 'S') { roomNo = `S-${index}`; roomName = `階段${index}`; }
  if (!customName && areaCode === 'R') { roomNo = `R-${index}`; roomName = index === 1 ? '屋上' : `屋上${index}`; }
  if (!customName && areaCode === 'E') { roomNo = `面${index}`; roomName = ''; }
  return createRoomRecords({ areaCode, roomPosition, floor: null, roomNo, roomName });
}

function rekeyRecordToRoomPosition(record, newRoomPosition) {
  const oldId = record.finishId;
  const nextId = computeFinishId(record.areaCode, newRoomPosition, record.position);
  if (oldId === nextId) return record;
  return {
    ...record,
    roomPosition: newRoomPosition,
    finishId: nextId,
    updatedAt: nowIso()
  };
}

/* ============================================================
   Firestore疎保存
   ============================================================ */

function roomCarrierRecord(roomRecords = []) {
  // 部屋No. / 部屋名と、＋階／＋部屋の構造保持は標準末尾602へ集約する。
  // ＋行の603以降は行構造専用であり、部屋共通情報のcarrierにはしない。
  const standardCarrierPosition = computeCellPosition(PART_COUNT, INITIAL_ROW_COUNT);
  return roomRecords.find((record) => Number(record.position) === standardCarrierPosition) || null;
}

function isFinishCellAtDefault(record) {
  if (!record) return true;
  return !String(record.materialId || '') && String(record.part || '') === String(defaultPartForRecord(record) || '');
}

function hasRoomCommonDifference(record) {
  if (!record) return false;
  const defaults = defaultRoomFieldsForRecord(record);
  return String(record.roomNo || '') !== String(defaults.roomNo || '')
    || String(record.roomName || '') !== String(defaults.roomName || '');
}

function shouldKeepSparseFinishRecord(record, allRecords = finishRecordStore.getAll()) {
  if (!record?.finishId) return false;
  if (getRequiredStructureRecordIds(allRecords).has(record.finishId)) return true;
  if (!isFinishCellAtDefault(record)) return true;
  const carrier = roomCarrierRecord(allRecords.filter((item) => item.roomUid === record.roomUid && item.status === 'active'));
  if (carrier?.finishId === record.finishId && hasRoomCommonDifference(record)) return true;
  if (String(record.systemMemo || '').trim()) return true;
  return false;
}

function persistSparseFinishRecord(project, record, allRecords = finishRecordStore.getAll()) {
  if (!project?.projectId || project.isSample || !record?.finishId) return;
  if (shouldKeepSparseFinishRecord(record, allRecords)) {
    persistFinishForProject(project, record, 'finish-sparse-cell');
    return;
  }
  // Firestoreに存在しない初期レコードはdelete自体を送らない。
  if (hasKnownFinishRecord(project.projectId, record.finishId)) deleteFinishForProject(project, record, 'finish-sparse-reset');
}

function persistAddedStructureMarker(records = []) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample || !records.length) return;
  const marker = roomCarrierRecord(records);
  if (marker) persistFinishForProject(project, marker, 'finish-structure-marker');
}

/* ============================================================
   構造変更
   ============================================================ */

const STRUCTURE_COMPARE_FIELDS = Object.freeze([
  'finishId', 'areaCode', 'roomPosition', 'floor', 'roomNo', 'roomName',
  'position', 'part', 'materialId'
]);

function sameStructureRecord(a, b) {
  if (!a || !b) return false;
  return STRUCTURE_COMPARE_FIELDS.every((field) => String(a[field] ?? '') === String(b[field] ?? ''));
}

/**
 * ＋階／＋部屋／＋行／コピーなど、複数finishRecordを一度に変える操作の共通保存。
 * 新規・変更Recordはset、構造から消えたRecordだけdeleteする。
 */
function persistFinishStructureChange(beforeRecords, afterRecords) {
  const project = getCurrentProject();
  if (!project?.projectId || project.isSample) return;

  const beforeMap = new Map(beforeRecords.map((record) => [record.finishId, record]));
  const afterMap = new Map(afterRecords.map((record) => [record.finishId, record]));

  const removed = beforeRecords.filter((record) => !afterMap.has(record.finishId));
  const changed = afterRecords.filter((record) => {
    const previous = beforeMap.get(record.finishId);
    return !previous || !sameStructureRecord(previous, record);
  });

  // H: ローカルの完全構造をそのままFirestoreへ複製しない。
  // 入力差分または復元に必要な構造保持レコードだけを残す。
  changed.forEach((record) => persistSparseFinishRecord(project, record, afterRecords));
  removed.forEach((record) => {
    if (hasKnownFinishRecord(project.projectId, record.finishId)) deleteFinishForProject(project, record, 'finish-sparse-reset');
  });
}

function listFloorNumbers(areaCode) {
  return [...new Set(uniqueRoomAnchors(areaCode).map((record) => Number(record.floor)))];
}

function countRoomsInFloor(areaCode, floor) { return uniqueRoomAnchors(areaCode, floor).length; }
function countFlatRooms(areaCode) { return uniqueRoomAnchors(areaCode).length; }

function insertFloorRoomAt(areaCode, floor, insertIndex) {
  const before = finishRecordStore.getAll();
  const shifted = before.map((record) => {
    if (record.areaCode !== areaCode || Number(record.floor) !== floor) return record;
    const idx = roomIndexFromRoomPosition(record.roomPosition);
    return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, buildFloorRoomPosition(floor, idx + 1));
  });
  finishRecordStore.replaceAll([...shifted, ...buildFloorRoomSeed(areaCode, floor, insertIndex)]);
  persistFinishStructureChange(before, finishRecordStore.getAll());
}

function insertFlatRoomAt(areaCode, insertIndex) {
  const before = finishRecordStore.getAll();
  const shifted = before.map((record) => {
    if (record.areaCode !== areaCode) return record;
    const idx = Number(record.roomPosition);
    return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, pad(idx + 1, 3));
  });
  finishRecordStore.replaceAll([...shifted, ...buildFlatRoomSeed(areaCode, insertIndex)]);
  persistFinishStructureChange(before, finishRecordStore.getAll());
}

export function addNormalFloor() {
  const floors = listFloorNumbers('I');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('I', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === ROOMS_PER_FLOOR));
  return `floor-I-${next}`;
}

export function addBasementFloor() {
  const floors = listFloorNumbers('B');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('B', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records.filter((record) => roomIndexFromRoomPosition(record.roomPosition) === ROOMS_PER_FLOOR));
  return `floor-B-${next}`;
}

export function addStairs() {
  const records = buildFlatRoomSeed('S', countFlatRooms('S') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
  return 'stairs-group';
}

export function addRoof() {
  const records = buildFlatRoomSeed('R', countFlatRooms('R') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
  return 'roof-group';
}

export function addExternalRoom() {
  const records = buildFlatRoomSeed('E', countFlatRooms('E') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addRoomToFloor(floorKey) {
  const parsed = parseFloorKey(floorKey);
  if (!parsed) return;
  const index = countRoomsInFloor(parsed.areaCode, parsed.floor) + 1;
  const records = buildFloorRoomSeed(parsed.areaCode, parsed.floor, index);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  persistAddedStructureMarker(records);
}

export function addRoomAfter(roomKey) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return;
  if (anchor.areaCode === 'I' || anchor.areaCode === 'B') {
    insertFloorRoomAt(anchor.areaCode, Number(anchor.floor), roomIndexFromRoomPosition(anchor.roomPosition) + 1);
  } else {
    insertFlatRoomAt(anchor.areaCode, Number(anchor.roomPosition) + 1);
  }
}

/** 6部位すべてに「次の入力行」の空レコードを1件ずつ生成する。 */
export function addInputRow(roomKey) {
  const before = finishRecordStore.getAll();
  const roomRecords = getRoomRecords(roomKey);
  const anchor = roomRecords[0];
  if (!anchor) return;
  const maxRow = Math.max(...roomRecords.map((record) => rowFromPosition(record.position)), 0);
  const nextRow = maxRow + 1;
  const records = [];
  for (let partIndex = 1; partIndex <= PART_COUNT; partIndex += 1) {
    records.push(createFinishRecord({
      areaCode: anchor.areaCode,
      roomPosition: anchor.roomPosition,
      floor: anchor.floor,
      roomNo: anchor.roomNo,
      roomName: anchor.roomName,
      position: computeCellPosition(partIndex, nextRow),
      part: defaultPartName(anchor.areaCode, partIndex),
      roomUid: anchor.roomUid
    }));
  }
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  const marker = records.find((record) => partIndexFromPosition(record.position) === PART_COUNT);
  if (marker) persistFinishForProject(getCurrentProject(), marker, 'finish-structure-marker');
}

/* ============================================================
   部屋情報変更
   ============================================================ */

export function commitRoomField(roomKey, field, rawValue) {
  const records = getRoomRecords(roomKey);
  if (!records.length) return;
  const value = field === 'room-no' ? String(rawValue ?? '').trim() : String(rawValue ?? '');
  const dataField = field === 'room-no' ? 'roomNo' : 'roomName';
  const changed = records.filter((record) => String(record[dataField] ?? '') !== value);
  if (!changed.length) return;
  const confirmedAt = Date.now();
  const nextRecords = changed.map((record) => ({
    ...record,
    [dataField]: value,
    fieldEditedAt: touchFieldEditedAt(record.fieldEditedAt, dataField, confirmedAt)
  }));
  finishRecordStore.batch(() => nextRecords.forEach((record) => finishRecordStore.set(record)));
  const project = getCurrentProject();
  const currentRoomRecords = getRoomRecords(roomKey);
  const carrier = roomCarrierRecord(currentRoomRecords);
  if (carrier) persistSparseFinishRecord(project, carrier, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-common-edit');
}

/* ============================================================
   セル編集
   ============================================================ */

function cellFinishId(anchor, partIndex, row) {
  return computeFinishId(anchor.areaCode, anchor.roomPosition, computeCellPosition(partIndex, row));
}

function writeCellPatch(anchor, partIndex, row, patch, options = {}) {
  const finishId = cellFinishId(anchor, partIndex, row);
  const existing = finishRecordStore.get(finishId);
  if (!existing) {
    throw new Error(`仕上表レコードが存在しません: ${finishId}`);
  }
  const changedFields = Object.keys(patch).filter((field) => String(existing[field] ?? '') !== String(patch[field] ?? ''));
  if (!changedFields.length) return existing;
  const syncFields = changedFields.filter((field) => PERSISTED_FINISH_EDIT_FIELDS.has(field));

  // その他1/2のpartも入力値をそのまま保持する。
  // 空欄をタップしただけ・空欄のまま編集終了しただけで「その他」を実データ化しない。
  const next = {
    ...existing,
    ...patch,
    fieldEditedAt: syncFields.length
      ? touchFieldEditedAt(existing.fieldEditedAt, syncFields)
      : { ...(existing.fieldEditedAt || {}) }
  };
  finishRecordStore.set(next);
  if (syncFields.length) persistSparseFinishRecord(getCurrentProject(), next, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('finish-cell-patch', { persist: options.persistMaterialDerived !== false });
  return next;
}

export function commitCellId(roomKey, partIndex, row, rawInputId) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const inputId = String(rawInputId ?? '').trim();
  const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));

  if (!inputId) {
    // その他1/2は建材ID解除を「この入力枠を初期状態へ戻す」操作として扱い、
    // 建材紐付けだけでなく実部位も同時に空欄へ戻す。
    writeCellPatch(anchor, partIndex, row, {
      inputId: '',
      materialId: '',
      ...(partIndex >= 5 ? { part: '' } : {})
    });
    return null;
  }

  const material = materialRecordStore.findByInputId(inputId);
  if (!material) {
    writeCellPatch(anchor, partIndex, row, { inputId, materialId: '' });
    return null;
  }

  writeCellPatch(anchor, partIndex, row, {
    inputId: String(material.inputId),
    materialId: material.materialId,
    ...partPatchForExistingMaterial(currentCell, partIndex, material)
  });
  return material;
}

export function commitCellName(roomKey, partIndex, row, rawName) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const name = normalizeCandidateMaterialInput(rawName);
  if (!name) {
    writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '' });
    return null;
  }
  const material = materialRecordStore.findByName(name);
  if (material) {
    writeCellPatch(anchor, partIndex, row, { inputId: String(material.inputId), materialId: material.materialId });
    return material;
  }
  // 未登録名称自体はUIのpending状態で保持し、正式finishRecordは未リンク状態のまま。
  writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '' });
  return null;
}

export function commitCellActualPart(roomKey, partIndex, row, rawValue) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return;
  writeCellPatch(anchor, partIndex, row, { part: String(rawValue ?? '') });

  // その他部位を変更したら建材Recordの使用部位も同時に再集計する。
  // これにより次に開く建材候補の優先1/2が最新部位へ追従する。
  refreshMaterialUsageDerivedFields('actual-part-edit');
}

export function isCellPendingRegistration(roomKey, partIndex, row) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return false;
  const record = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
  return Boolean(record) && !record.materialId;
}

export function applyMaterialToCell(roomKey, partIndex, row, materialRecord) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor || !materialRecord) return;
  const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
  writeCellPatch(anchor, partIndex, row, {
    inputId: String(materialRecord.inputId),
    materialId: materialRecord.materialId,
    ...partPatchForExistingMaterial(currentCell, partIndex, materialRecord)
  });
}

function nextInputIdForMaterials() {
  const ids = materialRecordStore.getAll().map((m) => Number(m.inputId) || 0);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

/**
 * 登録ボタンによる新規建材登録。
 * 明示末尾英字が無い場合だけ、同一ベース名の既存建材を見て次サフィックスを自動採番する。
 */
export function registerMaterialForCell(roomKey, partIndex, row, rawName) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  const normalized = normalizeCandidateMaterialInput(rawName);
  if (!anchor || !normalized) return null;

  let material = materialRecordStore.findByName(normalized);
  let createdNewMaterial = false;
  let beforeMaterial = material ? { ...material } : null;

  runRecordTransaction(() => {
    if (!material) {
      const parsed = splitBaseNameAndSuffix(normalized);
      const suffix = parsed.suffixLetter || nextMaterialSuffix(parsed.baseName, materialRecordStore.getAll());
      const finalName = parsed.suffixLetter ? normalized : `${parsed.baseName}${suffix}`;

      material = materialRecordStore.findByName(finalName);
      if (material && !beforeMaterial) beforeMaterial = { ...material };
      if (!material) {
        const inputId = nextInputIdForMaterials();
        material = createMaterialRecord({
          materialId: nextMaterialId(materialRecordStore.getAll().map((m) => m.materialId)),
          inputId,
          materialNo: inputId,
          name: finalName,
          baseName: parsed.baseName,
          suffixLetter: suffix
        });
        material = {
          ...material,
          fieldEditedAt: touchFieldEditedAt(material.fieldEditedAt, ['name', 'analysisRequired', 'sampleCount'])
        };
        materialRecordStore.set(material);
        createdNewMaterial = true;
      }
    }

    // その他1/2では、建材を正式登録する時点で実部位が未入力なら
    // 業務上の部位として「その他」を確定する。
    // タップしただけ／空欄のまま編集終了／部屋コピーでは補完しない。
    const currentCell = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
    const finishPatch = {
      inputId: String(material.inputId),
      materialId: material.materialId
    };
    if (partIndex >= 5 && !String(currentCell?.part || '').trim()) {
      finishPatch.part = 'その他';
    }

    // 登録操作中はfinishRecord自体は通常どおり保存するが、
    // そこから派生するmaterialの途中状態はFirestoreへ送らない。
    writeCellPatch(anchor, partIndex, row, finishPatch, { persistMaterialDerived: false });

    // finishRecordを正として更新済みの最新materialへ、採取設定の自動補完も
    // ローカルで完了させる。ここでもFirestoreへはまだ送らない。
    const derivedMaterial = materialRecordStore.get(material.materialId) || material;
    const finalMaterial = { ...derivedMaterial };
    const autofillFields = applySingleRecordSamplingAutofill(finalMaterial);
    if (autofillFields.length) {
      finalMaterial.fieldEditedAt = touchFieldEditedAt(derivedMaterial.fieldEditedAt, autofillFields);
      materialRecordStore.set(finalMaterial);
    }

    material = materialRecordStore.get(material.materialId) || finalMaterial;

    // 新規建材、または既存建材でも今回の紐付けで派生値が変わった場合だけ、
    // 完成したmaterialRecordを既存の1レコード保存経路から1回だけ送る。
    const materialChanged = createdNewMaterial
      || !beforeMaterial
      || String(beforeMaterial.part ?? '') !== String(material.part ?? '')
      || String(beforeMaterial.usageLocation ?? '') !== String(material.usageLocation ?? '')
      || autofillFields.length > 0;
    if (materialChanged) {
      persistMaterialForProject(getCurrentProject(), material, 'material-register-final');
    }
  });
  return material;
}

/* ============================================================
   建材レコード派生値
   ============================================================ */

/** finishRecordStoreを正として、全建材の部位・使用箇所を再計算する。 */
export function refreshMaterialUsageDerivedFields(source = 'usageLocation-recalc', options = {}) {
  const shouldPersist = options.persist !== false;
  const finishRecords = finishRecordStore.getAll().filter((record) => record.status === 'active' && record.materialId);
  const byMaterial = new Map();
  finishRecords.forEach((record) => {
    if (!byMaterial.has(record.materialId)) byMaterial.set(record.materialId, { parts: [], places: [] });
    const item = byMaterial.get(record.materialId);
    // その他1/2の部位未選択（空欄）は、複数部位建材の選択途中を表すことがある。
    // 新規登録時の「その他」は登録確定処理で明示的に入るため、ここで空欄を
    // 勝手に「その他」へ変換せず、確定済みの実部位だけを建材Recordへ集計する。
    const part = String(record.part || '').trim();
    const place = String(record.roomNo || record.roomName || '').trim();
    if (part && !item.parts.includes(part)) item.parts.push(part);
    if (place && !item.places.includes(place)) item.places.push(place);
  });

  materialRecordStore.batch(() => {
    materialRecordStore.getAll().forEach((material) => {
      const derived = byMaterial.get(material.materialId) || { parts: [], places: [] };
      const part = derived.parts.join('、');
      const usageLocation = derived.places.join('、');
      if (material.part === part && material.usageLocation === usageLocation) return;
      const next = {
        ...material,
        part,
        usageLocation,
        fieldEditedAt: touchFieldEditedAt(material.fieldEditedAt, ['part', 'usageLocation'])
      };
      materialRecordStore.set(next);
      if (shouldPersist) persistMaterialForProject(getCurrentProject(), next, source);
    });
  });
}

function materialUsageSortKey(record) {
  const areaCode = String(record?.areaCode || '');
  const floor = Number(record?.floor);
  const position = String(record?.roomPosition || '');

  // 使用箇所は現場で見る順を固定する。
  // 外部 → 地下 → 1階 → 階段 → 2階以降 → 屋上。
  if (areaCode === 'E') return [0, 0, position];
  if (areaCode === 'B') return [1, Number.isFinite(floor) ? floor : 0, position];
  if (areaCode === 'I' && floor === 1) return [2, 1, position];
  if (areaCode === 'S') return [3, 0, position];
  if (areaCode === 'I') return [4, Number.isFinite(floor) ? floor : 9999, position];
  if (areaCode === 'R') return [5, 0, position];
  return [6, Number.isFinite(floor) ? floor : 9999, position];
}

export function getMaterialUsageRoomNos(inputId) {
  const material = materialRecordStore.findByInputId(inputId);
  if (!material) return [];

  // 1入力枠ごとのfinishRecordを、そのままroomNoへmapすると登録順になるため、
  // roomUid単位で代表Recordを1件にまとめてから業務上の表示順で並べる。
  const byRoom = new Map();
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.materialId !== material.materialId) return;
    const key = record.roomUid || `${record.areaCode}|${record.roomPosition}`;
    if (!byRoom.has(key)) byRoom.set(key, record);
  });

  return [...byRoom.values()]
    .sort((a, b) => {
      const ak = materialUsageSortKey(a);
      const bk = materialUsageSortKey(b);
      for (let i = 0; i < ak.length; i += 1) {
        if (ak[i] < bk[i]) return -1;
        if (ak[i] > bk[i]) return 1;
      }
      return 0;
    })
    .map((record) => String(record.roomNo || '').trim())
    .filter(Boolean);
}

/* ============================================================
   部屋コピー
   ============================================================ */

function sameAreaFamily(a, b) {
  const familyOf = (code) => (code === 'E' ? 'external' : 'internal');
  return !!a && !!b && familyOf(a) === familyOf(b);
}

export function getRoomCopyButtonState(roomCopyState, roomKey) {
  if (roomCopyState.done[roomKey]) return 'restore';
  if (roomCopyState.sourceRoomKey === roomKey) return 'source';
  if (roomCopyState.sourceRoomKey) return roomHasRecordedContent(roomKey) ? 'target-overwrite' : 'target-empty';
  return 'idle';
}

export function describeRoomCopyClick(roomCopyState, roomKey) {
  const target = findRepresentativeByRoomKey(roomKey);
  if (!target) return { type: 'none' };
  if (roomCopyState.done[roomKey]) return { type: 'restore' };
  if (!roomCopyState.sourceRoomKey) return { type: 'become-source' };
  if (roomCopyState.sourceRoomKey === roomKey) return { type: 'cancel-source' };
  const source = findRepresentativeByRoomKey(roomCopyState.sourceRoomKey);
  return {
    type: 'copy',
    crossFamily: !sameAreaFamily(source?.areaCode, target.areaCode),
    overwrite: roomHasRecordedContent(roomKey)
  };
}

export function executeRoomCopy(sourceRoomKey, targetRoomKey) {
  const before = finishRecordStore.getAll();
  const sourceRecords = getRoomRecords(sourceRoomKey);
  const targetRecords = getRoomRecords(targetRoomKey);
  const target = targetRecords[0];
  if (!sourceRecords.length || !target) return;

  // コピー先には、既に存在するfinishRecordへ値だけを書き込む。
  // コピー元の方が行数が多い場合だけ不足する入力枠を新規生成し、
  // コピー元の方が少ない場合は余分な入力枠を除いて行構成を一致させる。
  const sourcePositions = new Set(sourceRecords.map((record) => record.position));
  const targetByPosition = new Map(targetRecords.map((record) => [record.position, record]));
  const confirmedAt = Date.now();

  finishRecordStore.batch(() => {
    // コピー元に存在しない余分な行は、コピー後の行構成から外す。
    targetRecords.forEach((record) => {
      if (!sourcePositions.has(record.position)) finishRecordStore.remove(record.finishId);
    });

    sourceRecords.forEach((source) => {
      const partIndex = partIndexFromPosition(source.position);
      const part = partIndex >= 5 ? String(source.part || '').trim() : defaultPartName(target.areaCode, partIndex);
      const existing = targetByPosition.get(source.position);

      if (existing) {
        // 既存のコピー先レコードはID・位置情報を維持し、入力内容だけ上書きする。
        const changedFields = [];
        if (String(existing.part || '') !== String(part || '')) changedFields.push('part');
        if (String(existing.materialId || '') !== String(source.materialId || '')) changedFields.push('materialId');
        finishRecordStore.set({
          ...existing,
          part,
          materialId: source.materialId,
          inputId: source.inputId,
          fieldEditedAt: changedFields.length
            ? touchFieldEditedAt(existing.fieldEditedAt, changedFields, confirmedAt)
            : { ...(existing.fieldEditedAt || {}) },
          updatedAt: nowIso()
        });
        return;
      }

      // コピー元の行数が多い場合のみ、コピー先に不足するfinishRecordを追加する。
      finishRecordStore.set(createFinishRecord({
        areaCode: target.areaCode,
        roomPosition: target.roomPosition,
        floor: target.floor,
        roomNo: target.roomNo,
        roomName: target.roomName,
        position: source.position,
        part,
        materialId: source.materialId,
        inputId: source.inputId,
        fieldEditedAt: touchFieldEditedAt({}, ['part', 'materialId'], confirmedAt),
        roomUid: target.roomUid
      }));
    });
  });
  persistFinishStructureChange(before, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-copy');
}

export function restoreRoomCopy(roomKey, backupRecords) {
  if (!backupRecords?.length) return;
  const before = finishRecordStore.getAll();
  const current = getRoomRecords(roomKey);
  finishRecordStore.batch(() => {
    current.forEach((record) => finishRecordStore.remove(record.finishId));
    backupRecords.forEach((record) => finishRecordStore.set({ ...record }));
  });
  persistFinishStructureChange(before, finishRecordStore.getAll());
  refreshMaterialUsageDerivedFields('room-copy-restore');
}

/* ============================================================
   初期投入
   ============================================================ */

export function seedInitialMaterials() {
  const records = SAMPLE_MATERIALS_SEED.map(([materialId, inputId, name, note, photoCount]) => {
    // v0.1.5.3B 写真タブの建材採取UIを実機確認できるよう、
    // demoデータのうち2件だけ採取対象として初期設定する。
    // 本番の採取条件・保存処理とは切り離したサンプル値。
    const samplingDemo = materialId === 'R001'
      ? { analysisRequired: '採取・分析', sampleCount: 2, sampleLocation1: '1-1', sampleLocation2: '1-2', samplePart: '壁' }
      : materialId === 'R002'
        ? { analysisRequired: '採取・分析', sampleCount: 1, sampleLocation1: '北面', samplePart: '外壁' }
        : {};

    return createMaterialRecord({
      materialId,
      inputId,
      materialNo: inputId,
      name: normalizeMaterialName(name),
      note,
      photoCount,
      ...samplingDemo
    });
  });
  materialRecordStore.batch(() => records.forEach((record) => materialRecordStore.set(record)));
}

/**
 * 初期確認用：テスト建材を仕上表へランダム風に配置する。
 * Math.random()は使わず固定シードを使うため、同じレビュー版では毎回同じ配置になる。
 * 本番データ生成とは切り離したdemo専用処理。
 */
function assignSampleMaterialsToFinishRecords(records) {
  const materials = materialRecordStore.getAll().filter((material) => material.status === 'active');
  if (!materials.length || !records.length) return records;

  // その他1/2へテスト建材が入る場合に使う実部位候補。
  // 本番の候補設定とは無関係な、レビュー用demoデータだけの値。
  const sampleOtherParts = ['窓枠', '配管', '梁', '柱', '貫通部', '床下', '壁部'];

  let seed = 15103;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const applySampleMaterial = (record, material) => {
    const partIndex = partIndexFromPosition(record.position);
    const next = {
      ...record,
      materialId: material.materialId,
      inputId: String(material.inputId)
    };

    // ランダム配置済みの「その他」建材は、実部位入力ありの状態も確認できるようにする。
    // その他1/2というスロット名はpartへ保存せず、実部位名を保存する。
    if (partIndex >= 5) {
      next.part = sampleOtherParts[Math.floor(random() * sampleOtherParts.length)];
    }
    return next;
  };

  // 全20件が少なくとも1回は確認できるよう、候補セルを固定シードでシャッフルして先に割り当てる。
  const indices = records.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const used = new Set();
  materials.forEach((material, materialIndex) => {
    const index = indices[materialIndex % indices.length];
    records[index] = applySampleMaterial(records[index], material);
    used.add(index);
  });

  // 残りは約28%を追加で埋め、同じ建材が複数部屋・複数部位に出る状態も確認できるようにする。
  records.forEach((record, index) => {
    if (used.has(index) || random() >= 0.28) return;
    const material = materials[Math.floor(random() * materials.length)];
    records[index] = applySampleMaterial(record, material);
  });

  return records;
}

export function seedInitialFinishRecords() {
  const records = [];
  INITIAL_STRUCTURE_SEED.floors.forEach(({ areaCode, floor, roomCount }) => {
    for (let i = 1; i <= roomCount; i += 1) records.push(...buildFloorRoomSeed(areaCode, floor, i));
  });
  for (let i = 1; i <= INITIAL_STRUCTURE_SEED.stairsCount; i += 1) records.push(...buildFlatRoomSeed('S', i));
  for (let i = 1; i <= INITIAL_STRUCTURE_SEED.roofCount; i += 1) records.push(...buildFlatRoomSeed('R', i));
  INITIAL_STRUCTURE_SEED.externalRoomNames.forEach((name, index) => {
    records.push(...buildFlatRoomSeed('E', index + 1, name));
  });
  assignSampleMaterialsToFinishRecords(records);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
  refreshMaterialUsageDerivedFields('seed-initial-finish');
}

/* ============================================================
   複数Store transaction
   ============================================================ */

export function runRecordTransaction(mutate) {
  // Store更新通知は各Storeのbatch()へ一本化する。
  // 仕上表・建材・写真をまたぐ業務操作も同じtransaction入口を使い、
  // 変更されたStoreだけがbatch終了時に通常のsubscribe通知を1回発火する。
  finishRecordStore.batch(() => {
    materialRecordStore.batch(() => {
      photoRecordStore.batch(() => mutate());
    });
  });
}

export { finishRecordStore, materialRecordStore };
