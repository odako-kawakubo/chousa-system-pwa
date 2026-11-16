/**
 * サンプル初期データを既定候補・確定した配置定義から生成する。
 * 一覧の表示値は各Record Storeを正本とし、二重の建材正本を持たない。
 */
import { partIndexFromPosition } from '../records/finish-record.js';
import { roomIdFor } from '../records/room-id.js';
import { createMaterialRecord, normalizeMaterialName } from '../records/material-record.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import { getConfiguredMaterialCandidates } from '../store/survey-candidate-store.js';
import { INITIAL_STRUCTURE_SEED } from '../demo/sample-finish-data.js';
import { SAMPLE_MATERIALS_SEED } from '../demo/sample-materials.js';
import { buildFloorRoomSeed, buildFlatRoomSeed } from './finish-table-structure-actions.js';
import { refreshMaterialUsageDerivedFields } from './material-usage-derived.js';

function resolveCandidateName(part, name) {
  const selected = getConfiguredMaterialCandidates().find((entry) =>
    entry.source === 'default' && entry.part === part && entry.baseName === name
  );
  if (!selected) throw new Error('サンプル建材候補が不正です: '+part+'/'+name);
  return normalizeMaterialName(selected.baseName);
}

export function seedInitialMaterials() {
  const records = SAMPLE_MATERIALS_SEED.map(([part,name,note,analysisRequired,sampleCount,analysisResult,photoCount],index) =>
    createMaterialRecord({
      materialId:'R'+String(index+1).padStart(3,'0'), inputId:index+1, materialNo:index+1,
      name:resolveCandidateName(part,name)+'A', note, analysisRequired, sampleCount,
      analysisResult:analysisResult||'', photoCount:photoCount||0
    })
  );
  materialRecordStore.replaceAll(records);
}

/**
 * 写真サンプルの対象も含め、部屋と部位を固定する。
 * [入力ID, エリア, 部屋No, 部位スロット, その他部位]
 */
const SAMPLE_PLACEMENTS = [
  [
    1,
    "I",
    "1-1",
    3
  ],
  [
    1,
    "I",
    "1-2",
    3
  ],
  [
    1,
    "I",
    "2-1",
    3
  ],
  [
    2,
    "E",
    "E-1",
    2
  ],
  [
    2,
    "E",
    "E-2",
    2
  ],
  [
    3,
    "I",
    "1-2",
    1
  ],
  [
    3,
    "I",
    "1-3",
    1
  ],
  [
    3,
    "I",
    "1-1",
    1
  ],
  [
    4,
    "I",
    "1-4",
    1
  ],
  [
    4,
    "I",
    "1-5",
    1
  ],
  [
    5,
    "I",
    "1-4",
    4
  ],
  [
    5,
    "I",
    "2-4",
    4
  ],
  [
    6,
    "I",
    "1-5",
    5,
    "耐火被覆"
  ],
  [
    7,
    "I",
    "1-1",
    4
  ],
  [
    8,
    "I",
    "2-1",
    4
  ],
  [
    9,
    "E",
    "E-3",
    2
  ],
  [
    10,
    "E",
    "E-4",
    2
  ],
  [
    11,
    "I",
    "1-5",
    3
  ],
  [
    12,
    "I",
    "2-5",
    4
  ],
  [
    13,
    "I",
    "1-1",
    2
  ],
  [
    14,
    "I",
    "2-5",
    3
  ],
  [
    15,
    "R",
    "R-1",
    3
  ],
  [
    16,
    "E",
    "E-1",
    5,
    "目地"
  ],
  [
    17,
    "I",
    "1-5",
    6,
    "配管"
  ],
  [
    18,
    "I",
    "2-5",
    5,
    "機器"
  ],
  [
    19,
    "I",
    "1-5",
    5,
    "貫通部"
  ],
  [
    20,
    "I",
    "2-5",
    6,
    "配管"
  ]
];

/** 同一部屋・部位の2行目以降も使用可能。 */
function assignSamplePlacements(records) {
  const materialByInputId = new Map(materialRecordStore.getAll().map((item) => [Number(item.inputId),item]));
  const occupied = new Set();
  const usage = new Map();
  for (const [inputId,areaCode,roomNo,partIndex,otherPart] of SAMPLE_PLACEMENTS) {
    const material = materialByInputId.get(inputId);
    const target = records.find((record) =>
      record.areaCode === areaCode && record.roomNo === roomNo &&
      partIndexFromPosition(record.position) === partIndex && !occupied.has(record.finishId)
    );
    if (!material || !target) throw new Error('サンプル建材配置が不正です: '+inputId+'/'+roomNo+'/'+partIndex);
    occupied.add(target.finishId);
    target.materialId = material.materialId;
    target.materialName = '';
    target.inputId = String(material.inputId);
    if (otherPart) target.part = otherPart;
    const key = roomIdFor(target.areaCode,target.roomPosition,target.buildingId);
    const usedRooms = usage.get(material.materialId) || [];
    if (!usedRooms.some((room) => room.key === key)) {
      usedRooms.push({
        key,
        value:target.areaCode === 'E' ? (target.roomName || target.roomNo) : target.roomNo,
        part:target.part
      });
    }
    usage.set(material.materialId,usedRooms);
  }
  materialRecordStore.batch(() => {
    materialRecordStore.getAll().forEach((material) => {
      if (material.analysisRequired !== '採取・分析') return;
      const rooms = (usage.get(material.materialId)||[]).slice(0,Number(material.sampleCount)||1);
      materialRecordStore.set({
        ...material,
        sampleLocation1:rooms[0]?.value||'', sampleRoomKey1:rooms[0]?.key||'',
        sampleLocation2:rooms[1]?.value||'', sampleRoomKey2:rooms[1]?.key||'',
        sampleLocation3:rooms[2]?.value||'', sampleRoomKey3:rooms[2]?.key||'',
        samplePart:[...new Set(rooms.map((room)=>room.part).filter(Boolean))]
      });
    });
  });
}

export function seedInitialFinishRecords() {
  const records = [];
  INITIAL_STRUCTURE_SEED.floors.forEach(({areaCode,floor,roomCount}) => {
    for(let i=1;i<=roomCount;i++) records.push(...buildFloorRoomSeed(areaCode,floor,i,''));
  });
  for(let i=1;i<=INITIAL_STRUCTURE_SEED.stairsCount;i++) records.push(...buildFlatRoomSeed('S',i,'',''));
  for(let i=1;i<=INITIAL_STRUCTURE_SEED.roofCount;i++) records.push(...buildFlatRoomSeed('R',i,'',''));
  INITIAL_STRUCTURE_SEED.externalRoomNames.forEach((name,i) =>
    records.push(...buildFlatRoomSeed('E',i+1,name,'')));
  assignSamplePlacements(records);
  finishRecordStore.replaceAll(records);
  refreshMaterialUsageDerivedFields('seed-initial-finish');
}
