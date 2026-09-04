/**
 * 独立トップページ(index.html)のコントローラ。
 * 案件本体は初期化せず、案件選択・新規作成・接続状態確認だけを担当する。
 */
import { getProjectList, formatProjectLabel, subscribe } from '../projects/project-store.js';
import { createTemporaryProjectSnapshot } from '../projects/project-creation.js';
import { openProjectPage } from '../projects/project-navigation.js';
import { sampleProject } from '../demo/sample-project.js';
import { openModal, closeModal } from '../ui/modal.js';
import { beginLoading, endLoading } from '../ui/loading-ui.js';
import { getAuthUiState, reconnectMicrosoftAuth, subscribeAuthUiState } from '../ui/auth-ui.js';
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { getDeviceDisplayName, subscribeDeviceName } from '../device-code.js';
import { isManualOffline } from '../sync/sync-status.js';
import {
  getOneDriveConnectionState,
  refreshOneDriveConnection,
  subscribeOneDriveConnection
} from '../onedrive/onedrive-connection.js';

let checkToken = 0;
let currentAvailability = {
  firestore: false,
  oneDrive: false,
  firestoreError: '',
  oneDriveError: ''
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderIdentity() {
  const auth = getAuthUiState();
  const device = document.getElementById('homeDeviceName');
  const microsoft = document.getElementById('homeMicrosoftName');
  const reconnect = document.getElementById('homeReconnectMicrosoftButton');
  const anyMicrosoftSession = auth.loggedIn || auth.graphLoggedIn;

  if (device) device.textContent = getDeviceDisplayName();
  if (microsoft) microsoft.textContent = anyMicrosoftSession ? (auth.displayName || auth.email || 'ログイン済み') : '未接続';
  if (reconnect) {
    const complete = auth.loggedIn && auth.graphLoggedIn && auth.graphTokenReady && currentAvailability.oneDrive;
    reconnect.textContent = complete ? '接続済み' : (anyMicrosoftSession ? '再接続' : '接続');
    reconnect.disabled = complete;
  }
}

function renderServiceStatus(wrapperId, valueId, connected, message, phase = '') {
  const wrapper = document.getElementById(wrapperId);
  const value = document.getElementById(valueId);
  if (wrapper) {
    wrapper.dataset.state = connected ? 'ready' : (phase === 'checking' ? 'checking' : 'off');
    wrapper.title = message || '';
  }
  if (value) value.textContent = phase === 'checking' ? '確認中' : (connected ? '接続' : '未接続');
}

function renderAvailability() {
  const auth = getAuthUiState();
  const openExisting = document.getElementById('homeOpenExistingButton');
  const note = document.getElementById('homeConnectionNote');
  const oneDriveState = getOneDriveConnectionState();

  currentAvailability.oneDrive = oneDriveState.connected;
  currentAvailability.oneDriveError = oneDriveState.error || '';

  renderIdentity();
  renderServiceStatus('homeFirestoreStatus', 'homeFirestoreState', currentAvailability.firestore, currentAvailability.firestoreError);
  renderServiceStatus('homeOneDriveStatus', 'homeOneDriveState', currentAvailability.oneDrive, currentAvailability.oneDriveError, oneDriveState.phase);

  if (openExisting) openExisting.disabled = !(currentAvailability.firestore || currentAvailability.oneDrive);

  if (!note) return;
  if (navigator.onLine === false) note.textContent = '圏外';
  else if (isManualOffline()) note.textContent = 'オフラインモード';
  else if (!auth.loggedIn && !auth.graphLoggedIn) note.textContent = 'Microsoft未接続';
  else if (!auth.loggedIn) note.textContent = 'Firestore認証が必要';
  else if (!auth.graphLoggedIn || !auth.graphTokenReady) note.textContent = 'OneDriveの再接続が必要';
  else if (currentAvailability.firestore && currentAvailability.oneDrive) note.textContent = 'クラウド接続済み';
  else if (currentAvailability.firestore) note.textContent = currentAvailability.oneDriveError || 'OneDriveを確認してください';
  else if (currentAvailability.oneDrive) note.textContent = 'Firestoreを確認してください';
  else note.textContent = currentAvailability.oneDriveError || 'クラウド接続を確認してください';
}

function localProjects() {
  return getProjectList()
    .filter((project) => !project.isSample)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function renderLocalProjects() {
  const list = document.getElementById('homeLocalProjectList');
  if (!list) return;
  const projects = localProjects();
  if (!projects.length) {
    list.innerHTML = '<div class="shirabe-empty-projects">この端末に保存された案件はありません</div>';
    return;
  }

  list.innerHTML = projects.map((project) => `
    <button type="button" class="shirabe-local-project" data-home-local-project-id="${escapeHtml(project.projectId)}">
      <span class="shirabe-local-project-main">
        <strong>${escapeHtml(formatProjectLabel(project))}</strong>
        ${project.address ? `<small>${escapeHtml(project.address)}</small>` : ''}
      </span>
      <span class="shirabe-local-project-arrow" aria-hidden="true">›</span>
    </button>
  `).join('');
}

async function checkAvailability() {
  const token = ++checkToken;
  const auth = getAuthUiState();
  currentAvailability.firestore = false;
  currentAvailability.firestoreError = '';
  renderAvailability();

  if (!auth.loggedIn || navigator.onLine === false || isManualOffline()) return;

  const firestore = await readFirestoreProjectList()
    .then(() => ({ ok: true, error: '' }))
    .catch((error) => ({ ok: false, error: error?.message || 'Firestoreへ接続できません。' }));
  if (token !== checkToken) return;
  currentAvailability.firestore = firestore.ok;
  currentAvailability.firestoreError = firestore.error;
  renderAvailability();
}

function showNewProjectStatus(message, type = '') {
  const status = document.getElementById('newProjectStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `project-restore-status${message ? ' show' : ''}${type ? ` ${type}` : ''}`;
}

async function createNewProject() {
  const button = document.getElementById('createNewProjectButton');
  const projectName = document.getElementById('newProjectNameInput')?.value || '';
  const address = document.getElementById('newProjectAddressInput')?.value || '';
  const loadingToken = beginLoading('案件を作成しています…');
  try {
    if (button) button.disabled = true;
    showNewProjectStatus('案件番号と初期仕上表を準備しています…');
    const snapshot = await createTemporaryProjectSnapshot({ projectName, address });
    if (!snapshot?.project?.projectId) throw new Error('案件を作成できませんでした。');
    closeModal('newProjectModal');
    openProjectPage(snapshot.project.projectId);
  } catch (error) {
    showNewProjectStatus(error?.message || '新規案件を作成できませんでした。', 'warn');
  } finally {
    endLoading(loadingToken);
    if (button) button.disabled = false;
  }
}

function bindHomeEvents() {
  document.getElementById('homeNewProjectButton')?.addEventListener('click', () => openModal('newProjectModal'));
  document.getElementById('createNewProjectButton')?.addEventListener('click', () => void createNewProject());
  document.getElementById('newProjectModal')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      void createNewProject();
    }
  });

  document.getElementById('homeOpenExistingButton')?.addEventListener('click', () => {
    if (!(currentAvailability.firestore || currentAvailability.oneDrive)) return;
    openModal('sharedProjectModal');
    const firstSource = currentAvailability.firestore ? 'firestore' : 'onedrive';
    window.dispatchEvent(new CustomEvent('chousa:project-source-change', { detail: { source: firstSource } }));
  });

  document.getElementById('homeLocalProjectList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-home-local-project-id]');
    if (button) openProjectPage(button.dataset.homeLocalProjectId);
  });

  document.getElementById('homeOpenSampleButton')?.addEventListener('click', () => openProjectPage(sampleProject.projectId));

  document.getElementById('homeReconnectMicrosoftButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    const loadingToken = beginLoading('Microsoft / OneDriveへ接続しています…');
    try {
      await reconnectMicrosoftAuth();
      await refreshOneDriveConnection({ force: true });
      await checkAvailability();
    } catch {
      // 認証UI側で表示済み。
    } finally {
      endLoading(loadingToken);
      renderIdentity();
    }
  });

  window.addEventListener('online', () => void checkAvailability());
  window.addEventListener('offline', () => void checkAvailability());
  window.addEventListener('chousa:manual-offline-change', () => void checkAvailability());
}

export function initializeHome() {
  bindHomeEvents();
  subscribe(renderLocalProjects);
  subscribeDeviceName(renderIdentity);
  subscribeOneDriveConnection(renderAvailability);
  subscribeAuthUiState(() => {
    renderIdentity();
    void checkAvailability();
  });
  renderLocalProjects();
  renderIdentity();
  renderAvailability();
  void checkAvailability();
}
