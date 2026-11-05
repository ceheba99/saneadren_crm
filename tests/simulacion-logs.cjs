// LOGS DEL SISTEMA (2026-11-05): entradas, salidas, contraseñas equivocadas, bloqueos, «¿Olvidaste tu contraseña?»,
// errores del servidor y quién está conectado; solo Dirección los ve. Lo tecleado en un intento con un usuario que no
// existe NO se guarda (podría ser una contraseña escrita en la casilla equivocada).
// Uso: node tests/simulacion-logs.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-logs-')), DB = path.join(dir, 'logs.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Logs-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Logs-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9850 + Math.floor(Math.random() * 100)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const filas = () => { const d = new DatabaseSync(DB); try { return d.prepare('SELECT * FROM registro_sistema ORDER BY id').all(); } finally { d.close(); } };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'crear gerente');
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Victor Ventas', correo: 'victor@saneadren.com.mx', password: CLAVE, rol: 'ventas', sucursales: [qro.id] }), 'crear ventas');
  const G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar Gema').token;

  console.log('1. Accesos');
  let f = filas();
  const entro = f.filter(r => r.evento === 'entro');
  revisa(entro.length === 2 && entro[0].usuario === 'admin' && entro[1].usuario === 'Gema Gerente' && entro[0].equipo === 'Chrome · Windows' && entro[0].ip, 'Cada entrada queda con usuario, IP y equipo', entro);
  revisa(!f.some(r => JSON.stringify(r).includes(ADMIN.password) || JSON.stringify(r).includes(CLAVE)), 'Ninguna contraseña queda en el registro');
  await pedir('POST', '/login', null, { nombre: 'Victor Ventas', password: 'equivocada-1' });
  f = filas(); let u = f.at(-1);
  revisa(u.evento === 'fallo' && u.usuario === 'Victor Ventas' && u.nivel === 'aviso', 'Contraseña equivocada de alguien que existe: queda a su nombre', u);
  await pedir('POST', '/login', null, { nombre: 'MiClaveSuperSecreta2026', password: 'x' });
  f = filas(); u = f.at(-1);
  revisa(u.evento === 'desconocido' && !u.usuario && !JSON.stringify(f).includes('MiClaveSuperSecreta2026'), 'Usuario que no existe: no se guarda lo que se tecleó', u);
  await pedir('POST', '/login', null, { nombre: 'victor@saneadren.com.mx', password: 'equivocada-correo' });
  u = filas().at(-1);
  revisa(u.evento === 'fallo' && u.usuario === 'Victor Ventas', 'Si entra con su correo, el fallo también queda a su nombre', u);
  for (let i = 0; i < 5; i++) await pedir('POST', '/login', null, { nombre: 'Victor Ventas', password: 'equivocada-' + i });
  f = filas();
  const bloq = f.filter(r => r.evento === 'bloqueado');
  revisa(bloq.length === 1 && bloq[0].usuario === 'Victor Ventas' && bloq[0].nivel === 'grave' && /5 min/.test(bloq[0].detalle), 'Al sexto intento seguido queda el bloqueo, a nombre de la persona', bloq);
  for (let i = 0; i < 3; i++) revisa((await pedir('POST', '/login', null, { nombre: 'Victor Ventas', password: CLAVE }))[0] === 429, 'Bloqueado aunque ponga la buena (' + (i + 1) + ')');
  f = filas();
  revisa(f.filter(r => r.evento === 'rechazado').length === 1, 'Los intentos estando bloqueado se anotan una sola vez por minuto (no llenan el registro)', f.filter(r => r.evento === 'rechazado'));
  await pedir('POST', '/olvide-password', null, { correo: 'victor@saneadren.com.mx' });
  await pedir('POST', '/olvide-password', null, { correo: 'nadie@saneadren.com.mx' });
  f = filas();
  revisa(f.filter(r => r.evento === 'olvido').length === 1 && f.find(r => r.evento === 'olvido').usuario === 'Victor Ventas' && !JSON.stringify(f).includes('nadie@'), '«¿Olvidaste tu contraseña?» queda solo si el correo es de alguien');
  exigir(await pedir('POST', '/logout', G, {}), 'salir Gema');
  f = filas(); u = f.at(-1);
  revisa(u.evento === 'salio' && u.usuario === 'Gema Gerente', 'La salida queda registrada', u);

  console.log('2. Quién los ve');
  const G2 = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar Gema otra vez').token;
  revisa((await pedir('GET', '/registro-sistema', G2))[0] === 403, 'El Gerente no ve los logs');
  revisa((await pedir('GET', '/registro-sistema', null))[0] === 401, 'Sin sesión, nada');
  let [s, j] = await pedir('GET', '/registro-sistema', A);
  revisa(s === 200 && j.resumen.entradas === 3 && j.resumen.fallos === 8 && j.resumen.bloqueos === 1 && j.resumen.errores === 0, 'Dirección ve el resumen de 24 h', j.resumen);
  revisa(j.conectados.some(c => c.nombre === 'admin' && c.equipo === 'Chrome · Windows') && j.conectados.some(c => c.nombre === 'Gema Gerente') && !j.conectados.some(c => c.nombre === 'Victor Ventas'), 'Conectados ahora: admin y Gema, no Victor', j.conectados);
  [s, j] = await pedir('GET', '/registro-sistema?tipo=fallas', A);
  revisa(j.filas.length && j.filas.every(r => r.nivel !== 'info'), 'Filtro «solo problemas»', j.filas.map(r => r.evento));
  [s, j] = await pedir('GET', '/registro-sistema?q=Gema', A);
  revisa(j.filas.length === 3 && j.filas.every(r => r.usuario === 'Gema Gerente'), 'Buscar por usuario', j.filas.map(r => r.evento));

  console.log('3. Errores del servidor');
  const reg = require('../server/registro-sistema.js');
  const mem = new DatabaseSync(':memory:');
  mem.exec('CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT, correo TEXT); CREATE TABLE sesiones (token_hash TEXT, usuario_id INTEGER, expira INTEGER)');
  const r = reg({ get() {} }, mem, fn => fn);
  r.error({ method: 'POST', originalUrl: '/api/leads/5?token=abc', ipCliente: '1.2.3.4', usuarioSesion: { id: 1, nombre: 'admin' }, get: () => UA }, new Error('no such column:  x'));
  r.error(null, new Error('fallo sin petición'));
  const e = mem.prepare('SELECT * FROM registro_sistema ORDER BY id').all();
  revisa(e[0].tipo === 'error' && e[0].nivel === 'grave' && e[0].detalle === 'POST /api/leads/5 · no such column: x' && e[0].usuario === 'admin', 'Un error queda con la ruta (sin lo que va después de «?») y el mensaje', e[0]);
  revisa(e[1].detalle === 'servidor · fallo sin petición', 'También los errores sin petición', e[1]);
  revisa(reg.equipo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1') === 'Safari · iPhone'
    && reg.equipo('curl/8.4.0') === 'Programa' && reg.equipo('') === '', 'El equipo se reconoce sin guardar la cadena completa');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
