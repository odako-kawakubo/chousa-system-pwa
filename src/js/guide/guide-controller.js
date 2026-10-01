/**
 * src/js/guide/guide-controller.js
 *
 * チュートリアル／操作ガイドの進行を管理する。
 * 実案件へ練習操作を混ぜないため、チュートリアル開始時は専用ローカル案件へ切り替える。
 * v0.1.9.7では操作制限をDOMイベント遮断からアプリ側の操作許可判定へ移行する。
 * 戻る操作では各ステップ開始時の3Recordスナップショットへ復元する。
 */
import { showTab } from '../ui/tabs.js';
import { closeDrawer, closeGuideDrawer } from '../ui/drawer.js';
import { openProjectById } from '../projects/project-controller.js';
import { openProjectSession } from '../projects/project-session.js';
import { getCurrentProject } from '../projects/project-store.js';
import { setOpenProjectId } from '../projects/project-navigation.js';
import { setSimpleListOpen } from '../finish-table/finish-table-state.js';
import {
  TUTORIAL_PROJECT_ID,
  initializeTutorialProjectSnapshot,
  resetTutorialProjectSnapshot,
  consumeTutorialAutoStart
} from './tutorial-project.js';
import { TUTORIAL_STEPS, OPERATION_GUIDE_STEPS } from './guide-data.js';
import {
  hideGuideOverlay,
  initializeGuideOverlayPositionEvents,
  positionGuideOverlay,
  showGuideOverlay,
  watchGuideOverlayPosition
} from './guide-overlay.js';
import {
  captureTutorialSnapshot,
  restoreTutorialSnapshot,
  startTutorialRuntime,
  stopTutorialRuntime
} from './tutorial-runtime.js';
import {
  clearTutorialState,
  startTutorialState,
  updateTutorialState
} from './tutorial-state.js';

let activeSteps = null;
let activeIndex = 0;
let targetElement = null;
let initialized = false;
let tutorialMode = false;
let stepSnapshots = new Map();
let advancing = false;

function resolveTarget(step) {
  try {
    return typeof step?.target === 'function' ? step.target() : null;
  } catch {
    return null;
  }
}

function resolvePermissions(step) {
  try {
    if (typeof step?.permissions === 'function') {
      const value = step.permissions(stepContext());
      return Array.isArray(value) ? value : [value];
    }
    if (Array.isArray(step?.permissions)) return step.permissions;
    return [];
  } catch {
    return [];
  }
}

function syncTutorialState(step) {
  if (!tutorialMode) return;
  updateTutorialState({
    currentStepId: step?.id || '',
    resolvePermissions: () => resolvePermissions(activeSteps?.[activeIndex])
  });
}

function ensureStepSnapshot(index) {
  if (!tutorialMode || stepSnapshots.has(index)) return;
  stepSnapshots.set(index, captureTutorialSnapshot());
}

function stepContext(index = activeIndex) {
  return { snapshot: stepSnapshots.get(index) || null, index };
}

function stepIsComplete(step) {
  if (!tutorialMode || !step?.interactive || typeof step.completeWhen !== 'function') return false;
  try {
    return Boolean(step.completeWhen(stepContext()));
  } catch {
    return false;
  }
}

function stepNeedsTarget(step) {
  return Boolean(step?.interactive || typeof step?.target === 'function');
}

function waitForStepTarget(step, attempts = 0) {
  if (!stepNeedsTarget(step)) return Promise.resolve(null);
  const target = resolveTarget(step);
  if (target?.isConnected || attempts >= 60) return Promise.resolve(target || null);
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(waitForStepTarget(step, attempts + 1)));
  });
}

function scrollTargetIntoView(target) {
  if (!target?.isConnected) return;
  const rect = target.getBoundingClientRect();
  const margin = 90;
  if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }
}

async function renderActiveStep() {
  if (!activeSteps?.length) return;
  const step = activeSteps[activeIndex];

  // 前stepの完了監視だけを解除し、現在stepの操作許可へ切り替える。
  stopTutorialRuntime();
  syncTutorialState(step);

  try {
    ensureStepSnapshot(activeIndex);
    if (step.tab) showTab(step.tab);

    targetElement = await waitForStepTarget(step);
    if (!activeSteps?.length || step !== activeSteps[activeIndex]) return;

    if (tutorialMode && step.interactive && !targetElement?.isConnected) {
      // 操作対象を取得できない場合もガイドカードは残し、
      // 閉じる／戻る／次へで脱出できる状態を保つ。
      showGuideOverlay({
        step: {
          ...step,
          text: `${step.text || ''}\n\n操作対象を表示できませんでした。画面を閉じるか、前の手順へ戻ってください。`
        },
        index: activeIndex,
        total: activeSteps.length,
        target: null,
        interactive: false,
        onPrev: () => moveStep(-1),
        onNext: () => moveStep(1),
        onClose: closeGuide
      });
      return;
    }

    scrollTargetIntoView(targetElement);
    showGuideOverlay({
      step,
      index: activeIndex,
      total: activeSteps.length,
      target: targetElement,
      interactive: Boolean(tutorialMode && step.interactive),
      onPrev: () => moveStep(-1),
      onNext: () => moveStep(1),
      onClose: closeGuide
    });
    watchGuideOverlayPosition(() => {
      const activeStep = activeSteps?.[activeIndex];
      targetElement = resolveTarget(activeStep);
      positionGuideOverlay(targetElement);
    });

    if (tutorialMode && step.interactive) {
      startTutorialRuntime({
        checkCompletion: () => {
          refreshInteractiveTarget();
          void completeInteractiveStep();
        }
      });
    }

    if (stepIsComplete(step)) void completeInteractiveStep();
  } catch (error) {
    console.error('[guide] failed to render tutorial step', error);
    closeGuide();
  }
}

function refreshInteractiveTarget() {
  if (!activeSteps?.length) return;
  const step = activeSteps[activeIndex];
  targetElement = resolveTarget(step);
  scrollTargetIntoView(targetElement);
  positionGuideOverlay(targetElement);
}

async function completeInteractiveStep() {
  if (advancing || !activeSteps?.length) return;
  const step = activeSteps[activeIndex];
  if (!stepIsComplete(step)) {
    refreshInteractiveTarget();
    return;
  }

  advancing = true;
  try {
    const next = activeIndex + 1;
    if (next >= activeSteps.length) {
      closeGuide();
      return;
    }
    activeIndex = next;
    await renderActiveStep();
  } finally {
    advancing = false;
  }
}

function moveStep(delta) {
  if (!activeSteps?.length) return;
  const next = activeIndex + delta;
  if (next < 0) return;
  if (next >= activeSteps.length) {
    closeGuide();
    return;
  }

  if (tutorialMode && delta < 0) {
    const snapshot = stepSnapshots.get(next);
    if (snapshot) restoreTutorialSnapshot(snapshot);
    [...stepSnapshots.keys()].forEach((index) => {
      if (index > next) stepSnapshots.delete(index);
    });
  }

  activeIndex = next;
  void renderActiveStep();
}

function startSteps(steps, { tutorial = false } = {}) {
  stopTutorialRuntime();
  activeSteps = steps;
  activeIndex = 0;
  tutorialMode = tutorial;
  stepSnapshots = new Map();
  if (tutorialMode) {
    startTutorialState({
      currentStepId: steps?.[0]?.id || '',
      resolvePermissions: () => resolvePermissions(activeSteps?.[activeIndex])
    });
  } else {
    clearTutorialState();
  }
  advancing = false;
  closeDrawer();

  void renderActiveStep();
}

export function closeGuide() {
  hideGuideOverlay();
  stopTutorialRuntime();
  clearTutorialState();
  activeSteps = null;
  activeIndex = 0;
  targetElement = null;
  tutorialMode = false;
  stepSnapshots = new Map();
  advancing = false;
}

export async function startBasicTutorial() {
  closeGuide();
  closeGuideDrawer();
  closeDrawer();

  const snapshot = resetTutorialProjectSnapshot();
  setOpenProjectId(TUTORIAL_PROJECT_ID);

  if (getCurrentProject()?.projectId === TUTORIAL_PROJECT_ID) {
    openProjectSession(snapshot);
  } else {
    await openProjectById(TUTORIAL_PROJECT_ID);
  }

  // 基本チュートリアルでは簡易リストをノイズにしない。
  // 通常案件の既定値は変えず、練習開始時だけ閉じる。
  setSimpleListOpen(false);
  showTab('finish');
  startSteps(TUTORIAL_STEPS, { tutorial:true });
}

export function openOperationGuide() {
  closeGuideDrawer();
  startSteps(OPERATION_GUIDE_STEPS, { tutorial:false });
}

export async function startRequestedTutorialIfNeeded() {
  if (!consumeTutorialAutoStart()) return false;
  await startBasicTutorial();
  return true;
}

export function initializeGuide() {
  if (initialized) return;
  initialized = true;
  initializeTutorialProjectSnapshot();
  initializeGuideOverlayPositionEvents();

  document.getElementById('startBasicTutorialButton')?.addEventListener('click', () => {
    void startBasicTutorial();
  });
  document.getElementById('openOperationGuideButton')?.addEventListener('click', openOperationGuide);

  window.addEventListener('chousa:tab-change', () => {
    if (!activeSteps?.length) return;
    requestAnimationFrame(() => {
      const step = activeSteps[activeIndex];
      targetElement = resolveTarget(step);
      positionGuideOverlay(targetElement);
    });
  });
}
