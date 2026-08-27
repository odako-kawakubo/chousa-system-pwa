/**
 * src/js/projects/project-controller.js
 *
 * v0.1.6.2Eの案件管理入口。
 * デモ案件と端末内で作成した仮案件を同じ一覧へ表示し、
 * 新規作成・案件切替を行う。Firestore案件一覧は後続版で接続する。
 */

import { createTemporaryProject, temporaryDateCode } from './project-factory.js';
import { openProjectSession, saveCurrentProjectSession, refreshOpenProjectSessionViews } from './project-session.js';
import { createDefaultFinishRecords } from '../default/default-finish-data.js';
import {
  getCurrentProject,
  getProject,
  getProjectList,
  saveProjectSnapshot,
  removeProject,
  formatProjectLabel,
  subscribe
} from './project-store.js';
import { closeModal } from '../ui/modal.js';
import { closeProjectPanel } from '../ui/project-panel.js';
import {
  getRemoteTemporaryProjectNos,
  subscribeProjectRecordsForProject,
  hydrateIncomingMaterialRecord,
  hydrateIncomingFinishRecord,
  hydrateIncomingPhotoRecord,
  persistFinishStructureForProject,
  persistProjectMetadataForProject,
  deleteTestProjectFromFirestore
} from '../sync/project-record-persistence.js';
import { refreshMaterialUsageDerivedFields } from '../finish-table/finish-table-actions.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
import { listUnsent, clearUnsentForProject } from '../sync/unsent-queue.js';
import { deleteLocalPhotoData } from '../photos/photo-local-store.js';
import { sampleProject } from '../demo/sample-project.js';
import { clearProjectBoardSettings } from '../settings/board-settings-store.js';
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';


let stopActiveProjectRecords = null;
let activeProjectStreamToken = 0;

function stopProjectRecordStream() {
  activeProjectStreamToken += 1;
  if (stopActiveProjectRecords) {
    stopActiveProjectRecords();
    stopActiveProjectRecords = null;
  }
}

function sameFieldEditedAt(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function applyProjectRecordChanges(project, changes = []) {
  if (!project?.projectId || getCurrentProject()?.projectId !== project.projectId) return;
  let changed = false;

  // materialを先に反映し、その後finishのinputId解決に使う。
  const materialChanges = changes.filter((item) => item.recordType === 'material');
  if (materialChanges.length) {
    let rawMaterials = materialRecordStore.exportSnapshot();
    materialChanges.forEach((change) => {
      const id = String(change.id || change.record?.materialId || '');
      if (!id) return;
      const current = materialRecordStore.get(id);
      if (change.changeType !== 'removed' && current && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) return;
      rawMaterials = rawMaterials.filter((record) => String(record.materialId) !== id);
      if (change.changeType !== 'removed' && change.record) rawMaterials.push(change.record);
      changed = true;
    });
    if (changed) {
      const normalized = hydrateIncomingMaterialRecord(null, rawMaterials);
      materialRecordStore.replaceAll(normalized, { notify: false });
    }
  }

  changes.filter((item) => item.recordType === 'finish').forEach((change) => {
    const id = String(change.id || change.record?.finishId || '');
    if (!id) return;
    const current = finishRecordStore.get(id);
    if (change.changeType !== 'removed' && current && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) return;
    if (change.changeType === 'removed') {
      finishRecordStore.remove(id);
      changed = true;
      return;
    }
    const normalized = hydrateIncomingFinishRecord(
      change.record,
      finishRecordStore.exportSnapshot(),
      materialRecordStore.exportSnapshot()
    );
    if (normalized) {
      finishRecordStore.set(normalized);
      changed = true;
    }
  });

  changes.filter((item) => item.recordType === 'photo').forEach((change) => {
    const id = String(change.id || change.record?.photoId || '');
    if (!id) return;
    const current = photoRecordStore.get(id);
    if (change.changeType !== 'removed' && current && sameFieldEditedAt(current.fieldEditedAt, change.record?.fieldEditedAt)) return;
    if (change.changeType === 'removed') {
      // photoRecordは通常論理削除だが、Firestoreから物理削除された場合だけStoreから外す。
      photoRecordStore.replaceAll(photoRecordStore.exportSnapshot().filter((record) => record.photoId !== id), { notify: false });
      changed = true;
      return;
    }
    const normalized = hydrateIncomingPhotoRecord(change.record);
    if (normalized) {
      photoRecordStore.set(normalized);
      changed = true;
    }
  });

  if (!changed) return;
  saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot()
  });
  refreshOpenProjectSessionViews();
}

function openFirestoreProjectSession(target) {
  const project = target.project;
  const token = ++activeProjectStreamToken;

  return new Promise((resolve, reject) => {
    const stop = subscribeProjectRecordsForProject(project, {
      onInitial: (remote) => {
        if (token !== activeProjectStreamToken) return;
        const restored = {
          project,
          finishRecords: remote?.finishRecords?.length ? remote.finishRecords : target.finishRecords,
          materialRecords: remote?.materialRecords || target.materialRecords,
          photoRecords: remote?.photoRecords || target.photoRecords || []
        };
        saveProjectSnapshot(restored);
        openProjectSession(restored);
        refreshMaterialUsageDerivedFields();
        refreshMaterialList();
        stopActiveProjectRecords = stop;
        resolve(restored);
      },
      onChanges: (changes) => {
        if (token !== activeProjectStreamToken) return;
        applyProjectRecordChanges(project, changes);
      },
      onError: (error) => {
        if (token !== activeProjectStreamToken) return;
        reject(error);
      }
    });
  });
}

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
    const deleteButton = project.isSample ? '' : `
      <button type="button"
        class="project-delete-btn"
        data-project-delete-id="${escapeHtml(project.projectId)}"
        title="${project.environment === 'test' ? 'テスト案件を完全削除' : '端末から削除'}"
        aria-label="${project.environment === 'test' ? 'テスト案件を完全削除' : '端末から削除'}">×</button>`;
    return `
      <div class="project-card${active ? ' active' : ''}">
        <button type="button"
          class="project-card-open"
          data-project-open-id="${escapeHtml(project.projectId)}"
          ${active ? 'aria-current="true"' : ''}>
          <strong>${escapeHtml(formatProjectLabel(project))}</strong>
          ${address}
        </button>
        ${deleteButton}
      </div>
    `;
  }).join('');
}


function isTestProject(project) {
  return project?.environment === 'test';
}

async function deleteProject(projectId) {
  const id = String(projectId || '');
  if (!id || id === sampleProject.projectId) return;

  const current = getCurrentProject();
  if (current?.projectId === id) {
    saveCurrentProjectSession();
    stopProjectRecordStream();
  }

  const entry = getProject(id);
  const project = entry?.project;
  if (!project) return;

  const unsentCount = listUnsent({ projectId: id }).length;
  const testProject = isTestProject(project);
  const scopeText = testProject
    ? 'このテスト案件を端末とFirestoreから完全に削除します。'
    : 'この案件をこの端末から削除します。Firestoreの案件データは残ります。';
  const unsentText = unsentCount
    ? `\n\n未送信の変更が${unsentCount}件あります。削除するとこの端末の未送信データは失われます。`
    : '';

  if (!window.confirm(`${formatProjectLabel(project)}\n\n${scopeText}${unsentText}\n\n削除しますか？`)) return;

  try {
    // テスト案件はFirestore削除に成功してから端末側を消す。失敗時はローカルを残して再試行できるようにする。
    if (testProject) await deleteTestProjectFromFirestore(project);

    const photoIds = (entry.photoRecords || []).map((record) => record?.photoId).filter(Boolean);
    try {
      await deleteLocalPhotoData(photoIds);
    } catch (error) {
      console.warn('[v0.1.6.2E] 写真キャッシュ削除失敗', error);
    }

    clearUnsentForProject(id);
    clearProjectBoardSettings(id);
    removeProject(id);

    if (current?.projectId === id) {
      const sample = getProject(sampleProject.projectId);
      if (sample) openProjectSession(sample);
    }

    renderProjectList();
  } catch (error) {
    console.error('[v0.1.6.2E] 案件削除失敗', error);
    window.alert(testProject
      ? 'テスト案件をFirestoreから削除できませんでした。端末内の案件は残しています。'
      : '案件を端末から削除できませんでした。');
  }
}

async function switchProject(projectId) {
  const targetId = String(projectId || '');
  const current = getCurrentProject();
  if (!targetId || targetId === current?.projectId) {
    closeProjectPanel();
    return;
  }

  // 切替前の案件状態を退避し、旧案件のFirestore監視を必ず解除する。
  saveCurrentProjectSession();
  stopProjectRecordStream();

  const target = getProject(targetId);
  if (!target) return;

  try {
    if (target.project?.isSample) {
      openProjectSession(target);
    } else {
      // Eでは初回snapshotで現在形を受け取り、そのlistenerを差分受信用に維持する。
      await openFirestoreProjectSession(target);
    }
    closeProjectPanel();
  } catch (error) {
    stopProjectRecordStream();
    console.error('[v0.1.6.2E] Firestore案件購読失敗', error);
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

    // 現在案件を先に退避し、旧案件のFirestore監視を解除する。
    saveCurrentProjectSession();
    stopProjectRecordStream();

    // PC/iPadなど別端末で作成済みの当日仮番号もFirestoreで確認する。
    const dateCode = temporaryDateCode();
    let remoteProjectNos = [];
    try {
      remoteProjectNos = await getRemoteTemporaryProjectNos(dateCode, 'production');
    } catch (error) {
      console.warn('[v0.1.6.2E] Firestore仮番号確認失敗。端末内番号だけで採番します。', error);
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

    // 初期登録後は新規案件にもlistenerを張り、以後の変更を差分受信する。
    stopProjectRecordStream();
    const createdTarget = getProject(project.projectId);
    if (createdTarget) await openFirestoreProjectSession(createdTarget);

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
      const deleteButton = event.target.closest('[data-project-delete-id]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        deleteProject(deleteButton.dataset.projectDeleteId);
        return;
      }

      const openButton = event.target.closest('[data-project-open-id]');
      if (!openButton) return;
      switchProject(openButton.dataset.projectOpenId);
    });
  }

  renderProjectList();
  subscribe(renderProjectList);
}
