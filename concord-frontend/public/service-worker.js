// Concord service worker — Phase 11 (Item 13).
//
// Single job: receive WebPush events from the server and surface them
// as OS-level notifications even when the tab is closed.  The hook in
// hooks/useWebPush.ts registers this file at /service-worker.js and
// subscribes to push via VAPID.
//
// No background sync, no caching — Concord is online-first.

self.addEventListener('install', (event) => {
  // Skip the waiting phase so the new worker activates immediately.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'Concord', body: event.data.text() }; }

  const title = payload.title || 'Concord';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
    tag: payload.data?.notificationId || undefined,
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Default deep-link: jump to /lenses/social with the notification id
  // so the user lands on the relevant thread. Server-side notification
  // routes can override by setting data.url.
  const url = data.url || '/lenses/social';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
