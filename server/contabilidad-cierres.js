// EDITAR CONTABILIDAD · parte 1 (2026-11-12, aprobado por Dirección): el mes cerrado y el saldo inicial del banco.
//  · Cerrar el mes: Dirección y quien tenga «Cerrar el mes de contabilidad» (el Contador), por sucursal, solo un mes que
//    ya terminó. Ya cerrado, solo Dirección registra, corrige o cancela cobros, pagos a proveedor y anticipos con fecha de
//    ese mes (en cualquier pantalla: Cobranza, Cuentas por pagar, Nómina, Conciliación…), y cambia su saldo inicial.
//    Reabrirlo: solo Dirección, con motivo.
//  · El candado está en la base: disparadores TEMPORALES de esta conexión (solo existen con el sistema encendido; las
//    herramientas y pruebas que abren la base directo no los tienen). Revisan la fecha anterior y la nueva.
//  · Saldo inicial del banco por mes, sucursal y cuenta de banco (antes se guardaba en el navegador): el que se escriba o, si
//    no, el calculado (el último escrito antes más lo que se movió desde entonces). El cálculo está en server/contabilidad.js.
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
  // Correcciones a mano del Flujo de banco (parte 3, 2026-11-12): una por renglón (ref = cobro:12, pago:5, anticipo:3,
  // reintegro:3) y columna; vale la última. valor NULL = volver al dato del sistema. No se cambian ni se borran.
  db.exec(`CREATE TABLE IF NOT EXISTS flujo_correcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL CHECK(ref GLOB '[a-z]*:[0-9]*'),
      campo TEXT NOT NULL,
      valor TEXT, valor_anterior TEXT,
      mes TEXT NOT NULL CHECK(length(mes) = 7),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      usuario TEXT NOT NULL,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_flujo_corr_ref ON flujo_correcciones(ref, campo, id);
    CREATE TRIGGER IF NOT EXISTS flujo_corr_fijas_upd BEFORE UPDATE ON flujo_correcciones BEGIN SELECT RAISE(ABORT, 'Las correcciones del flujo no se modifican'); END;
    CREATE TRIGGER IF NOT EXISTS flujo_corr_fijas_del BEFORE DELETE ON flujo_correcciones BEGIN SELECT RAISE(ABORT, 'Las correcciones del flujo no se borran'); END;`);
  // Parte 4 (2026-11-12): movimientos que no pasaron por el sistema (traspasos, préstamos, comisiones…) y el desglose de
  // un pago en varios renglones (una factura por unidad, o varias facturas en una transferencia). No se borran: un
  // movimiento se cancela con motivo y un renglón del desglose se quita (queda con quién y cuándo).
  db.exec(`CREATE TABLE IF NOT EXISTS flujo_movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      cuenta_id INTEGER NOT NULL DEFAULT 0,
      fecha TEXT NOT NULL CHECK(length(fecha) = 10 AND date(fecha, '+0 days') = fecha),
      tipo TEXT NOT NULL CHECK(tipo IN ('ingreso', 'egreso')),
      monto_cent INTEGER NOT NULL CHECK(typeof(monto_cent) = 'integer' AND monto_cent > 0),
      categoria TEXT NOT NULL,
      concepto TEXT NOT NULL CHECK(length(trim(concepto)) BETWEEN 3 AND 200),
      referencia TEXT, observaciones TEXT,
      creado_por INTEGER REFERENCES usuarios(id), creado_por_nombre TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      cancelado INTEGER NOT NULL DEFAULT 0 CHECK(cancelado IN (0, 1)),
      cancelado_por INTEGER REFERENCES usuarios(id), cancelado_at TEXT, motivo_cancelacion TEXT,
      CHECK(cancelado = 0 OR (cancelado_por IS NOT NULL AND COALESCE(length(trim(motivo_cancelacion)), 0) >= 5))
    );
    CREATE INDEX IF NOT EXISTS idx_flujo_mov_fecha ON flujo_movimientos(sucursal_id, fecha);
    CREATE TRIGGER IF NOT EXISTS flujo_mov_sin_borrar BEFORE DELETE ON flujo_movimientos BEGIN SELECT RAISE(ABORT, 'Los movimientos del flujo no se borran: se cancelan con motivo'); END;
    CREATE TRIGGER IF NOT EXISTS flujo_mov_fijos BEFORE UPDATE ON flujo_movimientos WHEN NEW.fecha IS NOT OLD.fecha OR NEW.monto_cent IS NOT OLD.monto_cent OR NEW.tipo IS NOT OLD.tipo
      OR NEW.sucursal_id IS NOT OLD.sucursal_id OR NEW.cuenta_id IS NOT OLD.cuenta_id OR NEW.categoria IS NOT OLD.categoria OR NEW.concepto IS NOT OLD.concepto OR (OLD.cancelado = 1 AND NEW.cancelado = 0)
      BEGIN SELECT RAISE(ABORT, 'Un movimiento del flujo no se cambia: se cancela y se agrega de nuevo (los textos se corrigen en la tabla)'); END;
    CREATE TABLE IF NOT EXISTS flujo_desglose (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_padre TEXT NOT NULL CHECK(ref_padre GLOB '[a-z]*:[0-9]*'),
      mes TEXT NOT NULL CHECK(length(mes) = 7),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      metodo TEXT, cfdi TEXT, tercero TEXT, concepto TEXT, observaciones TEXT,
      cfdi_monto_cent INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cfdi_monto_cent) = 'integer' AND cfdi_monto_cent >= 0),
      no_deducible_cent INTEGER NOT NULL DEFAULT 0 CHECK(typeof(no_deducible_cent) = 'integer' AND no_deducible_cent >= 0),
      cuenta_abono TEXT, proyecto TEXT, unidad TEXT, tipo_gasto TEXT,
      creado_por INTEGER REFERENCES usuarios(id), usuario TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      actualizado_por TEXT, updated_at TEXT,
      anulado INTEGER NOT NULL DEFAULT 0 CHECK(anulado IN (0, 1)), anulado_por TEXT, anulado_at TEXT,
      CHECK(anulado = 0 OR anulado_por IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_flujo_desglose_padre ON flujo_desglose(ref_padre, anulado);
    CREATE TRIGGER IF NOT EXISTS flujo_desglose_sin_borrar BEFORE DELETE ON flujo_desglose BEGIN SELECT RAISE(ABORT, 'El desglose no se borra: el renglón se quita y queda en el historial'); END;
    CREATE TRIGGER IF NOT EXISTS flujo_desglose_fijo BEFORE UPDATE ON flujo_desglose WHEN NEW.ref_padre IS NOT OLD.ref_padre OR NEW.mes IS NOT OLD.mes OR NEW.sucursal_id IS NOT OLD.sucursal_id OR (OLD.anulado = 1 AND NEW.anulado = 0)
      BEGIN SELECT RAISE(ABORT, 'Un renglón del desglose no cambia de pago ni regresa después de quitarse'); END;`);
  // 2026-11-12 (formato del Excel «flujo banco»): un saldo por cuenta de banco (Conciliación › cuentas); 0 = «Sin cuenta».
  if (!db.prepare('PRAGMA table_info(flujo_saldos_iniciales)').all().some(c => c.name === 'cuenta_id')) db.exec('ALTER TABLE flujo_saldos_iniciales ADD COLUMN cuenta_id INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_saldos_cuenta ON flujo_saldos_iniciales(sucursal_id, cuenta_id, mes, id)');
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
    // Gastos (cuentas por pagar; 2026-11-13, auditoría del módulo contable): el gasto cuenta en el mes de su fecha de
    // documento, así que registrarlo, cancelarlo o cambiarle fecha, importe, IVA, categoría, comprobante, proveedor o sucursal
    // mueve «Gastos del mes» y el IVA de un mes cerrado. La sucursal se asigna justo después de insertar (por eso se revisa
    // también al cambiarla). Pagarlo con fecha de un mes abierto, sus notas y su XML sin cambio de IVA sí se pueden.
    ['cierre_cxp_ins', 'BEFORE INSERT ON main.cuentas_por_pagar', 'mes_bloqueado(NEW.fecha_documento, NEW.sucursal_id)'],
    ['cierre_cxp_upd', 'BEFORE UPDATE ON main.cuentas_por_pagar', `(NEW.fecha_documento IS NOT OLD.fecha_documento OR NEW.total_cent IS NOT OLD.total_cent OR NEW.iva_cent IS NOT OLD.iva_cent
      OR NEW.categoria IS NOT OLD.categoria OR NEW.cancelada IS NOT OLD.cancelada OR NEW.sucursal_id IS NOT OLD.sucursal_id OR NEW.tipo_comprobante IS NOT OLD.tipo_comprobante
      OR NEW.proveedor_id IS NOT OLD.proveedor_id)
      AND (mes_bloqueado(OLD.fecha_documento, OLD.sucursal_id) OR mes_bloqueado(NEW.fecha_documento, NEW.sucursal_id))`],
  ];
  // Correcciones a mano del flujo de un mes cerrado: solo Dirección (también en la base).
  disparadores.push(['cierre_flujo_corr_ins', 'BEFORE INSERT ON main.flujo_correcciones', "mes_bloqueado(NEW.mes || '-01', NEW.sucursal_id)"],
    // Movimientos propios y desglose (parte 4): agregar, quitar, cancelar o cambiar algo de un mes cerrado, solo Dirección.
    ['cierre_flujo_mov_ins', 'BEFORE INSERT ON main.flujo_movimientos', 'mes_bloqueado(NEW.fecha, NEW.sucursal_id)'],
    ['cierre_flujo_mov_upd', 'BEFORE UPDATE ON main.flujo_movimientos', 'mes_bloqueado(OLD.fecha, OLD.sucursal_id)'],
    ['cierre_flujo_des_ins', 'BEFORE INSERT ON main.flujo_desglose', "mes_bloqueado(NEW.mes || '-01', NEW.sucursal_id)"],
    ['cierre_flujo_des_upd', 'BEFORE UPDATE ON main.flujo_desglose', "mes_bloqueado(OLD.mes || '-01', OLD.sucursal_id)"]);
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
  // Lo escrito para una sucursal y cuenta: el vigente de ese mes (si el último renglón de ese mes no es «volver al del CRM»),
  // el último vigente de un mes anterior (de ahí se encadena) y el historial de ese mes. El cálculo está en server/contabilidad.js.
  function escrito(suc, cuenta, mes) {
    const historial = db.prepare('SELECT saldo_cent, usuario, fecha FROM main.flujo_saldos_iniciales WHERE sucursal_id = ? AND cuenta_id = ? AND mes = ? ORDER BY id DESC').all(suc, cuenta, mes);
    const anterior = db.prepare(`SELECT f.mes, f.saldo_cent FROM main.flujo_saldos_iniciales f WHERE f.sucursal_id = ? AND f.cuenta_id = ? AND f.mes < ?
      AND f.id = (SELECT MAX(id) FROM main.flujo_saldos_iniciales WHERE sucursal_id = f.sucursal_id AND cuenta_id = f.cuenta_id AND mes = f.mes) AND f.saldo_cent IS NOT NULL ORDER BY f.mes DESC LIMIT 1`).get(suc, cuenta, mes);
    return { este: historial[0] && historial[0].saldo_cent != null ? historial[0] : null, anterior: anterior || null, historial };
  }
  const cuentasEscritas = suc => db.prepare('SELECT DISTINCT cuenta_id FROM main.flujo_saldos_iniciales WHERE sucursal_id = ?').all(suc).map(r => r.cuenta_id);
  const saldoInicial = (req, mes, sucursales, cuenta) => app.locals.flujoBanco.saldoInicial(req, mes, sucursales, cuenta);
  // Para server/contabilidad.js (flujo de banco y su Excel).
  app.locals.contabilidadCierres = { estadoCierre, sucursalesDe, cerrado, escrito, cuentasEscritas };

  const leerMes = (v, res) => { const mes = String(v || ''); if (!MES.test(mes)) { res.status(400).json({ error: 'Elige el mes (AAAA-MM)' }); return null; } return mes; };

  app.get('/api/contabilidad/cierre', h((req, res) => {
    if (!puedeVer(req)) return res.status(403).json({ error: 'La contabilidad del mes la ven Dirección y quien tenga «Contabilidad del mes»' });
    const mes = leerMes(req.query.mes, res); if (!mes) return;
    const suc = sucursalesDe(req, req.query.sucursal); if (!suc) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ...estadoCierre(req, mes, suc), saldo_inicial: (() => { const s = saldoInicial(req, mes, suc, null); return { saldo: pesos(s.saldo_cent), crm: pesos(s.crm_cent), sucursales: s.sucursales }; })() });
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

  // Saldo inicial del banco de un mes, una sucursal y una cuenta: el que se escribe, o null para volver al calculado.
  app.post('/api/contabilidad/saldo-inicial', h((req, res) => {
    if (!puedeVer(req)) return res.status(403).json({ error: 'El saldo inicial lo cambian Dirección y quien tenga «Contabilidad del mes»' });
    const mes = leerMes(req.body?.mes, res); if (!mes) return;
    const suc = sucursalesDe(req, req.body?.sucursal);
    if (!suc) return res.status(404).json({ error: 'No encontrado' });
    if (suc.length !== 1) return res.status(400).json({ error: 'Elige una sucursal: cada una tiene su propio saldo inicial del banco' });
    const id = suc[0], cuentas = app.locals.flujoBanco.cuentasDe([id]), b = req.body || {};
    // La cuenta: la elegida (de esa sucursal) o «Sin cuenta» (0). Si la sucursal ya tiene cuentas de banco, hay que decir cuál.
    if ((b.cuenta === undefined || b.cuenta === null || b.cuenta === '') && cuentas.length > 1) return res.status(400).json({ error: 'Elige la cuenta de banco: cada cuenta tiene su propio saldo inicial' });
    const cuenta = Number(b.cuenta || 0);
    if (!cuentas.some(c => c.id === cuenta)) return res.status(404).json({ error: 'No se encontró esa cuenta de banco' });
    const v = b.saldo;
    let cent = null;
    if (v !== null && v !== undefined && v !== '') {
      const t = String(v).trim();
      if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(t)) return res.status(400).json({ error: 'Escribe el saldo en pesos, con máximo 2 decimales' });
      cent = Math.round(Number(t) * 100);
    }
    if (cerrado(mes, id) && !P.direccion(req)) return res.status(409).json({ error: `${nombreMes(mes)} ya está cerrado: su saldo inicial lo cambia solo Dirección`, codigo: 'MES_CERRADO' });
    const actual = () => saldoInicial(req, mes, [id], cuenta).sucursales[0];
    const antes = actual();
    if ((antes.escrito ? Math.round(antes.saldo * 100) : null) === cent) return res.json({ ok: true, sin_cambios: true, ...antes });
    const quien = `${nombreMes(mes)} · ${datosSuc(id).clave || 'sucursal ' + id} · ${antes.cuenta}`;
    db.transaction(() => {
      db.prepare('INSERT INTO main.flujo_saldos_iniciales (mes, sucursal_id, cuenta_id, saldo_cent, usuario_id, usuario) VALUES (?, ?, ?, ?, ?, ?)').run(mes, id, cuenta, cent, req.usuarioSesion.id, req.usuarioSesion.nombre);
      app.locals.auditoria?.registrar(req, 'contabilidad', id, 'saldo inicial', `${quien}: ${antes.escrito ? fmt(Math.round(antes.saldo * 100)) : fmt(Math.round(antes.crm * 100)) + ' (el calculado)'} → ${cent == null ? fmt(Math.round(antes.crm * 100)) + ' (el calculado)' : fmt(cent)}`);
    }).immediate();
    res.json({ ok: true, ...actual() });
  }));
};
