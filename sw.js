/* GitHub Pages replaces this marker with the deployed commit SHA. */
const CACHE = 'board-shell-__BUILD_ID__';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './i18n.js',
  './app.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('board-shell-') && key !== CACHE)
        .map(key => caches.delete(key))
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match(event.request).then(cached => cached || caches.match('./')));
    return;
  }

  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
