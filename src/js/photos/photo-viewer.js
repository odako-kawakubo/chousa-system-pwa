/**
 * src/js/photos/photo-viewer.js
 *
 * 共通PhotoViewer。
 * 通常表示・写真送り・2〜4枠比較・画像本体の遅延解決を担当する。
 * Gesture処理は photo-viewer-gesture.js、
 * OneDrive/IndexedDBからの完成画像解決は photo-viewer-source.js に分離する。
 */

import { getVisualPhotoTargetKey } from '../records/photo-record.js';
import { resolveViewerCompletedPhoto } from './photo-viewer-source.js';
import {
  createPhotoViewerTransformState,
  resetPhotoViewerTransform,
  applyPhotoViewerTransform,
  bindPhotoViewerGestureStage
} from './photo-viewer-gesture.js';

let getPhotosForPhoto = () => [];
let getPhotoSource = () => '';
let getCompareTargets = () => [];
let onEditPhoto = null;
let modal = null;
let title = null;
let body = null;
let bound = false;
let viewerSessionId = 0;
const resolvedViewerUrls = new Map();

const viewerState = {
  photos: [],
  index: 0,
  context: {},
  compareMode: false,
  normalTransform: createPhotoViewerTransformState(),
  compare: {
    targets: [],
    panes: []
  }
};

/**
 * Viewerで生成したObject URLをすべてrevokeし、案件/写真切替時のメモリリークを防ぐ。
 */
function revokeResolvedViewerUrls() {
  for (const url of resolvedViewerUrls.values()) {
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  }
  resolvedViewerUrls.clear();
}

/**
 * photoIdごとの解決済みfull画像URLを保存し、旧Object URLがあれば安全に解放する。
 */
function setResolvedViewerSource(photoId, blob) {
  if (!photoId || !(blob instanceof Blob) || typeof URL.createObjectURL !== 'function') return '';
  const previous = resolvedViewerUrls.get(photoId);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  resolvedViewerUrls.set(photoId, url);
  return url;
}

/**
 * Viewer内HTMLへ埋め込む文字列をescapeする小helper。
 */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * 通常Viewerのcurrent indexから現在photo Recordを返す。
 */
function currentPhoto() {
  return viewerState.photos[viewerState.index] || null;
}

/**
 * 指定photoIdの解決済みfull画像URLがあれば返し、未解決時はpreview用sourceへfallbackする。
 */
function sourceFor(photo) {
  if (!photo) return '';
  return String(resolvedViewerUrls.get(photo.photoId) || getPhotoSource(photo) || '');
}

/**
 * img要素へsource/alt/transform対象属性を設定する共通描画helper。
 */
function renderImage(photo, className = 'photo-viewer-image') {
  const source = sourceFor(photo);
  if (!photo) {
    return '<div class="photo-viewer-no-image"><div class="photo-preview-icon">📷</div><b>写真なし</b></div>';
  }
  if (!source) {
    return `<div class="photo-viewer-no-image"><div class="photo-preview-icon">📷</div><b>${esc(photo.fileName || photo.photoId)}</b><span>画像本体はまだ接続されていません。</span></div>`;
  }
  return `<img class="${className}" src="${esc(source)}" alt="${esc(photo.fileName || photo.photoId || '写真')}" draggable="false">`;
}

/**
 * 通常Viewerのstage画像だけを差し替え、gesture transformを初期化する。
 */
function updateStageImage(stage, photo, className = 'photo-viewer-image') {
  if (!stage || !photo) return;
  const source = sourceFor(photo);
  const image = stage.querySelector('img');
  if (image && source) {
    if (image.getAttribute('src') !== source) image.src = source;
    return;
  }
  stage.innerHTML = renderImage(photo, className);
}

/**
 * 通常Viewer用にlocal completed画像またはremote full画像を非同期解決し、現在photoが変わっていなければ反映する。
 */
async function prepareNormalPhotoSource(photo) {
  if (!photo || resolvedViewerUrls.has(photo.photoId)) return;
  const sessionId = viewerSessionId;
  const photoId = String(photo.photoId || '');
  try {
    const blob = await resolveViewerCompletedPhoto(photo);
    if (!(blob instanceof Blob)) return;
    if (sessionId !== viewerSessionId || viewerState.compareMode) return;
    if (String(currentPhoto()?.photoId || '') !== photoId) return;
    setResolvedViewerSource(photoId, blob);
    const stage = body?.querySelector('[data-photo-viewer-stage]');
    updateStageImage(stage, photo);
    applyPhotoViewerTransform(stage, viewerState.normalTransform);
  } catch (error) {
    console.warn('Viewer写真本体の解決に失敗しました', { photoId, error });
  }
}

/**
 * 比較pane用のfull画像sourceを非同期解決し、paneがまだ同じ写真を指している場合だけ反映する。
 */
async function prepareComparePhotoSource(paneIndex, photo) {
  if (!photo) return;
  const sessionId = viewerSessionId;
  const photoId = String(photo.photoId || '');
  const pane = comparePane(paneIndex);
  if (!pane) return;
  const paneKey = pane.key;

  try {
    if (!resolvedViewerUrls.has(photoId)) {
      const blob = await resolveViewerCompletedPhoto(photo);
      if (!(blob instanceof Blob)) return;
      if (sessionId !== viewerSessionId || !viewerState.compareMode) return;
      const livePane = comparePane(paneIndex);
      if (!livePane || livePane.key !== paneKey) return;
      if (String(comparePhoto(paneIndex)?.photoId || '') !== photoId) return;
      setResolvedViewerSource(photoId, blob);
    }

    if (sessionId !== viewerSessionId || !viewerState.compareMode) return;
    const livePane = comparePane(paneIndex);
    if (!livePane || livePane.key !== paneKey) return;
    if (String(comparePhoto(paneIndex)?.photoId || '') !== photoId) return;
    const stage = body?.querySelector(`[data-compare-stage="${paneIndex}"]`);
    updateStageImage(stage, photo, 'photo-viewer-image photo-compare-image');
    applyPhotoViewerTransform(stage, livePane.transform);
  } catch (error) {
    console.warn('比較写真本体の解決に失敗しました', { photoId, error });
  }
}

/**
 * 通常Viewer内で前後写真へ移動する。current indexを更新後、新しい画像sourceを準備して描画する。
 */
function moveNormal(delta) {
  if (!viewerState.photos.length || viewerState.normalTransform.scale > 1.01) return;
  viewerState.index = (viewerState.index + delta + viewerState.photos.length) % viewerState.photos.length;
  renderNormal();
}

/**
 * 通常Viewerの現在photoを描画し、前後移動可否・caption・gesture対象を更新する。
 */
function renderNormal() {
  const photo = currentPhoto();
  if (!photo || !body || !title) return;
  viewerState.compareMode = false;
  resetPhotoViewerTransform(viewerState.normalTransform);
  title.textContent = photo.fileName || photo.photoId || '写真プレビュー';
  const hasMultiple = viewerState.photos.length > 1;
  const canCompare = photo.photoType === 'visual' && Boolean(getVisualPhotoTargetKey(photo)) && getCompareTargets(viewerState.context).length >= 2;
  body.innerHTML = `<div class="photo-viewer-shell">
    <div class="photo-viewer-tools">
      <button type="button" class="btn small" data-photo-edit>看板編集</button>
      ${canCompare ? '<button type="button" class="btn small" data-photo-compare-open>比較</button>' : ''}
    </div>
    <div class="photo-viewer-stage" data-photo-viewer-stage>${renderImage(photo)}</div>
    <button class="photo-viewer-nav photo-viewer-prev" type="button" data-photo-viewer-prev ${hasMultiple ? '' : 'hidden'}>‹</button>
    <button class="photo-viewer-nav photo-viewer-next" type="button" data-photo-viewer-next ${hasMultiple ? '' : 'hidden'}>›</button>
    <div class="photo-viewer-counter">${viewerState.index + 1} / ${viewerState.photos.length}</div>
  </div>`;
  const stage = body.querySelector('[data-photo-viewer-stage]');
  bindPhotoViewerGestureStage(stage, viewerState.normalTransform, { allowSwipe: true, onSwipe: moveNormal });
  void prepareNormalPhotoSource(photo);
}

/**
 * 比較Viewer用pane stateを生成する。target key・photo index等の初期値を持つ。
 */
function createComparePane(key = '') {
  return {
    key,
    index: 0,
    transform: createPhotoViewerTransformState()
  };
}

/**
 * paneが指す比較target定義を現在候補集合から解決する。
 */
function compareTarget(key) {
  return viewerState.compare.targets.find((item) => item.key === key) || null;
}

/**
 * pane indexから比較pane stateを返す。
 */
function comparePane(paneIndex) {
  return viewerState.compare.panes[paneIndex] || null;
}

/**
 * paneのtarget + photo indexから現在比較中のPhoto Recordを解決する。
 */
function comparePhoto(paneIndex) {
  const pane = comparePane(paneIndex);
  return pane ? compareTarget(pane.key)?.photos?.[pane.index] || null : null;
}

/**
 * 比較pane内で同一targetの前後写真へ切り替える。
 */
function moveComparePhoto(paneIndex, delta) {
  const pane = comparePane(paneIndex);
  if (!pane) return;
  const target = compareTarget(pane.key);
  if (!target?.photos?.length) return;
  pane.index = (pane.index + delta + target.photos.length) % target.photos.length;
  resetPhotoViewerTransform(pane.transform);
  renderCompare();
}

/**
 * 現在各paneで使用中のtarget key集合を返す。比較対象の重複候補除外に使う。
 */
function selectedCompareKeys(exceptIndex = -1) {
  return new Set(
    viewerState.compare.panes
      .map((pane, index) => index === exceptIndex ? '' : pane.key)
      .filter(Boolean)
  );
}

/**
 * 1つのpane用target select option一覧を生成する。既に他paneで使うtargetは除外する。
 */
function compareSelectOptions(paneIndex) {
  const pane = comparePane(paneIndex);
  if (!pane) return '';
  const blocked = selectedCompareKeys(paneIndex);
  return viewerState.compare.targets
    .filter((item) => item.key === pane.key || !blocked.has(item.key))
    .map((item) => `<option value="${esc(item.key)}" ${item.key === pane.key ? 'selected' : ''}>${esc(item.label)}</option>`)
    .join('');
}

/**
 * 比較mode上部のpane追加/削除や件数表示など共通controlを再描画する。
 */
function renderCompareControls(paneIndex) {
  const pane = comparePane(paneIndex);
  if (!pane) return '';
  const target = compareTarget(pane.key);
  const count = target?.photos?.length || 0;
  const canRemove = paneIndex >= 2;
  return `<div class="photo-compare-controls" data-compare-controls="${paneIndex}">
    <select data-compare-target="${paneIndex}" aria-label="比較対象${paneIndex + 1}">${compareSelectOptions(paneIndex)}</select>
    <div class="photo-compare-photo-nav">
      <button type="button" class="btn small" data-compare-prev="${paneIndex}" ${count > 1 ? '' : 'disabled'}>‹</button>
      <span>${count ? pane.index + 1 : 0} / ${count}</span>
      <button type="button" class="btn small" data-compare-next="${paneIndex}" ${count > 1 ? '' : 'disabled'}>›</button>
      ${canRemove ? `<button type="button" class="btn small photo-compare-remove" data-compare-remove="${paneIndex}" title="比較枠を削除">×</button>` : ''}
    </div>
  </div>`;
}

/**
 * 1つの比較paneを現在target/photo選択に合わせて更新する。paneごとのfull画像source解決も開始する。
 */
function renderComparePane(paneIndex) {
  const pane = comparePane(paneIndex);
  if (!pane) return '';
  const photo = comparePhoto(paneIndex);
  const controls = renderCompareControls(paneIndex);
  const controlsOnBottom = paneIndex >= 2;
  return `<section class="photo-compare-pane ${controlsOnBottom ? 'controls-bottom' : 'controls-top'}" data-compare-pane="${paneIndex}">
    ${controlsOnBottom ? '' : controls}
    <div class="photo-compare-stage" data-compare-stage="${paneIndex}">${renderImage(photo, 'photo-viewer-image photo-compare-image')}</div>
    ${controlsOnBottom ? controls : ''}
  </section>`;
}

/**
 * まだ他paneで使われていない比較targetを1件返す。新規pane追加時のdefault候補。
 */
function availableCompareTarget() {
  const used = selectedCompareKeys();
  return viewerState.compare.targets.find((item) => !used.has(item.key)) || null;
}

/**
 * 未使用target候補から比較paneを追加する。最大4枚・同一target重複なしの制約を守る。
 */
function addComparePane() {
  if (viewerState.compare.panes.length >= 4) return;
  const target = availableCompareTarget();
  if (!target) return;
  viewerState.compare.panes.push(createComparePane(target.key));
  renderCompare();
}

/**
 * 指定比較paneを削除し、残りpaneを再描画する。
 */
function removeComparePane(paneIndex) {
  if (paneIndex < 2 || paneIndex >= viewerState.compare.panes.length) return;
  viewerState.compare.panes.splice(paneIndex, 1);
  renderCompare();
}

/**
 * 比較mode全体を描画し、各paneの候補select・写真・削除buttonを更新する。
 */
function renderCompare() {
  if (!body || !title) return;
  viewerState.compareMode = true;
  title.textContent = '写真比較';
  const count = viewerState.compare.panes.length;
  const canAdd = count < 4 && Boolean(availableCompareTarget());
  body.innerHTML = `<div class="photo-compare-shell">
    <div class="photo-compare-toolbar">
      <button type="button" class="btn small" data-photo-compare-back>通常表示へ戻る</button>
      ${canAdd ? '<button type="button" class="btn small" data-compare-add>＋比較追加</button>' : ''}
    </div>
    <div class="photo-compare-grid count-${count}">${viewerState.compare.panes.map((_, index) => renderComparePane(index)).join('')}</div>
  </div>`;

  viewerState.compare.panes.forEach((pane, index) => {
    const stage = body.querySelector(`[data-compare-stage="${index}"]`);
    bindPhotoViewerGestureStage(stage, pane.transform);
    void prepareComparePhotoSource(index, comparePhoto(index));
  });
}

/**
 * 比較Viewer modeへ切り替え、最大4枠の比較paneを初期化する。
 */
function openCompare() {
  const targets = getCompareTargets(viewerState.context) || [];
  if (targets.length < 2) return;
  viewerState.compare.targets = targets;
  const current = currentPhoto();
  const currentKey = current?.photoType === 'visual' ? getVisualPhotoTargetKey(current) : '';
  const firstKey = targets.find((item) => item.key === currentKey)?.key || targets[0].key;
  const secondKey = targets.find((item) => item.key !== firstKey)?.key || '';
  if (!secondKey) return;
  viewerState.compare.panes = [createComparePane(firstKey), createComparePane(secondKey)];
  renderCompare();
}

/**
 * Viewer上部/下部の閉じる・前後・比較切替等のUIイベントを接続する。gesture本体はphoto-viewer-gestureへ分離している。
 */
function bindChrome() {
  if (bound || !modal || !body) return;
  bound = true;
  body.addEventListener('click', (event) => {
    if (event.target.closest('[data-photo-edit]')) { const photo=currentPhoto(); if (photo) onEditPhoto?.(photo.photoId); return; }
    if (event.target.closest('[data-photo-viewer-prev]')) return moveNormal(-1);
    if (event.target.closest('[data-photo-viewer-next]')) return moveNormal(1);
    if (event.target.closest('[data-photo-compare-open]')) return openCompare();
    if (event.target.closest('[data-photo-compare-back]')) return renderNormal();
    if (event.target.closest('[data-compare-add]')) return addComparePane();

    const remove = event.target.closest('[data-compare-remove]');
    if (remove) return removeComparePane(Number(remove.dataset.compareRemove));

    const prev = event.target.closest('[data-compare-prev]');
    if (prev) return moveComparePhoto(Number(prev.dataset.comparePrev), -1);
    const next = event.target.closest('[data-compare-next]');
    if (next) return moveComparePhoto(Number(next.dataset.compareNext), 1);
  });

  body.addEventListener('change', (event) => {
    const select = event.target.closest('[data-compare-target]');
    if (!select) return;
    const paneIndex = Number(select.dataset.compareTarget);
    const pane = comparePane(paneIndex);
    if (!pane) return;

    // 他枠で選択済みの対象は選択肢自体から除外しているが、DOM改変等でも
    // 重複しないよう最終防御する。
    const blocked = selectedCompareKeys(paneIndex);
    if (blocked.has(select.value)) {
      renderCompare();
      return;
    }

    pane.key = select.value;
    pane.index = 0;
    resetPhotoViewerTransform(pane.transform);
    renderCompare();
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closePhotoViewer();
  });
  modal.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', closePhotoViewer));
}

/**
 * Photo Viewer DOMとgesture/chromeイベントを一度だけ初期化する。
 */
export function initializePhotoViewer(options = {}) {
  getPhotosForPhoto = typeof options.getPhotosForPhoto === 'function' ? options.getPhotosForPhoto : (() => []);
  getPhotoSource = typeof options.getPhotoSource === 'function' ? options.getPhotoSource : (() => '');
  getCompareTargets = typeof options.getCompareTargets === 'function' ? options.getCompareTargets : (() => []);
  onEditPhoto = typeof options.onEditPhoto === 'function' ? options.onEditPhoto : null;
  modal = document.getElementById('photoPreviewModal');
  title = document.getElementById('photoPreviewTitle');
  body = document.getElementById('photoPreviewBody');
  bindChrome();
}

/**
 * 指定photoIdを通常Viewerで開く公開API。Viewer用候補集合とfull画像sourceを解決し、拡大表示を開始する。
 */
export function openPhotoViewer(photoId, context = {}) {
  if (!modal || !body) return;
  const contextPhotos = Array.isArray(context.photos) ? context.photos : null;
  const photos = contextPhotos || getPhotosForPhoto(photoId) || [];
  const index = photos.findIndex((photo) => photo.photoId === photoId);
  if (!photos.length || index < 0) return;
  viewerSessionId += 1;
  revokeResolvedViewerUrls();
  viewerState.photos = photos;
  viewerState.index = index;
  viewerState.context = { ...context };
  viewerState.compareMode = false;
  renderNormal();
  modal.classList.add('open');
}

/**
 * Viewerを閉じ、解決済みObject URLやgesture状態を解放する。
 */
export function closePhotoViewer() {
  if (!modal) return;
  viewerSessionId += 1;
  revokeResolvedViewerUrls();
  modal.classList.remove('open');
  viewerState.photos = [];
  viewerState.index = 0;
  viewerState.context = {};
  viewerState.compareMode = false;
  resetPhotoViewerTransform(viewerState.normalTransform);
  viewerState.compare.panes.forEach((pane) => resetPhotoViewerTransform(pane.transform));
  viewerState.compare.panes = [];
  viewerState.compare.targets = [];
  if (body) body.innerHTML = '';
}
