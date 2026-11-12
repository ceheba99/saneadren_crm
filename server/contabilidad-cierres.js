// EDITAR CONTABILIDAD · parte 1 (2026-11-12, aprobado por Dirección): el mes cerrado y el saldo inicial del banco.
//  · Cerrar el mes: Dirección y quien tenga «Cerrar el mes de contabilidad» (el Contador), por sucursal, solo un mes que
//    ya terminó. Ya cerrado, solo Dirección registra, corrige o cancela cobros, pagos a proveedor y anticipos con fecha de
//    ese mes (en cualquier pantalla: Cobranza, Cuentas por pagar, Nómina, Conciliación…), y cambia su saldo inicial.
//    Reabrirlo: solo Dirección, con motivo.
//  · El candado está en la base: disparadores TEMPORALES de esta conexión (solo existen con el sistema encendido; las
//    herramientas y pruebas que abren la base directo no los tienen). Revisan la fecha anterior y la nueva.
//  · Saldo inicial del banco por mes y sucursal (antes se guardaba en el navegador): el del CRM o el que se escriba.
//  · Rastro: nada se borra ni se cambia. Cada cierre, reapertura y saldo es un renglón nuevo con quién y cuándo; el estado
//    vigente es el último. Además queda en la bitácora general con el valor anterior.
const alcance = require('./alcance');
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const pesos = c => Math.round(Number(c || 0)) / 100;
const fmt = c => '$' + (Number(c || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).format(new Date());
const nombreMes = m => { const [a, n] = m.split('-').map(Number); return ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][n - 1] + ' ' + a; };

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contabilidad_cierres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mes TEXT NOT NULL CHECK(length(mes) = 7 AND date(mes || '-01', '+0 days') = mes || '-01'),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      accion TEXT NOT NULL CHECK(accion IN ('cerrar', 'reabrir')),
      motivo TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      usuario TEXT NOT NULL,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      CHECK(accion <> 'reabrir' OR COALESCE(length(trim(motivo)), 0) >= 5)
    );
    CREATE INDEX IF NOT EXISTS idx_cierres_mes ON contabilidad_cierres(mes, sucursal_id, id);
    CREATE TABLE IF NOT EXISTS flujo_saldos_iniciales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mes TEXT NOT NULL CHECK(length(mes) = 7 AND date(mes || '-01', '+0 days') = mes || '-01'),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      saldo_cent INTEGER CHECK(saldo_cent IS NULL OR typeof(saldo_cent) = 'integer'), -- NULL = volver al que calcula el CRM
      usuario_id INTEGER REFERENCES usuarios(id),
      usuario TEXT NOT NULL,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_saldos_mes ON flujo_saldos_iniciales(mes, sucursal_id, id);
    -- El rastro no se toca: ni se cambia ni se borra.
    CREATE TRIGGER IF NOT EXISTS cierres_fijos_upd BEFORE UPDATE ON contabilidad_cierres BEGIN SELECT RAISE(ABORT, 'El historial de cierres no se modifica'); END;
    CREATE TRIGGER IF NOT EXISTS cierres_fijos_del BEFORE DELETE ON contabilidad_cierres BEGIN SELECT RAISE(ABORT, 'El historial de cierres no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS saldos_fijos_upd BEFORE UPDATE ON flujo_saldos_iniciales BEGIN SELECT RAISE(ABORT, 'El historial de saldos no se modifica'); END;
    CREATE TRIGGER IF NOT EXISTS saldos_fijos_del BEFORE DELETE ON flujo_saldos_iniciales BEGIN SELECT RAISE(ABORT, 'El historial de saldos no se borra'); END;
  `);
}

module.exports = function contabilidadCierres(app, db, h) {
  migrar(db);
  const P = app.locals.permisos;
  const tabla = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const ultimoCierre = db.prepare('SELECT * FROM main.contabilidad_cierres WHERE mes = ? AND sucursal_id = ? ORDER BY id DESC LIMIT 1');
  const cerrado = (mes, suc) => ultimoCierre.get(mes, suc)?.accion === 'cerrar';

  // ---------- Candado en la base ----------
  // 1 = esa fecha cae en un mes cerrado de esa sucursal y quien pide no es Dirección. Fuera de una petición (tareas del
  // sistema, migraciones) o con global() no se bloquea: eso no lo hace una persona.
  const bloq = db.db.prepare("SELECT accion FROM main.contabilidad_cierres WHERE mes = ? AND sucursal_id = ? ORDER BY id DESC LIMIT 1");
  db.db.function('mes_bloqueado', { deterministic: false }, (fecha, suc) => {
    if (!fecha || suc == null) return 0;
    const a = alcance.als.getStore();
    if (!a || a === alcance.TODO || a.direccion) return 0;
    return bloq.get(String(fecha).slice(0, 7), suc)?.accion === 'cerrar' ? 1 : 0;
  });
  const sucCobro = id => `(SELECT sucursal_id FROM main.leads WHERE id = ${id})`, sucPago = id => `(SELECT sucursal_id FROM main.cuentas_por_pagar WHERE id = ${id})`;
  const ALTO = "SELECT RAISE(ABORT, 'MES_CERRADO');";
  const disparadores = [
    // Cobros: registrar, confirmar, cancelar o cambiar monto, fecha, vía o referencia.
    ['cierre_cobros_ins', 'BEFORE INSERT ON main.cobros', `mes_bloqueado(NEW.fecha, ${sucCobro('NEW.lead_id')})`],
    ['cierre_cobros_upd', 'BEFORE UPDATE ON main.cobros', `(NEW.fecha IS NOT OLD.fecha OR NEW.monto_cent IS NOT OLD.monto_cent OR NEW.confirmado IS NOT OLD.confirmado OR NEW.cancelado IS NOT OLD.cancelado
      OR NEW.tipo IS NOT OLD.tipo OR NEW.metodo IS NOT OLD.metodo OR NEW.referencia IS NOT OLD.referencia OR NEW.lead_id IS NOT OLD.lead_id)
      AND (mes_bloqueado(OLD.fecha, ${sucCobro('OLD.lead_id')}) OR mes_bloqueado(NEW.fecha, ${sucCobro('NEW.lead_id')}))`],
    // Pagos a proveedor (también los de nómina, conciliación y los hechos con un anticipo).
    ['cierre_pagos_ins', 'BEFORE INSERT ON main.pagos_proveedor', `mes_bloqueado(NEW.fecha, ${sucPago('NEW.cxp_id')})`],
    ['cierre_pagos_upd', 'BEFORE UPDATE ON main.pagos_proveedor', `(NEW.fecha IS NOT OLD.fecha OR NEW.monto_cent IS NOT OLD.monto_cent OR NEW.cancelado IS NOT OLD.cancelado OR NEW.metodo IS NOT OLD.metodo
      OR NEW.referencia IS NOT OLD.referencia OR NEW.cuenta_origen IS NOT OLD.cuenta_origen OR NEW.cxp_id IS NOT OLD.cxp_id)
      AND (mes_bloqueado(OLD.fecha, ${sucPago('OLD.cxp_id')}) OR mes_bloqueado(NEW.fecha, ${sucPago('NEW.cxp_id')}))`],
  ];
  if (tabla('anticipos')) disparadores.push(
    ['cierre_anticipos_ins', 'BEFORE INSERT ON main.anticipos', 'mes_bloqueado(NEW.fecha, NEW.sucursal_id)'],
    // La entrega (su fecha y monto, o cancelarlo) y el reintegro (lo que regresó) se revisan cada uno con su fecha: cerrar
    // en noviembre un anticipo entregado en un octubre ya cerrado sí se puede; su reintegro cae en noviembre.
    ['cierre_anticipos_entrega', 'BEFORE UPDATE ON main.anticipos', `(NEW.fecha IS NOT OLD.fecha OR NEW.monto_cent IS NOT OLD.monto_cent OR NEW.metodo IS NOT OLD.metodo OR NEW.referencia IS NOT OLD.referencia
      OR NEW.cuenta_origen IS NOT OLD.cuenta_origen OR NEW.sucursal_id IS NOT OLD.sucursal_id OR (NEW.estado = 'cancelado' AND OLD.estado <> 'cancelado'))
      AND (mes_bloqueado(OLD.fecha, OLD.sucursal_id) OR mes_bloqueado(NEW.fecha, NEW.sucursal_id))`],
    ['cierre_anticipos_reintegro', 'BEFORE UPDATE ON main.anticipos', `(NEW.reintegro_cent IS NOT OLD.reintegro_cent OR NEW.reintegro_fecha IS NOT OLD.reintegro_fecha OR NEW.reintegro_metodo IS NOT OLD.reintegro_metodo
      OR NEW.reintegro_referencia IS NOT OLD.reintegro_referencia OR NEW.reintegro_cuenta IS NOT OLD.reintegro_cuenta OR (NEW.estado = 'cancelado' AND OLD.estado <> 'cancelado' AND OLD.reintegro_cent > 0))
      AND (mes_bloqueado(OLD.reintegro_fecha, OLD.sucursal_id) OR mes_bloqueado(NEW.reintegro_fecha, NEW.sucursal_id))`]);
  for (const [nombre, cuando, condicion] of disparadores) {
    db.exec(`DROP TRIGGER IF EXISTS temp.${nombre}`);
    db.exec(`CREATE TEMP TRIGGER ${nombre} ${cuando} FOR EACH ROW WHEN ${condicion} BEGIN ${ALTO} END`);
  }

  // ---------- Qué sucursales abarca la consulta ----------
  // La elegida (si la ve) o todas las que ve quien pide.
  const sucursalesDe = (req, elegida) => {
    const ve = [...(req.alcanceSuc?.ids || [])];
    if (elegida === undefined || elegida === null || elegida === '') return ve;
    const n = Number(elegida);
    return ve.includes(n) ? [n] : null;
  };
  const datosSuc = id => app.locals.sucursales?.lista?.().find(s => s.id === id) || { id, clave: '', nombre: '' };
  const puedeVer = req => P.direccion(req) || P.puede(req, 'contabilidad.ver');
  const puedeCerrar = req => P.direccion(req) || P.puede(req, 'contabilidad.cerrar');

  // Estado de cierre de un mes en esas sucursales, con su historial (para la pantalla y el Excel).
  function estadoCierre(req, mes, sucursales) {
    const filas = sucursales.map(id => {
      const hist = db.prepare('SELECT accion, motivo, usuario, fecha FROM main.contabilidad_cierres WHERE mes = ? AND sucursal_id = ? ORDER BY id DESC').all(mes, id);
      const s = datosSuc(id);
      return { sucursal_id: id, clave: s.clave, nombre: s.nombre, cerrado: hist[0]?.accion === 'cerrar', ultimo: hist[0] || null, historial: hist };
    });
    return { mes, terminado: mes < mesActual(), cerrado: filas.length > 0 && filas.every(f => f.cerrado), alguno_cerrado: filas.some(f => f.cerrado), sucursales: filas,
      puede_cerrar: puedeCerrar(req), puede_reabrir: P.direccion(req), puede_saldo: puedeVer(req), es_direccion: P.direccion(req) };
  }

  // ---------- Saldo inicial del banco ----------
  const ultimoSaldo = db.prepare('SELECT * FROM main.flujo_saldos_iniciales WHERE mes = ? AND sucursal_id = ? ORDER BY id DESC LIMIT 1');
  // Lo que el CRM acumuló antes del mes en esa sucursal: cobros confirmados − pagos (sin los hechos con anticipo) −
  // anticipos entregados + reintegros (las mismas reglas que el flujo de banco).
  function saldoCrm(desde, suc) {
    const conAnt = tabla('anticipos');
    return db.prepare(`SELECT (SELECT COALESCE(SUM(k.monto_cent), 0) FROM main.cobros k JOIN main.leads l ON l.id = k.lead_id WHERE k.cancelado = 0 AND k.confirmado = 1 AND k.tipo <> 'ajuste' AND k.fecha < ? AND l.sucursal_id = ?)
      - (SELECT COALESCE(SUM(g.monto_cent), 0) FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id WHERE g.cancelado = 0 AND g.metodo <> 'anticipo' AND g.fecha < ? AND x.sucursal_id = ?)
      ${conAnt ? `- (SELECT COALESCE(SUM(a.monto_cent), 0) FROM main.anticipos a WHERE a.estado <> 'cancelado' AND a.fecha < ? AND a.sucursal_id = ?)
      + (SELECT COALESCE(SUM(a.reintegro_cent), 0) FROM main.anticipos a WHERE a.estado <> 'cancelado' AND a.reintegro_cent > 0 AND a.reintegro_fecha < ? AND a.sucursal_id = ?)` : ''} AS n`)
      .get(...(conAnt ? [desde, suc, desde, suc, desde, suc, desde, suc] : [desde, suc, desde, suc])).n;
  }
  // Saldo inicial del mes en esas sucursales: por cada una, el escrito (si hay) o el del CRM; y su historial.
  function saldoInicial(mes, sucursales) {
    const desde = mes + '-01';
    const filas = sucursales.map(id => {
      const crm = saldoCrm(desde, id), ult = ultimoSaldo.get(mes, id), manual = ult && ult.saldo_cent != null ? ult.saldo_cent : null;
      const hist = db.prepare('SELECT saldo_cent, usuario, fecha FROM main.flujo_saldos_iniciales WHERE mes = ? AND sucursal_id = ? ORDER BY id DESC').all(mes, id)
        .map(r => ({ saldo: r.saldo_cent == null ? null : pesos(r.saldo_cent), usuario: r.usuario, fecha: r.fecha }));
      const s = datosSuc(id);
      return { sucursal_id: id, clave: s.clave, nombre: s.nombre, crm_cent: crm, usado_cent: manual ?? crm, crm: pesos(crm), saldo: pesos(manual ?? crm), escrito: manual != null, historial: hist };
    });
    const suma = k => filas.reduce((t, f) => t + f[k], 0);
    return { saldo_cent: suma('usado_cent'), crm_cent: suma('crm_cent'), sucursales: filas.map(({ crm_cent, usado_cent, ...f }) => f) };
  }
  // Para server/contabilidad.js (flujo de banco y su Excel).
  app.locals.contabilidadCierres = { estadoCierre, saldoInicial, sucursalesDe, cerrado };

  const leerMes = (v, res) => { const mes = String(v || ''); if (!MES.test(mes)) { res.status(400).json({ error: 'Elige el mes (AAAA-MM)' }); return null; } return mes; };

  app.get('/api/contabilidad/cierre', h((req, res) => {
    if (!puedeVer(req)) return res.status(403).json({ error: 'La contabilidad del mes la ven Dirección y quien tenga «Contabilidad del mes»' });
    const mes = leerMes(req.query.mes, res); if (!mes) return;
    const suc = sucursalesDe(req, req.query.sucursal); if (!suc) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ...estadoCierre(req, mes, suc), saldo_inicial: (() => { const s = saldoInicial(mes, suc); return { saldo: pesos(s.saldo_cent), crm: pesos(s.crm_cent), sucursales: s.sucursales }; })() });
  }));

  // Cerrar el mes (la sucursal elegida o todas las que ve). Solo un mes que ya terminó.
  app.post('/api/contabilidad/cierre', h((req, res) => {
    if (!puedeCerrar(req)) return res.status(403).json({ error: 'Cierran el mes Dirección y quien tenga «Cerrar el mes de contabilidad»' });
    const mes = leerMes(req.body?.mes, res); if (!mes) return;
    if (mes >= mesActual()) return res.status(400).json({ error: `Solo se cierra un mes que ya terminó (${nombreMes(mes)} todavía no termina)` });
    const suc = sucursalesDe(req, req.body?.sucursal); if (!suc) return res.status(404).json({ error: 'No encontrado' });
    if (!suc.length) return res.status(400).json({ error: 'No tienes sucursal para cerrar' });
    const cerradas = db.transaction(() => suc.filter(id => !cerrado(mes, id)).map(id => {
      db.prepare("INSERT INTO main.contabilidad_cierres (mes, sucursal_id, accion, usuario_id, usuario) VALUES (?, ?, 'cerrar', ?, ?)").run(mes, id, req.usuarioSesion.id, req.usuarioSesion.nombre);
      app.locals.auditoria?.registrar(req, 'contabilidad', id, 'mes cerrado', `${nombreMes(mes)} · ${datosSuc(id).clave || 'sucursal ' + id}: abierto → cerrado`);
      return id;
    })).immediate();
    res.status(201).json({ cerradas: cerradas.length, ...estadoCierre(req, mes, suc) });
  }));

  // Reabrir: solo Dirección, una sucursal a la vez y con motivo.
  app.post('/api/contabilidad/cierre/reabrir', h((req, res) => {
    if (!P.direccion(req)) return res.status(403).json({ error: 'Reabrir un mes cerrado lo hace solo Dirección' });
    const mes = leerMes(req.body?.mes, res); if (!mes) return;
    const suc = sucursalesDe(req, req.body?.sucursal);
    if (!suc || suc.length !== 1) return res.status(400).json({ error: 'Elige la sucursal que se reabre' });
    const motivo = String(req.body?.motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (motivo.length < 5) return res.status(400).json({ error: 'Escribe por qué se reabre el mes (mínimo 5 letras)' });
    if (!cerrado(mes, suc[0])) return res.status(400).json({ error: 'Ese mes no está cerrado' });
    db.transaction(() => {
      db.prepare("INSERT INTO main.contabilidad_cierres (mes, sucursal_id, accion, motivo, usuario_id, usuario) VALUES (?, ?, 'reabrir', ?, ?, ?)").run(mes, suc[0], motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
      app.locals.auditoria?.registrar(req, 'contabilidad', suc[0], 'mes reabierto', `${nombreMes(mes)} · ${datosSuc(suc[0]).clave || 'sucursal ' + suc[0]}: cerrado → abierto · motivo: ${motivo}`);
    }).immediate();
    res.json(estadoCierre(req, mes, suc));
  }));

  // Saldo inicial del banco de un mes y una sucursal: el que se escribe, o null para volver al del CRM.
  app.post('/api/contabilidad/saldo-inicial', h((req, res) => {
    if (!puedeVer(req)) return res.status(403).json({ error: 'El saldo inicial lo cambian Dirección y quien tenga «Contabilidad del mes»' });
    const mes = leerMes(req.body?.mes, res); if (!mes) return;
    const suc = sucursalesDe(req, req.body?.sucursal);
    if (!suc) return res.status(404).json({ error: 'No encontrado' });
    if (suc.length !== 1) return res.status(400).json({ error: 'Elige una sucursal: cada una tiene su propio saldo inicial del banco' });
    const id = suc[0], v = req.body?.saldo;
    let cent = null;
    if (v !== null && v !== undefined && v !== '') {
      const t = String(v).trim();
      if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(t)) return res.status(400).json({ error: 'Escribe el saldo en pesos, con máximo 2 decimales' });
      cent = Math.round(Number(t) * 100);
    }
    if (cerrado(mes, id) && !P.direccion(req)) return res.status(409).json({ error: `${nombreMes(mes)} ya está cerrado: su saldo inicial lo cambia solo Dirección`, codigo: 'MES_CERRADO' });
    const antes = saldoInicial(mes, [id]).sucursales[0];
    if ((antes.escrito ? Math.round(antes.saldo * 100) : null) === cent) return res.json({ ok: true, sin_cambios: true, ...saldoInicial(mes, [id]).sucursales[0] });
    db.transaction(() => {
      db.prepare('INSERT INTO main.flujo_saldos_iniciales (mes, sucursal_id, saldo_cent, usuario_id, usuario) VALUES (?, ?, ?, ?, ?)').run(mes, id, cent, req.usuarioSesion.id, req.usuarioSesion.nombre);
      app.locals.auditoria?.registrar(req, 'contabilidad', id, 'saldo inicial', `${nombreMes(mes)} · ${datosSuc(id).clave || 'sucursal ' + id}: ${antes.escrito ? fmt(Math.round(antes.saldo * 100)) : fmt(Math.round(antes.crm * 100)) + ' (el del CRM)'} → ${cent == null ? fmt(Math.round(antes.crm * 100)) + ' (el del CRM)' : fmt(cent)}`);
    }).immediate();
    res.json({ ok: true, ...saldoInicial(mes, [id]).sucursales[0] });
  }));
};
