/*
 * v0.1.8.1 Service Worker
 * 最新版優先 + 圏外時は直近キャッシュから起動する。
 */
const APP_CACHE = 'chousa-app-v0.1.8.1-review';
const FIREBASE_SDK_CACHE = 'chousa-firebase-v12.1.0';
const OUTPUT_LIB_CACHE = 'chousa-output-libs-v0181-review';
const APP_CACHE_PREFIX = 'chousa-app-';
const FIREBASE_SDK_PREFIX = 'https://www.gstatic.com/firebasejs/12.1.0/';
const OUTPUT_LIB_URLS = new Set([
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
]);

const APP_SHELL = [
  './','./index.html','./app.html','./manifest.json','./version.json',
  './css/common.css','./css/layout.css','./css/home.css','./css/finish-table.css','./css/record-view.css','./css/material-list.css','./css/material-operations.css','./css/photos.css','./css/camera.css','./css/settings.css','./css/pwa-offline.css','./css/output.css','./css/room-note.css','./css/analysis-import.css',
  './assets/microsoft-symbol.svg',
  './js/home/home-init.js','./js/home/home-controller.js','./js/home/home-return-control.js',
  './js/app-init.js','./js/app-update.js','./js/app-version.js','./js/device-code.js',
  './js/pwa/pwa-controller.js',
  './js/auth/microsoft-auth.js','./js/auth/graph-session.js',
  './js/ui/auth-ui.js','./js/ui/header-edit-ui.js','./js/ui/sync-ui.js','./js/ui/loading-ui.js','./js/ui/modal.js','./js/ui/tabs.js','./js/ui/drawer.js','./js/ui/project-panel.js','./js/ui/theme.js','./js/ui/device-ui.js',
  './js/firestore/firestore-repository.js','./js/firestore/firestore-project-list.js','./js/firestore/record-serializer.js',
  './js/sync/sync-status.js','./js/sync/field-edit-meta.js','./js/sync/project-record-persistence.js','./js/sync/unsent-queue.js','./js/sync/finish-sparse-structure.js',
  './js/projects/project-controller.js','./js/projects/project-store.js','./js/projects/project-session.js','./js/projects/project-creation.js','./js/projects/project-factory.js','./js/projects/project-navigation.js','./js/projects/project-side-panel-controller.js','./js/projects/project-entry-ui.js','./js/projects/firestore-project-browser.js','./js/projects/onedrive-project-browser.js','./js/projects/project-transfer.js',
  './js/records/finish-record.js','./js/records/material-record.js','./js/records/photo-record.js',
  './js/store/finish-record-store.js','./js/store/material-record-store.js','./js/store/photo-record-store.js','./js/store/survey-candidate-store.js',
  './js/finish-table/finish-table-controller.js','./js/finish-table/finish-table-actions.js','./js/finish-table/finish-table-constants.js','./js/finish-table/finish-table-history.js','./js/finish-table/finish-table-renderer.js','./js/finish-table/finish-table-state.js','./js/finish-table/finish-table-view-model.js','./js/finish-table/finish-table-refresh-guard.js','./js/finish-table/finish-table-scroll-state.js','./js/finish-table/room-note-editor.js',
  './js/record-view/record-view-controller.js','./js/record-view/record-view-renderer.js','./js/record-view/record-view-view-model.js',
  './js/materials/material-list-controller.js','./js/materials/material-operations-controller.js','./js/materials/material-sample-name.js','./js/materials/simple-list.js',
  './js/photos/photo-local-store.js','./js/photos/photo-completed-image.js','./js/photos/photo-filename.js','./js/photos/photo-onedrive-sync.js','./js/photos/photo-remote-reader.js','./js/photos/photo-original-source.js','./js/photos/photo-controller.js','./js/photos/photo-refresh-policy.js','./js/photos/photo-view-model.js','./js/photos/photo-viewer-source.js','./js/photos/photo-viewer.js',
  './js/output/output-controller.js','./js/output/output-view-model.js','./js/output/output-state.js','./js/output/output-settings-store.js','./js/output/output-settings-ui.js','./js/output/output-photo-selection.js','./js/output/output-photo-source.js','./js/output/output-pdf-renderer.js','./js/output/output-pdf-preview.js','./js/output/output-export-controller.js','./js/output/output-targets.js','./js/output/output-format.js',
  './js/settings/settings-controller.js','./js/settings/settings-renderer.js','./js/settings/board-settings-store.js','./js/settings/output-settings-section.js',
  './js/analysis/analysis-import-controller.js',
  './js/onedrive/onedrive-client.js','./js/onedrive/onedrive-root.js','./js/onedrive/onedrive-connection.js','./js/onedrive/onedrive-project.js','./js/onedrive/onedrive-project-file.js','./js/onedrive/openxml-workbook-reader.js','./js/onedrive/system-data-backup.js',
  './js/camera/camera-board.js','./js/camera/camera-controller.js',
  './js/debug/sync-diagnostic-log.js',
  './js/demo/sample-session.js','./js/demo/sample-project.js','./js/demo/sample-finish-data.js','./js/demo/sample-materials.js','./js/demo/sample-photos.js',
  './js/default/default-finish-data.js',
  './config/app-config.js','./config/firebase-config.js','./config/microsoft-config.js'
];

function appCacheKey(request) {
  const url=new URL(request.url);url.search='';return new Request(url.toString(),{method:'GET'});
}
async function networkFirstAppRequest(request) {
  const cache=await caches.open(APP_CACHE);const cacheKey=appCacheKey(request);
  try{const response=await fetch(request);if(response&&response.ok)await cache.put(cacheKey,response.clone());return response;}
  catch(error){const cached=await cache.match(cacheKey);if(cached)return cached;throw error;}
}
async function cacheFirst(request,cacheName) {
  const cache=await caches.open(cacheName);const cached=await cache.match(request);if(cached)return cached;
  const response=await fetch(request);if(response&&response.ok)await cache.put(request,response.clone());return response;
}

self.addEventListener('install',(event)=>{event.waitUntil(caches.open(APP_CACHE).then((cache)=>cache.addAll(APP_SHELL)));});
self.addEventListener('message',(event)=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',(event)=>{
  event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>(key.startsWith(APP_CACHE_PREFIX)&&key!==APP_CACHE)||(key.startsWith('chousa-firebase-')&&key!==FIREBASE_SDK_CACHE)||(key.startsWith('chousa-output-libs-')&&key!==OUTPUT_LIB_CACHE)).map((key)=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',(event)=>{
  const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);
  if(url.origin===self.location.origin){event.respondWith(networkFirstAppRequest(request));return;}
  if(request.url.startsWith(FIREBASE_SDK_PREFIX)){event.respondWith(cacheFirst(request,FIREBASE_SDK_CACHE));return;}
  if(OUTPUT_LIB_URLS.has(request.url)){event.respondWith(cacheFirst(request,OUTPUT_LIB_CACHE));}
});
