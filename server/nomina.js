// MÓDULO CONTABLE · F3 (2026-11-11, aprobado por Dirección): NÓMINA SEMANAL.
// Decisiones de Dirección: las faltas solo se reportan (el descuento lo decide RH a mano); el sueldo se captura por SEMANA
// en la ficha, en dos partes: el registrado en el IMSS y el bono; se paga por Santander y Banorte.
//  1. Preparar: por sucursal y semana de nómina (la del checador), una línea por persona con sus dos sueldos (de la
//     ficha), el pago del tiempo extra autorizado (asistencia.js), días trabajados, faltas y retardos. Lo que el checador
//     tiene pendiente (extra sin autorizar, checadas por revisar, sin salida) se muestra.
//  2. A mano: descuento (con nota; p. ej. una falta, si RH decide descontarla), otros pagos (con nota) y el NETO del IMSS
//     que calcula el contador (ISR e IMSS los calcula él; aquí no se inventan). Total = neto IMSS + bono + extra + otros − descuento.
//  3. Cerrar: queda fija. No se cierra con pendientes del checador (solo Dirección puede forzarlo) ni sin el neto del
//     IMSS de quien tiene sueldo IMSS. Dirección la puede reabrir (con motivo) mientras no se pague.
//  4. Pagar: quien además mueve dinero. Se registra como gasto de «Sueldos» ya pagado (Cuentas por pagar, Flujo de banco
//     y Contabilidad) y se baja la lista para el banco con la CLABE de cada persona. El formato exacto de Santander y
//     Banorte queda pendiente de una muestra del portal de cada banco: por ahora es una lista genérica (CSV).
//  · BONO DE PUNTUALIDAD (2026-11-11, Dirección): reglas por sucursal y PUESTO (monto semanal, retardos y faltas
//    permitidos, minutos de retardo máximos opcional, desde qué fecha). Vacaciones, incapacidades y permisos se respetan
//    (el checador no los cuenta como falta). Solo para quien checa. Se calcula solo en la nómina; RH lo puede quitar a
//    una persona con motivo. Las reglas no se borran: un cambio es una versión nueva «desde» una fecha.
//  · Quién: «Preparar la nómina» (nomina.preparar; Gerente, y a quien Dirección se lo dé) y Dirección. Pagar: además
//    «Mover dinero». Lo de cada sucursal, solo con las sucursales que ve. Nada se borra.
const { hoyMexico } = require('./fechas');
const pesos = c => Math.round(Number(c || 0)) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function nomina(app, db, h) {
  const P = app.locals.permisos;
  const F = require('./finanzas');
  const { texto, conSentido, aCentavos, METODOS_PROV, fechaValida } = F;
  const fmt = c => '$' + pesos(c).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dma = f => String(f || '').slice(0, 10).split('-').reverse().join('/');

  db.exec(`CREATE TABLE IF NOT EXISTS nominas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    desde TEXT NOT NULL CHECK(length(desde) = 10 AND date(desde, '+0 days') = desde),
    hasta TEXT NOT NULL CHECK(length(hasta) = 10 AND date(hasta, '+0 days') = hasta AND hasta >= desde),
    estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN ('abierta', 'cerrada', 'pagada')),
    creada_por INTEGER NOT NULL REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizada_at TEXT,
    cerrada_por INTEGER REFERENCES usuarios(id), cerrada_at TEXT, forzada_motivo TEXT,
    pagada_por INTEGER REFERENCES usuarios(id), pagada_at TEXT, fecha_pago TEXT, metodo_pago TEXT, cuenta_origen TEXT, cxp_id INTEGER REFERENCES cuentas_por_pagar(id),
    UNIQUE(sucursal_id, desde),
    CHECK(estado = 'abierta' OR cerrada_por IS NOT NULL),
    CHECK(estado <> 'pagada' OR (pagada_por IS NOT NULL AND cxp_id IS NOT NULL))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS nomina_lineas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nomina_id INTEGER NOT NULL REFERENCES nominas(id),
    personal_id INTEGER NOT NULL REFERENCES personal(id),
    nombre TEXT NOT NULL, puesto TEXT, numero_empleado TEXT,
    sueldo_imss_cent INTEGER NOT NULL DEFAULT 0, bono_cent INTEGER NOT NULL DEFAULT 0, extra_cent INTEGER NOT NULL DEFAULT 0,
    extra_min INTEGER NOT NULL DEFAULT 0, sin_precio_extra INTEGER NOT NULL DEFAULT 0,
    dias_trabajados INTEGER NOT NULL DEFAULT 0, faltas INTEGER NOT NULL DEFAULT 0, retardos INTEGER NOT NULL DEFAULT 0, checa INTEGER NOT NULL DEFAULT 0,
    pendientes TEXT,
    descuento_cent INTEGER NOT NULL DEFAULT 0 CHECK(descuento_cent >= 0), descuento_nota TEXT,
    otros_cent INTEGER NOT NULL DEFAULT 0 CHECK(otros_cent >= 0), otros_nota TEXT,
    neto_imss_cent INTEGER CHECK(neto_imss_cent IS NULL OR neto_imss_cent >= 0),
    UNIQUE(nomina_id, personal_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_nominas_estado ON nominas(estado, desde)');
  { const cols = db.prepare('PRAGMA table_info(nomina_lineas)').all().map(c => c.name);
    for (const [c, tipo] of [['puntualidad_cent', 'INTEGER NOT NULL DEFAULT 0'], ['puntualidad_razon', 'TEXT'], ['puntualidad_quitada', 'INTEGER NOT NULL DEFAULT 0'], ['puntualidad_motivo', 'TEXT'], ['retardo_min', 'INTEGER NOT NULL DEFAULT 0']])
      if (!cols.includes(c)) db.exec(`ALTER TABLE nomina_lineas ADD COLUMN ${c} ${tipo}`); }
  db.exec(`CREATE TABLE IF NOT EXISTS reglas_puntualidad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    puesto TEXT NOT NULL,
    desde TEXT NOT NULL CHECK(length(desde) = 10 AND date(desde, '+0 days') = desde),
    monto_cent INTEGER NOT NULL CHECK(typeof(monto_cent) = 'integer' AND monto_cent >= 0),
    max_retardos INTEGER NOT NULL DEFAULT 0 CHECK(max_retardos BETWEEN 0 AND 7),
    max_faltas INTEGER NOT NULL DEFAULT 0 CHECK(max_faltas BETWEEN 0 AND 7),
    max_retardo_min INTEGER CHECK(max_retardo_min IS NULL OR max_retardo_min BETWEEN 0 AND 600),
    creada_por INTEGER NOT NULL REFERENCES usuarios(id), creada_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_reglas_puntualidad ON reglas_puntualidad(sucursal_id, puesto, desde)');
  { const t = (n, c) => { db.exec(`DROP TRIGGER IF EXISTS ${n}`); db.exec(`CREATE TRIGGER ${n} ${c}`); };
    t('reglas_puntualidad_fijas', `BEFORE UPDATE ON reglas_puntualidad BEGIN SELECT RAISE(ABORT, 'Una regla no se cambia: se pone una nueva desde otra fecha'); END`);
    t('reglas_puntualidad_sin_borrar', `BEFORE DELETE ON reglas_puntualidad BEGIN SELECT RAISE(ABORT, 'Las reglas no se borran: se pone una nueva (monto 0 = sin bono)'); END`); }
  // La regla vigente de una sucursal y puesto en una fecha (la última «desde» que ya empezó). Monto 0 = sin bono.
  const reglaDe = (sucursalId, puesto, fecha) => db.prepare('SELECT * FROM main.reglas_puntualidad WHERE sucursal_id = ? AND puesto = ? AND desde <= ? ORDER BY desde DESC, id DESC LIMIT 1').get(sucursalId, puesto, fecha) || null;
  const puntualidad = (regla, t) => {
    if (!regla || !regla.monto_cent) return { cent: 0, razon: null };
    const falla = [t.faltas > regla.max_faltas ? `${t.faltas} falta(s) (se permiten ${regla.max_faltas})` : '', t.retardos > regla.max_retardos ? `${t.retardos} retardo(s) (se permiten ${regla.max_retardos})` : '',
      regla.max_retardo_min != null && (t.retardo_min || 0) > regla.max_retardo_min ? `${t.retardo_min} min de retardo (máximo ${regla.max_retardo_min})` : ''].filter(Boolean);
    return falla.length ? { cent: 0, razon: 'No lo ganó: ' + falla.join(', ') } : { cent: regla.monto_cent, razon: `Lo ganó: ${t.faltas || 0} falta(s), ${t.retardos || 0} retardo(s)` };
  };
  const trigger = (nombre, cuerpo) => { db.exec(`DROP TRIGGER IF EXISTS ${nombre}`); db.exec(`CREATE TRIGGER ${nombre} ${cuerpo}`); };
  trigger('nominas_sin_borrar', `BEFORE DELETE ON nominas BEGIN SELECT RAISE(ABORT, 'Las nóminas no se borran'); END`);
  trigger('nomina_lineas_sin_borrar', `BEFORE DELETE ON nomina_lineas WHEN (SELECT estado FROM nominas WHERE id = OLD.nomina_id) <> 'abierta' BEGIN SELECT RAISE(ABORT, 'Una nómina cerrada no se cambia'); END`);
  trigger('nomina_lineas_fija', `BEFORE UPDATE ON nomina_lineas WHEN (SELECT estado FROM nominas WHERE id = OLD.nomina_id) <> 'abierta' BEGIN SELECT RAISE(ABORT, 'Una nómina cerrada no se cambia: Dirección la reabre si no se ha pagado'); END`);
  trigger('nominas_pagada_fija', `BEFORE UPDATE ON nominas WHEN OLD.estado = 'pagada' BEGIN SELECT RAISE(ABORT, 'Una nómina pagada no se cambia'); END`);

  const prepara = req => P.direccion(req) || P.puede(req, 'nomina.preparar');
  const paga = req => prepara(req) && (P.direccion(req) || P.puede(req, 'dinero.mover'));
  const negar = res => res.status(403).json({ error: 'La nómina la preparan Dirección y quien tiene «Preparar la nómina»' });
  const enAlcance = s => !!db.prepare('SELECT en_alcance(?) v').get(s).v;
  const puntualidadDe = l => (l.puntualidad_quitada ? 0 : l.puntualidad_cent || 0);
  const totalDe = l => (l.neto_imss_cent ?? l.sueldo_imss_cent) + l.bono_cent + l.extra_cent + puntualidadDe(l) + l.otros_cent - l.descuento_cent;
  const sucursalTxt = id => app.locals.sucursales?.claveDe?.(id) || '';

  // Las líneas que tocan a una sucursal y semana: quien está activo en la semana, de esa sucursal, si checa o tiene sueldo.
  function calcular(sucursalId, desde) {
    const A = app.locals.asistencia, Pe = app.locals.personal;
    const sem = A.resumenSemana(desde, null, true), porPersona = new Map(sem.filas.map(f => [f.personal_id, f]));
    const ids = db.prepare(`SELECT id FROM main.personal WHERE sucursal_id = ? AND (activo = 1 OR fecha_baja >= ?) AND (fecha_ingreso IS NULL OR fecha_ingreso <= ?) ORDER BY nombre`).all(sucursalId, sem.desde, sem.hasta).map(r => r.id);
    const lineas = [];
    // Auditoría del checador (2026-11-12) y de Finanzas (2026-11-13): una persona está en UNA sola nómina por semana,
    // sea cual sea su estado (abierta, cerrada o pagada). Quien ya está en la de otra sucursal (cambió de sucursal
    // después) no entra aquí; la pantalla dice en cuál está (enOtrasDe). Antes solo se miraban las no abiertas y, con
    // las dos abiertas, entraba en ambas y se pagaba dos veces.
    const yaEnOtra = db.prepare('SELECT 1 FROM main.nomina_lineas l JOIN main.nominas n ON n.id = l.nomina_id WHERE l.personal_id = ? AND n.desde = ? AND n.sucursal_id <> ?');
    const vigencia = db.prepare('SELECT fecha_ingreso, fecha_baja FROM main.personal WHERE id = ?');
    for (const id of ids) {
      const p = Pe.fichaPago(id), a = porPersona.get(id);
      if (!p) continue;
      if (yaEnOtra.get(id, sem.desde, sucursalId)) continue;
      const imss = p.sueldo_imss_semanal_cent || 0, bono = p.bono_semanal_cent || 0;
      if (!a && !imss && !bono) continue; // ni checa ni tiene sueldo semanal: no entra
      const t = a?.totales || {};
      const pend = a ? [t.extra_sin_autorizar_min ? `${t.extra_sin_autorizar_min} min de tiempo extra sin autorizar` : '', t.por_revisar ? `${t.por_revisar} checada(s) por revisar` : '',
        t.sin_salida ? `${t.sin_salida} día(s) sin salida` : '', t.extra_sin_fin ? `${t.extra_sin_fin} tiempo extra sin fin` : '',
        // Auditoría del checador 13-nov: M1 (el extra cambió después de autorizarlo: se pagaría lo viejo sin aviso) y G7
        // (extra autorizado y el puesto sin precio de la hora: salía en $0 y la nómina se cerraba igual).
        t.extra_autorizacion_vieja ? `${t.extra_autorizacion_vieja} día(s) con tiempo extra que cambió después de autorizarlo (vuelve a autorizarlo en Asistencia)` : '',
        t.extra_autorizado_min && a.dinero?.valor_hora_cent == null ? `${t.extra_autorizado_min} min de tiempo extra autorizado, pero su puesto (${p.puesto || 'sin puesto'}) no tiene precio de la hora en esta sucursal: el extra saldría en $0 (captúralo en Asistencia → Horarios → Precio de la hora)` : ''].filter(Boolean) : [];
      if (p.ilegibles.some(k => /sueldo|bono/.test(k))) pend.push('Su sueldo no se puede leer (clave de cifrado)');
      else if (!imss && !bono) pend.push('Sin sueldo semanal en su ficha (captúralo en Personal)');
      // Checa y no tiene horario asignado (2026-11-12): sin horario no hay faltas ni retardos que contar; antes ganaba la
      // puntualidad sin checar y nadie lo veía. Es un pendiente y no gana el bono hasta que se le asigne.
      const v = a ? vigencia.get(id) : null;
      // Quien ya no checa (solo sale por sus checadas o su extra de esos días): solo cuentan los días que sí checó.
      const sinHorario = a ? a.dias.filter(d => d.notas.includes('Sin horario asignado') && (a.checa || d.entrada || d.salida) && (!v?.fecha_ingreso || d.fecha >= v.fecha_ingreso) && (!v?.fecha_baja || d.fecha <= v.fecha_baja)).length : 0;
      if (sinHorario) pend.unshift(`Sin horario asignado ${sinHorario} día(s): no se pueden contar sus faltas ni retardos (asígnalo en Asistencia → Horarios)`);
      const regla = a?.checa ? reglaDe(sucursalId, p.puesto, sem.hasta) : null; // el bono de puntualidad, solo para quien checa
      const pu = !a?.checa ? { cent: 0, razon: null } : sinHorario && regla?.monto_cent ? { cent: 0, razon: 'No lo ganó: no tiene horario asignado (no se pueden contar sus faltas ni retardos)' } : puntualidad(regla, t);
      lineas.push({ personal_id: id, nombre: p.nombre, puesto: p.puesto, numero_empleado: p.numero_empleado || null, sueldo_imss_cent: imss, bono_cent: bono,
        puntualidad_cent: pu.cent, puntualidad_razon: pu.razon, retardo_min: t.retardo_min || 0,
        extra_cent: a?.dinero?.total_cent || 0, extra_min: t.extra_autorizado_min || 0, sin_precio_extra: a && t.extra_autorizado_min && a.dinero?.valor_hora_cent == null ? 1 : 0,
        dias_trabajados: t.dias_trabajados || 0, faltas: t.faltas || 0, retardos: t.retardos || 0, checa: a?.checa ? 1 : 0, pendientes: pend.length ? JSON.stringify(pend) : null });
    }
    return { desde: sem.desde, hasta: sem.hasta, lineas };
  }
  // Vuelve a leer checador y fichas en una nómina abierta, sin tocar lo capturado a mano.
  function refrescar(n) {
    const c = calcular(n.sucursal_id, n.desde);
    const ins = db.prepare(`INSERT INTO main.nomina_lineas (nomina_id, personal_id, nombre, puesto, numero_empleado, sueldo_imss_cent, bono_cent, extra_cent, extra_min, sin_precio_extra, dias_trabajados, faltas, retardos, checa, pendientes, puntualidad_cent, puntualidad_razon, retardo_min)
      VALUES (@nomina_id, @personal_id, @nombre, @puesto, @numero_empleado, @sueldo_imss_cent, @bono_cent, @extra_cent, @extra_min, @sin_precio_extra, @dias_trabajados, @faltas, @retardos, @checa, @pendientes, @puntualidad_cent, @puntualidad_razon, @retardo_min)
      ON CONFLICT(nomina_id, personal_id) DO UPDATE SET nombre = excluded.nombre, puesto = excluded.puesto, numero_empleado = excluded.numero_empleado, sueldo_imss_cent = excluded.sueldo_imss_cent,
        bono_cent = excluded.bono_cent, extra_cent = excluded.extra_cent, extra_min = excluded.extra_min, sin_precio_extra = excluded.sin_precio_extra, dias_trabajados = excluded.dias_trabajados,
        faltas = excluded.faltas, retardos = excluded.retardos, checa = excluded.checa, pendientes = excluded.pendientes,
        puntualidad_cent = excluded.puntualidad_cent, puntualidad_razon = excluded.puntualidad_razon, retardo_min = excluded.retardo_min`);
    db.transaction(() => {
      for (const l of c.lineas) ins.run({ nomina_id: n.id, ...l });
      // Quien ya no entra (cambió de sucursal, se quitó su sueldo) y no tiene nada capturado, sale.
      const siguen = new Set(c.lineas.map(l => l.personal_id));
      for (const l of db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ?').all(n.id))
        if (!siguen.has(l.personal_id) && !l.descuento_cent && !l.otros_cent && l.neto_imss_cent == null) db.prepare('DELETE FROM main.nomina_lineas WHERE id = ?').run(l.id);
      db.prepare("UPDATE main.nominas SET actualizada_at = datetime('now','localtime') WHERE id = ?").run(n.id);
    })();
  }
  // Quien es hoy de esta sucursal pero ya está en la nómina de la misma semana de otra (no entra aquí).
  const enOtrasDe = (sucursalId, desde) => !sucursalId || !desde ? [] : db.prepare(`SELECT p.id AS personal_id, p.nombre, n.id AS nomina_id, n.sucursal_id, n.estado
      FROM main.personal p JOIN main.nomina_lineas l ON l.personal_id = p.id JOIN main.nominas n ON n.id = l.nomina_id
      WHERE p.sucursal_id = ? AND n.desde = ? AND n.sucursal_id <> ? AND (p.activo = 1 OR p.fecha_baja >= ?) ORDER BY p.nombre`).all(sucursalId, desde, sucursalId, desde)
    .map(x => ({ ...x, sucursal: sucursalTxt(x.sucursal_id) }));
  // Las líneas de una nómina que también están en otra de la misma semana (datos de antes de la regla): no se cierra
  // ni se paga hasta que la persona quede en una sola.
  const duplicadasDe = n => db.prepare(`SELECT l.nombre, o.sucursal_id, o.estado FROM main.nomina_lineas l JOIN main.nomina_lineas x ON x.personal_id = l.personal_id AND x.nomina_id <> l.nomina_id
      JOIN main.nominas o ON o.id = x.nomina_id WHERE l.nomina_id = ? AND o.desde = ? ORDER BY l.nombre`).all(n.id, n.desde);
  const errorDuplicadas = (n, que) => {
    const d = duplicadasDe(n); if (!d.length) return null;
    return { error: `No se puede ${que}: ${d.map(x => `${x.nombre} también está en la nómina ${sucursalTxt(x.sucursal_id)} de esta semana (${x.estado})`).join(' · ')}. Una persona solo puede estar en una nómina por semana: en la que no le toca, borra lo capturado (neto, descuento, otros) y pulsa «Actualizar»${d.some(x => x.estado !== 'abierta') ? '; si esa otra ya está cerrada, Dirección la reabre primero' : ''}.`, codigo: 'EN_OTRA_NOMINA' };
  };
  // Ninguna línea en negativo (auditoría de Finanzas 2026-11-13): al cerrar se vuelve a leer la ficha y una línea podía
  // quedar negativa; el gasto «Sueldos» la restaba y la lista del banco la omitía.
  const errorNegativas = (lineas, que) => {
    const neg = lineas.filter(l => totalDe(l) < 0); if (!neg.length) return null;
    return { error: `No se puede ${que}: el total queda en negativo en ${neg.map(l => `${l.nombre} (−${fmt(-totalDe(l))})`).join(', ')}. Baja el descuento o revisa su sueldo en la ficha.`, codigo: 'NEGATIVO' };
  };
  const leer = id => db.prepare('SELECT n.*, uc.nombre AS cerro, up.nombre AS pago FROM main.nominas n LEFT JOIN main.usuarios uc ON uc.id = n.cerrada_por LEFT JOIN main.usuarios up ON up.id = n.pagada_por WHERE n.id = ?').get(Number(id) || 0);
  function salida(req, n, propuesta) {
    const lineas = (propuesta || db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ? ORDER BY nombre').all(n.id)).map(l => ({
      id: l.id || null, personal_id: l.personal_id, nombre: l.nombre, puesto: l.puesto, numero_empleado: l.numero_empleado || '', checa: !!l.checa,
      sueldo_imss: pesos(l.sueldo_imss_cent), bono: pesos(l.bono_cent), extra: pesos(l.extra_cent), extra_min: l.extra_min, sin_precio_extra: !!l.sin_precio_extra,
      dias_trabajados: l.dias_trabajados, faltas: l.faltas, retardos: l.retardos, pendientes: l.pendientes ? JSON.parse(l.pendientes) : [],
      descuento: pesos(l.descuento_cent || 0), descuento_nota: l.descuento_nota || '', otros: pesos(l.otros_cent || 0), otros_nota: l.otros_nota || '',
      puntualidad: pesos(puntualidadDe(l)), puntualidad_calculada: pesos(l.puntualidad_cent || 0), puntualidad_razon: l.puntualidad_razon || '', puntualidad_quitada: !!l.puntualidad_quitada, puntualidad_motivo: l.puntualidad_motivo || '',
      neto_imss: l.neto_imss_cent == null ? null : pesos(l.neto_imss_cent), falta_neto: (l.sueldo_imss_cent > 0) && l.neto_imss_cent == null,
      total: pesos(totalDe({ descuento_cent: 0, otros_cent: 0, neto_imss_cent: null, ...l })) }));
    const suma = k => Math.round(lineas.reduce((t, l) => t + Math.round(l[k] * 100), 0)) / 100;
    return { id: n?.id || null, estado: n?.estado || 'sin_preparar', sucursal_id: n?.sucursal_id, sucursal: sucursalTxt(n?.sucursal_id), desde: n?.desde, hasta: n?.hasta,
      cerro: n?.cerro || '', cerrada_at: n?.cerrada_at || '', forzada_motivo: n?.forzada_motivo || '', pago: n?.pago || '', fecha_pago: n?.fecha_pago || '', metodo_pago: n?.metodo_pago || '', cuenta_origen: n?.cuenta_origen || '',
      actualizada_at: n?.actualizada_at || '', lineas, en_otra: enOtrasDe(n?.sucursal_id, n?.desde),
      totales: { personas: lineas.length, sueldo_imss: suma('sueldo_imss'), bono: suma('bono'), extra: suma('extra'), puntualidad: suma('puntualidad'), descuento: suma('descuento'), otros: suma('otros'), total: suma('total'),
        faltas: lineas.reduce((t, l) => t + l.faltas, 0), retardos: lineas.reduce((t, l) => t + l.retardos, 0) },
      pendientes: lineas.filter(l => l.pendientes.length).length, sin_neto: lineas.filter(l => l.falta_neto).length,
      puede: { editar: prepara(req) && n?.estado === 'abierta', pagar: paga(req), reabrir: P.direccion(req) && n?.estado === 'cerrada', forzar: P.direccion(req) } };
  }
  const sucursalPedida = (req, valor) => {
    const s = Number(valor) || req.alcanceSuc?.permitidas?.[0] || null;
    return s && (app.locals.sucursales?.lista?.() || []).some(x => x.id === s) && enAlcance(s) ? s : null;
  };

  // ---------- Ver la nómina de una semana ----------
  // Si no se ha preparado, devuelve la propuesta (sin guardar nada).
  app.get('/api/nomina', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const f = req.query.desde || hoyMexico();
    if (!FECHA.test(f) || !fechaValida(f)) return res.status(400).json({ error: 'Revisa la fecha' });
    const suc = sucursalPedida(req, req.query.sucursal);
    if (!suc) return res.status(400).json({ error: 'Elige la sucursal' });
    const sem = app.locals.asistencia.semanaDe(f), en = app.locals.asistencia.semanaDe(hoyMexico());
    const n = db.prepare('SELECT id FROM main.nominas WHERE sucursal_id = ? AND desde = ?').get(suc, sem.desde);
    const base = n ? salida(req, leer(n.id)) : (() => { const c = calcular(suc, sem.desde); return { ...salida(req, { sucursal_id: suc, desde: c.desde, hasta: c.hasta }, c.lineas), estado: 'sin_preparar' }; })();
    const sucursales = (app.locals.sucursales?.lista?.() || []).filter(s => enAlcance(s.id)).map(s => ({ id: s.id, nombre: s.nombre, clave: s.clave }));
    const historial = db.prepare('SELECT id, desde, hasta, estado, sucursal_id FROM main.nominas WHERE en_alcance(sucursal_id) ORDER BY desde DESC LIMIT 20').all().map(x => ({ ...x, sucursal: sucursalTxt(x.sucursal_id) }));
    res.json({ ...base, sucursales, historial, en_curso: en.desde, vencida: app.locals.asistencia.semanaDe(sumarDias(en.desde, -1)).desde, anterior: app.locals.asistencia.semanaDe(sumarDias(sem.desde, -1)).desde, siguiente: sumarDias(sem.hasta, 1), metodos: METODOS_PROV });
  }));
  const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // ---------- Preparar (guardar) ----------
  app.post('/api/nomina/preparar', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const b = req.body || {}, f = b.desde || hoyMexico();
    if (!FECHA.test(f) || !fechaValida(f)) return res.status(400).json({ error: 'Revisa la fecha' });
    const suc = sucursalPedida(req, b.sucursal_id);
    if (!suc) return res.status(400).json({ error: 'Elige la sucursal' });
    const sem = app.locals.asistencia.semanaDe(f);
    if (sem.desde > hoyMexico()) return res.status(400).json({ error: 'Esa semana todavía no empieza' });
    let n = db.prepare('SELECT * FROM main.nominas WHERE sucursal_id = ? AND desde = ?').get(suc, sem.desde);
    if (!n) {
      const id = Number(db.prepare('INSERT INTO main.nominas (sucursal_id, desde, hasta, creada_por) VALUES (?, ?, ?, ?)').run(suc, sem.desde, sem.hasta, req.usuarioSesion.id).lastInsertRowid);
      n = db.prepare('SELECT * FROM main.nominas WHERE id = ?').get(id);
      app.locals.auditoria?.registrar(req, 'nomina', id, 'preparada', `Semana ${dma(sem.desde)}–${dma(sem.hasta)} · ${sucursalTxt(suc)}`);
    }
    if (n.estado === 'abierta') refrescar(n);
    res.status(201).json(salida(req, leer(n.id)));
  }));

  // ---------- Capturar a mano en una línea ----------
  app.put('/api/nomina/lineas/:id', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const l = db.prepare('SELECT l.*, n.estado, n.sucursal_id, n.id AS nid FROM main.nomina_lineas l JOIN main.nominas n ON n.id = l.nomina_id WHERE l.id = ?').get(Number(req.params.id) || 0);
    if (!l || !enAlcance(l.sucursal_id)) return res.status(404).json({ error: 'No se encontró esa línea de la nómina' });
    if (l.estado !== 'abierta') return res.status(409).json({ error: 'La nómina ya está cerrada' });
    const b = req.body || {}, cambios = {};
    const monto = (k, etiqueta) => {
      if (b[k] === undefined) return true;
      if (b[k] === null || String(b[k]).trim() === '') { cambios[k + '_cent'] = k === 'neto_imss' ? null : 0; return true; }
      const c = /^\s*0+(\.0+)?\s*$/.test(String(b[k])) ? 0 : aCentavos(b[k]);
      if (c === null || c === undefined) { res.status(400).json({ error: `Revisa ${etiqueta} (máximo 2 decimales)` }); return false; }
      cambios[k + '_cent'] = c; return true;
    };
    if (!monto('descuento', 'el descuento') || !monto('otros', 'los otros pagos') || !monto('neto_imss', 'el neto del IMSS')) return;
    for (const k of ['descuento_nota', 'otros_nota']) if (b[k] !== undefined) cambios[k] = texto(b[k], 200);
    // Quitarle (o regresarle) el bono de puntualidad a una persona: con motivo.
    if (b.quitar_puntualidad !== undefined) {
      if (b.quitar_puntualidad) {
        const m = texto(b.puntualidad_motivo, 200);
        if (!m || !conSentido(m, 5)) return res.status(400).json({ error: 'Escribe por qué se le quita el bono de puntualidad (mínimo 5 letras)' });
        cambios.puntualidad_quitada = 1; cambios.puntualidad_motivo = m;
      } else { cambios.puntualidad_quitada = 0; cambios.puntualidad_motivo = null; }
    }
    const nuevo = { ...l, ...cambios };
    if (nuevo.descuento_cent > 0 && !conSentido(nuevo.descuento_nota, 3)) return res.status(400).json({ error: 'Escribe por qué se descuenta (por ejemplo: falta del martes)' });
    if (nuevo.otros_cent > 0 && !conSentido(nuevo.otros_nota, 3)) return res.status(400).json({ error: 'Escribe qué son los otros pagos (por ejemplo: bono de puntualidad)' });
    if (nuevo.neto_imss_cent != null && nuevo.neto_imss_cent > nuevo.sueldo_imss_cent) return res.status(400).json({ error: `El neto del IMSS no puede ser mayor que el sueldo IMSS (${fmt(nuevo.sueldo_imss_cent)})` });
    if (totalDe(nuevo) < 0) return res.status(400).json({ error: 'Con ese descuento el total queda negativo' });
    const ks = Object.keys(cambios);
    if (ks.length) db.prepare(`UPDATE main.nomina_lineas SET ${ks.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...ks.map(k => cambios[k]), l.id);
    app.locals.auditoria?.registrar(req, 'nomina', l.nid, 'captura', `${l.nombre}: ${ks.map(k => k.replace('_cent', '')).join(', ')}`);
    res.json({ ok: true, total: pesos(totalDe(nuevo)) });
  }));

  // ---------- Volver a leer checador y fichas ----------
  app.post('/api/nomina/:id/actualizar', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const n = leer(req.params.id);
    if (!n || !enAlcance(n.sucursal_id)) return res.status(404).json({ error: 'No se encontró la nómina' });
    if (n.estado !== 'abierta') return res.status(409).json({ error: 'La nómina ya está cerrada' });
    refrescar(n);
    res.json(salida(req, leer(n.id)));
  }));

  // ---------- Cerrar ----------
  app.post('/api/nomina/:id/cerrar', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const n = leer(req.params.id);
    if (!n || !enAlcance(n.sucursal_id)) return res.status(404).json({ error: 'No se encontró la nómina' });
    if (n.estado !== 'abierta') return res.status(409).json({ error: 'La nómina ya está cerrada' });
    if (n.hasta >= hoyMexico()) return res.status(409).json({ error: `La semana termina el ${dma(n.hasta)}: se cierra cuando ya pasó` });
    refrescar(n);
    const lineas = db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ?').all(n.id);
    if (!lineas.length) return res.status(409).json({ error: 'No hay nadie en esta nómina (nadie checa ni tiene sueldo semanal en su ficha)' });
    const dup = errorDuplicadas(n, 'cerrar'); if (dup) return res.status(409).json(dup);
    const neg = errorNegativas(lineas, 'cerrar'); if (neg) return res.status(409).json(neg);
    // Le bajaron o quitaron el sueldo IMSS en la ficha después de capturar el neto (13-nov): se pagaba el neto viejo.
    const netoDeMas = lineas.filter(l => l.neto_imss_cent != null && l.neto_imss_cent > l.sueldo_imss_cent);
    if (netoDeMas.length) return res.status(409).json({ error: `El neto del IMSS es mayor que su sueldo IMSS en: ${netoDeMas.map(l => `${l.nombre} (neto ${fmt(l.neto_imss_cent)}, sueldo ${fmt(l.sueldo_imss_cent)})`).join(', ')}. Corrige el neto (o bórralo si ya no tiene sueldo IMSS).`, codigo: 'NETO_DE_MAS' });
    const sinNeto = lineas.filter(l => l.sueldo_imss_cent > 0 && l.neto_imss_cent == null);
    if (sinNeto.length) return res.status(409).json({ error: `Falta el neto del IMSS (lo da el contador) de: ${sinNeto.map(l => l.nombre).join(', ')}`, codigo: 'FALTA_NETO' });
    const conPend = lineas.filter(l => l.pendientes);
    let motivo = null;
    if (conPend.length) {
      if (!b(req).forzar || !P.direccion(req)) return res.status(409).json({ error: `Hay pendientes del checador: ${conPend.map(l => `${l.nombre} (${JSON.parse(l.pendientes).join('; ')})`).join(' · ')}. Resuélvelos en Asistencia y vuelve a intentar${P.direccion(req) ? ', o ciérrala de todos modos' : ''}.`, codigo: 'PENDIENTES', puede_forzar: P.direccion(req) });
      motivo = texto(b(req).motivo, 300) || 'Cerrada por Dirección con pendientes del checador';
    }
    db.prepare("UPDATE main.nominas SET estado = 'cerrada', cerrada_por = ?, cerrada_at = datetime('now','localtime'), forzada_motivo = ? WHERE id = ? AND estado = 'abierta'").run(req.usuarioSesion.id, motivo, n.id);
    const total = lineas.reduce((t, l) => t + totalDe(l), 0);
    app.locals.auditoria?.registrar(req, 'nomina', n.id, 'cerrada', `Semana ${dma(n.desde)}–${dma(n.hasta)} · ${sucursalTxt(n.sucursal_id)} · ${lineas.length} personas · ${fmt(total)}${motivo ? ' · ' + motivo : ''}`);
    res.json(salida(req, leer(n.id)));
  }));
  const b = req => req.body || {};

  // ---------- Reabrir (Dirección, antes de pagar) ----------
  app.post('/api/nomina/:id/reabrir', h((req, res) => {
    if (!P.direccion(req)) return res.status(403).json({ error: 'Solo Dirección reabre una nómina cerrada' });
    const n = leer(req.params.id);
    if (!n) return res.status(404).json({ error: 'No se encontró la nómina' });
    if (n.estado !== 'cerrada') return res.status(409).json({ error: n.estado === 'pagada' ? 'Ya se pagó: no se reabre' : 'La nómina está abierta' });
    const motivo = texto(b(req).motivo, 300);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe por qué se reabre (mínimo 5 letras)' });
    db.prepare("UPDATE main.nominas SET estado = 'abierta', cerrada_por = NULL, cerrada_at = NULL, forzada_motivo = NULL WHERE id = ?").run(n.id);
    app.locals.auditoria?.registrar(req, 'nomina', n.id, 'reabierta', motivo);
    res.json(salida(req, leer(n.id)));
  }));

  // ---------- Pagar ----------
  // Un gasto de «Sueldos» por la semana (ya pagado), a nombre de «Nómina (sueldos)», en la sucursal de la nómina.
  app.post('/api/nomina/:id/pagar', h((req, res) => {
    if (!paga(req)) return res.status(403).json({ error: 'La nómina la paga quien la prepara y además mueve dinero' });
    const n = leer(req.params.id);
    if (!n || !enAlcance(n.sucursal_id)) return res.status(404).json({ error: 'No se encontró la nómina' });
    if (n.estado !== 'cerrada') return res.status(409).json({ error: n.estado === 'pagada' ? 'Esa nómina ya se pagó' : 'Primero cierra la nómina' });
    const x = b(req), hoy = hoyMexico(), fecha = x.fecha || hoy;
    if (!fechaValida(fecha) || fecha > hoy) return res.status(400).json({ error: 'La fecha de pago no es válida o es futura' });
    if (!METODOS_PROV.includes(x.metodo)) return res.status(400).json({ error: 'Elige cómo se pagó (layout del banco, transferencia, efectivo…)' });
    // Folios de banco (2026-11-12): la cuenta de la que salió la nómina (con ella recibe su folio).
    const cta = app.locals.folios?.resolver(n.sucursal_id, x.cuenta_id, { requerida: true }) || {};
    if (cta.error) return res.status(400).json(cta);
    const cuenta = texto(x.cuenta_origen, 80) || cta.nombre;
    if (!cuenta) return res.status(400).json({ error: 'Escribe de qué cuenta salió (por ejemplo: Santander nómina, Banorte nómina)' });
    const lineas = db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ?').all(n.id), total = lineas.reduce((t, l) => t + totalDe(l), 0);
    const dup = errorDuplicadas(n, 'pagar'); if (dup) return res.status(409).json(dup);
    const neg = errorNegativas(lineas, 'pagar'); if (neg) return res.status(409).json(neg);
    if (total <= 0) return res.status(409).json({ error: 'La nómina no tiene nada que pagar' });
    const cxpId = db.transaction(() => {
      let prov = db.prepare("SELECT id FROM main.proveedores WHERE nombre = 'Nómina (sueldos)'").get();
      if (!prov) prov = { id: Number(db.prepare("INSERT INTO main.proveedores (nombre, categoria, dias_credito, notas) VALUES ('Nómina (sueldos)', 'sueldos', 0, 'Lo crea la nómina semanal: un gasto por semana pagada')").run().lastInsertRowid) };
      const concepto = `Nómina semana ${dma(n.desde)}–${dma(n.hasta)} (${lineas.filter(l => totalDe(l) > 0).length} personas)`;
      const info = db.prepare(`INSERT INTO main.cuentas_por_pagar (proveedor_id, categoria, concepto, fecha_documento, fecha_vencimiento, total_cent, notas, registrado_por, dias_credito, tipo_comprobante, iva_cent, iva_origen)
        VALUES (?, 'sueldos', ?, ?, ?, ?, ?, ?, 0, 'nomina', 0, 'manual')`).run(prov.id, concepto, n.hasta, n.hasta > fecha ? n.hasta : fecha, total, `Nómina #${n.id}: sueldo IMSS neto, bono, tiempo extra y otros, menos descuentos`, req.usuarioSesion.id);
      const id = Number(info.lastInsertRowid);
      app.locals.sucursales.asignar('cuentas_por_pagar', id, n.sucursal_id);
      db.prepare('INSERT INTO main.pagos_proveedor (cxp_id, fecha, monto_cent, metodo, referencia, registrado_por, cuenta_origen, cuenta_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, fecha < n.hasta ? n.hasta : fecha, total, x.metodo, texto(x.referencia, 120) || `Nómina ${dma(n.desde)}–${dma(n.hasta)}`, req.usuarioSesion.id, cuenta, cta.id ?? null);
      db.prepare("UPDATE main.nominas SET estado = 'pagada', pagada_por = ?, pagada_at = datetime('now','localtime'), fecha_pago = ?, metodo_pago = ?, cuenta_origen = ?, cxp_id = ? WHERE id = ? AND estado = 'cerrada'")
        .run(req.usuarioSesion.id, fecha < n.hasta ? n.hasta : fecha, x.metodo, cuenta, id, n.id);
      return id;
    })();
    app.locals.auditoria?.registrar(req, 'nomina', n.id, 'pagada', `${fmt(total)} · ${x.metodo} · ${cuenta} · gasto #${cxpId}`);
    res.json({ ...salida(req, leer(n.id)), cxp_id: cxpId });
  }));

  // ---------- Lista para el banco ----------
  // CSV con número, nombre, banco, CLABE e importe de cada persona (quien paga). El formato exacto de cada banco
  // (Santander, Banorte) se ajusta cuando haya una muestra vacía de su portal.
  app.get('/api/nomina/:id/lista-banco', h((req, res) => {
    if (!paga(req)) return res.status(403).json({ error: 'La lista para el banco (con las CLABE) la baja quien paga la nómina' });
    const n = leer(req.params.id);
    if (!n || !enAlcance(n.sucursal_id)) return res.status(404).json({ error: 'No se encontró la nómina' });
    if (n.estado === 'abierta') return res.status(409).json({ error: 'Primero cierra la nómina' });
    const csv = v => { const t = String(v ?? ''); return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const filas = [['No. empleado', 'Nombre', 'Banco', 'CLABE', 'Importe', 'Concepto', 'Revisar']];
    let sinClabe = 0;
    for (const l of db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ? ORDER BY nombre').all(n.id)) {
      const total = totalDe(l); if (total <= 0) continue;
      const p = app.locals.personal.fichaPago(l.personal_id) || {};
      if (!p.clabe) sinClabe++;
      filas.push([l.numero_empleado || '', l.nombre, p.banco || '', p.clabe || '', pesos(total).toFixed(2), `Nomina ${dma(n.desde)} al ${dma(n.hasta)}`, p.clabe ? '' : 'SIN CLABE: pagar aparte']);
    }
    app.locals.auditoria?.registrar(req, 'nomina', n.id, 'lista para el banco', `${filas.length - 1} personas${sinClabe ? ` · ${sinClabe} sin CLABE` : ''}`);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="nomina_${sucursalTxt(n.sucursal_id)}_${n.desde}.csv"`, 'Cache-Control': 'private, no-store' });
    res.send('﻿' + filas.map(f => f.map(csv).join(',')).join('\r\n') + '\r\n');
  }));

  // ---------- Reglas del bono de puntualidad ----------
  // Las vigentes hoy de una sucursal (una por puesto) y su historial. Quien prepara la nómina las pone.
  app.get('/api/nomina/reglas-puntualidad', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const suc = sucursalPedida(req, req.query.sucursal);
    if (!suc) return res.status(400).json({ error: 'Elige la sucursal' });
    const hoy = hoyMexico(), PUESTOS = app.locals.personal.PUESTOS;
    const todas = db.prepare('SELECT * FROM main.reglas_puntualidad WHERE sucursal_id = ? ORDER BY puesto, desde DESC, id DESC').all(suc);
    const fmtR = r => r && ({ id: r.id, puesto: r.puesto, desde: r.desde, monto: pesos(r.monto_cent), max_retardos: r.max_retardos, max_faltas: r.max_faltas, max_retardo_min: r.max_retardo_min, creada_por: r.creada_por_nombre || '', created_at: r.created_at });
    res.json({ sucursal_id: suc, puestos: PUESTOS,
      vigentes: PUESTOS.map(p => ({ puesto: p, regla: fmtR(reglaDe(suc, p, hoy)), proxima: fmtR(db.prepare('SELECT * FROM main.reglas_puntualidad WHERE sucursal_id = ? AND puesto = ? AND desde > ? ORDER BY desde, id LIMIT 1').get(suc, p, hoy)) })),
      historial: todas.map(fmtR) });
  }));
  app.post('/api/nomina/reglas-puntualidad', h((req, res) => {
    if (!prepara(req)) return negar(res);
    const x = b(req), suc = sucursalPedida(req, x.sucursal_id);
    if (!suc) return res.status(400).json({ error: 'Elige la sucursal' });
    if (!app.locals.personal.PUESTOS.includes(x.puesto)) return res.status(400).json({ error: 'Elige el puesto' });
    const monto = /^\s*0+(\.0+)?\s*$/.test(String(x.monto ?? '')) ? 0 : aCentavos(x.monto);
    if (monto === null || monto === undefined) return res.status(400).json({ error: 'Escribe el monto del bono por semana (0 = sin bono)' });
    const entero = (v, max, nombre) => { const n = v === '' || v === null || v === undefined ? 0 : Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : { error: `Revisa ${nombre} (de 0 a ${max})` }; };
    const mr = entero(x.max_retardos, 7, 'los retardos permitidos'), mf = entero(x.max_faltas, 7, 'las faltas permitidas');
    if (mr.error || mf.error) return res.status(400).json({ error: (mr.error || mf.error) });
    const mm = x.max_retardo_min === '' || x.max_retardo_min === null || x.max_retardo_min === undefined ? null : entero(x.max_retardo_min, 600, 'los minutos de retardo');
    if (mm?.error) return res.status(400).json({ error: mm.error });
    const desde = x.desde || hoyMexico();
    if (!FECHA.test(desde) || !fechaValida(desde)) return res.status(400).json({ error: 'Revisa la fecha desde la que aplica' });
    // Una nómina ya cerrada o pagada no cambia: la regla nueva no puede empezar dentro de una semana ya cerrada.
    const cerrada = db.prepare("SELECT desde, hasta FROM main.nominas WHERE sucursal_id = ? AND estado <> 'abierta' AND hasta >= ? ORDER BY desde LIMIT 1").get(suc, desde);
    if (cerrada) return res.status(409).json({ error: `La nómina del ${dma(cerrada.desde)} al ${dma(cerrada.hasta)} ya está cerrada: la regla debe empezar después del ${dma(cerrada.hasta)}` });
    const id = Number(db.prepare('INSERT INTO main.reglas_puntualidad (sucursal_id, puesto, desde, monto_cent, max_retardos, max_faltas, max_retardo_min, creada_por, creada_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(suc, x.puesto, desde, monto, mr, mf, mm, req.usuarioSesion.id, req.usuarioSesion.nombre).lastInsertRowid);
    app.locals.auditoria?.registrar(req, 'nomina', null, 'regla de puntualidad', `${sucursalTxt(suc)} · ${x.puesto} · ${monto ? fmt(monto) : 'sin bono'} desde ${dma(desde)} · retardos ≤ ${mr}, faltas ≤ ${mf}${mm != null ? `, ≤ ${mm} min de retardo` : ''}`);
    // Las nóminas abiertas de esa sucursal se vuelven a calcular con la regla nueva.
    for (const n of db.prepare("SELECT * FROM main.nominas WHERE sucursal_id = ? AND estado = 'abierta' AND hasta >= ?").all(suc, desde)) refrescar(n);
    res.status(201).json({ id });
  }));

  // ---------- Avisos para Inicio ----------
  app.get('/api/nomina/avisos', h((req, res) => {
    if (!prepara(req)) return res.json({ avisos: [] });
    const A = app.locals.asistencia, vencida = A.semanaDe(sumarDias(A.semanaDe(hoyMexico()).desde, -1));
    const avisos = [];
    for (const s of (app.locals.sucursales?.lista?.() || []).filter(x => enAlcance(x.id))) {
      const n = db.prepare('SELECT * FROM main.nominas WHERE sucursal_id = ? AND desde = ?').get(s.id, vencida.desde);
      if (!n || n.estado === 'abierta') {
        const hay = db.prepare('SELECT 1 FROM main.personal WHERE sucursal_id = ? AND activo = 1 AND (checa = 1 OR sueldo_imss_semanal_cent IS NOT NULL OR bono_semanal_cent IS NOT NULL) LIMIT 1').get(s.id);
        if (hay) avisos.push({ tipo: 'cerrar', desde: vencida.desde, sucursal_id: s.id, urgente: true, texto: `Nómina ${s.clave} de la semana ${dma(vencida.desde)}–${dma(vencida.hasta)} sin cerrar`, detalle: n ? 'Está abierta: revisa descuentos y el neto del IMSS, y ciérrala' : 'Todavía no se prepara' });
      }
    }
    if (paga(req)) for (const n of db.prepare("SELECT * FROM main.nominas WHERE estado = 'cerrada' AND en_alcance(sucursal_id) ORDER BY desde").all())
      avisos.push({ tipo: 'pagar', desde: n.desde, sucursal_id: n.sucursal_id, urgente: true, texto: `Nómina ${sucursalTxt(n.sucursal_id)} de la semana ${dma(n.desde)}–${dma(n.hasta)} cerrada sin pagar`, detalle: 'Baja la lista para el banco y registra el pago' });
    res.json({ avisos });
  }));
};
