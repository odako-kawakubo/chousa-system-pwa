/**
 * src/js/app-update.js
 *
 * サーバー上の version.json と現在の appConfig.version を比較し、
 * 必要に応じてアプリ本体のキャッシュを破棄して最新版を再取得する。
 * localStorage / sessionStorage / IndexedDB 等の案件データ領域は削除しない。
 */

import { appConfig } from '../config/app-config.js';
import { openModal, closeModal } from './ui/modal.js';

const UPDATE_MODAL_ID = 'updateModal';

function buildStampedUrl(path = './app.html') {
  const url = new URL(path, location.href);
  url.searchParams.set('v', Date.now());
  return url.toString();
}

/**
 * キャッシュを使わず version.json を取得する。
 * 取得に失敗した場合は、現在実行中のバージョンを返して更新操作自体は利用可能にする。
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
      app: 'app.html',
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
    updateButton.dataset.appPath = 'app.html';
    updateButton.disabled = false;
  }

  openModal(UPDATE_MODAL_ID);

  const info = await fetchLatestVersionInfo();
  const latest = String(info.version || appConfig.version);
  const appPath = String(info.app || 'app.html').replace(/^\.\//, '');

  if (updateButton) {
    updateButton.dataset.appPath = appPath;
  }

  if (!message) return;

  if (info.fetchFailed) {
    message.innerHTML =
      `現在のバージョン：v${appConfig.version}<br>` +
      `最新版情報を取得できませんでした。<br>` +
      `アプリ本体キャッシュを削除して再読み込みしますか？`;
    return;
  }

  message.innerHTML = latest === appConfig.version
    ? `現在のバージョン：v${appConfig.version}<br>最新版：v${latest}<br><b>最新版です。</b><br>アプリ本体キャッシュを削除して再読み込みしますか？`
    : `現在のバージョン：v${appConfig.version}<br>最新版：v${latest}<br><b>更新があります。</b><br>アプリ本体キャッシュを削除して開きますか？`;
}

/**
 * Service Worker登録とCache Storageだけを破棄し、タイムスタンプ付きURLで
 * app.htmlを再取得する。IndexedDB / localStorage等の案件データは削除しない。
 * JS / CSSの最新版確認はFirebase Hosting側のCache-Controlに任せる。
 */
export async function reloadLatestApp(appPath = 'app.html') {
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
    console.warn('アプリ本体キャッシュの削除を一部実行できませんでした', error);
  }

  // 履歴に旧版URLを積まず、タイムスタンプ付きapp.htmlへ置き換える。
  // Firebase Hosting側のCache-Controlにより、HTML / JS / CSSは最新版を再検証する。
  location.replace(buildStampedUrl(`./${String(appPath || 'app.html').replace(/^\.\//, '')}`));
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
    const appPath = confirmButton.dataset.appPath || 'app.html';
    confirmButton.disabled = true;
    await reloadLatestApp(appPath);
  });

  document.querySelectorAll('[data-update-modal-close]').forEach((element) => {
    element.addEventListener('click', () => closeModal(UPDATE_MODAL_ID));
  });
}
