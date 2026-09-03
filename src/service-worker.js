/*
 * v0.1.6.4 Service Worker
 *
 * 責任は「アプリ本体を圏外でも起動できる状態に保つ」ことだけ。
 * 案件データ、IndexedDB、localStorage、未送信キュー、Firestore同期処理は扱わない。
 */

const APP_CACHE = 'chousa-app-v0.1.6.4';
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
  './js/app-update.js',
  './js/pwa/pwa-controller.js',
  './js/ui/auth-ui.js',
  './js/ui/header-edit-ui.js',
  './js/ui/sync-ui.js',
  './js/firestore/firestore-repository.js',
  './js/firestore/firestore-project-list.js',
  './js/sync/sync-status.js',
  './js/projects/project-controller.js',
  './js/projects/project-store.js',
  './js/projects/project-session.js',
  './js/projects/firestore-project-browser.js',
  './js/projects/project-transfer.js',
  './js/demo/sample-session.js',
  './js/materials/simple-list.js',
  './config/app-config.js'
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
