/* global self, caches, importScripts, Response */
/**
 * Concord service worker — the only worker for scope "/".
 *
 * install/activate/fetch: precache the offline shell, version the cache,
 * never cache /api/ or non-GET, never cache.put a response canStore() rejects.
 * push/notificationclick: Web Push (previously a second worker at
 * /service-worker.js, which fought this file for the same scope).
 *
 * Routing rules live in /sw-policy.js so unit tests load the same decisions.
 */
importScripts('/sw-policy.js');

var policy = self.concordSwPolicy;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(policy.CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(policy.PRECACHE_URLS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.filter(policy.isRetiredCache).map(function (name) {
            return caches.delete(name);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function navigationFallback(request) {
  return fetch(request).catch(function () {
    return caches.match(policy.OFFLINE_URL).then(function (cached) {
      if (cached) return cached;
      return new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    });
  });
}

function staticCacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      // canStore is false for non-GET, /api/, non-200, opaque, and Set-Cookie.
      // cache.put is only reached for a response that passed that check.
      if (policy.canStore(request, response)) {
        var copy = response.clone();
        caches
          .open(policy.CACHE_NAME)
          .then(function (cache) {
            return cache.put(request, copy);
          })
          .catch(function () {});
      }
      return response;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Other origins (analytics, media CDNs) are the browser's business.
  if (url.origin !== self.location.origin) return;

  var decision = policy.decide(request);
  if (decision === 'navigation') {
    event.respondWith(navigationFallback(request));
    return;
  }
  if (decision === 'static') {
    event.respondWith(staticCacheFirst(request));
  }
  // passthrough: API, non-GET, and documents we do not shell-cache.
  // Not calling respondWith leaves the request on the network and never cache.put.
});

self.addEventListener('push', function (event) {
  if (!event.data) return;
  var payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Concord', body: event.data.text() };
  }

  var title = payload.title || 'Concord';
  var data = payload.data || {};
  var options = {
    body: payload.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: data,
    tag: data.notificationId || undefined,
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  // Default deep-link: /lenses/social. Server payloads can set data.url.
  var target = data.url || '/lenses/social';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf(target) !== -1 && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
