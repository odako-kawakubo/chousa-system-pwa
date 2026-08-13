/**
 * src/js/materials/material-operations-renderer.js
 *
 * 建材リストの統合・削除UI描画。
 *
 * controllerから渡された選択状態・開閉状態をそのまま描画し、
 * Store更新やconfirm処理は一切行わない。
 */

export function renderMaterialOperations(root, materials, options = {}) {
  if (!root) return;

  const targetId = options.targetId || '';
  const sourceIds = new Set(options.sourceIds || []);
  const deleteIds = new Set(options.deleteIds || []);
  const usageMap = options.usageMap || new Map();
  const openAccordion = options.openAccordion || '';
  const openPickerId = options.openPickerId || '';
  const target = materials.find((material) => material.materialId === targetId) || null;

  root.innerHTML = `
    <div class="drawer-box material-operations-box" id="drawerMaterialOps">
      <h4>建材リスト操作</h4>
      <div class="hint">統合・削除は必要な時だけ開きます。選択中も開いている状態を保持します。</div>

      ${renderMergeAccordion(materials, target, sourceIds, {
        open: openAccordion === 'merge',
        openPickerId
      })}

      ${renderDeleteAccordion(materials, deleteIds, usageMap, {
        open: openAccordion === 'delete',
        openPickerId
      })}

      <div class="picker-note material-photo-defer-note">
        写真レコードは後続段階で接続します。現段階では仕上表・建材レコードを対象に統合／削除します。
      </div>
    </div>
  `;
}

function renderMergeAccordion(materials, target, sourceIds, uiState) {
  const targetId = target?.materialId || '';
  const targetBaseName = String(target?.baseName || target?.name || '').trim();

  return `
    <div class="material-op-accordion${uiState.open ? ' open' : ''}" data-material-op-accordion="merge">
      <button type="button" class="material-op-accordion-head" data-action="toggle-material-op-accordion">
        <span><span class="material-op-arrow">${uiState.open ? '▼' : '▶'}</span> 統合</span>
        <span class="material-op-open-label">${uiState.open ? '閉じる' : '開く'}</span>
      </button>
      <div class="material-op-accordion-body">
        <div class="hint">統合先の建材</div>
        ${renderPicker({
          materials,
          pickerId: 'mergeTargetPicker',
          chipId: 'mergeTargetChips',
          role: 'merge-target',
          selectedIds: new Set(targetId ? [targetId] : []),
          single: true,
          excludedIds: new Set(),
          open: uiState.openPickerId === 'mergeTargetPicker'
        })}

        <div class="hint material-op-section-gap">統合する建材</div>
        ${renderPicker({
          materials,
          pickerId: 'mergeSourcePicker',
          chipId: 'mergeSourceChips',
          role: 'merge-source',
          selectedIds: sourceIds,
          single: false,
          excludedIds: new Set(targetId ? [targetId] : []),
          preferredBaseName: targetBaseName,
          open: uiState.openPickerId === 'mergeSourcePicker'
        })}

        <div class="drawer-material-actions">
          <button type="button" class="btn primary" data-action="execute-material-merge" ${targetId && sourceIds.size ? '' : 'disabled'}>統合</button>
        </div>
        <div class="picker-note">統合元候補は、統合先と同じベース名の建材を先に表示します。</div>
      </div>
    </div>
  `;
}

function renderDeleteAccordion(materials, deleteIds, usageMap, uiState) {
  const unused = [];
  const used = [];

  materials.forEach((material) => {
    const places = usageMap.get(material.materialId) || [];
    if (places.length) used.push({ material, places });
    else unused.push({ material, places: [] });
  });

  return `
    <div class="material-op-accordion${uiState.open ? ' open' : ''}" data-material-op-accordion="delete">
      <button type="button" class="material-op-accordion-head" data-action="toggle-material-op-accordion">
        <span><span class="material-op-arrow">${uiState.open ? '▼' : '▶'}</span> 削除</span>
        <span class="material-op-open-label">${uiState.open ? '閉じる' : '開く'}</span>
      </button>
      <div class="material-op-accordion-body">
        <div class="hint">削除する建材</div>
        <div class="material-picker-wrap">
          <button type="button" class="material-picker-open" data-action="toggle-material-picker" data-picker-id="deleteTargetPicker">
            <span class="plus">＋</span>選択する
          </button>
          <div class="material-picker-chips" id="deleteTargetChips">${renderSelectedChips(materials, deleteIds, 'delete-target')}</div>
          <div class="material-picker-help">選択済みチップを押すと解除できます。</div>
          <div class="material-picker-panel${uiState.openPickerId === 'deleteTargetPicker' ? ' open' : ''}" id="deleteTargetPicker">
            ${renderDeleteGroups(unused, used, deleteIds)}
            <div class="material-picker-actions">
              <button type="button" class="btn small" data-action="close-material-picker" data-picker-id="deleteTargetPicker">選択完了</button>
            </div>
          </div>
        </div>

        <div class="drawer-material-actions">
          <button type="button" class="btn danger" data-action="execute-material-delete" ${deleteIds.size ? '' : 'disabled'}>削除</button>
        </div>
        <div class="picker-note">削除候補は「仕上表で未使用」を先に表示します。使用中建材は削除時に確認します。</div>
      </div>
    </div>
  `;
}

function renderPicker({
  materials,
  pickerId,
  chipId,
  role,
  selectedIds,
  single,
  excludedIds,
  preferredBaseName = '',
  open = false
}) {
  return `
    <div class="material-picker-wrap">
      <button type="button" class="material-picker-open" data-action="toggle-material-picker" data-picker-id="${escapeAttr(pickerId)}">
        <span class="plus">＋</span>選択する
      </button>
      <div class="material-picker-chips" id="${escapeAttr(chipId)}">${renderSelectedChips(materials, selectedIds, role)}</div>
      <div class="material-picker-help">選択済みチップを押すと解除できます。</div>
      <div class="material-picker-panel${open ? ' open' : ''}" id="${escapeAttr(pickerId)}">
        ${renderGroupedPicker(materials, role, selectedIds, single, excludedIds, preferredBaseName)}
        ${single ? '' : `
          <div class="material-picker-actions">
            <button type="button" class="btn small" data-action="close-material-picker" data-picker-id="${escapeAttr(pickerId)}">選択完了</button>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderGroupedPicker(materials, role, selectedIds, single, excludedIds, preferredBaseName = '') {
  if (!materials.length) return '<div class="hint">対象建材がありません</div>';

  const groups = groupByBase(materials, preferredBaseName);
  return `
    <div class="material-group-picker">
      ${groups.map(([base, items]) => `
        <div class="material-pick-group${base === preferredBaseName && preferredBaseName ? ' preferred-base' : ''}">
          <div class="material-pick-group-title">${escapeHtml(base)}</div>
          ${items.map((material) => renderPickRow(material, role, selectedIds, single, excludedIds)).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

function renderDeleteGroups(unused, used, selectedIds) {
  const section = (title, items, cls, showPlaces) => {
    if (!items.length) return '';

    return `
      <div class="delete-section-title ${cls}">${escapeHtml(title)}</div>
      ${groupByBase(items.map((item) => item.material)).map(([base, grouped]) => `
        <div class="material-pick-group">
          <div class="material-pick-group-title">${escapeHtml(base)}</div>
          ${grouped.map((material) => {
            const found = items.find((item) => item.material.materialId === material.materialId);
            return renderPickRow(
              material,
              'delete-target',
              selectedIds,
              false,
              new Set(),
              showPlaces && found?.places?.length ? found.places.join('、') : ''
            );
          }).join('')}
        </div>
      `).join('')}
    `;
  };

  return `
    <div class="material-group-picker delete-priority-picker">
      ${section('仕上表で未使用', unused, 'unused', false)}
      ${section('仕上表で使用中', used, 'used', true)}
    </div>
  `;
}

function renderPickRow(material, role, selectedIds, single, excludedIds, usageText = '') {
  const excluded = excludedIds.has(material.materialId);
  return `
    <label class="material-pick-row${excluded ? ' excluded-by-target' : ''}">
      <input
        type="checkbox"
        data-material-op-choice
        data-role="${escapeAttr(role)}"
        data-single="${single ? '1' : '0'}"
        value="${escapeAttr(material.materialId)}"
        ${selectedIds.has(material.materialId) && !excluded ? 'checked' : ''}
        ${excluded ? 'disabled' : ''}
      />
      ${renderMaterialPickLine(material)}
      ${usageText ? `<span class="material-pick-use">${escapeHtml(usageText)}</span>` : ''}
    </label>
  `;
}

function renderSelectedChips(materials, selectedIds, role) {
  const selected = materials.filter((material) => selectedIds.has(material.materialId));
  if (!selected.length) return '<span class="empty">未選択</span>';

  return selected.map((material) => `
    <button
      type="button"
      class="material-picker-chip"
      data-action="remove-material-op-choice"
      data-role="${escapeAttr(role)}"
      data-material-id="${escapeAttr(material.materialId)}"
    >No.${escapeHtml(material.materialNo)} ${escapeHtml(material.name)} ×</button>
  `).join('');
}

function renderMaterialPickLine(material) {
  return `
    <span class="material-pick-main">
      <span class="material-pick-no">No.${escapeHtml(material.materialNo)}</span>
      <span class="material-pick-name">${escapeHtml(material.name)}</span>
      <span class="material-pick-inputid">ID:${escapeHtml(material.inputId)}</span>
    </span>
  `;
}

/**
 * ベース名ごとにまとめる。
 * preferredBaseNameがある場合、そのグループだけを先頭へ移動する。
 * 各グループ内はmaterialNo.の自然順を維持する。
 */
function groupByBase(materials, preferredBaseName = '') {
  const map = new Map();

  [...materials]
    .sort((a, b) => Number(a.materialNo || 0) - Number(b.materialNo || 0))
    .forEach((material) => {
      const base = String(material.baseName || material.name || '未分類').trim() || '未分類';
      if (!map.has(base)) map.set(base, []);
      map.get(base).push(material);
    });

  const groups = [...map.entries()];
  if (!preferredBaseName) return groups;

  return groups.sort(([baseA], [baseB]) => {
    const aPreferred = baseA === preferredBaseName;
    const bPreferred = baseB === preferredBaseName;
    if (aPreferred === bPreferred) return 0;
    return aPreferred ? -1 : 1;
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
