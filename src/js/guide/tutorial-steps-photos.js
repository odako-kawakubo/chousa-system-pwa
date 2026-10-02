/**
 * 写真セクションの基本チュートリアル。
 * 実撮影はCamera内部チュートリアルへ分離し、ここでは写真タブの基本構造と
 * 仕上表／建材リストからの反映を確認する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import { getVisualPhotoTargetKey } from '../records/photo-record.js';

function tutorialRoomRecord() {
  return finishRecordStore.getAll()
    .filter((record) =>
      record.status === 'active'
      && record.areaCode === 'I'
      && Number(record.floor) === 1
      && String(record.roomNo || '') === '1-1'
    )
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))[0] || null;
}

function tutorialRoomUid() {
  return String(tutorialRoomRecord()?.roomUid || '');
}

function tutorialFloorMaterialId() {
  const roomUid = tutorialRoomUid();
  if (!roomUid) return '';
  return String(
    finishRecordStore.getAll().find((record) =>
      record.status === 'active'
      && String(record.roomUid || '') === roomUid
      && Math.floor(Number(record.position || 0) / 100) === 1
      && record.materialId
    )?.materialId || ''
  );
}

function tutorialRoomButton() {
  const roomUid = tutorialRoomUid();
  return roomUid
    ? document.querySelector(`#photos [data-photo-room="${CSS.escape(roomUid)}"]`)
    : null;
}

function visualFloorTarget() {
  const record = tutorialRoomRecord();
  if (!record) return null;
  const key = getVisualPhotoTargetKey({
    areaCode: record.areaCode,
    roomPosition: record.roomPosition,
    partSlot: 1
  });
  return key
    ? document.querySelector(`#photos [data-photo-target-key="${CSS.escape(key)}"]`)
    : null;
}

function samplingModeButton() {
  return document.querySelector('#photos [data-photo-mode="sampling"]');
}

function isSamplingMode() {
  return Boolean(samplingModeButton()?.classList.contains('active'));
}

function samplingMaterialButton() {
  const materialId = tutorialFloorMaterialId();
  return materialId
    ? document.querySelector(`#photos [data-photo-material="${CSS.escape(materialId)}"]`)
    : null;
}

function samplingPoint(branch) {
  const materialId = tutorialFloorMaterialId();
  if (!materialId) return null;
  const key = `sampling|${materialId}|${branch}`;
  return document.querySelector(
    `#photos [data-photo-sampling-point-key="${CSS.escape(key)}"]`
  );
}

function samplingStage(branch, stage) {
  const point = samplingPoint(branch);
  return point?.querySelector(
    `[data-photo-camera-sampling-stage][data-photo-stage="${CSS.escape(stage)}"]`
  )?.closest('.photo-stage-tile') || null;
}

function tutorialRoomSelected() {
  return Boolean(tutorialRoomButton()?.classList.contains('active'));
}

export const PHOTO_TUTORIAL_STEPS = [
  {
    id: 'photos-intro',
    section: '写真',
    tab: 'photos',
    title: '写真',
    text: '写真タブでは、仕上表の部屋・部位ごとの目視写真と、建材リストの採取情報に対応した採取写真を管理します。',
    target: () => document.querySelector('#photos .photo-mode-sticky') || document.getElementById('photos')
  },
  {
    id: 'photos-select-room',
    section: '写真',
    tab: 'photos',
    title: '調査場所を選択',
    text: '左の調査場所から「1-1」を選択します。',
    target: () => tutorialRoomButton(),
    interactive: true,
    permissions: () => [{
      actionId: 'photo.room.select',
      context: { roomUid: tutorialRoomUid() }
    }],
    completeWhen: ({ didAction }) =>
      tutorialRoomSelected()
      && didAction('photo.room.select', { roomUid:tutorialRoomUid() })
  },
  {
    id: 'photos-visual-floor',
    section: '写真',
    tab: 'photos',
    title: '目視調査の写真',
    text: '仕上表の部屋・部位が目視写真の枠として表示されます。「＋」から、その部位を指定した状態でカメラを起動できます。',
    target: () => visualFloorTarget()
  },
  {
    id: 'photos-switch-sampling',
    section: '写真',
    tab: 'photos',
    title: '建材採取',
    text: '「建材採取」に切り替えます。',
    target: () => samplingModeButton(),
    interactive: true,
    permissions: () => [{
      actionId: 'photo.mode.change',
      context: { mode: 'sampling' }
    }],
    completeWhen: ({ didAction }) =>
      isSamplingMode()
      && didAction('photo.mode.change', { mode:'sampling' })
  },
  {
    id: 'photos-sampling-reflection',
    section: '写真',
    tab: 'photos',
    title: '採取情報の反映',
    text: '建材リストで設定した採取数・採取場所・採取部位が、そのまま採取試料へ反映されます。採取数を2にしたため、①と②の2箇所が表示されています。',
    target: () => [
      samplingMaterialButton(),
      samplingPoint(1),
      samplingPoint(2)
    ].filter(Boolean)
  },
  {
    id: 'photos-before-stage',
    section: '写真',
    tab: 'photos',
    title: '施工前写真',
    text: '採取写真は、施工前・施工中・施工後を区分して管理します。各枠の「＋」からその区分でカメラを起動できます。',
    target: () => samplingStage(1, 'before')
  },
  {
    id: 'photos-section-stage',
    section: '写真',
    tab: 'photos',
    title: '断面写真',
    text: '断面写真は、施工前・施工中・施工後とは別の区分として管理します。',
    target: () => samplingStage(1, 'section')
  },
  {
    id: 'photos-complete',
    section: '写真',
    tab: 'photos',
    title: '写真の基本操作',
    text: '写真タブの基本的な見方はここまでです。実際の撮影操作はカメラ画面で行います。',
    target: () => document.querySelector('#photos .photo-panel') || document.getElementById('photos')
  }
];
