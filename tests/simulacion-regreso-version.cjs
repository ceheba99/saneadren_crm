// REGRESO DE VERSIÓN. Ida y vuelta: base llena con el código de producción → código nuevo (rehace usuarios, crea roles) → otra vez el de
// producción (por si hubiera que regresar) → otra vez el nuevo. Todo debe seguir entrando y funcionando.
// Uso: CODIGO_ANTERIOR=<carpeta con el código publicado> node tests/simulacion-regreso-version.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const NUEVO = path.join(__dirname, '..'), ANTERIOR = process.env.CODIGO_ANTERIOR;
if (!ANTERIOR || !fs.existsSync(path.join(ANTERIOR, 'server', 'index.js'))) { console.log('Falta CODIGO_ANTERIOR (carpeta con el código publicado): se omite.'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-idavuelta-')), DB = path.join(dir, 'p.db');
const PASS = 'IdaVuelta-Prueba-2026x';
let srv, out = '', P = 0; const esp = ms => new Promise(r => setTimeout(r, ms));
let n = 0, mal = 0; const ok = (c, t, x) => { n++; if (!c) mal++; console.log((c ? '  ✔ ' : '  ✘ ') + t + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); };
async function arrancar(codigo, extra = {}) {
  P = 8100 + Math.floor(Math.random() * 300); out = '';
  srv = spawn(process.execPath, [path.join(codigo, 'server', 'index.js')], { cwd: codigo, env: { ...process.env, MODO_DEMO: '', ...extra, NODE_PATH: path.join(NUEVO, 'node_modules'), PORT: String(P), DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: 'marketing@saneadren.com.mx', ADMIN_PASSWORD: PASS, SMTP_HOST: '' } });
  srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);
  for (let i = 0; i < 150 && !/corriendo/.test(out); i++) await esp(150);
  if (!/corriendo/.test(out)) throw new Error(out.slice(-1500));
}
const parar = () => new Promise(r => { srv.on('exit', r); srv.kill(); });
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${P}/api${r}`, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [x.status, await x.json().catch(() => ({}))]; };
const conteo = () => { const d = new DatabaseSync(DB); const r = { usuarios: d.prepare('SELECT COUNT(*) n FROM usuarios').get().n, leads: d.prepare('SELECT COUNT(*) n FROM leads').get().n, check: /CHECK\s*\(\s*rol\s+IN/i.test(d.prepare("SELECT sql FROM sqlite_master WHERE name='usuarios'").get().sql), fk: d.prepare('PRAGMA foreign_key_check').all().length }; d.close(); return r; };
(async () => {
  console.log('1. Producción: base llena');
  await arrancar(ANTERIOR, { MODO_DEMO: '1' });
  for (let i = 0; i < 400; i++) { const [, j] = await pedir('GET', '/demo/estado'); if (j.listo || j.error) break; await esp(250); }
  await parar();
  // Si la versión publicada ya trae roles y permisos, la tabla de usuarios ya no tiene la lista fija.
  const anteriorConRoles = fs.existsSync(path.join(ANTERIOR, 'server', 'permisos.js'));
  let A = conteo(); ok(anteriorConRoles ? !A.check : A.check, anteriorConRoles ? 'la base de producción ya acepta roles nuevos' : 'la base de producción tiene la lista fija de roles', A);
  console.log('2. Código nuevo');
  await arrancar(NUEVO);
  let [s, j] = await pedir('POST', '/login', null, { nombre: 'admin', password: PASS }); let T = j.token;
  let B = conteo(); ok(!B.check && B.usuarios === A.usuarios && B.leads === A.leads && B.fk === 0, 'se quitó la lista fija sin perder usuarios ni datos ni referencias', B);
  [s, j] = await pedir('GET', '/sucursales', T); const qro = j.sucursales.find(x => x.clave === 'QRO').id;
  [s, j] = await pedir('POST', '/usuarios', T, { nombre: 'Persona Ida', password: PASS, rol: 'ventas', sucursales: [qro] }); ok(s === 201, 'crea usuario de ventas', j);
  [s, j] = await pedir('POST', '/roles', T, { nombre: 'Contador', copiar_de: 'tecnico' }); ok(s === 201, 'crea el rol Contador', j);
  [s, j] = await pedir('POST', '/usuarios', T, { nombre: 'Persona Contador', password: PASS, rol: 'contador', sucursales: [qro] }); ok(s === 201, 'crea a alguien con el rol Contador', j);
  [s] = await pedir('GET', '/finanzas/cartera', T); ok(s === 200, 'Dirección ve la cartera');
  await parar();
  console.log('3. Regreso al código de producción (por si hubiera que deshacer)');
  await arrancar(ANTERIOR);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'admin', password: PASS }); T = j.token; ok(s === 200, 'Dirección entra');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Persona Ida', password: PASS }); ok(s === 200, 'la persona de ventas entra'); const TV = j.token;
  [s] = await pedir('GET', '/finanzas/cartera', TV); ok(s === 200, 'y ve la cartera como siempre');
  [s, j] = await pedir('POST', '/usuarios', T, { nombre: 'Persona Vuelta', password: PASS, rol: 'tecnico', sucursales: [qro] }); ok(s === 201, 'el código anterior sigue creando usuarios', j);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Persona Contador', password: PASS }); const TC = j.token;
  [s] = await pedir('GET', '/finanzas/cartera', TC); ok(anteriorConRoles ? s === 200 : (s === 403 || s === 401), anteriorConRoles ? 'quien tiene un rol nuevo, con el código anterior ve según sus permisos' : 'quien tiene un rol nuevo, con el código anterior no ve de más (' + s + ')');
  [s] = await pedir('GET', '/leads', T); ok(s === 200, 'las órdenes siguen');
  await parar();
  console.log('4. Otra vez el nuevo');
  await arrancar(NUEVO);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Persona Contador', password: PASS }); ok(s === 200, 'el contador entra');
  [s, j] = await pedir('GET', '/permisos/mios', j.token); ok(j.rol === 'contador' && j.permisos.includes('cxc.ver'), 'con sus permisos de contador', j);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Persona Vuelta', password: PASS }); ok(s === 200, 'lo creado con el anterior entra');
  const C = conteo(); ok(C.fk === 0 && !C.check, 'base sana al final', C);
  await parar();
  console.log(`\n${n - mal}/${n} correctas`); fs.rmSync(dir, { recursive: true, force: true }); process.exit(mal ? 1 : 0);
})().catch(async e => { console.error(e); try { await parar(); } catch {} process.exit(1); });
