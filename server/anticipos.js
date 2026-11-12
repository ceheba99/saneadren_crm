// MÓDULO CONTABLE · F2 (2026-11-11, aprobado por Dirección): ANTICIPOS POR COMPROBAR.
// Dinero que se le entrega a una persona del personal ANTES del gasto (casetas, diésel, viáticos, una compra en campo)
// y que después comprueba con sus tickets o facturas.
//  1. Entregar: quien mueve dinero (dinero.mover) registra a quién, cuánto, cuándo, cómo y de qué cuenta salió, para qué y,
//     si aplica, la orden de servicio. Es una SALIDA del banco (Flujo de banco: «Anticipo por comprobar»).
//  2. Comprobar: cada ticket o factura es un gasto normal de Cuentas por pagar (con su XML si lo trae) marcado con el
//     anticipo (cuentas_por_pagar.anticipo_id). Se paga solo con el anticipo (un pago con vía «anticipo», que NO es otra
//     salida del banco) hasta donde alcance; si el gasto pasa lo que queda, la diferencia queda «Reembolso a <persona>»
//     por pagar, como los reembolsos de hoy. Lo captura la persona (si tiene usuario) o quien mueve dinero.
//  3. Cerrar: si sobró, la persona regresa el dinero (reintegro: ENTRADA al banco) y se cierra; si no sobró, se cierra
//     sin más. Un anticipo cerrado ya no recibe gastos y sus gastos no se descomprueban.
//  4. Aviso en Inicio: a quien lo entregó, si pasa de 7 días sin cerrarse; a la persona, mientras tenga algo por comprobar.
//  · Quién ve: Dirección, quien mueve dinero y ve al personal (el Gerente) y quien tiene «Contabilidad del mes» ven todos
//    los de sus sucursales; cada persona ve solo los suyos. Compras (mueve dinero sin ver al personal) no, por ahora. Nada se borra: un anticipo equivocado (sin gastos) se cancela con motivo.
const { hoyMexico } = require('./fechas');
const DIAS_AVISO = 7;
const pesos = c => Math.round(Number(c || 0)) / 100;

module.exports = function anticipos(app, db, h) {
  const P = app.locals.permisos;
  const F = require('./finanzas');
  const { aCentavos, METODOS_PROV, fechaValida, texto, conSentido } = F;
  const fmt = cent => '$' + pesos(cent).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fechaTxt = f => String(f || '').slice(0, 10).split('-').reverse().join('/');
  const bitacora = (leadId, textoEvento, req) => db.prepare(
    "INSERT INTO main.historial (lead_id, tipo, texto, usuario, origen, area, usuario_id) VALUES (?, 'observacion', ?, ?, 'sistema', 'cxp', ?)"
  ).run(leadId, textoEvento, req.usuarioSesion.nombre, req.usuarioSesion.id);

  db.exec(`CREATE TABLE IF NOT EXISTS anticipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    personal_id INTEGER NOT NULL REFERENCES personal(id),
    fecha TEXT NOT NULL CHECK(length(fecha) = 10 AND date(fecha, '+0 days') = fecha),
    monto_cent INTEGER NOT NULL CHECK(typeof(monto_cent) = 'integer' AND monto_cent > 0),
    metodo TEXT NOT NULL,
    cuenta_origen TEXT, referencia TEXT,
    motivo TEXT NOT NULL CHECK(length(trim(motivo)) BETWEEN 3 AND 300),
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    sucursal_id INTEGER REFERENCES sucursales(id),
    entregado_por INTEGER NOT NULL REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    estado TEXT NOT NULL DEFAULT 'abierto' CHECK(estado IN ('abierto', 'cerrado', 'cancelado')),
    reintegro_cent INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reintegro_cent) = 'integer' AND reintegro_cent >= 0),
    reintegro_fecha TEXT, reintegro_metodo TEXT, reintegro_cuenta TEXT, reintegro_referencia TEXT,
    nota_cierre TEXT, cerrado_por INTEGER REFERENCES usuarios(id), cerrado_at TEXT,
    cancelado_por INTEGER REFERENCES usuarios(id), cancelado_at TEXT, motivo_cancelacion TEXT,
    CHECK(estado <> 'cancelado' OR (cancelado_por IS NOT NULL AND COALESCE(length(trim(motivo_cancelacion)), 0) >= 5)),
    CHECK(estado <> 'cerrado' OR cerrado_por IS NOT NULL)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_anticipos_estado ON anticipos(estado, fecha)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_anticipos_personal ON anticipos(personal_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_anticipos_sucursal ON anticipos(sucursal_id)');
  if (!db.prepare('PRAGMA table_info(cuentas_por_pagar)').all().some(c => c.name === 'anticipo_id')) db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN anticipo_id INTEGER REFERENCES anticipos(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cxp_anticipo ON cuentas_por_pagar(anticipo_id)');
  // Red de seguridad en la base: no se borra; a quién, cuánto, cuándo y cómo no cambian; cerrado o cancelado no se reabre.
  const trigger = (nombre, cuerpo) => { db.exec(`DROP TRIGGER IF EXISTS ${nombre}`); db.exec(`CREATE TRIGGER ${nombre} ${cuerpo}`); };
  trigger('anticipos_inmutable', `BEFORE UPDATE ON anticipos
    WHEN NEW.personal_id <> OLD.personal_id OR NEW.monto_cent <> OLD.monto_cent OR NEW.fecha <> OLD.fecha OR NEW.metodo <> OLD.metodo
      OR NEW.entregado_por <> OLD.entregado_por OR (OLD.estado <> 'abierto' AND NEW.estado <> OLD.estado) OR (OLD.estado <> 'abierto' AND NEW.reintegro_cent <> OLD.reintegro_cent)
    BEGIN SELECT RAISE(ABORT, 'Un anticipo no se modifica: si se capturó mal, cancélalo (sin gastos) y regístralo de nuevo'); END`);
  trigger('anticipos_sin_borrar', `BEFORE DELETE ON anticipos BEGIN SELECT RAISE(ABORT, 'Los anticipos no se borran: se cancelan'); END`);

  // Entregar, cerrar y cancelar: quien mueve dinero Y ya ve al personal (nombre y puesto: «Ver personal» u órdenes de
  // servicio). Así Compras (mueve dinero, pero no ve al personal; regla del 2026-10-19) no recibe nombres por aquí.
  const mueve = req => P.direccion(req) || (P.puede(req, 'dinero.mover') && (P.puede(req, 'personal.ver') || P.puede(req, 'ordenes.ver')));
  const veTodos = req => mueve(req) || P.puede(req, 'contabilidad.ver');
  const yo = req => req.usuarioSesion.id;
  // Lo comprobado: lo que se pagó con el anticipo a sus gastos vigentes.
  const comprobadoDe = id => db.prepare(`SELECT COALESCE(SUM(g.monto_cent), 0) n FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id
    WHERE x.anticipo_id = ? AND x.cancelada = 0 AND g.cancelado = 0 AND g.metodo = 'anticipo'`).get(id).n;
  const leer = id => db.prepare(`SELECT a.*, p.nombre AS persona, p.usuario_id AS persona_usuario, p.puesto, u.nombre AS entrego FROM main.anticipos a
    JOIN main.personal p ON p.id = a.personal_id LEFT JOIN main.usuarios u ON u.id = a.entregado_por WHERE a.id = ?`).get(id);
  // ¿Lo ve quien pide? Los de sus sucursales si ve todos; si no, solo los suyos (la persona del anticipo es él).
  const loVe = (req, a) => !!a && (a.persona_usuario === yo(req) || (veTodos(req) && !!db.prepare('SELECT en_alcance(?) v').get(a.sucursal_id).v));
  function conCuentas(a) {
    const comprobado = comprobadoDe(a.id), saldo = a.estado === 'cancelado' ? 0 : a.monto_cent - comprobado - a.reintegro_cent;
    const dias = Math.max(0, Math.round((Date.parse(hoyMexico() + 'T12:00:00Z') - Date.parse(a.fecha + 'T12:00:00Z')) / 864e5));
    return { ...a, comprobado_cent: comprobado, saldo_cent: saldo, dias };
  }
  const folioOS = (id, creado) => (id ? require('./sucursales').folio('OS', 'leads', id, creado) : '');

  // Para el alta de un gasto en Cuentas por pagar (finanzas.js): ¿se puede comprobar con este anticipo y cuánto le queda?
  function paraGasto(req, anticipoId) {
    const a = leer(Number(anticipoId) || 0);
    if (!a || !loVe(req, a)) return { status: 404, error: 'No se encontró el anticipo' };
    if (a.estado !== 'abierto') return { status: 409, error: a.estado === 'cerrado' ? 'Ese anticipo ya se cerró: ya no recibe gastos' : 'Ese anticipo está cancelado' };
    if (a.persona_usuario !== yo(req) && !mueve(req)) return { status: 403, error: 'Los gastos de un anticipo los captura la persona que lo recibió o quien mueve dinero' };
    return { anticipo: a, saldo_cent: conCuentas(a).saldo_cent };
  }
  // ¿Se puede cancelar este pago con vía «anticipo»? Si el anticipo ya se cerró, no (sus cuentas ya se cuadraron).
  function bloqueaCancelarPago(pago) {
    if (pago?.metodo !== 'anticipo') return null;
    const a = db.prepare('SELECT a.estado FROM main.anticipos a JOIN main.cuentas_por_pagar x ON x.anticipo_id = a.id WHERE x.id = ?').get(pago.cxp_id);
    return a && a.estado !== 'abierto' ? 'Ese gasto se comprobó con un anticipo que ya se cerró: no se puede descomprobar' : null;
  }
  app.locals.anticipos = { paraGasto, bloqueaCancelarPago, comprobadoDe };

  // ---------- Lista ----------
  app.get('/api/anticipos', h((req, res) => {
    const estado = ['abiertos', 'cerrados', 'todos'].includes(req.query.estado) ? req.query.estado : 'abiertos';
    const filtroEstado = estado === 'abiertos' ? "a.estado = 'abierto'" : estado === 'cerrados' ? "a.estado IN ('cerrado', 'cancelado')" : '1 = 1';
    const todos = veTodos(req);
    const filas = db.prepare(`SELECT a.*, p.nombre AS persona, p.usuario_id AS persona_usuario, p.puesto, u.nombre AS entrego, l.created_at AS lead_created_at
      FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id LEFT JOIN main.usuarios u ON u.id = a.entregado_por LEFT JOIN main.leads l ON l.id = a.lead_id
      WHERE ${filtroEstado} AND (${todos ? 'en_alcance(a.sucursal_id)' : '0'} OR p.usuario_id = ?) ORDER BY a.estado = 'abierto' DESC, a.fecha DESC, a.id DESC LIMIT 300`).all(yo(req));
    const gastosDe = db.prepare(`SELECT x.id, x.concepto, x.total_cent, x.fecha_documento, x.tipo_comprobante, x.factura_folio, x.beneficiario, x.cancelada, pr.nombre AS proveedor,
        (SELECT COALESCE(SUM(g.monto_cent), 0) FROM main.pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0 AND g.metodo = 'anticipo') AS con_anticipo,
        (SELECT COALESCE(SUM(g.monto_cent), 0) FROM main.pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) AS pagado,
        (SELECT 1 FROM main.cfdi_gastos q WHERE q.cxp_id = x.id AND q.eliminado = 0 LIMIT 1) AS con_xml
      FROM main.cuentas_por_pagar x JOIN main.proveedores pr ON pr.id = x.proveedor_id WHERE x.anticipo_id = ? AND x.cancelada = 0 ORDER BY x.fecha_documento, x.id`);
    const conXml = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'cfdi_gastos'").get();
    const personas = mueve(req) ? db.prepare("SELECT id, nombre, puesto, sucursal_id FROM main.personal WHERE activo = 1 AND en_alcance(sucursal_id) ORDER BY nombre").all() : [];
    res.json({
      puede_entregar: mueve(req), ve_todos: todos, dias_aviso: DIAS_AVISO, personas,
      anticipos: filas.map(conCuentas).map(a => ({
        id: a.id, persona: a.persona, puesto: a.puesto, es_mio: a.persona_usuario === yo(req), persona_con_usuario: a.persona_usuario != null,
        fecha: a.fecha, monto: pesos(a.monto_cent), metodo: a.metodo, cuenta_origen: a.cuenta_origen || '', referencia: a.referencia || '', motivo: a.motivo,
        orden: folioOS(a.lead_id, a.lead_created_at), lead_id: a.lead_id, entrego: a.entrego || '', estado: a.estado, dias: a.dias,
        comprobado: pesos(a.comprobado_cent), reintegro: pesos(a.reintegro_cent), saldo: pesos(a.saldo_cent), reintegro_fecha: a.reintegro_fecha || '', reintegro_metodo: a.reintegro_metodo || '',
        nota_cierre: a.nota_cierre || '', motivo_cancelacion: a.motivo_cancelacion || '', vencido: a.estado === 'abierto' && a.dias > DIAS_AVISO,
        gastos: (conXml ? gastosDe.all(a.id) : []).map(g => ({ id: g.id, proveedor: g.proveedor, concepto: g.concepto, fecha: g.fecha_documento, total: pesos(g.total_cent), con_anticipo: pesos(g.con_anticipo),
          por_reembolsar: pesos(g.total_cent - g.pagado), reembolso_a: /^Reembolso a /.test(g.beneficiario || '') ? g.beneficiario : '', comprobante: g.tipo_comprobante || '', folio: g.factura_folio || '', xml: !!g.con_xml })),
      })),
    });
  }));

  // ---------- Avisos para Inicio ----------
  // A quien lo entregó: los que pasan de 7 días sin cerrarse. A la persona: los suyos con algo por comprobar.
  app.get('/api/anticipos/avisos', h((req, res) => {
    const filas = db.prepare(`SELECT a.*, p.nombre AS persona, p.usuario_id AS persona_usuario FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id
      WHERE a.estado = 'abierto' AND (a.entregado_por = ? OR p.usuario_id = ?) ORDER BY a.fecha`).all(yo(req), yo(req)).map(conCuentas);
    const avisos = [];
    for (const a of filas) {
      if (a.persona_usuario === yo(req) && a.saldo_cent > 0) avisos.push({ id: a.id, tipo: 'mio', urgente: a.dias > DIAS_AVISO, texto: `Tienes ${fmt(a.saldo_cent)} por comprobar`, detalle: `Anticipo del ${fechaTxt(a.fecha)} · ${a.motivo}` });
      else if (a.entregado_por === yo(req) && a.dias > DIAS_AVISO) avisos.push({ id: a.id, tipo: 'entregado', urgente: true, texto: `Anticipo de ${a.persona} sin cerrar (${a.dias} días)`,
        detalle: a.saldo_cent > 0 ? `${fmt(a.saldo_cent)} por comprobar de ${fmt(a.monto_cent)} · ${a.motivo}` : `Ya está comprobado: falta cerrarlo · ${a.motivo}` });
    }
    res.json({ avisos });
  }));

  // ---------- Entregar ----------
  app.post('/api/anticipos', h((req, res) => {
    if (!mueve(req)) return res.status(403).json({ error: 'Los anticipos los entrega Dirección o quien mueve dinero y ve al personal (el Gerente)' });
    const b = req.body || {};
    const persona = db.prepare('SELECT * FROM main.personal WHERE id = ? AND activo = 1 AND en_alcance(sucursal_id)').get(Number(b.personal_id) || 0);
    if (!persona) return res.status(400).json({ error: 'Elige a quién se le entrega el anticipo (personal activo)' });
    const monto = aCentavos(b.monto);
    if (!monto) return res.status(400).json({ error: 'Escribe el monto del anticipo (mayor a 0, máximo 2 decimales)' });
    const hoy = hoyMexico(), fecha = b.fecha || hoy;
    if (!fechaValida(fecha) || fecha > hoy) return res.status(400).json({ error: 'La fecha del anticipo no es válida o es futura' });
    if (!METODOS_PROV.includes(b.metodo)) return res.status(400).json({ error: 'Elige cómo se entregó (efectivo, transferencia…)' });
    const motivo = texto(b.motivo, 300);
    if (!motivo || !conSentido(motivo, 3)) return res.status(400).json({ error: 'Escribe para qué es el anticipo (por ejemplo: casetas y diésel de la ruta a San Juan del Río)' });
    let lead = null;
    if (b.lead_id) {
      lead = F.ordenParaLigar?.(b.lead_id);
      if (!lead) return res.status(400).json({ error: 'La orden de servicio indicada no existe' });
    }
    if (!b.forzar && db.prepare(`SELECT id FROM main.anticipos WHERE personal_id = ? AND monto_cent = ? AND fecha = ? AND estado <> 'cancelado' AND created_at >= datetime('now','localtime','-2 minutes')`).get(persona.id, monto, fecha))
      return res.status(409).json({ error: `Ese mismo anticipo a ${persona.nombre} se acaba de registrar. ¿Es otro anticipo?`, codigo: 'POSIBLE_DUPLICADO' });
    const sucursal = lead?.sucursal_id ?? persona.sucursal_id;
    const id = Number(db.prepare(`INSERT INTO main.anticipos (personal_id, fecha, monto_cent, metodo, cuenta_origen, referencia, motivo, lead_id, sucursal_id, entregado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(persona.id, fecha, monto, b.metodo, texto(b.cuenta_origen, 80), texto(b.referencia, 120), motivo, lead?.id ?? null, sucursal, yo(req)).lastInsertRowid);
    if (lead) bitacora(lead.id, `Anticipo por comprobar entregado a ${persona.nombre}: ${fmt(monto)} (${b.metodo}, ${fechaTxt(fecha)}) · ${motivo}.`, req);
    app.locals.auditoria?.registrar(req, 'anticipo', id, 'entregado', `${persona.nombre} · ${fmt(monto)} por ${b.metodo} el ${fecha} · ${motivo}`);
    res.status(201).json({ id });
  }));

  // ---------- Cerrar ----------
  // Si sobró: la persona lo regresa (reintegro, que entra al banco) y se anota cómo y cuándo. Si no sobró, se cierra.
  app.post('/api/anticipos/:id/cerrar', h((req, res) => {
    if (!mueve(req)) return res.status(403).json({ error: 'Los anticipos los cierra quien mueve dinero' });
    const a = leer(Number(req.params.id) || 0);
    if (!a || !loVe(req, a)) return res.status(404).json({ error: 'No se encontró el anticipo' });
    if (a.estado !== 'abierto') return res.status(409).json({ error: a.estado === 'cerrado' ? 'Ese anticipo ya está cerrado' : 'Ese anticipo está cancelado' });
    const b = req.body || {}, saldo = conCuentas(a).saldo_cent, hoy = hoyMexico();
    let reintegro = null;
    if (saldo > 0) {
      const fecha = b.fecha || hoy;
      if (!fechaValida(fecha) || fecha > hoy || fecha < a.fecha) return res.status(400).json({ error: 'La fecha en que regresó el dinero no es válida (no puede ser futura ni antes del anticipo)' });
      if (!METODOS_PROV.includes(b.metodo)) return res.status(400).json({ error: `Sobraron ${fmt(saldo)}: elige cómo los regresó ${a.persona} (efectivo, transferencia…)` });
      reintegro = { fecha, metodo: b.metodo, cuenta: texto(b.cuenta, 80), referencia: texto(b.referencia, 120) };
    }
    const nota = texto(b.nota, 300);
    db.prepare(`UPDATE main.anticipos SET estado = 'cerrado', cerrado_por = ?, cerrado_at = datetime('now','localtime'), nota_cierre = ?,
      reintegro_cent = ?, reintegro_fecha = ?, reintegro_metodo = ?, reintegro_cuenta = ?, reintegro_referencia = ? WHERE id = ? AND estado = 'abierto'`)
      .run(yo(req), nota, reintegro ? saldo : 0, reintegro?.fecha ?? null, reintegro?.metodo ?? null, reintegro?.cuenta ?? null, reintegro?.referencia ?? null, a.id);
    const txt = reintegro ? `regresó ${fmt(saldo)} (${reintegro.metodo}, ${fechaTxt(reintegro.fecha)})` : 'comprobado completo';
    if (a.lead_id) bitacora(a.lead_id, `Anticipo de ${a.persona} cerrado: ${txt}.`, req);
    app.locals.auditoria?.registrar(req, 'anticipo', a.id, 'cerrado', `${a.persona} · ${fmt(a.monto_cent)} · ${txt}${nota ? ' · ' + nota : ''}`);
    res.json({ ok: true, reintegro: pesos(reintegro ? saldo : 0) });
  }));

  // ---------- Cancelar (se capturó mal) ----------
  app.post('/api/anticipos/:id/cancelar', h((req, res) => {
    if (!mueve(req)) return res.status(403).json({ error: 'Los anticipos los cancela quien mueve dinero' });
    const a = leer(Number(req.params.id) || 0);
    if (!a || !loVe(req, a)) return res.status(404).json({ error: 'No se encontró el anticipo' });
    if (a.estado !== 'abierto') return res.status(409).json({ error: 'Solo se cancela un anticipo abierto' });
    const motivo = texto(req.body?.motivo, 300);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe el motivo de la cancelación (mínimo 5 caracteres)' });
    if (db.prepare('SELECT 1 FROM main.cuentas_por_pagar WHERE anticipo_id = ? AND cancelada = 0').get(a.id))
      return res.status(409).json({ error: 'Este anticipo ya tiene gastos comprobados: ciérralo (o cancela primero esos gastos en Cuentas por pagar)' });
    db.prepare("UPDATE main.anticipos SET estado = 'cancelado', cancelado_por = ?, cancelado_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ? AND estado = 'abierto'").run(yo(req), motivo, a.id);
    if (a.lead_id) bitacora(a.lead_id, `Anticipo de ${a.persona} por ${fmt(a.monto_cent)} CANCELADO. Motivo: ${motivo}`, req);
    app.locals.auditoria?.registrar(req, 'anticipo', a.id, 'cancelado', `${a.persona} · ${fmt(a.monto_cent)} · motivo: ${motivo}`);
    res.json({ ok: true });
  }));
};
module.exports.DIAS_AVISO = DIAS_AVISO;
