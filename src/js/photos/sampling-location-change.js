/**
 * src/js/photos/sampling-location-change.js
 *
 * 採取場所変更時のmaterialRecord / photoRecord整合を1か所で扱う。
 *
 * 既存写真がある枝番を変更する場合:
 * - 反映させる: material採取場所を更新し、同枝番の写真samplingPlaceも更新。
 *   元画像から完成画像の看板を再生成する。
 * - 撮り直す: material採取場所を更新し、既存写真は削除せず同建材の未整理写真へ移す。
 * - 確認する: 施工前/施工中/施工後/断面の代表写真を確認Viewerで表示し、閉じたら判断UIへ戻す。
 *
 * UI呼び出し元はこのmoduleへ変更予定値を渡すだけとし、写真タブ/建材リスト/看板編集で
 * 同じ判断・保存処理を共有する。
 */

import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';
import * as boardSettingsStore from '../settings/board-settings-store.js';
import { PHOTO_TYPES, SHOOTING_TYPES } from '../records/photo-record.js';
import { getDeviceCode } from '../device-code.js';
import { getCurrentProject } from '../projects/project-store.js';
import { touchFieldEditedAt } from '../sync/field-edit-meta.js';
import { persistPhotoForProject } from '../sync/project-record-persistence.js';
import { setAndPersistMaterialRecord, appendMaterialSystemMemo } from '../materials/material-list-persistence.js';
import { resolveEditorOriginalPhoto } from './photo-original-source.js';
import { composeCompletedPhotoBlob } from './photo-completed-composer.js';
import { savePhotoBlob, updateCameraPhotoRecord } from './photo-local-store.js';
import { samplingLocationReviewPhotos } from './photo-viewer-data.js';
import { openSamplingLocationReview } from './photo-viewer.js';

const MATERIAL_LOCATION_FIELDS = Object.freeze({
  1:'sampleLocation1',
  2:'sampleLocation2',
  3:'sampleLocation3'
});

const PHOTO_REFLECT_FIELDS = Object.freeze([
  'samplingPlace', 'isEdited', 'lastEditedDevice', 'lastEditedAt', 'systemMemo'
]);

const PHOTO_RETAKE_FIELDS = Object.freeze([
  'samplingPlace', 'samplingBranch', 'sampleNo', 'part', 'shootingType',
  'isRepresentative', 'isEdited', 'lastEditedDevice', 'lastEditedAt', 'systemMemo'
]);

let decisionRoot = null;
let decisionResolver = null;

function text(value) {
  return String(value ?? '').trim();
}

function formatDate(value) {
  const source = text(value);
  const date = source ? new Date(source) : new Date();
  if (Number.isNaN(date.getTime())) return source;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function samplingStatusCode(shootingType) {
  if (shootingType === SHOOTING_TYPES.SECTION) return '4';
  return ({
    [SHOOTING_TYPES.BEFORE]:'1',
    [SHOOTING_TYPES.DURING]:'2',
    [SHOOTING_TYPES.AFTER]:'3'
  })[shootingType] || '';
}

function appendPhotoMemo(currentMemo, message) {
  const current = text(currentMemo);
  const stamp = new Date().toLocaleString('ja-JP');
  const line = `${stamp} ${message}`;
  return current ? `${current}\n${line}` : line;
}

function sampleLocationField(branch) {
  return MATERIAL_LOCATION_FIELDS[Number(branch)] || '';
}

function branchPhotos(materialId, branch) {
  return photoRecordStore.findSampling({
    materialId:String(materialId || ''),
    samplingBranch:Number(branch || 0)
  });
}

function boardDataForPhoto(photo, samplingPlace) {
  const settings = boardSettingsStore.get();
  return {
    photoType:PHOTO_TYPES.SAMPLING,
    projectName:settings.subjectText || settings.projectName,
    address:settings.addressText || settings.address,
    subjectFontSize:settings.subjectFontSize,
    addressFontSize:settings.addressFontSize,
    samplingPlace,
    sampleNo:photo.sampleNo || '',
    statusCode:samplingStatusCode(photo.shootingType),
    date:formatDate(photo.boardDate || photo.capturedAt)
  };
}

function ensureDecisionRoot() {
  if (decisionRoot) return decisionRoot;

  decisionRoot = document.createElement('div');
  decisionRoot.className = 'sampling-location-decision';
  decisionRoot.hidden = true;
  decisionRoot.innerHTML = `
    <div class="sampling-location-decision-backdrop" data-sampling-location-cancel></div>
    <div class="sampling-location-decision-card" role="dialog" aria-modal="true" aria-labelledby="samplingLocationDecisionTitle">
      <div class="sampling-location-decision-head">
        <b id="samplingLocationDecisionTitle">採取場所の変更</b>
      </div>
      <div class="sampling-location-decision-body">
        <div data-sampling-location-summary></div>
        <p>この採取場所には撮影済みの写真があります。写真の扱いを選択してください。</p>
      </div>
      <div class="sampling-location-decision-actions">
        <button class="btn primary" type="button" data-sampling-location-decision="reflect">反映させる</button>
        <button class="btn" type="button" data-sampling-location-decision="retake">撮り直す</button>
        <button class="btn" type="button" data-sampling-location-decision="review">確認する</button>
        <button class="btn small" type="button" data-sampling-location-cancel>キャンセル</button>
      </div>
    </div>`;

  decisionRoot.addEventListener('click', (event) => {
    const decision = event.target.closest('[data-sampling-location-decision]');
    if (decision) {
      const resolve = decisionResolver;
      decisionResolver = null;
      decisionRoot.hidden = true;
      resolve?.(decision.dataset.samplingLocationDecision || '');
      return;
    }

    if (event.target.closest('[data-sampling-location-cancel]')) {
      const resolve = decisionResolver;
      decisionResolver = null;
      decisionRoot.hidden = true;
      resolve?.('cancel');
    }
  });

  document.body.appendChild(decisionRoot);
  return decisionRoot;
}

function askDecision({ material, branch, currentLocation, nextLocation }) {
  const root = ensureDecisionRoot();
  const summary = root.querySelector('[data-sampling-location-summary]');
  if (summary) {
    const sampleNo = text(material?.sampleName || material?.inputId || material?.materialNo || material?.materialId);
    summary.textContent = `検体 ${sampleNo}　箇所${branch}　${currentLocation || '未設定'} → ${nextLocation || '未設定'}`;
  }

  if (decisionResolver) decisionResolver('cancel');
  root.hidden = false;
  return new Promise((resolve) => {
    decisionResolver = resolve;
  });
}

function updatedMaterialForLocation(material, branch, nextLocation) {
  const field = sampleLocationField(branch);
  if (!field) throw new Error('採取箇所を確認できません。');

  return {
    ...material,
    [field]:nextLocation,
    updatedAt:new Date().toISOString(),
    updatedDevice:getDeviceCode(),
    systemMemo:appendMaterialSystemMemo(
      material.systemMemo,
      `採取場所${branch}変更：${text(material[field]) || '-'} → ${nextLocation || '-'}`
    )
  };
}

async function prepareReflectedPhotos(photos, nextLocation) {
  const prepared = [];

  for (const photo of photos) {
    const originalBlob = await resolveEditorOriginalPhoto(photo);
    if (!(originalBlob instanceof Blob)) {
      throw new Error(`元写真を取得できませんでした。 (${photo.photoId})`);
    }

    const completedBlob = await composeCompletedPhotoBlob({
      originalBlob,
      photoType:photo.photoType,
      shootingType:photo.shootingType,
      boardPosition:photo.boardPosition || 'bottom-left',
      boardSize:photo.boardSize || 'medium',
      boardData:boardDataForPhoto(photo, nextLocation)
    });

    prepared.push({ photo, completedBlob });
  }

  return prepared;
}

async function persistReflectedPhotos(prepared, nextLocation) {
  const project = getCurrentProject();
  const now = new Date().toISOString();
  const device = getDeviceCode();
  const saved = [];

  for (const item of prepared) {
    const previous = item.photo;
    const next = photoRecordStore.set({
      ...previous,
      samplingPlace:nextLocation,
      systemMemo:appendPhotoMemo(
        previous.systemMemo,
        `採取場所変更を反映：${text(previous.samplingPlace) || '-'} → ${nextLocation || '-'}`
      ),
      isEdited:true,
      lastEditedDevice:device,
      lastEditedAt:now,
      syncStatus:'pending',
      localCompletedStatus:'saved',
      fieldEditedAt:touchFieldEditedAt(previous.fieldEditedAt, PHOTO_REFLECT_FIELDS)
    });

    await savePhotoBlob(next.photoId, 'completed', item.completedBlob, {
      createdAt:now,
      fileName:next.fileName,
      uploadStatus:'pending'
    });
    await updateCameraPhotoRecord(next);
    await persistPhotoForProject(project, next, 'sampling-location-reflect');
    saved.push(next);
  }

  return saved;
}

async function persistRetakePhotos(photos, currentLocation, nextLocation) {
  const project = getCurrentProject();
  const now = new Date().toISOString();
  const device = getDeviceCode();
  const saved = [];

  for (const previous of photos) {
    const next = photoRecordStore.set({
      ...previous,
      samplingPlace:'',
      samplingBranch:0,
      sampleNo:'',
      part:'',
      shootingType:'',
      isRepresentative:false,
      systemMemo:appendPhotoMemo(
        previous.systemMemo,
        `採取場所変更により撮り直し：${currentLocation || '-'} → ${nextLocation || '-'}、未整理写真へ移動`
      ),
      isEdited:true,
      lastEditedDevice:device,
      lastEditedAt:now,
      syncStatus:'pending',
      fieldEditedAt:touchFieldEditedAt(previous.fieldEditedAt, PHOTO_RETAKE_FIELDS)
    });

    await updateCameraPhotoRecord(next);
    await persistPhotoForProject(project, next, 'sampling-location-retake');
    saved.push(next);
  }

  return saved;
}

async function commitDecision({ material, branch, nextLocation, photos, decision }) {
  const field = sampleLocationField(branch);
  const currentLocation = text(material[field]);

  if (decision === 'reflect') {
    // 画像再生成可能性を先に確認し、失敗時はmaterialRecordを変更しない。
    const prepared = await prepareReflectedPhotos(photos, nextLocation);
    const nextMaterial = updatedMaterialForLocation(material, branch, nextLocation);
    const savedMaterial = setAndPersistMaterialRecord(
      material,
      nextMaterial,
      'sampling-location-reflect'
    );
    const savedPhotos = await persistReflectedPhotos(prepared, nextLocation);
    return { changed:true, decision, material:savedMaterial, photos:savedPhotos };
  }

  if (decision === 'retake') {
    const nextMaterial = updatedMaterialForLocation(material, branch, nextLocation);
    const savedMaterial = setAndPersistMaterialRecord(
      material,
      nextMaterial,
      'sampling-location-retake'
    );
    const savedPhotos = await persistRetakePhotos(photos, currentLocation, nextLocation);
    return { changed:true, decision, material:savedMaterial, photos:savedPhotos };
  }

  return { changed:false, decision:'cancel', material, photos:[] };
}

/**
 * 採取場所変更の共通入口。
 * 既存写真なしは即materialRecordだけ更新する。
 * 既存写真ありは「反映させる / 撮り直す / 確認する」の判断UIを出す。
 */
export async function requestSamplingLocationChange({
  materialId,
  samplingBranch,
  nextLocation
} = {}) {
  const material = materialRecordStore.get(String(materialId || ''));
  const branch = Number(samplingBranch || 0);
  const field = sampleLocationField(branch);
  if (!material || !field) {
    return { changed:false, decision:'cancel', reason:'invalid-target' };
  }

  const next = text(nextLocation);
  const current = text(material[field]);
  if (next === current) {
    return { changed:false, decision:'unchanged', material, photos:[] };
  }

  const photos = branchPhotos(material.materialId, branch);
  if (!photos.length) {
    const savedMaterial = setAndPersistMaterialRecord(
      material,
      updatedMaterialForLocation(material, branch, next),
      'sampling-location-no-photo'
    );
    return { changed:savedMaterial !== material, decision:'no-photo', material:savedMaterial, photos:[] };
  }

  while (true) {
    const decision = await askDecision({
      material,
      branch,
      currentLocation:current,
      nextLocation:next
    });

    if (decision === 'review') {
      const reviewPhotos = samplingLocationReviewPhotos({
        materialId:material.materialId,
        samplingBranch:branch
      });
      if (reviewPhotos.length) {
        await new Promise((resolve) => {
          const opened = openSamplingLocationReview(reviewPhotos, { onClosed:resolve });
          if (!opened) resolve();
        });
      }
      continue;
    }

    if (decision === 'reflect' || decision === 'retake') {
      return commitDecision({
        material,
        branch,
        nextLocation:next,
        photos,
        decision
      });
    }

    return { changed:false, decision:'cancel', material, photos:[] };
  }
}
