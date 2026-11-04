// AUDITORÍA FORENSE (2026-11-04): pruebas de las correcciones. Lista de órdenes sin consultas por fila y con el filtro
// «por concluir» de Inicio (H-025), campos de texto que llegan como objeto (H-013), candado de facturas timbradas en la
// base (H-021), correos tachados en la bitácora de facturación (H-010) y archivos que solo empiezan como PDF o JPG (H-018).
// Uso: node tests/simulacion-auditoria-correcciones.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-aud-corr-')), DB = path.join(dir, 'aud.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Auditoria-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Auditoria-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9750 + Math.floor(Math.random() * 200)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, h = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...h }, body: b === undefined ? undefined : (Buffer.isBuffer(b) ? b : JSON.stringify(b)) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Valeria Ventas', password: CLAVE, rol: 'ventas', sucursales: [qro.id] }), 'crear ventas');
  const V = exigir(await pedir('POST', '/login', null, { nombre: 'Valeria Ventas', password: CLAVE }), 'entrar ventas').token;
  const canal = (await pedir('GET', '/canales', V))[1][0], servicio = (await pedir('GET', '/servicios', V))[1][0];
  const yo = (await pedir('GET', '/permisos/mios', V))[1].usuario_id;

  console.log('1. Campos de texto que llegan como objeto o lista (H-013)');
  revisa((await pedir('POST', '/contactos', V, { nombre: { a: 1 }, telefono: '4421110001', canal_origen_id: canal.id }))[0] === 400, 'Nombre como objeto: rechazado');
  revisa((await pedir('POST', '/contactos', V, { nombre: ['Ana', 'Luis'], telefono: '4421110002', canal_origen_id: canal.id }))[0] === 400, 'Nombre como lista: rechazado');
  const cli = exigir(await pedir('POST', '/contactos', V, { nombre: 'Hotel Correcciones', telefono: '4421110003', canal_origen_id: canal.id }), 'contacto');
  revisa((await pedir('PUT', '/clientes/' + cli.id, V, { direccion: { calle: 'x' } }))[0] === 400, 'Dirección como objeto al editar: rechazada');

  console.log('2. Lista de órdenes: conteos y «por concluir» (H-025)');
  const orden = async (fecha, realizada) => {
    const l = exigir(await pedir('POST', '/leads', V, { cliente_id: cli.id, direccion: 'X', canal_id: canal.id, servicio_id: servicio.id, responsable_id: yo, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'a', importe: 100 }]), iva_modo: 'mas_iva', iva_tasa: 16, fecha_cotizacion: sumar(HOY, -10), forzar_duplicado: true }), 'orden');
    const x = (await pedir('GET', '/leads/' + l.id, V))[1];
    exigir(await pedir('PUT', '/leads/' + l.id, V, { version: x.version, estatus: 'ganado', fecha_servicio: fecha }), 'ganar');
    if (realizada) exigir(await pedir('POST', '/leads/' + l.id + '/ejecucion', V, { estado: 'realizado', fecha, realizado_por: 'propio' }), 'realizar');
    return l.id;
  };
  const pasada = await orden(sumar(HOY, -3), false), hecha = await orden(sumar(HOY, -2), true), futura = await orden(sumar(HOY, 5), false);
  const [, todas] = await pedir('GET', '/leads?estatus=ganado&solo_area=1', V);
  const [, pc] = await pedir('GET', '/leads?estatus=ganado&solo_area=1&por_concluir=1', V);
  revisa(todas.length === 3 && todas.every(l => l.veces_contratado === 3), 'Cada orden dice que el cliente tiene 3 (conteo agrupado igual que antes)', todas.map(l => l.veces_contratado));
  revisa(pc.length === 1 && pc[0].id === pasada, 'Inicio recibe solo la orden con fecha pasada sin marcar (no la realizada ni la futura)', pc.map(l => l.id));
  exigir(await pedir('POST', '/leads/' + pasada + '/historial', V, { tipo: 'alerta', texto: 'Llamar', fecha_alerta: sumar(HOY, -1) + ' 09:00:00' }), 'aviso');
  const [, conAviso] = await pedir('GET', '/leads?estatus=ganado', V);
  revisa(conAviso.find(l => l.id === pasada)?.alertas_pendientes === 1 && conAviso.find(l => l.id === hecha)?.alertas_pendientes === 0, 'Los avisos pendientes se cuentan por orden');
  void futura;

  console.log('3. Facturas timbradas: candado en la base (H-021)');
  const fid = conBase(d => Number(d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, estatus, entorno, total_cent, serie, folio, uuid) VALUES (?, ?, 'AUD-1', 'timbrada', 'sandbox', 11600, 'F', '7', 'AAAAAAAA-1111-2222-3333-444444444444')").run(pasada, qro.id).lastInsertRowid));
  const intento = sql => { try { conBase(d => d.exec(sql)); return false; } catch { return true; } };
  revisa(intento(`DELETE FROM facturas WHERE id = ${fid}`), 'La base no deja borrar una factura timbrada');
  revisa(intento(`UPDATE facturas SET total_cent = 1 WHERE id = ${fid}`), 'Ni cambiarle el total');
  revisa(intento(`UPDATE facturas SET uuid = 'BBBBBBBB-1111-2222-3333-444444444444' WHERE id = ${fid}`), 'Ni el folio fiscal');
  revisa(!intento(`UPDATE facturas SET estatus = 'cancelacion_solicitada', uuid = 'AAAAAAAA-1111-2222-3333-444444444444' WHERE id = ${fid}`), 'Sí deja cambiar el estatus y volver a escribir el mismo folio fiscal');
  const borrador = conBase(d => Number(d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, estatus, entorno) VALUES (?, ?, 'AUD-2', 'pendiente', 'sandbox')").run(hecha, qro.id).lastInsertRowid));
  revisa(!intento(`UPDATE facturas SET total_cent = 500 WHERE id = ${borrador}`), 'Una factura sin timbrar sí se puede ajustar');

  console.log('4. Bitácora de facturación sin correos (H-010)');
  const { log } = require('../server/facturacion-timbrado');
  conBase(d => log(d, { id: fid, lead_id: pasada }, 'prueba', 'error', 'El receptor cliente.real@empresa.com.mx con RFC EKU9003173C9 no existe', null));
  const msg = conBase(d => d.prepare("SELECT mensaje FROM facturas_log WHERE accion = 'prueba'").get().mensaje);
  revisa(!/@/.test(msg) && /\[correo\]/.test(msg) && /\[RFC\]/.test(msg), 'El correo y el RFC se tachan', msg);

  console.log('5. Archivos que solo empiezan como PDF o JPG (H-018)');
  const { tipoReal } = require('../server/expediente-oc');
  revisa(tipoReal(Buffer.from('%PDF-<html><script>alert(1)</script></html>')) === null, 'Un HTML que empieza con %PDF- ya no pasa como PDF');
  revisa(tipoReal(Buffer.from('%PDF-1.4\n1 0 obj\n%%EOF\n')) === 'pdf', 'Un PDF que cierra con %%EOF sí pasa');
  revisa(tipoReal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)])) === null && tipoReal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50), Buffer.from([0xff, 0xd9])])) === 'jpg', 'Un JPG debe cerrar con FF D9');
  const per = exigir(await pedir('POST', '/personal', A, { nombre: 'Persona Archivos', puesto: 'Operador' }), 'persona');
  const x = await fetch(URLB + '/api/personal/' + per.id + '/documentos', { method: 'POST', headers: { Authorization: 'Bearer ' + A, 'Content-Type': 'application/pdf', 'X-Tipo': 'ine', 'X-Nombre': 'falso.pdf' }, body: Buffer.from('%PDF-<html><script>alert(1)</script></html>') });
  revisa(x.status === 400, 'El expediente rechaza el HTML disfrazado', x.status);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
