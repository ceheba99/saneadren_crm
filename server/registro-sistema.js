// REGISTRO DEL SISTEMA (logs, 2026-11-05): lo más importante para vigilar el CRM, solo para Dirección (Ajustes → Logs).
//  · Accesos: quién entró y salió, contraseñas equivocadas, bloqueos por intentos, «¿Olvidaste tu contraseña?» y su uso.
//  · Errores: fallas del servidor (lo que al usuario le sale como «Error interno»), para poder mandarlas a revisar.
//  · Conectados ahora: quién tiene la sesión abierta y su última actividad.
// Los cambios a registros (clientes, usuarios, permisos…) siguen en la Bitácora (server/auditoria.js).
// Nunca se guardan contraseñas ni llaves; de un intento fallido solo se guarda el usuario si existe en el sistema
// (así, si alguien escribe su contraseña en la casilla del usuario, no queda en el registro). Se guarda 180 días.
const DIAS_GUARDA = 180, MAX_FILAS = 100000;
const TTL_SESION_MS = 12 * 60 * 60 * 1000; // el mismo de server/index.js: la sesión vence 12 h después de la última actividad

const EVENTOS = {
  entro: ['acceso', 'info', 'Entró'],
  salio: ['acceso', 'info', 'Salió'],
  fallo: ['acceso', 'aviso', 'Contraseña equivocada'],
  desconocido: ['acceso', 'aviso', 'Usuario que no existe'],
  bloqueado: ['acceso', 'grave', 'Bloqueado por intentos'],
  rechazado: ['acceso', 'aviso', 'Intento mientras estaba bloqueado'],
  olvido: ['acceso', 'info', 'Pidió restablecer su contraseña'],
  restablecio: ['acceso', 'info', 'Restableció su contraseña'],
  error: ['error', 'grave', 'Error del servidor']
};

// «Chrome · Windows», «Safari · iPhone»… Basta para reconocer el equipo sin guardar la cadena completa.
function equipo(ua) {
  ua = String(ua || '');
  if (!ua) return '';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|wget|python|node|axios|Go-http/i.test(ua) ? 'Programa' : 'Otro';
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return so ? `${nav} · ${so}` : nav;
}

module.exports = function registroSistema(app, db, h) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registro_sistema (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      tipo TEXT NOT NULL,            -- acceso | error
      evento TEXT NOT NULL,          -- entro, salio, fallo, desconocido, bloqueado, rechazado, olvido, restablecio, error
      nivel TEXT NOT NULL,           -- info | aviso | grave
      usuario_id INTEGER,
      usuario TEXT,
      ip TEXT,
      equipo TEXT,
      detalle TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_registro_sistema_fecha ON registro_sistema(fecha);
    CREATE INDEX IF NOT EXISTS idx_registro_sistema_tipo ON registro_sistema(tipo, id);
  `);
  const ins = db.prepare('INSERT INTO main.registro_sistema (tipo, evento, nivel, usuario_id, usuario, ip, equipo, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const purgar = () => {
    db.prepare(`DELETE FROM main.registro_sistema WHERE fecha < datetime('now','localtime','-${DIAS_GUARDA} days')`).run();
    db.prepare('DELETE FROM main.registro_sistema WHERE id <= (SELECT MAX(id) FROM main.registro_sistema) - ?').run(MAX_FILAS);
  };
  purgar();
  setInterval(() => { try { purgar(); } catch (e) { console.error('[registro] no se pudo depurar:', e.message); } }, 24 * 3600000).unref();

  // Nunca tumba la petición: si el registro falla, solo se avisa en la consola.
  function anotar(req, evento, { usuario, detalle } = {}) {
    try {
      const [tipo, nivel] = EVENTOS[evento];
      const u = usuario || req?.usuarioSesion || null;
      ins.run(tipo, evento, nivel, u?.id ?? null, u?.nombre ?? null, req?.ipCliente || req?.ip || null,
        equipo(req?.get?.('user-agent')), detalle ? String(detalle).slice(0, 500) : null);
    } catch (e) { console.error('[registro] no se pudo anotar:', e.message); }
  }
  // Busca a quién se refería un intento (por nombre o correo) sin guardar lo tecleado si no existe.
  const quien = texto => {
    texto = String(texto || '').trim();
    if (!texto || texto.length > 254) return null;
    return db.prepare('SELECT id, nombre FROM main.usuarios WHERE nombre = ? OR lower(correo) = lower(?)').get(texto, texto) || null;
  };
  // Errores: ruta sin parámetros (?…) y el mensaje recortado; sin el cuerpo de la petición.
  function error(req, err) {
    const ruta = req ? `${req.method} ${String(req.originalUrl || '').split('?')[0]}`.slice(0, 160) : 'servidor';
    anotar(req, 'error', { detalle: `${ruta} · ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 300)}` });
  }

  app.get('/api/registro-sistema', h((req, res) => {
    if (!req.usuarioSesion?.admin_general) return res.status(403).json({ error: 'Los logs son solo para Dirección' });
    const f = [], p = [];
    const tipo = String(req.query.tipo || '');
    if (tipo === 'acceso' || tipo === 'error') { f.push('tipo = ?'); p.push(tipo); }
    if (tipo === 'fallas') f.push("nivel <> 'info'");
    if (req.query.desde) { f.push('fecha >= ?'); p.push(String(req.query.desde).slice(0, 10)); }
    if (req.query.hasta) { f.push("fecha < date(?, '+1 day')"); p.push(String(req.query.hasta).slice(0, 10)); }
    if (req.query.q) { const q = '%' + String(req.query.q).slice(0, 60) + '%'; f.push('(usuario LIKE ? OR ip LIKE ? OR detalle LIKE ? OR equipo LIKE ?)'); p.push(q, q, q, q); }
    const antesDe = Number(req.query.antes_de);
    if (antesDe > 0) { f.push('id < ?'); p.push(antesDe); }
    const filas = db.prepare(`SELECT * FROM main.registro_sistema ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY id DESC LIMIT 201`).all(...p);
    const hace24 = "datetime('now','localtime','-1 day')";
    const r = db.prepare(`SELECT SUM(evento = 'entro') entradas, SUM(evento IN ('fallo','desconocido')) fallos,
      SUM(evento = 'bloqueado') bloqueos, SUM(tipo = 'error') errores FROM main.registro_sistema WHERE fecha >= ${hace24}`).get();
    const ahora = Date.now();
    const conectados = db.prepare(`SELECT u.id, u.nombre, u.rol, COUNT(*) sesiones, MAX(s.expira) expira
      FROM main.sesiones s JOIN main.usuarios u ON u.id = s.usuario_id WHERE s.expira > ? GROUP BY u.id ORDER BY MAX(s.expira) DESC`).all(ahora)
      .map(c => ({ id: c.id, nombre: c.nombre, rol: c.rol, sesiones: c.sesiones, ultima_actividad: new Date(c.expira - TTL_SESION_MS).toISOString() }));
    for (const c of conectados) {
      const u = db.prepare("SELECT ip, equipo FROM main.registro_sistema WHERE usuario_id = ? AND evento = 'entro' ORDER BY id DESC LIMIT 1").get(c.id);
      c.ip = u?.ip || null; c.equipo = u?.equipo || null;
    }
    res.json({ filas: filas.slice(0, 200), hay_mas: filas.length > 200,
      resumen: { entradas: r.entradas || 0, fallos: r.fallos || 0, bloqueos: r.bloqueos || 0, errores: r.errores || 0 }, conectados, dias_guarda: DIAS_GUARDA });
  }));

  return { anotar, error, quien };
};
module.exports.equipo = equipo;
