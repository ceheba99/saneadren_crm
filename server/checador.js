// RELOJ CHECADOR (RH · F1, 2026-11-03): código y PIN de cada persona, kioscos registrados y checadas que no se borran.
//  · Checa cualquier persona de Personal (tenga o no cuenta del CRM) con su código de 4 dígitos y un PIN de 4 dígitos.
//    El PIN NUNCA se guarda en claro: se pasa por un HMAC con la clave de cifrado del servidor («pimienta») y luego por
//    scrypt con sal. Un PIN de 4 dígitos con un hash común se saca en segundos de una base robada; sin CLAVE_CIFRADO, no.
//    Si se cambia CLAVE_CIFRADO, los PINes dejan de servir y RH genera uno nuevo a cada quien.
//  · RH no ve PINes: genera uno temporal (se muestra una sola vez) y la persona elige el suyo en su primera checada.
//    No se aceptan PINes obvios (1111, 1234, 4321, 1212, su propio código).
//  · Intentos: 5 fallos seguidos → bloqueado 15 min; 10 → bloqueado hasta que RH lo desbloquee. Por kiosco, 20 fallos
//    en 10 min pausan el kiosco; por conexión, 30 tokens de kiosco inválidos en 15 min. El mensaje es siempre el mismo
//    («código o PIN incorrecto»): no dice si el código existe.
//  · Kiosco: una tableta que registra quien tiene «Kioscos del checador». Recibe un token aleatorio (la base guarda solo
//    su hash) y se puede revocar. Sin token válido no se checa. Al kiosco solo le llegan el primer nombre y la hora.
//  · Hora: SIEMPRE la del servidor, en hora de México; la del dispositivo no se usa.
//  · Checadas: nunca se borran ni se les cambia la hora (lo impiden triggers de la base). Se anulan con motivo o se
//    agrega una a mano con motivo; todo queda en checadas_correcciones con quién y cuándo.
//  · Botones (decididos con Dirección el 2026-11-03): entrada, salida a comer, regreso de comer, salida, y inicio y fin
//    de tiempo extra. El kiosco sugiere el siguiente, pero la persona elige.
const crypto = require('crypto');
const C = require('./cifrado');
const { hashToken, nuevoToken } = require('./seguridad');
const { ahoraMexico } = require('./fechas');

const TIPOS = { entrada: 'Entrada', comida_sale: 'Salida a comer', comida_regresa: 'Regreso de comer', salida: 'Salida', extra_inicia: 'Inicio de tiempo extra', extra_termina: 'Fin de tiempo extra' };
const SIGUIENTE = { '': 'entrada', entrada: 'comida_sale', comida_sale: 'comida_regresa', comida_regresa: 'salida', salida: 'extra_inicia', extra_inicia: 'extra_termina', extra_termina: 'extra_inicia' };
const ORIGENES = ['kiosco', 'celular', 'whatsapp', 'manual'];
const FALLOS_ESPERA = 5, FALLOS_TOTAL = 10, ESPERA_MS = 15 * 60 * 1000, BLOQUEO_TOTAL = 8.64e15;
const FALLOS_KIOSCO = 20, VENTANA_KIOSCO_MS = 10 * 60 * 1000, FALLOS_IP = 30, VENTANA_IP_MS = 15 * 60 * 1000;
const TICKET_MS = 90 * 1000, DUPLICADO_MS = 2 * 60 * 1000;

const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const texto = (v, max) => { const t = String(v ?? '').trim().replace(/\s+/g, ' '); return t ? t.slice(0, max) : null; };
const primerNombre = n => String(n || '').trim().split(/\s+/)[0] || '';
// PIN obvio: todos iguales, escalera (1234, 9876), par repetido (1212) o su propio código.
function pinDebil(pin, codigo) {
  if (/^(\d)\1{3}$/.test(pin) || /^(\d\d)\1$/.test(pin) || pin === codigo) return true;
  const d = [...pin].map(Number), paso = d[1] - d[0];
  return Math.abs(paso) === 1 && d.every((x, i) => !i || x - d[i - 1] === paso);
}
// Hash del PIN: «p1:<id de la clave>:<sal>:<scrypt>». La pimienta va amarrada a la persona: el mismo PIN de dos
// personas da hashes distintos y no se puede copiar el hash de una a otra.
const pimienta = (personaId, pin) => C.huella(Buffer.from(`checador-pin:${personaId}:${pin}`));
const scrypt = (txt, sal) => crypto.scryptSync(txt, sal, 32, { N: 1 << 14, r: 8, p: 1 });
function hashPin(personaId, pin) {
  const sal = crypto.randomBytes(16);
  return `p1:${C.estado().kid}:${sal.toString('hex')}:${scrypt(pimienta(personaId, pin), sal).toString('hex')}`;
}
// { ok } o { ok: false, otraClave: true } si el hash se hizo con otra clave de cifrado.
function revisarPin(personaId, pin, guardado) {
  const [v, kid, sal, h] = String(guardado || '').split(':');
  if (v !== 'p1' || !sal || !h) { scrypt('relleno', 'relleno'); return { ok: false }; }
  if (kid !== C.estado().kid) { scrypt('relleno', 'relleno'); return { ok: false, otraClave: true }; }
  const calc = scrypt(pimienta(personaId, pin), Buffer.from(sal, 'hex')), esperado = Buffer.from(h, 'hex');
  return { ok: esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado) };
}

function migrar(db) {
  const columnas = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  const agregar = (t, col, def) => { if (!columnas(t).includes(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  agregar('personal', 'codigo_checador', 'TEXT');
  agregar('personal', 'pin_hash', 'TEXT');
  agregar('personal', 'pin_temporal', 'INTEGER NOT NULL DEFAULT 0');
  agregar('personal', 'pin_fallos', 'INTEGER NOT NULL DEFAULT 0');
  agregar('personal', 'pin_bloqueado_hasta', 'INTEGER NOT NULL DEFAULT 0');
  agregar('personal', 'pin_cambiado_at', 'TEXT');
  agregar('personal', 'checa', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_codigo_checador ON personal(codigo_checador) WHERE codigo_checador IS NOT NULL;
    CREATE TABLE IF NOT EXISTS checador_dispositivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 60),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      token_hash TEXT NOT NULL UNIQUE,
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      registrado_por INTEGER, registrado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      ultimo_uso TEXT, revocado_por TEXT, revocado_at TEXT
    );
    CREATE TABLE IF NOT EXISTS checadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'comida_sale', 'comida_regresa', 'salida', 'extra_inicia', 'extra_termina')),
      momento_utc TEXT NOT NULL, fecha TEXT NOT NULL, hora TEXT NOT NULL,
      origen TEXT NOT NULL CHECK(origen IN ('kiosco', 'celular', 'whatsapp', 'manual')),
      dispositivo_id INTEGER REFERENCES checador_dispositivos(id), sucursal_id INTEGER REFERENCES sucursales(id),
      lat REAL, lon REAL, foto_archivo TEXT, sin_conexion INTEGER NOT NULL DEFAULT 0, hora_dispositivo TEXT,
      estado TEXT NOT NULL DEFAULT 'valida' CHECK(estado IN ('valida', 'por_revisar', 'anulada')),
      observaciones TEXT, registrado_por INTEGER, registrado_por_nombre TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_checadas_persona ON checadas(personal_id, momento_utc);
    CREATE INDEX IF NOT EXISTS idx_checadas_fecha ON checadas(fecha);
    CREATE TABLE IF NOT EXISTS checadas_correcciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checada_id INTEGER NOT NULL REFERENCES checadas(id),
      accion TEXT NOT NULL CHECK(accion IN ('agregar', 'anular', 'aceptar')),
      antes TEXT, despues TEXT, motivo TEXT NOT NULL CHECK(length(trim(motivo)) >= 4),
      usuario_id INTEGER, usuario_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_checadas_correcciones ON checadas_correcciones(checada_id);
    -- Candados de la base: una checada no se borra ni se le cambia la hora, y su bitácora tampoco se toca.
    CREATE TRIGGER IF NOT EXISTS checadas_no_borrar BEFORE DELETE ON checadas
      BEGIN SELECT RAISE(ABORT, 'Las checadas no se borran: se anulan con motivo'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_no_cambiar BEFORE UPDATE OF personal_id, tipo, momento_utc, fecha, hora, origen, dispositivo_id, created_at ON checadas
      BEGIN SELECT RAISE(ABORT, 'La hora de una checada no se cambia: se anula y se agrega otra con motivo'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_anulada_final BEFORE UPDATE OF estado ON checadas WHEN OLD.estado = 'anulada'
      BEGIN SELECT RAISE(ABORT, 'Una checada anulada ya no cambia'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_correcciones_no_borrar BEFORE DELETE ON checadas_correcciones
      BEGIN SELECT RAISE(ABORT, 'La bitácora de checadas no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_correcciones_no_cambiar BEFORE UPDATE ON checadas_correcciones
      BEGIN SELECT RAISE(ABORT, 'La bitácora de checadas no se cambia'); END;
  `);
}

module.exports = function checador(app, db, h) {
  migrar(db);
  const P = app.locals.permisos;
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const puede = (req, k) => P.puede(req, k);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para el reloj checador' });

  // ---------- Kiosco (sin sesión: lo identifica su token) ----------
  const fallosKiosco = new Map(), fallosIp = new Map(), tickets = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const m of [fallosKiosco, fallosIp]) for (const [k, v] of m) if (v.reinicia <= t) m.delete(k);
    for (const [k, v] of tickets) if (v.expira <= t) tickets.delete(k);
  }, 60 * 1000).unref();
  const contar = (mapa, k, ventana) => { const t = Date.now(); let r = mapa.get(k); if (!r || r.reinicia <= t) { r = { fallos: 0, reinicia: t + ventana }; mapa.set(k, r); } r.fallos++; };
  const excedido = (mapa, k, max) => { const r = mapa.get(k); return !!r && r.reinicia > Date.now() && r.fallos >= max; };
  const dispositivoDe = db.prepare(`SELECT d.id, d.nombre, d.sucursal_id, s.nombre AS sucursal FROM main.checador_dispositivos d
    LEFT JOIN main.sucursales s ON s.id = d.sucursal_id WHERE d.token_hash = ? AND d.activo = 1`);
  // Middleware de las rutas del kiosco: token válido o 401 (y cuenta el fallo por conexión).
  function kiosco(req, res, next) {
    if (excedido(fallosIp, req.ipCliente, FALLOS_IP)) return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espera 15 minutos.' });
    const t = String(req.get('x-kiosco') || '');
    const d = /^[A-Za-z0-9_-]{40,60}$/.test(t) ? dispositivoDe.get(hashToken(t)) : null;
    if (!d) { contar(fallosIp, req.ipCliente, VENTANA_IP_MS); return res.status(401).json({ error: 'Este dispositivo no está registrado como kiosco (o lo dieron de baja). Pide al gerente que lo registre.', codigo: 'KIOSCO_NO_REGISTRADO' }); }
    req.kiosco = d;
    next();
  }
  const ultimaDe = (personaId, fecha) => db.prepare("SELECT tipo, hora FROM main.checadas WHERE personal_id = ? AND fecha = ? AND estado <> 'anulada' ORDER BY momento_utc DESC, id DESC LIMIT 1").get(personaId, fecha);
  function nuevoTicket(tipo, persona, dispositivoId) {
    const t = crypto.randomBytes(24).toString('base64url');
    tickets.set(t, { tipo, personaId: persona.id, dispositivoId, expira: Date.now() + TICKET_MS });
    return t;
  }
  // Toma un ticket (se usa una sola vez) del mismo kiosco que lo pidió.
  function tomarTicket(req, tiposValidos) {
    const t = String(req.body?.ticket || ''), x = tickets.get(t);
    if (!x || x.expira <= Date.now() || x.dispositivoId !== req.kiosco.id || !tiposValidos.includes(x.tipo)) return null;
    tickets.delete(t);
    const p = db.prepare('SELECT * FROM main.personal WHERE id = ? AND activo = 1 AND checa = 1').get(x.personaId);
    return p || null;
  }
  const paraChecar = (req, p) => {
    const { fecha } = ahoraMexico(), u = ultimaDe(p.id, fecha);
    return { ticket: nuevoTicket('checar', p, req.kiosco.id), nombre: primerNombre(p.nombre), sugerido: SIGUIENTE[u?.tipo || ''], ultima: u ? { tipo: TIPOS[u.tipo], hora: u.hora.slice(0, 5) } : null, tipos: TIPOS };
  };

  app.get('/api/publico/kiosco/estado', kiosco, h((req, res) => {
    const a = ahoraMexico();
    db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(req.kiosco.id);
    res.json({ nombre: req.kiosco.nombre, sucursal: req.kiosco.sucursal, fecha: a.fecha, hora: a.hora.slice(0, 5), tipos: TIPOS });
  }));
  // Paso 1: código y PIN. Si son correctos regresa un ticket de 90 s para checar (o para elegir PIN si es temporal).
  app.post('/api/publico/kiosco/identificar', kiosco, h((req, res) => {
    const d = req.kiosco;
    if (excedido(fallosKiosco, d.id, FALLOS_KIOSCO)) return res.status(429).json({ error: 'Demasiados intentos fallidos en este kiosco. Espera 10 minutos o avisa al gerente.' });
    const codigo = String(req.body?.codigo ?? ''), pin = String(req.body?.pin ?? '');
    const incorrecto = () => { contar(fallosKiosco, d.id, VENTANA_KIOSCO_MS); return res.status(401).json({ error: 'Código o PIN incorrecto' }); };
    if (!/^\d{4}$/.test(codigo) || !/^\d{4}$/.test(pin)) { scrypt('relleno', 'relleno'); return incorrecto(); }
    const p = db.prepare('SELECT * FROM main.personal WHERE codigo_checador = ?').get(codigo);
    if (!p || !p.pin_hash) { scrypt('relleno', 'relleno'); return incorrecto(); }
    const ahora = Date.now();
    if (p.pin_bloqueado_hasta > ahora) {
      contar(fallosKiosco, d.id, VENTANA_KIOSCO_MS);
      return res.status(423).json({ error: p.pin_bloqueado_hasta >= BLOQUEO_TOTAL ? 'Tu PIN está bloqueado por intentos fallidos. Pide a RH o a tu gerente que lo desbloquee.' : `Tu PIN está bloqueado por intentos fallidos. Intenta de nuevo en ${Math.ceil((p.pin_bloqueado_hasta - ahora) / 60000)} minuto(s).` });
    }
    const r = revisarPin(p.id, pin, p.pin_hash);
    if (r.otraClave) return res.status(409).json({ error: 'Tu PIN ya no sirve (cambió la clave de seguridad del sistema). Pide a RH un PIN nuevo.' });
    if (!r.ok) {
      const fallos = p.pin_fallos + 1, hasta = fallos >= FALLOS_TOTAL ? BLOQUEO_TOTAL : fallos % FALLOS_ESPERA === 0 ? ahora + ESPERA_MS : 0;
      db.prepare('UPDATE main.personal SET pin_fallos = ?, pin_bloqueado_hasta = ? WHERE id = ?').run(fallos, hasta, p.id);
      if (hasta) audit(null, p.id, 'checador bloqueado', `${p.nombre}: PIN bloqueado ${hasta >= BLOQUEO_TOTAL ? 'hasta que RH lo desbloquee' : '15 minutos'} por ${fallos} intentos fallidos (kiosco «${d.nombre}»)`);
      return incorrecto();
    }
    if (!p.activo || !p.checa) return res.status(403).json({ error: 'No estás dado de alta en el reloj checador. Avisa a RH.' });
    if (p.pin_fallos || p.pin_bloqueado_hasta) db.prepare('UPDATE main.personal SET pin_fallos = 0, pin_bloqueado_hasta = 0 WHERE id = ?').run(p.id);
    if (p.pin_temporal) return res.json({ cambiar_pin: true, ticket: nuevoTicket('pin', p, d.id), nombre: primerNombre(p.nombre) });
    res.json(paraChecar(req, p));
  }));
  // Elegir su PIN (obligatorio la primera vez, con el ticket del paso 1).
  app.post('/api/publico/kiosco/cambiar-pin', kiosco, h((req, res) => {
    const p = tomarTicket(req, ['pin', 'checar']);
    if (!p) return res.status(401).json({ error: 'Se acabó el tiempo. Vuelve a escribir tu código y PIN.' });
    const nuevo = String(req.body?.nuevo ?? '');
    if (!/^\d{4}$/.test(nuevo)) return res.status(400).json({ error: 'El PIN son 4 números', ticket: nuevoTicket('pin', p, req.kiosco.id) });
    if (pinDebil(nuevo, p.codigo_checador)) return res.status(400).json({ error: 'Ese PIN es muy fácil de adivinar (números iguales, seguidos, repetidos o tu código). Elige otro.', ticket: nuevoTicket('pin', p, req.kiosco.id) });
    db.prepare("UPDATE main.personal SET pin_hash = ?, pin_temporal = 0, pin_fallos = 0, pin_bloqueado_hasta = 0, pin_cambiado_at = datetime('now','localtime') WHERE id = ?").run(hashPin(p.id, nuevo), p.id);
    audit(null, p.id, 'checador', `${p.nombre}: eligió su PIN en el kiosco «${req.kiosco.nombre}»`);
    res.json(paraChecar(req, p));
  }));
  // Paso 2: registrar la checada con la hora del servidor.
  app.post('/api/publico/kiosco/checar', kiosco, h((req, res) => {
    const tipo = String(req.body?.tipo || '');
    if (!TIPOS[tipo]) return res.status(400).json({ error: 'Elige qué vas a registrar' });
    const p = tomarTicket(req, ['checar']);
    if (!p) return res.status(401).json({ error: 'Se acabó el tiempo. Vuelve a escribir tu código y PIN.' });
    const d = req.kiosco, a = ahoraMexico();
    // Doble toque: la misma checada de la misma persona en menos de 2 minutos no se repite.
    const previa = db.prepare("SELECT id, hora FROM main.checadas WHERE personal_id = ? AND tipo = ? AND estado <> 'anulada' AND momento_utc >= ? ORDER BY id DESC LIMIT 1")
      .get(p.id, tipo, new Date(Date.now() - DUPLICADO_MS).toISOString());
    if (previa) return res.json({ id: previa.id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: previa.hora.slice(0, 5), repetida: true });
    const otraSucursal = p.sucursal_id !== d.sucursal_id;
    const info = db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, dispositivo_id, sucursal_id, estado, observaciones)
      VALUES (?, ?, ?, ?, ?, 'kiosco', ?, ?, ?, ?)`).run(p.id, tipo, a.utc, a.fecha, a.hora, d.id, d.sucursal_id, otraSucursal ? 'por_revisar' : 'valida', otraSucursal ? 'Checó en un kiosco de otra sucursal' : null);
    db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(d.id);
    res.status(201).json({ id: Number(info.lastInsertRowid), nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: a.hora.slice(0, 5) });
  }));

  // ---------- Administración (con sesión) ----------
  // Las tablas sin «main.» son las vistas por sucursal (sucursales.js): una persona o kiosco de otra sucursal «no existe».
  const persona = id => db.prepare('SELECT * FROM personal WHERE id = ?').get(idDe(id));
  const estadoDe = p => ({
    codigo: p.codigo_checador, tiene_pin: !!p.pin_hash, pin_temporal: !!p.pin_temporal, checa: !!p.checa, pin_cambiado_at: p.pin_cambiado_at,
    bloqueado: p.pin_bloqueado_hasta > Date.now(), bloqueo_total: p.pin_bloqueado_hasta >= BLOQUEO_TOTAL,
    bloqueado_hasta: p.pin_bloqueado_hasta > Date.now() && p.pin_bloqueado_hasta < BLOQUEO_TOTAL ? new Date(p.pin_bloqueado_hasta).toISOString() : null,
  });
  app.get('/api/asistencia/catalogos', h((req, res) => res.json({ tipos: TIPOS, origenes: ORIGENES })));
  app.get('/api/asistencia/personal/:id', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const ultimas = puede(req, 'asistencia.ver') ? db.prepare('SELECT id, tipo, fecha, hora, origen, estado, observaciones FROM checadas WHERE personal_id = ? ORDER BY momento_utc DESC, id DESC LIMIT 10').all(p.id) : [];
    res.json({ ...estadoDe(p), ultimas, puede: { editar: puede(req, 'personal.editar'), corregir: puede(req, 'asistencia.corregir') } });
  }));
  // Genera (o vuelve a generar) su código y un PIN temporal. El PIN se muestra UNA vez; la base guarda solo su hash.
  app.post('/api/asistencia/personal/:id/pin', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para dar PINes del checador');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (!p.activo) return res.status(409).json({ error: 'Está dada de baja: no puede checar' });
    let codigo = p.codigo_checador;
    while (!codigo) { const c = String(crypto.randomInt(1000, 10000)); if (!db.prepare('SELECT 1 FROM main.personal WHERE codigo_checador = ?').get(c)) codigo = c; }
    let pin; do pin = String(crypto.randomInt(0, 10000)).padStart(4, '0'); while (pinDebil(pin, codigo));
    db.prepare("UPDATE main.personal SET codigo_checador = ?, pin_hash = ?, pin_temporal = 1, pin_fallos = 0, pin_bloqueado_hasta = 0, pin_cambiado_at = NULL, checa = 1, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?")
      .run(codigo, hashPin(p.id, pin), p.id);
    audit(req, p.id, 'checador', `${p.nombre}: ${p.pin_hash ? 'nuevo PIN temporal' : 'alta en el checador'} (código ${codigo}; el PIN no se guarda)`);
    res.json({ codigo, pin, aviso: 'Anota el PIN y dáselo a la persona: no se vuelve a mostrar. En su primera checada elegirá el suyo.' });
  }));
  app.post('/api/asistencia/personal/:id/desbloquear', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para desbloquear el checador');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    db.prepare('UPDATE main.personal SET pin_fallos = 0, pin_bloqueado_hasta = 0 WHERE id = ?').run(p.id);
    audit(req, p.id, 'checador', `${p.nombre}: se desbloqueó su PIN`);
    res.json(estadoDe(persona(p.id)));
  }));
  // Quién no checa (p. ej. Dirección): no aparece como falta.
  app.put('/api/asistencia/personal/:id', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para cambiar el checador');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (typeof req.body?.checa !== 'boolean') return res.status(400).json({ error: 'Indica si checa o no' });
    db.prepare("UPDATE main.personal SET checa = ?, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(req.body.checa ? 1 : 0, p.id);
    audit(req, p.id, 'checador', `${p.nombre}: ${req.body.checa ? 'checa' : 'ya no checa'}`);
    res.json(estadoDe(persona(p.id)));
  }));

  // Kioscos: el token se muestra una sola vez (lo guarda la tableta); la base solo guarda su hash.
  app.get('/api/asistencia/dispositivos', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para los kioscos del checador');
    res.json(db.prepare(`SELECT d.id, d.nombre, d.sucursal_id, s.nombre AS sucursal, d.activo, d.registrado_por_nombre, d.created_at, d.ultimo_uso, d.revocado_por, d.revocado_at
      FROM checador_dispositivos d LEFT JOIN main.sucursales s ON s.id = d.sucursal_id ORDER BY d.activo DESC, d.nombre`).all());
  }));
  app.post('/api/asistencia/dispositivos', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para registrar kioscos');
    const nombre = texto(req.body?.nombre, 60);
    if (!nombre || nombre.length < 3 || /[<>{}]/.test(nombre)) return res.status(400).json({ error: 'Escribe un nombre para el kiosco (p. ej. «Entrada Querétaro»)' });
    const s = Number(req.body?.sucursal_id || (req.alcanceSuc?.permitidas?.length === 1 ? req.alcanceSuc.permitidas[0] : 0));
    if (!s || !req.alcanceSuc?.permitidas?.includes(s)) return res.status(400).json({ error: 'Elige una de tus sucursales' });
    const token = nuevoToken();
    const info = db.prepare('INSERT INTO main.checador_dispositivos (nombre, sucursal_id, token_hash, registrado_por, registrado_por_nombre) VALUES (?, ?, ?, ?, ?)')
      .run(nombre, s, hashToken(token), req.usuarioSesion.id, req.usuarioSesion.nombre);
    app.locals.auditoria?.registrar(req, 'checador_dispositivo', Number(info.lastInsertRowid), 'alta', `Kiosco «${nombre}»`);
    res.status(201).json({ id: Number(info.lastInsertRowid), nombre, token });
  }));
  app.post('/api/asistencia/dispositivos/:id/revocar', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para dar de baja kioscos');
    const d = db.prepare('SELECT * FROM checador_dispositivos WHERE id = ? AND activo = 1').get(idDe(req.params.id));
    if (!d) return res.status(404).json({ error: 'Kiosco no encontrado' });
    db.prepare("UPDATE main.checador_dispositivos SET activo = 0, revocado_por = ?, revocado_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.nombre, d.id);
    for (const [k, v] of tickets) if (v.dispositivoId === d.id) tickets.delete(k);
    app.locals.auditoria?.registrar(req, 'checador_dispositivo', d.id, 'baja', `Kiosco «${d.nombre}»: ya no puede checar`);
    res.json({ ok: true });
  }));

  // ---------- Checadas: consulta y correcciones ----------
  const fechaOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  app.get('/api/asistencia/checadas', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const fecha = req.query.fecha || ahoraMexico().fecha;
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    const pid = req.query.personal_id ? idDe(req.query.personal_id) : null;
    res.json(db.prepare(`SELECT c.id, c.personal_id, p.nombre, c.tipo, c.fecha, c.hora, c.origen, c.estado, c.observaciones, c.sin_conexion, c.registrado_por_nombre, d.nombre AS kiosco
      FROM checadas c JOIN personal p ON p.id = c.personal_id LEFT JOIN main.checador_dispositivos d ON d.id = c.dispositivo_id
      WHERE c.fecha = ? ${pid ? 'AND c.personal_id = ?' : ''} ORDER BY c.momento_utc, c.id`).all(...[fecha, ...(pid ? [pid] : [])]));
  }));
  app.get('/api/asistencia/checadas/:id/correcciones', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const c = db.prepare('SELECT id FROM checadas WHERE id = ? AND personal_id IN (SELECT id FROM personal)').get(idDe(req.params.id));
    if (!c) return res.status(404).json({ error: 'Checada no encontrada' });
    res.json(db.prepare('SELECT accion, antes, despues, motivo, usuario_nombre, created_at FROM checadas_correcciones WHERE checada_id = ? ORDER BY id').all(c.id));
  }));
  const motivoDe = req => { const m = texto(req.body?.motivo, 300); return m && m.length >= 4 ? m : null; };
  const corregir = db.prepare('INSERT INTO main.checadas_correcciones (checada_id, accion, antes, despues, motivo, usuario_id, usuario_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const describir = c => `${TIPOS[c.tipo]} ${c.fecha} ${c.hora.slice(0, 5)}`;
  // Agregar a mano (se le olvidó checar, no había kiosco…): con motivo; nunca en el futuro.
  app.post('/api/asistencia/checadas', h((req, res) => {
    if (!puede(req, 'asistencia.corregir')) return negar(res, 'No tienes permiso para corregir la asistencia');
    const b = req.body || {}, p = persona(b.personal_id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (!TIPOS[b.tipo]) return res.status(400).json({ error: 'Elige qué se registra' });
    if (!fechaOk(b.fecha) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.hora || ''))) return res.status(400).json({ error: 'Revisa la fecha y la hora' });
    const motivo = motivoDe(req);
    if (!motivo) return res.status(400).json({ error: 'Escribe el motivo (por qué se agrega a mano)' });
    // México (centro) no cambia de horario desde 2022: UTC−6 todo el año.
    const momento = new Date(`${b.fecha}T${b.hora}:00-06:00`), a = ahoraMexico();
    if (momento.getTime() > Date.now()) return res.status(400).json({ error: 'No se puede registrar una checada en el futuro' });
    if (b.fecha < new Date(Date.parse(a.fecha + 'T12:00:00Z') - 400 * 86400000).toISOString().slice(0, 10)) return res.status(400).json({ error: 'Máximo un año atrás' });
    const id = db.transaction(() => {
      const r = db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, sucursal_id, estado, observaciones, registrado_por, registrado_por_nombre)
        VALUES (?, ?, ?, ?, ?, 'manual', ?, 'valida', ?, ?, ?)`).run(p.id, b.tipo, momento.toISOString(), b.fecha, b.hora + ':00', p.sucursal_id, motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
      corregir.run(r.lastInsertRowid, 'agregar', null, `${TIPOS[b.tipo]} ${b.fecha} ${b.hora}`, motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
      return Number(r.lastInsertRowid);
    })();
    audit(req, p.id, 'checada agregada', `${p.nombre}: ${TIPOS[b.tipo]} ${b.fecha} ${b.hora} · ${motivo}`);
    res.status(201).json({ id });
  }));
  const checadaDe = id => db.prepare('SELECT c.*, p.nombre FROM checadas c JOIN personal p ON p.id = c.personal_id WHERE c.id = ?').get(idDe(id));
  app.post('/api/asistencia/checadas/:id/anular', h((req, res) => {
    if (!puede(req, 'asistencia.corregir')) return negar(res, 'No tienes permiso para corregir la asistencia');
    const c = checadaDe(req.params.id);
    if (!c) return res.status(404).json({ error: 'Checada no encontrada' });
    if (c.estado === 'anulada') return res.status(409).json({ error: 'Ya está anulada' });
    const motivo = motivoDe(req);
    if (!motivo) return res.status(400).json({ error: 'Escribe el motivo de la anulación' });
    db.transaction(() => {
      db.prepare("UPDATE main.checadas SET estado = 'anulada' WHERE id = ?").run(c.id);
      corregir.run(c.id, 'anular', describir(c) + ' · ' + c.estado, 'anulada', motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
    })();
    audit(req, c.personal_id, 'checada anulada', `${c.nombre}: ${describir(c)} · ${motivo}`);
    res.json({ ok: true });
  }));
  // Aceptar una checada «por revisar» (de otra sucursal; en F2, las que se guardaron sin conexión).
  app.post('/api/asistencia/checadas/:id/aceptar', h((req, res) => {
    if (!puede(req, 'asistencia.corregir')) return negar(res, 'No tienes permiso para corregir la asistencia');
    const c = checadaDe(req.params.id);
    if (!c) return res.status(404).json({ error: 'Checada no encontrada' });
    if (c.estado !== 'por_revisar') return res.status(409).json({ error: 'Esta checada no está por revisar' });
    const motivo = motivoDe(req);
    if (!motivo) return res.status(400).json({ error: 'Escribe por qué se acepta' });
    db.transaction(() => {
      db.prepare("UPDATE main.checadas SET estado = 'valida' WHERE id = ?").run(c.id);
      corregir.run(c.id, 'aceptar', describir(c) + ' · por revisar', 'valida', motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
    })();
    audit(req, c.personal_id, 'checada aceptada', `${c.nombre}: ${describir(c)} · ${motivo}`);
    res.json({ ok: true });
  }));

  return { TIPOS };
};
module.exports.pinDebil = pinDebil;
module.exports.TIPOS = TIPOS;
