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
const { vigia, ventana, correosDe } = require('./kiosco-vigia');

const TIPOS = { entrada: 'Entrada', comida_sale: 'Salida a comer', comida_regresa: 'Regreso de comer', salida: 'Salida', extra_inicia: 'Inicio de tiempo extra', extra_termina: 'Fin de tiempo extra' };
const SIGUIENTE = { '': 'entrada', entrada: 'comida_sale', comida_sale: 'comida_regresa', comida_regresa: 'salida', salida: 'extra_inicia', extra_inicia: 'extra_termina', extra_termina: 'extra_inicia' };
const ORIGENES = ['kiosco', 'celular', 'whatsapp', 'manual'];
// BLOQUEO_TOTAL: el bloqueo «para siempre» de antes (los que ya estén así siguen hasta que RH los desbloquee).
const FALLOS_ESPERA = 5, FALLOS_TOTAL = 10, ESPERA_MS = 15 * 60 * 1000, BLOQUEO_LARGO_MS = 24 * 3600000, BLOQUEO_TOTAL = 8.64e15;
const FALLOS_KIOSCO = 20, VENTANA_KIOSCO_MS = 10 * 60 * 1000, FALLOS_IP = 30, VENTANA_IP_MS = 15 * 60 * 1000;
// 3 minutos (antes 90 s): la comprobación de la cara ahora da tiempo de acomodarse y de intentarlo otra vez.
const TICKET_MS = 180 * 1000, DUPLICADO_MS = 2 * 60 * 1000;
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

// Motivos de un intento del biométrico que avisan en Inicio (los dos últimos, de versiones anteriores del kiosco).
const MOTIVOS_CARA = ['La cara no coincide', 'Parece foto o pantalla', 'No volteó la cabeza (¿foto?)', 'Cara sin parpadeo (¿foto?)'];
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
  if (existe('checador_intentos')) {
    agregar('checador_intentos', 'detalle', 'TEXT'); // diagnóstico del biométrico (2026-11-09)
    // Aviso de Inicio «la cara no coincidió» (2026-11-09): queda hasta que alguien lo marca revisado (con su nombre).
    agregar('checador_intentos', 'revisado_at', 'TEXT'); agregar('checador_intentos', 'revisado_por_nombre', 'TEXT');
  }
  if (existe('checadas')) { agregar('checadas', 'uid_kiosco', 'TEXT'); agregar('checadas', 'precision_m', 'REAL'); agregar('checadas', 'foto_borrada_at', 'TEXT'); agregar('checadas', 'ip', 'TEXT'); agregar('checadas', 'distancia_m', 'REAL'); agregar('checadas', 'biometria', 'TEXT'); agregar('checadas', 'distancia_rostro', 'REAL'); }
  if (existe('checador_dispositivos')) { agregar('checador_dispositivos', 'tipo', "TEXT NOT NULL DEFAULT 'kiosco'"); agregar('checador_dispositivos', 'personal_id', 'INTEGER REFERENCES personal(id)'); agregar('checador_dispositivos', 'red_habitual', 'TEXT'); agregar('checador_dispositivos', 'eliminado_at', 'TEXT'); agregar('checador_dispositivos', 'eliminado_por', 'TEXT'); }
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
      tipo TEXT NOT NULL DEFAULT 'kiosco', personal_id INTEGER REFERENCES personal(id), red_habitual TEXT,
      eliminado_at TEXT, eliminado_por TEXT
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
      uid_kiosco TEXT, precision_m REAL, foto_borrada_at TEXT, ip TEXT, distancia_m REAL, biometria TEXT, distancia_rostro REAL
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
    CREATE TRIGGER checadas_no_cambiar BEFORE UPDATE OF personal_id, tipo, momento_utc, fecha, hora, origen, dispositivo_id, created_at, uid_kiosco, ip, distancia_m, biometria, distancia_rostro ON checadas
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
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), detalle TEXT, revisado_at TEXT, revisado_por_nombre TEXT
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
  // «bio»: resultado del biométrico facial (biometria.js); si trae nota, la checada queda por revisar.
  function guardarChecada({ p, d, tipo, a, foto, ip = null, sinConexion = null, uid = null, origen = 'kiosco', ubicacion = null, bio = null }) {
    const notas = [], avisos = [];
    if (bio?.nota) notas.push(bio.nota);
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
      const r = db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, dispositivo_id, sucursal_id, estado, observaciones, sin_conexion, hora_dispositivo, uid_kiosco, lat, lon, precision_m, ip, distancia_m, biometria, distancia_rostro)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, tipo, a.utc, a.fecha, a.hora, origen, d.id, d.sucursal_id, notas.length ? 'por_revisar' : 'valida', obs,
        sinConexion ? 1 : 0, sinConexion?.horaDispositivo ?? null, uid, ubicacion?.lat ?? null, ubicacion?.lon ?? null, ubicacion?.precision ?? null, ip, distancia, bio?.resultado ?? null, bio?.distancia ?? null);
      const id = Number(r.lastInsertRowid);
      if (foto) guardarFoto(id, foto, a.fecha);
      db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(d.id);
      return id;
    })();
  }

  // ---------- Kiosco (sin sesión: lo identifica su token) ----------
  const fallosKiosco = new Map(), fallosIp = new Map(), tickets = new Map(), fotosIntento = new Map(), ultimoIntento = new Map();
  // Permisos de checar ya usados (2 min): si la tableta repite la misma checada porque no le llegó la respuesta (red
  // inestable), recibe la misma respuesta en vez de «se acabó el tiempo» (2026-11-12).
  const ticketsUsados = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of ticketsUsados) if (v.expira <= t) ticketsUsados.delete(k);
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
    vigiaKioscos.senal(d.id); // señal de vida (kiosco-vigia.js)
    next();
  }
  // ---------- Aviso «el reloj checador no responde» (2026-11-12, pedido de Dirección; regla en kiosco-vigia.js) ----------
  // Queda en los Logs del sistema, sale en Inicio (personal.js, para quien tiene «Kioscos del checador», de sus
  // sucursales) y se manda por correo a Dirección (usuarios con rol admin) y a los correos de CORREO_AVISOS_CHECADOR.
  const textoKiosco = k => `Kiosco «${k.nombre}»${k.sucursal ? ' (' + k.sucursal + ')' : ''}`;
  function avisarKiosco(tipo, k) {
    if (tipo === 'bateria' || tipo === 'camara' || tipo === 'pantalla') return avisarAtencion(tipo, k);
    const cayo = tipo === 'sin_respuesta';
    app.locals.registro?.servicio(cayo ? 'kiosco_sin_respuesta' : 'kiosco_volvio', cayo ? `${textoKiosco(k)}: sin señal desde ${k.desde || 'hace más de 5 minutos'}${k.ultimo ? '; lo último que reportó: ' + k.ultimo : ''}` : `${textoKiosco(k)}: volvió a dar señal a las ${k.volvio}`);
    const correo = require('./correo');
    const para = correosDe(db.prepare("SELECT correo FROM main.usuarios WHERE rol = 'admin' AND activo = 1 AND correo IS NOT NULL AND trim(correo) <> ''").all().map(u => u.correo), process.env.CORREO_AVISOS_CHECADOR);
    const asunto = cayo ? `⚠️ El reloj checador no responde: ${k.nombre}` : `✅ El reloj checador ya responde: ${k.nombre}`;
    const mensaje = cayo
      ? `${textoKiosco(k)} no da señal desde ${k.desde || 'hace más de 5 minutos'}. Revisa que la tableta esté prendida, desbloqueada, con internet y con el checador abierto. Mientras tanto, quien tenga su enlace puede checar desde su celular.`
      : `${textoKiosco(k)} volvió a dar señal a las ${k.volvio}. No había respondido desde ${k.desde || 'antes de las ' + k.hora}.`;
    for (const c of para) correo.enviar(c, asunto, { titulo: cayo ? 'El reloj checador no responde' : 'El reloj checador ya responde', saludo: 'Hola:', mensaje,
      pie: 'Aviso automático del CRM de Saneadren: llega una vez cuando el checador deja de responder en horario de trabajo y otra cuando vuelve.' }).catch(e => console.error('[kiosco] correo:', e.message));
  }
  // «Necesita atención»: batería baja sin cargador o cámara que no funciona (para arreglarlo antes de que falle).
  const textoAtencion = k => (k.tipo === 'pantalla' ? 'no puede mantener la pantalla encendida: se va a apagar sola y pedirá el PIN de la tableta. En la tableta: apaga el ahorro de energía y activa «Pantalla activa» en Ajustes → Opciones de desarrollador (y déjala conectada al cargador)' : k.tipo === 'bateria' ? `batería en ${k.bateria} % y sin cargador: conéctala para que no se apague` : 'la cámara no está funcionando: las checadas quedan sin foto y por revisar (toca el aviso amarillo de la tableta o cierra y abre el checador)');
  function avisarAtencion(tipo, k) {
    app.locals.registro?.servicio('kiosco_atencion', `${textoKiosco(k)}: ${textoAtencion(k)}`);
    const correo = require('./correo');
    const para = correosDe(db.prepare("SELECT correo FROM main.usuarios WHERE rol = 'admin' AND activo = 1 AND correo IS NOT NULL AND trim(correo) <> ''").all().map(u => u.correo), process.env.CORREO_AVISOS_CHECADOR);
    for (const c of para) correo.enviar(c, `⚠️ El reloj checador necesita atención: ${k.nombre}`, { titulo: 'El reloj checador necesita atención', saludo: 'Hola:', mensaje: `${textoKiosco(k)}: ${textoAtencion(k)}.`,
      pie: 'Aviso automático del CRM de Saneadren: llega una sola vez; en Inicio se quita solo cuando se arregla.' }).catch(e => console.error('[kiosco] correo:', e.message));
  }
  const vigiaKioscos = vigia({ ahoraMexico, avisar: avisarKiosco, ventanaDe: (suc, fecha) => { try { return ventana(db, suc, fecha); } catch { return null; } },
    kioscos: () => db.prepare(`SELECT d.id, d.nombre, d.sucursal_id, s.nombre AS sucursal FROM main.checador_dispositivos d LEFT JOIN main.sucursales s ON s.id = d.sucursal_id
      WHERE d.tipo = 'kiosco' AND d.activo = 1 AND d.eliminado_at IS NULL AND d.ultimo_uso >= datetime('now', 'localtime', '-7 days')`).all() });
  if (process.env.MODO_DEMO !== '1') setInterval(() => { try { vigiaKioscos.revisar(); } catch (e) { console.error('[kiosco] vigía:', e.message); } }, 60000).unref();
  const ultimaDe = (personaId, fecha) => db.prepare("SELECT tipo, hora FROM main.checadas WHERE personal_id = ? AND fecha = ? AND estado <> 'anulada' ORDER BY momento_utc DESC, id DESC LIMIT 1").get(personaId, fecha);
  // Qué botón sugerir. Tiempo extra que pasa de medianoche (2026-11-11): si hoy aún no checa, es antes de las 12:00 y
  // anoche dejó abierto el «Inicio de tiempo extra», se sugiere «Fin de tiempo extra» (server/asistencia.js lo une).
  function sugeridoPara(personaId, a) {
    const u = ultimaDe(personaId, a.fecha);
    if (!u && a.hora < '12:00') {
      const ayer = ultimaDe(personaId, new Date(Date.parse(a.fecha + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10));
      if (ayer?.tipo === 'extra_inicia') return 'extra_termina';
      // Salida de madrugada (2026-11-12): antes de las 06:00, si ayer entró y no ha salido, se sugiere «Salida».
      if (a.hora < '06:00' && ['entrada', 'comida_regresa'].includes(ayer?.tipo)) return 'salida';
    }
    return SIGUIENTE[u?.tipo || ''];
  }
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
  // ---------- Mis servicios (2026-11-11, pedido de Dirección) ----------
  // Al identificarse en el kiosco o en su celular, la persona ve las órdenes de servicio que le asignaron (equipo de la
  // orden: responsable, operador o ayudante; o técnico, si su ficha está ligada a ese usuario) de hoy y los próximos 6
  // días. Quien tiene puesto «Supervisor» ve todas las órdenes de su sucursal. Solo lo necesario para ir a trabajar:
  // día, hora, cliente, dirección, servicio y su descripción, equipo (unidad) y compañeros. Nunca precios ni teléfonos.
  const PAPELES = { responsable: 'Responsable', operador: 'Operador', ayudante: 'Ayudante' };
  // Descripción del trabajo (partidas, sin cantidades ni precios). El nombre del servicio no se repite si ya es el de la orden.
  const textoServicio = (json, servicio) => { try { const l = JSON.parse(json || '[]'); return Array.isArray(l) ? l.map(x => [x?.servicio && x.servicio !== servicio ? x.servicio : null, x?.leyenda].filter(Boolean).join(': ')).filter(Boolean).join(' · ').slice(0, 400) : ''; } catch { return ''; } };
  function serviciosDe(personaId, dispositivoId = null) {
    const p = db.prepare('SELECT id, puesto, sucursal_id, usuario_id FROM main.personal WHERE id = ?').get(personaId);
    if (!p) return [];
    const hoy = ahoraMexico().fecha, hasta = (() => { const d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
    const supervisor = p.puesto === 'Supervisor';
    const filas = db.prepare(`SELECT l.id, l.created_at, l.estatus, l.folio_num, l.sucursal_id, l.fecha_servicio, l.hora_servicio, l.direccion, l.equipo, l.partidas_json,
        COALESCE(c.empresa_contacto, c.nombre, l.empresa_contacto, l.nombre) AS cliente, s.nombre AS servicio,
        (SELECT op.papel FROM main.orden_personal op WHERE op.lead_id = l.id AND op.personal_id = ?) AS papel
      FROM main.leads l LEFT JOIN main.clientes c ON c.id = l.cliente_id LEFT JOIN main.catalogo_servicios s ON s.id = l.servicio_id
      WHERE l.estatus = 'ganado' AND l.fecha_servicio BETWEEN ? AND ? AND (l.ejecucion IS NULL OR l.fecha_servicio = ?)
        AND (EXISTS (SELECT 1 FROM main.orden_personal op WHERE op.lead_id = l.id AND op.personal_id = ?) OR (l.tecnico_id IS NOT NULL AND l.tecnico_id = ?) OR (? = 1 AND l.sucursal_id = ?))
      ORDER BY l.fecha_servicio, COALESCE(l.hora_servicio, '99:99'), l.id LIMIT 40`).all(p.id, hoy, hasta, hoy, p.id, p.usuario_id ?? -1, supervisor ? 1 : 0, p.sucursal_id ?? -1);
    const equipo = db.prepare('SELECT pe.nombre, op.papel FROM main.orden_personal op JOIN main.personal pe ON pe.id = op.personal_id WHERE op.lead_id = ? ORDER BY CASE op.papel WHEN \'responsable\' THEN 0 WHEN \'operador\' THEN 1 ELSE 2 END, pe.nombre');
    const folioLead = require('./sucursales').folioLead;
    const factura = db.prepare("SELECT 1 FROM main.facturas WHERE lead_id = ? AND estatus = 'timbrada' AND pdf_path IS NOT NULL LIMIT 1");
    return filas.map(l => ({ folio: folioLead(l), ...(dispositivoId ? { imprimir: permisoDocumento(l.id, p.id, dispositivoId), con_factura: !!factura.get(l.id) } : {}), fecha: l.fecha_servicio, hora: l.hora_servicio || null, cliente: l.cliente || '', direccion: l.direccion || '', servicio: l.servicio || '',
      descripcion: textoServicio(l.partidas_json, l.servicio), unidad: l.equipo || '', papel: PAPELES[l.papel] || (l.papel ? l.papel : supervisor ? 'Supervisor' : 'Técnico'),
      equipo: equipo.all(l.id).map(x => `${x.nombre} (${PAPELES[x.papel] || x.papel})`) }));
  }
  // ---------- Imprimir la orden de servicio y su factura (2026-11-11, Dirección: «sí tiene que imprimir la orden de
  // servicio y factura con precio») ----------
  // Cada servicio de «Mis servicios» trae un permiso de un solo dispositivo que vale 15 min: solo quien está asignado
  // (o el supervisor de la sucursal) y solo después de identificarse. Cada impresión queda en la bitácora.
  const permisosDoc = new Map(), PERMISO_DOC_MS = 15 * 60 * 1000;
  setInterval(() => { const t = Date.now(); for (const [k, v] of permisosDoc) if (v.expira <= t) permisosDoc.delete(k); }, 60 * 1000).unref();
  function permisoDocumento(leadId, personaId, dispositivoId) {
    const t = crypto.randomBytes(18).toString('base64url');
    permisosDoc.set(t, { leadId, personaId, dispositivoId, expira: Date.now() + PERMISO_DOC_MS });
    return t;
  }
  const permisoValido = (req, res) => {
    const x = permisosDoc.get(String(req.body?.permiso || ''));
    if (!x || x.expira <= Date.now() || x.dispositivoId !== req.kiosco.id) { res.status(401).json({ error: 'Se acabó el tiempo. Vuelve a identificarte para imprimir.' }); return null; }
    const persona = db.prepare('SELECT id, nombre, activo FROM main.personal WHERE id = ?').get(x.personaId);
    if (!persona?.activo) { res.status(401).json({ error: 'Ya no estás activo en el reloj checador' }); return null; }
    return { ...x, persona };
  };
  const dondeImprime = req => (req.persona ? 'desde su celular' : `en el kiosco «${req.kiosco.nombre}»`);
  // Los datos de la orden para dibujar el PDF en la tableta (public/orden-servicio-pdf.js), igual que en el CRM.
  function datosOrden(req, leadId) {
    const l = db.prepare(`SELECT l.*, c.nombre AS c_nombre, c.empresa_contacto AS c_empresa FROM main.leads l LEFT JOIN main.clientes c ON c.id = l.cliente_id WHERE l.id = ? AND l.estatus = 'ganado'`).get(leadId);
    if (!l) return null;
    const Importes = require('../public/importes.js'), suc = require('./sucursales');
    let items = []; try { items = JSON.parse(l.partidas_json || '[]').filter(x => x && (x.servicio || x.importe || x.leyenda)); } catch { items = []; }
    const modo = l.iva_modo || null, tasa = l.iva_tasa ?? null, r = Importes.calcular(items, modo, tasa);
    let e = db.prepare('SELECT token FROM main.encuestas WHERE lead_id = ?').get(l.id);
    if (!e) { db.prepare('INSERT OR IGNORE INTO main.encuestas (lead_id, token) VALUES (?, ?)').run(l.id, crypto.randomBytes(16).toString('base64url')); e = db.prepare('SELECT token FROM main.encuestas WHERE lead_id = ?').get(l.id); }
    const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') : (req.get('x-forwarded-proto') || req.protocol) + '://' + req.get('host');
    const equipo = db.prepare('SELECT p.nombre FROM main.orden_personal op JOIN main.personal p ON p.id = op.personal_id WHERE op.lead_id = ? ORDER BY op.papel = \'responsable\' DESC, p.nombre').all(l.id).map(x => x.nombre);
    return {
      leadId: l.id, folio: suc.folioLead(l), folioCotizacion: l.origen === 'directo' ? '' : suc.folioLead({ ...l, estatus: 'abierto' }),
      fechaServicio: l.fecha_servicio ? l.fecha_servicio.split('-').reverse().join('/') : 'Por confirmar',
      cliente: { nombre: l.nombre || l.c_nombre || 'Cliente', empresa: l.empresa_contacto || l.c_empresa || '', telefono: l.telefono || '', direccion: l.direccion || '' },
      equipo: l.equipo || '', operador: [...equipo, l.operador].filter(Boolean).join(', '), proyecto: l.proyecto || '', observaciones: l.observaciones || '', items,
      modo, total: r.total_cent / 100, totalLetras: Importes.enLetras(r.total_cent), totales: Importes.filasTotales(r, modo, tasa), leyendaIva: Importes.leyenda(modo, tasa),
      encabezadoImporte: Importes.encabezadoImporte(modo) + ' (MXN)', conCantidad: items.some(i => Importes.cantidadDe(i) !== 1),
      encuesta: e ? base + '/e/' + e.token : null,
    };
  }
  const dirFacturas = path.join(process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..'), 'archivos');
  const imprimirOrden = (req, res) => {
    const x = permisoValido(req, res); if (!x) return;
    const d = datosOrden(req, x.leadId);
    if (!d) return res.status(404).json({ error: 'La orden ya no está disponible' });
    audit(null, x.persona.id, 'imprimió', `${x.persona.nombre}: imprimió la orden de servicio ${d.folio} ${dondeImprime(req)}`);
    res.json(d);
  };
  const imprimirFactura = (req, res) => {
    const x = permisoValido(req, res); if (!x) return;
    const f = db.prepare("SELECT id, serie, folio, entorno, pdf_path FROM main.facturas WHERE lead_id = ? AND estatus = 'timbrada' AND pdf_path IS NOT NULL ORDER BY id DESC LIMIT 1").get(x.leadId);
    const ruta = f ? path.resolve(dirFacturas, f.pdf_path) : null;
    if (!ruta || !ruta.startsWith(path.resolve(dirFacturas) + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'Esta orden no tiene factura guardada. Pídela a la oficina.' });
    const nombre = `factura-${String(f.serie || '').replace(/[^A-Za-z0-9]/g, '')}${String(f.folio || f.id).replace(/[^A-Za-z0-9]/g, '')}${f.entorno === 'prod' ? '' : '-PRUEBA'}.pdf`;
    audit(null, x.persona.id, 'imprimió', `${x.persona.nombre}: imprimió la factura ${f.serie || ''}${f.folio || f.id} ${dondeImprime(req)}`);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'private, no-store' }).send(fs.readFileSync(ruta));
  };
  const paraChecar = (req, p) => {
    const ah = ahoraMexico(), { fecha } = ah, u = ultimaDe(p.id, fecha);
    // biometria: la tableta debe tomar su cara con la prueba de vida y mandarla (biometria.js).
    return { ticket: nuevoTicket('checar', p, req.kiosco.id), nombre: primerNombre(p.nombre), sugerido: sugeridoPara(p.id, ah), ultima: u ? { tipo: TIPOS[u.tipo], hora: u.hora.slice(0, 5) } : null, tipos: TIPOS, biometria: !!app.locals.biometria?.activo(p.id), avisos: avisosDe(p.id, req.kiosco.id), servicios: serviciosDe(p.id, req.kiosco.id) };
  };

  // La pantalla del kiosco: la única página del sistema con permiso de cámara (seguridad.js la bloquea en las demás).
  app.get('/kiosco', (req, res) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    // La prueba de vida (public/vendor/ort + vendor/antispoof) corre en WebAssembly: solo esta página lo permite.
    res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy') || '').replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"));
    res.sendFile(path.join(__dirname, '..', 'public', 'kiosco.html'));
  });
  app.get('/api/publico/kiosco/estado', kiosco, h((req, res) => {
    const a = ahoraMexico();
    db.prepare("UPDATE main.checador_dispositivos SET ultimo_uso = datetime('now','localtime') WHERE id = ?").run(req.kiosco.id);
    // La tableta dice cómo está (batería, cargador, cámara): el vigía avisa antes de que falle (kiosco-vigia.js).
    const q = req.query, b = /^\d{1,3}$/.test(String(q.b ?? '')) ? Number(q.b) : null, si = v => (v === '1' ? true : v === '0' ? false : null);
    vigiaKioscos.reporte(req.kiosco.id, { bateria: b, cargando: si(q.c), camara: si(q.cam), pantalla: si(q.pan) });
    res.json({ nombre: req.kiosco.nombre, sucursal: req.kiosco.sucursal, fecha: a.fecha, hora: a.hora.slice(0, 5), utc: a.utc, tipos: TIPOS, llave_cola: llaveColaPublica(),
      // ¿Alguien de esta sucursal entra con la cara? Si nadie, la tableta no carga el reconocimiento facial (22 MB) al abrir.
      caras: !!db.prepare('SELECT 1 FROM main.rostros r JOIN main.personal p ON p.id = r.personal_id WHERE p.activo = 1 AND p.sucursal_id = ? LIMIT 1').get(req.kiosco.sucursal_id) });
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
  // Paso 1: código y PIN. Si son correctos regresa un ticket de 3 min para checar (o para elegir PIN si es temporal).
  // Intento fallido: se registra (uno por código y kiosco cada 30 s) y se regresa un permiso de 3 min para subir su foto.
  // «motivo»: para los intentos con la cara (biométrico); esos no se limitan a uno cada 30 s (ya son máx. 3 por persona).
  // «detalle»: diagnóstico del biométrico (cuadros vistos, ojos, giro) para poder ajustar con datos reales.
  function registrarIntento(req, codigo, v, motivo = null, detalle = null) {
    if (![401, 423].includes(v.status)) return null;
    const cod = /^\d{4}$/.test(codigo) ? codigo : null, llave = req.kiosco.id + ':' + (cod || '-'), t = Date.now();
    if (!motivo && ultimoIntento.has(llave) && ultimoIntento.get(llave) + 30000 > t) return null;
    if (!motivo) ultimoIntento.set(llave, t);
    const quien = cod ? db.prepare('SELECT id FROM main.personal WHERE codigo_checador = ?').get(cod) : null, a = ahoraMexico();
    const id = Number(db.prepare('INSERT INTO main.checador_intentos (dispositivo_id, personal_id, codigo, motivo, ip, momento_utc, fecha, hora, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.kiosco.id, quien?.id ?? null, cod, motivo || (v.status === 423 ? 'PIN bloqueado' : 'Código o PIN incorrecto'), req.ipCliente || null, a.utc, a.fecha, a.hora, detalle).lastInsertRowid);
    const permiso = crypto.randomBytes(24).toString('base64url');
    fotosIntento.set(permiso, { id, dispositivoId: req.kiosco.id, fecha: a.fecha, expira: t + TICKET_MS });
    return permiso;
  }
  // Diagnóstico que manda la tableta (solo números) + la distancia de la cara, en una línea legible.
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
  function detalleDe(d, ev) {
    const partes = [];
    if (d && typeof d === 'object') {
      const c = num(d.cuadros, 10000), s = num(d.segundos, 600), ev2 = num(d.evaluados, 1000), re = num(d.reales, 1000), sg = num(d.seguidos, 1000), vp = num(d.vida, 100);
      if (c !== null) partes.push(`${c} cuadros${s ? ` en ${s} s` : ''}`);
      // Prueba de vida pasiva (2026-11-09): cuántos cuadros revisó el modelo, cuántos salieron «persona real», la racha
      // más larga (pide 3 seguidos) y el promedio (positivo = real, negativo = foto o pantalla).
      if (ev2 !== null) partes.push(`vida: ${re ?? 0} de ${ev2} reales, racha ${sg ?? 0} (pide 3)${vp !== null ? `, promedio ${vp.toFixed(1)}` : ''}`);
      const ac = num(d.acomodo, 600), rg = num(d.regresos, 10);
      if (ac !== null) partes.push(`se acomodó en ${ac} s`);
      if (rg) partes.push(`se movió ${rg} ${rg === 1 ? 'vez' : 'veces'}`);
      if (d.oscuro === true) partes.push('poca luz');
      if (d.chica === true) partes.push('cara muy lejos');
      if (d.sinModelo === true) partes.push('no cargó la prueba de vida');
    }
    if (ev?.distancia != null) partes.push(`distancia ${Number(ev.distancia).toFixed(2)}`);
    return partes.join(' · ').slice(0, 200) || null;
  }
  // ---------- Entrar con la cara en vez del PIN (biométrico, decidido con Dirección el 2026-11-05) ----------
  // Código (o credencial) → si la persona tiene biométrico, la tablet la escanea: si coincide y pasa la prueba de vida, SE SALTA EL
  // PIN. Tras 3 caras que no coinciden en 10 min, solo con PIN (y cada intento fallido queda con su foto en «Intentos
  // fallidos» para RH). No aplica a quien tiene PIN temporal (primero elige su PIN).
  const fallosCara = new Map(), INTENTOS_CARA = 3, VENTANA_CARA_MS = 10 * 60 * 1000;
  setInterval(() => { const t = Date.now(); for (const [k, v] of fallosCara) if (v.reinicia <= t) fallosCara.delete(k); }, 60 * 1000).unref();
  const caraAgotada = pid => { const f = fallosCara.get(pid); return !!f && f.reinicia > Date.now() && f.n >= INTENTOS_CARA; };
  const conCara = codigo => {
    if (!/^\d{4}$/.test(codigo)) return null;
    const p = db.prepare('SELECT * FROM main.personal WHERE codigo_checador = ? AND activo = 1 AND checa = 1').get(codigo);
    return p && !p.pin_temporal && app.locals.biometria?.activo(p.id) && !caraAgotada(p.id) ? p : null;
  };
  // ¿Esta persona entra con su cara? (si no, el kiosco pide el PIN)
  app.post('/api/publico/kiosco/rostro-previo', kiosco, h((req, res) => res.json({ biometria: !!conCara(String(req.body?.codigo ?? '')) })));
  app.post('/api/publico/kiosco/rostro-entrar', kiosco, h((req, res) => {
    const codigo = String(req.body?.codigo ?? ''), p = conCara(codigo);
    if (!p) return res.status(409).json({ error: 'Escribe tu PIN', pin: true });
    const ev = app.locals.biometria.evaluar(p.id, req.body?.rostro);
    if (ev?.resultado === 'coincide') { fallosCara.delete(p.id); return res.json({ ...paraChecar(req, p), con_cara: true }); }
    const t = Date.now(); let f = fallosCara.get(p.id);
    if (!f || f.reinicia <= t) { f = { n: 0, reinicia: t + VENTANA_CARA_MS }; fallosCara.set(p.id, f); }
    f.n++;
    const motivo = { no_coincide: 'La cara no coincide', no_vivo: 'Parece foto o pantalla', sin_rostro: 'No se vio la cara' }[ev?.resultado] || 'Biométrico sin resultado';
    const intento = registrarIntento(req, codigo, { status: 401 }, motivo, detalleDe(req.body?.rostro?.diag, ev));
    res.status(401).json({ coincide: false, resultado: ev?.resultado || null, intentos: f.n, pin: f.n >= INTENTOS_CARA, ...(intento ? { intento } : {}) });
  }));
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
  // La foto de un intento fallido (una sola, del mismo kiosco, dentro de 3 min).
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
  // Biométrico (biometria.js): comprobar la cara antes de checar, hasta 3 veces por ticket (sin gastarlo). Solo dice si
  // coincide; la decisión que queda en la checada se toma otra vez al checar.
  app.post('/api/publico/kiosco/rostro-verificar', kiosco, h((req, res) => {
    const t = String(req.body?.ticket || ''), x = tickets.get(t);
    if (!x || x.expira <= Date.now() || x.dispositivoId !== req.kiosco.id || x.tipo !== 'checar') return res.status(401).json({ error: 'Se acabó el tiempo. Vuelve a escribir tu código y PIN.' });
    x.rostros = (x.rostros || 0) + 1;
    if (x.rostros > 3) return res.status(429).json({ error: 'Ya se intentó 3 veces' });
    const ev = app.locals.biometria?.evaluar(x.personaId, req.body?.rostro);
    res.json({ coincide: !ev || ev.resultado === 'coincide', resultado: ev?.resultado || null, intentos: x.rostros });
  }));
  // Registrar la cara con el código que dio RH (biometria.js).
  app.post('/api/publico/kiosco/rostro-registrar', kiosco, h((req, res) => {
    const r = app.locals.biometria?.registrar(req.kiosco, req.body?.codigo, req.body?.descriptores, req.body?.vivo);
    if (!r) return res.status(503).json({ error: 'El biométrico no está disponible' });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.status(201).json(r);
  }));
  // Paso 2: registrar la checada con la hora del servidor.
  app.post('/api/publico/kiosco/checar', kiosco, h((req, res) => {
    const tipo = String(req.body?.tipo || '');
    if (!TIPOS[tipo]) return res.status(400).json({ error: 'Elige qué vas a registrar' });
    const tk = String(req.body?.ticket || ''), ya = ticketsUsados.get(tk);
    if (ya && ya.expira > Date.now() && ya.dispositivoId === req.kiosco.id && ya.tipo === tipo) return res.json({ ...ya.respuesta, repetida: true });
    const p = tomarTicket(req, ['checar']);
    if (!p) return res.status(401).json({ error: 'Se acabó el tiempo. Vuelve a escribir tu código y PIN.' });
    const d = req.kiosco, a = ahoraMexico();
    const responder = (estatus, respuesta) => { ticketsUsados.set(tk, { dispositivoId: d.id, tipo, respuesta, expira: Date.now() + DUPLICADO_MS }); res.status(estatus).json(respuesta); };
    // Doble toque: la misma checada de la misma persona en menos de 2 minutos no se repite.
    const previa = db.prepare("SELECT id, hora FROM main.checadas WHERE personal_id = ? AND tipo = ? AND estado <> 'anulada' AND momento_utc >= ? ORDER BY id DESC LIMIT 1")
      .get(p.id, tipo, new Date(Date.now() - DUPLICADO_MS).toISOString());
    if (previa) return responder(200, { id: previa.id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: previa.hora.slice(0, 5), repetida: true, avisos: avisosDe(p.id, req.kiosco.id), servicios: serviciosDe(p.id, req.kiosco.id) });
    const foto = fotoDe(req.body?.foto), bio = app.locals.biometria?.evaluar(p.id, req.body?.rostro) || null;
    const id = guardarChecada({ p, d, tipo, a, foto, ip: req.ipCliente || null, bio });
    responder(201, { id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: a.hora.slice(0, 5), ...(foto ? {} : { sin_foto: true }), ...(bio?.nota ? { por_revisar: bio.nota } : {}), avisos: avisosDe(p.id, req.kiosco.id), servicios: serviciosDe(p.id, req.kiosco.id) });
  }));
  // Checada que el kiosco guardó SIN CONEXIÓN y sube al volver internet (una por petición). El PIN se revisa aquí, con
  // los mismos topes. La hora = ahora del servidor − el tiempo que pasó según el kiosco («edad»): con su reloj interno
  // si la página no se recargó (confiable), o con la hora de la tableta si se recargó (estimada). Siempre «por revisar».
  // Auditoría del checador (2026-11-12): lo que se rechaza ya no desaparece. Queda en «Intentos fallidos» (de quién era
  // el código, qué botón, la hora en que se marcó según la tableta y su foto) y en la bitácora de la persona, para que
  // RH la registre a mano si era buena. Con el PIN BLOQUEADO no se descarta: la tableta la vuelve a subir después (antes
  // una checada buena se borraba si subía durante el bloqueo). Si la tableta repite una ya rechazada (no le llegó la
  // respuesta), recibe lo mismo sin anotarla otra vez ni contar otro fallo de PIN.
  // Candado de la cola sin conexión (2026-11-12, auditoría): la tableta ya no guarda el PIN en claro mientras la checada
  // espera a subir. Lo cierra con una llave PÚBLICA que le da el servidor (ECDH P-256 + AES-256-GCM); solo el servidor
  // lo abre, con la llave privada que sale de CLAVE_CIFRADO (no se guarda en ningún lado). Quien lea el almacenamiento
  // de la tableta no puede sacar los PIN ni las caras guardadas. Si cambia CLAVE_CIFRADO, lo guardado con la llave
  // anterior ya no se abre (los PIN tampoco sirven ya): queda en «Intentos fallidos».
  const llaveCola = () => { const e = crypto.createECDH('prime256v1'); e.setPrivateKey(Buffer.from(C.huella(Buffer.from('checador-cola-sin-conexion:v1')).slice(3), 'hex')); return e; };
  const llaveColaPublica = () => { try { return llaveCola().getPublicKey().toString('base64'); } catch { return null; } };
  function abrirSecreto(uid, s) {
    try {
      const e = Buffer.from(String(s?.e || ''), 'base64'), iv = Buffer.from(String(s?.iv || ''), 'base64'), c = Buffer.from(String(s?.c || ''), 'base64');
      if (e.length !== 65 || iv.length !== 12 || c.length < 17 || c.length > 200000) return null;
      const llave = crypto.createHash('sha256').update(Buffer.concat([llaveCola().computeSecret(e), e])).digest();
      const d = crypto.createDecipheriv('aes-256-gcm', llave, iv);
      d.setAAD(Buffer.from(uid)); d.setAuthTag(c.subarray(c.length - 16));
      const j = JSON.parse(Buffer.concat([d.update(c.subarray(0, c.length - 16)), d.final()]).toString('utf8'));
      return j && typeof j === 'object' ? j : null;
    } catch { return null; }
  }
  const rechazadasSinConexion = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of rechazadasSinConexion) if (v.expira <= t) rechazadasSinConexion.delete(k); }, 60 * 1000).unref();
  function rechazarSinConexion(req, res, { uid, tipo, a, status, error }) {
    const d = req.kiosco, b = req.body || {}, cod = /^\d{4}$/.test(String(b.codigo ?? '')) ? String(b.codigo) : null;
    const quien = cod ? db.prepare('SELECT id, nombre FROM main.personal WHERE codigo_checador = ?').get(cod) : null;
    const cuando = a || ahoraMexico(), detalle = `${TIPOS[tipo]} guardada sin internet${a ? '' : ' (hora desconocida)'} · ${error}`.slice(0, 200);
    const id = Number(db.prepare('INSERT INTO main.checador_intentos (dispositivo_id, personal_id, codigo, motivo, ip, momento_utc, fecha, hora, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.id, quien?.id ?? null, cod, 'Checada sin conexión rechazada', req.ipCliente || null, cuando.utc, cuando.fecha, cuando.hora, detalle).lastInsertRowid);
    const foto = fotoDe(b.foto);
    if (foto) {
      try {
        const archivo = path.join(cuando.fecha.slice(0, 7), `intento-${id}-${crypto.randomBytes(8).toString('hex')}.jpg.cifrado`);
        fs.mkdirSync(path.join(DIR_FOTOS, cuando.fecha.slice(0, 7)), { recursive: true, mode: 0o700 });
        C.escribirSeguro(path.join(DIR_FOTOS, archivo), C.cifrarArchivo(foto, contextoIntento(id)));
        db.prepare('UPDATE main.checador_intentos SET foto_archivo = ? WHERE id = ?').run(archivo, id);
      } catch (e) { console.error('[checador] foto de la checada sin conexión rechazada:', e.message); }
    }
    audit(null, quien?.id ?? null, 'checada sin conexión rechazada', `${quien ? quien.nombre : 'Código ' + (cod || 'inválido')}: ${TIPOS[tipo]}${a ? ` del ${cuando.fecha} a las ${cuando.hora.slice(0, 5)}` : ''}, guardada sin internet en el kiosco «${d.nombre}» · ${error} (queda en «Intentos fallidos»${foto ? ', con su foto' : ''})`);
    const cuerpo = { error, descartar: true };
    rechazadasSinConexion.set(d.id + ':' + uid, { status, cuerpo, expira: Date.now() + 30 * 60 * 1000 });
    return res.status(status).json(cuerpo);
  }
  app.post('/api/publico/kiosco/sin-conexion', kiosco, h((req, res) => {
    const b = req.body || {}, d = req.kiosco;
    const uid = String(b.uid || ''), tipo = String(b.tipo || ''), edad = Number(b.edad_ms);
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(uid) || !TIPOS[tipo]) return res.status(400).json({ error: 'Checada guardada inválida', descartar: true });
    const ya = rechazadasSinConexion.get(d.id + ':' + uid);
    if (ya && ya.expira > Date.now()) return res.status(ya.status).json(ya.cuerpo);
    if (!Number.isFinite(edad) || edad < 0 || edad > MAX_SIN_CONEXION_MS) return rechazarSinConexion(req, res, { uid, tipo, a: null, status: 400, error: 'La checada guardada es de hace más de 7 días o su hora no es válida: regístrala a mano con motivo' });
    const a = ahoraMexico(new Date(Date.now() - edad)), monotonica = b.monotonica === true;
    // El PIN (o la cara de quien entra con ella) llega cerrado con el candado de la cola; las tabletas con la versión
    // anterior todavía lo mandan en claro.
    let pin = String(b.pin ?? ''), rostro = null;
    if (b.secreto) {
      const s = abrirSecreto(uid, b.secreto);
      if (!s) return rechazarSinConexion(req, res, { uid, tipo, a, status: 409, error: 'No se pudo abrir lo que guardó la tableta (cambió la clave de seguridad del sistema): regístrala a mano con motivo' });
      pin = String(s.pin ?? ''); rostro = s.rostro && typeof s.rostro === 'object' ? s.rostro : null;
    }
    let p = null, bio = null;
    if (!pin && rostro) {
      // Entró con la cara y no había internet (2026-11-12): la tableta guardó su cara (cerrada) y se compara aquí, al
      // subir, contra su registro. Si no coincide o no pasó la prueba de vida, no se guarda: queda en «Intentos fallidos».
      p = conCara(String(b.codigo ?? ''));
      if (!p) return rechazarSinConexion(req, res, { uid, tipo, a, status: 409, error: 'Entró con la cara sin internet, pero no tiene la cara registrada (o ya no checa)' });
      const repetida = db.prepare('SELECT id, tipo, hora FROM main.checadas WHERE uid_kiosco = ?').get(uid);
      if (repetida) return res.json({ id: repetida.id, nombre: primerNombre(p.nombre), tipo: TIPOS[repetida.tipo], hora: repetida.hora.slice(0, 5), repetida: true });
      bio = app.locals.biometria.evaluar(p.id, rostro);
      if (bio?.resultado !== 'coincide') return rechazarSinConexion(req, res, { uid, tipo, a, status: 401, error: 'Entró con la cara sin internet y ' + ({ no_coincide: 'la cara no coincide', no_vivo: 'no pasó la prueba de vida (parece foto o pantalla)', sin_rostro: 'no se vio la cara' }[bio?.resultado] || 'no se pudo comprobar') });
    } else {
      const v = verificar(d, String(b.codigo ?? ''), pin);
      if (!v.p) {
        // Kiosco en pausa (429) o PIN bloqueado (423): no se descarta, la tableta la sube después.
        if (v.status === 429 || v.status === 423) return res.status(v.status).json({ error: v.error, descartar: false });
        return rechazarSinConexion(req, res, { uid, tipo, a, status: v.status, error: v.error });
      }
      p = v.p;
    }
    const previa = db.prepare('SELECT id, tipo, hora FROM main.checadas WHERE uid_kiosco = ?').get(uid);
    if (previa) return res.json({ id: previa.id, nombre: primerNombre(p.nombre), tipo: TIPOS[previa.tipo], hora: previa.hora.slice(0, 5), repetida: true });
    if (p.pin_temporal) return rechazarSinConexion(req, res, { uid, tipo, a, status: 409, error: 'Tenía PIN temporal: debe elegir su PIN con internet' });
    // La misma checada ya está (2026-11-12): la tableta la guardó «sin conexión» porque no le llegó la respuesta, pero el
    // servidor sí la había recibido. Misma persona y mismo botón a menos de 2 minutos: no se duplica.
    const cerca = db.prepare("SELECT id, hora FROM main.checadas WHERE personal_id = ? AND tipo = ? AND estado <> 'anulada' AND momento_utc BETWEEN ? AND ? ORDER BY id DESC LIMIT 1")
      .get(p.id, tipo, new Date(Date.parse(a.utc) - DUPLICADO_MS).toISOString(), new Date(Date.parse(a.utc) + DUPLICADO_MS).toISOString());
    if (cerca) return res.json({ id: cerca.id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: cerca.hora.slice(0, 5), repetida: true });
    const hd = typeof b.hora_dispositivo === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(b.hora_dispositivo) ? b.hora_dispositivo : null;
    const id = guardarChecada({ p, d, tipo, a, foto: fotoDe(b.foto), uid, ip: req.ipCliente || null, bio,
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
    res.json({ nombre: primerNombre(p.nombre), sucursal: req.kiosco.sucursal, utc: a.utc, tipos: TIPOS, sugerido: sugeridoPara(p.id, a), ultima: u ? { tipo: TIPOS[u.tipo], hora: u.hora.slice(0, 5) } : null, pin_temporal: !!p.pin_temporal, activo: !!(p.activo && p.checa) });
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
    if (previa) return res.json({ id: previa.id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: previa.hora.slice(0, 5), repetida: true, avisos: avisosDe(p.id, req.kiosco.id), servicios: serviciosDe(p.id, req.kiosco.id) });
    const foto = fotoDe(b.foto), ubicacion = ubicacionDe(b), a = ahoraMexico();
    const id = guardarChecada({ p, d, tipo, a, foto, origen: 'celular', ubicacion, ip: req.ipCliente || null });
    const est = db.prepare('SELECT estado, observaciones FROM main.checadas WHERE id = ?').get(id);
    res.status(201).json({ id, nombre: primerNombre(p.nombre), tipo: TIPOS[tipo], hora: a.hora.slice(0, 5), ...(est.estado === 'por_revisar' ? { por_revisar: est.observaciones } : {}), avisos: avisosDe(p.id, req.kiosco.id), servicios: serviciosDe(p.id, req.kiosco.id) });
  }));
  // ---------- Calendario de servicios en el kiosco (2026-11-11, Dirección: «un calendario para todos con las órdenes
  // de servicio, pero para imprimir que sí se verifiquen») ----------
  // Lo ve cualquiera frente al kiosco (sin identificarse): las órdenes de servicio de la sucursal del kiosco de hoy y los
  // próximos 6 días, con lo mismo que «Mis servicios» (sin precios ni teléfonos). Para imprimir la orden o su factura hay
  // que escribir código y PIN, y SOLO quien está asignado a esa orden (equipo de la orden o técnico) o el Supervisor de
  // la sucursal (Dirección, 2026-11-11: «sí, solo asignados»); cuenta como intento (con foto) si se equivoca, y la
  // impresión queda en la bitácora con su nombre.
  const CAL_DIAS = 7;
  app.get('/api/publico/kiosco/calendario', kiosco, h((req, res) => {
    const hoy = ahoraMexico().fecha, d0 = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || '')) ? String(req.query.desde) : hoy;
    const sumarDias = (f, k) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
    const desde = d0 < sumarDias(hoy, -7) ? sumarDias(hoy, -7) : d0 > sumarDias(hoy, 30) ? sumarDias(hoy, 30) : d0, hasta = sumarDias(desde, CAL_DIAS - 1);
    const filas = db.prepare(`SELECT l.id, l.created_at, l.estatus, l.folio_num, l.sucursal_id, l.fecha_servicio, l.hora_servicio, l.direccion, l.equipo, l.partidas_json, l.ejecucion,
        COALESCE(c.empresa_contacto, c.nombre, l.empresa_contacto, l.nombre) AS cliente, s.nombre AS servicio
      FROM main.leads l LEFT JOIN main.clientes c ON c.id = l.cliente_id LEFT JOIN main.catalogo_servicios s ON s.id = l.servicio_id
      WHERE l.estatus = 'ganado' AND l.sucursal_id = ? AND l.fecha_servicio BETWEEN ? AND ? ORDER BY l.fecha_servicio, COALESCE(l.hora_servicio, '99:99'), l.id LIMIT 300`).all(req.kiosco.sucursal_id, desde, hasta);
    const equipo = db.prepare("SELECT pe.nombre, op.papel FROM main.orden_personal op JOIN main.personal pe ON pe.id = op.personal_id WHERE op.lead_id = ? ORDER BY CASE op.papel WHEN 'responsable' THEN 0 WHEN 'operador' THEN 1 ELSE 2 END, pe.nombre");
    const folioLead = require('./sucursales').folioLead;
    res.json({ hoy, desde, hasta, ordenes: filas.map(l => ({ id: l.id, folio: folioLead(l), fecha: l.fecha_servicio, hora: l.hora_servicio || null, cliente: l.cliente || '', direccion: l.direccion || '', servicio: l.servicio || '',
      descripcion: textoServicio(l.partidas_json, l.servicio), unidad: l.equipo || '', estado: l.ejecucion === 'realizado' ? 'Realizada' : l.ejecucion === 'no_realizado' ? 'No realizada' : null,
      equipo: equipo.all(l.id).map(x => `${x.nombre} (${PAPELES[x.papel] || x.papel})`) })) });
  }));
  // Permiso para imprimir una orden del calendario: código y PIN de alguien activo de la sucursal del kiosco.
  app.post('/api/publico/kiosco/calendario-imprimir', kiosco, h((req, res) => {
    const codigo = String(req.body?.codigo ?? ''), v = verificar(req.kiosco, codigo, String(req.body?.pin ?? ''));
    if (!v.p) { const intento = registrarIntento(req, codigo, v); return res.status(v.status).json({ error: v.error, ...(intento ? { intento } : {}) }); }
    if (v.p.pin_temporal) return res.status(409).json({ error: 'Primero elige tu PIN: escribe tu código en la pantalla principal' });
    if (v.p.sucursal_id !== req.kiosco.sucursal_id) return res.status(403).json({ error: 'Solo el personal de esta sucursal imprime sus órdenes' });
    const l = db.prepare("SELECT id, tecnico_id FROM main.leads WHERE id = ? AND estatus = 'ganado' AND sucursal_id = ?").get(idDe(req.body?.orden), req.kiosco.sucursal_id);
    if (!l) return res.status(404).json({ error: 'Esa orden ya no está en el calendario' });
    const asignado = !!db.prepare('SELECT 1 FROM main.orden_personal WHERE lead_id = ? AND personal_id = ?').get(l.id, v.p.id) || (l.tecnico_id != null && l.tecnico_id === v.p.usuario_id);
    if (!asignado && v.p.puesto !== 'Supervisor') return res.status(403).json({ error: 'Solo quien está asignado a esta orden (o el supervisor) la puede imprimir. Pide a la oficina que te asignen.' });
    const factura = !!db.prepare("SELECT 1 FROM main.facturas WHERE lead_id = ? AND estatus = 'timbrada' AND pdf_path IS NOT NULL LIMIT 1").get(l.id);
    res.json({ nombre: primerNombre(v.p.nombre), permiso: permisoDocumento(l.id, v.p.id, req.kiosco.id), con_factura: factura });
  }));
  // Diagnóstico del kiosco (2026-11-11): cuando su vigilante lo recupera (pantalla vacía, no inició, recarga), lo
  // anota y lo manda aquí para verlo en los Logs del sistema. Solo texto corto; tope de 30 por kiosco por hora.
  const diagKiosco = new Map();
  app.post('/api/publico/kiosco/diagnostico', kiosco, h((req, res) => {
    const l = Array.isArray(req.body?.eventos) ? req.body.eventos.slice(-10) : null;
    if (!l) return res.status(400).json({ error: 'Faltan los eventos' });
    const t = Date.now(); let c = diagKiosco.get(req.kiosco.id); if (!c || c.reinicia <= t) { c = { n: 0, reinicia: t + 3600000 }; diagKiosco.set(req.kiosco.id, c); }
    for (const x of l) {
      if (c.n >= 30) break;
      const m = String(x?.m || '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} .,:;()«»\-_/]/gu, '').slice(0, 160), cuando = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(x?.t || '')) ? String(x.t).slice(0, 16).replace('T', ' ') + ' UTC' : '';
      if (!m) continue;
      // «Velocidad…»: lo que tardó la tableta en abrir y en checar (2026-11-13), en su propio renglón de los Logs.
      // 2026-11-13: cada renglón dice además cómo estaba la tableta (app o navegador, batería, cámara, pantalla) y lleva
      // la red y el equipo, para que se entienda solo (server/registro-guias.js arma la explicación al leerlo).
      const tableta = [/SaneadrenChecador/.test(req.get('user-agent') || '') ? 'app propia' : 'navegador', vigiaKioscos.estadoTexto(req.kiosco.id)].filter(Boolean).join(', ');
      c.n++; app.locals.registro?.anotar(req, m.startsWith('Velocidad') ? 'kiosco_velocidad' : m.startsWith('Hueco sin señal') ? 'kiosco_hueco' : 'kiosco_recuperado', { detalle: `Kiosco «${req.kiosco.nombre}»${req.kiosco.sucursal ? ' (' + req.kiosco.sucursal + ')' : ''}: ${m}${cuando ? ' · ' + cuando : ''} · tableta: ${tableta}` });
    }
    res.json({ ok: true });
  }));
  // Avisos (2026-11-11, server/avisos.js): «Enterado» con el token que trae cada aviso pendiente (un dispositivo, 15 min).
  const avisosDe = (personaId, dispositivoId) => app.locals.avisos?.pendientes(personaId, dispositivoId) || [];
  app.post('/api/publico/kiosco/enterado', kiosco, h((req, res) => app.locals.avisos.enteradoPublico(false)(req, res)));
  app.post('/api/publico/celular/enterado', celular, h((req, res) => app.locals.avisos.enteradoPublico(true)(req, res)));
  app.post('/api/publico/kiosco/orden', kiosco, h(imprimirOrden));
  app.post('/api/publico/kiosco/factura', kiosco, h(imprimirFactura));
  app.post('/api/publico/celular/orden', celular, h(imprimirOrden));
  app.post('/api/publico/celular/factura', celular, h(imprimirFactura));
  // Ver sus servicios desde el celular, sin checar: con su PIN (cuenta como intento si está mal, igual que al checar).
  app.post('/api/publico/celular/servicios', celular, h((req, res) => {
    const v = verificar(req.kiosco, req.persona.codigo_checador, String(req.body?.pin ?? ''));
    if (!v.p) return res.status(v.status).json({ error: v.error });
    if (v.p.pin_temporal) return res.status(409).json({ error: 'Primero elige tu PIN', codigo: 'PIN_TEMPORAL' });
    res.json({ avisos: avisosDe(v.p.id, req.kiosco.id), servicios: serviciosDe(v.p.id, req.kiosco.id) });
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
    res.json({ ...estadoDe(p), biometria: app.locals.biometria?.estado(p.id) || null, celular: cel, aviso_firmado: avisoFirmado, dias_fotos: DIAS_FOTOS, ultimas, puede: { editar: puede(req, 'personal.editar'), corregir: puede(req, 'asistencia.corregir'), ver: puede(req, 'asistencia.ver') } });
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
    // Etapa 6 (FLW-H08, SEC-04; regla aprobada por Dirección el 2026-11-12): la primera alta sigue con «Editar personal»;
    // reiniciar un PIN que ya existe pide «Corregir asistencia» (con el PIN nuevo se podía checar por otra persona).
    // Nunca para uno mismo, y sin ficha ligada tampoco. Dirección sí.
    if (p.pin_hash && !puede(req, 'asistencia.corregir')) return negar(res, 'Reiniciar el PIN de alguien que ya tiene uno lo hace quien corrige la asistencia (tu gerente o Dirección). Si solo lo bloqueó, usa «Desbloquear».');
    if (app.locals.personal.esPropio(req, res, p.id, 'dar el PIN del checador')) return;
    if (app.locals.personal.sinFichaLigada(req, res, 'dar PINes del checador')) return;
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
    // Etapa 6 (SEC-04): con el enlace se liga cualquier teléfono como si fuera el de la persona; lo da quien corrige la asistencia.
    if (!puede(req, 'personal.editar') || !puede(req, 'asistencia.corregir')) return negar(res, 'El enlace para checar desde el celular lo manda quien corrige la asistencia (tu gerente o Dirección)');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'mandar el enlace para checar desde el celular')) return;
    if (app.locals.personal.sinFichaLigada(req, res, 'mandar enlaces del celular')) return;
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
      FROM checador_dispositivos d LEFT JOIN main.sucursales s ON s.id = d.sucursal_id WHERE d.tipo = 'kiosco' AND d.eliminado_at IS NULL ORDER BY d.activo DESC, d.nombre`).all());
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

  // Eliminar un kiosco de la lista (2026-11-11, Dirección: «solo para administradores»). Si nunca se usó, se borra; si
  // tiene checadas o intentos, esos registros no se tocan (la bitácora no se borra) y el kiosco solo deja de salir en la
  // lista, con quién y cuándo lo eliminó. En los dos casos deja de poder checar al instante.
  app.delete('/api/asistencia/dispositivos/:id', h((req, res) => {
    if (!P.direccion(req)) return negar(res, 'Solo Dirección elimina kioscos');
    const d = db.prepare("SELECT * FROM checador_dispositivos WHERE id = ? AND tipo = 'kiosco' AND eliminado_at IS NULL").get(idDe(req.params.id));
    if (!d) return res.status(404).json({ error: 'Kiosco no encontrado' });
    const usado = db.prepare('SELECT EXISTS(SELECT 1 FROM main.checadas WHERE dispositivo_id = ?) OR EXISTS(SELECT 1 FROM main.checador_intentos WHERE dispositivo_id = ?) AS u').get(d.id, d.id).u;
    let borrado = false;
    if (!usado) { try { db.prepare('DELETE FROM main.checador_dispositivos WHERE id = ?').run(d.id); borrado = true; } catch { borrado = false; } }
    if (!borrado) db.prepare("UPDATE main.checador_dispositivos SET activo = 0, revocado_por = COALESCE(revocado_por, ?), revocado_at = COALESCE(revocado_at, datetime('now','localtime')), eliminado_por = ?, eliminado_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.nombre, req.usuarioSesion.nombre, d.id);
    for (const [k, v] of tickets) if (v.dispositivoId === d.id) tickets.delete(k);
    app.locals.auditoria?.registrar(req, 'checador_dispositivo', d.id, 'eliminar', `Kiosco «${d.nombre}»: eliminado de la lista${borrado ? ' (nunca se usó)' : ' (sus checadas e intentos se conservan)'}`);
    res.json({ ok: true, borrado });
  }));

  // ---------- Checadas: consulta y correcciones ----------
  const fechaOk = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
  app.get('/api/asistencia/checadas', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const fecha = req.query.fecha || ahoraMexico().fecha;
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    const pid = req.query.personal_id ? idDe(req.query.personal_id) : null;
    res.json(db.prepare(`SELECT c.id, c.personal_id, p.nombre, c.tipo, c.fecha, c.hora, c.origen, c.estado, c.observaciones, c.sin_conexion, c.foto_archivo IS NOT NULL AS tiene_foto, c.foto_borrada_at IS NOT NULL AS foto_borrada, c.lat, c.lon, c.precision_m, c.distancia_m, c.ip, c.biometria, c.distancia_rostro, c.registrado_por_nombre, d.nombre AS kiosco
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
  const intentosDe = (fecha, pid = null) => db.prepare(`SELECT i.id, i.personal_id, i.fecha, substr(i.hora, 1, 5) AS hora, i.codigo, i.motivo, i.detalle, i.ip, i.foto_archivo IS NOT NULL AS tiene_foto, i.foto_borrada_at IS NOT NULL AS foto_borrada,
      i.motivo IN (${MOTIVOS_CARA.map(() => '?').join(', ')}) AS es_cara, i.revisado_at, i.revisado_por_nombre,
      p.nombre AS persona, d.nombre AS kiosco FROM checador_intentos i LEFT JOIN personal p ON p.id = i.personal_id LEFT JOIN main.checador_dispositivos d ON d.id = i.dispositivo_id
      WHERE i.fecha = ? ${pid ? 'AND i.personal_id = ?' : ''} ORDER BY i.momento_utc DESC, i.id DESC`).all(...MOTIVOS_CARA, fecha, ...(pid ? [pid] : [])).map(i => ({ ...i, es_cara: !!i.es_cara }));
  app.get('/api/asistencia/intentos', h((req, res) => {
    if (!puede(req, 'asistencia.ver')) return negar(res, 'No tienes permiso para ver la asistencia');
    const fecha = req.query.fecha || ahoraMexico().fecha;
    if (!fechaOk(fecha)) return res.status(400).json({ error: 'Revisa la fecha' });
    res.json(intentosDe(fecha, req.query.personal_id ? idDe(req.query.personal_id) : null));
  }));
  // ---------- Aviso «la cara no coincidió» (2026-11-09, pedido de Dirección) ----------
  // Por persona y día (últimos 30 días): intentos del biométrico que no coincidieron o parecían foto/pantalla y que
  // nadie ha revisado, más sus checadas que siguen por revisar por la cara. Sale en Inicio (ficha «Personal») para
  // quien ve la asistencia, de sus sucursales (vistas). «No se vio la cara» no avisa: es la cámara, no un intento raro.
  function avisosCara() {
    const hoy = ahoraMexico().fecha, grupos = new Map();
    const de = (pid, fecha, nombre) => { const k = pid + '|' + fecha; if (!grupos.has(k)) grupos.set(k, { personal_id: pid, nombre, fecha, intentos: 0, checadas: 0, motivos: [], kioscos: [], hora: null }); return grupos.get(k); };
    for (const i of db.prepare(`SELECT i.personal_id, i.fecha, substr(i.hora, 1, 5) AS hora, i.motivo, d.nombre AS kiosco, p.nombre FROM checador_intentos i JOIN personal p ON p.id = i.personal_id
      LEFT JOIN main.checador_dispositivos d ON d.id = i.dispositivo_id WHERE i.fecha >= date(?, '-30 days') AND i.revisado_at IS NULL AND i.motivo IN (${MOTIVOS_CARA.map(() => '?').join(', ')}) ORDER BY i.momento_utc`).all(hoy, ...MOTIVOS_CARA)) {
      const g = de(i.personal_id, i.fecha, i.nombre); g.intentos++; g.hora = i.hora;
      if (!g.motivos.includes(i.motivo)) g.motivos.push(i.motivo);
      if (i.kiosco && !g.kioscos.includes(i.kiosco)) g.kioscos.push(i.kiosco);
    }
    for (const c of db.prepare(`SELECT c.personal_id, c.fecha, COUNT(*) n, p.nombre FROM checadas c JOIN personal p ON p.id = c.personal_id
      WHERE c.fecha >= date(?, '-30 days') AND c.estado = 'por_revisar' AND c.biometria IN ('no_coincide', 'no_vivo') GROUP BY c.personal_id, c.fecha`).all(hoy)) de(c.personal_id, c.fecha, c.nombre).checadas = c.n;
    return [...grupos.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.nombre.localeCompare(b.nombre));
  }
  // Marcar revisados los intentos de la cara de una persona en un día (quien corrige la asistencia). Sus checadas por
  // revisar se aceptan o anulan aparte, con su motivo.
  app.post('/api/asistencia/intentos/revisar', h((req, res) => {
    if (!puede(req, 'asistencia.corregir')) return negar(res, 'No tienes permiso para revisar la asistencia');
    const pid = idDe(req.body?.personal_id), fecha = String(req.body?.fecha || '');
    if (!pid || !fechaOk(fecha)) return res.status(400).json({ error: 'Indica la persona y el día' });
    const p = db.prepare('SELECT id, nombre FROM personal WHERE id = ?').get(pid); // de sus sucursales
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'revisar tus propios avisos del checador')) return;
    const ids = db.prepare(`SELECT id FROM checador_intentos WHERE personal_id = ? AND fecha = ? AND revisado_at IS NULL AND motivo IN (${MOTIVOS_CARA.map(() => '?').join(', ')})`).all(p.id, fecha, ...MOTIVOS_CARA).map(x => x.id);
    const marcar = db.prepare("UPDATE main.checador_intentos SET revisado_at = datetime('now','localtime'), revisado_por_nombre = ? WHERE id = ? AND revisado_at IS NULL");
    db.transaction(() => { for (const id of ids) marcar.run(req.usuarioSesion.nombre, id); })();
    if (ids.length) audit(req, p.id, 'revisó', `${p.nombre}: revisó ${ids.length} intento(s) en que la cara no coincidió (${fecha})`);
    res.json({ ok: true, revisados: ids.length });
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

  // guardarFoto: también la usa checar por WhatsApp (server/whatsapp.js) para la selfie.
  return { TIPOS, altaChecador, intentosDe, avisosCara, guardarFoto, kioscosCaidos: () => vigiaKioscos.caidos(), kioscosAtencion: () => vigiaKioscos.atencion() };
};
module.exports.pinDebil = pinDebil;
module.exports.TIPOS = TIPOS;
module.exports.distanciaM = distanciaM;
module.exports.distanciaTexto = distanciaTexto;
module.exports.SIGUIENTE = SIGUIENTE;
