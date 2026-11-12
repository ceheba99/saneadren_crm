// ASISTENCIA (RH · F3, 2026-11-03): horarios, días festivos, cálculo de cada día y de la semana, y tiempo extra autorizado.
// Las checadas vienen del reloj checador (checador.js); aquí solo se leen (nunca se cambian).
//  · Horarios con VERSIONES (decidido con Dirección: RH los cambia seguido): cada cambio es una versión nueva con su
//    fecha «desde». Un día se calcula con la versión vigente ese día; las semanas ya pagadas no cambian. Cada día de la
//    semana tiene su entrada y salida (o es descanso), más tolerancia y minutos de comida (lo ajusta RH).
//    De arranque: «Administrativo» lunes a viernes 8:30–18:00 y «Operaciones» lunes a sábado 8:30–18:30, comida 1 hora,
//    tolerancia 10 min (se cambian en la pantalla).
//    Cada sucursal tiene SUS horarios (el gerente de una no cambia los de otra); los de arranque se crean en cada
//    sucursal, también en las que se abran después.
//  · A cada persona se le asigna un horario de su sucursal desde una fecha (también con historial).
//  · Días festivos obligatorios (art. 74 LFT) se siembran solos para este año y el siguiente; RH agrega o quita otros
//    (p. ej. jornadas electorales). Quitar no borra: se desactiva.
//  · Cálculo del día (solo checadas válidas; las «por revisar» se avisan pero no cuentan hasta aceptarlas):
//    entrada = primera «entrada», salida = última «salida», comida = salida a comer → regreso. Trabajado = salida −
//    entrada − comida. Retardo = minutos después de la hora de entrada, si pasa la tolerancia. Exceso de comida, salida
//    anticipada. Tiempo extra MINUTO A MINUTO (decidido con Dirección) = lo trabajado después de la hora de salida del
//    horario, unido con los bloques «inicio / fin de tiempo extra» (sin contar dos veces). Llegar ANTES de la entrada
//    (2026-11-05, Dirección): hasta 30 min antes no es extra; si llega más temprano, cuenta todo desde que llegó
//    (como la tolerancia del retardo). Al extra nunca se le descuenta comida: solo cuenta la comida que se marca. En descanso o festivo, todo lo
//    trabajado es extra (y se marca). Falta = día laboral ya pasado sin entrada, sin vacaciones/incapacidad/permiso.
//  · Semana de nómina: SEMANA VENCIDA DE LUNES A DOMINGO (Dirección, 2026-11-09; antes era de viernes a jueves). Se
//    paga la semana que ya cerró. El día en que empieza es una de las «reglas del tiempo extra» (abajo).
//  · Reglas del tiempo extra (Dirección, 2026-11-09: «quiero poder configurar cuándo ya cuenta como tiempo extra»),
//    con versiones «desde» como los horarios y para TODA la empresa (las cambia quien cambia los festivos):
//    día en que empieza la semana; contar automático (lo trabajado fuera del horario) o solo con los botones de tiempo
//    extra; minutos que debe quedarse después de su salida para que cuente (y entonces cuenta todo desde la salida);
//    si llegar antes cuenta y desde cuántos minutos antes; redondeo hacia abajo por día (minuto a minuto, 15, 30 o
//    60 min); si en descanso o festivo todo lo trabajado es extra. Si cambia el día en que empieza la semana, la semana
//    del cambio se corta el día anterior (puede quedar más corta) para que ningún día quede en dos semanas.
//  · Tiempo extra: lo AUTORIZAN RH y el Gerente (permiso «Autorizar tiempo extra»), hasta los minutos calculados. Cada
//    autorización es un registro nuevo (la última cuenta); no se borran. Semana: las primeras 9 horas autorizadas son
//    dobles y lo demás triples (arts. 67 y 68 LFT).
//  · Precio de la hora (decidido con Dirección el 2026-11-03: un precio POR PUESTO, en cada sucursal): es el valor de la
//    hora normal; el tiempo extra se paga doble o triple sobre él. Cada cambio es un registro nuevo desde hoy (las
//    semanas pasadas se calculan con el precio que tenían). Lo ven y lo cambian solo quienes ven sueldos
//    («personal.sensibles» y editar personal: Dirección y el Gerente); los demás ven solo horas.
const { ahoraMexico } = require('./fechas');

const DIAS = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
const AUSENCIAS = ['vacaciones', 'incapacidad', 'permiso'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const fechaOk = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const texto = (v, max) => { const t = String(v ?? '').trim().replace(/\s+/g, ' '); return t ? t.slice(0, max) : null; };
const min = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const hhmm = m => (m >= 1440 ? hhmm(m - 1440) + ' del día siguiente' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
// Tiempo extra que pasa de medianoche (2026-11-11): el «Fin» de la madrugada siguiente cierra el «Inicio» de la noche
// anterior si es la PRIMERA checada de ese día y es antes de esta hora. Se cuenta en el día en que empezó.
const MEDIANOCHE_HASTA = 12 * 60;
const sumar = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSemana = f => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
// Primer día de la semana que empieza en «inicio» (1 = lunes … 7 = domingo) a la que pertenece una fecha.
const inicioSemana = (f, inicio = 1) => sumar(f, -((diaSemana(f) - inicio + 7) % 7));
// Reglas del tiempo extra de arranque (lo que se hacía hasta el 2026-11-09, con la semana ya de lunes a domingo).
const REGLAS_INICIALES = { inicio_semana: 1, modo: 'auto', despues_min: 0, antes_cuenta: 1, antes_min: 30, bloque_min: 1, descanso_todo: 1 };
const BLOQUES = [1, 5, 10, 15, 30, 60];
// Semana de nómina de una fecha según una lista de reglas [{ desde, inicio_semana }] ordenada por fecha.
function semanaCon(reglas, f) {
  const efectivas = [];
  for (const r of reglas) { if (efectivas.length && efectivas.at(-1).desde === r.desde) efectivas[efectivas.length - 1] = r; else efectivas.push(r); }
  const cortes = efectivas.filter((r, i) => i > 0 && r.inicio_semana !== efectivas[i - 1].inicio_semana).map(r => r.desde);
  const vig = [...efectivas].reverse().find(r => r.desde <= f) || efectivas[0] || REGLAS_INICIALES;
  let desde = inicioSemana(f, vig.inicio_semana);
  const antes = cortes.filter(c => c <= f).pop();
  if (antes && antes > desde) desde = antes;
  let hasta = sumar(desde, 6);
  const despues = cortes.find(c => c > desde && c <= hasta);
  if (despues) hasta = sumar(despues, -1);
  return { desde, hasta };
}
// Días festivos obligatorios de la LFT (art. 74) de un año. Las jornadas electorales las agrega RH.
function festivosLey(anio) {
  const lunes = (mes, n) => { const d = new Date(Date.UTC(anio, mes - 1, 1, 12)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); d.setUTCDate(d.getUTCDate() + 7 * (n - 1)); return d.toISOString().slice(0, 10); };
  const f = [[`${anio}-01-01`, 'Año Nuevo'], [lunes(2, 1), 'Día de la Constitución'], [lunes(3, 3), 'Natalicio de Benito Juárez'], [`${anio}-05-01`, 'Día del Trabajo'],
    [`${anio}-09-16`, 'Día de la Independencia'], [lunes(11, 3), 'Día de la Revolución'], [`${anio}-12-25`, 'Navidad']];
  if ((anio - 2024) % 6 === 0) f.push([`${anio}-10-01`, 'Transmisión del Poder Ejecutivo Federal']);
  return f;
}
// Une intervalos [ini, fin] (minutos) y regresa el total sin contar dos veces.
function unidos(intervalos) {
  const l = intervalos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, ini = null, fin = null;
  for (const [a, b] of l) { if (fin === null || a > fin) { if (fin !== null) total += fin - ini; ini = a; fin = b; } else fin = Math.max(fin, b); }
  return fin === null ? 0 : total + fin - ini;
}
// Valida los días de un horario: { "1": { entrada, salida }, … } (1 = lunes … 7 = domingo; sin día = descanso).
function validarDias(dias) {
  if (!dias || typeof dias !== 'object' || Array.isArray(dias)) return { error: 'Indica qué días se trabaja' };
  const r = {};
  for (const [k, v] of Object.entries(dias)) {
    if (!DIAS[k]) return { error: 'Día inválido' };
    if (v === null || v === false) continue;
    if (!HORA.test(String(v?.entrada)) || !HORA.test(String(v?.salida))) return { error: `Revisa la entrada y la salida del ${DIAS[k].toLowerCase()} (formato 08:30)` };
    if (min(v.salida) <= min(v.entrada)) return { error: `El ${DIAS[k].toLowerCase()} la salida debe ser después de la entrada` };
    r[k] = { entrada: v.entrada, salida: v.salida };
  }
  if (!Object.keys(r).length) return { error: 'El horario debe tener al menos un día de trabajo' };
  return { dias: r };
}

// Horarios de arranque en cada sucursal que todavía no tiene ninguno (al arrancar y al pedir la lista: así una sucursal
// nueva también los tiene).
function sembrarHorarios(db) {
  const sinHorarios = db.prepare('SELECT s.id FROM main.sucursales s WHERE NOT EXISTS (SELECT 1 FROM main.horarios h WHERE h.sucursal_id = s.id)').all();
  for (const { id: suc } of sinHorarios) {
    for (const [nombre, dias, salida] of [['Administrativo', [1, 2, 3, 4, 5], '18:00'], ['Operaciones', [1, 2, 3, 4, 5, 6], '18:30']]) {
      const id = Number(db.prepare('INSERT INTO main.horarios (nombre, sucursal_id) VALUES (?, ?)').run(nombre, suc).lastInsertRowid);
      db.prepare("INSERT INTO main.horario_versiones (horario_id, desde, dias, tolerancia_min, comida_min, creado_por_nombre) VALUES (?, '2020-01-01', ?, 10, 60, 'Sistema')")
        .run(id, JSON.stringify(Object.fromEntries(dias.map(d => [d, { entrada: '08:30', salida }]))));
    }
  }
}
function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS horarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(nombre)) BETWEEN 3 AND 60),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_horarios_nombre ON horarios(sucursal_id, nombre COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS horario_versiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horario_id INTEGER NOT NULL REFERENCES horarios(id),
      desde TEXT NOT NULL, dias TEXT NOT NULL,
      tolerancia_min INTEGER NOT NULL CHECK(tolerancia_min BETWEEN 0 AND 120),
      comida_min INTEGER NOT NULL CHECK(comida_min BETWEEN 0 AND 240),
      creado_por INTEGER, creado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_horario_versiones ON horario_versiones(horario_id, desde);
    CREATE TABLE IF NOT EXISTS personal_horario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      horario_id INTEGER NOT NULL REFERENCES horarios(id),
      desde TEXT NOT NULL,
      asignado_por INTEGER, asignado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_personal_horario ON personal_horario(personal_id, desde);
    CREATE TABLE IF NOT EXISTS dias_festivos (
      fecha TEXT PRIMARY KEY, nombre TEXT NOT NULL,
      origen TEXT NOT NULL DEFAULT 'empresa' CHECK(origen IN ('ley', 'empresa')),
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      cambiado_por TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS extra_autorizaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      fecha TEXT NOT NULL,
      minutos_calculados INTEGER NOT NULL CHECK(minutos_calculados >= 0),
      minutos_autorizados INTEGER NOT NULL CHECK(minutos_autorizados >= 0 AND minutos_autorizados <= minutos_calculados),
      motivo TEXT, autorizado_por INTEGER, autorizado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_extra_autorizaciones ON extra_autorizaciones(personal_id, fecha);
    -- Historial: las versiones de horario, asignaciones y autorizaciones de tiempo extra no se borran ni se cambian.
    CREATE TRIGGER IF NOT EXISTS horario_versiones_fijas BEFORE UPDATE ON horario_versiones BEGIN SELECT RAISE(ABORT, 'Un horario se cambia con una versión nueva'); END;
    -- Se rehace en cada arranque (2026-11-04): solo deja borrar la versión que el sistema creó al abrir una sucursal y que
    -- nadie usó (para eliminar una sucursal creada por error, server/eliminar.js). Lo demás sigue sin borrarse.
    DROP TRIGGER IF EXISTS horario_versiones_no_borrar;
    CREATE TRIGGER horario_versiones_no_borrar BEFORE DELETE ON horario_versiones
      WHEN COALESCE(OLD.creado_por_nombre, '') <> 'Sistema' OR EXISTS (SELECT 1 FROM personal_horario ph WHERE ph.horario_id = OLD.horario_id)
      BEGIN SELECT RAISE(ABORT, 'El historial de horarios no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS personal_horario_no_borrar BEFORE DELETE ON personal_horario BEGIN SELECT RAISE(ABORT, 'El historial de horarios no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS extra_autorizaciones_fijas BEFORE UPDATE ON extra_autorizaciones BEGIN SELECT RAISE(ABORT, 'Una autorización de tiempo extra se corrige con otra nueva'); END;
    CREATE TRIGGER IF NOT EXISTS extra_autorizaciones_no_borrar BEFORE DELETE ON extra_autorizaciones BEGIN SELECT RAISE(ABORT, 'Las autorizaciones de tiempo extra no se borran'); END;
    -- Precio de la hora normal por puesto y sucursal (centavos), con historial: el vigente es el último con desde <= fecha.
    CREATE TABLE IF NOT EXISTS precios_hora_puesto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      puesto TEXT NOT NULL,
      valor_cent INTEGER NOT NULL CHECK(valor_cent >= 0 AND valor_cent <= 10000000),
      desde TEXT NOT NULL,
      creado_por INTEGER, creado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_precios_hora_puesto ON precios_hora_puesto(sucursal_id, puesto, desde);
    CREATE TRIGGER IF NOT EXISTS precios_hora_fijos BEFORE UPDATE ON precios_hora_puesto BEGIN SELECT RAISE(ABORT, 'Un precio se cambia con uno nuevo'); END;
    CREATE TRIGGER IF NOT EXISTS precios_hora_no_borrar BEFORE DELETE ON precios_hora_puesto BEGIN SELECT RAISE(ABORT, 'El historial de precios no se borra'); END;
    -- Reglas del tiempo extra (2026-11-09), para toda la empresa, con versiones «desde» que no se cambian ni se borran.
    CREATE TABLE IF NOT EXISTS reglas_extra (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      desde TEXT NOT NULL,
      inicio_semana INTEGER NOT NULL CHECK(inicio_semana BETWEEN 1 AND 7),
      modo TEXT NOT NULL CHECK(modo IN ('auto', 'botones')),
      despues_min INTEGER NOT NULL CHECK(despues_min BETWEEN 0 AND 240),
      antes_cuenta INTEGER NOT NULL CHECK(antes_cuenta IN (0, 1)),
      antes_min INTEGER NOT NULL CHECK(antes_min BETWEEN 0 AND 240),
      bloque_min INTEGER NOT NULL CHECK(bloque_min IN (1, 5, 10, 15, 30, 60)),
      descanso_todo INTEGER NOT NULL CHECK(descanso_todo IN (0, 1)),
      creado_por INTEGER, creado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_reglas_extra ON reglas_extra(desde);
    CREATE TRIGGER IF NOT EXISTS reglas_extra_fijas BEFORE UPDATE ON reglas_extra BEGIN SELECT RAISE(ABORT, 'Una regla del tiempo extra se cambia con una versión nueva'); END;
    CREATE TRIGGER IF NOT EXISTS reglas_extra_no_borrar BEFORE DELETE ON reglas_extra BEGIN SELECT RAISE(ABORT, 'El historial de las reglas del tiempo extra no se borra'); END;
  `);
  if (!db.prepare('SELECT 1 FROM main.reglas_extra LIMIT 1').get()) {
    const r = REGLAS_INICIALES;
    db.prepare("INSERT INTO main.reglas_extra (desde, inicio_semana, modo, despues_min, antes_cuenta, antes_min, bloque_min, descanso_todo, creado_por_nombre) VALUES ('2020-01-01', ?, ?, ?, ?, ?, ?, ?, 'Sistema')")
      .run(r.inicio_semana, r.modo, r.despues_min, r.antes_cuenta, r.antes_min, r.bloque_min, r.descanso_todo);
  }
  sembrarHorarios(db);
  // Festivos de la ley de este año y el siguiente (no revive uno que RH desactivó).
  const anio = Number(ahoraMexico().fecha.slice(0, 4)), ins = db.prepare("INSERT OR IGNORE INTO dias_festivos (fecha, nombre, origen) VALUES (?, ?, 'ley')");
  for (const a of [anio, anio + 1]) for (const [f, n] of festivosLey(a)) ins.run(f, n);
}

module.exports = function asistencia(app, db, h) {
  migrar(db);
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para la asistencia' });
  // Dinero del tiempo extra: quien ve sueldos lo ve; quien además edita el personal cambia el precio de la hora.
  const verDinero = req => puede(req, 'personal.sensibles'), cambiaPrecio = req => verDinero(req) && puede(req, 'personal.editar');
  // «Descargar la nómina» (2026-11-11): la semana de nómina con su pago, sin el resto de la asistencia.
  const veNomina = req => puede(req, 'asistencia.ver') || puede(req, 'asistencia.nomina');

  // ---------- Horario vigente ----------
  const versionDe = (horarioId, fecha) => db.prepare('SELECT * FROM main.horario_versiones WHERE horario_id = ? AND desde <= ? ORDER BY desde DESC, id DESC LIMIT 1').get(horarioId, fecha);
  const asignadoDe = (personaId, fecha) => db.prepare('SELECT ph.horario_id, h.nombre FROM main.personal_horario ph JOIN main.horarios h ON h.id = ph.horario_id WHERE ph.personal_id = ? AND ph.desde <= ? ORDER BY ph.desde DESC, ph.id DESC LIMIT 1').get(personaId, fecha);
  function horarioDe(personaId, fecha) {
    const a = asignadoDe(personaId, fecha); if (!a) return null;
    const v = versionDe(a.horario_id, fecha); if (!v) return null;
    return { id: a.horario_id, nombre: a.nombre, dias: JSON.parse(v.dias), tolerancia: v.tolerancia_min, comida: v.comida_min };
  }
  const festivoDe = fecha => db.prepare('SELECT nombre FROM main.dias_festivos WHERE fecha = ? AND activo = 1').get(fecha)?.nombre || null;

  // ---------- Reglas del tiempo extra ----------
  const reglaDe = fecha => db.prepare('SELECT * FROM main.reglas_extra WHERE desde <= ? ORDER BY desde DESC, id DESC LIMIT 1').get(fecha)
    || db.prepare('SELECT * FROM main.reglas_extra ORDER BY desde, id LIMIT 1').get() || REGLAS_INICIALES;
  const semanaDe = f => semanaCon(db.prepare('SELECT desde, inicio_semana FROM main.reglas_extra ORDER BY desde, id').all(), f);
  const horas = m => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
  // ---------- Cálculo de un día ----------
  // Checadas válidas de un día y el «Inicio de tiempo extra» que quedó abierto al final (para la madrugada siguiente).
  const validasDe = (pid, f) => db.prepare("SELECT id, tipo, hora, origen, foto_archivo IS NOT NULL AS tiene_foto, foto_borrada_at IS NOT NULL AS foto_borrada FROM main.checadas WHERE personal_id = ? AND fecha = ? AND estado = 'valida' ORDER BY momento_utc, id").all(pid, f);
  function abiertoAlFinal(l) { let a = null; for (const c of l) { if (c.tipo === 'extra_inicia') a = c; else if (c.tipo === 'extra_termina') a = null; } return a; }
  const cierraLaNoche = l => (l[0]?.tipo === 'extra_termina' && min(l[0].hora.slice(0, 5)) < MEDIANOCHE_HASTA ? l[0] : null);
  function calcularDia(p, fecha, hoy = ahoraMexico().fecha) {
    const hor = horarioDe(p.id, fecha), dia = hor?.dias[diaSemana(fecha)] || null, festivo = festivoDe(fecha), rg = reglaDe(fecha);
    const laboral = !!dia && !festivo;
    const ch = db.prepare('SELECT id, tipo, hora, estado, origen, sin_conexion FROM main.checadas WHERE personal_id = ? AND fecha = ? AND estado <> \'anulada\' ORDER BY momento_utc, id').all(p.id, fecha);
    const validas = ch.filter(c => c.estado === 'valida'), m = c => min(c.hora.slice(0, 5));
    const entradas = validas.filter(c => c.tipo === 'entrada'), salidas = validas.filter(c => c.tipo === 'salida');
    // 2026-11-12 (Dirección: «marcó tiempo extra como entrada y su salida normal; que lo tome en cuenta»): en un día
    // laboral sin «Entrada», si lo PRIMERO que marcó fue «Inicio de tiempo extra» antes de su hora de salida, esa checada
    // es su entrada. Si no marcó el «Fin», el tiempo extra va de esa hora a su hora de entrada (nunca dentro del horario).
    const porExtra = laboral && !entradas.length && validas[0]?.tipo === 'extra_inicia' && m(validas[0]) < min(dia.salida) ? validas[0] : null;
    const finPropio = porExtra ? (() => { for (const c of validas.slice(1)) { if (c.tipo === 'extra_termina') return true; if (c.tipo === 'extra_inicia') return false; } return false; })() : false;
    const llegada = entradas[0] || porExtra;
    const eId = llegada?.id, sId = salidas.at(-1)?.id;
    const entrada = llegada ? m(llegada) : null, salida = salidas.length ? m(salidas[salidas.length - 1]) : null;
    // Comida: cada salida a comer con el regreso que le sigue.
    let comida = 0, abierta = null;
    for (const c of validas) { if (c.tipo === 'comida_sale') abierta = m(c); else if (c.tipo === 'comida_regresa' && abierta !== null) { comida += Math.max(0, m(c) - abierta); abierta = null; } }
    // Bloques de tiempo extra marcados con los botones.
    // bloqueIds: las checadas de inicio y fin de cada bloque (su foto es la evidencia en el detalle del tiempo extra).
    const bloques = [], bloqueIds = []; let ini = null, iniId = null;
    for (const c of validas) {
      if (c === porExtra && !finPropio) { if (m(c) < min(dia.entrada)) { bloques.push([m(c), min(dia.entrada)]); bloqueIds.push([c.id]); } continue; }
      if (c.tipo === 'extra_inicia') { ini = m(c); iniId = c.id; } else if (c.tipo === 'extra_termina' && ini !== null) { bloques.push([ini, m(c)]); bloqueIds.push([iniId, c.id]); ini = null; } }
    // Pasó de medianoche: el «Fin» es la primera checada del día siguiente (antes de las 12:00) y se cuenta hoy.
    let finOtroDia = null;
    if (ini !== null) {
      const fin = cierraLaNoche(validasDe(p.id, sumar(fecha, 1)));
      if (fin) { bloques.push([ini, 1440 + m(fin)]); bloqueIds.push([iniId, fin.id]); finOtroDia = { ...fin, fecha: sumar(fecha, 1) }; ini = null; }
    }
    // Y al revés: un «Fin» al empezar el día que cierra el tiempo extra de anoche ya se contó ayer.
    const primera = validas[0], deAnoche = primera?.tipo === 'extra_termina' && cierraLaNoche(validas) ? abiertoAlFinal(validasDe(p.id, sumar(fecha, -1))) : null;
    const trabajado = entrada !== null && salida !== null && salida > entrada ? salida - entrada - comida : null;
    // Detalle del tiempo extra (2026-11-11, Dirección: «ver el checado de su tiempo extra más a detalle»): cada tramo
    // con su hora de inicio y fin, por qué cuenta o por qué no, la regla que se usó, el traslape y el redondeo.
    const piezas = [], pieza = (a, b, motivo, cuenta = true, checadas = []) => { if (a !== null && b !== null && b > a) piezas.push({ desde: hhmm(a), hasta: hhmm(b), min: b - a, motivo, cuenta, checadas: checadas.filter(Boolean) }); };
    const r = { personal_id: p.id, nombre: p.nombre, fecha, dia: DIAS[diaSemana(fecha)], horario: hor?.nombre || null, programado: dia, festivo, laboral,
      entrada: entrada === null ? null : llegada.hora.slice(0, 5), salida: salida === null ? null : salidas[salidas.length - 1].hora.slice(0, 5),
      comida_min: comida, trabajado_min: trabajado, retardo_min: 0, exceso_comida_min: 0, salida_anticipada_min: 0, extra_min: 0,
      por_revisar: ch.filter(c => c.estado === 'por_revisar').length, incidencia: null, falta: false, notas: [] };
    const inc = db.prepare('SELECT tipo FROM main.incidencias_personal WHERE personal_id = ? AND cancelada = 0 AND fecha_inicio <= ? AND fecha_fin >= ? ORDER BY id DESC LIMIT 1').get(p.id, fecha, fecha);
    if (inc) r.incidencia = inc.tipo;
    if (laboral) {
      if (entrada !== null && entrada > min(dia.entrada) + hor.tolerancia) r.retardo_min = entrada - min(dia.entrada);
      if (salida !== null && salida < min(dia.salida)) r.salida_anticipada_min = min(dia.salida) - salida;
      if (hor.comida && comida > hor.comida) r.exceso_comida_min = comida - hor.comida;
      // Los bloques marcados con los botones solo cuentan FUERA del horario (auditoría 2026-11-05: apretar «Inicio» y
      // «Fin de tiempo extra» a media jornada convertía horas normales en extra).
      const desdeH = min(dia.entrada), hastaH = min(dia.salida), fuera = bloques.flatMap(([a, b]) => [[a, Math.min(b, desdeH)], [Math.max(a, hastaH), b]]);
      // Automático (reglas del tiempo extra): llegar antes (si cuenta y pasa los minutos) y quedarse después de la
      // salida (si llega a los minutos: entonces cuenta todo desde la salida). Con «solo botones», solo los bloques.
      const partes = [...fuera];
      for (const [k, [a, b]] of bloques.entries()) {
        pieza(a, Math.min(b, desdeH), bloqueIds[k].length === 1 ? `Marcó «Inicio de tiempo extra» al llegar y no marcó el fin: cuenta hasta su hora de entrada (${dia.entrada})` : 'Botones «Inicio / Fin de tiempo extra», antes de su entrada', true, bloqueIds[k]);
        pieza(Math.max(a, hastaH), b, 'Botones «Inicio / Fin de tiempo extra», después de su salida', true, bloqueIds[k]);
        pieza(Math.max(a, desdeH), Math.min(b, hastaH), 'Botones de tiempo extra dentro de su horario: no cuenta (son horas normales)', false, bloqueIds[k]);
      }
      if (porExtra) r.notas.push('Marcó «Inicio de tiempo extra» al llegar y no marcó «Entrada»: se tomó como su entrada');
      if (rg.modo === 'auto') {
        if (porExtra) { /* lo de antes de su entrada ya es el bloque del botón */ }
        else if (rg.antes_cuenta && entrada !== null && entrada < desdeH - rg.antes_min) { partes.push([entrada, desdeH]); pieza(entrada, desdeH, `Llegó antes de su entrada (${dia.entrada}): cuenta desde que llegó porque fue más de ${rg.antes_min} min antes`, true, [eId]); r.notas.push(`Llegó ${horas(desdeH - entrada)} antes de su entrada (cuenta como tiempo extra)`); }
        else if (entrada !== null && entrada < desdeH) pieza(entrada, desdeH, rg.antes_cuenta ? `Llegó antes de su entrada (${dia.entrada}): no cuenta, solo cuenta si llega más de ${rg.antes_min} min antes` : `Llegó antes de su entrada (${dia.entrada}): no cuenta (regla: llegar antes no es tiempo extra)`, false, [eId]);
        if (salida !== null && salida > hastaH) {
          if (salida - hastaH >= Math.max(1, rg.despues_min)) { partes.push([hastaH, salida]); pieza(hastaH, salida, `Se quedó después de su salida (${dia.salida})${rg.despues_min ? `: cuenta todo porque pasó los ${rg.despues_min} min` : ''}`, true, [sId]); }
          else { pieza(hastaH, salida, `Se quedó después de su salida (${dia.salida}): no cuenta, el tiempo extra empieza a los ${rg.despues_min} min`, false, [sId]); r.notas.push(`Se quedó ${horas(salida - hastaH)} después de su salida (no cuenta: el tiempo extra empieza a los ${rg.despues_min} min)`); }
        }
      } else {
        if (!porExtra) pieza(entrada, salida === null ? desdeH : Math.min(desdeH, salida), `Llegó antes de su entrada (${dia.entrada}): no cuenta (regla: solo cuenta lo marcado con los botones)`, false, [eId]);
        pieza(entrada === null ? hastaH : Math.max(hastaH, entrada), salida, `Se quedó después de su salida (${dia.salida}): no cuenta (regla: solo cuenta lo marcado con los botones)`, false, [sId]);
      }
      r.extra_min = unidos(partes);
      // La comida siempre se marca: si trabajó 6 h o más sin marcarla, RH lo ve (no se descuenta sola).
      if (hor.comida && trabajado >= 360 && !validas.some(c => c.tipo === 'comida_sale')) r.notas.push('No marcó su comida');
      if (entrada === null && fecha < hoy && !AUSENCIAS.includes(r.incidencia)) r.falta = true;
    } else if (trabajado !== null || bloques.length) {
      // Descanso o festivo trabajado: todo lo trabajado es tiempo extra (y se marca para pagarlo como tal).
      // Con la regla «en descanso o festivo todo es extra» apagada, solo cuentan los bloques marcados con los botones.
      r.extra_min = rg.descanso_todo ? unidos([...(trabajado !== null ? [[entrada, salida]] : []), ...bloques]) - (trabajado !== null ? comida : 0) : unidos(bloques);
      const que = festivo ? 'festivo' : 'día de descanso';
      if (trabajado !== null) pieza(entrada, salida, rg.descanso_todo ? `De su entrada a su salida: en ${que} todo lo trabajado es tiempo extra${comida ? ` (se le resta su comida de ${horas(comida)})` : ''}` : `De su entrada a su salida en ${que}: no cuenta (regla: solo cuenta lo marcado con los botones)`, !!rg.descanso_todo, [eId, sId]);
      for (const [k, [a, b]] of bloques.entries()) pieza(a, b, `Botones «Inicio / Fin de tiempo extra» en ${que}`, true, bloqueIds[k]);
      r.notas.push(festivo ? 'Festivo trabajado' : 'Descanso trabajado');
    }
    piezas.sort((x, y) => x.desde.localeCompare(y.desde) || x.hasta.localeCompare(y.hasta));
    if (deAnoche) piezas.unshift({ desde: hhmm(m(primera)), hasta: hhmm(m(primera)), min: 0, motivo: `Fin del tiempo extra que empezó ayer a las ${deAnoche.hora.slice(0, 5)}: se cuenta en el día anterior`, cuenta: false, checadas: [primera.id], ayer: true });
    else if (primera?.tipo === 'extra_termina') piezas.unshift({ desde: hhmm(m(primera)), hasta: hhmm(m(primera)), min: 0, motivo: 'Fin de tiempo extra sin un inicio antes: no cuenta', cuenta: false, checadas: [primera.id] });
    const det = { piezas, regla: `${rg.modo === 'auto' ? 'Automático' : 'Solo botones'} · después de la salida ${rg.despues_min ? 'desde ' + rg.despues_min + ' min' : 'desde el primer minuto'} · llegar antes ${rg.antes_cuenta ? 'cuenta si son más de ' + rg.antes_min + ' min' : 'no cuenta'} · ${rg.bloque_min === 1 ? 'minuto a minuto' : 'redondeo a bloques de ' + rg.bloque_min + ' min'} · descanso/festivo ${rg.descanso_todo ? 'todo es extra' : 'solo botones'}`, sin_redondeo_min: r.extra_min, redondeo: null };
    const sumaTramos = piezas.filter(x => x.cuenta).reduce((s, x) => s + x.min, 0) - (!laboral && rg.descanso_todo && trabajado !== null ? comida : 0);
    if (sumaTramos > r.extra_min) det.traslape_min = sumaTramos - r.extra_min;
    // Redondeo hacia abajo por día (reglas del tiempo extra).
    if (rg.bloque_min > 1 && r.extra_min > 0) {
      const redondo = Math.floor(r.extra_min / rg.bloque_min) * rg.bloque_min;
      if (redondo !== r.extra_min) r.notas.push(`Tiempo extra redondeado a bloques de ${rg.bloque_min} min (${horas(r.extra_min)} → ${horas(redondo)})`);
      det.redondeo = { bloque_min: rg.bloque_min, perdidos_min: r.extra_min - redondo };
      r.extra_min = redondo;
    }
    if (diaSemana(fecha) === 7 && (trabajado !== null || bloques.length)) r.notas.push('Domingo trabajado (prima dominical)');
    if (!hor) r.notas.push('Sin horario asignado');
    if (abierta !== null) r.notas.push('Salió a comer y no registró regreso');
    if (entrada !== null && salida === null && fecha < hoy) r.notas.push('Sin salida');
    // «Inicio de tiempo extra» sin «Fin»: ese bloque no cuenta (no se inventa la hora); RH agrega el fin real con motivo.
    if (ini !== null && fecha < hoy) r.notas.push('Inició tiempo extra y no marcó el fin');
    if (ini !== null) { det.sin_fin = hhmm(ini); det.sin_fin_checada = iniId; }
    if (finOtroDia) det.otras = [finOtroDia];
    r.extra_detalle = piezas.length || det.sin_fin ? det : null;
    const aut = db.prepare('SELECT minutos_autorizados, minutos_calculados, autorizado_por_nombre, motivo FROM main.extra_autorizaciones WHERE personal_id = ? AND fecha = ? ORDER BY id DESC LIMIT 1').get(p.id, fecha);
    r.extra_autorizado_min = aut ? Math.min(aut.minutos_autorizados, r.extra_min) : null;
    r.extra_autorizado_por = aut?.autorizado_por_nombre || null;
    r.extra_autorizado_motivo = aut?.motivo || null;
    if (aut && aut.minutos_calculados !== r.extra_min) r.notas.push('El tiempo extra cambió después de autorizarlo: revísalo');
    return r;
  }
  // Personas que checan, de las sucursales de quien pide (vista «personal»), activas en esa fecha.
  const gente = (fecha, personaId) => db.prepare(`SELECT id, nombre, puesto, sucursal_id FROM personal WHERE checa = 1 AND (activo = 1 OR fecha_baja >= ?)
    AND (fecha_ingreso IS NULL OR fecha_ingreso <= ?) ${personaId ? 'AND id = ?' : ''} ORDER BY nombre`).all(...[fecha, fecha, ...(personaId ? [personaId] : [])]);

  // Qué puede hacer quien pide en la pantalla de asistencia (y la fecha de hoy del servidor).
  app.get('/api/asistencia', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res);
    res.json({ hoy: ahoraMexico().fecha, puede: { corregir: puede(req, 'asistencia.corregir'), extra: puede(req, 'asistencia.extra'), horarios: puede(req, 'asistencia.horarios'), kioscos: puede(req, 'asistencia.kioscos') } });
  }));
  app.get('/api/asistencia/dia', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res);
    const fecha = req.query.fecha || ahoraMexico().fecha;
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    res.json({ fecha, festivo: festivoDe(fecha), filas: gente(fecha).map(p => calcularDia(p, fecha)), intentos: app.locals.checador?.intentosDe(fecha) || [], puede: { corregir: puede(req, 'asistencia.corregir'), extra: puede(req, 'asistencia.extra') } });
  }));
  // La semana de nómina de una fecha: cada día y los totales de cada persona que checa (de las sucursales de quien pide);
  // con «conDinero», también el pago del tiempo extra. La usan esta pantalla y la nómina (nomina.js, F3 contable).
  function resumenSemana(f, pid, conDinero) {
    const { desde, hasta } = semanaDe(f), fechas = [];
    for (let d = desde; d <= hasta; d = sumar(d, 1)) fechas.push(d);
    const filas = gente(hasta, pid).map(p => {
      const dias = fechas.map(f => calcularDia(p, f));
      const t = k => dias.reduce((s, d) => s + (d[k] || 0), 0), autorizado = dias.reduce((s, d) => s + (d.extra_autorizado_min || 0), 0);
      return { personal_id: p.id, nombre: p.nombre, puesto: p.puesto, dias, totales: {
        trabajado_min: t('trabajado_min'), retardos: dias.filter(d => d.retardo_min).length, retardo_min: t('retardo_min'), faltas: dias.filter(d => d.falta).length,
        extra_min: t('extra_min'), extra_autorizado_min: autorizado, extra_dobles_min: Math.min(autorizado, 540), extra_triples_min: Math.max(0, autorizado - 540),
        domingos: dias.filter(d => d.notas.some(n => n.startsWith('Domingo'))).length, festivos_trabajados: dias.filter(d => d.notas.includes('Festivo trabajado')).length,
        descansos_trabajados: dias.filter(d => d.notas.includes('Descanso trabajado')).length, dias_trabajados: dias.filter(d => d.entrada).length,
        vacaciones: dias.filter(d => d.incidencia === 'vacaciones').length, incapacidad: dias.filter(d => d.incidencia === 'incapacidad').length, permisos: dias.filter(d => d.incidencia === 'permiso').length,
        // Lo que hay que revisar antes de pagar: tiempo extra sin autorizar o sin fin, días sin salida o sin horario, checadas por revisar.
        extra_sin_autorizar_min: dias.reduce((s, d) => s + (d.extra_autorizado_min == null ? d.extra_min : 0), 0),
        sin_salida: dias.filter(d => d.notas.includes('Sin salida')).length, extra_sin_fin: dias.filter(d => d.notas.includes('Inició tiempo extra y no marcó el fin')).length, sin_horario: dias.filter(d => d.notas.includes('Sin horario asignado') && (d.entrada || d.salida)).length,
        por_revisar: t('por_revisar') } };
    });
    // Dinero del tiempo extra: solo para quien ve sueldos, con el precio del puesto vigente al cierre de la semana.
    if (conDinero) for (const f of filas) {
      const p = gente(hasta, f.personal_id)[0], pr = p ? precioDe(p.sucursal_id, p.puesto, hasta) : null, v = pr?.valor_cent ?? null;
      f.dinero = v == null ? { valor_hora_cent: null } : { valor_hora_cent: v, dobles_cent: pago(f.totales.extra_dobles_min, v, 2), triples_cent: pago(f.totales.extra_triples_min, v, 3) };
      if (v != null) f.dinero.total_cent = f.dinero.dobles_cent + f.dinero.triples_cent;
    }
    return { desde, hasta, fechas, filas };
  }
  // Semana de nómina (semana vencida, de lunes a domingo por omisión; ver las reglas): cada día y los totales.
  // Tiempo extra: dobles hasta 9 h autorizadas, luego triples. «vencida=1»: la última semana que ya cerró (la que se paga).
  app.get('/api/asistencia/semana', h((req, res) => {
    if (!veNomina(req)) return negar(res);
    const hoy = ahoraMexico().fecha, enCurso = semanaDe(hoy);
    let f = req.query.vencida === '1' ? sumar(enCurso.desde, -1) : req.query.desde || hoy;
    if (!fechaOk(f)) return res.status(400).json({ error: 'Revisa la fecha' });
    const pid = req.query.personal_id ? idDe(req.query.personal_id) : null;
    const dinero = verDinero(req) || puede(req, 'asistencia.nomina');
    const { desde, hasta, fechas, filas } = resumenSemana(f, pid, dinero);
    const rg = reglaDe(hasta);
    res.json({ desde, hasta, fechas, festivos: fechas.map(festivoDe), filas, en_curso: enCurso.desde, vencida: semanaDe(sumar(enCurso.desde, -1)).desde, anterior: semanaDe(sumar(desde, -1)).desde, siguiente: sumar(hasta, 1),
      semana_texto: `de ${DIAS[rg.inicio_semana].toLowerCase()} a ${DIAS[((rg.inicio_semana + 5) % 7) + 1].toLowerCase()}`, corta: fechas.length < 7, ...(dinero ? { dinero: true } : {}), puede: { asistencia: puede(req, 'asistencia.ver'), corregir: puede(req, 'asistencia.corregir'), extra: puede(req, 'asistencia.extra'), precios: cambiaPrecio(req) } });
  }));

  // ---------- Precio de la hora por puesto ----------
  // Valor de la hora NORMAL (centavos) de un puesto en una sucursal, vigente en una fecha. Antes del primer precio que
  // se capturó vale ese primero (si no, la semana que se paga el viernes en que se capturó quedaría sin precio).
  // null si el puesto nunca ha tenido precio.
  const precioDe = (sucursalId, puesto, fecha) => db.prepare('SELECT valor_cent, desde, creado_por_nombre FROM main.precios_hora_puesto WHERE sucursal_id = ? AND puesto = ? AND desde <= ? ORDER BY desde DESC, id DESC LIMIT 1').get(sucursalId, puesto, fecha)
    || db.prepare('SELECT valor_cent, desde, creado_por_nombre FROM main.precios_hora_puesto WHERE sucursal_id = ? AND puesto = ? ORDER BY desde, id DESC LIMIT 1').get(sucursalId, puesto) || null;
  // Pago de unos minutos a «factor» veces la hora normal, en centavos (enteros: nada de flotantes en el total).
  const pago = (minutos, valorCent, factor) => Math.round((minutos || 0) * valorCent * factor / 60);
  app.get('/api/asistencia/precios', h((req, res) => {
    if (!verDinero(req)) return negar(res, 'El precio de la hora lo ve quien ve sueldos');
    const hoy = ahoraMexico().fecha, puestos = app.locals.personal.PUESTOS;
    const sucursales = db.prepare('SELECT id, nombre FROM main.sucursales WHERE activo = 1 ORDER BY id').all().filter(s => req.alcanceSuc?.permitidas?.includes(s.id));
    res.json({ puestos, editar: cambiaPrecio(req), sucursales: sucursales.map(s => ({ ...s, precios: Object.fromEntries(puestos.map(pu => {
      const pr = precioDe(s.id, pu, hoy);
      return [pu, pr ? { valor: pr.valor_cent / 100, desde: pr.desde, por: pr.creado_por_nombre } : null];
    })) })) });
  }));
  app.put('/api/asistencia/precios', h((req, res) => {
    if (!cambiaPrecio(req)) return negar(res, 'El precio de la hora lo cambia quien ve sueldos y edita el personal');
    const b = req.body || {}, s = idDe(b.sucursal_id), puesto = String(b.puesto || '');
    if (!s || !req.alcanceSuc?.permitidas?.includes(s)) return res.status(400).json({ error: 'Elige una de tus sucursales' });
    if (!app.locals.personal.PUESTOS.includes(puesto)) return res.status(400).json({ error: 'Elige un puesto de la lista' });
    const v = Number(String(b.valor ?? '').replace(/[$,\s]/g, '')), cent = Math.round(v * 100);
    if (b.valor === '' || b.valor == null || !Number.isFinite(v) || v < 0 || v > 100000 || Math.abs(v * 100 - cent) > 1e-6) return res.status(400).json({ error: 'Escribe el precio de la hora en pesos (p. ej. 62.50), de 0 a 100,000' });
    const hoy = ahoraMexico().fecha, antes = precioDe(s, puesto, hoy);
    if (antes && antes.valor_cent === cent) return res.json({ ok: true, cambios: 0 });
    db.prepare('INSERT INTO main.precios_hora_puesto (sucursal_id, puesto, valor_cent, desde, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?, ?)').run(s, puesto, cent, hoy, req.usuarioSesion.id, req.usuarioSesion.nombre);
    const suc = db.prepare('SELECT nombre FROM main.sucursales WHERE id = ?').get(s)?.nombre || s;
    app.locals.auditoria?.registrar(req, 'precio_hora', s, 'cambio', `${suc} · ${puesto}: hora ${antes ? '$' + (antes.valor_cent / 100).toFixed(2) : 'sin precio'} → $${(cent / 100).toFixed(2)} desde ${hoy}`);
    res.json({ ok: true, cambios: 1 });
  }));

  // ---------- Tiempo extra ----------
  app.post('/api/asistencia/extra', h((req, res) => {
    if (!puede(req, 'asistencia.extra')) return negar(res, 'No tienes permiso para autorizar tiempo extra');
    const b = req.body || {}, p = db.prepare('SELECT id, nombre FROM personal WHERE id = ?').get(idDe(b.personal_id));
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'autorizar el tiempo extra')) return;
    if (!fechaOk(b.fecha) || b.fecha > ahoraMexico().fecha) return res.status(400).json({ error: 'Revisa la fecha (no puede ser futura)' });
    const minutos = Number(b.minutos), calc = calcularDia(p, b.fecha);
    if (!Number.isInteger(minutos) || minutos < 0) return res.status(400).json({ error: 'Los minutos autorizados deben ser un número entero' });
    if (minutos > calc.extra_min) return res.status(400).json({ error: `Solo hay ${calc.extra_min} minutos de tiempo extra registrados ese día` });
    const motivo = texto(b.motivo, 300);
    if (minutos < calc.extra_min && (!motivo || motivo.length < 4)) return res.status(400).json({ error: 'Si autorizas menos de lo registrado, escribe el motivo' });
    db.prepare('INSERT INTO main.extra_autorizaciones (personal_id, fecha, minutos_calculados, minutos_autorizados, motivo, autorizado_por, autorizado_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, b.fecha, calc.extra_min, minutos, motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
    audit(req, p.id, 'tiempo extra', `${p.nombre}: ${b.fecha} · autorizó ${minutos} de ${calc.extra_min} min${motivo ? ' · ' + motivo : ''}`);
    res.status(201).json(calcularDia(p, b.fecha));
  }));

  // ---------- Reglas del tiempo extra (2026-11-09) ----------
  // Las ve quien ve la asistencia; las cambia quien cambia los festivos (valen para toda la empresa). Cada cambio es una
  // versión nueva «desde» una fecha (hasta 7 días atrás o a futuro); lo anterior no cambia.
  const publicaRegla = r => r && ({ id: r.id, desde: r.desde, inicio_semana: r.inicio_semana, modo: r.modo, despues_min: r.despues_min, antes_cuenta: !!r.antes_cuenta, antes_min: r.antes_min, bloque_min: r.bloque_min, descanso_todo: !!r.descanso_todo, por: r.creado_por_nombre || null, created_at: r.created_at || null });
  app.get('/api/asistencia/reglas-extra', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res);
    const hoy = ahoraMexico().fecha, versiones = db.prepare('SELECT * FROM main.reglas_extra ORDER BY desde DESC, id DESC').all();
    res.json({ hoy, dias: DIAS, bloques: BLOQUES, dobles_semana_min: 540, vigente: publicaRegla(reglaDe(hoy)), semana_actual: semanaDe(hoy),
      proximas: versiones.filter(v => v.desde > hoy).map(publicaRegla).reverse(), versiones: versiones.map(publicaRegla), editar: editaFestivos(req) });
  }));
  app.put('/api/asistencia/reglas-extra', h((req, res) => {
    if (!editaFestivos(req)) return negar(res, 'Las reglas del tiempo extra valen para todas las sucursales: las cambia RH de la empresa o Dirección');
    const b = req.body || {}, n = (v, a, z) => { const x = Number(v); return Number.isInteger(x) && x >= a && x <= z ? x : null; };
    const r = { inicio_semana: n(b.inicio_semana, 1, 7), modo: ['auto', 'botones'].includes(b.modo) ? b.modo : null, despues_min: n(b.despues_min, 0, 240), antes_cuenta: b.antes_cuenta ? 1 : 0, antes_min: n(b.antes_min, 0, 240), bloque_min: BLOQUES.includes(Number(b.bloque_min)) ? Number(b.bloque_min) : null, descanso_todo: b.descanso_todo ? 1 : 0 };
    if (r.inicio_semana === null) return res.status(400).json({ error: 'Elige el día en que empieza la semana' });
    if (!r.modo) return res.status(400).json({ error: 'Elige cómo se cuenta el tiempo extra' });
    if (r.despues_min === null || r.antes_min === null) return res.status(400).json({ error: 'Los minutos van de 0 a 240' });
    if (r.bloque_min === null) return res.status(400).json({ error: 'Elige el redondeo (minuto a minuto, 5, 10, 15, 30 o 60 min)' });
    const desde = desdeDe(b);
    if (!desde) return res.status(400).json({ error: 'El cambio puede valer desde hace 7 días como máximo (lo anterior ya se calculó para la nómina)' });
    const antes = reglaDe(desde);
    if (antes && r.inicio_semana !== antes.inicio_semana && diaSemana(desde) !== r.inicio_semana)
      return res.status(400).json({ error: `Si cambias el día en que empieza la semana, el cambio debe valer desde un ${DIAS[r.inicio_semana].toLowerCase()} (el primer día de la semana nueva)` });
    const igual = antes && Object.keys(r).every(k => Number(antes[k]) === Number(r[k]) || antes[k] === r[k]);
    if (igual) return res.json({ ok: true, cambios: 0 });
    db.prepare('INSERT INTO main.reglas_extra (desde, inicio_semana, modo, despues_min, antes_cuenta, antes_min, bloque_min, descanso_todo, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(desde, r.inicio_semana, r.modo, r.despues_min, r.antes_cuenta, r.antes_min, r.bloque_min, r.descanso_todo, req.usuarioSesion.id, req.usuarioSesion.nombre);
    app.locals.auditoria?.registrar(req, 'reglas_extra', null, 'cambio', `Desde ${desde}: semana empieza ${DIAS[r.inicio_semana].toLowerCase()} · ${r.modo === 'auto' ? 'automático' : 'solo con botones'} · después de la salida desde ${r.despues_min} min · llegar antes ${r.antes_cuenta ? 'cuenta desde ' + r.antes_min + ' min' : 'no cuenta'} · redondeo ${r.bloque_min} min · descanso/festivo ${r.descanso_todo ? 'todo es extra' : 'solo botones'}`);
    res.json({ ok: true, cambios: 1 });
  }));

  // ---------- Horarios ----------
  const horarioCompleto = (hh, fecha) => {
    const versiones = db.prepare('SELECT id, desde, dias, tolerancia_min, comida_min, creado_por_nombre, created_at FROM main.horario_versiones WHERE horario_id = ? ORDER BY desde DESC, id DESC').all(hh.id).map(v => ({ ...v, dias: JSON.parse(v.dias) }));
    const vigente = versiones.find(v => v.desde <= fecha) || null, proxima = versiones.filter(v => v.desde > fecha).pop() || null;
    return { ...hh, vigente, proxima, versiones, personas: db.prepare('SELECT COUNT(*) n FROM personal p WHERE p.activo = 1 AND (SELECT horario_id FROM main.personal_horario ph WHERE ph.personal_id = p.id AND ph.desde <= ? ORDER BY ph.desde DESC, ph.id DESC LIMIT 1) = ?').get(fecha, hh.id).n };
  };
  app.get('/api/asistencia/horarios', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const hoy = ahoraMexico().fecha;
    sembrarHorarios(db);
    res.json({ dias: DIAS, horarios: db.prepare('SELECT h.*, s.nombre AS sucursal FROM horarios h LEFT JOIN main.sucursales s ON s.id = h.sucursal_id ORDER BY s.nombre, h.activo DESC, h.nombre').all().map(x => horarioCompleto(x, hoy)), puede: { editar: puede(req, 'asistencia.horarios'), precios: verDinero(req) } });
  }));
  const datosVersion = b => {
    const v = validarDias(b.dias); if (v.error) return v;
    const tol = Number(b.tolerancia_min), com = Number(b.comida_min);
    if (!Number.isInteger(tol) || tol < 0 || tol > 120) return { error: 'La tolerancia va de 0 a 120 minutos' };
    if (!Number.isInteger(com) || com < 0 || com > 240) return { error: 'La comida va de 0 a 240 minutos' };
    return { dias: v.dias, tol, com };
  };
  // Desde cuándo vale un cambio: hoy por omisión; hasta 7 días atrás (para corregir la semana en curso) o a futuro.
  const desdeDe = b => { const hoy = ahoraMexico().fecha, d = b.desde || hoy; return fechaOk(d) && d >= sumar(hoy, -7) ? d : null; };
  app.post('/api/asistencia/horarios', h((req, res) => {
    if (!puede(req, 'asistencia.horarios')) return negar(res, 'No tienes permiso para cambiar horarios');
    const nombre = texto(req.body?.nombre, 60);
    if (!nombre || nombre.length < 3 || /[<>{}]/.test(nombre)) return res.status(400).json({ error: 'Escribe el nombre del horario' });
    const suc = Number(req.body?.sucursal_id || (req.alcanceSuc?.permitidas?.length === 1 ? req.alcanceSuc.permitidas[0] : 0));
    if (!suc || !req.alcanceSuc?.permitidas?.includes(suc)) return res.status(400).json({ error: 'Elige una de tus sucursales' });
    if (db.prepare('SELECT 1 FROM main.horarios WHERE sucursal_id = ? AND nombre = ? COLLATE NOCASE').get(suc, nombre)) return res.status(409).json({ error: 'Ya hay un horario con ese nombre en esa sucursal' });
    const v = datosVersion(req.body || {}); if (v.error) return res.status(400).json({ error: v.error });
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO main.horarios (nombre, sucursal_id) VALUES (?, ?)').run(nombre, suc);
      db.prepare('INSERT INTO main.horario_versiones (horario_id, desde, dias, tolerancia_min, comida_min, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(r.lastInsertRowid, '2020-01-01', JSON.stringify(v.dias), v.tol, v.com, req.usuarioSesion.id, req.usuarioSesion.nombre);
      return Number(r.lastInsertRowid);
    })();
    app.locals.auditoria?.registrar(req, 'horario', id, 'alta', nombre);
    res.status(201).json(horarioCompleto(db.prepare('SELECT * FROM main.horarios WHERE id = ?').get(id), ahoraMexico().fecha));
  }));
  // Cambiar un horario = versión nueva desde una fecha (lo anterior se conserva). Activar o desactivar, aparte.
  app.put('/api/asistencia/horarios/:id', h((req, res) => {
    if (!puede(req, 'asistencia.horarios')) return negar(res, 'No tienes permiso para cambiar horarios');
    const hh = db.prepare('SELECT * FROM horarios WHERE id = ?').get(idDe(req.params.id)); // de sus sucursales
    if (!hh) return res.status(404).json({ error: 'Horario no encontrado' });
    const b = req.body || {};
    if (typeof b.activo === 'boolean') {
      db.prepare('UPDATE main.horarios SET activo = ? WHERE id = ?').run(b.activo ? 1 : 0, hh.id);
      app.locals.auditoria?.registrar(req, 'horario', hh.id, b.activo ? 'activado' : 'desactivado', hh.nombre);
      return res.json(horarioCompleto(db.prepare('SELECT * FROM main.horarios WHERE id = ?').get(hh.id), ahoraMexico().fecha));
    }
    const v = datosVersion(b); if (v.error) return res.status(400).json({ error: v.error });
    const desde = desdeDe(b); if (!desde) return res.status(400).json({ error: 'El cambio puede valer desde hace 7 días como máximo (lo anterior ya se calculó para la nómina)' });
    db.prepare('INSERT INTO main.horario_versiones (horario_id, desde, dias, tolerancia_min, comida_min, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(hh.id, desde, JSON.stringify(v.dias), v.tol, v.com, req.usuarioSesion.id, req.usuarioSesion.nombre);
    const resumen = Object.entries(v.dias).map(([d, x]) => `${DIAS[d].slice(0, 3)} ${x.entrada}-${x.salida}`).join(', ');
    app.locals.auditoria?.registrar(req, 'horario', hh.id, 'cambio', `${hh.nombre} desde ${desde}: ${resumen} · tolerancia ${v.tol} min · comida ${v.com} min`);
    res.json(horarioCompleto(hh, ahoraMexico().fecha));
  }));
  // Horario de una persona (con historial).
  app.get('/api/asistencia/personal/:id/horario', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const p = db.prepare('SELECT id, sucursal_id FROM personal WHERE id = ?').get(idDe(req.params.id));
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const hoy = ahoraMexico().fecha;
    res.json({ actual: asignadoDe(p.id, hoy) || null, historial: db.prepare('SELECT ph.desde, h.nombre, ph.asignado_por_nombre, ph.created_at FROM main.personal_horario ph JOIN main.horarios h ON h.id = ph.horario_id WHERE ph.personal_id = ? ORDER BY ph.desde DESC, ph.id DESC').all(p.id),
      horarios: db.prepare('SELECT id, nombre FROM main.horarios WHERE activo = 1 AND sucursal_id = ? ORDER BY nombre').all(p.sucursal_id), puede: { editar: puede(req, 'asistencia.horarios') } });
  }));
  const asignarHorario = (req, p, hh, desde) => {
    db.prepare('INSERT INTO main.personal_horario (personal_id, horario_id, desde, asignado_por, asignado_por_nombre) VALUES (?, ?, ?, ?, ?)').run(p.id, hh.id, desde, req.usuarioSesion.id, req.usuarioSesion.nombre);
    audit(req, p.id, 'horario', `${p.nombre}: horario «${hh.nombre}» desde ${desde}`);
  };
  // Horario activo de una sucursal por su nombre (para la carga en lote de RH).
  const horarioPorNombre = (sucursalId, nombre) => { sembrarHorarios(db); return db.prepare('SELECT id, nombre FROM main.horarios WHERE sucursal_id = ? AND activo = 1 AND nombre = ? COLLATE NOCASE').get(sucursalId, String(nombre || '').trim()) || null; };
  app.put('/api/asistencia/personal/:id/horario', h((req, res) => {
    if (!puede(req, 'asistencia.horarios')) return negar(res, 'No tienes permiso para asignar horarios');
    const p = db.prepare('SELECT id, nombre, sucursal_id FROM personal WHERE id = ?').get(idDe(req.params.id));
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'cambiar el horario')) return;
    const hh = db.prepare('SELECT id, nombre FROM main.horarios WHERE id = ? AND activo = 1 AND sucursal_id = ?').get(idDe(req.body?.horario_id), p.sucursal_id);
    if (!hh) return res.status(400).json({ error: 'Elige un horario activo de su sucursal' });
    // La primera vez que se le asigna horario puede valer desde antes (aún no se calculaba nada con otro horario).
    const primera = !db.prepare('SELECT 1 FROM main.personal_horario WHERE personal_id = ?').get(p.id), pedida = req.body?.desde;
    const desde = primera && fechaOk(pedida) && pedida <= ahoraMexico().fecha ? pedida : desdeDe(req.body || {});
    if (!desde) return res.status(400).json({ error: 'El cambio puede valer desde hace 7 días como máximo' });
    asignarHorario(req, p, hh, desde);
    res.json({ ok: true });
  }));

  // ---------- Días festivos ----------
  // Valen para TODA la empresa (no hay festivos por sucursal): los cambia quien tiene «Horarios y días festivos» y ve
  // todas las sucursales (RH de la empresa, Dirección). Auditoría 2026-11-05: el gerente de una sola sucursal declaraba
  // un festivo y en las demás todo lo trabajado ese día se volvía tiempo extra.
  const editaFestivos = req => puede(req, 'asistencia.horarios') && db.prepare('SELECT id FROM main.sucursales WHERE activo = 1').all().every(s => req.alcanceSuc?.permitidas?.includes(s.id));
  app.get('/api/asistencia/festivos', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const anio = /^\d{4}$/.test(String(req.query.anio || '')) ? String(req.query.anio) : ahoraMexico().fecha.slice(0, 4);
    if (Number(anio) >= 2020 && Number(anio) <= 2100) { const ins = db.prepare("INSERT OR IGNORE INTO main.dias_festivos (fecha, nombre, origen) VALUES (?, ?, 'ley')"); for (const [f, n] of festivosLey(Number(anio))) ins.run(f, n); }
    res.json({ anio, festivos: db.prepare('SELECT * FROM main.dias_festivos WHERE fecha LIKE ? ORDER BY fecha').all(anio + '-%'), puede: { editar: editaFestivos(req) } });
  }));
  app.post('/api/asistencia/festivos', h((req, res) => {
    if (!puede(req, 'asistencia.horarios')) return negar(res, 'No tienes permiso para cambiar los días festivos');
    if (!editaFestivos(req)) return negar(res, 'Los días festivos valen para todas las sucursales: los cambia RH de la empresa o Dirección');
    const fecha = String(req.body?.fecha || ''), nombre = texto(req.body?.nombre, 80);
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    if (!nombre || nombre.length < 3 || /[<>{}]/.test(nombre)) return res.status(400).json({ error: 'Escribe qué día es (p. ej. «Jornada electoral»)' });
    const activo = req.body?.activo !== false;
    db.prepare("INSERT INTO main.dias_festivos (fecha, nombre, origen, activo, cambiado_por, updated_at) VALUES (?, ?, 'empresa', ?, ?, datetime('now','localtime')) ON CONFLICT(fecha) DO UPDATE SET nombre = CASE WHEN origen = 'ley' THEN nombre ELSE excluded.nombre END, activo = excluded.activo, cambiado_por = excluded.cambiado_por, updated_at = excluded.updated_at")
      .run(fecha, nombre, activo ? 1 : 0, req.usuarioSesion.nombre);
    app.locals.auditoria?.registrar(req, 'dia_festivo', null, activo ? 'festivo' : 'festivo quitado', `${fecha} · ${nombre}`);
    res.json(db.prepare('SELECT * FROM main.dias_festivos WHERE fecha = ?').get(fecha));
  }));

  return { calcularDia, horarioDe, asignarHorario, horarioPorNombre, semanaDe, resumenSemana };
};
module.exports.festivosLey = festivosLey;
module.exports.unidos = unidos;
module.exports.inicioSemana = inicioSemana;
module.exports.semanaCon = semanaCon;
