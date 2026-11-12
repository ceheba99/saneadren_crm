// Etapa 5 de la auditoría (2026-11-12): A-07, M-24 e INT-01. SIN red: factura.com simulado.
//  · A-07: si el total del XML timbrado difiere del calculado (un centavo), el XML y el PDF se guardan IGUAL; la factura queda marcada «revisar» y se
//          conserva el total calculado. El candado de «datos de una timbrada no cambian» sigue vivo una vez guardado el XML.
//  · M-24: «Vigente · No cancelable» después de una cancelación aceptada regresa la factura a vigente, pero el acuse NUNCA se pierde.
//  · INT-01: la factura que queda timbrada al pulsar «Verificar» se anota en la bitácora de negocio (y la cancelación revertida también).
// Uso: node --test tests/facturacion-etapa5.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const express = require('express');
const Database = require('../server/sqlite');
const crearTablas = require('../server/facturacion-db');
const rutas = require('../server/facturacion-rutas');
const { crearClienteFactura } = require('../server/facturacom');
const { leerConfig } = require('../server/facturacion-config');
const T = require('../server/facturacion-timbrado');
const { cancelar } = require('../server/facturacion-cancelacion');

const ENV = { sandbox: { FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: 'k1', FACTURA_SANDBOX_SECRET_KEY: 's1', FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '26015' },
  prod: { FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: 'k2', FACTURA_PROD_SECRET_KEY: 's2', FACTURA_PROD_EMISOR_REGIMEN: '601', FACTURA_PROD_EMISOR_CP: '26015' } };
const UUID1 = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
const ACUSE = '<?xml version="1.0" encoding="utf-8"?><Acuse Fecha="2026-11-12T10:00:00" RfcEmisor="EKU9003173C9"><Folios><UUID>' + UUID1 + '</UUID><EstatusUUID>201</EstatusUUID></Folios></Acuse>';
const xmlDe = (sub, total) => `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="7" SubTotal="${sub}" Moneda="MXN" Total="${total}"><cfdi:Complemento/></cfdi:Comprobante>`;

/** Base en memoria con una orden de 3 × $100.03 + IVA: el sistema calcula $348.10 (subtotal 300.09, IVA 48.01). */
function base(entorno = 'sandbox') {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO usuarios VALUES (1, 'Fer');
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, empresa_contacto TEXT, rfc TEXT, correo TEXT); INSERT INTO clientes (id, nombre) VALUES (1, 'Acme');
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1); INSERT INTO sucursales (id, nombre, clave) VALUES (1, 'Querétaro', 'QRO');
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0); INSERT INTO catalogo_servicios (id, nombre) VALUES (1, 'Desazolve');
    CREATE TABLE leads (id INTEGER PRIMARY KEY, estatus TEXT, ejecucion TEXT, iva_modo TEXT, iva_tasa INTEGER, iva_cent INTEGER, valor REAL, partidas_json TEXT, servicio_id INTEGER, cliente_id INTEGER,
      sucursal_id INTEGER, factura_folio TEXT, factura_fecha TEXT, factura_total_cent INTEGER, factura_metodo TEXT, dias_credito INTEGER, fecha_realizado TEXT, created_at TEXT DEFAULT '2026-10-20 10:00:00');
    CREATE TABLE cobros (id INTEGER PRIMARY KEY, lead_id INTEGER, monto_cent INTEGER, tipo TEXT DEFAULT 'pago', cancelado INTEGER DEFAULT 0, confirmado INTEGER DEFAULT 1, fecha TEXT, metodo TEXT, referencia TEXT, created_at TEXT);
    CREATE TABLE historial (id INTEGER PRIMARY KEY, lead_id INTEGER, tipo TEXT, texto TEXT, usuario TEXT, origen TEXT, area TEXT, usuario_id INTEGER);`);
  crearTablas(db);
  db.exec(`UPDATE catalogo_servicios SET clave_prod_serv = '76121600', clave_unidad = 'E48', nombre_unidad = 'Unidad de servicio'; UPDATE sucursales SET cp_expedicion = '76087';
    INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, entorno) VALUES (1, 'factura', 'F', '5508587', '${entorno}');
    INSERT INTO sat_catalogos (catalogo, clave, nombre, extra) VALUES ('RegimenFiscal', '601', 'x', NULL), ('UsoCfdi', 'G03', 'x', '{"regimenes":["601"]}'), ('FormaPago', '03', 'x', NULL), ('FormaPago', '99', 'x', NULL);
    INSERT INTO clientes_fiscales (id, cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo, predeterminado, uid_facturacom, uid_entorno)
      VALUES (1, 1, 'EKU9003173C9', 'ESCUELA KEMPER URGATE', '26015', '601', 'G03', 'p@k.mx', 1, 'CLI-UID-1', '${entorno}');`);
  const items = [1, 2, 3].map(() => ({ servicio: 'Desazolve', leyenda: 'Desazolve', importe: 100.03 }));
  db.prepare("INSERT INTO leads (id, estatus, iva_modo, iva_tasa, iva_cent, valor, partidas_json, servicio_id, cliente_id, sucursal_id) VALUES (10, 'ganado', 'mas_iva', 16, 4801, 300.09, ?, 1, 1, 1)").run(JSON.stringify(items));
  return db;
}
/** factura.com simulado: «r» decide qué contesta cada «MÉTODO ruta» («*» = último tramo). */
function simulado(r = {}) {
  const llamadas = [];
  const fetchImpl = async (url, o) => {
    const ruta = url.replace(/^https:\/\/[^/]+(\/api)?/, ''); llamadas.push(o.method + ' ' + ruta);
    const f = r[o.method + ' ' + ruta] || r[o.method + ' ' + ruta.replace(/\/[^/]+$/, '/*')] || r[o.method + ' ' + ruta.replace(/^(\/v4\/cfdi40\/)[^/]+/, '$1*')] || (() => ({ status: 404, json: { status: 'error', message: 'No simulada: ' + ruta } }));
    const x = f();
    const buf = x.buffer || Buffer.from(x.texto ?? JSON.stringify(x.json));
    return { status: x.status || 200, headers: { get: () => x.tipo || 'application/json' }, arrayBuffer: async () => buf };
  };
  return { llamadas, fetchImpl };
}
const EXITO = () => ({ json: { response: 'success', UUID: UUID1, uid: 'U7', SAT: { UUID: UUID1, FechaTimbrado: '2026-11-12T09:00:00' }, INV: { Serie: 'F', Folio: 7 } } });
const ARCHIVOS = (xml = xmlDe('300.09', '348.09')) => ({ 'GET /v4/cfdi40/*/xml': () => ({ tipo: 'application/xml', texto: xml }), 'GET /v4/cfdi40/*/pdf': () => ({ tipo: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x') }) });
const ctxDe = (sim, entorno = 'sandbox') => { const config = leerConfig(ENV[entorno]); return { config, demo: false, dirArchivos: fs.mkdtempSync(path.join(os.tmpdir(), 'crm-e5-')), usuario: { id: 1, nombre: 'Fer' }, crearCliente: () => crearClienteFactura({ config, fetchImpl: sim.fetchImpl, esperaMs: 1 }) }; };
const fila = db => db.prepare('SELECT * FROM facturas ORDER BY id DESC LIMIT 1').get();
const timbrar = async (db, ctx) => { const r = await T.timbrar(db, 10, { metodo_pago: 'PUE', forma_pago: '03', confirmar: true }, ctx); r.avisosDescarga = r.descargas ? await r.descargas : []; return r; };

/** Las rutas reales en un servidor chico, con la bitácora de negocio (auditar) capturada. */
async function montar(db, sim, entorno = 'sandbox') {
  const bitacora = [], config = leerConfig(ENV[entorno]);
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.usuarioSesion = { id: 1, nombre: 'Fer', rol: 'admin' }; next(); });
  const h = fn => (req, res) => { try { fn(req, res); } catch (e) { res.status(500).json({ error: 'Error interno del servidor: ' + e.message }); } };
  rutas(app, db, h, { direccion: () => true, esDemo: () => false, env: ENV[entorno], dirArchivos: fs.mkdtempSync(path.join(os.tmpdir(), 'crm-e5r-')),
    crearCliente: () => crearClienteFactura({ config, fetchImpl: sim.fetchImpl, esperaMs: 1 }), auditar: (req, entidad, id, accion, detalle) => bitacora.push({ entidad, id, accion, detalle }) });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const url = 'http://127.0.0.1:' + srv.address().port + '/api/facturacion';
  const pedir = async (metodo, ruta, cuerpo) => { const r = await fetch(url + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }); const t = await r.text(); let json = {}; try { json = JSON.parse(t); } catch { /* */ } return { status: r.status, texto: t, json }; };
  return { bitacora, pedir, cerrar: () => new Promise(r => srv.close(r)) };
}

// ------------------------------------------------------------ A-07 ------------------------------------------------------------
test('A-07: el XML timbrado con un centavo distinto SE GUARDA (y el PDF), la factura queda «revisar» y se conserva el total calculado', async () => {
  const db = base(), sim = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS() });
  const r = await timbrar(db, ctxDe(sim));
  const f = fila(db);
  assert.equal(r.estado, 'timbrada'); assert.equal(f.estatus, 'timbrada');
  assert.ok(f.xml && f.xml.includes('Total="348.09"'), 'el XML timbrado (la copia legal) queda guardado');
  assert.ok(f.pdf_path, 'el PDF queda guardado');
  assert.equal(f.total_cent, 34809, 'el total de la factura es el del XML (la verdad fiscal)');
  assert.equal(f.total_calculado_cent, 34810, 'lo que calculó el sistema no se descarta');
  assert.match(String(f.revisar || ''), /\$348\.09.*\$348\.10/, 'queda marcada para revisar, con las dos cifras');
  assert.ok(r.avisosDescarga.some(a => /revisar/i.test(a)), 'se avisa al timbrar');
  assert.equal(T.vistaFactura(f).revisar, f.revisar, 'la pantalla recibe la marca');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM facturas_log WHERE accion = 'descargar_xml' AND resultado = 'error'").get().n, 0);
  // El candado sigue: ya con XML, el total de una timbrada no se puede cambiar.
  assert.throws(() => db.prepare('UPDATE facturas SET total_cent = 1 WHERE id = ?').run(f.id), /no se cambian/);
  // Y sin XML todavía, solo se ajusta el total en la MISMA escritura que guarda el XML (no un cambio suelto).
  db.exec("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, uuid, serie, folio, total_cent) VALUES (NULL, 1, 'timbrada', 'N9', 'sandbox', 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5E', 'F', '9', 100)");
  assert.throws(() => db.prepare("UPDATE facturas SET total_cent = 101 WHERE num_order = 'N9'").run(), /no se cambian/);
});

test('A-07: en producción, la cobranza de la orden toma el total del XML; con el total igual no se marca «revisar»', async () => {
  const db = base('prod'), sim = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS() });
  await timbrar(db, ctxDe(sim, 'prod'));
  assert.ok(fila(db).xml);
  assert.equal(db.prepare('SELECT factura_total_cent t FROM leads WHERE id = 10').get().t, 34809);
  const db2 = base(), sim2 = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS(xmlDe('300.09', '348.10')) });
  await timbrar(db2, ctxDe(sim2));
  const f = fila(db2);
  assert.ok(f.xml); assert.equal(f.total_cent, 34810); assert.equal(f.revisar ?? null, null); assert.equal(f.total_calculado_cent ?? null, null);
});

test('A-07: el botón «XML» entrega el XML (no culpa a factura.com) y la factura aparece en los avisos de Inicio para revisar', async () => {
  const db = base(), sim = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS() });
  await timbrar(db, ctxDe(sim));
  const m = await montar(db, sim);
  try {
    const x = await m.pedir('GET', `/facturas/${fila(db).id}/xml`);
    assert.equal(x.status, 200, x.texto); assert.match(x.texto, /Total="348\.09"/);
    const a = await m.pedir('GET', '/avisos');
    assert.ok((a.json.avisos || []).some(v => v.tipo === 'revisar' && /348\.09/.test(v.texto)), a.texto);
  } finally { await m.cerrar(); }
});

// ------------------------------------------------------------ M-24 ------------------------------------------------------------
test('M-24: tras una cancelación aceptada y luego «Vigente · No cancelable», la factura vuelve a vigente SIN perder el acuse', async () => {
  const db = base();
  const sim = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS(xmlDe('300.09', '348.10')),
    'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { response: 'success', acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { status: 'success', data: { Estado: 'Vigente', EsCancelable: 'No cancelable', EstatusCancelacion: '' } } }) });
  const ctx = ctxDe(sim);
  await timbrar(db, ctx);
  const r = await cancelar(db, fila(db), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'timbrada'); assert.equal(fila(db).estatus, 'timbrada');
  const guardados = db.prepare('SELECT * FROM facturas_acuses WHERE factura_id = ?').all(fila(db).id);
  assert.equal(guardados.length, 1, 'el acuse queda guardado'); assert.equal(guardados[0].acuse, ACUSE); assert.equal(guardados[0].motivo, '02');
  assert.equal(T.vistaFactura({ ...fila(db), acuses_guardados: 1 }).tiene_acuse, true);
  // Nadie lo borra ni lo cambia, ni a mano.
  assert.throws(() => db.prepare('DELETE FROM facturas_acuses').run(), /acuse/i);
  assert.throws(() => db.prepare("UPDATE facturas_acuses SET acuse = 'x'").run(), /acuse/i);
  // Una nueva solicitud con otro acuse tampoco pisa el anterior: se guardan los dos.
  const otro = ACUSE.replace('10:00:00', '11:00:00');
  db.prepare('UPDATE facturas SET acuse = ? WHERE id = ?').run(otro, fila(db).id);
  db.prepare('UPDATE facturas SET acuse = NULL WHERE id = ?').run(fila(db).id);
  assert.deepEqual(db.prepare('SELECT acuse FROM facturas_acuses ORDER BY id').all().map(x => x.acuse), [ACUSE, otro]);
});

test('M-24: el botón «Acuse» de la factura revertida entrega el acuse guardado y la reversión queda en la bitácora de negocio', async () => {
  const db = base();
  const sim = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS(xmlDe('300.09', '348.10')),
    'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { response: 'success', acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { status: 'success', data: { Estado: 'Vigente', EsCancelable: 'Cancelable sin aceptación', EstatusCancelacion: '' } } }) });
  const ctx = ctxDe(sim);
  await timbrar(db, ctx);
  await cancelar(db, fila(db), { motivo: '02' }, ctx);
  assert.equal(fila(db).estatus, 'cancelacion_solicitada');
  // Al consultar más tarde, el SAT dice que no es cancelable.
  const m = await montar(db, simulado({ 'GET /v4/cfdi40/*/cancel_status': () => ({ json: { status: 'success', data: { Estado: 'Vigente', EsCancelable: 'No cancelable', EstatusCancelacion: '' } } }) }));
  try {
    const x = await m.pedir('POST', `/facturas/${fila(db).id}/estatus-cancelacion`, {});
    assert.equal(x.status, 200, x.texto); assert.equal(x.json.estado, 'timbrada'); assert.equal(x.json.factura.tiene_acuse, true);
    assert.ok(m.bitacora.some(b => b.accion === 'factura' && /sigue vigente/i.test(b.detalle) && /F-7/.test(b.detalle)), JSON.stringify(m.bitacora));
    const a = await m.pedir('GET', `/facturas/${fila(db).id}/acuse`);
    assert.equal(a.status, 200, a.texto); assert.equal(a.texto, ACUSE);
    const o = await m.pedir('GET', '/ordenes/10');
    assert.equal(o.json.facturas[0].tiene_acuse, true, 'la pantalla de la orden muestra el botón «Acuse»');
  } finally { await m.cerrar(); }
});

// ------------------------------------------------------------ INT-01 ------------------------------------------------------------
test('INT-01: la factura que queda timbrada al pulsar «Verificar» se anota en la bitácora de negocio', async () => {
  const db = base();
  // Se mandó a timbrar y no hubo respuesta: queda «timbrando».
  const sinRespuesta = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': () => ({ status: 503, tipo: 'text/html', texto: '<html>caído</html>' }) });
  const r = await T.timbrar(db, 10, { metodo_pago: 'PUE', forma_pago: '03', confirmar: true }, ctxDe(sinRespuesta));
  assert.equal(r.estado, 'sin_respuesta'); assert.equal(fila(db).estatus, 'timbrando');
  const num = fila(db).num_order;
  const sim = simulado({ 'GET /v4/cfdi/order/*': () => ({ json: { status: 'success', data: [{ UID: 'U7', UUID: UUID1, Folio: 'F 7', Status: 'enviada', NumOrder: num }] } }), ...ARCHIVOS(xmlDe('300.09', '348.10')) });
  const m = await montar(db, sim);
  try {
    const x = await m.pedir('POST', `/facturas/${fila(db).id}/verificar`, {});
    assert.equal(x.status, 200, x.texto); assert.equal(x.json.estado, 'timbrada');
    assert.ok(m.bitacora.some(b => b.accion === 'factura' && b.id === 10 && /Timbró la factura F-7/.test(b.detalle) && /Verificar/.test(b.detalle)), JSON.stringify(m.bitacora));
  } finally { await m.cerrar(); }
});

// ------------------------------------------------------------ Migración ------------------------------------------------------------
test('Etapa 5 en una base ya existente: el candado viejo se reemplaza, los acuses que ya había se guardan y correr dos veces no cambia nada', () => {
  const db = base();
  // Se deja la base como estaba antes de la etapa 5: candado viejo, sin tabla de acuses, y una factura con su acuse.
  db.exec(`DROP TABLE facturas_acuses; DROP TRIGGER facturas_acuse_guardar; DROP TRIGGER facturas_timbradas_fijas;
    CREATE TRIGGER facturas_timbradas_fijas BEFORE UPDATE OF uuid, total_cent, serie, folio, lead_id ON facturas
      WHEN COALESCE(OLD.uuid, '') <> '' AND (NEW.uuid IS NOT OLD.uuid OR NEW.total_cent IS NOT OLD.total_cent OR NEW.serie IS NOT OLD.serie OR NEW.folio IS NOT OLD.folio OR NEW.lead_id IS NOT OLD.lead_id)
      BEGIN SELECT RAISE(ABORT, 'Los datos de una factura timbrada no se cambian'); END;`);
  db.prepare("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, uuid, serie, folio, total_cent, acuse, motivo_cancelacion) VALUES (10, 1, 'cancelada', 'N1', 'sandbox', ?, 'F', '1', 100, ?, '02')").run(UUID1, ACUSE);
  crearTablas(db);
  const esquema = () => db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'facturas_timbradas_fijas'").get().sql, /OLD\.xml/);
  assert.deepEqual(db.prepare('SELECT acuse, motivo FROM facturas_acuses').all().map(x => ({ ...x })), [{ acuse: ACUSE, motivo: '02' }]);
  const antes = esquema(); crearTablas(db);
  assert.deepEqual(esquema(), antes); assert.equal(db.prepare('SELECT COUNT(*) n FROM facturas_acuses').get().n, 1);
});

test('M-24 (revisor): el acuse del «no» del SAT (código 205) también se guarda; el XML guardado no se vacía ni se cambia', async () => {
  const db = base(), A205 = ACUSE.replace('<EstatusUUID>201', '<EstatusUUID>205');
  const sim = simulado({ 'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success' } }), 'POST /v4/cfdi40/create': EXITO, ...ARCHIVOS(xmlDe('300.09', '348.10')),
    'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { response: 'success', acuse: A205 } } }) });
  const ctx = ctxDe(sim);
  await timbrar(db, ctx);
  const r = await cancelar(db, fila(db), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'timbrada');
  assert.deepEqual(db.prepare('SELECT acuse, motivo FROM facturas_acuses').all().map(x => ({ ...x })), [{ acuse: A205, motivo: '02' }]);
  assert.equal(fila(db).acuse, null, 'no se pone como acuse de una cancelación en curso');
  assert.throws(() => db.prepare('UPDATE facturas SET xml = NULL WHERE id = ?').run(fila(db).id), /no se cambian/);
  assert.throws(() => db.prepare("UPDATE facturas SET xml = '<x/>' WHERE id = ?").run(fila(db).id), /no se cambian/);
});
