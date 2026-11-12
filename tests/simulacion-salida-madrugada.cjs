// SALIDA DE MADRUGADA (auditoría del checador, 2026-11-12): quien trabaja pasada la medianoche y marca «Salida» ya en
// el día siguiente perdía toda la jornada (el día quedaba «Sin salida», 0 horas y 0 tiempo extra). Regla: una «Salida»
// antes de las 06:00 que es la PRIMERA checada del día cierra la jornada de ayer, si ayer tuvo entrada y no tuvo salida.
// Uso: node tests/simulacion-salida-madrugada.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-madrugada-')), DB = path.join(dir, 'm.db');
const ADMIN = { password: 'Madrugada-' + crypto.randomBytes(6).toString('hex') + '-9Q' }, CLAVE = 'Clave-Madrugada-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9760 + Math.floor(Math.random() * 200)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: 'marketing@saneadren.com.mx', ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => { const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const tx = await x.text(); let j = {}; try { j = JSON.parse(tx); } catch { /* */ } return [x.status, j]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const dow = f => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
// Semana de lunes a domingo que ya pasó completa: D(0) = lunes … D(6) = domingo.
const LUN = sumar(sumar(HOY, -7), -(dow(sumar(HOY, -7)) - 1)), D = k => sumar(LUN, k);

(async () => {
  for (let i = 0; i < 200 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'crear gerente');
  const G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar gerente').token;
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente']);
  const juan = exigir(await pedir('POST', '/personal', G, { nombre: 'Juan Pérez Operador', puesto: 'Operador', fecha_ingreso: sumar(HOY, -400) }), 'alta de Juan');
  exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/pin', G), 'alta en el checador');
  const op = (await pedir('GET', '/asistencia/horarios', G))[1].horarios.find(x => x.nombre === 'Operaciones'); // L-S 8:30–18:30
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/horario', G, { horario_id: op.id, desde: sumar(LUN, -30) }), 'asignar horario');
  const checar = async (fecha, tipo, hora) => exigir(await pedir('POST', '/asistencia/checadas', G, { personal_id: juan.id, tipo, fecha, hora, motivo: 'Semana de prueba' }), `checada ${fecha} ${tipo}`);
  const semana = async () => (await pedir('GET', '/asistencia/semana?desde=' + LUN + '&personal_id=' + juan.id, G))[1].filas[0];
  const dia = (s, k) => s.dias.find(x => x.fecha === D(k));

  console.log('1. Lunes: entra 8:30 y marca «Salida» a las 00:40 del martes');
  await checar(D(0), 'entrada', '08:30'); await checar(D(1), 'salida', '00:40'); await checar(D(1), 'entrada', '08:30'); await checar(D(1), 'salida', '18:30');
  let s = await semana(), lu = dia(s, 0), ma = dia(s, 1);
  revisa(lu.salida === '00:40' && lu.trabajado_min === 970, 'El lunes cuenta de 8:30 a 00:40: 16 h 10 min trabajadas', [lu.salida, lu.trabajado_min]);
  revisa(lu.extra_min === 370, 'El lunes tiene 6 h 10 min de tiempo extra (de su salida de las 18:30 a las 00:40)', lu.extra_min);
  revisa(!lu.notas.includes('Sin salida') && lu.notas.some(x => /día siguiente/.test(x)), 'El lunes ya no dice «Sin salida» y avisa que salió al día siguiente', lu.notas);
  revisa(lu.salida_anticipada_min === 0 && !lu.falta, 'El lunes no tiene salida anticipada ni falta', lu);
  revisa(ma.entrada === '08:30' && ma.salida === '18:30' && ma.trabajado_min === 600 && ma.extra_min === 0, 'El martes cuenta solo su jornada normal (8:30–18:30), sin la salida de la madrugada', [ma.entrada, ma.salida, ma.trabajado_min, ma.extra_min]);
  revisa(s.totales.sin_salida === 0, 'La semana no tiene días «sin salida»', s.totales.sin_salida);

  console.log('2. Sábado: entra 8:30 y sale a la 1:00 del domingo (su descanso)');
  await checar(D(5), 'entrada', '08:30'); await checar(D(6), 'salida', '01:00');
  s = await semana(); const sa = dia(s, 5), dom = dia(s, 6);
  revisa(sa.salida === '01:00' && sa.trabajado_min === 990 && sa.extra_min === 390, 'El sábado cuenta 16 h 30 min y 6 h 30 min de tiempo extra', [sa.salida, sa.trabajado_min, sa.extra_min]);
  revisa(dom.salida === null && dom.trabajado_min === null && dom.extra_min === 0 && !dom.notas.some(x => /Domingo trabajado|Descanso trabajado/.test(x)), 'El domingo no cuenta como trabajado: esa salida es del sábado', dom);

  console.log('3. Lo que NO debe cambiar');
  // Miércoles sin salida; el jueves su primera checada es una «Salida» a las 8:20 (ya no es madrugada): no cierra el miércoles.
  await checar(D(2), 'entrada', '08:30'); await checar(D(3), 'salida', '08:20'); await checar(D(3), 'entrada', '08:30'); await checar(D(3), 'salida', '18:30');
  // Viernes: «Salida» a las 2:00, pero el jueves ya tenía su salida: no se mueve.
  await checar(D(4), 'salida', '02:00');
  s = await semana(); const mi = dia(s, 2), ju = dia(s, 3), vi = dia(s, 4);
  revisa(mi.salida === null && mi.notas.includes('Sin salida'), 'Una «Salida» a las 8:20 del día siguiente no cierra el día anterior (sigue «Sin salida»)', mi);
  revisa(ju.salida === '18:30' && ju.trabajado_min === 600, 'Un día que ya tiene su salida no toma la «Salida» de la madrugada siguiente', [ju.salida, ju.trabajado_min]);
  revisa(vi.salida === '02:00' && vi.entrada === null, 'Esa «Salida» de las 2:00 se queda en su propio día', [vi.entrada, vi.salida]);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); srv.kill(); process.exit(1); });
