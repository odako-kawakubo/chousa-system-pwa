/**
 * Photo Board Editorのフォーム表示・候補解決・draft更新を担当する。
 * セッション遷移、履歴確定、Canvas描画、保存処理は持たない。
 */
import { PHOTO_TYPES, SHOOTING_TYPES, getVisualPhotoRoomKey } from '../records/photo-record.js';

const STAGES = [SHOOTING_TYPES.BEFORE, SHOOTING_TYPES.DURING, SHOOTING_TYPES.AFTER];
const MARKS = { 1: '①', 2: '②', 3: '③' };

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeBoardEditorDateInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function boardEditorVisualRooms(optionsProvider) {
  return optionsProvider?.()?.visualRooms || [];
}

export function boardEditorSamplingTargets(optionsProvider) {
  return optionsProvider?.()?.samplingTargets || [];
}

export function findBoardEditorVisualRoom(optionsProvider, identity = {}) {
  const key = getVisualPhotoRoomKey(identity);
  return boardEditorVisualRooms(optionsProvider)
    .find((room) => getVisualPhotoRoomKey(room) === key) || null;
}

export function boardEditorSamplingMaterialTargets(optionsProvider, materialId) {
  return boardEditorSamplingTargets(optionsProvider)
    .filter((target) => target.materialId === materialId);
}

export function boardEditorSamplingMaterials(optionsProvider) {
  const map = new Map();
  boardEditorSamplingTargets(optionsProvider).forEach((target) => {
    if (!map.has(target.materialId)) {
      map.set(target.materialId, {
        materialId: target.materialId,
        sampleBaseNo: String(target.sampleBaseNo || ''),
        targets: []
      });
    }
    map.get(target.materialId).targets.push(target);
  });
  return [...map.values()];
}

function visualRoomLabel(room = {}) {
  const no = String(room.roomNo || room.roomPosition || '').trim();
  const name = String(room.roomName || '').trim();
  return name && name !== no ? `${no}　${name}` : no;
}

function visualFields(entry, optionsProvider) {
  const rooms = boardEditorVisualRooms(optionsProvider);
  const room = findBoardEditorVisualRoom(optionsProvider, entry.draft);
  const parts = room?.targets || [];
  const activeRoomKey = getVisualPhotoRoomKey(entry.draft);
  const hasActiveRoom = rooms.some((item) => getVisualPhotoRoomKey(item) === activeRoomKey);

  return `<div class="photo-board-editor-fields">
    <label>部屋No.<select data-editor-room>
      ${hasActiveRoom ? '' : '<option value="" selected>選択してください</option>'}
      ${rooms.map((roomItem) => {
        const key = getVisualPhotoRoomKey(roomItem);
        return `<option value="${esc(key)}" ${key === activeRoomKey ? 'selected' : ''}>${esc(visualRoomLabel(roomItem))}</option>`;
      }).join('')}
    </select></label>
    <label>部位<select data-editor-part>
      <option value="" ${Number(entry.draft.partSlot || 0) === 0 ? 'selected' : ''}>未整理</option>
      ${parts.map((part) => `<option value="${Number(part.partSlot || 0)}" ${Number(part.partSlot || 0) === Number(entry.draft.partSlot || 0) ? 'selected' : ''}>${esc(part.part)}</option>`).join('')}
    </select></label>
  </div>`;
}

function uniqueEditorOptions(values = []) {
  const out = [];
  values.forEach((value) => {
    const text = String(value || '').trim();
    if (text && !out.includes(text)) out.push(text);
  });
  return out;
}

function samplingFields(entry, optionsProvider) {
  const materials = boardEditorSamplingMaterials(optionsProvider);
  const selectedMaterialId = entry.draft.materialId || entry.record.materialId || '';
  const targets = boardEditorSamplingMaterialTargets(optionsProvider, selectedMaterialId);
  const branches = [...new Set(targets.map((target) => Number(target.branch)).filter(Boolean))];
  const hasMaterial = materials.some((item) => item.materialId === selectedMaterialId);
  const activeTarget = targets.find((target) => Number(target.branch) === Number(entry.draft.samplingBranch || 0)) || null;
  const placeCandidates = uniqueEditorOptions([
    ...(activeTarget?.placeOptions || []).map((item) => item?.value || item),
    ...targets.flatMap((target) => (target.placeOptions || []).map((item) => item?.value || item)),
    entry.draft.samplingPlace
  ]);
  const partCandidates = uniqueEditorOptions([
    ...(activeTarget?.partOptions || []),
    ...targets.flatMap((target) => target.partOptions || []),
    activeTarget?.part,
    entry.draft.part
  ]);
  const plannedPlace = String(activeTarget?.samplingPlace || '').trim();
  const draftPlace = String(entry.draft.samplingPlace || '').trim();
  const canReflectPlace = Boolean(
    selectedMaterialId
    && Number(entry.draft.samplingBranch || 0)
    && draftPlace
    && draftPlace !== plannedPlace
  );

  return `<div class="photo-board-editor-fields">
    <label>検体No.<select data-editor-sample>
      ${hasMaterial ? '' : '<option value="" selected>選択してください</option>'}
      ${materials.map((material) => `<option value="${esc(material.materialId)}" ${material.materialId === selectedMaterialId ? 'selected' : ''}>${esc(material.sampleBaseNo)}</option>`).join('')}
    </select></label>
    <label>箇所<select data-editor-branch>
      <option value="" ${Number(entry.draft.samplingBranch || 0) === 0 ? 'selected' : ''}>未整理</option>
      ${branches.map((branch) => `<option value="${branch}" ${branch === Number(entry.draft.samplingBranch) ? 'selected' : ''}>${MARKS[branch] || branch}</option>`).join('')}
    </select></label>
    <label>部屋No.<select data-editor-sampling-place>
      <option value="" ${!entry.draft.samplingPlace ? 'selected' : ''}>未整理</option>
      ${placeCandidates.map((place) => `<option value="${esc(place)}" ${place === String(entry.draft.samplingPlace || '') ? 'selected' : ''}>${esc(place)}</option>`).join('')}
    </select></label>
    <label>採取部位<select data-editor-sampling-part>
      <option value="" ${!entry.draft.part ? 'selected' : ''}>未整理</option>
      ${partCandidates.map((part) => `<option value="${esc(part)}" ${part === String(entry.draft.part || '') ? 'selected' : ''}>${esc(part)}</option>`).join('')}
    </select></label>
    <label>撮影区分<select data-editor-stage>
      <option value="" ${!entry.draft.shootingType ? 'selected' : ''}>未整理</option>
      ${STAGES.map((stage) => `<option value="${stage}" ${stage === entry.draft.shootingType ? 'selected' : ''}>${({ before:'施工前', during:'施工中', after:'施工後' })[stage]}</option>`).join('')}
      <option value="section" ${entry.draft.shootingType === SHOOTING_TYPES.SECTION ? 'selected' : ''}>断面</option>
    </select></label>
    ${canReflectPlace ? `<button class="btn small photo-board-editor-reflect-place" type="button" data-editor-reflect-sampling-place>この場所を採取場所にも反映</button>` : ''}
  </div>`;
}

export function renderBoardEditorForm(root, entry, optionsProvider) {
  if (!root || !entry) return;
  const fieldHost = root.querySelector('[data-editor-fields]');
  if (fieldHost) {
    fieldHost.innerHTML = entry.record.photoType === PHOTO_TYPES.VISUAL
      ? visualFields(entry, optionsProvider)
      : samplingFields(entry, optionsProvider);
  }

  const date = root.querySelector('[data-editor-date]');
  const position = root.querySelector('[data-editor-position]');
  const size = root.querySelector('[data-editor-size]');
  if (date) date.value = entry.draft.boardDate || '';
  if (position) position.value = entry.draft.boardPosition;
  if (size) size.value = entry.draft.boardSize;
}

function syncSamplingPlace(entry, optionsProvider) {
  const materialId = entry.draft.materialId || entry.record.materialId;
  const target = boardEditorSamplingMaterialTargets(optionsProvider, materialId)
    .find((item) => Number(item.branch) === Number(entry.draft.samplingBranch));

  if (!target) return;
  entry.draft.samplingPlace = target.samplingPlace || '';
  entry.draft.part = target.part || entry.draft.part;
}

export function updateBoardEditorDraftFromEvent(target, entry, optionsProvider) {
  if (!target || !entry) return { changed: false, rerenderControls: false };

  let rerenderControls = false;

  if (target.matches('[data-editor-room]')) {
    const room = boardEditorVisualRooms(optionsProvider)
      .find((item) => getVisualPhotoRoomKey(item) === target.value);
    entry.draft.areaCode = room?.areaCode || '';
    entry.draft.roomPosition = room?.roomPosition || '';
    entry.draft.roomNo = room?.roomNo || '';
    entry.draft.partSlot = 0;
    entry.draft.part = '';
    rerenderControls = true;
  } else if (target.matches('[data-editor-part]')) {
    const room = findBoardEditorVisualRoom(optionsProvider, entry.draft);
    const partTarget = target.value
      ? room?.targets?.find((item) => Number(item.partSlot || 0) === Number(target.value)) || null
      : null;
    entry.draft.partSlot = Number(partTarget?.partSlot || 0);
    entry.draft.part = partTarget?.part || '';
  } else if (target.matches('[data-editor-sample]')) {
    const material = boardEditorSamplingMaterials(optionsProvider)
      .find((item) => item.materialId === target.value);
    entry.draft.materialId = material?.materialId || target.value;
    entry.draft.sampleBaseNo = material?.sampleBaseNo || '';
    entry.draft.samplingBranch = 0;
    entry.draft.samplingPlace = '';
    entry.draft.part = '';
    rerenderControls = true;
  } else if (target.matches('[data-editor-branch]')) {
    entry.draft.samplingBranch = Number(target.value || 0);
    if (entry.draft.samplingBranch) syncSamplingPlace(entry, optionsProvider);
    else {
      entry.draft.samplingPlace = '';
      entry.draft.part = '';
    }
    rerenderControls = true;
  } else if (target.matches('[data-editor-sampling-place]')) {
    entry.draft.samplingPlace = String(target.value || '');
  } else if (target.matches('[data-editor-sampling-part]')) {
    entry.draft.part = String(target.value || '');
  } else if (target.matches('[data-editor-stage]')) {
    entry.draft.shootingType = target.value;
  } else if (target.matches('[data-editor-date]')) {
    entry.draft.boardDate = normalizeBoardEditorDateInput(target.value);
  } else if (target.matches('[data-editor-position]')) {
    entry.draft.boardPosition = target.value;
  } else if (target.matches('[data-editor-size]')) {
    entry.draft.boardSize = target.value;
  } else {
    return { changed: false, rerenderControls: false };
  }

  return { changed: true, rerenderControls };
}
