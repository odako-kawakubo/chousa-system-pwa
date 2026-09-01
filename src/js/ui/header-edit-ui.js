/**
 * ヘッダーの案件名／端末名を既存の正本へ接続する。
 * 案件名はproject-storeを更新し、Firestoreの案件メタ情報も同じ値へ更新する。
 * 設定タブの案件名入力も同じ経路へ流す。
 */
import { getCurrentProject, updateProjectFields } from '../projects/project-store.js';
import { persistProjectMetadataForProject } from '../sync/project-record-persistence.js';
import { getDeviceDisplayName, setDeviceName } from '../device-code.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';

let metadataTimer = null;

function scheduleProjectMetadataPersist(project) {
  if (!project?.projectId || project.isSample) return;
  if (metadataTimer) clearTimeout(metadataTimer);
  metadataTimer = setTimeout(() => {
    metadataTimer = null;
    persistProjectMetadataForProject(project).catch((error) => {
      console.warn('[v0.1.6.3B] 案件情報のFirestore反映に失敗', error);
    });
  }, 400);
}

function updateCurrentProjectName(rawValue) {
  const current = getCurrentProject();
  if (!current?.projectId || current.isSample) return false;
  const nextName = String(rawValue ?? '').trim();
  if (!nextName || nextName === current.projectName) return Boolean(nextName);

  const updated = updateProjectFields(current.projectId, { projectName: nextName });
  if (!updated) return false;

  const board = boardSettingsStore.get();
  const subjectWasFollowingProject = !String(board.subjectText || '').trim()
    || String(board.subjectText || '').trim() === String(current.projectName || '').trim();
  boardSettingsStore.set({
    projectName: nextName,
    ...(subjectWasFollowingProject ? { subjectText: nextName } : {})
  });

  scheduleProjectMetadataPersist(updated);
  return true;
}

function editHeaderProjectName() {
  const current = getCurrentProject();
  if (!current?.projectId || current.isSample) return;
  const entered = window.prompt('案件名を変更', current.projectName || '');
  if (entered === null) return;
  if (!String(entered).trim()) {
    window.alert('案件名を入力してください。');
    return;
  }
  updateCurrentProjectName(entered);
}

function editHeaderDeviceName() {
  const entered = window.prompt('端末名を変更', getDeviceDisplayName());
  if (entered === null) return;
  if (!setDeviceName(entered)) window.alert('端末名を入力してください。');
}

export function bindHeaderEditUi() {
  const projectTitle = document.getElementById('caseHeaderTitle');
  const devicePill = document.getElementById('devicePill');

  if (projectTitle && projectTitle.dataset.editBound !== '1') {
    projectTitle.dataset.editBound = '1';
    projectTitle.tabIndex = 0;
    projectTitle.title = 'クリックして案件名を変更';
    projectTitle.classList.add('header-editable-label');
    projectTitle.addEventListener('click', editHeaderProjectName);
    projectTitle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        editHeaderProjectName();
      }
    });
  }

  if (devicePill && devicePill.dataset.editBound !== '1') {
    devicePill.dataset.editBound = '1';
    devicePill.tabIndex = 0;
    devicePill.title = 'クリックして端末名を変更';
    devicePill.classList.add('header-editable-label');
    devicePill.addEventListener('click', editHeaderDeviceName);
    devicePill.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        editHeaderDeviceName();
      }
    });
  }

  // 設定タブの案件名変更もproject-storeへ流し、ヘッダーを同時に更新する。
  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-setting-project-field="projectName"]');
    if (!input) return;
    updateCurrentProjectName(input.value);
  });
}
