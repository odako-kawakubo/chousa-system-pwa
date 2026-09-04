/**
 * src/js/app-update.js
 *
 * version.jsonとappConfig.versionを比較し、利用者が明示的にアップデートを
 * 実行した時だけService Workerを新版へ切り替える。
 *
 * キャッシュの作成・旧世代削除はservice-worker.jsだけが担当する。
 * localStorage / IndexedDB / 案件データ / 写真データには触れない。
 */

import { appConfig } from '../config/app-config.js';
import { openModal, closeModal } from './ui/modal.js';
import { beginLoading, updateLoading, endLoading } from './ui/loading-ui.js';
import { preparePwaUpdate, activatePreparedPwaUpdate } from './pwa/pwa-controller.js';

const UPDATE_MODAL_ID = 'updateModal';
const UPDATE_VERIFY_KEY = 'chousaAppExpectedVersionAfterReload';

const UPDATE_FAILURE_MESSAGE = [
  'アップデートを確認できませんでした。',
  '',
  'Safariでこのアプリを直接開いて、もう一度アップデートしてください。',
  'それでも切り替わらない場合は、',
  'ホーム画面のアプリを終了して開き直してください。'
].join('\n');

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

export async function showUpdatePrompt() {
  const message = document.getElementById('updateMessage');

  if (message) {
    message.innerHTML =
      `現在：v${appConfig.version}<br>` +
      '最新バージョンを確認しています...';
  }

  renderUpdateActions({ canUpdate: false });
  openModal(UPDATE_MODAL_ID);

  const info = await fetchLatestVersionInfo();
  const latest = String(info.version || appConfig.version);

  if (!message) return;

  if (info.fetchFailed) {
    message.innerHTML =
      `現在：v${appConfig.version}<br><br>` +
      '最新バージョンを確認できませんでした。<br>' +
      '通信状態を確認して、もう一度お試しください。';
    renderUpdateActions({ canUpdate: false });
    return;
  }

  if (latest === appConfig.version) {
    message.innerHTML =
      `現在：v${appConfig.version}<br>` +
      `最新：v${latest}<br><br>` +
      '<b>最新の状態です。</b>';
    renderUpdateActions({ canUpdate: false });
    return;
  }

  message.innerHTML =
    `現在：v${appConfig.version}<br>` +
    `最新：v${latest}<br><br>` +
    '<b>アップデートできます。</b>';
  renderUpdateActions({ canUpdate: true });
}

/**
 * 新しいService Workerを準備し、切替後に通常reloadする。
 * Cache Storageの直接削除やService Workerのunregisterは行わない。
 */
export async function reloadLatestApp(loadingToken = '') {
  updateLoading(loadingToken, 'アップデートを確認しています…');
  const latestInfo = await fetchLatestVersionInfo();
  if (latestInfo.fetchFailed) {
    sessionStorage.removeItem(UPDATE_VERIFY_KEY);
    throw new Error('最新バージョンを確認できませんでした。');
  }

  const expectedVersion = String(latestInfo.version || appConfig.version);
  sessionStorage.setItem(UPDATE_VERIFY_KEY, expectedVersion);

  updateLoading(loadingToken, 'アップデート中です…');
  const worker = await preparePwaUpdate();
  const switched = await activatePreparedPwaUpdate(worker);

  // SWファイルに差分がない場合でもHTML/JS側の更新を取り直せるようreloadする。
  // controllerchangeを待てなかった場合も自動再試行ループには入らない。
  if (!switched && worker) {
    console.warn('Service Workerの切替完了を確認できませんでした。通常reloadを続行します。');
  }

  location.reload();
}

async function verifyPendingAppUpdate() {
  const expectedVersion = sessionStorage.getItem(UPDATE_VERIFY_KEY);
  if (!expectedVersion) return;

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

  renderUpdateActions({ canUpdate: false });
  openModal(UPDATE_MODAL_ID);
}

export function bindAppUpdateEvents() {
  const openButton = document.getElementById('showUpdatePromptButton');
  const confirmButton = document.getElementById('confirmAppUpdateButton');

  openButton?.addEventListener('click', () => {
    showUpdatePrompt();
  });

  confirmButton?.addEventListener('click', async () => {
    confirmButton.disabled = true;
    const loadingToken = beginLoading('アップデート中です…', { delay: 0 });
    try {
      await reloadLatestApp(loadingToken);
    } catch (error) {
      endLoading(loadingToken);
      console.error('アプリをアップデートできませんでした', error);
      const message = document.getElementById('updateMessage');
      if (message) {
        message.innerHTML =
          'アップデートできませんでした。<br>' +
          '通信状態を確認して、もう一度お試しください。';
      }
      renderUpdateActions({ canUpdate: false });
    }
  });

  document.querySelectorAll('[data-update-modal-close]').forEach((element) => {
    element.addEventListener('click', () => closeModal(UPDATE_MODAL_ID));
  });

  verifyPendingAppUpdate();
}
