const CACHE_NAME = 'find-app-shell-v5';
const APP_SHELL = [
    '/index.html',
    '/login.html',
    '/style.css',
    '/app.js',
    '/app-optimized.js',
    '/masters.js',
    '/register.js',
    '/useful-life.js',
    '/offline-queue.js',
    '/firebase-config.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// 덩치가 커서 받다 실패할 수 있는 자산. 실패해도 설치는 성공시키고 나중에 fetch에서 채운다
const OPTIONAL_ASSETS = [
    '/useful-life.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).then(() => Promise.all(
            OPTIONAL_ASSETS.map((url) => cache.add(url).catch(() => null))
        ))).then(() => self.skipWaiting())
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
    const isAppShell = url.origin === self.location.origin;
    const isCdn = /gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com/.test(url.hostname);
    if (!isAppShell && !isCdn) return;

    const preferNetwork = request.mode === 'navigate'
        || url.pathname.endsWith('.html')
        || url.pathname.endsWith('.js')
        || url.pathname.endsWith('.css');

    if (preferNetwork) {
        event.respondWith(
            fetch(request).then((response) => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            }).catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request).then((response) => {
            if (response && response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
        }))
    );
});
