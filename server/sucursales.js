// SUCURSALES: cada sucursal opera su propio sistema (Pedro de CDMX solo ve lo de CDMX) y el administrador
// general ve todas, juntas o una por una.
//
// Cómo se separa (el candado está en la base, no en cada ruta):
//  · Lo operativo tiene sucursal_id: cotizaciones/órdenes (leads), cuentas por pagar, solicitudes y órdenes de
//    compra, prospección y el archivo de eliminados. Lo que cuelga de ellos (pagos, cobros, notas, documentos)
//    hereda la sucursal de su registro.
//  · Al arrancar se crean VISTAS TEMPORALES con el mismo nombre que esas tablas («leads», «cobros»…) que solo
//    muestran las filas de las sucursales de la petición (función en_alcance). Así, CUALQUIER consulta que lea
//    «FROM leads» queda filtrada sin tener que acordarse en cada ruta. Las escrituras van a «main.leads».
//  · Clientes, proveedores y catálogos son compartidos (un solo KFC para todos). Un usuario de sucursal ve los
//    clientes que dio de alta su sucursal o con los que su sucursal ha trabajado.
//  · Folios con clave y consecutivo propio por sucursal: OS-CDMX-202610-0001. Los anteriores no cambian.
//  · Cada ROL ve en cada área nada, «lo suyo», toda su sucursal o toda la empresa (permisos.js). Las mismas vistas lo
//    aplican: en_area (la sucursal, o cualquiera con «toda la empresa»), ve_lead (cotizaciones y órdenes que capturó,
//    tiene a su nombre o como técnico; cobranza de esas), ve_registro (lo que él registró o pidió) y nivel_area. Así
//    ninguna pantalla, reporte ni Excel puede mostrar lo de otro.
//  · Roles: admin (general, ve todas y crea sucursales), gerente (admin, pero solo en sus sucursales) y los demás
//    roles limitados a sus sucursales. Un usuario puede tener varias y cambia con el selector (X-Sucursal).
const alcance = require('./alcance');

// Tablas con sucursal propia y tablas que la heredan de su registro (en orden: primero las de arriba).
const CON_SUCURSAL = ['leads', 'cuentas_por_pagar', 'solicitudes_compra', 'ordenes_compra', 'establecimientos', 'historial_archivo', 'clientes', 'personal'];
const VISTAS = [
  ['leads', 've_lead(sucursal_id, responsable_id, tecnico_id, estatus, capturado_por)'],
  // Gastos: los de su sucursal o los que él registró; con «Ver los gastos de sus órdenes», también los de sus órdenes.
  ['cuentas_por_pagar', "en_area('cxp', sucursal_id) AND (ve_registro('cxp', registrado_por) OR ve_gasto_orden(lead_id))"],
  ['solicitudes_compra', "en_area('solicitudes', sucursal_id) AND ve_registro('solicitudes', solicitante_id)"],
  // Órdenes de compra: las que él hizo, o las que salen de sus solicitudes (si ve órdenes de compra: el técnico, no).
  ['ordenes_compra', "en_area('ordenes_compra', sucursal_id) AND (ve_registro('ordenes_compra', creado_por) OR (nivel_area('ordenes_compra') >= 1 AND solicitud_id IN (SELECT id FROM solicitudes_compra)))"],
  ['establecimientos', "en_area('prospeccion', sucursal_id) AND ve_registro('prospeccion', responsable_id)"], // prospección: los suyos, o toda su sucursal
  ['historial_archivo', 'en_alcance(sucursal_id)'],
  // Cobros: los de las órdenes que ve, si ve cuentas por cobrar; si no, solo los que él registró (el técnico que cobra en campo).
  ['cobros', 'lead_id IN (SELECT id FROM leads) AND ve_cobro(registrado_por, lead_id)'],
  ['historial', 'lead_id IN (SELECT id FROM leads) AND ve_bitacora(area, usuario_id, lead_id)'],
  ['pagos_proveedor', 'cxp_id IN (SELECT id FROM cuentas_por_pagar)'],
  ['documentos_solicitud', 'solicitud_id IN (SELECT id FROM solicitudes_compra)'],
  ['documentos_oc', 'oc_id IN (SELECT id FROM ordenes_compra)'],
  ['personal', 'en_alcance(sucursal_id)'], // qué se ve de cada persona lo decide personal.js (permisos)
  ['documentos_personal', 'personal_id IN (SELECT id FROM personal)'],
  ['incidencias_personal', 'personal_id IN (SELECT id FROM personal)'],
  ['orden_personal', 'lead_id IN (SELECT id FROM leads)'],
  ['encuestas', 'lead_id IN (SELECT id FROM leads)'], // la encuesta, con su orden
  // Marketing (2026-10-26): las de toda la empresa (sin sucursal) o de una sucursal que ve; con «lo suyo», las que creó o tiene a su nombre.
  ['publicaciones', "nivel_area('marketing') >= 1 AND (sucursal_id IS NULL OR en_area('marketing', sucursal_id)) AND (ve_registro('marketing', responsable_id) OR ve_registro('marketing', creado_por))"],
  ['publicacion_imagenes', 'publicacion_id IN (SELECT id FROM publicaciones)'],
  ['publicacion_comentarios', 'publicacion_id IN (SELECT id FROM publicaciones)'],
  ['publicacion_versiones', 'publicacion_id IN (SELECT id FROM publicaciones)'],
];
// Tablas con folio propio por sucursal y su tipo de contador.
const FOLIO = { leads: 'leads', solicitudes_compra: 'solicitudes', ordenes_compra: 'ordenes_compra' };
const CLAVE = /^[A-Z0-9]{2,6}$/;
// Segundo candado, por ruta: un registro de otra sucursal «no existe» (404) aunque se escriba su número.
const RUTAS_REGISTRO = [
  [/^\/leads\/(\d+)(?:\/|$)/, 'leads'], [/^\/historial\/(\d+)(?:\/|$)/, 'historial'],
  [/^\/finanzas\/cobros\/(\d+)(?:\/|$)/, 'cobros'], [/^\/finanzas\/cxp\/(\d+)(?:\/|$)/, 'cuentas_por_pagar'],
  [/^\/finanzas\/pagos-proveedor\/(\d+)(?:\/|$)/, 'pagos_proveedor'], [/^\/compras\/ordenes\/(\d+)(?:\/|$)/, 'ordenes_compra'],
  [/^\/compras\/documentos\/(\d+)(?:\/|$)/, 'documentos_oc'], [/^\/compras\/solicitudes\/documentos\/(\d+)(?:\/|$)/, 'documentos_solicitud'],
  [/^\/compras\/solicitudes\/(\d+)(?:\/|$)/, 'solicitudes_compra'], [/^\/prospeccion\/(\d+)(?:\/|$)/, 'establecimientos'],
  [/^\/personal\/(\d+)(?:\/|$)/, 'personal'],
  [/^\/marketing\/publicaciones\/(\d+)(?:\/|$)/, 'publicaciones'], [/^\/marketing\/imagenes\/(\d+)(?:\/|$)/, 'publicacion_imagenes'],
];
const RUTA_CLIENTE = /^\/(?:finanzas\/)?clientes\/(\d+)(?:\/|$)/;
// Lo que solo hace el administrador GENERAL (Dirección): afecta a todas las sucursales o lo ve todo. Aplica a
// cualquier otro rol, incluidos los que Dirección invente. (Los catálogos compartidos —canales, tipos de cliente,
// centros, unidades, categorías y descripción de servicios— los decide el permiso «catalogos.editar».)
const SOLO_GENERAL = [
  [/^(POST|PUT|DELETE)$/, /^\/sucursales(\/|$)/],
  [/./, /^\/admin\//],
  [/./, /^\/clientes\/(duplicados|distintos)$/], [/./, /^\/clientes\/\d+\/fusionar$/],
  [/^POST$/, /^\/servicios$/], [/^DELETE$/, /^\/servicios\/\d+$/],
  [/^(POST|PUT|DELETE)$/, /^\/prospeccion\/sectores(\/|$)/],
  [/^(PUT)$/, /^\/compras\/formato$/],
];
const esSoloGeneral = req => (req.path === '/auditoria' && !(req.query.entidad && req.query.id)) || SOLO_GENERAL.some(([m, r]) => m.test(req.method) && r.test(req.path));

// Folio de un registro a partir de su id (busca su sucursal y su consecutivo). Lo usan todos los módulos.
let DB = null, LISTA = [];
const CONSULTA_FOLIO = {};
const mesDe = creado => String(creado || '').slice(0, 7).replace('-', '');
function folioDe(prefijo, tabla, id, creado) {
  if (id == null) return '';
  // La consulta se prepara una sola vez por tabla (en listas de miles de renglones prepararla cada vez era lo lento).
  const r = DB && FOLIO[tabla] ? (CONSULTA_FOLIO[tabla] ||= DB.prepare(`SELECT folio_num, sucursal_id, created_at FROM main.${tabla} WHERE id = ?`)).get(id) : null;
  const clave = r && r.folio_num != null ? (LISTA.find(s => s.id === r.sucursal_id)?.clave || '') : '';
  if (clave) return `${prefijo}-${clave}-${mesDe(r.created_at)}-${String(r.folio_num).padStart(4, '0')}`;
  return `${prefijo}-${mesDe(r?.created_at || creado)}-${String(id).padStart(4, '0')}`;
}

module.exports = function sucursales(app, db, h, { audit }) {
  DB = db;
  // ---------- Tablas y migración ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS sucursales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(nombre)) BETWEEN 2 AND 60),
      clave TEXT NOT NULL UNIQUE CHECK(length(clave) BETWEEN 2 AND 6),
      direccion TEXT, telefono TEXT,
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS usuario_sucursales (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      PRIMARY KEY (usuario_id, sucursal_id)
    );
    CREATE TABLE IF NOT EXISTS contadores_folio (
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      tipo TEXT NOT NULL,
      ultimo INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (sucursal_id, tipo)
    );
  `);
  const columnas = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  const existeTabla = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!db.prepare('SELECT 1 FROM sucursales').get()) db.prepare("INSERT INTO sucursales (nombre, clave) VALUES ('Querétaro', 'QRO')").run();
  // Columnas y datos de las tablas de los demás módulos: se preparan al final del arranque (ya existen todas).
  function migrar() {
  for (const t of CON_SUCURSAL) if (existeTabla(t) && !columnas(t).includes('sucursal_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)`);
  for (const t of Object.keys(FOLIO)) if (existeTabla(t) && !columnas(t).includes('folio_num')) db.exec(`ALTER TABLE ${t} ADD COLUMN folio_num INTEGER`);
  db.transaction(() => {
    // La primera sucursal (matriz) recibe todo lo que ya existía; su consecutivo continúa después del último folio.
    if (!db.prepare('SELECT 1 FROM sucursales').get()) db.prepare("INSERT INTO sucursales (nombre, clave) VALUES ('Querétaro', 'QRO')").run();
    const m = db.prepare('SELECT id FROM sucursales ORDER BY id LIMIT 1').get().id;
    for (const t of CON_SUCURSAL) if (existeTabla(t)) db.prepare(`UPDATE ${t} SET sucursal_id = ? WHERE sucursal_id IS NULL`).run(m);
    for (const [t, tipo] of Object.entries(FOLIO)) if (existeTabla(t))
      db.prepare('INSERT OR IGNORE INTO contadores_folio (sucursal_id, tipo, ultimo) VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM ' + t + '))').run(m, tipo);
    // Quien no tiene sucursal (todos antes de existir sucursales) queda en la matriz; el admin general las ve todas.
    db.prepare("INSERT OR IGNORE INTO usuario_sucursales (usuario_id, sucursal_id) SELECT id, ? FROM usuarios u WHERE rol <> 'admin' AND NOT EXISTS (SELECT 1 FROM usuario_sucursales x WHERE x.usuario_id = u.id)").run(m);
  })();
  for (const t of Object.keys(FOLIO)) if (existeTabla(t)) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_folio_suc ON ${t}(sucursal_id, folio_num) WHERE folio_num IS NOT NULL`);
  for (const t of CON_SUCURSAL) if (existeTabla(t)) db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_sucursal ON ${t}(sucursal_id)`);
  }

  let CACHE = null;
  const lista = () => (CACHE ||= db.prepare('SELECT * FROM sucursales ORDER BY id').all());
  const refrescar = () => { CACHE = null; LISTA = lista(); alcance.fijarMatriz(LISTA[0]?.id ?? null); };
  refrescar();
  const claveDe = id => lista().find(s => s.id === Number(id))?.clave || '';

  // ---------- Alcance de cada petición ----------
  const sucursalesDe = usuarioId => db.prepare('SELECT s.id FROM usuario_sucursales x JOIN sucursales s ON s.id = x.sucursal_id WHERE x.usuario_id = ? AND s.activo = 1 ORDER BY s.id').all(usuarioId).map(r => r.id);
  function alcanceDe(usuario, pedida) {
    const general = usuario.rol === 'admin';
    let permitidas = general ? lista().map(s => s.id) : sucursalesDe(usuario.id);
    // Solo quien NUNCA tuvo sucursal (p. ej. se creó cuando había una sola); si su sucursal está desactivada, no ve nada.
    if (!general && !permitidas.length && !db.prepare('SELECT 1 FROM usuario_sucursales WHERE usuario_id = ?').get(usuario.id)) {
      const activas = lista().filter(s => s.activo);
      if (activas.length === 1) { db.prepare('INSERT OR IGNORE INTO usuario_sucursales (usuario_id, sucursal_id) VALUES (?, ?)').run(usuario.id, activas[0].id); permitidas = [activas[0].id]; }
    }
    let ids = permitidas;
    if (pedida && pedida !== 'todas') {
      const n = Number(pedida);
      if (!permitidas.includes(n)) return { error: 'No tienes acceso a esa sucursal' };
      ids = [n];
    }
    const todo = general && ids.length === permitidas.length, todas = ids === permitidas; // «Todas» en el selector
    const alta = ids.length === 1 ? ids[0] : (general ? alcance.matriz() : permitidas[0]) ?? null;
    return { todo, todas, ids: new Set(ids), alta, permitidas, general };
  }
  // Después de la sesión: fija el alcance y, para el gerente, sus permisos de administrador (solo en sus sucursales).
  app.use('/api', (req, res, next) => {
    const u = req.usuarioSesion;
    if (!u) return alcance.correr(alcance.SIN_ACCESO, next);
    const a = alcanceDe(u, req.get('X-Sucursal'));
    if (a.error) return res.status(403).json({ error: a.error, codigo: 'SUCURSAL' });
    if (!a.general && !a.permitidas.length && !['/sucursales', '/logout', '/cambiar-password'].includes(req.path))
      return res.status(403).json({ error: 'Tu sucursal está desactivada o no tienes sucursal asignada. Pide a Dirección que te asigne una.', codigo: 'SIN_SUCURSAL' });
    req.alcanceSuc = a;
    u.rol_real = u.rol; u.admin_general = u.rol === 'admin';
    if (u.rol === 'gerente') u.rol = 'admin';
    if (!u.admin_general && esSoloGeneral(req)) return res.status(403).json({ error: 'Esto solo lo hace Dirección (afecta a todas las sucursales)' });
    // Qué ve el rol (lo suyo / toda la sucursal): antes del candado por número, para que también lo aplique.
    app.locals.permisos?.prepararAlcance(req, a);
    const visible = alcance.correr(a, () => {
      const c = req.path.match(RUTA_CLIENTE);
      if (c) return verCliente(Number(c[1]));
      for (const [re, t] of RUTAS_REGISTRO) { const m = req.path.match(re); if (m) return !!db.prepare(`SELECT 1 FROM ${t} WHERE id = ?`).get(Number(m[1])); }
      return true;
    });
    if (!visible) return res.status(404).json({ error: 'No encontrado' });
    alcance.correr(a, next);
  });

  // ---------- Rutas ----------
  const esGeneral = req => !!req.usuarioSesion?.admin_general;
  app.get('/api/sucursales', h((req, res) => {
    const a = req.alcanceSuc, ids = new Set(a.permitidas);
    const filas = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM usuario_sucursales x JOIN usuarios u ON u.id = x.usuario_id AND u.activo = 1 WHERE x.sucursal_id = s.id) AS usuarios
      FROM sucursales s ORDER BY s.id`).all().filter(s => ids.has(s.id) || esGeneral(req));
    res.json({ sucursales: filas, admin_general: esGeneral(req), rol_real: req.usuarioSesion.rol_real, vista: a.ids.size === a.permitidas.length ? 'todas' : [...a.ids][0], alta: a.alta });
  }));
  const datos = b => {
    const nombre = String(b.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (nombre.length < 2 || nombre.length > 60 || /[<>{}]/.test(nombre)) return { error: 'Escribe el nombre de la sucursal (2 a 60 letras)' };
    const corto = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
    return { nombre, direccion: corto(b.direccion, 200), telefono: corto(b.telefono, 25) };
  };
  app.post('/api/sucursales', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json({ error: 'Solo el administrador general crea sucursales' });
    const d = datos(req.body); if (d.error) return res.status(400).json(d);
    const clave = String(req.body.clave ?? '').trim().toUpperCase();
    if (!CLAVE.test(clave)) return res.status(400).json({ error: 'La clave va en los folios: de 2 a 6 letras o números, sin espacios (ej. CDMX)' });
    if (lista().some(s => s.clave === clave)) return res.status(409).json({ error: 'Ya existe una sucursal con la clave ' + clave });
    if (lista().some(s => s.nombre.toLowerCase() === d.nombre.toLowerCase())) return res.status(409).json({ error: 'Ya existe la sucursal ' + d.nombre });
    // Quien todavía no tiene sucursal (todos, mientras solo había una) queda en la principal: no se queda sin ver nada.
    db.prepare("INSERT OR IGNORE INTO usuario_sucursales (usuario_id, sucursal_id) SELECT id, ? FROM usuarios u WHERE rol <> 'admin' AND NOT EXISTS (SELECT 1 FROM usuario_sucursales x WHERE x.usuario_id = u.id)").run(alcance.matriz());
    const id = Number(db.prepare('INSERT INTO sucursales (nombre, clave, direccion, telefono) VALUES (?, ?, ?, ?)').run(d.nombre, clave, d.direccion, d.telefono).lastInsertRowid);
    refrescar();
    audit.registrar(req, 'sucursal', id, 'creada', `${d.nombre} (${clave})`);
    res.status(201).json(lista().find(s => s.id === id));
  }));
  app.put('/api/sucursales/:id', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json({ error: 'Solo el administrador general modifica sucursales' });
    const s = lista().find(x => x.id === Number(req.params.id)); if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    const d = datos({ ...s, ...req.body }); if (d.error) return res.status(400).json(d);
    if (req.body.clave !== undefined && String(req.body.clave).trim().toUpperCase() !== s.clave) return res.status(400).json({ error: 'La clave no se cambia: ya aparece en los folios de esta sucursal' });
    if (lista().some(x => x.id !== s.id && x.nombre.toLowerCase() === d.nombre.toLowerCase())) return res.status(409).json({ error: 'Ya existe la sucursal ' + d.nombre });
    const activo = req.body.activo === undefined ? s.activo : (req.body.activo ? 1 : 0);
    if (!activo && s.id === alcance.matriz()) return res.status(400).json({ error: 'La sucursal principal no se desactiva' });
    db.prepare('UPDATE sucursales SET nombre = ?, direccion = ?, telefono = ?, activo = ? WHERE id = ?').run(d.nombre, d.direccion, d.telefono, activo, s.id);
    const dif = audit.diferencias(s, { ...d, activo }, ['nombre', 'direccion', 'telefono', 'activo']);
    if (dif) audit.registrar(req, 'sucursal', s.id, 'editada', dif);
    refrescar();
    res.json(lista().find(x => x.id === s.id));
  }));

  // ---------- Usuarios y sus sucursales ----------
  // Valida la lista de sucursales que se le asigna a alguien: el gerente solo asigna de las suyas.
  function sucursalesParaUsuario(req, ids, rol) {
    if (rol === 'admin') return { ids: [] }; // el administrador general las ve todas
    const activas = lista().filter(s => s.activo);
    if (ids === undefined && activas.length === 1) ids = [activas[0].id]; // una sola sucursal: es esa
    if (ids === undefined && !esGeneral(req) && req.alcanceSuc.permitidas.length === 1) ids = req.alcanceSuc.permitidas;
    const lista0 = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
    if (!lista0.length) return { error: 'Elige al menos una sucursal para este usuario' };
    const validas = new Set(lista().filter(s => s.activo).map(s => s.id));
    if (lista0.some(i => !validas.has(i))) return { error: 'Sucursal inválida o desactivada' };
    if (!esGeneral(req) && lista0.some(i => !req.alcanceSuc.permitidas.includes(i))) return { error: 'Solo puedes asignar tus sucursales' };
    return { ids: lista0 };
  }
  const guardarSucursalesUsuario = (usuarioId, ids) => db.transaction(() => {
    db.prepare('DELETE FROM usuario_sucursales WHERE usuario_id = ?').run(usuarioId);
    for (const s of ids) db.prepare('INSERT INTO usuario_sucursales (usuario_id, sucursal_id) VALUES (?, ?)').run(usuarioId, s);
  })();
  // ¿Puede quien pide administrar a este usuario? El gerente: solo usuarios (no admin ni gerente) de sus sucursales.
  function puedeAdministrar(req, usuario) {
    if (esGeneral(req)) return true;
    if (['admin', 'gerente'].includes(usuario.rol)) return false;
    if (!app.locals.permisos.cabe(req, usuario.rol)) return false; // nadie administra a quien tiene más permisos
    const suyas = sucursalesDe(usuario.id);
    return suyas.length > 0 && suyas.every(s => req.alcanceSuc.permitidas.includes(s));
  }

  // ---------- Folios por sucursal ----------
  function siguienteFolio(tipo, sucursalId) {
    db.prepare('INSERT OR IGNORE INTO contadores_folio (sucursal_id, tipo, ultimo) VALUES (?, ?, 0)').run(sucursalId, tipo);
    db.prepare('UPDATE contadores_folio SET ultimo = ultimo + 1 WHERE sucursal_id = ? AND tipo = ?').run(sucursalId, tipo);
    return db.prepare('SELECT ultimo FROM contadores_folio WHERE sucursal_id = ? AND tipo = ?').get(sucursalId, tipo).ultimo;
  }
  // Sucursal (y folio, si lleva) de un registro recién creado; llamarlo en la misma transacción del INSERT.
  // Sin sucursal explícita va a la de la petición. Un registro sin sucursal no lo ve nadie más que el admin general.
  function asignar(tabla, id, sucursalId) {
    const s = sucursalId ?? alcance.sucursalAlta(), tipo = FOLIO[tabla];
    if (!s) throw new Error('Sin sucursal para el registro');
    if (tipo) db.prepare(`UPDATE main.${tabla} SET sucursal_id = ?, folio_num = COALESCE(folio_num, ?) WHERE id = ?`).run(s, siguienteFolio(tipo, s), id);
    else db.prepare(`UPDATE main.${tabla} SET sucursal_id = ? WHERE id = ?`).run(s, id);
    // Quién capturó el contacto o la cotización (con su responsable, quienes lo editan; 2026-10-26).
    if ((tabla === 'clientes' || tabla === 'leads') && alcance.usuario() != null) db.prepare(`UPDATE main.${tabla} SET capturado_por = COALESCE(capturado_por, ?) WHERE id = ?`).run(alcance.usuario(), id);
    return s;
  }
  // Sucursal de un registro (sin importar el alcance): para heredarla.
  const de = (tabla, id) => (id == null ? undefined : db.prepare(`SELECT sucursal_id FROM main.${tabla} WHERE id = ?`).get(id)?.sucursal_id ?? undefined);

  // ---------- Candados en la base ----------
  // Se activan al final del arranque (después de todas las migraciones): vistas temporales que filtran por la
  // sucursal de la petición y un tope que impide guardar un registro operativo sin sucursal.
  function activarCandados() {
    migrar();
    db.db.function('en_alcance', { deterministic: false }, s => (alcance.ve(s) ? 1 : 0));
    db.db.function('en_area', { deterministic: false }, (area, s) => (alcance.veEnArea(area, s) ? 1 : 0));
    // Qué ve el rol (0 nada, 1 lo suyo, 2 toda su sucursal, 3 toda la empresa) y si una fila es «suya».
    db.db.function('nivel_area', { deterministic: false }, area => alcance.nivel(area));
    db.db.function('ve_registro', { deterministic: false }, (area, quien) => {
      const n = alcance.nivel(area);
      return n >= 2 || (n === 1 && quien != null && quien === alcance.usuario()) ? 1 : 0;
    });
    // Un cobro: lo ve quien ve la cobranza de toda su sucursal; con «lo suyo», solo en sus órdenes (responsable o técnico
    // asignado), aunque vea las ventas de toda la sucursal; y, siempre, quien lo registró.
    const respTec = db.db.prepare('SELECT responsable_id, tecnico_id FROM main.leads WHERE id = ?');
    // Un gasto de una orden suya (responsable o técnico), para quien tiene «Ver los gastos de sus órdenes» (2026-10-22).
    const deMiOrden = leadId => { const yo = alcance.usuario(), l = leadId == null || yo == null ? null : respTec.get(leadId); return !!l && (l.responsable_id === yo || l.tecnico_id === yo); };
    db.db.function('ve_gasto_orden', { deterministic: false }, leadId => (alcance.actual().gastosOrden && alcance.nivel('cxp') >= 1 && deMiOrden(leadId) ? 1 : 0));
    db.db.function('ve_cobro', { deterministic: false }, (quien, leadId) => {
      const n = alcance.nivel('cxc'), yo = alcance.usuario();
      if (n >= 2 || (yo != null && quien === yo)) return 1;
      if (n === 1 && yo != null) { const l = respTec.get(leadId); return l && (l.responsable_id === yo || l.tecnico_id === yo) ? 1 : 0; }
      return 0;
    });
    // Una cotización (área «cotizaciones») u orden («ordenes»): la ve quien ve esa área de su sucursal (o de toda la
    // empresa), quien la capturó, su responsable y, si es orden, su técnico asignado; y, ya contratada, quien ve la
    // cobranza (de toda la sucursal o de las suyas).
    db.db.function('ve_lead', { deterministic: false }, (s, resp, tec, estatus, capt) => {
      const orden = estatus === 'ganado', area = orden ? 'ordenes' : 'cotizaciones', v = alcance.nivel(area);
      const yo = alcance.usuario(), mia = yo != null && (resp === yo || capt === yo || (orden && tec === yo));
      if (alcance.veEnArea(area, s) && (v >= 2 || (v === 1 && mia))) return 1;
      if (orden && alcance.veEnArea('cxc', s)) { const c = alcance.nivel('cxc'); if (c >= 2 || (c === 1 && mia)) return 1; }
      return 0;
    });
    // Bitácora de una orden visible: lo de cobranza ('cxc') lo ve quien ve la cobranza de esa orden; lo de gastos
    // ('cxp'), quien ve esos gastos (toda la sucursal o lo que él registró).
    const delLead = db.db.prepare('SELECT responsable_id, tecnico_id FROM main.leads WHERE id = ?');
    db.db.function('ve_bitacora', { deterministic: false }, (area, quien, leadId) => {
      if (!area) return 1;
      // Avisos de la encuesta (cliente insatisfecho, quiere mantenimiento preventivo): Dirección, el gerente («Editar lo
      // de otros») y el responsable de la orden (2026-10-26).
      if (area === 'encuesta') {
        const a = alcance.actual(); if (!a.niveles) return 1;
        if (a.editarOtros) return 1;
        const l = delLead.get(leadId); return l && l.responsable_id === alcance.usuario() ? 1 : 0;
      }
      const n = alcance.nivel(area), yo = alcance.usuario();
      if (n >= 2) return 1;
      if (n === 0 || yo == null) return 0;
      if (area === 'cxp') return quien === yo || (alcance.actual().gastosOrden && deMiOrden(leadId)) ? 1 : 0;
      const l = delLead.get(leadId);
      return l && (l.responsable_id === yo || l.tecnico_id === yo) ? 1 : 0;
    });
    // Un contacto: lo ve quien ve los contactos de su sucursal (o de toda la empresa) y, con «lo suyo», el que lo
    // capturó (los de antes, sin quién los capturó, mientras no tengan cotización). Los demás se ven por sus
    // cotizaciones u órdenes visibles: quien ve una orden siempre ve los datos de su cliente.
    const conCotizacion = db.db.prepare('SELECT 1 FROM main.leads WHERE cliente_id = ? LIMIT 1');
    db.db.function('cliente_en_alcance', { deterministic: false }, (s, id, capt) => {
      if (!alcance.veEnArea('contactos', s)) return 0;
      const v = alcance.nivel('contactos'), yo = alcance.usuario();
      return v >= 2 || (v === 1 && ((yo != null && capt === yo) || (capt == null && !conCotizacion.get(id)))) ? 1 : 0;
    });
    for (const [t, filtro] of VISTAS) {
      if (!existeTabla(t)) continue;
      db.exec(`DROP VIEW IF EXISTS temp.${t}`);
      db.exec(`CREATE TEMP VIEW ${t} AS SELECT * FROM main.${t} WHERE ${filtro}`);
    }
  }

  // Clientes compartidos: los ve quien los dio de alta en su sucursal o ha trabajado con ellos (SQL para «c»).
  const clienteVisible = (a = 'c') => `(cliente_en_alcance(${a}.sucursal_id, ${a}.id, ${a}.capturado_por) OR EXISTS (SELECT 1 FROM leads lv WHERE lv.cliente_id = ${a}.id))`;
  const verCliente = id => !!db.prepare(`SELECT 1 FROM main.clientes c WHERE c.id = ? AND ${clienteVisible('c')}`).get(id);
  // Los datos de un cliente compartido (teléfonos, RFC, correo, dirección, crédito) los corrige Dirección o la
  // sucursal que lo dio de alta; las demás sucursales le venden, pero no le cambian los datos.
  function puedeEditarCliente(req, id) {
    if (req.usuarioSesion?.admin_general && !req.usuarioSesion?.ver_como) return true;
    return clienteDeSuSucursal(req, id) && clienteEsSuyo(req, id);
  }
  // Solo la regla de sucursal (para lo que no es de ventas, p. ej. el crédito que captura cobranza).
  function clienteDeSuSucursal(req, id) {
    if (req.usuarioSesion?.admin_general && !req.usuarioSesion?.ver_como) return true;
    const c = db.prepare('SELECT sucursal_id FROM main.clientes WHERE id = ?').get(id);
    return !!c && (c.sucursal_id == null ? req.alcanceSuc.permitidas.includes(alcance.matriz()) : req.alcanceSuc.permitidas.includes(c.sucursal_id));
  }
  // Según su rol (2026-10-26): edita el contacto quien edita contactos y es suyo (lo capturó o atiende alguna de sus
  // cotizaciones u órdenes; los de antes sin nadie que los atienda, cualquiera), o quien tiene «Editar lo de otros».
  // Quien solo lo ve (Cobranza, Técnico) no lo toca.
  function clienteEsSuyo(req, id) {
    const yo = alcance.usuario(), c = db.prepare('SELECT capturado_por FROM main.clientes WHERE id = ?').get(id);
    const resp = db.prepare('SELECT responsable_id, capturado_por FROM main.leads WHERE cliente_id = ? AND en_alcance(sucursal_id)').all(id);
    const suyo = yo != null && (c?.capturado_por === yo || resp.some(r => r.responsable_id === yo || r.capturado_por === yo) || (c?.capturado_por == null && !resp.length));
    return app.locals.permisos.puedeEditar(req, 'contactos', suyo);
  }
  const sucursalDeCliente = id => { const c = db.prepare('SELECT sucursal_id FROM main.clientes WHERE id = ?').get(id); return lista().find(s => s.id === c?.sucursal_id) || null; };
  const NO_EDITA = (req, id) => { if (!clienteEsSuyo(req, id)) return { error: !app.locals.permisos.puede(req, 'contactos.editar') ? 'Tu rol no modifica los datos de los clientes' : 'Este cliente lo atiende otra persona: sus datos los corrige ella o el gerente', codigo: 'CLIENTE_DE_OTRO' };
    const s = sucursalDeCliente(id); return { error: `Este cliente lo dio de alta ${s ? s.nombre + ' (' + s.clave + ')' : 'otra sucursal'}: sus datos (teléfonos, RFC, correo, dirección y crédito) los corrige esa sucursal o Dirección. Tú sí puedes cotizarle y venderle.`, codigo: 'CLIENTE_DE_OTRA_SUCURSAL' }; };

  return { puedeEditarCliente, clienteDeSuSucursal, NO_EDITA, activarCandados, folio: folioDe, claveDe, asignar, de, siguienteFolio, lista, clienteVisible, verCliente, esGeneral, sucursalesParaUsuario, guardarSucursalesUsuario, puedeAdministrar, sucursalesDe };
};
module.exports.VISTAS = VISTAS;
// «OS-CDMX-202610-0001»; los registros de antes de las sucursales conservan «OS-202610-0087».
module.exports.folio = folioDe;
// Orden de servicio (visible para quien pregunta) a partir de un folio escrito: «OS-CDMX-202610-0001», «cdmx 1»,
// «OS-202610-0087» (de antes) o solo el número. Devuelve su id o null.
module.exports.leadPorFolio = texto => {
  const m = String(texto || '').trim().match(/^(?:(?:os|cot)[\s-]*)?(?:([a-z][a-z0-9]{1,5})[\s-]+)?(?:(\d{6})[\s-]+)?0*(\d{1,7})$/i);
  if (!m || !DB) return null;
  const mes = m[2] ? " AND strftime('%Y%m', created_at) = '" + m[2] + "'" : '';
  const r = m[1] ? DB.prepare("SELECT id FROM leads WHERE sucursal_id = (SELECT id FROM sucursales WHERE clave = ?) AND folio_num = ?" + mes).get(m[1].toUpperCase(), Number(m[3]))
    : DB.prepare('SELECT id FROM leads WHERE ((id = ? AND folio_num IS NULL) OR folio_num = ?)' + mes + ' ORDER BY folio_num IS NULL DESC LIMIT 1').get(Number(m[3]), Number(m[3]));
  return r ? r.id : null;
};
module.exports.folioLead = (l, id = l.id) => folioDe(l.estatus === 'ganado' ? 'OS' : 'COT', 'leads', id, l.created_at);
module.exports.CON_SUCURSAL = CON_SUCURSAL;
module.exports.esSoloGeneral = esSoloGeneral;
