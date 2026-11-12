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
  const trigger = (nombre, cuerpo) => { db.exec(`DROP TRIGGER IF EXISTS ${nombre}`); db.exec(`CREATE TRIGGER ${nombre} ${cuerpo}`); };
  trigger('nominas_sin_borrar', `BEFORE DELETE ON nominas BEGIN SELECT RAISE(ABORT, 'Las nóminas no se borran'); END`);
  trigger('nomina_lineas_sin_borrar', `BEFORE DELETE ON nomina_lineas WHEN (SELECT estado FROM nominas WHERE id = OLD.nomina_id) <> 'abierta' BEGIN SELECT RAISE(ABORT, 'Una nómina cerrada no se cambia'); END`);
  trigger('nomina_lineas_fija', `BEFORE UPDATE ON nomina_lineas WHEN (SELECT estado FROM nominas WHERE id = OLD.nomina_id) <> 'abierta' BEGIN SELECT RAISE(ABORT, 'Una nómina cerrada no se cambia: Dirección la reabre si no se ha pagado'); END`);
  trigger('nominas_pagada_fija', `BEFORE UPDATE ON nominas WHEN OLD.estado = 'pagada' BEGIN SELECT RAISE(ABORT, 'Una nómina pagada no se cambia'); END`);

  const prepara = req => P.direccion(req) || P.puede(req, 'nomina.preparar');
  const paga = req => prepara(req) && (P.direccion(req) || P.puede(req, 'dinero.mover'));
  const negar = res => res.status(403).json({ error: 'La nómina la preparan Dirección y quien tiene «Preparar la nómina»' });
  const enAlcance = s => !!db.prepare('SELECT en_alcance(?) v').get(s).v;
  const totalDe = l => (l.neto_imss_cent ?? l.sueldo_imss_cent) + l.bono_cent + l.extra_cent + l.otros_cent - l.descuento_cent;
  const sucursalTxt = id => app.locals.sucursales?.claveDe?.(id) || '';

  // Las líneas que tocan a una sucursal y semana: quien está activo en la semana, de esa sucursal, si checa o tiene sueldo.
  function calcular(sucursalId, desde) {
    const A = app.locals.asistencia, Pe = app.locals.personal;
    const sem = A.resumenSemana(desde, null, true), porPersona = new Map(sem.filas.map(f => [f.personal_id, f]));
    const ids = db.prepare(`SELECT id FROM main.personal WHERE sucursal_id = ? AND (activo = 1 OR fecha_baja >= ?) AND (fecha_ingreso IS NULL OR fecha_ingreso <= ?) ORDER BY nombre`).all(sucursalId, sem.desde, sem.hasta).map(r => r.id);
    const lineas = [];
    for (const id of ids) {
      const p = Pe.fichaPago(id), a = porPersona.get(id);
      if (!p) continue;
      const imss = p.sueldo_imss_semanal_cent || 0, bono = p.bono_semanal_cent || 0;
      if (!a && !imss && !bono) continue; // ni checa ni tiene sueldo semanal: no entra
      const t = a?.totales || {};
      const pend = a ? [t.extra_sin_autorizar_min ? `${t.extra_sin_autorizar_min} min de tiempo extra sin autorizar` : '', t.por_revisar ? `${t.por_revisar} checada(s) por revisar` : '',
        t.sin_salida ? `${t.sin_salida} día(s) sin salida` : '', t.extra_sin_fin ? `${t.extra_sin_fin} tiempo extra sin fin` : ''].filter(Boolean) : [];
      if (p.ilegibles.some(k => /sueldo|bono/.test(k))) pend.push('Su sueldo no se puede leer (clave de cifrado)');
      else if (!imss && !bono) pend.push('Sin sueldo semanal en su ficha (captúralo en Personal)');
      lineas.push({ personal_id: id, nombre: p.nombre, puesto: p.puesto, numero_empleado: p.numero_empleado || null, sueldo_imss_cent: imss, bono_cent: bono,
        extra_cent: a?.dinero?.total_cent || 0, extra_min: t.extra_autorizado_min || 0, sin_precio_extra: a && t.extra_autorizado_min && a.dinero?.valor_hora_cent == null ? 1 : 0,
        dias_trabajados: t.dias_trabajados || 0, faltas: t.faltas || 0, retardos: t.retardos || 0, checa: a ? 1 : 0, pendientes: pend.length ? JSON.stringify(pend) : null });
    }
    return { desde: sem.desde, hasta: sem.hasta, lineas };
  }
  // Vuelve a leer checador y fichas en una nómina abierta, sin tocar lo capturado a mano.
  function refrescar(n) {
    const c = calcular(n.sucursal_id, n.desde);
    const ins = db.prepare(`INSERT INTO main.nomina_lineas (nomina_id, personal_id, nombre, puesto, numero_empleado, sueldo_imss_cent, bono_cent, extra_cent, extra_min, sin_precio_extra, dias_trabajados, faltas, retardos, checa, pendientes)
      VALUES (@nomina_id, @personal_id, @nombre, @puesto, @numero_empleado, @sueldo_imss_cent, @bono_cent, @extra_cent, @extra_min, @sin_precio_extra, @dias_trabajados, @faltas, @retardos, @checa, @pendientes)
      ON CONFLICT(nomina_id, personal_id) DO UPDATE SET nombre = excluded.nombre, puesto = excluded.puesto, numero_empleado = excluded.numero_empleado, sueldo_imss_cent = excluded.sueldo_imss_cent,
        bono_cent = excluded.bono_cent, extra_cent = excluded.extra_cent, extra_min = excluded.extra_min, sin_precio_extra = excluded.sin_precio_extra, dias_trabajados = excluded.dias_trabajados,
        faltas = excluded.faltas, retardos = excluded.retardos, checa = excluded.checa, pendientes = excluded.pendientes`);
    db.transaction(() => {
      for (const l of c.lineas) ins.run({ nomina_id: n.id, ...l });
      // Quien ya no entra (cambió de sucursal, se quitó su sueldo) y no tiene nada capturado, sale.
      const siguen = new Set(c.lineas.map(l => l.personal_id));
      for (const l of db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ?').all(n.id))
        if (!siguen.has(l.personal_id) && !l.descuento_cent && !l.otros_cent && l.neto_imss_cent == null) db.prepare('DELETE FROM main.nomina_lineas WHERE id = ?').run(l.id);
      db.prepare("UPDATE main.nominas SET actualizada_at = datetime('now','localtime') WHERE id = ?").run(n.id);
    })();
  }
  const leer = id => db.prepare('SELECT n.*, uc.nombre AS cerro, up.nombre AS pago FROM main.nominas n LEFT JOIN main.usuarios uc ON uc.id = n.cerrada_por LEFT JOIN main.usuarios up ON up.id = n.pagada_por WHERE n.id = ?').get(Number(id) || 0);
  function salida(req, n, propuesta) {
    const lineas = (propuesta || db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ? ORDER BY nombre').all(n.id)).map(l => ({
      id: l.id || null, personal_id: l.personal_id, nombre: l.nombre, puesto: l.puesto, numero_empleado: l.numero_empleado || '', checa: !!l.checa,
      sueldo_imss: pesos(l.sueldo_imss_cent), bono: pesos(l.bono_cent), extra: pesos(l.extra_cent), extra_min: l.extra_min, sin_precio_extra: !!l.sin_precio_extra,
      dias_trabajados: l.dias_trabajados, faltas: l.faltas, retardos: l.retardos, pendientes: l.pendientes ? JSON.parse(l.pendientes) : [],
      descuento: pesos(l.descuento_cent || 0), descuento_nota: l.descuento_nota || '', otros: pesos(l.otros_cent || 0), otros_nota: l.otros_nota || '',
      neto_imss: l.neto_imss_cent == null ? null : pesos(l.neto_imss_cent), falta_neto: (l.sueldo_imss_cent > 0) && l.neto_imss_cent == null,
      total: pesos(totalDe({ descuento_cent: 0, otros_cent: 0, neto_imss_cent: null, ...l })) }));
    const suma = k => Math.round(lineas.reduce((t, l) => t + Math.round(l[k] * 100), 0)) / 100;
    return { id: n?.id || null, estado: n?.estado || 'sin_preparar', sucursal_id: n?.sucursal_id, sucursal: sucursalTxt(n?.sucursal_id), desde: n?.desde, hasta: n?.hasta,
      cerro: n?.cerro || '', cerrada_at: n?.cerrada_at || '', forzada_motivo: n?.forzada_motivo || '', pago: n?.pago || '', fecha_pago: n?.fecha_pago || '', metodo_pago: n?.metodo_pago || '', cuenta_origen: n?.cuenta_origen || '',
      actualizada_at: n?.actualizada_at || '', lineas,
      totales: { personas: lineas.length, sueldo_imss: suma('sueldo_imss'), bono: suma('bono'), extra: suma('extra'), descuento: suma('descuento'), otros: suma('otros'), total: suma('total'),
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
    const cuenta = texto(x.cuenta_origen, 80);
    if (!cuenta) return res.status(400).json({ error: 'Escribe de qué cuenta salió (por ejemplo: Santander nómina, Banorte nómina)' });
    const lineas = db.prepare('SELECT * FROM main.nomina_lineas WHERE nomina_id = ?').all(n.id), total = lineas.reduce((t, l) => t + totalDe(l), 0);
    if (total <= 0) return res.status(409).json({ error: 'La nómina no tiene nada que pagar' });
    const cxpId = db.transaction(() => {
      let prov = db.prepare("SELECT id FROM main.proveedores WHERE nombre = 'Nómina (sueldos)'").get();
      if (!prov) prov = { id: Number(db.prepare("INSERT INTO main.proveedores (nombre, categoria, dias_credito, notas) VALUES ('Nómina (sueldos)', 'sueldos', 0, 'Lo crea la nómina semanal: un gasto por semana pagada')").run().lastInsertRowid) };
      const concepto = `Nómina semana ${dma(n.desde)}–${dma(n.hasta)} (${lineas.filter(l => totalDe(l) > 0).length} personas)`;
      const info = db.prepare(`INSERT INTO main.cuentas_por_pagar (proveedor_id, categoria, concepto, fecha_documento, fecha_vencimiento, total_cent, notas, registrado_por, dias_credito, tipo_comprobante, iva_cent, iva_origen)
        VALUES (?, 'sueldos', ?, ?, ?, ?, ?, ?, 0, 'nomina', 0, 'manual')`).run(prov.id, concepto, n.hasta, n.hasta > fecha ? n.hasta : fecha, total, `Nómina #${n.id}: sueldo IMSS neto, bono, tiempo extra y otros, menos descuentos`, req.usuarioSesion.id);
      const id = Number(info.lastInsertRowid);
      app.locals.sucursales.asignar('cuentas_por_pagar', id, n.sucursal_id);
      db.prepare('INSERT INTO main.pagos_proveedor (cxp_id, fecha, monto_cent, metodo, referencia, registrado_por, cuenta_origen) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, fecha < n.hasta ? n.hasta : fecha, total, x.metodo, texto(x.referencia, 120) || `Nómina ${dma(n.desde)}–${dma(n.hasta)}`, req.usuarioSesion.id, cuenta);
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
