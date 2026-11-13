// TABLETA SIN INTERNET (auditoría del checador, 2026-11-12): el PIN de una checada que espera a subir va CERRADO con la
// llave pública del servidor (la tableta no lo guarda en claro) y quien entra con la cara también puede checar sin
// internet (su cara, cerrada, se compara al subir). Se usa el código real de la tableta para cerrar (public/kiosco.html).
// Uso: node tests/simulacion-tableta-sin-internet.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tableta-')), DB = path.join(dir, 't.db');
const ADMIN = { password: 'Tableta-' + crypto.randomBytes(6).toString('hex') + '-9Q' }, CLAVE = 'Clave-Tableta-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9150 + Math.floor(Math.random() * 180)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: 'marketing@saneadren.com.mx', ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, hd = {}) => { const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...hd }, body: b === undefined ? undefined : JSON.stringify(b) }); const tx = await x.text(); let j = {}; try { j = JSON.parse(tx); } catch { /* */ } return [x.status, j, tx]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const FOTO = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000), Buffer.from([0xff, 0xd9])]).toString('base64');
const uid = () => crypto.randomBytes(15).toString('base64url');
// Caras simuladas: 128 números; «la misma persona» = el mismo vector con poco ruido.
const normal = v => { const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map(x => x / m); };
const cara = () => normal(Array.from({ length: 128 }, () => Math.random() - 0.5));
const parecida = (v, ruido = 0.008) => normal(v.map(x => x + (Math.random() - 0.5) * ruido * 2));
// El código real de la tableta que cierra el PIN o la cara.
const html = fs.readFileSync(path.join(__dirname, '../public/kiosco.html'), 'utf8');
const tramo = html.slice(html.indexOf('  // ---------- Memoria de la tableta y candado de la cola'), html.indexOf('  // ---------- Sin conexión: cola en IndexedDB'));
function tableta(llave) {
  const c = vm.createContext({ crypto: crypto.webcrypto, TextEncoder, btoa, atob, Uint8Array, Date, JSON, Object, String, localStorage: { getItem: k => (k === 'saneadren_kiosco_llave_cola' ? llave : null), setItem() {} } });
  vm.runInContext(tramo + '\n;this.sellar = sellar;', c); return c.sellar;
}

(async () => {
  for (let i = 0; i < 200 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'crear gerente');
  const G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar gerente').token;
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente']);
  const K = exigir(await pedir('POST', '/asistencia/dispositivos', G, { nombre: 'Entrada Querétaro', sucursal_id: qro.id }), 'kiosco').token;
  const kio = (r, b) => pedir(b ? 'POST' : 'GET', '/publico/kiosco/' + r, null, b, { 'X-Kiosco': K });
  const alta = async nombre => {
    const p = exigir(await pedir('POST', '/personal', G, { nombre, puesto: 'Operador' }), 'alta ' + nombre), a = exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', G), 'pin');
    return { ...p, codigo: a.codigo, pinTemporal: a.pin };
  };
  const ana = await alta('Ana López Técnica'), beto = await alta('Beto Ruiz Ayudante');
  const PIN = '7391';
  exigir(await kio('cambiar-pin', { ticket: exigir(await kio('identificar', { codigo: ana.codigo, pin: ana.pinTemporal }), 'identificar').ticket, nuevo: PIN }), 'elegir PIN');
  exigir(await kio('cambiar-pin', { ticket: exigir(await kio('identificar', { codigo: beto.codigo, pin: beto.pinTemporal }), 'identificar').ticket, nuevo: '8264' }), 'elegir PIN de Beto');
  const checada = id => conBase(d => d.prepare('SELECT * FROM checadas WHERE id = ?').get(id) || {});
  const intentos = () => conBase(d => d.prepare('SELECT * FROM checador_intentos ORDER BY id').all());

  console.log('1. El PIN viaja y espera cerrado');
  const est = exigir(await kio('estado'), 'estado');
  revisa(typeof est.llave_cola === 'string' && Buffer.from(est.llave_cola, 'base64').length === 65, 'El servidor le da a la tableta su llave pública');
  revisa(!/llave_cola/.test((await pedir('GET', '/publico/kiosco/estado', null))[2]), 'Sin ser un kiosco registrado no se entrega nada');
  const sellar = tableta(est.llave_cola);
  const u1 = uid(), s1 = await sellar(u1, { pin: PIN });
  revisa(!!s1 && !JSON.stringify(s1).includes(PIN), 'La tableta cierra el PIN: lo guardado no lo deja ver', s1);
  const [e1, j1] = await kio('sin-conexion', { uid: u1, codigo: ana.codigo, secreto: s1, tipo: 'entrada', foto: FOTO, edad_ms: 3600000, monotonica: true });
  revisa(e1 === 201 && checada(j1.id).personal_id === ana.id && checada(j1.id).sin_conexion === 1 && checada(j1.id).estado === 'por_revisar', 'La checada con el PIN cerrado sube y se guarda (por revisar, como toda checada sin conexión)', [e1, j1]);
  const [e1b, j1b] = await kio('sin-conexion', { uid: u1, codigo: ana.codigo, secreto: s1, tipo: 'entrada', foto: FOTO, edad_ms: 3660000, monotonica: true });
  revisa(e1b === 200 && j1b.repetida && j1b.id === j1.id, 'Si la tableta la repite, no se duplica', [e1b, j1b]);
  const u2 = uid(), [e2, j2] = await kio('sin-conexion', { uid: u2, codigo: ana.codigo, secreto: await sellar(u2, { pin: '5555' }), tipo: 'salida', foto: FOTO, edad_ms: 1800000, monotonica: true });
  revisa(e2 === 401 && j2.descartar && intentos().at(-1).personal_id === ana.id, 'Con el PIN equivocado (cerrado) se rechaza y queda en «Intentos fallidos»', [e2, j2]);
  const u3 = uid(), s3 = await sellar(u3, { pin: PIN });
  const [e3, j3] = await kio('sin-conexion', { uid: uid(), codigo: ana.codigo, secreto: s3, tipo: 'salida', edad_ms: 1000 });
  revisa(e3 === 409 && j3.descartar, 'Lo cerrado para una checada no sirve en otra (no se puede reusar)', [e3, j3]);
  const roto = { ...s3, c: Buffer.from(s3.c, 'base64').map((x, i) => (i === 3 ? x ^ 1 : x)).toString('base64') };
  const [e4, j4] = await kio('sin-conexion', { uid: u3, codigo: ana.codigo, secreto: roto, tipo: 'salida', edad_ms: 1000 });
  revisa(e4 === 409 && j4.descartar && /abrir/.test(j4.error), 'Si alguien altera lo guardado, no se abre y se rechaza', [e4, j4]);
  const u5 = uid(), [e5, j5] = await kio('sin-conexion', { uid: u5, codigo: ana.codigo, pin: PIN, tipo: 'comida_sale', foto: FOTO, edad_ms: 600000, monotonica: true });
  revisa(e5 === 201, 'Una tableta que aún no se actualiza (manda el PIN como antes) sigue funcionando', [e5, j5]);

  console.log('2. Quien entra con la cara también checa sin internet');
  exigir(await pedir('PUT', '/asistencia/personal/' + ana.id + '/biometria/consentimiento', G, { firmado: true }), 'consentimiento');
  const cod = exigir(await pedir('POST', '/asistencia/personal/' + ana.id + '/biometria/codigo', G), 'código de cara').codigo;
  const ANA = cara();
  exigir(await kio('rostro-registrar', { codigo: cod, descriptores: [parecida(ANA), parecida(ANA), parecida(ANA)], vivo: true }), 'registrar cara');
  const rostro = (v, vivo = true) => ({ descriptor: v, descriptores: [v], vivo, diag: {} });
  const u6 = uid(), [e6, j6] = await kio('sin-conexion', { uid: u6, codigo: ana.codigo, secreto: await sellar(u6, { rostro: rostro(parecida(ANA)) }), tipo: 'comida_regresa', foto: FOTO, edad_ms: 300000, monotonica: true });
  const c6 = checada(j6.id);
  revisa(e6 === 201 && c6.personal_id === ana.id && c6.biometria === 'coincide' && c6.estado === 'por_revisar' && /Sin conexión/.test(c6.observaciones), 'Su cara (cerrada) coincide al subir: la checada se guarda sin PIN', [e6, j6, c6.biometria]);
  const antes = intentos().length;
  const u7 = uid(), [e7, j7] = await kio('sin-conexion', { uid: u7, codigo: ana.codigo, secreto: await sellar(u7, { rostro: rostro(cara()) }), tipo: 'salida', foto: FOTO, edad_ms: 200000, monotonica: true });
  revisa(e7 === 401 && j7.descartar && /no coincide/.test(j7.error) && intentos().length === antes + 1 && /cara/.test(intentos().at(-1).detalle) && !!intentos().at(-1).foto_archivo, 'La cara de otra persona no pasa: se rechaza y queda en «Intentos fallidos» con su foto', [e7, j7]);
  const u8 = uid(), [e8, j8] = await kio('sin-conexion', { uid: u8, codigo: ana.codigo, secreto: await sellar(u8, { rostro: rostro(parecida(ANA), false) }), tipo: 'salida', edad_ms: 100000 });
  revisa(e8 === 401 && j8.descartar && /prueba de vida/.test(j8.error), 'Sin prueba de vida (foto o pantalla) tampoco pasa', [e8, j8]);
  const u9 = uid(), [e9, j9] = await kio('sin-conexion', { uid: u9, codigo: beto.codigo, secreto: await sellar(u9, { rostro: rostro(parecida(ANA)) }), tipo: 'entrada', edad_ms: 100000 });
  revisa(e9 === 409 && j9.descartar, 'Quien no tiene la cara registrada no checa «con la cara»', [e9, j9]);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE estado <> 'anulada'").get().n) === 3, 'Solo se guardaron las tres checadas buenas');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); srv.kill(); process.exit(1); });
