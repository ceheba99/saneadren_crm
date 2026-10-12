// Cuentas por cobrar (CxC) y cuentas por pagar (CxP).
//
// Cuentas por cobrar: cada orden de servicio (leads.estatus = 'ganado') ES la cuenta por cobrar;
// no se duplica información. Se le agregan días de crédito y los datos de la factura CFDI
// emitida fuera del sistema, y los pagos del cliente viven en la tabla `cobros`.
// Cuentas por pagar: proveedores, sus facturas o gastos (`cuentas_por_pagar`) y los pagos que
// se les hacen (`pagos_proveedor`).
//
// Reglas de dinero (para que los saldos nunca se descuadren):
// - Importes en centavos enteros (INTEGER *_cent). La API recibe y devuelve pesos.
// - El saldo, el vencimiento y el estado NUNCA se guardan: se calculan en cada consulta.
// - Pagos y gastos no se borran: solo un admin los cancela, con motivo; queda quién y cuándo.
// - Cada movimiento lo anota el servidor en la bitácora (historial) de la orden.
const { hoyMexico } = require('./fechas');

const METODOS = ['transferencia', 'efectivo', 'deposito', 'cheque', 'tarjeta', 'otro'];
const TIPOS_COBRO = ['anticipo', 'pago', 'ajuste'];
const CATEGORIAS = {
  residuos: 'Disposición de residuos', combustible: 'Combustible', refacciones: 'Refacciones y mantenimiento',
  renta_maquinaria: 'Renta de maquinaria', nomina_eventual: 'Nómina eventual', casetas_viaticos: 'Casetas y viáticos',
  servicios_oficina: 'Oficina y servicios', otro: 'Otro',
};
// Quién ve qué. Ocultar botones en pantalla es solo comodidad: esto es lo que manda.
const PUEDE_VER_CARTERA = ['admin', 'atencion'];   // cartera completa, estados de cuenta, crédito y facturas
const PUEDE_REGISTRAR_COBRO = ['admin', 'atencion', 'ventas', 'tecnico'];
const COBRO_CONFIRMADO_AL_REGISTRAR = ['admin', 'atencion']; // los demás quedan "por confirmar"

function migrar(db) {
  const columnas = tabla => db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
  const agregar = (tabla, columna, tipo) => { if (!columnas(tabla).includes(columna)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`); };
  const nuevaInstalacion = !db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cobros'").get();

  agregar('clientes', 'dias_credito', 'INTEGER');
  agregar('leads', 'dias_credito', 'INTEGER');
  agregar('leads', 'factura_folio', 'TEXT');
  agregar('leads', 'factura_fecha', 'TEXT');
  agregar('leads', 'factura_total_cent', 'INTEGER');
  // Órdenes que ya existían al instalar el módulo: quedan fuera de la cartera hasta que el admin
  // indique si ya se cobraron (si no, aparecerían todas como deuda el primer día).
  agregar('leads', 'cobranza_por_revisar', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cobros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
      fecha TEXT NOT NULL CHECK(length(fecha) = 10 AND date(fecha, '+0 days') = fecha),
      monto_cent INTEGER NOT NULL CHECK(typeof(monto_cent) = 'integer' AND monto_cent > 0),
      tipo TEXT NOT NULL DEFAULT 'pago',
      metodo TEXT NOT NULL,
      referencia TEXT,
      notas TEXT,
      confirmado INTEGER NOT NULL DEFAULT 1 CHECK(confirmado IN (0, 1)),
      confirmado_por INTEGER REFERENCES usuarios(id),
      confirmado_at TEXT,
      registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      cancelado INTEGER NOT NULL DEFAULT 0 CHECK(cancelado IN (0, 1)),
      cancelado_por INTEGER REFERENCES usuarios(id),
      cancelado_at TEXT,
      motivo_cancelacion TEXT,
      CHECK(cancelado = 0 OR (cancelado_por IS NOT NULL AND COALESCE(length(trim(motivo_cancelacion)), 0) >= 5))
    );
    CREATE INDEX IF NOT EXISTS idx_cobros_lead ON cobros(lead_id, cancelado);
    CREATE INDEX IF NOT EXISTS idx_cobros_fecha ON cobros(fecha);
    CREATE INDEX IF NOT EXISTS idx_cobros_confirmar ON cobros(confirmado, cancelado);

    CREATE TABLE IF NOT EXISTS proveedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(nombre)) BETWEEN 1 AND 120),
      categoria TEXT NOT NULL DEFAULT 'otro',
      rfc TEXT,
      telefono TEXT,
      contacto TEXT,
      dias_credito INTEGER NOT NULL DEFAULT 0 CHECK(dias_credito BETWEEN 0 AND 180),
      notas TEXT,
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS cuentas_por_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
      categoria TEXT NOT NULL,
      concepto TEXT NOT NULL CHECK(length(trim(concepto)) BETWEEN 1 AND 200),
      factura_folio TEXT,
      fecha_documento TEXT NOT NULL CHECK(length(fecha_documento) = 10 AND date(fecha_documento, '+0 days') = fecha_documento),
      fecha_vencimiento TEXT NOT NULL CHECK(length(fecha_vencimiento) = 10 AND date(fecha_vencimiento, '+0 days') = fecha_vencimiento AND fecha_vencimiento >= fecha_documento),
      total_cent INTEGER NOT NULL CHECK(typeof(total_cent) = 'integer' AND total_cent > 0),
      lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
      equipo TEXT,
      notas TEXT,
      registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT,
      cancelada INTEGER NOT NULL DEFAULT 0 CHECK(cancelada IN (0, 1)),
      cancelada_por INTEGER REFERENCES usuarios(id),
      cancelada_at TEXT,
      motivo_cancelacion TEXT,
      CHECK(cancelada = 0 OR (cancelada_por IS NOT NULL AND COALESCE(length(trim(motivo_cancelacion)), 0) >= 5))
    );
    CREATE INDEX IF NOT EXISTS idx_cxp_vence ON cuentas_por_pagar(cancelada, fecha_vencimiento);
    CREATE INDEX IF NOT EXISTS idx_cxp_proveedor ON cuentas_por_pagar(proveedor_id);
    CREATE INDEX IF NOT EXISTS idx_cxp_lead ON cuentas_por_pagar(lead_id);
    CREATE INDEX IF NOT EXISTS idx_cxp_categoria ON cuentas_por_pagar(categoria, fecha_documento);

    CREATE TABLE IF NOT EXISTS pagos_proveedor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cxp_id INTEGER NOT NULL REFERENCES cuentas_por_pagar(id) ON DELETE RESTRICT,
      fecha TEXT NOT NULL CHECK(length(fecha) = 10 AND date(fecha, '+0 days') = fecha),
      monto_cent INTEGER NOT NULL CHECK(typeof(monto_cent) = 'integer' AND monto_cent > 0),
      metodo TEXT NOT NULL,
      referencia TEXT,
      registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      cancelado INTEGER NOT NULL DEFAULT 0 CHECK(cancelado IN (0, 1)),
      cancelado_por INTEGER REFERENCES usuarios(id),
      cancelado_at TEXT,
      motivo_cancelacion TEXT,
      CHECK(cancelado = 0 OR (cancelado_por IS NOT NULL AND COALESCE(length(trim(motivo_cancelacion)), 0) >= 5))
    );
    CREATE INDEX IF NOT EXISTS idx_pagos_prov_cxp ON pagos_proveedor(cxp_id, cancelado);
    CREATE INDEX IF NOT EXISTS idx_pagos_prov_fecha ON pagos_proveedor(fecha);
  `);

  if (nuevaInstalacion) {
    db.prepare("UPDATE leads SET cobranza_por_revisar = 1 WHERE estatus = 'ganado' AND COALESCE(valor, 0) > 0").run();
  }

  // Red de seguridad en la base (por si alguna ruta futura olvida validar): un pago no se edita
  // ni se borra; solo se cancela, y una cancelación no se revierte.
  const trigger = (nombre, cuerpo) => { db.exec(`DROP TRIGGER IF EXISTS ${nombre}`); db.exec(`CREATE TRIGGER ${nombre} ${cuerpo}`); };
  trigger('cobros_inmutable', `BEFORE UPDATE ON cobros
    WHEN NEW.lead_id <> OLD.lead_id OR NEW.monto_cent <> OLD.monto_cent OR NEW.fecha <> OLD.fecha OR NEW.metodo <> OLD.metodo
      OR NEW.tipo <> OLD.tipo OR NEW.registrado_por <> OLD.registrado_por
      OR (OLD.cancelado = 1 AND NEW.cancelado = 0) OR (OLD.confirmado = 1 AND NEW.confirmado = 0)
    BEGIN SELECT RAISE(ABORT, 'Los pagos no se modifican: cancélalo y regístralo de nuevo'); END`);
  trigger('pagos_proveedor_inmutable', `BEFORE UPDATE ON pagos_proveedor
    WHEN NEW.cxp_id <> OLD.cxp_id OR NEW.monto_cent <> OLD.monto_cent OR NEW.fecha <> OLD.fecha OR NEW.metodo <> OLD.metodo
      OR NEW.registrado_por <> OLD.registrado_por OR (OLD.cancelado = 1 AND NEW.cancelado = 0)
    BEGIN SELECT RAISE(ABORT, 'Los pagos no se modifican: cancélalo y regístralo de nuevo'); END`);
  trigger('cuentas_por_pagar_inmutable', `BEFORE UPDATE ON cuentas_por_pagar
    WHEN NEW.proveedor_id <> OLD.proveedor_id OR NEW.total_cent <> OLD.total_cent
      OR NEW.fecha_documento <> OLD.fecha_documento OR (OLD.cancelada = 1 AND NEW.cancelada = 0)
    BEGIN SELECT RAISE(ABORT, 'El importe, proveedor y fecha no se modifican: cancela y vuelve a capturar'); END`);
  trigger('cobros_sin_borrar', `BEFORE DELETE ON cobros BEGIN SELECT RAISE(ABORT, 'Los pagos no se borran: se cancelan'); END`);
  trigger('pagos_proveedor_sin_borrar', `BEFORE DELETE ON pagos_proveedor BEGIN SELECT RAISE(ABORT, 'Los pagos no se borran: se cancelan'); END`);
  trigger('cuentas_por_pagar_sin_borrar', `BEFORE DELETE ON cuentas_por_pagar BEGIN SELECT RAISE(ABORT, 'Las cuentas no se borran: se cancelan'); END`);
}

// ---------- Utilidades de dinero y fechas ----------
const aPesos = cent => Math.round(Number(cent || 0)) / 100;
// Pesos → centavos. null si no es un monto válido (> 0, máximo 2 decimales, hasta 100 millones).
function aCentavos(valor) {
  const n = typeof valor === 'string' ? Number(valor.replace(/[$,\s]/g, '')) : Number(valor);
  if (!Number.isFinite(n) || n <= 0 || n > 100000000) return null;
  const cent = Math.round(n * 100);
  return Math.abs(cent - n * 100) < 1e-6 ? cent : null;
}
function fechaValida(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(f + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === f;
}
function sumarDias(fecha, dias) {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (Number(dias) || 0));
  return d.toISOString().slice(0, 10);
}
const diasEntre = (desde, hasta) => Math.round((new Date(hasta + 'T00:00:00Z') - new Date(desde + 'T00:00:00Z')) / 86400000);
const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
// Mismo folio que el documento impreso (public/app.js folioOrdenServicio): OS-AAAAMM-0000.
const folioOS = (id, createdAt) => 'OS-' + String(createdAt || '').slice(0, 7).replace('-', '') + '-' + String(id).padStart(4, '0');
const diasCreditoValidos = v => v === null || v === '' || v === undefined || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 180);

// ---------- Cálculo de la cuenta de una orden ----------
// Total a cobrar = total facturado (con IVA) si ya se capturó; si no, el importe de la orden.
const SQL_CUENTA = `
  SELECT l.id, l.cliente_id, l.created_at, l.fecha_servicio, l.valor, l.dias_credito, l.factura_folio, l.factura_fecha,
    l.factura_total_cent, l.cobranza_por_revisar, l.servicio_id, l.estatus,
    c.nombre AS cliente_nombre, c.empresa_contacto, c.telefono, c.rfc,
    s.nombre AS servicio_nombre,
    COALESCE(l.factura_total_cent, CAST(ROUND(COALESCE(l.valor, 0) * 100) AS INTEGER)) AS total_cent,
    (SELECT COALESCE(SUM(monto_cent), 0) FROM cobros k WHERE k.lead_id = l.id AND k.cancelado = 0) AS cobrado_cent,
    (SELECT COUNT(*) FROM cobros k WHERE k.lead_id = l.id AND k.cancelado = 0 AND k.confirmado = 0) AS por_confirmar
  FROM leads l
  LEFT JOIN clientes c ON c.id = l.cliente_id
  LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id`;

function describirCuenta(f, hoy) {
  const saldo = f.total_cent - f.cobrado_cent;
  const base = f.factura_fecha || f.fecha_servicio || String(f.created_at).slice(0, 10);
  const vence = sumarDias(base, f.dias_credito || 0);
  const diasVencido = diasEntre(vence, hoy);
  let estado = saldo <= 0 ? 'pagada' : f.cobrado_cent > 0 ? 'parcial' : 'pendiente';
  // Programada: servicio todavía futuro y sin factura. No cuenta como "te deben" (aún no se hace el trabajo).
  const programada = !!(f.fecha_servicio && f.fecha_servicio > hoy && !f.factura_folio);
  const vencida = saldo > 0 && diasVencido > 0;
  let tramo = null;
  if (saldo > 0) tramo = diasVencido <= 0 ? 'por_vencer' : diasVencido <= 15 ? '1-15' : diasVencido <= 30 ? '16-30' : diasVencido <= 60 ? '31-60' : '60+';
  return {
    lead_id: f.id, folio: folioOS(f.id, f.created_at), cliente_id: f.cliente_id, cliente_nombre: f.cliente_nombre, empresa_contacto: f.empresa_contacto,
    telefono: f.telefono, rfc: f.rfc, servicio_nombre: f.servicio_nombre, created_at: f.created_at, fecha_servicio: f.fecha_servicio,
    dias_credito: f.dias_credito || 0, factura_folio: f.factura_folio, factura_fecha: f.factura_fecha,
    factura_total: f.factura_total_cent == null ? null : aPesos(f.factura_total_cent),
    total: aPesos(f.total_cent), cobrado: aPesos(f.cobrado_cent), saldo: aPesos(Math.max(saldo, 0)),
    vence, dias_vencido: saldo > 0 ? diasVencido : 0, estado, vencida, programada, tramo: programada ? null : tramo,
    por_confirmar: f.por_confirmar, por_revisar: !!f.cobranza_por_revisar,
  };
}

module.exports = function finanzas(app, db, h) {
  migrar(db);
  const rol = req => req.usuarioSesion.rol;
  const permitido = (req, res, roles, mensaje) => {
    if (roles.includes(rol(req))) return true;
    res.status(403).json({ error: mensaje || 'No tienes permiso para esta sección' });
    return false;
  };
  const soloAdmin = (req, res) => permitido(req, res, ['admin'], 'Solo un administrador puede hacer esto');
  const bitacora = (leadId, textoEvento, req) => db.prepare(
    "INSERT INTO historial (lead_id, tipo, texto, usuario, origen) VALUES (?, 'observacion', ?, ?, 'sistema')"
  ).run(leadId, textoEvento, req.usuarioSesion.nombre);
  const fmt = cent => '$' + aPesos(cent).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function cuentaDeOrden(leadId) {
    const f = db.prepare(SQL_CUENTA + " WHERE l.id = ?").get(leadId);
    return f ? describirCuenta(f, hoyMexico()) : null;
  }
  function cobrosDeOrden(leadId) {
    return db.prepare(`SELECT k.*, u.nombre AS registrado_por_nombre, uc.nombre AS cancelado_por_nombre
      FROM cobros k LEFT JOIN usuarios u ON u.id = k.registrado_por LEFT JOIN usuarios uc ON uc.id = k.cancelado_por
      WHERE k.lead_id = ? ORDER BY k.fecha DESC, k.id DESC`).all(leadId)
      .map(k => ({ ...k, monto: aPesos(k.monto_cent) }));
  }
  // Cuentas que componen la cartera (excluye las históricas aún sin revisar).
  function cartera() {
    const hoy = hoyMexico();
    return db.prepare(SQL_CUENTA + " WHERE l.estatus = 'ganado' AND l.cobranza_por_revisar = 0").all()
      .map(f => describirCuenta(f, hoy));
  }

  // ===================== CUENTAS POR COBRAR =====================

  // Resumen para Inicio y las tarjetas de la vista Cuentas.
  app.get('/api/finanzas/resumen', h((req, res) => {
    if (!permitido(req, res, PUEDE_VER_CARTERA)) return;
    const hoy = hoyMexico(), mes = hoy.slice(0, 7);
    const conSaldo = cartera().filter(c => c.saldo > 0);
    const cuentas = conSaldo.filter(c => !c.programada);
    const suma = arr => Math.round(arr.reduce((t, c) => t + c.saldo * 100, 0)) / 100;
    const r = {
      por_cobrar: suma(cuentas), vencido: suma(cuentas.filter(c => c.vencida)),
      programado: suma(conSaldo.filter(c => c.programada)), ordenes_programadas: conSaldo.filter(c => c.programada).length,
      cuentas_con_saldo: cuentas.length, clientes_con_vencido: new Set(cuentas.filter(c => c.vencida).map(c => c.cliente_id)).size,
      cobrado_mes: aPesos(db.prepare("SELECT COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE cancelado = 0 AND tipo <> 'ajuste' AND substr(fecha, 1, 7) = ?").get(mes).t),
      por_revisar: db.prepare("SELECT COUNT(*) n FROM leads WHERE estatus = 'ganado' AND cobranza_por_revisar = 1").get().n,
    };
    if (rol(req) === 'admin') {
      const pc = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE cancelado = 0 AND confirmado = 0').get();
      r.por_confirmar = { cantidad: pc.n, monto: aPesos(pc.t) };
      const domingo = sumarDias(hoy, (7 - new Date(hoy + 'T00:00:00Z').getUTCDay()) % 7);
      const cxp = cuentasPorPagar();
      const pend = cxp.filter(x => x.saldo > 0);
      r.por_pagar = Math.round(pend.reduce((t, x) => t + x.saldo * 100, 0)) / 100;
      r.pagar_semana = Math.round(pend.filter(x => x.fecha_vencimiento <= domingo).reduce((t, x) => t + x.saldo * 100, 0)) / 100;
      r.facturas_semana = pend.filter(x => x.fecha_vencimiento <= domingo).length;
      r.pagado_mes = aPesos(db.prepare('SELECT COALESCE(SUM(monto_cent), 0) t FROM pagos_proveedor WHERE cancelado = 0 AND substr(fecha, 1, 7) = ?').get(mes).t);
    }
    res.json(r);
  }));

  // Cartera por orden o por cliente, con filtros por antigüedad.
  app.get('/api/finanzas/cartera', h((req, res) => {
    if (!permitido(req, res, PUEDE_VER_CARTERA)) return;
    const filtro = String(req.query.filtro || 'con_saldo');
    const q = String(req.query.q || '').trim().toLowerCase();
    let cuentas = cartera();
    if (filtro === 'todas') { /* incluye pagadas */ }
    else if (filtro === 'vencido') cuentas = cuentas.filter(c => c.vencida);
    else if (filtro === 'por_vencer') cuentas = cuentas.filter(c => c.saldo > 0 && !c.vencida && !c.programada);
    else if (filtro === 'programadas') cuentas = cuentas.filter(c => c.saldo > 0 && c.programada);
    else if (['1-15', '16-30', '31-60', '60+'].includes(filtro)) cuentas = cuentas.filter(c => c.tramo === filtro);
    else if (filtro === 'sin_factura') cuentas = cuentas.filter(c => c.saldo > 0 && !c.factura_folio && !c.programada);
    else cuentas = cuentas.filter(c => c.saldo > 0 && !c.programada);
    if (q) cuentas = cuentas.filter(c => [c.cliente_nombre, c.empresa_contacto, c.telefono, c.servicio_nombre, c.factura_folio, String(c.lead_id)]
      .some(v => String(v || '').toLowerCase().includes(q)));
    cuentas.sort((a, b) => b.dias_vencido - a.dias_vencido || b.saldo - a.saldo);
    if (req.query.vista === 'cliente') {
      const porCliente = new Map();
      for (const c of cuentas) {
        const g = porCliente.get(c.cliente_id) || { cliente_id: c.cliente_id, cliente_nombre: c.cliente_nombre, empresa_contacto: c.empresa_contacto,
          telefono: c.telefono, saldo: 0, vencido: 0, ordenes: 0, max_dias_vencido: 0, lead_ids: [], folios: [], proximo_vence: null };
        g.saldo = Math.round((g.saldo + c.saldo) * 100) / 100;
        if (c.vencida) g.vencido = Math.round((g.vencido + c.saldo) * 100) / 100;
        g.ordenes++; g.max_dias_vencido = Math.max(g.max_dias_vencido, c.dias_vencido); g.lead_ids.push(c.lead_id); g.folios.push(c.folio);
        if (c.saldo > 0 && (!g.proximo_vence || c.vence < g.proximo_vence)) g.proximo_vence = c.vence;
        porCliente.set(c.cliente_id, g);
      }
      const creditos = db.prepare('SELECT id, dias_credito FROM clientes WHERE id = ?');
      return res.json([...porCliente.values()].map(g => ({ ...g, dias_credito: creditos.get(g.cliente_id)?.dias_credito || 0 }))
        .sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo));
    }
    res.json(cuentas);
  }));

  // Cuenta de una orden: la puede consultar cualquiera que abra la orden (para registrar pagos en campo).
  app.get('/api/leads/:id/cobros', h((req, res) => {
    const lead = db.prepare('SELECT estatus FROM leads WHERE id = ?').get(req.params.id);
    if (!lead || lead.estatus !== 'ganado') return res.status(404).json({ error: 'Solo las órdenes de servicio tienen cobranza' });
    const cuenta = cuentaDeOrden(req.params.id);
    res.json({ cuenta, cobros: cobrosDeOrden(req.params.id), puede_editar_factura: PUEDE_VER_CARTERA.includes(rol(req)), es_admin: rol(req) === 'admin' });
  }));

  app.post('/api/leads/:id/cobros', h((req, res) => {
    if (!permitido(req, res, PUEDE_REGISTRAR_COBRO)) return;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead || lead.estatus !== 'ganado') return res.status(400).json({ error: 'Solo se registran pagos en órdenes de servicio contratadas' });
    const monto = aCentavos(req.body.monto);
    if (!monto) return res.status(400).json({ error: 'Escribe un monto mayor a 0, con máximo 2 decimales' });
    const hoy = hoyMexico();
    const fecha = req.body.fecha || hoy;
    if (!fechaValida(fecha)) return res.status(400).json({ error: 'La fecha del pago no es válida' });
    if (fecha > hoy) return res.status(400).json({ error: 'La fecha del pago no puede ser futura' });
    const metodo = String(req.body.metodo || '');
    if (!METODOS.includes(metodo)) return res.status(400).json({ error: 'Elige cómo pagó el cliente' });
    let tipo = String(req.body.tipo || (lead.fecha_servicio && lead.fecha_servicio > hoy ? 'anticipo' : 'pago'));
    if (!TIPOS_COBRO.includes(tipo)) return res.status(400).json({ error: 'Tipo de pago inválido' });
    if (tipo === 'ajuste' && rol(req) !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede registrar ajustes o descuentos' });

    const cuenta = cuentaDeOrden(lead.id);
    const saldoCent = Math.round(cuenta.saldo * 100);
    if (monto > saldoCent) {
      return res.status(400).json({ error: `El pago (${fmt(monto)}) es mayor que el saldo de la orden (${fmt(saldoCent)}). Si el cliente pagó con IVA, captura primero el total facturado.` });
    }
    // Doble toque: mismo pago de la misma persona en menos de 2 minutos.
    if (!req.body.forzar) {
      const repetido = db.prepare(`SELECT id FROM cobros WHERE lead_id = ? AND monto_cent = ? AND fecha = ? AND metodo = ? AND registrado_por = ?
        AND cancelado = 0 AND created_at >= datetime('now','localtime','-2 minutes')`).get(lead.id, monto, fecha, metodo, req.usuarioSesion.id);
      if (repetido) return res.status(409).json({ error: 'Ese mismo pago se acaba de registrar. ¿Es un pago distinto?', codigo: 'POSIBLE_DUPLICADO' });
    }
    const confirmado = COBRO_CONFIRMADO_AL_REGISTRAR.includes(rol(req)) ? 1 : 0;
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO cobros (lead_id, fecha, monto_cent, tipo, metodo, referencia, notas, confirmado, confirmado_por, confirmado_at, registrado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${confirmado ? "datetime('now','localtime')" : 'NULL'}, ?)`)
        .run(lead.id, fecha, monto, tipo, metodo, texto(req.body.referencia, 120), texto(req.body.notas, 500), confirmado, confirmado ? req.usuarioSesion.id : null, req.usuarioSesion.id);
      if (lead.cobranza_por_revisar) db.prepare('UPDATE leads SET cobranza_por_revisar = 0 WHERE id = ?').run(lead.id);
      bitacora(lead.id, `${tipo === 'anticipo' ? 'Anticipo' : tipo === 'ajuste' ? 'Ajuste' : 'Pago'} registrado: ${fmt(monto)} por ${metodo} (${fecha})${confirmado ? '' : ' · por confirmar'}.`, req);
      return info.lastInsertRowid;
    })();
    res.status(201).json({ id, confirmado: !!confirmado, cuenta: cuentaDeOrden(lead.id) });
  }));

  app.post('/api/finanzas/cobros/:id/confirmar', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const c = db.prepare('SELECT * FROM cobros WHERE id = ?').get(req.params.id);
    if (!c || c.cancelado) return res.status(404).json({ error: 'Pago no encontrado' });
    if (c.confirmado) return res.json({ ok: true });
    db.transaction(() => {
      db.prepare("UPDATE cobros SET confirmado = 1, confirmado_por = ?, confirmado_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.id, c.id);
      bitacora(c.lead_id, `Pago de ${fmt(c.monto_cent)} (${c.fecha}) confirmado por administración.`, req);
    })();
    res.json({ ok: true });
  }));

  app.post('/api/finanzas/cobros/:id/cancelar', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const motivo = texto(req.body.motivo, 300);
    if (!motivo || motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo de la cancelación (mínimo 5 caracteres)' });
    const c = db.prepare('SELECT * FROM cobros WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Pago no encontrado' });
    if (c.cancelado) return res.status(400).json({ error: 'Ese pago ya estaba cancelado' });
    db.transaction(() => {
      db.prepare("UPDATE cobros SET cancelado = 1, cancelado_por = ?, cancelado_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ?").run(req.usuarioSesion.id, motivo, c.id);
      bitacora(c.lead_id, `Pago de ${fmt(c.monto_cent)} (${c.fecha}) CANCELADO. Motivo: ${motivo}`, req);
    })();
    res.json({ ok: true, cuenta: cuentaDeOrden(c.lead_id) });
  }));

  app.get('/api/finanzas/por-confirmar', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    res.json(db.prepare(`SELECT k.*, u.nombre AS registrado_por_nombre, c.nombre AS cliente_nombre, l.created_at AS lead_created_at
      FROM cobros k JOIN leads l ON l.id = k.lead_id JOIN clientes c ON c.id = l.cliente_id LEFT JOIN usuarios u ON u.id = k.registrado_por
      WHERE k.cancelado = 0 AND k.confirmado = 0 ORDER BY k.fecha, k.id`).all().map(k => ({ ...k, monto: aPesos(k.monto_cent) })));
  }));

  // Crédito y datos de la factura de una orden (va aparte de "Guardar cambios" de la orden).
  app.put('/api/leads/:id/facturacion', h((req, res) => {
    if (!permitido(req, res, PUEDE_VER_CARTERA, 'Solo administración o atención pueden cambiar crédito y factura')) return;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead || lead.estatus !== 'ganado') return res.status(400).json({ error: 'Solo las órdenes de servicio tienen facturación' });
    const b = req.body;
    if (!diasCreditoValidos(b.dias_credito)) return res.status(400).json({ error: 'Los días de crédito deben ser un número entero de 0 a 180' });
    if (b.factura_fecha && !fechaValida(b.factura_fecha)) return res.status(400).json({ error: 'La fecha de la factura no es válida' });
    let totalFactura = lead.factura_total_cent;
    if (b.factura_total !== undefined) {
      totalFactura = b.factura_total === null || b.factura_total === '' ? null : aCentavos(b.factura_total);
      if (b.factura_total !== null && b.factura_total !== '' && !totalFactura) return res.status(400).json({ error: 'El total facturado no es válido' });
    }
    const cobrado = db.prepare('SELECT COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE lead_id = ? AND cancelado = 0').get(lead.id).t;
    const nuevoTotal = totalFactura ?? Math.round((lead.valor || 0) * 100);
    if (nuevoTotal < cobrado) return res.status(400).json({ error: `El total no puede quedar por debajo de lo ya cobrado (${fmt(cobrado)})` });
    const dias = b.dias_credito === undefined ? lead.dias_credito : (b.dias_credito === null || b.dias_credito === '' ? null : Number(b.dias_credito));
    const folio = b.factura_folio === undefined ? lead.factura_folio : texto(b.factura_folio, 60);
    const fechaF = b.factura_fecha === undefined ? lead.factura_fecha : (b.factura_fecha || null);
    const cambios = [];
    if (dias !== lead.dias_credito) cambios.push(`crédito ${lead.dias_credito || 0} → ${dias || 0} días`);
    if (folio !== lead.factura_folio) cambios.push(`factura ${folio || '(sin folio)'}`);
    if (fechaF !== lead.factura_fecha) cambios.push(`fecha de factura ${fechaF || '(sin fecha)'}`);
    if (totalFactura !== lead.factura_total_cent) cambios.push(`total facturado ${totalFactura == null ? '(igual al importe)' : fmt(totalFactura)}`);
    db.transaction(() => {
      db.prepare('UPDATE leads SET dias_credito = ?, factura_folio = ?, factura_fecha = ?, factura_total_cent = ? WHERE id = ?').run(dias, folio, fechaF, totalFactura, lead.id);
      if (cambios.length) bitacora(lead.id, 'Facturación: ' + cambios.join(', ') + '.', req);
    })();
    res.json({ ok: true, cuenta: cuentaDeOrden(lead.id) });
  }));

  // Días de crédito predeterminados del cliente (se copian a sus órdenes nuevas).
  app.put('/api/finanzas/clientes/:id/credito', h((req, res) => {
    if (!permitido(req, res, PUEDE_VER_CARTERA)) return;
    if (!diasCreditoValidos(req.body.dias_credito)) return res.status(400).json({ error: 'Los días de crédito deben ser un número entero de 0 a 180' });
    const info = db.prepare('UPDATE clientes SET dias_credito = ? WHERE id = ?').run(req.body.dias_credito === '' || req.body.dias_credito == null ? null : Number(req.body.dias_credito), req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true });
  }));

  // Estado de cuenta de un cliente. Todos ven si tiene adeudo vencido (aviso al cotizar);
  // los importes solo administración y atención.
  app.get('/api/finanzas/clientes/:id/estado-cuenta', h((req, res) => {
    const cli = db.prepare('SELECT id, dias_credito FROM clientes WHERE id = ?').get(req.params.id);
    if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
    const hoy = hoyMexico();
    const cuentas = db.prepare(SQL_CUENTA + " WHERE l.estatus = 'ganado' AND l.cliente_id = ?").all(cli.id).map(f => describirCuenta(f, hoy));
    const activas = cuentas.filter(c => !c.por_revisar);
    const vencidas = activas.filter(c => c.vencida);
    const r = { cliente_id: cli.id, dias_credito: cli.dias_credito || 0, tiene_vencido: vencidas.length > 0, dias_max_vencido: Math.max(0, ...vencidas.map(c => c.dias_vencido)) };
    if (!PUEDE_VER_CARTERA.includes(rol(req))) return res.json(r);
    const suma = arr => Math.round(arr.reduce((t, c) => t + c.saldo * 100, 0)) / 100;
    const ultimos = db.prepare(`SELECT k.id, k.lead_id, k.fecha, k.monto_cent, k.metodo, k.tipo, k.confirmado, l.created_at AS lead_created_at
      FROM cobros k JOIN leads l ON l.id = k.lead_id WHERE l.cliente_id = ? AND k.cancelado = 0 ORDER BY k.fecha DESC, k.id DESC LIMIT 5`).all(cli.id)
      .map(k => ({ ...k, monto: aPesos(k.monto_cent), folio: folioOS(k.lead_id, k.lead_created_at) }));
    res.json({ ...r, saldo: suma(activas.filter(c => c.saldo > 0 && !c.programada)), vencido: suma(vencidas),
      programado: suma(activas.filter(c => c.saldo > 0 && c.programada)), por_revisar_n: cuentas.filter(c => c.por_revisar).length,
      ordenes: activas.filter(c => c.saldo > 0), ultimos_cobros: ultimos });
  }));

  // Dinero de un periodo (Resultados): cobrado; y, para admin, pagado a proveedores y gasto por categoría.
  app.get('/api/finanzas/periodo', h((req, res) => {
    if (!permitido(req, res, PUEDE_VER_CARTERA)) return;
    const hoy = hoyMexico();
    const desde = req.query.desde || hoy.slice(0, 8) + '01', hasta = req.query.hasta || hoy;
    if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Revisa el rango de fechas' });
    const c = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE cancelado = 0 AND tipo <> 'ajuste' AND fecha BETWEEN ? AND ?").get(desde, hasta);
    const r = { desde, hasta, cobrado: aPesos(c.t), cobros_n: c.n };
    if (rol(req) === 'admin') {
      r.pagado = aPesos(db.prepare('SELECT COALESCE(SUM(monto_cent), 0) t FROM pagos_proveedor WHERE cancelado = 0 AND fecha BETWEEN ? AND ?').get(desde, hasta).t);
      const gastos = db.prepare('SELECT categoria, SUM(total_cent) t FROM cuentas_por_pagar WHERE cancelada = 0 AND fecha_documento BETWEEN ? AND ? GROUP BY categoria ORDER BY t DESC').all(desde, hasta);
      r.gasto_por_categoria = gastos.map(g => ({ categoria: g.categoria, nombre: CATEGORIAS[g.categoria] || g.categoria, total: aPesos(g.t) }));
      r.gasto_total = aPesos(gastos.reduce((t, g) => t + g.t, 0));
    }
    res.json(r);
  }));

  // Revisión inicial: órdenes que ya existían al instalar el módulo.
  app.get('/api/finanzas/revision-inicial', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const hoy = hoyMexico();
    res.json(db.prepare(SQL_CUENTA + " WHERE l.estatus = 'ganado' AND l.cobranza_por_revisar = 1 ORDER BY l.fecha_servicio").all().map(f => describirCuenta(f, hoy)));
  }));
  // { cobradas: [ids], pendientes: [ids] } — las cobradas reciben un ajuste por su saldo.
  app.post('/api/finanzas/revision-inicial', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const ids = v => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);
    const cobradas = ids(req.body.cobradas), pendientes = ids(req.body.pendientes);
    const hoy = hoyMexico();
    let n = 0;
    db.transaction(() => {
      for (const id of cobradas) {
        const c = cuentaDeOrden(id);
        if (!c || !c.por_revisar) continue;
        const saldo = Math.round(c.saldo * 100);
        if (saldo > 0) {
          db.prepare(`INSERT INTO cobros (lead_id, fecha, monto_cent, tipo, metodo, notas, confirmado, confirmado_por, confirmado_at, registrado_por)
            VALUES (?, ?, ?, 'ajuste', 'otro', 'Saldo inicial: ya estaba cobrada al instalar el módulo', 1, ?, datetime('now','localtime'), ?)`)
            .run(id, fechaValida(c.fecha_servicio) && c.fecha_servicio <= hoy ? c.fecha_servicio : hoy, saldo, req.usuarioSesion.id, req.usuarioSesion.id);
        }
        db.prepare('UPDATE leads SET cobranza_por_revisar = 0 WHERE id = ?').run(id);
        bitacora(id, 'Revisión inicial de cobranza: marcada como ya cobrada.', req);
        n++;
      }
      for (const id of pendientes) {
        const info = db.prepare('UPDATE leads SET cobranza_por_revisar = 0 WHERE id = ? AND cobranza_por_revisar = 1').run(id);
        if (info.changes) { bitacora(id, 'Revisión inicial de cobranza: sigue pendiente de cobro.', req); n++; }
      }
    })();
    res.json({ ok: true, revisadas: n });
  }));

  // ===================== CUENTAS POR PAGAR (solo admin) =====================
  function cuentasPorPagar() {
    const hoy = hoyMexico();
    return db.prepare(`SELECT x.*, p.nombre AS proveedor_nombre,
        (SELECT COALESCE(SUM(monto_cent), 0) FROM pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) AS pagado_cent
      FROM cuentas_por_pagar x JOIN proveedores p ON p.id = x.proveedor_id WHERE x.cancelada = 0`).all()
      .map(x => {
        const saldo = x.total_cent - x.pagado_cent;
        return { ...x, categoria_nombre: CATEGORIAS[x.categoria] || x.categoria, total: aPesos(x.total_cent), pagado: aPesos(x.pagado_cent),
          saldo: aPesos(Math.max(saldo, 0)), vencida: saldo > 0 && x.fecha_vencimiento < hoy, dias_para_vencer: diasEntre(hoy, x.fecha_vencimiento) };
      });
  }

  app.get('/api/finanzas/categorias', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    res.json(Object.entries(CATEGORIAS).map(([clave, nombre]) => ({ clave, nombre })));
  }));

  app.get('/api/finanzas/proveedores', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const saldos = new Map();
    for (const x of cuentasPorPagar()) saldos.set(x.proveedor_id, Math.round(((saldos.get(x.proveedor_id) || 0) + x.saldo) * 100) / 100);
    res.json(db.prepare('SELECT * FROM proveedores ORDER BY activo DESC, nombre').all().map(p => ({ ...p, saldo: saldos.get(p.id) || 0 })));
  }));

  function datosProveedor(b) {
    const nombre = texto(b.nombre, 120);
    if (!nombre) return { error: 'Escribe el nombre del proveedor' };
    const categoria = b.categoria || 'otro';
    if (!CATEGORIAS[categoria]) return { error: 'Categoría inválida' };
    if (!diasCreditoValidos(b.dias_credito)) return { error: 'Los días de crédito deben ser un número entero de 0 a 180' };
    return { nombre, categoria, rfc: texto(b.rfc, 13), telefono: texto(b.telefono, 25), contacto: texto(b.contacto, 120), dias_credito: Number(b.dias_credito) || 0, notas: texto(b.notas, 1000) };
  }
  app.post('/api/finanzas/proveedores', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const d = datosProveedor(req.body);
    if (d.error) return res.status(400).json(d);
    if (db.prepare('SELECT id FROM proveedores WHERE nombre = ?').get(d.nombre)) return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });
    const info = db.prepare('INSERT INTO proveedores (nombre, categoria, rfc, telefono, contacto, dias_credito, notas) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(d.nombre, d.categoria, d.rfc, d.telefono, d.contacto, d.dias_credito, d.notas);
    res.status(201).json(db.prepare('SELECT * FROM proveedores WHERE id = ?').get(info.lastInsertRowid));
  }));
  app.put('/api/finanzas/proveedores/:id', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const p = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const d = datosProveedor({ ...p, ...req.body });
    if (d.error) return res.status(400).json(d);
    if (db.prepare('SELECT id FROM proveedores WHERE nombre = ? AND id <> ?').get(d.nombre, p.id)) return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });
    const activo = req.body.activo === undefined ? p.activo : (req.body.activo ? 1 : 0);
    db.prepare('UPDATE proveedores SET nombre = ?, categoria = ?, rfc = ?, telefono = ?, contacto = ?, dias_credito = ?, notas = ?, activo = ? WHERE id = ?')
      .run(d.nombre, d.categoria, d.rfc, d.telefono, d.contacto, d.dias_credito, d.notas, activo, p.id);
    res.json(db.prepare('SELECT * FROM proveedores WHERE id = ?').get(p.id));
  }));

  app.get('/api/finanzas/cxp', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const vista = String(req.query.vista || 'pendientes');
    let lista = cuentasPorPagar();
    if (vista !== 'todas') lista = lista.filter(x => x.saldo > 0);
    if (req.query.proveedor_id) lista = lista.filter(x => x.proveedor_id === Number(req.query.proveedor_id));
    lista.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.id - b.id);
    res.json(lista);
  }));

  // Registrar una factura o gasto de proveedor. Con ya_pagado se crea también su pago (gasto de contado).
  app.post('/api/finanzas/cxp', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const b = req.body;
    const prov = db.prepare('SELECT * FROM proveedores WHERE id = ? AND activo = 1').get(b.proveedor_id);
    if (!prov) return res.status(400).json({ error: 'Elige un proveedor' });
    const categoria = b.categoria || prov.categoria;
    if (!CATEGORIAS[categoria]) return res.status(400).json({ error: 'Categoría inválida' });
    const concepto = texto(b.concepto, 200);
    if (!concepto) return res.status(400).json({ error: 'Escribe el concepto del gasto' });
    const total = aCentavos(b.total);
    if (!total) return res.status(400).json({ error: 'Escribe el total (mayor a 0, máximo 2 decimales)' });
    const fecha = b.fecha_documento || hoyMexico();
    if (!fechaValida(fecha)) return res.status(400).json({ error: 'La fecha del documento no es válida' });
    const vence = b.fecha_vencimiento || sumarDias(fecha, prov.dias_credito);
    if (!fechaValida(vence) || vence < fecha) return res.status(400).json({ error: 'El vencimiento no es válido (no puede ser antes de la fecha del documento)' });
    let leadId = null;
    if (b.lead_id) {
      const l = db.prepare("SELECT id FROM leads WHERE id = ? AND estatus = 'ganado'").get(b.lead_id);
      if (!l) return res.status(400).json({ error: 'La orden de servicio indicada no existe' });
      leadId = l.id;
    }
    if (b.ya_pagado && !METODOS.includes(b.metodo)) return res.status(400).json({ error: 'Elige cómo se pagó' });
    const folioFactura = texto(b.factura_folio, 60);
    if (folioFactura && !b.forzar && db.prepare('SELECT id FROM cuentas_por_pagar WHERE proveedor_id = ? AND factura_folio = ? AND cancelada = 0').get(prov.id, folioFactura)) {
      return res.status(409).json({ error: `Ya registraste la factura ${folioFactura} de ${prov.nombre}. ¿Es otra factura?`, codigo: 'POSIBLE_DUPLICADO' });
    }
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO cuentas_por_pagar (proveedor_id, categoria, concepto, factura_folio, fecha_documento, fecha_vencimiento, total_cent, lead_id, equipo, notas, registrado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(prov.id, categoria, concepto, texto(b.factura_folio, 60), fecha, vence, total, leadId, texto(b.equipo, 200), texto(b.notas, 1000), req.usuarioSesion.id);
      if (b.ya_pagado) {
        db.prepare('INSERT INTO pagos_proveedor (cxp_id, fecha, monto_cent, metodo, referencia, registrado_por) VALUES (?, ?, ?, ?, ?, ?)')
          .run(info.lastInsertRowid, fecha > hoyMexico() ? hoyMexico() : fecha, total, b.metodo, texto(b.referencia, 120), req.usuarioSesion.id);
      }
      return info.lastInsertRowid;
    })();
    res.status(201).json({ id });
  }));

  app.post('/api/finanzas/cxp/:id/pagos', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const x = cuentasPorPagar().find(c => c.id === Number(req.params.id));
    if (!x) return res.status(404).json({ error: 'Cuenta por pagar no encontrada' });
    const monto = aCentavos(req.body.monto);
    if (!monto) return res.status(400).json({ error: 'Escribe un monto mayor a 0, con máximo 2 decimales' });
    if (monto > Math.round(x.saldo * 100)) return res.status(400).json({ error: `El pago es mayor que el saldo (${fmt(Math.round(x.saldo * 100))})` });
    const hoy = hoyMexico(), fecha = req.body.fecha || hoy;
    if (!fechaValida(fecha) || fecha > hoy) return res.status(400).json({ error: 'La fecha del pago no es válida o es futura' });
    if (!METODOS.includes(req.body.metodo)) return res.status(400).json({ error: 'Elige cómo se pagó' });
    if (!req.body.forzar && db.prepare(`SELECT id FROM pagos_proveedor WHERE cxp_id = ? AND monto_cent = ? AND fecha = ? AND cancelado = 0
      AND created_at >= datetime('now','localtime','-2 minutes')`).get(x.id, monto, fecha)) {
      return res.status(409).json({ error: 'Ese mismo pago se acaba de registrar. ¿Es un pago distinto?', codigo: 'POSIBLE_DUPLICADO' });
    }
    const info = db.prepare('INSERT INTO pagos_proveedor (cxp_id, fecha, monto_cent, metodo, referencia, registrado_por) VALUES (?, ?, ?, ?, ?, ?)')
      .run(x.id, fecha, monto, req.body.metodo, texto(req.body.referencia, 120), req.usuarioSesion.id);
    res.status(201).json({ id: info.lastInsertRowid });
  }));

  app.get('/api/finanzas/cxp/:id/pagos', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    res.json(db.prepare(`SELECT g.*, u.nombre AS registrado_por_nombre FROM pagos_proveedor g LEFT JOIN usuarios u ON u.id = g.registrado_por
      WHERE g.cxp_id = ? ORDER BY g.fecha DESC, g.id DESC`).all(req.params.id).map(g => ({ ...g, monto: aPesos(g.monto_cent) })));
  }));

  app.post('/api/finanzas/pagos-proveedor/:id/cancelar', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const motivo = texto(req.body.motivo, 300);
    if (!motivo || motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo de la cancelación (mínimo 5 caracteres)' });
    const info = db.prepare("UPDATE pagos_proveedor SET cancelado = 1, cancelado_por = ?, cancelado_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ? AND cancelado = 0")
      .run(req.usuarioSesion.id, motivo, req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Pago no encontrado o ya cancelado' });
    res.json({ ok: true });
  }));

  app.post('/api/finanzas/cxp/:id/cancelar', h((req, res) => {
    if (!soloAdmin(req, res)) return;
    const motivo = texto(req.body.motivo, 300);
    if (!motivo || motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo de la cancelación (mínimo 5 caracteres)' });
    const pagos = db.prepare('SELECT COUNT(*) n FROM pagos_proveedor WHERE cxp_id = ? AND cancelado = 0').get(req.params.id).n;
    if (pagos) return res.status(409).json({ error: 'Esta cuenta tiene pagos registrados: cancélalos primero' });
    const info = db.prepare("UPDATE cuentas_por_pagar SET cancelada = 1, cancelada_por = ?, cancelada_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ? AND cancelada = 0")
      .run(req.usuarioSesion.id, motivo, req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Cuenta no encontrada o ya cancelada' });
    res.json({ ok: true });
  }));

  // ---------- Ganchos para las rutas de órdenes (server/index.js) ----------
  return {
    // Centavos cobrados (no cancelados) de una orden.
    cobradoCent: leadId => db.prepare('SELECT COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE lead_id = ? AND cancelado = 0').get(leadId).t,
    // ¿Tiene pagos activos? (no se puede borrar ni reabrir como cotización)
    tieneCobros: leadId => !!db.prepare('SELECT 1 FROM cobros WHERE lead_id = ? AND cancelado = 0 LIMIT 1').get(leadId),
    // Al nacer una orden se copian los días de crédito del cliente (si la orden no tiene).
    copiarCredito: leadId => db.prepare(`UPDATE leads SET dias_credito = (SELECT dias_credito FROM clientes WHERE clientes.id = leads.cliente_id)
      WHERE id = ? AND dias_credito IS NULL`).run(leadId),
  };
};
module.exports.aCentavos = aCentavos;
module.exports.migrar = migrar;
module.exports.folioOS = folioOS;
module.exports.describirCuenta = describirCuenta;
