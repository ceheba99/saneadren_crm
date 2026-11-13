// CHECAR POR WHATSAPP (RH · F5b, 2026-11-05, decidido con Dirección): respaldo del «checar desde el celular» para los
// técnicos foráneos. Usa la WhatsApp Business Platform (Cloud API) de Meta con un número de la empresa.
//  · Quién: solo quien RH active en su ficha («Puede checar por WhatsApp»), activo, con alta en el checador, y SOLO
//    desde el celular de su ficha (se comparan los últimos 10 dígitos). Sin PIN en el chat (quedaría escrito en su
//    WhatsApp a la vista de cualquiera).
//  · Cómo: escribe cualquier cosa → el bot responde con un menú (lista) de qué registrar → elige → queda la checada.
//  · Foto y ubicación (2026-11-13, Dirección): RH elige en la ficha qué pide el bot a cada persona: nada, solo
//    ubicación, solo foto, o las dos (por omisión las dos). Al elegir qué registra, la hora queda fija y el bot pide lo
//    que falte (botón «Enviar ubicación» de WhatsApp y una selfie); tiene 5 min. Si no llega, la checada se guarda igual
//    «por revisar» con la nota de qué faltó (para no perder la hora si se va la señal). La ubicación se compara con las
//    ZONAS que RH da de alta (punto + radio) y asigna a cada persona; fuera de sus zonas, sin zonas, ubicación elegida
//    en el mapa (no la actual) o algo reenviado → «por revisar». Con todo lo pedido y dentro de su zona, la checada vale.
//    La foto se baja de Meta (vive 7 días ahí) y se guarda cifrada como las del kiosco. Docs revisados 2026-11-13:
//    «location request messages» (interactive location_request_message / action send_location; la respuesta trae
//    location.latitude/longitude y name/address solo si eligió un lugar) y «media» (GET /{media-id} → url que dura
//    5 min; se baja con el mismo token).
//  · Validez sin foto ni ubicación (si RH elige «nada»): cada checada queda «POR REVISAR» y la acepta RH o el
//    supervisor. Hora: la del mensaje según WhatsApp (la pone Meta y viene firmada), aunque llegue tarde por la
//    señal (2026-11-13, Dirección: que no le cuente retardo por culpa de la red); si llegó con más de 15 min de retraso
//    se anota en la checada. Solo si la hora no es válida o viene del futuro se usa la del servidor.
//  · Solo números de México (52 / 521 + 10 dígitos) y solo mensajes dirigidos al número de la empresa configurado
//    (WHATSAPP_PHONE_ID): si en la app de Meta hay otro número conectado (p. ej. el de prueba), sus mensajes se ignoran.
//  · Seguridad: el webhook comprueba la firma X-Hub-Signature-256 (HMAC SHA-256 del cuerpo con el App Secret); cada
//    mensaje se procesa una sola vez (Meta reintenta hasta 36 h); tope de mensajes por número. Sin configurar (faltan
//    variables), el webhook no acepta nada.
//  · Documentación revisada (2026-11-05): webhooks (verificación hub.*, firma), payload de mensajes de texto y de
//    list_reply, y el envío de listas interactivas (máx. 10 filas; título de fila 24 caracteres; botón 20).
//  · Variables (.env del servidor): WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET y,
//    opcional, WHATSAPP_API_URL (por omisión https://graph.facebook.com/v27.0).
const crypto = require('crypto');
const { ahoraMexico } = require('./fechas');
const { TIPOS, SIGUIENTE, distanciaM, distanciaTexto } = require('./checador');

const ult10 = v => String(v || '').replace(/\D/g, '').slice(-10);
// Números de México: WhatsApp los manda como 521 + 10 dígitos (el «1» de celulares de antes), pero hay que contestarles
// a 52 + 10 dígitos; si no, Meta rechaza el envío (p. ej. «el número no está en la lista autorizada» del número de prueba).
const destino = de => (/^521\d{10}$/.test(de) ? '52' + de.slice(3) : de);
// Solo celulares de México: sin esto, un número de otro país con los mismos 10 últimos dígitos (p. ej. +1 442…) pasaría
// como el de la ficha.
const esMexico = de => /^521?\d{10}$/.test(de);
const retrasoTexto = s => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const MENSAJES_TOPE = 30, VENTANA_MS = 10 * 60 * 1000, DUPLICADO_MS = 2 * 60 * 1000, RETRASO_MAX_S = 15 * 60;
// Qué pide el bot (lo elige RH en la ficha) y cuánto espera la foto/ubicación.
const PIDE = { ambas: 'Foto y ubicación', ubicacion: 'Solo ubicación', foto: 'Solo foto', nada: 'Nada (queda por revisar)' };
const ESPERA_MS = Number(process.env.WHATSAPP_ESPERA_MS) || 5 * 60 * 1000, MAX_FOTO_WA = 5 * 1024 * 1024, RADIO_ZONA_M = 300;
const pideUbic = pide => pide === 'ambas' || pide === 'ubicacion', pideFoto = pide => pide === 'ambas' || pide === 'foto';
// Ubicación que pega RH: «20.5888, -100.3899» o un enlace largo de Google Maps (…/@20.58,-100.38,17z, ?q=…, !3d…!4d…).
function ubicacionDe(txt) {
  const crudo = String(txt || '').trim().slice(0, 2000);
  let t; try { t = decodeURIComponent(crudo); } catch { t = crudo; }
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const m = t.match(new RegExp('^' + num + '\\s*,\\s*' + num + '$')) || t.match(new RegExp('!3d' + num + '!4d' + num))
    || t.match(new RegExp('[?&](?:q|ll|query|center|destination)=' + num + ',\\s*' + num)) || t.match(new RegExp('@' + num + ',' + num));
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}
const config = () => ({
  token: process.env.WHATSAPP_TOKEN || '', telefonoId: process.env.WHATSAPP_PHONE_ID || '',
  verificar: process.env.WHATSAPP_VERIFY_TOKEN || '', secreto: process.env.WHATSAPP_APP_SECRET || '',
  api: (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v27.0').replace(/\/+$/, ''),
});
const configurado = () => { const c = config(); return !!(c.token && c.telefonoId && c.verificar && c.secreto); };

function migrar(db) {
  const cols = db.prepare('PRAGMA table_info(personal)').all().map(c => c.name);
  if (!cols.includes('checa_whatsapp')) db.exec('ALTER TABLE personal ADD COLUMN checa_whatsapp INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('whatsapp_pide')) db.exec("ALTER TABLE personal ADD COLUMN whatsapp_pide TEXT NOT NULL DEFAULT 'ambas'");
  // Problema con la ubicación de una checada por WhatsApp (fuera de zona, no la mandó…): sale en Inicio hasta revisarla.
  if (!db.prepare('PRAGMA table_info(checadas)').all().some(c => c.name === 'alerta_ubicacion')) db.exec('ALTER TABLE checadas ADD COLUMN alerta_ubicacion TEXT');
  // Zonas donde se puede checar por WhatsApp (punto + radio) y a quién aplica cada una. Checada en espera de su foto o
  // ubicación (una por persona; dura 5 min): sin la foto, solo el número que da Meta para bajarla.
  db.exec(`
    CREATE TABLE IF NOT EXISTS checador_zonas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, radio_m INTEGER NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      creado_por TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS checador_zonas_personal (
      zona_id INTEGER NOT NULL REFERENCES checador_zonas(id),
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      PRIMARY KEY (zona_id, personal_id)
    );
    CREATE TABLE IF NOT EXISTS whatsapp_pendientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL UNIQUE REFERENCES personal(id),
      tipo TEXT NOT NULL, momento_ms INTEGER NOT NULL, nota_hora TEXT, de TEXT NOT NULL, pide TEXT NOT NULL,
      lat REAL, lon REAL, ubic_elegida INTEGER NOT NULL DEFAULT 0, foto_media TEXT,
      expira_ms INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
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
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: destino(para), ...cuerpo }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        // Solo el código y el motivo de Meta (p. ej. 190 = token vencido, 131030 = número no autorizado), sin el número.
        const e = (await r.json().catch(() => ({})))?.error || {};
        const motivo = `Meta rechazó el envío (HTTP ${r.status}, código ${e.code ?? '—'}): ${String(e.message || '').replace(/\+?\d{10,15}/g, '***').slice(0, 200)}`;
        console.error('[whatsapp] ' + motivo);
        app.locals.registro?.servicio('whatsapp_fallo', motivo);
        return false;
      }
      return true;
    } catch (e) { console.error('[whatsapp] no se pudo enviar:', e.message); app.locals.registro?.servicio('whatsapp_fallo', 'No se pudo conectar con Meta: ' + String(e.message).slice(0, 200)); return false; }
  }
  const texto = (para, t) => enviar(para, { type: 'text', text: { preview_url: false, body: t } });
  // Avisos (2026-11-11, server/avisos.js): fuera de la ventana de 24 h Meta solo deja mandar PLANTILLAS aprobadas.
  // Variables: WHATSAPP_PLANTILLA_AVISO (nombre de la plantilla en Meta, con {{1}} = título y {{2}} = texto en el
  // cuerpo) y WHATSAPP_PLANTILLA_IDIOMA (por omisión es_MX). Los valores van en una sola línea (sin saltos ni tabs).
  const plantillaLista = () => configurado() && !!process.env.WHATSAPP_PLANTILLA_AVISO;
  const enLinea = (t, max) => String(t || '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, max);
  function plantilla(para, valores) {
    if (!plantillaLista()) return Promise.resolve(false);
    return enviar(para, { type: 'template', template: { name: process.env.WHATSAPP_PLANTILLA_AVISO, language: { code: process.env.WHATSAPP_PLANTILLA_IDIOMA || 'es_MX' },
      components: [{ type: 'body', parameters: valores.map((v, i) => ({ type: 'text', text: enLinea(v, i ? 900 : 120) || '—' })) }] } });
  }
  app.locals.whatsapp = { plantilla, plantillaLista };
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
  // Logs (2026-11-13): por qué no contesta el bot. Una vez cada 10 min por motivo, para no llenar el registro.
  const ultimoRechazo = new Map();
  const anotarRechazo = (motivo, detalle) => {
    const t = Date.now(); if ((ultimoRechazo.get(motivo) || 0) > t - VENTANA_MS) return;
    ultimoRechazo.set(motivo, t); console.error('[whatsapp] ' + detalle); app.locals.registro?.servicio('whatsapp_rechazado', detalle);
  };
  setInterval(() => { const t = Date.now(); for (const [k, v] of porNumero) if (v.reinicia <= t) porNumero.delete(k); }, VENTANA_MS).unref();
  app.post('/api/publico/whatsapp', h(async (req, res) => {
    if (!configurado()) return res.sendStatus(401);
    const crudo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), firma = String(req.get('x-hub-signature-256') || '');
    const esperada = 'sha256=' + crypto.createHmac('sha256', config().secreto).update(crudo).digest('hex');
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
      anotarRechazo('firma', `Firma ${firma ? 'que no coincide' : 'ausente'}: revisa WHATSAPP_APP_SECRET`);
      return res.sendStatus(401);
    }
    let datos; try { datos = JSON.parse(crudo.toString('utf8')); } catch { return res.sendStatus(400); }
    res.sendStatus(200); // Meta solo necesita el 200; lo demás se hace después
    // Solo lo que llegó al número de la empresa configurado (otro número de la misma app de Meta no cuenta).
    const propio = String(config().telefonoId);
    const cambios = (datos?.entry || []).flatMap(e => (e?.changes || []).filter(c => c?.field === 'messages' && (c?.value?.messages || []).length));
    const ajenos = cambios.filter(c => String(c?.value?.metadata?.phone_number_id || '') !== propio);
    if (ajenos.length) anotarRechazo('numero', `Mensaje a otro número de Meta (Phone ID terminado en …${String(ajenos[0]?.value?.metadata?.phone_number_id || '').slice(-4)}): revisa WHATSAPP_PHONE_ID`);
    const mensajes = cambios.filter(c => !ajenos.includes(c)).flatMap(c => c.value.messages);
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
    const gente = !esMexico(de) ? [] : db.prepare("SELECT * FROM main.personal WHERE activo = 1 AND checa = 1 AND checa_whatsapp = 1 AND codigo_checador IS NOT NULL AND telefono IS NOT NULL AND telefono <> ''").all().filter(p => ult10(p.telefono) === ult10(de));
    if (gente.length !== 1) {
      marcar(gente.length ? 'número repetido en varias fichas' : esMexico(de) ? 'número no autorizado' : 'número de otro país');
      if (r.n <= 3) await texto(de, gente.length ? 'Este número está en la ficha de más de una persona. Pide a Recursos Humanos que lo corrija.' : 'Este número no está autorizado para checar por WhatsApp. Si eres de Saneadren, pide a Recursos Humanos que lo active en tu ficha.');
      return;
    }
    const p = gente[0];
    // ¿Tiene una checada esperando su foto o ubicación? Si ya se le acabó el tiempo, se guarda primero como esté.
    let pend = db.prepare('SELECT * FROM main.whatsapp_pendientes WHERE personal_id = ?').get(p.id);
    if (pend && pend.expira_ms <= Date.now()) { await finalizar(pend, 'tiempo'); pend = null; }
    const elegido = m?.type === 'interactive' && m?.interactive?.type === 'list_reply' ? String(m.interactive.list_reply?.id || '') : '';
    const tipo = /^checar:([a-z_]+)$/.exec(elegido)?.[1];
    if (tipo && TIPOS[tipo]) {
      if (pend) { await finalizar(pend, 'otra'); pend = null; } // eligió otra cosa sin terminar la anterior: no se pierde
      return elegir(p, de, tipo, m, marcar);
    }
    if (pend && (m?.type === 'location' || m?.type === 'image')) return evidencia(p, pend, de, m, marcar);
    if (pend) { marcar('recordatorio', p.id); return pedirFaltante(pend, true); }
    marcar('menú', p.id); return menu(de, p);
  }

  // Eligió qué registra: la hora queda fija aquí (la del mensaje). Si RH pide foto/ubicación, se espera hasta 5 min.
  async function elegir(p, de, tipo, m, marcar) {
    // Hora: la del mensaje (WhatsApp la pone al recibirlo y viene firmada), aunque llegue tarde; la del servidor solo si
    // la del mensaje no sirve (no es número o viene del futuro).
    const ts = Number(m.timestamp) * 1000, ahora = Date.now(), valida = Number.isFinite(ts) && ts > 0 && ts <= ahora + 60000;
    const momento = valida ? Math.min(ts, ahora) : ahora, retrasoS = Math.round((ahora - momento) / 1000);
    // Repetida: el mismo tipo dentro de ±2 min de la hora del mensaje (como las checadas sin conexión del kiosco).
    const previa = db.prepare("SELECT id, hora FROM main.checadas WHERE personal_id = ? AND tipo = ? AND estado <> 'anulada' AND momento_utc BETWEEN ? AND ? ORDER BY id DESC LIMIT 1")
      .get(p.id, tipo, new Date(momento - DUPLICADO_MS).toISOString(), new Date(momento + DUPLICADO_MS).toISOString());
    if (previa) { marcar('repetida', p.id, previa.id); return texto(de, `✔ Tu ${TIPOS[tipo].toLowerCase()} ya estaba registrada a las ${previa.hora.slice(0, 5)}.`); }
    const notaHora = !valida ? 'la hora del mensaje no era válida: hora del servidor' : retrasoS > RETRASO_MAX_S ? `llegó con ${retrasoTexto(retrasoS)} de retraso (se usó la hora en que lo mandó)` : null;
    const pide = PIDE[p.whatsapp_pide] ? p.whatsapp_pide : 'ambas';
    if (pide === 'nada') {
      const id = guardar({ p, de, tipo, momento, notaHora, pide, revisar: ['sin foto ni ubicación'], avisos: [], lat: null, lon: null, distancia: null, foto: null });
      marcar('checada', p.id, id);
      return confirmar(de, tipo, momento, ['sin foto ni ubicación']);
    }
    const r = db.prepare('INSERT INTO main.whatsapp_pendientes (personal_id, tipo, momento_ms, nota_hora, de, pide, expira_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, tipo, momento, notaHora, de, pide, Date.now() + ESPERA_MS);
    marcar('esperando ' + (pide === 'ambas' ? 'foto y ubicación' : pide), p.id);
    return pedirFaltante(db.prepare('SELECT * FROM main.whatsapp_pendientes WHERE id = ?').get(r.lastInsertRowid), false);
  }

  // Lo que todavía falta: la ubicación (con el botón «Enviar ubicación» de WhatsApp) y/o la selfie.
  function pedirFaltante(pend, recordatorio) {
    const faltaU = pideUbic(pend.pide) && pend.lat == null, faltaF = pideFoto(pend.pide) && !pend.foto_media;
    const que = TIPOS[pend.tipo], hora = ahoraMexico(new Date(pend.momento_ms)).hora.slice(0, 5);
    const min = Math.max(1, Math.ceil((pend.expira_ms - Date.now()) / 60000));
    const inicio = recordatorio ? `Sigo esperando para tu ${que.toLowerCase()} de las ${hora}.` : `Tu ${que.toLowerCase()} queda a las ${hora}.`;
    if (faltaU) return enviar(pend.de, { type: 'interactive', interactive: { type: 'location_request_message',
      body: { text: `${inicio}\n📍 Toca «Enviar ubicación» y manda tu ubicación ACTUAL (no elijas otro lugar).${faltaF ? '\n📷 Después tómate una selfie con la cámara y mándala aquí.' : ''}\nTienes ${min} min; si no llega, queda por revisar.` },
      action: { name: 'send_location' } } });
    if (faltaF) return texto(pend.de, `${inicio}\n📷 Ahora tómate una selfie con la cámara de este chat y mándala aquí (no una foto vieja).\nTienes ${min} min; si no llega, queda por revisar.`);
    return null;
  }

  // Llegó una ubicación o una foto para la checada en espera.
  async function evidencia(p, pend, de, m, marcar) {
    if (m.context?.forwarded || m.context?.frequently_forwarded) {
      marcar('reenviada', p.id);
      return texto(de, 'No se aceptan ubicaciones ni fotos reenviadas. Manda una nueva desde aquí.');
    }
    if (m.type === 'location' && pideUbic(pend.pide) && pend.lat == null) {
      const lat = Number(m.location?.latitude), lon = Number(m.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { marcar('ubicación inválida', p.id); return pedirFaltante(pend, true); }
      // Con nombre o dirección = eligió un lugar del mapa, no su ubicación actual.
      db.prepare('UPDATE main.whatsapp_pendientes SET lat = ?, lon = ?, ubic_elegida = ? WHERE id = ?')
        .run(Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, m.location?.name || m.location?.address ? 1 : 0, pend.id);
      marcar('ubicación', p.id);
    } else if (m.type === 'image' && pideFoto(pend.pide) && !pend.foto_media) {
      const media = String(m.image?.id || '');
      if (!/^[\w.-]{1,100}$/.test(media)) { marcar('foto inválida', p.id); return pedirFaltante(pend, true); }
      db.prepare('UPDATE main.whatsapp_pendientes SET foto_media = ? WHERE id = ?').run(media, pend.id);
      marcar('foto', p.id);
    } else { marcar('evidencia que no se pidió', p.id); return pedirFaltante(pend, true); }
    const ya = db.prepare('SELECT * FROM main.whatsapp_pendientes WHERE id = ?').get(pend.id);
    if (!ya) return null;
    if ((pideUbic(ya.pide) && ya.lat == null) || (pideFoto(ya.pide) && !ya.foto_media)) return pedirFaltante(ya, false);
    return finalizar(ya, 'completa');
  }

  // Guarda la checada en espera con lo que haya llegado. «motivo»: completa, tiempo (se acabaron los 5 min) u otra
  // (eligió otra opción antes de terminar). Se «toma» primero (DELETE) para que dos caminos no la guarden dos veces.
  async function finalizar(pend, motivo) {
    if (!db.prepare('DELETE FROM main.whatsapp_pendientes WHERE id = ?').run(pend.id).changes) return null;
    const p = db.prepare('SELECT * FROM main.personal WHERE id = ?').get(pend.personal_id);
    if (!p) return null;
    const revisar = [], avisos = [], alerta = [];
    let distancia = null, foto = null;
    const ubic = t => { revisar.push(t); alerta.push(t); };
    if (pideUbic(pend.pide)) {
      if (pend.lat == null) ubic('no mandó su ubicación');
      else {
        if (pend.ubic_elegida) ubic('ubicación elegida en el mapa (no la actual)');
        const zonas = db.prepare('SELECT z.* FROM main.checador_zonas z JOIN main.checador_zonas_personal zp ON zp.zona_id = z.id WHERE zp.personal_id = ? AND z.activo = 1').all(p.id);
        if (!zonas.length) ubic('no tiene zonas asignadas para comparar su ubicación');
        else {
          const punto = { lat: pend.lat, lon: pend.lon };
          const cerca = zonas.map(z => ({ z, d: distanciaM(z, punto) })).sort((x, y) => (x.d - x.z.radio_m) - (y.d - y.z.radio_m))[0];
          distancia = cerca.d;
          if (cerca.d <= cerca.z.radio_m) avisos.push(`en la zona «${cerca.z.nombre}»`);
          else ubic(`a ${distanciaTexto(cerca.d)} de la zona «${cerca.z.nombre}» (radio ${cerca.z.radio_m} m)`);
        }
      }
    }
    if (pideFoto(pend.pide)) {
      if (!pend.foto_media) revisar.push('no mandó foto');
      else {
        try { foto = await bajarFoto(pend.foto_media); }
        catch (e) { revisar.push('no se pudo bajar su foto de WhatsApp'); app.locals.registro?.servicio('whatsapp_fallo', 'No se pudo bajar la foto de una checada: ' + String(e.message).slice(0, 200)); }
      }
    }
    const id = guardar({ p, de: pend.de, tipo: pend.tipo, momento: pend.momento_ms, notaHora: pend.nota_hora, pide: pend.pide, revisar, avisos, alerta, lat: pend.lat, lon: pend.lon, distancia, foto });
    await confirmar(pend.de, pend.tipo, pend.momento_ms, revisar, motivo);
    return id;
  }

  // Inserta la checada (con foto cifrada si llegó). Vale si llegó todo lo pedido y está en su zona; si no, por revisar.
  function guardar({ p, de, tipo, momento, notaHora, pide, revisar, avisos, alerta = [], lat, lon, distancia, foto }) {
    const a = ahoraMexico(new Date(momento));
    const notas = [...revisar, `por WhatsApp desde el ***${de.slice(-4)}`, ...(notaHora ? [notaHora] : []), ...avisos];
    const obs = notas.join(' · ').replace(/^./, c => c.toUpperCase()).slice(0, 500);
    const estado = revisar.length ? 'por_revisar' : 'valida';
    const id = db.transaction(() => {
      const nuevo = Number(db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, sucursal_id, estado, observaciones, lat, lon, distancia_m, alerta_ubicacion)
        VALUES (?, ?, ?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?)`).run(p.id, tipo, a.utc, a.fecha, a.hora, p.sucursal_id, estado, obs, lat ?? null, lon ?? null, distancia, alerta.length ? alerta.join('; ').slice(0, 300) : null).lastInsertRowid);
      if (foto) app.locals.checador.guardarFoto(nuevo, foto, a.fecha);
      return nuevo;
    })();
    audit(null, p.id, 'checada por WhatsApp', `${p.nombre}: ${TIPOS[tipo]} ${a.fecha} ${a.hora.slice(0, 5)} (${estado === 'valida' ? 'válida' : 'por revisar'}; pide ${PIDE[pide] || pide})`);
    return id;
  }

  function confirmar(de, tipo, momento, revisar, motivo) {
    const a = ahoraMexico(new Date(momento)), cuando = `${a.hora.slice(0, 5)} del ${a.fecha.split('-').reverse().join('/')}`;
    const inicio = motivo === 'tiempo' ? '⏱ Se acabó el tiempo para tu foto/ubicación.\n' : motivo === 'otra' ? '⚠ Elegiste otra opción antes de terminar la anterior.\n' : '';
    return texto(de, revisar.length
      ? `${inicio}✔ ${TIPOS[tipo]} registrada a las ${cuando}.\nQueda por revisar: ${revisar.join('; ')}. Si te equivocaste, avisa a Recursos Humanos.`
      : `${inicio}✔ ${TIPOS[tipo]} registrada a las ${cuando}. ¡Gracias!`);
  }

  // La foto: Meta da una dirección que dura 5 min y se baja con el mismo token. Solo JPEG de hasta 5 MB, y solo de
  // servidores de Meta (para no mandar el token a otro lado).
  const HOSTS_META = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net)$/i;
  async function bajarFoto(media) {
    const c = config(), auth = { Authorization: 'Bearer ' + c.token };
    const r = await fetch(`${c.api}/${encodeURIComponent(media)}?phone_number_id=${encodeURIComponent(c.telefonoId)}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Meta no dio la foto (HTTP ${r.status})`);
    const j = await r.json().catch(() => ({}));
    let u; try { u = new URL(String(j.url || '')); } catch { throw new Error('Meta no dio la dirección de la foto'); }
    if (!(u.protocol === 'https:' && HOSTS_META.test(u.hostname)) && u.origin !== new URL(c.api).origin) throw new Error('La dirección de la foto no es de Meta: ' + u.hostname);
    if (Number(j.file_size) > MAX_FOTO_WA) throw new Error('La foto pesa más de 5 MB');
    const b = await fetch(u, { headers: auth, signal: AbortSignal.timeout(20000) });
    if (!b.ok) throw new Error(`No se pudo bajar la foto (HTTP ${b.status})`);
    const buf = Buffer.from(await b.arrayBuffer());
    if (buf.length < 1000 || buf.length > MAX_FOTO_WA || !(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw new Error('La foto no es JPEG');
    return buf;
  }

  // Cada 20 s: las checadas que ya no recibieron su foto/ubicación a tiempo se guardan «por revisar».
  setInterval(async () => {
    try {
      for (const pend of db.prepare('SELECT * FROM main.whatsapp_pendientes WHERE expira_ms <= ? ORDER BY id LIMIT 50').all(Date.now())) await finalizar(pend, 'tiempo').catch(e => console.error('[whatsapp] al guardar en espera:', e.message));
    } catch (e) { console.error('[whatsapp] espera:', e.message); }
  }, Number(process.env.WHATSAPP_REVISAR_MS) || 20000).unref();

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

  // ---------- Qué pide el bot a cada persona y sus zonas (2026-11-13) ----------
  const zonaDe = id => db.prepare('SELECT * FROM main.checador_zonas WHERE id = ?').get(Number(id) || 0);
  app.get('/api/asistencia/personal/:id/whatsapp', h((req, res) => {
    if (!puede(req, 'personal.ver')) return res.status(403).json({ error: 'No tienes permiso' });
    const p = db.prepare('SELECT id, checa_whatsapp, whatsapp_pide FROM personal WHERE id = ?').get(Number(req.params.id) || 0); // vista: solo sus sucursales
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const suyas = new Set(db.prepare('SELECT zona_id FROM main.checador_zonas_personal WHERE personal_id = ?').all(p.id).map(x => x.zona_id));
    res.json({ checa_whatsapp: !!p.checa_whatsapp, pide: PIDE[p.whatsapp_pide] ? p.whatsapp_pide : 'ambas', opciones: PIDE, editar: puede(req, 'personal.editar'),
      zonas: db.prepare('SELECT id, nombre, radio_m, activo FROM main.checador_zonas ORDER BY activo DESC, nombre').all().filter(z => z.activo || suyas.has(z.id)).map(z => ({ ...z, activo: !!z.activo, asignada: suyas.has(z.id) })) });
  }));
  app.put('/api/asistencia/personal/:id/whatsapp/config', h((req, res) => {
    if (!puede(req, 'personal.editar')) return res.status(403).json({ error: 'No tienes permiso para cambiar el checador' });
    const p = db.prepare('SELECT id, nombre, whatsapp_pide FROM personal WHERE id = ?').get(Number(req.params.id) || 0);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const pide = String(req.body?.pide || ''), ids = req.body?.zonas;
    if (!PIDE[pide]) return res.status(400).json({ error: 'Elige qué se le pide al checar' });
    if (!Array.isArray(ids) || ids.length > 50 || !ids.every(x => Number.isSafeInteger(x) && x > 0)) return res.status(400).json({ error: 'Revisa las zonas elegidas' });
    const zonas = [...new Set(ids)].map(zonaDe);
    if (zonas.some(z => !z)) return res.status(400).json({ error: 'Una de las zonas ya no existe' });
    if (app.locals.personal.esPropio(req, res, p.id, 'cambiar cómo checa por WhatsApp')) return;
    const antes = db.prepare('SELECT z.nombre FROM main.checador_zonas_personal zp JOIN main.checador_zonas z ON z.id = zp.zona_id WHERE zp.personal_id = ? ORDER BY z.nombre').all(p.id).map(z => z.nombre).join(', ');
    db.transaction(() => {
      db.prepare("UPDATE main.personal SET whatsapp_pide = ?, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(pide, p.id);
      db.prepare('DELETE FROM main.checador_zonas_personal WHERE personal_id = ?').run(p.id);
      const ins = db.prepare('INSERT INTO main.checador_zonas_personal (zona_id, personal_id) VALUES (?, ?)');
      for (const z of zonas) ins.run(z.id, p.id);
    })();
    const ahora = zonas.map(z => z.nombre).sort().join(', ');
    audit(req, p.id, 'checador', `${p.nombre}: por WhatsApp pide «${PIDE[pide]}»${p.whatsapp_pide !== pide ? ` (antes «${PIDE[p.whatsapp_pide] || p.whatsapp_pide}»)` : ''}; zonas: ${ahora || 'ninguna'}${antes !== ahora ? ` (antes: ${antes || 'ninguna'})` : ''}`);
    res.json({ ok: true, aviso: pideUbic(pide) && !zonas.length ? 'Ojo: sin zonas, todas sus checadas con ubicación quedarán «por revisar».' : null });
  }));

  // Zonas: las ve quien ve el personal o la asistencia; las da de alta y cambia quien edita el personal (RH).
  const leerZona = (b, actual) => {
    const nombre = String(b?.nombre ?? actual?.nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre || nombre.length > 60) return { error: 'Ponle un nombre a la zona (máx. 60 letras)' };
    let punto = actual ? { lat: actual.lat, lon: actual.lon } : null;
    if (b?.ubicacion !== undefined) { punto = ubicacionDe(b.ubicacion); if (!punto) return { error: 'Pega la ubicación como «20.5888, -100.3899» o el enlace largo de Google Maps (el corto maps.app.goo.gl no sirve: ábrelo y copia la dirección completa)' }; }
    if (!punto) return { error: 'Falta la ubicación de la zona' };
    const radio = b?.radio_m === undefined || b?.radio_m === null || b?.radio_m === '' ? (actual?.radio_m ?? RADIO_ZONA_M) : Number(b.radio_m);
    if (!Number.isInteger(radio) || radio < 50 || radio > 20000) return { error: 'El radio va de 50 a 20,000 metros' };
    return { nombre, ...punto, radio };
  };
  app.get('/api/asistencia/whatsapp/zonas', h((req, res) => {
    if (!puede(req, 'personal.ver') && !puede(req, 'asistencia.ver')) return res.status(403).json({ error: 'No tienes permiso' });
    res.json({ editar: puede(req, 'personal.editar'), radio_omision: RADIO_ZONA_M,
      zonas: db.prepare('SELECT z.id, z.nombre, z.lat, z.lon, z.radio_m, z.activo, (SELECT COUNT(*) FROM main.checador_zonas_personal zp JOIN main.personal p ON p.id = zp.personal_id WHERE zp.zona_id = z.id AND p.activo = 1) AS personas FROM main.checador_zonas z ORDER BY z.activo DESC, z.nombre').all().map(z => ({ ...z, activo: !!z.activo })) });
  }));
  app.post('/api/asistencia/whatsapp/zonas', h((req, res) => {
    if (!puede(req, 'personal.editar')) return res.status(403).json({ error: 'No tienes permiso para dar de alta zonas' });
    const z = leerZona(req.body);
    if (z.error) return res.status(400).json({ error: z.error });
    if (db.prepare('SELECT 1 FROM main.checador_zonas WHERE lower(nombre) = lower(?)').get(z.nombre)) return res.status(409).json({ error: 'Ya hay una zona con ese nombre' });
    const id = Number(db.prepare('INSERT INTO main.checador_zonas (nombre, lat, lon, radio_m, creado_por) VALUES (?, ?, ?, ?, ?)').run(z.nombre, z.lat, z.lon, z.radio, req.usuarioSesion?.nombre || null).lastInsertRowid);
    app.locals.auditoria?.registrar(req, 'checador_zona', id, 'alta', `Zona «${z.nombre}»: ${z.lat}, ${z.lon} · radio ${z.radio} m`);
    res.status(201).json({ id });
  }));
  app.put('/api/asistencia/whatsapp/zonas/:id', h((req, res) => {
    if (!puede(req, 'personal.editar')) return res.status(403).json({ error: 'No tienes permiso para cambiar zonas' });
    const actual = zonaDe(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Zona no encontrada' });
    const z = leerZona(req.body, actual);
    if (z.error) return res.status(400).json({ error: z.error });
    if (req.body?.activo !== undefined && typeof req.body.activo !== 'boolean') return res.status(400).json({ error: 'Revisa si la zona está activa' });
    if (db.prepare('SELECT 1 FROM main.checador_zonas WHERE lower(nombre) = lower(?) AND id <> ?').get(z.nombre, actual.id)) return res.status(409).json({ error: 'Ya hay una zona con ese nombre' });
    const activo = req.body?.activo === undefined ? actual.activo : (req.body.activo ? 1 : 0);
    db.prepare("UPDATE main.checador_zonas SET nombre = ?, lat = ?, lon = ?, radio_m = ?, activo = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(z.nombre, z.lat, z.lon, z.radio, activo, actual.id);
    app.locals.auditoria?.registrar(req, 'checador_zona', actual.id, 'cambio', `Zona «${actual.nombre}» → «${z.nombre}»: ${z.lat}, ${z.lon} · radio ${z.radio} m${activo ? '' : ' · desactivada'}`);
    res.json({ ok: true });
  }));
};
module.exports.configurado = configurado;
