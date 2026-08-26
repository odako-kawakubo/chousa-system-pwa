/**
 * src/js/projects/project-controller.js
 *
 * v0.1.6.1Bの案件管理入口。
 * デモ案件と端末内で作成した仮案件を同じ一覧へ表示し、
 * 新規作成・案件切替を行う。Firestore案件一覧は後続版で接続する。
 */

import { createTemporaryProject } from './project-factory.js';
import { openProjectSession, saveCurrentProjectSession } from './project-session.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import {
  getCurrentProject,
  getProject,
  getProjectList,
  saveProjectSnapshot,
  formatProjectLabel,
  subscribe
} from './project-store.js';
import { closeModal } from '../ui/modal.js';
import { closeProjectPanel } from '../ui/project-panel.js';

function showStatus(message, type = '') {
  const status = document.getElementById('newProjectStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status show ${type}`.trim();
}

function clearForm() {
  const name = document.getElementById('newProjectNameInput');
  const address = document.getElementById('newProjectAddressInput');
  if (name) name.value = '';
  if (address) address.value = '';
  const status = document.getElementById('newProjectStatus');
  if (status) {
    status.textContent = '';
    status.className = 'project-restore-status';
  }
}

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
    return `
      <button type="button"
        class="project-card${active ? ' active' : ''}"
        data-project-open-id="${escapeHtml(project.projectId)}"
        ${active ? 'aria-current="true"' : ''}>
        <strong>${escapeHtml(formatProjectLabel(project))}</strong>
        ${address}
      </button>
    `;
  }).join('');
}

function switchProject(projectId) {
  const targetId = String(projectId || '');
  const current = getCurrentProject();
  if (!targetId || targetId === current?.projectId) {
    closeProjectPanel();
    return;
  }

  // 切替前の案件状態を退避。デモ案件も同じ入口で保存するため、
  // 新規案件を開いた後でもデモへ戻れる。
  saveCurrentProjectSession();

  const target = getProject(targetId);
  if (!target) return;

  openProjectSession(target);
  closeProjectPanel();
}

function createProjectFromForm() {
  const button = document.getElementById('createNewProjectButton');
  const projectName = document.getElementById('newProjectNameInput')?.value || '';
  const address = document.getElementById('newProjectAddressInput')?.value || '';

  try {
    if (button) button.disabled = true;

    // 現在案件を先に退避。最初のデモ案件もここで初めて完全スナップショットになる。
    saveCurrentProjectSession();

    const project = createTemporaryProject({
      projectName,
      address,
      existingProjects: getProjectList()
    });
    const finishRecords = createDefaultFinishRecords();

    saveProjectSnapshot({
      project,
      finishRecords,
      materialRecords: [],
      photoRecords: []
    });

    openProjectSession({
      project,
      finishRecords,
      materialRecords: [],
      photoRecords: []
    });

    closeModal('newProjectModal');
    closeProjectPanel();
    clearForm();
  } catch (error) {
    showStatus(error?.message || '新規案件を作成できませんでした。', 'warn');
  } finally {
    if (button) button.disabled = false;
  }
}

export function captureInitialProjectSession() {
  saveCurrentProjectSession();
  renderProjectList();
}

export function initializeProjectManagement() {
  const createButton = document.getElementById('createNewProjectButton');
  if (createButton && createButton.dataset.eventsBound !== '1') {
    createButton.dataset.eventsBound = '1';
    createButton.addEventListener('click', createProjectFromForm);
  }

  const modal = document.getElementById('newProjectModal');
  if (modal && modal.dataset.projectEventsBound !== '1') {
    modal.dataset.projectEventsBound = '1';
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        createProjectFromForm();
      }
    });
  }

  const list = document.getElementById('projectList');
  if (list && list.dataset.eventsBound !== '1') {
    list.dataset.eventsBound = '1';
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-project-open-id]');
      if (!button) return;
      switchProject(button.dataset.projectOpenId);
    });
  }

  renderProjectList();
  subscribe(renderProjectList);
}
