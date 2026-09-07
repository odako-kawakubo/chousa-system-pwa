/**
 * 独立トップ/案件サイドパネルの「既存案件を開く」OneDrive側。
 * OneDrive業務ルートはonedrive-connectionの正本のみを使用する。
 * 案件番号・案件名はOneDrive案件フォルダ名を正本とする。
 * v0.1.7.1では案件Excelの読取成立を確認するため、Excel読取失敗を握りつぶさない。
 */
import { listDriveChildren } from '../onedrive/onedrive-client.js';
import { getUsableSurveyRoot, getOneDriveConnectionState } from '../onedrive/onedrive-connection.js';
import { readProjectExcelInfo } from '../onedrive/onedrive-project-file.js';
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { getProject, saveProjectSnapshot, updateProjectSyncMeta } from './project-store.js';
import { createFormalProjectFromOneDriveSnapshot } from './project-creation.js';
import { openProjectPage } from './project-navigation.js';
import { closeModal } from '../ui/modal.js';
import { beginLoading, updateLoading, endLoading } from '../ui/loading-ui.js';

const MODAL_ID = 'sharedProjectModal';
let projectFolders = [];
let loading = false;
let resolvedRoot = null;

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
    id: String(item?.itemId || item?.id || ''),
    itemId: String(item?.itemId || item?.id || ''),
    driveId: String(item?.driveId || ''),
    name,
    webUrl: item?.webUrl || '',
    folder: item?.folder || null,
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
  const connection = getOneDriveConnectionState();
  if (!connection.connected) {
    projectFolders = [];
    resolvedRoot = null;
    if (list) list.innerHTML = '';
    setStatus(connection.error || 'OneDriveが未接続です。', 'warn');
    return;
  }

  loading = true;
  const loadingToken = beginLoading('OneDriveを確認しています…');
  if (input) input.disabled = true;
  if (searchButton) searchButton.disabled = true;
  if (list) list.innerHTML = '';
  setStatus('OneDrive案件を読み込んでいます…');

  try {
    resolvedRoot = await getUsableSurveyRoot();
    projectFolders = (await listDriveChildren(resolvedRoot))
      .filter((item) => item.folder)
      .map(parseProjectFolder)
      .filter((item) => item.projectNo)
      .sort((a, b) => b.projectNo.localeCompare(a.projectNo, 'ja'));
    if (input) input.disabled = false;
    if (searchButton) searchButton.disabled = false;
    setStatus(`OneDrive案件 ${projectFolders.length}件`);
    render();
  } catch (error) {
    projectFolders = [];
    resolvedRoot = null;
    setStatus(error?.message || 'OneDrive案件を読み込めませんでした。', 'warn');
    render();
  } finally {
    loading = false;
    endLoading(loadingToken);
  }
}

function bindOneDrive(projectId, folder, excelInfo = null) {
  updateProjectSyncMeta(projectId, {
    oneDriveBinding: {
      mode: 'formal',
      driveId: folder.driveId || resolvedRoot?.driveId || '',
      rootDriveId: resolvedRoot?.driveId || '',
      rootFolderId: resolvedRoot?.itemId || resolvedRoot?.id || '',
      rootFolderName: resolvedRoot?.name || '04 調査',
      projectFolderId: folder.id,
      projectFolderName: folder.name,
      projectFolderWebUrl: folder.webUrl,
      projectExcelFileId: excelInfo?.excelFileId || '',
      projectExcelFileName: excelInfo?.excelFileName || '',
      projectExcelFileWebUrl: excelInfo?.excelFileWebUrl || ''
    }
  });
}

function excelReadErrorMessage(folder, error) {
  const code = error?.code ? ` [${error.code}]` : '';
  return `Excel読取失敗${code}: ${error?.message || '原因を確認できませんでした。'}\n対象案件: ${folder.projectNo}　${folder.projectName}`;
}

async function readRequiredProjectExcel(folder, loadingToken) {
  updateLoading(loadingToken, '案件Excelを読み取っています…');
  setStatus('案件Excelを読み取っています…');
  try {
    const excelInfo = await readProjectExcelInfo(folder, folder.projectNo);
    console.info('案件Excel読取成功', {
      projectNo: folder.projectNo,
      excelFileName: excelInfo.excelFileName,
      F2: excelInfo.projectNo,
      K2: excelInfo.projectName,
      L2: excelInfo.address
    });
    setStatus(`Excel読取成功: ${excelInfo.excelFileName} / 入力!F2=${excelInfo.projectNo} / K2=${excelInfo.projectName} / L2=${excelInfo.address || '(空)'}`);
    return excelInfo;
  } catch (error) {
    console.error('案件Excel読取失敗', {
      projectNo: folder.projectNo,
      projectName: folder.projectName,
      code: error?.code || '',
      message: error?.message || String(error),
      error
    });
    throw new Error(excelReadErrorMessage(folder, error), { cause: error });
  }
}

async function openFolder(folderId) {
  const folder = projectFolders.find((item) => item.id === String(folderId || ''));
  if (!folder) return;

  const loadingToken = beginLoading('案件を確認しています…');
  setStatus('案件情報を確認しています…');

  try {
    // v0.1.7.1ではExcel読取を必須確認とする。
    // 読めなかった場合は案件を開いて先へ進まず、失敗理由をモーダル上に残す。
    const excelInfo = await readRequiredProjectExcel(folder, loadingToken);
    const projectInfo = {
      projectNo: folder.projectNo,
      projectName: folder.projectName,
      address: excelInfo.address || ''
    };

    updateLoading(loadingToken, 'Firestoreの調査データを確認しています…');
    const firestoreProjects = await readFirestoreProjectList();
    let project = firestoreProjects.find((item) => String(item.projectNo || item.projectId) === projectInfo.projectNo) || null;

    if (!project) {
      const confirmed = window.confirm(
        `${projectInfo.projectNo}　${projectInfo.projectName}\n${projectInfo.address || ''}\n\nFirestoreに調査データがありません。\nこの案件の調査データを新規作成しますか？`
      );
      if (!confirmed) {
        setStatus('作成をキャンセルしました。');
        return;
      }
      updateLoading(loadingToken, '案件を作成しています…');
      setStatus('Firestoreに調査データを作成しています…');
      const created = await createFormalProjectFromOneDriveSnapshot(projectInfo);
      project = created?.project || null;
      if (!project) throw new Error('Firestore調査データを作成できませんでした。');
    } else if (!getProject(project.projectId)) {
      saveProjectSnapshot({
        project,
        finishRecords: [],
        materialRecords: [],
        photoRecords: [],
        syncMeta: {},
        source: 'onedrive-existing-firestore-project'
      });
    }

    bindOneDrive(project.projectId, folder, excelInfo);
    closeModal(MODAL_ID);
    openProjectPage(project.projectId);
  } catch (error) {
    setStatus(error?.message || 'OneDrive案件を開けませんでした。', 'warn');
  } finally {
    endLoading(loadingToken);
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
