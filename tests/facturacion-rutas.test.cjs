// Facturación · pantalla de configuración (2026-10-27): pruebas de las rutas /api/facturacion/* SIN red. Se monta un servidor chico con las rutas reales,
// una sesión simulada (Dirección o no) y un «factura.com» simulado que se inyecta. Revisa: solo Dirección, el demo nunca se conecta, las llaves nunca salen,
// los errores se muestran en español, el doble clic no repite, un fallo no deja cambios a medias y todo queda en la bitácora.
// Uso: node --test tests/facturacion-rutas.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crearTablas = require('../server/facturacion-db');
const rutas = require('../server/facturacion-rutas');
const { ErrorFactura } = require('../server/facturacom');

const LLAVE = 'LLAVE-QUE-NO-DEBE-SALIR-111', SECRETA = 'SECRETA-QUE-NO-DEBE-SALIR-222';
const ENV = { FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: LLAVE, FACTURA_SANDBOX_SECRET_KEY: SECRETA, FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '26015' };
const SERIES = [{ SerieID: 11, SerieName: 'F', SerieType: 'factura', SerieDescription: 'Factura', SerieStatus: 'Activa' }, { SerieID: 12, SerieName: 'FM', SerieType: 'factura', SerieDescription: '', SerieStatus: 'Activa' },
  { SerieID: 13, SerieName: 'PA', SerieType: 'pago', SerieDescription: 'Pago', SerieStatus: 'Activa' }, { SerieID: 14, SerieName: 'OLD', SerieType: 'factura', SerieDescription: '', SerieStatus: 'Inactiva' }];

/** Monta todo: base en memoria, rutas y un servidor HTTP. «cfg» controla la sesión, el demo y el factura.com simulado. */
async function montar(cfg = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY); CREATE TABLE clientes (id INTEGER PRIMARY KEY); CREATE TABLE leads (id INTEGER PRIMARY KEY); CREATE TABLE cobros (id INTEGER PRIMARY KEY);
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT); CREATE TABLE sucursales (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1);
    INSERT INTO sucursales (nombre, clave) VALUES ('Querétaro', 'QRO'), ('Ciudad de México', 'CDMX');`);
  crearTablas(db);
  const estado = { direccion: true, demo: false, llamadas: [], bitacora: [], proximo: null, ...cfg };
  const clienteSim = () => ({ config: { entorno: 'sandbox' }, get: async ruta => {
    estado.llamadas.push('GET ' + ruta);
    if (estado.proximo) { const p = estado.proximo; if (p.espera) await new Promise(r => setTimeout(r, p.espera)); if (p.error) throw p.error; }
    if (ruta === '/v4/series') return { datos: SERIES };
    return { crudo: { response: 'success', data: [{ key: '601', name: 'General' }] }, datos: [{ key: '601', name: 'General' }] };
  }, post: async () => { throw new Error('no debe llamarse'); } });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.usuarioSesion = { id: 1, nombre: 'Dirección', rol: estado.direccion ? 'admin' : 'ventas' }; next(); });
  const h = fn => (req, res) => { try { fn(req, res); } catch (e) { res.status(500).json({ error: 'Error interno del servidor' }); } };
  rutas(app, db, h, { direccion: () => estado.direccion, esDemo: () => estado.demo, crearCliente: clienteSim, env: ENV, auditar: (req, entidad, id, accion, detalle) => estado.bitacora.push({ entidad, id, accion, detalle }) });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/facturacion';
  const pedir = async (metodo, ruta, cuerpo) => { const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { db, estado, pedir, cerrar: () => { srv.close(); db.close(); } };
}
const conMontaje = (nombre, cfg, fn) => test(nombre, async () => { const m = await montar(cfg); try { await fn(m); } finally { m.cerrar(); } });

conMontaje('Solo Dirección: todas las rutas responden 403 a cualquier otro rol y no llaman a factura.com', { direccion: false }, async ({ pedir, estado }) => {
  for (const [m, r, c] of [['GET', '/config'], ['POST', '/probar', {}], ['POST', '/catalogos', {}], ['PUT', '/sucursales/1', { cp_expedicion: '76087' }]]) {
    const x = await pedir(m, r, c); assert.equal(x.status, 403, m + ' ' + r); assert.match(x.json.error, /solo de Dirección/);
  }
  assert.deepEqual(estado.llamadas, []);
});
conMontaje('Configuración: estado sin llaves, sucursales y catálogos', {}, async ({ pedir, db }) => {
  db.exec("INSERT INTO sat_catalogos (catalogo, clave, nombre) VALUES ('RegimenFiscal', '601', 'x'), ('RegimenFiscal', '626', 'y')");
  const x = await pedir('GET', '/config'); assert.equal(x.status, 200);
  const texto = JSON.stringify(x.json); assert.ok(!texto.includes(LLAVE) && !texto.includes(SECRETA), 'las llaves nunca salen');
  assert.equal(x.json.entorno, 'sandbox'); assert.equal(x.json.apiKey, 'puesta'); assert.equal(x.json.secretKey, 'puesta'); assert.deepEqual(x.json.emisor, { regimen: '601', cp: '26015' }); assert.equal(x.json.demo, false); assert.equal(x.json.listo, true);
  assert.deepEqual(x.json.sucursales.map(s => [s.clave, s.cp_expedicion, s.serie_factura, s.serie_pago]), [['QRO', '', null, null], ['CDMX', '', null, null]]);
  assert.deepEqual(x.json.catalogos.find(c => c.catalogo === 'RegimenFiscal').total, 2); assert.equal(x.json.catalogos.find(c => c.catalogo === 'UsoCfdi').total, 0); assert.equal(x.json.catalogos.length, 5);
});
conMontaje('Probar conexión: devuelve las series; el demo nunca se conecta', {}, async ({ pedir, estado }) => {
  const x = await pedir('POST', '/probar', {}); assert.equal(x.status, 200); assert.equal(x.json.ok, true); assert.deepEqual(x.json.series.map(s => [s.id, s.nombre, s.tipo, s.activa]), [['11', 'F', 'factura', true], ['12', 'FM', 'factura', true], ['13', 'PA', 'pago', true], ['14', 'OLD', 'factura', false]]);
  estado.llamadas.length = 0; estado.demo = true;
  for (const [r, c] of [['/probar', {}], ['/catalogos', {}]]) { const y = await pedir('POST', r, c); assert.equal(y.status, 409, r); assert.match(y.json.error, /demo no se conecta/); }
  assert.equal((await pedir('PUT', '/sucursales/1', { serie_factura: '11' })).status, 409, 'en el demo tampoco se cambian series');
  assert.deepEqual(estado.llamadas, [], 'en el demo no se hace ninguna llamada');
});
conMontaje('Errores de factura.com: se muestran en español y el servidor sigue vivo', {}, async ({ pedir, estado }) => {
  estado.proximo = { error: new ErrorFactura('api', 'La cuenta que intenta autenticarse no existe') };
  let x = await pedir('POST', '/probar', {}); assert.equal(x.status, 502); assert.equal(x.json.error, 'La cuenta que intenta autenticarse no existe');
  estado.proximo = { error: new ErrorFactura('config', 'Faltan las llaves de factura.com') }; x = await pedir('POST', '/probar', {}); assert.equal(x.status, 400);
  estado.proximo = { error: new ErrorFactura('tiempo', 'tardó más de 30 segundos') }; x = await pedir('POST', '/probar', {}); assert.equal(x.status, 502);
  const registro = []; const original = console.error; console.error = (...a) => registro.push(a.join(' '));
  estado.proximo = { error: new TypeError('algo inesperado con LLAVE-QUE-NO-DEBE-SALIR-111 y SECRETA-QUE-NO-DEBE-SALIR-222') }; try { x = await pedir('POST', '/probar', {}); } finally { console.error = original; }
  assert.equal(registro.length, 1); assert.ok(registro[0].includes('algo inesperado con *** y ***')); assert.ok(!registro[0].includes('LLAVE-QUE') && !registro[0].includes('SECRETA-QUE'), 'el registro del servidor no lleva llaves');
  assert.equal(x.status, 500); assert.equal(x.json.error, 'Error interno del servidor'); assert.ok(!JSON.stringify(x.json).includes('LLAVE'), 'un error inesperado no se cuenta');
  estado.proximo = null; assert.equal((await pedir('POST', '/probar', {})).status, 200, 'sigue funcionando después de un error inesperado');
});
conMontaje('Doble clic: una segunda operación igual mientras la primera sigue se rechaza', {}, async ({ pedir, estado }) => {
  estado.proximo = { espera: 150 };
  const [a, b] = await Promise.all([pedir('POST', '/probar', {}), (async () => { await new Promise(r => setTimeout(r, 30)); return pedir('POST', '/probar', {}); })()]);
  assert.deepEqual([a.status, b.status], [200, 409]); assert.match(b.json.error, /Ya se está haciendo/); assert.equal(estado.llamadas.filter(l => l === 'GET /v4/series').length, 1);
  estado.proximo = null; assert.equal((await pedir('POST', '/probar', {})).status, 200, 'después se puede otra vez');
});
conMontaje('Catálogos: se guardan y queda en la bitácora', {}, async ({ pedir, estado, db }) => {
  const x = await pedir('POST', '/catalogos', {}); assert.equal(x.status, 200); assert.equal(x.json.catalogos.find(c => c.catalogo === 'RegimenFiscal').total, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sat_catalogos WHERE catalogo = 'RegimenFiscal'").get().n, 1);
  assert.equal(estado.bitacora.length, 1); assert.deepEqual([estado.bitacora[0].entidad, estado.bitacora[0].accion], ['catalogo', 'facturacion']); assert.match(estado.bitacora[0].detalle, /Actualizó los catálogos del SAT: RegimenFiscal 1/);
});
conMontaje('Sucursal: el CP se valida, se guarda (con su cero), se quita y queda en la bitácora', {}, async ({ pedir, estado, db }) => {
  for (const cp of ['9410', '0941A', '094100', '09 41']) { const x = await pedir('PUT', '/sucursales/2', { cp_expedicion: cp }); assert.equal(x.status, 400, cp); assert.match(x.json.error, /5 números/); }
  let x = await pedir('PUT', '/sucursales/2', { cp_expedicion: ' 09410 ' }); assert.equal(x.status, 200); assert.equal(x.json.cp_expedicion, '09410');
  assert.equal(db.prepare('SELECT cp_expedicion FROM sucursales WHERE id = 2').get().cp_expedicion, '09410'); assert.equal(db.prepare('SELECT cp_expedicion FROM sucursales WHERE id = 1').get().cp_expedicion, null, 'otra sucursal no cambia');
  assert.match(estado.bitacora.at(-1).detalle, /Ciudad de México: CP de expedición 09410/); assert.equal(estado.bitacora.at(-1).id, 2);
  x = await pedir('PUT', '/sucursales/2', { cp_expedicion: '' }); assert.equal(x.status, 200); assert.equal(x.json.cp_expedicion, ''); assert.equal(db.prepare('SELECT cp_expedicion FROM sucursales WHERE id = 2').get().cp_expedicion, null);
  assert.equal((await pedir('PUT', '/sucursales/99', { cp_expedicion: '09410' })).status, 404); assert.equal((await pedir('PUT', '/sucursales/2', {})).status, 400); assert.equal((await pedir('PUT', '/sucursales/2', { otra_cosa: 1 })).status, 400);
});
conMontaje('Sucursal: asignar y quitar series (se comprueban contra la lista de factura.com)', {}, async ({ pedir, estado, db }) => {
  let x = await pedir('PUT', '/sucursales/1', { serie_factura: '11', serie_pago: '13' }); assert.equal(x.status, 200);
  assert.deepEqual([x.json.serie_factura, x.json.serie_pago], [{ id: '11', nombre: 'F' }, { id: '13', nombre: 'PA' }]);
  assert.match(estado.bitacora.at(-1).detalle, /Querétaro: serie de factura F · serie de pago PA/);
  for (const [cuerpo, texto] of [[{ serie_factura: '13' }, /es de tipo «pago», no de «factura»/], [{ serie_factura: '14' }, /desactivada/], [{ serie_factura: '999' }, /no existe en factura\.com/], [{ serie_factura: '11' }, null]]) {
    x = await pedir('PUT', '/sucursales/2', cuerpo);
    if (texto) { assert.equal(x.status, 400, JSON.stringify(cuerpo)); assert.match(x.json.error, texto); } else { assert.equal(x.status, 400); assert.match(x.json.error, /ya está asignada a la sucursal «Querétaro»/); }
  }
  assert.equal((await pedir('PUT', '/sucursales/2', { serie_factura: 'abc' })).status, 400); assert.equal((await pedir('PUT', '/sucursales/2', { serie_factura: '1; DROP TABLE' })).status, 400);
  x = await pedir('PUT', '/sucursales/1', { serie_pago: null }); assert.equal(x.status, 200); assert.equal(x.json.serie_pago, null); assert.equal(x.json.serie_factura.nombre, 'F', 'lo que no se menciona no se toca');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM series_factura WHERE sucursal_id = 1').get().n, 1);
  x = await pedir('PUT', '/sucursales/1', { serie_factura: '12' }); assert.equal(x.json.serie_factura.nombre, 'FM', 'cambiar la serie reemplaza a la anterior'); assert.equal(db.prepare('SELECT COUNT(*) n FROM series_factura WHERE sucursal_id = 1').get().n, 1);
});
conMontaje('Sucursal: si la serie falla NO se cambia el CP (nada a medias) y un error de red se explica', {}, async ({ pedir, estado, db }) => {
  let x = await pedir('PUT', '/sucursales/1', { cp_expedicion: '76087', serie_factura: '999' }); assert.equal(x.status, 400);
  assert.equal(db.prepare('SELECT cp_expedicion FROM sucursales WHERE id = 1').get().cp_expedicion, null, 'el CP no quedó guardado');
  estado.proximo = { error: new ErrorFactura('red', 'No se pudo conectar con factura.com') }; x = await pedir('PUT', '/sucursales/1', { cp_expedicion: '76087', serie_factura: '11' }); assert.equal(x.status, 502); assert.match(x.json.error, /No se pudo conectar/);
  assert.equal(db.prepare('SELECT cp_expedicion FROM sucursales WHERE id = 1').get().cp_expedicion, null); assert.equal(db.prepare('SELECT COUNT(*) n FROM series_factura').get().n, 0);
  estado.bitacora.length = 0; estado.proximo = null; await pedir('PUT', '/sucursales/1', { serie_factura: '999' }); assert.equal(estado.bitacora.length, 0, 'lo que falla no queda en la bitácora');
});
conMontaje('Demo: el CP sí se puede cambiar (no llama a nada); quitar una serie también', { demo: true }, async ({ pedir, estado, db }) => {
  db.prepare("INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid) VALUES (1, 'factura', 'F', '900001')").run();
  assert.equal((await pedir('PUT', '/sucursales/1', { cp_expedicion: '76000' })).status, 200);
  const x = await pedir('PUT', '/sucursales/1', { serie_factura: null }); assert.equal(x.status, 200); assert.equal(x.json.serie_factura, null);
  assert.deepEqual(estado.llamadas, []);
});
