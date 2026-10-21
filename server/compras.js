// Órdenes de compra (formato CM-F-03): se capturan como borrador, un administrador las autoriza y en
// ese momento pasan a Cuentas por pagar como factura pendiente del proveedor. También se pueden cancelar
// (si la cuenta por pagar aún no tiene pagos). Incluye los catálogos de centros de costo (los edita un
// administrador) y de unidades de medida (las edita cualquier usuario).
const Importes = require('../public/importes.js');
const { hoyMexico } = require('./fechas');

const CENTROS_INICIALES = [['Mantenimiento', 'Isaac Hernandez'], ['Operaciones', 'Noe Gomez'], ['Subdireccion', 'Luis Perea'], ['Dirección', 'Miguel Perea'],
  ['Compras', 'Marco Herrera'], ['Administración', 'Helena'], ['RH', 'Marco Herrera'], ['Ventas', 'Evelyn Perea']];
const UNIDADES_INICIALES = [['PZA', 'Pieza'], ['L', 'Litro'], ['M', 'Metro'], ['M2', 'Metro cuadrado'], ['M3', 'Metro cúbico'], ['KG', 'Kilogramo'],
  ['TON', 'Tonelada'], ['GAL', 'Galón'], ['CJA', 'Caja'], ['PAQ', 'Paquete'], ['JGO', 'Juego'], ['ROL', 'Rollo'], ['BTO', 'Bulto'], ['LOTE', 'Lote'],
  ['SERV', 'Servicio'], ['HR', 'Hora'], ['DÍA', 'Día'], ['VJE', 'Viaje']];
const fechaOk = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f + 'T00:00:00Z')) && new Date(f + 'T00:00:00Z').toISOString().slice(0, 10) === f;
const sumarDias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + (Number(d) || 0)); return x.toISOString().slice(0, 10); };
const texto = (v, max) => { if (v === undefined || v === null) return null; const t = String(v).trim(); return t ? t.slice(0, max) : null; };
// Compara nombres sin importar mayúsculas, acentos ni espacios de más (lower() de SQLite no cambia «É» → «é»).
const llaveNombre = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Número escrito como número: «1500», «1,500.50», «$ 1,500». Nada de «0x10», «1e3», «Infinity» ni texto.
const numeroEscrito = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const t = v.trim().replace(/^\$\s*/, '');
  return /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, '')) : NaN;
};
const pesos = c => Math.round(Number(c || 0)) / 100;
const { folioSol } = require('./solicitudes');
const folioOC = o => require('./sucursales').folio('OC', 'ordenes_compra', o.id, o.created_at);

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS centros_costo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE CHECK(length(trim(nombre)) BETWEEN 1 AND 80),
      responsable TEXT,
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      orden INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ordenes_compra (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
      centro_id INTEGER NOT NULL REFERENCES centros_costo(id),
      categoria TEXT NOT NULL,
      lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
      fecha TEXT NOT NULL CHECK(length(fecha) = 10 AND date(fecha, '+0 days') = fecha),
      fecha_requerida TEXT CHECK(fecha_requerida IS NULL OR (length(fecha_requerida) = 10 AND date(fecha_requerida, '+0 days') = fecha_requerida)),
      entrega TEXT, factura_a TEXT, nota TEXT, observaciones TEXT,
      partidas_json TEXT NOT NULL,
      iva_modo TEXT NOT NULL CHECK(iva_modo IN ('mas_iva', 'incluido', 'sin_iva')),
      iva_tasa REAL NOT NULL,
      subtotal_cent INTEGER NOT NULL, iva_cent INTEGER NOT NULL,
      total_cent INTEGER NOT NULL CHECK(typeof(total_cent) = 'integer' AND total_cent > 0),
      solicitante_nombre TEXT, solicitante_cargo TEXT,
      estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador', 'autorizada', 'cancelada')),
      cxp_id INTEGER REFERENCES cuentas_por_pagar(id),
      autorizada_por INTEGER REFERENCES usuarios(id), autorizada_at TEXT,
      cancelada_por INTEGER REFERENCES usuarios(id), cancelada_at TEXT, motivo_cancelacion TEXT,
      creado_por INTEGER NOT NULL REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_oc_estado ON ordenes_compra(estado, fecha);
    CREATE TABLE IF NOT EXISTS unidades_medida (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clave TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(clave)) BETWEEN 1 AND 10),
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 40),
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      orden INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Solicitud de compra de la que salió la orden, y la recepción (cuando llega lo comprado).
  const cols = db.prepare('PRAGMA table_info(ordenes_compra)').all().map(c => c.name);
  for (const [c, t] of [['motivo_diferencia', 'TEXT'], ['solicitud_id', 'INTEGER'], ['recibida_at', 'TEXT'], ['recibida_por', 'INTEGER'], ['recibida_por_nombre', 'TEXT'], ['recibio_nombre', 'TEXT'], ['recepcion_nota', 'TEXT']])
    if (!cols.includes(c)) db.exec(`ALTER TABLE ordenes_compra ADD COLUMN ${c} ${t}`);
  // Días de crédito de CADA compra: se escriben al autorizarla (no se toman solos del proveedor).
  if (!db.prepare('PRAGMA table_info(cuentas_por_pagar)').all().some(c => c.name === 'dias_credito')) db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN dias_credito INTEGER');
  if (!db.prepare('SELECT COUNT(*) n FROM unidades_medida').get().n) {
    const ins = db.prepare('INSERT INTO unidades_medida (clave, nombre, orden) VALUES (?, ?, ?)');
    db.transaction(() => UNIDADES_INICIALES.forEach(([c, n], i) => ins.run(c, n, i + 1)))();
  }
  if (!db.prepare('SELECT COUNT(*) n FROM centros_costo').get().n) {
    const ins = db.prepare('INSERT INTO centros_costo (nombre, responsable, orden) VALUES (?, ?, ?)');
    db.transaction(() => CENTROS_INICIALES.forEach(([n, r], i) => ins.run(n, r, i + 1)))();
  }
}

module.exports = function compras(app, db, h, finanzas) {
  migrar(db);
  const P = app.locals.permisos;
  // Autorizar órdenes (se vuelven deuda), cancelar autorizadas o recibidas y quitar sus documentos.
  const esAdmin = req => P.puede(req, 'compras.autorizar');
  // Gestionar compras (al inicio: encargado de centro de costos y administración): aprueban solicitudes, eligen
  // cotización, crean y corrigen órdenes de compra y marcan cuando llega lo comprado.
  const esCostos = req => P.puede(req, 'compras.gestionar');
  const SOLO_COSTOS = { error: 'Las órdenes de compra las hace el encargado de centro de costos o administración. Si necesitas algo, haz una Solicitud de compra.' };
  const CATEGORIAS = finanzas.CATEGORIAS, conSentido = finanzas.conSentido;

  const SQL_OC = `SELECT o.*, p.nombre AS proveedor_nombre, p.rfc AS proveedor_rfc, p.dias_credito AS proveedor_credito, c.nombre AS centro_nombre, c.responsable AS centro_responsable,
      u.nombre AS creado_por_nombre, ua.nombre AS autorizada_por_nombre,
      (SELECT created_at FROM main.leads l WHERE l.id = o.lead_id) AS lead_created_at,
      (SELECT created_at FROM solicitudes_compra s WHERE s.id = o.solicitud_id) AS solicitud_created_at,
      (SELECT excepcion_motivo FROM solicitudes_compra s WHERE s.id = o.solicitud_id) AS excepcion_motivo,
      (SELECT COALESCE(SUM(g.monto_cent), 0) FROM pagos_proveedor g WHERE g.cxp_id = o.cxp_id AND g.cancelado = 0) AS pagado_cent
    FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id JOIN centros_costo c ON c.id = o.centro_id
    LEFT JOIN usuarios u ON u.id = o.creado_por LEFT JOIN usuarios ua ON ua.id = o.autorizada_por`;
  const describir = o => {
    let partidas; try { partidas = JSON.parse(o.partidas_json); } catch { partidas = []; }
    return { ...o, folio: folioOC(o), partidas, subtotal: pesos(o.subtotal_cent), iva: pesos(o.iva_cent), total: pesos(o.total_cent), pagado: pesos(o.pagado_cent),
      saldo: o.estado === 'autorizada' ? pesos(o.total_cent - o.pagado_cent) : null, categoria_nombre: CATEGORIAS[o.categoria] || o.categoria,
      solicitud_folio: o.solicitud_id ? folioSol({ id: o.solicitud_id, created_at: o.solicitud_created_at }) : null,
      orden_folio: o.lead_id ? require('./sucursales').folio('OS', 'leads', o.lead_id, o.lead_created_at) : null };
  };
  const leer = id => { const o = db.prepare(SQL_OC + ' WHERE o.id = ?').get(id); return o ? describir(o) : null; };
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'orden_compra', id, accion, detalle);
  const fmt = c => '$' + (Number(c || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const expediente = require('./expediente-oc')(app, db, h, { leer, esAdmin, folioOC });
  const Sol = require('./solicitudes')(app, db, h, { texto, fechaOk, hoyMexico, conSentido, folioOC, agregarDocumentoOC: expediente.agregarDocumento });

  // ----- Código del formato (CM-F-03). Es del FORMATO, no de cada orden; lo cambia un administrador y queda en
  // la bitácora. (La revisión y sus fechas se quitaron: confundían con la fecha de la orden.) -----
  const FORMATO_INICIAL = { codigo: 'CM-F-03' };
  const formato = () => { const f = db.prepare("SELECT valor FROM config_servidor WHERE clave = 'formato_oc'").get(); let g = {}; try { g = f ? JSON.parse(f.valor) : {}; } catch { g = {}; } return { codigo: g.codigo || FORMATO_INICIAL.codigo }; };
  app.get('/api/compras/formato', h((req, res) => res.json(formato())));
  app.put('/api/compras/formato', h((req, res) => {
    if (!P.direccion(req)) return res.status(403).json({ error: 'Los datos del formato los cambia Dirección' });
    const antes = formato(), b = req.body || {};
    const nuevo = { codigo: texto(b.codigo, 20) || antes.codigo };
    if (!/^[\p{L}\d .\/-]{1,20}$/u.test(nuevo.codigo)) return res.status(400).json({ error: 'El código del formato solo lleva letras, números y guiones' });
    db.prepare("INSERT INTO config_servidor (clave, valor) VALUES ('formato_oc', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(nuevo));
    const cambios = Object.keys(nuevo).filter(k => String(nuevo[k]) !== String(antes[k])).map(k => `${k.replace('_', ' ')}: ${antes[k]} → ${nuevo[k]}`).join(' · ');
    if (cambios) app.locals.auditoria?.registrar(req, 'catalogo', null, 'formato de orden de compra', cambios);
    res.json(nuevo);
  }));

  // Valida y calcula una orden (crear o editar). Devuelve { error } o { datos }.
  function validar(b, usuario) {
    const prov = db.prepare('SELECT * FROM proveedores WHERE id = ? AND activo = 1').get(b.proveedor_id);
    if (!prov) return { error: 'Elige el proveedor' };
    const centro = db.prepare('SELECT * FROM centros_costo WHERE id = ? AND activo = 1').get(b.centro_id);
    if (!centro) return { error: 'Elige el centro de costos' };
    const categoria = b.categoria || prov.categoria;
    if (!finanzas.categoriaActiva(categoria)) return { error: CATEGORIAS[categoria] ? `La categoría «${CATEGORIAS[categoria]}» está dada de baja: elige otra` : 'Elige la categoría del gasto' };
    let leadId = null;
    if (b.lead_id) {
      const l = require('./finanzas').ordenParaLigar(b.lead_id);
      if (!l) return { error: 'La orden de servicio relacionada no existe' };
      leadId = l.id;
    }
    const fecha = b.fecha || hoyMexico();
    if (!fechaOk(fecha)) return { error: 'La fecha no es válida' };
    if (fecha > sumarDias(hoyMexico(), 31)) return { error: 'La fecha de la orden está a más de un mes en el futuro: revisa el año' };
    const requerida = b.fecha_requerida || null;
    if (requerida && (!fechaOk(requerida) || requerida < fecha)) return { error: 'La fecha requerida no puede ser antes de la fecha de la orden' };
    if (!Importes.MODOS.includes(b.iva_modo)) return { error: 'Indica el IVA: más IVA, IVA incluido o sin IVA' };
    const tasa = Importes.tasaDe(b.iva_modo, Importes.TASA_DEFAULT);
    let lista = b.partidas;
    if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch { lista = null; } }
    if (!Array.isArray(lista) || !lista.length || lista.length > 100) return { error: 'Agrega de 1 a 100 partidas' };
    const partidas = [];
    for (const [i, p] of lista.entries()) {
      const r = `Partida ${i + 1}: `;
      const descripcion = texto(p && p.descripcion, 300);
      if (!descripcion || !conSentido(descripcion, 2)) return { error: r + 'escribe la descripción (qué se compra)' };
      // La unidad, si viene, debe ser una del catálogo (se guarda con su abreviatura oficial: «pza» → «PZA»).
      let unidad = null;
      if (p.unidad !== undefined && p.unidad !== null && String(p.unidad).trim()) {
        const u = db.prepare('SELECT clave FROM unidades_medida WHERE clave = ? COLLATE NOCASE').get(String(p.unidad).trim());
        if (!u) return { error: r + `la unidad «${String(p.unidad).slice(0, 15)}» no está en el catálogo de unidades (agrégala primero)` };
        unidad = u.clave;
      }
      const cantidad = numeroEscrito(p.cantidad);
      if (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1e6 || Math.round(cantidad * 1000) !== cantidad * 1000) return { error: r + 'la cantidad debe ser mayor a 0 (hasta 3 decimales)' };
      const precio = numeroEscrito(p.precio);
      if (typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0 || precio > 1e9 || Math.abs(precio * 100 - Math.round(precio * 100)) > 1e-6) return { error: r + 'el precio debe ser mayor a $0 (máximo 2 decimales)' };
      partidas.push({ cantidad, descripcion, unidad, clave: texto(p.clave, 60), precio, importe: Importes.importeDe(cantidad, precio) });
    }
    const r = Importes.calcular(partidas, b.iva_modo, tasa);
    if (!(r.total_cent > 0)) return { error: 'El total debe ser mayor a $0' };
    if (r.total_cent > Importes.TOPE_CENT) return { error: 'El total no puede pasar de $100,000,000.00' };
    return { datos: { proveedor_id: prov.id, centro_id: centro.id, categoria, lead_id: leadId, fecha, fecha_requerida: requerida,
      entrega: null, factura_a: texto(b.factura_a, 120) || 'SANEADREN', nota: texto(b.nota, 500), observaciones: texto(b.observaciones, 2000),
      partidas_json: JSON.stringify(partidas), iva_modo: b.iva_modo, iva_tasa: tasa, subtotal_cent: r.subtotal_cent, iva_cent: r.iva_cent, total_cent: r.total_cent,
      solicitante_nombre: texto(b.solicitante_nombre, 120) || usuario.nombre, solicitante_cargo: texto(b.solicitante_cargo, 120) } };
  }

  // ----- Centros de costo -----
  app.get('/api/compras/centros', h((req, res) => {
    res.json(db.prepare('SELECT * FROM centros_costo ORDER BY activo DESC, orden, nombre').all());
  }));
  // Cualquier usuario agrega, corrige o elimina centros de costo. Eliminar lo quita de la lista para órdenes
  // nuevas (las órdenes que ya lo usan no cambian); si se vuelve a agregar con el mismo nombre, regresa.
  const nombreValido = n => n && conSentido(n, 2) && !/[<>{}]/.test(n);
  app.post('/api/compras/centros', h((req, res) => {
    const nombre = texto(req.body.nombre, 80);
    if (!nombreValido(nombre)) return res.status(400).json({ error: 'Escribe el nombre del centro de costos' });
    const ya = db.prepare('SELECT * FROM centros_costo ORDER BY activo DESC').all().find(c => llaveNombre(c.nombre) === llaveNombre(nombre));
    if (ya && ya.activo) return res.status(409).json({ error: `Ya existe el centro de costos «${ya.nombre}»` });
    if (ya) {
      db.prepare('UPDATE centros_costo SET activo = 1, responsable = COALESCE(?, responsable) WHERE id = ?').run(texto(req.body.responsable, 120), ya.id);
      app.locals.auditoria?.registrar(req, 'catalogo', null, 'centro de costos agregado', `${ya.nombre} (se recuperó el que estaba eliminado)`);
      return res.status(201).json(db.prepare('SELECT * FROM centros_costo WHERE id = ?').get(ya.id));
    }
    const orden = db.prepare('SELECT COALESCE(MAX(orden), 0) + 1 o FROM centros_costo').get().o;
    const info = db.prepare('INSERT INTO centros_costo (nombre, responsable, orden) VALUES (?, ?, ?)').run(nombre, texto(req.body.responsable, 120), orden);
    app.locals.auditoria?.registrar(req, 'catalogo', null, 'centro de costos agregado', nombre + (texto(req.body.responsable, 120) ? ' · ' + texto(req.body.responsable, 120) : ''));
    res.status(201).json(db.prepare('SELECT * FROM centros_costo WHERE id = ?').get(info.lastInsertRowid));
  }));
  app.put('/api/compras/centros/:id', h((req, res) => {
    const c = db.prepare('SELECT * FROM centros_costo WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Centro de costos no encontrado' });
    const nombre = req.body.nombre === undefined ? c.nombre : texto(req.body.nombre, 80);
    if (!nombreValido(nombre)) return res.status(400).json({ error: 'Escribe el nombre del centro de costos' });
    if (db.prepare('SELECT nombre FROM centros_costo WHERE id <> ?').all(c.id).some(x => llaveNombre(x.nombre) === llaveNombre(nombre))) return res.status(409).json({ error: 'Ya existe ese centro de costos' });
    const responsable = req.body.responsable === undefined ? c.responsable : texto(req.body.responsable, 120);
    const activo = req.body.activo === undefined ? c.activo : (req.body.activo ? 1 : 0);
    db.prepare('UPDATE centros_costo SET nombre = ?, responsable = ?, activo = ? WHERE id = ?').run(nombre, responsable, activo, c.id);
    const difCentro = app.locals.auditoria?.diferencias(c, { nombre, responsable, activo }, ['nombre', 'responsable', 'activo']);
    if (difCentro) app.locals.auditoria.registrar(req, 'catalogo', null, 'centro de costos editado', `«${c.nombre}»: ${difCentro}`);
    res.json(db.prepare('SELECT * FROM centros_costo WHERE id = ?').get(c.id));
  }));

  app.delete('/api/compras/centros/:id', h((req, res) => {
    const c = db.prepare('SELECT * FROM centros_costo WHERE id = ? AND activo = 1').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Centro de costos no encontrado' });
    if (db.prepare('SELECT COUNT(*) n FROM centros_costo WHERE activo = 1').get().n <= 1) return res.status(400).json({ error: 'Debe quedar al menos un centro de costos' });
    db.prepare('UPDATE centros_costo SET activo = 0 WHERE id = ?').run(c.id);
    const usos = db.prepare("SELECT COUNT(*) n FROM ordenes_compra WHERE centro_id = ?").get(c.id).n;
    app.locals.auditoria?.registrar(req, 'catalogo', null, 'centro de costos eliminado', `${c.nombre}${usos ? ` (lo usan ${usos} órdenes, que no cambian)` : ''}`);
    res.json({ ok: true, usos });
  }));

  // ----- Unidades de medida (cualquier usuario las agrega o corrige; no se borran, se dan de baja) -----
  const leerUnidad = id => db.prepare('SELECT * FROM unidades_medida WHERE id = ?').get(id);
  function datosUnidad(b, actual) {
    const clave = b.clave === undefined && actual ? actual.clave : texto(b.clave, 10)?.toUpperCase();
    const nombre = b.nombre === undefined && actual ? actual.nombre : texto(b.nombre, 40);
    if (!clave) return { error: 'Escribe la abreviatura de la unidad (ej. PZA)' };
    if (!nombre) return { error: 'Escribe el nombre de la unidad (ej. Pieza)' };
    if (!/^[\p{L}\d ./²³-]+$/u.test(clave)) return { error: 'La abreviatura solo lleva letras, números, punto, guion o diagonal' };
    if (db.prepare('SELECT 1 FROM unidades_medida WHERE clave = ? COLLATE NOCASE AND id <> ?').get(clave, actual?.id || 0)) return { error: 'Ya existe una unidad con la abreviatura ' + clave };
    if (db.prepare('SELECT nombre FROM unidades_medida WHERE id <> ?').all(actual?.id || 0).some(x => llaveNombre(x.nombre) === llaveNombre(nombre))) return { error: 'Ya existe la unidad ' + nombre };
    return { clave, nombre };
  }
  app.get('/api/compras/unidades', h((req, res) => {
    res.json(db.prepare('SELECT * FROM unidades_medida ORDER BY activo DESC, orden, nombre').all());
  }));
  app.post('/api/compras/unidades', h((req, res) => {
    const bClave = llaveNombre(texto(req.body?.clave, 10)), bNombre = llaveNombre(texto(req.body?.nombre, 40));
    const baja = db.prepare('SELECT * FROM unidades_medida WHERE activo = 0').all().find(u => (bClave && llaveNombre(u.clave) === bClave) || (bNombre && llaveNombre(u.nombre) === bNombre));
    if (baja) { db.prepare('UPDATE unidades_medida SET activo = 1 WHERE id = ?').run(baja.id); app.locals.auditoria?.registrar(req, 'catalogo', null, 'unidad agregada', `${baja.nombre} (${baja.clave}) · se recuperó la que estaba eliminada`); return res.status(201).json(leerUnidad(baja.id)); }
    const d = datosUnidad(req.body || {});
    if (d.error) return res.status(400).json({ error: d.error });
    const orden = db.prepare('SELECT COALESCE(MAX(orden), 0) + 1 o FROM unidades_medida').get().o;
    const info = db.prepare('INSERT INTO unidades_medida (clave, nombre, orden) VALUES (?, ?, ?)').run(d.clave, d.nombre, orden);
    app.locals.auditoria?.registrar(req, 'catalogo', null, 'unidad agregada', `${d.nombre} (${d.clave})`);
    res.status(201).json(leerUnidad(info.lastInsertRowid));
  }));
  app.delete('/api/compras/unidades/:id', h((req, res) => {
    const u = db.prepare('SELECT * FROM unidades_medida WHERE id = ? AND activo = 1').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Unidad no encontrada' });
    db.prepare('UPDATE unidades_medida SET activo = 0 WHERE id = ?').run(u.id);
    app.locals.auditoria?.registrar(req, 'catalogo', null, 'unidad eliminada', `${u.nombre} (${u.clave})`);
    res.json({ ok: true });
  }));
  app.put('/api/compras/unidades/:id', h((req, res) => {
    const u = leerUnidad(req.params.id);
    if (!u) return res.status(404).json({ error: 'Unidad no encontrada' });
    const d = datosUnidad(req.body || {}, u);
    if (d.error) return res.status(400).json({ error: d.error });
    const activo = req.body.activo === undefined ? u.activo : (req.body.activo ? 1 : 0);
    db.prepare('UPDATE unidades_medida SET clave = ?, nombre = ?, activo = ? WHERE id = ?').run(d.clave, d.nombre, activo, u.id);
    const difUni = app.locals.auditoria?.diferencias(u, { clave: d.clave, nombre: d.nombre, activo }, ['clave', 'nombre', 'activo']);
    if (difUni) app.locals.auditoria.registrar(req, 'catalogo', null, 'unidad editada', `«${u.nombre}»: ${difUni}`);
    res.json(leerUnidad(u.id));
  }));

  // ----- Órdenes de compra -----
  // Avisos para Inicio (bloque «Compras»), según lo que hace cada quien y lo que ve (vistas de la base):
  //  · quien gestiona compras: solicitudes por aprobar (las propias solo con «aprobar sus propias»), por cotizar y
  //    con cotización elegida sin orden; órdenes autorizadas por recibir (rojo si ya pasó la fecha requerida);
  //  · quien autoriza: órdenes de compra en borrador por autorizar;
  //  · quien pidió: en qué va cada una de sus solicitudes abiertas.
  app.get('/api/compras/avisos', h((req, res) => {
    if (!P.puede(req, 'compras.ver')) return res.status(403).json({ error: 'Tu rol no ve compras' });
    const yo = req.usuarioSesion.id, hoy = hoyMexico(), gestiona = P.puede(req, 'compras.gestionar'), autoriza = P.puede(req, 'compras.autorizar'), propias = P.puede(req, 'compras.aprobar_propias');
    const dma = f => String(f).slice(0, 10).split('-').reverse().join('/'), avisos = [];
    const EST = { por_aprobar: 'por aprobar', cotizando: 'buscando cotizaciones', elegida: 'cotización elegida, falta la orden de compra' };
    for (const s of db.prepare(`SELECT s.*, (SELECT COUNT(DISTINCT d.proveedor_id) FROM documentos_solicitud d WHERE d.solicitud_id = s.id AND d.tipo = 'cotizacion' AND d.eliminado = 0) AS cots
      FROM solicitudes_compra s WHERE s.estado IN ('por_aprobar', 'cotizando', 'elegida') ORDER BY s.urgente DESC, s.created_at`).all()) {
      const base = { solicitud_id: s.id, folio: folioSol(s), nombre: s.que, fecha: s.fecha_requerida || String(s.created_at).slice(0, 10) };
      const tarde = s.fecha_requerida && s.fecha_requerida < hoy;
      if (gestiona && s.estado === 'por_aprobar' && (propias || s.solicitante_id !== yo)) avisos.push({ ...base, tipo: 'por_aprobar', nivel: s.urgente || tarde ? 'rojo' : 'amarillo', texto: `Por aprobar · la pidió ${s.solicitante_nombre}${s.urgente ? ' · URGENTE' : ''}` });
      else if (gestiona && s.estado === 'cotizando') avisos.push({ ...base, tipo: 'cotizar', nivel: s.urgente || tarde ? 'rojo' : 'amarillo', texto: `Faltan cotizaciones (${s.cots} de 3)${s.urgente ? ' · URGENTE' : ''}` });
      else if (gestiona && s.estado === 'elegida') avisos.push({ ...base, tipo: 'hacer_oc', nivel: tarde ? 'rojo' : 'amarillo', texto: 'Cotización elegida: falta hacer la orden de compra' });
      else if (s.solicitante_id === yo) avisos.push({ ...base, tipo: 'mi_solicitud', nivel: 'azul', texto: 'Tu solicitud va: ' + EST[s.estado] });
    }
    for (const o of db.prepare(`SELECT o.*, p.nombre AS proveedor FROM ordenes_compra o LEFT JOIN proveedores p ON p.id = o.proveedor_id
      WHERE (o.estado = 'borrador') OR (o.estado = 'autorizada' AND o.recibida_at IS NULL) ORDER BY COALESCE(o.fecha_requerida, o.fecha)`).all()) {
      const tarde = o.fecha_requerida && o.fecha_requerida < hoy, total = '$' + (o.total_cent / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 });
      if (o.estado === 'borrador' && autoriza) avisos.push({ tipo: 'por_autorizar', nivel: tarde ? 'rojo' : 'amarillo', oc_id: o.id, folio: folioOC(o), nombre: o.proveedor, fecha: o.fecha_requerida || o.fecha, texto: `Por autorizar · ${total}` });
      if (o.estado === 'autorizada' && gestiona) avisos.push({ tipo: 'por_recibir', nivel: tarde ? 'rojo' : 'azul', oc_id: o.id, folio: folioOC(o), nombre: o.proveedor, fecha: o.fecha_requerida || o.fecha, texto: tarde ? `Por recibir · se requería el ${dma(o.fecha_requerida)}` : 'Autorizada, por recibir' });
    }
    const peso = { rojo: 0, amarillo: 1, azul: 2 };
    res.json(avisos.sort((a, b) => peso[a.nivel] - peso[b.nivel] || String(a.fecha).localeCompare(String(b.fecha))));
  }));
  app.get('/api/compras/ordenes', h((req, res) => {
    const estado = String(req.query.estado || '');
    let filas = db.prepare(SQL_OC + ' ORDER BY o.fecha DESC, o.id DESC').all().map(describir);
    if (['borrador', 'autorizada', 'cancelada'].includes(estado)) filas = filas.filter(o => o.estado === estado);
    else if (estado === 'pendiente_pago') filas = filas.filter(o => o.estado === 'autorizada' && o.saldo > 0);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) filas = filas.filter(o => [o.folio, o.solicitud_folio, o.orden_folio, o.factura_folio, o.proveedor_nombre, o.centro_nombre, o.nota, o.observaciones, o.solicitante_nombre, ...o.partidas.map(p => p.descripcion)]
      .some(v => String(v || '').toLowerCase().includes(q)));
    res.json(filas);
  }));
  app.get('/api/compras/ordenes/:id', h((req, res) => {
    const o = leer(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    res.json(o);
  }));
  app.post('/api/compras/ordenes', h((req, res) => {
    if (!esCostos(req)) return res.status(403).json(SOLO_COSTOS);
    // Desde una solicitud: debe tener cotización elegida y la orden va con ese proveedor.
    let desde = null;
    if (req.body?.solicitud_id) {
      desde = Sol.paraOrden(Number(req.body.solicitud_id));
      if (desde.error) return res.status(desde.status).json({ error: desde.error });
      if (Number(req.body.proveedor_id) !== desde.ganadora.proveedor_id) return res.status(400).json({ error: `El proveedor debe ser el de la cotización elegida (${desde.ganadora.proveedor_nombre})` });
    }
    const v = validar(req.body || {}, req.usuarioSesion);
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.datos;
    // La misma orden capturada dos veces (doble clic o se volvió a capturar): se pregunta antes de crear otra.
    // Por más de lo cotizado (más de $1 de diferencia): se escribe por qué.
    let motivoDif = null;
    if (desde && d.total_cent > desde.ganadora.monto_cent + 100) {
      motivoDif = texto(req.body.motivo_diferencia, 300);
      if (!motivoDif || !conSentido(motivoDif, 10)) return res.status(409).json({ error: `La orden (${fmt(d.total_cent)}) es mayor que lo cotizado (${fmt(desde.ganadora.monto_cent)}). Escribe por qué (mínimo 10 letras).`, codigo: 'SUPERA_COTIZACION', cotizado: desde.ganadora.monto_cent / 100 });
    }
    const igual = !req.body.forzar && !desde && db.prepare("SELECT id, created_at FROM ordenes_compra WHERE proveedor_id = ? AND fecha = ? AND total_cent = ? AND partidas_json = ? AND estado <> 'cancelada' ORDER BY id DESC LIMIT 1")
      .get(d.proveedor_id, d.fecha, d.total_cent, d.partidas_json);
    if (igual) return res.status(409).json({ error: `Ya existe una orden igual (${folioOC(igual)}): mismo proveedor, fecha, partidas y total. ¿Es otra compra?`, codigo: 'POSIBLE_DUPLICADO', orden_id: igual.id });
    const info = db.prepare(`INSERT INTO main.ordenes_compra (proveedor_id, centro_id, categoria, lead_id, fecha, fecha_requerida, entrega, factura_a, nota, observaciones,
        partidas_json, iva_modo, iva_tasa, subtotal_cent, iva_cent, total_cent, solicitante_nombre, solicitante_cargo, creado_por, solicitud_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.proveedor_id, d.centro_id, d.categoria, d.lead_id, d.fecha, d.fecha_requerida, d.entrega, d.factura_a,
      d.nota, d.observaciones, d.partidas_json, d.iva_modo, d.iva_tasa, d.subtotal_cent, d.iva_cent, d.total_cent, d.solicitante_nombre, d.solicitante_cargo, req.usuarioSesion.id, desde ? desde.solicitud.id : null);
    // La orden va a la sucursal de su solicitud (si viene de una); si no, a la de quien la hace.
    app.locals.sucursales.asignar('ordenes_compra', Number(info.lastInsertRowid), desde ? app.locals.sucursales.de('solicitudes_compra', desde.solicitud.id) : undefined);
    let creada = leer(info.lastInsertRowid);
    audit(req, creada.id, 'creada', `${creada.folio} · ${creada.proveedor_nombre} · ${creada.partidas.length} partida(s) · ${fmt(creada.total_cent)} · centro ${creada.centro_nombre}`
      + (desde ? ` · de la solicitud ${desde.solicitud.folio} (cotización ${fmt(desde.ganadora.monto_cent)}${desde.solicitud.excepcion_motivo ? ', EXCEPCIÓN POR URGENCIA: ' + desde.solicitud.excepcion_motivo : ''})` : ' · SIN SOLICITUD')
      + (req.body.forzar ? ' · se confirmó que no es repetida' : ''));
    if (motivoDif) { db.prepare('UPDATE main.ordenes_compra SET motivo_diferencia = ? WHERE id = ?').run(motivoDif, creada.id); audit(req, creada.id, 'mayor que lo cotizado', `${fmt(creada.total_cent)} vs cotizado ${fmt(desde.ganadora.monto_cent)} · motivo: ${motivoDif}`); }
    if (desde) { Sol.vincular(req, desde.solicitud.id, creada); creada = leer(creada.id); }
    res.status(201).json(creada);
  }));
  app.put('/api/compras/ordenes/:id', h((req, res) => {
    if (!esCostos(req)) return res.status(403).json(SOLO_COSTOS);
    const o = db.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    if (o.estado !== 'borrador') return res.status(409).json({ error: 'Solo se edita una orden en borrador. Una autorizada ya está en Cuentas por pagar.' });
    if (o.recibida_at) return res.status(409).json({ error: 'Esta orden ya se recibió: ya no se edita (lo que llegó y su precio quedan como se registraron).' });
    if (req.body.version !== undefined && Number(req.body.version) !== o.version) return res.status(409).json({ error: 'Otra persona modificó esta orden. Ciérrala y vuelve a abrirla.' });
    const v = validar(req.body || {}, req.usuarioSesion);
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.datos;
    const antes = leer(o.id);
    if (o.solicitud_id && d.proveedor_id !== o.proveedor_id) return res.status(400).json({ error: `Esta orden salió de la solicitud ${antes.solicitud_folio}: el proveedor es el de la cotización elegida. Para cambiarlo, elige otra cotización en la solicitud.` });
    // Al editar, tampoco puede quedar por encima de lo cotizado sin motivo.
    let motivoDif = o.motivo_diferencia;
    if (o.solicitud_id) {
      const cot = db.prepare('SELECT d.monto_cent FROM solicitudes_compra s JOIN documentos_solicitud d ON d.id = s.ganadora_id WHERE s.id = ?').get(o.solicitud_id);
      if (cot && d.total_cent > cot.monto_cent + 100) {
        motivoDif = texto(req.body.motivo_diferencia, 300) || motivoDif;
        if (!motivoDif || !conSentido(motivoDif, 10)) return res.status(409).json({ error: `La orden (${fmt(d.total_cent)}) es mayor que lo cotizado (${fmt(cot.monto_cent)}). Escribe por qué (mínimo 10 letras).`, codigo: 'SUPERA_COTIZACION', cotizado: cot.monto_cent / 100 });
        if (motivoDif !== o.motivo_diferencia) db.prepare('UPDATE main.ordenes_compra SET motivo_diferencia = ? WHERE id = ?').run(motivoDif, o.id);
      }
    }
    db.prepare(`UPDATE main.ordenes_compra SET proveedor_id = ?, centro_id = ?, categoria = ?, lead_id = ?, fecha = ?, fecha_requerida = ?, entrega = ?, factura_a = ?, nota = ?, observaciones = ?,
        partidas_json = ?, iva_modo = ?, iva_tasa = ?, subtotal_cent = ?, iva_cent = ?, total_cent = ?, solicitante_nombre = ?, solicitante_cargo = ?,
        updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?`).run(d.proveedor_id, d.centro_id, d.categoria, d.lead_id, d.fecha, d.fecha_requerida, d.entrega,
      d.factura_a, d.nota, d.observaciones, d.partidas_json, d.iva_modo, d.iva_tasa, d.subtotal_cent, d.iva_cent, d.total_cent, d.solicitante_nombre, d.solicitante_cargo, o.id);
    const despues = leer(o.id);
    const cambios = [app.locals.auditoria?.diferencias(antes, despues, ['proveedor_nombre', 'centro_nombre', 'fecha', 'fecha_requerida', 'factura_a', 'nota', 'observaciones', 'total_cent', 'iva_modo', 'solicitante_nombre', 'solicitante_cargo'].map(k => k)),
      antes.partidas_json !== despues.partidas_json ? 'partidas: ' + despues.partidas.map(p => `${p.cantidad} ${p.unidad || ''} ${p.descripcion} a ${fmt(Math.round(p.precio * 100))}`).join('; ') : ''].filter(Boolean).join(' · ');
    if (cambios) audit(req, o.id, 'editada', cambios);
    res.json(despues);
  }));
  // Autorizar: la orden pasa a Cuentas por pagar (pendiente de pago; vence según el crédito del proveedor).
  app.post('/api/compras/ordenes/:id/autorizar', h((req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede autorizar órdenes de compra' });
    const o = leer(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    if (o.estado !== 'borrador') return res.status(409).json({ error: o.estado === 'autorizada' ? 'Esta orden ya está autorizada' : 'Esta orden está cancelada' });
    const prov = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(o.proveedor_id);
    // Obligatorio: cuántos días de crédito tiene ESTA compra (0 = de contado). Con eso se calcula cuándo vence.
    const crudo = req.body?.dias_credito;
    const dias = typeof crudo === 'number' ? crudo : typeof crudo === 'string' && /^\s*\d{1,3}\s*$/.test(crudo) ? Number(crudo) : NaN;
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) return res.status(400).json({ error: 'Escribe cuántos días de crédito tiene esta compra (0 si es de contado, máximo 365)', codigo: 'FALTA_CREDITO', credito_proveedor: prov.dias_credito ?? null });
    const vence = sumarDias(o.fecha, dias);
    const resumen = o.partidas[0].descripcion + (o.partidas.length > 1 ? ` y ${o.partidas.length - 1} más` : '');
    const concepto = (o.folio + ' · ' + resumen).slice(0, 200);
    const cxpId = db.transaction(() => {
      // El IVA de la orden pasa a la cuenta por pagar (así Resultados no tiene que estimarlo).
      const info = db.prepare(`INSERT INTO main.cuentas_por_pagar (proveedor_id, categoria, concepto, fecha_documento, fecha_vencimiento, total_cent, lead_id, notas, registrado_por, dias_credito, iva_cent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(o.proveedor_id, o.categoria, concepto, o.fecha, vence, o.total_cent, o.lead_id,
        `Orden de compra ${o.folio} · Centro de costos: ${o.centro_nombre} · Crédito: ${dias ? dias + ' días' : 'de contado'}`, req.usuarioSesion.id, dias, o.iva_cent ?? null);
      app.locals.sucursales.asignar('cuentas_por_pagar', Number(info.lastInsertRowid), o.sucursal_id);
      db.prepare("UPDATE main.ordenes_compra SET estado = 'autorizada', cxp_id = ?, autorizada_por = ?, autorizada_at = datetime('now','localtime'), version = version + 1 WHERE id = ?")
        .run(info.lastInsertRowid, req.usuarioSesion.id, o.id);
      return info.lastInsertRowid;
    })();
    const distinto = prov.dias_credito != null && Number(prov.dias_credito) !== dias ? ` (el proveedor suele dar ${prov.dias_credito})` : '';
    audit(req, o.id, 'autorizada', `Se volvió deuda: cuenta por pagar de ${fmt(o.total_cent)} con ${o.proveedor_nombre} · crédito ${dias ? dias + ' días' : 'de contado'}${distinto}, vence el ${vence.split('-').reverse().join('/')}`);
    res.json({ ok: true, cxp_id: cxpId, orden: leer(o.id) });
  }));
  app.post('/api/compras/ordenes/:id/cancelar', h((req, res) => {
    const motivo = texto(req.body && req.body.motivo, 300);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe el motivo de la cancelación (mínimo 5 caracteres)' });
    const o = leer(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    if (o.estado === 'cancelada') return res.status(409).json({ error: 'Esta orden ya estaba cancelada' });
    if (!esCostos(req)) return res.status(403).json(SOLO_COSTOS);
    if (o.recibida_at && !esAdmin(req)) return res.status(403).json({ error: 'Esta orden ya se recibió: solo un administrador puede cancelarla (por ejemplo, si se devolvió lo comprado)' });
    if (o.estado === 'autorizada') {
      if (!esAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede cancelar una orden autorizada' });
      if (o.pagado_cent > 0) return res.status(409).json({ error: 'Esta orden ya tiene pagos al proveedor. Cancela primero esos pagos en Cuentas por pagar.' });
    }
    db.transaction(() => {
      if (o.cxp_id) db.prepare("UPDATE main.cuentas_por_pagar SET cancelada = 1, cancelada_por = ?, cancelada_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ? AND cancelada = 0")
        .run(req.usuarioSesion.id, ('Orden de compra cancelada: ' + motivo).slice(0, 300), o.cxp_id);
      db.prepare("UPDATE main.ordenes_compra SET estado = 'cancelada', cancelada_por = ?, cancelada_at = datetime('now','localtime'), motivo_cancelacion = ?, version = version + 1 WHERE id = ?")
        .run(req.usuarioSesion.id, motivo, o.id);
    })();
    audit(req, o.id, 'cancelada', `Motivo: ${motivo}${o.cxp_id ? ' · también se canceló su cuenta por pagar' : ''}`);
    Sol.ordenCancelada(req, o);
    res.json({ ok: true, orden: leer(o.id) });
  }));
  // Recepción: el encargado de centro de costos (o administración) marca que llegó lo comprado. Antes sube al
  // expediente la foto («Evidencia de entrega») y/o la firma de quien recibe («Firma de recibido»).
  app.post('/api/compras/ordenes/:id/recibir', h((req, res) => {
    if (!esCostos(req)) return res.status(403).json({ error: 'Lo marca el encargado de centro de costos o administración' });
    const o = leer(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    if (o.estado === 'cancelada') return res.status(409).json({ error: 'Esta orden está cancelada' });
    if (o.recibida_at) return res.status(409).json({ error: 'Ya estaba marcada como recibida el ' + String(o.recibida_at).slice(0, 10).split('-').reverse().join('/') });
    const evidencia = db.prepare("SELECT tipo, COUNT(*) n FROM documentos_oc WHERE oc_id = ? AND eliminado = 0 AND tipo IN ('evidencia', 'firma_recepcion') GROUP BY tipo").all(o.id);
    if (!evidencia.length) return res.status(400).json({ error: 'Agrega la foto de lo que llegó y/o la firma de quien lo recibe' });
    const recibio = texto(req.body?.recibio, 120);
    if (!recibio || !conSentido(recibio, 3) || /[<>{}]/.test(recibio)) return res.status(400).json({ error: 'Escribe el nombre de quien recibió' });
    const nota = texto(req.body?.nota, 300);
    db.prepare("UPDATE main.ordenes_compra SET recibida_at = datetime('now','localtime'), recibida_por = ?, recibida_por_nombre = ?, recibio_nombre = ?, recepcion_nota = ? WHERE id = ?")
      .run(req.usuarioSesion.id, req.usuarioSesion.nombre, recibio, nota, o.id);
    const conQue = evidencia.map(e => e.tipo === 'evidencia' ? 'foto' : 'firma').join(' y ');
    audit(req, o.id, 'recibida', `Recibió ${recibio} · con ${conQue}${nota ? ' · ' + nota : ''}`);
    Sol.ordenRecibida(req, o, `recibió ${recibio} (con ${conQue})`);
    res.json(leer(o.id));
  }));
};
