// PROYECTOS Y TAREAS CON GANTT (2026-11-11, aprobado por Dirección).
//  · Asignan Dirección y quien tiene «Asignar tareas» (tareas.asignar: el Gerente), este solo a gente de sus sucursales.
//    Cada tarea: a quién, inicio y entrega, prioridad, descripción, hito, de qué otra depende y proyecto (opcional).
//  · La persona asignada la ve en Inicio («Mis tareas») y en su pantalla: actualiza su avance, comenta, adjunta (PDF,
//    JPG o PNG) y la marca «terminada»; no cambia fechas ni se la pasa a otro. Quien asignó la acepta o la regresa.
//  · Avisos: al asignarla, en Inicio y por correo; un día antes de la entrega se le recuerda (correo); si se vence, se le
//    avisa a quien la asignó (correo). Cada aviso una sola vez. Nada se borra: una tarea o proyecto se cancela con motivo.
//  · Quién ve qué: quien asigna ve las tareas de sus sucursales; cada quien ve las suyas (aunque sean de otra sucursal).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), express = require('express');
const { hoyMexico, ahoraMexico } = require('./fechas');
const { tipoReal } = require('./expediente-oc');
const PRIORIDADES = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const ESTADOS = { pendiente: 'Pendiente', en_proceso: 'En proceso', por_revisar: 'Por revisar', terminada: 'Terminada', cancelada: 'Cancelada' };
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaOk = f => FECHA.test(f || '') && !Number.isNaN(Date.parse(f + 'T12:00:00Z')) && new Date(f + 'T12:00:00Z').toISOString().slice(0, 10) === f;

module.exports = function tareas(app, db, h) {
  const P = app.locals.permisos;
  const correo = require('./correo');
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'tareas');
  const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const conSentido = (t, min) => (String(t ?? '').match(/[\p{L}\p{N}]/gu) || []).length >= min;
  const dma = f => String(f || '').slice(0, 10).split('-').reverse().join('/');
  const yo = req => req.usuarioSesion.id;

  db.exec(`CREATE TABLE IF NOT EXISTS proyectos_tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 120), descripcion TEXT,
    sucursal_id INTEGER REFERENCES sucursales(id),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo', 'terminado', 'cancelado')),
    creado_por INTEGER NOT NULL REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    cancelado_por INTEGER REFERENCES usuarios(id), motivo_cancelacion TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id INTEGER REFERENCES proyectos_tareas(id),
    titulo TEXT NOT NULL CHECK(length(trim(titulo)) BETWEEN 3 AND 160), descripcion TEXT,
    asignado_a INTEGER NOT NULL REFERENCES usuarios(id), asignado_por INTEGER NOT NULL REFERENCES usuarios(id),
    sucursal_id INTEGER REFERENCES sucursales(id),
    inicio TEXT NOT NULL CHECK(length(inicio) = 10), fin TEXT NOT NULL CHECK(length(fin) = 10 AND fin >= inicio),
    prioridad TEXT NOT NULL DEFAULT 'media' CHECK(prioridad IN ('alta', 'media', 'baja')),
    es_hito INTEGER NOT NULL DEFAULT 0 CHECK(es_hito IN (0, 1)),
    depende_de INTEGER REFERENCES tareas(id),
    avance INTEGER NOT NULL DEFAULT 0 CHECK(avance BETWEEN 0 AND 100),
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'en_proceso', 'por_revisar', 'terminada', 'cancelada')),
    terminada_at TEXT, revisada_por INTEGER REFERENCES usuarios(id), revisada_at TEXT,
    cancelada_por INTEGER REFERENCES usuarios(id), motivo_cancelacion TEXT,
    recordada_at TEXT, vencida_avisada_at TEXT, correo_asignacion_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT, version INTEGER NOT NULL DEFAULT 1,
    CHECK(estado <> 'cancelada' OR (cancelada_por IS NOT NULL AND COALESCE(length(trim(motivo_cancelacion)), 0) >= 5))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS tarea_comentarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id INTEGER NOT NULL REFERENCES tareas(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    tipo TEXT NOT NULL DEFAULT 'comentario' CHECK(tipo IN ('comentario', 'avance', 'terminada', 'aceptada', 'regresada', 'cambio', 'archivo', 'cancelada')),
    texto TEXT, archivo TEXT, archivo_nombre TEXT, formato TEXT, bytes INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tareas_asignado ON tareas(asignado_a, estado)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tareas_proyecto ON tareas(proyecto_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tarea_comentarios ON tarea_comentarios(tarea_id)');
  { const t = (n, c) => { db.exec(`DROP TRIGGER IF EXISTS ${n}`); db.exec(`CREATE TRIGGER ${n} ${c}`); };
    t('tareas_sin_borrar', `BEFORE DELETE ON tareas BEGIN SELECT RAISE(ABORT, 'Las tareas no se borran: se cancelan'); END`);
    t('proyectos_tareas_sin_borrar', `BEFORE DELETE ON proyectos_tareas BEGIN SELECT RAISE(ABORT, 'Los proyectos no se borran: se cancelan'); END`);
    t('tarea_comentarios_sin_borrar', `BEFORE DELETE ON tarea_comentarios BEGIN SELECT RAISE(ABORT, 'El historial de una tarea no se borra'); END`); }

  const asigna = req => P.direccion(req) || P.puede(req, 'tareas.asignar');
  const enAlcance = s => !!db.prepare('SELECT en_alcance(?) v').get(s).v;
  const sucursalesDe = uid => db.prepare('SELECT sucursal_id FROM usuario_sucursales WHERE usuario_id = ?').all(uid).map(r => r.sucursal_id);
  const usuario = id => db.prepare('SELECT id, nombre, correo, rol, activo FROM usuarios WHERE id = ?').get(Number(id) || 0);
  // ¿A quién le puede asignar? Dirección: a cualquiera activo; el Gerente: a quien tenga alguna de sus sucursales.
  const puedeAsignarA = (req, u) => !!u && u.activo === 1 && (P.direccion(req) || sucursalesDe(u.id).some(s => req.alcanceSuc?.permitidas?.includes(s)));
  const leer = id => db.prepare(`SELECT t.*, ua.nombre AS asignado, up.nombre AS asigno, p.nombre AS proyecto FROM main.tareas t JOIN main.usuarios ua ON ua.id = t.asignado_a
    JOIN main.usuarios up ON up.id = t.asignado_por LEFT JOIN main.proyectos_tareas p ON p.id = t.proyecto_id WHERE t.id = ?`).get(Number(id) || 0);
  // La ve quien la tiene asignada, quien la asignó y quien asigna en esa sucursal.
  const ve = (req, t) => !!t && (t.asignado_a === yo(req) || t.asignado_por === yo(req) || (asigna(req) && enAlcance(t.sucursal_id)));
  const manda = (req, t) => !!t && (P.direccion(req) || (asigna(req) && (t.asignado_por === yo(req) || enAlcance(t.sucursal_id))));
  const nota = (tareaId, uid, tipo, txt) => db.prepare('INSERT INTO main.tarea_comentarios (tarea_id, usuario_id, tipo, texto) VALUES (?, ?, ?, ?)').run(tareaId, uid, tipo, txt);
  const vencida = t => !['terminada', 'cancelada'].includes(t.estado) && t.fin < hoyMexico();
  const fila = (req, t) => ({ id: t.id, titulo: t.titulo, descripcion: t.descripcion || '', proyecto_id: t.proyecto_id, proyecto: t.proyecto || '', asignado_a: t.asignado_a, asignado: t.asignado, asigno: t.asigno,
    inicio: t.inicio, fin: t.fin, prioridad: t.prioridad, es_hito: !!t.es_hito, depende_de: t.depende_de, avance: t.avance, estado: t.estado, vencida: vencida(t),
    es_mia: t.asignado_a === yo(req), puede_mandar: manda(req, t), terminada_at: t.terminada_at || '', motivo_cancelacion: t.motivo_cancelacion || '', version: t.version });

  const enviarCorreo = async (uid, asunto, mensaje) => {
    const u = usuario(uid); if (!u?.correo || !correo.configurado) return false;
    try { await correo.enviar(u.correo, asunto, { titulo: asunto, saludo: `Hola, ${u.nombre}:`, mensaje, enlace: (process.env.APP_URL || '').replace(/\/$/, '') + '/', boton: 'Abrir mis tareas', pie: 'Lo manda el CRM de Saneadren.' }); return true; }
    catch { return false; }
  };

  // ---------- Lista (para la pantalla y el Gantt) ----------
  // vista: mias (las mías), equipo (las de mis sucursales, si asigno), todas (las dos). Con proyecto o persona para filtrar.
  app.get('/api/tareas', h((req, res) => {
    const vista = ['mias', 'equipo', 'todas'].includes(req.query.vista) ? req.query.vista : 'todas', ab = asigna(req);
    const estado = req.query.estado === 'cerradas' ? "t.estado IN ('terminada', 'cancelada')" : req.query.estado === 'todas' ? '1 = 1' : "t.estado NOT IN ('terminada', 'cancelada')";
    const filtros = [], params = [];
    if (vista === 'mias' || !ab) { filtros.push('t.asignado_a = ?'); params.push(yo(req)); }
    else if (vista === 'equipo') filtros.push('(en_alcance(t.sucursal_id) OR t.asignado_por = ?)'), params.push(yo(req));
    else { filtros.push('(t.asignado_a = ? OR en_alcance(t.sucursal_id) OR t.asignado_por = ?)'); params.push(yo(req), yo(req)); }
    if (req.query.proyecto) { filtros.push('t.proyecto_id = ?'); params.push(Number(req.query.proyecto)); }
    if (req.query.persona && ab) { filtros.push('t.asignado_a = ?'); params.push(Number(req.query.persona)); }
    const lista = db.prepare(`SELECT t.*, ua.nombre AS asignado, up.nombre AS asigno, p.nombre AS proyecto FROM main.tareas t JOIN main.usuarios ua ON ua.id = t.asignado_a
      JOIN main.usuarios up ON up.id = t.asignado_por LEFT JOIN main.proyectos_tareas p ON p.id = t.proyecto_id WHERE ${estado} AND ${filtros.join(' AND ')} ORDER BY t.inicio, t.fin, t.id LIMIT 500`).all(...params);
    const proyectos = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM main.tareas x WHERE x.proyecto_id = p.id AND x.estado <> 'cancelada') AS tareas,
        (SELECT COALESCE(ROUND(AVG(x.avance)), 0) FROM main.tareas x WHERE x.proyecto_id = p.id AND x.estado <> 'cancelada') AS avance FROM main.proyectos_tareas p
      WHERE p.estado = 'activo' AND (${ab ? 'en_alcance(p.sucursal_id) OR ' : ''}EXISTS (SELECT 1 FROM main.tareas x WHERE x.proyecto_id = p.id AND x.asignado_a = ?)) ORDER BY p.nombre`).all(yo(req));
    const equipo = ab ? db.prepare("SELECT id, nombre FROM main.usuarios WHERE activo = 1 ORDER BY nombre").all().filter(u => puedeAsignarA(req, { ...u, activo: 1 })) : [];
    res.json({ puede_asignar: ab, hoy: hoyMexico(), prioridades: PRIORIDADES, estados: ESTADOS, tareas: lista.map(t => fila(req, t)),
      proyectos: proyectos.map(p => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion || '', tareas: p.tareas, avance: p.avance })), equipo });
  }));

  // ---------- Avisos para Inicio ----------
  app.get('/api/tareas/avisos', h((req, res) => {
    const hoy = hoyMexico(), manana = new Date(Date.parse(hoy + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    const mias = db.prepare(`SELECT t.*, up.nombre AS asigno FROM main.tareas t JOIN main.usuarios up ON up.id = t.asignado_por WHERE t.asignado_a = ? AND t.estado IN ('pendiente', 'en_proceso') ORDER BY t.fin, t.id`).all(yo(req));
    const avisos = mias.map(t => ({ id: t.id, tipo: 'mia', urgente: t.fin <= manana, texto: t.titulo, detalle: `${t.fin < hoy ? 'Vencida desde el ' + dma(t.fin) : t.fin === hoy ? 'Se entrega hoy' : t.fin === manana ? 'Se entrega mañana' : 'Entrega ' + dma(t.fin)} · ${t.avance} % · de ${t.asigno}` }));
    if (asigna(req)) {
      for (const t of db.prepare(`SELECT t.*, ua.nombre AS asignado FROM main.tareas t JOIN main.usuarios ua ON ua.id = t.asignado_a WHERE t.estado = 'por_revisar' AND (t.asignado_por = ? OR en_alcance(t.sucursal_id)) AND t.asignado_a <> ? ORDER BY t.terminada_at`).all(yo(req), yo(req)))
        avisos.push({ id: t.id, tipo: 'revisar', urgente: true, texto: `Por revisar: ${t.titulo}`, detalle: `${t.asignado} la marcó terminada` });
      for (const t of db.prepare(`SELECT t.*, ua.nombre AS asignado FROM main.tareas t JOIN main.usuarios ua ON ua.id = t.asignado_a WHERE t.estado IN ('pendiente', 'en_proceso') AND t.fin < ? AND t.asignado_por = ? AND t.asignado_a <> ? ORDER BY t.fin`).all(hoy, yo(req), yo(req)))
        avisos.push({ id: t.id, tipo: 'vencida', urgente: true, texto: `Vencida: ${t.titulo}`, detalle: `De ${t.asignado} · debía entregarse el ${dma(t.fin)} · ${t.avance} %` });
    }
    res.json({ avisos });
  }));

  // ---------- Detalle (con historial y archivos) ----------
  app.get('/api/tareas/:id', h((req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    const historial = db.prepare('SELECT c.*, u.nombre FROM main.tarea_comentarios c JOIN main.usuarios u ON u.id = c.usuario_id WHERE c.tarea_id = ? ORDER BY c.id').all(t.id)
      .map(c => ({ id: c.id, tipo: c.tipo, texto: c.texto || '', quien: c.nombre, fecha: c.created_at, archivo: c.archivo ? { nombre: c.archivo_nombre, formato: c.formato, bytes: c.bytes } : null }));
    res.json({ ...fila(req, t), historial, depende: t.depende_de ? (({ id, titulo, estado }) => ({ id, titulo, estado }))(leer(t.depende_de) || {}) : null });
  }));

  // ---------- Proyectos ----------
  app.post('/api/tareas/proyectos', h((req, res) => {
    if (!asigna(req)) return res.status(403).json({ error: 'Los proyectos los crean Dirección y quien asigna tareas' });
    const b = req.body || {}, nombre = texto(b.nombre, 120);
    if (!nombre || !conSentido(nombre, 3)) return res.status(400).json({ error: 'Escribe el nombre del proyecto' });
    const suc = Number(b.sucursal_id) || req.alcanceSuc?.alta || req.alcanceSuc?.permitidas?.[0];
    if (!suc || !(app.locals.sucursales?.lista?.() || []).some(x => x.id === suc) || !enAlcance(suc)) return res.status(400).json({ error: 'Elige la sucursal' });
    const id = Number(db.prepare('INSERT INTO main.proyectos_tareas (nombre, descripcion, sucursal_id, creado_por) VALUES (?, ?, ?, ?)').run(nombre, texto(b.descripcion, 2000), suc, yo(req)).lastInsertRowid);
    app.locals.auditoria?.registrar(req, 'tareas', id, 'proyecto', nombre);
    res.status(201).json({ id });
  }));
  app.post('/api/tareas/proyectos/:id/cancelar', h((req, res) => {
    if (!asigna(req)) return res.status(403).json({ error: 'Los proyectos los cancelan Dirección y quien asigna tareas' });
    const p = db.prepare('SELECT * FROM main.proyectos_tareas WHERE id = ?').get(Number(req.params.id) || 0);
    if (!p || !enAlcance(p.sucursal_id)) return res.status(404).json({ error: 'No se encontró el proyecto' });
    const motivo = texto(req.body?.motivo, 300); if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe el motivo (mínimo 5 letras)' });
    if (db.prepare("SELECT 1 FROM main.tareas WHERE proyecto_id = ? AND estado NOT IN ('terminada', 'cancelada')").get(p.id)) return res.status(409).json({ error: 'El proyecto tiene tareas abiertas: termínalas o cancélalas primero' });
    db.prepare("UPDATE main.proyectos_tareas SET estado = 'cancelado', cancelado_por = ?, motivo_cancelacion = ? WHERE id = ?").run(yo(req), motivo, p.id);
    res.json({ ok: true });
  }));

  // ---------- Crear y cambiar una tarea (quien asigna) ----------
  function validar(req, b, actual) {
    const d = {};
    if (b.titulo !== undefined || !actual) { const t = texto(b.titulo, 160); if (!t || !conSentido(t, 3)) return { error: 'Escribe qué hay que hacer (el título de la tarea)' }; d.titulo = t; }
    if (b.descripcion !== undefined) d.descripcion = texto(b.descripcion, 4000);
    if (b.asignado_a !== undefined || !actual) {
      const u = usuario(b.asignado_a);
      if (!u || u.activo !== 1) return { error: 'Elige a quién se le asigna (usuario activo)' };
      if (!puedeAsignarA(req, u)) return { error: 'Solo puedes asignar tareas a gente de tu sucursal', status: 403 };
      d.asignado_a = u.id;
    }
    const inicio = b.inicio !== undefined ? b.inicio : actual?.inicio, fin = b.fin !== undefined ? b.fin : actual?.fin;
    if (!fechaOk(inicio) || !fechaOk(fin)) return { error: 'Revisa las fechas de inicio y de entrega' };
    if (fin < inicio) return { error: 'La entrega no puede ser antes del inicio' };
    if (b.inicio !== undefined) d.inicio = inicio; if (b.fin !== undefined) d.fin = fin;
    if (!actual) { d.inicio = inicio; d.fin = fin; }
    if (b.prioridad !== undefined) { if (!PRIORIDADES[b.prioridad]) return { error: 'Elige la prioridad' }; d.prioridad = b.prioridad; }
    if (b.es_hito !== undefined) d.es_hito = b.es_hito ? 1 : 0;
    if (b.proyecto_id !== undefined) {
      if (b.proyecto_id === null || b.proyecto_id === '') d.proyecto_id = null;
      else { const p = db.prepare("SELECT * FROM main.proyectos_tareas WHERE id = ? AND estado = 'activo'").get(Number(b.proyecto_id)); if (!p || !enAlcance(p.sucursal_id)) return { error: 'Ese proyecto no existe o ya se cerró' }; d.proyecto_id = p.id; }
    }
    if (b.depende_de !== undefined) {
      if (b.depende_de === null || b.depende_de === '') d.depende_de = null;
      else {
        const x = leer(b.depende_de); if (!x || !ve(req, x)) return { error: 'La tarea de la que depende no existe' };
        if (actual && x.id === actual.id) return { error: 'Una tarea no puede depender de sí misma' };
        // Sin ciclos: la otra no puede depender (directa o indirectamente) de esta.
        if (actual) { let k = x, n = 0; while (k?.depende_de && n++ < 50) { if (k.depende_de === actual.id) return { error: 'Esa dependencia haría un círculo' }; k = leer(k.depende_de); } }
        d.depende_de = x.id;
      }
    }
    return { datos: d };
  }
  app.post('/api/tareas', h(async (req, res) => {
    if (!asigna(req)) return res.status(403).json({ error: 'Las tareas las asignan Dirección y el Gerente' });
    const v = validar(req, req.body || {}, null); if (v.error) return res.status(v.status || 400).json({ error: v.error });
    const d = v.datos, proy = d.proyecto_id ? db.prepare('SELECT sucursal_id FROM main.proyectos_tareas WHERE id = ?').get(d.proyecto_id) : null;
    const sucAsignado = sucursalesDe(d.asignado_a).find(s => enAlcance(s));
    const suc = proy?.sucursal_id ?? sucAsignado ?? req.alcanceSuc?.alta ?? req.alcanceSuc?.permitidas?.[0];
    const cols = { ...d, prioridad: d.prioridad || 'media', asignado_por: yo(req), sucursal_id: suc };
    const id = Number(db.prepare(`INSERT INTO main.tareas (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')})`).run(...Object.values(cols)).lastInsertRowid);
    nota(id, yo(req), 'cambio', `Asignada a ${usuario(d.asignado_a).nombre}: del ${dma(d.inicio)} al ${dma(d.fin)}`);
    app.locals.auditoria?.registrar(req, 'tareas', id, 'asignada', `«${d.titulo}» → ${usuario(d.asignado_a).nombre} · ${dma(d.inicio)}–${dma(d.fin)}`);
    if (d.asignado_a !== yo(req) && await enviarCorreo(d.asignado_a, 'Te asignaron una tarea: ' + d.titulo, `${req.usuarioSesion.nombre} te asignó «${d.titulo}».\nInicio: ${dma(d.inicio)} · entrega: ${dma(d.fin)} · prioridad ${PRIORIDADES[cols.prioridad].toLowerCase()}.${d.descripcion ? '\n\n' + d.descripcion : ''}`))
      db.prepare("UPDATE main.tareas SET correo_asignacion_at = datetime('now','localtime') WHERE id = ?").run(id);
    res.status(201).json({ id });
  }));
  app.put('/api/tareas/:id', h(async (req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    if (!manda(req, t)) return res.status(403).json({ error: 'Las fechas, la persona y los datos de la tarea los cambia quien la asignó' });
    if (['terminada', 'cancelada'].includes(t.estado)) return res.status(409).json({ error: 'La tarea ya está cerrada' });
    if (req.body?.version !== undefined && Number(req.body.version) !== t.version) return res.status(409).json({ error: 'Alguien más cambió la tarea: vuelve a abrirla' });
    const v = validar(req, req.body || {}, t); if (v.error) return res.status(v.status || 400).json({ error: v.error });
    const d = v.datos, ks = Object.keys(d).filter(k => d[k] !== t[k]);
    if (!ks.length) return res.json({ ok: true });
    db.prepare(`UPDATE main.tareas SET ${ks.map(k => k + ' = ?').join(', ')}, recordada_at = CASE WHEN ? THEN NULL ELSE recordada_at END, vencida_avisada_at = CASE WHEN ? THEN NULL ELSE vencida_avisada_at END,
      updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?`).run(...ks.map(k => d[k]), ks.includes('fin') ? 1 : 0, ks.includes('fin') ? 1 : 0, t.id);
    const txt = ks.map(k => k === 'asignado_a' ? `ahora es de ${usuario(d[k]).nombre}` : k === 'fin' ? `entrega ${dma(d[k])}` : k === 'inicio' ? `inicio ${dma(d[k])}` : k).join(', ');
    nota(t.id, yo(req), 'cambio', 'Cambió: ' + txt);
    if (ks.includes('asignado_a') && d.asignado_a !== yo(req)) await enviarCorreo(d.asignado_a, 'Te asignaron una tarea: ' + (d.titulo || t.titulo), `${req.usuarioSesion.nombre} te asignó «${d.titulo || t.titulo}». Entrega: ${dma(d.fin || t.fin)}.`);
    res.json({ ok: true });
  }));

  // ---------- La persona asignada: avance, comentario, terminada ----------
  app.post('/api/tareas/:id/avance', h((req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    if (t.asignado_a !== yo(req) && !manda(req, t)) return res.status(403).json({ error: 'El avance lo pone la persona que tiene la tarea' });
    if (['terminada', 'cancelada', 'por_revisar'].includes(t.estado)) return res.status(409).json({ error: t.estado === 'por_revisar' ? 'Ya la marcaste terminada: espera a que la revisen' : 'La tarea ya está cerrada' });
    const a = Number(req.body?.avance);
    if (!Number.isInteger(a) || a < 0 || a > 99) return res.status(400).json({ error: 'El avance va de 0 a 99 % (para el 100 %, márcala terminada)' });
    const c = texto(req.body?.comentario, 2000);
    db.prepare("UPDATE main.tareas SET avance = ?, estado = CASE WHEN ? > 0 THEN 'en_proceso' ELSE estado END, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(a, a, t.id);
    nota(t.id, yo(req), 'avance', `Avance ${t.avance} % → ${a} %${c ? ': ' + c : ''}`);
    res.json({ ok: true });
  }));
  app.post('/api/tareas/:id/comentarios', h((req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    const c = texto(req.body?.texto, 2000); if (!c || !conSentido(c, 2)) return res.status(400).json({ error: 'Escribe el comentario' });
    nota(t.id, yo(req), 'comentario', c);
    res.status(201).json({ ok: true });
  }));
  app.post('/api/tareas/:id/terminar', h((req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    if (t.asignado_a !== yo(req)) return res.status(403).json({ error: 'La marca terminada la persona que tiene la tarea' });
    if (!['pendiente', 'en_proceso'].includes(t.estado)) return res.status(409).json({ error: 'La tarea no está abierta' });
    if (t.depende_de) { const x = leer(t.depende_de); if (x && x.estado !== 'terminada' && x.estado !== 'cancelada') return res.status(409).json({ error: `Primero tiene que terminarse «${x.titulo}», de la que depende` }); }
    const c = texto(req.body?.comentario, 2000);
    // Si la asignó ella misma, queda terminada; si no, va a revisión de quien la asignó.
    const propia = t.asignado_por === yo(req);
    db.prepare(`UPDATE main.tareas SET estado = ?, avance = 100, terminada_at = datetime('now','localtime'), ${propia ? "revisada_por = ?, revisada_at = datetime('now','localtime')," : ''} updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?`)
      .run(propia ? 'terminada' : 'por_revisar', ...(propia ? [yo(req)] : []), t.id);
    nota(t.id, yo(req), 'terminada', c ? 'La marcó terminada: ' + c : 'La marcó terminada');
    res.json({ ok: true, estado: propia ? 'terminada' : 'por_revisar' });
  }));

  // ---------- Quien asignó: aceptar, regresar o cancelar ----------
  app.post('/api/tareas/:id/revisar', h(async (req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    if (!manda(req, t)) return res.status(403).json({ error: 'La revisa quien la asignó' });
    if (t.estado !== 'por_revisar') return res.status(409).json({ error: 'La tarea no está por revisar' });
    const acepta = req.body?.acepta === true, c = texto(req.body?.comentario, 2000);
    if (!acepta && (!c || !conSentido(c, 5))) return res.status(400).json({ error: 'Escribe qué falta para regresarla' });
    db.prepare(`UPDATE main.tareas SET estado = ?, avance = ?, revisada_por = ?, revisada_at = datetime('now','localtime'), updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?`)
      .run(acepta ? 'terminada' : 'en_proceso', acepta ? 100 : 90, yo(req), t.id);
    nota(t.id, yo(req), acepta ? 'aceptada' : 'regresada', acepta ? (c ? 'Aceptada: ' + c : 'Aceptada') : 'La regresó: ' + c);
    if (!acepta) await enviarCorreo(t.asignado_a, 'Te regresaron una tarea: ' + t.titulo, `${req.usuarioSesion.nombre} te regresó «${t.titulo}»: ${c}`);
    res.json({ ok: true });
  }));
  app.post('/api/tareas/:id/cancelar', h((req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    if (!manda(req, t)) return res.status(403).json({ error: 'La cancela quien la asignó' });
    if (['terminada', 'cancelada'].includes(t.estado)) return res.status(409).json({ error: 'La tarea ya está cerrada' });
    const motivo = texto(req.body?.motivo, 300); if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe el motivo (mínimo 5 letras)' });
    db.prepare("UPDATE main.tareas SET estado = 'cancelada', cancelada_por = ?, motivo_cancelacion = ?, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(yo(req), motivo, t.id);
    nota(t.id, yo(req), 'cancelada', 'Cancelada: ' + motivo);
    app.locals.auditoria?.registrar(req, 'tareas', t.id, 'cancelada', `«${t.titulo}» · ${motivo}`);
    res.json({ ok: true });
  }));

  // ---------- Archivos (PDF, JPG o PNG; máximo 10 MB) ----------
  app.post('/api/tareas/:id/archivos', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    const t = leer(req.params.id); if (!ve(req, t)) return res.status(404).json({ error: 'No se encontró la tarea' });
    if (t.estado === 'cancelada') return res.status(409).json({ error: 'La tarea está cancelada' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'El archivo pasa de 10 MB' });
    const formato = tipoReal(buf); if (!MIME[formato]) return res.status(400).json({ error: 'Sube un PDF, una foto JPG o una imagen PNG' });
    let nombre = ''; try { nombre = decodeURIComponent(String(req.get('x-nombre') || '')); } catch { /* */ }
    nombre = nombre.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'archivo.' + formato;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    db.transaction(() => {
      const r = db.prepare("INSERT INTO main.tarea_comentarios (tarea_id, usuario_id, tipo, texto, archivo_nombre, formato, bytes) VALUES (?, ?, 'archivo', ?, ?, ?, ?)").run(t.id, yo(req), 'Subió ' + nombre, nombre, formato, buf.length);
      const rel = path.join(String(t.id), `${r.lastInsertRowid}-${sha.slice(0, 12)}.${formato}`);
      fs.mkdirSync(path.join(DIR, String(t.id)), { recursive: true });
      fs.writeFileSync(path.join(DIR, rel), buf);
      db.prepare('UPDATE main.tarea_comentarios SET archivo = ? WHERE id = ?').run(rel, r.lastInsertRowid);
    })();
    res.status(201).json({ ok: true });
  }));
  app.get('/api/tareas/archivos/:id', h((req, res) => {
    const c = db.prepare("SELECT * FROM main.tarea_comentarios WHERE id = ? AND tipo = 'archivo' AND archivo IS NOT NULL").get(Number(req.params.id) || 0);
    if (!c || !ve(req, leer(c.tarea_id))) return res.status(404).json({ error: 'No se encontró el archivo' });
    const ruta = path.join(DIR, c.archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.set({ 'Content-Type': MIME[c.formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${c.formato === 'pdf' ? 'attachment' : 'inline'}; filename="archivo.${c.formato}"; filename*=UTF-8''${encodeURIComponent(c.archivo_nombre || 'archivo')}` });
    res.send(fs.readFileSync(ruta));
  }));

  // ---------- Recordatorios por correo (cada media hora; cada uno una sola vez) ----------
  async function recordatorios() {
    try {
      if (process.env.MODO_DEMO === '1' || !correo.configurado) return;
      const ahora = ahoraMexico(); if (Number(ahora.hora.slice(0, 2)) < 8) return;
      const hoy = ahora.fecha, manana = new Date(Date.parse(hoy + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
      for (const t of db.prepare("SELECT * FROM main.tareas WHERE estado IN ('pendiente', 'en_proceso') AND fin = ? AND recordada_at IS NULL").all(manana)) {
        db.prepare("UPDATE main.tareas SET recordada_at = datetime('now','localtime') WHERE id = ?").run(t.id);
        await enviarCorreo(t.asignado_a, 'Mañana se entrega: ' + t.titulo, `Recordatorio: «${t.titulo}» se entrega mañana (${dma(t.fin)}). Vas en ${t.avance} %.`);
      }
      for (const t of db.prepare("SELECT t.*, ua.nombre AS asignado FROM main.tareas t JOIN main.usuarios ua ON ua.id = t.asignado_a WHERE t.estado IN ('pendiente', 'en_proceso') AND t.fin < ? AND t.vencida_avisada_at IS NULL").all(hoy)) {
        db.prepare("UPDATE main.tareas SET vencida_avisada_at = datetime('now','localtime') WHERE id = ?").run(t.id);
        await enviarCorreo(t.asignado_por, 'Tarea vencida: ' + t.titulo, `«${t.titulo}» de ${t.asignado} debía entregarse el ${dma(t.fin)} y va en ${t.avance} %.`);
      }
    } catch (err) { console.error('[tareas] recordatorios:', err.message); }
  }
  setTimeout(recordatorios, 90 * 1000).unref();
  setInterval(recordatorios, 30 * 60 * 1000).unref();
};
