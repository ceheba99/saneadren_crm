// Piezas de seguridad compartidas: contraseñas, política de contraseñas, correos permitidos,
// tokens de un solo uso y limitador de intentos.
const crypto = require('crypto');

// ---------- Contraseñas ("salt:hash" con scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
// Hash de relleno: cuando el usuario no existe se calcula igual un scrypt, para que el tiempo
// de respuesta no delate qué usuarios o correos existen.
const HASH_RELLENO = hashPassword(crypto.randomBytes(16).toString('hex'));
function verificarPassword(password, guardado) {
  if (typeof password !== 'string') return false;
  if (!guardado) { verificarPassword(password, HASH_RELLENO); return false; }
  if (guardado.includes(':')) {
    const [salt, hash] = guardado.split(':');
    const intento = crypto.scryptSync(password, salt, 64);
    const bufGuardado = Buffer.from(hash, 'hex');
    if (bufGuardado.length !== intento.length) return false;
    return crypto.timingSafeEqual(bufGuardado, intento);
  }
  // Contraseña heredada sin cifrar (se re-guarda cifrada al iniciar sesión).
  const a = Buffer.from(guardado), b = Buffer.from(password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const COMUNES = new Set(['1234567890', '0123456789', 'password123', 'contraseña1', 'contrasena1', 'qwerty12345', 'saneadren1', 'saneadren123', 'saneadren2026', 'admin12345', '1q2w3e4r5t']);
// Devuelve el motivo por el que la contraseña no es aceptable, o null si es válida.
function problemaPassword(password, { nombre = '', correo = '' } = {}) {
  if (typeof password !== 'string' || password.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (password.length > 128) return 'La contraseña admite máximo 128 caracteres';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) return 'La contraseña debe combinar letras y números';
  const minus = password.toLowerCase();
  if (COMUNES.has(minus)) return 'Esa contraseña es demasiado común; elige otra';
  const usuarioCorreo = correo.split('@')[0].toLowerCase();
  if ((usuarioCorreo.length >= 4 && minus.includes(usuarioCorreo)) || (nombre.trim().length >= 4 && minus.includes(nombre.trim().toLowerCase()))) {
    return 'La contraseña no debe contener tu nombre ni tu correo';
  }
  return null;
}

// ---------- Nombre visible del usuario ----------
// Solo letras, espacios y . ' - : el nombre se muestra en muchas pantallas, y así nunca puede
// llevar HTML o código (importante ahora que cualquiera con correo de la empresa puede registrarse).
function problemaNombre(nombre) {
  if (typeof nombre !== 'string') return 'Escribe tu nombre';
  const n = nombre.trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 60) return 'El nombre debe tener entre 3 y 60 caracteres';
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(n)) return 'El nombre solo puede llevar letras, espacios, punto, apóstrofo y guion';
  return null;
}

// ---------- Correos permitidos ----------
// Coincidencia EXACTA con el dominio (sin subdominios ni variantes) para que nadie de fuera
// pueda registrarse; el dominio se puede cambiar con DOMINIO_CORREO.
const DOMINIO = (process.env.DOMINIO_CORREO || 'saneadren.com.mx').toLowerCase();
function normalizarCorreo(correo) {
  return typeof correo === 'string' ? correo.trim().toLowerCase() : '';
}
function correoPermitido(correo) {
  const c = normalizarCorreo(correo);
  if (c.length > 254) return false;
  const [local, dominio, ...resto] = c.split('@');
  return resto.length === 0 && dominio === DOMINIO && /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/.test(local || '') && !local.includes('..');
}

// ---------- Tokens de un solo uso (verificación de correo / restablecer contraseña) ----------
// El enlace lleva el token; la base de datos solo guarda su hash SHA-256.
const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
function nuevoToken() { return crypto.randomBytes(32).toString('base64url'); }

// ---------- Limitador de intentos en memoria ----------
// limitador({ max, ventanaMs, clave: req => '...' }) → middleware que responde 429 al exceder.
function limitador({ max, ventanaMs, clave, mensaje }) {
  const registros = new Map();
  setInterval(() => { const ahora = Date.now(); for (const [k, v] of registros) if (v.reinicia <= ahora) registros.delete(k); }, ventanaMs).unref();
  return (req, res, next) => {
    const k = clave(req);
    const ahora = Date.now();
    let r = registros.get(k);
    if (!r || r.reinicia <= ahora) { r = { cuenta: 0, reinicia: ahora + ventanaMs }; registros.set(k, r); }
    r.cuenta += 1;
    if (r.cuenta > max) {
      const minutos = Math.ceil((r.reinicia - ahora) / 60000);
      return res.status(429).json({ error: mensaje || `Demasiados intentos. Intenta de nuevo en ${minutos} minuto(s).` });
    }
    next();
  };
}

// ---------- Encabezados de seguridad HTTP ----------
function encabezadosSeguridad(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // La interfaz usa manejadores onclick en línea, por eso script-src incluye 'unsafe-inline';
  // aun así se restringe de dónde se cargan scripts y a dónde puede conectarse la página.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
}

module.exports = { problemaNombre, hashPassword, verificarPassword, problemaPassword, normalizarCorreo, correoPermitido, DOMINIO, hashToken, nuevoToken, limitador, encabezadosSeguridad };
