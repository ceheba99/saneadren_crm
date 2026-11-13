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
  .replace('LIMITE_RED_MS = 20000', 'LIMITE_RED_MS = 400').replace('LIMITE_ARCHIVO_MS = 60000', 'LIMITE_ARCHIVO_MS = 400')
  .replace('LIMITE_CACHE_MS = 1500', 'LIMITE_CACHE_MS = 60'); // tiempos cortos para la prueba
const HTML = fs.readFileSync(path.join(__dirname, '../public/kiosco.html'), 'utf8');
const PAGINA = v => `<!doctype html><html><body><div id="pantalla"></div><script>const LLAVE = 'saneadren_kiosco'; /* ${v} */</script></body></html>`;
const html = (texto, extra = {}) => new Response(texto, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'permissions-policy': 'camera=(self)', ...extra } });
const espera = ms => new Promise(r => setTimeout(r, ms));

// Un service worker de mentira: caché en memoria, red que se programa en cada prueba y clientes que reciben avisos.
function sw(red, cachesIniciales = {}, { almacenColgado = false } = {}) {
  const almacenes = new Map(Object.entries(cachesIniciales).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const llave = k => (typeof k === 'string' ? k : k.url);
  const caches = {
    async open(n) { if (almacenColgado) await new Promise(() => {}); if (!almacenes.has(n)) almacenes.set(n, new Map()); const m = almacenes.get(n);
      return { async match(k) { const r = m.get(llave(k)); return r ? r.clone() : undefined; }, async put(k, r) { m.set(llave(k), r); }, async keys() { return [...m.keys()].map(url => ({ url })); } }; },
    async keys() { return [...almacenes.keys()]; }, async delete(n) { return almacenes.delete(n); },
  };
  const eventos = {}, mensajes = [], estado = { red, pedidas: [] };
  const self = { location: { origin: 'https://sistema.test' }, addEventListener: (k, fn) => { eventos[k] = fn; }, skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [{ postMessage: m => mensajes.push(m) }] } };
  const fetchFalso = (url, o = {}) => { estado.pedidas.push(String(url)); return new Promise((ok, mal) => { o.signal?.addEventListener('abort', () => mal(new Error('abortada'))); Promise.resolve().then(() => estado.red(String(url), o)).then(ok, mal); }); };
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
// 2026-11-12 (Dirección: «otra vez en blanco al desbloquear; tuve que reiniciar la app»).
test('caché: si el ALMACÉN de la caché no contesta (tableta saliendo del bloqueo), la página se entrega igual', async () => {
  const s = sw(() => html(PAGINA('de la red')), {}, { almacenColgado: true });
  const t0 = Date.now(), { texto } = await s.pedir('/kiosco');
  assert.match(texto, /de la red/); assert.ok(Date.now() - t0 < 1000, 'respondió en ' + (Date.now() - t0) + ' ms');
  const sinRed = sw(NUNCA, {}, { almacenColgado: true }), x = await sinRed.pedir('/kiosco');
  assert.match(x.texto, /Se reintenta solo/, 'sin almacén y sin red: la página que se reintenta sola');
  assert.match((await s.pedir('/vendor/face-api/face-api.js', { mode: 'no-cors' })).texto, /de la red/, 'los archivos también');
});
test('caché: «/kiosco?copia=1» (reinicio tras el bloqueo) entrega la copia al instante y baja la nueva por detrás', async () => {
  const s = sw(async () => { await espera(40); return html(PAGINA('nueva')); }, guardada()); // red buena pero no inmediata
  const t0 = Date.now(), x = await s.pedir('/kiosco?copia=1');
  assert.match(x.texto, /copia/); assert.ok(Date.now() - t0 < 30, 'no esperó a la red: ' + (Date.now() - t0) + ' ms');
  await x.detras();
  assert.match(await s.almacenes.get('saneadren-kiosco-v4').get('/kiosco').clone().text(), /nueva/);
  assert.equal(JSON.stringify(s.mensajes), '[{"kiosco":"version-nueva"}]');
  assert.match((await sw(() => html(PAGINA('nueva'))).pedir('/kiosco?copia=1')).texto, /nueva/, 'sin copia guardada, la de la red');
});
test('caché: deja bitácora de las aperturas (de dónde salió la página y cuánto tardó)', async () => {
  const s = sw(NUNCA, guardada());
  for (let i = 0; i < 8; i++) { const x = await s.pedir('/kiosco'); await espera(2); x.detras(); }
  await espera(30);
  const l = await s.almacenes.get('saneadren-kiosco-v4').get('/kiosco-bitacora').clone().json();
  assert.equal(l.length, 6, 'solo las últimas 6'); assert.ok(l.every(x => x.de === 'copia' && x.ms >= 0 && x.t > 0));
  const colgada = sw(NUNCA, guardada()); colgada.pedir('/kiosco'); await espera(20);
  assert.deepEqual((await colgada.almacenes.get('saneadren-kiosco-v4').get('/kiosco-bitacora').clone().json()).map(x => [x.ms, x.de]), [[null, 'sin respuesta']], 'una apertura a medias queda anotada');
});

// ---------- 2. El vigilante ----------
const VIGILANTE = HTML.slice(HTML.indexOf('/* VIGILANTE'), HTML.indexOf('</script>', HTML.indexOf('/* VIGILANTE')));
function vigilante({ sesion = {}, local = {}, bitacora = null, navegacion = 'navigate' } = {}) {
  let ahora = 1_000_000, tic = null; const eventos = {}, recargas = [], espera_ = [];
  const pantalla = { firstElementChild: { id: 'arranque' }, innerText: 'Iniciando el reloj checador…', className: '', _html: '',
    set innerHTML(v) { this._html = v; this.firstElementChild = { id: 'arranque' }; this.innerText = 'Reiniciando el reloj checador…'; }, get innerHTML() { return this._html; },
    querySelector: () => ({ set textContent(v) { pantalla.mensaje = v; }, set onclick(v) { pantalla.boton = v; } }) };
  const document = { visibilityState: 'visible', addEventListener: (k, fn) => { eventos[k] = fn; },
    getElementById: id => (id === 'pantalla' ? pantalla : id === 'arranque' ? (pantalla.firstElementChild?.id === 'arranque' ? pantalla.firstElementChild : null) : null) };
  const window = { addEventListener: (k, fn) => { eventos[k] = fn; } };
  const almacen = v => ({ getItem: k => (k in v ? v[k] : null), setItem: (k, x) => { v[k] = String(x); }, removeItem: k => { delete v[k]; } });
  const ctx = vm.createContext({ window, document, performance: { getEntriesByType: () => [{ type: navegacion }], memory: { usedJSHeapSize: 85 * 1048576 } },
    caches: { match: () => ({ then: ok => ({ then: (ok2, mal) => { try { ok2(ok(bitacora ? { json: () => bitacora } : null)); } catch (e) { mal(e); } } }) }) }, sessionStorage: almacen(sesion), localStorage: almacen(local), location: { replace: u => recargas.push(u) },
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
// 2026-11-12: la caja negra (el vigilante solo anotaba lo que él arreglaba; si alguien reiniciaba la app no quedaba nada).
const AHORA = 1_000_000, HORA = 3600000;
test('caja negra: guarda una señal de vida cada 5 s y si la tableta está a la vista o bloqueada', () => {
  const v = vigilante(); v.K.listo = true; v.pintar('Escribe tu código'); v.pasar(10000);
  let c = JSON.parse(v.local.saneadren_kiosco_caja);
  assert.ok(c.lat > AHORA + 4000 && c.lat <= AHORA + 10000, 'señal reciente'); assert.equal(c.ocu, 0); assert.equal(c.mem, 85);
  v.document.visibilityState = 'hidden'; v.eventos.visibilitychange(); v.pasar(60000);
  c = JSON.parse(v.local.saneadren_kiosco_caja);
  assert.equal(c.lat, AHORA + 10000, 'bloqueada: la señal se queda en el momento del bloqueo'); assert.equal(c.ocu, AHORA + 10000);
  v.document.visibilityState = 'visible'; v.eventos.visibilitychange();
  assert.equal(JSON.parse(v.local.saneadren_kiosco_caja).ocu, 0);
});
test('caja negra: si alguien tuvo que reiniciar la app, al arrancar queda anotado cómo estaba (para los Logs)', () => {
  // Se bloqueó hace 9 h y el programa nunca volvió a correr: el navegador lo descartó o la recarga no llegó.
  let v = vigilante({ local: { saneadren_kiosco_caja: JSON.stringify({ lat: AHORA - 9 * HORA, ocu: AHORA - 9 * HORA, mem: 140 }) },
    bitacora: [{ t: AHORA - 10 * HORA, ms: 30, de: 'red' }, { t: AHORA - 60000, ms: null, de: 'sin respuesta' }, { t: AHORA - 5, ms: 20, de: 'copia' }] });
  let d = JSON.parse(v.local.saneadren_kiosco_diag);
  assert.equal(d.length, 1);
  assert.equal(d[0].m, 'Reinicio (abrieron la app). Última señal hace 9 h; estaba bloqueada u oculta; memoria 140 MB; caché: 1 sin responder');
  assert.ok(d[0].m.length <= 160, 'cabe en el renglón de los Logs');
  // El programa seguía vivo y a la vista (pantalla sin dibujar) cuando reiniciaron.
  v = vigilante({ local: { saneadren_kiosco_caja: JSON.stringify({ lat: AHORA - 20000, ocu: 0 }) }, navegacion: 'reload' });
  assert.equal(JSON.parse(v.local.saneadren_kiosco_diag)[0].m, 'Reinicio (recarga del navegador). Última señal hace menos de 1 min; estaba a la vista');
  assert.equal(JSON.parse(v.local.saneadren_kiosco_caja).lat, AHORA, 'la caja empieza de nuevo');
});
test('caja negra: las recargas que pide el propio kiosco (regreso del bloqueo, versión nueva, vigilante) no se anotan como reinicio', () => {
  const local = {}; let v = vigilante({ local }); v.K.cierre('regreso del bloqueo');
  v = vigilante({ local }); assert.equal(local.saneadren_kiosco_diag, undefined);
  v.pasar(14000); // el vigilante recarga: anota su motivo, y el arranque siguiente no lo repite
  v = vigilante({ local });
  assert.deepEqual(JSON.parse(local.saneadren_kiosco_diag).map(x => x.m), ['no terminó de iniciar']);
  assert.equal(vigilante().local.saneadren_kiosco_diag, undefined, 'la primera vez no hay nada que anotar');
});
test('página: al volver de un bloqueo de más de 15 s se reinicia sola con la copia guardada (lo que antes se hacía a mano)', () => {
  const revivir = HTML.slice(HTML.indexOf('  function revivir(motivo'), HTML.indexOf("  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revivir()"));
  assert.match(HTML, /const REINICIO_MS = 15000;/);
  assert.match(revivir, /if \(fuera > REINICIO_MS && !deBaja && registro\?\.token && navigator\.serviceWorker\?\.controller\) \{ window\.__kiosco\.cierre\('regreso del bloqueo'\); location\.replace\('\/kiosco\?copia=1'\); return; \}/);
  assert.ok(revivir.indexOf('location.replace') < revivir.indexOf('despierta(); tic();'), 'antes que todo lo demás');
  assert.match(HTML, /window\.__kiosco\.cierre\('versión nueva'\); location\.reload\(\);/);
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
// 2026-11-12 (Dirección: «al cerrar y abrir la app no sale el botón de leer la credencial»).
test('página: el botón «Leer mi credencial» aparece aunque el lector de QR conteste después del teclado, y se reintenta', async () => {
  const codigo = HTML.slice(HTML.indexOf('  let lectorQR = null, buscandoQR = false;'), HTML.indexOf('  const LECTURA_MS'));
  const hacer = async (formatos, estado, tecleado = '') => {
    const pintadas = [], esperas = [];
    const pantalla = { querySelector: q => (q === '.btn-credencial' ? null : { textContent: tecleado.padEnd(4, '·') }) };
    function BarcodeDetector() {} let n = 0;
    BarcodeDetector.getSupportedFormats = () => { const f = formatos[Math.min(n++, formatos.length - 1)]; return f ? Promise.resolve(f) : Promise.reject(new Error('no')); };
    const ctx = vm.createContext({ window: { BarcodeDetector }, BarcodeDetector, estado, $: () => pantalla, inicio: () => pintadas.push(1), setTimeout: (fn, ms) => { esperas.push(ms); if (esperas.length < 8) fn(); } });
    vm.runInContext(codigo + '; globalThis.lector = () => lectorQR;', ctx);
    for (let i = 0; i < 20; i++) await null;
    return { pintadas: pintadas.length, esperas, lector: !!ctx.lector() };
  };
  assert.deepEqual(await hacer([['qr_code']], { esCodigo: true }), { pintadas: 1, esperas: [], lector: true }, 'contesta tarde: se vuelve a pintar con el botón');
  assert.equal((await hacer([['qr_code']], { esCodigo: true }, '12')).pintadas, 0, 'si alguien ya está tecleando no se le borra');
  assert.equal((await hacer([['qr_code']], {})).pintadas, 0, 'en otra pantalla no se toca nada');
  assert.deepEqual(await hacer([[], null, ['qr_code']], { esCodigo: true }), { pintadas: 1, esperas: [2000, 5000], lector: true }, 'recién instalada: todavía no hay lector → se reintenta');
  assert.deepEqual((await hacer([[]], { esCodigo: true })).esperas, [2000, 5000, 15000, 60000], 'sin lector: 4 reintentos y ya');
  assert.match(HTML, /despierta\(\); tic\(\); buscarLectorQR\(\);/, 'y al desbloquear la tableta');
});
// 2026-11-12 (Dirección: «revisa a detalle todo el checador y blinda todo lo que se pueda»).
test('blindaje: si la red falla justo al checar, se reintenta y la checada de quien puso su PIN se guarda aquí (no se pierde)', () => {
  const checar = HTML.slice(HTML.indexOf('  async function checar(datos, tipo) {'), HTML.indexOf('  // servicios: si la persona tiene órdenes asignadas'));
  assert.match(checar, /for \(let i = 0; i < 2 && !r; i\+\+\) \{ try \{ r = await api\('checar', cuerpo\); \}/, 'dos intentos con el mismo permiso');
  assert.match(checar, /if \(!r \|\| r\.status >= 500\) \{\s+if \(datos\.respaldo\) \{[^}]*\} return guardarSinConexion\(\{ \.\.\.datos\.respaldo, tipo, foto: imagen \}\);/, 'sin red o con el servidor fallando: se guarda en el kiosco');
  assert.match(checar, /r\.status === 401 && r\.j\.codigo !== 'KIOSCO_NO_REGISTRADO' && datos\.respaldo/, 'permiso caducado (el sistema se actualizó): se pide otro solo');
  assert.match(HTML, /const datos = \{ \.\.\.r\.j, respaldo: \{ codigo, pin \} \};/);
});
test('blindaje: una checada guardada que el servidor no acepta no detiene a las demás de la cola', () => {
  const subir = HTML.slice(HTML.indexOf('  async function subirPendientes() {'), HTML.indexOf('  // ---------- Arranque ----------'));
  assert.match(subir, /if \(r\.status === 429\) break;/); assert.match(subir, /x\.intentos = \(x\.intentos \|\| 0\) \+ 1; await cola\('readwrite', s => s\.put\(x\)\);\s+if \(\+\+fallas >= 5\) break;/);
  assert.match(subir, /\.sort\(\(a, b\) => \(a\.intentos \|\| 0\) - \(b\.intentos \|\| 0\) \|\| a\.t0 - b\.t0\)/, 'primero las que menos intentos llevan');
  assert.doesNotMatch(subir, /break; \/\/ 429 o error del servidor/);
});
test('blindaje: solo el servidor del checador puede desregistrar la tableta o desligar el celular', () => {
  assert.match(HTML, /if \(r\.status === 401 && r\.j\.codigo === 'KIOSCO_NO_REGISTRADO'\) \{ noRegistrado\(\); return false; \}/);
  const CEL = fs.readFileSync(path.join(__dirname, '../public/checar.html'), 'utf8');
  assert.equal((CEL.match(/localStorage\.removeItem\(LLAVE\)/g) || []).length, 2);
  assert.equal((CEL.match(/r\.status === 401 && r\.j\.codigo === 'CELULAR_NO_LIGADO'\) \{ try \{ localStorage\.removeItem\(LLAVE\)/g) || []).length, 2, 'las dos veces, solo con el aviso del servidor');
  assert.match(CEL, /new AbortController\(\), t = setTimeout\(\(\) => corte\.abort\(\), 20000\)/, 'el celular ya no se queda en «Registrando…» para siempre');
  assert.match(CEL, /for \(let i = 0; i < 3 && !r; i\+\+\) \{ try \{ r = await api\('checar', cuerpo\); \}/, 'con mala señal reintenta con la misma foto');
});
test('blindaje: la pantalla encendida se vuelve a pedir sola, lo guardado se protege y la tableta reporta batería y cámara', () => {
  assert.match(HTML, /candado\?\.addEventListener\('release', \(\) => \{ candado = null; setTimeout\(despierta, 1000\); \}\)/);
  assert.match(HTML, /despierta\(\); \/\/ el sistema puede soltar «pantalla encendida»/);
  assert.match(HTML, /navigator\.storage\?\.persist\?\.\(\)/);
  assert.match(HTML, /const r = await api\('estado' \+ estadoTableta\(\)\);/);
  assert.match(HTML, /if \(camaraFallo && estado\.esCodigo\) iniciarCamara\(\)/, 'la cámara se prueba sola otra vez');
});


// 2026-11-13 (la tableta iba lenta): los archivos grandes ya guardados (reconocimiento facial, prueba de vida: 22 MB) se
// volvían a bajar y a escribir en la caché en CADA apertura. Ahora solo se pregunta si cambiaron (ETag).
test('caché: un archivo guardado que no cambió no se vuelve a bajar ni a escribir', async () => {
  const U = 'https://sistema.test/vendor/ort/ort-wasm-simd-threaded.wasm', viejo = new Response('guardado', { status: 200, headers: { etag: 'W/"a1"' } });
  const vistos = [], s = sw((url, o) => { vistos.push(o.headers?.['If-None-Match'] || null); return new Response(null, { status: 304 }); }, { 'saneadren-kiosco-v4': { [U]: viejo } });
  const x = await s.pedir('/vendor/ort/ort-wasm-simd-threaded.wasm', { mode: 'no-cors' }); await x.detras();
  assert.equal(x.texto, 'guardado');
  assert.deepEqual(vistos, ['W/"a1"'], 'pregunta al servidor solo si cambió');
  assert.equal(s.almacenes.get('saneadren-kiosco-v4').get(U), viejo, 'no se reescribió');
});
test('caché: si el archivo guardado sí cambió, se guarda el nuevo para la próxima vez', async () => {
  const U = 'https://sistema.test/vendor/face-api/face-api.js';
  const s = sw(() => new Response('nuevo', { status: 200, headers: { etag: 'W/"b2"' } }), { 'saneadren-kiosco-v4': { [U]: new Response('guardado', { status: 200, headers: { etag: 'W/"a1"' } }) } });
  const x = await s.pedir('/vendor/face-api/face-api.js', { mode: 'no-cors' }); await x.detras();
  assert.equal(x.texto, 'guardado', 'esta vez entrega lo guardado, sin esperar');
  assert.equal(await s.almacenes.get('saneadren-kiosco-v4').get(U).clone().text(), 'nuevo');
});
