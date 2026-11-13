// ASISTENCIA (F3, 2026-11-03): horarios por versión, días festivos, cálculo del día y de la semana y tiempo extra.
// Una semana completa ya pasada de un operador (lunes a sábado 8:30–18:30, tolerancia 10, comida 60) con casos a mano:
// retardo, exceso de comida, tiempo extra después de la salida y con los botones (sin contar dos veces), falta,
// vacaciones, festivo y domingo trabajados; autorización del tiempo extra (dobles hasta 9 h, luego triples); versión
// nueva de horario que no cambia lo pasado; historial que no se borra; permisos y sucursales.
// Uso: node tests/simulacion-asistencia.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-asistencia-')), DB = path.join(dir, 'asistencia.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Asistencia-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Asistencia-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9450 + Math.floor(Math.random() * 300)), URLB = 'http://localhost:' + PUERTO;
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
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const dow = f => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
// Semana de nómina (semana vencida de lunes a domingo, Dirección 2026-11-09) que ya pasó completa: D(0..6) = lunes a domingo.
const LUN = sumar(sumar(HOY, -7), -(dow(sumar(HOY, -7)) - 1)), D = k => sumar(LUN, k);

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const T = {};
  for (const [nombre, rol, s] of [['Gema Gerente', 'gerente', qro.id], ['Valeria Ventas', 'ventas', qro.id], ['Gus GerenteMx', 'gerente', cdmx.id]]) {
    exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), 'crear ' + nombre);
    T[nombre.split(' ')[0]] = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  }
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente', 'Gus GerenteMx']); // etapa 6: quien edita personal tiene su ficha ligada
  const juan = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Juan Pérez Operador', puesto: 'Operador', fecha_ingreso: sumar(HOY, -400) }), 'alta de Juan');
  exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/pin', T.Gema), 'alta en el checador');

  console.log('1. Horarios de arranque y asignación');
  const [, hs] = await pedir('GET', '/asistencia/horarios', T.Gema);
  const op = hs.horarios.find(x => x.nombre === 'Operaciones'), adm = hs.horarios.find(x => x.nombre === 'Administrativo');
  revisa(hs.horarios.length === 2 && hs.horarios.every(x => x.sucursal_id === qro.id), 'La gerente de Querétaro ve solo los horarios de su sucursal', hs.horarios.map(x => [x.nombre, x.sucursal_id]));
  revisa(op && adm && op.vigente.dias['6']?.salida === '18:30' && !adm.vigente.dias['6'] && adm.vigente.dias['1'].salida === '18:00' && op.vigente.tolerancia_min === 10 && op.vigente.comida_min === 60,
    'Vienen «Administrativo» (L-V 8:30–18:00) y «Operaciones» (L-S 8:30–18:30), tolerancia 10 y comida 60', hs.horarios);
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/horario', T.Valeria, { horario_id: op.id, desde: LUN }))[0] === 403, 'Ventas no asigna horarios');
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/horario', T.Gema, { horario_id: op.id, desde: sumar(LUN, -30) }), 'asignar horario');
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/horario', T.Gema, { horario_id: adm.id, desde: sumar(HOY, -20) }))[0] === 400, 'Un cambio de horario no puede valer desde hace más de 7 días (la primera asignación sí)');

  console.log('2. La semana de Juan');
  const checar = async (fecha, tipo, hora) => exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: juan.id, tipo, fecha, hora, motivo: 'Semana de prueba' }), `checada ${fecha} ${tipo}`);
  // Lunes: retardo (8:45), comida de 80 min, sale 19:40.
  await checar(D(0), 'entrada', '08:45'); await checar(D(0), 'comida_sale', '13:00'); await checar(D(0), 'comida_regresa', '14:20'); await checar(D(0), 'salida', '19:40');
  // Martes: 8:38 (dentro de la tolerancia), sale 18:30 y luego un bloque de tiempo extra 18:40–19:10.
  await checar(D(1), 'entrada', '08:38'); await checar(D(1), 'salida', '18:30'); await checar(D(1), 'extra_inicia', '18:40'); await checar(D(1), 'extra_termina', '19:10');
  // Miércoles: sale 20:00 y además marcó tiempo extra 19:00–21:00 (se empalma: no se cuenta dos veces).
  await checar(D(2), 'entrada', '08:30'); await checar(D(2), 'extra_inicia', '19:00'); await checar(D(2), 'salida', '20:00'); await checar(D(2), 'extra_termina', '21:00');
  // Jueves: no checó (falta). Viernes: vacaciones.
  exigir(await pedir('POST', '/personal/' + juan.id + '/incidencias', T.Gema, { tipo: 'permiso', fecha_inicio: D(4), notas: 'Trámite' }), 'permiso del viernes');
  // Sábado: festivo (lo agrega RH) y lo trabaja; domingo también trabaja.
  exigir(await pedir('POST', '/asistencia/festivos', A, { fecha: D(5), nombre: 'Jornada electoral' }), 'festivo'); // valen para todas las sucursales
  await checar(D(5), 'entrada', '08:30'); await checar(D(5), 'salida', '18:30');
  await checar(D(6), 'entrada', '09:00'); await checar(D(6), 'salida', '13:00');

  const dia = async f => (await pedir('GET', '/asistencia/dia?fecha=' + f, T.Gema))[1].filas.find(x => x.personal_id === juan.id);
  const lun = await dia(D(0));
  revisa(lun.retardo_min === 15 && lun.comida_min === 80 && lun.exceso_comida_min === 20 && lun.extra_min === 70 && lun.trabajado_min === 575, 'Lunes: retardo 15 min, comida 80 (20 de más), 70 min extra, 9:35 trabajadas', lun);
  const mar = await dia(D(1));
  revisa(mar.retardo_min === 0 && mar.extra_min === 30, 'Martes: 8:38 está dentro de la tolerancia; 30 min de tiempo extra con los botones', mar);
  const mie = await dia(D(2));
  revisa(mie.extra_min === 150, 'Miércoles: salida tarde y bloque de extra empalmados cuentan 2:30 (sin contar dos veces)', mie);
  // Detalle del tiempo extra (2026-11-11): cada tramo con su hora, si cuenta y por qué, y el traslape.
  const pm = mar.extra_detalle?.piezas || [];
  revisa(pm.length === 1 && pm[0].desde === '18:40' && pm[0].hasta === '19:10' && pm[0].cuenta && /Botones/.test(pm[0].motivo),
    'Detalle del martes: el bloque 18:40–19:10 cuenta por los botones', mar.extra_detalle);
  revisa(pm[0]?.checadas?.length === 2 && pm[0].checadas.every(Number.isInteger), 'Evidencia: el tramo de los botones trae sus dos checadas (inicio y fin) para ver la foto', pm[0]);
  revisa(mie.extra_detalle?.traslape_min === 60 && mie.extra_detalle.sin_redondeo_min === 150, 'Detalle del miércoles: los tramos se enciman 1 h y se cuenta una vez', mie.extra_detalle);
  revisa(lun.extra_detalle?.regla && /Automático/.test(lun.extra_detalle.regla), 'El detalle dice la regla que se usó ese día', lun.extra_detalle);
  const jue = await dia(D(3)), vie = await dia(D(4));
  revisa(jue.falta && !vie.falta && vie.incidencia === 'permiso', 'Jueves sin checar es falta; viernes con permiso no', [jue, vie]);
  const sab = await dia(D(5)), dom = await dia(D(6));
  revisa(sab.festivo === 'Jornada electoral' && sab.extra_min === 600 && sab.notas.includes('Festivo trabajado') && !sab.falta, 'Sábado festivo trabajado: todo es tiempo extra y se marca', sab);
  revisa(dom.extra_min === 240 && dom.notas.some(x => /Descanso trabajado/.test(x)) && dom.notas.some(x => /Domingo/.test(x)), 'Domingo (descanso) trabajado: tiempo extra y prima dominical', dom);
  revisa((dom.extra_detalle?.piezas || []).some(z => z.checadas?.length === 2), 'Evidencia: el descanso trabajado trae su entrada y su salida', dom.extra_detalle);

  console.log('3. Tiempo extra autorizado');
  revisa((await pedir('POST', '/asistencia/extra', T.Valeria, { personal_id: juan.id, fecha: D(0), minutos: 70 }))[0] === 403, 'Ventas no autoriza tiempo extra');
  revisa((await pedir('POST', '/asistencia/extra', T.Gema, { personal_id: juan.id, fecha: D(0), minutos: 90 }))[0] === 400, 'No se autoriza más de lo registrado');
  revisa((await pedir('POST', '/asistencia/extra', T.Gema, { personal_id: juan.id, fecha: D(0), minutos: 40 }))[0] === 400, 'Autorizar menos de lo registrado pide motivo');
  revisa((await pedir('POST', '/asistencia/extra', T.Gema, { personal_id: juan.id, fecha: sumar(HOY, 1), minutos: 0 }))[0] === 400, 'No se autoriza un día futuro');
  for (const [k, m] of [[0, 70], [1, 30], [2, 150], [5, 600], [6, 240]]) exigir(await pedir('POST', '/asistencia/extra', T.Gema, { personal_id: juan.id, fecha: D(k), minutos: m }), 'autorizar ' + D(k));
  exigir(await pedir('POST', '/asistencia/extra', T.Gema, { personal_id: juan.id, fecha: D(2), minutos: 120, motivo: 'Media hora fue por su cuenta' }), 'corregir autorización');
  const [, sem] = await pedir('GET', '/asistencia/semana?desde=' + D(3), T.Gema);
  const tj = sem.filas.find(x => x.personal_id === juan.id)?.totales;
  revisa(sem.desde === LUN && sem.hasta === sumar(LUN, 6) && sem.vencida === LUN && sem.fechas.length === 7 && tj && tj.extra_min === 1090 && tj.extra_autorizado_min === 1060 && tj.extra_dobles_min === 540 && tj.extra_triples_min === 520 && tj.faltas === 1 && tj.retardos === 1 && tj.domingos === 1 && tj.festivos_trabajados === 1,
    'Semana de nómina lunes a domingo (cualquier día lleva a su lunes; es la semana vencida): extra 18:10, autorizado 17:40 (la última autorización cuenta) → 9 h dobles y 8:40 triples; 1 falta, 1 retardo, domingo y festivo', tj);

  revisa(tj.dias_trabajados === 5 && tj.permisos === 1 && tj.descansos_trabajados === 1 && tj.extra_sin_autorizar_min === 0 && tj.sin_salida === 0, 'Totales para el Excel: 5 días trabajados, 1 permiso, 1 descanso trabajado, nada sin autorizar', tj);
  // Precio de la hora por puesto (2026-11-03): quien ve sueldos ve el pago; 9 h dobles y 8:40 triples a $62.35 la hora.
  revisa(sem.dinero === true && sem.filas.find(x => x.personal_id === juan.id).dinero.valor_hora_cent === null, 'Sin precio del puesto, la semana dice «sin precio» (no inventa uno)');
  revisa((await pedir('PUT', '/asistencia/precios', T.Gema, { sucursal_id: qro.id, puesto: 'Operador', valor: '62.355' }))[0] === 400, 'Precio con más de 2 decimales: no');
  revisa((await pedir('PUT', '/asistencia/precios', T.Valeria, { sucursal_id: qro.id, puesto: 'Operador', valor: 62.35 }))[0] === 403, 'Ventas no pone precios');
  exigir(await pedir('PUT', '/asistencia/precios', T.Gema, { sucursal_id: qro.id, puesto: 'Operador', valor: '$62.35' }), 'precio del operador');
  { const [, s2] = await pedir('GET', '/asistencia/semana?desde=' + D(3), T.Gema), dj = s2.filas.find(x => x.personal_id === juan.id).dinero;
    // 540 min × 6235 × 2 / 60 = 112230; 520 min × 6235 × 3 / 60 = 162110.
    revisa(dj.valor_hora_cent === 6235 && dj.dobles_cent === 112230 && dj.triples_cent === 162110 && dj.total_cent === 274340, 'Pago: 9 h al doble $1,122.30 + 8:40 al triple $1,621.10 = $2,743.40 (el primer precio vale también para semanas anteriores)', dj); }
  exigir(await pedir('PUT', '/asistencia/precios', T.Gema, { sucursal_id: qro.id, puesto: 'Operador', valor: 70 }), 'precio nuevo');
  revisa((await pedir('GET', '/asistencia/semana?desde=' + D(3), T.Gema))[1].filas.find(x => x.personal_id === juan.id).dinero.valor_hora_cent === 7000, 'Si se corrige el mismo día, manda el último precio');
  revisa(!('dinero' in (await pedir('GET', '/asistencia/semana?desde=' + D(3), T.Gus))[1]) || (await pedir('GET', '/asistencia/precios', T.Gus))[1].sucursales.every(s => s.id !== qro.id), 'El gerente de CDMX no ve ni cambia los precios de Querétaro');
  revisa((await pedir('PUT', '/asistencia/precios', T.Gus, { sucursal_id: qro.id, puesto: 'Operador', valor: 1 }))[0] === 400, 'Ni puede ponerlos');
  console.log('4. Versiones de horario');
  revisa((await pedir('PUT', '/asistencia/horarios/' + op.id, T.Valeria, { dias: { 1: { entrada: '08:00', salida: '17:00' } }, tolerancia_min: 5, comida_min: 60 }))[0] === 403, 'Ventas no cambia horarios');
  revisa((await pedir('PUT', '/asistencia/horarios/' + op.id, T.Gema, { dias: { 1: { entrada: '08:00', salida: '17:00' } }, tolerancia_min: 5, comida_min: 60, desde: sumar(HOY, -20) }))[0] === 400, 'Un horario no se cambia hacia atrás más de 7 días');
  revisa((await pedir('PUT', '/asistencia/horarios/' + op.id, T.Gema, { dias: { 1: { entrada: '09:00', salida: '08:00' } }, tolerancia_min: 5, comida_min: 60 }))[0] === 400, 'La salida debe ser después de la entrada');
  exigir(await pedir('PUT', '/asistencia/horarios/' + op.id, T.Gema, { dias: { 1: { entrada: '08:00', salida: '17:00' }, 6: { entrada: '08:30', salida: '14:00' } }, tolerancia_min: 5, comida_min: 30 }), 'cambiar Operaciones desde hoy');
  const lun2 = await dia(D(0));
  revisa(lun2.retardo_min === 15 && lun2.extra_min === 70, 'El cambio de horario no cambia la semana pasada', lun2);
  const [, hs2] = await pedir('GET', '/asistencia/horarios', T.Gema), op2 = hs2.horarios.find(x => x.id === op.id);
  revisa(op2.versiones.length === 2 && op2.vigente.dias['6'].salida === '14:00' && op2.vigente.tolerancia_min === 5, 'Queda la versión nueva (sábado corto, tolerancia 5) y se conserva la anterior', op2.versiones);
  exigir(await pedir('POST', '/asistencia/horarios', T.Gema, { nombre: 'Medio turno', dias: { 1: { entrada: '08:30', salida: '13:30' } }, tolerancia_min: 0, comida_min: 0 }), 'horario nuevo');
  revisa((await pedir('POST', '/asistencia/horarios', T.Gema, { nombre: 'medio turno', dias: { 1: { entrada: '08:30', salida: '13:30' } }, tolerancia_min: 0, comida_min: 0 }))[0] === 409, 'No se repite el nombre de un horario');

  console.log('5. Festivos, permisos, sucursales e historial');
  const [, fes] = await pedir('GET', '/asistencia/festivos?anio=' + HOY.slice(0, 4), T.Gema);
  revisa(['-01-01', '-05-01', '-09-16', '-12-25'].every(s => fes.festivos.some(f => f.fecha === HOY.slice(0, 4) + s && f.origen === 'ley')), 'Los festivos de la ley se agregan solos', fes.festivos.map(f => f.fecha));
  exigir(await pedir('POST', '/asistencia/festivos', A, { fecha: HOY.slice(0, 4) + '-05-01', nombre: 'Día del Trabajo', activo: false }), 'quitar festivo');
  revisa(conBase(d => d.prepare('SELECT activo FROM dias_festivos WHERE fecha = ?').get(HOY.slice(0, 4) + '-05-01').activo) === 0, 'Quitar un festivo lo desactiva (no se borra)');
  revisa((await pedir('POST', '/asistencia/festivos', T.Valeria, { fecha: HOY, nombre: 'Día libre' }))[0] === 403, 'Ventas no agrega festivos');
  revisa((await pedir('GET', '/asistencia/dia', T.Valeria))[0] === 403 && (await pedir('GET', '/asistencia/semana', T.Valeria))[0] === 403, 'Ventas no ve la asistencia');
  revisa(!(await pedir('GET', '/asistencia/semana?desde=' + LUN, T.Gus))[1].filas.some(x => x.personal_id === juan.id), 'El gerente de CDMX no ve la asistencia de Querétaro');
  revisa((await pedir('GET', '/asistencia/personal/' + juan.id + '/horario', T.Gus))[0] === 404, 'Ni el horario de una persona de otra sucursal');
  revisa((await pedir('PUT', '/asistencia/horarios/' + op.id, T.Gus, { dias: { 1: { entrada: '07:00', salida: '15:00' } }, tolerancia_min: 0, comida_min: 0 }))[0] === 404, 'El gerente de CDMX no cambia los horarios de Querétaro');
  const hMx = (await pedir('GET', '/asistencia/horarios', T.Gus))[1].horarios;
  revisa(hMx.length === 2 && hMx.every(x => x.sucursal_id === cdmx.id), 'CDMX tiene sus propios horarios de arranque (sucursal abierta después)', hMx.map(x => [x.nombre, x.sucursal_id]));
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/horario', T.Gema, { horario_id: hMx[0].id }))[0] === 400, 'No se asigna un horario de otra sucursal');
  revisa((await pedir('POST', '/asistencia/festivos', A, { fecha: '2026-13-45', nombre: 'Fecha imposible' }))[0] === 400, 'Una fecha imposible se rechaza (sin error interno)');
  const intento = sql => { try { conBase(d => d.exec(sql)); return false; } catch { return true; } };
  revisa(intento('DELETE FROM extra_autorizaciones') && intento('UPDATE extra_autorizaciones SET minutos_autorizados = 0'), 'Las autorizaciones de tiempo extra no se borran ni se cambian');
  revisa(intento('DELETE FROM horario_versiones') && intento("UPDATE horario_versiones SET tolerancia_min = 60") && intento('DELETE FROM personal_horario'), 'El historial de horarios no se borra ni se cambia');

  console.log('6. Llegar antes de la entrada (2026-11-05)');
  // Jueves (era falta): llega 4:30, sale 18:30 sin marcar comida. Viernes: llega 8:00 (justo 30 min antes) y sale 18:30.
  await checar(D(3), 'entrada', '04:30'); await checar(D(3), 'salida', '18:30');
  await checar(D(4), 'entrada', '08:00'); await checar(D(4), 'salida', '18:30');
  const jue2 = await dia(D(3)), vie2 = await dia(D(4));
  revisa(jue2.extra_min === 240 && jue2.trabajado_min === 840 && jue2.comida_min === 0 && jue2.notas.some(x => /Llegó 4 h antes/.test(x)),
    'Llega 4:30 y sale 18:30: las 4 h antes de su entrada son tiempo extra, sin descontarle comida', jue2);
  revisa(jue2.notas.includes('No marcó su comida'), 'Si no marca su comida, RH lo ve (no se descuenta sola)', jue2.notas);
  revisa(vie2.extra_min === 0 && !vie2.notas.some(x => /antes de su entrada/.test(x)), 'Llegar 30 min antes (8:00) no es tiempo extra', vie2);
  await checar(D(4), 'entrada', '07:59'); // RH corrige: en realidad llegó 7:59
  revisa((await dia(D(4))).extra_min === 31, 'Llegar 31 min antes (7:59) sí cuenta, todo desde que llegó');
  revisa(lun.notas.every(x => !/No marcó su comida/.test(x)), 'Quien sí marca su comida no tiene el aviso', lun.notas);

  console.log('7. Tiempo extra sin fin');
  await checar(D(4), 'extra_inicia', '19:00'); // se le olvidó el «Fin de tiempo extra»
  const vie3 = await dia(D(4));
  revisa(vie3.extra_min === 31 && vie3.notas.includes('Inició tiempo extra y no marcó el fin'), 'Sin el fin, ese bloque no cuenta (no se inventa la hora) y RH ve el aviso', vie3);
  const [, sem3] = await pedir('GET', '/asistencia/semana?desde=' + D(3), T.Gema);
  revisa(sem3.filas.find(x => x.personal_id === juan.id).totales.extra_sin_fin === 1, 'La semana lo cuenta en sus pendientes');
  await checar(D(4), 'extra_termina', '20:30'); // RH agrega el fin real con motivo
  const vie4 = await dia(D(4));
  revisa(vie4.extra_min === 31 + 90 && !vie4.notas.includes('Inició tiempo extra y no marcó el fin'), 'Con el fin agregado, el bloque cuenta y el aviso se va', vie4);
  await checar(HOY, 'extra_inicia', '06:00');
  revisa(!(await dia(HOY)).notas.includes('Inició tiempo extra y no marcó el fin'), 'Hoy todavía no avisa (puede seguir trabajando)');

  console.log('8. Reglas del tiempo extra (2026-11-09)');
  const [, rg0] = await pedir('GET', '/asistencia/reglas-extra', T.Gema);
  revisa(rg0.vigente && rg0.vigente.inicio_semana === 1 && rg0.vigente.modo === 'auto' && rg0.vigente.despues_min === 0 && rg0.vigente.antes_min === 30 && rg0.vigente.bloque_min === 1 && rg0.vigente.descanso_todo === true && rg0.editar === false,
    'De arranque: semana de lunes a domingo, automático, minuto a minuto, llegar 30 min antes; la gerente de una sucursal las ve pero no las cambia', rg0);
  const reglas = (x = {}) => ({ inicio_semana: 1, modo: 'auto', despues_min: 0, antes_cuenta: true, antes_min: 30, bloque_min: 1, descanso_todo: true, desde: sumar(HOY, -7), ...x });
  revisa((await pedir('PUT', '/asistencia/reglas-extra', T.Gema, reglas({ despues_min: 30 })))[0] === 403, 'La gerente de una sola sucursal no cambia las reglas (valen para todas)');
  revisa((await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: sumar(HOY, -20) })))[0] === 400, 'No valen hacia atrás más de 7 días');
  revisa((await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ bloque_min: 7 })))[0] === 400, 'Redondeo solo de la lista');
  revisa((await pedir('PUT', '/asistencia/reglas-extra', A, reglas()))[1].cambios === 0, 'Guardar lo mismo no crea otra versión');
  // Ana (Administrativo, L-V 8:30–18:00) un día entre semana de los últimos 6: entra 8:30 y sale 18:20 (20 min después).
  const ana = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Ana Reglas Extra', puesto: 'Operador', fecha_ingreso: sumar(HOY, -400) }), 'alta de Ana');
  exigir(await pedir('PUT', '/asistencia/personal/' + ana.id + '/horario', T.Gema, { horario_id: adm.id, desde: sumar(HOY, -30) }), 'horario de Ana');
  let X = sumar(HOY, -1); while (dow(X) > 5) X = sumar(X, -1);
  const marca = async (tipo, hora) => exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo, fecha: X, hora, motivo: 'Prueba de reglas' }), 'checada de Ana');
  const diaAna = async () => (await pedir('GET', '/asistencia/dia?fecha=' + X, T.Gema))[1].filas.find(x => x.personal_id === ana.id);
  await marca('entrada', '08:30'); await marca('salida', '18:20');
  revisa((await diaAna()).extra_min === 20, 'Minuto a minuto: 20 min después de su salida son 20 min de extra');
  exigir(await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: X, despues_min: 30 })), 'regla 30 min');
  const dx = await diaAna();
  revisa(dx.extra_min === 0 && dx.notas.some(x => /no cuenta: el tiempo extra empieza a los 30 min/.test(x)), 'Con «desde 30 min»: quedarse 20 min no cuenta y se dice por qué', dx);
  revisa(dx.extra_detalle?.piezas?.length === 1 && dx.extra_detalle.piezas[0].cuenta === false && dx.extra_detalle.piezas[0].desde === '18:00' && dx.extra_detalle.piezas[0].hasta === '18:20', 'El detalle muestra el tramo 18:00–18:20 que no contó', dx.extra_detalle);
  await marca('salida', '18:40');
  revisa((await diaAna()).extra_min === 40, 'Si se queda 40 min (pasa los 30), cuenta todo desde su salida');
  exigir(await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: X, despues_min: 30, bloque_min: 30 })), 'regla con redondeo');
  const dx2 = await diaAna();
  revisa(dx2.extra_min === 30 && dx2.notas.some(x => /redondeado a bloques de 30 min/.test(x)), 'Redondeo a bloques de 30 min (hacia abajo): 40 → 30', dx2);
  revisa(dx2.extra_detalle?.redondeo?.bloque_min === 30 && dx2.extra_detalle.redondeo.perdidos_min === 10 && dx2.extra_detalle.sin_redondeo_min === 40, 'El detalle muestra el redondeo (40 → 30, no cuentan 10 min)', dx2.extra_detalle);
  revisa((await dia(D(0))).extra_min === 70, 'La semana pasada no cambia con las reglas nuevas');
  exigir(await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: X, modo: 'botones' })), 'solo botones');
  revisa((await diaAna()).extra_min === 0, 'Con «solo con los botones», quedarse después de la salida no cuenta');
  exigir(await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: X })), 'volver a como estaba');
  revisa((await diaAna()).extra_min === 40, 'Al volver a la regla anterior, vuelve a contar los 40 min');
  // Cambiar el día en que empieza la semana: debe valer desde ese día y la semana del cambio se corta.
  const prox = k => { let f = sumar(HOY, 1); while (dow(f) !== k) f = sumar(f, 1); return f; };
  const mier = prox(3);
  revisa((await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: sumar(mier, 1), inicio_semana: 3 })))[0] === 400, 'Si la semana empezará en miércoles, el cambio debe valer desde un miércoles');
  exigir(await pedir('PUT', '/asistencia/reglas-extra', A, reglas({ desde: mier, inicio_semana: 3 })), 'semana de miércoles a martes');
  const [, sc] = await pedir('GET', '/asistencia/semana?desde=' + sumar(mier, -1), T.Gema), [, sn] = await pedir('GET', '/asistencia/semana?desde=' + mier, T.Gema);
  revisa(sc.hasta === sumar(mier, -1) && sc.corta === true && dow(sc.desde) === 1 && sn.desde === mier && sn.hasta === sumar(mier, 6) && sn.semana_texto === 'de miércoles a martes',
    'La semana del cambio se corta el martes (ningún día queda en dos semanas) y la nueva va de miércoles a martes', [sc.desde, sc.hasta, sn.desde, sn.hasta, sn.semana_texto]);
  revisa(intento('DELETE FROM reglas_extra') && intento('UPDATE reglas_extra SET despues_min = 99'), 'El historial de las reglas no se borra ni se cambia');

  console.log('8b. Tiempo extra que pasa de medianoche (2026-11-11)');
  let V = sumar(HOY, -21); while (dow(V) > 3) V = sumar(V, -1);
  const marcaA = async (fecha, tipo, hora) => exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo, fecha, hora, motivo: 'Prueba de medianoche' }), 'checada de Ana');
  const diaA = async f => (await pedir('GET', '/asistencia/dia?fecha=' + f, T.Gema))[1].filas.find(x => x.personal_id === ana.id);
  // Día 1: jornada normal y a las 21:00 empieza tiempo extra; día 2: lo termina a las 02:30 y luego su jornada.
  for (const [t, h] of [['entrada', '08:30'], ['salida', '18:00'], ['extra_inicia', '21:00']]) await marcaA(V, t, h);
  for (const [t, h] of [['extra_termina', '02:30'], ['entrada', '09:00'], ['salida', '18:00']]) await marcaA(sumar(V, 1), t, h);
  const n1 = await diaA(V), n2 = await diaA(sumar(V, 1)), tr = (n1.extra_detalle?.piezas || []).find(z => z.cuenta);
  revisa(n1.extra_min === 330 && !n1.notas.includes('Inició tiempo extra y no marcó el fin') && tr?.desde === '21:00' && tr.hasta === '02:30 del día siguiente' && tr.checadas.length === 2 && n1.extra_detalle.otras?.[0]?.fecha === sumar(V, 1),
    'De 21:00 a 02:30 del día siguiente son 5:30 de extra, en el día en que empezó, con las dos checadas de evidencia', n1);
  revisa(n2.extra_min === 0 && n2.extra_detalle?.piezas?.some(z => z.ayer && !z.cuenta), 'El día siguiente no lo cuenta otra vez y dice que se contó el día anterior', n2);
  // Si al otro día lo primero es la entrada, no se une (no se inventa la hora): sigue el aviso de que no marcó el fin.
  const W = sumar(V, 7);
  await marcaA(W, 'extra_inicia', '22:00'); await marcaA(sumar(W, 1), 'entrada', '08:30'); await marcaA(sumar(W, 1), 'extra_termina', '09:00');
  const w1 = await diaA(W);
  revisa(w1.extra_min === 0 && w1.notas.includes('Inició tiempo extra y no marcó el fin'), 'Si al otro día lo primero que marca es la entrada, no se une', w1);
  // Un «Fin» después de las 12:00 del día siguiente tampoco se une.
  const Y = sumar(V, 14);
  await marcaA(Y, 'extra_inicia', '23:00'); await marcaA(sumar(Y, 1), 'extra_termina', '13:00');
  revisa((await diaA(Y)).notas.includes('Inició tiempo extra y no marcó el fin'), 'Un «Fin» después de las 12:00 del día siguiente no se une');

  console.log('8c. «Inicio de tiempo extra» en lugar de «Entrada» (2026-11-12)');
  // Caso real: a las 04:34 apretó «Inicio de tiempo extra» (no «Entrada»), comió y salió a su hora normal.
  const Z1 = sumar(V, 2), Z2 = sumar(Y, 2), Z3 = sumar(W, 2);
  for (const [t, h] of [['extra_inicia', '04:34'], ['comida_sale', '15:17'], ['comida_regresa', '16:11'], ['salida', '18:12']]) await marcaA(Z1, t, h);
  const z1 = await diaA(Z1), p1 = (z1.extra_detalle?.piezas || []).filter(z => z.cuenta);
  revisa(!z1.falta && z1.entrada === '04:34' && z1.trabajado_min === 18 * 60 + 12 - (4 * 60 + 34) - 54 && z1.retardo_min === 0
    && z1.notas.some(x => /se tomó como su entrada/.test(x)) && !z1.notas.includes('Inició tiempo extra y no marcó el fin'),
    'Sin «Entrada», el «Inicio de tiempo extra» de las 04:34 es su entrada: no es falta, ni retardo, ni «no marcó el fin»', z1);
  revisa(p1.some(z => z.desde === '04:34' && z.hasta === '08:30' && z.checadas.length === 1) && z1.extra_min >= 236 && p1.filter(z => z.desde === '04:34').length === 1,
    'El tiempo extra cuenta de 04:34 a su hora de entrada (08:30), una sola vez', p1);
  // Si sí marcó el «Fin», se respeta su hora de fin.
  for (const [t, h] of [['extra_inicia', '06:00'], ['extra_termina', '07:30'], ['salida', '18:00']]) await marcaA(Z2, t, h);
  const z2 = await diaA(Z2), p2 = (z2.extra_detalle?.piezas || []).filter(z => z.cuenta);
  revisa(!z2.falta && z2.entrada === '06:00' && p2.length === 1 && p2[0].desde === '06:00' && p2[0].hasta === '07:30', 'Con «Fin» marcado, cuenta de su inicio a su fin y el inicio es su entrada', z2);
  // Si lo apretó ya tarde (después de su hora de entrada), es su entrada con retardo y no hay tiempo extra.
  for (const [t, h] of [['extra_inicia', '09:15'], ['salida', '18:00']]) await marcaA(Z3, t, h);
  const z3 = await diaA(Z3);
  revisa(!z3.falta && z3.entrada === '09:15' && z3.retardo_min === 45 && z3.extra_min === 0 && !z3.notas.includes('Inició tiempo extra y no marcó el fin'), 'Apretado tarde: cuenta como entrada con retardo, sin tiempo extra', z3);

  console.log('8d. Tramos de trabajo: cada «Entrada» con su «Salida» (auditoría 13-nov)');
  { // Administrativo 8:30–18:00 L-V, reglas de arranque (cuenta desde el primer minuto, minuto a minuto, descanso todo extra).
    const toño = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Toño Tramos', puesto: 'Operador', fecha_ingreso: sumar(HOY, -400) }), 'alta de Toño');
    exigir(await pedir('PUT', '/asistencia/personal/' + toño.id + '/horario', T.Gema, { horario_id: adm.id, desde: sumar(HOY, -90) }), 'horario de Toño');
    let L = sumar(HOY, -42); while (dow(L) !== 1) L = sumar(L, -1);
    const marca = async (f, lista) => { for (const [tipo, hora] of lista) exigir(await pedir('POST', '/asistencia/checadas', A, { personal_id: toño.id, tipo, fecha: f, hora, motivo: 'Prueba de tramos' }), 'checada de Toño'); };
    const dt = async f => (await pedir('GET', '/asistencia/dia?fecha=' + f, A))[1].filas.find(x => x.personal_id === toño.id);
    await marca(L, [['entrada', '08:30'], ['salida', '18:00'], ['entrada', '20:00'], ['salida', '22:00']]);
    let d = await dt(L);
    revisa(d.extra_min === 120 && d.trabajado_min === 570 + 120 && d.extra_detalle.piezas.some(z => z.cuenta && z.desde === '20:00' && /Regresó/.test(z.motivo)), 'G5: regresa por una emergencia de 20:00 a 22:00: 2 h de extra, no 4 (las 2 h en su casa no cuentan)', d);
    await marca(sumar(L, 1), [['entrada', '08:30'], ['salida', '18:00'], ['entrada', '23:00']]); await marca(sumar(L, 2), [['salida', '02:00']]);
    d = await dt(sumar(L, 1));
    revisa(d.extra_min === 180 && !d.notas.includes('Sin salida'), 'M3: jornada normal y emergencia de 23:00 a 02:00: 3 h de extra el día en que empezó (antes 0 sin aviso)', d);
    revisa((await dt(sumar(L, 2))).extra_min === 0, 'y el día siguiente no la vuelve a contar');
    await marca(sumar(L, 3), [['entrada', '19:00'], ['salida', '21:00']]);
    d = await dt(sumar(L, 3));
    revisa(d.extra_min === 120 && d.trabajado_min === 120, 'G1: entra a las 19:00 (después de su hora de salida) y sale a las 21:00: 2 h de extra, no 3', d);
    await marca(sumar(L, 4), [['entrada', '08:30'], ['comida_sale', '18:30'], ['comida_regresa', '19:30'], ['salida', '21:00']]);
    d = await dt(sumar(L, 4));
    revisa(d.extra_min === 120 && d.notas.some(x => /Se le restó 1 h de comida/.test(x)), 'M4: la comida que tomó dentro de su tiempo extra se resta (2 h, no 3)', d);
    await marca(sumar(L, 5), [['entrada', '08:00'], ['salida', '10:00'], ['entrada', '16:00'], ['salida', '18:00']]);
    d = await dt(sumar(L, 5));
    revisa(d.extra_min === 240 && d.trabajado_min === 240, 'G4: dos ratos en su sábado de descanso (8–10 y 16–18): 4 h de extra, no 10', d);
    const L2 = sumar(L, 7);
    await marca(L2, [['entrada', '20:00']]);
    for (const k of [1, 2]) await marca(sumar(L2, k), [['salida', '02:00'], ['entrada', '20:00']]);
    await marca(sumar(L2, 3), [['salida', '02:00']]);
    const noches = []; for (const k of [0, 1, 2]) noches.push((await dt(sumar(L2, k))).extra_min);
    revisa(noches.every(x => x === 360), 'G2: tres noches seguidas de 20:00 a 02:00: 6 h cada noche (antes la 3ª salía en 0)', noches);
    await marca(sumar(L2, 4), [['entrada', '08:30'], ['salida', '18:00'], ['salida', '19:00']]);
    d = await dt(sumar(L2, 4));
    revisa(d.extra_min === 60 && d.salida === '19:00', 'RH agrega la salida real más tarde (sin otra entrada): vale la última salida, como antes', d);
    await marca(sumar(L2, 5), [['entrada', '09:00'], ['entrada', '09:05'], ['salida', '13:00']]);
    d = await dt(sumar(L2, 5));
    revisa(d.extra_min === 240 && d.notas.some(x => /dos veces/.test(x)), '«Entrada» repetida sin salida en medio: se toma la primera y se avisa', d);
    // G3: anoche olvidó el «Fin»; a la mañana marca «Fin» al llegar (el kiosco se lo sugería): no son 13 h de extra.
    const L3 = sumar(L, 14);
    await marca(L3, [['entrada', '08:30'], ['salida', '18:00'], ['extra_inicia', '19:00']]);
    await marca(sumar(L3, 1), [['extra_termina', '08:25'], ['salida', '18:00']]);
    const g1 = await dt(L3), g2 = await dt(sumar(L3, 1));
    revisa(g1.extra_min === 0 && g1.notas.includes('Inició tiempo extra y no marcó el fin'), 'G3: un «Fin» a la hora de llegar no cierra lo de anoche (antes: 13 h de extra); queda «sin fin» para que RH ponga la hora real', g1);
    revisa(!g2.falta && g2.entrada === '08:25' && g2.trabajado_min === 575 && g2.notas.some(x => /Fin de tiempo extra» al llegar/.test(x)), 'y ese «Fin» cuenta como su entrada: el día no sale como falta', g2);
    // B3: pasada la medianoche marcó «Salida» y luego «Fin»: el extra de anoche sí cuenta.
    await marca(sumar(L3, 2), [['entrada', '08:30'], ['salida', '18:00'], ['extra_inicia', '19:00']]);
    await marca(sumar(L3, 3), [['salida', '01:30'], ['extra_termina', '01:31'], ['entrada', '08:30'], ['salida', '18:00']]);
    const b1 = await dt(sumar(L3, 2)), b2 = await dt(sumar(L3, 3));
    revisa(b1.extra_min === 391 && !b1.notas.includes('Inició tiempo extra y no marcó el fin'), 'B3: «Salida» 01:30 y «Fin» 01:31: de 19:00 a 01:31 son 6 h 31 min el día en que empezó (antes 0)', b1);
    revisa(b2.extra_min === 0 && b2.trabajado_min === 570 && b2.salida === '18:00', 'y al día siguiente esa «Salida» de madrugada no se cuenta como suya', b2);
    // Casos que encontró la revisión independiente del cálculo por tramos.
    const L4 = sumar(L, 21), L5 = sumar(L, 28);
    await marca(L4, [['entrada', '06:00'], ['salida', '06:30'], ['entrada', '07:00'], ['salida', '18:00']]);
    d = await dt(L4);
    revisa(d.extra_min === 120 && d.trabajado_min === 690, 'Llegó antes en dos ratos (06:00–06:30 y 07:00): cuentan los dos antes de las 8:30 (2 h), no solo el primero', d);
    await marca(sumar(L4, 1), [['extra_inicia', '06:00'], ['salida', '18:00'], ['entrada', '20:00'], ['salida', '22:00']]);
    d = await dt(sumar(L4, 1));
    revisa(d.entrada === '06:00' && d.retardo_min === 0 && d.extra_min === 150 + 120, '«Inicio de tiempo extra» como entrada y luego regresa con «Entrada» por una emergencia: entrada 06:00, sin retardo, extra 2:30 + 2:00', d);
    await marca(sumar(L4, 2), [['entrada', '08:30'], ['salida', '14:00'], ['comida_sale', '14:00'], ['comida_regresa', '15:00'], ['entrada', '15:00'], ['salida', '18:00']]);
    d = await dt(sumar(L4, 2));
    revisa(d.trabajado_min === 510, 'Comida marcada entre dos tramos: no se resta dos veces (8:30 trabajadas)', d);
    await marca(sumar(L4, 3), [['entrada', '08:30'], ['salida', '18:00'], ['entrada', '23:00'], ['extra_inicia', '23:01']]);
    await marca(sumar(L4, 4), [['extra_termina', '02:00'], ['salida', '02:01'], ['entrada', '08:30'], ['salida', '18:00']]);
    const n1 = await dt(sumar(L4, 3)), n2 = await dt(sumar(L4, 4));
    revisa(n1.extra_min === 181 && !n1.notas.includes('Sin salida'), 'Noche que termina con «Fin» y luego «Salida»: la «Salida» de las 02:01 sí cierra la noche (3 h 1 min, sin «Sin salida»)', n1);
    revisa(n2.trabajado_min === 570 && n2.extra_min === 0 && n2.salida === '18:00', 'y el día siguiente es una jornada normal', n2);
    await marca(L5, [['extra_inicia', '07:00']]);
    await marca(sumar(L5, 1), [['salida', '02:00'], ['entrada', '08:30'], ['salida', '18:00']]);
    const p1 = await dt(L5), p2 = await dt(sumar(L5, 1));
    revisa(p1.extra_min === 90 + 480 && !p1.notas.includes('Sin salida'), '«Inicio de tiempo extra» como entrada y «Salida» de madrugada: cierra ese día (1:30 antes + 8 h después)', p1);
    revisa(p2.trabajado_min === 570 && p2.salida === '18:00' && p2.salida_anticipada_min === 0, 'y esa «Salida» no se cuenta otra vez al día siguiente', p2);
    await marca(sumar(L5, 2), [['salida', '05:59'], ['entrada', '08:30']]);
    d = await dt(sumar(L5, 2));
    revisa(d.salida === null && d.salida_anticipada_min === 0 && d.notas.includes('Sin salida'), 'Una «Salida» de madrugada suelta (ayer ya había salido) no es su salida: sin salida anticipada absurda', d);
    await marca(sumar(L5, 3), [['entrada', '08:30'], ['salida', '13:00'], ['entrada', '20:00'], ['salida', '22:00']]);
    d = await dt(sumar(L5, 3));
    revisa(d.salida_anticipada_min === 300 && d.extra_min === 120 && d.notas.some(x => /Salió a las 13:00/.test(x)), 'Salió a las 13:00 y regresó de 20:00 a 22:00: se marca la salida anticipada (5 h) y RH lo ve en la nota', d);
    await marca(sumar(L5, 4), [['salida', '20:00']]);
    d = await dt(sumar(L5, 4));
    revisa(d.extra_min === 0 && d.falta && d.notas.some(x => /sin «Entrada»/.test(x)), 'Solo marcó «Salida» (olvidó la entrada): no se inventa nada, es falta y la nota le dice a RH qué agregar', d); }

  console.log('9. Solo «Descargar la nómina» (2026-11-11)');
  const rolN = exigir(await pedir('POST', '/roles', A, { nombre: 'Solo nómina' }), 'crear rol');
  exigir(await pedir('PUT', '/roles/' + rolN.clave + '/permisos', A, { permisos: ['asistencia.nomina'], alcances: {} }), 'permisos del rol');
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Nora Nómina', password: CLAVE, rol: rolN.clave, sucursales: [qro.id] }), 'usuaria de nómina');
  const N = exigir(await pedir('POST', '/login', null, { nombre: 'Nora Nómina', password: CLAVE }), 'entrar Nora').token;
  const mios = (await pedir('GET', '/permisos/mios', N))[1].permisos;
  revisa(mios.includes('asistencia.nomina') && !mios.includes('asistencia.ver') && !mios.includes('personal.ver'), 'El rol tiene solo «Descargar la nómina» (no arrastra «Ver personal» ni «Ver asistencia»)', mios);
  const [sN, semN] = await pedir('GET', '/asistencia/semana?desde=' + LUN, N), fN = semN.filas?.find(x => x.personal_id === juan.id);
  revisa(sN === 200 && fN && fN.totales.extra_autorizado_min === tj.extra_autorizado_min && fN.totales.extra_dobles_min === 540 && semN.dinero === true && fN.dinero?.valor_hora_cent === 7000 && semN.puede.asistencia === false,
    'Ve la semana de nómina con horas, tiempo extra y su pago (para el Excel)', [sN, fN?.totales, fN?.dinero, semN.puede]);
  revisa((await pedir('GET', '/asistencia/semana?vencida=1', N))[0] === 200, 'y la semana vencida');
  const cerradas = [['GET', '/asistencia/dia'], ['GET', '/asistencia/checadas?fecha=' + D(0)], ['GET', '/asistencia/intentos'], ['GET', '/asistencia/horarios'], ['GET', '/asistencia/reglas-extra'],
    ['GET', '/asistencia/precios'], ['GET', '/asistencia/festivos'], ['GET', '/asistencia'], ['GET', '/personal'], ['GET', '/personal/' + juan.id], ['GET', '/personal/avisos'], ['GET', '/rh/resumen'],
    ['GET', '/asistencia/personal/' + juan.id + '/horario'], ['POST', '/asistencia/extra'], ['POST', '/asistencia/checadas'], ['PUT', '/asistencia/precios']];
  const abiertas = [];
  for (const [m, r] of cerradas) { const st = (await pedir(m, r, N, m === 'GET' ? undefined : { personal_id: juan.id, fecha: D(0), minutos: 0, tipo: 'salida', hora: '18:00', motivo: 'Prueba', sucursal_id: qro.id, puesto: 'Operador', valor: 1 }))[0]; if (st < 400) abiertas.push(`${m} ${r} → ${st}`); }
  revisa(!abiertas.length, 'Y nada más de RH: ni el día, checadas, intentos, horarios, reglas, precios, festivos, fichas, avisos ni el inicio de RH', abiertas);
  revisa(!(await pedir('GET', '/asistencia/semana?desde=' + LUN, T.Valeria))[1].filas, 'Ventas sigue sin ver la nómina');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
