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

let activeSteps = null;
let activeIndex = 0;
let targetElement = null;
let initialized = false;

function resolveTarget(step) {
  try {
    return typeof step?.target === 'function' ? step.target() : null;
  } catch {
    return null;
  }
}

function scrollTargetIntoView(target) {
  if (!target?.isConnected) return;
  const rect = target.getBoundingClientRect();
  const margin = 90;
  if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }
}

function renderActiveStep() {
  if (!activeSteps?.length) return;
  const step = activeSteps[activeIndex];
  if (step.tab) showTab(step.tab);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      targetElement = resolveTarget(step);
      scrollTargetIntoView(targetElement);
      showGuideOverlay({
        step,
        index: activeIndex,
        total: activeSteps.length,
        target: targetElement,
        onPrev: () => moveStep(-1),
        onNext: () => moveStep(1),
        onClose: closeGuide
      });
      watchGuideOverlayPosition(() => {
        targetElement = resolveTarget(activeSteps?.[activeIndex]);
        positionGuideOverlay(targetElement);
      });
    });
  });
}

function moveStep(delta) {
  if (!activeSteps?.length) return;
  const next = activeIndex + delta;
  if (next < 0) return;
  if (next >= activeSteps.length) {
    closeGuide();
    return;
  }
  activeIndex = next;
  renderActiveStep();
}

function startSteps(steps) {
  activeSteps = steps;
  activeIndex = 0;
  closeDrawer();
  renderActiveStep();
}

export function closeGuide() {
  hideGuideOverlay();
  activeSteps = null;
  activeIndex = 0;
  targetElement = null;
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
  startSteps(TUTORIAL_STEPS);
}

export function openOperationGuide() {
  closeGuideDrawer();
  startSteps(OPERATION_GUIDE_STEPS);
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
