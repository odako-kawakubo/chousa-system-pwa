/**
 * src/js/app-update.js
 *
 * サーバー上の version.json と現在の appConfig.version を比較し、
 * 必要に応じてアプリ本体だけを再読み込みする。
 *
 * v0.1.5.7:
 * ・既存の version.json / appConfig.version 比較ロジックは変更しない。
 * ・利用者向け表記を「現在 / 最新 / アップデート」に統一する。
 * ・確認時点では再読み込みせず、差分がある場合だけ
 *   「キャンセル / アップデート」を表示する。
 *
 * アップデート時に扱うもの：
 * ・過去バージョン由来の Service Worker 登録解除
 * ・Cache Storage の削除
 * ・通常の location.reload() によるページ再読み込み
 *
 * アップデート時に扱わないもの：
 * ・localStorage
 * ・IndexedDB
 * ・案件データ / 写真データ
 *
 * 現行版は Service Worker を登録していないため、SW解除は過去バージョンの
 * 残留物を掃除するためだけに残している。
 */

import { appConfig } from '../config/app-config.js';
import { openModal, closeModal } from './ui/modal.js';

const UPDATE_MODAL_ID = 'updateModal';
const UPDATE_VERIFY_KEY = 'chousaAppExpectedVersionAfterReload';

const UPDATE_FAILURE_MESSAGE = [
  'アップデートを確認できませんでした。',
  '',
  'Safariでこのアプリを直接開いて、もう一度アップデートしてください。',
  'それでも切り替わらない場合は、',
  'ホーム画面のアプリを削除して追加し直してください。'
].join('\n');

/**
 * キャッシュを使わず version.json を取得する。
 *
 * @returns {Promise<Object>}
 */
export async function fetchLatestVersionInfo() {
  try {
    const response = await fetch(`./version.json?ts=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`version.json fetch failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn('最新バージョンを取得できませんでした', error);
    return {
      version: appConfig.version,
      fetchFailed: true
    };
  }
}

/**
 * 更新モーダルの操作ボタンを確認結果に合わせて整える。
 * 比較判定は showUpdatePrompt() の既存 version 比較結果だけを受け取る。
 *
 * @param {{ canUpdate:boolean }} state
 */
function renderUpdateActions({ canUpdate }) {
  const closeButton = document.getElementById('closeAppUpdateButton');
  const updateButton = document.getElementById('confirmAppUpdateButton');

  if (closeButton) {
    closeButton.textContent = canUpdate ? 'キャンセル' : '閉じる';
  }

  if (updateButton) {
    updateButton.hidden = !canUpdate;
    updateButton.disabled = false;
  }
}

/**
 * アップデート確認モーダルを開き、サーバー上の最新バージョンを確認する。
 * 判定基準は従来どおり version.json と appConfig.version の完全一致比較のみ。
 */
export async function showUpdatePrompt() {
  const message = document.getElementById('updateMessage');

  if (message) {
    message.innerHTML =
      `現在：v${appConfig.version}<br>` +
      `最新バージョンを確認しています...`;
  }

  renderUpdateActions({ canUpdate: false });
  openModal(UPDATE_MODAL_ID);

  const info = await fetchLatestVersionInfo();
  const latest = String(info.version || appConfig.version);

  if (!message) return;

  if (info.fetchFailed) {
    message.innerHTML =
      `現在：v${appConfig.version}<br><br>` +
      `最新バージョンを確認できませんでした。<br>` +
      `通信状態を確認して、もう一度お試しください。`;
    renderUpdateActions({ canUpdate: false });
    return;
  }

  // v0.1.5.6Eからの判定ロジックをそのまま使用する。
  const isLatest = latest === appConfig.version;

  if (isLatest) {
    message.innerHTML =
      `現在：v${appConfig.version}<br>` +
      `最新：v${latest}<br><br>` +
      `<b>最新の状態です。</b>`;
    renderUpdateActions({ canUpdate: false });
    return;
  }

  message.innerHTML =
    `現在：v${appConfig.version}<br>` +
    `最新：v${latest}<br><br>` +
    `<b>アップデートできます。</b>`;
  renderUpdateActions({ canUpdate: true });
}

/**
 * 過去バージョン由来のアプリ配信キャッシュだけを掃除する。
 *
 * 現行アプリは Service Worker を登録していないが、以前の版で登録された
 * Service Worker が端末に残っている可能性があるため unregister は残す。
 * IndexedDB / localStorage には一切触れない。
 */
async function clearLegacyAppCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister().catch(() => false))
      );
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName).catch(() => false))
      );
    }
  } catch (error) {
    console.warn('過去のアプリキャッシュを一部削除できませんでした', error);
  }
}

/**
 * 最新バージョンを確認したうえで、アプリ本体を通常の reload で再読み込みする。
 *
 * 再読込前に期待する最新バージョンを sessionStorage へ一時保存する。
 * 次の起動時に verifyPendingAppUpdate() が appConfig.version と照合する。
 * sessionStorage はこのアップデート確認用の一時キーだけを使用し、案件データ領域には触れない。
 */
export async function reloadLatestApp() {
  const latestInfo = await fetchLatestVersionInfo();

  if (latestInfo.fetchFailed) {
    sessionStorage.removeItem(UPDATE_VERIFY_KEY);
  } else {
    sessionStorage.setItem(
      UPDATE_VERIFY_KEY,
      String(latestInfo.version || appConfig.version)
    );
  }

  await clearLegacyAppCaches();

  // URLにタイムスタンプを付けず、ブラウザ標準の再読み込みだけを行う。
  location.reload();
}

/**
 * アップデート後の起動時に「期待したバージョンへ切り替わったか」を自己検証する。
 *
 * ・期待版と現在版が一致：成功として一時キーを消す
 * ・不一致：自動再試行せず、ユーザーへ次の行動を案内する
 */
async function verifyPendingAppUpdate() {
  const expectedVersion = sessionStorage.getItem(UPDATE_VERIFY_KEY);
  if (!expectedVersion) return;

  // 一度だけ検証する。失敗しても自動リトライしない。
  sessionStorage.removeItem(UPDATE_VERIFY_KEY);

  const latestInfo = await fetchLatestVersionInfo();
  const latestVersion = String(latestInfo.version || expectedVersion);
  const currentVersion = String(appConfig.version || '');

  if (!latestInfo.fetchFailed && currentVersion === latestVersion) {
    return;
  }

  const message = document.getElementById('updateMessage');

  if (message) {
    message.innerHTML = UPDATE_FAILURE_MESSAGE
      .split('\n')
      .map((line) => line || '&nbsp;')
      .join('<br>');
  }

  // 失敗時は同じ画面から自動再試行させない。
  renderUpdateActions({ canUpdate: false });
  openModal(UPDATE_MODAL_ID);
}

/**
 * 「アップデートを確認」ボタンとアップデート実行ボタンを配線する。
 */
export function bindAppUpdateEvents() {
  const openButton = document.getElementById('showUpdatePromptButton');
  const confirmButton = document.getElementById('confirmAppUpdateButton');

  openButton?.addEventListener('click', () => {
    showUpdatePrompt();
  });

  confirmButton?.addEventListener('click', async () => {
    confirmButton.disabled = true;
    await reloadLatestApp();
  });

  document.querySelectorAll('[data-update-modal-close]').forEach((element) => {
    element.addEventListener('click', () => closeModal(UPDATE_MODAL_ID));
  });

  // reload後だけ、前回アップデートの成否を1回だけ自己検証する。
  verifyPendingAppUpdate();
}
