// ETAPA 7 de la auditoría (A-05): quien causa baja a media semana NO desaparece de esa semana.
// Una persona trabaja lunes a miércoles de una semana ya cerrada (con tiempo extra el lunes) y se le da de baja con
// fecha miércoles. La semana debe seguir mostrándola con sus 3 días, su tiempo extra y su dinero; jueves a domingo
// (después de la baja) no son falta. Las reglas del tiempo extra no cambian: los minutos son los mismos que antes.
// Uso: node tests/simulacion-baja-media-semana.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-baja-semana-')), DB = path.join(dir, 'baja.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Baja-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Baja-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9750 + Math.floor(Math.random() * 200)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const dow = f => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
// Semana ya cerrada (lunes a domingo): D(0..6).
const LUN = sumar(sumar(HOY, -7), -(dow(sumar(HOY, -7)) - 1)), D = k => sumar(LUN, k);

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'crear gerente');
  const G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar gerente').token;
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente']);
  const p = exigir(await pedir('POST', '/personal', G, { nombre: 'Rosa Baja Miércoles', puesto: 'Operador', fecha_ingreso: sumar(HOY, -200) }), 'alta');
  exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', G), 'alta en el checador');
  const op = (await pedir('GET', '/asistencia/horarios', G))[1].horarios.find(x => x.nombre === 'Operaciones');
  exigir(await pedir('PUT', '/asistencia/personal/' + p.id + '/horario', G, { horario_id: op.id, desde: sumar(LUN, -30) }), 'asignar horario');
  exigir(await pedir('PUT', '/asistencia/precios', G, { sucursal_id: qro.id, puesto: 'Operador', valor: 100 }), 'precio de la hora');
  const checar = async (fecha, tipo, hora) => exigir(await pedir('POST', '/asistencia/checadas', G, { personal_id: p.id, tipo, fecha, hora, motivo: 'Semana de prueba A-05' }), `checada ${fecha} ${tipo}`);
  // Lunes: 8:30–20:30 (2 h después de su salida de 18:30). Martes y miércoles: 8:30–18:30.
  for (const [k, sal] of [[0, '20:30'], [1, '18:30'], [2, '18:30']]) { await checar(D(k), 'entrada', '08:30'); await checar(D(k), 'comida_sale', '13:00'); await checar(D(k), 'comida_regresa', '14:00'); await checar(D(k), 'salida', sal); }

  console.log('1. Antes de la baja');
  const semana = async () => (await pedir('GET', '/asistencia/semana?desde=' + D(3), G))[1];
  const s0 = await semana(), f0 = s0.filas?.find(f => f.personal_id === p.id);
  revisa(f0 && f0.totales.dias_trabajados === 3, 'Aparece en la semana con sus 3 días', f0?.totales);
  const extra0 = f0?.totales.extra_min, trab0 = f0?.totales.trabajado_min;
  exigir(await pedir('POST', '/asistencia/extra', G, { personal_id: p.id, fecha: D(0), minutos: extra0 }), 'autorizar el tiempo extra del lunes');

  console.log('2. Baja con fecha miércoles');
  const [sb, jb] = await pedir('POST', '/personal/' + p.id + '/baja', G, { fecha: D(2), motivo: 'Renuncia a media semana (prueba A-05)' });
  revisa(sb === 200, 'RH da la baja con fecha miércoles', [sb, jb]);

  console.log('3. La semana de su baja');
  const s1 = await semana(), f1 = s1.filas?.find(f => f.personal_id === p.id);
  revisa(!!f1, 'A-05: sigue apareciendo en la semana de su baja', { filas: s1.filas?.map(f => f.nombre) });
  revisa(f1?.totales.dias_trabajados === 3 && f1.dias.filter(d => d.entrada).map(d => d.fecha).join() === [D(0), D(1), D(2)].join(), 'Con sus días trabajados: lunes, martes y miércoles', f1?.totales);
  revisa(f1?.totales.trabajado_min === trab0 && f1.totales.extra_min === extra0 && extra0 > 0, `Con el mismo tiempo trabajado y el mismo tiempo extra que antes de la baja (${extra0} min): las reglas no cambian`, { antes: { trab0, extra0 }, despues: f1?.totales });
  revisa(f1?.totales.extra_autorizado_min === extra0 && f1.dinero?.valor_hora_cent === 10000 && f1.dinero.total_cent > 0, 'Su tiempo extra autorizado y su pago siguen ahí', f1?.dinero);
  revisa(f1?.totales.faltas === 0 && f1.dias.filter(d => d.fecha > D(2)).every(d => !d.falta), 'Jueves a domingo (después de la baja) no cuentan como falta', f1?.dias.map(d => [d.fecha, d.falta]));
  const solo = (await pedir('GET', `/asistencia/semana?desde=${D(3)}&personal_id=${p.id}`, G))[1];
  revisa(solo.filas?.length === 1, 'También aparece al pedir solo a esa persona', solo.filas?.length);

  console.log('4. Las otras semanas');
  const despues = (await pedir('GET', '/asistencia/semana?desde=' + sumar(LUN, 7), G))[1];
  revisa(!despues.filas?.some(f => f.personal_id === p.id), 'La semana siguiente a su baja ya no la muestra', despues.filas?.map(f => f.nombre));
  const antes = (await pedir('GET', '/asistencia/semana?desde=' + sumar(LUN, -7), G))[1];
  revisa(antes.filas?.some(f => f.personal_id === p.id), 'La semana anterior sí la muestra (estaba activa)', antes.filas?.map(f => f.nombre));

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
