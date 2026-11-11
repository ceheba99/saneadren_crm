// KIOSCO A PRUEBA DE ERRORES (2026-11-11, Dirección: «la pantalla se queda en blanco al bloquear la tableta, recargar
// muchas veces o con el ahorro de energía»). Tres partes:
//  1. La caché del kiosco (public/kiosco-sw.js): con la red colgada, caída, con error, vacía o con el portal del Wi-Fi,
//     la página abre con la copia guardada en poco tiempo; sin copia, una página que se reintenta sola. Nunca en blanco.
//  2. El vigilante de la página (bloque aparte en public/kiosco.html): si el programa no inicia o deja la pantalla vacía,
//     lo recupera (primero sin recargar; si no, recarga espaciando los intentos).
//  3. La página: lo que la hacía quedarse esperando para siempre ya tiene límite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SW = fs.readFileSync(path.join(__dirname, '../public/kiosco-sw.js'), 'utf8')
  .replace('ESPERA_CON_COPIA_MS = 2500', 'ESPERA_CON_COPIA_MS = 80').replace('ESPERA_SIN_COPIA_MS = 15000', 'ESPERA_SIN_COPIA_MS = 150')
  .replace('LIMITE_RED_MS = 20000', 'LIMITE_RED_MS = 400').replace('LIMITE_ARCHIVO_MS = 60000', 'LIMITE_ARCHIVO_MS = 400'); // tiempos cortos para la prueba
const HTML = fs.readFileSync(path.join(__dirname, '../public/kiosco.html'), 'utf8');
const PAGINA = v => `<!doctype html><html><body><div id="pantalla"></div><script>const LLAVE = 'saneadren_kiosco'; /* ${v} */</script></body></html>`;
const html = (texto, extra = {}) => new Response(texto, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'permissions-policy': 'camera=(self)', ...extra } });
const espera = ms => new Promise(r => setTimeout(r, ms));

// Un service worker de mentira: caché en memoria, red que se programa en cada prueba y clientes que reciben avisos.
function sw(red, cachesIniciales = {}) {
  const almacenes = new Map(Object.entries(cachesIniciales).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const llave = k => (typeof k === 'string' ? k : k.url);
  const caches = {
    async open(n) { if (!almacenes.has(n)) almacenes.set(n, new Map()); const m = almacenes.get(n);
      return { async match(k) { const r = m.get(llave(k)); return r ? r.clone() : undefined; }, async put(k, r) { m.set(llave(k), r); }, async keys() { return [...m.keys()].map(url => ({ url })); } }; },
    async keys() { return [...almacenes.keys()]; }, async delete(n) { return almacenes.delete(n); },
  };
  const eventos = {}, mensajes = [], estado = { red, pedidas: [] };
  const self = { location: { origin: 'https://sistema.test' }, addEventListener: (k, fn) => { eventos[k] = fn; }, skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [{ postMessage: m => mensajes.push(m) }] } };
  const fetchFalso = (url, o = {}) => { estado.pedidas.push(String(url)); return new Promise((ok, mal) => { o.signal?.addEventListener('abort', () => mal(new Error('abortada'))); Promise.resolve().then(() => estado.red(String(url))).then(ok, mal); }); };
  vm.runInContext(SW, vm.createContext({ self, caches, fetch: fetchFalso, Response, Headers, URL, AbortController, setTimeout, clearTimeout, Promise }));
  // Dispara un evento y regresa lo que respondió (o undefined si no lo tocó) y lo que dejó trabajando por detrás.
  const pedir = async (ruta, opciones = {}) => {
    let respuesta; const detras = [];
    eventos.fetch({ request: { url: 'https://sistema.test' + ruta, method: opciones.method || 'GET', mode: opciones.mode || 'navigate' }, respondWith: p => { respuesta = p; }, waitUntil: p => detras.push(p) });
    const r = respuesta ? await respuesta : undefined;
    return { r, texto: r ? await r.clone().text() : null, detras: () => Promise.all(detras) };
  };
  const instalar = async () => { const p = []; eventos.install({ waitUntil: x => p.push(x) }); await Promise.all(p); };
  return { pedir, instalar, mensajes, estado, almacenes };
}
const NUNCA = () => new Promise(() => {});
const guardada = () => ({ 'saneadren-kiosco-v4': { '/kiosco': html(PAGINA('copia')) } });

test('caché: con red buena entrega la página nueva y la guarda', async () => {
  const s = sw(() => html(PAGINA('nueva')));
  const { r, texto } = await s.pedir('/kiosco');
  assert.equal(r.status, 200); assert.match(texto, /nueva/);
  assert.equal(r.headers.get('permissions-policy'), 'camera=(self)', 'conserva el permiso de cámara de la página');
  assert.match(await s.almacenes.get('saneadren-kiosco-v4').get('/kiosco').clone().text(), /nueva/);
});
test('caché: con la red COLGADA abre la copia guardada sin esperar a la red (antes: pantalla en blanco por minutos)', async () => {
  const s = sw(NUNCA, guardada());
  const t0 = Date.now(), { texto } = await s.pedir('/kiosco');
  assert.match(texto, /copia/); assert.ok(Date.now() - t0 < 1000, 'respondió en ' + (Date.now() - t0) + ' ms');
});
for (const [nombre, red] of [['caída', () => { throw new Error('sin red'); }], ['con error 503', () => new Response('', { status: 503 })], ['con respuesta vacía', () => html('')],
  ['con el portal del Wi-Fi', () => html('<html><body>Inicia sesión en el Wi-Fi</body></html>')], ['con un JSON de error', () => new Response('{"error":"x"}', { status: 429, headers: { 'content-type': 'application/json' } })],
  ['redirigida', () => Object.defineProperty(html(PAGINA('otra')), 'redirected', { value: true })]]) {
  test(`caché: con la red ${nombre} abre la copia buena (nunca la sustituye)`, async () => {
    const s = sw(red, guardada());
    const { texto } = await s.pedir('/kiosco');
    assert.match(texto, /copia/);
    assert.match(await s.almacenes.get('saneadren-kiosco-v4').get('/kiosco').clone().text(), /copia/, 'la copia buena sigue guardada');
  });
}
test('caché: /kiosco.html y /kiosco/ abren igual que /kiosco', async () => {
  const s = sw(NUNCA, guardada());
  assert.match((await s.pedir('/kiosco.html')).texto, /copia/); assert.match((await s.pedir('/kiosco/')).texto, /copia/);
});
test('caché: sin copia y sin red entrega una página que se reintenta sola (nunca en blanco)', async () => {
  for (const red of [NUNCA, () => { throw new Error('sin red'); }, () => new Response('', { status: 502 })]) {
    const { r, texto } = await sw(red).pedir('/kiosco');
    assert.equal(r.status, 200); assert.match(texto, /Reintentar ahora/); assert.match(texto, /location\.replace\('\/kiosco'\)/);
  }
});
test('caché: si la página nueva llega tarde, queda guardada y se avisa a la pantalla para que se actualice sola', async () => {
  let soltar; const s = sw(() => new Promise(ok => { soltar = () => ok(html(PAGINA('nueva'))); }), guardada());
  const x = await s.pedir('/kiosco');
  assert.match(x.texto, /copia/); assert.equal(s.mensajes.length, 0);
  soltar(); await x.detras();
  assert.equal(JSON.stringify(s.mensajes), JSON.stringify([{ kiosco: 'version-nueva' }]));
  assert.match(await s.almacenes.get('saneadren-kiosco-v4').get('/kiosco').clone().text(), /nueva/);
});
test('caché: si llega tarde pero es igual a la copia, no avisa (no hay ciclo de recargas)', async () => {
  let soltar; const s = sw(() => new Promise(ok => { soltar = () => ok(html(PAGINA('copia'))); }), guardada());
  const x = await s.pedir('/kiosco'); soltar(); await x.detras();
  assert.equal(s.mensajes.length, 0);
});
test('caché: muchas recargas seguidas con la red colgada responden todas', async () => {
  const s = sw(NUNCA, guardada());
  const l = await Promise.all(Array.from({ length: 25 }, () => s.pedir('/kiosco')));
  assert.ok(l.every(x => /copia/.test(x.texto)));
});
test('caché: la API y lo que no es del kiosco nunca pasan por aquí', async () => {
  const s = sw(() => html(PAGINA('x')));
  for (const [ruta, o] of [['/api/publico/kiosco/estado', { mode: 'cors' }], ['/api/publico/kiosco/checar', { method: 'POST', mode: 'cors' }], ['/', {}], ['/index.html', {}], ['/app.js', { mode: 'no-cors' }], ['/kiosco', { method: 'POST' }]])
    assert.equal((await s.pedir(ruta, o)).r, undefined, ruta);
});
test('caché: lo que usa el kiosco (cara, prueba de vida, impresión) se guarda y luego sale de lo guardado aunque no haya red', async () => {
  let hay = true; const s = sw(url => { if (!hay) throw new Error('sin red'); return new Response('datos de ' + url, { status: 200 }); });
  for (const ruta of ['/vendor/face-api/face-api.js', '/vendor/ort/ort-wasm-simd-threaded.wasm', '/imprimir-documentos.js?v=3', '/logo-saneadren.png'])
    assert.match((await s.pedir(ruta, { mode: 'no-cors' })).texto, /datos de/, ruta);
  hay = false;
  for (const ruta of ['/vendor/face-api/face-api.js', '/vendor/ort/ort-wasm-simd-threaded.wasm', '/imprimir-documentos.js?v=3', '/logo-saneadren.png']) {
    const x = await s.pedir(ruta, { mode: 'no-cors' }); await x.detras();
    assert.match(x.texto, /datos de/, ruta + ' sin red');
  }
  const mal = sw(() => new Response('no', { status: 500 })); await mal.pedir('/vendor/x.js', { mode: 'no-cors' });
  assert.equal(mal.almacenes.get('saneadren-kiosco-v4').size, 0, 'una respuesta de error no se guarda');
});
test('caché: se instala aunque no haya red y conserva la página de la versión anterior', async () => {
  const s = sw(() => { throw new Error('sin red'); }, { 'saneadren-kiosco-v3': { '/kiosco': html(PAGINA('de la v3')) } });
  await s.instalar();
  assert.match((await s.pedir('/kiosco')).texto, /de la v3/);
});

// ---------- 2. El vigilante ----------
const VIGILANTE = HTML.slice(HTML.indexOf('/* VIGILANTE'), HTML.indexOf('</script>', HTML.indexOf('/* VIGILANTE')));
function vigilante({ sesion = {} } = {}) {
  let ahora = 1_000_000, tic = null; const eventos = {}, recargas = [], espera_ = [];
  const pantalla = { firstElementChild: { id: 'arranque' }, innerText: 'Iniciando el reloj checador…', className: '', _html: '',
    set innerHTML(v) { this._html = v; this.firstElementChild = { id: 'arranque' }; this.innerText = 'Reiniciando el reloj checador…'; }, get innerHTML() { return this._html; },
    querySelector: () => ({ set textContent(v) { pantalla.mensaje = v; }, set onclick(v) { pantalla.boton = v; } }) };
  const document = { visibilityState: 'visible', addEventListener: (k, fn) => { eventos[k] = fn; },
    getElementById: id => (id === 'pantalla' ? pantalla : id === 'arranque' ? (pantalla.firstElementChild?.id === 'arranque' ? pantalla.firstElementChild : null) : null) };
  const window = { addEventListener: (k, fn) => { eventos[k] = fn; } };
  const almacen = v => ({ getItem: k => (k in v ? v[k] : null), setItem: (k, x) => { v[k] = String(x); }, removeItem: k => { delete v[k]; } });
  const local = {}, ctx = vm.createContext({ window, document, sessionStorage: almacen(sesion), localStorage: almacen(local), location: { replace: u => recargas.push(u) },
    Date: Object.assign(function () { return new Date(ahora); }, { now: () => ahora }), JSON, String, Math, setInterval: fn => { tic = fn; }, setTimeout: (fn, ms) => { espera_.push(ms); fn(); } });
  vm.runInContext(VIGILANTE, ctx);
  const K = window.__kiosco;
  return { K, pantalla, recargas, esperas: espera_, sesion, local, eventos, document, pasar: ms => { for (let t = 0; t < ms; t += 2000) { ahora += 2000; tic(); } },
    pintar: texto => { pantalla.firstElementChild = texto ? { id: 'teclado' } : null; pantalla.innerText = texto; } };
}
test('vigilante: es un bloque aparte, antes del programa del kiosco, y la pantalla nunca empieza en blanco', () => {
  const iVig = HTML.indexOf('/* VIGILANTE'), iProg = HTML.indexOf("const LLAVE = 'saneadren_kiosco'");
  assert.ok(iVig > 0 && iVig < iProg && HTML.slice(iVig, iProg).includes('</script>'), 'el vigilante va en su propio <script>, antes');
  assert.match(HTML, /<div class="pantalla" id="pantalla"><div class="arranque" id="arranque">.*<a href="\/kiosco">Reintentar<\/a>/);
});
test('vigilante: si todo va bien, no hace nada', () => {
  const v = vigilante(); v.K.listo = true; v.pintar('Escribe tu código'); v.pasar(120000);
  assert.deepEqual(v.recargas, []);
});
test('vigilante: si el programa no termina de iniciar (12 s), recarga y lo anota', () => {
  const v = vigilante(); v.pasar(10000); assert.deepEqual(v.recargas, []);
  v.pasar(4000);
  assert.deepEqual(v.recargas, ['/kiosco']); assert.match(v.local.saneadren_kiosco_diag, /no terminó de iniciar/);
  assert.match(v.pantalla.innerHTML, /Reintentar ahora/);
});
test('vigilante: pantalla vacía → primero le pide al programa volver al inicio, sin recargar', () => {
  const v = vigilante(); v.K.listo = true; v.pintar('Escribe tu código'); v.pasar(4000);
  v.K.revivir = () => v.pintar('Escribe tu código');
  v.pintar(''); v.pasar(8000);
  assert.deepEqual(v.recargas, []); assert.equal(v.pantalla.innerText, 'Escribe tu código'); assert.match(v.local.saneadren_kiosco_diag, /pantalla vacía/);
});
test('vigilante: si el programa no puede (o truena al intentarlo), recarga', () => {
  for (const revivir of [() => {}, () => { throw new Error('roto'); }, null]) {
    const v = vigilante(); v.K.listo = true; v.pintar('algo'); v.pasar(2000); v.K.revivir = revivir;
    v.pintar(''); v.pasar(8000);
    assert.deepEqual(v.recargas, ['/kiosco']);
  }
});
test('vigilante: las recargas se espacian (0, 5, 15, 30, 60, 60 s) y se olvidan tras un minuto funcionando', () => {
  const sesion = {}, esperas = [];
  for (let i = 0; i < 6; i++) { const v = vigilante({ sesion }); v.pasar(14000); esperas.push(Math.round(v.esperas.at(-1) / 1000)); }
  assert.deepEqual(esperas, [0, 5, 15, 30, 60, 60]);
  const v = vigilante({ sesion }); v.K.listo = true; v.pintar('Escribe tu código'); v.pasar(200000);
  assert.equal(JSON.parse(sesion.saneadren_kiosco_vigia).n, undefined);
});
test('vigilante: con la tableta bloqueada (página oculta) no recarga', () => {
  const v = vigilante(); v.document.visibilityState = 'hidden'; v.eventos.visibilitychange(); v.pasar(120000);
  assert.deepEqual(v.recargas, []);
});
test('vigilante: un error del programa al iniciar lo recupera', () => {
  const v = vigilante(); v.pasar(4000); v.eventos.error({ message: 'x is not defined' });
  assert.deepEqual(v.recargas, ['/kiosco']); assert.match(v.local.saneadren_kiosco_diag, /error al iniciar/);
});

// ---------- 3. La página ----------
test('página: toda petición al servidor y la cámara tienen límite de tiempo', () => {
  const api = HTML.slice(HTML.indexOf('  async function api(ruta, cuerpo) {'), HTML.indexOf('  async function conectar()'));
  assert.match(api, /new AbortController\(\)/); assert.match(api, /signal: corte\.signal/); assert.match(api, /finally \{ clearTimeout\(t\); \}/);
  assert.match(HTML, /Promise\.race\(\[pedida, new Promise\(\(_, mal\) => setTimeout\(/, 'getUserMedia con límite');
  assert.equal((HTML.match(/await fetch\(/g) || []).length, 1, 'el único fetch con espera es el de api()');
});
test('página: una respuesta que no es del servidor del checador (portal del Wi-Fi, vacía) cuenta como sin conexión y no descompone el reloj', () => {
  const api = HTML.slice(HTML.indexOf('  async function api(ruta, cuerpo) {'), HTML.indexOf('  // Dado de baja'));
  assert.match(api, /application\\\/json/); assert.match(api, /Number\.isFinite\(hora\)/);
  assert.match(HTML, /function tic\(\) \{ if \(!Number\.isFinite\(desfase\)\) desfase = 0;/);
});
test('página: el teclado sale ANTES de consultar al servidor (antes se quedaba vacía esperándolo)', () => {
  const arranque = HTML.slice(HTML.lastIndexOf('  (async () => {'));
  assert.ok(arranque.indexOf('inicio();') > 0 && arranque.indexOf('inicio();') < arranque.indexOf('await conectar()'));
  assert.ok(arranque.indexOf('window.__kiosco.listo = true') < arranque.indexOf('await conectar()'));
});
test('página: al volver del bloqueo se recupera sola y nada externo detiene el arranque', () => {
  for (const k of ["document.addEventListener('visibilitychange'", "window.addEventListener('pageshow'", "document.addEventListener('resume'", "window.addEventListener('focus'"]) assert.ok(HTML.includes(k + ', '), k);
  assert.match(HTML, /candado\?\.addEventListener\('release'/, 'la pantalla encendida se vuelve a pedir');
  const scripts = [...HTML.matchAll(/<script src="([^"]+)"([^>]*)>/g)];
  assert.ok(scripts.length && scripts.every(m => / async/.test(m[2])), 'ningún archivo externo se carga deteniendo la página');
  assert.match(HTML, /overscroll-behavior:none/, 'sin «jalar para recargar»');
});
