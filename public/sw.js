'use strict';
// Service worker do WAndCine: deixa o app abrir mesmo sem conexão com o servidor (mostra um aviso)
// e carrega os arquivos do app mais rápido. Dados (API) e capas nunca passam pelo cache.
const CACHE = 'wandcine-v1';
const SHELL = ['/offline.html', '/styles.css', '/favicon.svg'];
const STATIC = new Set(['/styles.css', '/app.js', '/login.js', '/favicon.svg', '/logo', '/icon.png', '/apple-touch-icon.png', '/manifest.webmanifest']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Páginas: sempre da rede; se o servidor estiver fora do ar, mostra o aviso.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Arquivos do app: rede primeiro (pega atualizações), cache como reserva.
  if (STATIC.has(url.pathname)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
});
