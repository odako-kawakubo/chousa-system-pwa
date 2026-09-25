/**
 * src/js/finish-table/finish-table-edit-session.js
 *
 * 仕上表の「1回の文字編集」を管理する。
 * - focusin時の編集前スナップショット／値
 * - 候補選択・登録など明示確定後のfocusout二重commit防止
 * - 編集確定時のUndo履歴記録
 *
 * Storeの業務ロジックやDOM全体の再描画責務は持たず、
 * controller初期化時に必要なコールバックだけ受け取る。
 */

import { setFocusedInputKey } from './finish-table-state.js';
import { runRecordTransaction } from './finish-table-actions.js';
import { recordHistory } from './finish-table-history.js';
import {
  closeCandidatePopup,
  restoreDynamicRegisterButton
} from './finish-table-candidate-input.js';

let pendingEditSnapshot = null;
let pendingEditBeforeValue = null;
let explicitlyCommittedInputKey = null;
let explicitCommitReleaseTimer = null;

let getUndoableSnapshot = () => null;
let onHistoryChanged = () => {};
let onRefresh = () => {};

export function configureFinishTableEditSession(options = {}) {
  getUndoableSnapshot = typeof options.getUndoableSnapshot === 'function'
    ? options.getUndoableSnapshot
    : () => null;
  onHistoryChanged = typeof options.onHistoryChanged === 'function'
    ? options.onHistoryChanged
    : () => {};
  onRefresh = typeof options.onRefresh === 'function'
    ? options.onRefresh
    : () => {};
}

export function beginFinishEdit(input, snapshot = null) {
  pendingEditSnapshot = snapshot || getUndoableSnapshot();
  pendingEditBeforeValue = input?.value ?? '';
}

function markExplicitlyCommitted(input) {
  const key = String(input?.dataset?.inputKey || '');
  explicitlyCommittedInputKey = key || null;

  if (explicitCommitReleaseTimer) clearTimeout(explicitCommitReleaseTimer);
  explicitCommitReleaseTimer = setTimeout(() => {
    explicitlyCommittedInputKey = null;
    explicitCommitReleaseTimer = null;
  }, 250);
}

export function consumeExplicitCommit(input) {
  const key = String(input?.dataset?.inputKey || '');
  if (!key || key !== explicitlyCommittedInputKey) return false;

  explicitlyCommittedInputKey = null;
  if (explicitCommitReleaseTimer) clearTimeout(explicitCommitReleaseTimer);
  explicitCommitReleaseTimer = null;
  return true;
}

/**
 * 候補選択／登録／Enterなど、明示操作でセル編集を確定する共通経路。
 * Store確定・履歴追加・再描画は1操作につき1回だけ行う。
 */
export function completeCellEdit(input, mutate) {
  if (!input || typeof mutate !== 'function') return;

  const before = pendingEditSnapshot || getUndoableSnapshot();
  markExplicitlyCommitted(input);
  closeCandidatePopup();
  restoreDynamicRegisterButton(input);
  setFocusedInputKey(null);

  runRecordTransaction(mutate);
  if (before) recordHistory(before);
  onHistoryChanged();

  pendingEditSnapshot = null;
  pendingEditBeforeValue = null;
  onRefresh();
}

/**
 * 通常focusout時の編集確定。
 * 編集前後の値が変わった場合だけUndo履歴へ積む。
 */
export function finalizePendingEdit(currentValue) {
  if (pendingEditSnapshot && currentValue !== pendingEditBeforeValue) {
    recordHistory(pendingEditSnapshot);
    onHistoryChanged();
  }
  pendingEditSnapshot = null;
  pendingEditBeforeValue = null;
}

export function resetFinishTableEditSession() {
  pendingEditSnapshot = null;
  pendingEditBeforeValue = null;
  explicitlyCommittedInputKey = null;

  if (explicitCommitReleaseTimer) clearTimeout(explicitCommitReleaseTimer);
  explicitCommitReleaseTimer = null;
}
