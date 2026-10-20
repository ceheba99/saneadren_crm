// Bitácora general: queda registro de cada movimiento que no es de una cotización u orden de servicio (esas
// tienen su propio historial): clientes, proveedores, órdenes de compra y su expediente, usuarios, catálogos
// y registros eliminados. Nada se borra de aquí. Cada renglón dice qué pasó, a qué, quién y cuándo.

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entidad TEXT NOT NULL,          -- cliente, proveedor, orden_compra, usuario, catalogo, orden_servicio…
      entidad_id INTEGER,
      accion TEXT NOT NULL,           -- creado, editado, autorizada, cancelada, documento, eliminado…
      detalle TEXT,
      usuario_id INTEGER,
      usuario TEXT,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria(entidad, entidad_id, id);
    CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha);
  `);
}

// Etiquetas legibles de los campos que se comparan al editar.
const ETIQUETAS = {
  nombre: 'Nombre', empresa_contacto: 'Empresa', telefono: 'Teléfono', telefono_alterno: 'Teléfono alterno', correo: 'Correo', rfc: 'RFC',
  direccion: 'Dirección', giro: 'Tipo de cliente', notas_generales: 'Notas', categoria: 'Categoría', dias_credito: 'Días de crédito',
  contacto: 'Contacto', notas: 'Notas', activo: 'Activo', rol: 'Rol', responsable: 'Responsable', clave: 'Abreviatura',
  proveedor_id: 'Proveedor', centro_id: 'Centro de costos', fecha: 'Fecha', fecha_requerida: 'Fecha requerida', factura_a: 'Factura a',
  que: 'Qué se necesita', para_que: 'Para qué', urgente: 'Urgente', equipo: 'Unidad o equipo',
  nota: 'Nota', observaciones: 'Observaciones', total_cent: 'Total', iva_modo: 'IVA', solicitante_nombre: 'Solicitante', solicitante_cargo: 'Cargo', lead_id: 'Orden de servicio', proveedor_nombre: 'Proveedor', centro_nombre: 'Centro de costos',
};
const vacio = v => v === null || v === undefined || String(v).trim() === '';
const mostrar = (k, v) => {
  if (vacio(v)) return '(vacío)';
  if (k === 'total_cent') return '$' + (Number(v) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (k === 'activo') return Number(v) ? 'sí' : 'no';
  if (/^fecha/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v).split('-').reverse().join('/');
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 77) + '…' : t;
};
// «Nombre: KFC → KFC México · Teléfono: (vacío) → 4421000001». Solo los campos que sí cambiaron.
function diferencias(antes, despues, campos) {
  return campos.filter(k => k in despues && !(vacio(antes?.[k]) && vacio(despues[k])) && String(antes?.[k] ?? '') !== String(despues[k] ?? ''))
    .map(k => `${ETIQUETAS[k] || k}: ${mostrar(k, antes?.[k])} → ${mostrar(k, despues[k])}`).join(' · ');
}

module.exports = function auditoria(app, db, h) {
  migrar(db);
  const ins = db.prepare('INSERT INTO auditoria (entidad, entidad_id, accion, detalle, usuario_id, usuario) VALUES (?, ?, ?, ?, ?, ?)');
  const registrar = (req, entidad, id, accion, detalle = null) =>
    ins.run(entidad, id ?? null, accion, detalle ? String(detalle).slice(0, 2000) : null, req?.usuarioSesion?.id ?? null, req?.usuarioSesion?.nombre ?? 'Sistema');

  // Consulta: el historial de un registro (cualquier usuario con sesión) o la bitácora completa (solo administración).
  app.get('/api/auditoria', h((req, res) => {
    const { entidad, id } = req.query;
    if (entidad && id) {
      // Solo el historial de algo que quien pregunta puede ver (registros de otra sucursal «no existen»).
      const suc = app.locals.sucursales, n = Number(id);
      const VISTA = { orden_compra: 'ordenes_compra', solicitud_compra: 'solicitudes_compra', cuenta_por_pagar: 'cuentas_por_pagar' };
      const general = !!req.usuarioSesion.admin_general;
      const visible = general ? true
        : VISTA[entidad] ? !!db.prepare(`SELECT 1 FROM ${VISTA[entidad]} WHERE id = ?`).get(n)
        : entidad === 'orden_servicio' ? !!db.prepare('SELECT 1 FROM leads WHERE id = ?').get(n)
        : entidad === 'cliente' ? !!suc?.verCliente(n)
        : entidad === 'usuario' ? n === req.usuarioSesion.id || (app.locals.permisos.puede(req, 'usuarios.administrar') && !!db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(n) && suc?.puedeAdministrar(req, db.prepare('SELECT * FROM usuarios WHERE id = ?').get(n)))
        : entidad === 'personal' ? !!app.locals.permisos?.puede(req, 'personal.ver') && !!db.prepare('SELECT 1 FROM personal WHERE id = ?').get(n)
        : entidad === 'proveedor';
      if (!visible) return res.json([]);
      return res.json(db.prepare('SELECT * FROM auditoria WHERE entidad = ? AND entidad_id = ? ORDER BY id DESC LIMIT 500').all(String(entidad), Number(id)));
    }
    if (!req.usuarioSesion.admin_general) return res.status(403).json({ error: 'La bitácora completa es solo para Dirección' });
    const filtros = [], params = [];
    if (entidad) { filtros.push('entidad = ?'); params.push(String(entidad)); }
    if (req.query.desde) { filtros.push('fecha >= ?'); params.push(String(req.query.desde)); }
    if (req.query.hasta) { filtros.push('fecha < date(?, \'+1 day\')'); params.push(String(req.query.hasta)); }
    if (req.query.q) { filtros.push('(detalle LIKE ? OR usuario LIKE ? OR accion LIKE ?)'); const q = '%' + String(req.query.q).slice(0, 60) + '%'; params.push(q, q, q); }
    res.json(db.prepare(`SELECT * FROM auditoria ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`).all(...params));
  }));

  return { registrar, diferencias };
};
module.exports.diferencias = diferencias;
