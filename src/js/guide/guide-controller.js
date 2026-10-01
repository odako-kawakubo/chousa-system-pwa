/**
 * src/js/guide/guide-controller.js
 *
 * チュートリアル／操作ガイドの進行を管理する。
 * 実案件へ練習操作を混ぜないため、チュートリアル開始時は専用ローカル案件へ切り替える。
 * v0.1.9.1初版では「実画面を開く・対象を強調する・前後移動」を基盤とし、
 * 各操作のStore状態による自動完了判定は次段階で追加できる構造に留める。
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

let activeSteps = null;
let activeIndex = 0;
let targetElement = null;
let initialized = false;
let tutorialMode = false;
let stepSnapshots = new Map();
let advancing = false;

function resolveAllowed(step) {
  try {
    if (typeof step?.allowed !== 'function') return [];
    const value = step.allowed();
    return (Array.isArray(value) ? value : [value]).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveTarget(step) {
  try {
    const allowed = resolveAllowed(step);
    if (step?.interactive && allowed.length) return allowed[0];
    return typeof step?.target === 'function' ? step.target() : null;
  } catch {
    return null;
  }
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

function waitForStepTarget(step, attempts = 0) {
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
  ensureStepSnapshot(activeIndex);
  if (step.tab) showTab(step.tab);

  targetElement = await waitForStepTarget(step);
  if (!activeSteps?.length || step !== activeSteps[activeIndex]) return;

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
    targetElement = resolveTarget(activeSteps?.[activeIndex]);
    positionGuideOverlay(targetElement);
  });

  if (stepIsComplete(step)) void completeInteractiveStep();
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
  advancing = false;
  closeDrawer();

  if (tutorialMode) {
    startTutorialRuntime({
      resolveAllowed: () => resolveAllowed(activeSteps?.[activeIndex]),
      checkCompletion: () => {
        refreshInteractiveTarget();
        void completeInteractiveStep();
      }
    });
  }

  void renderActiveStep();
}

export function closeGuide() {
  hideGuideOverlay();
  stopTutorialRuntime();
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
      targetElement = resolveTarget(activeSteps[activeIndex]);
      positionGuideOverlay(targetElement);
    });
  });
}
