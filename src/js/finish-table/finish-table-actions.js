/**
 * src/js/finish-table/finish-table-actions.js
 *
 * 仕上表・建材の業務ロジック。
 *
 * v0.1.5.1D 方針：
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
import {
  INITIAL_ROW_COUNT,
  INITIAL_STRUCTURE_SEED,
  INTERNAL_PARTS,
  EXTERNAL_PARTS
} from '../demo/sample-finish-data.js';
import { SAMPLE_MATERIALS_SEED } from '../demo/sample-materials.js';

const ROOMS_PER_FLOOR = 10;
const PART_COUNT = 6;

function pad(value, length) { return String(value).padStart(length, '0'); }
function nowIso() { return new Date().toISOString(); }

function partsForArea(areaCode) {
  return areaCode === 'E' ? EXTERNAL_PARTS : INTERNAL_PARTS;
}

function defaultPartName(areaCode, partIndex) {
  const raw = partsForArea(areaCode)[partIndex - 1] || '';

  // その他1/2は、建材が未入力の段階では実部位も空欄のままにする。
  // 建材登録時に実部位が空ならnormalizeOtherPartName()で「その他」へ確定する。
  return partIndex >= 5 ? '' : raw;
}

/**
 * その他1/2の業務上の部位名を正規化する。
 * 入力が空、またはスロット名そのもの（その他1/その他2）の場合は
 * 正式な部位名「その他」として保持する。実部位が入力されていればその値を使う。
 */
function normalizeOtherPartName(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'その他1' || text === 'その他2') return 'その他';
  return text;
}


function normalizeCandidateMaterialInput(rawValue) {
  const normalized = normalizeMaterialName(rawValue);
  // 候補の優先1は「【入力ID】建材名称」で表示するため、確定時は表示用IDを外して名称だけ扱う。
  return normalized.replace(/^【\d+】\s*/, '');
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
  return createRoomRecords({ areaCode, roomPosition, floor, roomNo: label, roomName: label });
}

function buildFlatRoomSeed(areaCode, index, customName = '') {
  const roomPosition = pad(index, 3);
  let roomNo = customName;
  let roomName = customName;
  if (!customName && areaCode === 'S') { roomNo = `S-${index}`; roomName = `階段${index}`; }
  if (!customName && areaCode === 'R') { roomNo = `R-${index}`; roomName = index === 1 ? '屋上' : `屋上${index}`; }
  if (!customName && areaCode === 'E') { roomNo = `面${index}`; roomName = `面${index}`; }
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
    systemMemo: appendSystemMemo(record.systemMemo, `部屋挿入等により仕上表ID変更 旧:${oldId} 新:${nextId}`),
    updatedAt: nowIso()
  };
}

/* ============================================================
   構造変更
   ============================================================ */

function listFloorNumbers(areaCode) {
  return [...new Set(uniqueRoomAnchors(areaCode).map((record) => Number(record.floor)))];
}

function countRoomsInFloor(areaCode, floor) { return uniqueRoomAnchors(areaCode, floor).length; }
function countFlatRooms(areaCode) { return uniqueRoomAnchors(areaCode).length; }

function insertFloorRoomAt(areaCode, floor, insertIndex) {
  const shifted = finishRecordStore.getAll().map((record) => {
    if (record.areaCode !== areaCode || Number(record.floor) !== floor) return record;
    const idx = roomIndexFromRoomPosition(record.roomPosition);
    return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, buildFloorRoomPosition(floor, idx + 1));
  });
  finishRecordStore.replaceAll([...shifted, ...buildFloorRoomSeed(areaCode, floor, insertIndex)]);
}

function insertFlatRoomAt(areaCode, insertIndex) {
  const shifted = finishRecordStore.getAll().map((record) => {
    if (record.areaCode !== areaCode) return record;
    const idx = Number(record.roomPosition);
    return idx < insertIndex ? record : rekeyRecordToRoomPosition(record, pad(idx + 1, 3));
  });
  finishRecordStore.replaceAll([...shifted, ...buildFlatRoomSeed(areaCode, insertIndex)]);
}

export function addNormalFloor() {
  const floors = listFloorNumbers('I');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('I', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
}

export function addBasementFloor() {
  const floors = listFloorNumbers('B');
  const next = floors.length ? Math.max(...floors) + 1 : 1;
  const records = [];
  for (let i = 1; i <= ROOMS_PER_FLOOR; i += 1) records.push(...buildFloorRoomSeed('B', next, i));
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
}

export function addStairs() {
  const records = buildFlatRoomSeed('S', countFlatRooms('S') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
}

export function addRoof() {
  const records = buildFlatRoomSeed('R', countFlatRooms('R') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
}

export function addExternalRoom() {
  const records = buildFlatRoomSeed('E', countFlatRooms('E') + 1);
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
}

export function addRoomToFloor(floorKey) {
  const parsed = parseFloorKey(floorKey);
  if (!parsed) return;
  insertFloorRoomAt(parsed.areaCode, parsed.floor, countRoomsInFloor(parsed.areaCode, parsed.floor) + 1);
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
      roomUid: anchor.roomUid,
      systemMemo: `入力行追加: ${nextRow}行目`
    }));
  }
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set(record)));
}

/* ============================================================
   部屋情報変更
   ============================================================ */

export function commitRoomField(roomKey, field, rawValue) {
  const records = getRoomRecords(roomKey);
  if (!records.length) return;
  const value = field === 'room-no' ? String(rawValue ?? '').trim() : String(rawValue ?? '');
  finishRecordStore.batch(() => records.forEach((record) => finishRecordStore.set({
    ...record,
    ...(field === 'room-no' ? { roomNo: value } : { roomName: value }),
    updatedAt: nowIso()
  })));
  refreshMaterialUsageDerivedFields();
}

/* ============================================================
   セル編集
   ============================================================ */

function cellFinishId(anchor, partIndex, row) {
  return computeFinishId(anchor.areaCode, anchor.roomPosition, computeCellPosition(partIndex, row));
}

function writeCellPatch(anchor, partIndex, row, patch) {
  const finishId = cellFinishId(anchor, partIndex, row);
  const existing = finishRecordStore.get(finishId);
  if (!existing) {
    throw new Error(`仕上表レコードが存在しません: ${finishId}`);
  }
  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'part') && partIndex >= 5) {
    normalizedPatch.part = normalizeOtherPartName(normalizedPatch.part);
  }
  finishRecordStore.set({ ...existing, ...normalizedPatch, updatedAt: nowIso() });
  refreshMaterialUsageDerivedFields();
}

export function commitCellId(roomKey, partIndex, row, rawInputId) {
  const anchor = findRepresentativeByRoomKey(roomKey);
  if (!anchor) return null;
  const inputId = String(rawInputId ?? '').trim();
  if (!inputId) {
    writeCellPatch(anchor, partIndex, row, { inputId: '', materialId: '' });
    return null;
  }
  const material = materialRecordStore.findByInputId(inputId);
  if (!material) {
    writeCellPatch(anchor, partIndex, row, { inputId, materialId: '' });
    return null;
  }
  writeCellPatch(anchor, partIndex, row, { inputId: String(material.inputId), materialId: material.materialId });
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
  refreshMaterialUsageDerivedFields();
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
  writeCellPatch(anchor, partIndex, row, {
    inputId: String(materialRecord.inputId),
    materialId: materialRecord.materialId
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
  runRecordTransaction(() => {
    if (!material) {
      const parsed = splitBaseNameAndSuffix(normalized);
      const suffix = parsed.suffixLetter || nextMaterialSuffix(parsed.baseName, materialRecordStore.getAll());
      const finalName = parsed.suffixLetter ? normalized : `${parsed.baseName}${suffix}`;

      material = materialRecordStore.findByName(finalName);
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
        materialRecordStore.set(material);
      }
    }
    const patch = {
      inputId: String(material.inputId),
      materialId: material.materialId
    };
    // その他1/2は実部位未入力なら、業務上の部位名を「その他」として保持する。
    if (partIndex >= 5) {
      const current = finishRecordStore.get(cellFinishId(anchor, partIndex, row));
      patch.part = normalizeOtherPartName(current?.part);
    }
    writeCellPatch(anchor, partIndex, row, patch);
    refreshMaterialUsageDerivedFields();
  });
  return material;
}

/* ============================================================
   建材レコード派生値
   ============================================================ */

/** finishRecordStoreを正として、全建材の部位・使用箇所を再計算する。 */
export function refreshMaterialUsageDerivedFields() {
  const finishRecords = finishRecordStore.getAll().filter((record) => record.status === 'active' && record.materialId);
  const byMaterial = new Map();
  finishRecords.forEach((record) => {
    if (!byMaterial.has(record.materialId)) byMaterial.set(record.materialId, { parts: [], places: [] });
    const item = byMaterial.get(record.materialId);
    const part = String(record.part || '').trim() || 'その他';
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
      materialRecordStore.set({ ...material, part, usageLocation, updatedAt: nowIso() });
    });
  });
}

export function getMaterialUsageRoomNos(inputId) {
  const material = materialRecordStore.findByInputId(inputId);
  if (!material) return [];
  return finishRecordStore.getAll()
    .filter((record) => record.status === 'active' && record.materialId === material.materialId)
    .map((record) => record.roomNo)
    .filter((value, index, array) => value && array.indexOf(value) === index);
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
  const sourceRecords = getRoomRecords(sourceRoomKey);
  const targetRecords = getRoomRecords(targetRoomKey);
  const target = targetRecords[0];
  if (!sourceRecords.length || !target) return;

  // コピー先には、既に存在するfinishRecordへ値だけを書き込む。
  // コピー元の方が行数が多い場合だけ不足する入力枠を新規生成し、
  // コピー元の方が少ない場合は余分な入力枠を除いて行構成を一致させる。
  const sourcePositions = new Set(sourceRecords.map((record) => record.position));
  const targetByPosition = new Map(targetRecords.map((record) => [record.position, record]));

  finishRecordStore.batch(() => {
    // コピー元に存在しない余分な行は、コピー後の行構成から外す。
    targetRecords.forEach((record) => {
      if (!sourcePositions.has(record.position)) finishRecordStore.remove(record.finishId);
    });

    sourceRecords.forEach((source) => {
      const partIndex = partIndexFromPosition(source.position);
      const part = partIndex >= 5 ? (String(source.part || '').trim() || 'その他') : defaultPartName(target.areaCode, partIndex);
      const existing = targetByPosition.get(source.position);

      if (existing) {
        // 既存のコピー先レコードはID・位置情報を維持し、入力内容だけ上書きする。
        finishRecordStore.set({
          ...existing,
          part,
          materialId: source.materialId,
          inputId: source.inputId,
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
        roomUid: target.roomUid
      }));
    });
  });
  refreshMaterialUsageDerivedFields();
}

export function restoreRoomCopy(roomKey, backupRecords) {
  if (!backupRecords?.length) return;
  const current = getRoomRecords(roomKey);
  finishRecordStore.batch(() => {
    current.forEach((record) => finishRecordStore.remove(record.finishId));
    backupRecords.forEach((record) => finishRecordStore.set({ ...record }));
  });
  refreshMaterialUsageDerivedFields();
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
  refreshMaterialUsageDerivedFields();
}

/* ============================================================
   複数Store transaction
   ============================================================ */

export function runRecordTransaction(mutate) {
  // Store更新通知は各Storeのbatch()へ一本化する。
  // transaction専用DOMイベントや通知完全抑制は使わず、変更されたStoreが
  // batch終了時に通常のsubscribe通知を1回だけ発火する。
  finishRecordStore.batch(() => {
    materialRecordStore.batch(() => mutate());
  });
}

export { finishRecordStore, materialRecordStore };
