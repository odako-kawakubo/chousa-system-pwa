/**
 * 案件情報に属する棟の定義。
 * A棟は従来案件との互換のため暗黙の既定棟（buildingIdなし）。
 * B棟以降だけproject.buildingsに保持し、棟名称は識別子に使わない。
 */
const FIRST_ADDITIONAL_CODE = 'B'.charCodeAt(0);
const LAST_BUILDING_CODE = 'Z'.charCodeAt(0);

export function normalizeBuildingId(value) {
  const id = String(value || '').trim().toUpperCase();
  return id === '' || id === 'A' ? '' : /^[B-Z]$/.test(id) ? id : '';
}

export function normalizeProjectBuildings(value = {}) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [rawId, raw] of Object.entries(value)) {
    const id = normalizeBuildingId(rawId);
    if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    result[id] = {
      name: String(raw.name ?? `${id}棟`),
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : id.charCodeAt(0) - 64
    };
  }
  return result;
}

export function projectBuildingIds(project = {}) {
  return ['', ...Object.keys(normalizeProjectBuildings(project.buildings)).sort()];
}

export function nextBuildingId(project = {}) {
  const used = new Set(projectBuildingIds(project));
  for (let code = FIRST_ADDITIONAL_CODE; code <= LAST_BUILDING_CODE; code += 1) {
    const id = String.fromCharCode(code);
    if (!used.has(id)) return id;
  }
  return '';
}

export function makeBuildingDefinition(id, name = '') {
  const buildingId = normalizeBuildingId(id);
  if (!buildingId) throw new Error('追加棟にはB以降の棟IDが必要です。');
  return { name: String(name || `${buildingId}棟`), order: buildingId.charCodeAt(0) - 64 };
}
