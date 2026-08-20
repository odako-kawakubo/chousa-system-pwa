/**
 * src/js/settings/settings-controller.js
 *
 * v0.1.5.4B 設定タブの入口。
 * - 案件情報／同期システムはUIだけ用意し、まだ保存しない。
 * - 建材名称候補・部位名称候補はsurveyCandidateStoreを正本として編集する。
 * - 削除仕様は未確定のため、この版では追加・編集のみ実装する。
 */

import { sampleProject } from '../demo/sample-project.js';
import * as surveyCandidateStore from '../store/survey-candidate-store.js';
import { renderSettingsTab } from './settings-renderer.js';
import * as boardSettingsStore from './board-settings-store.js';
import { renderBoardSample } from '../camera/camera-board.js';

let root = null;
let unsubscribe = null;

function buildViewModel() {
  const board = boardSettingsStore.get();
  return {
    project: {
      projectNo: board.projectNo || sampleProject.projectNo || '',
      projectName: board.projectName || sampleProject.projectName || '',
      address: board.address || '',
      surveyDate: board.surveyDate || '',
      surveyor: board.surveyor || ''
    },
    materialCandidates: surveyCandidateStore.getConfiguredMaterialCandidates(),
    partCandidates: surveyCandidateStore.getConfiguredPartCandidates(),
    board
  };
}

function render() {
  if (!root) return;
  const activeSection = root.querySelector('.settings-subtab.active')?.dataset.settingsSection || 'survey';
  renderSettingsTab(root, buildViewModel());
  showInnerSection(activeSection);
  renderBoardPreview();
}

function showInnerSection(section) {
  if (!root) return;
  root.querySelectorAll('[data-settings-section]').forEach((button) => {
    button.classList.toggle('active', button.dataset.settingsSection === section);
  });
  root.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== section;
  });
}

function boardPreviewData() {
  const settings = boardSettingsStore.get();
  return {
    photoType: 'visual',
    projectName: settings.subjectText || settings.projectName,
    address: settings.addressText || settings.address,
    subjectFontSize: settings.subjectFontSize,
    addressFontSize: settings.addressFontSize,
    roomNo: '1-1',
    part: '壁',
    statusCode: '5',
    date: new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())
  };
}

function renderBoardPreview() {
  const canvas = root?.querySelector('[data-settings-board-preview]');
  if (canvas) renderBoardSample(canvas, boardPreviewData());
}

function syncBoardFromInputs(changedElement = null) {
  if (!root) return;

  const projectNoInput = root.querySelector('[data-setting-project-field="projectNo"]');
  const projectNameInput = root.querySelector('[data-setting-project-field="projectName"]');
  const addressInput = root.querySelector('[data-setting-project-field="address"]');
  const surveyDateInput = root.querySelector('[data-setting-project-field="surveyDate"]');
  const surveyorInput = root.querySelector('[data-setting-project-field="surveyor"]');
  const subjectTextInput = root.querySelector('[data-board-setting="subjectText"]');
  const addressTextInput = root.querySelector('[data-board-setting="addressText"]');

  const projectNo = projectNoInput?.value || '';
  const projectName = projectNameInput?.value || '';
  const address = addressInput?.value || '';
  const surveyDate = surveyDateInput?.value || '';
  const surveyor = surveyorInput?.value || '';

  // 案件情報を変更した場合は、看板用文字列もその場で同じ値へ更新する。
  // これにより「リセットを押した時だけ新しい案件情報が反映される」状態を作らない。
  if (changedElement?.matches('[data-setting-project-field="projectName"]') && subjectTextInput) {
    subjectTextInput.value = projectName;
  }
  if (changedElement?.matches('[data-setting-project-field="address"]') && addressTextInput) {
    addressTextInput.value = address;
  }

  const subjectText = subjectTextInput?.value ?? projectName;
  const addressText = addressTextInput?.value ?? address;
  const subjectFontSize = root.querySelector('[data-board-setting="subjectFontSize"]')?.value;
  const addressFontSize = root.querySelector('[data-board-setting="addressFontSize"]')?.value;

  boardSettingsStore.set({
    projectNo,
    projectName,
    address,
    surveyDate,
    surveyor,
    subjectText,
    addressText,
    subjectFontSize,
    addressFontSize
  });

  renderBoardPreview();
}

function adjustBoardFontSize(field, delta) {
  const input = root?.querySelector(`[data-board-setting="${field}"]`);
  if (!input) return;

  const min = Number(input.min || 0);
  const max = Number(input.max || 999);
  const current = Number(input.value || 0);
  const next = Math.max(min, Math.min(max, current + delta));

  input.value = String(next);
  syncBoardFromInputs(input);
}

function handleClick(event) {
  const subtab = event.target.closest('[data-settings-section]');
  if (subtab) {
    showInnerSection(subtab.dataset.settingsSection);
    return;
  }

  const fontAdjust = event.target.closest('[data-board-font-adjust]');
  if (fontAdjust) {
    adjustBoardFontSize(
      fontAdjust.dataset.boardFontAdjust,
      Number(fontAdjust.dataset.boardFontDelta || 0)
    );
    return;
  }

  if (event.target.closest('[data-action="reset-board-settings"]')) {
    boardSettingsStore.resetFormatting();
    render();
    return;
  }

  if (event.target.closest('[data-action="add-setting-material"]')) {
    const part = root.querySelector('[data-setting-add-material-part]')?.value || '';
    const baseName = root.querySelector('[data-setting-add-material-name]')?.value || '';
    if (!part.trim() || !baseName.trim()) {
      window.alert('部位と建材名称を入力してください。');
      return;
    }
    if (!surveyCandidateStore.addMaterialCandidate(part, baseName)) {
      window.alert('同じ建材名称候補が登録済みか、入力内容が不正です。');
      return;
    }
    return;
  }

  if (event.target.closest('[data-action="add-setting-part"]')) {
    const name = root.querySelector('[data-setting-add-part-name]')?.value || '';
    if (!name.trim()) {
      window.alert('部位名称を入力してください。');
      return;
    }
    if (!surveyCandidateStore.addPartCandidate(name)) {
      window.alert('同じ部位名称候補が登録済みです。');
    }
  }
}

function handleChange(event) {
  const materialRow = event.target.closest('[data-setting-material-row]');
  if (materialRow && event.target.matches('[data-setting-material-field]')) {
    const candidateId = materialRow.dataset.settingMaterialRow;
    const fields = {};
    materialRow.querySelectorAll('[data-setting-material-field]').forEach((input) => {
      fields[input.dataset.settingMaterialField] = input.value;
    });
    if (!surveyCandidateStore.updateMaterialCandidate(candidateId, fields)) {
      window.alert('同じ候補が登録済みか、入力内容が不正です。');
      render();
    }
    return;
  }

  const partRow = event.target.closest('[data-setting-part-row]');
  if (partRow && event.target.matches('[data-setting-part-field]')) {
    const candidateId = partRow.dataset.settingPartRow;
    if (!surveyCandidateStore.updatePartCandidate(candidateId, event.target.value)) {
      window.alert('同じ候補が登録済みか、入力内容が不正です。');
      render();
    }
  }
}

export function initializeSettingsTab() {
  root = document.getElementById('settings');
  if (!root) return;

  render();

  if (root.dataset.settingsEventsBound !== '1') {
    root.dataset.settingsEventsBound = '1';
    root.addEventListener('click', handleClick);
    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-board-setting], [data-setting-project-field]')) {
        syncBoardFromInputs(event.target);
      }
    });
    root.addEventListener('change', handleChange);
    window.addEventListener('resize', renderBoardPreview);
  }

  if (unsubscribe) unsubscribe();
  unsubscribe = surveyCandidateStore.subscribe(render);
}
