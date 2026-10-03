/* Studio App — service worker
   - App files & master JSON: network first, cache as offline fallback
     (so edits on GitHub Pages show up right away).
   - Photos, 3D icons, fonts, QR lib: cache first. */

const VERSION = 'studio-app-v24';
const SHELL_CACHE = VERSION + '-shell';
const MEDIA_CACHE = VERSION + '-media';
const MEDIA_LIMIT = 120;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './backend.js',
  './cabinet.js',
  './config.js',
  './manifests/demo.webmanifest',
  './masters/demo.json',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon-maskable-512.png',
  './img/apple-touch-icon.png',
  './img/badge-96.png'
];

const MEDIA_HOSTS = [
  'images.pexels.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (MEDIA_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    // a pretty address (…/bella-brows) is the app itself: GitHub answers it with 404.html —
    // the app's own page instead, straight away (it reads the studio from the address)
    if (req.mode === 'navigate' && res.status === 404) {
      const page = (await cache.match('./index.html')) || (await fetch('./index.html').catch(() => null));
      if (page && page.ok) return page;
    }
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req) ||
      (req.mode === 'navigate' && (await cache.match('./index.html') || await cache.match('./')));
    return hit || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // These hosts send CORS headers, so a CORS fetch gives a readable
    // (non-opaque) response that doesn't bloat the storage quota.
    let res;
    try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }
    catch (e) { res = await fetch(req); }
    if (res.ok || res.type === 'opaque') {
      await cache.put(req.url, res.clone());
      trim(cache);
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_LIMIT; i++) await cache.delete(keys[i]);
}

/* ---------- Push notifications for the master ----------
   Payload (JSON, from the send-push Edge Function):
   { title, body, url: "./<slug>?owner=1&booking=<id>", tag, booking } */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Studio', {
    body: d.body || '',
    icon: './img/icon-192.png',
    badge: './img/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    timestamp: Date.now(),
    data: { url: d.url || './?owner=1', booking: d.booking || null }
  }));
});

// Tap → the dashboard opens right on that booking (an open window is reused)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open-booking', url, booking: data.booking });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
