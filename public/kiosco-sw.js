// Service worker SOLO del kiosco del reloj checador (se registra con scope «/kiosco»: no toca el resto del CRM ni la
// API). Guarda la página del kiosco y lo que necesita para que la pantalla SIEMPRE abra y pueda guardar checadas.
//
// 2026-11-11 (Dirección: «la pantalla se queda en blanco al bloquear la tableta, recargar muchas veces o con el ahorro
// de energía; quiero que sea a prueba de errores»). Se reprodujo: al volver del bloqueo o con ahorro de energía la red
// tarda o no contesta, y la versión anterior esperaba a la red SIN LÍMITE antes de usar la copia guardada → pantalla en
// blanco durante minutos. Ahora:
//  · La página: se pide a la red, pero si hay copia guardada solo se espera 2.5 s; después se abre la copia (y la
//    nueva, si llega, queda guardada y se avisa a la página para que se actualice sola cuando nadie la esté usando).
//  · Solo se acepta de la red la página VERDADERA del kiosco (200, HTML, con sus marcas): una página de error, una
//    respuesta vacía o el portal del Wi-Fi nunca sustituyen a la copia buena.
//  · Sin copia y sin red: una página mínima que se reintenta sola cada 5 s (nunca una pantalla en blanco).
//  · Lo demás que usa el kiosco (logo, cara, prueba de vida, impresión): primero lo guardado y se actualiza por detrás.
//  · La API (/api/…) nunca pasa por aquí.
const CACHE = 'saneadren-kiosco-v4';
const PAGINA = '/kiosco';
const PAGINAS = ['/kiosco', '/kiosco/', '/kiosco.html'];
const ESPERA_CON_COPIA_MS = 2500, ESPERA_SIN_COPIA_MS = 15000, LIMITE_RED_MS = 20000, LIMITE_ARCHIVO_MS = 60000;
const ESTATICOS = /^\/(logo-saneadren\.png|kiosco-icono-\d+\.png|kiosco\.webmanifest|imprimir-documentos\.js|importes\.js|orden-servicio-pdf\.js|membrete-orden-servicio\.png|vendor\/.+)$/;
// Encabezados de la página que se conservan en la copia (permiso de cámara y WebAssembly del kiosco, y los de seguridad).
const ENCABEZADOS = ['content-type', 'content-security-policy', 'permissions-policy', 'referrer-policy', 'x-frame-options', 'x-content-type-options', 'cross-origin-opener-policy', 'strict-transport-security'];
const MARCAS = ['id="pantalla"', 'saneadren_kiosco'];

const conLimite = (promesa, ms) => new Promise(ok => { const t = setTimeout(() => ok(null), ms); promesa.then(v => { clearTimeout(t); ok(v); }, () => { clearTimeout(t); ok(null); }); });
function pedir(url, ms, opciones = {}) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opciones, signal: c.signal }).finally(() => clearTimeout(t));
}
const esPagina = texto => MARCAS.every(m => texto.includes(m));
function respuestaPagina(texto, origen) {
  const h = new Headers();
  for (const k of ENCABEZADOS) { const v = origen.headers.get(k); if (v) h.set(k, v); }
  if (!h.has('content-type')) h.set('content-type', 'text/html; charset=utf-8');
  return new Response(texto, { status: 200, headers: h });
}
// Trae la página de la red. Regresa { texto, respuesta } solo si es la página verdadera; si no, null. La guarda.
async function paginaDeRed() {
  try {
    const r = await pedir(PAGINA, LIMITE_RED_MS, { cache: 'no-cache', credentials: 'same-origin' });
    if (!r.ok || r.redirected || !/text\/html/i.test(r.headers.get('content-type') || '')) return null;
    const texto = await r.text();
    if (!esPagina(texto)) return null;
    const cache = await caches.open(CACHE), antes = await cache.match(PAGINA), textoAntes = antes ? await antes.text() : null;
    await cache.put(PAGINA, respuestaPagina(texto, r));
    return { texto, origen: r, cambio: textoAntes !== null && textoAntes !== texto };
  } catch { return null; }
}
async function avisar(tipo) {
  const l = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of l) c.postMessage({ kiosco: tipo });
}
// Página mínima cuando no hay ni red ni copia (p. ej. la primera vez sin internet): se reintenta sola.
const RESPALDO = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reloj checador · Saneadren</title>
<style>body{margin:0;font-family:system-ui,Arial,sans-serif;background:#f4f5f7;color:#1a1d23;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
div{max-width:520px;padding:24px}h1{font-size:1.6rem}p{color:#4b5563;font-size:1.1rem}button{font-size:1.2rem;padding:14px 26px;border-radius:12px;border:0;background:#f6b103;font-weight:700}</style></head>
<body><div><h1>Reloj checador</h1><p>Conectando con el servidor… Se reintenta solo cada 5 segundos.</p><p id="n"></p><button type="button" onclick="location.replace('/kiosco')">Reintentar ahora</button></div>
<script>var s=5,n=document.getElementById('n');setInterval(function(){s--;n.textContent='Siguiente intento en '+Math.max(s,0)+' s';if(s<=0)location.replace('/kiosco');},1000);</script></body></html>`;

async function pagina(e) {
  const cache = await caches.open(CACHE), guardada = await cache.match(PAGINA);
  const red = paginaDeRed();
  const r = await conLimite(red, guardada ? ESPERA_CON_COPIA_MS : ESPERA_SIN_COPIA_MS);
  if (r) return respuestaPagina(r.texto, r.origen);
  if (guardada) {
    // La red tardó o falló: se abre la copia. Si la nueva llega después y es distinta, la página se actualiza sola.
    e.waitUntil(red.then(n => (n && n.cambio ? avisar('version-nueva') : null)));
    return guardada;
  }
  return new Response(RESPALDO, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
async function estatico(e) {
  const cache = await caches.open(CACHE), llave = e.request.url, guardado = await cache.match(llave);
  const red = pedir(e.request.url, LIMITE_ARCHIVO_MS, { credentials: 'same-origin' }).then(async r => { if (r.ok && !r.redirected) await cache.put(llave, r.clone()); return r; });
  if (guardado) { e.waitUntil(red.catch(() => {})); return guardado; }
  return red;
}

self.addEventListener('install', e => {
  // Nunca falla la instalación por no tener red: si no se puede bajar la página, se copia la de la versión anterior.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (!await paginaDeRed()) {
      for (const k of await caches.keys()) {
        if (k === CACHE || !k.startsWith('saneadren-kiosco-')) continue;
        const vieja = await (await caches.open(k)).match(PAGINA);
        if (vieja) { const t = await vieja.clone().text(); if (esPagina(t)) { await cache.put(PAGINA, respuestaPagina(t, vieja)); break; } }
      }
    }
    await pedir('/logo-saneadren.png', LIMITE_RED_MS).then(r => (r.ok ? cache.put(new URL('/logo-saneadren.png', self.location.origin).href, r) : null)).catch(() => {});
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k.startsWith('saneadren-kiosco-')).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate' && PAGINAS.includes(url.pathname)) return e.respondWith(pagina(e));
  if (PAGINAS.includes(url.pathname) && e.request.mode !== 'navigate') return; // la instalación y las pruebas piden la página directo
  if (ESTATICOS.test(url.pathname)) e.respondWith(estatico(e));
});
