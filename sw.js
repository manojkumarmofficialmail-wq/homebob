// Homzy service worker: works offline after the first visit.
// Bump VERSION whenever app files change so phones pick up the update.
const VERSION = 'homzy-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/ui.js', 'js/data.js', 'js/parse.js', 'js/speech.js', 'js/scan.js',
  'js/nutrition.js', 'js/feedback.js', 'js/cloud.js', 'js/sync.js', 'js/vendor/qrcode.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const RUNTIME = 'homzy-runtime'; // bill reader files from the CDN

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The API (feedback, sync config) always goes to the network. Supabase calls are
  // cross-origin and are never cached.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // App files: answer from cache at once, refresh the cache in the background.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached || cache.match('index.html'));
        return cached || network;
      })
    );
    return;
  }

  // Bill reader (Tesseract) and fonts from CDNs: cache once, reuse forever.
  if (['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname) || url.hostname.endsWith('projectnaptha.com')) {
    e.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
