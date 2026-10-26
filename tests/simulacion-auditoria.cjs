// Auditoría: candados de entrada (sin sesión nada), límites de intentos por IP y por cuenta (detrás de
// Cloudflare), respaldo descargable y respaldos automáticos, integridad de librerías externas y encabezados.
// Uso: node tests/simulacion-auditoria.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-auditoria-')); const PUERTO = String(6700 + Math.floor(Math.random() * 250));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Audita-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'a.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}`;
const pedir = async (m, r, t, b, extra = {}) => { const x = await fetch(URL + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const login = (nombre, password, ip) => pedir('POST', '/login', null, { nombre, password }, ip ? { 'CF-Connecting-IP': ip } : {});
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);

(async () => {
  for (let i = 0; i < 80 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await login(ADMIN.correo, ADMIN.password))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Laura Audita', correo: 'laura.audita@saneadren.com.mx', password: 'Laura-Audita-2026', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Pedro Audita', correo: 'pedro.audita@saneadren.com.mx', password: 'Pedro-Audita-2026', rol: 'ventas' });
  const V = (await login('laura.audita@saneadren.com.mx', 'Laura-Audita-2026'))[1].token;

  seccion('1. Sin sesión no se entra a nada');
  const fuentes = fs.readdirSync(path.join(__dirname, '..', 'server')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8')).join('\n');
  const rutas = [...fuentes.matchAll(/app\.(get|post|put|delete)\('(\/api\/[^']+)'/g)].map(m => [m[1].toUpperCase(), m[2].replace(/:[a-z_]+/gi, '1')]);
  const publicas = ['/api/salud', '/api/login', '/api/registro', '/api/verificar-correo', '/api/olvide-password', '/api/restablecer-password', '/api/demo/estado', '/api/demo/entrar', '/api/publico/encuesta/1']; // la encuesta del QR no pide sesión (2026-10-26)
  const abiertas = [];
  for (const [m, r] of rutas) { if (publicas.includes(r)) continue; const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' }); if (x.status !== 401) abiertas.push(m + ' ' + r + ' → ' + x.status); }
  revisa(rutas.length > 100 && !abiertas.length, `las ${rutas.length} rutas de la API piden sesión (salvo entrar, salud y recuperar contraseña)`, abiertas);
  { const x = await fetch(URL + '/api/leads', { headers: { Authorization: 'Bearer ' + 'f'.repeat(64) } }); revisa(x.status === 401, 'un token inventado no sirve'); }
  for (const p of ['/.env', '/../server/index.js', '/%2e%2e/server/index.js', '/package.json', '/a.db', '/archivos/']) { const x = await fetch(URL + p); revisa(x.status === 404 || x.status === 403 || x.status === 400, 'no se puede descargar «' + p + '»', x.status); }

  seccion('2. Encabezados de seguridad');
  { const x = await fetch(URL + '/'); const hh = k => x.headers.get(k) || '';
    revisa(/frame-ancestors 'none'/.test(hh('content-security-policy')) && /object-src 'none'/.test(hh('content-security-policy')), 'política de contenido (CSP) sin marcos ni objetos');
    revisa(hh('x-content-type-options') === 'nosniff' && /DENY/i.test(hh('x-frame-options')) && hh('referrer-policy'), 'nosniff, sin marcos y sin referer'); }
  { const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const externos = [...html.matchAll(/<script[^>]+src="https?:\/\/[^"]+"[^>]*>/g)].map(m => m[0]);
    revisa(externos.length >= 4 && externos.every(s => /integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/.test(s) && /crossorigin="anonymous"/.test(s)), 'cada librería externa trae su huella (SRI): si el CDN la altera, no se ejecuta', externos.filter(s => !/integrity=/.test(s)));
    const js = fs.readdirSync(path.join(__dirname, '..', 'public')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
    const dinamicos = [...js.matchAll(/s\.src = 'https:[^']+';([\s\S]{0,300})/g)];
    revisa(dinamicos.length >= 2 && dinamicos.every(m => /s\.integrity = 'sha/.test(m[1])), 'también las que se cargan después (Excel y ZIP)', dinamicos.length); }

  seccion('3. Intentos de contraseña (detrás de Cloudflare)');
  for (let k = 0; k < 6; k++) await login('laura.audita@saneadren.com.mx', 'mala-' + k, '203.0.113.10');
  let [s, j] = await login('laura.audita@saneadren.com.mx', 'Laura-Audita-2026', '203.0.113.10'); revisa(s === 429, 'desde la IP del atacante, la cuenta queda frenada tras 6 intentos', [s, j.error]);
  [s, j] = await login('laura.audita@saneadren.com.mx', 'Laura-Audita-2026', '198.51.100.20'); revisa(s === 200, 'Laura, desde SU conexión, sí entra (el atacante no la deja fuera)', [s, j.error]);
  [s, j] = await login('pedro.audita@saneadren.com.mx', 'Pedro-Audita-2026', '203.0.113.10'); revisa(s === 200, 'otra cuenta desde la misma IP del atacante sigue funcionando');
  for (let k = 0; k < 30; k++) await login('pedro.audita@saneadren.com.mx', 'mala-' + k, '10.9.' + Math.floor(k / 5) + '.' + k);
  [s, j] = await login('pedro.audita@saneadren.com.mx', 'Pedro-Audita-2026', '10.99.99.99'); revisa(s === 429 && /demasiados intentos/i.test(j.error), 'cambiando de IP 30 veces no se pueden seguir probando contraseñas (tope por cuenta)', [s, j.error]);
  [s, j] = await login('laura.audita@saneadren.com.mx', 'Laura-Audita-2026', '10.99.99.99'); revisa(s === 200, 'el tope de Pedro no afecta a Laura');
  [s, j] = await login('admin', 'x', 'esto-no-es-ip'); revisa(s === 401, 'una IP falsa mal escrita se ignora (no rompe nada)');

  seccion('4. Respaldos');
  { const x = await fetch(URL + '/api/admin/backup', { headers: { Authorization: 'Bearer ' + V } }); revisa(x.status === 403, 'ventas no descarga la base'); }
  const [r1, r2] = await Promise.all([fetch(URL + '/api/admin/backup', { headers: { Authorization: 'Bearer ' + A } }), fetch(URL + '/api/admin/backup', { headers: { Authorization: 'Bearer ' + A } })]);
  const [b1, b2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
  revisa(r1.status === 200 && r2.status === 200 && Buffer.from(b1).slice(0, 15).toString() === 'SQLite format 3' && Buffer.from(b2).slice(0, 15).toString() === 'SQLite format 3', 'dos respaldos al mismo tiempo salen completos (no se pisan)');
  revisa(!fs.readdirSync(path.join(__dirname, '..')).some(f => /^saneadren_backup_.*\.db$/.test(f)), 'el respaldo no deja copias de la base en la carpeta de la aplicación');
  { // Respaldo automático: se prueba la pieza directamente con una base de prueba.
    process.env.DB_PATH = path.join(dir, 'auto', 'x.db'); process.env.RESPALDOS_DIAS = '3'; fs.mkdirSync(path.dirname(process.env.DB_PATH), { recursive: true });
    const Database = require('../server/sqlite.js'); const Base = Database.Database || Database; const db = new Base(process.env.DB_PATH); db.exec('CREATE TABLE t (x)'); db.exec("INSERT INTO t VALUES ('dato')");
    const resp = require('../server/respaldos.js')(db, { hoyMexico: () => '2026-10-15' });
    fs.mkdirSync(resp.dir, { recursive: true });
    for (const d of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) fs.writeFileSync(path.join(resp.dir, 'saneadren-' + d + '.db'), 'viejo');
    await resp.hacer(); await resp.hacer();
    const quedan = resp.lista();
    revisa(quedan.length === 3 && quedan.at(-1) === 'saneadren-2026-10-15.db' && fs.readFileSync(path.join(resp.dir, quedan.at(-1))).slice(0, 15).toString() === 'SQLite format 3', 'el respaldo automático hace la copia del día y conserva solo los últimos días', quedan);
    revisa(!fs.readdirSync(resp.dir).some(f => f.endsWith('.tmp')), 'no quedan copias a medias');
    db.close?.();
  }

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
