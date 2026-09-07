/**
 * src/js/projects/project-session.js
 * 案件を開く／閉じる共通入口。Firestore／OneDriveの取得処理は持たない。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import { getCurrentProject, saveProjectSnapshot, setCurrentProject, formatProjectLabel } from './project-store.js';
import { setProject } from '../finish-table/finish-table-state.js';
import { refreshFinishTableFromStores, resetFinishTableForProject } from '../finish-table/finish-table-controller.js';
import {
  requestFinishTableExternalRefresh,
  resetFinishTableExternalRefresh
} from '../finish-table/finish-table-refresh-guard.js';
import { refreshMaterialList } from '../materials/material-list-controller.js';
import { refreshMaterialOperations } from '../materials/material-operations-controller.js';
import { refreshRecordView } from '../record-view/record-view-controller.js';
import { refreshPhotoTab } from '../photos/photo-controller.js';
import { refreshPhotoForImpact, initializePhotoRefreshOnTabActivation } from '../photos/photo-refresh-policy.js';
import { refreshSettingsTab } from '../settings/settings-controller.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';

export function saveCurrentProjectSession() {
  const project = getCurrentProject();
  if (!project?.projectId) return null;
  return saveProjectSnapshot({
    project,
    finishRecords: finishRecordStore.exportSnapshot(),
    materialRecords: materialRecordStore.exportSnapshot(),
    photoRecords: photoRecordStore.exportSnapshot(),
    source: 'current-project-session'
  });
}

function refreshDerivedFinishInputIds() {
  const materials = new Map(
    materialRecordStore.exportSnapshot().map((record) => [String(record.materialId || ''), record])
  );
  const current = finishRecordStore.exportSnapshot();
  let changed = false;
  const next = current.map((record) => {
    const material = materials.get(String(record.materialId || ''));
    const inputId = material ? String(material.inputId ?? '') : '';
    if (String(record.inputId ?? '') === inputId) return record;
    changed = true;
    return { ...record, inputId };
  });
  if (changed) finishRecordStore.replaceAll(next, { notify: false });
}

/**
 * 案件を開く時だけ使う全画面初期反映。
 * リアルタイム同期では refreshProjectViewsForChanges() を使い、
 * 関係のないタブまで再描画しない。
 */
export function refreshOpenProjectSessionViews() {
  refreshDerivedFinishInputIds();
  refreshFinishTableFromStores();
  refreshMaterialList();
  refreshMaterialOperations();
  refreshRecordView();
  refreshPhotoTab();
  refreshSettingsTab();
}

/**
 * Firestoreのリアルタイム変更を、影響する画面だけへ反映する。
 * Recordの受信・Store更新そのものはproject-controller.jsで完了済みとし、
 * ここではDOM更新の振り分けだけを担当する。
 *
 * 仕上表は入力中DOMを守るため、外部同期由来の再描画だけrefresh guardを通す。
 * Store更新やFirestore送受信は止めず、編集終了後に最新Storeから1回だけ描画する。
 *
 * 写真は「Record種別が変わった」だけでは描画せず、現在表示している
 * 目視／採取モードに実際に影響する時だけphoto-refresh-policyから更新する。
 * 非表示中の写真タブは描画せず、タブを開いた時に最新Storeから再構築する。
 */
export function refreshProjectViewsForChanges(impact = {}) {
  const finish = impact.finish || {};
  const material = impact.material || {};
  const photo = impact.photo || {};

  if (material.changed) refreshDerivedFinishInputIds();

  if (finish.changed || material.finishView) {
    requestFinishTableExternalRefresh(refreshFinishTableFromStores);
  }

  if (finish.materialView || material.changed) {
    refreshMaterialList();
    refreshMaterialOperations();
  }

  if (finish.changed || material.changed || photo.changed) {
    refreshRecordView();
  }

  const photoTypes = photo.photoTypes instanceof Set
    ? photo.photoTypes
    : new Set(photo.photoTypes || []);
  refreshPhotoForImpact({
    visual: Boolean(finish.photoVisual || material.photoVisual || photoTypes.has('visual')),
    sampling: Boolean(material.photoSampling || photoTypes.has('sampling')),
    force: Boolean(photo.forceRefresh)
  });
}

export function openProjectSession({ project, finishRecords = [], materialRecords = [], photoRecords = [] }) {
  if (!project?.projectId) throw new Error('案件情報が正しくありません。');

  // 旧案件で保留中だった外部描画要求を、新案件へ持ち越さない。
  resetFinishTableExternalRefresh();

  finishRecordStore.replaceAll(finishRecords, { notify: false });
  materialRecordStore.replaceAll(materialRecords, { notify: false });
  photoRecordStore.replaceAll(photoRecords, { notify: false });

  setCurrentProject(project);
  boardSettingsStore.activateProject(project);
  setProject(project);

  resetFinishTableForProject();
  initializePhotoRefreshOnTabActivation();
  refreshOpenProjectSessionViews();

  const header = document.getElementById('caseHeaderTitle');
  if (header) header.textContent = formatProjectLabel(project);
  return project;
}

export function closeProjectSession() {
  saveCurrentProjectSession();
  resetFinishTableExternalRefresh();
  setCurrentProject(null);
  const header = document.getElementById('caseHeaderTitle');
  if (header) header.textContent = '案件未選択';
}
