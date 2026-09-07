const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const SOUNDS = 'sounds';
// The app may be mounted under a path (e.g. /soundboard/); the registration scope tells us where.
const BASE = new URL(self.registration.scope).pathname;
const PRECACHE = ['', 'app.js', 'audio.js', 'sync.js', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'sounds/manifest.json'].map((p) => BASE + p);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  const rel = url.pathname.slice(BASE.length);
  if (rel.startsWith('api/') || rel === 'ws' || rel === 'healthz') return;

  // Sounds are immutable: cache first, forever.
  if (rel.startsWith('sounds/') && !rel.endsWith('manifest.json')) {
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
  const shellPath = rel.startsWith('r/') ? BASE : url.pathname;
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
