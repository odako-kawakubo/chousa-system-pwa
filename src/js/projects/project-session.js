/**
 * src/js/projects/project-session.js
 *
 * 案件を開くときの共通入口。
 * 案件情報と3つの正式Storeを同じタイミングで切り替え、各画面を再描画する。
 * Firestore／OneDriveの取得処理はここに持たず、取得済みデータを受け取るだけにする。
 */

import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { getCurrentProject, saveProjectSnapshot, setCurrentProject, formatProjectLabel } from './project-store.js';
import { setProject } from '../finish-table/finish-table-state.js';
import { refreshFinishTableFromStores, resetFinishTableForProject } from '../finish-table/finish-table-controller.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
import { refreshMaterialOperations } from '../materials/material-operations-controller.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';
import { refreshPhotoTab } from '../photos/photo-controller.js';
import { refreshSettingsTab } from '../settings/settings-controller.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';

/** 現在開いている案件の3レコードを案件一覧Storeへ退避する。 */
export function saveCurrentProjectSession() {
  const project = getCurrentProject();
  if (!project?.projectId) return null;
  return saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  });
}

export function refreshOpenProjectSessionViews() {
  refreshFinishTableFromStores();
  refreshMaterialList();
  refreshMaterialOperations();
  refreshRecordView();
  refreshPhotoTab();
  refreshSettingsTab();
}

export function openProjectSession({ project, finishRecords = [], materialRecords = [], photoRecords = [] }) {
  if (!project?.projectId) throw new Error('案件情報が正しくありません。');

  finishRecordStore.replaceAll(finishRecords, { notify: false });
  materialRecordStore.replaceAll(materialRecords, { notify: false });
  photoRecordStore.replaceAll(photoRecords, { notify: false });

  setCurrentProject(project);
  boardSettingsStore.activateProject(project);
  setProject(project);

  resetFinishTableForProject();
  refreshOpenProjectSessionViews();

  const header = document.getElementById('caseHeaderTitle');
  if (header) {
    header.textContent = formatProjectLabel(project);
  }

  return project;
}
