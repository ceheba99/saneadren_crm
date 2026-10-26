// Solicitudes de compra: el paso ANTES de la orden de compra.
//   1. Cualquier usuario pide lo que necesita (qué y para qué, sin precios ni proveedor).
//   2. El encargado de centro de costos (rol «costos») o administración la aprueba o la rechaza.
//   3. Se suben 3 cotizaciones de 3 proveedores distintos (las sube el encargado o quien pidió).
//   4. El encargado o administración elige la ganadora y crea la orden de compra ya llena.
//      Urgente: se puede seguir con menos de 3 cotizaciones solo escribiendo por qué no puede esperar;
//      queda marcado «excepción por urgencia» (lo ve administración al autorizar) y se pueden completar después.
//   5. Al llegar lo comprado, el encargado lo marca recibido en la orden con foto y/o firma.
// Los archivos se guardan fuera del sitio web (junto a la base, en «archivos/solicitudes/»). Nada se borra.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { tipoReal } = require('./expediente-oc');

const MAX_BYTES = 10 * 1024 * 1024;
const COTIZACIONES_REQUERIDAS = 3;
const ESTADOS = { por_aprobar: 'Por aprobar', cotizando: 'Cotizando', elegida: 'Cotización elegida', con_orden: 'Con orden de compra', recibida: 'Recibida', rechazada: 'Rechazada', cancelada: 'Cancelada' };
const ABIERTAS = ['por_aprobar', 'cotizando', 'elegida'];
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
const folioSol = s => require('./sucursales').folio('SOL', 'solicitudes_compra', s.id, s.created_at);
const nombreSeguro = t => String(t || 'documento').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'documento';
const llave = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
// Número escrito como número: «1500», «1,500.50», «$ 1,500». Nada de «0x10», «1e3», «Infinity» ni texto.
const numeroEscrito = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const t = v.trim().replace(/^\$\s*/, '');
  return /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, '')) : NaN;
};
const encabezado = (req, k) => { try { return decodeURIComponent(String(req.get(k) || '')); } catch { return ''; } };

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS solicitudes_compra (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      que TEXT NOT NULL, para_que TEXT NOT NULL,
      urgente INTEGER NOT NULL DEFAULT 0 CHECK(urgente IN (0, 1)),
      fecha_requerida TEXT,
      centro_id INTEGER NOT NULL REFERENCES centros_costo(id),
      equipo TEXT,
      lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
      estado TEXT NOT NULL DEFAULT 'por_aprobar' CHECK(estado IN ('por_aprobar','cotizando','elegida','con_orden','recibida','rechazada','cancelada')),
      solicitante_id INTEGER NOT NULL REFERENCES usuarios(id), solicitante_nombre TEXT NOT NULL,
      aprobada_por TEXT, aprobada_at TEXT,
      ganadora_id INTEGER, elegida_por TEXT, elegida_at TEXT, excepcion_motivo TEXT,
      oc_id INTEGER REFERENCES ordenes_compra(id),
      cerrada_por TEXT, cerrada_at TEXT, motivo_cierre TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes_compra(estado, id);
    CREATE TABLE IF NOT EXISTS documentos_solicitud (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL REFERENCES solicitudes_compra(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('cotizacion', 'foto')),
      proveedor_id INTEGER REFERENCES proveedores(id), monto_cent INTEGER, entrega TEXT, nota TEXT,
      nombre TEXT NOT NULL, archivo TEXT NOT NULL, formato TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      subido_por INTEGER, subido_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      eliminado INTEGER NOT NULL DEFAULT 0, eliminado_por TEXT, eliminado_at TEXT, motivo_eliminado TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documentos_solicitud ON documentos_solicitud(solicitud_id);
  `);
  if (!db.prepare('PRAGMA table_info(solicitudes_compra)').all().some(c => c.name === 'motivo_eleccion')) db.exec('ALTER TABLE solicitudes_compra ADD COLUMN motivo_eleccion TEXT');
}

module.exports = function solicitudes(app, db, h, { texto, fechaOk, hoyMexico, conSentido, folioOC, agregarDocumentoOC }) {
  migrar(db);
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'solicitudes');
  const esCostos = req => app.locals.permisos.puede(req, 'compras.gestionar');
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'solicitud_compra', id, accion, detalle);
  const fmt = c => '$' + (Number(c || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ahora = () => db.prepare("SELECT datetime('now','localtime') AS t").get().t;
  const NO_COSTOS = { error: 'Esto lo hace el encargado de centro de costos o administración' };

  const SQL = `SELECT s.*, c.nombre AS centro_nombre, c.responsable AS centro_responsable, o.estado AS oc_estado, o.created_at AS oc_created_at, o.recibida_at AS oc_recibida_at
    FROM solicitudes_compra s JOIN centros_costo c ON c.id = s.centro_id LEFT JOIN ordenes_compra o ON o.id = s.oc_id`;
  const cotizaciones = id => db.prepare(`SELECT d.id, d.proveedor_id, p.nombre AS proveedor_nombre, d.monto_cent, d.entrega, d.nota, d.nombre, d.formato, d.subido_por, d.subido_por_nombre, d.created_at
      FROM documentos_solicitud d LEFT JOIN proveedores p ON p.id = d.proveedor_id WHERE d.solicitud_id = ? AND d.tipo = 'cotizacion' AND d.eliminado = 0 ORDER BY d.monto_cent, d.id`).all(id)
    .map(c => ({ ...c, monto: c.monto_cent / 100 }));
  const proveedoresDistintos = cots => new Set(cots.map(c => c.proveedor_id)).size;
  function describir(s, completo = false) {
    const cots = cotizaciones(s.id), distintos = proveedoresDistintos(cots);
    const r = { ...s, folio: folioSol(s), estado_nombre: ESTADOS[s.estado], urgente: !!s.urgente, oc_folio: s.oc_id ? folioOC({ id: s.oc_id, created_at: s.oc_created_at }) : null,
      cotizaciones_count: distintos, cotizaciones_faltan: Math.max(0, COTIZACIONES_REQUERIDAS - distintos), requeridas: COTIZACIONES_REQUERIDAS,
      ganadora: cots.find(c => c.id === s.ganadora_id) || null, mas_barata_id: cots[0]?.id ?? null };
    if (completo) {
      r.cotizaciones = cots;
      r.fotos = db.prepare("SELECT id, nombre, formato, subido_por_nombre, created_at FROM documentos_solicitud WHERE solicitud_id = ? AND tipo = 'foto' AND eliminado = 0 ORDER BY id").all(s.id);
      r.historial = db.prepare("SELECT * FROM auditoria WHERE entidad = 'solicitud_compra' AND entidad_id = ? ORDER BY id DESC").all(s.id);
    }
    return r;
  }
  const leer = (id, completo = true) => { const s = db.prepare(SQL + ' WHERE s.id = ?').get(id); return s ? describir(s, completo) : null; };
  const actualizar = (id, campos) => {
    const k = Object.keys(campos);
    db.prepare(`UPDATE main.solicitudes_compra SET ${k.map(x => x + ' = ?').join(', ')}, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?`).run(...k.map(x => campos[x]), id);
  };

  function validar(b, antes) {
    const que = texto(b.que, 500), para = texto(b.para_que, 500);
    if (!que || !conSentido(que, 3) || /[<>{}]/.test(que)) return { error: 'Escribe qué necesitas (ej. 4 llantas 11R22.5)' };
    if (!para || !conSentido(para, 5) || /[<>{}]/.test(para)) return { error: 'Escribe para qué lo necesitas (mínimo 5 letras)' };
    const centro = db.prepare('SELECT id FROM centros_costo WHERE id = ? AND (activo = 1 OR id = ?)').get(Number(b.centro_id) || 0, antes?.centro_id ?? -1);
    if (!centro) return { error: 'Elige el centro de costos (el área que lo necesita)' };
    const fecha = b.fecha_requerida || null;
    if (fecha && !fechaOk(fecha)) return { error: 'La fecha para cuándo no es válida' };
    if (fecha && fecha < (antes ? String(antes.created_at).slice(0, 10) : hoyMexico())) return { error: 'La fecha para cuándo no puede ser en el pasado' };
    let leadId = null;
    if (b.lead_id) { const l = require('./finanzas').ordenParaLigar(b.lead_id); if (!l) return { error: 'La orden de servicio relacionada no existe' }; leadId = l.id; }
    const equipo = texto(b.equipo, 80);
    if (equipo && /[<>{}]/.test(equipo)) return { error: 'Revisa la unidad o equipo' };
    return { datos: { que, para_que: para, urgente: b.urgente ? 1 : 0, fecha_requerida: fecha, centro_id: centro.id, equipo, lead_id: leadId } };
  }

  // ----- Lista y detalle (todos los usuarios con sesión) -----
  app.get('/api/compras/solicitudes', h((req, res) => {
    let filas = db.prepare(SQL + ' ORDER BY s.id DESC').all().map(s => describir(s));
    const e = String(req.query.estado || '');
    if (e === 'abiertas') filas = filas.filter(s => ABIERTAS.includes(s.estado));
    else if (e === 'mias') filas = filas.filter(s => s.solicitante_id === req.usuarioSesion.id);
    else if (ESTADOS[e]) filas = filas.filter(s => s.estado === e);
    const q = llave(req.query.q);
    if (q) filas = filas.filter(s => [s.folio, s.que, s.para_que, s.centro_nombre, s.solicitante_nombre, s.equipo, s.oc_folio].some(v => llave(v).includes(q)));
    res.json(filas);
  }));
  app.get('/api/compras/solicitudes/:id', h((req, res) => {
    const s = leer(req.params.id);
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    res.json(s);
  }));

  // ----- Crear (cualquier usuario) y corregir -----
  app.post('/api/compras/solicitudes', h((req, res) => {
    if (!app.locals.permisos.puede(req, 'solicitudes.editar')) return res.status(403).json({ error: 'Tu rol no hace solicitudes de compra' });
    const v = validar(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.datos;
    // La misma solicitud dos veces (doble clic o se volvió a pedir): se pregunta antes.
    if (!req.body.forzar) {
      const igual = db.prepare(`SELECT id, created_at, que FROM solicitudes_compra WHERE solicitante_id = ? AND estado IN ('por_aprobar','cotizando','elegida') AND created_at >= datetime('now','localtime','-7 days')`).all(req.usuarioSesion.id)
        .find(s => llave(s.que) === llave(d.que));
      if (igual) return res.status(409).json({ error: `Ya pediste lo mismo en ${folioSol(igual)} y sigue abierta. ¿Es otra necesidad?`, codigo: 'POSIBLE_DUPLICADO', solicitud_id: igual.id });
    }
    const info = db.prepare(`INSERT INTO main.solicitudes_compra (que, para_que, urgente, fecha_requerida, centro_id, equipo, lead_id, solicitante_id, solicitante_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(d.que, d.para_que, d.urgente, d.fecha_requerida, d.centro_id, d.equipo, d.lead_id, req.usuarioSesion.id, req.usuarioSesion.nombre);
    app.locals.sucursales.asignar('solicitudes_compra', Number(info.lastInsertRowid), d.lead_id ? app.locals.sucursales.de('leads', d.lead_id) : undefined);
    const s = leer(info.lastInsertRowid);
    audit(req, s.id, 'creada', `${s.folio} · ${s.que} · para: ${s.para_que} · ${s.centro_nombre}${s.urgente ? ' · URGENTE' : ''}${s.fecha_requerida ? ' · para el ' + s.fecha_requerida.split('-').reverse().join('/') : ''}${req.body.forzar ? ' · se confirmó que no es repetida' : ''}`);
    res.status(201).json(s);
  }));
  app.put('/api/compras/solicitudes/:id', h((req, res) => {
    const s = leer(req.params.id, false);
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const propia = s.solicitante_id === req.usuarioSesion.id;
    if (!(propia && s.estado === 'por_aprobar') && !(esCostos(req) && ['por_aprobar', 'cotizando'].includes(s.estado)))
      return res.status(403).json({ error: s.estado === 'por_aprobar' ? 'Solo quien la pidió o el encargado de centro de costos puede corregirla' : 'Ya no se puede corregir: ' + ESTADOS[s.estado].toLowerCase() });
    if (req.body.version !== undefined && Number(req.body.version) !== s.version) return res.status(409).json({ error: 'Otra persona modificó esta solicitud. Ciérrala y vuelve a abrirla.' });
    const v = validar(req.body || {}, s);
    if (v.error) return res.status(400).json({ error: v.error });
    actualizar(s.id, v.datos);
    const despues = leer(s.id);
    const cambios = app.locals.auditoria?.diferencias(s, despues, ['que', 'para_que', 'urgente', 'fecha_requerida', 'centro_nombre', 'equipo', 'lead_id']);
    if (cambios) audit(req, s.id, 'editada', cambios);
    res.json(despues);
  }));

  // ----- Aprobar / rechazar (encargado de centro de costos o administración) y cancelar -----
  app.post('/api/compras/solicitudes/:id/aprobar', h((req, res) => {
    if (!esCostos(req)) return res.status(403).json(NO_COSTOS);
    const s = leer(req.params.id, false);
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (s.estado !== 'por_aprobar') return res.status(409).json({ error: 'Esta solicitud ya no está por aprobar (' + ESTADOS[s.estado].toLowerCase() + ')' });
    // Nadie se aprueba a sí mismo: si el encargado pidió algo, lo aprueba un administrador (u otro encargado).
    if (s.solicitante_id === req.usuarioSesion.id && !app.locals.permisos.puede(req, 'compras.aprobar_propias')) return res.status(403).json({ error: 'Tú pediste esta solicitud: la aprueba un administrador u otro encargado de centro de costos' });
    actualizar(s.id, { estado: 'cotizando', aprobada_por: req.usuarioSesion.nombre, aprobada_at: ahora() });
    audit(req, s.id, 'aprobada', `Pasa a cotizar: se piden ${COTIZACIONES_REQUERIDAS} cotizaciones de proveedores distintos`);
    res.json(leer(s.id));
  }));
  const cerrar = (estado, accion) => h((req, res) => {
    const s = leer(req.params.id, false);
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const motivo = texto(req.body?.motivo, 300);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe el motivo (mínimo 5 letras)' });
    if (estado === 'rechazada') {
      if (!esCostos(req)) return res.status(403).json(NO_COSTOS);
      if (!['por_aprobar', 'cotizando'].includes(s.estado)) return res.status(409).json({ error: 'Ya no se puede rechazar: ' + ESTADOS[s.estado].toLowerCase() });
    } else {
      if (!esCostos(req) && s.solicitante_id !== req.usuarioSesion.id) return res.status(403).json({ error: 'Solo quien la pidió o el encargado de centro de costos puede cancelarla' });
      if (!ABIERTAS.includes(s.estado)) return res.status(409).json({ error: s.oc_id ? 'Ya tiene orden de compra: cancela primero la orden' : 'Ya no se puede cancelar: ' + ESTADOS[s.estado].toLowerCase() });
    }
    actualizar(s.id, { estado, cerrada_por: req.usuarioSesion.nombre, cerrada_at: ahora(), motivo_cierre: motivo });
    audit(req, s.id, accion, 'Motivo: ' + motivo);
    res.json(leer(s.id));
  });
  app.post('/api/compras/solicitudes/:id/rechazar', cerrar('rechazada', 'rechazada'));
  app.post('/api/compras/solicitudes/:id/cancelar', cerrar('cancelada', 'cancelada'));

  // ----- Cotizaciones y fotos: el cuerpo es el archivo tal cual; los datos van en encabezados -----
  app.post('/api/compras/solicitudes/:id/documentos', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    const s = leer(req.params.id, false);
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const tipo = String(req.get('x-tipo') || '');
    if (!['cotizacion', 'foto'].includes(tipo)) return res.status(400).json({ error: 'Indica si es cotización o foto' });
    const propia = s.solicitante_id === req.usuarioSesion.id;
    if (!propia && !esCostos(req)) return res.status(403).json({ error: 'Las cotizaciones las suben quien pidió o el encargado de centro de costos' });
    let proveedor = null, monto = null;
    if (tipo === 'cotizacion') {
      // Se cotiza mientras está «cotizando». Si se siguió por urgencia con menos de 3, se pueden completar después.
      const completar = s.excepcion_motivo && ['elegida', 'con_orden', 'recibida'].includes(s.estado) && s.cotizaciones_faltan > 0;
      if (s.estado !== 'cotizando' && !completar) return res.status(409).json({ error: s.estado === 'por_aprobar' ? 'Primero se aprueba la solicitud; después se cotiza' : 'Ya no se agregan cotizaciones: ' + ESTADOS[s.estado].toLowerCase() });
      proveedor = db.prepare('SELECT id, nombre FROM proveedores WHERE id = ? AND activo = 1').get(Number(encabezado(req, 'x-proveedor')) || 0);
      if (!proveedor) return res.status(400).json({ error: 'Elige el proveedor de la cotización' });
      const ya = db.prepare("SELECT id FROM documentos_solicitud WHERE solicitud_id = ? AND tipo = 'cotizacion' AND eliminado = 0 AND proveedor_id = ?").get(s.id, proveedor.id);
      if (ya) return res.status(409).json({ error: `Ya hay una cotización de ${proveedor.nombre}. Las ${COTIZACIONES_REQUERIDAS} deben ser de proveedores distintos (si es una nueva, quita la anterior).` });
      monto = numeroEscrito(encabezado(req, 'x-monto'));
      if (!Number.isFinite(monto) || monto <= 0 || monto > 1e8 || Math.abs(monto * 100 - Math.round(monto * 100)) > 1e-6) return res.status(400).json({ error: 'Escribe el total de la cotización (mayor a $0, máximo 2 decimales)' });
    } else if (['rechazada', 'cancelada'].includes(s.estado)) return res.status(409).json({ error: 'La solicitud está ' + ESTADOS[s.estado].toLowerCase() });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: tipo === 'cotizacion' ? 'Adjunta el archivo de la cotización (PDF o foto)' : 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'El archivo pasa de 10 MB' });
    const formato = tipoReal(buf);
    if (!['pdf', 'jpg', 'png'].includes(formato)) return res.status(400).json({ error: tipo === 'foto' ? 'La foto debe ser JPG o PNG (o un PDF)' : 'La cotización debe ser PDF, JPG o PNG' });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const repetido = db.prepare('SELECT solicitud_id FROM documentos_solicitud WHERE sha256 = ? AND eliminado = 0').get(sha);
    if (repetido) {
      const otra = db.prepare('SELECT id, created_at FROM solicitudes_compra WHERE id = ?').get(repetido.solicitud_id);
      return res.status(409).json({ error: otra.id === s.id ? 'Ese mismo archivo ya está en esta solicitud (cada cotización es un archivo distinto)' : `Ese mismo archivo ya está en la solicitud ${folioSol(otra)}` });
    }
    const nombre = nombreSeguro(encabezado(req, 'x-nombre'));
    const entrega = texto(encabezado(req, 'x-entrega'), 80), nota = texto(encabezado(req, 'x-nota'), 300);
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO main.documentos_solicitud (solicitud_id, tipo, proveedor_id, monto_cent, entrega, nota, nombre, archivo, formato, bytes, sha256, subido_por, subido_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.id, tipo, proveedor?.id ?? null, monto == null ? null : Math.round(monto * 100), entrega, nota, nombre, '', formato, buf.length, sha, req.usuarioSesion.id, req.usuarioSesion.nombre);
      const archivo = path.join(String(s.id), `${r.lastInsertRowid}-${sha.slice(0, 12)}.${formato}`);
      fs.mkdirSync(path.join(DIR, String(s.id)), { recursive: true });
      fs.writeFileSync(path.join(DIR, archivo), buf);
      db.prepare('UPDATE main.documentos_solicitud SET archivo = ? WHERE id = ?').run(archivo, r.lastInsertRowid);
      return r.lastInsertRowid;
    })();
    const despues = leer(s.id);
    audit(req, s.id, tipo === 'cotizacion' ? 'cotización' : 'foto', tipo === 'cotizacion'
      ? `${proveedor.nombre}: ${fmt(Math.round(monto * 100))}${entrega ? ' · entrega ' + entrega : ''} · «${nombre}» · van ${despues.cotizaciones_count} de ${COTIZACIONES_REQUERIDAS}`
      : `«${nombre}»`);
    res.status(201).json({ id, solicitud: despues });
  }));
  app.get('/api/compras/solicitudes/documentos/:id', h((req, res) => {
    const d = db.prepare('SELECT * FROM documentos_solicitud WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    const ruta = path.join(DIR, d.archivo);
    if (!ruta.startsWith(DIR) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.set({ 'Content-Type': MIME[d.formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="documento.${d.formato}"; filename*=UTF-8''${encodeURIComponent(d.nombre)}` });
    res.send(fs.readFileSync(ruta));
  }));
  app.post('/api/compras/solicitudes/documentos/:id/quitar', h((req, res) => {
    const d = db.prepare('SELECT * FROM documentos_solicitud WHERE id = ? AND eliminado = 0').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    const s = leer(d.solicitud_id, false);
    if (s.ganadora_id === d.id) return res.status(409).json({ error: 'Es la cotización elegida: no se puede quitar' });
    if (!esCostos(req) && !(d.subido_por === req.usuarioSesion.id && ABIERTAS.includes(s.estado))) return res.status(403).json({ error: 'Solo quien lo subió (mientras la solicitud está abierta) o el encargado de centro de costos puede quitarlo' });
    const motivo = texto(req.body?.motivo, 300);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe por qué se quita (mínimo 5 letras)' });
    db.prepare("UPDATE main.documentos_solicitud SET eliminado = 1, eliminado_por = ?, eliminado_at = datetime('now','localtime'), motivo_eliminado = ? WHERE id = ?").run(req.usuarioSesion.nombre, motivo, d.id);
    const prov = d.proveedor_id ? db.prepare('SELECT nombre FROM proveedores WHERE id = ?').get(d.proveedor_id)?.nombre : null;
    audit(req, s.id, d.tipo === 'cotizacion' ? 'cotización quitada' : 'foto quitada', `${prov ? prov + ' ' + fmt(d.monto_cent) + ' · ' : ''}«${d.nombre}» · motivo: ${motivo}`);
    res.json({ ok: true, solicitud: leer(s.id) });
  }));

  // ----- Elegir la cotización ganadora -----
  app.post('/api/compras/solicitudes/:id/elegir', h((req, res) => {
    if (!esCostos(req)) return res.status(403).json(NO_COSTOS);
    const s = leer(req.params.id, false);
    if (!s) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (!['cotizando', 'elegida'].includes(s.estado)) return res.status(409).json({ error: s.estado === 'por_aprobar' ? 'Primero se aprueba la solicitud' : 'Ya no se puede cambiar la cotización: ' + ESTADOS[s.estado].toLowerCase() });
    const cots = cotizaciones(s.id), c = cots.find(x => x.id === Number(req.body?.cotizacion_id));
    if (!c) return res.status(400).json({ error: 'Elige una de las cotizaciones de esta solicitud' });
    // Regla: 3 cotizaciones de proveedores distintos. Excepción solo por urgencia, con el motivo por escrito.
    const faltan = Math.max(0, COTIZACIONES_REQUERIDAS - proveedoresDistintos(cots));
    let excepcion = null;
    if (faltan) {
      excepcion = texto(req.body?.motivo_urgencia, 300);
      if (!excepcion || !conSentido(excepcion, 10)) return res.status(409).json({ error: `Faltan ${faltan} cotización(es): se piden ${COTIZACIONES_REQUERIDAS} de proveedores distintos. Si es urgente y no puede esperar, escribe por qué (mínimo 10 letras).`, codigo: 'FALTAN_COTIZACIONES', faltan });
    }
    // Si no es la más barata, se escribe por qué (entrega, calidad, garantía…).
    const mas_barata = cots[0];
    let motivoEleccion = null;
    if (c.monto_cent > mas_barata.monto_cent) {
      motivoEleccion = texto(req.body?.motivo_eleccion, 300);
      if (!motivoEleccion || !conSentido(motivoEleccion, 10)) return res.status(409).json({ error: `No es la más barata (${mas_barata.proveedor_nombre} cotizó ${fmt(mas_barata.monto_cent)}). Escribe por qué se elige esta (mínimo 10 letras).`, codigo: 'MOTIVO_ELECCION' });
    }
    actualizar(s.id, { estado: 'elegida', ganadora_id: c.id, elegida_por: req.usuarioSesion.nombre, elegida_at: ahora(), motivo_eleccion: motivoEleccion,
      excepcion_motivo: excepcion, ...(excepcion ? { urgente: 1 } : {}) });
    audit(req, s.id, 'cotización elegida', `${c.proveedor_nombre}: ${fmt(c.monto_cent)}${mas_barata.id !== c.id ? ` (no es la más barata: ${mas_barata.proveedor_nombre} ${fmt(mas_barata.monto_cent)}; motivo: ${motivoEleccion})` : ' (la más barata)'}`
      + (excepcion ? ` · EXCEPCIÓN POR URGENCIA con ${COTIZACIONES_REQUERIDAS - faltan} de ${COTIZACIONES_REQUERIDAS} cotizaciones: ${excepcion}` : ''));
    res.json(leer(s.id));
  }));

  // ----- Enlace con la orden de compra (lo usa server/compras.js) -----
  // ¿Se puede crear la orden desde esta solicitud? Devuelve { error, status } o { solicitud, ganadora }.
  function paraOrden(id) {
    const s = leer(id, false);
    if (!s) return { error: 'La solicitud no existe', status: 400 };
    if (s.estado !== 'elegida') return { error: s.oc_id ? `La solicitud ${s.folio} ya tiene la orden ${s.oc_folio}` : `La solicitud ${s.folio} aún no tiene cotización elegida`, status: 409 };
    return { solicitud: s, ganadora: s.ganadora };
  }
  function vincular(req, solicitudId, oc) {
    const s = leer(solicitudId, false);
    actualizar(s.id, { estado: 'con_orden', oc_id: oc.id });
    audit(req, s.id, 'orden de compra', `Se creó ${oc.folio} con ${oc.proveedor_nombre} por ${fmt(oc.total_cent)}`);
    // La cotización ganadora pasa sola al expediente de la orden.
    const d = db.prepare('SELECT * FROM documentos_solicitud WHERE id = ?').get(s.ganadora_id);
    const ruta = d && path.join(DIR, d.archivo);
    if (ruta && ruta.startsWith(DIR) && fs.existsSync(ruta)) {
      try { agregarDocumentoOC(req, oc, 'cotizacion', d.nombre, fs.readFileSync(ruta), `Cotización elegida en ${s.folio}`); } catch { /* si ya estaba, no pasa nada */ }
    }
  }
  // Orden cancelada: la solicitud regresa a «cotización elegida» para poder hacer otra orden.
  function ordenCancelada(req, oc) {
    const s = db.prepare('SELECT * FROM solicitudes_compra WHERE oc_id = ?').get(oc.id);
    if (!s) return;
    actualizar(s.id, { estado: 'elegida', oc_id: null });
    audit(req, s.id, 'orden cancelada', `${oc.folio} se canceló; la solicitud queda lista para otra orden`);
  }
  function ordenRecibida(req, oc, detalle) {
    const s = db.prepare('SELECT * FROM solicitudes_compra WHERE oc_id = ?').get(oc.id);
    if (!s) return;
    actualizar(s.id, { estado: 'recibida' });
    audit(req, s.id, 'recibida', `${oc.folio}: ${detalle}`);
  }
  // Se deshizo la recepción de su orden: la solicitud vuelve a «con orden de compra».
  function recepcionDeshecha(req, oc, motivo) {
    const s = db.prepare('SELECT * FROM solicitudes_compra WHERE oc_id = ?').get(oc.id);
    if (!s || s.estado !== 'recibida') return;
    actualizar(s.id, { estado: 'con_orden' });
    audit(req, s.id, 'recepción deshecha', `${oc.folio}: ${motivo}`);
  }
  return { paraOrden, vincular, ordenCancelada, ordenRecibida, recepcionDeshecha, folioSol, COTIZACIONES_REQUERIDAS };
};
module.exports.folioSol = folioSol;
