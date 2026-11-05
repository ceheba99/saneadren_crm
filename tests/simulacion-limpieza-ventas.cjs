// LIMPIEZA DE VENTAS (2026-11-05): herramientas/limpiar-ventas.js deja en cero clientes, órdenes, cobros, facturas,
// cuentas por pagar, compras, prospección y catálogos comerciales; RH, marketing, usuarios y sucursales no se tocan.
// Revisar no cambia nada; borrar saca copia de la base, mueve los archivos y no procede si hay una factura de producción.
// Uso: node tests/simulacion-limpieza-ventas.cjs
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-limpieza-ventas-')), DB = path.join(dir, 'limpieza.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Limpieza-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const PUERTO = String(9700 + Math.floor(Math.random() * 150)), URLB = 'http://localhost:' + PUERTO;
const ENV = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') };
const HERRAMIENTA = path.join(__dirname, '..', 'herramientas', 'limpiar-ventas.js');
const espera = ms => new Promise(r => setTimeout(r, ms));
let srv, salida = '';
const arrancar = async () => {
  salida = ''; srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: ENV });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
};
const detener = async () => { srv.kill(); await new Promise(r => srv.once('exit', r)); };
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const herramienta = (args, env = ENV) => spawnSync(process.execPath, [HERRAMIENTA, ...args], { env, encoding: 'utf8' });
const conBase = (fn, ruta = DB) => { const d = new DatabaseSync(ruta); try { return fn(d); } finally { d.close(); } };
const n = (t, ruta) => conBase(d => d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, ruta);
let total = 0; const malos = [];
const revisa = (cond, texto, extra) => { total++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const VENTAS = ['clientes', 'leads', 'cobros', 'cuentas_por_pagar', 'pagos_proveedor', 'proveedores', 'facturas', 'historial'];
const QUEDAN = ['personal', 'proyectos_marketing', 'canales', 'usuarios', 'sucursales', 'auditoria', 'horarios', 'roles'];

(async () => {
  await arrancar();
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const canal = (await pedir('GET', '/canales', A))[1][0];
  const servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente de Prueba', telefono: '4421112233', canal_origen_id: canal.id }), 'contacto');
  const clienteId = cli.cliente_id || cli.id;
  const lead = exigir(await pedir('POST', '/leads', A, { cliente_id: clienteId, direccion: 'Cocina', canal_id: canal.id, servicio_id: servicio.id, responsable_id: 1, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Prueba', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: HOY }), 'orden');
  exigir(await pedir('PUT', '/leads/' + lead.id, A, { version: lead.version, estatus: 'ganado', fecha_servicio: HOY }), 'contratar');
  exigir(await pedir('POST', '/leads/' + lead.id + '/cobros', A, { monto: 100, metodo: 'efectivo', fecha: HOY }), 'cobro');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas Prueba', categoria: 'otro', dias_credito: 15 }), 'proveedor');
  const gasto = exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Diésel', total: 500, dias_credito: 0, fecha_documento: HOY }), 'gasto');
  exigir(await pedir('POST', '/finanzas/cxp/' + gasto.id + '/pagos', A, { monto: 200, metodo: 'transferencia', fecha: HOY }), 'pago a proveedor');
  exigir(await pedir('POST', '/personal', A, { nombre: 'Persona de RH', puesto: 'Operador', sucursal_id: 1 }), 'persona');
  exigir(await pedir('POST', '/marketing/proyectos', A, { nombre: 'Campaña de prueba', inicio: HOY, fin: HOY, sucursal: 'empresa' }), 'proyecto');
  await detener();

  // Una factura de sandbox ya timbrada, un servicio editado a mano y archivos de cada módulo.
  conBase(d => {
    d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, estatus, uuid, entorno, total_cent) VALUES (?, 1, 'P-1', 'timbrada', 'AAAA-SANDBOX', 'sandbox', 116000)").run(lead.id);
    d.prepare("UPDATE catalogo_servicios SET nombre = 'Servicio editado a mano' WHERE id = ?").run(servicio.id);
  });
  const archivo = (c, f) => { fs.mkdirSync(path.join(dir, 'archivos', c), { recursive: true }); fs.writeFileSync(path.join(dir, 'archivos', c, f), 'x'); };
  archivo('facturas', 'f.pdf'); archivo('cuentas_por_pagar', 'g.xml'); archivo('personal', 'ine.jpg'); archivo('marketing', 'arte.png');
  const antes = Object.fromEntries([...VENTAS, ...QUEDAN].map(t => [t, n(t)]));
  const candados = conBase(d => d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger'").get().n);

  console.log('1. Revisar no cambia nada');
  revisa(herramienta([], { ...ENV, DB_PATH: '' }).status === 1, 'Sin DB_PATH se detiene');
  let r = herramienta([]);
  revisa(r.status === 0 && /Modo REVISAR/.test(r.stdout), 'Revisar termina bien', r.stdout + r.stderr);
  revisa(VENTAS.every(t => n(t) === antes[t]) && fs.existsSync(path.join(dir, 'archivos', 'facturas', 'f.pdf')), 'Todo sigue igual después de revisar');

  console.log('2. Una factura de producción lo frena');
  conBase(d => d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, estatus, uuid, entorno, total_cent) VALUES (?, 1, 'P-2', 'timbrada', 'BBBB-REAL', 'prod', 116000)").run(lead.id));
  r = herramienta(['--borrar']);
  revisa(r.status === 1 && /PRODUCCIÓN/.test(r.stderr), 'No borra si hay una factura real', r.stdout + r.stderr);
  revisa(n('leads') === antes.leads && !fs.readdirSync(dir).some(f => f.startsWith('antes-de-limpieza')), 'Y no tocó nada (ni sacó copia)');
  conBase(d => { d.exec('DROP TRIGGER facturas_timbradas_no_borrar'); d.exec("DELETE FROM facturas WHERE entorno = 'prod'"); });

  console.log('3. Borrar');
  r = herramienta(['--borrar']);
  revisa(r.status === 0 && /LIMPIEZA HECHA/.test(r.stdout), 'La limpieza termina bien', r.stdout + r.stderr);
  revisa(VENTAS.every(t => n(t) === 0), 'Clientes, órdenes, cobros, CxP, pagos, proveedores, facturas e historial quedan en cero', Object.fromEntries(VENTAS.map(t => [t, n(t)])));
  revisa(QUEDAN.every(t => n(t) === antes[t]), 'RH, marketing, canales, usuarios, sucursales y auditoría siguen igual', Object.fromEntries(QUEDAN.map(t => [t, [antes[t], n(t)]])));
  const copia = fs.readdirSync(dir).find(f => /^antes-de-limpieza-\d{8}-\d{4}\.db$/.test(f));
  revisa(copia && n('leads', path.join(dir, copia)) === antes.leads && n('facturas', path.join(dir, copia)) === 1, 'Quedó la copia de la base con todo lo de antes', copia);
  const movidos = fs.readdirSync(dir).find(f => f.startsWith('archivos-antes-de-limpieza-'));
  revisa(movidos && fs.existsSync(path.join(dir, movidos, 'facturas', 'f.pdf')) && fs.existsSync(path.join(dir, movidos, 'cuentas_por_pagar', 'g.xml')) && !fs.existsSync(path.join(dir, 'archivos', 'facturas')), 'Los archivos de facturas y CxP se movieron aparte');
  revisa(fs.existsSync(path.join(dir, 'archivos', 'personal', 'ine.jpg')) && fs.existsSync(path.join(dir, 'archivos', 'marketing', 'arte.png')), 'Los archivos de RH y marketing no se tocaron');
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger'").get().n) === candados - 1, 'Los candados volvieron (menos el que quitó la prueba)');
  revisa(herramienta(['--borrar']).status === 1, 'Correrla otra vez en el mismo minuto se detiene (no pisa la copia)');

  console.log('4. Al reiniciar');
  await arrancar();
  const A2 = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar otra vez').token;
  const servicios = (await pedir('GET', '/servicios', A2))[1];
  revisa(servicios.length >= 9 && !servicios.some(s => s.nombre === 'Servicio editado a mano'), 'Vuelven los servicios de fábrica', servicios.map(s => s.nombre));
  const c2 = exigir(await pedir('POST', '/contactos', A2, { nombre: 'Primer Cliente Real', telefono: '4425556677', canal_origen_id: canal.id }), 'contacto nuevo');
  const l2 = exigir(await pedir('POST', '/leads', A2, { cliente_id: c2.cliente_id || c2.id, direccion: 'Patio', canal_id: canal.id, servicio_id: servicios[0].id, responsable_id: 1, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Real', importe: 500 }]), iva_modo: 'mas_iva', valor: 500, fecha_cotizacion: HOY }), 'orden nueva');
  revisa(conBase(d => d.prepare('SELECT folio_num FROM leads WHERE id = ?').get(l2.id).folio_num) === 1, 'La primera orden nueva es el folio 1');
  exigir(await pedir('PUT', '/leads/' + l2.id, A2, { version: l2.version, estatus: 'ganado', fecha_servicio: HOY }), 'contratar nueva');
  exigir(await pedir('POST', '/leads/' + l2.id + '/cobros', A2, { monto: 50, metodo: 'efectivo', fecha: HOY }), 'cobro nuevo');
  revisa(conBase(d => { try { d.exec('DELETE FROM cobros'); return false; } catch { return true; } }), 'Los cobros siguen sin poder borrarse');
  revisa((await pedir('GET', '/personal', A2))[0] === 200, 'RH sigue abriendo');
  await detener();

  console.log(`\n${total - malos.length}/${total} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); try { srv.kill(); } catch { /* */ } process.exit(1); });
