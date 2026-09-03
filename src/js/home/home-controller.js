/**
 * しらべの中立トップ画面。
 * 起動時は案件未選択でここを表示し、新規・既存・サンプルの入口を分離する。
 * 既存案件はFirestoreとOneDriveの両方を確認できた時だけ開ける。
 * 同じブラウザセッション内の再読込では直前案件を復帰し、セッション終了後はトップから始める。
 */
import { getCurrentProject, getProject, subscribe } from '../projects/project-store.js';
import { openProjectById } from '../projects/project-controller.js';
import { sampleProject } from '../demo/sample-project.js';
import { openModal } from '../ui/modal.js';
import { getAuthUiState, reconnectMicrosoftAuth, subscribeAuthUiState } from '../ui/auth-ui.js';
import { readFirestoreProjectList } from '../firestore/firestore-project-list.js';
import { findChildFolder } from '../onedrive/onedrive-client.js';
import { getGraphAccessToken } from '../auth/microsoft-auth.js';
import { isManualOffline } from '../sync/sync-status.js';

const ACTIVE_PROJECT_SESSION_KEY = 'shirabe-active-project-session';
let checkToken = 0;
let currentAvailability = { firestore: false, oneDrive: false };
let resumeAttempted = false;

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
    <div class="shirabe-home-card">
      <div class="shirabe-home-brand">
        <h1>しらべ</h1>
        <span>調査システム</span>
      </div>
      <div class="shirabe-cloud-row">
        <div class="shirabe-cloud-state">
          <b>Firestore</b><span id="homeFirestoreState">確認中…</span>
        </div>
        <div class="shirabe-cloud-state">
          <b>OneDrive</b><span id="homeOneDriveState">確認中…</span>
        </div>
      </div>
      <div class="shirabe-home-actions">
        <button type="button" class="btn primary shirabe-home-action" id="homeNewProjectButton">＋ 新規作成</button>
        <button type="button" class="btn shirabe-home-action" id="homeOpenExistingButton" disabled>既存案件を開く</button>
      </div>
      <div class="shirabe-home-subactions">
        <button type="button" class="btn" id="homeReconnectMicrosoftButton">Microsoft接続</button>
        <button type="button" class="btn" id="homeOpenSampleButton">サンプルを開く</button>
      </div>
      <div class="shirabe-home-note" id="homeConnectionNote"></div>
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

function renderAvailability() {
  const auth = getAuthUiState();
  const firestore = document.getElementById('homeFirestoreState');
  const oneDrive = document.getElementById('homeOneDriveState');
  const openExisting = document.getElementById('homeOpenExistingButton');
  const reconnect = document.getElementById('homeReconnectMicrosoftButton');
  const note = document.getElementById('homeConnectionNote');

  if (firestore) firestore.textContent = currentAvailability.firestore ? '接続' : '未接続';
  if (oneDrive) oneDrive.textContent = currentAvailability.oneDrive ? '接続' : '未接続';
  if (openExisting) openExisting.disabled = !(currentAvailability.firestore && currentAvailability.oneDrive);
  if (reconnect) reconnect.textContent = auth.loggedIn && !auth.graphTokenReady ? 'Microsoft再接続' : 'Microsoft接続';

  if (!note) return;
  if (navigator.onLine === false) note.textContent = '圏外です。新規作成は端末内で継続できます。';
  else if (isManualOffline()) note.textContent = 'オフラインモード中です。';
  else if (!auth.loggedIn) note.textContent = '既存案件を開くにはMicrosoftへ接続してください。';
  else if (!auth.graphTokenReady) note.textContent = 'OneDrive接続を更新してください。';
  else if (!currentAvailability.firestore || !currentAvailability.oneDrive) note.textContent = 'クラウド接続を確認しています。';
  else note.textContent = 'Firestore / OneDrive 接続済み';
}

async function checkAvailability() {
  const token = ++checkToken;
  const auth = getAuthUiState();
  currentAvailability = { firestore: false, oneDrive: false };
  renderAvailability();

  if (!auth.loggedIn || navigator.onLine === false || isManualOffline()) return;

  const firestoreCheck = readFirestoreProjectList()
    .then(() => true)
    .catch(() => false);
  const oneDriveCheck = getGraphAccessToken()
    ? findChildFolder('root', '04 調査').then((folder) => Boolean(folder)).catch(() => false)
    : Promise.resolve(false);

  const [firestore, oneDrive] = await Promise.all([firestoreCheck, oneDriveCheck]);
  if (token !== checkToken) return;
  currentAvailability = { firestore, oneDrive };
  renderAvailability();
}

function bindHomeEvents() {
  document.getElementById('homeNewProjectButton')?.addEventListener('click', () => {
    openModal('newProjectModal');
  });

  document.getElementById('homeOpenExistingButton')?.addEventListener('click', () => {
    if (!(currentAvailability.firestore && currentAvailability.oneDrive)) return;
    openModal('sharedProjectModal');
    window.dispatchEvent(new CustomEvent('chousa:project-source-change', { detail: { source: 'firestore' } }));
  });

  document.getElementById('homeOpenSampleButton')?.addEventListener('click', () => {
    if (!getProject(sampleProject.projectId)) return;
    void openProjectById(sampleProject.projectId);
  });

  document.getElementById('homeReconnectMicrosoftButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await reconnectMicrosoftAuth();
      await checkAvailability();
    } catch {
      // 認証UI側で表示済み。
    } finally {
      button.disabled = false;
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
  subscribe(() => rememberAndRenderProjectMode());
  subscribeAuthUiState(() => {
    void checkAvailability();
    void tryResumeProject();
  });
  rememberAndRenderProjectMode();
  void checkAvailability();
  void tryResumeProject();
}
