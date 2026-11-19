/**
 * 11H 帳票の棟・階・部位単位の表示専用集計。
 * finish/materialの正本には書き戻さない。
 */
const PART_ORDER = Object.freeze(['床','巾木','壁','天井','その他']);
const text = value => String(value ?? '').trim();
const buildingKey = value => text(value).toUpperCase() === 'A' ? '' : text(value).toUpperCase();

export function groupMaterialUsageLocations(rooms, buildingLabel) {
  const groups = new Map();
  for (const room of rooms || []) {
    const id = buildingKey(room.buildingId);
    const location = text(room.rawDisplay);
    if (!location) continue;
    if (!groups.has(id)) groups.set(id, []);
    if (!groups.get(id).includes(location)) groups.get(id).push(location);
  }
  if (groups.size <= 1 && groups.has('') && !buildingLabel('')) {
    return groups.get('').join('、');
  }
  return [...groups].map(([id, locations]) =>
    `${buildingLabel(id) || (id || 'A') + '棟'}：${locations.join('、')}`
  ).join('\n');
}

export function groupRoomRowsByBuilding(rows, buildingLabel) {
  const groups = new Map();
  for (const row of rows || []) {
    const id = buildingKey(row.buildingId);
    if (!groups.has(id)) groups.set(id, { buildingId:id, label:buildingLabel(id), rows:[] });
    groups.get(id).rows.push(row);
  }
  return [...groups.values()];
}

export function groupPartRowsByFloor(rows, buildingLabel, {preferRoomName=false}={}) {
  const groups = new Map();
  for (const row of rows || []) {
    const buildingId = buildingKey(row.buildingId);
    const floor = text(row.floorLabel || row.floor);
    const id = JSON.stringify([buildingId, text(row.areaCode), floor]);
    if (!groups.has(id)) groups.set(id, {
      buildingId, buildingLabel:buildingLabel(buildingId), floor, rows:[], byMaterial:new Map()
    });
    const group = groups.get(id);
    const index = Number(row.partIndex);
    const part = PART_ORDER[index-1] || 'その他';
    const materialIdentity = row.materialId
      ? `id:${row.materialId}`
      : `name:${text(row.materialName)}`;
    const key = JSON.stringify([part,materialIdentity]);
    let entry = group.byMaterial.get(key);
    if (!entry) {
      entry = {
        part, materialId:row.materialId||'', materialNo:row.materialNo, materialName:row.materialName,
        level:row.level, analysisResult:row.analysisResult,
        positive:row.positive, note:row.note, locations:[], location:''
      };
      group.byMaterial.set(key, entry);
      group.rows.push(entry);
    }
    const location = text(preferRoomName ? (row.roomName||row.roomNo) : row.roomNo);
    if (location && !entry.locations.includes(location)) entry.locations.push(location);
  }
  return [...groups.values()].map(group => {
    group.rows.sort((a,b) => PART_ORDER.indexOf(a.part)-PART_ORDER.indexOf(b.part)
      || String(a.materialNo ?? '').localeCompare(String(b.materialNo ?? ''),'ja',{numeric:true}));
    group.rows.forEach(row => {
      row.location = row.locations.join('、');
      delete row.locations;
    });
    delete group.byMaterial;
    return group;
  });
}

/**
 * 棟単位に階ごとの集計を再配列。複数エリアにまたがる同一建材は
 * 棟・階・部位・建材IDで一行に統合し、使用箇所だけをまとめる。
 */
export function groupPartRowsByBuilding(floorGroups) {
  const buildings=new Map();
  for(const group of floorGroups||[]){
    const id=buildingKey(group.buildingId);
    if(!buildings.has(id))buildings.set(id,{buildingId:id,buildingLabel:group.buildingLabel,rows:[],byKey:new Map()});
    const building=buildings.get(id);
    for(const row of group.rows||[]){
      const identity=row.materialId?('id:'+row.materialId):('name:'+text(row.materialName));
      const key=JSON.stringify([row.part,group.floor,identity]);
      let item=building.byKey.get(key);
      if(!item){
        item={...row,floor:group.floor,location:''};
        item.locationTokens=[];
        building.byKey.set(key,item);
        building.rows.push(item);
      }
      for(const location of text(row.location).split('、').filter(Boolean)){
        if(!item.locationTokens.includes(location))item.locationTokens.push(location);
      }
    }
  }
  return [...buildings.values()].map(group=>{
    const floorOrder=new Map();
    group.rows.forEach(row=>{if(!floorOrder.has(row.floor))floorOrder.set(row.floor,floorOrder.size);});
    group.rows.sort((a,b)=>PART_ORDER.indexOf(a.part)-PART_ORDER.indexOf(b.part)
      || floorOrder.get(a.floor)-floorOrder.get(b.floor)
      || String(a.materialNo??'').localeCompare(String(b.materialNo??''),'ja',{numeric:true}));
    group.rows.forEach(row=>{row.location=row.locationTokens.join('、');delete row.locationTokens;});
    delete group.byKey;
    return group;
  });
}
