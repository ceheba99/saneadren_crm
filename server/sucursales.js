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
//  · Roles: admin (general, ve todas y crea sucursales), gerente (admin, pero solo en sus sucursales) y los demás
//    roles limitados a sus sucursales. Un usuario puede tener varias y cambia con el selector (X-Sucursal).
const alcance = require('./alcance');

// Tablas con sucursal propia y tablas que la heredan de su registro (en orden: primero las de arriba).
const CON_SUCURSAL = ['leads', 'cuentas_por_pagar', 'solicitudes_compra', 'ordenes_compra', 'establecimientos', 'historial_archivo', 'clientes'];
const VISTAS = [
  ['leads', 'en_alcance(sucursal_id)'],
  ['cuentas_por_pagar', 'en_alcance(sucursal_id)'],
  ['solicitudes_compra', 'en_alcance(sucursal_id)'],
  ['ordenes_compra', 'en_alcance(sucursal_id)'],
  ['establecimientos', 'en_alcance(sucursal_id)'],
  ['historial_archivo', 'en_alcance(sucursal_id)'],
  ['cobros', 'lead_id IN (SELECT id FROM leads)'],
  ['historial', 'lead_id IN (SELECT id FROM leads)'],
  ['pagos_proveedor', 'cxp_id IN (SELECT id FROM cuentas_por_pagar)'],
  ['documentos_solicitud', 'solicitud_id IN (SELECT id FROM solicitudes_compra)'],
  ['documentos_oc', 'oc_id IN (SELECT id FROM ordenes_compra)'],
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
];
const RUTA_CLIENTE = /^\/(?:finanzas\/)?clientes\/(\d+)(?:\/|$)/;
// Lo que solo hace el administrador GENERAL (afecta a todas las sucursales o lo ve todo).
const SOLO_GENERAL = [
  [/^(POST|PUT|DELETE)$/, /^\/sucursales(\/|$)/],
  [/./, /^\/admin\//],
  [/./, /^\/clientes\/(duplicados|distintos)$/], [/./, /^\/clientes\/\d+\/fusionar$/],
  [/^(POST|PUT|DELETE)$/, /^\/servicios(\/|$)/], [/^(POST|PUT|DELETE)$/, /^\/canales(\/|$)/], [/^(POST|PUT|DELETE)$/, /^\/tipos-cliente(\/|$)/],
  [/^(POST|PUT|DELETE)$/, /^\/finanzas\/categorias(\/|$)/], [/^(POST|PUT|DELETE)$/, /^\/prospeccion\/sectores(\/|$)/],
  [/^(PUT)$/, /^\/compras\/formato$/], [/^(POST|PUT|DELETE)$/, /^\/compras\/(centros|unidades)(\/|$)/],
];

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
    const todo = general && ids.length === permitidas.length;
    const alta = ids.length === 1 ? ids[0] : (general ? alcance.matriz() : permitidas[0]) ?? null;
    return { todo, ids: new Set(ids), alta, permitidas, general };
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
    if (u.rol === 'gerente') {
      u.rol = 'admin';
      const bitacoraCompleta = req.path === '/auditoria' && !(req.query.entidad && req.query.id);
      if (bitacoraCompleta || SOLO_GENERAL.some(([m, r]) => m.test(req.method) && r.test(req.path))) return res.status(403).json({ error: 'Esto solo lo hace el administrador general (afecta a todas las sucursales)' });
    }
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
    for (const [t, filtro] of VISTAS) {
      if (!existeTabla(t)) continue;
      db.exec(`DROP VIEW IF EXISTS temp.${t}`);
      db.exec(`CREATE TEMP VIEW ${t} AS SELECT * FROM main.${t} WHERE ${filtro}`);
    }
  }

  // Clientes compartidos: los ve quien los dio de alta en su sucursal o ha trabajado con ellos (SQL para «c»).
  const clienteVisible = (a = 'c') => `(en_alcance(${a}.sucursal_id) OR EXISTS (SELECT 1 FROM leads lv WHERE lv.cliente_id = ${a}.id))`;
  const verCliente = id => !!db.prepare(`SELECT 1 FROM main.clientes c WHERE c.id = ? AND ${clienteVisible('c')}`).get(id);
  // Los datos de un cliente compartido (teléfonos, RFC, correo, dirección, crédito) los corrige Dirección o la
  // sucursal que lo dio de alta; las demás sucursales le venden, pero no le cambian los datos.
  function puedeEditarCliente(req, id) {
    if (req.usuarioSesion?.admin_general) return true;
    const c = db.prepare('SELECT sucursal_id FROM main.clientes WHERE id = ?').get(id);
    return !!c && (c.sucursal_id == null ? req.alcanceSuc.permitidas.includes(alcance.matriz()) : req.alcanceSuc.permitidas.includes(c.sucursal_id));
  }
  const sucursalDeCliente = id => { const c = db.prepare('SELECT sucursal_id FROM main.clientes WHERE id = ?').get(id); return lista().find(s => s.id === c?.sucursal_id) || null; };
  const NO_EDITA = (req, id) => { const s = sucursalDeCliente(id); return { error: `Este cliente lo dio de alta ${s ? s.nombre + ' (' + s.clave + ')' : 'otra sucursal'}: sus datos (teléfonos, RFC, correo, dirección y crédito) los corrige esa sucursal o Dirección. Tú sí puedes cotizarle y venderle.`, codigo: 'CLIENTE_DE_OTRA_SUCURSAL' }; };

  return { puedeEditarCliente, NO_EDITA, activarCandados, folio: folioDe, claveDe, asignar, de, siguienteFolio, lista, clienteVisible, verCliente, esGeneral, sucursalesParaUsuario, guardarSucursalesUsuario, puedeAdministrar, sucursalesDe };
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
