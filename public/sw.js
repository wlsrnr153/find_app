const CACHE_NAME = 'find-app-shell-v44';

// 오프라인에서도 localhost 셸이 뜨도록 핵심 자산·vendor를 미리 캐시한다
const APP_SHELL = [
    '/',
    '/index.html',
    '/login.html',
    '/style.css',
    '/app.js',
    '/app-optimized.js',
    '/auth.js',
    '/masters.js',
    '/register.js',
    '/baseline-register.js',
    '/useful-life.js',
    '/goods-catalog.js',
    '/goods-idntfc.js',
    '/useful-life-ui.js',
    '/useful-life-excel.js',
    '/useful-life-register.js',
    '/excel-form-convert.js',
    '/offline-queue.js',
    '/firebase-config.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/vendor/firebase-app-compat.js',
    '/vendor/firebase-auth-compat.js',
    '/vendor/firebase-firestore-compat.js',
    '/vendor/firebase-functions-compat.js',
    '/vendor/xlsx.full.min.js',
    '/vendor/exceljs.min.js',
    '/vendor/html5-qrcode.min.js'
];

// 덩치가 커서 받다 실패할 수 있는 자산. 실패해도 설치는 성공시키고 나중에 fetch에서 채운다
const OPTIONAL_ASSETS = [
    '/useful-life.json',
    '/goods-catalog.json',
    '/goods-idntfc-cache.json',
    '/useful-life-aliases.json',
    '/templates/RFID_OAST_TEMPLET.xls',
    '/templates/RFID_운영부서코드_양식.xlsx'
];

function cachePut(cache, request, response) {
    if (!response || !response.ok) return;
    cache.put(request, response.clone());
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(
                APP_SHELL.map((url) => cache.add(url).catch((error) => {
                    console.warn('SW precache 실패:', url, error);
                }))
            ).then(() => Promise.all(
                OPTIONAL_ASSETS.map((url) => cache.add(url).catch(() => null))
            ))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // 앱 origin만 캐시 (vendor 로컬화 후 CDN 의존 제거)
    if (url.origin !== self.location.origin) return;

    const preferNetwork = request.mode === 'navigate'
        || url.pathname.endsWith('.html')
        || url.pathname.endsWith('.js')
        || url.pathname.endsWith('.css');

    if (preferNetwork) {
        event.respondWith(
            fetch(request).then((response) => {
                if (response && response.ok) {
                    caches.open(CACHE_NAME).then((cache) => cachePut(cache, request, response));
                }
                return response;
            }).catch(() =>
                caches.match(request).then((cached) =>
                    cached
                    || (request.mode === 'navigate' ? caches.match('/index.html') : undefined)
                    || caches.match('/index.html')
                )
            )
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request).then((response) => {
            if (response && response.ok) {
                caches.open(CACHE_NAME).then((cache) => cachePut(cache, request, response));
            }
            return response;
        }).catch(() => caches.match(request)))
    );
});
