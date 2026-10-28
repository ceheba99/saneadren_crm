// Facturación · F4 (2026-10-28): pruebas SIN red de la lista de facturas, los avisos de Inicio, el reenvío por correo y el descarte de borradores.
// Se monta un servidor chico con las rutas reales, una sesión simulada (con o sin permiso de timbrar, con o sin ser Dirección) y un «factura.com» simulado.
// Uso: node --test tests/facturacion-f4.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('../server/sqlite');
const crearTablas = require('../server/facturacion-db');
const rutas = require('../server/facturacion-rutas');
const { ErrorFactura } = require('../server/facturacom');

const UUID1 = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', UUID2 = 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5E';
const ENV = { sandbox: { FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: 'k1', FACTURA_SANDBOX_SECRET_KEY: 's1', FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '42501' },
  prod: { FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: 'k2', FACTURA_PROD_SECRET_KEY: 's2', FACTURA_PROD_EMISOR_REGIMEN: '626', FACTURA_PROD_EMISOR_CP: '76087' } };

async function montar({ entorno = 'sandbox', direccion = true, timbra = true, demo = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO usuarios VALUES (1, 'Fer');
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, empresa_contacto TEXT, rfc TEXT, correo TEXT); INSERT INTO clientes (id, nombre) VALUES (1, 'Acme'), (2, 'Otro');
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1); INSERT INTO sucursales (id, nombre, clave) VALUES (1, 'Querétaro', 'QRO'), (2, 'CDMX', 'CDMX');
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0);
    CREATE TABLE leads (id INTEGER PRIMARY KEY, estatus TEXT, ejecucion TEXT, fecha_realizado TEXT, iva_modo TEXT, iva_tasa INTEGER, iva_cent INTEGER, valor REAL, partidas_json TEXT, servicio_id INTEGER, cliente_id INTEGER,
      sucursal_id INTEGER, factura_folio TEXT, factura_fecha TEXT, factura_total_cent INTEGER, factura_metodo TEXT, created_at TEXT DEFAULT '2026-10-20 10:00:00');
    CREATE TABLE cobros (id INTEGER PRIMARY KEY, lead_id INTEGER, monto_cent INTEGER, cancelado INTEGER DEFAULT 0, confirmado INTEGER DEFAULT 1);
    CREATE TABLE historial (id INTEGER PRIMARY KEY, lead_id INTEGER, tipo TEXT, texto TEXT, usuario TEXT, origen TEXT, area TEXT, usuario_id INTEGER);`);
  crearTablas(db);
  const hoy = db.prepare("SELECT date('now','localtime') d").get().d;
  const orden = (id, extra = {}) => db.prepare("INSERT INTO leads (id, estatus, ejecucion, fecha_realizado, iva_modo, iva_tasa, iva_cent, valor, cliente_id, sucursal_id, factura_folio) VALUES (?, 'ganado', ?, ?, 'mas_iva', 16, 160, 10, 1, 1, ?)")
    .run(id, extra.ejecucion ?? 'realizado', extra.fecha ?? hoy, extra.folio ?? null);
  const factura = (c = {}) => Number(db.prepare(`INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, receptor_rfc, receptor_razon_social, receptor_correo, serie, folio, uuid, cfdi_uid, subtotal_cent, iva_cent, total_cent, error_json)
    VALUES (?, ?, ?, ?, ?, 'EKU9003173C9', 'ESCUELA KEMPER URGATE', ?, ?, ?, ?, ?, 1000, 160, 1160, ?)`)
    .run(c.lead ?? 1, c.sucursal ?? 1, c.estatus ?? 'timbrada', c.num ?? 'N-' + Math.random().toString(36).slice(2, 8), c.entorno ?? 'sandbox', c.correo === undefined ? 'cliente@ejemplo.mx' : c.correo, c.serie ?? 'F', c.folio ?? null,
      c.uuid ?? null, c.uid ?? null, c.error ?? null).lastInsertRowid);
  const estado = { llamadas: [], bitacora: [], error: null, direccion, timbra };
  const clienteSim = () => ({ config: { entorno }, get: async ruta => { estado.llamadas.push('GET ' + ruta); if (estado.error) throw estado.error; return { datos: {}, crudo: { response: 'success', message: 'Hemos enviado tu Factura con exito al e-mail cliente@ejemplo.mx' } }; },
    post: async (ruta, cuerpo) => { estado.llamadas.push('POST ' + ruta); if (estado.error) throw estado.error; return { datos: {}, crudo: { response: 'success' } }; } });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.usuarioSesion = { id: 1, nombre: 'Fer' }; next(); });
  const h = fn => (req, res) => { try { fn(req, res); } catch (e) { res.status(500).json({ error: 'Error interno del servidor' }); } };
  rutas(app, db, h, { direccion: () => estado.direccion, puede: (req, clave) => estado.timbra && clave === 'facturacion.timbrar', esDemo: () => demo, crearCliente: clienteSim, env: ENV[entorno],
    dirArchivos: require('os').tmpdir(), auditar: (req, entidad, id, accion, detalle) => estado.bitacora.push({ entidad, id, accion, detalle }) });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/facturacion';
  const pedir = async (metodo, ruta, cuerpo) => { const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { db, estado, pedir, orden, factura, hoy, cerrar: () => { srv.close(); db.close(); } };
}
const conMontaje = (nombre, cfg, fn) => test(nombre, async () => { const m = await montar(cfg); try { await fn(m); } finally { m.cerrar(); } });

conMontaje('Sin el permiso de timbrar: ninguna ruta nueva responde (403) ni llama a factura.com', { timbra: false, direccion: false }, async ({ pedir, estado, orden, factura }) => {
  orden(1); const f = factura({ uuid: UUID1, folio: '1' });
  for (const [m, r] of [['GET', '/facturas'], ['GET', '/avisos'], ['POST', `/facturas/${f}/reenviar`], ['POST', `/facturas/${f}/descartar`]]) assert.equal((await pedir(m, r, {})).status, 403, m + ' ' + r);
  assert.deepEqual(estado.llamadas, []);
});

conMontaje('Lista: busca por folio, UUID, RFC o cliente; filtra por estado, tipo, sucursal y fecha; valida lo que viene', {}, async ({ pedir, orden, factura, db }) => {
  orden(1); orden(2);
  factura({ lead: 1, estatus: 'timbrada', uuid: UUID1, folio: '1', serie: 'F' });
  factura({ lead: 2, estatus: 'timbrada', uuid: UUID2, folio: '2', serie: 'FM', entorno: 'prod', sucursal: 2 });
  db.exec("UPDATE facturas SET fecha_timbrado = '2026-09-10T10:00:00' WHERE uuid = '" + UUID2 + "'");
  assert.equal((await pedir('GET', '/facturas')).json.total, 2);
  assert.deepEqual((await pedir('GET', '/facturas?q=fm-2')).json.facturas.map(f => f.folio), ['2'], 'por serie-folio');
  assert.deepEqual((await pedir('GET', '/facturas?q=' + UUID1.toLowerCase())).json.facturas.map(f => f.uuid), [UUID1], 'por UUID, sin importar mayúsculas');
  assert.equal((await pedir('GET', '/facturas?q=kemper')).json.total, 2); assert.equal((await pedir('GET', '/facturas?q=nadie')).json.total, 0);
  assert.deepEqual((await pedir('GET', '/facturas?entorno=prod')).json.facturas.map(f => f.entorno), ['prod']);
  assert.deepEqual((await pedir('GET', '/facturas?entorno=prueba')).json.facturas.map(f => f.entorno), ['sandbox']);
  assert.equal((await pedir('GET', '/facturas?sucursal=2')).json.total, 1);
  assert.equal((await pedir('GET', '/facturas?hasta=2026-09-30')).json.total, 1, 'por fecha de timbrado');
  assert.equal((await pedir('GET', '/facturas?estatus=borrador_error')).json.total, 0);
  assert.equal((await pedir('GET', '/facturas?estatus=inventado')).status, 400); assert.equal((await pedir('GET', '/facturas?desde=ayer')).status, 400);
  const x = (await pedir('GET', '/facturas?entorno=prod')).json.facturas[0];
  assert.equal(x.puede_reenviar, true); assert.ok(!('xml' in x) && !('error_json' in x), 'la lista no manda el XML');
});

conMontaje('Avisos de Inicio: sin respuesta, borrador, rechazada y órdenes por facturar; solo del entorno activo; lo ya facturado no aparece', {}, async ({ pedir, orden, factura, db, hoy }) => {
  orden(1); orden(2); orden(3); orden(4); orden(5, { ejecucion: 'no_realizado' }); orden(6, { folio: 'A-9' }); orden(7, { fecha: '2020-01-01' }); orden(8);
  factura({ lead: 1, estatus: 'timbrando' });
  factura({ lead: 2, estatus: 'borrador_error', uid: 'B1', error: JSON.stringify({ mensaje: 'CFDI40111 El descuento no es correcto' }) });
  factura({ lead: 3, estatus: 'pendiente', error: JSON.stringify({ mensaje: 'Rechazada' }) });
  factura({ lead: 8, estatus: 'timbrada', uuid: UUID1, folio: '1' });
  factura({ lead: 4, estatus: 'timbrando', entorno: 'prod' }); // de otro entorno: no aparece
  const r = (await pedir('GET', '/avisos')).json;
  assert.equal(r.entorno, 'sandbox');
  const tipos = Object.fromEntries(r.avisos.map(a => [a.lead_id, a.tipo]));
  assert.deepEqual(tipos, { 1: 'timbrando', 2: 'borrador_error', 3: 'pendiente', 4: 'por_facturar' }, 'la 5 no se realizó, la 6 ya tiene folio, la 7 es vieja y la 8 ya tiene factura');
  assert.match(r.avisos.find(a => a.lead_id === 2).texto, /El descuento no es correcto/);
  assert.equal(r.avisos.find(a => a.lead_id === 4).fecha, hoy);
});

conMontaje('Reenviar: solo facturas REALES timbradas; pide el correo a factura.com por el UUID; queda en bitácora sin el correo', { entorno: 'prod' }, async ({ pedir, orden, factura, estado, db }) => {
  orden(1); orden(2);
  const real = factura({ lead: 1, estatus: 'timbrada', entorno: 'prod', uuid: UUID1, folio: '1' });
  const x = await pedir('POST', `/facturas/${real}/reenviar`, {});
  assert.equal(x.status, 200); assert.deepEqual(estado.llamadas, ['GET /v4/cfdi40/' + UUID1 + '/email']);
  assert.ok(!JSON.stringify(x.json).includes('@') && !JSON.stringify(estado.bitacora).includes('@'), 'el correo del cliente no sale ni se guarda en la bitácora');
  assert.deepEqual(db.prepare("SELECT accion, resultado FROM facturas_log WHERE factura_id = ?").all(real).map(l => l.accion + ':' + l.resultado), ['reenviar:ok']);
  assert.equal(estado.bitacora.length, 1);
  const sinCorreo = factura({ lead: 2, estatus: 'timbrada', entorno: 'prod', uuid: UUID2, folio: '2', correo: '' });
  assert.equal((await pedir('POST', `/facturas/${sinCorreo}/reenviar`, {})).status, 409);
  db.exec('UPDATE facturas SET estatus = \'cancelada\' WHERE id = ' + sinCorreo); // libera el lugar de la orden 2
  const borr = factura({ lead: 2, estatus: 'borrador_error', entorno: 'prod', uid: 'B' });
  assert.equal((await pedir('POST', `/facturas/${borr}/reenviar`, {})).status, 409, 'un borrador no se reenvía');
  assert.equal((await pedir('POST', '/facturas/9999/reenviar', {})).status, 404);
  estado.llamadas.length = 0; estado.error = new ErrorFactura('red', 'No se pudo conectar con factura.com');
  assert.equal((await pedir('POST', `/facturas/${real}/reenviar`, {})).status, 502);
  assert.deepEqual(db.prepare("SELECT resultado FROM facturas_log WHERE factura_id = ? ORDER BY id").all(real).map(l => l.resultado), ['ok', 'error']);
});

conMontaje('Reenviar no existe en pruebas ni en el demo (regla 7: sin correos en sandbox)', {}, async ({ pedir, orden, factura, estado }) => {
  orden(1); const f = factura({ lead: 1, estatus: 'timbrada', uuid: UUID1, folio: '1' });
  const x = await pedir('POST', `/facturas/${f}/reenviar`, {}); assert.equal(x.status, 409); assert.match(x.json.error, /no se manda correo/);
  assert.deepEqual(estado.llamadas, []);
  assert.equal((await pedir('GET', '/facturas')).json.facturas[0].puede_reenviar, false);
});

conMontaje('Descartar borrador: Dirección, Gerente y quien factura (sin el permiso, nadie); borra el borrador en factura.com y deja el lugar libre; una timbrada nunca se descarta', {}, async ({ pedir, orden, factura, estado, db }) => {
  orden(1); orden(2);
  const b = factura({ lead: 1, estatus: 'borrador_error', uid: 'BORR-1', folio: '8' });
  estado.timbra = false; estado.direccion = false;
  assert.equal((await pedir('POST', `/facturas/${b}/descartar`, {})).status, 403, 'sin el permiso de timbrar nadie descarta');
  assert.deepEqual(estado.llamadas, []);
  estado.timbra = true; // quien factura (no es Dirección) sí descarta
  const x = await pedir('POST', `/facturas/${b}/descartar`, {});
  assert.equal(x.status, 200); assert.equal(x.json.factura.descartada, true); assert.equal(x.json.factura.estatus, 'cancelada');
  assert.deepEqual(estado.llamadas, ['POST /v4/drafts/BORR-1/drop']);
  // el lugar quedó libre: se puede empezar una factura nueva de la misma orden
  assert.doesNotThrow(() => factura({ lead: 1, estatus: 'pendiente' }));
  assert.equal(db.prepare("SELECT accion FROM facturas_log WHERE factura_id = ?").get(b).accion, 'descartar');
  const t = factura({ lead: 2, estatus: 'timbrada', uuid: UUID1, folio: '1', uid: 'CFDI-1' });
  assert.equal((await pedir('POST', `/facturas/${t}/descartar`, {})).status, 409); assert.equal(db.prepare('SELECT estatus FROM facturas WHERE id = ?').get(t).estatus, 'timbrada');
});

conMontaje('Descartar: si factura.com dice con claridad que no (ya no existe) se descarta igual; si no hay respuesta, NO', {}, async ({ pedir, orden, factura, estado, db }) => {
  orden(1); orden(2);
  const a = factura({ lead: 1, estatus: 'borrador_error', uid: 'BORR-A' }), b = factura({ lead: 2, estatus: 'borrador_error', uid: 'BORR-B' });
  estado.error = new ErrorFactura('api', 'No se encontró el borrador', { rechazo: true });
  assert.equal((await pedir('POST', `/facturas/${a}/descartar`, {})).status, 200);
  assert.match(JSON.parse(db.prepare('SELECT error_json FROM facturas WHERE id = ?').get(a).error_json).mensaje, /No se encontró el borrador/);
  estado.error = new ErrorFactura('tiempo', 'factura.com tardó más de 30 segundos');
  assert.equal((await pedir('POST', `/facturas/${b}/descartar`, {})).status, 502);
  assert.equal(db.prepare('SELECT estatus FROM facturas WHERE id = ?').get(b).estatus, 'borrador_error', 'sin respuesta no se sabe si se borró: no se descarta');
  estado.error = new ErrorFactura('api', 'Error del servidor', { rechazo: false, httpStatus: 503 });
  assert.equal((await pedir('POST', `/facturas/${b}/descartar`, {})).status, 502);
  assert.equal(db.prepare('SELECT estatus FROM facturas WHERE id = ?').get(b).estatus, 'borrador_error', 'un 5xx tampoco');
});

conMontaje('Descartar: un borrador de otro entorno o del demo no se toca', { demo: true }, async ({ pedir, orden, factura, estado }) => {
  orden(1); const b = factura({ lead: 1, estatus: 'borrador_error', uid: 'B', entorno: 'demo' });
  assert.equal((await pedir('POST', `/facturas/${b}/descartar`, {})).status, 409); assert.deepEqual(estado.llamadas, []);
});
