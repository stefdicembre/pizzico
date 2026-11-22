// Pizzico offline cache. Keeps the app itself, its font and the recipe photos on the phone
// so the last-loaded recipes can be opened with no signal. Recipe data is kept by the page itself.
const VERSION = 'pizzico-v1';
const PHOTOS = 'pizzico-photos-v1';
const SCOPE = self.registration.scope;
const SHELL = [SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icons/icon-192.png', SCOPE + 'icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map(async u => { try { const r = await fetch(new Request(u, { mode: u.startsWith(SCOPE) ? 'same-origin' : 'cors', cache: 'reload' })); if (r.ok) await c.put(u, r); } catch (_) {} }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== PHOTOS) await caches.delete(k);
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function swr(req, cacheName, fetchReq) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(fetchReq || req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; });
  if (hit) { net.catch(() => {}); return hit; }
  return net;
}
async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page: try the network briefly (so updates arrive), fall back to the saved copy.
  if (req.mode === 'navigate' && url.href.startsWith(SCOPE)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const r = await withTimeout(fetch(req.url, { cache: 'no-cache' }), 4000);
        if (r.ok) c.put(SCOPE, r.clone());
        return r;
      } catch (_) {
        return (await c.match(SCOPE)) || (await c.match(SCOPE + 'index.html')) || Response.error();
      }
    })());
    return;
  }

  if (url.origin === location.origin && url.href.startsWith(SCOPE)) { e.respondWith(swr(req, VERSION)); return; }
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(swr(req, VERSION, new Request(req.url, { mode: 'cors', credentials: 'omit' }))); return;
  }
  // Recipe photos (public storage files only; sign-in, database and live-update calls are never touched).
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/')) {
    e.respondWith(swr(req, PHOTOS, new Request(req.url, { mode: 'cors', credentials: 'omit' })).finally(() => trim(PHOTOS, 400)));
  }
});
