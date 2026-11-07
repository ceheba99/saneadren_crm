// Service worker SOLO del kiosco del reloj checador (se registra con scope «/kiosco»: no toca el resto del CRM ni la
// API). Guarda la página del kiosco y el logo para que, si la tableta se reinicia sin internet, la pantalla abra y
// pueda guardar checadas sin conexión. Con internet siempre se usa la versión nueva del servidor.
const CACHE = 'saneadren-kiosco-v1';
const ARCHIVOS = ['/kiosco', '/logo-saneadren.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !ARCHIVOS.includes(url.pathname)) return;
  // Primero la red (versión nueva); si no hay, lo guardado.
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copia)); } return r; })
    .catch(() => caches.match(url.pathname)));
});
