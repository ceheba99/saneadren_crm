// REGISTRO DEL SISTEMA (logs, 2026-11-05): lo más importante para vigilar el CRM, solo para Dirección (Ajustes → Logs).
//  · Accesos: quién entró y salió, contraseñas equivocadas, bloqueos por intentos, «¿Olvidaste tu contraseña?» y su uso.
//  · Errores: fallas del servidor (lo que al usuario le sale como «Error interno»), para poder mandarlas a revisar.
//  · Conectados ahora: quién tiene la sesión abierta y su última actividad.
//  · Servicios (2026-11-05): correos que no salieron, respaldo automático diario (hecho o fallido), WhatsApp que Meta
//    rechazó y cada vez que el sistema arranca (actualización o reinicio en Plesk).
//  · Seguridad: descargas de respaldos (la base completa sale del servidor).
//  · Errores en pantalla: fallas del navegador de cualquier usuario (una pantalla que no carga), con tope por persona.
//  · Facturación: lo que ya anota facturas_log (timbrar, cancelar, reenviar, descargar, errores de factura.com).
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
  error: ['error', 'grave', 'Error del servidor'],
  pantalla: ['error', 'aviso', 'Error en pantalla'],
  correo_fallo: ['servicio', 'grave', 'Correo que no salió'],
  respaldo_ok: ['servicio', 'info', 'Respaldo automático hecho'],
  respaldo_fallo: ['servicio', 'grave', 'Respaldo automático falló'],
  whatsapp_fallo: ['servicio', 'aviso', 'WhatsApp no se envió'],
  kiosco_recuperado: ['servicio', 'aviso', 'El reloj checador se recuperó solo'],
  kiosco_sin_respuesta: ['servicio', 'grave', 'El reloj checador no responde'],
  kiosco_atencion: ['servicio', 'aviso', 'El reloj checador necesita atención'],
  kiosco_volvio: ['servicio', 'info', 'El reloj checador ya responde'],
  inicio: ['servicio', 'info', 'Sistema iniciado'],
  descarga: ['seguridad', 'aviso', 'Descargó un respaldo']
};
// Correo a medias: «ma•••@saneadren.com.mx» (se reconoce sin quedar completo en el registro).
const tapar = c => String(c || '').replace(/^([^@]{1,2})[^@]*@/, '$1•••@').slice(0, 120);
const ACCION_FACTURA = { timbrar: 'Timbrar', cancelar: 'Cancelar', reenviar: 'Reenviar por correo', descartar: 'Descartar borrador', verificar: 'Verificar',
  acuse: 'Acuse de cancelación', estatus_cancelacion: 'Estatus de cancelación', descargar_pdf: 'Bajar PDF', descargar_xml: 'Bajar XML', cliente: 'Cliente en factura.com' };

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
  // Eventos sin petición (respaldo, correo, WhatsApp, arranque).
  const servicio = (evento, detalle, usuario) => anotar(null, evento, { usuario, detalle });
  // Errores del navegador: como máximo 20 por persona por hora y sin repetir el mismo en 10 minutos.
  const topePantalla = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of topePantalla) if (v.reinicia <= t) topePantalla.delete(k); }, 3600000).unref();
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

  app.post('/api/registro-sistema/pantalla', h((req, res) => {
    const u = req.usuarioSesion, t = Date.now(), msj = String(req.body?.mensaje || '').replace(/\s+/g, ' ').slice(0, 300);
    if (!msj) return res.status(400).json({ error: 'Falta el mensaje' });
    let c = topePantalla.get(u.id); if (!c || c.reinicia <= t) { c = { n: 0, reinicia: t + 3600000, vistos: new Map() }; topePantalla.set(u.id, c); }
    if (c.n >= 20 || (c.vistos.get(msj) || 0) > t) return res.json({ ok: true, anotado: false });
    c.n++; c.vistos.set(msj, t + 600000);
    const donde = [req.body?.vista, req.body?.archivo].map(x => String(x || '').replace(/[^\w.:/ -]/g, '').slice(0, 80)).filter(Boolean).join(' · ');
    anotar(req, 'pantalla', { detalle: (donde ? donde + ' · ' : '') + msj });
    res.json({ ok: true, anotado: true });
  }));

  // Facturación: los renglones de facturas_log con la misma forma que los demás.
  function filasFacturas(q, desde, hasta, antesDe) {
    const f = [], p = [];
    if (desde) { f.push('l.created_at >= ?'); p.push(desde); }
    if (hasta) { f.push("l.created_at < date(?, '+1 day')"); p.push(hasta); }
    if (antesDe > 0) { f.push('l.id < ?'); p.push(antesDe); }
    if (q) { f.push("(u.nombre LIKE ? OR l.mensaje LIKE ? OR l.accion LIKE ? OR (fa.serie || '-' || fa.folio) LIKE ?)"); const x = '%' + q + '%'; p.push(x, x, x, x); }
    return db.prepare(`SELECT l.id, l.created_at fecha, l.accion, l.resultado, l.http_status, l.mensaje, l.lead_id, u.nombre usuario, fa.serie, fa.folio, fa.entorno
      FROM main.facturas_log l LEFT JOIN main.usuarios u ON u.id = l.usuario_id LEFT JOIN main.facturas fa ON fa.id = l.factura_id
      ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY l.id DESC LIMIT 201`).all(...p).map(r => ({
      id: r.id, fecha: r.fecha, tipo: 'facturacion', evento: r.resultado === 'error' ? 'factura_error' : 'factura_ok', nivel: r.resultado === 'error' ? 'grave' : 'info',
      usuario: r.usuario, ip: null, equipo: null,
      detalle: [ACCION_FACTURA[r.accion] || r.accion, r.serie ? `factura ${r.serie}-${r.folio ?? 'borrador'}` : null, r.entorno === 'sandbox' ? 'pruebas' : null,
        r.http_status ? 'HTTP ' + r.http_status : null, r.mensaje].filter(Boolean).join(' · ').slice(0, 500)
    }));
  }
  const hayTabla = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

  app.get('/api/registro-sistema', h((req, res) => {
    if (!req.usuarioSesion?.admin_general) return res.status(403).json({ error: 'Los logs son solo para Dirección' });
    const f = [], p = [];
    const tipo = String(req.query.tipo || '');
    if (['acceso', 'error', 'servicio', 'seguridad'].includes(tipo)) { f.push('tipo = ?'); p.push(tipo); }
    if (tipo === 'fallas') f.push("nivel <> 'info'");
    if (req.query.desde) { f.push('fecha >= ?'); p.push(String(req.query.desde).slice(0, 10)); }
    if (req.query.hasta) { f.push("fecha < date(?, '+1 day')"); p.push(String(req.query.hasta).slice(0, 10)); }
    if (req.query.q) { const q = '%' + String(req.query.q).slice(0, 60) + '%'; f.push('(usuario LIKE ? OR ip LIKE ? OR detalle LIKE ? OR equipo LIKE ?)'); p.push(q, q, q, q); }
    const antesDe = Number(req.query.antes_de);
    if (antesDe > 0) { f.push('id < ?'); p.push(antesDe); }
    const filas = tipo === 'facturacion'
      ? (hayTabla('facturas_log') ? filasFacturas(String(req.query.q || '').slice(0, 60), String(req.query.desde || '').slice(0, 10), String(req.query.hasta || '').slice(0, 10), antesDe) : [])
      : db.prepare(`SELECT * FROM main.registro_sistema ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY id DESC LIMIT 201`).all(...p);
    const hace24 = "datetime('now','localtime','-1 day')";
    const r = db.prepare(`SELECT SUM(evento = 'entro') entradas, SUM(evento IN ('fallo','desconocido')) fallos,
      SUM(evento = 'bloqueado') bloqueos, SUM(tipo = 'error') errores,
      SUM(tipo = 'servicio' AND nivel <> 'info') servicios FROM main.registro_sistema WHERE fecha >= ${hace24}`).get();
    const facturasError = hayTabla('facturas_log') ? db.prepare(`SELECT COUNT(*) n FROM main.facturas_log WHERE resultado = 'error' AND created_at >= ${hace24}`).get().n : 0;
    const respaldo = db.prepare("SELECT fecha, evento, detalle FROM main.registro_sistema WHERE evento IN ('respaldo_ok', 'respaldo_fallo') ORDER BY id DESC LIMIT 1").get() || null;
    const inicio = db.prepare("SELECT fecha FROM main.registro_sistema WHERE evento = 'inicio' ORDER BY id DESC LIMIT 1").get()?.fecha || null;
    const ahora = Date.now();
    const conectados = db.prepare(`SELECT u.id, u.nombre, u.rol, COUNT(*) sesiones, MAX(s.expira) expira
      FROM main.sesiones s JOIN main.usuarios u ON u.id = s.usuario_id WHERE s.expira > ? GROUP BY u.id ORDER BY MAX(s.expira) DESC`).all(ahora)
      .map(c => ({ id: c.id, nombre: c.nombre, rol: c.rol, sesiones: c.sesiones, ultima_actividad: new Date(c.expira - TTL_SESION_MS).toISOString() }));
    for (const c of conectados) {
      const u = db.prepare("SELECT ip, equipo FROM main.registro_sistema WHERE usuario_id = ? AND evento = 'entro' ORDER BY id DESC LIMIT 1").get(c.id);
      c.ip = u?.ip || null; c.equipo = u?.equipo || null;
    }
    res.json({ filas: filas.slice(0, 200), hay_mas: filas.length > 200,
      resumen: { entradas: r.entradas || 0, fallos: r.fallos || 0, bloqueos: r.bloqueos || 0, errores: r.errores || 0, servicios: r.servicios || 0, facturas_error: facturasError },
      respaldo, inicio, conectados, dias_guarda: DIAS_GUARDA });
  }));

  return { anotar, error, quien, servicio, tapar };
};
module.exports.equipo = equipo;
