/**
 * Photo Board Editorの編集セッションとUndo/Redo履歴を管理する。
 * DOM・Canvas・保存処理は持たない。
 */

export function cloneEditorValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameDraft(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createEmptyBoardEditorSession() {
  return { ids: [], index: -1, entries: new Map() };
}

export function createBoardEditorEntry(record, initialDraft) {
  const initial = cloneEditorValue(initialDraft);
  return {
    record: { ...record },
    initialDraft: cloneEditorValue(initial),
    draft: cloneEditorValue(initial),
    history: [cloneEditorValue(initial)],
    historyIndex: 0,
    dirty: false
  };
}

export function refreshBoardEditorEntryDirty(entry) {
  if (!entry) return false;
  entry.dirty = !sameDraft(entry.draft, entry.initialDraft);
  return entry.dirty;
}

export function boardEditorSessionHasUnsavedChanges(session) {
  return [...(session?.entries?.values?.() || [])].some((entry) => entry.dirty);
}

export function pushBoardEditorHistory(entry) {
  if (!entry) return false;
  const snapshot = cloneEditorValue(entry.draft);
  const current = entry.history[entry.historyIndex];
  if (current && sameDraft(current, snapshot)) return false;

  entry.history = entry.history.slice(0, entry.historyIndex + 1);
  entry.history.push(snapshot);
  entry.historyIndex = entry.history.length - 1;
  refreshBoardEditorEntryDirty(entry);
  return true;
}

export function applyBoardEditorHistory(entry, index) {
  if (!entry || index < 0 || index >= entry.history.length) return false;
  entry.historyIndex = index;
  entry.draft = cloneEditorValue(entry.history[index]);
  refreshBoardEditorEntryDirty(entry);
  return true;
}

export function settleBoardEditorEntry(entry, record) {
  if (!entry) return;
  if (record) entry.record = { ...record };
  entry.initialDraft = cloneEditorValue(entry.draft);
  entry.history = [cloneEditorValue(entry.draft)];
  entry.historyIndex = 0;
  entry.dirty = false;
}
