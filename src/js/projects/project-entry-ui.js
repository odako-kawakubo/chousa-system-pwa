/**
 * 案件入口UIの表示名と「既存案件を開く」モーダルの取得元切替を管理する。
 * 取得元は Firestore → OneDrive の順で固定し、端末ファイルの移送は書き出し／読み込みとして分離する。
 */

const MODAL_ID = 'sharedProjectModal';

function renderExistingProjectModal() {
  const modal = document.getElementById(MODAL_ID);
  const card = modal?.querySelector('.shared-project-card');
  if (!modal || !card) return;

  card.innerHTML = `
    <div class="shared-project-head">
      <b id="sharedProjectTitle">既存案件を開く</b>
      <button class="btn small" data-modal-close data-modal-target="${MODAL_ID}">閉じる</button>
    </div>
    <div class="settings-subtabs" role="tablist" aria-label="案件取得元">
      <button type="button" class="btn settings-subtab active" data-project-source="firestore">Firestore</button>
      <button type="button" class="btn settings-subtab" data-project-source="onedrive">OneDrive</button>
    </div>
    <section data-project-source-panel="firestore">
      <div class="shared-project-search-row">
        <input class="shared-project-search" data-firestore-project-search placeholder="案件を検索" disabled />
        <button class="btn small primary" data-firestore-project-search-button disabled>検索</button>
      </div>
      <div class="project-restore-status" data-firestore-project-status></div>
      <div class="shared-project-list" id="sharedProjectList"></div>
    </section>
    <section data-project-source-panel="onedrive" hidden>
      <div class="shared-project-search-row">
        <input class="shared-project-search" data-onedrive-project-search placeholder="案件を検索" disabled />
        <button class="btn small primary" data-onedrive-project-search-button disabled>検索</button>
      </div>
      <div class="project-restore-status" data-onedrive-project-status></div>
      <div class="shared-project-list" id="oneDriveProjectList"></div>
    </section>
  `;
}

function setMenuLabels() {
  const newButton = document.querySelector('[data-modal-target="newProjectModal"]');
  if (newButton) newButton.textContent = '＋ 新規作成';

  const newTitle = document.querySelector('#newProjectModal .shared-project-head b');
  if (newTitle) newTitle.textContent = '新規作成';

  const exportButton = document.getElementById('exportProjectJsonButton');
  if (exportButton) exportButton.textContent = '書き出し';

  const importButton = document.getElementById('importProjectJsonButton');
  if (importButton) importButton.textContent = '読み込み';
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

export function initializeProjectEntryUi() {
  renderExistingProjectModal();
  setMenuLabels();

  const modal = document.getElementById(MODAL_ID);
  if (modal && modal.dataset.projectEntryUiBound !== '1') {
    modal.dataset.projectEntryUiBound = '1';
    modal.addEventListener('click', (event) => {
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
}
