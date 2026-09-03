/**
 * 「既存案件を開く」モーダルのFirestore案件一覧を担当する。
 * 選択した案件は端末内案件Storeへ登録し、project-controllerの正式な
 * 案件オープン入口へ直接渡す。
 */
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { getCurrentProject, getProject, saveProjectSnapshot } from './project-store.js';
import { openProjectById } from './project-controller.js';
import { closeModal } from '../ui/modal.js';

const MODAL_ID = 'sharedProjectModal';
let remoteProjects = [];
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
    list: document.getElementById('sharedProjectList'),
    input: modal?.querySelector('.shared-project-search') || null,
    searchButton: modal?.querySelector('.shared-project-search-row .btn') || null,
    status: modal?.querySelector('.project-restore-status') || null
  };
}

function matches(project, query) {
  const keyword = String(query || '').trim().toLowerCase();
  if (!keyword) return true;
  return [project.projectNo, project.projectName, project.address]
    .some((value) => String(value || '').toLowerCase().includes(keyword));
}

function render() {
  const { list, input } = elements();
  if (!list) return;
  const filtered = remoteProjects.filter((project) => matches(project, input?.value));

  if (!filtered.length) {
    list.innerHTML = '<div class="hint" style="padding:16px 4px">該当するFirestore案件がありません</div>';
    return;
  }

  list.innerHTML = filtered.map((project) => {
    const registered = Boolean(getProject(project.projectId));
    const active = getCurrentProject()?.projectId === project.projectId;
    const state = active ? '開いています' : registered ? 'この端末に登録済み' : '';
    return `
      <button type="button" class="project-card shared-firestore-project-card"
        data-firestore-project-id="${escapeHtml(project.projectId)}">
        <strong>${escapeHtml(project.projectNo)}　${escapeHtml(project.projectName)}</strong>
        <span>${escapeHtml(project.address)}</span>
        ${state ? `<small class="hint">${escapeHtml(state)}</small>` : ''}
      </button>
    `;
  }).join('');
}

function setStatus(message, type = '') {
  const { status } = elements();
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status show ${type}`.trim();
}

async function loadProjects() {
  if (loading) return;
  loading = true;
  const { input, searchButton, list } = elements();
  if (input) input.disabled = true;
  if (searchButton) searchButton.disabled = true;
  if (list) list.innerHTML = '';
  setStatus('Firestore案件を読み込んでいます…');

  try {
    remoteProjects = await readFirestoreProjectList();
    if (input) input.disabled = false;
    if (searchButton) searchButton.disabled = false;
    setStatus(`Firestore案件 ${remoteProjects.length}件`);
    render();
  } catch (error) {
    remoteProjects = [];
    setStatus(error?.message || 'Firestore案件を読み込めませんでした。', 'warn');
    render();
  } finally {
    loading = false;
  }
}

async function openRemoteProject(projectId) {
  const project = remoteProjects.find((item) => item.projectId === String(projectId || ''));
  if (!project) return;

  if (!getProject(project.projectId)) {
    saveProjectSnapshot({
      project,
      finishRecords: [],
      materialRecords: [],
      photoRecords: [],
      syncMeta: {}
    });
  }

  closeModal(MODAL_ID);
  await openProjectById(project.projectId);
}

export function initializeFirestoreProjectBrowser() {
  const restoreButton = document.getElementById('restoreProjectButton');
  const { modal, list, input, searchButton } = elements();
  if (!restoreButton || !modal || !list) return;

  if (restoreButton.dataset.firestoreBrowserBound !== '1') {
    restoreButton.dataset.firestoreBrowserBound = '1';
    restoreButton.addEventListener('click', () => {
      void loadProjects();
    });
  }

  if (list.dataset.firestoreBrowserBound !== '1') {
    list.dataset.firestoreBrowserBound = '1';
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-firestore-project-id]');
      if (!button) return;
      void openRemoteProject(button.dataset.firestoreProjectId);
    });
  }

  if (input && input.dataset.firestoreBrowserBound !== '1') {
    input.dataset.firestoreBrowserBound = '1';
    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) render();
    });
  }

  if (searchButton && searchButton.dataset.firestoreBrowserBound !== '1') {
    searchButton.dataset.firestoreBrowserBound = '1';
    searchButton.addEventListener('click', render);
  }
}
