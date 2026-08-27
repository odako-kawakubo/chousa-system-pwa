/**
 * src/js/projects/project-controller.js
 *
 * v0.1.6.2Cの案件管理入口。
 * デモ案件と端末内で作成した仮案件を同じ一覧へ表示し、
 * 新規作成・案件切替を行う。Firestore案件一覧は後続版で接続する。
 */

import { createTemporaryProject, temporaryDateCode } from './project-factory.js';
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
import {
  getRemoteTemporaryProjectNos,
  loadProjectRecordsFromFirestore,
  persistFinishStructureForProject,
  persistProjectMetadataForProject
} from '../sync/project-record-persistence.js';
import { refreshMaterialUsageDerivedFields } from '../finish-table/finish-table-actions.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';

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

async function switchProject(projectId) {
  const targetId = String(projectId || '');
  const current = getCurrentProject();
  if (!targetId || targetId === current?.projectId) {
    closeProjectPanel();
    return;
  }

  // 切替前の案件状態を退避。Firestore書込失敗時の端末側保険としても残す。
  saveCurrentProjectSession();

  const target = getProject(targetId);
  if (!target) return;

  try {
    if (target.project?.isSample) {
      openProjectSession(target);
    } else {
      // CではFirestoreのfinishRecords全件を案件の現在形として再読込する。
      const remote = await loadProjectRecordsFromFirestore(target.project);
      const restored = {
        project: target.project,
        finishRecords: remote?.finishRecords?.length ? remote.finishRecords : target.finishRecords,
        materialRecords: remote?.materialRecords || target.materialRecords,
        photoRecords: remote?.photoRecords || target.photoRecords || []
      };
      saveProjectSnapshot(restored);
      openProjectSession(restored);
      // 建材使用箇所・部位は保存済み文字列を正本にせず、復元済み仕上表から再計算する。
      refreshMaterialUsageDerivedFields();
      refreshMaterialList();
    }
    closeProjectPanel();
  } catch (error) {
    console.error('[v0.1.6.2C] Firestore案件読込失敗', error);
    window.alert('Firestoreから案件を読み込めませんでした。通信状態を確認してください。端末内の状態は保持されています。');
  }
}

async function createProjectFromForm() {
  const button = document.getElementById('createNewProjectButton');
  const projectName = document.getElementById('newProjectNameInput')?.value || '';
  const address = document.getElementById('newProjectAddressInput')?.value || '';

  try {
    if (button) button.disabled = true;
    showStatus('案件番号と初期仕上表を準備しています…');

    // 現在案件を先に退避。最初のデモ案件もここで初めて完全スナップショットになる。
    saveCurrentProjectSession();

    // PC/iPadなど別端末で作成済みの当日仮番号もFirestoreで確認する。
    const dateCode = temporaryDateCode();
    let remoteProjectNos = [];
    try {
      remoteProjectNos = await getRemoteTemporaryProjectNos(dateCode, 'production');
    } catch (error) {
      console.warn('[v0.1.6.2C] Firestore仮番号確認失敗。端末内番号だけで採番します。', error);
    }

    const project = createTemporaryProject({
      projectName,
      address,
      existingProjects: getProjectList(),
      existingProjectNos: remoteProjectNos
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

    // 案件作成時点の空欄を含む仕上表全件をFirestoreへ登録する。
    // 以後の編集は従来どおり変更Recordだけ差分更新する。
    await persistProjectMetadataForProject(project);
    const saved = await persistFinishStructureForProject(project, finishRecords);
    if (saved?.queued) {
      showStatus('案件は作成しましたが、一部の仕上表レコードは未送信です。', 'warn');
    }

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
