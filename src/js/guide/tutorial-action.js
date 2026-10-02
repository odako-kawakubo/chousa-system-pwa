/**
 * src/js/guide/tutorial-action.js
 *
 * 通常UIでsemantic actionが正常に完了した事実だけを通知する。
 * 操作許可・DOM監視・進行判定は持たない。
 */

const listeners = new Set();

export function notifyTutorialAction(actionId, context = {}) {
  const id = String(actionId || '');
  if (!id) return;
  const event = {
    actionId: id,
    context: context && typeof context === 'object' ? { ...context } : {}
  };
  listeners.forEach((listener) => listener(event));
}

export function subscribeTutorialActions(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
