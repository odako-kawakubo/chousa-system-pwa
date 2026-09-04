/**
 * 案件画面(app.html)の案件サイドパネル専用コントローラ。
 * トップと機能が重複してよい前提で、作業中の案件切替・新規作成・端末内削除を担当する。
 */
import {
  getCurrentProject,
  getProject,
  getProjectList,
  formatProjectLabel,
  removeProject,
  subscribe
} from './project-store.js';
import { createTemporaryProjectSnapshot } from './project-creation.js';
import { openProjectById, captureInitialProjectSession } from './project-controller.js';
import { setOpenProjectId, openHomePage } from './project-navigation.js';
import { closeModal } from '../ui/modal.js';
import { closeProjectPanel } from '../ui/project-panel.js';
import { beginLoading, endLoading } from '../ui/loading-ui.js';
import { listUnsent, clearUnsentForProject } from '../sync/unsent-queue.js';
import { deleteTestProjectFromFirestore } from '../sync/project-record-persistence.js';
import { deleteLocalPhotoData } from '../photos/photo-local-store.js';
import { clearProjectBoardSettings } from '../settings/board-settings-store.js';
import { sampleProject } from '../demo/sample-project.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderProjectList() {
  const current = getCurrentProject();
  const header = document.getElementById('caseHeaderTitle');
  if (header) header.textContent = formatProjectLabel(current);

  const list = document.getElementById('projectList');
  if (!list) return;
  const projects = getProjectList();
  if (!projects.length) {
    list.innerHTML = '<div class="hint" style="padding:16px 4px">案件がありません</div>';
    return;
  }

  list.innerHTML = projects.map((project) => {
    const active = project.projectId === current?.projectId;
    const address = project.address ? `<span>${escapeHtml(project.address)}</span>` : '';
    const deleteButton = project.isSample ? '' : `
      <button type="button" class="project-delete-btn"
        data-project-delete-id="${escapeHtml(project.projectId)}"
        title="${project.environment === 'test' ? 'テスト案件を完全削除' : '端末から削除'}"
        aria-label="${project.environment === 'test' ? 'テスト案件を完全削除' : '端末から削除'}">×</button>`;
    return `
      <div class="project-card${active ? ' active' : ''}">
        <button type="button" class="project-card-open"
          data-project-open-id="${escapeHtml(project.projectId)}"
          ${active ? 'aria-current="true"' : ''}>
          <strong>${escapeHtml(formatProjectLabel(project))}</strong>
          ${address}
        </button>
        ${deleteButton}
      </div>`;
  }).join('');
}

function showNewProjectStatus(message, type = '') {
  const status = document.getElementById('newProjectStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status${message ? ' show' : ''}${type ? ` ${type}` : ''}`;
}

function clearNewProjectForm() {
  const name = document.getElementById('newProjectNameInput');
  const address = document.getElementById('newProjectAddressInput');
  if (name) name.value = '';
  if (address) address.value = '';
  showNewProjectStatus('');
}

async function createNewProject() {
  const button = document.getElementById('createNewProjectButton');
  const projectName = document.getElementById('newProjectNameInput')?.value || '';
  const address = document.getElementById('newProjectAddressInput')?.value || '';
  const loadingToken = beginLoading('案件を作成しています…');
  try {
    if (button) button.disabled = true;
    showNewProjectStatus('案件番号と初期仕上表を準備しています…');
    captureInitialProjectSession();
    const snapshot = await createTemporaryProjectSnapshot({ projectName, address });
    const projectId = snapshot?.project?.projectId || '';
    if (!projectId) throw new Error('案件を作成できませんでした。');
    setOpenProjectId(projectId);
    closeModal('newProjectModal');
    closeProjectPanel();
    clearNewProjectForm();
    await openProjectById(projectId);
  } catch (error) {
    showNewProjectStatus(error?.message || '新規案件を作成できませんでした。', 'warn');
  } finally {
    endLoading(loadingToken);
    if (button) button.disabled = false;
  }
}

async function deleteProject(projectId) {
  const id = String(projectId || '');
  if (!id || id === sampleProject.projectId) return;
  const entry = getProject(id);
  const project = entry?.project;
  if (!project) return;

  const current = getCurrentProject();
  const unsentCount = listUnsent({ projectId: id }).length;
  const testProject = project.environment === 'test';
  const scopeText = testProject
    ? 'このテスト案件を端末とFirestoreから完全に削除します。'
    : 'この案件をこの端末から削除します。Firestoreの案件データは残ります。';
  const unsentText = unsentCount
    ? `\n\n未送信の変更が${unsentCount}件あります。削除するとこの端末の未送信データは失われます。`
    : '';
  if (!window.confirm(`${formatProjectLabel(project)}\n\n${scopeText}${unsentText}\n\n削除しますか？`)) return;

  try {
    if (current?.projectId === id) captureInitialProjectSession();
    if (testProject) await deleteTestProjectFromFirestore(project);
    const photoIds = (entry.photoRecords || []).map((record) => record?.photoId).filter(Boolean);
    try {
      await deleteLocalPhotoData(photoIds);
    } catch (error) {
      console.warn('[v0.1.6.5G] 写真キャッシュ削除失敗', error);
    }
    clearUnsentForProject(id);
    clearProjectBoardSettings(id);
    removeProject(id);
    if (current?.projectId === id) {
      openHomePage();
      return;
    }
    renderProjectList();
  } catch (error) {
    console.error('[v0.1.6.5G] 案件削除失敗', error);
    window.alert(testProject
      ? 'テスト案件をFirestoreから削除できませんでした。端末内の案件は残しています。'
      : '案件を端末から削除できませんでした。');
  }
}

async function switchProject(projectId) {
  const id = String(projectId || '');
  if (!id) return;
  if (getCurrentProject()?.projectId === id) {
    closeProjectPanel();
    return;
  }
  const loadingToken = beginLoading('案件を読み込んでいます…');
  try {
    captureInitialProjectSession();
    setOpenProjectId(id);
    await openProjectById(id);
    closeProjectPanel();
  } finally {
    endLoading(loadingToken);
  }
}

export function initializeProjectSidePanelController() {
  const list = document.getElementById('projectList');
  const createButton = document.getElementById('createNewProjectButton');
  const modal = document.getElementById('newProjectModal');
  if (!list) return;

  if (list.dataset.projectSideControllerBound !== '1') {
    list.dataset.projectSideControllerBound = '1';
    list.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('[data-project-delete-id]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        void deleteProject(deleteButton.dataset.projectDeleteId);
        return;
      }
      const openButton = event.target.closest('[data-project-open-id]');
      if (openButton) void switchProject(openButton.dataset.projectOpenId);
    });
  }

  if (createButton && createButton.dataset.projectSideControllerBound !== '1') {
    createButton.dataset.projectSideControllerBound = '1';
    createButton.addEventListener('click', () => void createNewProject());
  }

  if (modal && modal.dataset.projectSideControllerBound !== '1') {
    modal.dataset.projectSideControllerBound = '1';
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        void createNewProject();
      }
    });
  }

  subscribe(renderProjectList);
  renderProjectList();
}
