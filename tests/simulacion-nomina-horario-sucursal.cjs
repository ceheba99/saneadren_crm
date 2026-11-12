// NÓMINA: SIN HORARIO Y CAMBIO DE SUCURSAL (auditoría del checador, 2026-11-12).
//  · Quien checa y no tiene horario asignado no tiene faltas ni retardos (no hay contra qué compararlo): antes ganaba el
//    bono de puntualidad sin checar un solo día y la nómina no lo marcaba. Ahora es un pendiente y no gana el bono.
//  · Quien cambia de sucursal después de que su sucursal anterior cerró o pagó la semana ya no entra otra vez en la
//    nómina de esa misma semana en la sucursal nueva (se pagaba dos veces).
// Uso: node tests/simulacion-nomina-horario-sucursal.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-nomhor-')), DB = path.join(dir, 'n.db');
const ADMIN = { password: 'NomHor-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const PUERTO = String(9340 + Math.floor(Math.random() * 180)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: 'marketing@saneadren.com.mx', ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => { const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const tx = await x.text(); let j = {}; try { j = JSON.parse(tx); } catch { /* */ } return [x.status, j]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 200 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const ficha = async (nombre, extra) => exigir(await pedir('POST', '/personal', A, { nombre, puesto: 'Operador', sucursal_id: qro.id, fecha_ingreso: dia(-200), bono_semanal: 500, ...extra }), 'ficha ' + nombre);
  const juan = await ficha('Juan Sin Horario'), luis = await ficha('Luis Con Horario'), pedro = await ficha('Pedro Se Cambia', { puesto: 'Ayudante' });
  exigir(await pedir('PUT', '/asistencia/personal/' + pedro.id, A, { checa: false }), 'Pedro no checa');
  const op = (await pedir('GET', '/asistencia/horarios', A))[1].horarios.find(x => x.nombre === 'Operaciones' && x.sucursal_id === qro.id);
  exigir(await pedir('PUT', '/asistencia/personal/' + luis.id + '/horario', A, { horario_id: op.id, desde: dia(-60) }), 'horario de Luis');
  exigir(await pedir('POST', '/nomina/reglas-puntualidad', A, { sucursal_id: qro.id, puesto: 'Operador', monto: 300, max_retardos: 0, max_faltas: 0, desde: dia(-60) }), 'regla de puntualidad');

  console.log('1. Checa y no tiene horario: no gana la puntualidad y sale como pendiente');
  const SEM = '/nomina?desde=' + dia(-7) + '&sucursal=' + qro.id;
  let r = exigir(await pedir('GET', SEM, A), 'ver la nómina');
  const de = (x, nombre) => x.lineas.find(l => l.nombre === nombre);
  const lj = de(r, 'Juan Sin Horario'), ll = de(r, 'Luis Con Horario');
  revisa(ll && ll.puntualidad === 0 && /No lo ganó/.test(ll.puntualidad_razon || '') && ll.faltas > 0, 'Luis (con horario, no checó en toda la semana) tiene faltas y no gana el bono', ll);
  revisa(lj && lj.puntualidad === 0, 'Juan (sin horario, tampoco checó) NO gana el bono de puntualidad', lj && [lj.puntualidad, lj.puntualidad_razon]);
  revisa(lj && /horario/i.test(lj.puntualidad_razon || ''), 'La razón dice que no tiene horario asignado', lj?.puntualidad_razon);
  revisa(lj && lj.pendientes.some(x => /horario/i.test(x)), 'Y sale como pendiente de la nómina', lj?.pendientes);
  revisa(ll && !ll.pendientes.some(x => /horario/i.test(x)), 'Quien sí tiene horario no lleva ese pendiente', ll?.pendientes);
  const nq = exigir(await pedir('POST', '/nomina/preparar', A, { desde: dia(-7), sucursal_id: qro.id }), 'preparar Querétaro');
  const [sc, jc] = await pedir('POST', '/nomina/' + nq.id + '/cerrar', A, {});
  revisa(sc === 409 && jc.codigo === 'PENDIENTES' && /Juan Sin Horario/.test(jc.error) && /horario/i.test(jc.error), 'La nómina no se cierra sin resolverlo (o sin que Dirección la fuerce)', jc);

  console.log('2. Cambia de sucursal después de que su sucursal cerró la semana: no se paga dos veces');
  const cerrada = exigir(await pedir('POST', '/nomina/' + nq.id + '/cerrar', A, { forzar: true, motivo: 'Prueba: se cierra con pendientes' }), 'cerrar Querétaro');
  revisa(cerrada.estado === 'cerrada' && !!de(cerrada, 'Pedro Se Cambia') && de(cerrada, 'Pedro Se Cambia').total === 500, 'Querétaro cierra la semana con Pedro ($500)', cerrada.lineas.map(l => [l.nombre, l.total]));
  const v = (await pedir('GET', '/personal/' + pedro.id, A))[1].version;
  exigir(await pedir('PUT', '/personal/' + pedro.id, A, { version: v, sucursal_id: cdmx.id }), 'pasar a Pedro a CDMX');
  r = exigir(await pedir('GET', '/nomina?desde=' + dia(-7) + '&sucursal=' + cdmx.id, A), 'ver CDMX');
  revisa(!de(r, 'Pedro Se Cambia'), 'En la propuesta de CDMX de esa misma semana Pedro ya no aparece', r.lineas.map(l => l.nombre));
  const nm = exigir(await pedir('POST', '/nomina/preparar', A, { desde: dia(-7), sucursal_id: cdmx.id }), 'preparar CDMX');
  revisa(!de(nm, 'Pedro Se Cambia'), 'Ni al prepararla', nm.lineas.map(l => l.nombre));
  r = exigir(await pedir('GET', '/nomina?desde=' + HOY + '&sucursal=' + cdmx.id, A), 'ver CDMX semana en curso');
  revisa(!!de(r, 'Pedro Se Cambia'), 'En la semana en curso (que Querétaro no ha cerrado) Pedro sí está en CDMX', r.lineas.map(l => l.nombre));
  r = exigir(await pedir('GET', SEM, A), 'ver Querétaro');
  revisa(!!de(r, 'Pedro Se Cambia'), 'La nómina cerrada de Querétaro conserva a Pedro', r.lineas.map(l => l.nombre));

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); srv.kill(); process.exit(1); });
