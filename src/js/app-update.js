/**
 * src/js/app-update.js
 *
 * version.json と実行中 appConfig の version + revision を比較する。
 * version は利用者向け表示、revision は同一version内の実装更新識別子。
 * 利用者が明示的にアップデートを実行した時だけ、新しいService Workerへ切り替える。
 *
 * キャッシュの作成・旧世代削除はservice-worker.jsだけが担当する。
 * localStorage / IndexedDB / 案件データ / 写真データには触れない。
 */

import { appConfig } from '../config/app-config.js';
import { openModal, closeModal } from './ui/modal.js';
import { beginLoading, updateLoading, endLoading } from './ui/loading-ui.js';
import { preparePwaUpdate, activatePreparedPwaUpdate } from './pwa/pwa-controller.js';

const UPDATE_MODAL_ID = 'updateModal';
const UPDATE_VERIFY_KEY = 'chousaAppExpectedRevisionAfterReload';

const UPDATE_FAILURE_MESSAGE = [
  'アップデートを確認できませんでした。',
  '',
  'Safariでこのアプリを直接開いて、もう一度アップデートしてください。',
  'それでも切り替わらない場合は、',
  'ホーム画面のアプリを終了して開き直してください。'
].join('\n');

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function normalizeVersionInfo(info = {}) {
  return {
    version: String(info.version || '').trim(),
    revision: String(info.revision || '').trim()
  };
}

function currentVersionInfo() {
  return normalizeVersionInfo(appConfig);
}

function sameBuild(left, right) {
  const a = normalizeVersionInfo(left);
  const b = normalizeVersionInfo(right);
  return Boolean(a.version && b.version)
    && a.version === b.version
    && a.revision === b.revision;
}

function buildLabel(info) {
  const normalized = normalizeVersionInfo(info);
  return normalized.revision
    ? `v${normalized.version}（${normalized.revision}）`
    : `v${normalized.version}`;
}

export async function fetchLatestVersionInfo() {
  try {
    const response = await fetch(`./version.json?ts=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`version.json fetch failed: ${response.status}`);
    }

    return normalizeVersionInfo(await response.json());
  } catch (error) {
    console.warn('最新バージョンを取得できませんでした', error);
    return {
      ...currentVersionInfo(),
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
  const current = currentVersionInfo();

  if (message) {
    message.innerHTML =
      `現在：${buildLabel(current)}<br>` +
      '最新バージョンを確認しています...';
  }

  renderUpdateActions({ canUpdate: false });
  openModal(UPDATE_MODAL_ID);

  const latest = await fetchLatestVersionInfo();

  if (!message) return;

  if (latest.fetchFailed) {
    message.innerHTML =
      `現在：${buildLabel(current)}<br><br>` +
      '最新バージョンを確認できませんでした。<br>' +
      '通信状態を確認して、もう一度お試しください。';
    renderUpdateActions({ canUpdate: false });
    return;
  }

  if (sameBuild(latest, current)) {
    message.innerHTML =
      `現在：${buildLabel(current)}<br>` +
      `最新：${buildLabel(latest)}<br><br>` +
      '<b>最新の状態です。</b>';
    renderUpdateActions({ canUpdate: false });
    return;
  }

  message.innerHTML =
    `現在：${buildLabel(current)}<br>` +
    `最新：${buildLabel(latest)}<br><br>` +
    '<b>アップデートできます。</b>';
  renderUpdateActions({ canUpdate: true });
}

/**
 * 新しいService Workerを準備し、切替後に通常reloadする。
 * versionが同じでもrevisionが異なれば更新対象になる。
 * Cache Storageの直接削除やService Workerのunregisterは行わない。
 */
export async function reloadLatestApp(loadingToken = '') {
  updateLoading(loadingToken, 'アップデートを確認しています…');
  await waitForPaint();

  const latestInfo = await fetchLatestVersionInfo();
  if (latestInfo.fetchFailed) {
    sessionStorage.removeItem(UPDATE_VERIFY_KEY);
    throw new Error('最新バージョンを確認できませんでした。');
  }

  sessionStorage.setItem(UPDATE_VERIFY_KEY, JSON.stringify(latestInfo));

  updateLoading(loadingToken, 'アップデートをダウンロードしています…');
  await waitForPaint();

  const worker = await preparePwaUpdate();

  updateLoading(loadingToken, 'アップデートを適用しています…');
  await waitForPaint();

  const switched = await activatePreparedPwaUpdate(worker);

  // 新しいSWが無い場合でも、M以降のnetwork-first制御下ならreload時に最新資材を取得する。
  // controllerchangeを待てなかった場合も自動再試行ループには入らない。
  if (!switched && worker) {
    console.warn('Service Workerの切替完了を確認できませんでした。通常reloadを続行します。');
  }

  location.reload();
}

async function verifyPendingAppUpdate() {
  const expectedRaw = sessionStorage.getItem(UPDATE_VERIFY_KEY);
  if (!expectedRaw) return;

  sessionStorage.removeItem(UPDATE_VERIFY_KEY);

  let expected = {};
  try {
    expected = normalizeVersionInfo(JSON.parse(expectedRaw));
  } catch {
    expected = { version: expectedRaw, revision: '' };
  }

  const latestInfo = await fetchLatestVersionInfo();
  const current = currentVersionInfo();
  const target = latestInfo.fetchFailed ? expected : latestInfo;

  if (sameBuild(current, target)) return;

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
    const loadingToken = beginLoading('アップデートを確認しています…', { delay: 0 });
    try {
      await waitForPaint();
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
