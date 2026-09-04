/**
 * src/js/projects/project-store.js
 *
 * 端末内の案件一覧と、案件ごとの3レコードSnapshot・同期メタ情報を保持する。
 * Firestoreを正本としつつ、案件切替・圏外継続・再起動後の復元に必要な
 * 端末内SnapshotをlocalStorageへ保存する。
 */

import { sampleProject, formatSampleProjectName } from '../demo/sample-project.js';
import { syncDiagnosticLog } from '../debug/sync-diagnostic-log.js';

const LOCAL_PROJECTS_KEY = 'chousa-local-projects-v0161b';

let currentProject = null;
let projects = new Map();
const listeners = [];

function cloneRecords(records = []) {
  return records.map((record) => ({
    ...record,
    fieldEditedAt: { ...(record.fieldEditedAt || {}) },
    samplePart: Array.isArray(record.samplePart) ? [...record.samplePart] : record.samplePart
  }));
}

function cloneEntry(entry) {
  if (!entry) return null;
  return {
    project: { ...entry.project },
    finishRecords: cloneRecords(entry.finishRecords),
    materialRecords: cloneRecords(entry.materialRecords),
    photoRecords: cloneRecords(entry.photoRecords),
    syncMeta: { ...(entry.syncMeta || {}) }
  };
}

function loadLocalProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_PROJECTS_KEY) || '[]');
    if (!Array.isArray(saved)) return;
    saved.forEach((entry) => {
      if (!entry?.project?.projectId || entry.project.isSample) return;
      projects.set(entry.project.projectId, cloneEntry(entry));
    });
  } catch (error) {
    syncDiagnosticLog('LOCAL_SNAPSHOT_LOAD_ERROR', { message: error?.message || String(error) });
  }
}

function persistLocalProjects(source = 'unspecified') {
  try {
    const payload = Array.from(projects.values())
      .filter((entry) => !entry.project?.isSample)
      .map(cloneEntry);
    localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(payload));
    syncDiagnosticLog('LOCAL_SNAPSHOT_PERSIST_OK', {
      source,
      projects: payload.map((entry) => ({
        projectId: entry.project?.projectId || '',
        finishCount: entry.finishRecords?.length || 0,
        materialCount: entry.materialRecords?.length || 0,
        photoCount: entry.photoRecords?.length || 0
      }))
    });
    return true;
  } catch (error) {
    syncDiagnosticLog('LOCAL_SNAPSHOT_PERSIST_ERROR', { source, message: error?.message || String(error) });
    return false;
  }
}

function notify() {
  listeners.slice().forEach((callback) => callback(getCurrentProject(), getProjectList()));
}

loadLocalProjects();
projects.set(sampleProject.projectId, {
  project: { ...sampleProject },
  finishRecords: [],
  materialRecords: [],
  photoRecords: [],
  syncMeta: {}
});

export function getCurrentProject() {
  return currentProject ? { ...currentProject } : null;
}

export function setCurrentProject(project) {
  currentProject = project ? { ...project } : null;
  notify();
  return getCurrentProject();
}

export function getProject(projectId) {
  return cloneEntry(projects.get(String(projectId || '')));
}

export function getProjectList() {
  const entries = Array.from(projects.values()).map((entry) => ({ ...entry.project }));
  return entries.sort((a, b) => {
    if (a.isSample && !b.isSample) return -1;
    if (!a.isSample && b.isSample) return 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

export function saveProjectSnapshot({
  project,
  finishRecords = [],
  materialRecords = [],
  photoRecords = [],
  syncMeta = null,
  source = 'unspecified'
}) {
  if (!project?.projectId) return null;
  const previous = projects.get(project.projectId);
  syncDiagnosticLog('LOCAL_SNAPSHOT_BEFORE_SAVE', {
    source,
    projectId: project.projectId,
    previousFinishCount: previous?.finishRecords?.length || 0,
    previousMaterialCount: previous?.materialRecords?.length || 0,
    previousPhotoCount: previous?.photoRecords?.length || 0,
    nextFinishCount: finishRecords.length,
    nextMaterialCount: materialRecords.length,
    nextPhotoCount: photoRecords.length,
    nextMaterialIds: materialRecords.map((record) => String(record?.materialId || '')).filter(Boolean)
  });

  projects.set(project.projectId, {
    project: { ...project },
    finishRecords: cloneRecords(finishRecords),
    materialRecords: cloneRecords(materialRecords),
    photoRecords: cloneRecords(photoRecords),
    syncMeta: { ...(previous?.syncMeta || {}), ...(syncMeta || {}) }
  });
  const persisted = project.isSample ? true : persistLocalProjects(source);
  syncDiagnosticLog('LOCAL_SNAPSHOT_AFTER_SAVE', {
    source,
    projectId: project.projectId,
    persisted,
    finishCount: finishRecords.length,
    materialCount: materialRecords.length,
    photoCount: photoRecords.length,
    materialIds: materialRecords.map((record) => String(record?.materialId || '')).filter(Boolean)
  });
  notify();
  return getProject(project.projectId);
}

export function updateProjectFields(projectId, patch = {}) {
  const id = String(projectId || '');
  const entry = projects.get(id);
  if (!entry?.project) return null;

  const nextProject = { ...entry.project, ...(patch || {}) };
  entry.project = nextProject;
  projects.set(id, entry);

  if (currentProject?.projectId === id) currentProject = { ...nextProject };
  if (!nextProject.isSample) persistLocalProjects('project-fields-update');
  notify();
  return { ...nextProject };
}

export function getProjectSyncMeta(projectId) {
  return { ...(projects.get(String(projectId || ''))?.syncMeta || {}) };
}

export function updateProjectSyncMeta(projectId, patch = {}) {
  const id = String(projectId || '');
  const entry = projects.get(id);
  if (!entry) return null;
  entry.syncMeta = { ...(entry.syncMeta || {}), ...(patch || {}) };
  projects.set(id, entry);
  if (!entry.project?.isSample) persistLocalProjects('sync-meta-update');
  notify();
  return { ...entry.syncMeta };
}

export function removeProject(projectId) {
  const id = String(projectId || '');
  if (!id || id === sampleProject.projectId) return false;
  const deleted = projects.delete(id);
  if (deleted) {
    persistLocalProjects('project-remove');
    notify();
  }
  return deleted;
}

export function ensureProject(project) {
  if (!project?.projectId) return null;
  if (!projects.has(project.projectId)) {
    saveProjectSnapshot({ project, source: 'ensure-project' });
  }
  return getProject(project.projectId);
}

export function subscribe(callback) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function formatProjectLabel(project) {
  if (!project) return '案件未選択';
  if (project.isSample) return formatSampleProjectName(project);
  return [project.projectNo, project.projectName].filter(Boolean).join('　');
}
