/**
 * src/js/app-update.js
 *
 * サーバー上の version.json と現在の appConfig.version を比較し、
 * 必要に応じてアプリ本体だけを再読み込みする。
 *
 * 更新時に扱うもの：
 * ・過去バージョン由来の Service Worker 登録解除
 * ・Cache Storage の削除
 * ・通常の location.reload() によるページ再読み込み
 *
 * 更新時に扱わないもの：
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
  '最新版への更新を確認できませんでした。',
  '',
  'Safariでこのアプリを直接開いて更新してください。',
  'それでも更新されない場合は、',
  'ホーム画面のアイコンを削除して追加し直してください。'
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
    console.warn('最新版情報を取得できませんでした', error);
    return {
      version: appConfig.version,
      fetchFailed: true
    };
  }
}

/**
 * 更新確認モーダルを開き、サーバー上の最新版を確認する。
 */
export async function showUpdatePrompt() {
  const message = document.getElementById('updateMessage');
  const updateButton = document.getElementById('confirmAppUpdateButton');

  if (message) {
    message.innerHTML = `現在のバージョン：v${appConfig.version}<br>最新版を確認しています...`;
  }

  if (updateButton) {
    updateButton.disabled = false;
  }

  openModal(UPDATE_MODAL_ID);

  const info = await fetchLatestVersionInfo();
  const latest = String(info.version || appConfig.version);

  if (!message) return;

  if (info.fetchFailed) {
    message.innerHTML =
      `現在のバージョン：v${appConfig.version}<br>` +
      `最新版情報を取得できませんでした。<br>` +
      `アプリ本体を再読み込みしますか？`;
    return;
  }

  message.innerHTML = latest === appConfig.version
    ? `現在のバージョン：v${appConfig.version}<br>最新版：v${latest}<br><b>最新版です。</b><br>アプリ本体を再読み込みしますか？`
    : `現在のバージョン：v${appConfig.version}<br>最新版：v${latest}<br><b>更新があります。</b><br>最新版へ更新しますか？`;
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
 * 最新版を確認したうえで、アプリ本体を通常の reload で再読み込みする。
 *
 * 再読込前に期待する最新版を sessionStorage へ一時保存する。
 * 次の起動時に verifyPendingAppUpdate() が appConfig.version と照合する。
 * sessionStorage はこの更新確認用の一時キーだけを使用し、案件データ領域には触れない。
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
 * 更新後の起動時に「本当に最新版へ切り替わったか」を自己検証する。
 *
 * ・期待版と現在版が一致：更新成功として一時キーを消す
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
  const updateButton = document.getElementById('confirmAppUpdateButton');

  if (message) {
    message.innerHTML = UPDATE_FAILURE_MESSAGE
      .split('\n')
      .map((line) => line || '&nbsp;')
      .join('<br>');
  }

  // 失敗時は同じ画面から自動再試行させない。
  if (updateButton) {
    updateButton.disabled = true;
  }

  openModal(UPDATE_MODAL_ID);
}

/**
 * 「最新版に更新」ボタンと更新確定ボタンを配線する。
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

  // reload後だけ、前回更新の成否を1回だけ自己検証する。
  verifyPendingAppUpdate();
}
