/**
 * チュートリアル専用の進行状態・操作ロック・3Recordスナップショットを管理する。
 * 通常のUndo/Redoや案件保存履歴とは分離し、練習案件内だけで使用する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { refreshOpenProjectSessionViews } from '../projects/project-session.js';

let active = false;
let allowedResolver = null;
let completionCallback = null;
let unsubscribeStores = [];
let mutationObserver = null;
let scheduled = false;

function cloneSnapshot() {
  return {
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  };
}

export function captureTutorialSnapshot() {
  return cloneSnapshot();
}

export function restoreTutorialSnapshot(snapshot) {
  if (!snapshot) return;
  finishRecordStore.replaceAll(snapshot.finishRecords || [], { notify:false });
  materialRecordStore.replaceAll(snapshot.materialRecords || [], { notify:false });
  photoRecordStore.replaceAll(snapshot.photoRecords || [], { notify:false });
  refreshOpenProjectSessionViews();
}

function currentAllowedElements() {
  const resolved = typeof allowedResolver === 'function' ? allowedResolver() : [];
  return (Array.isArray(resolved) ? resolved : [resolved]).filter((node) => node?.isConnected);
}

function cameraOpen() {
  return Boolean(document.body.classList.contains('camera-open'));
}

function allowedByTutorial(target) {
  if (!active) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest('.guide-card')) return true;
  if (cameraOpen() && target.closest('.camera-overlay')) return true;

  const allowed = currentAllowedElements();
  if (allowed.some((node) => node === target || node.contains(target) || target.contains(node))) return true;

  // 仕上表候補popupは現在の入力欄に付随する一時UIなので、入力操作ステップ中だけ許可する。
  if (allowed.some((node) => node.matches?.('[data-kind="name"],[data-kind="part"]'))
      && target.closest('.finish-candidate-popup')) return true;

  return false;
}

function blockOutsideTutorialTarget(event) {
  if (!active || allowedByTutorial(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function scheduleCompletionCheck() {
  if (!active || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    completionCallback?.();
  });
}

export function startTutorialRuntime({ resolveAllowed, checkCompletion } = {}) {
  stopTutorialRuntime();
  active = true;
  allowedResolver = resolveAllowed || null;
  completionCallback = checkCompletion || null;

  ['pointerdown','click','focusin','keydown'].forEach((type) => {
    document.addEventListener(type, blockOutsideTutorialTarget, true);
  });
  ['input','change','click'].forEach((type) => {
    document.addEventListener(type, scheduleCompletionCheck, true);
  });

  unsubscribeStores = [
    finishRecordStore.subscribe(scheduleCompletionCheck),
    materialRecordStore.subscribe(scheduleCompletionCheck),
    photoRecordStore.subscribe(scheduleCompletionCheck)
  ];

  mutationObserver = new MutationObserver(scheduleCompletionCheck);
  mutationObserver.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','hidden'] });
}

export function stopTutorialRuntime() {
  if (active) {
    ['pointerdown','click','focusin','keydown'].forEach((type) => {
      document.removeEventListener(type, blockOutsideTutorialTarget, true);
    });
    ['input','change','click'].forEach((type) => {
      document.removeEventListener(type, scheduleCompletionCheck, true);
    });
  }
  active = false;
  allowedResolver = null;
  completionCallback = null;
  unsubscribeStores.forEach((unsubscribe) => unsubscribe?.());
  unsubscribeStores = [];
  mutationObserver?.disconnect();
  mutationObserver = null;
  scheduled = false;
}

export function isTutorialRuntimeActive() {
  return active;
}
