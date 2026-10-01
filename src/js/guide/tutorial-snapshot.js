/**
 * src/js/guide/tutorial-snapshot.js
 *
 * チュートリアルの「戻る」ための3Recordスナップショットだけを担当する。
 * 操作許可・進行監視・DOM監視は持たない。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { refreshOpenProjectSessionViews } from '../projects/project-session.js';

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function captureTutorialSnapshot() {
  return deepClone({
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  });
}

export function restoreTutorialSnapshot(snapshot) {
  if (!snapshot) return;

  finishRecordStore.replaceAll(snapshot.finishRecords || [], { notify:false });
  materialRecordStore.replaceAll(snapshot.materialRecords || [], { notify:false });
  photoRecordStore.replaceAll(snapshot.photoRecords || [], { notify:false });
  refreshOpenProjectSessionViews();
}
