/*
 * v0.1.6.5I Service Worker
 *
 * 責任は「トップと案件画面を圏外でも起動できる状態に保つ」ことだけ。
 * 案件データ、IndexedDB、localStorage、未送信キュー、Firestore同期処理は扱わない。
 * network-firstへの更新方式整理はJで行う。
 */

const APP_CACHE = 'chousa-app-v0.1.6.5I-r2';
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
  './js/demo/sample-session.js',
  './js/materials/simple-list.js',
  './config/app-config.js',
  './config/microsoft-config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
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
    event.respondWith(
      caches.match(request).then((cached) => (
        cached || fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
      ))
    );
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
