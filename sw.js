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
  // Fetch every shell file straight from the network. Pages serves the shell
  // with max-age=600, so a plain addAll() is answered by the browser's HTTP
  // cache: deploy twice inside ten minutes and the new cache name gets filled
  // with the old bytes, activate() deletes the only copy of the real previous
  // version, and the update the user was just offered changes nothing.
  const shell = APP_SHELL.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(shell)));
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
  if (event.data === 'skip-waiting') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    // Never search every cache: an older shell could otherwise win the match
    // during an update and make the freshly activated app look unchanged.
    event.respondWith(caches.open(CACHE).then(cache =>
      cache.match(event.request).then(cached => cached || cache.match('./'))
    ));
    return;
  }

  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(cache =>
    cache.match(event.request).then(cached => cached || fetch(event.request))
  ));
});
