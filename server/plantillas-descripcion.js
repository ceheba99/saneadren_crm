// Descripciones guardadas por cliente (2026-11-04): textos que se repiten en las partidas de las cotizaciones y órdenes
// de un cliente, con huecos entre llaves que se llenan al usarlas. Ej. KFC: «… TRAMPAS DE GRASA INTERNAS Y EXTERNAS. KFC
// {sucursal}». Al elegirla en una partida, la pantalla pide cada hueco y llena la descripción (se puede seguir editando).
//  · Crean, cambian o quitan plantillas solo Dirección y el Gerente de la sucursal del cliente (decidido el 2026-11-04):
//    el permiso «clientes.plantillas», que de fábrica solo tiene el Gerente, y solo en clientes de sus sucursales.
//  · Las usa cualquiera que pueda cotizar a ese cliente (edita cotizaciones u órdenes y ve al cliente).
//  · Quitar = desactivar: nunca se borran, y cada cambio queda en la bitácora del cliente.
const MAX_TEXTO = 10000; // el mismo límite de la descripción de una partida (validarPartidas en index.js)
const MAX_NOMBRE = 80, MAX_HUECOS = 10, MAX_ACTIVAS = 50;
const HUECO = /\{([^{}\n]{1,40})\}/g;

// Huecos de un texto, sin repetir y en el orden en que aparecen: «{sucursal}» → ['sucursal'].
function huecosDe(texto) {
  const vistos = [];
  for (const m of String(texto || '').matchAll(HUECO)) { const k = m[1].trim(); if (k && !vistos.includes(k)) vistos.push(k); }
  return vistos;
}

module.exports = function plantillasDescripcion(app, db, h, { permisos, suc, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS plantillas_descripcion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    servicio_id INTEGER REFERENCES catalogo_servicios(id),
    nombre TEXT,
    texto TEXT NOT NULL CHECK(length(texto) BETWEEN 1 AND ${MAX_TEXTO}),
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_plantillas_desc_cliente ON plantillas_descripcion(cliente_id, activo);`);

  // Dirección, o quien tiene el permiso (el Gerente) en la sucursal que dio de alta al cliente.
  const editaPlantillas = (req, clienteId) => permisos.direccion(req) || (permisos.puede(req, 'clientes.plantillas') && suc.clienteDeSuSucursal(req, clienteId));
  const usaPlantillas = req => permisos.puede(req, 'cotizaciones.editar') || permisos.puede(req, 'ordenes.editar');
  const SOLO_EDITAN = { error: 'Las descripciones guardadas del cliente las crean o cambian solo Dirección y el Gerente de su sucursal', codigo: 'PLANTILLA_SOLO_GERENTE' };

  const cliente = id => db.prepare('SELECT id FROM main.clientes WHERE id = ?').get(Number(id));
  const leer = (clienteId, id) => db.prepare(`SELECT p.*, s.nombre AS servicio_nombre FROM plantillas_descripcion p
    LEFT JOIN catalogo_servicios s ON s.id = p.servicio_id WHERE p.cliente_id = ? AND p.id = ?`).get(clienteId, Number(id));
  const vista = p => ({ id: p.id, cliente_id: p.cliente_id, servicio_id: p.servicio_id, servicio_nombre: p.servicio_nombre || null, nombre: p.nombre || '',
    texto: p.texto, huecos: huecosDe(p.texto), activo: !!p.activo, updated_at: p.updated_at });
  const resumen = p => `«${p.nombre || p.texto.replace(/\s+/g, ' ').slice(0, 60) + (p.texto.length > 60 ? '…' : '')}»`;

  // Valida y normaliza lo que llega; regresa [error] o [null, datos]. En un cambio solo se valida lo que viene.
  function datosDe(body, parcial) {
    const d = {};
    if (!parcial || body.texto !== undefined) {
      if (typeof body.texto !== 'string' || !body.texto.trim()) return ['Escribe el texto de la descripción'];
      const texto = body.texto.replace(/\r\n/g, '\n').trim();
      if (texto.length > MAX_TEXTO) return [`La descripción no puede pasar de ${MAX_TEXTO.toLocaleString('es-MX')} caracteres`];
      if (/\{\s*\}/.test(texto)) return ['Hay un hueco vacío «{}»: escribe qué va dentro, p. ej. {sucursal}'];
      if (huecosDe(texto).length > MAX_HUECOS) return [`Una descripción puede tener hasta ${MAX_HUECOS} huecos distintos`];
      d.texto = texto;
    }
    if (!parcial || body.nombre !== undefined) {
      if (body.nombre != null && typeof body.nombre !== 'string') return ['El nombre debe ser texto'];
      const nombre = String(body.nombre ?? '').replace(/\s+/g, ' ').trim();
      if (nombre.length > MAX_NOMBRE) return [`El nombre no puede pasar de ${MAX_NOMBRE} caracteres`];
      d.nombre = nombre || null;
    }
    if (!parcial || body.servicio_id !== undefined) {
      if (body.servicio_id == null || body.servicio_id === '') d.servicio_id = null;
      else {
        const s = Number(body.servicio_id);
        if (!Number.isInteger(s) || !db.prepare('SELECT 1 FROM catalogo_servicios WHERE id = ? AND activo = 1').get(s)) return ['Ese servicio no está en el catálogo'];
        d.servicio_id = s;
      }
    }
    return [null, d];
  }

  // Lista del cliente. Quien las cambia ve también las quitadas (?todas=1) para poder reactivarlas.
  app.get('/api/clientes/:id/plantillas', h((req, res) => {
    const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    const edita = editaPlantillas(req, c.id);
    if (!edita && !usaPlantillas(req)) return res.status(403).json({ error: 'Tu rol no cotiza a este cliente' });
    const todas = edita && req.query.todas === '1';
    const filas = db.prepare(`SELECT p.*, s.nombre AS servicio_nombre FROM plantillas_descripcion p LEFT JOIN catalogo_servicios s ON s.id = p.servicio_id
      WHERE p.cliente_id = ? ${todas ? '' : 'AND p.activo = 1'} ORDER BY p.activo DESC, COALESCE(p.nombre, p.texto) COLLATE NOCASE, p.id`).all(c.id);
    res.json({ puede_editar: edita, plantillas: filas.map(vista) });
  }));

  app.post('/api/clientes/:id/plantillas', h((req, res) => {
    const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!editaPlantillas(req, c.id)) return res.status(403).json(SOLO_EDITAN);
    const [error, d] = datosDe(req.body || {}, false); if (error) return res.status(400).json({ error });
    if (db.prepare('SELECT COUNT(*) n FROM plantillas_descripcion WHERE cliente_id = ? AND activo = 1').get(c.id).n >= MAX_ACTIVAS)
      return res.status(400).json({ error: `Este cliente ya tiene ${MAX_ACTIVAS} descripciones guardadas: quita alguna que ya no se use` });
    const id = db.prepare('INSERT INTO plantillas_descripcion (cliente_id, servicio_id, nombre, texto, creado_por) VALUES (?, ?, ?, ?, ?)')
      .run(c.id, d.servicio_id, d.nombre, d.texto, req.usuarioSesion.id).lastInsertRowid;
    const p = leer(c.id, id);
    audit.registrar(req, 'cliente', c.id, 'editado', `Descripción guardada creada ${resumen(p)}${p.servicio_nombre ? ' (' + p.servicio_nombre + ')' : ''}`);
    res.status(201).json(vista(p));
  }));

  app.put('/api/clientes/:id/plantillas/:pid', h((req, res) => {
    const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!editaPlantillas(req, c.id)) return res.status(403).json(SOLO_EDITAN);
    const antes = leer(c.id, req.params.pid); if (!antes) return res.status(404).json({ error: 'Descripción no encontrada' });
    if (!antes.activo) return res.status(409).json({ error: 'Esta descripción está quitada: reactívala para cambiarla' });
    const [error, d] = datosDe(req.body || {}, true); if (error) return res.status(400).json({ error });
    const cambia = Object.keys(d).filter(k => (d[k] ?? null) !== (antes[k] ?? null));
    if (!cambia.length) return res.status(400).json({ error: 'Sin cambios' });
    db.prepare(`UPDATE plantillas_descripcion SET ${cambia.map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...cambia.map(k => d[k]), antes.id);
    const p = leer(c.id, antes.id);
    const que = { texto: 'texto', nombre: 'nombre', servicio_id: 'servicio' };
    audit.registrar(req, 'cliente', c.id, 'editado', `Descripción guardada ${resumen(antes)} cambiada (${cambia.map(k => que[k]).join(', ')})`);
    res.json(vista(p));
  }));

  // Quitar (desactivar) o volver a activar; nunca se borra.
  for (const [accion, activo] of [['desactivar', 0], ['reactivar', 1]]) {
    app.post('/api/clientes/:id/plantillas/:pid/' + accion, h((req, res) => {
      const c = cliente(req.params.id); if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
      if (!editaPlantillas(req, c.id)) return res.status(403).json(SOLO_EDITAN);
      const p = leer(c.id, req.params.pid); if (!p) return res.status(404).json({ error: 'Descripción no encontrada' });
      if (p.activo === activo) return res.status(409).json({ error: activo ? 'Ya está activa' : 'Ya estaba quitada' });
      if (activo && db.prepare('SELECT COUNT(*) n FROM plantillas_descripcion WHERE cliente_id = ? AND activo = 1').get(c.id).n >= MAX_ACTIVAS)
        return res.status(400).json({ error: `Este cliente ya tiene ${MAX_ACTIVAS} descripciones guardadas: quita alguna que ya no se use` });
      db.prepare("UPDATE plantillas_descripcion SET activo = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(activo, p.id);
      audit.registrar(req, 'cliente', c.id, 'editado', `Descripción guardada ${resumen(p)} ${activo ? 'reactivada' : 'quitada'}`);
      res.json(vista(leer(c.id, p.id)));
    }));
  }

  return { huecosDe };
};
module.exports.huecosDe = huecosDe;
