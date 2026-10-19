/**
 * 案件作成の共通入口。
 * UIやページ遷移は持たず、案件情報・初期仕上表・Firestoreメタデータ作成だけを担当する。
 */
import { createTemporaryProject, createFormalProjectFromOneDrive, temporaryDateCode } from './project-factory.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import { getProject, getProjectList, saveProjectSnapshot } from './project-store.js';
import { getRemoteTemporaryProjectNos, persistProjectMetadataForProject, persistDrawingForProject } from '../sync/project-record-persistence.js';
import { getDeviceCode } from '../device-code.js';
import { createDrawingRecord } from '../records/drawing-record.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';

function createInitialSurveyMap(project){
  const now=Date.now();
  return createDrawingRecord({
    drawingId:globalThis.crypto?.randomUUID?`D-${crypto.randomUUID()}`:
      `D-${now}-${Math.random().toString(36).slice(2,8)}`,
    projectId:project.projectId,
    name:'調査図1',order:1,
    titleSettings:{text:'調査図'},
    nameSettings:{text:project.projectName||'調査図1'},
    legendSettings:{visible:true,items:[]},
    createdAt:new Date(now).toISOString(),
    fieldEditedAt:touchFieldEditedAt({},[
      'name','order','deleted','titleSettings','nameSettings','legendSettings'
    ],now)
  });
}

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
  const drawingRecord = createInitialSurveyMap(project);
  const snapshot = saveProjectSnapshot({
    project,
    finishRecords,
    materialRecords: [],
    photoRecords: [],
    drawingRecords: [drawingRecord],
    drawingObjects: [],
    source: 'temporary-project-create'
  });
  await persistProjectMetadataForProject(project, { initializeChangeLog: true });
  try {
    await persistDrawingForProject(project,drawingRecord,'initial-survey-map-create');
  } catch (error) {
    console.warn('初期調査図の同期を保留しました。',error);
  }
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
  const drawingRecord = createInitialSurveyMap(project);
  const snapshot = saveProjectSnapshot({
    project,
    finishRecords,
    materialRecords: [],
    photoRecords: [],
    drawingRecords: [drawingRecord],
    drawingObjects: [],
    source: 'onedrive-formal-project-create'
  });
  await persistProjectMetadataForProject(project, { initializeChangeLog: true });
  try {
    await persistDrawingForProject(project,drawingRecord,'initial-survey-map-create');
  } catch (error) {
    console.warn('初期調査図の同期を保留しました。',error);
  }
  return snapshot || getProject(project.projectId);
}
