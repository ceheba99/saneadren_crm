// FOLIOS DE BANCO (Editar Contabilidad parte 5, 2026-11-12, decisiones de Dirección):
//  · Cada movimiento de dinero recibe un folio ANTES de llegar al Flujo de banco, en el momento en que queda registrado con
//    su cuenta: el pago a proveedor (también nómina y conciliación), el cobro al CONFIRMARSE, la entrega de un anticipo, su
//    reintegro y el movimiento agregado a mano.
//  · Una serie por cuenta y por tipo, SIEMPRE consecutiva (no empieza de nuevo cada mes): STD-I-0001 (entradas a Santander),
//    STD-E-0001 (salidas), BNT-…, PAG-… (pagadora), CAJ-… (efectivo). La clave (STD, BNT…) es de cada cuenta.
//  · Un folio nunca se reusa ni se borra. Si el movimiento se cancela, el folio se queda (el flujo lo muestra en gris como
//    CANCELADO). Si la cuenta estaba mal y se corrige, el folio viejo queda «reasignado» al nuevo de la cuenta correcta.
//  · El folio lo ponen disparadores TEMPORALES de la base (como el candado del mes cerrado): así ningún camino (pantalla,
//    carga de Excel, nómina, conciliación) se lo salta. Lo que no tiene cuenta con clave queda «sin folio» y se ve en el flujo.
const alcance = require('./alcance');
const CLAVE = /^[A-Z0-9]{2,6}$/;

function migrar(db) {
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  const agrega = (t, c, def) => { if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) && !cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  agrega('cuentas_banco', 'clave_folio', 'TEXT');
  agrega('cobros', 'cuenta_id', 'INTEGER');
  agrega('pagos_proveedor', 'cuenta_id', 'INTEGER');
  agrega('anticipos', 'cuenta_id', 'INTEGER');
  agrega('anticipos', 'reintegro_cuenta_id', 'INTEGER');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_banco_clave ON cuentas_banco(clave_folio) WHERE clave_folio IS NOT NULL;
    CREATE TABLE IF NOT EXISTS folios_banco (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas_banco(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('I', 'E')),
      numero INTEGER NOT NULL CHECK(numero > 0),
      folio TEXT NOT NULL UNIQUE,
      ref TEXT NOT NULL CHECK(ref GLOB '[a-z]*:[0-9]*'),
      fecha_mov TEXT, monto_cent INTEGER, concepto TEXT,
      estado TEXT NOT NULL DEFAULT 'vigente' CHECK(estado IN ('vigente', 'reasignado', 'sin_cuenta')),
      reasignado_a TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      cambio_usuario_id INTEGER REFERENCES usuarios(id), cambio_at TEXT,
      UNIQUE(cuenta_id, tipo, numero)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_folios_ref_vigente ON folios_banco(ref) WHERE estado = 'vigente';
    CREATE INDEX IF NOT EXISTS idx_folios_fecha ON folios_banco(cuenta_id, fecha_mov);
    -- Un folio no se borra; su número, serie y movimiento no cambian; solo deja de estar vigente (reasignado o sin cuenta).
    CREATE TRIGGER IF NOT EXISTS folios_sin_borrar BEFORE DELETE ON folios_banco BEGIN SELECT RAISE(ABORT, 'Los folios de banco no se borran'); END;
    CREATE TRIGGER IF NOT EXISTS folios_fijos BEFORE UPDATE ON folios_banco WHEN NEW.cuenta_id IS NOT OLD.cuenta_id OR NEW.tipo IS NOT OLD.tipo OR NEW.numero IS NOT OLD.numero
      OR NEW.folio IS NOT OLD.folio OR NEW.ref IS NOT OLD.ref OR OLD.estado <> 'vigente'
      BEGIN SELECT RAISE(ABORT, 'Un folio de banco no cambia: solo deja de estar vigente'); END;`);
}

module.exports = function foliosBanco(app, db, h) {
  migrar(db);
  const P = app.locals.permisos;
  const cuenta = id => db.prepare('SELECT * FROM main.cuentas_banco WHERE id = ?').get(Number(id) || 0);
  const conClave = suc => db.prepare('SELECT id, nombre, banco, terminacion, clave_folio, sucursal_id FROM main.cuentas_banco WHERE sucursal_id = ? AND activa = 1 AND clave_folio IS NOT NULL ORDER BY id').all(suc);

  // ---------- En la base ----------
  // La cuenta con clave a la que va un movimiento: la elegida (cuenta_id) o, para lo de antes y lo que se escribe a mano, la
  // que coincida con el texto de la «cuenta de salida» (nombre, terminación o banco; ver server/contabilidad.js).
  db.db.function('cuenta_folio', { deterministic: false }, (id, texto, suc) => {
    const c = id ? cuenta(id) : null;
    if (c) return c.clave_folio ? c.id : null;
    if (!texto || suc == null) return null;
    const r = app.locals.flujoBanco?.cuentaDeTexto?.(texto, Number(suc));
    return r && cuenta(r)?.clave_folio ? r : null;
  });
  db.db.function('yo_id', { deterministic: false }, () => alcance.usuario());
  const nuevoFolio = (tipo, ref, cta, fecha, monto, concepto) => `
    INSERT INTO folios_banco (cuenta_id, tipo, numero, folio, ref, fecha_mov, monto_cent, concepto, usuario_id)
    SELECT c.id, ${tipo}, n.num, c.clave_folio || '-' || ${tipo} || '-' || printf('%04d', n.num), ${ref}, ${fecha}, ${monto}, ${concepto}, yo_id()
    FROM main.cuentas_banco c, (SELECT COALESCE(MAX(f.numero), 0) + 1 AS num FROM main.folios_banco f WHERE f.cuenta_id = ${cta} AND f.tipo = ${tipo}) n
    WHERE c.id = ${cta} AND c.clave_folio IS NOT NULL AND NOT EXISTS (SELECT 1 FROM main.folios_banco v WHERE v.ref = ${ref} AND v.estado = 'vigente');`;
  const sucLead = id => `(SELECT sucursal_id FROM main.leads WHERE id = ${id})`, sucCxp = id => `(SELECT sucursal_id FROM main.cuentas_por_pagar WHERE id = ${id})`;
  const cobro = `cuenta_folio(NEW.cuenta_id, NULL, ${sucLead('NEW.lead_id')})`;
  const disparadores = [
    ['folio_cobro_ins', 'AFTER INSERT ON main.cobros', "NEW.confirmado = 1 AND NEW.cancelado = 0 AND NEW.tipo <> 'ajuste'", nuevoFolio("'I'", "'cobro:' || NEW.id", cobro, 'NEW.fecha', 'NEW.monto_cent', "'Cobro'")],
    ['folio_cobro_upd', 'AFTER UPDATE ON main.cobros', "NEW.confirmado = 1 AND NEW.cancelado = 0 AND NEW.tipo <> 'ajuste' AND (OLD.confirmado = 0 OR NEW.cuenta_id IS NOT OLD.cuenta_id)",
      nuevoFolio("'I'", "'cobro:' || NEW.id", cobro, 'NEW.fecha', 'NEW.monto_cent', "'Cobro'")],
    ['folio_pago_ins', 'AFTER INSERT ON main.pagos_proveedor', "NEW.metodo <> 'anticipo' AND NEW.cancelado = 0",
      nuevoFolio("'E'", "'pago:' || NEW.id", `cuenta_folio(NEW.cuenta_id, NEW.cuenta_origen, ${sucCxp('NEW.cxp_id')})`, 'NEW.fecha', 'NEW.monto_cent', "(SELECT concepto FROM main.cuentas_por_pagar WHERE id = NEW.cxp_id)")],
  ];
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'anticipos'").get()) disparadores.push(
    ['folio_anticipo_ins', 'AFTER INSERT ON main.anticipos', '1', nuevoFolio("'E'", "'anticipo:' || NEW.id", 'cuenta_folio(NEW.cuenta_id, NEW.cuenta_origen, NEW.sucursal_id)', 'NEW.fecha', 'NEW.monto_cent', "'Anticipo: ' || NEW.motivo")],
    ['folio_reintegro_upd', 'AFTER UPDATE ON main.anticipos', 'NEW.reintegro_cent > 0 AND OLD.reintegro_cent = 0',
      nuevoFolio("'I'", "'reintegro:' || NEW.id", 'cuenta_folio(NEW.reintegro_cuenta_id, NEW.reintegro_cuenta, NEW.sucursal_id)', 'NEW.reintegro_fecha', 'NEW.reintegro_cent', "'Reintegro de anticipo'")]);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'flujo_movimientos'").get()) disparadores.push(
    ['folio_movimiento_ins', 'AFTER INSERT ON main.flujo_movimientos', 'NEW.cuenta_id > 0',
      nuevoFolio("CASE NEW.tipo WHEN 'ingreso' THEN 'I' ELSE 'E' END", "'manual:' || NEW.id", 'cuenta_folio(NEW.cuenta_id, NULL, NEW.sucursal_id)', 'NEW.fecha', 'NEW.monto_cent', 'NEW.concepto')]);
  for (const [nombre, cuando, condicion, cuerpo] of disparadores) {
    db.exec(`DROP TRIGGER IF EXISTS temp.${nombre}`);
    db.exec(`CREATE TEMP TRIGGER ${nombre} ${cuando} FOR EACH ROW WHEN ${condicion} BEGIN ${cuerpo} END`);
  }

  // ---------- Para las rutas ----------
  // La cuenta elegida al registrar dinero. Si la sucursal ya tiene cuentas con clave de folio, elegirla es obligatorio
  // (sin ella no hay folio); si todavía no tiene, se registra como antes (sin folio, y el flujo lo avisa).
  function resolver(suc, cuentaId, { requerida = true } = {}) {
    const ok = conClave(suc);
    if (cuentaId === undefined || cuentaId === null || cuentaId === '' || Number(cuentaId) === 0) {
      if (requerida && ok.length) return { error: 'Elige la cuenta de banco (de dónde salió o a dónde entró el dinero): con ella se le pone su folio', codigo: 'FALTA_CUENTA' };
      return { id: null, nombre: null };
    }
    const c = cuenta(cuentaId);
    if (!c || c.sucursal_id !== suc) return { error: 'Esa cuenta de banco no es de la sucursal del movimiento' };
    return { id: c.id, nombre: c.nombre };
  }
  const vigente = ref => db.prepare("SELECT * FROM main.folios_banco WHERE ref = ? AND estado = 'vigente'").get(ref);
  // Folio nuevo desde aquí (cuenta corregida o «Asignar folios pendientes»): la misma serie y numeración que en la base.
  const siguiente = (c, tipo) => { const num = db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 n FROM main.folios_banco WHERE cuenta_id = ? AND tipo = ?').get(c.id, tipo).n; return { num, folio: `${c.clave_folio}-${tipo}-${String(num).padStart(4, '0')}` }; };
  const insertar = (req, c, tipo, s, ref, fecha, monto, concepto) => db.prepare('INSERT INTO main.folios_banco (cuenta_id, tipo, numero, folio, ref, fecha_mov, monto_cent, concepto, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, tipo, s.num, s.folio, ref, fecha, monto, concepto || null, req?.usuarioSesion?.id ?? null);
  function asignar(req, ref, cuentaId, tipo, fecha, monto, concepto) {
    const v = vigente(ref); if (v) return v.folio;
    const c = cuenta(cuentaId); if (!c?.clave_folio) return null;
    const s = siguiente(c, tipo); insertar(req, c, tipo, s, ref, fecha, monto, concepto); return s.folio;
  }
  // La cuenta de un movimiento cambió: el folio viejo deja de estar vigente (reasignado al nuevo, o «sin cuenta») y, si la
  // cuenta nueva tiene clave, recibe el siguiente folio de esa cuenta.
  function reasignar(req, ref, cuentaNueva, tipo, fecha, monto, concepto) {
    const v = vigente(ref), c = Number(cuentaNueva) ? cuenta(cuentaNueva) : null;
    if (v && c && v.cuenta_id === c.id) return v.folio;
    if (!v) return c ? asignar(req, ref, c.id, tipo, fecha, monto, concepto) : null;
    const s = c?.clave_folio ? siguiente(c, tipo) : null;
    db.prepare("UPDATE main.folios_banco SET estado = ?, reasignado_a = ?, cambio_usuario_id = ?, cambio_at = datetime('now','localtime') WHERE id = ?").run(s ? 'reasignado' : 'sin_cuenta', s?.folio ?? null, req?.usuarioSesion?.id ?? null, v.id);
    if (s) insertar(req, c, tipo, s, ref, fecha, monto, concepto);
    app.locals.auditoria?.registrar(req, 'contabilidad', null, 'folio reasignado', `${v.folio} → ${s?.folio || 'sin cuenta (sin folio)'}`);
    return s?.folio ?? null;
  }
  app.locals.folios = { resolver, vigente, asignar, reasignar, conClave };

  // ---------- Rutas ----------
  // Las cuentas para elegir al registrar dinero (quien paga, cobra, confirma, prepara nómina o lleva la contabilidad).
  const puedeVerCuentas = req => P.direccion(req) || ['dinero.mover', 'cobros.confirmar', 'cobros.directo', 'contabilidad.ver', 'nomina.preparar'].some(k => P.puede(req, k));
  app.get('/api/cuentas-banco', h((req, res) => {
    if (!puedeVerCuentas(req)) return res.status(403).json({ error: 'No tienes permiso para esta sección' });
    const ids = [...(req.alcanceSuc?.ids || [])], suc = req.query.sucursal ? Number(req.query.sucursal) : null;
    if (suc && !ids.includes(suc)) return res.status(404).json({ error: 'No encontrado' });
    const filas = db.prepare('SELECT id, nombre, banco, terminacion, clave_folio, sucursal_id FROM main.cuentas_banco WHERE activa = 1 ORDER BY sucursal_id, id').all().filter(c => (suc ? c.sucursal_id === suc : ids.includes(c.sucursal_id)));
    res.json({ cuentas: filas, requiere: filas.some(c => c.clave_folio) });
  }));
  // Poner la clave de folio de una cuenta (STD, BNT, PAG, CAJ…): Dirección y quien lleva la contabilidad; única en todo el
  // sistema; no se cambia cuando la cuenta ya tiene folios (cambiaría lo que ya se anotó en papeles).
  app.post('/api/cuentas-banco/:id/clave', h((req, res) => {
    if (!(P.direccion(req) || P.puede(req, 'contabilidad.ver'))) return res.status(403).json({ error: 'La clave de folio la ponen Dirección y quien tenga «Contabilidad del mes»' });
    const c = db.prepare('SELECT * FROM main.cuentas_banco WHERE id = ? AND en_alcance(sucursal_id)').get(Number(req.params.id) || 0);
    if (!c) return res.status(404).json({ error: 'No se encontró la cuenta' });
    const clave = String(req.body?.clave ?? '').trim().toUpperCase();
    if (!CLAVE.test(clave)) return res.status(400).json({ error: 'La clave va en cada folio: de 2 a 6 letras o números, sin espacios (por ejemplo STD, BNT, PAG o CAJ)' });
    if (c.clave_folio === clave) return res.json({ ok: true });
    if (db.prepare('SELECT 1 FROM main.folios_banco WHERE cuenta_id = ? LIMIT 1').get(c.id)) return res.status(409).json({ error: `La cuenta ya tiene folios con la clave ${c.clave_folio}: no se cambia` });
    if (db.prepare('SELECT 1 FROM main.cuentas_banco WHERE clave_folio = ? AND id <> ?').get(clave, c.id)) return res.status(409).json({ error: `La clave ${clave} ya es de otra cuenta` });
    db.prepare('UPDATE main.cuentas_banco SET clave_folio = ? WHERE id = ?').run(clave, c.id);
    app.locals.auditoria?.registrar(req, 'conciliacion', c.id, 'clave de folio', `${c.nombre}: ${c.clave_folio || '(sin clave)'} → ${clave}`);
    res.json({ ok: true });
  }));
};
module.exports.CLAVE = CLAVE;
