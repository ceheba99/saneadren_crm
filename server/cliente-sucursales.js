// Sucursales de un cliente (2026-11-04): la lista de lugares de un cliente (KFC Puerta La Victoria, Juriquilla…) para
// llenar el hueco {sucursal} de la descripción del servicio al capturar una partida. Decidido con Dirección:
//  · La descripción con huecos vive en el servicio del catálogo (una para todos los clientes); el cliente solo guarda
//    su lista de sucursales, y al capturar se elige de esa lista (no se escribe a mano).
//  · Agregan, cambian o quitan sucursales Dirección y el Gerente de la sucursal del cliente (permiso
//    «clientes.sucursales», de fábrica solo el Gerente); las ve y elige quien cotiza al cliente.
//  · Quitar = desactivar: nunca se borran, y cada cambio queda en la bitácora del cliente.
// Reemplaza a las «descripciones guardadas por cliente» (PR #134, mismo día): su tabla se conserva tal cual
// (migraciones aditivas), pero ya no se usa en la pantalla.
const MAX_NOMBRE = 80, MAX_DIRECCION = 250, MAX_ACTIVAS = 300;
const llave = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = function clienteSucursales(app, db, h, { permisos, suc, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS cliente_sucursales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND ${MAX_NOMBRE}),
    direccion TEXT,
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_cliente_sucursales ON cliente_sucursales(cliente_id, activo);
  -- Retirada el 2026-11-04 (ver arriba): se conserva con sus datos, sin pantalla.
  CREATE TABLE IF NOT EXISTS plantillas_descripcion (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL REFERENCES clientes(id), servicio_id INTEGER REFERENCES catalogo_servicios(id),
    nombre TEXT, texto TEXT NOT NULL CHECK(length(texto) BETWEEN 1 AND 10000), activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));`);

  // Dirección, o quien tiene el permiso (el Gerente) en la sucursal que dio de alta al cliente.
  const edita = (req, clienteId) => permisos.direccion(req) || (permisos.puede(req, 'clientes.sucursales') && suc.clienteDeSuSucursal(req, clienteId));
  const usa = req => permisos.puede(req, 'cotizaciones.editar') || permisos.puede(req, 'ordenes.editar');
  const SOLO_EDITAN = { error: 'Las sucursales del cliente las agregan o cambian solo Dirección y el Gerente de su sucursal', codigo: 'SUCURSAL_CLIENTE_SOLO_GERENTE' };

  const cliente = id => db.prepare('SELECT id FROM main.clientes WHERE id = ?').get(Number(id));
  const leer = (clienteId, id) => db.prepare('SELECT * FROM cliente_sucursales WHERE cliente_id = ? AND id = ?').get(clienteId, Number(id));
  const vista = s => ({ id: s.id, cliente_id: s.cliente_id, nombre: s.nombre, direccion: s.direccion || '', activo: !!s.activo });
  const repetida = (clienteId, nombre, menosId = 0) => db.prepare('SELECT nombre FROM cliente_sucursales WHERE cliente_id = ? AND activo = 1 AND id <> ?').all(clienteId, menosId).some(x => llave(x.nombre) === llave(nombre));
  const lleno = clienteId => db.prepare('SELECT COUNT(*) n FROM cliente_sucursales WHERE cliente_id = ? AND activo = 1').get(clienteId).n >= MAX_ACTIVAS;

  // Valida y normaliza; regresa [error] o [null, datos]. En un cambio solo se valida lo que viene.
  function datosDe(body, parcial) {
    const d = {};
    if (!parcial || body.nombre !== undefined) {
      if (typeof body.nombre !== 'string' || !body.nombre.trim()) return ['Escribe el nombre de la sucursal del cliente'];
      const nombre = body.nombre.replace(/\s+/g, ' ').trim();
      if (nombre.length > MAX_NOMBRE) return [`El nombre no puede pasar de ${MAX_NOMBRE} caracteres`];
      if (/[{}]/.test(nombre)) return ['El nombre no puede llevar llaves { }'];
      d.nombre = nombre;
    }
    if (!parcial || body.direccion !== undefined) {
      if (body.direccion != null && typeof body.direccion !== 'string') return ['La dirección debe ser texto'];
      const direccion = String(body.direccion ?? '').replace(/\s+/g, ' ').trim();
      if (direccion.length > MAX_DIRECCION) return [`La dirección no puede pasar de ${MAX_DIRECCION} caracteres`];
      d.direccion = direccion || null;
    }
    return [null, d];
  }

  // Lista del cliente. Quien las cambia ve también las quitadas (?todas=1) para poder reactivarlas.
  app.get('/api/clientes/:id/sucursales', h((req, res) => {
    const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    const puede = edita(req, c.id);
    if (!puede && !usa(req)) return res.status(403).json({ error: 'Tu rol no cotiza a este cliente' });
    const todas = puede && req.query.todas === '1';
    const filas = db.prepare(`SELECT * FROM cliente_sucursales WHERE cliente_id = ? ${todas ? '' : 'AND activo = 1'} ORDER BY activo DESC, nombre COLLATE NOCASE, id`).all(c.id);
    res.json({ puede_editar: puede, sucursales: filas.map(vista) });
  }));

  app.post('/api/clientes/:id/sucursales', h((req, res) => {
    const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!edita(req, c.id)) return res.status(403).json(SOLO_EDITAN);
    const [error, d] = datosDe(req.body || {}, false); if (error) return res.status(400).json({ error });
    if (repetida(c.id, d.nombre)) return res.status(409).json({ error: `Este cliente ya tiene la sucursal «${d.nombre}»` });
    if (lleno(c.id)) return res.status(400).json({ error: `Este cliente ya tiene ${MAX_ACTIVAS} sucursales: quita las que ya no se usen` });
    const id = db.prepare('INSERT INTO cliente_sucursales (cliente_id, nombre, direccion, creado_por) VALUES (?, ?, ?, ?)').run(c.id, d.nombre, d.direccion, req.usuarioSesion.id).lastInsertRowid;
    audit.registrar(req, 'cliente', c.id, 'editado', `Sucursal del cliente agregada: «${d.nombre}»`);
    res.status(201).json(vista(leer(c.id, id)));
  }));

  app.put('/api/clientes/:id/sucursales/:sid', h((req, res) => {
    const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!edita(req, c.id)) return res.status(403).json(SOLO_EDITAN);
    const antes = leer(c.id, req.params.sid); if (!antes) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!antes.activo) return res.status(409).json({ error: 'Esta sucursal está quitada: vuelve a activarla para cambiarla' });
    const [error, d] = datosDe(req.body || {}, true); if (error) return res.status(400).json({ error });
    const cambia = Object.keys(d).filter(k => (d[k] ?? null) !== (antes[k] ?? null));
    if (!cambia.length) return res.status(400).json({ error: 'Sin cambios' });
    if (d.nombre && repetida(c.id, d.nombre, antes.id)) return res.status(409).json({ error: `Este cliente ya tiene la sucursal «${d.nombre}»` });
    db.prepare(`UPDATE cliente_sucursales SET ${cambia.map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...cambia.map(k => d[k]), antes.id);
    audit.registrar(req, 'cliente', c.id, 'editado', `Sucursal del cliente «${antes.nombre}» cambiada${d.nombre && d.nombre !== antes.nombre ? ' a «' + d.nombre + '»' : ''}${cambia.includes('direccion') ? ' (dirección)' : ''}`);
    res.json(vista(leer(c.id, antes.id)));
  }));

  // Quitar (desactivar) o volver a activar; nunca se borra.
  for (const [accion, activo] of [['desactivar', 0], ['reactivar', 1]]) {
    app.post('/api/clientes/:id/sucursales/:sid/' + accion, h((req, res) => {
      const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
      if (!edita(req, c.id)) return res.status(403).json(SOLO_EDITAN);
      const s = leer(c.id, req.params.sid); if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
      if (s.activo === activo) return res.status(409).json({ error: activo ? 'Ya está activa' : 'Ya estaba quitada' });
      if (activo && repetida(c.id, s.nombre, s.id)) return res.status(409).json({ error: `Ya hay otra sucursal activa llamada «${s.nombre}»` });
      if (activo && lleno(c.id)) return res.status(400).json({ error: `Este cliente ya tiene ${MAX_ACTIVAS} sucursales: quita las que ya no se usen` });
      db.prepare("UPDATE cliente_sucursales SET activo = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(activo, s.id);
      audit.registrar(req, 'cliente', c.id, 'editado', `Sucursal del cliente «${s.nombre}» ${activo ? 'activada otra vez' : 'quitada'}`);
      res.json(vista(leer(c.id, s.id)));
    }));
  }
};
