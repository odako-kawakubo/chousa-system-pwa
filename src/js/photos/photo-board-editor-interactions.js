/**
 * Photo Board EditorのDOMイベントとスワイプ操作を担当する。
 * セッション状態・保存処理・Canvas描画の正本は持たない。
 */

let boundRoot = null;
let swipeStart = null;

export function bindPhotoBoardEditorInteractions({
  root,
  isActive,
  isSaving,
  isSwitching,
  getSessionIndex,
  updateDraftFromEvent,
  reflectSamplingPlace,
  requestClose,
  applyHistory,
  saveSession,
  setSaving,
  canNavigate,
  activateIndex,
  renderPreview
}) {
  if (!root || boundRoot === root) return;
  boundRoot = root;

  const stage = root.querySelector('.photo-board-editor-stage');

  stage?.addEventListener('pointerdown', (event) => {
    if (!isActive() || isSaving() || isSwitching() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  });

  stage?.addEventListener('pointerup', (event) => {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId || !isActive() || isSaving() || isSwitching()) {
      swipeStart = null;
      return;
    }

    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;

    if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
    const direction = dx < 0 ? 1 : -1;
    if (!canNavigate(direction)) return;

    activateIndex(getSessionIndex() + direction).catch((error) => {
      console.error(error);
      window.alert(`写真の切り替えに失敗しました。\n${error.message || error}`);
    });
  });

  stage?.addEventListener('pointercancel', () => {
    swipeStart = null;
  });

  root.addEventListener('change', (event) => updateDraftFromEvent(event.target));

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-editor-close]')) return requestClose();
    if (event.target.closest('[data-editor-undo]')) return applyHistory(-1);
    if (event.target.closest('[data-editor-redo]')) return applyHistory(1);
    if (event.target.closest('[data-editor-reset]')) return applyHistory('reset');

    if (event.target.closest('[data-editor-reflect-sampling-place]')) {
      reflectSamplingPlace().catch((error) => {
        console.error(error);
        window.alert(`採取場所への反映に失敗しました。\n${error.message || error}`);
      });
      return;
    }

    if (event.target.closest('[data-editor-save]')) {
      saveSession().catch((error) => {
        setSaving(false);
        console.error(error);
        window.alert(`看板編集の保存に失敗しました。\n${error.message || error}`);
      });
    }
  });

  window.addEventListener('resize', renderPreview);
}

export function resetPhotoBoardEditorInteractionState() {
  swipeStart = null;
}
