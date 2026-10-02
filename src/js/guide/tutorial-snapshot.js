/**
 * src/js/guide/tutorial-snapshot.js
 *
 * チュートリアルの「戻る」ためにRecord状態と各画面UI状態をまとめて保存・復元する。
 * 各画面固有のUI stateは各担当moduleの公開入口を通して扱う。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { refreshOpenProjectSessionViews } from '../projects/project-session.js';
import {
  captureFinishUiState,
  restoreFinishUiState
} from '../finish-table/finish-table-state.js';
import {
  captureMaterialListUiState,
  restoreMaterialListUiState
} from '../materials/material-list-controller.js';
import {
  capturePhotoUiState,
  restorePhotoUiState
} from '../photos/photo-controller.js';
import {
  captureOutputUiState,
  restoreOutputUiState
} from '../output/output-controller.js';

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function captureTutorialSnapshot() {
  return deepClone({
    records: {
      finish: finishRecordStore.exportSnapshot(),
      material: materialRecordStore.exportSnapshot(),
      photo: photoRecordStore.exportSnapshot()
    },
    ui: {
      finish: captureFinishUiState(),
      material: captureMaterialListUiState(),
      photo: capturePhotoUiState(),
      output: captureOutputUiState()
    }
  });
}

export function restoreTutorialSnapshot(snapshot) {
  if (!snapshot) return;

  const records = snapshot.records || {};
  finishRecordStore.replaceAll(records.finish || [], { notify:false });
  materialRecordStore.replaceAll(records.material || [], { notify:false });
  photoRecordStore.replaceAll(records.photo || [], { notify:false });

  restoreFinishUiState(snapshot.ui?.finish, { notifyNow:false });
  restoreMaterialListUiState(snapshot.ui?.material, { renderNow:false });
  restorePhotoUiState(snapshot.ui?.photo, { renderNow:false });
  restoreOutputUiState(snapshot.ui?.output, { renderNow:false });

  refreshOpenProjectSessionViews();
}
