// CHECAR POR WHATSAPP (RH · F5b, 2026-11-05, decidido con Dirección): respaldo del «checar desde el celular» para los
// técnicos foráneos. Usa la WhatsApp Business Platform (Cloud API) de Meta con un número de la empresa.
//  · Quién: solo quien RH active en su ficha («Puede checar por WhatsApp»), activo, con alta en el checador, y SOLO
//    desde el celular de su ficha (se comparan los últimos 10 dígitos). Sin PIN en el chat (quedaría escrito en su
//    WhatsApp a la vista de cualquiera).
//  · Cómo: escribe cualquier cosa → el bot responde con un menú (lista) de qué registrar → elige → queda la checada.
//  · Validez: sin foto ni ubicación (así lo dice el aviso de privacidad), cada checada queda «POR REVISAR» y la acepta
//    RH o el supervisor. Hora: la del mensaje según WhatsApp si llegó hace menos de 15 min; si no, la del servidor.
//  · Seguridad: el webhook comprueba la firma X-Hub-Signature-256 (HMAC SHA-256 del cuerpo con el App Secret); cada
//    mensaje se procesa una sola vez (Meta reintenta hasta 36 h); tope de mensajes por número. Sin configurar (faltan
//    variables), el webhook no acepta nada.
//  · Documentación revisada (2026-11-05): webhooks (verificación hub.*, firma), payload de mensajes de texto y de
//    list_reply, y el envío de listas interactivas (máx. 10 filas; título de fila 24 caracteres; botón 20).
//  · Variables (.env del servidor): WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET y,
//    opcional, WHATSAPP_API_URL (por omisión https://graph.facebook.com/v27.0).
const crypto = require('crypto');
const { ahoraMexico } = require('./fechas');
const { TIPOS, SIGUIENTE } = require('./checador');

const ult10 = v => String(v || '').replace(/\D/g, '').slice(-10);
const MENSAJES_TOPE = 30, VENTANA_MS = 10 * 60 * 1000, DUPLICADO_MS = 2 * 60 * 1000, RETRASO_MAX_S = 15 * 60;
const config = () => ({
  token: process.env.WHATSAPP_TOKEN || '', telefonoId: process.env.WHATSAPP_PHONE_ID || '',
  verificar: process.env.WHATSAPP_VERIFY_TOKEN || '', secreto: process.env.WHATSAPP_APP_SECRET || '',
  api: (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v27.0').replace(/\/+$/, ''),
});
const configurado = () => { const c = config(); return !!(c.token && c.telefonoId && c.verificar && c.secreto); };

function migrar(db) {
  const cols = db.prepare('PRAGMA table_info(personal)').all().map(c => c.name);
  if (!cols.includes('checa_whatsapp')) db.exec('ALTER TABLE personal ADD COLUMN checa_whatsapp INTEGER NOT NULL DEFAULT 0');
  // Solo para no procesar dos veces el mismo mensaje y para la bitácora: sin el texto completo del chat.
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wamid TEXT NOT NULL UNIQUE,
      telefono TEXT, personal_id INTEGER REFERENCES personal(id),
      resultado TEXT, checada_id INTEGER REFERENCES checadas(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

module.exports = function whatsapp(app, db, h) {
  migrar(db);
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const ultimaDe = (personaId, fecha) => db.prepare("SELECT tipo, hora FROM main.checadas WHERE personal_id = ? AND fecha = ? AND estado <> 'anulada' ORDER BY momento_utc DESC, id DESC LIMIT 1").get(personaId, fecha);
  // Los mensajes guardados solo sirven para no repetir: se borran a los 90 días (aviso de privacidad).
  const limpiar = () => db.prepare("DELETE FROM main.whatsapp_mensajes WHERE created_at < datetime('now','localtime','-90 days')").run();
  setInterval(() => { try { limpiar(); } catch (e) { console.error('[whatsapp] limpieza:', e.message); } }, 12 * 3600000).unref();

  // ---------- Enviar ----------
  async function enviar(para, cuerpo) {
    const c = config();
    try {
      const r = await fetch(`${c.api}/${encodeURIComponent(c.telefonoId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...cuerpo }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) console.error('[whatsapp] Meta respondió ' + r.status + ' al enviar un mensaje'); // sin el cuerpo: puede traer datos
    } catch (e) { console.error('[whatsapp] no se pudo enviar:', e.message); }
  }
  const texto = (para, t) => enviar(para, { type: 'text', text: { preview_url: false, body: t } });
  function menu(para, p) {
    const a = ahoraMexico(), u = ultimaDe(p.id, a.fecha), sug = SIGUIENTE[u?.tipo || ''];
    const orden = [sug, ...Object.keys(TIPOS).filter(k => k !== sug)];
    return enviar(para, { type: 'interactive', interactive: { type: 'list',
      header: { type: 'text', text: 'Reloj checador · Saneadren' },
      body: { text: `Hola, ${p.nombre.split(/\s+/)[0]}. Son las ${a.hora.slice(0, 5)}.${u ? ` Tu última checada de hoy: ${TIPOS[u.tipo]} a las ${u.hora.slice(0, 5)}.` : ''}\n¿Qué vas a registrar?` },
      footer: { text: 'Por WhatsApp queda por revisar (sin foto ni GPS)' },
      action: { button: 'Registrar', sections: [{ title: 'Elige una opción', rows: orden.map(k => ({ id: 'checar:' + k, title: TIPOS[k], ...(k === sug ? { description: 'Sugerido' } : {}) })) }] } } });
  }

  // ---------- Recibir (webhook de Meta) ----------
  // Sin configurar, con frase o firma equivocadas: 401 (como cualquier ruta sin credenciales).
  app.get('/api/publico/whatsapp', h((req, res) => {
    const c = config();
    if (configurado() && req.query['hub.mode'] === 'subscribe' && typeof req.query['hub.verify_token'] === 'string' && req.query['hub.verify_token'].length === c.verificar.length
      && crypto.timingSafeEqual(Buffer.from(req.query['hub.verify_token']), Buffer.from(c.verificar))) return res.type('text').send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(401);
  }));
  const porNumero = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of porNumero) if (v.reinicia <= t) porNumero.delete(k); }, VENTANA_MS).unref();
  app.post('/api/publico/whatsapp', h(async (req, res) => {
    if (!configurado()) return res.sendStatus(401);
    const crudo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), firma = String(req.get('x-hub-signature-256') || '');
    const esperada = 'sha256=' + crypto.createHmac('sha256', config().secreto).update(crudo).digest('hex');
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return res.sendStatus(401);
    let datos; try { datos = JSON.parse(crudo.toString('utf8')); } catch { return res.sendStatus(400); }
    res.sendStatus(200); // Meta solo necesita el 200; lo demás se hace después
    const mensajes = (datos?.entry || []).flatMap(e => (e?.changes || []).flatMap(c => (c?.field === 'messages' ? c?.value?.messages || [] : [])));
    for (const m of mensajes.slice(0, 20)) await procesar(m).catch(e => console.error('[whatsapp] error al procesar:', e.message));
  }));

  async function procesar(m) {
    const wamid = String(m?.id || ''), de = String(m?.from || '').replace(/\D/g, '');
    if (!wamid || wamid.length > 200 || de.length < 10 || de.length > 15) return;
    if (!db.prepare('INSERT OR IGNORE INTO main.whatsapp_mensajes (wamid, telefono) VALUES (?, ?)').run(wamid, '***' + de.slice(-4)).changes) return; // ya se procesó
    const marcar = (resultado, pid = null, cid = null) => db.prepare('UPDATE main.whatsapp_mensajes SET resultado = ?, personal_id = ?, checada_id = ? WHERE wamid = ?').run(resultado, pid, cid, wamid);
    const t = Date.now(); let r = porNumero.get(de);
    if (!r || r.reinicia <= t) { r = { n: 0, reinicia: t + VENTANA_MS }; porNumero.set(de, r); }
    if (++r.n > MENSAJES_TOPE) return marcar('demasiados mensajes');
    const gente = db.prepare("SELECT * FROM main.personal WHERE activo = 1 AND checa = 1 AND checa_whatsapp = 1 AND codigo_checador IS NOT NULL AND telefono IS NOT NULL AND telefono <> ''").all().filter(p => ult10(p.telefono) === ult10(de));
    if (gente.length !== 1) {
      marcar(gente.length ? 'número repetido en varias fichas' : 'número no autorizado');
      if (r.n <= 3) await texto(de, gente.length ? 'Este número está en la ficha de más de una persona. Pide a Recursos Humanos que lo corrija.' : 'Este número no está autorizado para checar por WhatsApp. Si eres de Saneadren, pide a Recursos Humanos que lo active en tu ficha.');
      return;
    }
    const p = gente[0], elegido = m?.type === 'interactive' && m?.interactive?.type === 'list_reply' ? String(m.interactive.list_reply?.id || '') : '';
    const tipo = /^checar:([a-z_]+)$/.exec(elegido)?.[1];
    if (!tipo || !TIPOS[tipo]) { marcar('menú', p.id); return menu(de, p); }
    // Hora: la del mensaje (WhatsApp la pone al recibirlo) si es reciente; si no, la del servidor.
    const ts = Number(m.timestamp) * 1000, ahora = Date.now(), reciente = Number.isFinite(ts) && ts <= ahora + 60000 && ahora - ts <= RETRASO_MAX_S * 1000;
    const a = ahoraMexico(reciente ? new Date(Math.min(ts, ahora)) : new Date());
    const previa = db.prepare("SELECT id, hora FROM main.checadas WHERE personal_id = ? AND tipo = ? AND estado <> 'anulada' AND momento_utc >= ? ORDER BY id DESC LIMIT 1")
      .get(p.id, tipo, new Date(ahora - DUPLICADO_MS).toISOString());
    if (previa) { marcar('repetida', p.id, previa.id); return texto(de, `✔ Tu ${TIPOS[tipo].toLowerCase()} ya estaba registrada a las ${previa.hora.slice(0, 5)}.`); }
    const nota = `Por WhatsApp desde el ***${de.slice(-4)} (sin foto ni ubicación)${reciente ? '' : ' · llegó tarde: hora del servidor'}`;
    const id = Number(db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, sucursal_id, estado, observaciones)
      VALUES (?, ?, ?, ?, ?, 'whatsapp', ?, 'por_revisar', ?)`).run(p.id, tipo, a.utc, a.fecha, a.hora, p.sucursal_id, nota).lastInsertRowid);
    marcar('checada', p.id, id);
    audit(null, p.id, 'checada por WhatsApp', `${p.nombre}: ${TIPOS[tipo]} ${a.fecha} ${a.hora.slice(0, 5)} (por revisar)`);
    await texto(de, `✔ ${TIPOS[tipo]} registrada a las ${a.hora.slice(0, 5)} del ${a.fecha.split('-').reverse().join('/')}.\nQueda por revisar (sin foto ni ubicación). Si te equivocaste, avisa a Recursos Humanos.`);
  }

  // ---------- Administración ----------
  app.get('/api/asistencia/whatsapp', h((req, res) => {
    if (!puede(req, 'personal.ver')) return res.status(403).json({ error: 'No tienes permiso' });
    res.json({ configurado: configurado() });
  }));
  app.put('/api/asistencia/personal/:id/whatsapp', h((req, res) => {
    if (!puede(req, 'personal.editar')) return res.status(403).json({ error: 'No tienes permiso para cambiar el checador' });
    const p = db.prepare('SELECT * FROM personal WHERE id = ?').get(Number(req.params.id) || 0); // vista: solo sus sucursales
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (typeof req.body?.activo !== 'boolean') return res.status(400).json({ error: 'Indica si se activa o no' });
    if (app.locals.personal.esPropio(req, res, p.id, 'activar el checar por WhatsApp')) return;
    if (req.body.activo) {
      if (!p.activo || !p.codigo_checador) return res.status(409).json({ error: 'Primero dala de alta en el reloj checador (código y PIN)' });
      if (ult10(p.telefono).length !== 10) return res.status(409).json({ error: 'Su ficha no tiene un celular de 10 dígitos: agrégalo primero (con ese número checará)' });
      const otro = db.prepare("SELECT nombre, telefono FROM main.personal WHERE id <> ? AND activo = 1 AND checa_whatsapp = 1 AND telefono IS NOT NULL").all(p.id).find(x => ult10(x.telefono) === ult10(p.telefono));
      if (otro) return res.status(409).json({ error: `Ese celular ya lo usa ${otro.nombre} para checar por WhatsApp` });
    }
    db.prepare("UPDATE main.personal SET checa_whatsapp = ?, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(req.body.activo ? 1 : 0, p.id);
    audit(req, p.id, 'checador', `${p.nombre}: ${req.body.activo ? 'puede checar por WhatsApp desde el ***' + ult10(p.telefono).slice(-4) : 'ya no checa por WhatsApp'}`);
    res.json({ ok: true, checa_whatsapp: !!req.body.activo, configurado: configurado() });
  }));
};
module.exports.configurado = configurado;
