// Facturación · F5 cancelación (2026-10-29): pruebas SIN red. Pasa por el cliente HTTP real (server/facturacom.js) con un «fetch» simulado.
// Revisa: qué se valida antes de pedir nada, motivos 01–03 (04 todavía no), la sustitución (la nueva va relacionada con «Sustitución de los CFDI previos»
// y después se cancela la original diciendo cuál la sustituye), que NADA se marque cancelado hasta que el SAT lo confirme, el rechazo del cliente,
// la cancelación con aceptación pendiente, un 5xx sin respuesta clara, la cobranza de la orden (solo producción) y el demo.
// Uso: node --test tests/facturacion-cancelacion.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const Database = require('../server/sqlite');
const crearTablas = require('../server/facturacion-db');
const { crearClienteFactura } = require('../server/facturacom');
const { leerConfig } = require('../server/facturacion-config');
const T = require('../server/facturacion-timbrado');
const { cancelar, consultarEstatus } = require('../server/facturacion-cancelacion');

const ENV = { sandbox: { FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: 'k1', FACTURA_SANDBOX_SECRET_KEY: 's1', FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '42501' },
  prod: { FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: 'k2', FACTURA_PROD_SECRET_KEY: 's2', FACTURA_PROD_EMISOR_REGIMEN: '626', FACTURA_PROD_EMISOR_CP: '76087' } };
const U = ['A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5E'];
const ACUSE = '<?xml version="1.0" encoding="utf-8"?><Acuse Fecha="2026-10-29T10:00:00" RfcEmisor="EKU9003173C9"><Folios><UUID>X</UUID><EstatusUUID>201</EstatusUUID></Folios></Acuse>';

function base(entorno = 'sandbox') {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO usuarios VALUES (1, 'Fer');
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, empresa_contacto TEXT, rfc TEXT, correo TEXT); INSERT INTO clientes (id, nombre) VALUES (1, 'Acme');
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1); INSERT INTO sucursales (id, nombre, clave) VALUES (1, 'Querétaro', 'QRO');
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0); INSERT INTO catalogo_servicios (id, nombre) VALUES (1, 'Desazolve');
    CREATE TABLE leads (id INTEGER PRIMARY KEY, estatus TEXT, ejecucion TEXT, iva_modo TEXT, iva_tasa INTEGER, iva_cent INTEGER, valor REAL, partidas_json TEXT, servicio_id INTEGER, cliente_id INTEGER,
      sucursal_id INTEGER, factura_folio TEXT, factura_fecha TEXT, factura_total_cent INTEGER, factura_metodo TEXT, created_at TEXT DEFAULT '2026-10-20 10:00:00');
    CREATE TABLE cobros (id INTEGER PRIMARY KEY, lead_id INTEGER, monto_cent INTEGER, cancelado INTEGER DEFAULT 0, confirmado INTEGER DEFAULT 1);
    CREATE TABLE historial (id INTEGER PRIMARY KEY, lead_id INTEGER, tipo TEXT, texto TEXT, usuario TEXT, origen TEXT, area TEXT, usuario_id INTEGER);`);
  crearTablas(db);
  db.exec(`UPDATE catalogo_servicios SET clave_prod_serv = '76121600', clave_unidad = 'E48', nombre_unidad = 'Unidad de servicio';
    INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, entorno) VALUES (1, 'factura', 'F', '5508587', '${entorno}');
    INSERT INTO sat_catalogos (catalogo, clave, nombre, extra) VALUES ('RegimenFiscal', '601', 'General de Ley Personas Morales', NULL), ('UsoCfdi', 'G03', 'Gastos en general', '{"regimenes":["601"]}'),
      ('FormaPago', '03', 'Transferencia electrónica de fondos', NULL), ('Relacion', '01', 'Nota de crédito de los documentos relacionados', NULL), ('Relacion', '04', 'Sustitución de los CFDI previos', NULL);
    INSERT INTO clientes_fiscales (id, cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo, predeterminado, uid_facturacom, uid_entorno)
      VALUES (1, 1, 'EKU9003173C9', 'ESCUELA KEMPER URGATE', '42501', '601', 'G03', 'pagos@kemper.mx', 1, 'CLI-1', '${entorno}');
    INSERT INTO leads (id, estatus, iva_modo, iva_tasa, iva_cent, valor, partidas_json, servicio_id, cliente_id, sucursal_id) VALUES (10, 'ganado', 'mas_iva', 16, 160, 10, '[{"servicio":"Desazolve","leyenda":"Desazolve","importe":10}]', 1, 1, 1);
    INSERT INTO cobros (lead_id, monto_cent) VALUES (10, 1160);`);
  return db;
}
/** factura.com simulado: «r» decide qué contesta cada «MÉTODO ruta» (con * al final para el último tramo). Guarda las llamadas. */
function simulado(r = {}) {
  const llamadas = [];
  const fetchImpl = async (url, o) => {
    const ruta = url.replace(/^https:\/\/[^/]+(\/api)?/, ''), cuerpo = o.body ? JSON.parse(o.body) : undefined;
    llamadas.push({ metodo: o.method, ruta, cuerpo });
    const f = r[o.method + ' ' + ruta] || r[o.method + ' ' + ruta.replace(/\/[^/]+$/, '/*')] || r[o.method + ' ' + ruta.replace(/^(\/v4\/cfdi40\/)[^/]+/, '$1*')] || (() => ({ status: 404, json: { status: 'error', message: 'No simulada: ' + ruta } }));
    const x = f(cuerpo, llamadas);
    if (x.abortar) { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
    const buf = Buffer.from(x.texto ?? JSON.stringify(x.json));
    return { status: x.status || 200, headers: { get: () => x.tipo || 'application/json' }, arrayBuffer: async () => buf };
  };
  return { llamadas, fetchImpl };
}
const ctxDe = (sim, entorno = 'sandbox') => { const config = leerConfig(ENV[entorno]); return { config, demo: false, dirArchivos: fs.mkdtempSync(path.join(os.tmpdir(), 'crm-canc-')), usuario: { id: 1, nombre: 'Fer' }, crearCliente: () => crearClienteFactura({ config, fetchImpl: sim.fetchImpl, esperaMs: 1 }) }; };
const exito = (uuid, folio) => () => ({ json: { response: 'success', UUID: uuid, uid: 'UID-' + folio, SAT: { UUID: uuid, FechaTimbrado: '2026-10-29T09:00:00' }, INV: { Serie: 'F', Folio: folio } } });
const archivos = { 'GET /v4/cfdi40/*/xml': () => ({ tipo: 'application/xml', texto: '<cfdi:Comprobante SubTotal="10.00" Total="11.60"/>' }), 'GET /v4/cfdi40/*/pdf': () => ({ tipo: 'application/pdf', texto: '%PDF-1.4' }),
  'POST /v1/clients/CLI-1/update': () => ({ json: { status: 'success', Data: { UID: 'CLI-1' } } }) };
const timbrar = async (db, op, ctx) => { const r = await T.timbrar(db, 10, { forma_pago: '03', ...op }, ctx); if (r.descargas) await r.descargas; return r; };
const fila = (db, id) => db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
const cancelUrl = (sim, uuid) => sim.llamadas.filter(l => l.metodo === 'POST' && l.ruta === `/v4/cfdi40/${uuid}/cancel`);

test('Antes de pedir nada se revisa: estado, motivo, 04, sustituta, entorno y conexión; si no se puede, nada cambia', async () => {
  const db = base(); const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1) }), ctx = ctxDe(sim);
  const f = (await timbrar(db, {}, ctx)).factura; sim.llamadas.length = 0;
  for (const [op, error] of [[{ motivo: '' }, /Elige el motivo/], [{ motivo: '05' }, /Elige el motivo/], [{ motivo: '04' }, /factura global/], [{ motivo: '01' }, /primero se timbra la factura que la sustituye/]]) {
    await assert.rejects(cancelar(db, fila(db, f.id), op, ctx), error);
  }
  await assert.rejects(cancelar(db, fila(db, f.id), { motivo: '02' }, ctxDe(sim, 'prod')), /otro entorno/);
  await assert.rejects(cancelar(db, fila(db, f.id), { motivo: '02' }, { ...ctx, config: leerConfig({ FACTURA_ENV: 'sandbox' }) }), /no está completa/);
  assert.equal(fila(db, f.id).estatus, 'timbrada'); assert.equal(sim.llamadas.length, 0, 'no se llamó a factura.com');
  await assert.rejects(consultarEstatus(db, ctx.crearCliente(), fila(db, f.id), ctx), /cancelación en proceso/);
});

test('Motivo 02 en SANDBOX: se pide sin folio sustituto, se guarda el acuse y solo se da por cancelada cuando el SAT dice «Cancelado»; la orden no se toca', async () => {
  const db = base();
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1),
    'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', message: 'se canceló exitosamente', respuestaapi: { response: 'success', acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: { Estado: 'Cancelado', EsCancelable: 'Cancelable sin aceptación', EstatusCancelacion: 'Cancelado sin aceptación' } } }) });
  const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
  const r = await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'cancelada');
  const x = fila(db, f.id);
  assert.equal(x.estatus, 'cancelada'); assert.equal(x.motivo_cancelacion, '02'); assert.equal(x.folio_sustituto, null); assert.match(x.acuse, /<Acuse/); assert.ok(x.cancelada_at);
  assert.deepEqual(cancelUrl(sim, U[0])[0].cuerpo, { motivo: '02' });
  assert.ok(x.xml, 'el XML se conserva (nunca se borra)');
  const lead = db.prepare('SELECT factura_folio FROM leads WHERE id = 10').get(); assert.equal(lead.factura_folio, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM historial').get().n, 0, 'una de prueba no escribe en la bitácora de la orden');
});

test('Con aceptación pendiente o el SAT aún «Vigente»: se queda «cancelación en proceso»; al confirmarse, cancelada. Si el cliente la rechaza, vuelve a timbrada', async () => {
  const db = base(); let estado = { Estado: 'Vigente', EsCancelable: 'Cancelable con aceptación', EstatusCancelacion: 'En proceso' };
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { response: 'success', acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: estado } }) });
  const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
  let r = await cancelar(db, fila(db, f.id), { motivo: '03' }, ctx);
  assert.equal(r.estado, 'cancelacion_solicitada'); assert.match(r.mensaje, /acepte o la rechace/); assert.equal(fila(db, f.id).cancelada_at, null);
  estado = { Estado: 'Vigente', EsCancelable: 'Cancelable con aceptación', EstatusCancelacion: [] };
  r = await consultarEstatus(db, ctx.crearCliente(), fila(db, f.id), ctx); assert.equal(r.estado, 'cancelacion_solicitada', '«Vigente» sin más no es cancelada (el SAT tarda en reflejarla)');
  estado = { Estado: 'Vigente', EsCancelable: 'Cancelable con aceptación', EstatusCancelacion: 'Solicitud rechazada' };
  r = await consultarEstatus(db, ctx.crearCliente(), fila(db, f.id), ctx);
  assert.equal(r.estado, 'timbrada'); assert.equal(fila(db, f.id).estatus, 'timbrada'); assert.match(r.mensaje, /rechazó/);
  // se puede volver a pedir y esta vez el SAT la cancela
  estado = { Estado: 'Cancelado', EsCancelable: 'Cancelable con aceptación', EstatusCancelacion: 'Cancelado con aceptación' };
  r = await cancelar(db, fila(db, f.id), { motivo: '03' }, ctx); assert.equal(r.estado, 'cancelada');
});

test('Un «no» claro de factura.com deja la factura vigente; un 5xx o sin respuesta la deja «en proceso» (nunca cancelada a ciegas)', async () => {
  const db = base(); let respuesta;
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => respuesta,
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: { Estado: 'Cancelado', EsCancelable: 'Cancelable sin aceptación', EstatusCancelacion: 'Cancelado sin aceptación' } } }) });
  const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
  respuesta = { json: { response: 'error', message: 'El CFDI no es cancelable' } };
  let r = await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'timbrada'); assert.match(r.mensaje, /no es cancelable/); assert.equal(fila(db, f.id).motivo_cancelacion, null);
  respuesta = { status: 504, tipo: 'text/html', texto: '<html>Gateway</html>' };
  r = await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'cancelacion_solicitada'); assert.match(r.mensaje, /Consultar estatus/);
  await assert.rejects(cancelar(db, fila(db, f.id), { motivo: '02' }, ctx), /Ya se pidió cancelar/, 'no se vuelve a pedir a ciegas');
  r = await consultarEstatus(db, ctx.crearCliente(), fila(db, f.id), ctx);
  assert.equal(r.estado, 'cancelada'); assert.equal(cancelUrl(sim, U[0]).length, 2);
});

test('Sustitución (motivo 01) en PRODUCCIÓN: la nueva va relacionada con la original; después se cancela la original con su folio sustituto; la cobranza queda con la nueva', async () => {
  const db = base('prod');
  db.exec("UPDATE clientes_fiscales SET uid_entorno = 'prod'");
  let n = 0;
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': () => exito(U[n], n + 1)(), 'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { response: 'success', acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: { Estado: 'Cancelado', EsCancelable: 'Cancelable sin aceptación', EstatusCancelacion: 'Cancelado sin aceptación' } } }) });
  const ctx = ctxDe(sim, 'prod');
  const orig = (await timbrar(db, {}, ctx)).factura; n = 1;
  assert.equal(db.prepare('SELECT factura_folio FROM leads WHERE id = 10').get().factura_folio, 'F-1');
  // sin sustitución, la orden ya tiene factura
  await assert.rejects(T.timbrar(db, 10, { forma_pago: '03' }, ctx), /ya tiene factura/);
  const nueva = (await timbrar(db, { sustituye_a: orig.id }, ctx)).factura;
  assert.equal(nueva.estatus, 'timbrada'); assert.equal(nueva.sustituye_a, orig.id);
  const cuerpo = sim.llamadas.filter(l => l.ruta === '/v4/cfdi40/create')[1].cuerpo;
  assert.deepEqual(cuerpo.CfdiRelacionados, { TipoRelacion: '04', UUID: [U[0]] }, 'la clave sale del catálogo Relacion («Sustitución de los CFDI previos»)');
  assert.match(cuerpo.Comentarios, /Sustituye a la factura F-1/);
  assert.notEqual(cuerpo.NumOrder, sim.llamadas.filter(l => l.ruta === '/v4/cfdi40/create')[0].cuerpo.NumOrder, 'la sustituta lleva su propio número de orden');
  assert.equal(db.prepare('SELECT factura_folio FROM leads WHERE id = 10').get().factura_folio, 'F-2', 'la cobranza ya muestra la nueva');
  await assert.rejects(T.timbrar(db, 10, { forma_pago: '03', sustituye_a: orig.id }, ctx), /falta cancelar la original/, 'una sola sustituta');
  await assert.rejects(cancelar(db, fila(db, orig.id), { motivo: '02' }, ctx), /cancélala con el motivo 01/);
  const r = await cancelar(db, fila(db, orig.id), { motivo: '01', sustituta_id: nueva.id }, ctx);
  assert.equal(r.estado, 'cancelada');
  assert.deepEqual(cancelUrl(sim, U[0])[0].cuerpo, { motivo: '01', folioSustituto: U[1] });
  assert.equal(fila(db, orig.id).folio_sustituto, U[1]);
  const lead = db.prepare('SELECT factura_folio, factura_total_cent FROM leads WHERE id = 10').get();
  assert.equal(lead.factura_folio, 'F-2', 'cancelar la original con 01 no le quita la factura a la orden');
  assert.match(db.prepare('SELECT texto FROM historial ORDER BY id DESC').get().texto, /F-1 CANCELADA.*sustituida por la F-2/);
  assert.ok(!JSON.stringify(db.prepare('SELECT texto FROM historial').all()).includes(U[0]), 'la bitácora de la orden no lleva UUID');
});

test('Motivo 02 en PRODUCCIÓN: la orden se queda sin factura en su cobranza (la cancelada se conserva con su XML y acuse)', async () => {
  const db = base('prod'); db.exec("UPDATE clientes_fiscales SET uid_entorno = 'prod'");
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: { Estado: 'Cancelado', EstatusCancelacion: 'Cancelado sin aceptación' } } }) });
  const ctx = ctxDe(sim, 'prod'); const f = (await timbrar(db, {}, ctx)).factura;
  await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
  assert.deepEqual(db.prepare('SELECT factura_folio, factura_total_cent, factura_metodo FROM leads WHERE id = 10').get(), { factura_folio: null, factura_total_cent: null, factura_metodo: null });
  // ya se puede timbrar otra factura para la orden
  assert.deepEqual(T.preparar(db, 10, { forma_pago: '03' }, { config: ctx.config }).errores, []);
});

test('Sustituir necesita el catálogo de tipos de relación (no se inventa la clave)', () => {
  const db = base(); db.exec("DELETE FROM sat_catalogos WHERE catalogo = 'Relacion'");
  db.prepare("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, uuid, serie, folio) VALUES (10, 1, 'timbrada', 'N1', 'sandbox', ?, 'F', '1')").run(U[0]);
  const id = db.prepare('SELECT id FROM facturas').get().id;
  assert.match(T.preparar(db, 10, { forma_pago: '03', sustituye_a: id }, { config: leerConfig(ENV.sandbox) }).errores.join(), /catálogo de tipos de relación/);
});

test('Demo: la cancelación se simula (sin llamar a nadie) y el acuse dice que no es del SAT', async () => {
  const db = base(); const sim = simulado();
  const ctx = { ...ctxDe(sim), config: leerConfig({}), demo: true };
  const f = (await T.timbrar(db, 10, { forma_pago: '03' }, ctx)).factura;
  const r = await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'cancelada'); assert.match(fila(db, f.id).acuse, /NO es un acuse/); assert.equal(sim.llamadas.length, 0);
});

// ----- Hallazgos del revisor fiscal (2026-10-29) -----
test('Una sustituta que se quedó sin respuesta bloquea cancelar la original y timbrar otra factura (no quedan dos vigentes)', async () => {
  const db = base(); let n = 0;
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': () => (n++ === 0 ? exito(U[0], 1)() : { abortar: true }) });
  const ctx = ctxDe(sim); const a = (await timbrar(db, {}, ctx)).factura;
  const r = await timbrar(db, { sustituye_a: a.id }, ctx); assert.equal(r.estado, 'sin_respuesta');
  await assert.rejects(cancelar(db, fila(db, a.id), { motivo: '02' }, ctx), /sin respuesta: primero verifícala/);
  assert.match(T.preparar(db, 10, { forma_pago: '03' }, { config: ctx.config }).errores.join(), /ya tiene factura|sin respuesta/);
});

test('El acuse con un código distinto de 201/202 es un «no»: la factura sigue vigente', async () => {
  const db = base();
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { response: 'success', acuse: ACUSE.replace('<EstatusUUID>201<', '<EstatusUUID>205<') } } }) });
  const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
  const r = await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'timbrada'); assert.match(r.mensaje, /código 205/); assert.equal(fila(db, f.id).motivo_cancelacion, null);
});

test('«No cancelable» y el rechazo del cliente regresan a vigente y limpian la solicitud (el acuse viejo no se queda)', async () => {
  for (const data of [{ Estado: 'Vigente', EsCancelable: 'No Cancelable', EstatusCancelacion: [] }, { Estado: 'Vigente', EsCancelable: 'Cancelable con aceptación', EstatusCancelacion: 'Solicitud rechazada' }]) {
    const db = base();
    const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'success', respuestaapi: { acuse: ACUSE } } }), 'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data } }) });
    const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
    const r = await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx);
    const x = fila(db, f.id);
    assert.equal(r.estado, 'timbrada'); assert.equal(x.estatus, 'timbrada');
    assert.deepEqual([x.motivo_cancelacion, x.folio_sustituto, x.cancelacion_solicitada_at, x.acuse], [null, null, null, null]);
    assert.ok(db.prepare("SELECT mensaje FROM facturas_log WHERE accion = 'cancelar' AND resultado = 'error'").get().mensaje.includes('motivo 02'), 'lo que se pidió queda en la bitácora técnica');
  }
});

test('«Ya estaba cancelada» no regresa la factura a vigente: se consulta el estatus', async () => {
  const db = base();
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => ({ json: { response: 'error', message: 'El CFDI ha sido previamente cancelado' } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: { Estado: 'Cancelado', EstatusCancelacion: 'Cancelado sin aceptación' } } }) });
  const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
  assert.equal((await cancelar(db, fila(db, f.id), { motivo: '02' }, ctx)).estado, 'cancelada');
});

test('Volver a pedir la cancelación: solo si sigue en proceso y pasó una hora; repite el mismo motivo', async () => {
  const db = base(); let veces = 0;
  const sim = simulado({ ...archivos, 'POST /v4/cfdi40/create': exito(U[0], 1), 'POST /v4/cfdi40/*/cancel': () => (++veces === 1 ? { abortar: true } : { json: { response: 'success', respuestaapi: { acuse: ACUSE } } }),
    'GET /v4/cfdi40/*/cancel_status': () => ({ json: { response: 'success', data: { Estado: 'Cancelado', EstatusCancelacion: 'Cancelado sin aceptación' } } }) });
  const ctx = ctxDe(sim); const f = (await timbrar(db, {}, ctx)).factura;
  await assert.rejects(cancelar(db, fila(db, f.id), { reintentar: true }, ctx), /Solo se vuelve a pedir/);
  assert.equal((await cancelar(db, fila(db, f.id), { motivo: '03' }, ctx)).estado, 'cancelacion_solicitada');
  await assert.rejects(cancelar(db, fila(db, f.id), { reintentar: true }, ctx), /menos de una hora/);
  db.exec("UPDATE facturas SET cancelacion_solicitada_at = datetime('now','localtime','-2 hours')");
  assert.equal((await cancelar(db, fila(db, f.id), { reintentar: true, motivo: '02' }, ctx)).estado, 'cancelada');
  const pedidos = cancelUrl(sim, U[0]); assert.equal(pedidos.length, 2); assert.deepEqual(pedidos.map(p => p.cuerpo.motivo), ['03', '03'], 'se repite el MISMO motivo');
});
