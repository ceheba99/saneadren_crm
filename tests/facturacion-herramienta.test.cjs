// Facturación CFDI 4.0 · F2 (2026-10-27): la herramienta de terminal (herramientas/facturacion-sandbox.js). Se prueba SIN llaves reales y sin red:
// los casos que llegarían a conectarse con factura.com solo se prueban hasta el punto en que la herramienta se detiene antes (llaves faltantes, producción).
// Uso: node --test tests/facturacion-herramienta.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), os = require('os'), path = require('path');
const crearTablas = require('../server/facturacion-db');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-fact-cli-')), DB = path.join(dir, 'cli.db');
const db = new DatabaseSync(DB);
db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY); CREATE TABLE clientes (id INTEGER PRIMARY KEY); CREATE TABLE leads (id INTEGER PRIMARY KEY); CREATE TABLE cobros (id INTEGER PRIMARY KEY);
  CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT); CREATE TABLE sucursales (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1);
  INSERT INTO sucursales (nombre, clave) VALUES ('Querétaro', 'QRO'), ('Ciudad de México', 'CDMX');`);
crearTablas(db); db.close();
test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const FALSA = 'LLAVE-FALSA-NO-DEBE-SALIR-123', FALSA2 = 'SECRETA-FALSA-NO-DEBE-SALIR-456';
const correr = (args, env = {}, base = DB) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'herramientas', 'facturacion-sandbox.js'), ...args],
    { env: { PATH: process.env.PATH, DB_PATH: base, ...env }, encoding: 'utf8', timeout: 20000 });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};
const PROD = { FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: FALSA, FACTURA_PROD_SECRET_KEY: FALSA2, FACTURA_PROD_EMISOR_REGIMEN: '626', FACTURA_PROD_EMISOR_CP: '76087' };

test('Herramienta: sin comando explica los comandos', () => { const r = correr([]); assert.equal(r.codigo, 0); assert.match(r.salida, /Comandos: probar/); });
test('Herramienta: «probar» sin llaves dice qué falta y no se conecta', () => {
  const r = correr(['probar']); assert.equal(r.codigo, 1); assert.match(r.salida, /sandbox \(pruebas\)/); assert.match(r.salida, /FACTURA_SANDBOX_API_KEY/);
});
test('Herramienta: en PRODUCCIÓN los comandos que cambian datos se niegan (y jamás se muestran las llaves)', () => {
  for (const args of [['crear-serie', 'A', 'factura'], ['cliente', '1'], ['vincular', '1', 'uid-x']]) {
    const r = correr(args, PROD); assert.equal(r.codigo, 1, args.join(' ')); assert.match(r.salida, /PRODUCCIÓN/); assert.match(r.salida, /--si-es-produccion/);
    assert.ok(!r.salida.includes(FALSA) && !r.salida.includes(FALSA2), 'la salida no debe llevar las llaves');
  }
});
test('Herramienta: «sucursal-cp» guarda el CP de expedición y valida', () => {
  let r = correr(['sucursal-cp', 'cdmx', '09410']); assert.equal(r.codigo, 0, r.salida); assert.match(r.salida, /CDMX: 09410/);
  const d = new DatabaseSync(DB); assert.equal(d.prepare("SELECT cp_expedicion FROM sucursales WHERE clave = 'CDMX'").get().cp_expedicion, '09410', 'conserva el cero'); assert.equal(d.prepare("SELECT cp_expedicion FROM sucursales WHERE clave = 'QRO'").get().cp_expedicion, null); d.close();
  for (const args of [['sucursal-cp', 'CDMX', '9410'], ['sucursal-cp', 'CDMX', '0941A'], ['sucursal-cp', 'CDMX'], ['sucursal-cp']]) { r = correr(args); assert.equal(r.codigo, 1, args.join(' ')); assert.match(r.salida, /Uso: sucursal-cp/); }
  r = correr(['sucursal-cp', 'ZZZ', '09410']); assert.equal(r.codigo, 1); assert.match(r.salida, /No hay una sucursal con la clave «ZZZ»/);
});
test('Herramienta: faltan argumentos → muestra el uso (sin llamar a la API)', () => {
  for (const [args, uso] of [[['asignar-serie', 'QRO'], /Uso: asignar-serie/], [['crear-serie'], /Uso: crear-serie/], [['cliente'], /Uso: cliente/], [['vincular', '1'], /Uso: vincular/]]) {
    const r = correr(args); assert.equal(r.codigo, 1, args.join(' ')); assert.match(r.salida, uso);
  }
});
test('Herramienta: sin las tablas de facturación pide arrancar el sistema', () => {
  const vacia = path.join(dir, 'vacia.db'); new DatabaseSync(vacia).close();
  const r = correr(['catalogos'], { FACTURA_SANDBOX_API_KEY: FALSA, FACTURA_SANDBOX_SECRET_KEY: FALSA2 }, vacia); assert.equal(r.codigo, 1); assert.match(r.salida, /todavía no tiene las tablas de facturación/);
  assert.ok(!r.salida.includes(FALSA));
});
