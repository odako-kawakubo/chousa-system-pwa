/**
 * チュートリアル専用の完了監視・3Recordスナップショットを管理する。
 * 通常のUndo/Redoや案件保存履歴とは分離し、操作可否はtutorial-state.jsへ分離する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { refreshOpenProjectSessionViews } from '../projects/project-session.js';

let active = false;
let completionCallback = null;
let unsubscribeStores = [];
let mutationObserver = null;
let scheduled = false;

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cloneSnapshot() {
  return deepClone({
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  });
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

function scheduleCompletionCheck() {
  if (!active || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    completionCallback?.();
  });
}

export function startTutorialRuntime({ checkCompletion } = {}) {
  stopTutorialRuntime();
  active = true;
  completionCallback = checkCompletion || null;

  ['input','change','click','focusout'].forEach((type) => {
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
    ['input','change','click','focusout'].forEach((type) => {
      document.removeEventListener(type, scheduleCompletionCheck, true);
    });
  }
  active = false;
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
