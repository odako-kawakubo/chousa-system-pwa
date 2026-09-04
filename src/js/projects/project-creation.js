/**
 * 案件作成の共通入口。
 * UIやページ遷移は持たず、案件情報・初期仕上表・Firestoreメタデータ作成だけを担当する。
 */
import { createTemporaryProject, createFormalProjectFromOneDrive, temporaryDateCode } from './project-factory.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import { getProject, getProjectList, saveProjectSnapshot } from './project-store.js';
import { getRemoteTemporaryProjectNos, persistProjectMetadataForProject } from '../sync/project-record-persistence.js';

export async function createTemporaryProjectSnapshot({ projectName, address }) {
  const dateCode = temporaryDateCode();
  let remoteProjectNos = [];
  try {
    remoteProjectNos = await getRemoteTemporaryProjectNos(dateCode, 'production');
  } catch (error) {
    console.warn('[v0.1.6.5F] Firestore仮番号確認失敗。端末内番号だけで採番します。', error);
  }

  const project = createTemporaryProject({
    projectName,
    address,
    existingProjects: getProjectList(),
    existingProjectNos: remoteProjectNos
  });
  const finishRecords = createDefaultFinishRecords();
  const snapshot = saveProjectSnapshot({
    project,
    finishRecords,
    materialRecords: [],
    photoRecords: [],
    source: 'temporary-project-create'
  });
  await persistProjectMetadataForProject(project, { initializeChangeLog: true });
  return snapshot || getProject(project.projectId);
}

export async function createFormalProjectFromOneDriveSnapshot({ projectNo, projectName, address = '' }) {
  const project = createFormalProjectFromOneDrive({ projectNo, projectName, address });
  const existing = getProject(project.projectId);

  if (existing?.project) {
    // 前回のFirestore作成だけ失敗して端末Snapshotが残った場合も、再選択で正式作成を再試行する。
    await persistProjectMetadataForProject(existing.project, { initializeChangeLog: true });
    return existing;
  }

  const finishRecords = createDefaultFinishRecords();
  const snapshot = saveProjectSnapshot({
    project,
    finishRecords,
    materialRecords: [],
    photoRecords: [],
    source: 'onedrive-formal-project-create'
  });
  await persistProjectMetadataForProject(project, { initializeChangeLog: true });
  return snapshot || getProject(project.projectId);
}
