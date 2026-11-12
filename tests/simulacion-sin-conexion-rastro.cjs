// CHECADAS SIN CONEXIÓN QUE EL SERVIDOR NO ACEPTA (auditoría del checador, 2026-11-12).
// Antes: si el PIN estaba mal tecleado, la checada guardada en la tableta se borraba con su foto y en la bitácora solo
// quedaba «Kiosco X: Código o PIN incorrecto» (sin persona ni hora); y una checada BUENA se borraba si subía mientras el
// PIN estaba bloqueado. Ahora: lo rechazado queda en «Intentos fallidos» (persona, botón, hora estimada y foto) y en la
// bitácora de la persona; con el PIN bloqueado la checada NO se descarta (la tableta la vuelve a subir).
// Uso: node tests/simulacion-sin-conexion-rastro.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sinconexion-')), DB = path.join(dir, 's.db');
const ADMIN = { password: 'SinRed-' + crypto.randomBytes(6).toString('hex') + '-9Q' }, CLAVE = 'Clave-SinRed-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9560 + Math.floor(Math.random() * 180)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: 'marketing@saneadren.com.mx', ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, hd = {}) => { const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...hd }, body: b === undefined ? undefined : JSON.stringify(b) }); const tx = await x.text(); let j = {}; try { j = JSON.parse(tx); } catch { /* */ } return [x.status, j, tx]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const MARCA = 'FOTO-RASTRO-' + crypto.randomBytes(6).toString('hex');
const FOTO = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(MARCA), crypto.randomBytes(3000), Buffer.from([0xff, 0xd9])]).toString('base64');
const uid = () => crypto.randomBytes(15).toString('base64url');

(async () => {
  for (let i = 0; i < 200 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'crear gerente');
  const G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar gerente').token;
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente']);
  const ana = exigir(await pedir('POST', '/personal', G, { nombre: 'Ana López Técnica', puesto: 'Operador' }), 'alta de Ana');
  const alta = exigir(await pedir('POST', '/asistencia/personal/' + ana.id + '/pin', G), 'alta en el checador');
  const K = exigir(await pedir('POST', '/asistencia/dispositivos', G, { nombre: 'Entrada Querétaro', sucursal_id: qro.id }), 'kiosco').token;
  const kio = (r, b) => pedir('POST', '/publico/kiosco/' + r, null, b, { 'X-Kiosco': K });
  const PIN = '7391';
  exigir(await kio('cambiar-pin', { ticket: exigir(await kio('identificar', { codigo: alta.codigo, pin: alta.pin }), 'identificar').ticket, nuevo: PIN }), 'elegir PIN');
  const intentos = () => conBase(d => d.prepare('SELECT * FROM checador_intentos ORDER BY id').all());
  const fallos = () => conBase(d => d.prepare('SELECT pin_fallos FROM personal WHERE id = ?').get(ana.id).pin_fallos);

  console.log('1. Checada sin conexión con el PIN mal tecleado: se rechaza, pero queda el rastro');
  const u1 = uid(), hace = 3600000;
  const [s1, j1] = await kio('sin-conexion', { uid: u1, codigo: alta.codigo, pin: '5555', tipo: 'entrada', foto: FOTO, edad_ms: hace, monotonica: true });
  revisa(s1 === 401 && j1.descartar === true, 'El servidor la rechaza y la tableta la descarta', [s1, j1]);
  let li = intentos(); const i1 = li.at(-1) || {};
  revisa(li.length === 1 && i1.personal_id === ana.id && i1.codigo === alta.codigo && /sin conexión/i.test(i1.motivo), 'Queda en «Intentos fallidos» con la persona y su código', i1);
  revisa(/Entrada/.test(i1.detalle || '') && Math.abs(Date.parse(i1.momento_utc) - (Date.now() - hace)) < 60000, 'Con el botón que marcó y la hora en que lo hizo (hace una hora)', i1);
  revisa(!!i1.foto_archivo, 'Con la foto que tomó la tableta', i1.foto_archivo);
  const fx = await fetch(URLB + '/api/asistencia/intentos/' + i1.id + '/foto', { headers: { Authorization: 'Bearer ' + G } });
  revisa(fx.status === 200 && Buffer.from(await fx.arrayBuffer()).includes(MARCA), 'La gerente ve esa foto');
  const [, lista] = await pedir('GET', '/asistencia/intentos?fecha=' + i1.fecha, G);
  revisa(Array.isArray(lista) && lista.some(x => x.id === i1.id && x.persona === 'Ana López Técnica' && x.tiene_foto), 'Sale en la lista de intentos del día con su nombre', lista);
  const aud = (await pedir('GET', '/auditoria?entidad=personal&id=' + ana.id, A))[2];
  revisa(/checada sin conexión rechazada/.test(aud) && /Entrada/.test(aud), 'Y en la bitácora de la persona (qué botón y a qué hora)', aud.slice(-400));
  const f1 = fallos();
  const [s1b, j1b] = await kio('sin-conexion', { uid: u1, codigo: alta.codigo, pin: '5555', tipo: 'entrada', foto: FOTO, edad_ms: hace + 20000, monotonica: true });
  revisa(s1b === 401 && j1b.descartar === true && intentos().length === 1 && fallos() === f1, 'Si la tableta la reintenta (no le llegó la respuesta), no se anota dos veces ni cuenta otro fallo de PIN', [s1b, intentos().length, fallos(), f1]);

  console.log('2. Una checada BUENA que sube mientras el PIN está bloqueado no se pierde');
  for (let i = 0; i < 4; i++) await kio('identificar', { codigo: alta.codigo, pin: '5556' }); // con el de arriba: 5 fallos → bloqueado 15 min
  const u2 = uid();
  const [s2, j2] = await kio('sin-conexion', { uid: u2, codigo: alta.codigo, pin: PIN, tipo: 'salida', foto: FOTO, edad_ms: 2 * 3600000, monotonica: true });
  revisa(s2 === 423 && !j2.descartar, 'Con el PIN bloqueado la tableta NO la descarta (la vuelve a subir después)', [s2, j2]);
  exigir(await pedir('POST', '/asistencia/personal/' + ana.id + '/desbloquear', G), 'desbloquear');
  const [s2b, j2b] = await kio('sin-conexion', { uid: u2, codigo: alta.codigo, pin: PIN, tipo: 'salida', foto: FOTO, edad_ms: 2 * 3600000 + 60000, monotonica: true });
  revisa(s2b === 201 && conBase(d => d.prepare('SELECT COUNT(*) n FROM checadas WHERE uid_kiosco = ?').get(u2).n) === 1, 'Al desbloquear el PIN, la misma checada sube y queda guardada', [s2b, j2b]);

  console.log('3. Otros rechazos también dejan rastro');
  const antes = intentos().length;
  const [s3, j3] = await kio('sin-conexion', { uid: uid(), codigo: alta.codigo, pin: PIN, tipo: 'entrada', foto: FOTO, edad_ms: 8 * 86400000 });
  const i3 = intentos().at(-1);
  revisa(s3 === 400 && j3.descartar && intentos().length === antes + 1 && i3.personal_id === ana.id && /7 días/.test(i3.detalle || ''), 'Una checada de hace más de 7 días se descarta, pero queda anotado de quién era', i3);
  const [s4, j4] = await kio('sin-conexion', { uid: uid(), codigo: '0000', pin: '1357', tipo: 'entrada', edad_ms: 1000 });
  const i4 = intentos().at(-1);
  revisa(s4 === 401 && j4.descartar && i4.personal_id === null && i4.codigo === '0000', 'Con un código que no existe queda anotado el código tecleado', i4);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE estado <> 'anulada'").get().n) === 1, 'Nada de lo rechazado se guardó como checada');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); srv.kill(); process.exit(1); });
