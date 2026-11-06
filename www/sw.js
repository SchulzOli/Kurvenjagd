// App-Shell: erst Netz, bei Offline aus dem Cache. Straßenpakete und Karte (data/, Range-Anfragen) laufen vorbei:
// die App cacht Straßen selbst, Teilantworten (206) kann der Service-Worker-Cache nicht speichern.
const CACHE = 'kurvenjagd-v3';
const SHELL = ['./', 'index.html', 'build/app.js', 'build/app.css', 'build/engine-worker.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/data/') || e.request.headers.has('range')) return;
  e.respondWith(fetch(e.request)
    .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request)));
});
