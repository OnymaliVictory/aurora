// Aurora service worker: shows device pop-up notifications and opens the right page when tapped.
// It must live at the site root (public/sw.js) so it can cover every page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Aurora', {
    body: d.body || '',
    tag: d.tag || undefined,      // same tag = replaces the older pop-up instead of stacking
    renotify: !!d.tag,
    data: { url: d.url || 'index.html' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || 'index.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    for (const w of wins) {
      if (w.url.split('#')[0] === target.split('#')[0] && 'focus' in w) return w.focus();
    }
    return self.clients.openWindow(target);
  }));
});
