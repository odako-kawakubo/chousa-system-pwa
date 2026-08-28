/** ヘッダーのFirestore通信ランプ／同期状態表示を同期状態Storeへ接続する。 */
import { subscribeSyncStatus } from '../sync/sync-status.js';

let unsubscribe = null;

function render(status) {
  const dot = document.getElementById('onlinePill');
  const label = document.getElementById('firebasePill');
  if (!dot || !label) return;

  dot.className = `connection-dot ${status.lamp}${status.blinking ? ' blinking' : ''}`;
  dot.title = `Firestore：${status.text}`;
  dot.setAttribute('aria-label', `Firestore ${status.text}`);

  label.textContent = status.text;
  label.className = `pill header-sync-state sync-${status.lamp}`;
}

export function bindSyncStatusUi() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeSyncStatus(render);
}
