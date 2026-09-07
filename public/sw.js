const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const SOUNDS = 'sounds';
const PRECACHE = ['/', '/app.js', '/audio.js', '/sync.js', '/styles.css', '/icon.svg', '/manifest.webmanifest', '/sounds/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/healthz') return;

  // Sounds are immutable: cache first, forever.
  if (url.pathname.startsWith('/sounds/') && !url.pathname.endsWith('manifest.json')) {
    e.respondWith(caches.open(SOUNDS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && res.status === 200) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // App shell: network first so updates land, cache as offline fallback.
  const shellPath = url.pathname.startsWith('/r/') ? '/' : url.pathname;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(SHELL)).put(shellPath, res.clone());
      return res;
    } catch {
      const hit = await caches.match(shellPath);
      return hit || new Response('offline', { status: 503 });
    }
  })());
});
