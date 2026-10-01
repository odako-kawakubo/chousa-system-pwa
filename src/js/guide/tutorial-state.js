/**
 * src/js/guide/tutorial-state.js
 *
 * チュートリアル中の操作許可だけを管理する。
 * DOMイベントの捕捉・停止は行わない。各機能の正式なユーザー操作入口から
 * isTutorialActionAllowed() を呼び、現在stepで許可された操作だけを実行する。
 */

let active = false;
let stepId = '';
let permissionResolver = null;

function normalizeRule(rule) {
  if (typeof rule === 'string') return { actionId: rule, context: {} };
  if (!rule || typeof rule !== 'object') return null;
  return {
    actionId: String(rule.actionId || rule.id || ''),
    context: rule.context && typeof rule.context === 'object' ? rule.context : {}
  };
}

function contextMatches(expected = {}, actual = {}) {
  return Object.entries(expected).every(([key, value]) => {
    if (typeof value === 'function') {
      try { return Boolean(value(actual[key], actual)); } catch { return false; }
    }
    if (Array.isArray(value)) return value.map(String).includes(String(actual[key] ?? ''));
    return String(value ?? '') === String(actual[key] ?? '');
  });
}

function currentRules() {
  if (typeof permissionResolver !== 'function') return [];
  try {
    const value = permissionResolver();
    return (Array.isArray(value) ? value : [value]).map(normalizeRule).filter((rule) => rule?.actionId);
  } catch {
    return [];
  }
}

export function startTutorialState({ currentStepId = '', resolvePermissions = null } = {}) {
  active = true;
  stepId = String(currentStepId || '');
  permissionResolver = typeof resolvePermissions === 'function' ? resolvePermissions : null;
}

export function updateTutorialState({ currentStepId = stepId, resolvePermissions = permissionResolver } = {}) {
  if (!active) return;
  stepId = String(currentStepId || '');
  permissionResolver = typeof resolvePermissions === 'function' ? resolvePermissions : null;
}

export function clearTutorialState() {
  active = false;
  stepId = '';
  permissionResolver = null;
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
  return currentRules().some((rule) => rule.actionId === id && contextMatches(rule.context, context));
}
