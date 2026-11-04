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
//    horario, unido con los bloques «inicio / fin de tiempo extra» (sin contar dos veces). En descanso o festivo, todo lo
//    trabajado es extra (y se marca). Falta = día laboral ya pasado sin entrada, sin vacaciones/incapacidad/permiso.
//  · Tiempo extra: lo AUTORIZAN RH y el Gerente (permiso «Autorizar tiempo extra»), hasta los minutos calculados. Cada
//    autorización es un registro nuevo (la última cuenta); no se borran. Semana: las primeras 9 horas autorizadas son
//    dobles y lo demás triples (arts. 67 y 68 LFT).
const { ahoraMexico } = require('./fechas');

const DIAS = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
const AUSENCIAS = ['vacaciones', 'incapacidad', 'permiso'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const fechaOk = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const texto = (v, max) => { const t = String(v ?? '').trim().replace(/\s+/g, ' '); return t ? t.slice(0, max) : null; };
const min = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const sumar = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSemana = f => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
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
    CREATE TRIGGER IF NOT EXISTS horario_versiones_no_borrar BEFORE DELETE ON horario_versiones BEGIN SELECT RAISE(ABORT, 'El historial de horarios no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS personal_horario_no_borrar BEFORE DELETE ON personal_horario BEGIN SELECT RAISE(ABORT, 'El historial de horarios no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS extra_autorizaciones_fijas BEFORE UPDATE ON extra_autorizaciones BEGIN SELECT RAISE(ABORT, 'Una autorización de tiempo extra se corrige con otra nueva'); END;
    CREATE TRIGGER IF NOT EXISTS extra_autorizaciones_no_borrar BEFORE DELETE ON extra_autorizaciones BEGIN SELECT RAISE(ABORT, 'Las autorizaciones de tiempo extra no se borran'); END;
  `);
  sembrarHorarios(db);
      db.prepare("INSERT INTO horario_versiones (horario_id, desde, dias, tolerancia_min, comida_min, creado_por_nombre) VALUES (?, ?, ?, 10, 60, 'Sistema')")
  // Festivos de la ley de este año y el siguiente (no revive uno que RH desactivó).
  const anio = Number(ahoraMexico().fecha.slice(0, 4)), ins = db.prepare("INSERT OR IGNORE INTO dias_festivos (fecha, nombre, origen) VALUES (?, ?, 'ley')");
  for (const a of [anio, anio + 1]) for (const [f, n] of festivosLey(a)) ins.run(f, n);
}

module.exports = function asistencia(app, db, h) {
  migrar(db);
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para la asistencia' });

  // ---------- Horario vigente ----------
  const versionDe = (horarioId, fecha) => db.prepare('SELECT * FROM main.horario_versiones WHERE horario_id = ? AND desde <= ? ORDER BY desde DESC, id DESC LIMIT 1').get(horarioId, fecha);
  const asignadoDe = (personaId, fecha) => db.prepare('SELECT ph.horario_id, h.nombre FROM main.personal_horario ph JOIN main.horarios h ON h.id = ph.horario_id WHERE ph.personal_id = ? AND ph.desde <= ? ORDER BY ph.desde DESC, ph.id DESC LIMIT 1').get(personaId, fecha);
  function horarioDe(personaId, fecha) {
    const a = asignadoDe(personaId, fecha); if (!a) return null;
    const v = versionDe(a.horario_id, fecha); if (!v) return null;
    return { id: a.horario_id, nombre: a.nombre, dias: JSON.parse(v.dias), tolerancia: v.tolerancia_min, comida: v.comida_min };
  }
  const festivoDe = fecha => db.prepare('SELECT nombre FROM main.dias_festivos WHERE fecha = ? AND activo = 1').get(fecha)?.nombre || null;

  // ---------- Cálculo de un día ----------
  function calcularDia(p, fecha, hoy = ahoraMexico().fecha) {
    const hor = horarioDe(p.id, fecha), dia = hor?.dias[diaSemana(fecha)] || null, festivo = festivoDe(fecha);
    const laboral = !!dia && !festivo;
    const ch = db.prepare('SELECT id, tipo, hora, estado, origen, sin_conexion FROM main.checadas WHERE personal_id = ? AND fecha = ? AND estado <> \'anulada\' ORDER BY momento_utc, id').all(p.id, fecha);
    const validas = ch.filter(c => c.estado === 'valida'), m = c => min(c.hora.slice(0, 5));
    const entradas = validas.filter(c => c.tipo === 'entrada'), salidas = validas.filter(c => c.tipo === 'salida');
    const entrada = entradas.length ? m(entradas[0]) : null, salida = salidas.length ? m(salidas[salidas.length - 1]) : null;
    // Comida: cada salida a comer con el regreso que le sigue.
    let comida = 0, abierta = null;
    for (const c of validas) { if (c.tipo === 'comida_sale') abierta = m(c); else if (c.tipo === 'comida_regresa' && abierta !== null) { comida += Math.max(0, m(c) - abierta); abierta = null; } }
    // Bloques de tiempo extra marcados con los botones.
    const bloques = []; let ini = null;
    for (const c of validas) { if (c.tipo === 'extra_inicia') ini = m(c); else if (c.tipo === 'extra_termina' && ini !== null) { bloques.push([ini, m(c)]); ini = null; } }
    const trabajado = entrada !== null && salida !== null && salida > entrada ? salida - entrada - comida : null;
    const r = { personal_id: p.id, nombre: p.nombre, fecha, dia: DIAS[diaSemana(fecha)], horario: hor?.nombre || null, programado: dia, festivo, laboral,
      entrada: entrada === null ? null : entradas[0].hora.slice(0, 5), salida: salida === null ? null : salidas[salidas.length - 1].hora.slice(0, 5),
      comida_min: comida, trabajado_min: trabajado, retardo_min: 0, exceso_comida_min: 0, salida_anticipada_min: 0, extra_min: 0,
      por_revisar: ch.filter(c => c.estado === 'por_revisar').length, incidencia: null, falta: false, notas: [] };
    const inc = db.prepare('SELECT tipo FROM main.incidencias_personal WHERE personal_id = ? AND cancelada = 0 AND fecha_inicio <= ? AND fecha_fin >= ? ORDER BY id DESC LIMIT 1').get(p.id, fecha, fecha);
    if (inc) r.incidencia = inc.tipo;
    if (laboral) {
      if (entrada !== null && entrada > min(dia.entrada) + hor.tolerancia) r.retardo_min = entrada - min(dia.entrada);
      if (salida !== null && salida < min(dia.salida)) r.salida_anticipada_min = min(dia.salida) - salida;
      if (hor.comida && comida > hor.comida) r.exceso_comida_min = comida - hor.comida;
      r.extra_min = unidos([...(salida !== null ? [[min(dia.salida), salida]] : []), ...bloques]);
      if (entrada === null && fecha < hoy && !AUSENCIAS.includes(r.incidencia)) r.falta = true;
    } else if (trabajado !== null || bloques.length) {
      // Descanso o festivo trabajado: todo lo trabajado es tiempo extra (y se marca para pagarlo como tal).
      r.extra_min = unidos([...(trabajado !== null ? [[entrada, salida]] : []), ...bloques]) - (trabajado !== null ? comida : 0);
      r.notas.push(festivo ? 'Festivo trabajado' : 'Descanso trabajado');
    }
    if (diaSemana(fecha) === 7 && (trabajado !== null || bloques.length)) r.notas.push('Domingo trabajado (prima dominical)');
    if (!hor) r.notas.push('Sin horario asignado');
    if (abierta !== null) r.notas.push('Salió a comer y no registró regreso');
    if (entrada !== null && salida === null && fecha < hoy) r.notas.push('Sin salida');
    const aut = db.prepare('SELECT minutos_autorizados, minutos_calculados, autorizado_por_nombre, motivo FROM main.extra_autorizaciones WHERE personal_id = ? AND fecha = ? ORDER BY id DESC LIMIT 1').get(p.id, fecha);
    r.extra_autorizado_min = aut ? Math.min(aut.minutos_autorizados, r.extra_min) : null;
    r.extra_autorizado_por = aut?.autorizado_por_nombre || null;
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
    res.json({ fecha, festivo: festivoDe(fecha), filas: gente(fecha).map(p => calcularDia(p, fecha)), puede: { corregir: puede(req, 'asistencia.corregir'), extra: puede(req, 'asistencia.extra') } });
  }));
  // Semana (lunes a domingo): cada día y los totales para la nómina. Tiempo extra: dobles hasta 9 h autorizadas, luego triples.
  app.get('/api/asistencia/semana', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res);
    let desde = req.query.desde || ahoraMexico().fecha;
    if (!fechaOk(desde)) return res.status(400).json({ error: 'Revisa la fecha' });
    desde = sumar(desde, 1 - diaSemana(desde));
    const fechas = [0, 1, 2, 3, 4, 5, 6].map(i => sumar(desde, i)), pid = req.query.personal_id ? idDe(req.query.personal_id) : null;
    const filas = gente(fechas[6], pid).map(p => {
      const dias = fechas.map(f => calcularDia(p, f));
      const t = k => dias.reduce((s, d) => s + (d[k] || 0), 0), autorizado = dias.reduce((s, d) => s + (d.extra_autorizado_min || 0), 0);
      return { personal_id: p.id, nombre: p.nombre, puesto: p.puesto, dias, totales: {
        trabajado_min: t('trabajado_min'), retardos: dias.filter(d => d.retardo_min).length, retardo_min: t('retardo_min'), faltas: dias.filter(d => d.falta).length,
        extra_min: t('extra_min'), extra_autorizado_min: autorizado, extra_dobles_min: Math.min(autorizado, 540), extra_triples_min: Math.max(0, autorizado - 540),
        domingos: dias.filter(d => d.notas.some(n => n.startsWith('Domingo'))).length, festivos_trabajados: dias.filter(d => d.notas.includes('Festivo trabajado')).length,
        por_revisar: t('por_revisar') } };
    });
    res.json({ desde, hasta: fechas[6], fechas, festivos: fechas.map(festivoDe), filas, puede: { corregir: puede(req, 'asistencia.corregir'), extra: puede(req, 'asistencia.extra') } });
  }));

  // ---------- Tiempo extra ----------
  app.post('/api/asistencia/extra', h((req, res) => {
    if (!puede(req, 'asistencia.extra')) return negar(res, 'No tienes permiso para autorizar tiempo extra');
    const b = req.body || {}, p = db.prepare('SELECT id, nombre FROM personal WHERE id = ?').get(idDe(b.personal_id));
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
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
    res.json({ dias: DIAS, horarios: db.prepare('SELECT h.*, s.nombre AS sucursal FROM horarios h LEFT JOIN main.sucursales s ON s.id = h.sucursal_id ORDER BY s.nombre, h.activo DESC, h.nombre').all().map(x => horarioCompleto(x, hoy)), puede: { editar: puede(req, 'asistencia.horarios') } });
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
  app.put('/api/asistencia/personal/:id/horario', h((req, res) => {
    if (!puede(req, 'asistencia.horarios')) return negar(res, 'No tienes permiso para asignar horarios');
    const p = db.prepare('SELECT id, nombre, sucursal_id FROM personal WHERE id = ?').get(idDe(req.params.id));
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const hh = db.prepare('SELECT id, nombre FROM main.horarios WHERE id = ? AND activo = 1 AND sucursal_id = ?').get(idDe(req.body?.horario_id), p.sucursal_id);
    if (!hh) return res.status(400).json({ error: 'Elige un horario activo de su sucursal' });
    // La primera vez que se le asigna horario puede valer desde antes (aún no se calculaba nada con otro horario).
    const primera = !db.prepare('SELECT 1 FROM main.personal_horario WHERE personal_id = ?').get(p.id), pedida = req.body?.desde;
    const desde = primera && fechaOk(pedida) && pedida <= ahoraMexico().fecha ? pedida : desdeDe(req.body || {});
    if (!desde) return res.status(400).json({ error: 'El cambio puede valer desde hace 7 días como máximo' });
    db.prepare('INSERT INTO main.personal_horario (personal_id, horario_id, desde, asignado_por, asignado_por_nombre) VALUES (?, ?, ?, ?, ?)').run(p.id, hh.id, desde, req.usuarioSesion.id, req.usuarioSesion.nombre);
    audit(req, p.id, 'horario', `${p.nombre}: horario «${hh.nombre}» desde ${desde}`);
    res.json({ ok: true });
  }));

  // ---------- Días festivos ----------
  app.get('/api/asistencia/festivos', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const anio = /^\d{4}$/.test(String(req.query.anio || '')) ? String(req.query.anio) : ahoraMexico().fecha.slice(0, 4);
    if (Number(anio) >= 2020 && Number(anio) <= 2100) { const ins = db.prepare("INSERT OR IGNORE INTO main.dias_festivos (fecha, nombre, origen) VALUES (?, ?, 'ley')"); for (const [f, n] of festivosLey(Number(anio))) ins.run(f, n); }
    res.json({ anio, festivos: db.prepare('SELECT * FROM main.dias_festivos WHERE fecha LIKE ? ORDER BY fecha').all(anio + '-%'), puede: { editar: puede(req, 'asistencia.horarios') } });
  }));
  app.post('/api/asistencia/festivos', h((req, res) => {
    if (!puede(req, 'asistencia.horarios')) return negar(res, 'No tienes permiso para cambiar los días festivos');
    const fecha = String(req.body?.fecha || ''), nombre = texto(req.body?.nombre, 80);
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    if (!nombre || nombre.length < 3 || /[<>{}]/.test(nombre)) return res.status(400).json({ error: 'Escribe qué día es (p. ej. «Jornada electoral»)' });
    const activo = req.body?.activo !== false;
    db.prepare("INSERT INTO main.dias_festivos (fecha, nombre, origen, activo, cambiado_por, updated_at) VALUES (?, ?, 'empresa', ?, ?, datetime('now','localtime')) ON CONFLICT(fecha) DO UPDATE SET nombre = CASE WHEN origen = 'ley' THEN nombre ELSE excluded.nombre END, activo = excluded.activo, cambiado_por = excluded.cambiado_por, updated_at = excluded.updated_at")
      .run(fecha, nombre, activo ? 1 : 0, req.usuarioSesion.nombre);
    app.locals.auditoria?.registrar(req, 'dia_festivo', null, activo ? 'festivo' : 'festivo quitado', `${fecha} · ${nombre}`);
    res.json(db.prepare('SELECT * FROM main.dias_festivos WHERE fecha = ?').get(fecha));
  }));

  return { calcularDia, horarioDe };
};
module.exports.festivosLey = festivosLey;
module.exports.unidos = unidos;
