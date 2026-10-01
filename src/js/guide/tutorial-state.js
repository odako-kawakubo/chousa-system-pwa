/**
 * src/js/guide/tutorial-state.js
 *
 * チュートリアル中の現在stepと許可操作だけを保持する。
 * DOM・イベント・Storeは監視しない。
 */

let active = false;
let stepId = '';
let permissions = [];

function normalizeRule(rule) {
  if (typeof rule === 'string') return { actionId: rule, context: {} };
  if (!rule || typeof rule !== 'object') return null;
  const actionId = String(rule.actionId || rule.id || '');
  if (!actionId) return null;
  return {
    actionId,
    context: rule.context && typeof rule.context === 'object'
      ? { ...rule.context }
      : {}
  };
}

function normalizePermissions(rules) {
  const list = Array.isArray(rules) ? rules : [rules];
  return list.map(normalizeRule).filter(Boolean);
}

function contextMatches(expected = {}, actual = {}) {
  return Object.entries(expected).every(([key, value]) => {
    if (Array.isArray(value)) {
      return value.map(String).includes(String(actual[key] ?? ''));
    }
    return String(value ?? '') === String(actual[key] ?? '');
  });
}

export function startTutorialState({ currentStepId = '', allowedActions = [] } = {}) {
  active = true;
  stepId = String(currentStepId || '');
  permissions = normalizePermissions(allowedActions);
}

export function setTutorialStepState({ currentStepId = '', allowedActions = [] } = {}) {
  if (!active) return;
  stepId = String(currentStepId || '');
  permissions = normalizePermissions(allowedActions);
}

export function clearTutorialState() {
  active = false;
  stepId = '';
  permissions = [];
}

export function isTutorialActive() {
  return active;
}

export function getTutorialStepId() {
  return stepId;
}

export function isTutorialActionAllowed(actionId, context = {}) {
  if (!active) return true;
  const id = String(actionId || '');
  if (!id) return false;
  return permissions.some((rule) =>
    rule.actionId === id && contextMatches(rule.context, context)
  );
}
