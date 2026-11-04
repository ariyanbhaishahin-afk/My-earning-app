const CACHE = 'my-earning-shell-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(['/','/style.css','/app.js','/manifest.json'])
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (
    event.request.method === 'GET' &&
    new URL(event.request.url).origin === location.origin
  ) {
    event.respondWith(fetch(event.request));
  }
});
