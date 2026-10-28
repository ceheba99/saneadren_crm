// Facturación · F3 timbrado (2026-10-27): pruebas SIN red del timbrado de una orden. Pasa por el cliente HTTP real (server/facturacom.js) con un
// «fetch» simulado que hace de factura.com, así se prueba también qué se conserva de los errores. Revisa: importes a 6 decimales (229.90 y 1635.48),
// el cuerpo que se manda, lo que falta antes de mandar, borrador si falla, sin respuesta → se verifica por NumOrder y NUNCA se manda dos veces a ciegas,
// «Ya existe un CFDI», cliente repetido en factura.com, PUE con saldo, entornos separados (una de prueba nunca toca la cobranza), demo sin red
// y que las llaves y los cuerpos de error no queden guardados.
// Uso: node --test tests/facturacion-timbrado.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const Database = require('../server/sqlite'); // el mismo envoltorio que usa el servidor (transaction, undefined → NULL)
const crearTablas = require('../server/facturacion-db');
const { crearClienteFactura } = require('../server/facturacom');
const { leerConfig } = require('../server/facturacion-config');
const T = require('../server/facturacion-timbrado'), { preparar, totalesDelXml } = T;
// Timbra y espera también las descargas del XML y el PDF (la ruta contesta antes de que terminen).
const timbrar = async (...a) => { const r = await T.timbrar(...a); if (r.descargas) r.avisos = [...(r.avisos || []), ...(await r.descargas)]; return r; };

const LLAVE = 'LLAVE-QUE-NO-DEBE-SALIR-111', SECRETA = 'SECRETA-QUE-NO-DEBE-SALIR-222';
const ENV = { sandbox: { FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: LLAVE, FACTURA_SANDBOX_SECRET_KEY: SECRETA, FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '26015' },
  prod: { FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: LLAVE, FACTURA_PROD_SECRET_KEY: SECRETA, FACTURA_PROD_EMISOR_REGIMEN: '626', FACTURA_PROD_EMISOR_CP: '76087' } };
const UUID1 = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
const xmlDe = (sub, total) => `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="7" SubTotal="${sub}" Moneda="MXN" Total="${total}" MetodoPago="PUE"><cfdi:Complemento/></cfdi:Comprobante>`;
const PDF = Buffer.from('%PDF-1.4 prueba');

function base() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO usuarios VALUES (1, 'Fer Factura');
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, empresa_contacto TEXT, rfc TEXT, correo TEXT); INSERT INTO clientes (id, nombre) VALUES (1, 'Acme'), (2, 'Otro');
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1); INSERT INTO sucursales (id, nombre, clave) VALUES (1, 'Querétaro', 'QRO');
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0);
    INSERT INTO catalogo_servicios (id, nombre) VALUES (1, 'Desazolve'), (2, 'Trampa de grasa'), (3, 'Sin clave');
    CREATE TABLE leads (id INTEGER PRIMARY KEY, estatus TEXT, ejecucion TEXT, iva_modo TEXT, iva_tasa INTEGER, iva_cent INTEGER, valor REAL, partidas_json TEXT, servicio_id INTEGER, cliente_id INTEGER,
      sucursal_id INTEGER, factura_folio TEXT, factura_fecha TEXT, factura_total_cent INTEGER, factura_metodo TEXT, created_at TEXT DEFAULT '2026-10-20 10:00:00');
    CREATE TABLE cobros (id INTEGER PRIMARY KEY, lead_id INTEGER, monto_cent INTEGER, cancelado INTEGER DEFAULT 0, confirmado INTEGER DEFAULT 1);
    CREATE TABLE historial (id INTEGER PRIMARY KEY, lead_id INTEGER, tipo TEXT, texto TEXT, usuario TEXT, origen TEXT, area TEXT, usuario_id INTEGER);`);
  crearTablas(db);
  db.exec(`UPDATE catalogo_servicios SET clave_prod_serv = '76121600', clave_unidad = 'E48', nombre_unidad = 'Unidad de servicio' WHERE id IN (1, 2);
    UPDATE sucursales SET cp_expedicion = '76087';
    INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, entorno) VALUES (1, 'factura', 'F', '5508587', 'sandbox');
    INSERT INTO sat_catalogos (catalogo, clave, nombre, extra) VALUES ('RegimenFiscal', '601', 'General de Ley Personas Morales', NULL), ('RegimenFiscal', '616', 'Sin obligaciones fiscales', NULL),
      ('UsoCfdi', 'G03', 'Gastos en general', '{"regimenes":["601","626"]}'), ('UsoCfdi', 'S01', 'Sin efectos fiscales', '{"regimenes":["601","616","626"]}'),
      ('FormaPago', '03', 'Transferencia electrónica de fondos', NULL), ('FormaPago', '99', 'Por definir', NULL);
    INSERT INTO clientes_fiscales (id, cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo, predeterminado, uid_facturacom, uid_entorno)
      VALUES (1, 1, 'EKU9003173C9', 'ESCUELA KEMPER URGATE', '26015', '601', 'G03', 'pagos@kemper.mx', 1, 'CLI-UID-1', 'sandbox');`);
  return db;
}
/** Una orden con IVA. partidas: [[servicio, leyenda, importe, cantidad?, precio?]] */
function orden(db, { partidas = [['Desazolve', 'Desazolve de drenaje', 229.90], ['Trampa de grasa', 'Limpieza de trampa', 1635.48]], modo = 'mas_iva', cliente = 1, id = 10, folio = null, cobrado = 0 } = {}) {
  const items = partidas.map(([servicio, leyenda, importe, cantidad, precio]) => ({ servicio, leyenda, importe, ...(cantidad ? { cantidad, precio } : {}) }));
  const suma = items.reduce((t, i) => t + Math.round(i.importe * 100), 0);
  const iva = modo === 'mas_iva' ? Math.round(suma * 16 / 100) : modo === 'incluido' ? suma - Math.round(suma * 100 / 116) : modo === 'sin_iva' ? 0 : null;
  const valor = modo === 'incluido' ? Math.round(suma * 100 / 116) / 100 : suma / 100;
  db.prepare("INSERT INTO leads (id, estatus, iva_modo, iva_tasa, iva_cent, valor, partidas_json, servicio_id, cliente_id, sucursal_id, factura_folio) VALUES (?, 'ganado', ?, ?, ?, ?, ?, 1, ?, 1, ?)")
    .run(id, modo, modo ? (modo === 'sin_iva' ? 0 : 16) : null, iva, valor, JSON.stringify(items), cliente, folio);
  if (cobrado) db.prepare('INSERT INTO cobros (lead_id, monto_cent) VALUES (?, ?)').run(id, cobrado);
  return id;
}

/** factura.com simulado: «respuestas» decide qué contesta cada ruta. Registra cada llamada (método, ruta y cuerpo). */
function simulado(respuestas = {}) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    const ruta = url.replace(/^https:\/\/[^/]+(\/api)?/, ''), metodo = opciones.method, cuerpo = opciones.body ? JSON.parse(opciones.body) : undefined;
    assert.equal(opciones.headers['F-Api-Key'], LLAVE); // las llaves solo viajan en los encabezados
    llamadas.push({ metodo, ruta, cuerpo });
    const r = (respuestas[metodo + ' ' + ruta] || respuestas[metodo + ' ' + ruta.replace(/[^/]+$/, '*')] || (() => ({ status: 404, json: { status: 'error', message: 'Ruta no simulada: ' + ruta } })))(cuerpo, llamadas);
    if (r.abortar) { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
    const buf = r.buffer || Buffer.from(r.texto ?? JSON.stringify(r.json));
    return { status: r.status || 200, headers: { get: () => r.tipo || 'application/json' }, arrayBuffer: async () => buf };
  };
  return { llamadas, fetchImpl };
}
const EXITO = (folio = 7, uuid = UUID1) => () => ({ json: { response: 'success', message: 'Factura creada', UUID: uuid, uid: 'CFDI-UID-' + folio, invoice_uid: 'INV-' + folio, SAT: { UUID: uuid, FechaTimbrado: '2026-10-27T12:34:56' }, INV: { Serie: 'F', Folio: folio } } });
const ARCHIVOS = { 'GET /v4/cfdi40/*': () => null };
function contexto(db, sim, { entorno = 'sandbox', demo = false } = {}) {
  const config = leerConfig(ENV[entorno]), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-fact-'));
  return { config, demo, dirArchivos: dir, usuario: { id: 1, nombre: 'Fer Factura' }, crearCliente: () => crearClienteFactura({ config, fetchImpl: sim.fetchImpl, esperaMs: 1 }) };
}
const respuestasBase = (extra = {}) => ({
  'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success', Data: { UID: 'CLI-UID-1' } } }),
  ['GET /v4/cfdi40/' + UUID1 + '/xml']: () => ({ tipo: 'application/xml', texto: xmlDe('1865.38', '2163.84') }),
  ['GET /v4/cfdi40/' + UUID1 + '/pdf']: () => ({ tipo: 'application/pdf', buffer: PDF }),
  ...extra,
});
const factura = db => db.prepare('SELECT * FROM facturas ORDER BY id DESC LIMIT 1').get();
const posts = (sim, patron) => sim.llamadas.filter(l => l.metodo === 'POST' && patron.test(l.ruta));

test('Importes: 229.90 y 1635.48 a 6 decimales por concepto; redondeo solo en las sumas; el cuerpo es el de la doc', () => {
  const db = base(); orden(db);
  const p = preparar(db, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) });
  assert.deepEqual(p.errores, []);
  assert.deepEqual(p.resumen.conceptos.map(c => [c.importe, c.iva]), [['229.900000', '36.784000'], ['1635.480000', '261.676800']]);
  assert.deepEqual([p.resumen.subtotal_cent, p.resumen.iva_cent, p.resumen.total_cent], [186538, 29846, 216384]);
  const c = p.cuerpo.Conceptos[0];
  assert.deepEqual(c, { ClaveProdServ: '76121600', Cantidad: 1, ClaveUnidad: 'E48', Unidad: 'Unidad de servicio', ValorUnitario: 229.9, Importe: 229.9, Descripcion: 'Desazolve de drenaje', ObjetoImp: '02',
    Impuestos: { Traslados: [{ Base: 229.9, Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: '0.16', Importe: 36.784 }] } });
  assert.equal(p.cuerpo.MetodoPago, 'PUE'); assert.equal(p.cuerpo.FormaPago, '03'); assert.equal(p.cuerpo.UsoCFDI, 'G03'); assert.equal(p.cuerpo.Serie, 5508587); assert.equal(p.cuerpo.LugarExpedicion, '76087');
  assert.equal(p.cuerpo.EnviarCorreo, false, 'en sandbox nunca se manda correo'); assert.equal(p.cuerpo.BorradorSiFalla, '1'); assert.equal(p.cuerpo.RegimenFiscal, 601);
  assert.ok(!('FechaFromAPI' in p.cuerpo), 'no se manda fecha: la pone factura.com');
});

test('Cantidad × precio se respeta si cuadra; IVA incluido se desglosa sin perder centavos', () => {
  const db = base(); orden(db, { partidas: [['Desazolve', 'Tres viajes', 689.70, 3, 229.90]] });
  let p = preparar(db, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) });
  assert.deepEqual([p.cuerpo.Conceptos[0].Cantidad, p.cuerpo.Conceptos[0].ValorUnitario, p.cuerpo.Conceptos[0].Importe], [3, 229.9, 689.7]);
  const db2 = base(); orden(db2, { modo: 'incluido', partidas: [['Desazolve', 'Con IVA', 1160], ['Trampa de grasa', 'Con IVA', 100]] });
  p = preparar(db2, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) });
  assert.deepEqual(p.errores, []);
  assert.deepEqual(p.resumen.conceptos.map(c => [c.importe, c.iva]), [['1000.000000', '160.000000'], ['86.206897', '13.793104']]);
  assert.equal(p.resumen.total_cent, 126000, 'el total con IVA incluido es lo que se capturó');
});

test('Antes de mandar nada se dice qué falta (y no se llama a factura.com)', async () => {
  const casos = [
    [db => orden(db, { modo: 'sin_iva' }), /sin IVA/], [db => orden(db, { modo: null }), /por definir/],
    [db => orden(db, { cliente: 2 }), /no tiene datos fiscales/], [db => orden(db, { partidas: [['Sin clave', 'x', 100]] }), /no tiene clave del SAT/],
    [db => { orden(db); db.exec("UPDATE clientes_fiscales SET correo = ''"); }, /Faltan datos fiscales del cliente: Correo/],
    [db => { orden(db); db.exec("UPDATE clientes_fiscales SET rfc = 'XAXX010101000'"); }, /público en general/],
    [db => { orden(db); db.exec('DELETE FROM series_factura'); }, /no tiene serie de factura/],
    [db => { orden(db); db.exec("UPDATE series_factura SET entorno = 'prod'"); }, /es de producción y la conexión está en pruebas/],
    [db => { orden(db); db.exec("UPDATE clientes_fiscales SET regimen = '616'"); }, /no es compatible con el régimen 616/],
  ];
  for (const [armar, error] of casos) {
    const db = base(); armar(db); const sim = simulado(respuestasBase());
    await assert.rejects(timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, sim)), e => { assert.match(e.message, error); return true; });
    assert.deepEqual(sim.llamadas, [], 'no se llamó a factura.com: ' + error);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM facturas').get().n, 0, 'no queda nada apartado');
  }
  const db = base(); orden(db);
  assert.match(preparar(db, 10, { forma_pago: '99' }, { config: leerConfig(ENV.sandbox) }).errores.join(), /solo se usa en facturas a crédito/);
  assert.match(preparar(db, 10, {}, { config: leerConfig(ENV.sandbox) }).errores.join(), /Elige la forma de pago/);
});

test('Timbrado en SANDBOX: queda timbrada con XML y PDF, y la orden (cobranza) no se toca', async () => {
  const db = base(); orden(db); const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': EXITO() })), ctx = contexto(db, sim);
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'timbrada');
  const f = factura(db);
  assert.equal(f.estatus, 'timbrada'); assert.equal(f.uuid, UUID1); assert.equal(f.serie, 'F'); assert.equal(f.folio, '7'); assert.equal(f.entorno, 'sandbox');
  assert.match(f.num_order, /^OS-202610-0010-F\d+-[0-9A-F]{6}$/); assert.match(f.xml, /cfdi:Comprobante/); assert.equal(f.total_cent, 216384);
  assert.ok(fs.existsSync(path.join(ctx.dirArchivos, f.pdf_path)), 'el PDF quedó en el disco');
  const enviado = posts(sim, /^\/v4\/cfdi40\/create$/)[0].cuerpo;
  assert.deepEqual(enviado.Receptor, { UID: 'CLI-UID-1' }); assert.equal(enviado.NumOrder, f.num_order);
  const lead = db.prepare('SELECT * FROM leads WHERE id = 10').get();
  assert.equal(lead.factura_folio, null, 'una factura de prueba no toca la orden'); assert.equal(lead.factura_total_cent, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM historial').get().n, 0);
  await assert.rejects(timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx), /ya tiene factura/);
});

test('Timbrado en PRODUCCIÓN: la cobranza de la orden toma folio, fecha, total del XML y PUE; la bitácora no lleva el UUID', async () => {
  const db = base(); orden(db); db.exec("UPDATE series_factura SET entorno = 'prod'");
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': EXITO(), 'GET /v1/clients/rfc/EKU9003173C9': () => ({ json: { status: 'error', message: 'El cliente no existe' } }),
    'POST /v1/clients/create': () => ({ json: { status: 'success', Data: { UID: 'CLI-PROD-9' } } }) }));
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, sim, { entorno: 'prod' }));
  assert.equal(r.estado, 'timbrada');
  assert.equal(posts(sim, /clients\/create/).length, 1, 'el UID de sandbox no sirve en producción: se dio de alta otra vez');
  assert.equal(db.prepare('SELECT uid_facturacom, uid_entorno FROM clientes_fiscales WHERE id = 1').get().uid_entorno, 'prod');
  assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/)[0].cuerpo.EnviarCorreo, true, 'en producción se manda al correo del cliente (por omisión)');
  assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/)[0].cuerpo.RegimenFiscal, 626);
  const lead = db.prepare('SELECT * FROM leads WHERE id = 10').get();
  assert.deepEqual([lead.factura_folio, lead.factura_fecha, lead.factura_total_cent, lead.factura_metodo], ['F-7', '2026-10-27', 216384, 'PUE']);
  const h = db.prepare('SELECT texto, area FROM historial').all();
  assert.equal(h.length, 1); assert.equal(h[0].area, 'cxc'); assert.ok(!h[0].texto.includes(UUID1) && !h[0].texto.includes('EKU9003173C9'), 'sin UUID ni RFC en la bitácora de la orden');
});

test('Una factura de prueba no estorba a la real (un lugar por entorno), y una capturada a mano bloquea timbrar otra en producción', async () => {
  const db = base(); orden(db);
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, simulado(respuestasBase({ 'POST /v4/cfdi40/create': EXITO() }))));
  db.exec("UPDATE series_factura SET entorno = 'prod'");
  assert.deepEqual(preparar(db, 10, { forma_pago: '03' }, { config: leerConfig(ENV.prod) }).errores, []);
  const db2 = base(); orden(db2, { folio: 'A-555' }); db2.exec("UPDATE series_factura SET entorno = 'prod'");
  assert.match(preparar(db2, 10, { forma_pago: '03' }, { config: leerConfig(ENV.prod) }).errores.join(), /ya tiene registrada la factura A-555/);
  db2.exec("UPDATE series_factura SET entorno = 'sandbox'");
  const p = preparar(db2, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) });
  assert.deepEqual(p.errores, []); assert.match(p.avisos.join(), /PRUEBA, no se toca/);
});

test('Si falla el timbrado queda BORRADOR (pendiente de corregir); al reintentar se corrige ese borrador y se timbra, sin crear otro', async () => {
  const db = base(); orden(db);
  const errorConBorrador = () => ({ json: { response: 'error', message: { message: 'CFDI40111 - El valor del campo Descuento no es correcto', messageDetail: 'detalle', data: { Secret: 'NO-GUARDAR' }, status: 'error' },
    xmlerror: '<xml secreto="NO-GUARDAR"/>', draft: { response: 'success', uid: 'BORR-1', INV: { Serie: 'F', Folio: 8 } } } });
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': errorConBorrador, 'POST /v4/cfdi40/create/BORR-1': () => ({ json: { response: 'success', message: 'Borrador creado satisfactoriamente', uid: 'BORR-1' } }),
    'POST /v4/cfdi40/BORR-1/timbrarborrador': EXITO(8) }));
  const ctx = contexto(db, sim);
  let r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'borrador_error'); assert.match(r.mensaje, /CFDI40111 - El valor del campo Descuento no es correcto — detalle/);
  let f = factura(db); assert.equal(f.cfdi_uid, 'BORR-1'); assert.equal(f.folio, '8');
  const guardado = JSON.stringify(db.prepare('SELECT * FROM facturas').all()) + JSON.stringify(db.prepare('SELECT * FROM facturas_log').all());
  assert.ok(!guardado.includes('NO-GUARDAR'), 'del cuerpo del error solo se guarda el mensaje y el uid del borrador');
  r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'timbrada'); f = factura(db); assert.equal(f.estatus, 'timbrada'); assert.equal(f.folio, '8');
  assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/).length, 1, 'no se creó otro CFDI: se corrigió el borrador');
  assert.equal(posts(sim, /create\/BORR-1$/)[0].cuerpo.Draft, '1');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM facturas').get().n, 1);
});

test('Sin respuesta (30 s): queda «timbrando»; el siguiente intento BUSCA por NumOrder antes de mandar y no duplica', async () => {
  const db = base(); orden(db);
  let encontrada = false;
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ abortar: true }),
    'GET /v4/cfdi/order/*': () => (encontrada ? { json: { status: 'success', data: { UID: 'CFDI-UID-7', UUID: UUID1, Folio: 'F 7', Status: 'enviada', NumOrder: factura(db).num_order } } } : { json: { status: 'error', message: 'No se encontró CFDI: x' } }) }));
  const ctx = contexto(db, sim);
  let r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'sin_respuesta'); assert.equal(factura(db).estatus, 'timbrando');
  // Enseguida: no aparece todavía → no se manda otra vez (puede estar en camino).
  await assert.rejects(timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx), /Espera un minuto/);
  assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/).length, 1);
  // Ya apareció en factura.com: se toma la que existe, sin mandar nada.
  encontrada = true;
  r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'timbrada'); const f = factura(db); assert.equal(f.uuid, UUID1); assert.equal(f.folio, '7');
  assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/).length, 1, 'jamás se mandó dos veces');
});

test('Sin respuesta y de verdad no llegó: pasado el minuto se vuelve a mandar con el MISMO NumOrder', async () => {
  const db = base(); orden(db);
  let veces = 0;
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': (c, ll) => (++veces === 1 ? { abortar: true } : EXITO()()), 'GET /v4/cfdi/order/*': () => ({ json: { status: 'error', message: 'No se encontró CFDI: x' } }) }));
  const ctx = contexto(db, sim);
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  db.exec("UPDATE facturas SET updated_at = datetime('now','localtime','-5 minutes')");
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'timbrada');
  const enviados = posts(sim, /^\/v4\/cfdi40\/create$/);
  assert.equal(enviados.length, 2); assert.equal(enviados[0].cuerpo.NumOrder, enviados[1].cuerpo.NumOrder);
  const orden1 = sim.llamadas.findIndex(l => l.ruta.startsWith('/v4/cfdi/order/')), segundo = sim.llamadas.lastIndexOf(enviados[1]);
  assert.ok(orden1 >= 0 && orden1 < segundo, 'antes de volver a mandar, se buscó por NumOrder');
});

test('Rechazada sin borrador: queda «pendiente» con el motivo; «Ya existe un CFDI con folio y serie» no duplica', async () => {
  const db = base(); orden(db);
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ json: { response: 'error', message: 'Ya existe un CFDI con folio y serie [F-1]', uid: 'OTRA', uuid: 'OTRO' } }),
    'GET /v4/cfdi/order/*': () => ({ json: { status: 'error', message: 'No se encontró CFDI: x' } }) }));
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, sim));
  assert.equal(r.estado, 'pendiente'); assert.match(r.mensaje, /Ya existe un CFDI/);
  assert.equal(factura(db).estatus, 'pendiente'); assert.equal(factura(db).uuid, null, 'no se adoptó el CFDI de otra orden');
  assert.equal(sim.llamadas.filter(l => l.ruta.startsWith('/v4/cfdi/order/')).length, 1, 'se revisó si era esta misma');
});

test('El RFC ya existe en factura.com y este cliente no tiene UID: no se crea otro, se pide elegir', async () => {
  const db = base(); orden(db); db.exec('UPDATE clientes_fiscales SET uid_facturacom = NULL, uid_entorno = NULL');
  const sim = simulado(respuestasBase({ 'GET /v1/clients/rfc/EKU9003173C9': () => ({ json: { status: 'success', Data: [{ UID: 'YA-1', RazonSocial: 'ESCUELA KEMPER URGATE', CodigoPostal: '26015', RegimenId: '601' }] } }) }));
  await assert.rejects(timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, sim)), e => { assert.equal(e.candidatos[0].uid, 'YA-1'); assert.equal(e.cliente_fiscal_id, 1); return true; });
  assert.equal(posts(sim, /clients\/create|cfdi40/).length, 0);
  assert.equal(factura(db).estatus, 'pendiente');
});

test('PUE con saldo pendiente: se pide confirmar; pagada completa, no', async () => {
  const db = base(); orden(db, { cobrado: 100000 }); const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': EXITO() }));
  await assert.rejects(timbrar(db, 10, { forma_pago: '03' }, contexto(db, sim)), e => { assert.match(e.confirmar[0], /día 17 del mes siguiente/); return true; });
  assert.equal(sim.llamadas.length, 0);
  const db2 = base(); orden(db2, { cobrado: 216384 });
  assert.deepEqual(preparar(db2, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) }).confirmar, []);
});

test('Demo: la factura se simula, dice que no es CFDI y no se llama a factura.com', async () => {
  const db = base(); orden(db); const sim = simulado();
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, { ...contexto(db, sim), config: leerConfig({}), demo: true });
  assert.equal(r.estado, 'timbrada'); const f = factura(db);
  assert.equal(f.entorno, 'demo'); assert.match(f.xml, /NO es un CFDI/); assert.equal(sim.llamadas.length, 0);
  assert.equal(db.prepare('SELECT factura_folio FROM leads WHERE id = 10').get().factura_folio, null);
});

test('Las llaves nunca quedan en la base', async () => {
  const db = base(); orden(db);
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ status: 401, json: { status: 'error', message: 'Llave ' + LLAVE + ' no válida', Data: SECRETA, Secret: SECRETA } }) }));
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, sim));
  const todo = JSON.stringify(db.prepare('SELECT * FROM facturas').all()) + JSON.stringify(db.prepare('SELECT * FROM facturas_log').all());
  assert.ok(!todo.includes(LLAVE) && !todo.includes(SECRETA));
});

test('Totales del XML timbrado', () => {
  assert.deepEqual(totalesDelXml(xmlDe('1865.38', '2163.84')), { subtotal_cent: 186538, total_cent: 216384, iva_cent: 29846 });
  assert.equal(totalesDelXml('<otro/>'), null);
});

test('Mensajes de factura.com legibles: sin etiquetas HTML y con los acentos reparados (respuesta real de sandbox, 2026-10-27)', () => {
  const { textoLegible } = require('../server/facturacom');
  assert.equal(textoLegible('<strong>No puedes facturar 2</strong>, necesitas agregar los archivos de facturaciÃ³n de la cuenta correspondiente'), 'No puedes facturar 2, necesitas agregar los archivos de facturación de la cuenta correspondiente');
  assert.equal(textoLegible('Facturación, Año y Ñandú'), 'Facturación, Año y Ñandú', 'lo que ya viene bien no se toca');
});

// ----- Hallazgos del revisor fiscal (2026-10-27) -----
test('Un 504 en HTML DESPUÉS de mandar no es «rechazada»: queda «timbrando» y el siguiente intento busca por NumOrder (nunca reenvía a ciegas)', async () => {
  const db = base(); orden(db);
  let timbrada = false;
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => { timbrada = true; return { status: 504, tipo: 'text/html', texto: '<html><body>504 Gateway Time-out</body></html>' }; },
    'GET /v4/cfdi/order/*': () => (timbrada ? { json: { status: 'success', data: { UID: 'CFDI-UID-7', UUID: UUID1, Folio: 'F7', Status: 'enviada', NumOrder: factura(db).num_order } } } : { json: { status: 'error', message: 'No se encontró CFDI: x' } }) }));
  const ctx = contexto(db, sim);
  let r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'sin_respuesta'); assert.equal(factura(db).estatus, 'timbrando');
  r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'timbrada'); assert.equal(factura(db).uuid, UUID1);
  assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/).length, 1, 'el segundo intento encontró la que sí se timbró y no mandó otra');
});

test('Un 5xx al timbrar un BORRADOR tampoco se toma como «sigue en borrador»: queda «timbrando» para verificar', async () => {
  const db = base(); orden(db);
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ json: { response: 'error', message: 'Falla', draft: { uid: 'BORR-2', INV: { Serie: 'F', Folio: 9 } } } }),
    'POST /v4/cfdi40/create/BORR-2': () => ({ json: { response: 'success', uid: 'BORR-2' } }), 'POST /v4/cfdi40/BORR-2/timbrarborrador': () => ({ status: 502, tipo: 'text/html', texto: '<html>Bad gateway</html>' }) }));
  const ctx = contexto(db, sim);
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  assert.equal(r.estado, 'sin_respuesta'); assert.equal(factura(db).estatus, 'timbrando');
});

test('Al buscar por NumOrder, solo «No se encontró CFDI» en JSON prueba que no existe; un 404 en HTML o «La serie no existe» NO liberan el reenvío', async () => {
  for (const respuesta of [() => ({ status: 404, tipo: 'text/html', texto: '<html>Not found</html>' }), () => ({ json: { status: 'error', message: 'La serie no existe' } }), () => ({ status: 503, json: { status: 'error', message: 'No se encontró CFDI: x' } })]) {
    const db = base(); orden(db);
    const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ abortar: true }), 'GET /v4/cfdi/order/*': respuesta }));
    const ctx = contexto(db, sim);
    await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
    db.exec("UPDATE facturas SET updated_at = datetime('now','localtime','-5 minutes')");
    await assert.rejects(timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx));
    assert.equal(factura(db).estatus, 'timbrando'); assert.equal(posts(sim, /^\/v4\/cfdi40\/create$/).length, 1);
  }
});

test('«Verificar» usa la misma puerta: si es reciente pide esperar; pasado el minuto y sin existir, la libera', async () => {
  const db = base(); orden(db);
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ abortar: true }), 'GET /v4/cfdi/order/*': () => ({ json: { status: 'error', message: 'No se encontró CFDI: x' } }) }));
  const ctx = contexto(db, sim);
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  await assert.rejects(T.resolverSinRespuesta(db, ctx.crearCliente(), factura(db), ctx), /Espera un minuto/);
  assert.equal(factura(db).estatus, 'timbrando');
  db.exec("UPDATE facturas SET updated_at = datetime('now','localtime','-2 minutes')");
  const r = await T.resolverSinRespuesta(db, ctx.crearCliente(), factura(db), ctx);
  assert.equal(r.estado, 'pendiente'); assert.equal(factura(db).estatus, 'pendiente');
});

test('Encontrada «en proceso de cancelación» queda como cancelación solicitada, no como cancelada (regla 13)', async () => {
  const db = base(); orden(db);
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ abortar: true }),
    'GET /v4/cfdi/order/*': () => ({ json: { status: 'success', data: { UID: 'U1', UUID: UUID1, Folio: 'F7', Status: 'En proceso de cancelación', NumOrder: factura(db).num_order } } }) }));
  const ctx = contexto(db, sim);
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx);
  const r = await timbrar(db, 10, { forma_pago: '03', confirmar: true }, ctx).catch(e => e);
  assert.equal(factura(db).estatus, 'cancelacion_solicitada'); assert.equal(factura(db).cancelada_at, null);
});

test('La bitácora técnica no guarda el RFC; un cobro «por confirmar» no quita el aviso de PUE', async () => {
  const db = base(); orden(db);
  const sim = simulado(respuestasBase({ 'POST /v4/cfdi40/create': () => ({ json: { response: 'error', message: 'El RFC EKU9003173C9 del receptor no está en la lista' } }) }));
  await timbrar(db, 10, { forma_pago: '03', confirmar: true }, contexto(db, sim));
  assert.ok(!JSON.stringify(db.prepare('SELECT mensaje FROM facturas_log').all()).includes('EKU9003173C9'));
  const db2 = base(); orden(db2); db2.prepare('INSERT INTO cobros (lead_id, monto_cent, confirmado) VALUES (10, 216384, 0)').run();
  const p = preparar(db2, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) });
  assert.match(p.confirmar.join(), /por confirmar/);
  db2.exec('UPDATE cobros SET confirmado = 1, monto_cent = 216383');
  assert.deepEqual(preparar(db2, 10, { forma_pago: '03' }, { config: leerConfig(ENV.sandbox) }).confirmar, [], 'un centavo de diferencia no cuenta como saldo');
});
