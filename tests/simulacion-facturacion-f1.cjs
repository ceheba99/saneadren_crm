// FACTURACIÓN · F1 (2026-10-27): la base de datos. Arranca el servidor con una base nueva y comprueba que las tablas y columnas
// existen; que el candado de «una factura vigente por orden» deja cancelar y sustituir; que los datos mal formados se rechazan;
// que arrancar OTRA VEZ sobre la misma base (con datos) no cambia nada ni falla (idempotente); y que lo que ya existía sigue igual.
// Uso: node tests/simulacion-facturacion-f1.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-facturacion-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'facturacion@saneadren.com.mx', password: 'Factura-' + Math.random().toString(36).slice(2) + '-5Q' };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
let salida = '';
async function arrancar() {
  const puerto = String(9500 + Math.floor(Math.random() * 300));
  salida = '';
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: puerto, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', FACTURA_ENV: '', FACTURA_SANDBOX_API_KEY: '', FACTURA_SANDBOX_SECRET_KEY: '' } });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 120 && !/corriendo/.test(salida); i++) await espera(150);
  revisa(/corriendo/.test(salida), 'el servidor arranca');
  return srv;
}
async function parar(srv) { srv.kill(); await espera(700); }
const abrir = () => { const db = new DatabaseSync(DB); db.exec('PRAGMA foreign_keys = ON'); return db; };
const falla = (db, sql, args = []) => { try { db.prepare(sql).run(...args); return null; } catch (e) { return e.message; } };
const NUEVAS = ['clientes_fiscales', 'facturas', 'facturas_log', 'factura_ventas', 'factura_cobros', 'series_factura', 'sat_catalogos'];

(async () => {
  console.log('1. Primer arranque');
  let srv = await arrancar(); await parar(srv);
  let db = abrir();
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  revisa(NUEVAS.every(t => tablas.includes(t)), 'se crean las 7 tablas nuevas', NUEVAS.filter(t => !tablas.includes(t)));
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  revisa(['clave_prod_serv', 'clave_unidad', 'nombre_unidad', 'objeto_imp', 'tasa_iva'].every(c => cols('catalogo_servicios').includes(c)), 'el catálogo de servicios gana sus 5 columnas (claves del SAT, ObjetoImp y tasa de IVA)');
  revisa(cols('sucursales').includes('cp_expedicion'), 'las sucursales ganan el CP de expedición');
  revisa(['id', 'nombre', 'activo', 'orden'].every(c => cols('catalogo_servicios').includes(c)) && ['id', 'nombre', 'clave', 'direccion', 'telefono', 'activo', 'created_at'].every(c => cols('sucursales').includes(c)), 'no se quitó ni se renombró ninguna columna que ya existía');
  const sv = db.prepare('SELECT * FROM catalogo_servicios LIMIT 1').get();
  revisa(sv && sv.objeto_imp === '02' && sv.tasa_iva === 16 && sv.clave_prod_serv === null && sv.clave_unidad === null, 'los servicios existentes quedan con ObjetoImp 02, IVA 16 % y SIN claves del SAT (no se inventan)', sv);
  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
  revisa(['idx_facturas_vigente_por_orden', 'idx_facturas_cfdi_uid', 'idx_facturas_uuid', 'idx_clientes_fiscales_uid'].every(i => indices.includes(i)), 'existen los candados (índices únicos parciales)');

  console.log('2. Candados y validaciones de la base');
  db.prepare("INSERT INTO clientes (telefono, telefono_normalizado, nombre) VALUES ('442 111 2233', '4421112233', 'Cliente de prueba')").run();
  const cliente = db.prepare('SELECT id FROM clientes').get().id;
  db.prepare("INSERT INTO leads (cliente_id, telefono, telefono_normalizado, estatus) VALUES (?, '442 111 2233', '4421112233', 'ganado')").run(cliente);
  db.prepare("INSERT INTO leads (cliente_id, telefono, telefono_normalizado, estatus) VALUES (?, '442 111 2233', '4421112233', 'ganado')").run(cliente);
  const [L1, L2] = db.prepare('SELECT id FROM leads ORDER BY id').all().map(r => r.id);
  const suc = db.prepare('SELECT id FROM sucursales ORDER BY id').get().id;
  const factura = (lead, estatus) => falla(db, 'INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order) VALUES (?, ?, ?, ?)', [lead, suc, estatus, 'OS-' + lead + '-' + Math.random().toString(36).slice(2, 6)]);
  revisa(factura(L1, 'timbrada') === null, 'una orden puede tener una factura vigente');
  revisa(/UNIQUE/.test(factura(L1, 'pendiente') || ''), 'una SEGUNDA vigente de la misma orden se rechaza (evita duplicar la factura)');
  revisa(/UNIQUE/.test(factura(L1, 'timbrando') || '') && /UNIQUE/.test(factura(L1, 'borrador_error') || '') && /UNIQUE/.test(factura(L1, 'cancelacion_solicitada') || ''), 'tampoco con «timbrando», «borrador con error» ni «cancelación solicitada» (siguen ocupando el lugar)');
  revisa(factura(L1, 'cancelada') === null && factura(L1, 'cancelada') === null, 'las canceladas no estorban (puede haber varias)');
  db.prepare("UPDATE facturas SET estatus = 'cancelada' WHERE lead_id = ? AND estatus = 'timbrada'").run(L1);
  revisa(factura(L1, 'timbrada') === null, 'cancelada la anterior, se puede timbrar la sustituta de la misma orden');
  revisa(factura(L2, 'pendiente') === null, 'otra orden no se ve afectada');
  revisa(/CHECK/.test(factura(L2, 'inventado') || ''), 'un estatus inventado se rechaza');
  revisa(/NOT NULL|UNIQUE|FOREIGN/.test(falla(db, "INSERT INTO facturas (lead_id, sucursal_id, estatus) VALUES (?, ?, 'cancelada')", [L2, suc]) || ''), 'toda factura lleva su NumOrder');
  revisa(/NOT NULL/.test(falla(db, "INSERT INTO facturas (lead_id, estatus, num_order) VALUES (?, 'cancelada', 'x')", [L2]) || ''), 'toda factura lleva su sucursal (de ahí salen la serie y el CP de expedición)');
  revisa(/FOREIGN/.test(falla(db, "INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order) VALUES (99999, ?, 'cancelada', 'x')", [suc]) || ''), 'una factura de una orden que no existe se rechaza');
  revisa(/FOREIGN/.test(falla(db, 'DELETE FROM leads WHERE id = ?', [L1]) || ''), 'no se puede borrar una orden que ya tiene facturas');
  db.prepare("UPDATE facturas SET cfdi_uid = 'uid-1', uuid = 'UUID-1' WHERE lead_id = ? AND estatus = 'timbrada'").run(L1);
  revisa(/UNIQUE/.test(falla(db, "UPDATE facturas SET cfdi_uid = 'uid-1' WHERE lead_id = ? AND estatus = 'pendiente'", [L2]) || ''), 'el UID de factura.com no se repite');
  revisa(/UNIQUE/.test(falla(db, "UPDATE facturas SET uuid = 'UUID-1' WHERE lead_id = ? AND estatus = 'pendiente'", [L2]) || ''), 'el UUID del SAT no se repite');
  revisa(/CHECK/.test(falla(db, "UPDATE facturas SET motivo_cancelacion = '05' WHERE lead_id = ?", [L2]) || '') && falla(db, "UPDATE facturas SET motivo_cancelacion = '02' WHERE lead_id = ?", [L2]) === null, 'el motivo de cancelación solo admite 01 a 04');
  revisa(/CHECK/.test(falla(db, "UPDATE facturas SET iva_cent = 12.5 WHERE lead_id = ?", [L2]) || '') && /CHECK/.test(falla(db, "UPDATE facturas SET total_cent = -1 WHERE lead_id = ?", [L2]) || ''), 'los importes son enteros y no negativos');
  revisa(/CHECK/.test(falla(db, "UPDATE facturas SET metodo_pago = 'XXX' WHERE lead_id = ?", [L2]) || ''), 'el método de pago solo admite PUE o PPD');

  const fiscal = (rfc, cp = '', regimen = '', extra = '') => falla(db, 'INSERT INTO clientes_fiscales (cliente_id, rfc, cp, regimen) VALUES (?, ?, ?, ?)' + extra, [cliente, rfc, cp, regimen]);
  revisa(fiscal('ABC010203AB1') === null, 'datos fiscales incompletos se guardan (solo el RFC es obligatorio); el timbrado es quien exige lo demás');
  revisa(/UNIQUE/.test(fiscal('ABC010203AB1') || ''), 'el mismo RFC no se repite en un cliente');
  revisa(fiscal('GOMC800101AB1', '76087', '626') === null, 'pero un cliente puede tener varias razones sociales');
  revisa(/CHECK/.test(fiscal('ABC') || '') && /CHECK/.test(fiscal('XYZ010203AB1', '1234') || '') && /CHECK/.test(fiscal('XYZ010203AB2', '7608A') || '') && /CHECK/.test(fiscal('XYZ010203AB3', '76087', '62') || ''), 'RFC corto, CP de 4 o con letras y régimen de 2 dígitos se rechazan');
  db.prepare("UPDATE clientes_fiscales SET uid_facturacom = 'cli-1' WHERE rfc = 'ABC010203AB1'").run();
  revisa(/UNIQUE/.test(falla(db, "UPDATE clientes_fiscales SET uid_facturacom = 'cli-1' WHERE rfc = 'GOMC800101AB1'") || ''), 'el UID del cliente en factura.com no se repite');
  revisa(falla(db, "UPDATE sucursales SET cp_expedicion = '76087' WHERE id = ?", [suc]) === null && /CHECK/.test(falla(db, "UPDATE sucursales SET cp_expedicion = '760' WHERE id = ?", [suc]) || ''), 'el CP de expedición de la sucursal: 5 dígitos o nada');
  revisa(falla(db, "INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid) VALUES (?, 'factura', 'Q', 'serie-1')", [suc]) === null && /UNIQUE/.test(falla(db, "INSERT INTO series_factura (sucursal_id, tipo_documento, serie) VALUES (?, 'factura', 'Z')", [suc]) || '') && falla(db, "INSERT INTO series_factura (sucursal_id, tipo_documento, serie) VALUES (?, 'pago', 'P')", [suc]) === null, 'una serie por sucursal y tipo de documento (factura y pago)');
  const servicio = db.prepare('SELECT id FROM catalogo_servicios ORDER BY id').get().id;
  revisa(/CHECK/.test(falla(db, "UPDATE catalogo_servicios SET objeto_imp = '05' WHERE id = ?", [servicio]) || '') && falla(db, "UPDATE catalogo_servicios SET objeto_imp = '01', clave_prod_serv = '72102900', clave_unidad = 'E48' WHERE id = ?", [servicio]) === null, 'ObjetoImp solo admite 01 a 04 (las claves se capturan; aquí solo se prueba que caben)');
  revisa(falla(db, "INSERT INTO sat_catalogos (catalogo, clave, nombre, extra) VALUES ('UsoCfdi', 'G03', 'Gastos en general', '{\"regimenes\":[\"601\"]}')") === null && /UNIQUE|PRIMARY/.test(falla(db, "INSERT INTO sat_catalogos (catalogo, clave) VALUES ('UsoCfdi', 'G03')") || ''), 'los catálogos del SAT se guardan con su clave única');
  // Complemento de pago y factura global: los enlaces con su integridad.
  const fid = db.prepare("SELECT id FROM facturas WHERE lead_id = ? AND estatus = 'timbrada'").get(L1).id;
  revisa(falla(db, 'INSERT INTO factura_ventas (factura_id, lead_id, importe_cent) VALUES (?, ?, 1000)', [fid, L2]) === null && /UNIQUE|PRIMARY/.test(falla(db, 'INSERT INTO factura_ventas (factura_id, lead_id, importe_cent) VALUES (?, ?, 1000)', [fid, L2]) || ''), 'la factura global enlaza varias órdenes y no repite la misma');
  revisa(/CHECK/.test(falla(db, 'INSERT INTO factura_cobros (factura_id, cobro_id, num_parcialidad, saldo_anterior_cent, importe_pagado_cent, saldo_insoluto_cent) VALUES (?, 1, 0, 100, 50, 50)', [fid]) || ''), 'la parcialidad del complemento de pago empieza en 1');
  db.close();

  console.log('3. Volver a arrancar sobre la misma base (con datos)');
  const antes = (() => { const d = abrir(); const o = { facturas: d.prepare('SELECT COUNT(*) n FROM facturas').get().n, leads: d.prepare('SELECT COUNT(*) n FROM leads').get().n, fiscales: d.prepare('SELECT COUNT(*) n FROM clientes_fiscales').get().n, esquema: d.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all().map(r => r.sql).join('\n') }; d.close(); return o; })();
  srv = await arrancar(); await espera(500); await parar(srv);
  revisa(!/SqliteError|Error:|ALTER|duplicate column/i.test(salida), 'el segundo arranque no marca errores (migración idempotente)', salida.split('\n').filter(l => /rror/.test(l)).slice(0, 3));
  const despues = (() => { const d = abrir(); const o = { facturas: d.prepare('SELECT COUNT(*) n FROM facturas').get().n, leads: d.prepare('SELECT COUNT(*) n FROM leads').get().n, fiscales: d.prepare('SELECT COUNT(*) n FROM clientes_fiscales').get().n, esquema: d.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all().map(r => r.sql).join('\n'),
    integridad: d.prepare('PRAGMA integrity_check').get().integrity_check, fk: d.prepare('PRAGMA foreign_key_check').all().length }; d.close(); return o; })();
  revisa(antes.facturas === despues.facturas && antes.leads === despues.leads && antes.fiscales === despues.fiscales, 'no cambia ni un dato', [antes.facturas, despues.facturas]);
  revisa(antes.esquema === despues.esquema, 'el esquema queda idéntico (no se repite ni se altera nada)');
  revisa(despues.integridad === 'ok' && despues.fk === 0, 'la base queda íntegra y sin referencias rotas', [despues.integridad, despues.fk]);

  console.log('4. El sistema sigue funcionando');
  srv = await arrancar();
  revisa(!/uncaughtException|Error no manejado|TypeError/.test(salida), 'el servidor no registra errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 3));
  await parar(srv);
  revisa(fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8').includes("require('./facturacion-db')(db)"), 'el arranque del servidor llama a la migración de facturación');
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  await espera(300); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); process.exit(1); });
