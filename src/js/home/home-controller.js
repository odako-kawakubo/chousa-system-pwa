/**
 * しらべの中立トップ画面。
 * 起動時は案件未選択でここを表示し、端末内案件・新規・クラウド既存・サンプルを分離する。
 * 同じブラウザセッション内の再読込では直前案件を復帰し、セッション終了後はトップから始める。
 */
import {
  getCurrentProject,
  getProject,
  getProjectList,
  formatProjectLabel,
  subscribe
} from '../projects/project-store.js';
import { openProjectById } from '../projects/project-controller.js';
import { openProjectSession } from '../projects/project-session.js';
import { sampleProject } from '../demo/sample-project.js';
import { openModal } from '../ui/modal.js';
import { getAuthUiState, reconnectMicrosoftAuth, subscribeAuthUiState } from '../ui/auth-ui.js';
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { resolveSharedRoot } from '../onedrive/onedrive-client.js';
import { getGraphAccessToken } from '../auth/microsoft-auth.js';
import { getDeviceDisplayName, subscribeDeviceName } from '../device-code.js';
import { isManualOffline, markLocalOnly } from '../sync/sync-status.js';

const ACTIVE_PROJECT_SESSION_KEY = 'shirabe-active-project-session';
const ONEDRIVE_ROOT_NAME = '04 調査';
let checkToken = 0;
let currentAvailability = {
  firestore: false,
  oneDrive: false,
  firestoreError: '',
  oneDriveError: ''
};
let resumeAttempted = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureStylesheet() {
  if (document.querySelector('link[data-shirabe-home-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/home.css';
  link.dataset.shirabeHomeCss = '1';
  document.head.appendChild(link);
}

function ensureHomeDom() {
  if (document.getElementById('shirabeHome')) return;
  const home = document.createElement('section');
  home.id = 'shirabeHome';
  home.className = 'shirabe-home';
  home.innerHTML = `
    <div class="shirabe-home-shell">
      <header class="shirabe-home-header">
        <div class="shirabe-home-brand">
          <h1>しらべ</h1>
          <span>調査システム</span>
        </div>
        <div class="shirabe-home-meta">
          <div class="shirabe-meta-item">
            <span class="shirabe-meta-label">端末</span>
            <strong id="homeDeviceName"></strong>
          </div>
          <div class="shirabe-meta-item shirabe-meta-account">
            <span class="shirabe-meta-label">Microsoft</span>
            <strong id="homeMicrosoftName">未接続</strong>
            <button type="button" class="shirabe-link-button" id="homeReconnectMicrosoftButton">接続</button>
          </div>
        </div>
      </header>

      <div class="shirabe-home-statusbar">
        <div class="shirabe-service-status" id="homeFirestoreStatus" title="">
          <span class="shirabe-status-dot" aria-hidden="true"></span>
          <b>Firestore</b>
          <span id="homeFirestoreState">確認中</span>
        </div>
        <div class="shirabe-service-status" id="homeOneDriveStatus" title="">
          <span class="shirabe-status-dot" aria-hidden="true"></span>
          <b>OneDrive</b>
          <span id="homeOneDriveState">確認中</span>
        </div>
        <div class="shirabe-home-note" id="homeConnectionNote"></div>
      </div>

      <main class="shirabe-home-main">
        <section class="shirabe-home-section shirabe-device-projects">
          <div class="shirabe-section-heading">
            <div>
              <span class="shirabe-section-kicker">この端末</span>
              <h2>案件を開く</h2>
            </div>
          </div>
          <div class="shirabe-local-project-list" id="homeLocalProjectList"></div>
        </section>

        <section class="shirabe-home-section shirabe-start-section">
          <div class="shirabe-section-heading">
            <div>
              <span class="shirabe-section-kicker">案件</span>
              <h2>新しく始める</h2>
            </div>
          </div>
          <div class="shirabe-primary-actions">
            <button type="button" class="shirabe-action-card primary" id="homeNewProjectButton">
              <span class="shirabe-action-symbol">＋</span>
              <span><strong>新規作成</strong><small>仮案件を作成</small></span>
            </button>
            <button type="button" class="shirabe-action-card" id="homeOpenExistingButton" disabled>
              <span class="shirabe-action-symbol">↗</span>
              <span><strong>既存案件を開く</strong><small>Firestore / OneDrive</small></span>
            </button>
          </div>
          <button type="button" class="shirabe-sample-button" id="homeOpenSampleButton">サンプル案件を開く</button>
        </section>
      </main>
    </div>
  `;
  document.body.prepend(home);
}

function setAppVisible(visible) {
  const header = document.querySelector('.app-header-compact');
  const app = document.querySelector('.app');
  if (header) header.hidden = !visible;
  if (app) app.hidden = !visible;
  const home = document.getElementById('shirabeHome');
  if (home) home.hidden = visible;
}

function rememberAndRenderProjectMode() {
  const project = getCurrentProject();
  setAppVisible(Boolean(project?.projectId));
  try {
    if (project?.projectId) sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, String(project.projectId));
  } catch {
    // セッション保存不可でも現在画面は維持する。
  }
}

function readResumeProjectId() {
  try {
    return sessionStorage.getItem(ACTIVE_PROJECT_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

async function tryResumeProject() {
  if (resumeAttempted || getCurrentProject()?.projectId) return;
  const projectId = readResumeProjectId();
  if (!projectId) {
    resumeAttempted = true;
    return;
  }
  const entry = getProject(projectId);
  if (!entry?.project) {
    resumeAttempted = true;
    return;
  }

  const auth = getAuthUiState();
  const canResumeNow = entry.project.isSample || navigator.onLine === false || auth.loggedIn;
  if (!canResumeNow) return;

  resumeAttempted = true;
  await openProjectById(projectId);
}

function renderIdentity() {
  const auth = getAuthUiState();
  const device = document.getElementById('homeDeviceName');
  const microsoft = document.getElementById('homeMicrosoftName');
  const reconnect = document.getElementById('homeReconnectMicrosoftButton');

  if (device) device.textContent = getDeviceDisplayName();
  if (microsoft) microsoft.textContent = auth.loggedIn ? (auth.displayName || auth.email || 'ログイン済み') : '未接続';
  if (reconnect) {
    reconnect.textContent = auth.loggedIn && !auth.graphTokenReady ? '再接続' : auth.loggedIn ? '接続済み' : '接続';
    reconnect.disabled = auth.loggedIn && auth.graphTokenReady;
  }
}

function renderServiceStatus(wrapperId, valueId, connected, message) {
  const wrapper = document.getElementById(wrapperId);
  const value = document.getElementById(valueId);
  if (wrapper) {
    wrapper.dataset.state = connected ? 'ready' : 'off';
    wrapper.title = message || '';
  }
  if (value) value.textContent = connected ? '接続' : '未接続';
}

function renderAvailability() {
  const auth = getAuthUiState();
  const openExisting = document.getElementById('homeOpenExistingButton');
  const note = document.getElementById('homeConnectionNote');

  renderIdentity();
  renderServiceStatus(
    'homeFirestoreStatus',
    'homeFirestoreState',
    currentAvailability.firestore,
    currentAvailability.firestoreError
  );
  renderServiceStatus(
    'homeOneDriveStatus',
    'homeOneDriveState',
    currentAvailability.oneDrive,
    currentAvailability.oneDriveError
  );

  if (openExisting) openExisting.disabled = !(currentAvailability.firestore || currentAvailability.oneDrive);

  if (!note) return;
  if (navigator.onLine === false) note.textContent = '圏外';
  else if (isManualOffline()) note.textContent = 'オフラインモード';
  else if (!auth.loggedIn) note.textContent = 'Microsoft未接続';
  else if (!auth.graphTokenReady) note.textContent = 'OneDriveの再接続が必要';
  else if (currentAvailability.firestore && currentAvailability.oneDrive) note.textContent = 'クラウド接続済み';
  else if (currentAvailability.firestore) note.textContent = 'OneDriveを確認してください';
  else if (currentAvailability.oneDrive) note.textContent = 'Firestoreを確認してください';
  else note.textContent = 'クラウド接続を確認してください';
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
  currentAvailability = { firestore: false, oneDrive: false, firestoreError: '', oneDriveError: '' };
  renderAvailability();

  if (!auth.loggedIn || navigator.onLine === false || isManualOffline()) return;

  const firestoreCheck = readFirestoreProjectList()
    .then(() => ({ ok: true, error: '' }))
    .catch((error) => ({ ok: false, error: error?.message || 'Firestoreへ接続できません。' }));

  const oneDriveCheck = getGraphAccessToken()
    ? resolveSharedRoot(ONEDRIVE_ROOT_NAME)
      .then(() => ({ ok: true, error: '' }))
      .catch((error) => ({ ok: false, error: error?.message || 'OneDriveへ接続できません。' }))
    : Promise.resolve({ ok: false, error: 'Microsoft Graphトークンがありません。' });

  const [firestore, oneDrive] = await Promise.all([firestoreCheck, oneDriveCheck]);
  if (token !== checkToken) return;
  currentAvailability = {
    firestore: firestore.ok,
    oneDrive: oneDrive.ok,
    firestoreError: firestore.error,
    oneDriveError: oneDrive.error
  };
  renderAvailability();
}

async function openLocalProject(projectId) {
  const entry = getProject(projectId);
  if (!entry?.project) return;

  if (currentAvailability.firestore && getAuthUiState().loggedIn) {
    await openProjectById(projectId);
    return;
  }

  openProjectSession(entry);
  markLocalOnly();
}

function bindHomeEvents() {
  document.getElementById('homeNewProjectButton')?.addEventListener('click', () => {
    openModal('newProjectModal');
  });

  document.getElementById('homeOpenExistingButton')?.addEventListener('click', () => {
    if (!(currentAvailability.firestore || currentAvailability.oneDrive)) return;
    openModal('sharedProjectModal');
    const firstSource = currentAvailability.firestore ? 'firestore' : 'onedrive';
    window.dispatchEvent(new CustomEvent('chousa:project-source-change', { detail: { source: firstSource } }));
  });

  document.getElementById('homeLocalProjectList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-home-local-project-id]');
    if (!button) return;
    void openLocalProject(button.dataset.homeLocalProjectId);
  });

  document.getElementById('homeOpenSampleButton')?.addEventListener('click', () => {
    if (!getProject(sampleProject.projectId)) return;
    void openProjectById(sampleProject.projectId);
  });

  document.getElementById('homeReconnectMicrosoftButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      await reconnectMicrosoftAuth();
      await checkAvailability();
    } catch {
      // 認証UI側で表示済み。
    } finally {
      renderIdentity();
    }
  });

  window.addEventListener('online', () => void checkAvailability());
  window.addEventListener('offline', () => void checkAvailability());
  window.addEventListener('chousa:manual-offline-change', () => void checkAvailability());
}

export function initializeHome() {
  ensureStylesheet();
  ensureHomeDom();
  bindHomeEvents();
  subscribe(() => {
    rememberAndRenderProjectMode();
    renderLocalProjects();
  });
  subscribeDeviceName(renderIdentity);
  subscribeAuthUiState(() => {
    renderIdentity();
    void checkAvailability();
    void tryResumeProject();
  });
  rememberAndRenderProjectMode();
  renderLocalProjects();
  renderIdentity();
  void checkAvailability();
  void tryResumeProject();
}
