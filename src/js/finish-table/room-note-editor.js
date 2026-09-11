/**
 * src/js/finish-table/room-note-editor.js
 * 部屋備考の小型ポップアップ編集。
 * roomNoteの保存自体は既存のcommitRoomField()へ一本化する。
 */
import { commitRoomField, finishRecordStore } from './finish-table-actions.js';
import { refreshFinishTableFromStores } from './finish-table-controller.js';

let initialized = false;
let editingRoomKey = '';

function ensureStyles() {
  if (document.querySelector('link[data-room-note-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './css/room-note.css';
  link.dataset.roomNoteStyles = '1';
  document.head.appendChild(link);
}

function roomAnchor(roomKey) {
  return finishRecordStore.getAll().find((record) =>
    record.status === 'active' && String(record.roomUid || '') === String(roomKey || '')
  ) || null;
}

function ensureModal() {
  let modal = document.getElementById('roomNoteModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'roomNoteModal';
  modal.className = 'finish-confirm-modal room-note-modal';
  modal.innerHTML = `
    <div class="finish-confirm-card room-note-card" role="dialog" aria-modal="true" aria-labelledby="roomNoteTitle">
      <div class="room-note-head">
        <strong id="roomNoteTitle">部屋備考</strong>
        <span class="room-note-room" id="roomNoteRoomLabel"></span>
      </div>
      <textarea id="roomNoteInput" class="room-note-textarea" rows="5" placeholder="部屋の備考を入力"></textarea>
      <div class="finish-confirm-actions">
        <button type="button" class="btn small" id="roomNoteCancel">キャンセル</button>
        <button type="button" class="btn small primary" id="roomNoteSave">保存</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.classList.remove('open');
    editingRoomKey = '';
  };
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  modal.querySelector('.room-note-card')?.addEventListener('click', (event) => event.stopPropagation());
  modal.querySelector('#roomNoteCancel')?.addEventListener('click', close);
  modal.querySelector('#roomNoteSave')?.addEventListener('click', () => {
    if (!editingRoomKey) return close();
    const value = modal.querySelector('#roomNoteInput')?.value ?? '';
    commitRoomField(editingRoomKey, 'room-note', value);
    refreshFinishTableFromStores();
    close();
  });
  return modal;
}

function openRoomNote(roomKey) {
  const anchor = roomAnchor(roomKey);
  if (!anchor) return;
  editingRoomKey = String(roomKey || '');
  const modal = ensureModal();
  const label = modal.querySelector('#roomNoteRoomLabel');
  const input = modal.querySelector('#roomNoteInput');
  if (label) label.textContent = [anchor.roomNo, anchor.roomName].filter(Boolean).join(' / ');
  if (input) input.value = String(anchor.roomNote || '');
  modal.classList.add('open');
  requestAnimationFrame(() => input?.focus());
}

export function initializeRoomNoteEditor() {
  if (initialized) return;
  initialized = true;
  ensureStyles();
  const root = document.getElementById('finish');
  if (!root) return;

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit-room-note"]');
    if (!button) return;
    openRoomNote(button.dataset.roomKey);
  });
}
