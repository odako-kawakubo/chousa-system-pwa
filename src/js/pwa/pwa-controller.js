/**
 * src/js/pwa/pwa-controller.js
 *
 * Service Workerの登録・更新・切替だけを担当する。
 * キャッシュ内容の管理はservice-worker.js、更新UIはapp-update.jsが担当する。
 */

let registrationPromise = null;

function supported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function initializePwa() {
  if (!supported()) return Promise.resolve(null);
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register('./service-worker.js', { scope: './', updateViaCache: 'none' })
    .catch((error) => {
      console.warn('Service Workerを登録できませんでした', error);
      return null;
    });

  return registrationPromise;
}

export async function getPwaRegistration() {
  if (!supported()) return null;
  return initializePwa();
}

function waitForWaitingWorker(registration, timeoutMs = 12000) {
  if (registration.waiting) return Promise.resolve(registration.waiting);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (worker = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(worker);
    };

    const watchInstalling = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') {
          finish(registration.waiting || worker);
        }
      });
    };

    watchInstalling(registration.installing);
    registration.addEventListener('updatefound', () => {
      watchInstalling(registration.installing);
    }, { once: true });

    const timer = window.setTimeout(() => finish(registration.waiting), timeoutMs);
  });
}

/**
 * サーバー上のservice-worker.jsを再確認し、新版があればwaiting状態まで待つ。
 * @returns {Promise<ServiceWorker|null>}
 */
export async function preparePwaUpdate() {
  const registration = await getPwaRegistration();
  if (!registration) return null;

  await registration.update();
  return waitForWaitingWorker(registration);
}

/**
 * waiting中のService Workerへ切替を要求し、controllerchangeを待つ。
 * 初回登録などwaiting workerがない場合はfalseを返す。
 */
export async function activatePreparedPwaUpdate(worker) {
  if (!worker) return false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(value);
    };
    const onControllerChange = () => finish(true);
    const timer = window.setTimeout(() => finish(false), 12000);

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
}
