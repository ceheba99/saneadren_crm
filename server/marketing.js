// MARKETING · CALENDARIO DE PUBLICACIONES (decidido con Dirección el 2026-10-26; fase 1 del panel de marketing).
//  · Cada publicación: título, redes (TikTok, Facebook, Instagram, LinkedIn, Spotify), formato, fecha y hora, copy,
//    hashtags, enlace (video o episodio: basta el enlace), campaña, imágenes, y si es de toda la empresa o de una sucursal.
//  · Flujo: Borrador → En revisión → (Cambios pedidos ↺) → Aprobada → Programada → Publicada; o Cancelada.
//    Aprueban (o piden cambios) Dirección y quien tiene «Aprobar publicaciones» (Gerente de marketing).
//    Si después de aprobada se cambia el contenido (texto, redes, formato, imágenes o enlace), vuelve a Borrador para
//    revisarla otra vez; mover la fecha o la hora no quita la aprobación. Publicada ya no se cambia (solo se comenta).
//  · Cada cambio del texto guarda la versión anterior; cada cambio de estado y cada comentario queda en su historial.
//  · Qué ve cada rol lo decide su nivel en el área «marketing» (vistas de sucursales.js): lo suyo, su sucursal (y lo
//    de toda la empresa) o todo. Edita quien tiene «marketing.editar». No se publica en las redes desde aquí: se marca
//    «Publicada» a mano con el enlace.
//  · PROYECTOS (fase 2, 2026-10-26): cada proyecto (de toda la empresa o de una sucursal) con sus tareas (responsable,
//    inicio, fin, % de avance, de cuál depende, hito) que se ven en un diagrama de Gantt, sus avances (texto, fotos y
//    archivos, y si mueven el % de una tarea) y las publicaciones ligadas a él. El % del proyecto es el promedio de sus
//    tareas pesado por su duración. Las mismas reglas de Marketing: lo ve quien ve Marketing, lo edita quien lo edita.
//    Una tarea no se borra: se quita (queda quién y cuándo).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { tipoReal } = require('./expediente-oc');

const REDES = { tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', spotify: 'Spotify' };
const FORMATOS = { post: 'Publicación (imagen)', carrusel: 'Carrusel', reel: 'Reel / video corto', historia: 'Historia', video: 'Video', episodio: 'Episodio / podcast', articulo: 'Artículo', otro: 'Otro' };
const ESTADOS = { borrador: 'Borrador', revision: 'En revisión', cambios: 'Cambios pedidos', aprobada: 'Aprobada', programada: 'Programada', publicada: 'Publicada', cancelada: 'Cancelada' };
const CONTENIDO = ['titulo', 'redes', 'formato', 'copy', 'hashtags', 'enlace'];
const ESTADOS_PROYECTO = { planeacion: 'En planeación', en_curso: 'En curso', pausa: 'En pausa', terminado: 'Terminado', cancelado: 'Cancelado' };
const MAX_BYTES = 10 * 1024 * 1024, MAX_IMAGENES = 10;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
const nombreSeguro = t => String(t || 'imagen').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'imagen';
const encabezado = (req, k) => { try { return decodeURIComponent(String(req.get(k) || '')); } catch { return ''; } };
// Imagen por su contenido (no por el nombre): JPG y PNG como en el resto del sistema, más WebP y GIF.
const formatoImagen = buf => {
  const t = tipoReal(buf); if (t === 'jpg' || t === 'png') return t;
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'gif';
  return null;
};
const fechaValida = f => { const d = new Date(f + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(d) && d.toISOString().slice(0, 10) === f; };

module.exports = function marketing(app, db, h) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS publicaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL CHECK(length(trim(titulo)) BETWEEN 1 AND 120),
      redes TEXT NOT NULL, formato TEXT NOT NULL, fecha TEXT NOT NULL, hora TEXT,
      copy TEXT NOT NULL DEFAULT '', hashtags TEXT NOT NULL DEFAULT '', enlace TEXT NOT NULL DEFAULT '', campana TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','revision','cambios','aprobada','programada','publicada','cancelada')),
      sucursal_id INTEGER REFERENCES sucursales(id), -- NULL: de toda la empresa
      responsable_id INTEGER REFERENCES usuarios(id), creado_por INTEGER REFERENCES usuarios(id),
      aprobado_por INTEGER REFERENCES usuarios(id), aprobado_at TEXT, publicado_url TEXT, publicado_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_publicaciones_fecha ON publicaciones(fecha);
    CREATE TABLE IF NOT EXISTS publicacion_imagenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      nombre TEXT NOT NULL, archivo TEXT NOT NULL, formato TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, orden INTEGER NOT NULL DEFAULT 0,
      subido_por INTEGER REFERENCES usuarios(id), eliminado INTEGER NOT NULL DEFAULT 0, eliminado_por INTEGER REFERENCES usuarios(id), eliminado_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_publicacion_imagenes ON publicacion_imagenes(publicacion_id);
    CREATE TABLE IF NOT EXISTS publicacion_comentarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      usuario_id INTEGER REFERENCES usuarios(id), tipo TEXT NOT NULL DEFAULT 'comentario' CHECK(tipo IN ('comentario','estado','cambios','aprobada')),
      texto TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_publicacion_comentarios ON publicacion_comentarios(publicacion_id);
    CREATE TABLE IF NOT EXISTS publicacion_versiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      titulo TEXT, copy TEXT, hashtags TEXT, redes TEXT, usuario_id INTEGER REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_publicacion_versiones ON publicacion_versiones(publicacion_id);
    CREATE TABLE IF NOT EXISTS proyectos_marketing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 120), objetivo TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'planeacion' CHECK(estado IN ('planeacion','en_curso','pausa','terminado','cancelado')),
      inicio TEXT NOT NULL, fin TEXT NOT NULL,
      sucursal_id INTEGER REFERENCES sucursales(id), -- NULL: de toda la empresa
      responsable_id INTEGER REFERENCES usuarios(id), creado_por INTEGER REFERENCES usuarios(id),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS tareas_marketing (
      id INTEGER PRIMARY KEY AUTOINCREMENT, proyecto_id INTEGER NOT NULL REFERENCES proyectos_marketing(id),
      titulo TEXT NOT NULL CHECK(length(trim(titulo)) BETWEEN 1 AND 160), responsable_id INTEGER REFERENCES usuarios(id),
      inicio TEXT NOT NULL, fin TEXT NOT NULL, avance INTEGER NOT NULL DEFAULT 0 CHECK(avance BETWEEN 0 AND 100),
      depende_de INTEGER REFERENCES tareas_marketing(id), hito INTEGER NOT NULL DEFAULT 0 CHECK(hito IN (0, 1)),
      orden INTEGER NOT NULL DEFAULT 0, notas TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
      eliminado INTEGER NOT NULL DEFAULT 0, eliminado_por INTEGER REFERENCES usuarios(id), eliminado_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_tareas_marketing ON tareas_marketing(proyecto_id);
    CREATE TABLE IF NOT EXISTS avances_marketing (
      id INTEGER PRIMARY KEY AUTOINCREMENT, proyecto_id INTEGER NOT NULL REFERENCES proyectos_marketing(id),
      usuario_id INTEGER REFERENCES usuarios(id), texto TEXT NOT NULL,
      tarea_id INTEGER REFERENCES tareas_marketing(id), avance_antes INTEGER, avance_nuevo INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_avances_marketing ON avances_marketing(proyecto_id);
    CREATE TABLE IF NOT EXISTS archivos_marketing (
      id INTEGER PRIMARY KEY AUTOINCREMENT, proyecto_id INTEGER NOT NULL REFERENCES proyectos_marketing(id), avance_id INTEGER REFERENCES avances_marketing(id),
      nombre TEXT NOT NULL, archivo TEXT NOT NULL, formato TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      subido_por INTEGER REFERENCES usuarios(id), eliminado INTEGER NOT NULL DEFAULT 0, eliminado_por INTEGER REFERENCES usuarios(id), eliminado_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_archivos_marketing ON archivos_marketing(proyecto_id);
  `);
  // Cada publicación puede ser parte de un proyecto.
  if (!db.prepare('PRAGMA table_info(publicaciones)').all().some(c => c.name === 'proyecto_id')) db.exec('ALTER TABLE publicaciones ADD COLUMN proyecto_id INTEGER REFERENCES proyectos_marketing(id)');
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'marketing');
  const P = () => app.locals.permisos, alc = () => require('./alcance');
  const yo = req => req.usuarioSesion.id;
  const puedeEditar = req => P().puede(req, 'marketing.editar');
  const puedeAprobar = req => P().direccion(req) || P().puede(req, 'marketing.aprobar');
  const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // Todo pasa por /api/marketing: sin «ver Marketing» no se entra.
  app.use('/api/marketing', (req, res, next) => {
    if (!req.usuarioSesion) return next();
    if (!P().puede(req, 'marketing.ver')) return res.status(403).json({ error: 'Tu rol no ve Marketing' });
    next();
  });

  const lista = (where, args) => db.prepare(`SELECT p.*, u.nombre responsable, s.clave sucursal_clave, s.nombre sucursal_nombre, (SELECT pm.nombre FROM proyectos_marketing pm WHERE pm.id = p.proyecto_id) proyecto_nombre,
      (SELECT i.id FROM publicacion_imagenes i WHERE i.publicacion_id = p.id AND i.eliminado = 0 ORDER BY i.orden, i.id LIMIT 1) portada_id,
      (SELECT COUNT(*) FROM publicacion_imagenes i WHERE i.publicacion_id = p.id AND i.eliminado = 0) imagenes,
      (SELECT COUNT(*) FROM publicacion_comentarios c WHERE c.publicacion_id = p.id AND c.tipo <> 'estado') comentarios
    FROM publicaciones p LEFT JOIN usuarios u ON u.id = p.responsable_id LEFT JOIN sucursales s ON s.id = p.sucursal_id WHERE ${where}`).all(...args).map(forma);
  const forma = p => ({ ...p, redes: String(p.redes || '').split(',').filter(Boolean) });
  function detalle(req, id) {
    const p = lista('p.id = ?', [Number(id)])[0]; if (!p) return null;
    const nombre = 'LEFT JOIN usuarios u ON u.id = x.usuario_id';
    return {
      ...p,
      aprobado_por_nombre: p.aprobado_por ? db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(p.aprobado_por)?.nombre : null,
      lista_imagenes: db.prepare('SELECT id, nombre, formato, bytes, orden, created_at FROM publicacion_imagenes WHERE publicacion_id = ? AND eliminado = 0 ORDER BY orden, id').all(p.id),
      historial: db.prepare(`SELECT x.id, x.tipo, x.texto, x.created_at, u.nombre usuario FROM publicacion_comentarios x ${nombre} WHERE x.publicacion_id = ? ORDER BY x.id DESC`).all(p.id),
      versiones: db.prepare(`SELECT x.id, x.titulo, x.copy, x.hashtags, x.redes, x.created_at, u.nombre usuario FROM publicacion_versiones x ${nombre} WHERE x.publicacion_id = ? ORDER BY x.id DESC`).all(p.id),
      puede: { editar: puedeEditar(req) && p.estado !== 'publicada', aprobar: puedeAprobar(req), comentar: true },
    };
  }
  const nota = (pubId, usuarioId, tipo, t) => db.prepare('INSERT INTO main.publicacion_comentarios (publicacion_id, usuario_id, tipo, texto) VALUES (?, ?, ?, ?)').run(pubId, usuarioId, tipo, t);

  // Datos de la publicación que llegan del formulario (solo los que vienen; al crear, todos los obligatorios).
  function validar(req, body, actual) {
    const x = {};
    if (body.titulo !== undefined || !actual) { x.titulo = texto(body.titulo, 120); if (!x.titulo) throw Error('Escribe un título para identificar la publicación'); }
    if (body.redes !== undefined || !actual) {
      const r = Array.isArray(body.redes) ? [...new Set(body.redes.map(String))] : [];
      if (!r.length) throw Error('Elige al menos una red');
      if (r.some(k => !REDES[k])) throw Error('Red no válida');
      x.redes = Object.keys(REDES).filter(k => r.includes(k)).join(',');
    }
    if (body.formato !== undefined || !actual) { x.formato = String(body.formato || ''); if (!FORMATOS[x.formato]) throw Error('Elige el formato'); }
    if (body.fecha !== undefined || !actual) { x.fecha = String(body.fecha || ''); if (!fechaValida(x.fecha)) throw Error('Elige la fecha de publicación'); }
    if (body.hora !== undefined) { x.hora = body.hora ? String(body.hora) : null; if (x.hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(x.hora)) throw Error('La hora no es válida'); }
    if (body.copy !== undefined) { if (typeof body.copy !== 'string' || body.copy.length > 5000) throw Error('El copy puede tener hasta 5000 caracteres'); x.copy = body.copy.replace(/\r\n/g, '\n'); }
    if (body.hashtags !== undefined) x.hashtags = texto(body.hashtags, 500);
    if (body.campana !== undefined) x.campana = texto(body.campana, 120);
    if (body.enlace !== undefined) { x.enlace = texto(body.enlace, 500); if (x.enlace && !/^https?:\/\/[^\s]+$/i.test(x.enlace)) throw Error('El enlace debe empezar con https://'); }
    if (body.sucursal !== undefined || !actual) x.sucursal_id = sucursalDe(req, body.sucursal);
    if (body.responsable_id !== undefined || !actual) x.responsable_id = responsableDe(req, body.responsable_id, 'publicaciones');
    // Proyecto al que pertenece (uno que vea), o ninguno.
    if (body.proyecto_id !== undefined) {
      x.proyecto_id = body.proyecto_id ? Number(body.proyecto_id) : null;
      if (x.proyecto_id && !db.prepare('SELECT id FROM proyectos_marketing WHERE id = ?').get(x.proyecto_id)) throw Error('Elige un proyecto válido');
    }
    return x;
  }
  // De toda la empresa o de una sucursal que pueda ver (con «toda la empresa», cualquiera).
  function sucursalDe(req, v = 'empresa') {
    if (v === 'empresa' || v === null || v === '' || v === undefined) return null;
    const sid = Number(v), a = req.alcanceSuc;
    const activa = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(sid);
    if (!activa || !(a.general || a.permitidas.includes(sid) || alc().nivel('marketing') >= 3)) throw Error('Elige una sucursal válida, o «Toda la empresa»');
    return sid;
  }
  // Responsable: alguien activo que trabaje en Marketing; con «lo suyo», solo uno mismo.
  function responsableDe(req, v, que) {
    const r = Number(v || yo(req));
    const u = db.prepare('SELECT id, rol FROM usuarios WHERE id = ? AND activo = 1').get(r);
    if (!u) throw Error('Elige a un responsable activo');
    if (r !== yo(req) && alc().nivel('marketing') < 2) throw Error(`Solo puedes poner ${que} a tu nombre`);
    if (!P().tieneRol(u.rol, 'marketing.editar')) throw Error('Esa persona no trabaja en Marketing: elige a otra');
    return r;
  }

  // ---------- Calendario y lista ----------
  // Catálogos de la pantalla y qué puede quien pide.
  app.get('/api/marketing', h((req, res) => {
    const a = req.alcanceSuc;
    const sucursales = db.prepare('SELECT id, nombre, clave FROM sucursales WHERE activo = 1 ORDER BY id').all().filter(s => a.general || a.permitidas.includes(s.id) || alc().nivel('marketing') >= 3);
    const responsables = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE activo = 1 ORDER BY nombre').all().filter(u => P().tieneRol(u.rol, 'marketing.editar')).map(({ id, nombre }) => ({ id, nombre }));
    // Proyectos a los que se puede ligar una publicación (los que ve y siguen abiertos).
    const proyectos = db.prepare("SELECT id, nombre FROM proyectos_marketing WHERE estado IN ('planeacion','en_curso','pausa') ORDER BY nombre").all();
    res.json({ redes: REDES, formatos: FORMATOS, estados: ESTADOS, estados_proyecto: ESTADOS_PROYECTO, sucursales, responsables, proyectos, puede: { editar: puedeEditar(req), aprobar: puedeAprobar(req) } });
  }));
  app.get('/api/marketing/publicaciones', h((req, res) => {
    const desde = String(req.query.desde || ''), hasta = String(req.query.hasta || '');
    if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indica el rango de fechas' });
    let where = 'p.fecha BETWEEN ? AND ?'; const args = [desde, hasta];
    if (req.query.red && REDES[req.query.red]) { where += " AND (',' || p.redes || ',') LIKE ?"; args.push('%,' + req.query.red + ',%'); }
    if (req.query.estado && ESTADOS[req.query.estado]) { where += ' AND p.estado = ?'; args.push(req.query.estado); }
    if (req.query.q) { where += ' AND (sin_acentos(p.titulo) LIKE sin_acentos(?) OR sin_acentos(p.copy) LIKE sin_acentos(?) OR sin_acentos(p.campana) LIKE sin_acentos(?) OR p.hashtags LIKE ?)'; args.push(...Array(4).fill('%' + String(req.query.q) + '%')); }
    res.json(lista(where + ' ORDER BY p.fecha, COALESCE(p.hora, \'99\'), p.id LIMIT 2000', args));
  }));
  // Pendientes para Inicio: por aprobar (quien aprueba), cambios pedidos, y lo aprobado cuya fecha ya llegó sin publicar.
  app.get('/api/marketing/pendientes', h((req, res) => {
    const hoy = require('./fechas').hoyMexico();
    const r = [];
    if (puedeAprobar(req)) r.push(...lista("p.estado = 'revision' ORDER BY p.fecha", []).map(p => ({ ...p, motivo: 'aprobar' })));
    if (puedeEditar(req)) {
      r.push(...lista("p.estado = 'cambios' ORDER BY p.fecha", []).map(p => ({ ...p, motivo: 'cambios' })));
      r.push(...lista("p.estado IN ('aprobada','programada') AND p.fecha <= ? ORDER BY p.fecha", [hoy]).map(p => ({ ...p, motivo: 'publicar' })));
      r.push(...lista("p.estado = 'borrador' AND p.fecha <= date(?, '+3 days') ORDER BY p.fecha", [hoy]).map(p => ({ ...p, motivo: 'enviar' })));
      // Tareas de proyectos a su nombre que ya vencieron o vencen en 2 días, sin terminar.
      r.push(...db.prepare(`SELECT t.id tarea_id, t.titulo, t.fin fecha, t.avance, pm.id proyecto_id, pm.nombre proyecto_nombre, u.nombre responsable FROM tareas_marketing t
        JOIN proyectos_marketing pm ON pm.id = t.proyecto_id LEFT JOIN usuarios u ON u.id = t.responsable_id
        WHERE t.eliminado = 0 AND t.avance < 100 AND t.responsable_id = ? AND t.fin <= date(?, '+2 days') AND pm.estado IN ('planeacion','en_curso') ORDER BY t.fin`).all(yo(req), hoy)
        .map(t => ({ ...t, redes: [], motivo: 'tarea' })));
    }
    res.json(r);
  }));
  app.get('/api/marketing/publicaciones/:id', h((req, res) => {
    const p = detalle(req, req.params.id); if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    res.json(p);
  }));

  // ---------- Crear y editar ----------
  app.post('/api/marketing/publicaciones', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    let x; try { x = validar(req, req.body || {}, null); } catch (e) { return res.status(400).json({ error: e.message }); }
    x.creado_por = yo(req);
    const ks = Object.keys(x);
    const id = db.transaction(() => {
      const r = db.prepare(`INSERT INTO main.publicaciones (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...Object.values(x));
      nota(r.lastInsertRowid, yo(req), 'estado', 'Creó la publicación (borrador)');
      return r.lastInsertRowid;
    })();
    res.status(201).json(detalle(req, id));
  }));
  app.put('/api/marketing/publicaciones/:id', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const p = detalle(req, req.params.id); if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    if (req.body?.version !== p.version) return res.status(409).json({ error: 'Otra persona cambió esta publicación. Vuelve a abrirla antes de guardar.' });
    if (p.estado === 'publicada') return res.status(409).json({ error: 'Ya está publicada: no se cambia (puedes comentarla)' });
    let x; try { x = validar(req, req.body || {}, p); } catch (e) { return res.status(400).json({ error: e.message }); }
    const antes = { ...p, redes: p.redes.join(',') };
    const cambiados = Object.keys(x).filter(k => String(x[k] ?? '') !== String(antes[k] ?? ''));
    if (!cambiados.length) return res.json(p);
    const contenido = cambiados.filter(k => CONTENIDO.includes(k));
    db.transaction(() => {
      // El texto anterior se guarda como versión.
      if (cambiados.some(k => ['titulo', 'copy', 'hashtags', 'redes'].includes(k)))
        db.prepare('INSERT INTO main.publicacion_versiones (publicacion_id, titulo, copy, hashtags, redes, usuario_id) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, antes.titulo, antes.copy, antes.hashtags, antes.redes, yo(req));
      const pierde = contenido.length && ['aprobada', 'programada'].includes(p.estado);
      const sets = cambiados.map(k => k + ' = ?'), vals = cambiados.map(k => x[k]);
      if (pierde) { sets.push("estado = 'borrador'", 'aprobado_por = NULL', 'aprobado_at = NULL'); }
      db.prepare(`UPDATE main.publicaciones SET ${sets.join(', ')}, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals, p.id);
      const nombres = { titulo: 'título', redes: 'redes', formato: 'formato', fecha: 'fecha', hora: 'hora', copy: 'copy', hashtags: 'hashtags', enlace: 'enlace', campana: 'campaña', sucursal_id: 'sucursal', responsable_id: 'responsable', proyecto_id: 'proyecto' };
      nota(p.id, yo(req), 'estado', 'Cambió ' + cambiados.map(k => nombres[k] || k).join(', ') + (cambiados.includes('fecha') ? ` (${p.fecha} → ${x.fecha})` : '')
        + (pierde ? '. Como ya estaba aprobada y cambió el contenido, regresó a borrador: hay que enviarla a revisión otra vez.' : ''));
    })();
    res.json(detalle(req, p.id));
  }));

  // ---------- Flujo de aprobación ----------
  // accion → [estados desde los que se puede, estado nuevo, quién, ¿comentario obligatorio?]
  const ACCIONES = {
    enviar: [['borrador', 'cambios'], 'revision', 'editar', false, 'La envió a revisión'],
    aprobar: [['revision'], 'aprobada', 'aprobar', false, 'La aprobó'],
    pedir_cambios: [['revision', 'aprobada', 'programada'], 'cambios', 'aprobar', true, 'Pidió cambios'],
    programar: [['aprobada'], 'programada', 'editar', false, 'La marcó como programada en la red'],
    publicar: [['aprobada', 'programada'], 'publicada', 'editar', false, 'La marcó como publicada'],
    cancelar: [['borrador', 'revision', 'cambios', 'aprobada', 'programada'], 'cancelada', 'editar', true, 'La canceló'],
    reabrir: [['cancelada'], 'borrador', 'editar', false, 'La reabrió como borrador'],
  };
  app.post('/api/marketing/publicaciones/:id/estado', h((req, res) => {
    const p = detalle(req, req.params.id); if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    const a = ACCIONES[String(req.body?.accion || '')]; if (!a) return res.status(400).json({ error: 'Acción no válida' });
    const [desde, nuevo, quien, conMotivo, frase] = a;
    if (quien === 'aprobar' ? !puedeAprobar(req) : !puedeEditar(req))
      return res.status(403).json({ error: quien === 'aprobar' ? 'Aprueban Dirección y el Gerente de marketing' : 'Tu rol solo consulta Marketing' });
    if (req.body.version !== p.version) return res.status(409).json({ error: 'Otra persona cambió esta publicación. Vuelve a abrirla.' });
    if (!desde.includes(p.estado)) return res.status(409).json({ error: `Está «${ESTADOS[p.estado]}»: no se puede ${frase.toLowerCase().replace(/^la /, '')}` });
    const comentario = texto(req.body.comentario, 2000);
    if (conMotivo && comentario.length < 3) return res.status(400).json({ error: nuevo === 'cambios' ? 'Escribe qué cambios hacen falta' : 'Escribe por qué se cancela' });
    let url = null;
    if (nuevo === 'publicada') { url = texto(req.body.url, 500); if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return res.status(400).json({ error: 'El enlace de la publicación debe empezar con https://' }); }
    if (nuevo === 'revision' && !p.copy.trim() && !p.imagenes && !p.enlace) return res.status(400).json({ error: 'Antes de enviarla a revisión agrega el copy, una imagen o el enlace del video' });
    db.transaction(() => {
      const sets = ['estado = ?'], vals = [nuevo];
      if (nuevo === 'aprobada') sets.push('aprobado_por = ?', "aprobado_at = datetime('now','localtime')"), vals.push(yo(req));
      if (nuevo === 'cambios' || nuevo === 'borrador') sets.push('aprobado_por = NULL', 'aprobado_at = NULL');
      if (nuevo === 'publicada') sets.push('publicado_url = ?', "publicado_at = datetime('now','localtime')"), vals.push(url || null);
      db.prepare(`UPDATE main.publicaciones SET ${sets.join(', ')}, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals, p.id);
      nota(p.id, yo(req), nuevo === 'cambios' ? 'cambios' : nuevo === 'aprobada' ? 'aprobada' : 'estado', frase + (comentario ? ': ' + comentario : '') + (url ? ' · ' + url : ''));
    })();
    res.json(detalle(req, p.id));
  }));

  // ---------- Comentarios ----------
  app.post('/api/marketing/publicaciones/:id/comentarios', h((req, res) => {
    const p = detalle(req, req.params.id); if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    const t = texto(req.body?.texto, 2000); if (!t) return res.status(400).json({ error: 'Escribe el comentario' });
    nota(p.id, yo(req), 'comentario', t);
    res.status(201).json(detalle(req, p.id));
  }));

  // ---------- Imágenes: el cuerpo es el archivo tal cual; el nombre va en un encabezado ----------
  app.post('/api/marketing/publicaciones/:id/imagenes', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const p = detalle(req, req.params.id); if (!p) return res.status(404).json({ error: 'Publicación no encontrada' });
    if (p.estado === 'publicada') return res.status(409).json({ error: 'Ya está publicada: no se cambian sus imágenes' });
    if (p.imagenes >= MAX_IMAGENES) return res.status(409).json({ error: `Máximo ${MAX_IMAGENES} imágenes por publicación` });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'La imagen pasa de 10 MB (los videos van como enlace)' });
    const formato = formatoImagen(buf);
    if (!formato) return res.status(400).json({ error: 'Sube imágenes JPG, PNG, WebP o GIF (los videos y episodios van como enlace)' });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (db.prepare('SELECT 1 FROM publicacion_imagenes WHERE publicacion_id = ? AND sha256 = ? AND eliminado = 0').get(p.id, sha)) return res.status(409).json({ error: 'Esa misma imagen ya está en la publicación' });
    const nombre = nombreSeguro(encabezado(req, 'x-nombre'));
    db.transaction(() => {
      const orden = (db.prepare('SELECT COALESCE(MAX(orden), 0) + 1 n FROM publicacion_imagenes WHERE publicacion_id = ?').get(p.id).n);
      const r = db.prepare('INSERT INTO main.publicacion_imagenes (publicacion_id, nombre, archivo, formato, bytes, sha256, orden, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, nombre, '', formato, buf.length, sha, orden, yo(req));
      const archivo = path.join(String(p.id), `${r.lastInsertRowid}-${sha.slice(0, 12)}.${formato}`);
      fs.mkdirSync(path.join(DIR, String(p.id)), { recursive: true });
      fs.writeFileSync(path.join(DIR, archivo), buf);
      db.prepare('UPDATE main.publicacion_imagenes SET archivo = ? WHERE id = ?').run(archivo, r.lastInsertRowid);
      const pierde = ['aprobada', 'programada'].includes(p.estado);
      db.prepare(`UPDATE main.publicaciones SET ${pierde ? "estado = 'borrador', aprobado_por = NULL, aprobado_at = NULL, " : ''}version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(p.id);
      nota(p.id, yo(req), 'estado', `Subió la imagen «${nombre}»` + (pierde ? '. Como ya estaba aprobada, regresó a borrador: hay que enviarla a revisión otra vez.' : ''));
    })();
    res.status(201).json(detalle(req, p.id));
  }));
  app.get('/api/marketing/imagenes/:id', h((req, res) => {
    const d = db.prepare('SELECT * FROM publicacion_imagenes WHERE id = ? AND eliminado = 0').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Imagen no encontrada' });
    const ruta = path.join(DIR, d.archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'La imagen ya no está en el servidor' });
    res.set({ 'Content-Type': MIME[d.formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="imagen.${d.formato}"; filename*=UTF-8''${encodeURIComponent(d.nombre)}` });
    res.send(fs.readFileSync(ruta));
  }));
  app.post('/api/marketing/imagenes/:id/quitar', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const d = db.prepare('SELECT * FROM publicacion_imagenes WHERE id = ? AND eliminado = 0').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Imagen no encontrada' });
    const p = detalle(req, d.publicacion_id);
    if (p.estado === 'publicada') return res.status(409).json({ error: 'Ya está publicada: no se cambian sus imágenes' });
    // No se borra el archivo: queda el rastro (como los documentos de compras).
    db.transaction(() => {
      db.prepare("UPDATE main.publicacion_imagenes SET eliminado = 1, eliminado_por = ?, eliminado_at = datetime('now','localtime') WHERE id = ?").run(yo(req), d.id);
      const pierde = ['aprobada', 'programada'].includes(p.estado);
      db.prepare(`UPDATE main.publicaciones SET ${pierde ? "estado = 'borrador', aprobado_por = NULL, aprobado_at = NULL, " : ''}version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(p.id);
      nota(p.id, yo(req), 'estado', `Quitó la imagen «${d.nombre}»` + (pierde ? '. Como ya estaba aprobada, regresó a borrador.' : ''));
    })();
    res.json(detalle(req, p.id));
  }));

  // =================== PROYECTOS ===================
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
  // % del proyecto: el de sus tareas, pesado por cuántos días dura cada una (un hito pesa un día).
  const avanceDe = tareas => { const t = tareas.filter(x => !x.eliminado); const peso = x => Math.max(1, dias(x.inicio, x.fin) + 1);
    const total = t.reduce((s, x) => s + peso(x), 0); return total ? Math.round(t.reduce((s, x) => s + peso(x) * x.avance, 0) / total) : 0; };
  const tareasDe = id => db.prepare(`SELECT t.*, u.nombre responsable FROM tareas_marketing t LEFT JOIN usuarios u ON u.id = t.responsable_id
    WHERE t.proyecto_id = ? AND t.eliminado = 0 ORDER BY t.orden, t.inicio, t.id`).all(id);
  const listaProyectos = (where, args) => db.prepare(`SELECT pm.*, u.nombre responsable, s.nombre sucursal_nombre, s.clave sucursal_clave,
      (SELECT COUNT(*) FROM publicaciones p WHERE p.proyecto_id = pm.id) publicaciones,
      (SELECT MAX(a.created_at) FROM avances_marketing a WHERE a.proyecto_id = pm.id) ultimo_avance
    FROM proyectos_marketing pm LEFT JOIN usuarios u ON u.id = pm.responsable_id LEFT JOIN sucursales s ON s.id = pm.sucursal_id WHERE ${where}`).all(...args)
    .map(pm => { const t = tareasDe(pm.id), hoy = require('./fechas').hoyMexico();
      return { ...pm, avance: avanceDe(t), tareas_total: t.length, tareas_hechas: t.filter(x => x.avance >= 100).length,
        tareas_atrasadas: t.filter(x => x.avance < 100 && x.fin < hoy).length, proximo_hito: t.filter(x => x.hito && x.avance < 100).sort((a, b) => a.fin.localeCompare(b.fin))[0] || null }; });
  function detalleProyecto(req, id) {
    const pm = listaProyectos('pm.id = ?', [Number(id)])[0]; if (!pm) return null;
    const avances = db.prepare(`SELECT a.*, u.nombre usuario, t.titulo tarea_titulo FROM avances_marketing a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN tareas_marketing t ON t.id = a.tarea_id
      WHERE a.proyecto_id = ? ORDER BY a.id DESC`).all(pm.id);
    const archivos = db.prepare('SELECT id, avance_id, nombre, formato, bytes, created_at FROM archivos_marketing WHERE proyecto_id = ? AND eliminado = 0 ORDER BY id').all(pm.id);
    return { ...pm, tareas: tareasDe(pm.id), avances: avances.map(a => ({ ...a, archivos: archivos.filter(f => f.avance_id === a.id) })),
      publicaciones_lista: lista('p.proyecto_id = ? ORDER BY p.fecha', [pm.id]).map(({ id, titulo, fecha, hora, estado, redes }) => ({ id, titulo, fecha, hora, estado, redes })),
      puede: { editar: puedeEditar(req) } };
  }
  function validarProyecto(req, body, actual) {
    const x = {};
    if (body.nombre !== undefined || !actual) { x.nombre = texto(body.nombre, 120); if (!x.nombre) throw Error('Escribe el nombre del proyecto'); }
    if (body.objetivo !== undefined) { if (typeof body.objetivo !== 'string' || body.objetivo.length > 3000) throw Error('El objetivo puede tener hasta 3000 caracteres'); x.objetivo = body.objetivo.trim(); }
    if (body.estado !== undefined) { x.estado = String(body.estado); if (!ESTADOS_PROYECTO[x.estado]) throw Error('Estado no válido'); }
    for (const k of ['inicio', 'fin']) if (body[k] !== undefined || !actual) { x[k] = String(body[k] || ''); if (!fechaValida(x[k])) throw Error(k === 'inicio' ? 'Elige la fecha de inicio' : 'Elige la fecha de fin'); }
    const ini = x.inicio ?? actual?.inicio, fin = x.fin ?? actual?.fin;
    if (fin < ini) throw Error('La fecha de fin no puede ser antes del inicio');
    if (dias(ini, fin) > 3 * 366) throw Error('Un proyecto puede durar hasta 3 años');
    if (body.sucursal !== undefined || !actual) x.sucursal_id = sucursalDe(req, body.sucursal);
    if (body.responsable_id !== undefined || !actual) x.responsable_id = responsableDe(req, body.responsable_id, 'proyectos');
    return x;
  }
  app.get('/api/marketing/proyectos', h((req, res) => {
    let where = '1 = 1'; const args = [];
    if (req.query.estado && ESTADOS_PROYECTO[req.query.estado]) { where += ' AND pm.estado = ?'; args.push(req.query.estado); }
    if (req.query.q) { where += ' AND (sin_acentos(pm.nombre) LIKE sin_acentos(?) OR sin_acentos(pm.objetivo) LIKE sin_acentos(?))'; args.push('%' + req.query.q + '%', '%' + req.query.q + '%'); }
    res.json({ estados: ESTADOS_PROYECTO, proyectos: listaProyectos(where + " ORDER BY CASE pm.estado WHEN 'en_curso' THEN 0 WHEN 'planeacion' THEN 1 WHEN 'pausa' THEN 2 ELSE 3 END, pm.fin, pm.id", args) });
  }));
  app.get('/api/marketing/proyectos/:id', h((req, res) => {
    const pm = detalleProyecto(req, req.params.id); if (!pm) return res.status(404).json({ error: 'Proyecto no encontrado' }); res.json(pm);
  }));
  app.post('/api/marketing/proyectos', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    let x; try { x = validarProyecto(req, req.body || {}, null); } catch (e) { return res.status(400).json({ error: e.message }); }
    x.creado_por = yo(req); const ks = Object.keys(x);
    const r = db.prepare(`INSERT INTO main.proyectos_marketing (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...Object.values(x));
    res.status(201).json(detalleProyecto(req, r.lastInsertRowid));
  }));
  app.put('/api/marketing/proyectos/:id', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const pm = detalleProyecto(req, req.params.id); if (!pm) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (req.body?.version !== pm.version) return res.status(409).json({ error: 'Otra persona cambió este proyecto. Vuelve a abrirlo antes de guardar.' });
    let x; try { x = validarProyecto(req, req.body || {}, pm); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ks = Object.keys(x); if (!ks.length) return res.json(pm);
    db.prepare(`UPDATE main.proyectos_marketing SET ${ks.map(k => k + ' = ?').join(', ')}, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(x), pm.id);
    res.json(detalleProyecto(req, pm.id));
  }));

  // ----- Tareas -----
  function validarTarea(req, body, actual, proyecto) {
    const x = {};
    if (body.titulo !== undefined || !actual) { x.titulo = texto(body.titulo, 160); if (!x.titulo) throw Error('Escribe qué hay que hacer'); }
    for (const k of ['inicio', 'fin']) if (body[k] !== undefined || !actual) { x[k] = String(body[k] || ''); if (!fechaValida(x[k])) throw Error(k === 'inicio' ? 'Elige cuándo empieza la tarea' : 'Elige cuándo termina la tarea'); }
    const ini = x.inicio ?? actual?.inicio, fin = x.fin ?? actual?.fin;
    if (fin < ini) throw Error('La tarea no puede terminar antes de empezar');
    if (dias(ini, fin) > 3 * 366) throw Error('Una tarea puede durar hasta 3 años');
    if (body.avance !== undefined) { x.avance = Number(body.avance); if (!Number.isInteger(x.avance) || x.avance < 0 || x.avance > 100) throw Error('El avance va de 0 a 100 %'); }
    if (body.hito !== undefined) x.hito = body.hito ? 1 : 0;
    if (body.notas !== undefined) x.notas = texto(body.notas, 1000);
    if (body.responsable_id !== undefined) x.responsable_id = body.responsable_id ? responsableDe(req, body.responsable_id, 'tareas') : null;
    else if (!actual) x.responsable_id = yo(req);
    if (body.orden !== undefined) x.orden = Math.max(0, Math.min(9999, Number(body.orden) || 0));
    if (body.depende_de !== undefined) {
      const d = body.depende_de ? Number(body.depende_de) : null;
      if (d) {
        const t = db.prepare('SELECT id, proyecto_id FROM tareas_marketing WHERE id = ? AND eliminado = 0').get(d);
        if (!t || t.proyecto_id !== proyecto.id) throw Error('La tarea de la que depende debe ser de este mismo proyecto');
        if (actual && d === actual.id) throw Error('Una tarea no puede depender de sí misma');
        // Sin vueltas: siguiendo de qué depende cada una, nunca se regresa a esta tarea.
        for (let k = d, n = 0; actual && k && n < 500; n++) { if (k === actual.id) throw Error('Eso haría una vuelta: esa tarea ya depende de esta'); k = db.prepare('SELECT depende_de FROM tareas_marketing WHERE id = ?').get(k)?.depende_de; }
      }
      x.depende_de = d;
    }
    return x;
  }
  app.post('/api/marketing/proyectos/:id/tareas', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const pm = detalleProyecto(req, req.params.id); if (!pm) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (pm.tareas.length >= 200) return res.status(409).json({ error: 'Máximo 200 tareas por proyecto' });
    let x; try { x = validarTarea(req, req.body || {}, null, pm); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (x.orden === undefined) x.orden = (pm.tareas.at(-1)?.orden ?? 0) + 1;
    x.proyecto_id = pm.id; const ks = Object.keys(x);
    db.prepare(`INSERT INTO main.tareas_marketing (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...Object.values(x));
    res.status(201).json(detalleProyecto(req, pm.id));
  }));
  const tareaVisible = id => db.prepare('SELECT * FROM tareas_marketing WHERE id = ? AND eliminado = 0').get(Number(id));
  app.put('/api/marketing/tareas/:id', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const t = tareaVisible(req.params.id); if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (req.body?.version !== t.version) return res.status(409).json({ error: 'Otra persona cambió esta tarea. Vuelve a abrir el proyecto.' });
    const pm = detalleProyecto(req, t.proyecto_id);
    let x; try { x = validarTarea(req, req.body || {}, t, pm); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ks = Object.keys(x); if (!ks.length) return res.json(pm);
    db.prepare(`UPDATE main.tareas_marketing SET ${ks.map(k => k + ' = ?').join(', ')}, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(x), t.id);
    res.json(detalleProyecto(req, t.proyecto_id));
  }));
  app.post('/api/marketing/tareas/:id/quitar', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const t = tareaVisible(req.params.id); if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
    db.transaction(() => {
      // Las que dependían de ella quedan sin dependencia.
      db.prepare('UPDATE main.tareas_marketing SET depende_de = NULL, version = version + 1 WHERE depende_de = ?').run(t.id);
      db.prepare("UPDATE main.tareas_marketing SET eliminado = 1, eliminado_por = ?, eliminado_at = datetime('now','localtime') WHERE id = ?").run(yo(req), t.id);
      db.prepare('INSERT INTO main.avances_marketing (proyecto_id, usuario_id, texto) VALUES (?, ?, ?)').run(t.proyecto_id, yo(req), `Quitó la tarea «${t.titulo}»`);
    })();
    res.json(detalleProyecto(req, t.proyecto_id));
  }));

  // ----- Avances: texto y, si se elige, el nuevo % de una tarea; después se le pueden subir fotos o archivos -----
  app.post('/api/marketing/proyectos/:id/avances', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const pm = detalleProyecto(req, req.params.id); if (!pm) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const t = texto(req.body?.texto, 3000); if (!t) return res.status(400).json({ error: 'Escribe el avance' });
    let tarea = null, nuevo = null;
    if (req.body.tarea_id) {
      tarea = pm.tareas.find(x => x.id === Number(req.body.tarea_id)); if (!tarea) return res.status(400).json({ error: 'Elige una tarea de este proyecto' });
      nuevo = Number(req.body.avance); if (!Number.isInteger(nuevo) || nuevo < 0 || nuevo > 100) return res.status(400).json({ error: 'El avance de la tarea va de 0 a 100 %' });
    }
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO main.avances_marketing (proyecto_id, usuario_id, texto, tarea_id, avance_antes, avance_nuevo) VALUES (?, ?, ?, ?, ?, ?)').run(pm.id, yo(req), t, tarea?.id ?? null, tarea?.avance ?? null, nuevo);
      if (tarea) db.prepare("UPDATE main.tareas_marketing SET avance = ?, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?").run(nuevo, tarea.id);
      return r.lastInsertRowid;
    })();
    res.status(201).json({ ...detalleProyecto(req, pm.id), avance_id: id });
  }));
  app.post('/api/marketing/avances/:id/archivos', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const a = db.prepare('SELECT * FROM avances_marketing WHERE id = ?').get(Number(req.params.id)); if (!a) return res.status(404).json({ error: 'Avance no encontrado' });
    if (db.prepare('SELECT COUNT(*) n FROM archivos_marketing WHERE avance_id = ? AND eliminado = 0').get(a.id).n >= MAX_IMAGENES) return res.status(409).json({ error: `Máximo ${MAX_IMAGENES} archivos por avance` });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'El archivo pasa de 10 MB' });
    const formato = formatoImagen(buf) || (tipoReal(buf) === 'pdf' ? 'pdf' : null);
    if (!formato) return res.status(400).json({ error: 'Sube fotos (JPG, PNG, WebP, GIF) o PDF' });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (db.prepare('SELECT 1 FROM archivos_marketing WHERE avance_id = ? AND sha256 = ? AND eliminado = 0').get(a.id, sha)) return res.status(409).json({ error: 'Ese mismo archivo ya está en el avance' });
    const nombre = nombreSeguro(encabezado(req, 'x-nombre'));
    db.transaction(() => {
      const r = db.prepare('INSERT INTO main.archivos_marketing (proyecto_id, avance_id, nombre, archivo, formato, bytes, sha256, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(a.proyecto_id, a.id, nombre, '', formato, buf.length, sha, yo(req));
      const archivo = path.join('proyectos', String(a.proyecto_id), `${r.lastInsertRowid}-${sha.slice(0, 12)}.${formato}`);
      fs.mkdirSync(path.join(DIR, 'proyectos', String(a.proyecto_id)), { recursive: true });
      fs.writeFileSync(path.join(DIR, archivo), buf);
      db.prepare('UPDATE main.archivos_marketing SET archivo = ? WHERE id = ?').run(archivo, r.lastInsertRowid);
    })();
    res.status(201).json(detalleProyecto(req, a.proyecto_id));
  }));
  app.get('/api/marketing/archivos/:id', h((req, res) => {
    const d = db.prepare('SELECT * FROM archivos_marketing WHERE id = ? AND eliminado = 0').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Archivo no encontrado' });
    const ruta = path.join(DIR, d.archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.set({ 'Content-Type': MIME[d.formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${d.formato === 'pdf' ? 'attachment' : 'inline'}; filename="archivo.${d.formato}"; filename*=UTF-8''${encodeURIComponent(d.nombre)}` });
    res.send(fs.readFileSync(ruta));
  }));
  app.post('/api/marketing/archivos/:id/quitar', h((req, res) => {
    if (!puedeEditar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const d = db.prepare('SELECT * FROM archivos_marketing WHERE id = ? AND eliminado = 0').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Archivo no encontrado' });
    db.prepare("UPDATE main.archivos_marketing SET eliminado = 1, eliminado_por = ?, eliminado_at = datetime('now','localtime') WHERE id = ?").run(yo(req), d.id);
    res.json(detalleProyecto(req, d.proyecto_id));
  }));

  return { REDES, FORMATOS, ESTADOS };
};
