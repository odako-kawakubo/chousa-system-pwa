/**
 * 案件入口UIの正本。
 * 「既存案件を開く」モーダルは、汎用モーダルのイベント配線より前にここで一度だけ構築する。
 * 実行後にinnerHTMLで作り直さないことで、閉じるボタンや取得元タブのイベント消失を防ぐ。
 */
const MODAL_ID = 'sharedProjectModal';

function renderExistingProjectModal() {
  const modal = document.getElementById(MODAL_ID);
  const card = modal?.querySelector('.shared-project-card');
  if (!modal || !card || card.dataset.projectEntryBuilt === '1') return;

  card.dataset.projectEntryBuilt = '1';
  card.innerHTML = `
    <div class="shared-project-head">
      <b id="sharedProjectTitle">既存案件を開く</b>
      <button class="btn small" type="button" data-modal-close data-modal-target="${MODAL_ID}">閉じる</button>
    </div>
    <div class="settings-subtabs" role="tablist" aria-label="案件取得元">
      <button type="button" class="btn settings-subtab active" data-project-source="firestore">Firestore</button>
      <button type="button" class="btn settings-subtab" data-project-source="onedrive">OneDrive</button>
    </div>
    <section data-project-source-panel="firestore">
      <div class="shared-project-search-row">
        <input class="shared-project-search" data-firestore-project-search placeholder="案件を検索" disabled />
        <button class="btn small primary" type="button" data-firestore-project-search-button disabled>検索</button>
      </div>
      <div class="project-restore-status" data-firestore-project-status></div>
      <div class="shared-project-list" id="sharedProjectList"></div>
    </section>
    <section data-project-source-panel="onedrive" hidden>
      <div class="shared-project-search-row">
        <input class="shared-project-search" data-onedrive-project-search placeholder="案件を検索" disabled />
        <button class="btn small primary" type="button" data-onedrive-project-search-button disabled>検索</button>
      </div>
      <div class="project-restore-status" data-onedrive-project-status></div>
      <div class="shared-project-list" id="oneDriveProjectList"></div>
    </section>
  `;
}

function showSource(source) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  modal.querySelectorAll('[data-project-source]').forEach((button) => {
    button.classList.toggle('active', button.dataset.projectSource === source);
  });
  modal.querySelectorAll('[data-project-source-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.projectSourcePanel !== source;
  });
  window.dispatchEvent(new CustomEvent('chousa:project-source-change', { detail: { source } }));
}

function organizeTransferControls() {
  const tools = document.querySelector('.project-side-tools');
  const exportButton = document.getElementById('exportProjectJsonButton');
  const importButton = document.getElementById('importProjectJsonButton');
  const input = document.getElementById('projectJsonFileInput');
  if (!tools || !exportButton || !importButton || document.getElementById('projectTransferGroup')) return;

  const group = document.createElement('div');
  group.id = 'projectTransferGroup';
  group.className = 'project-transfer-group';
  const title = document.createElement('div');
  title.className = 'hint project-transfer-title';
  title.textContent = '端末間同期';
  group.append(title, exportButton, importButton);
  if (input) group.append(input);
  tools.append(group);

  exportButton.textContent = '書き出し';
  importButton.textContent = '読み込み';
}

export function initializeProjectEntryUi() {
  renderExistingProjectModal();

  const newButton = document.querySelector('[data-modal-target="newProjectModal"]');
  if (newButton) newButton.textContent = '＋ 新規作成';
  const newTitle = document.querySelector('#newProjectModal .shared-project-head b');
  if (newTitle) newTitle.textContent = '新規作成';

  const modal = document.getElementById(MODAL_ID);
  const card = modal?.querySelector('.shared-project-card');
  if (card && card.dataset.projectSourceBound !== '1') {
    card.dataset.projectSourceBound = '1';
    card.addEventListener('click', (event) => {
      const button = event.target.closest('[data-project-source]');
      if (!button) return;
      showSource(button.dataset.projectSource);
    });
  }

  const restoreButton = document.getElementById('restoreProjectButton');
  if (restoreButton && restoreButton.dataset.projectEntryUiBound !== '1') {
    restoreButton.dataset.projectEntryUiBound = '1';
    restoreButton.addEventListener('click', () => showSource('firestore'));
  }

  queueMicrotask(organizeTransferControls);
}
