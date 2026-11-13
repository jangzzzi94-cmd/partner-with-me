/* 출근보고 알림 서비스워커  —  사이트 루트에 두세요 (/sw.js) */
const APP_PATH = '/attendance.html';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { title: '알림', body: event.data ? event.data.text() : '' }; }
  const title = d.title || '출근보고 알림';
  const opts = {
    body: d.body || '',
    tag: d.tag || 'attendance',
    renotify: true,
    requireInteraction: true,
    data: { url: d.url || APP_PATH },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || APP_PATH;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.includes('attendance.html')) { await c.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
