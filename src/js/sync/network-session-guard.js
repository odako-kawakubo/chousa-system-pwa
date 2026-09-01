/**
 * 物理的な通信復帰時、Firestoreの差分回収より先に現在の3レコードを
 * 案件Storeへ確定保存する。
 *
 * 圏外中の編集は正式Storeと未送信キューに残るため、復帰処理が古い案件
 * スナップショットを参照して現在画面を巻き戻さないようにする。
 */
import { saveCurrentProjectSession } from '../projects/project-session.js';

export function initializeNetworkSessionGuard() {
  if (document.documentElement.dataset.networkSessionGuardBound === '1') return;
  document.documentElement.dataset.networkSessionGuardBound = '1';

  window.addEventListener('online', () => {
    saveCurrentProjectSession();
  });
}
