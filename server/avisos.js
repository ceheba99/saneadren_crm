// AVISOS (2026-11-11, pedido de Dirección): comunicados a personas elegidas.
//  · Publica quien tenga «Publicar avisos» (Dirección siempre). Elige las personas una por una: del personal (de sus
//    sucursales) y de los usuarios del sistema. Una persona del personal ligada a un usuario es la misma persona.
//  · Dónde lo ven: el personal, en el reloj checador (al checar) y en su celular; los usuarios, en el Inicio del CRM.
//    Se queda hasta que tocan «Enterado» (en cualquiera de esos lugares) o hasta que el aviso vence o se retira.
//  · Además, si se elige al publicar: por correo (el de su ficha o el de su usuario) y por WhatsApp (el teléfono de su
//    ficha), con una plantilla aprobada en Meta (fuera de la ventana de 24 h Meta solo deja mandar plantillas).
//  · Nunca se borra: se retira, y queda quién lo publicó, a quién, quién lo leyó, cuándo y desde dónde.
const crypto = require('crypto');
const { ahoraMexico } = require('./fechas');
const correo = require('./correo');

const MAX_TITULO = 120, MAX_TEXTO = 2000, MAX_DESTINOS = 500, TOKEN_MS = 15 * 60 * 1000;
const texto = (v, max) => { const t = String(v ?? '').replace(/\r\n?/g, '\n').trim(); return t ? t.slice(0, max) : null; };
const fechaOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const ult10 = v => String(v || '').replace(/\D/g, '').slice(-10);

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS avisos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      texto TEXT NOT NULL,
      urgente INTEGER NOT NULL DEFAULT 0,
      vence TEXT,
      por_correo INTEGER NOT NULL DEFAULT 0,
      por_whatsapp INTEGER NOT NULL DEFAULT 0,
      creado_por INTEGER REFERENCES usuarios(id), creado_por_nombre TEXT,
      retirado_at TEXT, retirado_por_nombre TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS avisos_destinatarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aviso_id INTEGER NOT NULL REFERENCES avisos(id),
      personal_id INTEGER REFERENCES personal(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      nombre TEXT NOT NULL,
      enterado_at TEXT, enterado_en TEXT,
      correo_estado TEXT, whatsapp_estado TEXT,
      CHECK (personal_id IS NOT NULL OR usuario_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_avisos_dest_aviso ON avisos_destinatarios(aviso_id);
    CREATE INDEX IF NOT EXISTS idx_avisos_dest_personal ON avisos_destinatarios(personal_id);
    CREATE INDEX IF NOT EXISTS idx_avisos_dest_usuario ON avisos_destinatarios(usuario_id);
    CREATE TRIGGER IF NOT EXISTS avisos_no_borrar BEFORE DELETE ON avisos BEGIN SELECT RAISE(ABORT, 'Los avisos no se borran: se retiran'); END;
    CREATE TRIGGER IF NOT EXISTS avisos_dest_no_borrar BEFORE DELETE ON avisos_destinatarios BEGIN SELECT RAISE(ABORT, 'Quién recibió un aviso no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS avisos_fijos BEFORE UPDATE OF titulo, texto, urgente, vence, creado_por, created_at ON avisos BEGIN SELECT RAISE(ABORT, 'Un aviso publicado no se cambia: retíralo y publica otro'); END;
  `);
}

module.exports = function avisos(app, db, h) {
  migrar(db);
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para publicar avisos' });
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'avisos', id, accion, detalle);
  const hoy = () => ahoraMexico().fecha;
  const VIGENTE = "a.retirado_at IS NULL AND (a.vence IS NULL OR a.vence >= ?)";

  // ---------- A quién se le puede mandar ----------
  // Personal de sus sucursales (vista «personal») y usuarios activos que comparten sucursal con quien publica (Dirección: todos).
  function elegibles(req) {
    const gente = db.prepare("SELECT p.id, p.nombre, p.puesto, p.usuario_id, p.correo, p.telefono, p.codigo_checador IS NOT NULL AS checa, s.nombre AS sucursal FROM personal p LEFT JOIN main.sucursales s ON s.id = p.sucursal_id WHERE p.activo = 1 ORDER BY p.nombre").all();
    const ligados = new Set(gente.map(p => p.usuario_id).filter(Boolean));
    const yo = req.usuarioSesion.id, dir = P.direccion(req);
    const usuarios = db.prepare('SELECT u.id, u.nombre, u.rol, u.correo FROM usuarios u WHERE u.activo = 1 ORDER BY u.nombre').all()
      .filter(u => !ligados.has(u.id) && (dir || u.rol === 'admin' || u.id === yo || db.prepare('SELECT 1 FROM usuario_sucursales a JOIN usuario_sucursales b ON a.sucursal_id = b.sucursal_id WHERE a.usuario_id = ? AND b.usuario_id = ?').get(yo, u.id)));
    return [
      ...gente.map(p => ({ clave: 'p' + p.id, personal_id: p.id, usuario_id: p.usuario_id || null, nombre: p.nombre, detalle: [p.puesto, p.sucursal].filter(Boolean).join(' · '),
        donde: [p.checa ? 'reloj checador' : null, p.usuario_id ? 'sistema' : null].filter(Boolean), correo: !!p.correo || !!(p.usuario_id && db.prepare('SELECT correo FROM usuarios WHERE id = ?').get(p.usuario_id)?.correo), whatsapp: ult10(p.telefono).length === 10 })),
      ...usuarios.map(u => ({ clave: 'u' + u.id, personal_id: null, usuario_id: u.id, nombre: u.nombre, detalle: 'Usuario del sistema', donde: ['sistema'], correo: !!u.correo, whatsapp: false })),
    ];
  }
  app.get('/api/avisos/destinatarios', h((req, res) => {
    if (!puede(req, 'avisos.publicar')) return negar(res);
    res.json({ personas: elegibles(req), whatsapp: !!app.locals.whatsapp?.plantillaLista(), correo: !!correo.configurado });
  }));

  // ---------- Publicar ----------
  app.post('/api/avisos', h(async (req, res) => {
    if (!puede(req, 'avisos.publicar')) return negar(res);
    const b = req.body || {};
    const titulo = texto(b.titulo, MAX_TITULO)?.replace(/\s+/g, ' '), cuerpo = texto(b.texto, MAX_TEXTO);
    if (!titulo || titulo.length < 3) return res.status(400).json({ error: 'Escribe el título del aviso' });
    if (!cuerpo || cuerpo.length < 3) return res.status(400).json({ error: 'Escribe el aviso' });
    const vence = b.vence ? String(b.vence) : null;
    if (vence && (!fechaOk(vence) || vence < hoy())) return res.status(400).json({ error: 'La fecha en que deja de mostrarse no puede ser antes de hoy' });
    const claves = [...new Set((Array.isArray(b.destinatarios) ? b.destinatarios : []).map(String))];
    if (!claves.length) return res.status(400).json({ error: 'Elige al menos a una persona' });
    if (claves.length > MAX_DESTINOS) return res.status(400).json({ error: `Máximo ${MAX_DESTINOS} personas por aviso` });
    const mapa = new Map(elegibles(req).map(x => [x.clave, x]));
    const fuera = claves.filter(k => !mapa.has(k));
    if (fuera.length) return res.status(400).json({ error: 'Alguna persona ya no está activa o no es de tus sucursales. Vuelve a elegir.' });
    const porCorreo = !!b.correo, porWhatsapp = !!b.whatsapp;
    if (porCorreo && !correo.configurado) return res.status(400).json({ error: 'El correo del sistema no está configurado (SMTP): publícalo sin correo' });
    if (porWhatsapp && !app.locals.whatsapp?.plantillaLista()) return res.status(400).json({ error: 'WhatsApp todavía no está listo: falta la plantilla aprobada en Meta (ver LEEME de avisos)' });
    const elegidos = claves.map(k => mapa.get(k));
    let id;
    db.transaction(() => {
      id = Number(db.prepare('INSERT INTO main.avisos (titulo, texto, urgente, vence, por_correo, por_whatsapp, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(titulo, cuerpo, b.urgente ? 1 : 0, vence, porCorreo ? 1 : 0, porWhatsapp ? 1 : 0, req.usuarioSesion.id, req.usuarioSesion.nombre).lastInsertRowid);
      const ins = db.prepare('INSERT INTO main.avisos_destinatarios (aviso_id, personal_id, usuario_id, nombre, correo_estado, whatsapp_estado) VALUES (?, ?, ?, ?, ?, ?)');
      for (const x of elegidos) ins.run(id, x.personal_id, x.usuario_id, x.nombre, porCorreo ? 'pendiente' : null, porWhatsapp && x.personal_id ? 'pendiente' : null);
    })();
    audit(req, id, 'publicó', `«${titulo}» para ${elegidos.length} persona(s)${porCorreo ? ' · por correo' : ''}${porWhatsapp ? ' · por WhatsApp' : ''}`);
    res.status(201).json({ id, destinatarios: elegidos.length });
    // Correo y WhatsApp después de contestar: no detienen la pantalla. Cada uno deja su estado por persona.
    setImmediate(() => mandar(id).catch(e => console.error('[avisos] envío:', e.message)));
  }));
  async function mandar(id) {
    const a = db.prepare('SELECT * FROM main.avisos WHERE id = ?').get(id);
    const filas = db.prepare("SELECT d.*, p.correo AS correo_p, p.telefono, u.correo AS correo_u FROM main.avisos_destinatarios d LEFT JOIN main.personal p ON p.id = d.personal_id LEFT JOIN usuarios u ON u.id = COALESCE(d.usuario_id, p.usuario_id) WHERE d.aviso_id = ?").all(id);
    const fija = (campo, estado, did) => db.prepare(`UPDATE main.avisos_destinatarios SET ${campo === 'correo' ? 'correo_estado' : 'whatsapp_estado'} = ? WHERE id = ?`).run(estado, did);
    for (const d of filas) {
      if (d.correo_estado === 'pendiente') {
        const para = d.correo_p || d.correo_u;
        if (!para) fija('correo', 'sin_correo', d.id);
        else if (!correo.configurado) fija('correo', 'sin_configurar', d.id);
        else {
          try {
            await correo.enviar(para, (a.urgente ? 'URGENTE · ' : '') + 'Aviso: ' + a.titulo, { titulo: a.titulo, saludo: 'Hola, ' + d.nombre.split(' ')[0] + ':', mensaje: a.texto,
              pie: `Aviso de ${a.creado_por_nombre || 'Saneadren'}. Marca «Enterado» en el reloj checador, en tu celular o en el sistema.` });
            fija('correo', 'enviado', d.id);
          } catch { fija('correo', 'error', d.id); }
        }
      }
      if (d.whatsapp_estado === 'pendiente') {
        const tel = ult10(d.telefono);
        if (tel.length !== 10) fija('whatsapp', 'sin_telefono', d.id);
        else fija('whatsapp', (await app.locals.whatsapp.plantilla('52' + tel, [a.titulo, a.texto])) ? 'enviado' : 'error', d.id);
      }
    }
  }

  // ---------- Los que publicó (o todos, Dirección) ----------
  const resumen = a => ({ ...a, total: a.total, leidos: a.leidos, vigente: !a.retirado_at && (!a.vence || a.vence >= hoy()) });
  app.get('/api/avisos', h((req, res) => {
    if (!puede(req, 'avisos.publicar')) return negar(res);
    const dir = P.direccion(req);
    const l = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM main.avisos_destinatarios d WHERE d.aviso_id = a.id) AS total, (SELECT COUNT(*) FROM main.avisos_destinatarios d WHERE d.aviso_id = a.id AND d.enterado_at IS NOT NULL) AS leidos
      FROM main.avisos a ${dir ? '' : 'WHERE a.creado_por = ?'} ORDER BY a.id DESC LIMIT 200`).all(...(dir ? [] : [req.usuarioSesion.id]));
    res.json({ avisos: l.map(resumen) });
  }));
  const propio = (req, a) => a && (P.direccion(req) || a.creado_por === req.usuarioSesion.id);
  app.get('/api/avisos/:id', h((req, res) => {
    if (!puede(req, 'avisos.publicar')) return negar(res);
    const a = db.prepare('SELECT * FROM main.avisos WHERE id = ?').get(idDe(req.params.id));
    if (!propio(req, a)) return res.status(404).json({ error: 'Aviso no encontrado' });
    const d = db.prepare('SELECT id, nombre, personal_id, usuario_id, enterado_at, enterado_en, correo_estado, whatsapp_estado FROM main.avisos_destinatarios WHERE aviso_id = ? ORDER BY enterado_at IS NOT NULL, nombre').all(a.id);
    res.json({ aviso: resumen({ ...a, total: d.length, leidos: d.filter(x => x.enterado_at).length }), destinatarios: d });
  }));
  app.post('/api/avisos/:id/retirar', h((req, res) => {
    if (!puede(req, 'avisos.publicar')) return negar(res);
    const a = db.prepare('SELECT * FROM main.avisos WHERE id = ?').get(idDe(req.params.id));
    if (!propio(req, a)) return res.status(404).json({ error: 'Aviso no encontrado' });
    if (a.retirado_at) return res.json({ ok: true });
    db.prepare("UPDATE main.avisos SET retirado_at = datetime('now','localtime'), retirado_por_nombre = ? WHERE id = ?").run(req.usuarioSesion.nombre, a.id);
    audit(req, a.id, 'retiró', `«${a.titulo}»`);
    res.json({ ok: true });
  }));

  // ---------- Los míos (Inicio del CRM) ----------
  const deUsuario = uid => "(d.usuario_id = " + Number(uid) + " OR d.personal_id IN (SELECT id FROM main.personal WHERE usuario_id = " + Number(uid) + "))";
  app.get('/api/avisos-mios', h((req, res) => {
    const l = db.prepare(`SELECT a.id, a.titulo, a.texto, a.urgente, a.created_at, a.creado_por_nombre AS de FROM main.avisos a JOIN main.avisos_destinatarios d ON d.aviso_id = a.id
      WHERE ${VIGENTE} AND ${deUsuario(req.usuarioSesion.id)} GROUP BY a.id HAVING MAX(d.enterado_at) IS NULL ORDER BY a.urgente DESC, a.id DESC`).all(hoy());
    res.json({ avisos: l });
  }));
  app.post('/api/avisos-mios/:id/enterado', h((req, res) => {
    const n = enterado(idDe(req.params.id), `d.usuario_id = ? OR d.personal_id IN (SELECT id FROM main.personal WHERE usuario_id = ?)`, [req.usuarioSesion.id, req.usuarioSesion.id], 'sistema');
    if (!n) return res.status(404).json({ error: 'Ese aviso ya no está' });
    res.json({ ok: true });
  }));
  // Marca «Enterado» en todas las filas de esa persona en ese aviso (la misma persona puede estar como personal y usuario).
  function enterado(avisoId, quien, params, donde) {
    const filas = db.prepare(`SELECT d.id FROM main.avisos_destinatarios d JOIN main.avisos a ON a.id = d.aviso_id WHERE d.aviso_id = ? AND (${quien})`).all(avisoId, ...params);
    for (const f of filas) db.prepare("UPDATE main.avisos_destinatarios SET enterado_at = COALESCE(enterado_at, datetime('now','localtime')), enterado_en = COALESCE(enterado_en, ?) WHERE id = ?").run(donde, f.id);
    return filas.length;
  }

  // ---------- Reloj checador y celular (sin sesión: server/checador.js los llama) ----------
  // Cada aviso pendiente lleva un token de un solo dispositivo y 15 min para marcar «Enterado» sin volver a pedir el PIN.
  const tokens = new Map();
  setInterval(() => { const ahora = Date.now(); for (const [k, v] of tokens) if (v.expira < ahora) tokens.delete(k); }, 5 * 60000).unref();
  function pendientes(personalId, dispositivoId) {
    const p = db.prepare('SELECT usuario_id FROM main.personal WHERE id = ?').get(personalId);
    const l = db.prepare(`SELECT a.id, a.titulo, a.texto, a.urgente, a.created_at, a.creado_por_nombre AS de FROM main.avisos a JOIN main.avisos_destinatarios d ON d.aviso_id = a.id
      WHERE ${VIGENTE} AND (d.personal_id = ? OR (? IS NOT NULL AND d.usuario_id = ?)) GROUP BY a.id HAVING MAX(d.enterado_at) IS NULL ORDER BY a.urgente DESC, a.id DESC LIMIT 10`).all(hoy(), personalId, p?.usuario_id ?? null, p?.usuario_id ?? null);
    return l.map(a => { const t = crypto.randomBytes(18).toString('base64url'); tokens.set(t, { aviso: a.id, personal: personalId, usuario: p?.usuario_id ?? null, dispositivo: dispositivoId, expira: Date.now() + TOKEN_MS }); return { ...a, enterado: t }; });
  }
  const enteradoPublico = celular => (req, res) => {
    const t = tokens.get(String(req.body?.enterado || ''));
    if (!t || t.expira < Date.now() || t.dispositivo !== req.kiosco.id) return res.status(401).json({ error: 'Se acabó el tiempo. Vuelve a identificarte para marcarlo.' });
    tokens.delete(String(req.body.enterado));
    enterado(t.aviso, 'd.personal_id = ? OR (? IS NOT NULL AND d.usuario_id = ?)', [t.personal, t.usuario, t.usuario], celular ? 'celular' : 'reloj checador «' + req.kiosco.nombre + '»');
    res.json({ ok: true });
  };

  const api = { pendientes, enteradoPublico };
  app.locals.avisos = api;
  return api;
};
