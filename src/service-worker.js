/*
 * v0.1.6.3B Service Worker
 *
 * 責任は「アプリ本体を圏外でも起動できる状態に保つ」ことだけ。
 * 案件データ、IndexedDB、localStorage、未送信キュー、Firestore同期処理は扱わない。
 */

const APP_CACHE = 'chousa-app-v0.1.6.3B';
const FIREBASE_SDK_CACHE = 'chousa-firebase-v12.1.0';
const APP_CACHE_PREFIX = 'chousa-app-';
const FIREBASE_SDK_PREFIX = 'https://www.gstatic.com/firebasejs/12.1.0/';

const APP_SHELL = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './version.json',
  './css/common.css',
  './css/layout.css',
  './css/finish-table.css',
  './css/record-view.css',
  './css/material-list.css',
  './css/material-operations.css',
  './css/photos.css',
  './css/camera.css',
  './css/settings.css',
  './css/pwa-offline.css',
  './assets/microsoft-symbol.svg',
  './js/app-init.js',
  './js/sync/network-session-guard.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE)
        .map((name) => caches.delete(name))
    );

    // 更新時のcontrollerchangeを安定させ、初回導入後も現在の画面を正式SWの管理下へ移す。
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirst(request, fallbackRequest = null) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackRequest) {
      const fallback = await cache.match(fallbackRequest, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirebaseSdk(request) {
  const cache = await caches.open(FIREBASE_SDK_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase SDK本体だけを明示的にキャッシュする。
  // Firestore API / Authentication API / Microsoft Graph等の業務通信はここを通さない。
  if (request.url.startsWith(FIREBASE_SDK_PREFIX)) {
    event.respondWith(cacheFirebaseSdk(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const fallback = url.pathname.endsWith('/app.html') ? './app.html' : './index.html';
    event.respondWith(networkFirst(request, fallback));
    return;
  }

  const isAppAsset =
    url.pathname.includes('/css/') ||
    url.pathname.includes('/js/') ||
    url.pathname.includes('/config/') ||
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('/manifest.json');

  if (isAppAsset) {
    event.respondWith(networkFirst(request));
  }
});
