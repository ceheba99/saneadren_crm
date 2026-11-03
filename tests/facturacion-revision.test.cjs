// Facturación · F7 (2026-11-03): pruebas de la revisión «¿lista para producción?». Sin red. Revisa: que marque lo que falta (llaves de producción, series,
// claves del SAT, catálogos, respaldo), que con el servidor en pruebas una serie de pruebas sea solo aviso, que en producción sea falta, y que NUNCA salga una llave.
// Uso: node --test tests/facturacion-revision.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const Database = require('../server/sqlite');
const crearTablas = require('../server/facturacion-db');
const { revisarProduccion } = require('../server/facturacion-revision');

const LLAVE = 'LLAVE-PROD-QUE-NO-DEBE-SALIR-1', SECRETA = 'SECRETA-PROD-QUE-NO-DEBE-SALIR-2';
const PROD_OK = { FACTURA_PROD_API_KEY: LLAVE, FACTURA_PROD_SECRET_KEY: SECRETA, FACTURA_PROD_EMISOR_REGIMEN: '626', FACTURA_PROD_EMISOR_CP: '76087' };
function base() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT);
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, empresa_contacto TEXT, rfc TEXT, correo TEXT); INSERT INTO clientes (id, nombre) VALUES (1, 'Acme');
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1); INSERT INTO sucursales (id, nombre, clave) VALUES (1, 'Querétaro', 'QRO');
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0); INSERT INTO catalogo_servicios (id, nombre) VALUES (1, 'Desazolve');
    CREATE TABLE leads (id INTEGER PRIMARY KEY);`);
  crearTablas(db);
  return db;
}
function completo(db, entornoSerie = 'prod') {
  db.exec(`UPDATE catalogo_servicios SET clave_prod_serv = '76121600', clave_unidad = 'E48'; UPDATE sucursales SET cp_expedicion = '76087';
    INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, entorno) VALUES (1, 'factura', 'F', '1', '${entornoSerie}'), (1, 'pago', 'PA', '2', '${entornoSerie}');`);
  for (const c of ['RegimenFiscal', 'UsoCfdi', 'FormaPago', 'ClaveUnidad', 'ClaveProductServ', 'MetodoPago', 'Moneda', 'Impuesto', 'ObjetoImp', 'Relacion', 'Exportacion'])
    db.prepare("INSERT INTO sat_catalogos (catalogo, clave, nombre) VALUES (?, 'X', 'x')").run(c);
}
const nivel = (r, id) => r.items.find(i => i.id === id)?.nivel;

test('Base vacía y sin llaves: faltan llaves, series, claves y catálogos; nunca está «listo»', () => {
  const r = revisarProduccion(base(), {});
  assert.equal(r.listo, false); assert.equal(r.entorno, 'sandbox');
  assert.equal(nivel(r, 'llaves_prod'), 'falta'); assert.equal(nivel(r, 'claves_sat'), 'falta'); assert.equal(nivel(r, 'catalogos'), 'falta'); assert.equal(nivel(r, 'sucursal_1'), 'falta');
  assert.match(r.items.find(i => i.id === 'llaves_prod').detalle, /FACTURA_PROD_API_KEY, FACTURA_PROD_SECRET_KEY, FACTURA_PROD_EMISOR_REGIMEN, FACTURA_PROD_EMISOR_CP/);
});

test('En pruebas con todo listo salvo las series de producción: está listo y las series son aviso; en producción esas series sí faltan', () => {
  const db = base(); completo(db, 'sandbox');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-')); fs.mkdirSync(path.join(dir, 'respaldos'));
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date());
  fs.writeFileSync(path.join(dir, 'respaldos', `saneadren-${hoy}.db`), 'x');
  const env = { ...PROD_OK, FACTURA_ENV: 'sandbox', DB_PATH: path.join(dir, 'saneadren.db') };
  const r = revisarProduccion(db, env);
  assert.equal(r.listo, true, JSON.stringify(r.items.filter(i => i.nivel === 'falta')));
  assert.equal(nivel(r, 'sucursal_1'), 'aviso'); assert.equal(nivel(r, 'respaldo'), 'ok'); assert.equal(nivel(r, 'llaves_prod'), 'ok');
  assert.ok(['csd_prod', 'claves_contador', 'respaldo_fuera', 'primera_real'].every(id => nivel(r, id) === 'aviso'), 'lo que no se puede comprobar va siempre como aviso');
  const p = revisarProduccion(db, { ...env, FACTURA_ENV: 'prod' });
  assert.equal(p.entorno, 'prod'); assert.equal(p.listo, false); assert.equal(nivel(p, 'sucursal_1'), 'falta'); assert.equal(nivel(p, 'entorno'), 'ok');
  db.exec("UPDATE series_factura SET entorno = 'prod'");
  assert.equal(revisarProduccion(db, { ...env, FACTURA_ENV: 'prod' }).listo, true);
});

test('Respaldo: sin carpeta o con una copia vieja falla; régimen distinto del acordado es aviso; clientes de pruebas se avisan', () => {
  const db = base(); completo(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-')); const env = { ...PROD_OK, DB_PATH: path.join(dir, 'saneadren.db') };
  assert.equal(nivel(revisarProduccion(db, env), 'respaldo'), 'falta');
  fs.mkdirSync(path.join(dir, 'respaldos')); fs.writeFileSync(path.join(dir, 'respaldos', 'saneadren-2020-01-01.db'), 'x');
  assert.match(revisarProduccion(db, env).items.find(i => i.id === 'respaldo').detalle, /más de 2 días/);
  assert.equal(revisarProduccion(db, { ...env, FACTURA_PROD_EMISOR_REGIMEN: '601' }).items.find(i => i.id === 'regimen')?.nivel, 'aviso');
  db.exec("INSERT INTO clientes_fiscales (cliente_id, rfc, razon_social, uid_facturacom, uid_entorno) VALUES (1, 'EKU9003173C9', 'X', 'U1', 'sandbox')");
  assert.match(revisarProduccion(db, env).items.find(i => i.id === 'clientes_uid').titulo, /1 cliente fiscal ligado a la cuenta de pruebas/);
});

test('Nunca sale una llave en el resultado', () => {
  const db = base(); completo(db);
  const t = JSON.stringify(revisarProduccion(db, { ...PROD_OK, FACTURA_ENV: 'prod', FACTURA_SANDBOX_API_KEY: 'OTRA-LLAVE-SECRETA-9' }));
  for (const k of [LLAVE, SECRETA, 'OTRA-LLAVE-SECRETA-9']) assert.ok(!t.includes(k), 'no debe salir ' + k);
});
