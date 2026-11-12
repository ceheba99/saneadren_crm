// ETAPA 6 DE LA AUDITORÍA (2026-11-12, regla aprobada por Dirección): Personal y reloj checador.
//  · A-04: quien edita Personal ya no cambia su propio sueldo ni datos de pago, ni se desliga de su ficha (para luego
//    corregirse la asistencia). Quien no tiene su ficha ligada no cambia sueldos ni da PIN ni enlaces (no se sabría
//    cuál es la suya).
//  · FLW-H08 / SEC-04: reiniciar un PIN que ya existe, mandar el enlace del celular y dar el código de la cara piden
//    «Corregir asistencia» (con solo «Editar personal» ya no). La primera alta en el checador sigue con «Editar
//    personal». Nada de eso sobre uno mismo. Dirección sí (no tiene a quién pedírselo).
// Uso: node tests/simulacion-etapa6-personal.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-etapa6-')), DB = path.join(dir, 'e6.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Etapa6-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Etapa6-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(10150 + Math.floor(Math.random() * 200)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const d = new Date(HOY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const conDigito = p17 => { const w = [3, 7, 1]; let s = 0; for (let i = 0; i < 17; i++) s += (Number(p17[i]) * w[i % 3]) % 10; return p17 + ((10 - (s % 10)) % 10); };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const rol = async (nombre, permisos) => { const x = exigir(await pedir('POST', '/roles', A, { nombre }), 'rol ' + nombre); exigir(await pedir('PUT', '/roles/' + x.clave + '/permisos', A, { permisos, alcances: {} }), 'permisos ' + nombre); return x.clave; };
  const SUP = await rol('Supervisor de campo', ['personal.ver', 'personal.editar']);
  const RH = await rol('Recursos humanos', ['personal.ver', 'personal.editar', 'personal.sensibles']);
  const T = {}, ID = {};
  for (const [nombre, r] of [['Gabriela Gerente', 'gerente'], ['Sergio Supervisor', SUP], ['Rita Humanos', RH], ['Tomas Sinficha', RH]]) {
    const u = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol: r, sucursales: [qro.id] }), 'usuario ' + nombre);
    const k = nombre.split(' ')[0]; ID[k] = u.id; T[k] = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  }
  // Fichas: Gabriela, Sergio y Rita ligadas a su usuario (las liga Dirección); Tomás no tiene ficha ligada.
  const ficha = async (nombre, extra = {}) => exigir(await pedir('POST', '/personal', A, { nombre, puesto: 'Administración', sucursal_id: qro.id, fecha_ingreso: dia(-300), ...extra }), 'ficha ' + nombre);
  const fG = await ficha('Gabriela Gerente', { usuario_id: ID.Gabriela, salario: 15000, clabe: conDigito('07218000123456789') });
  const fS = await ficha('Sergio Supervisor', { usuario_id: ID.Sergio });
  const fR = await ficha('Rita Humanos', { usuario_id: ID.Rita, salario: 12000 });
  const fT = await ficha('Tomas Sinficha', { salario: 11000 }); // es Tomás, pero nadie ligó su usuario
  const pedro = await ficha('Pedro Operador', { puesto: 'Operador', salario: 9000 });
  const nuevo = await ficha('Nora Nueva', { puesto: 'Ayudante' }); // sin PIN todavía
  const pinPedro = exigir(await pedir('POST', '/asistencia/personal/' + pedro.id + '/pin', A), 'PIN de Pedro');
  const leer = async id => (await pedir('GET', '/personal/' + id, A))[1];

  console.log('A-04 · Nadie cambia su propio sueldo ni se desliga de su ficha');
  let r = await pedir('PUT', '/personal/' + fG.id, T.Gabriela, { salario: 99999 });
  revisa(r[0] === 403 && (await leer(fG.id)).salario === 15000, 'La gerente NO se sube el sueldo (403 y sigue en $15,000)', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + fG.id, T.Gabriela, { clabe: conDigito('01218000999999999') });
  revisa(r[0] === 403, 'La gerente NO cambia su propia CLABE', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + fG.id, T.Gabriela, { bono_semanal: 5000 });
  revisa(r[0] === 403, 'La gerente NO se pone bono semanal', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + fG.id, T.Gabriela, { usuario_id: null });
  revisa(r[0] === 403 && (await leer(fG.id)).usuario_id === ID.Gabriela, 'La gerente NO se desliga de su ficha (403 y sigue ligada)', [r[0], r[1]]);
  r = await pedir('POST', '/asistencia/checadas', T.Gabriela, { personal_id: fG.id, tipo: 'entrada', fecha: dia(-1), hora: '08:00', motivo: 'Me corrijo yo' });
  revisa(r[0] === 403, 'Por eso sigue sin poder agregarse una checada a sí misma', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + fS.id, T.Sergio, { usuario_id: null });
  revisa(r[0] === 403, 'El supervisor (sin datos sensibles) tampoco se desliga de su ficha', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + fR.id, T.Rita, { salario: 50000 });
  revisa(r[0] === 403, 'RH tampoco se sube su propio sueldo', [r[0], r[1]]);
  { const f = await leer(fG.id); r = await pedir('PUT', '/personal/' + fG.id, T.Gabriela, { ...f, telefono: '442 111 2233' });
    revisa(r[0] === 200 && r[1].telefono === '442 111 2233', 'Sí puede guardar su ficha con sus datos de pago sin cambio (p. ej. su teléfono)', [r[0], r[1].error]); }
  r = await pedir('PUT', '/personal/' + pedro.id, T.Gabriela, { salario: 9500 });
  revisa(r[0] === 200 && r[1].salario === 9500, 'La gerente sí cambia el sueldo de otra persona', [r[0], r[1].error]);
  r = await pedir('PUT', '/personal/' + pedro.id, T.Sergio, { usuario_id: ID.Sergio });
  revisa(r[0] === 403 || r[0] === 409, 'Nadie liga su propio usuario a otra ficha', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + fG.id, A, { salario: 16000 });
  revisa(r[0] === 200, 'Dirección sí cambia sueldos', [r[0], r[1].error]);

  console.log('Regla A · Quien no tiene su ficha ligada no cambia sueldos ni da PIN');
  r = await pedir('PUT', '/personal/' + fT.id, T.Tomas, { salario: 80000 });
  revisa(r[0] === 403 && (await leer(fT.id)).salario === 11000, 'Tomás (RH, ficha sin ligar) NO se sube el sueldo en su propia ficha', [r[0], r[1]]);
  r = await pedir('PUT', '/personal/' + pedro.id, T.Tomas, { salario: 1 });
  revisa(r[0] === 403 && /lig/i.test(r[1].error || ''), 'Ni el de nadie, y el mensaje le dice que primero liguen su ficha', [r[0], r[1]]);
  r = await pedir('POST', '/personal', T.Tomas, { nombre: 'Alta Con Sueldo', puesto: 'Ayudante', salario: 7000 });
  revisa(r[0] === 403, 'Ni da de alta a alguien con sueldo', [r[0], r[1]]);
  r = await pedir('POST', '/personal', T.Tomas, { nombre: 'Alta Sin Sueldo', puesto: 'Ayudante' });
  revisa(r[0] === 201, 'Sí da de alta a alguien sin datos de pago');
  r = await pedir('PUT', '/personal/' + fT.id, T.Tomas, { usuario_id: ID.Tomas });
  revisa(r[0] === 403, 'Tampoco se liga él solo a su ficha', [r[0], r[1]]);
  r = await pedir('POST', '/asistencia/personal/' + nuevo.id + '/pin', T.Tomas);
  revisa(r[0] === 403, 'Ni da de alta en el checador (no se sabe cuál es su ficha)', [r[0], r[1]]);
  r = await pedir('POST', '/rh/importar/revisar', T.Tomas, { filas: [{ nombre: 'Lote Checador', puesto: 'Ayudante', sucursal: qro.clave, checador: 'Sí' }] });
  revisa(r[0] === 200 && r[1].hay_errores, 'En la carga de Excel, la fila con «Checador: Sí» le sale con error', [r[0], r[1]]);
  exigir(await pedir('PUT', '/personal/' + fT.id, A, { usuario_id: ID.Tomas }), 'Dirección liga a Tomás');
  r = await pedir('PUT', '/personal/' + pedro.id, T.Tomas, { salario: 9600 });
  revisa(r[0] === 200, 'Ya ligado por Dirección, Tomás sí cambia el sueldo de otra persona', [r[0], r[1].error]);

  console.log('FLW-H08 / SEC-04 · PIN, enlace del celular y código de la cara');
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/pin', T.Sergio);
  revisa(r[0] === 403 && !r[1].pin, 'El supervisor (solo «Editar personal») NO reinicia el PIN de Pedro', [r[0], r[1]]);
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/celular', T.Sergio);
  revisa(r[0] === 403 && !r[1].ruta, 'Ni le genera el enlace del celular', [r[0], r[1]]);
  exigir(await pedir('PUT', '/asistencia/personal/' + pedro.id + '/biometria/consentimiento', A, { firmado: true }), 'consentimiento de Pedro');
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/biometria/codigo', T.Sergio);
  revisa(r[0] === 403 && !r[1].codigo, 'Ni le da el código para registrar su cara', [r[0], r[1]]);
  { // El PIN de Pedro sigue siendo el suyo: entra al kiosco con él.
    const kio = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Kiosco etapa 6', sucursal_id: qro.id }), 'kiosco');
    const x = await fetch(URLB + '/api/publico/kiosco/identificar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kiosco': kio.token }, body: JSON.stringify({ codigo: pinPedro.codigo, pin: pinPedro.pin }) });
    revisa(x.status === 200, 'Pedro sigue entrando con su PIN (nadie se lo cambió)', x.status); }
  r = await pedir('POST', '/asistencia/personal/' + nuevo.id + '/pin', T.Sergio);
  revisa(r[0] === 200 && /^\d{4}$/.test(r[1].pin || ''), 'El supervisor sí da la PRIMERA alta en el checador a quien no tiene PIN', [r[0], r[1].error]);
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/desbloquear', T.Sergio);
  revisa(r[0] === 200, 'Y sigue pudiendo desbloquear un PIN (no cambia el PIN)', [r[0], r[1].error]);
  r = await pedir('POST', '/asistencia/personal/' + fG.id + '/pin', T.Gabriela);
  revisa(r[0] === 403, 'La gerente NO se da de alta a sí misma en el checador', [r[0], r[1]]);
  exigir(await pedir('POST', '/asistencia/personal/' + fG.id + '/pin', A), 'Dirección le da su PIN a la gerente');
  r = await pedir('POST', '/asistencia/personal/' + fG.id + '/pin', T.Gabriela);
  revisa(r[0] === 403, 'Ni se reinicia su propio PIN', [r[0], r[1]]);
  r = await pedir('POST', '/asistencia/personal/' + fG.id + '/celular', T.Gabriela);
  revisa(r[0] === 403, 'Ni se manda el enlace del celular', [r[0], r[1]]);
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/pin', T.Gabriela);
  revisa(r[0] === 200 && r[1].pin, 'La gerente («Corregir asistencia») sí reinicia el PIN de Pedro', [r[0], r[1].error]);
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/celular', T.Gabriela);
  revisa(r[0] === 200 && r[1].ruta, 'Y le manda el enlace del celular', [r[0], r[1].error]);
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/biometria/codigo', T.Gabriela);
  revisa(r[0] === 200 && r[1].codigo, 'Y le da el código de la cara', [r[0], r[1].error]);
  r = await pedir('POST', '/asistencia/personal/' + pedro.id + '/pin', A);
  revisa(r[0] === 200, 'Dirección también');

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); await espera(200); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
