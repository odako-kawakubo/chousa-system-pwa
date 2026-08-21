/**
 * src/js/materials/material-operations.js
 *
 * v0.1.5.2C 建材の「統合・削除」業務ロジック。
 *
 * 方針：
 * - v0.14.28で固まった操作感を参考にするが、旧state.materialsは使わない。
 * - 正本は materialRecordStore / finishRecordStore。
 * - 複数Store更新は runRecordTransaction() 内で1つの業務操作として行う。
 * - 統合先の分析・採取情報はそのまま採用し、統合元からは
 *   仕上表上の紐づき・使用箇所・調査備考を引き継ぐ。
 * - 統合元／削除元レコードは物理削除せず履歴として保持する。
 * - 処理後は active 建材の建材No.と同一ベース名の末尾英字を整理する。
 *
 * 写真レコードは v0.1.5.2 時点でStore未実装のため、このモジュールでは触らない。
 * 写真Store実装時に materialId 引継ぎ処理を同じtransactionへ接続する。
 */

import {
  finishRecordStore,
  materialRecordStore,
  runRecordTransaction,
  refreshMaterialUsageDerivedFields
} from '../finish-table/finish-table-actions.js';

function nowIso() {
  return new Date().toISOString();
}

function appendSystemMemo(currentMemo, message) {
  const current = String(currentMemo || '').trim();
  const stamp = new Date().toLocaleString('ja-JP');
  const line = `${stamp} ${message}`;
  return current ? `${current}\n${line}` : line;
}

function numberToSuffix(value) {
  let n = Math.max(1, Number(value) || 1);
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function activeMaterialsSorted() {
  return materialRecordStore.getAll()
    .filter((record) => record.status === 'active')
    .slice()
    .sort((a, b) => {
      const aNo = Number(a.materialNo) || Number(a.inputId) || Number.MAX_SAFE_INTEGER;
      const bNo = Number(b.materialNo) || Number(b.inputId) || Number.MAX_SAFE_INTEGER;
      if (aNo !== bNo) return aNo - bNo;
      return String(a.materialId || '').localeCompare(String(b.materialId || ''), 'ja', { numeric: true });
    });
}

/** 操作パネル表示用のactive建材を現在の建材No.順で返す。 */
export function getActiveMaterialsForOperations() {
  return activeMaterialsSorted();
}

/**
 * 使用中の仕上表箇所（部屋No.）を重複なしで返す。
 * 14.28の削除警告と同じく、どこで使われている建材かを確認するために使う。
 */
export function getMaterialUsagePlaces(materialId) {
  const places = [];
  finishRecordStore.getAll().forEach((record) => {
    if (record.status !== 'active' || record.materialId !== materialId) return;
    const label = String(record.roomNo || record.roomName || '').trim();
    if (label && !places.includes(label)) places.push(label);
  });
  return places;
}

/** 統合元に、統合先へ引き継がない採取・分析情報があるか。 */
export function hasSamplingOrAnalysisData(record) {
  if (!record) return false;
  const analysis = String(record.analysisRequired || '').trim();
  if (analysis && analysis !== '未調査') return true;
  if (Number(record.sampleCount) > 0) return true;
  if (record.sampleLocation1 || record.sampleLocation2 || record.sampleLocation3) return true;
  if ((Array.isArray(record.samplePart) ? record.samplePart.length : String(record.samplePart || '').trim()) || record.sampleDone || record.sampleDate || record.sampleName) return true;
  if (record.analysisResult || record.remarks) return true;
  return false;
}

/** 調査備考を行単位で重複排除しながら結合する。 */
function mergeSurveyNotes(targetNote, sourceNote) {
  const lines = [];
  [targetNote, sourceNote].forEach((value) => {
    String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (!lines.includes(line)) lines.push(line);
      });
  });
  return lines.join('\n');
}

/**
 * active建材の現在位置に合わせて建材No.を1..Nへ振り直し、
 * 同一baseName内の末尾英字を A..Z,AA,AB... で整理する。
 * inputId / materialId は固定のため変更しない。
 */
function resequenceActiveMaterials() {
  const ordered = activeMaterialsSorted();
  const updatedAt = nowIso();

  // まず現在の一覧順を建材No.へ確定する。
  ordered.forEach((record, index) => {
    const nextNo = index + 1;
    if (Number(record.materialNo) === nextNo) return;
    materialRecordStore.set({
      ...record,
      materialNo: nextNo,
      updatedAt
    });
  });

  // materialNo.確定後のactiveレコードで同一ベース名ごとに末尾英字を整理する。
  const refreshed = activeMaterialsSorted();
  const groups = new Map();
  refreshed.forEach((record) => {
    const base = String(record.baseName || record.name || '').trim();
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(record);
  });

  groups.forEach((items, baseName) => {
    items.forEach((record, index) => {
      const suffixLetter = numberToSuffix(index + 1);
      const nextName = `${baseName}${suffixLetter}`;
      if (record.name === nextName && record.suffixLetter === suffixLetter) return;
      materialRecordStore.set({
        ...record,
        name: nextName,
        suffixLetter,
        systemMemo: appendSystemMemo(
          record.systemMemo,
          `末尾英字再採番：${record.name} → ${nextName}`
        ),
        updatedAt
      });
    });
  });
}

/**
 * 複数建材を1つの統合先へ統合する。
 * @param {string} targetId 統合先materialId
 * @param {string[]} sourceIds 統合元materialId群
 * @returns {{targetId:string, sourceIds:string[]}}
 */
export function mergeMaterials(targetId, sourceIds) {
  const target = materialRecordStore.get(targetId);
  if (!target || target.status !== 'active') throw new Error('統合先の建材を取得できません。');

  const uniqueSourceIds = [...new Set(sourceIds || [])].filter((id) => id && id !== targetId);
  const sources = uniqueSourceIds
    .map((id) => materialRecordStore.get(id))
    .filter((record) => record && record.status === 'active');
  if (!sources.length) throw new Error('統合する建材を選択してください。');

  runRecordTransaction(() => {
    const updatedAt = nowIso();
    let nextTarget = { ...target };

    sources.forEach((source) => {
      // 仕上表上の統合元materialId/inputIdを統合先へ置換する。
      finishRecordStore.getAll().forEach((finish) => {
        if (finish.status !== 'active' || finish.materialId !== source.materialId) return;
        finishRecordStore.set({
          ...finish,
          materialId: target.materialId,
          inputId: String(target.inputId),
          systemMemo: appendSystemMemo(
            finish.systemMemo,
            `建材統合により建材ID変更：${source.materialId} → ${target.materialId}`
          ),
          updatedAt
        });
      });

      // 調査備考だけは統合元から重複を除いて統合先へ引き継ぐ。
      nextTarget.note = mergeSurveyNotes(nextTarget.note, source.note);
      nextTarget.systemMemo = appendSystemMemo(
        nextTarget.systemMemo,
        `統合受入：${source.name}（${source.materialId}）を統合`
      );

      // 統合元は物理削除せず、統合済みの履歴レコードとして保持する。
      materialRecordStore.set({
        ...source,
        status: 'merged',
        systemMemo: appendSystemMemo(
          source.systemMemo,
          `統合：${source.name}（${source.materialId}）→ ${target.name}（${target.materialId}）`
        ),
        updatedAt
      });
    });

    materialRecordStore.set({ ...nextTarget, updatedAt });

    // 仕上表を正として統合先の部位・使用箇所を再派生する。
    refreshMaterialUsageDerivedFields();

    // 統合後のactive一覧に合わせて建材No.と末尾英字を整理する。
    resequenceActiveMaterials();
  });

  return { targetId, sourceIds: sources.map((source) => source.materialId) };
}

/**
 * 建材を削除状態へする。写真レコードは触らず保持する前提。
 * @param {string[]} materialIds
 * @returns {{deletedIds:string[]}}
 */
export function deleteMaterials(materialIds) {
  const uniqueIds = [...new Set(materialIds || [])].filter(Boolean);
  const targets = uniqueIds
    .map((id) => materialRecordStore.get(id))
    .filter((record) => record && record.status === 'active');
  if (!targets.length) throw new Error('削除する建材を選択してください。');

  runRecordTransaction(() => {
    const updatedAt = nowIso();

    targets.forEach((target) => {
      // 仕上表レコード自体は残し、建材紐づきだけ解除する。
      finishRecordStore.getAll().forEach((finish) => {
        if (finish.status !== 'active' || finish.materialId !== target.materialId) return;
        finishRecordStore.set({
          ...finish,
          materialId: '',
          inputId: '',
          systemMemo: appendSystemMemo(
            finish.systemMemo,
            `建材削除により入力解除：${target.materialId} ${target.name}`
          ),
          updatedAt
        });
      });

      materialRecordStore.set({
        ...target,
        status: 'deleted',
        systemMemo: appendSystemMemo(target.systemMemo, `削除：${target.name} を建材リストから除外`),
        updatedAt
      });
    });

    refreshMaterialUsageDerivedFields();
    resequenceActiveMaterials();
  });

  return { deletedIds: targets.map((target) => target.materialId) };
}
