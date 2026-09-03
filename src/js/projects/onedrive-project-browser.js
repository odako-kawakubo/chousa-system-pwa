/**
 * 「既存案件を開く」モーダルのOneDrive側。
 * OneDriveは案件フォルダ選択にだけ使い、Firestoreに既存のしらべデータがない案件を
 * 自動作成しない。既存データがある場合だけ同じ案件番号で開いてOneDriveを紐付ける。
 */
import { getGraphAccessToken } from '../auth/microsoft-auth.js';
import { listDriveChildren, findChildFolder } from '../onedrive/onedrive-client.js';
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { getProject, saveProjectSnapshot, updateProjectSyncMeta } from './project-store.js';
import { openProjectById } from './project-controller.js';
import { closeModal } from '../ui/modal.js';

const MODAL_ID = 'sharedProjectModal';
const ROOT_FOLDER_NAME = '04 調査';
let projectFolders = [];
let loading = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function elements() {
  const modal = document.getElementById(MODAL_ID);
  return {
    modal,
    list: document.getElementById('oneDriveProjectList'),
    input: modal?.querySelector('[data-onedrive-project-search]') || null,
    searchButton: modal?.querySelector('[data-onedrive-project-search-button]') || null,
    status: modal?.querySelector('[data-onedrive-project-status]') || null
  };
}

function parseProjectFolder(item) {
  const name = String(item?.name || '').trim();
  const match = name.match(/^(\S+)[\s　]+(.+)$/);
  return {
    id: String(item?.id || ''),
    name,
    webUrl: item?.webUrl || '',
    projectNo: match?.[1] || name,
    projectName: match?.[2] || ''
  };
}

function matches(item, query) {
  const keyword = String(query || '').trim().toLowerCase();
  if (!keyword) return true;
  return [item.projectNo, item.projectName, item.name]
    .some((value) => String(value || '').toLowerCase().includes(keyword));
}

function setStatus(message, type = '') {
  const { status } = elements();
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status${message ? ' show' : ''}${type ? ` ${type}` : ''}`;
}

function render() {
  const { list, input } = elements();
  if (!list) return;
  const filtered = projectFolders.filter((item) => matches(item, input?.value));
  if (!filtered.length) {
    list.innerHTML = '<div class="hint" style="padding:16px 4px">該当するOneDrive案件がありません</div>';
    return;
  }

  list.innerHTML = filtered.map((item) => `
    <button type="button" class="project-card" data-onedrive-project-folder-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.projectNo)}　${escapeHtml(item.projectName)}</strong>
    </button>
  `).join('');
}

async function loadProjects() {
  if (loading) return;
  const { input, searchButton, list } = elements();
  if (!getGraphAccessToken()) {
    projectFolders = [];
    if (list) list.innerHTML = '';
    setStatus('OneDriveが未接続です。', 'warn');
    return;
  }

  loading = true;
  if (input) input.disabled = true;
  if (searchButton) searchButton.disabled = true;
  if (list) list.innerHTML = '';
  setStatus('OneDrive案件を読み込んでいます…');

  try {
    const root = await findChildFolder('root', ROOT_FOLDER_NAME);
    if (!root) throw new Error(`OneDrive直下に「${ROOT_FOLDER_NAME}」が見つかりません。`);
    projectFolders = (await listDriveChildren(root.id))
      .filter((item) => item.folder)
      .map(parseProjectFolder)
      .filter((item) => item.projectNo)
      .sort((a, b) => a.projectNo.localeCompare(b.projectNo, 'ja'));
    if (input) input.disabled = false;
    if (searchButton) searchButton.disabled = false;
    setStatus(`OneDrive案件 ${projectFolders.length}件`);
    render();
  } catch (error) {
    projectFolders = [];
    setStatus(error?.message || 'OneDrive案件を読み込めませんでした。', 'warn');
    render();
  } finally {
    loading = false;
  }
}

async function openFolder(folderId) {
  const folder = projectFolders.find((item) => item.id === String(folderId || ''));
  if (!folder) return;
  setStatus('Firestoreの調査データを確認しています…');

  try {
    const firestoreProjects = await readFirestoreProjectList();
    const project = firestoreProjects.find((item) => String(item.projectNo || item.projectId) === folder.projectNo) || null;
    if (!project) {
      setStatus('この案件番号のFirestore調査データがありません。', 'warn');
      return;
    }

    if (!getProject(project.projectId)) {
      saveProjectSnapshot({ project, finishRecords: [], materialRecords: [], photoRecords: [], syncMeta: {} });
    }

    updateProjectSyncMeta(project.projectId, {
      oneDriveBinding: {
        mode: 'formal',
        rootFolderName: ROOT_FOLDER_NAME,
        projectFolderId: folder.id,
        projectFolderName: folder.name,
        projectFolderWebUrl: folder.webUrl
      }
    });

    closeModal(MODAL_ID);
    await openProjectById(project.projectId);
  } catch (error) {
    setStatus(error?.message || 'OneDrive案件を開けませんでした。', 'warn');
  }
}

export function initializeOneDriveProjectBrowser() {
  const { modal, list, input, searchButton } = elements();
  if (!modal || !list) return;

  window.addEventListener('chousa:project-source-change', (event) => {
    if (event.detail?.source === 'onedrive') void loadProjects();
  });

  if (list.dataset.onedriveBrowserBound !== '1') {
    list.dataset.onedriveBrowserBound = '1';
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-onedrive-project-folder-id]');
      if (button) void openFolder(button.dataset.onedriveProjectFolderId);
    });
  }

  if (input && input.dataset.onedriveBrowserBound !== '1') {
    input.dataset.onedriveBrowserBound = '1';
    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) render();
    });
  }

  if (searchButton && searchButton.dataset.onedriveBrowserBound !== '1') {
    searchButton.dataset.onedriveBrowserBound = '1';
    searchButton.addEventListener('click', render);
  }
}
