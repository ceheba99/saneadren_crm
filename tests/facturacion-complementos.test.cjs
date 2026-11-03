// Facturación · F6 (2026-11-03): pruebas SIN red de la factura a crédito (PPD) y del complemento de pago de cada cobro. Pasa por el cliente HTTP real
// (server/facturacom.js) con un «fetch» simulado que hace de factura.com. Revisa: PUE o PPD (sugerido y elegido; PPD con 99), el cuerpo del complemento
// como en la doc (complementos-de-pago), parcialidades y saldos en orden, IVA del pago a 6 decimales con enteros, forma de pago sugerida o preguntada,
// lo que no lleva complemento (ajustes, por confirmar, cancelados, factura PUE), sin respuesta → se verifica por NumOrder y no se duplica, candados
// (factura con complementos, cobro con complemento) y que un complemento cancelado deja el pago pendiente otra vez. Corregir un complemento:
// el nuevo va relacionado (04) con la misma parcialidad y saldos, toma el lugar del anterior y el anterior se cancela con el 01.
// Uso: node --test tests/facturacion-complementos.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const Database = require('../server/sqlite');
const crearTablas = require('../server/facturacion-db');
const { crearClienteFactura } = require('../server/facturacom');
const { leerConfig } = require('../server/facturacion-config');
const T = require('../server/facturacion-timbrado');
const C = require('../server/facturacion-complementos');
const { revisar } = require('../server/facturacion-cancelacion');
const esperar = async r => { if (r.descargas) r.avisos = [...(r.avisos || []), ...(await r.descargas)]; return r; };
const timbrar = async (...a) => esperar(await T.timbrar(...a));
const complemento = async (...a) => esperar(await C.timbrarComplemento(...a));

const LLAVE = 'LLAVE-QUE-NO-DEBE-SALIR-111', SECRETA = 'SECRETA-QUE-NO-DEBE-SALIR-222';
const ENV = { sandbox: { FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: LLAVE, FACTURA_SANDBOX_SECRET_KEY: SECRETA, FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '26015' },
  prod: { FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: LLAVE, FACTURA_PROD_SECRET_KEY: SECRETA, FACTURA_PROD_EMISOR_REGIMEN: '626', FACTURA_PROD_EMISOR_CP: '76087' } };
const UUID_F = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', UUID_P1 = 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C51', UUID_P2 = 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C52';
const xmlDe = (serie, sub, total, metodo) => `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="${serie}" Folio="7" SubTotal="${sub}" Moneda="MXN" Total="${total}"${metodo ? ` MetodoPago="${metodo}"` : ''}><cfdi:Complemento/></cfdi:Comprobante>`;
const PDF = Buffer.from('%PDF-1.4 prueba');

function base({ seriePago = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO usuarios VALUES (1, 'Fer Factura');
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, empresa_contacto TEXT, rfc TEXT, correo TEXT); INSERT INTO clientes (id, nombre) VALUES (1, 'Acme');
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1); INSERT INTO sucursales (id, nombre, clave) VALUES (1, 'Querétaro', 'QRO');
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0);
    INSERT INTO catalogo_servicios (id, nombre) VALUES (1, 'Desazolve'), (2, 'Trampa de grasa');
    CREATE TABLE leads (id INTEGER PRIMARY KEY, estatus TEXT, ejecucion TEXT, iva_modo TEXT, iva_tasa INTEGER, iva_cent INTEGER, valor REAL, partidas_json TEXT, servicio_id INTEGER, cliente_id INTEGER,
      sucursal_id INTEGER, dias_credito INTEGER, factura_folio TEXT, factura_fecha TEXT, factura_total_cent INTEGER, factura_metodo TEXT, created_at TEXT DEFAULT '2026-10-20 10:00:00');
    CREATE TABLE cobros (id INTEGER PRIMARY KEY, lead_id INTEGER, fecha TEXT, monto_cent INTEGER, tipo TEXT DEFAULT 'pago', metodo TEXT DEFAULT 'transferencia', referencia TEXT,
      cancelado INTEGER DEFAULT 0, confirmado INTEGER DEFAULT 1);
    CREATE TABLE historial (id INTEGER PRIMARY KEY, lead_id INTEGER, tipo TEXT, texto TEXT, usuario TEXT, origen TEXT, area TEXT, usuario_id INTEGER);`);
  crearTablas(db);
  db.exec(`UPDATE catalogo_servicios SET clave_prod_serv = '76121600', clave_unidad = 'E48', nombre_unidad = 'Unidad de servicio';
    UPDATE sucursales SET cp_expedicion = '76087';
    INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, entorno) VALUES (1, 'factura', 'F', '5508587', 'sandbox');
    ${seriePago ? "INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, entorno) VALUES (1, 'pago', 'PA', '5508598', 'sandbox');" : ''}
    INSERT INTO sat_catalogos (catalogo, clave, nombre, extra) VALUES ('RegimenFiscal', '601', 'General de Ley Personas Morales', NULL),
      ('UsoCfdi', 'G03', 'Gastos en general', '{"regimenes":["601","626"]}'),
      ('FormaPago', '01', 'Efectivo', NULL), ('FormaPago', '02', 'Cheque nominativo', NULL), ('FormaPago', '03', 'Transferencia electrónica de fondos', NULL),
      ('FormaPago', '04', 'Tarjeta de crédito', NULL), ('FormaPago', '28', 'Tarjeta de débito', NULL), ('FormaPago', '99', 'Por definir', NULL);
    INSERT INTO clientes_fiscales (id, cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo, predeterminado, uid_facturacom, uid_entorno)
      VALUES (1, 1, 'EKU9003173C9', 'ESCUELA KEMPER URGATE', '26015', '601', 'G03', 'pagos@kemper.mx', 1, 'CLI-UID-1', 'sandbox');`);
  return db;
}
/** Orden de 229.90 + 1635.48 más IVA = 2,163.84. */
function orden(db, { id = 10, dias = null } = {}) {
  const items = [{ servicio: 'Desazolve', leyenda: 'Desazolve de drenaje', importe: 229.90 }, { servicio: 'Trampa de grasa', leyenda: 'Limpieza de trampa', importe: 1635.48 }];
  db.prepare("INSERT INTO leads (id, estatus, iva_modo, iva_tasa, iva_cent, valor, partidas_json, servicio_id, cliente_id, sucursal_id, dias_credito) VALUES (?, 'ganado', 'mas_iva', 16, 29846, 1865.38, ?, 1, 1, 1, ?)")
    .run(id, JSON.stringify(items), dias);
  return id;
}
const cobro = (db, { lead = 10, fecha = '2026-11-01', monto = 100000, tipo = 'pago', metodo = 'transferencia', confirmado = 1, referencia = null } = {}) =>
  Number(db.prepare('INSERT INTO cobros (lead_id, fecha, monto_cent, tipo, metodo, confirmado, referencia) VALUES (?, ?, ?, ?, ?, ?, ?)').run(lead, fecha, monto, tipo, metodo, confirmado, referencia).lastInsertRowid);

function simulado(respuestas = {}) {
  const llamadas = [];
  const fetchImpl = async (url, opciones) => {
    const ruta = url.replace(/^https:\/\/[^/]+(\/api)?/, ''), metodo = opciones.method, cuerpo = opciones.body ? JSON.parse(opciones.body) : undefined;
    assert.equal(opciones.headers['F-Api-Key'], LLAVE);
    llamadas.push({ metodo, ruta, cuerpo });
    const r = (respuestas[metodo + ' ' + ruta] || (() => ({ status: 404, json: { status: 'error', message: 'Ruta no simulada: ' + ruta } })))(cuerpo, llamadas);
    if (r.abortar) { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
    const buf = r.buffer || Buffer.from(r.texto ?? JSON.stringify(r.json));
    return { status: r.status || 200, headers: { get: () => r.tipo || 'application/json' }, arrayBuffer: async () => buf };
  };
  return { llamadas, fetchImpl };
}
const EXITO = (serie, folio, uuid) => () => ({ json: { response: 'success', message: 'Factura creada', UUID: uuid, uid: 'CFDI-UID-' + serie + folio, invoice_uid: 'INV-' + folio,
  SAT: { UUID: uuid, FechaTimbrado: '2026-11-02T12:34:56' }, INV: { Serie: serie, Folio: folio } } });
// factura.com: la factura (F-7) y dos complementos (PA-1 y PA-2), en ese orden.
function respuestas(extra = {}) {
  let n = 0;
  const cfdis = [EXITO('F', 7, UUID_F), EXITO('PA', 1, UUID_P1), EXITO('PA', 2, UUID_P2)];
  return {
    'POST /v1/clients/CLI-UID-1/update': () => ({ json: { status: 'success', Data: { UID: 'CLI-UID-1' } } }),
    'POST /v4/cfdi40/create': (...a) => cfdis[n++](...a),
    ['GET /v4/cfdi40/' + UUID_F + '/xml']: () => ({ tipo: 'application/xml', texto: xmlDe('F', '1865.38', '2163.84', 'PPD') }),
    ['GET /v4/cfdi40/' + UUID_P1 + '/xml']: () => ({ tipo: 'application/xml', texto: xmlDe('PA', '0', '0') }),
    ['GET /v4/cfdi40/' + UUID_P2 + '/xml']: () => ({ tipo: 'application/xml', texto: xmlDe('PA', '0', '0') }),
    ...Object.fromEntries([UUID_F, UUID_P1, UUID_P2].map(u => ['GET /v4/cfdi40/' + u + '/pdf', () => ({ tipo: 'application/pdf', buffer: PDF })])),
    ...extra,
  };
}
function contexto(db, sim, { entorno = 'sandbox', demo = false } = {}) {
  const config = leerConfig(ENV[entorno]), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-comp-'));
  return { config, demo, dirArchivos: dir, usuario: { id: 1, nombre: 'Fer Factura' }, crearCliente: () => crearClienteFactura({ config, fetchImpl: sim.fetchImpl, esperaMs: 1 }) };
}
const cfg = entorno => ({ config: leerConfig(ENV[entorno || 'sandbox']) });
const creados = sim => sim.llamadas.filter(l => l.metodo === 'POST' && l.ruta === '/v4/cfdi40/create');
/** Orden con su factura PPD ya timbrada (sandbox). */
async function conPpd(db, sim, ops = {}) {
  orden(db, ops);
  const r = await timbrar(db, 10, { metodo_pago: 'PPD', confirmar: true }, contexto(db, sim, ops));
  assert.equal(r.estado, 'timbrada');
  return r.factura;
}

test('PUE o PPD: se sugiere PPD si debe algo o tiene días de crédito; PPD va con 99 y no se permite si ya pagó todo', () => {
  const db = base(); orden(db);
  let p = T.preparar(db, 10, {}, cfg());
  assert.equal(p.resumen.metodo_sugerido, 'PPD'); assert.equal(p.resumen.metodo_pago, 'PPD');
  assert.equal(p.cuerpo.MetodoPago, 'PPD'); assert.equal(p.cuerpo.FormaPago, '99', 'PPD siempre con «Por definir»');
  assert.deepEqual(p.formas.map(f => f.clave), ['99']);
  assert.deepEqual(p.errores, []); assert.deepEqual(p.confirmar, [], 'sin pagos previos no hay nada que confirmar');
  // Con forma de pago elegida a mano en PPD, se ignora: va 99.
  assert.equal(T.preparar(db, 10, { metodo_pago: 'PPD', forma_pago: '03' }, cfg()).cuerpo.FormaPago, '99');
  // Pagada completa: se sugiere PUE y PPD es un error.
  const db2 = base(); orden(db2); cobro(db2, { monto: 216384 });
  assert.equal(T.preparar(db2, 10, { forma_pago: '03' }, cfg()).resumen.metodo_sugerido, 'PUE');
  assert.match(T.preparar(db2, 10, { metodo_pago: 'PPD' }, cfg()).errores.join(), /ya pagó todo/);
  // Pagada completa aunque tenga días de crédito: se sugiere PUE (no hay nada que cobrar a crédito).
  const db3 = base(); orden(db3, { dias: 30 }); cobro(db3, { monto: 216384 });
  assert.equal(T.preparar(db3, 10, {}, cfg()).resumen.metodo_sugerido, 'PUE');
  // Un método inventado no pasa.
  assert.match(T.preparar(db, 10, { metodo_pago: 'XYZ' }, cfg()).errores.join(), /PUE .* o PPD/);
});

test('PPD con pagos de antes de la factura: se pide confirmar (también llevan complemento); sin serie de pagos, se avisa', () => {
  const db = base({ seriePago: false }); orden(db); cobro(db, { monto: 50000 });
  const p = T.preparar(db, 10, { metodo_pago: 'PPD' }, cfg());
  assert.match(p.confirmar.join(), /Ya hay \$500\.00 cobrados antes de esta factura/);
  assert.match(p.avisos.join(), /no tiene serie de pagos/);
});

test('Timbrar PPD en PRODUCCIÓN: la cobranza de la orden queda con método PPD', async () => {
  const db = base(); db.exec("UPDATE series_factura SET entorno = 'prod'; UPDATE clientes_fiscales SET uid_entorno = 'prod'"); orden(db);
  const sim = simulado(respuestas());
  const r = await timbrar(db, 10, { metodo_pago: 'PPD', confirmar: true }, contexto(db, sim, { entorno: 'prod' }));
  assert.equal(r.estado, 'timbrada');
  assert.equal(creados(sim)[0].cuerpo.MetodoPago, 'PPD'); assert.equal(creados(sim)[0].cuerpo.FormaPago, '99');
  const l = db.prepare('SELECT factura_folio, factura_metodo, factura_total_cent FROM leads WHERE id = 10').get();
  assert.deepEqual({ ...l }, { factura_folio: 'F-7', factura_metodo: 'PPD', factura_total_cent: 216384 });
});

test('Complemento: el cuerpo es el de la doc, con parcialidad, saldos e IVA del pago a 6 decimales (enteros)', async () => {
  const db = base(), sim = simulado(respuestas()); await conPpd(db, sim);
  const k = cobro(db, { monto: 100000, referencia: 'SPEI 1234' });
  const p = C.prepararComplemento(db, k, {}, cfg());
  assert.deepEqual(p.errores, []); assert.deepEqual(p.confirmar, []);
  assert.equal(p.resumen.forma_pago, '03', 'transferencia → 03 sin preguntar');
  const b = p.cuerpo;
  assert.equal(b.TipoCfdi, 'pago'); assert.equal(b.UsoCFDI, 'CP01'); assert.equal(b.Moneda, 'XXX'); assert.equal(b.Serie, 5508598); assert.equal(b.EnviarCorreo, false);
  assert.deepEqual(b.Conceptos, [{ ClaveProdServ: '84111506', Cantidad: 1, ClaveUnidad: 'ACT', Descripcion: 'Pago', ValorUnitario: 0, Importe: 0, ObjetoImp: '01' }]);
  const pago = b.Pagos[0], dr = pago.DoctoRelacionado[0];
  assert.deepEqual([pago.FechaPago, pago.FormaDePagoP, pago.MonedaP, pago.TipoCambioP, pago.Monto, pago.NumOperacion], ['2026-11-01T12:00:00', '03', 'MXN', '1', '1000.00', 'SPEI 1234']);
  assert.deepEqual([dr.IdDocumento, dr.Serie, dr.Folio, dr.MonedaDR, dr.EquivalenciaDR, dr.NumParcialidad, dr.ImpSaldoAnt, dr.ImpPagado, dr.ImpSaldoInsoluto, dr.ObjetoImpuesto],
    [UUID_F, 'F', '7', 'MXN', '1', '1', '2163.84', '1000.00', '1163.84', '02']);
  // 1000 / 1.16 = 862.0689655… → 862.068966; IVA = 862.068966 × 0.16 = 137.93103456 → 137.931035
  assert.deepEqual(dr.Impuestos, { Traslados: [{ Base: '862.068966', Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: '0.160000', Importe: '137.931035' }], Retenidos: [] });
  assert.equal(p.resumen.fecha_limite, '2026-12-05');
});

test('Timbrar dos complementos: parcialidades 1 y 2, saldos encadenados, sin tocar la orden; la factura queda pagada', async () => {
  const db = base(), sim = simulado(respuestas()); await conPpd(db, sim);
  const k1 = cobro(db, { fecha: '2026-11-01', monto: 100000 }), k2 = cobro(db, { fecha: '2026-11-02', monto: 116384, metodo: 'efectivo' });
  assert.deepEqual(C.pendientes(db, 'sandbox').map(x => x.cobro_id), [k1, k2]);
  // Las parcialidades van en orden: el segundo no se timbra antes que el primero.
  assert.match(C.prepararComplemento(db, k2, {}, cfg()).errores.join(), /Primero timbra el complemento del pago del 2026-11-01/);
  const r1 = await complemento(db, k1, {}, contexto(db, sim));
  assert.equal(r1.estado, 'timbrada'); assert.equal(r1.factura.tipo_documento, 'pago'); assert.equal(r1.factura.serie, 'PA'); assert.equal(r1.factura.total_cent, 0, 'el CFDI de pago vale 0');
  assert.match(r1.factura.num_order, /^OS-.*-P\d+-[0-9A-F]{6}$/);
  const r2 = await complemento(db, k2, {}, contexto(db, sim));
  assert.equal(r2.estado, 'timbrada');
  const dr2 = creados(sim)[2].cuerpo.Pagos[0].DoctoRelacionado[0];
  assert.deepEqual([dr2.NumParcialidad, dr2.ImpSaldoAnt, dr2.ImpPagado, dr2.ImpSaldoInsoluto], ['2', '1163.84', '1163.84', '0.00']);
  assert.equal(creados(sim)[2].cuerpo.Pagos[0].FormaDePagoP, '01', 'efectivo → 01');
  assert.deepEqual(C.pendientes(db, 'sandbox'), []);
  const o = C.complementosDeOrden(db, 10, 'sandbox');
  assert.equal(o.factura.saldo_insoluto_cent, 0); assert.deepEqual(o.pagos.map(x => [x.amparado, x.complemento.num_parcialidad]), [[true, 1], [true, 2]]);
  assert.equal(db.prepare('SELECT factura_folio FROM leads WHERE id = 10').get().factura_folio, null, 'en sandbox nada toca la orden');
  // Ya amparado: no se timbra otro.
  await assert.rejects(complemento(db, k1, {}, contexto(db, sim)), /ya tiene su complemento PA-1/);
});

test('Lo que NO lleva complemento: ajuste, pago por confirmar, factura PUE, pago mayor que el saldo', async () => {
  const db = base(), sim = simulado(respuestas()); await conPpd(db, sim);
  assert.match(C.prepararComplemento(db, cobro(db, { tipo: 'ajuste', monto: 100 }), {}, cfg()).errores.join(), /ajuste o descuento no es un pago/);
  assert.match(C.prepararComplemento(db, cobro(db, { confirmado: 0, monto: 100 }), {}, cfg()).errores.join(), /todavía no está confirmado/);
  assert.equal(C.pendientes(db, 'sandbox').length, 0, 'ni el ajuste ni el no confirmado quedan pendientes');
  assert.match(C.prepararComplemento(db, cobro(db, { monto: 300000 }), {}, cfg()).errores.join(), /es mayor que lo que falta de la factura F-7/);
  const db2 = base(), sim2 = simulado(respuestas()); orden(db2);
  await timbrar(db2, 10, { metodo_pago: 'PUE', forma_pago: '03', confirmar: true }, contexto(db2, sim2));
  assert.match(C.prepararComplemento(db2, cobro(db2), {}, cfg()).errores.join(), /es PUE .*no lleva complemento/);
  const db3 = base(); orden(db3);
  assert.match(C.prepararComplemento(db3, cobro(db3), {}, cfg()).errores.join(), /no tiene factura a crédito \(PPD\) timbrada/);
});

test('Forma de pago: tarjeta y depósito se preguntan; 99 nunca; una distinta a la sugerida se confirma', async () => {
  const db = base(), sim = simulado(respuestas()); await conPpd(db, sim);
  const kt = cobro(db, { metodo: 'tarjeta' });
  const p = C.prepararComplemento(db, kt, {}, cfg());
  assert.match(p.errores.join(), /tarjeta \(04 crédito o 28 débito\)/); assert.deepEqual(p.resumen.opciones, ['04', '28']);
  assert.deepEqual(C.prepararComplemento(db, kt, { forma_pago: '28' }, cfg()).errores, []);
  assert.match(C.prepararComplemento(db, kt, { forma_pago: '99' }, cfg()).errores.join(), /no se usa en un complemento/);
  const db2 = base(), sim2 = simulado(respuestas()); await conPpd(db2, sim2);
  const kd = cobro(db2, { metodo: 'deposito' });
  assert.match(C.prepararComplemento(db2, kd, {}, cfg()).errores.join(), /depósito \(01 en efectivo o 03 por transferencia\)/);
  const db3 = base(), sim3 = simulado(respuestas()); await conPpd(db3, sim3);
  const k = cobro(db3);
  assert.match(C.prepararComplemento(db3, k, { forma_pago: '01' }, cfg()).confirmar.join(), /se registró como «transferencia» y elegiste la forma 01/);
  await assert.rejects(complemento(db3, k, { forma_pago: '01' }, contexto(db3, sim3)), e => { assert.ok(e.confirmar); return true; });
  assert.equal(creados(sim3).length, 1, 'sin confirmar no se manda nada (solo la factura)');
});

test('Sin serie de pagos no se timbra el complemento', async () => {
  const db = base({ seriePago: false }), sim = simulado(respuestas()); await conPpd(db, sim);
  assert.match(C.prepararComplemento(db, cobro(db), {}, cfg()).errores.join(), /no tiene serie de pagos/);
});

test('Sin respuesta: el complemento queda «timbrando»; el siguiente intento busca por NumOrder y no lo manda otra vez', async () => {
  const db = base(); let n = 0;
  const sim = simulado(respuestas({ 'POST /v4/cfdi40/create': (...a) => (n++ === 0 ? EXITO('F', 7, UUID_F)(...a) : { abortar: true }) }));
  await conPpd(db, sim);
  const k = cobro(db);
  const r = await complemento(db, k, {}, contexto(db, sim));
  assert.equal(r.estado, 'sin_respuesta'); assert.equal(r.factura.estatus, 'timbrando');
  const comp = r.factura;
  assert.match(C.prepararComplemento(db, cobro(db, { fecha: '2026-11-03', monto: 100 }), {}, cfg()).errores.join(), /se quedó sin respuesta/);
  // Pasado el intento: factura.com sí lo tiene (se encuentra por NumOrder).
  const sim2 = simulado(respuestas({ ['GET /v4/cfdi/order/' + comp.num_order]: () => ({ json: { status: 'success', data: { NumOrder: comp.num_order, UID: 'CFDI-UID-PA1', UUID: UUID_P1, Folio: 'PA 1', Status: 'enviada' } } }) }));
  const r2 = await complemento(db, k, {}, contexto(db, sim2));
  assert.equal(r2.estado, 'timbrada'); assert.equal(r2.factura.folio, '1'); assert.equal(creados(sim2).length, 0, 'no se volvió a mandar');
});

test('Candados: factura con complementos no se cancela; complemento solo con 02; cancelado, el pago vuelve a pendiente y se timbra otro', async () => {
  const db = base(), sim = simulado(respuestas()); const inv = await conPpd(db, sim);
  const k = cobro(db);
  const r = await complemento(db, k, {}, contexto(db, sim));
  const ctx = cfg();
  assert.throws(() => revisar(db, T.leer(db, inv.id), { motivo: '02' }, ctx), /tiene un complemento de pago vigente \(PA-1\)/);
  assert.throws(() => revisar(db, T.leer(db, r.factura.id), { motivo: '01' }, ctx), /primero se timbra el complemento que lo corrige/);
  assert.throws(() => revisar(db, T.leer(db, r.factura.id), { motivo: '03' }, ctx), /motivo 01 \(se corrige con otro\) o con el 02/);
  assert.doesNotThrow(() => revisar(db, T.leer(db, r.factura.id), { motivo: '02' }, ctx));
  assert.equal(C.complementoQueBloquea(db, k), null, 'un complemento de PRUEBA no estorba al cobro real');
  db.prepare("UPDATE facturas SET entorno = 'prod' WHERE id = ?").run(r.factura.id);
  assert.equal(C.complementoQueBloquea(db, k).id, r.factura.id, 'uno real sí: el cobro no se cancela mientras tenga complemento');
  db.prepare("UPDATE facturas SET entorno = 'sandbox' WHERE id = ?").run(r.factura.id);
  // El SAT confirma la cancelación del complemento: el pago queda pendiente otra vez y se timbra uno nuevo (otro NumOrder, parcialidad 1 otra vez).
  db.prepare("UPDATE facturas SET estatus = 'cancelada', motivo_cancelacion = '02' WHERE id = ?").run(r.factura.id);
  assert.equal(C.complementoQueBloquea(db, k), null);
  assert.deepEqual(C.pendientes(db, 'sandbox').map(x => x.cobro_id), [k]);
  assert.doesNotThrow(() => revisar(db, T.leer(db, inv.id), { motivo: '02' }, ctx), 'sin complementos vigentes la factura ya se puede cancelar');
  const r2 = await complemento(db, k, {}, contexto(db, sim));
  assert.equal(r2.estado, 'timbrada'); assert.notEqual(r2.factura.num_order, r.factura.num_order);
  assert.equal(creados(sim)[2].cuerpo.Pagos[0].DoctoRelacionado[0].NumParcialidad, '1');
  assert.equal(db.prepare('SELECT complemento_id FROM factura_cobros WHERE cobro_id = ?').get(k).complemento_id, r2.factura.id);
});

test('PRODUCCIÓN: el complemento deja su línea en la bitácora de la orden y no toca el folio de la factura', async () => {
  const db = base(); db.exec("UPDATE series_factura SET entorno = 'prod'; UPDATE clientes_fiscales SET uid_entorno = 'prod'");
  const sim = simulado(respuestas()); orden(db);
  await timbrar(db, 10, { metodo_pago: 'PPD', confirmar: true }, contexto(db, sim, { entorno: 'prod' }));
  const k = cobro(db);
  const r = await complemento(db, k, {}, contexto(db, sim, { entorno: 'prod' }));
  assert.equal(r.estado, 'timbrada'); assert.equal(creados(sim)[1].cuerpo.EnviarCorreo, true);
  assert.deepEqual({ ...db.prepare('SELECT factura_folio, factura_metodo, factura_total_cent FROM leads WHERE id = 10').get() }, { factura_folio: 'F-7', factura_metodo: 'PPD', factura_total_cent: 216384 });
  assert.match(db.prepare("SELECT texto FROM historial ORDER BY id DESC LIMIT 1").get().texto, /^Complemento de pago PA-1 timbrado \(pago de \$1,000\.00 del 2026-11-01\)/);
});

test('Demo: el complemento se simula sin llamar a factura.com', async () => {
  const db = base(); orden(db);
  const sim = simulado({});
  await timbrar(db, 10, { metodo_pago: 'PPD', confirmar: true }, contexto(db, sim, { demo: true }));
  const r = await complemento(db, cobro(db), {}, contexto(db, sim, { demo: true }));
  assert.equal(r.estado, 'timbrada'); assert.equal(r.factura.entorno, 'demo'); assert.equal(sim.llamadas.length, 0);
});

test('Revisión fiscal: se cancela del último complemento hacia atrás; con uno en cancelación no se timbran otros; el cobro cancelado a medio camino no se manda', async () => {
  const db = base(), sim = simulado(respuestas()); await conPpd(db, sim);
  const k1 = cobro(db, { fecha: '2026-11-01', monto: 100000 }), k2 = cobro(db, { fecha: '2026-11-02', monto: 50000 });
  const r1 = await complemento(db, k1, {}, contexto(db, sim)), r2 = await complemento(db, k2, {}, contexto(db, sim));
  assert.throws(() => revisar(db, T.leer(db, r1.factura.id), { motivo: '02' }, cfg()), /ya hay otro de la misma factura \(PA-2\)/);
  assert.doesNotThrow(() => revisar(db, T.leer(db, r2.factura.id), { motivo: '02' }, cfg()), 'el último sí se cancela');
  db.prepare("UPDATE facturas SET estatus = 'cancelacion_solicitada' WHERE id = ?").run(r2.factura.id);
  const k3 = cobro(db, { fecha: '2026-11-03', monto: 100 });
  assert.match(C.prepararComplemento(db, k3, {}, cfg()).errores.join(), /PA-2 de esta factura está en proceso de cancelación/);
  // Cobro cancelado mientras se sincronizaba el cliente: no se manda nada.
  const db2 = base(); let k;
  const sim2 = simulado(respuestas({ 'POST /v1/clients/CLI-UID-1/update': () => { if (k) db2.prepare('UPDATE cobros SET cancelado = 1 WHERE id = ?').run(k); return { json: { status: 'success', Data: { UID: 'CLI-UID-1' } } }; } }));
  await conPpd(db2, sim2); k = cobro(db2);
  await assert.rejects(complemento(db2, k, {}, contexto(db2, sim2)), /se canceló mientras se preparaba/);
  assert.equal(creados(sim2).length, 1, 'solo la factura: el complemento no se mandó');
});

test('Corregir un complemento: el nuevo va relacionado (04) con la misma parcialidad y saldos, toma su lugar y el anterior se cancela con el 01', async () => {
  const UUID_P3 = 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C53';
  const cfdis = [EXITO('F', 7, UUID_F), EXITO('PA', 1, UUID_P1), EXITO('PA', 2, UUID_P2), EXITO('PA', 3, UUID_P3)]; let n = 0;
  const db = base(), sim = simulado(respuestas({ 'POST /v4/cfdi40/create': (...a) => cfdis[n++](...a),
    ['GET /v4/cfdi40/' + UUID_P3 + '/xml']: () => ({ tipo: 'application/xml', texto: xmlDe('PA', '0', '0') }), ['GET /v4/cfdi40/' + UUID_P3 + '/pdf']: () => ({ tipo: 'application/pdf', buffer: PDF }) }));
  const inv = await conPpd(db, sim);
  const k1 = cobro(db, { fecha: '2026-11-01', monto: 100000 }), k2 = cobro(db, { fecha: '2026-11-02', monto: 50000 });
  const r1 = await complemento(db, k1, {}, contexto(db, sim)), r2 = await complemento(db, k2, {}, contexto(db, sim));
  // Sin decir qué complemento se corrige, el pago ya está amparado; corrigiendo el PA-1 (aunque ya exista el PA-2) sí se puede.
  assert.match(C.prepararComplemento(db, k1, {}, cfg()).errores.join(), /ya tiene su complemento PA-1/);
  assert.match(C.prepararComplemento(db, k1, { sustituye_a: r2.factura.id }, cfg()).errores.join(), /no es el vigente de este pago/);
  const p = C.prepararComplemento(db, k1, { sustituye_a: r1.factura.id, forma_pago: '01' }, cfg());
  assert.deepEqual(p.errores, []); assert.equal(p.resumen.sustituye.id, r1.factura.id); assert.equal(p.confirmar.length, 1, 'otra forma que la sugerida se confirma');
  await assert.rejects(complemento(db, k1, { sustituye_a: r1.factura.id, forma_pago: '01' }, contexto(db, sim)), /¿Es correcto\?/);
  const r3 = await complemento(db, k1, { sustituye_a: r1.factura.id, forma_pago: '01', confirmar: true }, contexto(db, sim));
  assert.equal(r3.estado, 'timbrada'); assert.equal(r3.factura.sustituye_a, r1.factura.id); assert.notEqual(r3.factura.num_order, r1.factura.num_order);
  const c = creados(sim)[3].cuerpo, dr = c.Pagos[0].DoctoRelacionado[0];
  assert.deepEqual(c.CfdiRelacionados, { TipoRelacion: '04', UUID: [UUID_P1] });
  assert.equal(c.Pagos[0].FormaDePagoP, '01');
  assert.deepEqual([dr.NumParcialidad, dr.ImpSaldoAnt, dr.ImpPagado, dr.ImpSaldoInsoluto], ['1', '2163.84', '1000.00', '1163.84'], 'misma parcialidad y saldos que el PA-1');
  // El pago ahora apunta a la corrección; el PA-1 sigue vigente hasta cancelarlo con el 01 (el PA-2 posterior no estorba: los saldos no cambian).
  assert.equal(db.prepare('SELECT complemento_id FROM factura_cobros WHERE cobro_id = ?').get(k1).complemento_id, r3.factura.id);
  assert.deepEqual(C.pendientes(db, 'sandbox'), []);
  const o = C.complementosDeOrden(db, 10, 'sandbox');
  assert.equal(o.pagos[0].corrige_a.id, r1.factura.id); assert.equal(o.factura.saldo_insoluto_cent, 216384 - 150000);
  assert.match(C.prepararComplemento(db, k1, { sustituye_a: r1.factura.id }, cfg()).errores.join(), /Ya se timbró el complemento que corrige al PA-1 \(PA-3\)/);
  assert.throws(() => revisar(db, T.leer(db, r1.factura.id), { motivo: '02' }, cfg()), /ya tiene una sustituta timbrada \(PA-3\)/);
  assert.equal(revisar(db, T.leer(db, r1.factura.id), { motivo: '01' }, cfg()).sustituta.id, r3.factura.id);
  // Revisión fiscal: la corrección no se cancela (ni se corrige) mientras el anterior siga vigente; si no, el pago quedaría con dos complementos.
  assert.throws(() => revisar(db, T.leer(db, r3.factura.id), { motivo: '02' }, cfg()), /corrige al PA-1, que sigue vigente/);
  assert.throws(() => revisar(db, T.leer(db, r3.factura.id), { motivo: '01' }, cfg()), /corrige al PA-1, que sigue vigente/);
  assert.match(C.prepararComplemento(db, k1, { sustituye_a: r3.factura.id }, cfg()).errores.join(), /El PA-3 corrige al PA-1, que sigue vigente/);
  // Aunque la corrección quedara cancelada a la mala, el anterior vigente sigue amparando el pago: no se timbra un tercero.
  db.prepare("UPDATE facturas SET estatus = 'cancelada' WHERE id = ?").run(r3.factura.id);
  assert.match(C.prepararComplemento(db, k1, {}, cfg()).errores.join(), /ya tiene su complemento PA-1 vigente/);
  assert.equal(C.complementosVigentes(db, inv.id).map(x => x.serie + '-' + x.folio).join(), 'PA-1,PA-2');
  db.prepare("UPDATE facturas SET estatus = 'timbrada' WHERE id = ?").run(r3.factura.id);
  assert.throws(() => revisar(db, T.leer(db, inv.id), { motivo: '02' }, cfg()), /3 complementos de pago vigentes \(PA-1, PA-2, PA-3\)/, 'el anterior todavía cuenta ante el SAT');
  db.prepare("UPDATE facturas SET entorno = 'prod' WHERE id = ?").run(r1.factura.id);
  assert.equal(C.complementoQueBloquea(db, k1).id, r1.factura.id, 'el cobro no se cancela mientras el anterior siga vigente');
  db.prepare("UPDATE facturas SET entorno = 'sandbox', estatus = 'cancelada', motivo_cancelacion = '01' WHERE id = ?").run(r1.factura.id);
  assert.equal(C.complementosDeOrden(db, 10, 'sandbox').pagos[0].corrige_a, null);
  assert.equal(C.complementosVigentes(db, inv.id).length, 2);
  // Demo: la corrección simulada también toma el lugar del anterior.
  const dbD = base(), simD = simulado({}); orden(dbD);
  await timbrar(dbD, 10, { metodo_pago: 'PPD', confirmar: true }, contexto(dbD, simD, { demo: true }));
  const kD = cobro(dbD), d1 = await complemento(dbD, kD, {}, contexto(dbD, simD, { demo: true }));
  const d2 = await complemento(dbD, kD, { sustituye_a: d1.factura.id }, contexto(dbD, simD, { demo: true }));
  assert.equal(d2.estado, 'timbrada'); assert.equal(dbD.prepare('SELECT complemento_id FROM factura_cobros WHERE cobro_id = ?').get(kD).complemento_id, d2.factura.id);
  assert.equal(simD.llamadas.length, 0);
});

test('Aviso huérfano: una corrección que nunca se timbró (pendiente con error) se cierra sola al cancelarse el complemento que iba a sustituir', async () => {
  const { cancelar } = require('../server/facturacion-cancelacion');
  const db = base(); orden(db); const sim = simulado({});
  const ctx = contexto(db, sim, { demo: true });
  await timbrar(db, 10, { metodo_pago: 'PPD', confirmar: true }, ctx);
  const k = cobro(db), a = (await complemento(db, k, {}, ctx)).factura;
  // La corrección falló antes de llegar a factura.com: queda «pendiente» con su error.
  const b = Number(db.prepare("INSERT INTO facturas (lead_id, sucursal_id, tipo_documento, estatus, num_order, entorno, sustituye_a, error_json) VALUES (10, 1, 'pago', 'pendiente', 'OS-10-P99-AAAAAA', 'demo', ?, '{\"mensaje\":\"x\"}')").run(a.id).lastInsertRowid);
  const r = await cancelar(db, T.leer(db, a.id), { motivo: '02' }, ctx);
  assert.equal(r.estado, 'cancelada');
  assert.equal(T.leer(db, b).estatus, 'cancelada'); assert.match(T.leer(db, b).error_json, /descartado/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM facturas WHERE estatus = 'pendiente' AND error_json IS NOT NULL").get().n, 0, 'ya no hay nada pendiente que avisar en Inicio');
  assert.deepEqual(C.pendientes(db, 'demo').map(x => x.cobro_id), [k], 'el pago sí vuelve a «complemento pendiente»');
});

test('Fecha del pago: a mediodía, o la hora actual si el pago es de hoy y todavía no es mediodía (nunca en el futuro)', () => {
  assert.equal(C.fechaPago('2026-10-01'), '2026-10-01T12:00:00');
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date());
  assert.ok(C.fechaPago(hoy) <= `${hoy}T12:00:00` && C.fechaPago(hoy).startsWith(hoy));
});

test('Fecha límite: día 5 del mes siguiente (también de diciembre a enero)', () => {
  assert.equal(C.fechaLimite('2026-11-30'), '2026-12-05');
  assert.equal(C.fechaLimite('2026-12-15'), '2027-01-05');
});
