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

let root = null;
let unsubscribe = null;

function buildViewModel() {
  return {
    project: {
      projectNo: sampleProject.projectNo || '',
      projectName: sampleProject.projectName || '',
      address: '',
      surveyDate: '',
      surveyor: ''
    },
    materialCandidates: surveyCandidateStore.getConfiguredMaterialCandidates(),
    partCandidates: surveyCandidateStore.getConfiguredPartCandidates()
  };
}

function render() {
  if (!root) return;
  const activeSection = root.querySelector('.settings-subtab.active')?.dataset.settingsSection || 'survey';
  renderSettingsTab(root, buildViewModel());
  showInnerSection(activeSection);
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

function handleClick(event) {
  const subtab = event.target.closest('[data-settings-section]');
  if (subtab) {
    showInnerSection(subtab.dataset.settingsSection);
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
    root.addEventListener('change', handleChange);
  }

  if (unsubscribe) unsubscribe();
  unsubscribe = surveyCandidateStore.subscribe(render);
}
