/*
 * v0.1.6.5 Service Worker
 *
 * 責任は「最新版を優先しつつ、圏外では直近キャッシュから起動できる状態を保つ」こと。
 * 案件データ、IndexedDB、localStorage、未送信キュー、Firestore同期処理は扱わない。
 * 同一version内でもrevisionを上げるたびAPP_CACHEを更新し、資材世代を分離する。
 */

const APP_CACHE = 'chousa-app-v0.1.6.5-r1';
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
  './css/home.css',
  './css/finish-table.css',
  './css/record-view.css',
  './css/material-list.css',
  './css/material-operations.css',
  './css/photos.css',
  './css/camera.css',
  './css/settings.css',
  './css/pwa-offline.css',
  './assets/microsoft-symbol.svg',
  './js/home/home-init.js',
  './js/home/home-controller.js',
  './js/home/home-return-control.js',
  './js/app-init.js',
  './js/app-update.js',
  './js/app-version.js',
  './js/pwa/pwa-controller.js',
  './js/auth/microsoft-auth.js',
  './js/auth/graph-session.js',
  './js/ui/auth-ui.js',
  './js/ui/header-edit-ui.js',
  './js/ui/sync-ui.js',
  './js/ui/loading-ui.js',
  './js/ui/modal.js',
  './js/firestore/firestore-repository.js',
  './js/firestore/firestore-project-list.js',
  './js/firestore/record-serializer.js',
  './js/sync/sync-status.js',
  './js/sync/field-edit-meta.js',
  './js/sync/project-record-persistence.js',
  './js/projects/project-controller.js',
  './js/projects/project-store.js',
  './js/projects/project-session.js',
  './js/projects/project-creation.js',
  './js/projects/project-navigation.js',
  './js/projects/project-side-panel-controller.js',
  './js/projects/project-entry-ui.js',
  './js/projects/firestore-project-browser.js',
  './js/projects/onedrive-project-browser.js',
  './js/projects/project-transfer.js',
  './js/onedrive/onedrive-client.js',
  './js/onedrive/onedrive-root.js',
  './js/onedrive/onedrive-connection.js',
  './js/onedrive/onedrive-project.js',
  './js/onedrive/onedrive-project-file.js',
  './js/onedrive/openxml-workbook-reader.js',
  './js/onedrive/system-data-backup.js',
  './js/records/photo-record.js',
  './js/store/photo-record-store.js',
  './js/photos/photo-local-store.js',
  './js/photos/photo-filename.js',
  './js/photos/photo-onedrive-sync.js',
  './js/photos/photo-remote-reader.js',
  './js/photos/photo-controller.js',
  './js/photos/photo-viewer.js',
  './js/demo/sample-session.js',
  './js/materials/simple-list.js',
  './config/app-config.js',
  './config/microsoft-config.js'
];

function appCacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  return new Request(url.toString(), { method: 'GET' });
}

async function networkFirstAppRequest(request) {
  const cache = await caches.open(APP_CACHE);
  const cacheKey = appCacheKey(request);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (
            key.startsWith(APP_CACHE_PREFIX) && key !== APP_CACHE
          ) || (
            key.startsWith('chousa-firebase-') && key !== FIREBASE_SDK_CACHE
          ))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstAppRequest(request));
    return;
  }

  if (request.url.startsWith(FIREBASE_SDK_PREFIX)) {
    event.respondWith(
      caches.open(FIREBASE_SDK_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      })
    );
  }
});
