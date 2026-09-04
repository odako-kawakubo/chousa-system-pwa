/**
 * 独立トップの「既存案件を開く」Firestore側。
 * 選択した案件を端末Snapshotへ登録し、案件ページへ遷移する。
 */
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { getProject, saveProjectSnapshot } from './project-store.js';
import { openProjectPage } from './project-navigation.js';
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
    input: modal?.querySelector('[data-firestore-project-search]') || null,
    searchButton: modal?.querySelector('[data-firestore-project-search-button]') || null,
    status: modal?.querySelector('[data-firestore-project-status]') || null
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
    return `
      <button type="button" class="project-card shared-firestore-project-card"
        data-firestore-project-id="${escapeHtml(project.projectId)}">
        <strong>${escapeHtml(project.projectNo)}　${escapeHtml(project.projectName)}</strong>
        <span>${escapeHtml(project.address)}</span>
        ${registered ? '<small class="hint">この端末に登録済み</small>' : ''}
      </button>
    `;
  }).join('');
}

function setStatus(message, type = '') {
  const { status } = elements();
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status${message ? ' show' : ''}${type ? ` ${type}` : ''}`;
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

function openRemoteProject(projectId) {
  const project = remoteProjects.find((item) => item.projectId === String(projectId || ''));
  if (!project) return;
  if (!getProject(project.projectId)) {
    saveProjectSnapshot({
      project,
      finishRecords: [],
      materialRecords: [],
      photoRecords: [],
      syncMeta: {},
      source: 'firestore-project-browser'
    });
  }
  closeModal(MODAL_ID);
  openProjectPage(project.projectId);
}

export function initializeFirestoreProjectBrowser() {
  const { modal, list, input, searchButton } = elements();
  if (!modal || !list) return;

  window.addEventListener('chousa:project-source-change', (event) => {
    if (event.detail?.source === 'firestore') void loadProjects();
  });

  if (list.dataset.firestoreBrowserBound !== '1') {
    list.dataset.firestoreBrowserBound = '1';
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-firestore-project-id]');
      if (button) openRemoteProject(button.dataset.firestoreProjectId);
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
