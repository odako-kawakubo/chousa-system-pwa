/**
 * 案件作成の共通入口。
 * UIやページ遷移は持たず、案件情報・初期仕上表・Firestoreメタデータ作成だけを担当する。
 */
import { createTemporaryProject, createFormalProjectFromOneDrive, temporaryDateCode } from './project-factory.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import { getProject, getProjectList, saveProjectSnapshot } from './project-store.js';
import { getRemoteTemporaryProjectNos, persistProjectMetadataForProject, readProjectMetadataForProject } from '../sync/project-record-persistence.js';
import { getDeviceCode } from '../device-code.js';

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
    existingProjectNos: remoteProjectNos,
    deviceCode: getDeviceCode()
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
    // 端末内SnapshotがあるだけではFirestore未作成と断定できない。
    // 既存のリモート案件へ古い全項目を送信すると棟情報を上書きしかねない。
    const remote = await readProjectMetadataForProject(existing.project);
    if (!remote) await persistProjectMetadataForProject(existing.project, { initializeChangeLog: true });
    return existing;
  }

  // OneDrive案件の選択から作成までに、他端末が同じ案件を作成した可能性がある。
  const existingRemote = await readProjectMetadataForProject(project);
  if (existingRemote) {
    return saveProjectSnapshot({
      project: { ...project, ...existingRemote },
      finishRecords: createDefaultFinishRecords(),
      materialRecords: [],
      photoRecords: [],
      source: 'onedrive-remote-project-already-exists'
    });
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
