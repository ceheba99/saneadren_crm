// REPORTES DE DIRECCIÓN (2026-11-11, aprobado por Dirección): cumplimiento, metas con semáforo, ranking por vendedor,
// indicadores del Análisis comercial y el reporte ejecutivo del mes por correo a Dirección.
//  · Panorama general (reportes.panorama: Dirección y Gerente) suma (tablero.js → paraPanorama):
//      cumplimiento: por cobrar (% cobrado a tiempo, días promedio de cobro contra el crédito), por pagar (% pagado a
//      tiempo, días promedio de pago), operación (% de servicios realizados en su fecha, no realizados) y
//      satisfacción (promedio, NPS, % insatisfechos, % de encuestas contestadas); contabilidad (anticipos sin
//      comprobar, nómina pagada y su tiempo extra, % del banco conciliado); ranking por vendedor; y las METAS del mes
//      con su semáforo (verde: cumple; ámbar: 90 % o más; rojo: menos).
//  · Metas: las pone SOLO Dirección, por mes, para toda la empresa o una sucursal. El Gerente las ve.
//  · Análisis comercial (reportes.analisis): /api/analisis/indicadores, con lo que ve cada quien (vistas por
//    sucursal y «lo suyo»): satisfacción, cobranza a tiempo (solo si ve la cobranza), servicios en fecha y recompras.
//    Nada de cuentas por pagar ni dinero de la empresa.
//  · Correo: el día 1 (desde las 7:00, hora de México) se manda a Dirección (usuarios con rol admin y correo) el
//    reporte del mes anterior de toda la empresa. Solo si el correo (SMTP) está configurado y nunca en el demo; queda
//    anotado para no mandarlo dos veces. Dirección también lo puede mandar a mano.
const { hoyMexico, ahoraMexico } = require('./fechas');
const alcance = require('./alcance');
const pesos = c => Math.round(Number(c || 0)) / 100;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const pct = (a, b) => (b ? Math.round(a * 1000 / b) / 10 : null);
// Indicadores con meta: [clave, nombre, tipo (dinero | pct | numero), mayor es mejor]
const INDICADORES = [
  ['venta', 'Venta del mes (sin IVA)', 'dinero', true], ['cobrado', 'Cobrado', 'dinero', true], ['margen_pct', 'Margen (utilidad / venta)', 'pct', true],
  ['cobro_a_tiempo_pct', 'Cobrado a tiempo', 'pct', true], ['pago_a_tiempo_pct', 'Pagado a tiempo a proveedores', 'pct', true],
  ['servicios_en_fecha_pct', 'Servicios realizados en su fecha', 'pct', true], ['satisfaccion', 'Satisfacción promedio (1 a 5)', 'numero', true], ['nps', 'NPS', 'numero', true],
];

module.exports = function reportes(app, db, h) {
  const P = app.locals.permisos;
  const tabla = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t);
  const uno = (sql, ...p) => db.prepare(sql).get(...p);
  const fmt = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dma = f => String(f || '').slice(0, 10).split('-').reverse().join('/');

  db.exec(`CREATE TABLE IF NOT EXISTS metas_direccion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes TEXT NOT NULL CHECK(length(mes) = 7),
    para_sucursal INTEGER REFERENCES sucursales(id), -- NULL = toda la empresa (no es un registro operativo: no lleva sucursal_id)
    indicador TEXT NOT NULL,
    valor REAL NOT NULL CHECK(valor >= 0),
    puesta_por INTEGER NOT NULL REFERENCES usuarios(id), puesta_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_metas_direccion ON metas_direccion(mes, COALESCE(para_sucursal, 0), indicador)');

  // ---------- Cálculos (con las vistas de quien pide: sucursal y «lo suyo») ----------
  // Cobrado a tiempo: órdenes que se terminaron de pagar en el periodo; a tiempo si su último cobro confirmado fue a más
  // tardar al vencer (la base del crédito: factura, realizado o fecha del servicio, más sus días de crédito).
  function cobranza(desde, hasta) {
    const filas = db.prepare(`SELECT l.id, u.ultimo, COALESCE(l.factura_fecha, l.fecha_realizado, l.fecha_servicio, date(l.created_at)) AS base, COALESCE(l.dias_credito, 0) AS dias
      FROM leads l JOIN (SELECT lead_id, MAX(fecha) ultimo, SUM(monto_cent) cobrado FROM cobros WHERE cancelado = 0 AND confirmado = 1 AND tipo <> 'ajuste' GROUP BY lead_id) u ON u.lead_id = l.id
      WHERE l.estatus = 'ganado' AND COALESCE(l.ejecucion, '') <> 'no_realizado' AND u.ultimo BETWEEN ? AND ?
        AND u.cobrado >= COALESCE(l.factura_total_cent, CAST(ROUND(COALESCE(l.valor, 0) * 100) AS INTEGER) + COALESCE(l.iva_cent, 0))`).all(desde, hasta);
    const vence = f => { const d = new Date(f.base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + f.dias); return d.toISOString().slice(0, 10); };
    const dias = f => Math.round((Date.parse(f.ultimo + 'T12:00:00Z') - Date.parse(f.base + 'T12:00:00Z')) / 864e5);
    const aTiempo = filas.filter(f => f.ultimo <= vence(f)).length;
    return { liquidadas: filas.length, a_tiempo: aTiempo, pct: pct(aTiempo, filas.length),
      dias_promedio: filas.length ? Math.round(filas.reduce((t, f) => t + dias(f), 0) / filas.length) : null,
      credito_promedio: filas.length ? Math.round(filas.reduce((t, f) => t + f.dias, 0) / filas.length) : null };
  }
  // Pagado a tiempo: cuentas por pagar que se terminaron de pagar en el periodo; a tiempo si el último pago fue a más tardar al vencer.
  function pagos(desde, hasta) {
    const filas = db.prepare(`SELECT x.id, x.fecha_documento, x.fecha_vencimiento, u.ultimo FROM cuentas_por_pagar x
      JOIN (SELECT cxp_id, MAX(fecha) ultimo, SUM(monto_cent) pagado FROM pagos_proveedor WHERE cancelado = 0 GROUP BY cxp_id) u ON u.cxp_id = x.id
      WHERE x.cancelada = 0 AND COALESCE(x.tipo_comprobante, '') <> 'informativo' AND u.ultimo BETWEEN ? AND ? AND u.pagado >= x.total_cent`).all(desde, hasta);
    const aTiempo = filas.filter(f => f.ultimo <= f.fecha_vencimiento).length;
    const dias = f => Math.max(0, Math.round((Date.parse(f.ultimo + 'T12:00:00Z') - Date.parse(f.fecha_documento + 'T12:00:00Z')) / 864e5));
    return { liquidadas: filas.length, a_tiempo: aTiempo, pct: pct(aTiempo, filas.length), dias_promedio: filas.length ? Math.round(filas.reduce((t, f) => t + dias(f), 0) / filas.length) : null };
  }
  // Servicios realizados en su fecha: realizados en el periodo cuyo día de realizado no pasó de la fecha acordada.
  function operacion(desde, hasta) {
    const r = uno(`SELECT COUNT(*) n, SUM(CASE WHEN fecha_realizado IS NULL OR fecha_servicio IS NULL OR fecha_realizado <= fecha_servicio THEN 1 ELSE 0 END) en_fecha
      FROM leads WHERE estatus = 'ganado' AND ejecucion = 'realizado' AND COALESCE(fecha_realizado, fecha_servicio) BETWEEN ? AND ?`, desde, hasta);
    const no = uno("SELECT COUNT(*) n FROM leads WHERE estatus = 'ganado' AND ejecucion = 'no_realizado' AND COALESCE(fecha_realizado, fecha_servicio) BETWEEN ? AND ?", desde, hasta).n;
    const motivos = db.prepare("SELECT COALESCE(NULLIF(trim(motivo_no_realizado), ''), 'Sin motivo') motivo, COUNT(*) n FROM leads WHERE estatus = 'ganado' AND ejecucion = 'no_realizado' AND COALESCE(fecha_realizado, fecha_servicio) BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC LIMIT 8").all(desde, hasta);
    return { realizados: r.n || 0, en_fecha: r.en_fecha || 0, pct: pct(r.en_fecha || 0, r.n || 0), no_realizados: no, motivos_no_realizado: motivos };
  }
  // Encuestas: contestadas de las que se mandaron en el periodo (con lo que ve quien pide).
  function respuesta(desde, hasta) {
    if (!tabla('encuestas')) return { mandadas: 0, contestadas: 0, pct: null };
    const r = uno("SELECT COUNT(*) n, SUM(CASE WHEN respondida_at IS NOT NULL THEN 1 ELSE 0 END) c FROM encuestas WHERE substr(creada_at, 1, 10) BETWEEN ? AND ?", desde, hasta);
    return { mandadas: r.n || 0, contestadas: r.c || 0, pct: pct(r.c || 0, r.n || 0) };
  }
  // Recompras: servicios con recurrencia cuya recompra tocaba en el periodo (ya pasada); ¿el cliente volvió a contratarlo
  // a más tardar 30 días después de lo sugerido?
  function recompras(desde, hasta) {
    const hoy = hoyMexico(), tope = hasta < hoy ? hasta : hoy;
    const filas = db.prepare(`SELECT l.id, l.cliente_id, l.servicio_id, COALESCE(l.fecha_realizado, l.fecha_servicio) f, s.dias_recurrencia d FROM leads l JOIN catalogo_servicios s ON s.id = l.servicio_id
      WHERE l.estatus = 'ganado' AND l.ejecucion = 'realizado' AND COALESCE(s.dias_recurrencia, 0) > 0 AND l.cliente_id IS NOT NULL
        AND date(COALESCE(l.fecha_realizado, l.fecha_servicio), '+' || s.dias_recurrencia || ' days') BETWEEN ? AND ?`).all(desde, tope);
    const despues = db.prepare(`SELECT 1 FROM leads WHERE cliente_id = ? AND servicio_id = ? AND id <> ? AND estatus IN ('ganado', 'abierto') AND date(COALESCE(fecha_realizado, fecha_servicio, created_at)) > ?
      AND date(COALESCE(fecha_realizado, fecha_servicio, created_at)) <= date(?, '+' || (? + 30) || ' days') LIMIT 1`);
    const volvieron = filas.filter(f => despues.get(f.cliente_id, f.servicio_id, f.id, f.f, f.f, f.d)).length;
    return { tocaban: filas.length, volvieron, pct: pct(volvieron, filas.length) };
  }
  // Ranking por vendedor (responsable de la orden): venta del periodo, % de cierre de sus cotizaciones del periodo,
  // cobrado a tiempo y satisfacción de sus órdenes.
  function vendedores(desde, hasta, sat) {
    const venta = db.prepare(`SELECT responsable_id id, COUNT(*) servicios, COALESCE(SUM(valor), 0) venta FROM leads WHERE estatus = 'ganado' AND ejecucion = 'realizado' AND responsable_id IS NOT NULL
      AND COALESCE(fecha_realizado, fecha_servicio) BETWEEN ? AND ? GROUP BY responsable_id`).all(desde, hasta);
    const cot = db.prepare(`SELECT responsable_id id, COUNT(*) n, SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) g, SUM(CASE WHEN estatus = 'perdido' THEN 1 ELSE 0 END) p FROM leads
      WHERE origen = 'cotizacion' AND responsable_id IS NOT NULL AND date(created_at) BETWEEN ? AND ? GROUP BY responsable_id`).all(desde, hasta);
    const ids = [...new Set([...venta.map(v => v.id), ...cot.map(c => c.id)])];
    const nombre = id => db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id)?.nombre || 'Usuario #' + id;
    const satV = new Map((sat?.por_vendedor || []).map(v => [v.nombre, v]));
    return ids.map(id => {
      const v = venta.find(x => x.id === id) || { servicios: 0, venta: 0 }, c = cot.find(x => x.id === id) || { n: 0, g: 0, p: 0 }, n = nombre(id);
      const cb = cobranzaDe(desde, hasta, id);
      return { id, nombre: n, servicios: v.servicios, venta: Math.round(v.venta * 100) / 100, cotizaciones: c.n, cierre_pct: pct(c.g, (c.g || 0) + (c.p || 0)),
        cobro_a_tiempo_pct: cb.pct, satisfaccion: satV.get(n)?.promedio ?? null, nps: satV.get(n)?.nps ?? null, encuestas: satV.get(n)?.encuestas || 0 };
    }).sort((a, b) => b.venta - a.venta);
  }
  const cobranzaDe = (desde, hasta, responsable) => {
    const filas = db.prepare(`SELECT u.ultimo, COALESCE(l.factura_fecha, l.fecha_realizado, l.fecha_servicio, date(l.created_at)) base, COALESCE(l.dias_credito, 0) dias FROM leads l
      JOIN (SELECT lead_id, MAX(fecha) ultimo, SUM(monto_cent) cobrado FROM cobros WHERE cancelado = 0 AND confirmado = 1 AND tipo <> 'ajuste' GROUP BY lead_id) u ON u.lead_id = l.id
      WHERE l.estatus = 'ganado' AND l.responsable_id = ? AND u.ultimo BETWEEN ? AND ? AND u.cobrado >= COALESCE(l.factura_total_cent, CAST(ROUND(COALESCE(l.valor, 0) * 100) AS INTEGER) + COALESCE(l.iva_cent, 0))`).all(responsable, desde, hasta);
    const ok = filas.filter(f => { const d = new Date(f.base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + f.dias); return f.ultimo <= d.toISOString().slice(0, 10); }).length;
    return { pct: pct(ok, filas.length) };
  };
  // Contabilidad del periodo: anticipos sin comprobar (hoy), nómina pagada y conciliación del banco.
  function contabilidad(desde, hasta) {
    const r = {};
    if (tabla('anticipos')) {
      const abiertos = db.prepare("SELECT id, monto_cent FROM anticipos WHERE estado = 'abierto'").all();
      const comp = app.locals.anticipos?.comprobadoDe || (() => 0);
      r.anticipos_abiertos = abiertos.length; r.anticipos_por_comprobar = pesos(abiertos.reduce((t, a) => t + a.monto_cent - comp(a.id), 0));
    }
    if (tabla('nominas')) {
      const nom = db.prepare("SELECT n.id, x.total_cent FROM nominas n JOIN cuentas_por_pagar x ON x.id = n.cxp_id WHERE n.estado = 'pagada' AND n.fecha_pago BETWEEN ? AND ?").all(desde, hasta);
      const extra = nom.length ? uno(`SELECT COALESCE(SUM(extra_cent), 0) e FROM nomina_lineas WHERE nomina_id IN (${nom.map(() => '?').join(',')})`, ...nom.map(n => n.id)).e : 0;
      const total = nom.reduce((t, n) => t + n.total_cent, 0);
      r.nominas_pagadas = nom.length; r.nomina_pagada = pesos(total); r.tiempo_extra = pesos(extra); r.tiempo_extra_pct = pct(extra, total);
    }
    if (tabla('movimientos_banco')) {
      const b = uno('SELECT COUNT(*) n, SUM(CASE WHEN conciliado_id IS NOT NULL OR no_aplica = 1 THEN 1 ELSE 0 END) c FROM movimientos_banco WHERE fecha BETWEEN ? AND ?', desde, hasta);
      r.banco_movimientos = b.n || 0; r.banco_conciliado_pct = pct(b.c || 0, b.n || 0);
    }
    return r;
  }

  // ---------- Metas ----------
  // Las del periodo: si es un solo mes, las de ese mes; si son varios, se suman las de dinero y se promedian las demás.
  // Viendo una sola sucursal: las de esa sucursal; viendo varias: las de toda la empresa.
  function metasDe(req, desde, hasta) {
    const ids = [...(req.alcanceSuc?.ids || [])], suc = ids.length === 1 ? ids[0] : null;
    const meses = []; for (let m = desde.slice(0, 7); m <= hasta.slice(0, 7); ) { meses.push(m); const [a, b] = m.split('-').map(Number); m = b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`; if (meses.length > 24) break; }
    // Qué parte de cada mes cae dentro del periodo (días del periodo en ese mes / días del mes).
    const fraccion = Object.fromEntries(meses.map(mm => {
      const [y, mo] = mm.split('-').map(Number), ini = mm + '-01', fin = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10), total = Number(fin.slice(8));
      const a = desde > ini ? desde : ini, b = hasta < fin ? hasta : fin;
      return [mm, Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5) + 1) / total];
    }));
    // Viendo una sucursal: las suyas; si no tiene meta de ese indicador, la de toda la empresa (una sola sucursal = la empresa).
    const filas = db.prepare(`SELECT * FROM metas_direccion WHERE mes IN (${meses.map(() => '?').join(',')}) AND (para_sucursal IS NULL${suc ? ' OR para_sucursal = ?' : ''})`).all(...meses, ...(suc ? [suc] : []));
    const m = {}, crudos = {};
    for (const [k, , tipo] of INDICADORES) {
      const propias = suc ? filas.filter(f => f.indicador === k && f.para_sucursal === suc) : [];
      const xs = propias.length ? propias : filas.filter(f => f.indicador === k && f.para_sucursal == null); if (!xs.length) continue;
      // Las de dinero, en proporción a los días del mes que abarca el periodo (a medio mes, media meta).
      crudos[k] = tipo === 'dinero' ? xs.reduce((t, f) => t + f.valor, 0) : Math.round(xs.reduce((t, f) => t + f.valor, 0) / xs.length * 10) / 10;
      m[k] = tipo === 'dinero' ? Math.round(xs.reduce((t, f) => t + f.valor * (fraccion[f.mes] ?? 1), 0) * 100) / 100 : Math.round(xs.reduce((t, f) => t + f.valor, 0) / xs.length * 10) / 10;
    }
    return { sucursal_id: suc, meses, valores: m, crudos, proporcional: Object.values(fraccion).some(x => x < 1) };
  }
  const semaforo = (real, meta) => (meta == null || real == null ? null : meta === 0 ? 'verde' : real >= meta ? 'verde' : real >= meta * 0.9 ? 'ambar' : 'rojo');

  // Lo que el Panorama suma a su respuesta (tablero.js).
  function paraPanorama(req, desde, hasta, r, sat) {
    const cumplimiento = { cobranza: cobranza(desde, hasta), pagos: pagos(desde, hasta), operacion: operacion(desde, hasta), encuestas: respuesta(desde, hasta),
      satisfaccion: sat ? { encuestas: sat.encuestas, promedio: sat.promedio, nps: sat.nps, insatisfechos: sat.insatisfechos, insatisfechos_pct: pct(sat.insatisfechos || 0, sat.encuestas || 0) } : null };
    const reales = { venta: r.venta, cobrado: r.cobrado, margen_pct: r.margen_pct, cobro_a_tiempo_pct: cumplimiento.cobranza.pct, pago_a_tiempo_pct: cumplimiento.pagos.pct,
      servicios_en_fecha_pct: cumplimiento.operacion.pct, satisfaccion: sat?.promedio ?? null, nps: sat?.nps ?? null };
    const metas = metasDe(req, desde, hasta);
    return { cumplimiento, contabilidad: contabilidad(desde, hasta), vendedores: vendedores(desde, hasta, sat),
      metas: { ...metas, indicadores: INDICADORES.map(([clave, nombre, tipo]) => ({ clave, nombre, tipo, meta: metas.valores[clave] ?? null, real: reales[clave] ?? null, semaforo: semaforo(reales[clave], metas.valores[clave]) })),
        puede_editar: P.direccion(req) } };
  }
  app.locals.reportes = { paraPanorama, INDICADORES };

  app.get('/api/tablero/metas', h((req, res) => {
    if (!P.puede(req, 'reportes.panorama')) return res.status(403).json({ error: 'No tienes permiso para ver las metas' });
    const mes = MES.test(req.query.mes || '') ? req.query.mes : hoyMexico().slice(0, 7);
    const suc = req.query.sucursal ? Number(req.query.sucursal) : null;
    const filas = db.prepare(`SELECT m.*, u.nombre AS puso FROM metas_direccion m LEFT JOIN usuarios u ON u.id = m.puesta_por WHERE mes = ? AND ${suc ? 'para_sucursal = ?' : 'para_sucursal IS NULL'}`).all(mes, ...(suc ? [suc] : []));
    res.json({ mes, sucursal_id: suc, indicadores: INDICADORES.map(([clave, nombre, tipo]) => ({ clave, nombre, tipo, valor: filas.find(f => f.indicador === clave)?.valor ?? null, puso: filas.find(f => f.indicador === clave)?.puso || '' })), puede_editar: P.direccion(req) });
  }));
  app.put('/api/tablero/metas', h((req, res) => {
    if (!P.direccion(req)) return res.status(403).json({ error: 'Las metas las pone Dirección' });
    const b = req.body || {}, mes = String(b.mes || '');
    if (!MES.test(mes)) return res.status(400).json({ error: 'Elige el mes (AAAA-MM)' });
    const suc = b.sucursal_id ? Number(b.sucursal_id) : null;
    if (suc && !(app.locals.sucursales?.lista?.() || []).some(s => s.id === suc)) return res.status(400).json({ error: 'Esa sucursal no existe' });
    if (!b.metas || typeof b.metas !== 'object') return res.status(400).json({ error: 'Escribe las metas' });
    const cambios = [];
    for (const [k, v] of Object.entries(b.metas)) {
      const ind = INDICADORES.find(i => i[0] === k); if (!ind) return res.status(400).json({ error: 'Indicador desconocido: ' + k });
      if (v === null || v === '') { cambios.push([k, null]); continue; }
      const n = Number(String(v).replace(/[$,\s%]/g, ''));
      if (!Number.isFinite(n) || n < 0 || (ind[2] === 'pct' && n > 100) || (k === 'satisfaccion' && n > 5) || (k === 'nps' && n > 100)) return res.status(400).json({ error: `Revisa la meta de «${ind[1]}»` });
      cambios.push([k, Math.round(n * 100) / 100]);
    }
    db.transaction(() => {
      for (const [k, v] of cambios) {
        db.prepare(`DELETE FROM metas_direccion WHERE mes = ? AND indicador = ? AND ${suc ? 'para_sucursal = ?' : 'para_sucursal IS NULL'}`).run(mes, k, ...(suc ? [suc] : []));
        if (v !== null) db.prepare('INSERT INTO metas_direccion (mes, para_sucursal, indicador, valor, puesta_por) VALUES (?, ?, ?, ?, ?)').run(mes, suc, k, v, req.usuarioSesion.id);
      }
    })();
    app.locals.auditoria?.registrar(req, 'metas', null, 'metas del mes', `${mes}${suc ? ' · sucursal ' + (app.locals.sucursales?.claveDe?.(suc) || suc) : ' · toda la empresa'}: ${cambios.map(([k, v]) => `${k} = ${v ?? '(sin meta)'}`).join(', ')}`);
    res.json({ ok: true });
  }));

  // ---------- Indicadores del Análisis comercial (con lo que ve cada quien) ----------
  app.get('/api/analisis/indicadores', h((req, res) => {
    const hoy = hoyMexico(), desde = req.query.desde || hoy.slice(0, 8) + '01', hasta = req.query.hasta || hoy;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) return res.status(400).json({ error: 'Revisa el rango de fechas' });
    const enc = tabla('encuestas') ? db.prepare(`SELECT e.promedio, e.nps, e.facturacion, s.nombre AS servicio, u.nombre AS vendedor FROM encuestas e JOIN leads l ON l.id = e.lead_id
      LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id LEFT JOIN usuarios u ON u.id = l.responsable_id WHERE e.respondida_at IS NOT NULL AND substr(e.respondida_at, 1, 10) BETWEEN ? AND ?`).all(desde, hasta) : [];
    const insat = e => (e.promedio != null && e.promedio < 3) || (e.nps != null && e.nps <= 6) || e.facturacion === 'no';
    const nps = xs => { const v = xs.filter(e => e.nps != null); return v.length ? Math.round((v.filter(e => e.nps >= 9).length - v.filter(e => e.nps <= 6).length) * 100 / v.length) : null; };
    const prom = xs => { const v = xs.filter(e => e.promedio != null); return v.length ? Math.round(v.reduce((t, e) => t + e.promedio, 0) / v.length * 10) / 10 : null; };
    const grupo = k => [...new Set(enc.map(e => e[k] || 'Sin dato'))].map(n => { const xs = enc.filter(e => (e[k] || 'Sin dato') === n); return { nombre: n, encuestas: xs.length, promedio: prom(xs), nps: nps(xs) }; }).sort((a, b) => b.encuestas - a.encuestas);
    res.json({ desde, hasta,
      satisfaccion: { encuestas: enc.length, promedio: prom(enc), nps: nps(enc), insatisfechos: enc.filter(insat).length, por_servicio: grupo('servicio'), por_vendedor: grupo('vendedor'), respuesta: respuesta(desde, hasta) },
      cobranza: P.puede(req, 'cxc.ver') ? cobranza(desde, hasta) : null,
      operacion: operacion(desde, hasta), recompras: recompras(desde, hasta) });
  }));

  // ---------- Reporte ejecutivo del mes por correo a Dirección ----------
  const correo = require('./correo');
  function textoReporte(mes) {
    const [a, m] = mes.split('-').map(Number), desde = mes + '-01', hasta = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const t = app.locals.tablero?.resumen(desde, hasta);
    if (!t) return null;
    const metasTxt = t.metas.indicadores.filter(i => i.meta != null).map(i => `${i.semaforo === 'verde' ? '🟢' : i.semaforo === 'ambar' ? '🟡' : '🔴'} ${i.nombre}: ${i.tipo === 'dinero' ? fmt(i.real) : i.real ?? '—'}${i.tipo === 'pct' ? ' %' : ''} (meta ${i.tipo === 'dinero' ? fmt(i.meta) : i.meta}${i.tipo === 'pct' ? ' %' : ''})`);
    const c = t.cumplimiento, r = t.actual, ct = t.contabilidad;
    const lineas = [
      `Venta (sin IVA): ${fmt(r.venta)} · ${r.servicios} servicios · margen ${r.margen_pct ?? '—'} %`,
      `Cobrado: ${fmt(r.cobrado)} · pagado: ${fmt(r.pagado)} · flujo: ${fmt(r.flujo)}`,
      `Te deben hoy: ${fmt(t.foto.te_deben)} (vencido ${fmt(t.foto.vencido)}) · debes: ${fmt(t.foto.debes)} (vencido ${fmt(t.foto.debes_vencido)})`,
      `Cobrado a tiempo: ${c.cobranza.pct ?? '—'} % (${c.cobranza.liquidadas} órdenes) · pagado a tiempo: ${c.pagos.pct ?? '—'} %`,
      `Servicios en su fecha: ${c.operacion.pct ?? '—'} % · no realizados: ${c.operacion.no_realizados}`,
      c.satisfaccion ? `Satisfacción: ${c.satisfaccion.promedio ?? '—'} de 5 · NPS ${c.satisfaccion.nps ?? '—'} · ${c.satisfaccion.insatisfechos || 0} insatisfechos de ${c.satisfaccion.encuestas || 0}` : '',
      ct.anticipos_abiertos != null ? `Anticipos sin comprobar: ${ct.anticipos_abiertos} (${fmt(ct.anticipos_por_comprobar)})` : '',
      ct.nomina_pagada != null ? `Nómina pagada: ${fmt(ct.nomina_pagada)} (tiempo extra ${fmt(ct.tiempo_extra)})` : '',
      ct.banco_conciliado_pct != null ? `Banco conciliado: ${ct.banco_conciliado_pct} %` : '',
      ...(metasTxt.length ? ['', 'Metas del mes:', ...metasTxt] : ['', 'Sin metas para este mes (se ponen en Resultados › Panorama general).']),
      ...(t.alertas.length ? ['', 'Para atender:', ...t.alertas.slice(0, 6).map(x => '• ' + x.texto)] : []),
    ].filter(x => x !== '');
    return { asunto: `Reporte de Dirección · ${dma(desde).slice(3)} · Saneadren`, mensaje: lineas.join('\n'), desde, hasta };
  }
  const destinatarios = () => db.prepare("SELECT nombre, correo FROM usuarios WHERE rol = 'admin' AND activo = 1 AND correo IS NOT NULL AND trim(correo) <> ''").all();
  async function mandar(mes) {
    const rep = alcance.global(() => textoReporte(mes)), para = destinatarios();
    if (!rep || !para.length) return { enviados: 0 };
    let enviados = 0;
    for (const d of para) {
      await correo.enviar(d.correo, rep.asunto, { titulo: rep.asunto, saludo: `Hola, ${d.nombre}:`, mensaje: `Este es el resumen del mes del ${dma(rep.desde)} al ${dma(rep.hasta)} (toda la empresa).\n\n${rep.mensaje}`,
        enlace: (process.env.APP_URL || '').replace(/\/$/, '') + '/', boton: 'Abrir el Panorama', pie: 'Lo manda el ERP de Saneadren el día 1 de cada mes. Las cifras son de apoyo: lo fiscal lo decide el contador.' });
      enviados++;
    }
    return { enviados };
  }
  // Vista previa del correo del mes (Dirección): lo que llegaría, a quién y si el correo está configurado.
  app.get('/api/tablero/reporte-correo', h((req, res) => {
    if (!P.direccion(req)) return res.status(403).json({ error: 'El reporte por correo lo ve Dirección' });
    const mes = MES.test(req.query.mes || '') ? req.query.mes : (() => { const [a, m] = hoyMexico().split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; })();
    const rep = alcance.global(() => textoReporte(mes));
    res.json({ mes, asunto: rep?.asunto || '', mensaje: rep?.mensaje || '', destinatarios: destinatarios().map(d => d.nombre), correo_configurado: correo.configurado });
  }));
  app.post('/api/tablero/enviar-reporte', h(async (req, res) => {
    if (!P.direccion(req)) return res.status(403).json({ error: 'El reporte por correo lo manda Dirección' });
    const mes = MES.test(req.body?.mes || '') ? req.body.mes : (() => { const [a, m] = hoyMexico().split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; })();
    if (!correo.configurado) return res.status(409).json({ error: 'El correo del sistema no está configurado (SMTP): el reporte no puede salir. Se configura en las variables del servidor.' });
    if (!destinatarios().length) return res.status(409).json({ error: 'Nadie de Dirección tiene correo registrado' });
    const r = await mandar(mes);
    app.locals.auditoria?.registrar(req, 'reporte', null, 'reporte por correo', `${mes} · ${r.enviados} destinatario(s)`);
    res.json({ ok: true, mes, enviados: r.enviados });
  }));
  // Automático: el día 1, desde las 7:00, una sola vez por mes (queda anotado en config_servidor).
  async function revisarEnvio() {
    try {
      if (process.env.MODO_DEMO === '1' || !correo.configurado) return;
      const ahora = ahoraMexico(), [a, m, d] = ahora.fecha.split('-').map(Number);
      if (d !== 1 || Number(String(ahora.hora || '00').slice(0, 2)) < 7) return;
      const mes = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`, clave = 'reporte_mensual_' + mes;
      if (db.prepare('SELECT 1 FROM config_servidor WHERE clave = ?').get(clave)) return;
      db.prepare("INSERT OR IGNORE INTO config_servidor (clave, valor) VALUES (?, datetime('now','localtime'))").run(clave);
      const r = await mandar(mes);
      app.locals.registro?.servicio?.('reporte_mensual', `${mes}: ${r.enviados} correo(s) a Dirección`);
    } catch (err) { console.error('[reporte mensual] no se pudo mandar:', err.message); }
  }
  setTimeout(revisarEnvio, 60 * 1000).unref();
  setInterval(revisarEnvio, 30 * 60 * 1000).unref();
};
module.exports.INDICADORES = INDICADORES;
