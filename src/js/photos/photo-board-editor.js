/**
 * src/js/photos/photo-board-editor.js
 *
 * v0.1.7.6 撮影済み写真の電子看板編集。
 *
 * - 複数写真編集は写真ごとの draft / Undo・Redo履歴 / dirty状態を保持する。
 * - 左右スワイプは表示写真の切替だけを行い、永続保存は発生させない。
 * - 「保存」押下時だけ、変更された写真を既存の1枚保存経路で順番に確定する。
 * - 看板日付は capturedAt と分離した boardDate（YYYY-MM-DD）として編集・同期する。
 * - 旧写真に boardDate が無い場合だけ capturedAt の日付へフォールバックする。
 * - 看板編集に必要な元画像はローカル優先、無ければOneDriveから取得してIndexedDBへ保持する。
 *
 * 確定経路は増やさず、photo-board-editor-persistence.js の persistBoardEditorEntry() を全保存の唯一の入口とする。
 */

import * as photoRecordStore from '../store/photo-record-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES, isSamplingPhotoUnorganized, isVisualPhotoUnorganized } from '../records/photo-record.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import {
  BOARD_POSITION_LABELS,
  BOARD_SIZE_LABELS,
  drawBoard,
  getBoardRect
} from '../camera/camera-board.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import {
  bindPhotoBoardEditorInteractions,
  resetPhotoBoardEditorInteractionState
} from './photo-board-editor-interactions.js';
import {
  createEmptyBoardEditorSession,
  createBoardEditorEntry,
  cloneEditorValue,
  refreshBoardEditorEntryDirty,
  boardEditorSessionHasUnsavedChanges,
  pushBoardEditorHistory,
  applyBoardEditorHistory,
} from './photo-board-editor-session.js';
import {
  persistBoardEditorEntry,
  formatBoardSampleNo
} from './photo-board-editor-persistence.js';
import {
  normalizeBoardEditorDateInput,
  boardEditorVisualRooms,
  boardEditorSamplingTargets,
  findBoardEditorVisualRoom,
  boardEditorSamplingMaterialTargets,
  boardEditorSamplingMaterials,
  renderBoardEditorForm,
  updateBoardEditorDraftFromEvent
} from './photo-board-editor-form.js';

const BOARD_POSITIONS = ['bottom-left', 'bottom-right', 'top-right', 'top-left'];
const BOARD_SIZES = ['small', 'medium', 'large'];

let root = null;
let canvas = null;
let optionsProvider = () => ({ visualRooms: [], samplingTargets: [] });
let onSaved = null;
let onClosed = null;
let originalImage = null;
let originalUrl = '';
let renderToken = 0;
let saving = false;
let switching = false;

let session = createEmptyBoardEditorSession();
let active = null;

/**
 * 看板日付をHTML date inputへ入れられるYYYY-MM-DD形式へ正規化する小helper。
 */
function dateInputValue(value) {
  return normalizeBoardEditorDateInput(value);
}

/**
 * Photo Recordの撮影日/編集日から電子看板に表示する日付文字列を決める。
 */
function boardDateFromRecord(record) {
  return dateInputValue(record?.boardDate) || dateInputValue(record?.capturedAt) || dateInputValue(new Date());
}

/**
 * 内部日付値を看板表示用の日本語日付文字列へ変換する。
 */
function dateText(value) {
  const iso = dateInputValue(value);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/**
 * 採取写真の試料No.表示をmaterial/枝番情報から組み立てる。
 */
function sampleDisplay(base, branch) { return formatBoardSampleNo(base, branch); }

/**
 * 現在entryのdirty/保存済み/未保存状態をUI表示用codeへ変換する。
 */
function currentStatusCode(entry = active) {
  if (!entry) return '1';
  if (entry.record.photoType === PHOTO_TYPES.VISUAL) return '5';
  if (entry.draft.shootingType === SHOOTING_TYPES.SECTION) return '4';
  return ({ before:'1', during:'2', after:'3' })[entry.draft.shootingType] || '';
}

/**
 * 現在entryのdraftから電子看板描画用データを構築する。Camera Boardと同じ表示項目へ正規化する。
 */
function boardData(entry = active) {
  const settings = boardSettingsStore.get();
  return {
    photoType: entry.record.photoType,
    projectName: settings.subjectText || settings.projectName,
    address: settings.addressText || settings.address,
    subjectFontSize: settings.subjectFontSize,
    addressFontSize: settings.addressFontSize,
    roomNo: entry.draft.roomNo,
    part: entry.draft.part,
    samplingPlace: entry.draft.samplingPlace,
    sampleNo: sampleDisplay(entry.draft.sampleBaseNo, entry.draft.samplingBranch),
    statusCode: currentStatusCode(entry),
    date: dateText(entry.draft.boardDate)
  };
}

/**
 * 目視Board編集で選択可能な部屋候補一覧をForm module経由で返す。
 */
function visualRooms() { return boardEditorVisualRooms(optionsProvider); }
/**
 * 採取Board編集で選択可能な試料候補一覧をForm module経由で返す。
 */
function samplingTargets() { return boardEditorSamplingTargets(optionsProvider); }
/**
 * areaCode + roomPosition等の安定identityから目視部屋候補を1件解決する。
 */
function visualRoomByIdentity(identity = {}) { return findBoardEditorVisualRoom(optionsProvider, identity); }
/**
 * 採取写真のmaterialIdから枝番/採取場所を含む候補一覧を返す。
 */
function samplingMaterialTargets(materialId) { return boardEditorSamplingMaterialTargets(optionsProvider, materialId); }
/**
 * 採取対象material候補一覧をForm moduleから取得する薄いadapter。
 */
function samplingMaterials() { return boardEditorSamplingMaterials(optionsProvider); }

/**
 * 目視Photo RecordをBoard Editor draftへ変換する。編集可能fieldだけを抽出して元Recordと分離する。
 */
function snapshotVisualFromRecord_(record) {
  const room = visualRoomByIdentity(record);
  const unorganized = isVisualPhotoUnorganized(record);
  const target = unorganized ? null : room?.targets?.find((item) => Number(item.partSlot || 0) === Number(record.partSlot || 0)) || null;

  return {
    areaCode: record.areaCode || room?.areaCode || '',
    roomPosition: record.roomPosition || room?.roomPosition || '',
    partSlot: Number(record.partSlot || 0),
    roomNo: record.roomNo || room?.roomNo || '',
    part: record.part || target?.part || '',
    boardDate: boardDateFromRecord(record),
    boardPosition: record.boardPosition || 'bottom-left',
    boardSize: record.boardSize || 'medium'
  };
}

/**
 * 採取Photo RecordをBoard Editor draftへ変換する。material/枝番/撮影区分/採取場所等を保持する。
 */
function snapshotSamplingFromRecord_(record) {
  const materials = samplingMaterials();
  const material = materials.find((item) => item.materialId === record.materialId) || null;
  const targets = samplingMaterialTargets(record.materialId);
  const unorganized = isSamplingPhotoUnorganized(record);
  const target = unorganized ? null : targets.find((item) => Number(item.branch) === Number(record.samplingBranch)) || null;

  return {
    materialId: record.materialId || material?.materialId || '',
    sampleBaseNo: record.sampleBaseNo || String(record.sampleNo || '').split('-')[0] || material?.sampleBaseNo || '',
    samplingBranch: Number(record.samplingBranch || 0),
    samplingPlace: record.samplingPlace || target?.samplingPlace || '',
    part: record.part || target?.part || '',
    shootingType: record.shootingType || '',
    boardDate: boardDateFromRecord(record),
    boardPosition: record.boardPosition || 'bottom-left',
    boardSize: record.boardSize || 'medium'
  };
}

/**
 * Photo RecordからBoard Editor用draftを作る。目視/採取で必要fieldが異なるためtype別snapshotへ振り分ける。
 */
function snapshotFromRecord(record) {
  return record.photoType === PHOTO_TYPES.VISUAL ? snapshotVisualFromRecord_(record) : snapshotSamplingFromRecord_(record);
}

/**
 * photoIdとRecordからEditor session entryを生成する。draft/history/image resource等の初期状態もここでまとめる。
 */
function createEntry_(record) {
  return createBoardEditorEntry(record, snapshotFromRecord(record));
}

/**
 * entryのdraftと保存済みbaselineを比較しdirty状態を更新する。
 */
function refreshDirty_(entry = active) {
  return refreshBoardEditorEntryDirty(entry);
}
/**
 * session内に未保存entryが1件でもあるか判定する。閉じる確認や移動guardで使う。
 */
function hasUnsavedChanges_() {
  return boardEditorSessionHasUnsavedChanges(session);
}

/**
 * 現在draftをUndo履歴へ積む。連続同値や履歴上限はSession module側の規則に従う。
 */
function pushHistory() {
  if (!active) return;
  if (!pushBoardEditorHistory(active)) return;
  updateHistoryButtons();
}

/**
 * Undo/Redoで得たdraftを現在entryへ適用し、フォームとPreviewを再描画する。
 */
function applyHistory(index) {
  if (!active || !applyBoardEditorHistory(active, index)) return;
  renderControls();
  renderPreview();
  updateHistoryButtons();
}

/**
 * 現在entryのUndo/Redo可否をbutton disabled状態へ反映する。
 */
function updateHistoryButtons() {
  root?.querySelector('[data-editor-undo]')?.toggleAttribute('disabled', !active || active.historyIndex <= 0);
  root?.querySelector('[data-editor-redo]')?.toggleAttribute('disabled', !active || active.historyIndex >= active.history.length - 1);
}

/**
 * 複数写真sessionの現在位置と前後移動可否を案内UIへ表示する。
 */
function updateNavigationHint_() {
  const hint = root?.querySelector('[data-editor-sequence-hint]');
  if (!hint) return;
  if (session.ids.length <= 1) {
    hint.textContent = '';
    hint.hidden = true;
    return;
  }
  hint.hidden = false;
  hint.textContent = `${session.index + 1} / ${session.ids.length}　左右スワイプで写真切替`;
}

/**
 * Board Editor用DOM rootが存在することを保証して返す。初回だけ生成し再利用する。
 */
function ensureRoot() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'photo-board-editor';
  root.hidden = true;
  root.innerHTML = `
    <div class="photo-board-editor-shell">
      <div class="photo-board-editor-stage"><canvas data-photo-board-editor-canvas></canvas></div>
      <aside class="photo-board-editor-controls">
        <div class="photo-board-editor-head"><b>看板編集</b><button class="btn small" type="button" data-editor-close>閉じる</button></div>
        <div class="photo-board-editor-sequence-hint" data-editor-sequence-hint hidden></div>
        <div data-editor-fields></div>
        <div class="photo-board-editor-common">
          <label>日付<input type="date" data-editor-date></label>
          <label>看板位置<select data-editor-position>${BOARD_POSITIONS.map((v)=>`<option value="${v}">${BOARD_POSITION_LABELS[v] || v}</option>`).join('')}</select></label>
          <label>看板サイズ<select data-editor-size>${BOARD_SIZES.map((v)=>`<option value="${v}">${BOARD_SIZE_LABELS[v] || v}</option>`).join('')}</select></label>
        </div>
        <div class="photo-board-editor-history">
          <button class="btn small" type="button" data-editor-undo>戻る</button>
          <button class="btn small" type="button" data-editor-redo>進む</button>
          <button class="btn small" type="button" data-editor-reset>リセット</button>
        </div>
        <button class="btn primary" type="button" data-editor-save>保存</button>
      </aside>
    </div>`;
  document.body.appendChild(root);
  canvas = root.querySelector('[data-photo-board-editor-canvas]');
  bindPhotoBoardEditorInteractions({
    root,
    isActive: () => Boolean(active),
    isSaving: () => saving,
    isSwitching: () => switching,
    getSessionIndex: () => session.index,
    updateDraftFromEvent,
    requestClose: requestClose_,
    applyHistory: (direction) => {
      if (!active) return;
      if (direction === 'reset') return applyHistory(0);
      return applyHistory(active.historyIndex + Number(direction || 0));
    },
    saveSession: saveSession_,
    setSaving: (value) => { saving = Boolean(value); },
    canNavigate,
    activateIndex: activateIndex_,
    renderPreview
  });
}

/**
 * 現在entryのdraft・Undo/Redo状態・前後移動可否をEditor DOMへ反映する。
 */
function renderControls() {
  if (!active || !root) return;
  renderBoardEditorForm(root, active, optionsProvider);
  updateNavigationHint_();
}

/**
 * 画像BlobをObject URL経由でHTMLImageElementとしてdecodeし、Canvas描画可能状態で返す。
 */
async function loadImageFromBlob(blob) {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = originalUrl;
  await image.decode();
  return image;
}

/**
 * entryの原画像をlocal BlobまたはOneDrive参照から解決してEditor用Imageへロードする。完成画像ではなく原本を優先する。
 */
async function loadOriginalImageForEntry_(entry) {
  const originalBlob = await resolveEditorOriginalPhoto(entry.record);
  if (!originalBlob) return false;
  originalImage = await loadImageFromBlob(originalBlob);
  return true;
}

/**
 * 原画像とdraft看板をCanvas上に合成した編集Previewを描画する。ここでは永続保存しない。
 */
function renderPreview() {
  if (!active || !originalImage || !canvas) return;
  const token = ++renderToken;
  requestAnimationFrame(() => {
    if (token !== renderToken || !active) return;
    const wrap = canvas.parentElement;
    const width = Math.max(1, Math.floor(wrap.clientWidth || 900));
    const height = Math.max(1, Math.floor(wrap.clientHeight || 650));
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const ir = originalImage.width / originalImage.height;
    const cr = canvas.width / canvas.height;
    let dw, dh, dx, dy;
    if (ir > cr) { dw=canvas.width; dh=dw/ir; dx=0; dy=(canvas.height-dh)/2; }
    else { dh=canvas.height; dw=dh*ir; dy=0; dx=(canvas.width-dw)/2; }
    ctx.drawImage(originalImage, dx, dy, dw, dh);
    if (!(active.record.photoType === PHOTO_TYPES.SAMPLING && active.draft.shootingType === SHOOTING_TYPES.SECTION)) {
      const rect = getBoardRect(dw, dh, active.draft.boardPosition, active.draft.boardSize);
      drawBoard(ctx, { x: dx+rect.x, y: dy+rect.y, width: rect.width, height: rect.height }, boardData(active));
    }
  });
}

/**
 * フォームchange/inputをdraftへ反映し、dirty判定・history・Preview再描画を更新する。
 */
function updateDraftFromEvent(target) {
  if (!active) return;
  const result = updateBoardEditorDraftFromEvent(target, active, optionsProvider);
  if (!result.changed) return;
  if (result.rerenderControls) renderControls();
  pushHistory();
  renderPreview();
}

/**
 * 現在session内のdirty entryを順に保存する。画像合成とRecord更新はpersistence moduleへ委譲する。
 */
async function saveSession_() {
  if (!active || saving) return;
  saving = true;
  try {
    const dirtyEntries = session.ids.map((photoId) => session.entries.get(photoId)).filter((entry) => entry?.dirty);
    const items = [];
    for (const entry of dirtyEntries) items.push(await persistBoardEditorEntry(entry, { getBoardData: boardData }));
    closeEditorInternal_('saved');
    await onSaved?.({ items });
  } catch (error) {
    if (active) {
      await loadOriginalImageForEntry_(active);
      renderControls();
      updateHistoryButtons();
      renderPreview();
    }
    throw error;
  } finally {
    saving = false;
  }
}

/**
 * 未保存状態を含め、前後写真へ移動可能か判定する。編集中の不整合を避けるためのguard。
 */
function canNavigate(direction) {
  if (!session.ids.length) return false;
  const nextIndex = session.index + direction;
  return nextIndex >= 0 && nextIndex < session.ids.length;
}

/**
 * session内の指定indexをactiveにし、必要なら原画像をロードしてUI/Previewを更新する。
 */
async function activateIndex_(index) {
  if (switching || saving) return false;
  if (index < 0 || index >= session.ids.length) return false;
  const photoId = session.ids[index];
  const entry = session.entries.get(photoId);
  if (!entry) return false;

  switching = true;
  try {
    const loaded = await loadOriginalImageForEntry_(entry);
    if (!loaded) {
      window.alert('元写真を取得できませんでした。OneDrive上の元画像を確認してください。');
      return false;
    }
    session.index = index;
    active = entry;
    renderControls();
    updateHistoryButtons();
    renderPreview();
    return true;
  } finally {
    switching = false;
  }
}

/**
 * 閉じる操作時に未保存変更の有無を確認し、保存/破棄/キャンセルの分岐を行う。
 */
function requestClose_() {
  if (saving) return;
  if (hasUnsavedChanges_() && !window.confirm('未保存の看板編集があります。\n変更を破棄して閉じますか？')) return;
  closeEditorInternal_('cancel');
}


/**
 * 電子看板付き写真編集UIを一度だけ初期化する。DOM・Interactions・resize等を接続する入口。
 */
export function initializePhotoBoardEditor(options={}) {
  optionsProvider = typeof options.getOptions === 'function' ? options.getOptions : optionsProvider;
  onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
  onClosed = typeof options.onClosed === 'function' ? options.onClosed : null;
  ensureRoot();
}

/**
 * photoId配列からEditor session entry群を生成し、最初の写真をactiveにする内部初期化。
 */
async function startSession_(photoIds) {
  ensureRoot();
  const ids = [...new Set(photoIds || [])].filter((photoId) => {
    const record = photoRecordStore.get(photoId);
    return Boolean(record && !record.deleted);
  });
  if (!ids.length) return false;

  const entries = new Map();
  for (const photoId of ids) {
    const record = photoRecordStore.get(photoId);
    entries.set(photoId, createEntry_(record));
  }

  session = { ids, index: 0, entries };
  root.hidden=false;
  document.body.classList.add('photo-board-edit-open');
  const opened = await activateIndex_(0);
  if (!opened) {
    closeEditorInternal_('cancel');
    return false;
  }
  return true;
}

/**
 * 単一photoIdを編集sessionとして開く公開API。Photo Recordからdraftを作り、原画像読込後に編集画面を表示する。
 */
export function openPhotoBoardEditor(photoId) { return startSession_([photoId]); }
/**
 * 複数photoIdを順番付きsessionとして開く。前後移動しても各写真のdraft/historyを保持する。
 */
export function openPhotoBoardEditorSequence(photoIds) { return startSession_(photoIds); }

/**
 * 確認処理を行わずEditor DOM/session/resourceを破棄する内部処理。requestClose_または保存完了後からのみ使う。
 */
function closeEditorInternal_(reason = 'cancel') {
  if (!root) return;
  root.hidden=true;
  document.body.classList.remove('photo-board-edit-open');
  active=null;
  session=createEmptyBoardEditorSession();
  originalImage=null;
  switching=false;
  resetPhotoBoardEditorInteractionState();
  if (originalUrl) { URL.revokeObjectURL(originalUrl); originalUrl=''; }
  onClosed?.(reason);
}

/**
 * 未保存変更の確認を経てEditorを閉じる公開API。強制破棄ではなくrequestClose経路を使う。
 */
export function closePhotoBoardEditor(reason = 'cancel') {
  if (reason === 'cancel') return requestClose_();
  closeEditorInternal_(reason);
}
