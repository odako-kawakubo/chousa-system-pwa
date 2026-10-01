/**
 * src/js/guide/guide-controller.js
 *
 * チュートリアル／操作ガイドの進行だけを管理する。
 *
 * 基本チュートリアル:
 * - 操作可否は tutorial-state.js
 * - 戻る用3Recordは tutorial-snapshot.js
 * - interactive stepの完了確認は Record Store の変更通知
 * - 表示は guide-overlay.js
 *
 * documentイベント監視・DOM MutationObserver・イベント遮断は行わない。
 */
import { showTab } from '../ui/tabs.js';
import { closeDrawer, closeGuideDrawer } from '../ui/drawer.js';
import { openProjectById } from '../projects/project-controller.js';
import { openProjectSession } from '../projects/project-session.js';
import { getCurrentProject } from '../projects/project-store.js';
import { setOpenProjectId } from '../projects/project-navigation.js';
import { setSimpleListOpen } from '../finish-table/finish-table-state.js';
import * as finishRecordStore from '../store/finish-record-store.js';
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
  showGuideOverlay
} from './guide-overlay.js';
import {
  captureTutorialSnapshot,
  restoreTutorialSnapshot
} from './tutorial-snapshot.js';
import {
  clearTutorialState,
  startTutorialState,
  setTutorialStepState
} from './tutorial-state.js';

let activeSteps = null;
let activeIndex = 0;
let targetElement = null;
let initialized = false;
let tutorialMode = false;
let stepSnapshots = new Map();
let unsubscribeStepStore = null;
let stepCheckScheduled = false;
let advancing = false;

function currentStep() {
  return activeSteps?.[activeIndex] || null;
}

function resolveTarget(step) {
  try {
    return typeof step?.target === 'function' ? step.target() : null;
  } catch {
    return null;
  }
}

function stepContext(index = activeIndex) {
  return {
    snapshot: stepSnapshots.get(index) || null,
    index
  };
}

function resolvePermissions(step) {
  try {
    if (typeof step?.permissions === 'function') {
      const value = step.permissions(stepContext());
      return (Array.isArray(value) ? value : [value]).filter(Boolean);
    }
    return Array.isArray(step?.permissions) ? step.permissions.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function syncTutorialStepState(step) {
  if (!tutorialMode) return;
  setTutorialStepState({
    currentStepId: step?.id || '',
    allowedActions: resolvePermissions(step)
  });
}

function ensureStepSnapshot(index) {
  if (!tutorialMode || stepSnapshots.has(index)) return;
  stepSnapshots.set(index, captureTutorialSnapshot());
}

function stepIsComplete(step) {
  if (!tutorialMode || !step?.interactive || typeof step.completeWhen !== 'function') return false;
  try {
    return Boolean(step.completeWhen(stepContext()));
  } catch {
    return false;
  }
}

function stopStepStoreWatch() {
  unsubscribeStepStore?.();
  unsubscribeStepStore = null;
  stepCheckScheduled = false;
}

function refreshCurrentTarget() {
  const step = currentStep();
  if (!step) return;
  targetElement = resolveTarget(step);
  positionGuideOverlay(targetElement);
}

function scheduleCurrentStepCheck(expectedStepId) {
  if (stepCheckScheduled) return;
  stepCheckScheduled = true;

  queueMicrotask(() => {
    stepCheckScheduled = false;

    const step = currentStep();
    if (!tutorialMode || !step || step.id !== expectedStepId) return;

    // Store変更後の正式UI再描画が終わった状態で、
    // 動的permissionとtargetを現在Recordから再解決する。
    syncTutorialStepState(step);

    if (stepIsComplete(step)) {
      void advanceFromCompletedStep(step);
      return;
    }

    refreshCurrentTarget();
  });
}

function startStepStoreWatch(step) {
  stopStepStoreWatch();
  if (!tutorialMode || !step?.interactive) return;

  const expectedStepId = step.id;
  unsubscribeStepStore = finishRecordStore.subscribe(() => {
    const activeStep = currentStep();
    if (tutorialMode && activeStep?.id === expectedStepId) {
      // Record値だけで解決できるpermissionは同期的に更新する。
      // focusout直後の同一クリックでも、次に許可された入力へそのまま進める。
      syncTutorialStepState(activeStep);
    }
    scheduleCurrentStepCheck(expectedStepId);
  });
}

function stepNeedsTarget(step) {
  return Boolean(step?.interactive || typeof step?.target === 'function');
}

function waitForStepTarget(step, attempts = 0) {
  if (!stepNeedsTarget(step)) return Promise.resolve(null);

  const target = resolveTarget(step);
  if (target?.isConnected || attempts >= 60) return Promise.resolve(target || null);

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve(waitForStepTarget(step, attempts + 1));
    });
  });
}

function scrollTargetIntoView(target) {
  if (!target?.isConnected) return;

  const rect = target.getBoundingClientRect();
  const margin = 90;
  if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
    target.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth'
    });
  }
}

async function renderActiveStep() {
  stopStepStoreWatch();

  const step = currentStep();
  if (!step) return;

  try {
    ensureStepSnapshot(activeIndex);

    if (step.tab) showTab(step.tab);
    syncTutorialStepState(step);

    targetElement = await waitForStepTarget(step);
    if (step !== currentStep()) return;

    if (tutorialMode && step.interactive && !targetElement?.isConnected) {
      setTutorialStepState({
        currentStepId: step.id,
        allowedActions: []
      });
      showGuideOverlay({
        step: {
          ...step,
          text: `${step.text || ''}\n\n操作対象を表示できませんでした。前の手順へ戻るか、チュートリアルを閉じてください。`
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

    startStepStoreWatch(step);

    if (stepIsComplete(step)) {
      await advanceFromCompletedStep(step);
    }
  } catch (error) {
    console.error('[guide] failed to render step', error);
    closeGuide();
  }
}

async function advanceFromCompletedStep(step) {
  if (advancing || step !== currentStep() || !stepIsComplete(step)) return;

  advancing = true;
  try {
    stopStepStoreWatch();
    const nextIndex = activeIndex + 1;
    if (nextIndex >= activeSteps.length) {
      closeGuide();
      return;
    }

    activeIndex = nextIndex;
    await renderActiveStep();
  } finally {
    advancing = false;
  }
}

function moveStep(delta) {
  if (!activeSteps?.length || advancing) return;

  const nextIndex = activeIndex + delta;
  if (nextIndex < 0) return;

  if (nextIndex >= activeSteps.length) {
    closeGuide();
    return;
  }

  stopStepStoreWatch();

  if (tutorialMode && delta < 0) {
    const snapshot = stepSnapshots.get(nextIndex);
    if (snapshot) restoreTutorialSnapshot(snapshot);

    [...stepSnapshots.keys()].forEach((index) => {
      if (index > nextIndex) stepSnapshots.delete(index);
    });
  }

  activeIndex = nextIndex;
  void renderActiveStep();
}

function startSteps(steps, { tutorial = false } = {}) {
  stopStepStoreWatch();

  activeSteps = steps;
  activeIndex = 0;
  tutorialMode = tutorial;
  stepSnapshots = new Map();
  advancing = false;
  closeDrawer();

  if (tutorialMode) {
    startTutorialState({
      currentStepId: steps?.[0]?.id || '',
      allowedActions: []
    });
  } else {
    clearTutorialState();
  }

  void renderActiveStep();
}

export function closeGuide() {
  stopStepStoreWatch();
  hideGuideOverlay();
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
    requestAnimationFrame(refreshCurrentTarget);
  });
}
