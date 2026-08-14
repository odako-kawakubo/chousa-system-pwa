/**
 * src/js/store/survey-candidate-store.js
 *
 * 調査システムで使う入力候補を1か所に集約するStore。
 *
 * v0.1.5.4B 方針：
 * - 設定シートのデフォルト候補を正本として保持する。
 * - 仕上表で候補を出す時は、案件内の実使用データを優先して動的に合成する。
 * - 建材候補の表示優先度：
 *     1. この案件で、その部位に実際に使われている建材（【入力ID】建材名称）
 *     2. その建材のベース名
 *     3. 設定シートのデフォルト建材ベース名
 * - その他部位候補の表示優先度：
 *     1. この案件でその他1/2に実際に使われている部位
 *     2. 設定シートのデフォルト部位候補
 * - 採取部位候補はこのStoreから出さない。建材の実使用部位から生成する。
 *
 * Firebase永続化は未実装。v0.1.5.4Bではローカルメモリ上の設定として扱う。
 */

import * as finishRecordStore from './finish-record-store.js';
import * as materialRecordStore from './material-record-store.js';
import { normalizeMaterialName, splitBaseNameAndSuffix } from '../records/material-record.js';

const DEFAULT_MATERIAL_CANDIDATES = [
  ['床 犬走', 'コンクリート'],
  ['外壁', '仕上塗材'], ['外壁', 'スレート波板'], ['外壁', 'スレートボード'], ['外壁', '押出成型セメント板'], ['外壁', '窯業系サイディング'], ['外壁', 'コンクリート'], ['外壁', '鉄板'],
  ['屋根', 'アスファルトシングル'], ['屋根', '波板スレート'], ['屋根', 'アスファルト防水'], ['屋根', '防水シート'], ['屋根', '瓦'],
  ['軒裏', 'ケイカル板'], ['軒裏', '木材類'], ['軒裏', 'スレートボード'], ['軒裏', '断熱材'], ['軒裏', 'ウレタン断熱'], ['軒裏', '煙突断熱材'],
  ['床', 'ビニル床タイル'], ['床', 'ビニル床シート'], ['床', '防水シート'], ['床', 'アスファルト防水'], ['床', 'タイル'], ['床', '磁器タイル'], ['床', '畳'], ['床', '木材類'], ['床', 'カーペットタイル'], ['床', '人研ぎ石'],
  ['巾木', 'ソフト巾木'], ['巾木', '木材類'],
  ['壁', '石こうボード'], ['壁', '仕上塗材'], ['壁', '砂壁'], ['壁', 'ジュラク吹付'], ['壁', 'プラスター塗'], ['壁', 'コンクリート'], ['壁', '磁器タイル'], ['壁', '壁紙'], ['壁', '有孔ボード'], ['壁', 'スタイロフォーム'], ['壁', '吹付材'], ['壁', '窯業系サイディング'], ['壁', '押出成型セメント板'], ['壁', '木材類'], ['壁', 'フレキシブルボード'], ['壁', 'その他パネルボード'],
  ['天井', '石こうボード'], ['天井', 'ジプトーン'], ['天井', '岩綿吸音板'], ['天井', 'けい酸カルシウム板第1種'], ['天井', 'スレートボード'], ['天井', '木毛板'], ['天井', '有孔ボード'], ['天井', '成形板'], ['天井', '木材類'], ['天井', '吹付材'], ['天井', '吹付けロックウール'], ['天井', '吹付けパーライト'], ['天井', '吹付けバーミキュライト'], ['天井', '屋根用折板石綿含有断熱材'], ['天井', 'コンクリート'], ['天井', 'フレキシブルボード'], ['天井', 'その他パネルボード'],
  ['その他', 'シーリング'], ['その他', 'ガスケット'], ['その他', 'パッキン'], ['その他', '防水紙'], ['その他', 'キャンバス'], ['その他', '耐火二層管'], ['その他', '保温材'], ['その他', '石綿セメント管'], ['その他', '石綿セメント円筒'], ['その他', 'けい酸カルシウム板第2種'], ['その他', '耐火被覆板'], ['その他', '煙突断熱材'], ['その他', '吹付材'], ['その他', '仕上塗材'], ['その他', '石綿布']
];

const DEFAULT_PART_CANDIDATES = [
  'その他', '床', '巾木', '壁', '天井', '外壁', '屋根', '軒裏',
  '配管', '梁', '柱', '床下', '壁部', '窓枠', '貫通部'
];

let materialCandidates = DEFAULT_MATERIAL_CANDIDATES.map(([part, baseName], index) => ({
  candidateId: `MC-${String(index + 1).padStart(3, '0')}`,
  part,
  baseName,
  source: 'default'
}));

let partCandidates = DEFAULT_PART_CANDIDATES.map((name, index) => ({
  candidateId: `PC-${String(index + 1).padStart(3, '0')}`,
  name,
  source: 'default'
}));

const listeners = new Set();

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function splitPartList(value) {
  return String(value ?? '')
    .split(/[、,，]/)
    .map(normalizeText)
    .filter(Boolean);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function notify() {
  listeners.forEach((listener) => listener());
}

function nextCandidateId(prefix, items) {
  const max = items.reduce((current, item) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(String(item.candidateId || ''));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConfiguredMaterialCandidates() {
  return materialCandidates.map((item) => ({ ...item }));
}

export function getConfiguredPartCandidates() {
  return partCandidates.map((item) => ({ ...item }));
}

export function addMaterialCandidate(part, baseName) {
  const normalizedPart = normalizeText(part);
  const normalizedBaseName = normalizeMaterialName(baseName);
  if (!normalizedPart || !normalizedBaseName) return false;

  const exists = materialCandidates.some((item) =>
    normalizeText(item.part) === normalizedPart &&
    normalizeMaterialName(item.baseName) === normalizedBaseName
  );
  if (exists) return false;

  materialCandidates.push({
    candidateId: nextCandidateId('MC', materialCandidates),
    part: normalizedPart,
    baseName: normalizedBaseName,
    source: 'manual'
  });
  notify();
  return true;
}

export function updateMaterialCandidate(candidateId, patch = {}) {
  const index = materialCandidates.findIndex((item) => item.candidateId === candidateId);
  if (index < 0) return false;

  const nextPart = patch.part != null ? normalizeText(patch.part) : materialCandidates[index].part;
  const nextBaseName = patch.baseName != null ? normalizeMaterialName(patch.baseName) : materialCandidates[index].baseName;
  if (!nextPart || !nextBaseName) return false;

  const duplicate = materialCandidates.some((item, itemIndex) =>
    itemIndex !== index &&
    normalizeText(item.part) === nextPart &&
    normalizeMaterialName(item.baseName) === nextBaseName
  );
  if (duplicate) return false;

  materialCandidates[index] = {
    ...materialCandidates[index],
    part: nextPart,
    baseName: nextBaseName
  };
  notify();
  return true;
}

export function addPartCandidate(name) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (partCandidates.some((item) => normalizeText(item.name) === normalized)) return false;

  partCandidates.push({
    candidateId: nextCandidateId('PC', partCandidates),
    name: normalized,
    source: 'manual'
  });
  notify();
  return true;
}

export function updatePartCandidate(candidateId, name) {
  const index = partCandidates.findIndex((item) => item.candidateId === candidateId);
  if (index < 0) return false;
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (partCandidates.some((item, itemIndex) => itemIndex !== index && normalizeText(item.name) === normalized)) return false;

  partCandidates[index] = { ...partCandidates[index], name: normalized };
  notify();
  return true;
}

/**
 * 指定部位で仕上表に表示する建材候補を優先度順で返す。
 * valueはinput/datalistへそのまま渡せる表示値。
 */
export function getMaterialOptions(part, options = {}) {
  const wantedPart = normalizeText(part) || 'その他';
  const configuredPart = normalizeText(options.defaultPart || wantedPart) || wantedPart;
  const activeMaterials = materialRecordStore.getAll()
    .filter((material) => material.status === 'active')
    .filter((material) => splitPartList(material.part).includes(wantedPart))
    .sort((a, b) => Number(a.inputId || 999999) - Number(b.inputId || 999999));

  const used = activeMaterials.map((material) => ({
    kind: 'used',
    value: `【${material.inputId}】${material.name}`,
    materialId: material.materialId,
    inputId: String(material.inputId),
    name: normalizeMaterialName(material.name),
    baseName: normalizeMaterialName(material.baseName || splitBaseNameAndSuffix(material.name).baseName),
    part: wantedPart
  }));

  const usedBases = uniqueBy(
    used
      .map((item) => ({
        kind: 'used-base',
        value: item.baseName,
        name: item.baseName,
        baseName: item.baseName,
        part: wantedPart
      }))
      .filter((item) => item.value),
    (item) => normalizeMaterialName(item.value)
  );

  const usedBaseSet = new Set(usedBases.map((item) => normalizeMaterialName(item.baseName)));
  const defaults = uniqueBy(
    materialCandidates
      .filter((item) => normalizeText(item.part) === configuredPart)
      .map((item) => normalizeMaterialName(item.baseName))
      .filter(Boolean)
      .filter((baseName) => !usedBaseSet.has(baseName))
      .map((baseName) => ({
        kind: 'default',
        value: baseName,
        name: baseName,
        baseName,
        part: wantedPart
      })),
    (item) => normalizeMaterialName(item.value)
  );

  return [...used, ...usedBases, ...defaults];
}


/**
 * その他1/2の建材候補。
 * 2枠を共通候補として扱い、案件内の実使用を優先して返す。
 * 表示順：
 *  1. 【入力ID】実部位/実建材名称
 *  2. 実部位/ベース名
 *  3. ベース名
 *  4. 設定シートの「その他」デフォルト候補
 */
export function getOtherMaterialOptions() {
  const materialsById = new Map(
    materialRecordStore.getAll()
      .filter((material) => material.status === 'active')
      .map((material) => [String(material.materialId), material])
  );

  const usedExact = [];
  finishRecordStore.getAll()
    .filter((record) => record.status === 'active' && Math.floor(Number(record.position || 0) / 100) >= 5)
    .forEach((record) => {
      const material = materialsById.get(String(record.materialId || ''));
      if (!material) return;

      const actualPart = normalizeText(record.part) || 'その他';
      const name = normalizeMaterialName(material.name);
      const baseName = normalizeMaterialName(material.baseName || splitBaseNameAndSuffix(material.name).baseName);
      if (!name) return;

      usedExact.push({
        kind: 'used-other',
        value: `【${material.inputId}】${actualPart}/${name}`,
        materialId: material.materialId,
        inputId: String(material.inputId),
        name,
        baseName,
        part: actualPart,
        applyPart: true
      });
    });

  const exact = uniqueBy(
    usedExact.sort((a, b) => Number(a.inputId || 999999) - Number(b.inputId || 999999)),
    (item) => `${item.inputId}|${normalizeText(item.part)}`
  );

  const partBases = uniqueBy(
    exact
      .filter((item) => item.baseName)
      .map((item) => ({
        kind: 'used-other-part-base',
        value: `${item.part}/${item.baseName}`,
        name: item.baseName,
        baseName: item.baseName,
        part: item.part,
        applyPart: true
      })),
    (item) => `${normalizeText(item.part)}|${normalizeMaterialName(item.baseName)}`
  );

  const bases = uniqueBy(
    exact
      .filter((item) => item.baseName)
      .map((item) => ({
        kind: 'used-base',
        value: item.baseName,
        name: item.baseName,
        baseName: item.baseName,
        part: '',
        applyPart: false
      })),
    (item) => normalizeMaterialName(item.baseName)
  );

  const usedBaseSet = new Set(bases.map((item) => normalizeMaterialName(item.baseName)));
  const defaults = uniqueBy(
    materialCandidates
      .filter((item) => normalizeText(item.part) === 'その他')
      .map((item) => normalizeMaterialName(item.baseName))
      .filter(Boolean)
      .filter((baseName) => !usedBaseSet.has(baseName))
      .map((baseName) => ({
        kind: 'default',
        value: baseName,
        name: baseName,
        baseName,
        part: '',
        applyPart: false
      })),
    (item) => normalizeMaterialName(item.value)
  );

  return [...exact, ...partBases, ...bases, ...defaults];
}

/**
 * その他1/2で使う実部位候補。
 * 案件内で実際に使用中の部位を先頭に置き、その後に設定候補を続ける。
 */
export function getOtherPartOptions() {
  const usedParts = finishRecordStore.getAll()
    .filter((record) => record.status === 'active')
    .filter((record) => Number(record.position) >= 500)
    .map((record) => normalizeText(record.part))
    .filter((value) => value && value !== 'その他' && value !== 'その他1' && value !== 'その他2');

  const configured = partCandidates.map((item) => normalizeText(item.name)).filter(Boolean);
  return uniqueBy([...usedParts, ...configured], (value) => value);
}
