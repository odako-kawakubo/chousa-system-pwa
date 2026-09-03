/**
 * 案件とOneDrive案件フォルダの接続を一元管理する。
 * 04 調査を起点に、仮案件フォルダの自動生成・しらべ配下生成・正式案件への手動統合を担当する。
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
import { getGraphAccessToken } from '../auth/microsoft-auth.js';
import { getCurrentProject, getProjectSyncMeta, updateProjectSyncMeta, subscribe as subscribeProjects } from '../projects/project-store.js';
import { isManualOffline } from '../sync/sync-status.js';
import { subscribeAuthUiState } from '../ui/auth-ui.js';

const ROOT_FOLDER_NAME = '04 調査';
const listeners = [];
let currentState = stateFor('unconnected');
let inFlight = null;
let autoTimer = null;
let lastAutoKey = '';

function stateFor(phase, patch = {}) {
  const labels = {
    unconnected: '未接続',
    connecting: '接続中',
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

async function getInvestigationRoot() {
  const root = await findChildFolder('root', ROOT_FOLDER_NAME);
  if (!root) throw new Error(`OneDrive直下に「${ROOT_FOLDER_NAME}」が見つかりません。`);
  return root;
}

async function findProjectFolder(rootId, projectNo) {
  const children = await listDriveChildren(rootId);
  return children.find((item) => item.folder && matchesProjectNo(item.name, projectNo)) || null;
}

async function ensureShirabeStructure(projectFolder) {
  const shirabe = await ensureDriveFolder(projectFolder.id, 'しらべ');
  const visual = await ensureDriveFolder(shirabe.id, '目視写真');
  const sampling = await ensureDriveFolder(shirabe.id, '採取写真');
  const system = await ensureDriveFolder(shirabe.id, 'システムデータ');
  const visualOriginal = await ensureDriveFolder(visual.id, '元画像');
  const samplingOriginal = await ensureDriveFolder(sampling.id, '元画像');
  return {
    projectFolderId: projectFolder.id,
    projectFolderName: projectFolder.name,
    projectFolderWebUrl: projectFolder.webUrl || '',
    shirabeFolderId: shirabe.id,
    visualFolderId: visual.id,
    visualOriginalFolderId: visualOriginal.id,
    samplingFolderId: sampling.id,
    samplingOriginalFolderId: samplingOriginal.id,
    systemFolderId: system.id
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
    if (!getGraphAccessToken() || isManualOffline() || navigator.onLine === false) {
      publish(stateFor('unconnected'));
      return getCurrentOneDriveState();
    }

    publish(stateFor('connecting'));
    try {
      const root = await getInvestigationRoot();
      let binding = projectBinding(project.projectId);

      if (binding.projectFolderId) {
        try {
          const existing = await getDriveItem(binding.projectFolderId);
          if (existing?.folder) {
            const folders = await ensureShirabeStructure(existing);
            binding = { ...binding, ...folders };
            saveBinding(project.projectId, binding);
            publish(bindingState(binding));
            return getCurrentOneDriveState();
          }
        } catch (error) {
          if (error?.status !== 404) throw error;
          binding = {};
        }
      }

      let projectFolder = await findProjectFolder(root.id, project.projectNo);
      let mode = 'formal';
      if (isTemporaryProject(project)) {
        mode = 'temporary';
        if (!projectFolder) projectFolder = await createDriveFolder(root.id, projectFolderName(project));
      } else if (!projectFolder) {
        publish(stateFor('unconnected'));
        return getCurrentOneDriveState();
      }

      const folders = await ensureShirabeStructure(projectFolder);
      binding = { mode, rootFolderId: root.id, rootFolderName: root.name, ...folders };
      saveBinding(project.projectId, binding);
      publish(bindingState(binding));
    } catch (error) {
      publish(stateFor('error', { error, folderName: projectBinding(project.projectId).projectFolderName || '' }));
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
  const root = await getInvestigationRoot();
  const children = await listDriveChildren(root.id);
  return children
    .filter((item) => item.folder && item.id !== binding.projectFolderId)
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
  const target = candidates.find((item) => item.id === String(targetFolderId || ''));
  if (!target) throw new Error('統合先の正式案件フォルダを確認できませんでした。');

  publish(stateFor('integrating', {
    mode: 'temporary',
    folderName: binding.projectFolderName,
    canMerge: false,
    binding
  }));

  const existingShirabe = await findChildFolder(target.id, 'しらべ');
  if (existingShirabe) {
    publish(bindingState(binding));
    throw new Error('統合先に「しらべ」フォルダがすでにあります。自動統合を中止しました。');
  }

  try {
    await moveDriveItem(binding.shirabeFolderId, target.id);
    const remaining = await listDriveChildren(binding.projectFolderId);
    if (!remaining.length) await deleteDriveItem(binding.projectFolderId);

    const nextBinding = {
      ...binding,
      mode: 'formal',
      projectFolderId: target.id,
      projectFolderName: target.name,
      projectFolderWebUrl: target.webUrl || ''
    };
    saveBinding(project.projectId, nextBinding);
    publish(bindingState(nextBinding));
    return getCurrentOneDriveState();
  } catch (error) {
    publish(stateFor('error', {
      error,
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
  return [
    project?.projectId || '',
    binding.projectFolderId || '',
    Boolean(getGraphAccessToken()),
    isManualOffline(),
    navigator.onLine !== false
  ].join('|');
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
  subscribeAuthUiState(() => scheduleAutoConnect(true));
  window.addEventListener('online', () => scheduleAutoConnect(true));
  window.addEventListener('offline', () => scheduleAutoConnect(true));
  window.addEventListener('chousa:manual-offline-change', () => scheduleAutoConnect(true));
  scheduleAutoConnect(true);
}
