/**
 * src/js/guide/guide-data.js
 *
 * 現在実装済みの基本チュートリアル（仕上表セクション）と
 * 操作ガイドの表示内容・対象・許可操作・完了条件を定義する。
 */
import * as finishRecordStore from '../store/finish-record-store.js';

function roomBlock(index) {
  return document.querySelectorAll('#finish .finish-room-block')[index] || null;
}

function roomKeyAt(index) {
  return String(roomBlock(index)?.dataset.roomKey || '');
}

function roomFieldTarget(roomIndex, field) {
  return roomBlock(roomIndex)?.querySelector(
    `[data-field="${field}"]`
  )?.closest('.finish-meta') || null;
}

function finishCell(roomIndex, partIndex, kind = 'name', row = 1) {
  const room = roomBlock(roomIndex);
  return room?.querySelector(
    `[data-part-index="${partIndex}"][data-input-row="${row}"] [data-kind="${kind}"]`
  ) || null;
}

function finishCellTarget(roomIndex, partIndex, kind = 'name', row = 1) {
  return finishCell(roomIndex, partIndex, kind, row)?.closest('.finish-data-cell') || null;
}

function roomAction(roomIndex, action) {
  return roomBlock(roomIndex)?.querySelector(`[data-action="${action}"]`) || null;
}

function lastFirstFloorAction(action) {
  const rooms = [...document.querySelectorAll('#finish .finish-room-block')];
  const firstFloorRooms = rooms.filter((room) =>
    room.querySelector('[data-action="add-room"]')?.dataset.floorKey === 'floor-I-1'
  );
  const last = firstFloorRooms[firstFloorRooms.length - 1] || null;
  return last?.querySelector(`[data-action="${action}"]`) || null;
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

function firstRoomName() {
  const key = roomKeyAt(0);
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && String(record.roomUid || '') === key
  )?.roomName || '';
}

function activeFinishRoomCount(areaCode, floor) {
  return new Set(
    finishRecordStore.getAll()
      .filter((record) =>
        record.status === 'active'
        && record.areaCode === areaCode
        && Number(record.floor) === Number(floor)
      )
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
      .filter((record) =>
        record.status === 'active'
        && record.areaCode === areaCode
        && Number(record.floor) === Number(floor)
      )
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

export const TUTORIAL_STEPS = [
  {
    id: 'tutorial-intro',
    section: 'はじめに',
    tab: 'finish',
    title: '操作チュートリアル',
    text: 'まず仕上表の基本操作を練習します。練習案件なので実案件のデータは変更しません。'
  },
  {
    id: 'finish-room-name',
    section: '仕上表',
    tab: 'finish',
    title: '1-1の部屋名',
    text: '部屋名を入力します。内容は自由です。部屋名の表示部分を押すと入力できます。',
    target: () => roomFieldTarget(0, 'room-name'),
    interactive: true,
    permissions: () => [{
      actionId: 'finish.room-field.edit',
      context: { roomKey: roomKeyAt(0), field: 'room-name' }
    }],
    completeWhen: () => Boolean(String(firstRoomName()).trim())
  },
  {
    id: 'finish-new-floor-material',
    section: '仕上表',
    tab: 'finish',
    title: '1-1 床：新規建材',
    text: '1-1の「床」に建材名称を入力し、新しい建材として登録します。建材名は自由です。',
    target: () => finishCellTarget(0, 1, 'name', 1),
    interactive: true,
    permissions: () => {
      const context = { roomKey: roomKeyAt(0), partIndex: 1, row: 1 };
      return [
        { actionId: 'finish.material.edit', context: { ...context, kind: 'name' } },
        { actionId: 'finish.material.candidate', context: { ...context, kind: 'name' } },
        { actionId: 'finish.material.register', context }
      ];
    },
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
      const kind = String(record?.part || '').trim() ? 'name' : 'part';
      return finishCellTarget(0, 5, kind, 1);
    },
    interactive: true,
    permissions: () => {
      const record = finishRecordFor(0, 5, 1);
      const context = { roomKey: roomKeyAt(0), partIndex: 5, row: 1 };
      const rules = [
        { actionId: 'finish.material.part.edit', context: { ...context, kind: 'part' } },
        { actionId: 'finish.material.candidate', context: { ...context, kind: 'part' } }
      ];
      if (String(record?.part || '').trim()) {
        rules.push(
          { actionId: 'finish.material.edit', context: { ...context, kind: 'name' } },
          { actionId: 'finish.material.candidate', context: { ...context, kind: 'name' } },
          { actionId: 'finish.material.register', context }
        );
      }
      return rules;
    },
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
    target: () => finishCellTarget(1, 1, 'name', 1),
    interactive: true,
    permissions: () => {
      const context = { roomKey: roomKeyAt(1), partIndex: 1, row: 1, kind: 'name' };
      return [
        { actionId: 'finish.material.edit', context },
        { actionId: 'finish.material.candidate', context }
      ];
    },
    completeWhen: () => Boolean(finishRecordFor(1, 1, 1)?.materialId)
  },
  {
    id: 'finish-existing-other-material',
    section: '仕上表',
    tab: 'finish',
    title: '1-2 その他1：既存建材',
    text: '1-1で登録した「その他」の建材を候補から選びます。登録済みの部位も確認します。',
    target: () => finishCellTarget(1, 5, 'name', 1),
    interactive: true,
    permissions: () => {
      const context = { roomKey: roomKeyAt(1), partIndex: 5, row: 1 };
      return [
        { actionId: 'finish.material.edit', context: { ...context, kind: 'name' } },
        { actionId: 'finish.material.candidate', context: { ...context, kind: 'name' } }
      ];
    },
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
    permissions: () => [{
      actionId: 'finish.row.add',
      context: { roomKey: roomKeyAt(1) }
    }],
    completeWhen: ({ snapshot }) => {
      const key = roomKeyAt(1);
      const before = (snapshot?.finishRecords || [])
        .filter((record) => String(record.roomUid || '') === key).length;
      const after = finishRecordStore.getAll()
        .filter((record) => String(record.roomUid || '') === key).length;
      return after > before;
    }
  },
  {
    id: 'finish-add-room',
    section: '仕上表',
    tab: 'finish',
    title: '1Fに部屋を追加',
    text: '1Fの一番下にある「＋部屋」で部屋を追加します。',
    target: () => lastFirstFloorAction('add-room'),
    interactive: true,
    permissions: () => [{
      actionId: 'finish.room.add',
      context: { floorKey: 'floor-I-1' }
    }],
    completeWhen: ({ snapshot }) =>
      activeFinishRoomCount('I', 1) > snapshotRoomCount(snapshot, 'I', 1)
  },
  {
    id: 'finish-add-floor',
    section: '仕上表',
    tab: 'finish',
    title: '階を追加',
    text: '仕上表の一番下にある「＋階」から次の地上階を追加します。',
    target: () => document.querySelector('#finish [data-action="add-normal-floor"]'),
    interactive: true,
    permissions: () => [{
      actionId: 'finish.floor.add',
      context: { kind: 'normal' }
    }],
    completeWhen: ({ snapshot }) =>
      normalFloorCount() > snapshotNormalFloorCount(snapshot)
  },
  {
    id: 'finish-tutorial-done',
    section: '仕上表',
    tab: 'finish',
    title: '仕上表の基本操作は完了です',
    text: '仕上表セクションはここまでです。建材リスト以降は次のセクションで順に追加します。'
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
