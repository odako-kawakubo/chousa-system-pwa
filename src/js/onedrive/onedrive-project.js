/**
 * 案件とOneDrive案件フォルダの接続を一元管理する。
 * OneDrive業務ルート自体はonedrive-connectionの正本だけを使用する。
 */
import {
  listDriveChildren,
  getDriveItem,
  findChildFolder,
  createDriveFolder,
  ensureDriveFolder,
  moveDriveItem,
  deleteDriveItem
} from './onedrive-client.js';
import {
  getUsableSurveyRoot,
  getOneDriveConnectionState,
  subscribeOneDriveConnection
} from './onedrive-connection.js';
import { getCurrentProject, getProjectSyncMeta, updateProjectSyncMeta, subscribe as subscribeProjects } from '../projects/project-store.js';
import { isManualOffline } from '../sync/sync-status.js';

const listeners = [];
let currentState = stateFor('unconnected');
let inFlight = null;
let autoTimer = null;
let lastAutoKey = '';

function stateFor(phase, patch = {}) {
  const labels = {
    unconnected: '未接続',
    connecting: '接続確認中',
    temporary: '仮フォルダ接続中',
    formal: '正式案件接続済み',
    integrating: '統合処理中',
    error: '接続エラー',
    unavailable: '対象外'
  };
  return {
    phase,
    label: labels[phase] || phase,
    folderName: '',
    mode: '',
    canMerge: false,
    error: null,
    errorCode: '',
    ...patch
  };
}

function publish(next) {
  currentState = { ...next };
  listeners.slice().forEach((callback) => callback(getCurrentOneDriveState()));
}

function projectBinding(projectId) {
  return { ...(getProjectSyncMeta(projectId)?.oneDriveBinding || {}) };
}

function saveBinding(projectId, binding) {
  updateProjectSyncMeta(projectId, { oneDriveBinding: { ...(binding || {}) } });
}

function isTemporaryProject(project) {
  return Boolean(project?.isTemporary || project?.projectType === 'temporary');
}

function projectFolderName(project) {
  return [project?.projectNo, project?.projectName].filter(Boolean).join('　');
}

function matchesProjectNo(folderName, projectNo) {
  const name = String(folderName || '');
  const no = String(projectNo || '');
  return Boolean(no) && (name === no || name.startsWith(`${no} `) || name.startsWith(`${no}　`));
}

function folderRefFromBinding(binding = {}, prefix = 'project') {
  const driveId = String(binding.driveId || binding.rootDriveId || '');
  const itemId = String(binding[`${prefix}FolderId`] || '');
  return itemId ? { driveId, itemId } : null;
}

async function findProjectFolder(root, projectNo) {
  const children = await listDriveChildren(root);
  return children.find((item) => item.folder && matchesProjectNo(item.name, projectNo)) || null;
}

async function ensureShirabeStructure(projectFolder) {
  const shirabe = await ensureDriveFolder(projectFolder, 'しらべ');
  const visual = await ensureDriveFolder(shirabe, '目視写真');
  const sampling = await ensureDriveFolder(shirabe, '採取写真');
  const system = await ensureDriveFolder(shirabe, 'システムデータ');
  const visualOriginal = await ensureDriveFolder(visual, '元画像');
  const samplingOriginal = await ensureDriveFolder(sampling, '元画像');
  const driveId = String(projectFolder.driveId || shirabe.driveId || '');
  return {
    driveId,
    projectFolderId: projectFolder.itemId || projectFolder.id,
    projectFolderName: projectFolder.name,
    projectFolderWebUrl: projectFolder.webUrl || '',
    shirabeFolderId: shirabe.itemId || shirabe.id,
    visualFolderId: visual.itemId || visual.id,
    visualOriginalFolderId: visualOriginal.itemId || visualOriginal.id,
    samplingFolderId: sampling.itemId || sampling.id,
    samplingOriginalFolderId: samplingOriginal.itemId || samplingOriginal.id,
    systemFolderId: system.itemId || system.id
  };
}

function bindingState(binding) {
  const temporary = binding.mode === 'temporary';
  return stateFor(temporary ? 'temporary' : 'formal', {
    mode: binding.mode,
    folderName: binding.projectFolderName || '',
    canMerge: temporary,
    binding
  });
}

export function getCurrentOneDriveState() {
  return { ...currentState, binding: currentState.binding ? { ...currentState.binding } : null };
}

export function subscribeOneDriveState(callback) {
  listeners.push(callback);
  callback(getCurrentOneDriveState());
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export async function connectCurrentProjectOneDrive() {
  if (inFlight) return inFlight;
  const task = (async () => {
    const project = getCurrentProject();
    if (!project?.projectId || project.isSample) {
      publish(stateFor('unavailable'));
      return getCurrentOneDriveState();
    }
    if (!getOneDriveConnectionState().connected || isManualOffline() || navigator.onLine === false) {
      publish(stateFor('unconnected'));
      return getCurrentOneDriveState();
    }

    publish(stateFor('connecting'));
    try {
      const root = await getUsableSurveyRoot();
      let binding = projectBinding(project.projectId);

      const boundProjectRef = folderRefFromBinding(binding, 'project');
      if (boundProjectRef) {
        try {
          const existing = await getDriveItem(boundProjectRef);
          if (existing?.folder) {
            const folders = await ensureShirabeStructure(existing);
            binding = {
              ...binding,
              rootDriveId: root.driveId,
              rootFolderId: root.itemId || root.id,
              rootFolderName: root.name,
              ...folders
            };
            saveBinding(project.projectId, binding);
            publish(bindingState(binding));
            return getCurrentOneDriveState();
          }
        } catch (error) {
          if (error?.status !== 404) throw error;
          binding = {};
        }
      }

      let projectFolder = await findProjectFolder(root, project.projectNo);
      let mode = 'formal';
      if (isTemporaryProject(project)) {
        mode = 'temporary';
        if (!projectFolder) projectFolder = await createDriveFolder(root, projectFolderName(project));
      } else if (!projectFolder) {
        publish(stateFor('unconnected'));
        return getCurrentOneDriveState();
      }

      const folders = await ensureShirabeStructure(projectFolder);
      binding = {
        mode,
        rootDriveId: root.driveId,
        rootFolderId: root.itemId || root.id,
        rootFolderName: root.name,
        ...folders
      };
      saveBinding(project.projectId, binding);
      publish(bindingState(binding));
    } catch (error) {
      publish(stateFor('error', {
        error,
        errorCode: error?.code || error?.graphCode || '',
        folderName: projectBinding(project.projectId).projectFolderName || ''
      }));
    }
    return getCurrentOneDriveState();
  })();

  inFlight = task;
  try {
    return await task;
  } finally {
    if (inFlight === task) inFlight = null;
  }
}

export async function listFormalOneDriveCandidates() {
  const project = getCurrentProject();
  if (!project?.projectId) return [];
  const binding = projectBinding(project.projectId);
  if (binding.mode !== 'temporary') return [];
  const root = await getUsableSurveyRoot();
  const children = await listDriveChildren(root);
  return children
    .filter((item) => item.folder && (item.itemId || item.id) !== binding.projectFolderId)
    .filter((item) => !/^\d{6}-\d{2}(?:\s|　|$)/.test(String(item.name || '')))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
}

export async function mergeCurrentProjectOneDrive(targetFolderId) {
  const project = getCurrentProject();
  if (!project?.projectId) throw new Error('案件が開かれていません。');
  const binding = projectBinding(project.projectId);
  if (binding.mode !== 'temporary' || !binding.projectFolderId || !binding.shirabeFolderId) {
    throw new Error('この案件は仮フォルダ接続中ではありません。');
  }

  const candidates = await listFormalOneDriveCandidates();
  const target = candidates.find((item) => (item.itemId || item.id) === String(targetFolderId || ''));
  if (!target) throw new Error('統合先の正式案件フォルダを確認できませんでした。');

  publish(stateFor('integrating', { mode: 'temporary', folderName: binding.projectFolderName, canMerge: false, binding }));

  const existingShirabe = await findChildFolder(target, 'しらべ');
  if (existingShirabe) {
    publish(bindingState(binding));
    throw new Error('統合先に「しらべ」フォルダがすでにあります。自動統合を中止しました。');
  }

  const driveId = String(binding.driveId || binding.rootDriveId || target.driveId || '');
  const sourceShirabe = { driveId, itemId: binding.shirabeFolderId };
  const sourceProject = { driveId, itemId: binding.projectFolderId };

  try {
    await moveDriveItem(sourceShirabe, target);
    const remaining = await listDriveChildren(sourceProject);
    if (!remaining.length) await deleteDriveItem(sourceProject);

    const nextBinding = {
      ...binding,
      mode: 'formal',
      driveId: target.driveId || driveId,
      projectFolderId: target.itemId || target.id,
      projectFolderName: target.name,
      projectFolderWebUrl: target.webUrl || ''
    };
    saveBinding(project.projectId, nextBinding);
    publish(bindingState(nextBinding));
    return getCurrentOneDriveState();
  } catch (error) {
    publish(stateFor('error', {
      error,
      errorCode: error?.code || error?.graphCode || '',
      mode: 'temporary',
      folderName: binding.projectFolderName,
      canMerge: true,
      binding
    }));
    throw error;
  }
}

function autoKey() {
  const project = getCurrentProject();
  const binding = project?.projectId ? projectBinding(project.projectId) : {};
  const oneDrive = getOneDriveConnectionState();
  return [project?.projectId || '', binding.projectFolderId || '', oneDrive.connected, oneDrive.root?.itemId || '', isManualOffline(), navigator.onLine !== false].join('|');
}

function scheduleAutoConnect(force = false) {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    const key = autoKey();
    if (!force && key === lastAutoKey) return;
    lastAutoKey = key;
    void connectCurrentProjectOneDrive();
  }, 0);
}

export function initializeOneDriveProjectIntegration() {
  subscribeProjects(() => scheduleAutoConnect());
  subscribeOneDriveConnection(() => scheduleAutoConnect(true));
  window.addEventListener('chousa:manual-offline-change', () => scheduleAutoConnect(true));
  scheduleAutoConnect(true);
}
