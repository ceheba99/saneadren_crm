// Versión DEMO: solo existe con MODO_DEMO=1 y en una base vacía; nunca toca una base con datos reales.
// 1) sin MODO_DEMO: no hay botones ni ejemplos; 2) con MODO_DEMO en base vacía: siembra todo y la integridad sale limpia;
// 3) con MODO_DEMO sobre una base con datos reales: se niega y no agrega nada.
// Uso: node tests/simulacion-demo.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-demo-'));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Demo-Prueba-' + Math.random().toString(36).slice(2) + '-9' };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
let srv, salida = '', PUERTO;
async function arrancar(db, extra = {}) {
  PUERTO = String(8300 + Math.floor(Math.random() * 300)); salida = '';
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', ...extra, PORT: PUERTO, DB_PATH: path.join(dir, db), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
}
async function parar() { srv.kill(); await espera(400); }
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };

(async () => {
  console.log('1. Sistema normal (sin MODO_DEMO)');
  await arrancar('real.db');
  let [s, j] = await pedir('GET', '/demo/estado'); revisa(s === 200 && j.demo === false, 'el sistema real dice que no es demo (no se muestran botones ni franja)', j);
  [s] = await pedir('POST', '/demo/entrar', null, { rol: 'admin' }); revisa(s === 404, 'entrar sin contraseña NO funciona en el sistema real');
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Cliente Real', telefono: '442 111 2233', empresa_contacto: 'Empresa Real', canal_origen_id: 1 });
  revisa(s === 201 || s === 200, 'se captura un cliente real', [s, j.error]);
  [s, j] = await pedir('GET', '/usuarios', A); revisa(!j.some(u => /\(demo\)/.test(u.nombre)), 'no hay usuarios de ejemplo');
  await parar();

  console.log('2. MODO_DEMO=1 sobre esa base con datos reales');
  await arrancar('real.db', { MODO_DEMO: '1' });
  await espera(1500);
  [s, j] = await pedir('GET', '/demo/estado'); revisa(j.demo === false, 'se niega: la base ya tiene datos de negocio', j);
  [s] = await pedir('POST', '/demo/entrar', null, { rol: 'admin' }); revisa(s === 404, 'tampoco deja entrar sin contraseña');
  revisa(/NO se siembran ejemplos/.test(salida), 'lo deja escrito en el registro del servidor');
  const A2 = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  [s, j] = await pedir('GET', '/clientes/catalogo', A2); revisa(Array.isArray(j) && j.length === 1, 'la base real quedó igual (un solo cliente, sin ejemplos)', j.length);
  [s, j] = await pedir('GET', '/usuarios', A2); revisa(!j.some(u => /\(demo\)/.test(u.nombre)), 'no se crearon usuarios de ejemplo');
  await parar();

  console.log('3. MODO_DEMO=1 en una base vacía');
  await arrancar('demo.db', { MODO_DEMO: '1' });
  for (let i = 0; i < 400; i++) { [s, j] = await pedir('GET', '/demo/estado'); if (j.listo || j.error) break; await espera(250); }
  revisa(j.demo === true && j.listo === true && !j.error, 'los ejemplos se sembraron sin errores', j.error || j);
  [s] = await pedir('POST', '/demo/entrar', null, { rol: 'inventado' }); revisa(s === 400, 'un rol que no existe no entra');
  const tok = {};
  for (const rol of ['admin', 'ventas', 'costos', 'tecnico', 'atencion']) { [s, j] = await pedir('POST', '/demo/entrar', null, { rol }); tok[rol] = j.token; revisa(s === 200 && j.rol === rol && j.token, 'entra como ' + rol + ' sin contraseña'); }
  [s, j] = await pedir('GET', '/admin/integridad', tok.ventas); revisa(s === 403, 'cada usuario de ejemplo conserva los permisos de su rol (ventas no ve la revisión de integridad)');
  [s, j] = await pedir('GET', '/admin/integridad', tok.admin);
  revisa(s === 200 && j.errores === 0, 'la revisión de integridad no encuentra errores en los datos de ejemplo', (j.resultados || []).filter(r => r.gravedad === 'error' && r.total).map(r => r.titulo));
  const [, leads] = await pedir('GET', '/leads', tok.admin);
  const de = emp => leads.filter(l => (l.empresa_contacto || l.cliente_empresa || l.empresa || '').includes(emp) || JSON.stringify(l).includes(emp));
  const kfc = de('KFC'), sym = de('Symrise');
  revisa(kfc.length === 6 && new Set(kfc.map(l => l.cliente_id)).size === 1, 'KFC: 6 órdenes (una por sucursal) bajo un solo cliente', [kfc.length, [...new Set(kfc.map(l => l.cliente_id))]]);
  const dias = {}; for (const l of sym) { const d = new Date(l.fecha_servicio + 'T12:00:00Z').getUTCDay(); dias[d] = dias[d] || new Set(); dias[d].add(JSON.parse(l.partidas_json)[0].cantidad); }
  revisa(sym.length >= 40 && !dias[0] && [...(dias[1] || [])].join() === '5' && [...(dias[6] || [])].join() === '5' && [2, 3, 4, 5].every(d => [...(dias[d] || [])].join() === '3'), 'Symrise: lunes y sábado 5 viajes, martes a viernes 3, nunca domingo', [sym.length, Object.fromEntries(Object.entries(dias).map(([k, v]) => [k, [...v]]))]);
  [s, j] = await pedir('GET', '/compras/solicitudes', tok.admin); revisa(['recibida', 'con_orden', 'rechazada', 'cotizando', 'por_aprobar'].every(e => j.some(x => x.estado === e)), 'solicitudes de compra en cada etapa', j.map(x => x.estado));
  [s, j] = await pedir('GET', '/finanzas/resumen', tok.admin); revisa(j.por_cobrar > 0 && j.vencido > 0 && j.por_pagar > 0 && j.a_favor > 0, 'hay cuentas por cobrar, vencidas, por pagar y saldo a favor para enseñar', j);
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  await parar();

  console.log('4. Reinicio con la base demo ya sembrada');
  await arrancar('demo.db', { MODO_DEMO: '1' });
  [s, j] = await pedir('GET', '/demo/estado'); revisa(j.demo === true && j.listo === true, 'no vuelve a sembrar ni se niega: sigue siendo la demo', j);
  const [, leads2] = await pedir('GET', '/leads', (await pedir('POST', '/demo/entrar', null, { rol: 'admin' }))[1].token);
  revisa(leads2.length === leads.length, 'no duplica los ejemplos', [leads.length, leads2.length]);
  await parar();

  console.log('5. La base demo sin MODO_DEMO');
  await arrancar('demo.db');
  [s] = await pedir('POST', '/demo/entrar', null, { rol: 'admin' }); revisa(s === 404, 'sin la variable MODO_DEMO, ni la base demo deja entrar sin contraseña');
  await parar();

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv?.kill(); process.exit(1); });
