// RELOJ CHECADOR (RH · F1, 2026-11-03): código y PIN de cada persona, kioscos registrados y checadas que no se borran.
//  · Checa cualquier persona de Personal (tenga o no cuenta del CRM) con su código de 4 dígitos y un PIN de 4 dígitos.
//    El PIN NUNCA se guarda en claro: se pasa por un HMAC con la clave de cifrado del servidor («pimienta») y luego por
//    scrypt con sal. Un PIN de 4 dígitos con un hash común se saca en segundos de una base robada; sin CLAVE_CIFRADO, no.
//    Si se cambia CLAVE_CIFRADO, los PINes dejan de servir y RH genera uno nuevo a cada quien.
//  · RH no ve PINes: genera uno temporal (se muestra una sola vez) y la persona elige el suyo en su primera checada.
//    No se aceptan PINes obvios (1111, 1234, 4321, 1212, su propio código).
//  · Intentos: 5 fallos seguidos → bloqueado 15 min; 10 → 24 h (y otras 24 h cada 5 más) o hasta que RH lo desbloquee
//    (auditoría 2026-11-03: antes era para siempre y bastaba saber el código de otro para dejarlo sin checar). Por kiosco, 20 fallos
//    en 10 min pausan el kiosco; por conexión, 30 tokens de kiosco inválidos en 15 min. El mensaje es siempre el mismo
//    («código o PIN incorrecto»): no dice si el código existe.
//  · Kiosco: una tableta que registra quien tiene «Kioscos del checador». Recibe un token aleatorio (la base guarda solo
//    su hash) y se puede revocar. Sin token válido no se checa. Al kiosco solo le llegan el primer nombre y la hora.
//  · Hora: SIEMPRE la del servidor, en hora de México; la del dispositivo no se usa.
//  · Checadas: nunca se borran ni se les cambia la hora (lo impiden triggers de la base). Se anulan con motivo o se
//    agrega una a mano con motivo; todo queda en checadas_correcciones con quién y cuándo.
//  · Botones (decididos con Dirección el 2026-11-03): entrada, salida a comer, regreso de comer, salida, y inicio y fin
//    de tiempo extra. El kiosco sugiere el siguiente, pero la persona elige.
//  · F2 (2026-11-03): pantalla del kiosco en /kiosco (public/kiosco.html, la única página con permiso de cámara).
//    Foto en cada checada, guardada cifrada (como el expediente); sin foto, la checada queda «por revisar».
//    Sin internet (decidido con Dirección): el kiosco guarda la checada y la sube al volver; el servidor revisa el PIN
//    al subirla, calcula la hora con el tiempo que pasó según el reloj interno del kiosco y la deja «por revisar».
//  · F5 (2026-11-03): CHECAR DESDE EL CELULAR (técnicos que salen directo al cliente). RH genera desde la ficha un
//    enlace de UN SOLO USO (24 h); al abrirlo, ese celular queda ligado a esa persona (uno por persona; el anterior se
//    da de baja) y solo sirve para ella. Para checar: su PIN + selfie + ubicación GPS, con la hora del servidor, en
//    /checar (única página con permiso de cámara y ubicación). Sin foto, sin ubicación o con ubicación poco precisa
//    (más de 150 m) queda «por revisar». La ubicación se toma solo al checar (nunca se rastrea).
//  · F6 (2026-11-03): las FOTOS se borran solas a los 90 días (FOTOS_CHECADAS_DIAS, mínimo 7): se borra el archivo y
//    queda la checada con «foto borrada el …». Las que siguen «por revisar» se conservan hasta que alguien las revise.
//    Aviso de privacidad para el personal en /aviso-privacidad-checador.html (texto de Dirección, 2026-11-05); el firmado
//    se sube al expediente («Aviso de privacidad firmado») y la ficha avisa si falta.
//  · Auditoría tramposa (2026-11-05, decidido con Dirección):
//    - Intento fallido en el kiosco (código o PIN malo, PIN bloqueado): queda registrado y el kiosco le toma FOTO (cifrada,
//      como la de las checadas; se borra con el mismo plazo). Así se ve quién prueba el código de otro.
//    - RED: cada checada guarda la IP desde la que llegó. El kiosco aprende su red al registrarse; si checa desde otra,
//      la checada VALE pero lleva la nota «desde otra red» y sale en el resumen de RH (el internet de la oficina puede
//      cambiar de IP: quien maneja los kioscos marca la nueva como la de siempre).
//    - UBICACIÓN del celular: se compara con la de su sucursal (la captura Dirección). Más lejos que su radio (500 m por
//      omisión) → «por revisar» con la distancia, y RH lo ve en el mapa (p. ej. si checó en casa de un cliente).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./cifrado');
const { tipoReal } = require('./expediente-oc');
const { hashToken, nuevoToken } = require('./seguridad');
const { ahoraMexico } = require('./fechas');

const TIPOS = { entrada: 'Entrada', comida_sale: 'Salida a comer', comida_regresa: 'Regreso de comer', salida: 'Salida', extra_inicia: 'Inicio de tiempo extra', extra_termina: 'Fin de tiempo extra' };
const SIGUIENTE = { '': 'entrada', entrada: 'comida_sale', comida_sale: 'comida_regresa', comida_regresa: 'salida', salida: 'extra_inicia', extra_inicia: 'extra_termina', extra_termina: 'extra_inicia' };
const ORIGENES = ['kiosco', 'celular', 'whatsapp', 'manual'];
// BLOQUEO_TOTAL: el bloqueo «para siempre» de antes (los que ya estén así siguen hasta que RH los desbloquee).
const FALLOS_ESPERA = 5, FALLOS_TOTAL = 10, ESPERA_MS = 15 * 60 * 1000, BLOQUEO_LARGO_MS = 24 * 3600000, BLOQUEO_TOTAL = 8.64e15;
const FALLOS_KIOSCO = 20, VENTANA_KIOSCO_MS = 10 * 60 * 1000, FALLOS_IP = 30, VENTANA_IP_MS = 15 * 60 * 1000;
const TICKET_MS = 90 * 1000, DUPLICADO_MS = 2 * 60 * 1000;
const MAX_FOTO = 400 * 1024, MAX_SIN_CONEXION_MS = 7 * 86400000, ENLACE_MS = 24 * 3600000, PRECISION_MAX_M = 150, RADIO_SUCURSAL_M = 500;
const contextoFoto = id => `checadas.foto:${id}`, contextoIntento = id => `checador_intentos.foto:${id}`;
// Distancia en metros entre dos puntos (fórmula del haversine).
function distanciaM(a, b) {
  const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}
const distanciaTexto = m => (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m');
// Foto del kiosco: JPEG en base64 (o data URL), de 1 KB a 400 KB. Si no es una foto válida se trata como «sin foto».
function fotoDe(v) {
  if (typeof v !== 'string' || !v) return null;
  const b64 = v.replace(/^data:image\/jpeg;base64,/, '');
  if (b64.length > Math.ceil(MAX_FOTO / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length >= 1000 && buf.length <= MAX_FOTO && tipoReal(buf) === 'jpg' ? buf : null;
}

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
  const existe = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (existe('checadas')) { agregar('checadas', 'uid_kiosco', 'TEXT'); agregar('checadas', 'precision_m', 'REAL'); agregar('checadas', 'foto_borrada_at', 'TEXT'); agregar('checadas', 'ip', 'TEXT'); agregar('checadas', 'distancia_m', 'REAL'); }
  if (existe('checador_dispositivos')) { agregar('checador_dispositivos', 'tipo', "TEXT NOT NULL DEFAULT 'kiosco'"); agregar('checador_dispositivos', 'personal_id', 'INTEGER REFERENCES personal(id)'); agregar('checador_dispositivos', 'red_habitual', 'TEXT'); }
  // Ubicación de cada sucursal para revisar las checadas del celular (la captura Dirección).
  agregar('sucursales', 'lat', 'REAL'); agregar('sucursales', 'lon', 'REAL'); agregar('sucursales', 'radio_m', 'INTEGER');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_codigo_checador ON personal(codigo_checador) WHERE codigo_checador IS NOT NULL;
    CREATE TABLE IF NOT EXISTS checador_dispositivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 60),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      token_hash TEXT NOT NULL UNIQUE,
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      registrado_por INTEGER, registrado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      ultimo_uso TEXT, revocado_por TEXT, revocado_at TEXT,
      tipo TEXT NOT NULL DEFAULT 'kiosco', personal_id INTEGER REFERENCES personal(id), red_habitual TEXT
    );
    -- Enlaces de un solo uso para ligar el celular de una persona (F5). Solo se guarda el hash del enlace.
    CREATE TABLE IF NOT EXISTS checador_enlaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      token_hash TEXT NOT NULL UNIQUE, expira_ms INTEGER NOT NULL, usado_at TEXT,
      creado_por INTEGER, creado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      uid_kiosco TEXT, precision_m REAL, foto_borrada_at TEXT, ip TEXT, distancia_m REAL
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
    -- Una checada guardada sin conexión se sube una sola vez aunque el kiosco la reintente.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_checadas_uid_kiosco ON checadas(uid_kiosco) WHERE uid_kiosco IS NOT NULL;
    -- Candados de la base: una checada no se borra ni se le cambia la hora, y su bitácora tampoco se toca.
    CREATE TRIGGER IF NOT EXISTS checadas_no_borrar BEFORE DELETE ON checadas
      BEGIN SELECT RAISE(ABORT, 'Las checadas no se borran: se anulan con motivo'); END;
    -- Se rehace en cada arranque: así su lista de columnas protegidas se actualiza cuando se agrega una.
    DROP TRIGGER IF EXISTS checadas_no_cambiar;
    CREATE TRIGGER checadas_no_cambiar BEFORE UPDATE OF personal_id, tipo, momento_utc, fecha, hora, origen, dispositivo_id, created_at, uid_kiosco, ip, distancia_m ON checadas
      BEGIN SELECT RAISE(ABORT, 'La hora de una checada no se cambia: se anula y se agrega otra con motivo'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_anulada_final BEFORE UPDATE OF estado ON checadas WHEN OLD.estado = 'anulada'
      BEGIN SELECT RAISE(ABORT, 'Una checada anulada ya no cambia'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_correcciones_no_borrar BEFORE DELETE ON checadas_correcciones
      BEGIN SELECT RAISE(ABORT, 'La bitácora de checadas no se borra'); END;
    CREATE TRIGGER IF NOT EXISTS checadas_correcciones_no_cambiar BEFORE UPDATE ON checadas_correcciones
      BEGIN SELECT RAISE(ABORT, 'La bitácora de checadas no se cambia'); END;
    -- Intentos fallidos en el kiosco (2026-11-05): código tecleado, de quién es (si existe), motivo, red y foto.
    CREATE TABLE IF NOT EXISTS checador_intentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispositivo_id INTEGER NOT NULL REFERENCES checador_dispositivos(id),
      personal_id INTEGER REFERENCES personal(id),
      codigo TEXT, motivo TEXT NOT NULL, ip TEXT,
      momento_utc TEXT NOT NULL, fecha TEXT NOT NULL, hora TEXT NOT NULL,
      foto_archivo TEXT, foto_borrada_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_checador_intentos_fecha ON checador_intentos(fecha);
    CREATE TRIGGER IF NOT EXISTS checador_intentos_no_borrar BEFORE DELETE ON checador_intentos
      BEGIN SELECT RAISE(ABORT, 'Los intentos del checador no se borran'); END;
    CREATE TRIGGER IF NOT EXISTS checador_intentos_fijos BEFORE UPDATE OF dispositivo_id, personal_id, codigo, motivo, ip, momento_utc, fecha, hora, created_at ON checador_intentos
      BEGIN SELECT RAISE(ABORT, 'Un intento del checador no se cambia'); END;
  `);
}

module.exports = function checador(app, db, h) {
  migrar(db);
  const P = app.locals.permisos;
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const puede = (req, k) => P.puede(req, k);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para el reloj checador' });
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR_FOTOS = path.join(base, 'archivos', 'checadas');
  // La foto va cifrada y amarrada a su checada; el nombre del archivo es al azar (no revela de quién es).
  function guardarFoto(id, buf, fecha) {
    const mes = fecha.slice(0, 7), archivo = path.join(mes, `${id}-${crypto.randomBytes(8).toString('hex')}.jpg.cifrado`);
    fs.mkdirSync(path.join(DIR_FOTOS, mes), { recursive: true, mode: 0o700 });
    C.escribirSeguro(path.join(DIR_FOTOS, archivo), C.cifrarArchivo(buf, contextoFoto(id)));
    db.prepare('UPDATE main.checadas SET foto_archivo = ? WHERE id = ?').run(archivo, id);
  }
  // Borrado automático de fotos viejas (F6). Al arrancar y cada 6 horas; Dirección también lo puede correr a mano.
  const DIAS_FOTOS = Math.max(7, Math.floor(Number(process.env.FOTOS_CHECADAS_DIAS)) || 90);
  function borrarFotosViejas() {
    const hoy = ahoraMexico().fecha, limite = new Date(Date.parse(hoy + 'T12:00:00Z') - DIAS_FOTOS * 86400000).toISOString().slice(0, 10);
    const filas = db.prepare("SELECT id, foto_archivo FROM main.checadas WHERE foto_archivo IS NOT NULL AND fecha < ? AND estado <> 'por_revisar'").all(limite);
    let borradas = 0;
    for (const f of filas) {
      const ruta = path.join(DIR_FOTOS, f.foto_archivo);
      try { if (ruta.startsWith(DIR_FOTOS + path.sep)) fs.rmSync(ruta, { force: true }); }
      catch (e) { console.error('[checador] no se pudo borrar la foto de la checada ' + f.id + ':', e.message); continue; }
      db.prepare("UPDATE main.checadas SET foto_archivo = NULL, foto_borrada_at = datetime('now','localtime') WHERE id = ?").run(f.id);
      borradas++;
    }
    for (const f of db.prepare('SELECT id, foto_archivo FROM main.checador_intentos WHERE foto_archivo IS NOT NULL AND fecha < ?').all(limite)) {
      const ruta = path.join(DIR_FOTOS, f.foto_archivo);
      try { if (ruta.startsWith(DIR_FOTOS + path.sep)) fs.rmSync(ruta, { force: true }); }
      catch (e) { console.error('[checador] no se pudo borrar la foto del intento ' + f.id + ':', e.message); continue; }
      db.prepare("UPDATE main.checador_intentos SET foto_archivo = NULL, foto_borrada_at = datetime('now','localtime') WHERE id = ?").run(f.id);
      borradas++;
    }
    if (borradas) console.log(`[checador] Se borraron ${borradas} foto(s) de checadas de más de ${DIAS_FOTOS} días.`);
    return { borradas, dias: DIAS_FOTOS, antes_de: limite };
  }
  setTimeout(() => { try { borrarFotosViejas(); } catch (e) { console.error('[checador] borrado de fotos:', e.message); } }, 60 * 1000).unref();
  setInterval(() => { try { borrarFotosViejas(); } catch (e) { console.error('[checador] borrado de fotos:', e.message); } }, 6 * 3600000).unref();
  // Guarda una checada del kiosco (con o sin conexión) y su foto, en una sola transacción.
  // «notas» la dejan «por revisar»; «avisos» solo se anotan (la checada vale).
  function guardarChecada({ p, d, tipo, a, foto, ip = null, sinConexion = null, uid = null, origen = 'kiosco', ubicacion = null }) {
    const notas = [], avisos = [];
    let distancia = null;
    if (p.sucursal_id !== d.sucursal_id) notas.push('Checó en un kiosco de otra sucursal');
    if (!foto) notas.push('Sin foto');
    if (sinConexion) notas.push(sinConexion.nota);
    if (origen === 'celular') {
      if (!ubicacion) notas.push('Sin ubicación');
      else {
        if (ubicacion.precision > PRECISION_MAX_M) notas.push(`Ubicación poco precisa (±${Math.round(ubicacion.precision)} m)`);
        const s = db.prepare('SELECT nombre, lat, lon, radio_m FROM main.sucursales WHERE id = ?').get(p.sucursal_id);
        if (s && s.lat != null && s.lon != null) {
          distancia = distanciaM(s, ubicacion);
          if (distancia > (s.radio_m || RADIO_SUCURSAL_M)) notas.push(`A ${distanciaTexto(distancia)} de la sucursal ${s.nombre}`);
        }
      }
    } else if (ip) {
      // Kiosco: la primera red que se ve es la suya; si checa desde otra, vale pero se avisa.
      if (!d.red_habitual) db.prepare('UPDATE main.checador_dispositivos SET red_habitual = ? WHERE id = ? AND red_habitual IS NULL').run(ip, d.id);
      else if (d.red_habitual !== ip) avisos.push('Desde otra red (no la de siempre del kiosco)');
    }
    const obs = [...notas, ...avisos].join(' · ') || null;
    return db.transaction(() => {
      const r = db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, dispositivo_id, sucursal_id, estado, observaciones, sin_conexion, hora_dispositivo, uid_kiosco, lat, lon, precision_m, ip, distancia_m)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, tipo, a.utc, a.fecha, a.hora, origen, d.id, d.sucursal_id, notas.length ? 'por_revisar' : 'valida', obs,
        sinConexion ? 1 : 0, sinConexion?.horaDispositivo ?? null, uid, ubicacion?.lat ?? null, ubicacion?.lon ?? null, ubicacion?.precision ?? null, ip, distancia);
      const id = Number(r.lastInsertRowid);
      if (foto) guardarFoto(id, foto, a.fecha);
      db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(d.id);
      return id;
    })();
  }

  // ---------- Kiosco (sin sesión: lo identifica su token) ----------
  const fallosKiosco = new Map(), fallosIp = new Map(), tickets = new Map(), fotosIntento = new Map(), ultimoIntento = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const m of [fallosKiosco, fallosIp]) for (const [k, v] of m) if (v.reinicia <= t) m.delete(k);
    for (const [k, v] of tickets) if (v.expira <= t) tickets.delete(k);
    for (const [k, v] of fotosIntento) if (v.expira <= t) fotosIntento.delete(k);
    for (const [k, v] of ultimoIntento) if (v + 30000 <= t) ultimoIntento.delete(k);
  }, 60 * 1000).unref();
  const contar = (mapa, k, ventana) => { const t = Date.now(); let r = mapa.get(k); if (!r || r.reinicia <= t) { r = { fallos: 0, reinicia: t + ventana }; mapa.set(k, r); } r.fallos++; };
  const excedido = (mapa, k, max) => { const r = mapa.get(k); return !!r && r.reinicia > Date.now() && r.fallos >= max; };
  const dispositivoDe = db.prepare(`SELECT d.id, d.nombre, d.sucursal_id, d.red_habitual, s.nombre AS sucursal FROM main.checador_dispositivos d
    LEFT JOIN main.sucursales s ON s.id = d.sucursal_id WHERE d.token_hash = ? AND d.activo = 1 AND d.tipo = 'kiosco'`);
  // Middleware de las rutas del kiosco: token válido o 401 (y cuenta el fallo por conexión).
  // Auditoría 2026-11-05: el token válido se revisa ANTES del tope por conexión. Si no, una tableta dada de baja que se
  // queda prendida en la oficina (pregunta cada minuto) o alguien en el mismo Wi-Fi dejaba sin checar al kiosco bueno,
  // que comparte la conexión. Un token conocido pero dado de baja tampoco cuenta como ataque (no adivina nada).
  const conocido = db.prepare('SELECT 1 FROM main.checador_dispositivos WHERE token_hash = ?');
  function tokenInvalido(req, res, t, error, codigo) {
    const forma = /^[A-Za-z0-9_-]{40,60}$/.test(t);
    if (!(forma && conocido.get(hashToken(t)))) {
      if (excedido(fallosIp, req.ipCliente, FALLOS_IP)) return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espera 15 minutos.' });
      contar(fallosIp, req.ipCliente, VENTANA_IP_MS);
    }
    return res.status(401).json({ error, codigo });
  }
  function kiosco(req, res, next) {
    const t = String(req.get('x-kiosco') || '');
    const d = /^[A-Za-z0-9_-]{40,60}$/.test(t) ? dispositivoDe.get(hashToken(t)) : null;
    if (!d) return tokenInvalido(req, res, t, 'Este dispositivo no está registrado como kiosco (o lo dieron de baja). Pide al gerente que lo registre.', 'KIOSCO_NO_REGISTRADO');
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

  // La pantalla del kiosco: la única página del sistema con permiso de cámara (seguridad.js la bloquea en las demás).
  app.get('/kiosco', (req, res) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.sendFile(path.join(__dirname, '..', 'public', 'kiosco.html'));
  });
  app.get('/api/publico/kiosco/estado', kiosco, h((req, res) => {
    const a = ahoraMexico();
    db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(req.kiosco.id);
    res.json({ nombre: req.kiosco.nombre, sucursal: req.kiosco.sucursal, fecha: a.fecha, hora: a.hora.slice(0, 5), utc: a.utc, tipos: TIPOS });
  }));
  // Revisa código y PIN con todos los topes. Regresa { p } o { status, error } (el error ya va listo para la pantalla).
  function verificar(d, codigo, pin) {
    if (excedido(fallosKiosco, d.id, FALLOS_KIOSCO)) return { status: 429, error: 'Demasiados intentos fallidos en este kiosco. Espera 10 minutos o avisa al gerente.' };
    const incorrecto = () => { contar(fallosKiosco, d.id, VENTANA_KIOSCO_MS); return { status: 401, error: 'Código o PIN incorrecto' }; };
    if (!/^\d{4}$/.test(codigo) || !/^\d{4}$/.test(pin)) { scrypt('relleno', 'relleno'); return incorrecto(); }
    const p = db.prepare('SELECT * FROM main.personal WHERE codigo_checador = ?').get(codigo);
    if (!p || !p.pin_hash) { scrypt('relleno', 'relleno'); return incorrecto(); }
    const ahora = Date.now();
    if (p.pin_bloqueado_hasta > ahora) {
      // No cuenta para el tope del kiosco (auditoría 2026-11-05): aquí no se prueba ningún PIN, y si contara, alguien con
      // su PIN bloqueado que sigue tecleando pausaba el kiosco para todos.
      const falta = p.pin_bloqueado_hasta - ahora;
      return { status: 423, error: p.pin_bloqueado_hasta >= BLOQUEO_TOTAL ? 'Tu PIN está bloqueado por intentos fallidos. Pide a RH o a tu gerente que lo desbloquee.'
        : falta > ESPERA_MS ? `Tu PIN está bloqueado por muchos intentos fallidos. Pide a RH o a tu gerente que lo desbloquee, o espera ${Math.ceil(falta / 3600000)} hora(s).`
        : `Tu PIN está bloqueado por intentos fallidos. Intenta de nuevo en ${Math.ceil(falta / 60000)} minuto(s).` };
    }
    const r = revisarPin(p.id, pin, p.pin_hash);
    if (r.otraClave) return { status: 409, error: 'Tu PIN ya no sirve (cambió la clave de seguridad del sistema). Pide a RH un PIN nuevo.' };
    if (!r.ok) {
      // Cada 5 fallos se bloquea: 15 min las primeras veces; desde el fallo 10, 24 h (no para siempre: si no, cualquiera
      // que sepa el código de otra persona la deja sin checar tecleando PINes al azar). RH lo desbloquea antes.
      const fallos = p.pin_fallos + 1, hasta = fallos % FALLOS_ESPERA ? 0 : ahora + (fallos >= FALLOS_TOTAL ? BLOQUEO_LARGO_MS : ESPERA_MS);
      db.prepare('UPDATE main.personal SET pin_fallos = ?, pin_bloqueado_hasta = ? WHERE id = ?').run(fallos, hasta, p.id);
      if (hasta) audit(null, p.id, 'checador bloqueado', `${p.nombre}: PIN bloqueado ${fallos >= FALLOS_TOTAL ? '24 horas (o hasta que RH lo desbloquee)' : '15 minutos'} por ${fallos} intentos fallidos (kiosco «${d.nombre}»)`);
      return incorrecto();
    }
    if (!p.activo || !p.checa) return { status: 403, error: 'No estás dado de alta en el reloj checador. Avisa a RH.' };
    if (p.pin_fallos || p.pin_bloqueado_hasta) db.prepare('UPDATE main.personal SET pin_fallos = 0, pin_bloqueado_hasta = 0 WHERE id = ?').run(p.id);
    return { p };
  }
  // Paso 1: código y PIN. Si son correctos regresa un ticket de 90 s para checar (o para elegir PIN si es temporal).
  // Intento fallido: se registra (uno por código y kiosco cada 30 s) y se regresa un permiso de 90 s para subir su foto.
  function registrarIntento(req, codigo, v) {
    if (![401, 423].includes(v.status)) return null;
    const cod = /^\d{4}$/.test(codigo) ? codigo : null, llave = req.kiosco.id + ':' + (cod || '-'), t = Date.now();
    if (ultimoIntento.has(llave) && ultimoIntento.get(llave) + 30000 > t) return null;
    ultimoIntento.set(llave, t);
    const quien = cod ? db.prepare('SELECT id FROM main.personal WHERE codigo_checador = ?').get(cod) : null, a = ahoraMexico();
    const id = Number(db.prepare('INSERT INTO main.checador_intentos (dispositivo_id, personal_id, codigo, motivo, ip, momento_utc, fecha, hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.kiosco.id, quien?.id ?? null, cod, v.status === 423 ? 'PIN bloqueado' : 'Código o PIN incorrecto', req.ipCliente || null, a.utc, a.fecha, a.hora).lastInsertRowid);
    const permiso = crypto.randomBytes(24).toString('base64url');
    fotosIntento.set(permiso, { id, dispositivoId: req.kiosco.id, fecha: a.fecha, expira: t + TICKET_MS });
    return permiso;
  }
  app.post('/api/publico/kiosco/identificar', kiosco, h((req, res) => {
    const codigo = String(req.body?.codigo ?? ''), v = verificar(req.kiosco, codigo, String(req.body?.pin ?? ''));
    if (!v.p) { const intento = registrarIntento(req, codigo, v); return res.status(v.status).json({ error: v.error, ...(intento ? { intento } : {}) }); }
    if (v.p.pin_temporal) return res.json({ cambiar_pin: true, ticket: nuevoTicket('pin', v.p, req.kiosco.id), nombre: primerNombre(v.p.nombre) });
    res.json(paraChecar(req, v.p));
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
  // La foto de un intento fallido (una sola, del mismo kiosco, dentro de 90 s).
  app.post('/api/publico/kiosco/intento-foto', kiosco, h((req, res) => {
    const t = String(req.body?.intento || ''), x = fotosIntento.get(t);
    if (!x || x.expira <= Date.now() || x.dispositivoId !== req.kiosco.id) return res.status(401).json({ error: 'Se acabó el tiempo' });
    fotosIntento.delete(t);
    const buf = fotoDe(req.body?.foto);
    if (!buf) return res.status(400).json({ error: 'Foto inválida' });
    const archivo = path.join(x.fecha.slice(0, 7), `intento-${x.id}-${crypto.randomBytes(8).toString('hex')}.jpg.cifrado`);
    fs.mkdirSync(path.join(DIR_FOTOS, x.fecha.slice(0, 7)), { recursive: true, mode: 0o700 });
    C.escribirSeguro(path.join(DIR_FOTOS, archivo), C.cifrarArchivo(buf, contextoIntento(x.id)));
    db.prepare('UPDATE main.checador_intentos SET foto_archivo = ? WHERE id = ?').run(archivo, x.id);
    res.json({ ok: true });
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
    const foto = fotoDe(req.body?.foto);
    const id = guardarChecada({ p, d, tipo, a, foto, ip: req.ipCliente || null });
    res.status(201).json({ id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: a.hora.slice(0, 5), ...(foto ? {} : { sin_foto: true }) });
  }));
  // Checada que el kiosco guardó SIN CONEXIÓN y sube al volver internet (una por petición). El PIN se revisa aquí, con
  // los mismos topes. La hora = ahora del servidor − el tiempo que pasó según el kiosco («edad»): con su reloj interno
  // si la página no se recargó (confiable), o con la hora de la tableta si se recargó (estimada). Siempre «por revisar».
  app.post('/api/publico/kiosco/sin-conexion', kiosco, h((req, res) => {
    const b = req.body || {}, d = req.kiosco;
    const uid = String(b.uid || ''), tipo = String(b.tipo || ''), edad = Number(b.edad_ms);
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(uid) || !TIPOS[tipo]) return res.status(400).json({ error: 'Checada guardada inválida', descartar: true });
    if (!Number.isFinite(edad) || edad < 0 || edad > MAX_SIN_CONEXION_MS) return res.status(400).json({ error: 'La checada guardada es de hace más de 7 días o su hora no es válida: regístrala a mano con motivo', descartar: true });
    const v = verificar(d, String(b.codigo ?? ''), String(b.pin ?? ''));
    if (!v.p) {
      if (v.status !== 429) audit(null, null, 'checada sin conexión rechazada', `Kiosco «${d.nombre}»: ${v.error}`);
      return res.status(v.status).json({ error: v.error, descartar: v.status !== 429 });
    }
    const p = v.p, previa = db.prepare('SELECT id, tipo, hora FROM main.checadas WHERE uid_kiosco = ?').get(uid);
    if (previa) return res.json({ id: previa.id, nombre: primerNombre(p.nombre), tipo: TIPOS[previa.tipo], hora: previa.hora.slice(0, 5), repetida: true });
    if (p.pin_temporal) { audit(null, p.id, 'checada sin conexión rechazada', `${p.nombre}: tenía PIN temporal (debe elegir su PIN con internet)`); return res.status(409).json({ error: 'Debe elegir su PIN con internet', descartar: true }); }
    const a = ahoraMexico(new Date(Date.now() - edad)), monotonica = b.monotonica === true;
    const hd = typeof b.hora_dispositivo === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(b.hora_dispositivo) ? b.hora_dispositivo : null;
    const id = guardarChecada({ p, d, tipo, a, foto: fotoDe(b.foto), uid, ip: req.ipCliente || null,
      sinConexion: { horaDispositivo: hd, nota: 'Sin conexión: hora ' + (monotonica ? 'calculada con el reloj interno del kiosco' : 'estimada con el reloj de la tableta (el kiosco se reinició)') } });
    res.status(201).json({ id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: a.hora.slice(0, 5) });
  }));

  // ---------- Celular de una persona (F5) ----------
  const celularDe = db.prepare(`SELECT d.id, d.nombre, d.sucursal_id, d.personal_id, s.nombre AS sucursal FROM main.checador_dispositivos d
    LEFT JOIN main.sucursales s ON s.id = d.sucursal_id WHERE d.token_hash = ? AND d.activo = 1 AND d.tipo = 'celular'`);
  function celular(req, res, next) {
    const t = String(req.get('x-celular') || '');
    const d = /^[A-Za-z0-9_-]{40,60}$/.test(t) ? celularDe.get(hashToken(t)) : null;
    const p = d ? db.prepare('SELECT * FROM main.personal WHERE id = ?').get(d.personal_id) : null;
    if (!d || !p) return tokenInvalido(req, res, t, 'Este celular no está ligado (o lo dieron de baja). Pide a RH un enlace nuevo.', 'CELULAR_NO_LIGADO');
    req.kiosco = d; req.persona = p;
    next();
  }
  // Ubicación que manda el celular: { lat, lon, precision } en grados y metros, o null si no la dio.
  const ubicacionDe = b => {
    const lat = Number(b?.lat), lon = Number(b?.lon), pr = Number(b?.precision);
    if (b?.lat == null || b?.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, precision: Number.isFinite(pr) && pr >= 0 && pr < 1e6 ? Math.round(pr) : 99999 };
  };
  // La página del celular: la única con permiso de cámara y de ubicación.
  app.get('/checar', (req, res) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.sendFile(path.join(__dirname, '..', 'public', 'checar.html'));
  });
  // Ligar el celular con el enlace de un solo uso: regresa el token de este celular (solo se guarda su hash).
  app.post('/api/publico/celular/ligar', h((req, res) => {
    if (excedido(fallosIp, req.ipCliente, FALLOS_IP)) return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espera 15 minutos.' });
    const t = String(req.body?.enlace || '');
    const e = /^[A-Za-z0-9_-]{40,60}$/.test(t) ? db.prepare('SELECT * FROM main.checador_enlaces WHERE token_hash = ?').get(hashToken(t)) : null;
    if (!e || e.usado_at || e.expira_ms < Date.now()) { contar(fallosIp, req.ipCliente, VENTANA_IP_MS); return res.status(401).json({ error: 'Este enlace ya se usó o caducó (dura 24 horas y sirve una sola vez). Pide a RH uno nuevo.' }); }
    const p = db.prepare('SELECT * FROM main.personal WHERE id = ? AND activo = 1').get(e.personal_id);
    if (!p || !p.codigo_checador) return res.status(409).json({ error: 'Esta persona no está dada de alta en el reloj checador. Avisa a RH.' });
    const token = nuevoToken();
    db.transaction(() => {
      // Un celular por persona: el anterior deja de servir.
      db.prepare("UPDATE main.checador_dispositivos SET activo = 0, revocado_por = 'Sistema (se ligó otro celular)', revocado_at = datetime('now','localtime') WHERE tipo = 'celular' AND personal_id = ? AND activo = 1").run(p.id);
      db.prepare("INSERT INTO main.checador_dispositivos (nombre, sucursal_id, token_hash, tipo, personal_id, registrado_por, registrado_por_nombre) VALUES (?, ?, ?, 'celular', ?, ?, ?)")
        .run(('Celular de ' + p.nombre).slice(0, 60), p.sucursal_id, hashToken(token), p.id, e.creado_por, e.creado_por_nombre);
      db.prepare("UPDATE main.checador_enlaces SET usado_at = datetime('now','localtime') WHERE id = ?").run(e.id);
    })();
    audit(null, p.id, 'checador', `${p.nombre}: ligó su celular para checar`);
    res.json({ token, nombre: primerNombre(p.nombre) });
  }));
  app.get('/api/publico/celular/estado', celular, h((req, res) => {
    const p = req.persona, a = ahoraMexico(), u = ultimaDe(p.id, a.fecha);
    db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(req.kiosco.id);
    res.json({ nombre: primerNombre(p.nombre), sucursal: req.kiosco.sucursal, utc: a.utc, tipos: TIPOS, sugerido: SIGUIENTE[u?.tipo || ''], ultima: u ? { tipo: TIPOS[u.tipo], hora: u.hora.slice(0, 5) } : null, pin_temporal: !!p.pin_temporal, activo: !!(p.activo && p.checa) });
  }));
  app.post('/api/publico/celular/cambiar-pin', celular, h((req, res) => {
    const p = req.persona, v = verificar(req.kiosco, p.codigo_checador, String(req.body?.pin ?? ''));
    if (!v.p) return res.status(v.status).json({ error: v.error });
    const nuevo = String(req.body?.nuevo ?? '');
    if (!/^\d{4}$/.test(nuevo) || pinDebil(nuevo, p.codigo_checador)) return res.status(400).json({ error: 'Elige 4 números que no sean fáciles de adivinar (no iguales, seguidos, repetidos ni tu código)' });
    db.prepare("UPDATE main.personal SET pin_hash = ?, pin_temporal = 0, pin_fallos = 0, pin_bloqueado_hasta = 0, pin_cambiado_at = datetime('now','localtime') WHERE id = ?").run(hashPin(p.id, nuevo), p.id);
    audit(null, p.id, 'checador', `${p.nombre}: eligió su PIN desde su celular`);
    res.json({ ok: true });
  }));
  app.post('/api/publico/celular/checar', celular, h((req, res) => {
    const b = req.body || {}, tipo = String(b.tipo || '');
    if (!TIPOS[tipo]) return res.status(400).json({ error: 'Elige qué vas a registrar' });
    const d = req.kiosco, v = verificar(d, req.persona.codigo_checador, String(b.pin ?? ''));
    if (!v.p) return res.status(v.status).json({ error: v.error });
    const p = v.p;
    if (p.pin_temporal) return res.status(409).json({ error: 'Primero elige tu PIN', codigo: 'PIN_TEMPORAL' });
    const previa = db.prepare("SELECT id, hora FROM main.checadas WHERE personal_id = ? AND tipo = ? AND estado <> 'anulada' AND momento_utc >= ? ORDER BY id DESC LIMIT 1")
      .get(p.id, tipo, new Date(Date.now() - DUPLICADO_MS).toISOString());
    if (previa) return res.json({ id: previa.id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: previa.hora.slice(0, 5), repetida: true });
    const foto = fotoDe(b.foto), ubicacion = ubicacionDe(b), a = ahoraMexico();
    const id = guardarChecada({ p, d, tipo, a, foto, origen: 'celular', ubicacion, ip: req.ipCliente || null });
    const est = db.prepare('SELECT estado, observaciones FROM main.checadas WHERE id = ?').get(id);
    res.status(201).json({ id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: a.hora.slice(0, 5), ...(est.estado === 'por_revisar' ? { por_revisar: est.observaciones } : {}) });
  }));

  // ---------- Administración (con sesión) ----------
  // Las tablas sin «main.» son las vistas por sucursal (sucursales.js): una persona o kiosco de otra sucursal «no existe».
  const persona = id => db.prepare('SELECT * FROM personal WHERE id = ?').get(idDe(id));
  const estadoDe = p => ({
    codigo: p.codigo_checador, tiene_pin: !!p.pin_hash, pin_temporal: !!p.pin_temporal, checa: !!p.checa, pin_cambiado_at: p.pin_cambiado_at, checa_whatsapp: !!p.checa_whatsapp,
    // bloqueo_total: el largo (24 h, o el «para siempre» de antes): la pantalla dice que RH lo puede desbloquear.
    bloqueado: p.pin_bloqueado_hasta > Date.now(), bloqueo_total: p.pin_bloqueado_hasta - Date.now() > ESPERA_MS,
    bloqueado_hasta: p.pin_bloqueado_hasta > Date.now() && p.pin_bloqueado_hasta < BLOQUEO_TOTAL ? new Date(p.pin_bloqueado_hasta).toISOString() : null,
  });
  app.get('/api/asistencia/catalogos', h((req, res) => res.json({ tipos: TIPOS, origenes: ORIGENES })));
  app.get('/api/asistencia/personal/:id', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const cel = db.prepare("SELECT id, created_at, ultimo_uso FROM main.checador_dispositivos WHERE tipo = 'celular' AND personal_id = ? AND activo = 1 ORDER BY id DESC LIMIT 1").get(p.id) || null;
    const ultimas = puede(req, 'asistencia.ver') ? db.prepare('SELECT id, tipo, fecha, hora, origen, estado, observaciones, sin_conexion, foto_archivo IS NOT NULL AS tiene_foto, foto_borrada_at IS NOT NULL AS foto_borrada, lat, lon, precision_m FROM checadas WHERE personal_id = ? ORDER BY momento_utc DESC, id DESC LIMIT 10').all(p.id) : [];
    const avisoFirmado = !!db.prepare("SELECT 1 FROM main.documentos_personal WHERE personal_id = ? AND tipo = 'privacidad' AND eliminado = 0").get(p.id);
    res.json({ ...estadoDe(p), celular: cel, aviso_firmado: avisoFirmado, dias_fotos: DIAS_FOTOS, ultimas, puede: { editar: puede(req, 'personal.editar'), corregir: puede(req, 'asistencia.corregir'), ver: puede(req, 'asistencia.ver') } });
  }));
  // Genera (o vuelve a generar) su código y un PIN temporal. El PIN se muestra UNA vez; la base guarda solo su hash.
  // Código (si no tiene) y PIN temporal nuevo. Regresa { codigo, pin }: el PIN solo existe en esta respuesta.
  function altaChecador(req, p) {
    let codigo = p.codigo_checador;
    while (!codigo) { const c = String(crypto.randomInt(1000, 10000)); if (!db.prepare('SELECT 1 FROM main.personal WHERE codigo_checador = ?').get(c)) codigo = c; }
    let pin; do pin = String(crypto.randomInt(0, 10000)).padStart(4, '0'); while (pinDebil(pin, codigo));
    db.prepare("UPDATE main.personal SET codigo_checador = ?, pin_hash = ?, pin_temporal = 1, pin_fallos = 0, pin_bloqueado_hasta = 0, pin_cambiado_at = NULL, checa = 1, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?")
      .run(codigo, hashPin(p.id, pin), p.id);
    audit(req, p.id, 'checador', `${p.nombre}: ${p.pin_hash ? 'nuevo PIN temporal' : 'alta en el checador'} (código ${codigo}; el PIN no se guarda)`);
    return { codigo, pin };
  }
  app.post('/api/asistencia/personal/:id/pin', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para dar PINes del checador');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (!p.activo) return res.status(409).json({ error: 'Está dada de baja: no puede checar' });
    res.json({ ...altaChecador(req, p), aviso: 'Anota el PIN y dáselo a la persona: no se vuelve a mostrar. En su primera checada elegirá el suyo.' });
  }));
  app.post('/api/asistencia/personal/:id/desbloquear', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para desbloquear el checador');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    db.prepare('UPDATE main.personal SET pin_fallos = 0, pin_bloqueado_hasta = 0 WHERE id = ?').run(p.id);
    audit(req, p.id, 'checador', `${p.nombre}: se desbloqueó su PIN`);
    res.json(estadoDe(persona(p.id)));
  }));
  // Enlace de un solo uso (24 h) para ligar el celular de la persona. Se muestra una vez; la base guarda solo su hash.
  app.post('/api/asistencia/personal/:id/celular', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para ligar celulares');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'mandar el enlace para checar desde el celular')) return;
    if (!p.activo || !p.codigo_checador) return res.status(409).json({ error: 'Primero dala de alta en el reloj checador (código y PIN)' });
    const token = nuevoToken();
    db.transaction(() => {
      db.prepare("UPDATE main.checador_enlaces SET usado_at = 'cancelado' WHERE personal_id = ? AND usado_at IS NULL").run(p.id); // solo vale el último enlace
      db.prepare('INSERT INTO main.checador_enlaces (personal_id, token_hash, expira_ms, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?)').run(p.id, hashToken(token), Date.now() + ENLACE_MS, req.usuarioSesion.id, req.usuarioSesion.nombre);
    })();
    audit(req, p.id, 'checador', `${p.nombre}: enlace para ligar su celular (24 h, un solo uso)`);
    // El token va después de «#»: el navegador no lo manda al servidor ni a otras páginas. La dirección sale de APP_URL;
    // si no está, la pantalla la arma con la suya (nunca con el encabezado Host, que lo escribe quien hace la petición).
    const ruta = '/checar#e=' + token;
    res.json({ url: process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') + ruta : null, ruta, telefono: p.telefono || null, aviso: 'El enlace sirve una sola vez y dura 24 horas. Ábrelo en el celular de la persona.' });
  }));
  app.post('/api/asistencia/personal/:id/celular/quitar', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para quitar celulares');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const r = db.prepare("UPDATE main.checador_dispositivos SET activo = 0, revocado_por = ?, revocado_at = datetime('now','localtime') WHERE tipo = 'celular' AND personal_id = ? AND activo = 1").run(req.usuarioSesion.nombre, p.id);
    db.prepare("UPDATE main.checador_enlaces SET usado_at = 'cancelado' WHERE personal_id = ? AND usado_at IS NULL").run(p.id);
    if (r.changes) audit(req, p.id, 'checador', `${p.nombre}: se quitó su celular (ya no puede checar desde él)`);
    res.json({ ok: true, quitados: r.changes });
  }));
  // Quién no checa (p. ej. Dirección): no aparece como falta.
  app.put('/api/asistencia/personal/:id', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para cambiar el checador');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (typeof req.body?.checa !== 'boolean') return res.status(400).json({ error: 'Indica si checa o no' });
    if (app.locals.personal.esPropio(req, res, p.id, 'cambiar si checa o no')) return; // «no checa» = sin faltas
    db.prepare("UPDATE main.personal SET checa = ?, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(req.body.checa ? 1 : 0, p.id);
    audit(req, p.id, 'checador', `${p.nombre}: ${req.body.checa ? 'checa' : 'ya no checa'}`);
    res.json(estadoDe(persona(p.id)));
  }));

  // Kioscos: el token se muestra una sola vez (lo guarda la tableta); la base solo guarda su hash.
  app.get('/api/asistencia/dispositivos', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para los kioscos del checador');
    // red_cambiada: su última checada llegó desde otra red (p. ej. el internet de la oficina cambió de IP).
    res.json(db.prepare(`SELECT d.id, d.nombre, d.sucursal_id, s.nombre AS sucursal, d.activo, d.registrado_por_nombre, d.created_at, d.ultimo_uso, d.revocado_por, d.revocado_at,
      COALESCE((SELECT c.ip FROM main.checadas c WHERE c.dispositivo_id = d.id AND c.ip IS NOT NULL ORDER BY c.id DESC LIMIT 1) <> d.red_habitual, 0) AS red_cambiada
      FROM checador_dispositivos d LEFT JOIN main.sucursales s ON s.id = d.sucursal_id WHERE d.tipo = 'kiosco' ORDER BY d.activo DESC, d.nombre`).all());
  }));
  app.post('/api/asistencia/dispositivos', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para registrar kioscos');
    const nombre = texto(req.body?.nombre, 60);
    if (!nombre || nombre.length < 3 || /[<>{}]/.test(nombre)) return res.status(400).json({ error: 'Escribe un nombre para el kiosco (p. ej. «Entrada Querétaro»)' });
    const s = Number(req.body?.sucursal_id || (req.alcanceSuc?.permitidas?.length === 1 ? req.alcanceSuc.permitidas[0] : 0));
    if (!s || !req.alcanceSuc?.permitidas?.includes(s)) return res.status(400).json({ error: 'Elige una de tus sucursales' });
    const token = nuevoToken();
    // Se registra desde la misma tableta: su red de ahora es «la de siempre».
    const info = db.prepare('INSERT INTO main.checador_dispositivos (nombre, sucursal_id, token_hash, registrado_por, registrado_por_nombre, red_habitual) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nombre, s, hashToken(token), req.usuarioSesion.id, req.usuarioSesion.nombre, req.ipCliente || null);
    app.locals.auditoria?.registrar(req, 'checador_dispositivo', Number(info.lastInsertRowid), 'alta', `Kiosco «${nombre}»`);
    res.status(201).json({ id: Number(info.lastInsertRowid), nombre, token });
  }));
  // La red de la oficina cambió: la de su última checada pasa a ser «la de siempre».
  app.post('/api/asistencia/dispositivos/:id/red', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para los kioscos del checador');
    const d = db.prepare("SELECT * FROM checador_dispositivos WHERE id = ? AND activo = 1 AND tipo = 'kiosco'").get(idDe(req.params.id));
    if (!d) return res.status(404).json({ error: 'Kiosco no encontrado' });
    const ip = db.prepare('SELECT ip FROM main.checadas WHERE dispositivo_id = ? AND ip IS NOT NULL ORDER BY id DESC LIMIT 1').get(d.id)?.ip;
    if (!ip) return res.status(409).json({ error: 'Este kiosco todavía no tiene checadas' });
    db.prepare('UPDATE main.checador_dispositivos SET red_habitual = ? WHERE id = ?').run(ip, d.id);
    app.locals.auditoria?.registrar(req, 'checador_dispositivo', d.id, 'red', `Kiosco «${d.nombre}»: la red de su última checada es ahora la de siempre`);
    res.json({ ok: true });
  }));
  app.post('/api/asistencia/dispositivos/:id/revocar', h((req, res) => {
    if (!puede(req, 'asistencia.kioscos')) return negar(res, 'No tienes permiso para dar de baja kioscos');
    const d = db.prepare("SELECT * FROM checador_dispositivos WHERE id = ? AND activo = 1 AND tipo = 'kiosco'").get(idDe(req.params.id));
    if (!d) return res.status(404).json({ error: 'Kiosco no encontrado' });
    db.prepare("UPDATE main.checador_dispositivos SET activo = 0, revocado_por = ?, revocado_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.nombre, d.id);
    for (const [k, v] of tickets) if (v.dispositivoId === d.id) tickets.delete(k);
    app.locals.auditoria?.registrar(req, 'checador_dispositivo', d.id, 'baja', `Kiosco «${d.nombre}»: ya no puede checar`);
    res.json({ ok: true });
  }));

  // ---------- Checadas: consulta y correcciones ----------
  const fechaOk = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
  app.get('/api/asistencia/checadas', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const fecha = req.query.fecha || ahoraMexico().fecha;
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    const pid = req.query.personal_id ? idDe(req.query.personal_id) : null;
    res.json(db.prepare(`SELECT c.id, c.personal_id, p.nombre, c.tipo, c.fecha, c.hora, c.origen, c.estado, c.observaciones, c.sin_conexion, c.foto_archivo IS NOT NULL AS tiene_foto, c.foto_borrada_at IS NOT NULL AS foto_borrada, c.lat, c.lon, c.precision_m, c.distancia_m, c.ip, c.registrado_por_nombre, d.nombre AS kiosco
      FROM checadas c JOIN personal p ON p.id = c.personal_id LEFT JOIN main.checador_dispositivos d ON d.id = c.dispositivo_id
      WHERE c.fecha = ? ${pid ? 'AND c.personal_id = ?' : ''} ORDER BY c.momento_utc, c.id`).all(...[fecha, ...(pid ? [pid] : [])]));
  }));
  app.get('/api/asistencia/checadas/:id/correcciones', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const c = db.prepare('SELECT id FROM checadas WHERE id = ? AND personal_id IN (SELECT id FROM personal)').get(idDe(req.params.id));
    if (!c) return res.status(404).json({ error: 'Checada no encontrada' });
    res.json(db.prepare('SELECT accion, antes, despues, motivo, usuario_nombre, created_at FROM checadas_correcciones WHERE checada_id = ? ORDER BY id').all(c.id));
  }));
  // La foto de una checada (para revisar quién checó). Cada consulta queda en la bitácora.
  app.get('/api/asistencia/checadas/:id/foto', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const c = db.prepare('SELECT c.id, c.foto_archivo, c.tipo, c.fecha, c.hora, c.personal_id, p.nombre FROM checadas c JOIN personal p ON p.id = c.personal_id WHERE c.id = ?').get(idDe(req.params.id));
    if (!c || !c.foto_archivo) return res.status(404).json({ error: 'Esta checada no tiene foto' });
    const ruta = path.join(DIR_FOTOS, c.foto_archivo);
    if (!ruta.startsWith(DIR_FOTOS + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'La foto ya no está en el servidor' });
    let buf;
    try { buf = C.descifrarArchivo(fs.readFileSync(ruta), contextoFoto(c.id)); }
    catch { return res.status(409).json({ error: 'La foto está cifrada con otra clave o fue alterada: no se puede abrir' }); }
    audit(req, c.personal_id, 'consulta', `${c.nombre}: vio la foto de su checada (${TIPOS[c.tipo]} ${c.fecha} ${c.hora.slice(0, 5)})`);
    res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="checada.jpg"' });
    res.send(buf);
  }));
  // Intentos fallidos en los kioscos de sus sucursales (vista checador_intentos), de un día.
  const intentosDe = fecha => db.prepare(`SELECT i.id, i.fecha, substr(i.hora, 1, 5) AS hora, i.codigo, i.motivo, i.ip, i.foto_archivo IS NOT NULL AS tiene_foto, i.foto_borrada_at IS NOT NULL AS foto_borrada,
      p.nombre AS persona, d.nombre AS kiosco FROM checador_intentos i LEFT JOIN personal p ON p.id = i.personal_id LEFT JOIN main.checador_dispositivos d ON d.id = i.dispositivo_id
      WHERE i.fecha = ? ORDER BY i.momento_utc DESC, i.id DESC`).all(fecha);
  app.get('/api/asistencia/intentos', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const fecha = req.query.fecha || ahoraMexico().fecha;
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    res.json(intentosDe(fecha));
  }));
  app.get('/api/asistencia/intentos/:id/foto', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const i = db.prepare('SELECT i.*, p.nombre FROM checador_intentos i LEFT JOIN main.personal p ON p.id = i.personal_id WHERE i.id = ?').get(idDe(req.params.id));
    if (!i || !i.foto_archivo) return res.status(404).json({ error: 'Este intento no tiene foto' });
    const ruta = path.join(DIR_FOTOS, i.foto_archivo);
    if (!ruta.startsWith(DIR_FOTOS + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'La foto ya no está en el servidor' });
    let buf;
    try { buf = C.descifrarArchivo(fs.readFileSync(ruta), contextoIntento(i.id)); }
    catch { return res.status(409).json({ error: 'La foto está cifrada con otra clave o fue alterada: no se puede abrir' }); }
    audit(req, i.personal_id, 'consulta', `Vio la foto de un intento fallido en el kiosco (${i.fecha} ${i.hora.slice(0, 5)}, código ${i.codigo || '—'}${i.nombre ? ' de ' + i.nombre : ''})`);
    res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="intento.jpg"' });
    res.send(buf);
  }));
  // Ubicación de cada sucursal (para el celular). La ven quienes ven la asistencia; la captura solo Dirección.
  app.get('/api/asistencia/sucursales', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    res.json({ radio_omision: RADIO_SUCURSAL_M, editar: !!P.direccion?.(req), sucursales: db.prepare('SELECT id, nombre, lat, lon, radio_m FROM main.sucursales WHERE activo = 1 ORDER BY id').all().filter(s => req.alcanceSuc?.permitidas?.includes(s.id)) });
  }));
  app.put('/api/asistencia/sucursales/:id/ubicacion', h((req, res) => {
    if (!P.direccion?.(req)) return negar(res, 'La ubicación de una sucursal la captura Dirección');
    const s = db.prepare('SELECT id, nombre FROM main.sucursales WHERE id = ? AND activo = 1').get(idDe(req.params.id));
    if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    const txt = String(req.body?.ubicacion ?? '').trim(), radio = req.body?.radio_m == null || req.body.radio_m === '' ? RADIO_SUCURSAL_M : Number(req.body.radio_m);
    if (!Number.isInteger(radio) || radio < 100 || radio > 20000) return res.status(400).json({ error: 'El radio va de 100 a 20,000 metros' });
    let lat = null, lon = null;
    if (txt) {
      const m = txt.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
      lat = m ? Number(m[1]) : NaN; lon = m ? Number(m[2]) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'Pega la ubicación como la da Google Maps: «20.5888, -100.3899»' });
      lat = Math.round(lat * 1e6) / 1e6; lon = Math.round(lon * 1e6) / 1e6;
    }
    db.prepare('UPDATE main.sucursales SET lat = ?, lon = ?, radio_m = ? WHERE id = ?').run(lat, lon, radio, s.id);
    app.locals.auditoria?.registrar(req, 'sucursal', s.id, 'ubicación', `${s.nombre}: ${lat == null ? 'sin ubicación' : `${lat}, ${lon} · radio ${radio} m`}`);
    res.json({ ok: true, lat, lon, radio_m: radio });
  }));
  // Borrar ya las fotos que pasaron el plazo (además del borrado automático): solo Dirección.
  app.post('/api/asistencia/fotos/limpiar', h((req, res) => {
    if (!P.direccion?.(req)) return negar(res, 'Solo Dirección puede hacer esto');
    const r = borrarFotosViejas();
    app.locals.auditoria?.registrar(req, 'checador', null, 'fotos borradas', `${r.borradas} foto(s) de checadas anteriores al ${r.antes_de} (plazo ${r.dias} días)`);
    res.json(r);
  }));
  const motivoDe = req => { const m = texto(req.body?.motivo, 300); return m && m.length >= 4 ? m : null; };
  const corregir = db.prepare('INSERT INTO main.checadas_correcciones (checada_id, accion, antes, despues, motivo, usuario_id, usuario_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const describir = c => `${TIPOS[c.tipo]} ${c.fecha} ${c.hora.slice(0, 5)}`;
  // Agregar a mano (se le olvidó checar, no había kiosco…): con motivo; nunca en el futuro.
  app.post('/api/asistencia/checadas', h((req, res) => {
    if (!puede(req, 'asistencia.corregir')) return negar(res, 'No tienes permiso para corregir la asistencia');
    const b = req.body || {}, p = persona(b.personal_id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'agregar checadas')) return;
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
    if (app.locals.personal.esPropio(req, res, c.personal_id, 'anular checadas')) return;
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
    if (app.locals.personal.esPropio(req, res, c.personal_id, 'aceptar checadas')) return;
    const motivo = motivoDe(req);
    if (!motivo) return res.status(400).json({ error: 'Escribe por qué se acepta' });
    db.transaction(() => {
      db.prepare("UPDATE main.checadas SET estado = 'valida' WHERE id = ?").run(c.id);
      corregir.run(c.id, 'aceptar', describir(c) + ' · por revisar', 'valida', motivo, req.usuarioSesion.id, req.usuarioSesion.nombre);
    })();
    audit(req, c.personal_id, 'checada aceptada', `${c.nombre}: ${describir(c)} · ${motivo}`);
    res.json({ ok: true });
  }));

  return { TIPOS, altaChecador, intentosDe };
};
module.exports.pinDebil = pinDebil;
module.exports.TIPOS = TIPOS;
module.exports.SIGUIENTE = SIGUIENTE;
