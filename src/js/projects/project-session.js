/**
 * src/js/projects/project-session.js
 * 案件を開く／閉じる共通入口。Firestore／OneDriveの取得処理は持たない。
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

export function saveCurrentProjectSession() {
  const project = getCurrentProject();
  if (!project?.projectId) return null;
  return saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot(),
    source: 'current-project-session'
  });
}

function refreshDerivedFinishInputIds() {
  const materials = new Map(
    materialRecordStore.exportSnapshot().map((record) => [String(record.materialId || ''), record])
  );
  const current = finishRecordStore.exportSnapshot();
  let changed = false;
  const next = current.map((record) => {
    const material = materials.get(String(record.materialId || ''));
    const inputId = material ? String(material.inputId ?? '') : '';
    if (String(record.inputId ?? '') === inputId) return record;
    changed = true;
    return { ...record, inputId };
  });
  if (changed) finishRecordStore.replaceAll(next, { notify: false });
}

export function refreshOpenProjectSessionViews() {
  refreshDerivedFinishInputIds();
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
  if (header) header.textContent = formatProjectLabel(project);
  return project;
}

export function closeProjectSession() {
  saveCurrentProjectSession();
  setCurrentProject(null);
  const header = document.getElementById('caseHeaderTitle');
  if (header) header.textContent = '案件未選択';
}
