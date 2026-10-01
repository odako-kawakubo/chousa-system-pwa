/**
 * src/js/guide/guide-data.js
 *
 * チュートリアル／操作ガイドの表示内容と対象DOMだけを定義する。
 * ガイドの描画・タブ遷移・進行状態は guide-controller / guide-overlay 側へ分離する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';
import * as materialRecordStore from '../store/material-record-store.js';
import * as photoRecordStore from '../store/photo-record-store.js';

function roomBlock(index) {
  return document.querySelectorAll('#finish .finish-room-block')[index] || null;
}

function finishCell(roomIndex, partIndex, kind = 'name', row = 1) {
  const room = roomBlock(roomIndex);
  return room?.querySelector(
    `[data-part-index="${partIndex}"][data-input-row="${row}"] [data-kind="${kind}"]`
  ) || null;
}

function roomAction(roomIndex, action) {
  return roomBlock(roomIndex)?.querySelector(`[data-action="${action}"]`) || null;
}

function lastFirstFloorAction(action) {
  const floor = document.querySelector('#finish .finish-floor-heading[data-floor-key="floor-I-1"]');
  if (!floor) return document.querySelector(`#finish [data-action="${action}"]`);
  const rooms = [...document.querySelectorAll('#finish .finish-room-block')];
  return rooms.map((room) => room.querySelector(`[data-action="${action}"]`)).find(Boolean) || null;
}

function firstMaterialControl(field) {
  return document.querySelector(`#materials [data-material-row] [data-material-control][data-field="${field}"]`);
}

function roomKeyAt(index) {
  return String(roomBlock(index)?.dataset.roomKey || '');
}

function finishRecordFor(roomIndex, partIndex, row = 1) {
  const roomKey = roomKeyAt(roomIndex);
  if (!roomKey) return null;
  const position = Number(partIndex) * 100 + Number(row);
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active'
    && String(record.roomUid || '') === roomKey
    && Number(record.position) === position
  ) || null;
}

function registerButton(roomIndex, partIndex, row = 1) {
  const roomKey = roomKeyAt(roomIndex);
  return document.querySelector(
    `#finish [data-action="register-material"][data-room-key="${CSS.escape(roomKey)}"][data-part-index="${partIndex}"][data-input-row="${row}"]`
  );
}

function newMaterialAllowed(roomIndex, partIndex, { requirePart = false } = {}) {
  const record = finishRecordFor(roomIndex, partIndex, 1);
  if (record?.materialId) return [];
  if (requirePart && !String(record?.part || '').trim()) {
    return [finishCell(roomIndex, partIndex, 'part', 1)].filter(Boolean);
  }
  const register = registerButton(roomIndex, partIndex, 1);
  if (register) return [register];
  return [finishCell(roomIndex, partIndex, 'name', 1)].filter(Boolean);
}

function firstMaterial() {
  return materialRecordStore.getAll().find((record) => record.status === 'active') || null;
}

function firstMaterialId() {
  return String(firstMaterial()?.materialId || '');
}

function firstMaterialFieldTarget(field) {
  const materialId = firstMaterialId();
  if (!materialId) return null;
  return document.querySelector(
    `#materials [data-material-row][data-material-id="${CSS.escape(materialId)}"] [data-material-control][data-field="${field}"]`
  );
}

function firstMaterialTextTarget(kind) {
  const materialId = firstMaterialId();
  if (!materialId) return null;
  return document.querySelector(
    `#materials [data-material-row][data-material-id="${CSS.escape(materialId)}"] [data-material-text-display][data-editor-kind="${kind}"], #materials [data-material-row][data-material-id="${CSS.escape(materialId)}"] [data-material-text-input][data-editor-kind="${kind}"]`
  );
}

function firstMaterialMultiSelectTarget() {
  const materialId = firstMaterialId();
  if (!materialId) return null;
  return document.querySelector(
    `#materials [data-material-row][data-material-id="${CSS.escape(materialId)}"] [data-material-multi-select]`
  );
}

function firstRoomName() {
  const key = roomKeyAt(0);
  return finishRecordStore.getAll().find((record) => String(record.roomUid || '') === key)?.roomName || '';
}

function activeFinishRoomCount(areaCode, floor) {
  return new Set(
    finishRecordStore.getAll()
      .filter((record) => record.status === 'active' && record.areaCode === areaCode && Number(record.floor) === Number(floor))
      .map((record) => record.roomUid)
  ).size;
}

function normalFloorCount() {
  return new Set(
    finishRecordStore.getAll()
      .filter((record) => record.status === 'active' && record.areaCode === 'I')
      .map((record) => Number(record.floor))
  ).size;
}

function snapshotRoomCount(snapshot, areaCode, floor) {
  return new Set(
    (snapshot?.finishRecords || [])
      .filter((record) => record.status === 'active' && record.areaCode === areaCode && Number(record.floor) === Number(floor))
      .map((record) => record.roomUid)
  ).size;
}

function snapshotNormalFloorCount(snapshot) {
  return new Set(
    (snapshot?.finishRecords || [])
      .filter((record) => record.status === 'active' && record.areaCode === 'I')
      .map((record) => Number(record.floor))
  ).size;
}

function photoCount() {
  return photoRecordStore.getAll().filter((record) => !record.deleted).length;
}

function snapshotPhotoCount(snapshot) {
  return (snapshot?.photoRecords || []).filter((record) => !record.deleted).length;
}

function cameraClosed() {
  return !document.body.classList.contains('camera-open');
}

export const TUTORIAL_STEPS = [
  {
    id: 'tutorial-intro',
    section: 'はじめに',
    tab: 'finish',
    title: '操作チュートリアル',
    text: '実際の画面を使って、仕上表 → 建材リスト → 写真 → 出力の基本操作を確認します。練習案件なので実案件のデータは変更しません。'
  },
  {
    id: 'finish-room-name',
    section: '仕上表',
    tab: 'finish',
    title: '1-1の部屋名',
    text: '部屋名を入力します。内容は自由です。部屋名の表示部分を押すと入力できます。',
    target: () => roomBlock(0)?.querySelector('[data-field="room-name"]'),
    interactive: true,
    allowed: () => roomBlock(0)?.querySelector('[data-field="room-name"]'),
    completeWhen: () => Boolean(String(firstRoomName()).trim())
  },
  {
    id: 'finish-new-floor-material',
    section: '仕上表',
    tab: 'finish',
    title: '1-1 床：新規建材',
    text: '1-1の「床」に建材名称を入力し、新しい建材として登録します。建材名は自由です。',
    target: () => registerButton(0, 1, 1) || finishCell(0, 1, 'name', 1),
    interactive: true,
    allowed: () => newMaterialAllowed(0, 1),
    completeWhen: () => Boolean(finishRecordFor(0, 1, 1)?.materialId)
  },
  {
    id: 'finish-new-other-material',
    section: '仕上表',
    tab: 'finish',
    title: '1-1 その他1：新規建材',
    text: 'その他1では、先に部位を入力してから建材名称を登録します。部位・建材名は自由です。',
    target: () => {
      const record = finishRecordFor(0, 5, 1);
      if (!String(record?.part || '').trim()) return finishCell(0, 5, 'part', 1);
      return registerButton(0, 5, 1) || finishCell(0, 5, 'name', 1);
    },
    interactive: true,
    allowed: () => newMaterialAllowed(0, 5, { requirePart:true }),
    completeWhen: () => {
      const record = finishRecordFor(0, 5, 1);
      return Boolean(record?.materialId && String(record.part || '').trim());
    }
  },
  {
    id: 'finish-existing-floor-material',
    section: '仕上表',
    tab: 'finish',
    title: '1-2 床：既存建材',
    text: '1-1で登録した床の建材を、候補から1-2の床へ入力します。',
    target: () => finishCell(1, 1, 'name', 1),
    interactive: true,
    allowed: () => finishCell(1, 1, 'name', 1),
    completeWhen: () => Boolean(finishRecordFor(1, 1, 1)?.materialId)
  },
  {
    id: 'finish-existing-other-material',
    section: '仕上表',
    tab: 'finish',
    title: '1-2 その他1：既存建材',
    text: '1-1で登録した「その他」の建材を候補から選びます。登録済みの部位も確認します。',
    target: () => finishCell(1, 5, 'name', 1),
    interactive: true,
    allowed: () => finishCell(1, 5, 'name', 1),
    completeWhen: () => Boolean(finishRecordFor(1, 5, 1)?.materialId)
  },
  {
    id: 'finish-add-row',
    section: '仕上表',
    tab: 'finish',
    title: '1-2に行を追加',
    text: '同じ部屋・同じ部位に複数の仕上がある場合は「＋行」で入力行を増やせます。',
    target: () => roomAction(1, 'add-row'),
    interactive: true,
    allowed: () => roomAction(1, 'add-row'),
    completeWhen: ({ snapshot }) => {
      const key = roomKeyAt(1);
      const before = (snapshot?.finishRecords || []).filter((record) => String(record.roomUid || '') === key).length;
      const after = finishRecordStore.getAll().filter((record) => String(record.roomUid || '') === key).length;
      return after > before;
    }
  },
  {
    id: 'finish-add-room',
    section: '仕上表',
    tab: 'finish',
    title: '1Fに部屋を追加',
    text: '1Fの一番下にある「＋部屋」で部屋を追加します。練習案件では1-6が追加されます。',
    target: () => lastFirstFloorAction('add-room'),
    interactive: true,
    allowed: () => lastFirstFloorAction('add-room'),
    completeWhen: ({ snapshot }) => activeFinishRoomCount('I', 1) > snapshotRoomCount(snapshot, 'I', 1)
  },
  {
    id: 'finish-add-floor',
    section: '仕上表',
    tab: 'finish',
    title: '階を追加',
    text: '仕上表の一番下にある「＋階」から次の地上階を追加します。操作パネルから追加する方法は操作ガイドで案内します。',
    target: () => document.querySelector('#finish [data-action="add-normal-floor"]'),
    interactive: true,
    allowed: () => document.querySelector('#finish [data-action="add-normal-floor"]'),
    completeWhen: ({ snapshot }) => normalFloorCount() > snapshotNormalFloorCount(snapshot)
  },
  {
    id: 'materials-open',
    section: '建材リスト',
    tab: 'materials',
    title: '建材リストを確認',
    text: '仕上表で登録した建材が建材リストへ反映されます。ここで分析の要否・採取設定・備考などを管理します。',
    target: () => document.querySelector('#materials [data-material-row]')
  },
  {
    id: 'materials-analysis-required',
    section: '建材リスト',
    tab: 'materials',
    title: '分析の要否',
    text: '採取する建材は「採取・分析」を使用します。目視・みなし・対象外にすると採取設定は使用しません。',
    target: () => firstMaterialControl('analysisRequired')
  },
  {
    id: 'materials-sample-count',
    section: '建材リスト',
    tab: 'materials',
    title: '採取数',
    text: '採取する箇所数を設定します。チュートリアルでは2箇所にすると、採取場所2まで入力できます。',
    target: () => firstMaterialFieldTarget('sampleCount'),
    interactive: true,
    allowed: () => firstMaterialFieldTarget('sampleCount'),
    completeWhen: () => Number(firstMaterial()?.sampleCount || 0) === 2
  },
  {
    id: 'materials-sample-place',
    section: '建材リスト',
    tab: 'materials',
    title: '採取場所',
    text: '仕上表の使用箇所から採取場所を選びます。採取数に応じて採取場所1〜3を設定します。',
    target: () => firstMaterialFieldTarget('sampleLocation1'),
    interactive: true,
    allowed: () => firstMaterialFieldTarget('sampleLocation1'),
    completeWhen: () => Boolean(String(firstMaterial()?.sampleLocation1 || '').trim())
  },
  {
    id: 'materials-sample-part',
    section: '建材リスト',
    tab: 'materials',
    title: '採取部位',
    text: '建材の使用部位から、実際に採取する部位を選択します。複数選択もできます。',
    target: () => firstMaterialMultiSelectTarget(),
    interactive: true,
    allowed: () => firstMaterialMultiSelectTarget(),
    completeWhen: () => Array.isArray(firstMaterial()?.samplePart) && firstMaterial().samplePart.length > 0
  },
  {
    id: 'materials-note',
    section: '建材リスト',
    tab: 'materials',
    title: '調査備考',
    text: '必要な補足は調査備考へ入力します。内容は自由です。',
    target: () => firstMaterialTextTarget('note'),
    interactive: true,
    allowed: () => firstMaterialTextTarget('note'),
    completeWhen: () => Boolean(String(firstMaterial()?.note || '').trim())
  },
  {
    id: 'materials-sample-finish',
    section: '建材リスト',
    tab: 'materials',
    title: '採取チェック・採取日',
    text: '採取が終わったらチェックと採取日を記録します。レベルは分析結果に伴うため、ここでは操作しません。',
    target: () => firstMaterial()?.sampleDone
      ? firstMaterialFieldTarget('sampleDate')
      : firstMaterialFieldTarget('sampleDone'),
    interactive: true,
    allowed: () => firstMaterial()?.sampleDone
      ? firstMaterialFieldTarget('sampleDate')
      : firstMaterialFieldTarget('sampleDone'),
    completeWhen: () => Boolean(firstMaterial()?.sampleDone && String(firstMaterial()?.sampleDate || '').trim())
  },
  {
    id: 'photos-visual',
    section: '写真',
    tab: 'photos',
    title: '目視写真',
    text: '目視調査では左から場所を選び、右側の部位ごとの「＋」からカメラを起動します。',
    target: () => document.querySelector('#photos [data-photo-camera-visual]')
      || document.querySelector('#photos [data-photo-camera-global]'),
    interactive: true,
    allowed: () => document.querySelector('#photos [data-photo-camera-visual]')
      || document.querySelector('#photos [data-photo-camera-global]'),
    completeWhen: ({ snapshot }) => cameraClosed() && photoCount() > snapshotPhotoCount(snapshot)
  },
  {
    id: 'photos-sampling-mode',
    section: '写真',
    tab: 'photos',
    title: '建材採取へ切替',
    text: '採取写真は「建材採取」に切り替えます。建材リストの採取数・採取場所・採取部位がここへ反映されます。',
    target: () => document.querySelector('#photos [data-photo-mode="sampling"]'),
    interactive: true,
    allowed: () => document.querySelector('#photos [data-photo-mode="sampling"]'),
    completeWhen: () => document.querySelector('#photos [data-photo-mode="sampling"]')?.classList.contains('active')
  },
  {
    id: 'photos-sampling-before',
    section: '写真',
    tab: 'photos',
    title: '施工前を撮影',
    text: '対象建材・採取箇所を確認し、まず「施工前」の＋から撮影します。カメラ内の詳しい案内は看板カメラ側のチュートリアル方式を後続で統合します。',
    target: () => document.querySelector('#photos [data-photo-camera-sampling-stage][data-photo-stage="before"]')
      || document.querySelector('#photos [data-photo-mode="sampling"]'),
    interactive: true,
    allowed: () => document.querySelector('#photos [data-photo-camera-sampling-stage][data-photo-stage="before"]'),
    completeWhen: ({ snapshot }) => cameraClosed() && photoCount() > snapshotPhotoCount(snapshot)
  },
  {
    id: 'photos-sampling-section',
    section: '写真',
    tab: 'photos',
    title: '断面を撮影',
    text: '同じ採取箇所で「断面」も撮影します。施工中・施工後も同じ撮影区分の切替で登録できます。',
    target: () => document.querySelector('#photos [data-photo-camera-sampling-stage][data-photo-stage="section"]')
      || document.querySelector('#photos [data-photo-mode="sampling"]'),
    interactive: true,
    allowed: () => document.querySelector('#photos [data-photo-camera-sampling-stage][data-photo-stage="section"]'),
    completeWhen: ({ snapshot }) => cameraClosed() && photoCount() > snapshotPhotoCount(snapshot)
  },
  {
    id: 'analysis-placeholder',
    section: '分析結果',
    title: '分析結果',
    text: '現在は案件内のPDFから分析結果を読み取って反映しています。取り込み仕様の詳細が確定したら、この位置へ実操作ステップを差し替えます。'
  },
  {
    id: 'output-materials',
    section: '出力',
    tab: 'sync',
    title: '出力プレビュー',
    text: '出力タブでは、実際に出力するPDFをプレビューできます。まず建材リストの内容を確認します。',
    target: () => document.querySelector('#sync [data-output-view="materials"]')
      || document.querySelector('#sync [data-output-pdf-host]')
  },
  {
    id: 'output-views',
    section: '出力',
    tab: 'sync',
    title: '出力内容を切替',
    text: '建材リスト・部屋別リスト・建材写真帳・採取写真帳を切り替えて内容を確認できます。',
    target: () => document.querySelector('#sync .output-toolbar')
  },
  {
    id: 'output-zoom',
    section: '出力',
    tab: 'sync',
    title: 'ページと拡大表示',
    text: '前後ページとズームを使って出力内容を確認します。100%は表示領域へA4全体が収まる倍率です。',
    target: () => document.querySelector('#sync [data-output-zoom-reset]')
  },
  {
    id: 'output-settings',
    section: '出力',
    tab: 'sync',
    title: '出力設定',
    text: '出力設定から帳票の表示内容を変更できます。基本チュートリアルでは設定項目の詳細までは変更しません。',
    target: () => document.querySelector('#sync [data-output-settings-open]')
  },
  {
    id: 'output-pdf',
    section: '出力',
    tab: 'sync',
    title: 'PDF出力',
    text: '内容を確認したらPDFから出力します。印刷・Excelは操作ガイドで確認できます。',
    target: () => document.querySelector('#sync [data-output-export="pdf"]')
  },
  {
    id: 'tutorial-done',
    section: '完了',
    title: '基本操作は完了です',
    text: '仕上表 → 建材リスト → 写真 → 出力の基本的な流れは以上です。効率操作や詳細機能は「操作ガイド」へ追加していきます。'
  }
];

export const OPERATION_GUIDE_STEPS = [
  {
    id: 'guide-finish',
    section: '操作ガイド',
    tab: 'finish',
    title: '仕上表',
    text: '部屋名、新規/既存建材、その他建材、行・部屋・階追加が基本操作です。コピー・チップ入力・簡易リスト・カラー表示は効率操作として後続で詳しく追加します。',
    target: () => document.querySelector('#finish .finish-toolbar') || document.getElementById('finish')
  },
  {
    id: 'guide-materials',
    section: '操作ガイド',
    tab: 'materials',
    title: '建材リスト',
    text: '分析の要否、採取数、採取場所、採取部位、調査備考、採取チェック、採取日を管理します。統合・削除は詳細ガイドへ追加します。',
    target: () => document.querySelector('#materials .material-list-toolbar') || document.getElementById('materials')
  },
  {
    id: 'guide-photos',
    section: '操作ガイド',
    tab: 'photos',
    title: '写真',
    text: '目視調査と建材採取を切り替えて撮影します。採取写真では施工前・施工中・施工後・断面を区分して管理します。',
    target: () => document.querySelector('#photos .photo-mode-sticky') || document.getElementById('photos')
  },
  {
    id: 'guide-output',
    section: '操作ガイド',
    tab: 'sync',
    title: '出力',
    text: '建材リスト、部屋別リスト、建材写真帳、採取写真帳をプレビューし、PDF・印刷・Excelへ出力できます。',
    target: () => document.querySelector('#sync .output-toolbar') || document.getElementById('sync')
  }
];
