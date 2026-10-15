// Zona horaria del negocio. En servidores como Render el reloj está en UTC (6 h adelante de
// México): sin esto, lo capturado después de las 6 pm quedaba con fecha del día siguiente.
// Va antes de abrir la base para que SQLite ('localtime') también la use. TZ en el entorno manda.
// En Windows no se toca: su CRT no entiende nombres tipo America/Mexico_City y ya usa la hora del equipo.
if (!process.env.TZ && process.platform !== 'win32') process.env.TZ = 'America/Mexico_City';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, normalizarTelefono } = require('./db');

const { limitarCampos, problemaNombre, hashPassword, verificarPassword, problemaPassword, normalizarCorreo, correoPermitido, DOMINIO, encabezadosSeguridad } = require('./seguridad');
const crearAlmacenSesiones = require('./sesiones');
const PORT = process.env.PORT || 3210;
// URL pública del CRM; se usa en los enlaces de los correos (nunca se toma del encabezado Host).
const URL_BASE = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const { hoyMexico } = require('./fechas');
const Importes = require('../public/importes.js'); // mismo cálculo de IVA que el navegador

const app = express();
// Detrás de un proxy (Nginx, Cloudflare, etc.) define TRUST_PROXY=1 para que req.ip sea la IP real
// del cliente; sin proxy NO se activa, porque cualquiera podría falsificar X-Forwarded-For.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.disable('x-powered-by');
app.use(encabezadosSeguridad);
// Las plantillas de Excel pueden traer hasta 1,000 renglones: esas rutas aceptan un cuerpo mayor.
// El parser global se salta las peticiones que ya se leyeron aquí.
app.use('/api/finanzas/importar', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', limitarCampos);
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Sesiones (token) ----------
// Antes, cada acción "solo admin" confiaba en un solicitante_id que mandaba el propio navegador:
// bastaba con adivinar o inspeccionar el id de un admin para colarlo en el body y saltarse el login
// por completo. Ahora, /login entrega un token opaco; ese token es lo único que identifica al usuario
// en cada petición (vía encabezado Authorization), y las rutas leen req.usuarioSesion en vez de creer
// cualquier id que venga en el body.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas de inactividad
// Se guardan en la base (solo el hash SHA-256 del token): sobreviven a reinicios del servidor y
// se pueden revocar todas las de un usuario (al cambiar contraseña o desactivarlo).
const sesiones = crearAlmacenSesiones(db);
function crearSesion(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  sesiones.set(token, { usuarioId, expira: Date.now() + SESSION_TTL_MS });
  return token;
}
function requireAuth(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  const sesion = token ? sesiones.get(token) : null;
  if (!sesion || sesion.expira < Date.now()) {
    if (sesion) sesiones.delete(token);
    return res.status(401).json({ error: 'Sesión inválida o expirada. Inicia sesión de nuevo.' });
  }
  const usuario = db.prepare('SELECT id, nombre, rol, debe_cambiar_password FROM usuarios WHERE id = ? AND activo = 1').get(sesion.usuarioId);
  if (!usuario) { sesiones.delete(token); return res.status(401).json({ error: 'Usuario no válido' }); }
  // Renueva la sesión mientras siga activa (se escribe como máximo una vez por minuto).
  if (sesion.expira - Date.now() < SESSION_TTL_MS - 60000) sesiones.set(token, { usuarioId: sesion.usuarioId, expira: Date.now() + SESSION_TTL_MS });
  if (usuario.debe_cambiar_password && !['/cambiar-password', '/logout'].includes(req.path)) {
    return res.status(403).json({ error: 'Debes cambiar tu contraseña antes de continuar.', codigo: 'CAMBIAR_PASSWORD' });
  }
  req.usuarioSesion = usuario;
  next();
}
// Protección básica contra fuerza bruta en /login: bloquea por combinación IP+usuario
// tras varios intentos fallidos seguidos. No sustituye un WAF, pero detiene los intentos triviales.
const intentosLogin = new Map(); // clave "ip|usuario" -> { fallos, bloqueadoHasta }
const LOGIN_MAX_INTENTOS = 6;
const LOGIN_BLOQUEO_MS = 5 * 60 * 1000;
// Limpieza periódica: sin esto el registro de intentos crece sin límite con nombres inventados.
setInterval(() => { const ahora = Date.now(); for (const [k, v] of intentosLogin) if (!v.bloqueadoHasta || v.bloqueadoHasta < ahora) intentosLogin.delete(k); }, LOGIN_BLOQUEO_MS).unref();
function limitarLogin(req, res, next) {
  const clave = req.ip + '|' + String(req.body?.nombre || '').toLowerCase();
  const estado = intentosLogin.get(clave);
  if (estado?.bloqueadoHasta && estado.bloqueadoHasta > Date.now()) {
    const minutos = Math.ceil((estado.bloqueadoHasta - Date.now()) / 60000);
    return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).` });
  }
  next();
}
function registrarLoginFallido(req) {
  if (typeof contarFalloPorIp === 'function') contarFalloPorIp(req);
  const clave = req.ip + '|' + String(req.body?.nombre || '').toLowerCase();
  const estado = intentosLogin.get(clave) || { fallos: 0, bloqueadoHasta: 0 };
  estado.fallos += 1;
  if (estado.fallos >= LOGIN_MAX_INTENTOS) { estado.bloqueadoHasta = Date.now() + LOGIN_BLOQUEO_MS; estado.fallos = 0; }
  intentosLogin.set(clave, estado);
}
function limpiarLoginFallidos(req) {
  intentosLogin.delete(req.ip + '|' + String(req.body?.nombre || '').toLowerCase());
}

// Envuelve cada handler para que una excepción (ej. FOREIGN KEY constraint) nunca tumbe el servidor completo.
function h(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`Error en ${req.method} ${req.originalUrl}:`, err.message);
      if (err.code && err.code.startsWith('SQLITE_CONSTRAINT')) {
        return res.status(400).json({ error: 'Datos inválidos (referencia inexistente o restricción de base de datos)' });
      }
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  };
}

function existe(tabla, id) {
  if (id === undefined || id === null || id === '') return true; // opcional, no se validó
  return !!db.prepare(`SELECT id FROM ${tabla} WHERE id = ?`).get(id);
}

// A partir de aquí, toda ruta /api/* requiere sesión válida — excepto /api/login, que es
// justamente donde se obtiene el token. Colocar esto antes de registrar el resto de las
// rutas asegura que ninguna quede expuesta sin querer (como pasaba antes con /api/usuarios).
// Salud del servicio (pública, sin datos del negocio): para Render o un monitor externo.
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, hoy: hoyMexico(), zona: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone, base_persistente: !!process.env.DB_PATH || !process.env.RENDER });
});
const RUTAS_PUBLICAS = new Set(['/salud', '/login', '/registro', '/verificar-correo', '/olvide-password', '/restablecer-password']);
require('./cuentas')(app, db, h, { sesiones, urlBase: URL_BASE });
app.use('/api', (req, res, next) => {
  if (RUTAS_PUBLICAS.has(req.path)) return next();
  requireAuth(req, res, next);
});

// Clientes sin duplicados: ID CLI-0001, teléfonos adicionales, revisión de parecidos y fusión.
const unicos = require('./clientes-unicos')(app, db, h);
require('./prospeccion')(app,db,h,unicos);
// Cuentas por cobrar y por pagar. Devuelve ganchos que usan las rutas de órdenes de abajo.
const finanzas = require('./finanzas')(app, db, h, unicos);
require('./tablero')(app, db, h, finanzas); // Resultados: panorama general
require('./compras')(app, db, h, finanzas); // Órdenes de compra (formato CM-F-03)
require('./carga-generador')(app, db, h, unicos); // Carga masiva del Generador (Excel por meses)

// ---------- Catálogos ----------
app.get('/api/usuarios', h((req, res) => {
  // El correo solo lo ve el administrador (para gestionar cuentas).
  const columnas = req.usuarioSesion.rol === 'admin' ? 'id, nombre, rol, activo, correo, correo_verificado' : 'id, nombre, rol, activo';
  res.json(db.prepare(`SELECT ${columnas} FROM usuarios WHERE activo = 1 ORDER BY nombre`).all());
}));

// ---------- Login ----------
// Además del bloqueo por usuario, un tope por IP: evita que un desconocido pruebe miles de
// nombres distintos (cada intento cuesta un cálculo de contraseña y frena al servidor).
// Solo cuentan los intentos FALLIDOS: así, aunque varias personas compartan IP (oficina, túnel
// sin TRUST_PROXY), sus inicios de sesión correctos nunca agotan el tope.
const fallosPorIp = new Map(); // ip -> { fallos, reinicia }
const FALLOS_IP_MAX = 40, FALLOS_IP_VENTANA_MS = 15 * 60 * 1000;
setInterval(() => { const ahora = Date.now(); for (const [k, v] of fallosPorIp) if (v.reinicia <= ahora) fallosPorIp.delete(k); }, FALLOS_IP_VENTANA_MS).unref();
function limitarLoginPorIp(req, res, next) {
  const r = fallosPorIp.get(req.ip);
  if (r && r.reinicia > Date.now() && r.fallos >= FALLOS_IP_MAX) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos desde esta conexión. Espera 15 minutos.' });
  }
  next();
}
function contarFalloPorIp(req) {
  const ahora = Date.now();
  let r = fallosPorIp.get(req.ip);
  if (!r || r.reinicia <= ahora) { r = { fallos: 0, reinicia: ahora + FALLOS_IP_VENTANA_MS }; fallosPorIp.set(req.ip, r); }
  r.fallos++;
}
if (process.env.RENDER && !process.env.TRUST_PROXY) console.warn('[aviso] En Render define TRUST_PROXY=1 para que los límites de intentos vean la IP real de cada persona.');
app.post('/api/login', limitarLoginPorIp, limitarLogin, h((req, res) => {
  const { nombre, password } = req.body;
  if (!nombre || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (typeof nombre !== 'string' || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  // Se puede entrar con el nombre de usuario o con el correo.
  const usuario = nombre.includes('@')
    ? db.prepare('SELECT * FROM usuarios WHERE correo = ? AND activo = 1').get(normalizarCorreo(nombre))
    : db.prepare('SELECT * FROM usuarios WHERE nombre = ? AND activo = 1').get(nombre.trim());
  if (!verificarPassword(password, usuario?.password)) {
    registrarLoginFallido(req);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  limpiarLoginFallidos(req);
  // La contraseña inicial de fábrica la conoce cualquiera: con ella NO se entrega sesión (si no,
  // quien la supiera podría entrar y fijar su propia contraseña con el cambio obligatorio).
  if (password === '1234') {
    return res.status(403).json({ error: usuario.correo && usuario.correo_verificado
      ? 'Esta cuenta tiene la contraseña inicial y quedó bloqueada. Usa "¿Olvidaste tu contraseña?" para crear una nueva.'
      : 'Esta cuenta tiene la contraseña inicial y quedó bloqueada. Pide al administrador que le asigne una contraseña nueva.' });
  }
  if (usuario.correo && !usuario.correo_verificado) return res.status(403).json({ error: 'Confirma tu correo con el enlace que te enviamos antes de iniciar sesión.' });
  // Migración transparente: si la contraseña seguía en texto plano, se re-guarda cifrada.
  if (!usuario.password.includes(':')) {
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hashPassword(password), usuario.id);
  }
  const debil = !!problemaPassword(password, { nombre: usuario.nombre, correo: usuario.correo || '' });
  if (debil && !usuario.debe_cambiar_password) db.prepare('UPDATE usuarios SET debe_cambiar_password = 1 WHERE id = ?').run(usuario.id);
  const token = crearSesion(usuario.id);
  res.json({ token, id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, cambiar_password: debil || !!usuario.debe_cambiar_password });
}));
app.post('/api/logout', h((req, res) => {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  if (token) sesiones.delete(token);
  res.json({ ok: true });
}));

// ---------- Cambiar mi contraseña (con sesión) ----------
// Cierra todas las demás sesiones del usuario y entrega un token nuevo para esta.
app.post('/api/cambiar-password', h((req, res) => {
  const { actual, nueva } = req.body;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuarioSesion.id);
  if (!verificarPassword(String(actual || ''), usuario.password)) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  const problema = problemaPassword(nueva, { nombre: usuario.nombre, correo: usuario.correo || '' });
  if (problema) return res.status(400).json({ error: problema });
  if (nueva === actual) return res.status(400).json({ error: 'La contraseña nueva debe ser distinta de la actual' });
  db.prepare('UPDATE usuarios SET password = ?, debe_cambiar_password = 0 WHERE id = ?').run(hashPassword(nueva), usuario.id);
  sesiones.revocarUsuario(usuario.id);
  res.json({ ok: true, token: crearSesion(usuario.id) });
}));

// ---------- Crear usuario (solo admin) ----------
app.post('/api/usuarios', h((req, res) => {
  const { nombre, password, rol } = req.body;
  if (req.usuarioSesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
  const problemaN = problemaNombre(nombre);
  if (problemaN) return res.status(400).json({ error: problemaN });
  const correo = req.body.correo ? normalizarCorreo(req.body.correo) : null;
  if (correo && !correoPermitido(correo)) return res.status(400).json({ error: `El correo debe ser @${DOMINIO}` });
  if (correo && db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo)) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
  const problema = problemaPassword(password, { nombre, correo: correo || '' });
  if (problema) return res.status(400).json({ error: problema });
  if (!['admin', 'ventas', 'atencion', 'tecnico'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

  const existente = db.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(nombre.trim());
  if (existente) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });

  // El correo que captura un admin se da por confirmado (el admin responde por él). Con «temporal», la persona
  // debe cambiar la contraseña al entrar la primera vez (así el administrador no conoce la definitiva).
  const temporal = req.body.temporal === true ? 1 : 0;
  const info = db.prepare('INSERT INTO usuarios (nombre, password, rol, correo, correo_verificado, debe_cambiar_password) VALUES (?, ?, ?, ?, ?, ?)').run(nombre.trim(), hashPassword(password), rol, correo, correo ? 1 : 0, temporal);
  res.status(201).json({ id: info.lastInsertRowid, nombre: nombre.trim(), rol, correo });
}));

app.get('/api/servicios', h((req, res) => {
  res.json(db.prepare('SELECT * FROM catalogo_servicios WHERE activo = 1 ORDER BY orden').all());
})); 
// ---------- Administrar un usuario (solo admin): nombre, correo y rol ----------
app.put('/api/usuarios/:id', h((req, res) => {
  if (soloAdmin(req, res, 'Solo un administrador puede administrar usuarios')) return;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const nombre = req.body.nombre !== undefined ? String(req.body.nombre).trim().replace(/\s+/g, ' ') : usuario.nombre;
  const problemaN = problemaNombre(nombre);
  if (problemaN) return res.status(400).json({ error: problemaN });
  if (db.prepare('SELECT id FROM usuarios WHERE lower(nombre) = lower(?) AND id <> ?').get(nombre, usuario.id)) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
  const rol = req.body.rol !== undefined ? req.body.rol : usuario.rol;
  if (!['admin', 'ventas', 'atencion', 'tecnico'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (usuario.rol === 'admin' && rol !== 'admin' && db.prepare("SELECT COUNT(*) c FROM usuarios WHERE rol = 'admin' AND activo = 1").get().c <= 1) {
    return res.status(400).json({ error: 'Debe quedar al menos un administrador' });
  }
  let correo = usuario.correo, verificado = usuario.correo_verificado;
  if (req.body.correo !== undefined) {
    correo = req.body.correo ? normalizarCorreo(req.body.correo) : null;
    if (correo && !correoPermitido(correo)) return res.status(400).json({ error: `El correo debe ser @${DOMINIO}` });
    if (correo && db.prepare('SELECT id FROM usuarios WHERE correo = ? AND id <> ?').get(correo, usuario.id)) return res.status(409).json({ error: 'Ese correo ya pertenece a otro usuario' });
    if (correo !== usuario.correo) verificado = correo ? 1 : 0; // el admin responde por el correo que captura
  }
  db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, correo = ?, correo_verificado = ? WHERE id = ?').run(nombre, rol, correo, verificado, usuario.id);
  if (rol !== usuario.rol) sesiones.revocarUsuario(usuario.id); // que el nuevo rol aplique de inmediato
  res.json(db.prepare('SELECT id, nombre, rol, correo, correo_verificado FROM usuarios WHERE id = ?').get(usuario.id));
}));

// Asignar una contraseña temporal (solo admin). El usuario deberá cambiarla al entrar y se
// cierran sus sesiones abiertas.
app.post('/api/usuarios/:id/password', h((req, res) => {
  if (soloAdmin(req, res, 'Solo un administrador puede asignar contraseñas')) return;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const problema = problemaPassword(req.body.password, { nombre: usuario.nombre, correo: usuario.correo || '' });
  if (problema) return res.status(400).json({ error: problema });
  const propio = usuario.id === req.usuarioSesion.id;
  db.prepare('UPDATE usuarios SET password = ?, debe_cambiar_password = ? WHERE id = ?').run(hashPassword(req.body.password), propio ? 0 : 1, usuario.id);
  if (!propio) sesiones.revocarUsuario(usuario.id);
  res.json({ ok: true });
}));

/* ---------- Eliminar usuario (soft delete, solo admin) ---------- */
app.delete('/api/usuarios/:id', h((req, res) => {
  if (req.usuarioSesion.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo un administrador puede eliminar usuarios' });
  }
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (usuario.id === req.usuarioSesion.id) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  if (usuario.rol === 'admin') {
    const totalAdmins = db.prepare('SELECT COUNT(*) c FROM usuarios WHERE rol = ? AND activo = 1').get('admin').c;
    if (totalAdmins <= 1) {
      return res.status(400).json({ error: 'No puedes eliminar el último administrador del sistema' });
    }
  }
  /* Soft delete: marcar como inactivo en lugar de borrar físicamente.
     Esto preserva el historial de quién creó/atendió cada lead. */
  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(req.params.id);
  sesiones.revocarUsuario(Number(req.params.id));
  /* Opcional: reasignar leads abiertos a un usuario "Sin asignar" o al admin.
  db.prepare('UPDATE leads SET responsable_id = ? WHERE responsable_id = ? AND estatus = ?')
    .run(solicitante_id, req.params.id, 'abierto'); */
  res.json({ ok: true, id: Number(req.params.id), nombre: usuario.nombre });
}));

// ---------- Permisos de catálogos ----------
// Todos: editar la descripción de los servicios, tipos de cliente y canales ("cómo se enteró"),
// y reordenar servicios y canales. Solo admin: dar de alta / eliminar servicios, la recurrencia
// de recompra y todo lo de usuarios y respaldos.
const esAdmin = req => req.usuarioSesion.rol === 'admin';
const soloAdmin = (req, res, mensaje) => { if (esAdmin(req)) return false; res.status(403).json({ error: mensaje }); return true; };

// Reordenar un catálogo: recibe la lista completa de ids en el nuevo orden.
function reordenar(tabla, req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
  const actuales = db.prepare(`SELECT id FROM ${tabla}${tabla === 'catalogo_servicios' ? ' WHERE activo = 1' : ''}`).all().map(x => x.id);
  if (!ids || ids.length !== actuales.length || new Set(ids).size !== ids.length || !ids.every(id => actuales.includes(id))) {
    return res.status(400).json({ error: 'La lista no coincide con el catálogo actual; recarga la página e inténtalo de nuevo' });
  }
  const upd = db.prepare(`UPDATE ${tabla} SET orden = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id, i) => upd.run(i + 1, id)))();
  res.json({ ok: true });
}
app.put('/api/servicios/orden', h((req, res) => reordenar('catalogo_servicios', req, res)));
app.put('/api/canales/orden', h((req, res) => reordenar('canales', req, res)));

// Editar un servicio: la descripción la puede cambiar cualquiera; la recurrencia solo un admin.
app.put('/api/servicios/:id', h((req, res) => {
  const { dias_recurrencia } = req.body;
  if (dias_recurrencia !== undefined && soloAdmin(req, res, 'Solo un administrador puede cambiar la recurrencia de un servicio')) return;
  const servicio = db.prepare('SELECT * FROM catalogo_servicios WHERE id = ? AND activo = 1').get(req.params.id);
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  let dias = null;
  if (dias_recurrencia !== null && dias_recurrencia !== '' && dias_recurrencia !== undefined) {
    dias = Number(dias_recurrencia);
    if (!Number.isInteger(dias) || dias < 1 || dias > 3650) return res.status(400).json({ error: 'Los días de recurrencia deben ser un número entero entre 1 y 3650 (o vacío para servicio de una sola vez)' });
  }
  if (req.body.descripcion !== undefined && (typeof req.body.descripcion !== 'string' || req.body.descripcion.length > 10000)) return res.status(400).json({ error: 'La descripción debe ser texto de hasta 10000 caracteres' });
  db.prepare('UPDATE catalogo_servicios SET dias_recurrencia = ?, descripcion = ? WHERE id = ?').run(dias_recurrencia === undefined ? servicio.dias_recurrencia : dias, req.body.descripcion === undefined ? servicio.descripcion : req.body.descripcion.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(req.params.id));
}));

// Eliminar un servicio del catálogo (solo admin). Es una baja lógica: las cotizaciones y
// órdenes que ya lo usan lo conservan; solo deja de ofrecerse en las nuevas.
app.delete('/api/servicios/:id', h((req, res) => {
  if (soloAdmin(req, res, 'Solo un administrador puede eliminar servicios')) return;
  const servicio = db.prepare('SELECT * FROM catalogo_servicios WHERE id = ? AND activo = 1').get(req.params.id);
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  if (db.prepare('SELECT COUNT(*) c FROM catalogo_servicios WHERE activo = 1').get().c <= 1) return res.status(400).json({ error: 'Debe quedar al menos un servicio en el catálogo' });
  db.prepare('UPDATE catalogo_servicios SET activo = 0 WHERE id = ?').run(servicio.id);
  res.json({ ok: true, id: servicio.id, nombre: servicio.nombre });
}));

// Agregar un servicio nuevo al catálogo (solo admin). Si existía y se había eliminado, se reactiva.
app.post('/api/servicios', h((req, res) => {
  const { nombre, dias_recurrencia } = req.body;
  if (soloAdmin(req, res, 'Solo un administrador puede agregar servicios')) return;
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 120) return res.status(400).json({ error: 'El nombre del servicio es requerido (máximo 120 caracteres)' });
  const existente = db.prepare('SELECT id, activo FROM catalogo_servicios WHERE nombre = ?').get(nombre.trim());
  if (existente?.activo) return res.status(409).json({ error: 'Ya existe un servicio con ese nombre' });
  let dias = null;
  if (dias_recurrencia !== null && dias_recurrencia !== '' && dias_recurrencia !== undefined) {
    dias = Number(dias_recurrencia);
    if (!Number.isInteger(dias) || dias < 1 || dias > 3650) return res.status(400).json({ error: 'Los días de recurrencia deben ser un número entero entre 1 y 3650 (o vacío para servicio de una sola vez)' });
  }
  const orden = (db.prepare('SELECT MAX(orden) m FROM catalogo_servicios').get().m || 0) + 1;
  if (req.body.descripcion !== undefined && (typeof req.body.descripcion !== 'string' || req.body.descripcion.length > 10000)) return res.status(400).json({ error: 'La descripción debe ser texto de hasta 10000 caracteres' });
  if (existente) {
    db.prepare('UPDATE catalogo_servicios SET activo = 1, orden = ?, dias_recurrencia = ?, descripcion = ? WHERE id = ?').run(orden, dias, (req.body.descripcion || '').trim(), existente.id);
    return res.status(201).json(db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(existente.id));
  }
  const info = db.prepare('INSERT INTO catalogo_servicios (nombre, orden, dias_recurrencia, descripcion) VALUES (?, ?, ?, ?)').run(nombre.trim(), orden, dias, (req.body.descripcion || '').trim());
  res.status(201).json(db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(info.lastInsertRowid));
}));

app.get('/api/tipos-cliente', h((req,res)=>res.json(db.prepare('SELECT * FROM tipos_cliente ORDER BY nombre').all())));
app.post('/api/tipos-cliente', h((req,res)=>{
  const nombre=typeof req.body.nombre==='string'?req.body.nombre.trim():'';
  if(!nombre || nombre.length>80)return res.status(400).json({error:'Escribe un nombre de hasta 80 caracteres'});
  if(db.prepare('SELECT clave FROM tipos_cliente WHERE nombre = ?').get(nombre))return res.status(409).json({error:'Ya existe ese tipo de cliente'});
  const clave=crypto.randomUUID();db.prepare('INSERT INTO tipos_cliente (clave,nombre) VALUES (?,?)').run(clave,nombre);
  res.status(201).json({clave,nombre});
}));
app.put('/api/tipos-cliente/:clave', h((req,res)=>{
  const nombre=typeof req.body.nombre==='string'?req.body.nombre.trim():'';
  if(!nombre || nombre.length>80)return res.status(400).json({error:'Escribe un nombre de hasta 80 caracteres'});
  if(!db.prepare('SELECT clave FROM tipos_cliente WHERE clave = ?').get(req.params.clave))return res.status(404).json({error:'Tipo no encontrado'});
  if(db.prepare('SELECT clave FROM tipos_cliente WHERE nombre = ? AND clave <> ?').get(nombre,req.params.clave))return res.status(409).json({error:'Ya existe ese tipo de cliente'});
  db.prepare('UPDATE tipos_cliente SET nombre = ? WHERE clave = ?').run(nombre,req.params.clave);res.json({clave:req.params.clave,nombre});
}));
app.get('/api/canales', h((req, res) => {
  res.json(db.prepare('SELECT * FROM canales ORDER BY orden').all());
}));

// Renombrar un canal ("cómo se enteró de nosotros"). Los contactos conservan su canal.
app.put('/api/canales/:id', h((req, res) => {
  const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
  if (!nombre || nombre.length > 80) return res.status(400).json({ error: 'Escribe un nombre de hasta 80 caracteres' });
  if (!db.prepare('SELECT id FROM canales WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Canal no encontrado' });
  if (db.prepare('SELECT id FROM canales WHERE nombre = ? AND id <> ?').get(nombre, req.params.id)) return res.status(409).json({ error: 'Ya existe un canal con ese nombre' });
  db.prepare('UPDATE canales SET nombre = ? WHERE id = ?').run(nombre, req.params.id);
  res.json(db.prepare('SELECT * FROM canales WHERE id = ?').get(req.params.id));
}));

// Agregar un canal nuevo (cualquier usuario).
app.post('/api/canales', h((req, res) => {
  const { nombre } = req.body;
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 80) return res.status(400).json({ error: 'El nombre del canal es requerido (máximo 80 caracteres)' });
  const existente = db.prepare('SELECT id FROM canales WHERE nombre = ?').get(nombre.trim());
  if (existente) return res.status(409).json({ error: 'Ya existe un canal con ese nombre' });
  const orden = (db.prepare('SELECT MAX(orden) m FROM canales').get().m || 0) + 1;
  const info = db.prepare('INSERT INTO canales (nombre, orden) VALUES (?, ?)').run(nombre.trim(), orden);
  res.status(201).json(db.prepare('SELECT * FROM canales WHERE id = ?').get(info.lastInsertRowid));
}));

// ---------- Verificar duplicado por teléfono (búsqueda en vivo) ----------
// Devuelve el cliente (si existe) + sus solicitudes, para distinguir entre
// "ya tiene una solicitud abierta" (bloquea) y "cliente recurrente, todo cerrado" (permite nueva solicitud).
app.get('/api/leads/buscar-telefono/:telefono', h((req, res) => {
  const norm = normalizarTelefono(req.params.telefono);
  if (norm.length < 8) return res.json({ cliente: null, solicitudes: [] });
  const cliente = unicos.porTelefono(norm);
  if (!cliente) return res.json({ cliente: null, solicitudes: [] });
  const solicitudes = db.prepare(`
    SELECT l.*, s.nombre AS servicio_nombre, u.nombre AS responsable_nombre, ca.nombre AS canal_nombre
    FROM leads l
    LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
    LEFT JOIN usuarios u ON u.id = l.responsable_id
    LEFT JOIN canales ca ON ca.id = l.canal_id
    WHERE l.cliente_id = ?
    ORDER BY l.created_at DESC
  `).all(cliente.id);
  res.json({ cliente, solicitudes, tiene_abierta: solicitudes.some(s => s.estatus === 'abierto') });
}));

// ---------- Listado / tablero ----------
app.get('/api/leads', h((req, res) => {
  const { etapa, responsable_id, estatus, q, desde, hasta, urgente } = req.query;
  let sql = `
    SELECT l.*, s.nombre AS servicio_nombre, u.nombre AS responsable_nombre, ca.nombre AS canal_nombre,
      (SELECT COUNT(*) FROM historial h WHERE h.lead_id = l.id AND h.tipo='alerta' AND h.resuelta=0 AND h.fecha_alerta <= datetime('now','localtime')) AS alertas_pendientes,
      (SELECT COUNT(*) FROM leads l2 WHERE l2.cliente_id = l.cliente_id) AS veces_contratado
    FROM leads l
    LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
    LEFT JOIN usuarios u ON u.id = l.responsable_id
    LEFT JOIN canales ca ON ca.id = l.canal_id
    WHERE 1=1
  `;
  const params = [];
  if (etapa) { sql += ' AND l.etapa = ?'; params.push(etapa); }
  if (responsable_id) { sql += ' AND l.responsable_id = ?'; params.push(responsable_id); }
  if (estatus) { sql += ' AND l.estatus = ?'; params.push(estatus); }
  if (q) { sql += ' AND (l.nombre LIKE ? OR l.telefono LIKE ? OR CAST(l.cliente_id AS TEXT) = ?)'; params.push(`%${q}%`, `%${q}%`, q); }
  if (desde) { sql += " AND date(l.created_at) >= date(?)"; params.push(desde); }
  if (hasta) { sql += " AND date(l.created_at) <= date(?)"; params.push(hasta); }
  if (urgente === '1') { sql += ' AND l.urgente = 1'; }
  sql += ' ORDER BY l.urgente DESC, l.updated_at DESC';
  res.json(db.prepare(sql).all(...params));
}));

// ---------- Detalle del lead y solicitudes relacionadas ----------
app.get('/api/leads/:id', h((req, res) => {
  const lead = db.prepare(`
    SELECT l.*, s.nombre AS servicio_nombre, u.nombre AS responsable_nombre, ca.nombre AS canal_nombre
    FROM leads l
    LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
    LEFT JOIN usuarios u ON u.id = l.responsable_id
    LEFT JOIN canales ca ON ca.id = l.canal_id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Cotización no encontrada' });
  const otras_solicitudes = lead.cliente_id ? db.prepare(`
    SELECT l.id, l.etapa, l.estatus, l.created_at, l.updated_at, l.valor, l.notas_iniciales, s.nombre AS servicio_nombre
    FROM leads l LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
    WHERE l.cliente_id = ? AND l.id != ?
    ORDER BY l.created_at DESC
  `).all(lead.cliente_id, lead.id) : [];
  const primer_contacto = lead.cliente_id ? db.prepare('SELECT MIN(created_at) AS f FROM leads WHERE cliente_id = ?').get(lead.cliente_id).f : lead.created_at;
  const valorCliente = lead.cliente_id ? db.prepare(`
    SELECT
      COALESCE(SUM(valor), 0) AS valor_cotizado_total,
      COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN valor ELSE 0 END), 0) AS valor_ganado_total
    FROM leads WHERE cliente_id = ?
  `).get(lead.cliente_id) : { valor_cotizado_total: 0, valor_ganado_total: 0 };
  const historial = db.prepare('SELECT * FROM historial WHERE lead_id = ? ORDER BY created_at DESC, id DESC').all(lead.id);
  res.json({
    ...lead, otras_solicitudes, historial,
    veces_contratado: otras_solicitudes.length + 1,
    primer_contacto,
    valor_cotizado_total: valorCliente.valor_cotizado_total,
    valor_ganado_total: valorCliente.valor_ganado_total
  });
}));

// ---------- Alta rápida de cotización / servicio ----------
function fechaServicioValida(valor){
  if(valor===null||valor===undefined||valor==='')return true;
  if(typeof valor!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(valor))return false;
  const fecha=new Date(valor+'T00:00:00Z');return !isNaN(fecha)&&fecha.toISOString().slice(0,10)===valor;
}
function validarRegistro(req,res,next){
  if(!fechaServicioValida(req.body.fecha_servicio))return res.status(400).json({error:'La fecha del servicio no es válida'});
  if(req.body.valor!==undefined&&req.body.valor!==null&&(typeof req.body.valor!=='number'||!Number.isFinite(req.body.valor)||req.body.valor<0||req.body.valor>1e12))return res.status(400).json({error:'El importe debe ser un número válido entre 0 y 1 billón'});
  if(req.body.etapa!==undefined&&(!Number.isInteger(req.body.etapa)||req.body.etapa<1||req.body.etapa>4))return res.status(400).json({error:'Etapa inválida'});
  next();
}
// Partidas e IVA: el servidor siempre recalcula valor (subtotal sin IVA) e iva_cent con
// public/importes.js; nunca toma los que mande el navegador. Si no llega el modo de IVA se
// conserva el guardado (PUT) o queda "por definir" (POST), como antes de existir el IVA.
// Deja en req.totalNuevoCent el total con IVA cuando recalcula.
function validarPartidas(req,res,next){
  delete req.body.iva_cent;
  const tocaIva=req.body.iva_modo!==undefined||req.body.iva_tasa!==undefined;
  if(req.body.partidas_json===undefined&&!tocaIva)return next();
  const guardado=req.params.id?db.prepare('SELECT partidas_json, iva_modo, iva_tasa FROM leads WHERE id = ?').get(req.params.id):null;
  if(req.params.id&&!guardado)return res.status(404).json({error:'Cotización no encontrada'});
  let items;
  if(req.body.partidas_json!==undefined){
    try{items=JSON.parse(req.body.partidas_json);}catch{return res.status(400).json({error:'Partidas inválidas'});}
    if(!Array.isArray(items)||!items.length||items.length>100||items.some(i=>!i||typeof i.servicio!=='string'||!i.servicio.trim()||typeof i.leyenda!=='string'||i.leyenda.length>10000||typeof i.importe!=='number'||!Number.isFinite(i.importe)||i.importe<0||i.importe>1e12))return res.status(400).json({error:'Revisa servicios, descripciones e importes'});
    if(items.some(i=>!db.prepare('SELECT id FROM catalogo_servicios WHERE nombre = ?').get(i.servicio)))return res.status(400).json({error:'Todas las partidas deben tener un servicio del catálogo'});
    const primero=db.prepare('SELECT id FROM catalogo_servicios WHERE nombre = ?').get(items[0].servicio);
    if(!primero)return res.status(400).json({error:'Selecciona un servicio del catálogo'});
    // Cantidad × precio unitario (opcionales): el importe de la partida lo calcula el servidor.
    for(const i of items){
      if(i.cantidad===undefined&&i.precio===undefined)continue;
      const cantidad=i.cantidad===undefined?1:i.cantidad,precio=i.precio===undefined?i.importe:i.precio;
      if(typeof cantidad!=='number'||!Number.isFinite(cantidad)||cantidad<=0||cantidad>1e6||Math.round(cantidad*1000)!==cantidad*1000)return res.status(400).json({error:'La cantidad debe ser mayor a 0 (hasta 3 decimales)'});
      if(typeof precio!=='number'||!Number.isFinite(precio)||precio<0||precio>1e12)return res.status(400).json({error:'Revisa el precio unitario'});
      i.cantidad=cantidad;i.precio=precio;i.importe=Importes.importeDe(cantidad,precio);
      if(i.importe>1e12)return res.status(400).json({error:'El importe de una partida es demasiado alto'});
    }
    // Ninguna cotización u orden sale en ceros: cada servicio lleva su precio.
    if(items.some(i=>!(Importes.importeDe(1,i.importe)>0)))return res.status(400).json({error:'Ningún servicio puede ir en $0.00: escribe su precio'});
    req.body.servicio_id=primero.id;req.body.partidas_json=JSON.stringify(items);
  }else{
    // Solo cambia el IVA: se recalcula con las partidas guardadas.
    try{items=JSON.parse(guardado?.partidas_json||'null');}catch{items=null;}
    if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'Edita las partidas de la cotización para indicar su IVA'});
  }
  // Al duplicar una orden sin decir el IVA (p. ej. pestaña con la versión anterior) se hereda el de la original.
  const original=!req.params.id&&req.body.duplicado_de&&!tocaIva?db.prepare('SELECT iva_modo, iva_tasa FROM leads WHERE id = ?').get(req.body.duplicado_de):null;
  let modo=req.body.iva_modo!==undefined?req.body.iva_modo:(guardado?.iva_modo??original?.iva_modo??null);
  if(modo==='')modo=null;
  if(modo!==null&&!Importes.MODOS.includes(modo))return res.status(400).json({error:'Indica si los importes son más IVA, con IVA incluido o sin IVA'});
  if(modo===null&&guardado?.iva_modo)return res.status(400).json({error:'El IVA de este registro ya está indicado; no puede volver a quedar por definir'});
  let tasa=null;
  if(modo==='sin_iva')tasa=0; // sin IVA: tasa 0, sin importar lo que se mande
  else if(modo!==null){
    // La tasa guardada de un registro "sin IVA" es 0: al pasar a otro modo se usa la tasa normal.
    tasa=req.body.iva_tasa!==undefined&&req.body.iva_tasa!==null&&req.body.iva_tasa!==''?Number(req.body.iva_tasa):((guardado?.iva_tasa||original?.iva_tasa)||Importes.TASA_DEFAULT);
    if(!Importes.TASAS_PERMITIDAS.includes(tasa))return res.status(400).json({error:'Tasa de IVA no permitida (solo '+Importes.TASAS_PERMITIDAS.join(', ')+' %)'});
  }else if(req.body.iva_tasa!==undefined&&req.body.iva_tasa!==null&&req.body.iva_tasa!=='')return res.status(400).json({error:'Indica si los importes son más IVA, con IVA incluido o sin IVA'});
  const r=Importes.calcular(items,modo,tasa);
  if(modo!==null&&r.total_cent>Importes.TOPE_CENT)return res.status(400).json({error:'El total del documento no puede pasar de $100,000,000.00'});
  req.body.valor=r.subtotal_cent/100;req.body.iva_modo=modo;req.body.iva_tasa=tasa;req.body.iva_cent=r.iva_cent;
  req.totalNuevoCent=r.total_cent;
  next();
}
// Equipo / operador / observaciones de la orden de servicio: texto libre con tope de longitud.
const LIMITES_ORDEN = { equipo: 200, operador: 300, observaciones: 3000, proyecto: 200, manifiestos: 200, tiros: 60, notas_cotizacion: 3000 };
function validarDatosOrden(body) {
  for (const [campo, max] of Object.entries(LIMITES_ORDEN)) {
    if (body[campo] === undefined || body[campo] === null) continue;
    if (typeof body[campo] !== 'string') return `El campo ${campo} no es válido`;
    if (body[campo].length > max) return `El campo ${campo} admite máximo ${max} caracteres`;
  }
  return null;
}
const textoOrden = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
app.post('/api/leads', validarPartidas, validarRegistro, h((req, res) => {
  let { telefono, nombre, empresa_contacto, direccion } = req.body;
  const { cliente_id, canal_id, servicio_id, notas_iniciales, responsable_id, forzar_duplicado, valor, fecha_servicio, correo, giro, urgente } = req.body;
  const fechaCotizacionFinal = req.body.fecha_cotizacion || hoyMexico();
  if (req.body.fecha_cotizacion && (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCotizacionFinal) || Number.isNaN(Date.parse(fechaCotizacionFinal + 'T00:00:00Z')) || fechaCotizacionFinal > hoyMexico()))
    return res.status(400).json({ error: 'La fecha de la cotización no es válida o es futura' });
  const creado_por = req.usuarioSesion.nombre; // nunca se confía en el valor que mande el navegador
  if (!validarCorreo(correo)) return res.status(400).json({ error: 'El correo electrónico no es válido' });
  if (giro && !tipoClienteValido(giro)) return res.status(400).json({ error: 'Giro inválido' });
  // «Es el mismo cliente»: el teléfono nuevo se agrega a ese cliente (agregar_telefono_a) en lugar de crear otro.
  const agregarTelA = req.body.agregar_telefono_a ? Number(req.body.agregar_telefono_a) : null;
  const idElegido = agregarTelA || cliente_id;
  const contactoElegido = idElegido ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(idElegido) : null;
  if (idElegido && !contactoElegido) return res.status(404).json({error:'Contacto no encontrado'});
  if (contactoElegido) {
    if (!agregarTelA) telefono = contactoElegido.telefono;
    nombre = contactoElegido.nombre; empresa_contacto = contactoElegido.empresa_contacto;
  }
  if (agregarTelA) {
    const dueño = unicos.porTelefono(telefono);
    if (dueño && dueño.id !== agregarTelA) return res.status(409).json({ error: `Ese teléfono ya es de ${unicos.folioCliente(dueño.id)} · ${dueño.empresa_contacto || dueño.nombre}` });
  }
  if (!responsable_id || !db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').get(responsable_id)) return res.status(400).json({error:'Selecciona un responsable activo'});
  let { estatus } = req.body;
  if (!telefono) return res.status(400).json({ error: 'Teléfono requerido' });
  const norm = normalizarTelefono(telefono);
  if (norm.length !== 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del contacto es requerido' });
  if (!contactoElegido) {
    const mal = (!agregarTelA && unicos.telefonoFalso(norm) ? 'Ese teléfono no parece real (' + norm + ')' : null) || unicos.problemaNombreCliente(nombre, 'El nombre') || (empresa_contacto && String(empresa_contacto).trim() ? unicos.problemaNombreCliente(empresa_contacto, 'La empresa') : null);
    if (mal) return res.status(400).json({ error: mal });
  } else if (agregarTelA && unicos.telefonoFalso(norm)) return res.status(400).json({ error: 'Ese teléfono no parece real (' + norm + ')' });
  if (!direccion || !direccion.trim()) return res.status(400).json({ error: 'La dirección es requerida' });
  if (valor !== undefined && valor !== null && (isNaN(Number(valor)) || Number(valor) < 0)) {
    return res.status(400).json({ error: 'El valor debe ser un número mayor o igual a 0' });
  }
  // Permite registrar un servicio ya confirmado directamente (estatus 'ganado') (p. ej. una recompra de un cliente
  // existente) sin que pase por el pipeline de leads. Por defecto sigue siendo 'abierto'.
  if (estatus !== undefined && !['abierto', 'ganado'].includes(estatus)) {
    return res.status(400).json({ error: 'Estatus inválido: use "abierto" para cotizaciones o "ganado" para servicios directos' });
  }
  if (req.body.partidas_json === undefined) return res.status(400).json({ error: 'Agrega al menos un servicio con su precio' });
  if (!servicio_id) return res.status(400).json({error:'Selecciona un servicio para crear la cotización'});
  // Vigencia de la cotización (solo cotizaciones): si aplica y hasta qué fecha.
  const incluyeVigencia = estatus === 'ganado' ? 1 : (req.body.incluye_vigencia === undefined ? 1 : (req.body.incluye_vigencia ? 1 : 0));
  const vigenciaHasta = incluyeVigencia && estatus !== 'ganado' ? (req.body.vigencia_hasta || null) : null;
  if (vigenciaHasta && (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaHasta) || Number.isNaN(Date.parse(vigenciaHasta + 'T00:00:00Z')) || vigenciaHasta < fechaCotizacionFinal)) return res.status(400).json({ error: 'La vigencia debe ser una fecha igual o posterior a la fecha de la cotización' });
  let fechaServicioFinal = fecha_servicio || null;
  if (estatus === 'ganado') {
    if (valor === null || valor === undefined || valor === '') {
      return res.status(400).json({ error: 'Se requiere el costo del servicio para registrarlo directamente como ganado' });
    }
    if (!fechaServicioFinal) return res.status(400).json({error:'Indica la fecha acordada del servicio'});
  }
  estatus = estatus || 'abierto';

  if (!existe('canales', canal_id)) return res.status(400).json({ error: 'El canal indicado no existe' });
  if (!existe('catalogo_servicios', servicio_id)) return res.status(400).json({ error: 'El servicio indicado no existe' });
  if (!existe('usuarios', responsable_id)) return res.status(400).json({ error: 'El responsable indicado no existe' });

  let cliente = contactoElegido || unicos.porTelefono(norm);
  // Cliente nuevo: antes de crearlo se revisa que no exista uno parecido (salvo que ya se haya dicho que es otro).
  const distintoDe = Array.isArray(req.body.distinto_de) ? req.body.distinto_de.map(Number).filter(Boolean) : [];
  if (!cliente) {
    const pendiente = unicos.exigirConfirmacion({ nombre, empresa: empresa_contacto }, distintoDe);
    if (pendiente) return res.status(409).json(pendiente);
  }

  if (cliente && !forzar_duplicado) {
    const abierta = db.prepare(`SELECT id FROM leads WHERE cliente_id = ? AND estatus = 'abierto' LIMIT 1`).get(cliente.id);
    if (abierta) return res.status(409).json({ error: 'duplicado', lead_id: abierta.id });
  }

  // Duplicar solo aplica a órdenes de servicio (ganadas) del mismo contacto; las cotizaciones no se duplican.
  const duplicadoDe = req.body.duplicado_de ? Number(req.body.duplicado_de) : null;
  if (duplicadoDe) {
    if (estatus !== 'ganado') return res.status(400).json({ error: 'Solo se pueden duplicar órdenes de servicio' });
    const original = db.prepare('SELECT id, cliente_id, estatus FROM leads WHERE id = ?').get(duplicadoDe);
    if (!original || original.estatus !== 'ganado') return res.status(400).json({ error: 'Solo se pueden duplicar órdenes de servicio ya contratadas' });
    if (cliente && original.cliente_id !== cliente.id) return res.status(400).json({ error: 'La orden a duplicar pertenece a otro contacto' });
  }
  const origen = estatus === 'ganado' ? 'directo' : 'cotizacion';
  // Una cotización nueva ya tiene propuesta: entra al Pipeline en "Cotización enviada" (la orden directa, en "Cierre").
  const etapaInicial = estatus === 'ganado' ? 4 : 2;
  const errorOrden = validarDatosOrden(req.body);
  if (errorOrden) return res.status(400).json({ error: errorOrden });
  // Costos con terceros de la orden original que se copian a la duplicada (quedan pendientes de pago).
  const costosDup = duplicadoDe ? finanzas.validarCostosDuplicados(duplicadoDe, req.body.costos_duplicar) : { items: [] };
  if (costosDup.error) return res.status(400).json({ error: costosDup.error });

  if(req.body.establecimiento_id && !db.prepare("SELECT id FROM establecimientos WHERE id=? AND cliente_id=? AND estado<>'no_contactar'").get(req.body.establecimiento_id,cliente_id))return res.status(400).json({error:'El establecimiento no está vinculado a este contacto o está marcado como no contactar'});
  const creado=db.transaction(()=>{
  if (!cliente) {
    const infoC = db.prepare(`INSERT INTO clientes (telefono, telefono_normalizado, nombre, empresa_contacto, direccion, correo, giro)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(telefono, norm, nombre || null, empresa_contacto || null, direccion || null, correo?.trim() || null, giro || null);
    cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(infoC.lastInsertRowid);
    unicos.recordarDistintos(cliente.id, distintoDe, req.usuarioSesion.id);
  }
  if (agregarTelA) { const r = unicos.agregarTelefono(agregarTelA, telefono); if (r.error) throw Object.assign(new Error(r.error), { status: 409 }); }


  // El responsable es siempre el usuario que inició sesión, no depende del canal.
  if (!responsable_id) return res.status(400).json({ error: 'Falta el usuario responsable (sesión no válida)' });
  const resp = responsable_id;

  const info = db.prepare(`
    INSERT INTO leads (cliente_id, telefono, telefono_normalizado, nombre, empresa_contacto, direccion, canal_id, servicio_id, responsable_id, notas_iniciales, creado_por, valor, fecha_servicio, fecha_cotizacion, estatus, urgente, origen, duplicado_de, etapa)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cliente.id, telefono, norm,
    cliente.nombre || null,
    cliente.empresa_contacto || null,
    direccion || cliente.direccion || null,
    canal_id || null, servicio_id || null, resp || null, notas_iniciales || null, creado_por || null,
    valor !== undefined && valor !== null ? Number(valor) : null,
    fechaServicioFinal,
    origen === 'cotizacion' ? fechaCotizacionFinal : null,
    estatus,
    urgente ? 1 : 0,
    origen,
    duplicadoDe,
    etapaInicial
  );

  if(req.body.partidas_json!==undefined)db.prepare('UPDATE leads SET partidas_json = ?, iva_modo = ?, iva_tasa = ?, iva_cent = ? WHERE id = ?').run(req.body.partidas_json,req.body.iva_modo??null,req.body.iva_tasa??null,req.body.iva_cent??null,info.lastInsertRowid);
  db.prepare('UPDATE leads SET incluye_vigencia = ?, vigencia_hasta = ? WHERE id = ?').run(incluyeVigencia, vigenciaHasta, info.lastInsertRowid);
  db.prepare('UPDATE leads SET notas_cotizacion = ? WHERE id = ?').run(textoOrden(req.body.notas_cotizacion), info.lastInsertRowid);
  db.prepare('UPDATE leads SET equipo = ?, operador = ?, observaciones = ?, proyecto = ?, manifiestos = ?, tiros = ? WHERE id = ?').run(textoOrden(req.body.equipo), textoOrden(req.body.operador), textoOrden(req.body.observaciones), textoOrden(req.body.proyecto), textoOrden(req.body.manifiestos), textoOrden(req.body.tiros), info.lastInsertRowid);
  if(req.body.establecimiento_id)db.prepare('UPDATE leads SET establecimiento_id=? WHERE id=?').run(req.body.establecimiento_id,info.lastInsertRowid);
  // Crear una cotización nunca modifica los datos maestros del contacto.
  db.prepare(`INSERT INTO historial (lead_id, tipo, texto, usuario, origen) VALUES (?, 'observacion', ?, ?, 'sistema')`)
    .run(info.lastInsertRowid, duplicadoDe ? `Orden de servicio duplicada a partir del registro #${duplicadoDe}.` : estatus === 'ganado' ? 'Servicio registrado directamente como contratado.' : 'Cotización creada.', creado_por || null);

  if (estatus === 'ganado') finanzas.copiarCredito(info.lastInsertRowid);
  if (costosDup.items.length) {
    const orig = db.prepare('SELECT id, created_at FROM leads WHERE id = ?').get(duplicadoDe);
    const folioOrig = 'OS-' + String(orig.created_at).slice(0, 7).replace('-', '') + '-' + String(orig.id).padStart(4, '0');
    const suma = finanzas.duplicarCostos(info.lastInsertRowid, costosDup.items, fechaServicioFinal, textoOrden(req.body.equipo), req.usuarioSesion.id, folioOrig);
    db.prepare(`INSERT INTO historial (lead_id, tipo, texto, usuario, origen) VALUES (?, 'observacion', ?, ?, 'sistema')`)
      .run(info.lastInsertRowid, `Costos con terceros copiados de ${folioOrig}: ${costosDup.items.length} por $${(suma / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })} (pendientes de pago en Cuentas por pagar).`, creado_por || null);
  }
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  })();
  res.status(201).json(creado);
}));

// ---------- Editar lead (datos, etapa, responsable, estatus) ----------
app.put('/api/leads/:id', validarPartidas, validarRegistro, h((req, res) => {
  const id = req.params.id;
  const actual = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });
  if (req.body.version !== undefined && Number(req.body.version) !== actual.version) {
    return res.status(409).json({ error: 'Otra persona actualizó esta cotización mientras la tenías abierta. Ciérrala y vuelve a abrirla para ver los cambios antes de guardar los tuyos.' });
  }

  if (req.body.urgente !== undefined) req.body.urgente = req.body.urgente ? 1 : 0;
  if (req.body.incluye_vigencia !== undefined) req.body.incluye_vigencia = req.body.incluye_vigencia ? 1 : 0;
  if (req.body.canal_id !== undefined && !existe('canales', req.body.canal_id)) return res.status(400).json({ error: 'El canal indicado no existe' });
  if (req.body.servicio_id !== undefined && !existe('catalogo_servicios', req.body.servicio_id)) return res.status(400).json({ error: 'El servicio indicado no existe' });
  if (req.body.responsable_id !== undefined && !existe('usuarios', req.body.responsable_id)) return res.status(400).json({ error: 'El responsable indicado no existe' });
  if (req.body.etapa !== undefined && !(Number(req.body.etapa) >= 1 && Number(req.body.etapa) <= 4)) return res.status(400).json({ error: 'Etapa inválida (1-4)' });
  if (req.body.estatus !== undefined && !['abierto', 'ganado', 'perdido'].includes(req.body.estatus)) return res.status(400).json({ error: 'Estatus inválido: use abierto, ganado o perdido' });
  if (req.body.valor !== undefined && req.body.valor !== null && (isNaN(Number(req.body.valor)) || Number(req.body.valor) < 0)) {
    return res.status(400).json({ error: 'El valor debe ser un número mayor o igual a 0' });
  }

  // Reglas de negocio al cerrar una cotización como GANADA (servicio confirmado): sin esto, un lead pasaba a "cliente"
  // sin valor registrado (rompe los reportes de ingresos) y sin fecha de cierre real
  // (el resumen mensual de Clientes terminaba usando la fecha de creación del lead).
  if (actual.origen === 'directo' && req.body.estatus !== undefined && req.body.estatus !== 'ganado') {
    return res.status(400).json({ error: 'Esta orden de servicio no viene de una cotización; no puede reabrirse ni descartarse como cotización. Si fue un error, elimínala.' });
  }
  // Una orden con pagos registrados no puede volver a ser cotización, ni bajar su importe por
  // debajo de lo ya cobrado (si no hay total facturado que mande sobre el importe).
  if (actual.estatus === 'ganado' && req.body.estatus !== undefined && req.body.estatus !== 'ganado' && finanzas.tieneCobros(actual.id)) {
    return res.status(409).json({ error: 'Esta orden tiene pagos registrados: no puede reabrirse ni descartarse. Si fue un error, un administrador debe cancelar primero esos pagos.' });
  }
  // El importe de una orden de servicio es lo que el cliente debe: solo administración o atención
  // pueden cambiarlo (un vendedor o técnico podría, si no, "saldar" una deuda editando las partidas).
  // Se comparan totales con IVA (valor + iva_cent): cambiar solo el IVA también cambia lo que se debe.
  const totalActualCent = Math.round(Number(actual.valor || 0) * 100) + (actual.iva_cent || 0);
  const totalNuevoCent = req.totalNuevoCent !== undefined ? req.totalNuevoCent
    : (req.body.valor !== undefined && req.body.valor !== null ? Math.round(Number(req.body.valor) * 100) + (actual.iva_cent || 0) : null);
  const cambiaImporte = actual.estatus === 'ganado' && totalNuevoCent !== null && totalNuevoCent !== totalActualCent;
  // Indicar o cambiar el IVA de una orden cambia cómo se lee su importe: misma regla que el importe.
  const cambiaIva = actual.estatus === 'ganado' && req.totalNuevoCent !== undefined
    && (req.body.iva_modo !== actual.iva_modo || req.body.iva_tasa !== actual.iva_tasa);
  if ((cambiaImporte || cambiaIva) && !['admin', 'atencion'].includes(req.usuarioSesion.rol)) {
    return res.status(403).json({ error: cambiaImporte
      ? 'Solo administración o atención pueden cambiar el importe de una orden de servicio. Para un descuento, pide un ajuste al administrador.'
      : 'Solo administración o atención pueden indicar o cambiar el IVA de una orden de servicio.' });
  }
  if (actual.estatus === 'ganado' && actual.factura_total_cent == null && totalNuevoCent !== null
    && totalNuevoCent < finanzas.cobradoCent(actual.id)) {
    return res.status(400).json({ error: 'El importe no puede quedar por debajo de lo que el cliente ya pagó.' });
  }
  if ((req.body.estatus || actual.estatus) === 'ganado') {
    const valorEfectivo = req.body.valor !== undefined ? req.body.valor : actual.valor;
    if (valorEfectivo === null || valorEfectivo === undefined || valorEfectivo === '') {
      return res.status(400).json({ error: 'Se requiere el costo del servicio para cerrar la cotización como ganada' });
    }
    if (!(req.body.fecha_servicio !== undefined ? req.body.fecha_servicio : actual.fecha_servicio)) return res.status(400).json({error:'Indica la fecha acordada del servicio'});
    if (!(req.body.servicio_id !== undefined ? req.body.servicio_id : actual.servicio_id)) return res.status(400).json({error:'Selecciona el servicio que se contratará'});
    // No se puede realizar un servicio antes de cotizarlo: al convertir o al cambiar la fecha se valida.
    const fechaServ = req.body.fecha_servicio !== undefined ? req.body.fecha_servicio : actual.fecha_servicio;
    const fechaCot = req.body.fecha_cotizacion || actual.fecha_cotizacion;
    if ((actual.estatus !== 'ganado' || req.body.fecha_servicio !== undefined) && actual.origen === 'cotizacion' && fechaCot && fechaServ < fechaCot)
      return res.status(400).json({ error: 'La fecha del servicio no puede ser anterior a la fecha de la cotización (' + fechaCot.split('-').reverse().join('/') + ')' });
    if (!String(req.body.direccion !== undefined ? req.body.direccion : actual.direccion || '').trim()) return res.status(400).json({error:'Indica la ubicación del servicio'});
    // Al aceptar la cotización, el lead llega al final del embudo de decisión ("Cierre") aunque
    // el usuario no haya movido la tarjeta manualmente; así el kanban refleja el estado real.
    // (La tarjeta de todas formas sale del tablero de inmediato, porque este solo muestra
    // cotizaciones con estatus 'abierto' — el seguimiento posterior lo lleva el sistema de recompras.)
    if (req.body.etapa === undefined && actual.etapa < 4) req.body.etapa = 4;
  }

  if(actual.partidas_json && req.totalNuevoCent===undefined && (req.body.valor!==undefined || req.body.servicio_id!==undefined)){
    const subtotal=Importes.calcular(JSON.parse(actual.partidas_json),actual.iva_modo,actual.iva_tasa).subtotal_cent;
    if((req.body.valor!==undefined && (req.body.valor===null || Math.round(Number(req.body.valor)*100)!==subtotal))||(req.body.servicio_id!==undefined && Number(req.body.servicio_id)!==actual.servicio_id))return res.status(400).json({error:'Edita las partidas de la cotización para cambiar su importe o servicio'});
  }
  if (['nombre','telefono','empresa_contacto'].some(c=>req.body[c]!==undefined)) return res.status(400).json({error:'Edita los datos de contacto desde su ficha; esta acción modifica solo la cotización o servicio.'});

  if (req.body.encuesta_calificacion !== undefined && req.body.encuesta_calificacion !== null && !(Number(req.body.encuesta_calificacion) >= 1 && Number(req.body.encuesta_calificacion) <= 4)) {
    return res.status(400).json({ error: 'Calificación inválida (1 a 4)' });
  }

  const errorOrden = validarDatosOrden(req.body);
  if (errorOrden) return res.status(400).json({ error: errorOrden });
  ['equipo', 'operador', 'observaciones', 'proyecto', 'manifiestos', 'tiros', 'notas_cotizacion'].forEach(c => { if (req.body[c] !== undefined) req.body[c] = textoOrden(req.body[c]); });
  const campos = ['equipo', 'operador', 'observaciones', 'proyecto', 'manifiestos', 'tiros', 'partidas_json', 'iva_modo', 'iva_tasa', 'iva_cent','direccion', 'canal_id', 'servicio_id', 'responsable_id', 'etapa', 'estatus', 'valor', 'fecha_servicio', 'notas_iniciales', 'urgente', 'encuesta_calificacion', 'encuesta_comentario', 'fecha_cotizacion', 'incluye_vigencia', 'vigencia_hasta', 'notas_cotizacion'];
  const set = [];
  const params = [];
  campos.forEach(c => {
    if (req.body[c] !== undefined) { set.push(`${c} = ?`); params.push(req.body[c]); }
  });
  if (set.length === 0) return res.status(400).json({ error: 'Sin cambios' });
  set.push("updated_at = datetime('now','localtime')");
  set.push('version = version + 1');
  params.push(id);

  db.prepare(`UPDATE leads SET ${set.join(', ')} WHERE id = ?`).run(...params);



  if (req.body.estatus !== undefined && req.body.estatus !== actual.estatus) {
    // Una cotización cerrada (ganada o perdida) ya no necesita recordatorios de seguimiento pendientes:
    // se resuelven solos para no dejar tareas obsoletas en la vista de Alertas.
    if (req.body.estatus === 'ganado' || req.body.estatus === 'perdido') {
      db.prepare(`UPDATE historial SET resuelta = 1 WHERE lead_id = ? AND tipo = 'alerta' AND resuelta = 0`).run(id);
    }
    const textoEvento = { ganado: 'Cotización marcada como ganada (servicio contratado).', perdido: 'Cotización marcada como no aceptada.', abierto: 'Cotización reabierta.' }[req.body.estatus] || ('Estatus cambiado a ' + req.body.estatus + '.');
    db.prepare(`INSERT INTO historial (lead_id, tipo, texto, usuario, origen) VALUES (?, 'observacion', ?, ?, 'sistema')`)
      .run(id, textoEvento, req.usuarioSesion?.nombre || null);
    if (req.body.estatus === 'ganado') finanzas.copiarCredito(id);
  }
  if (cambiaImporte || cambiaIva) {
    const fmt = cent => '$' + (Number(cent || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const iva = cambiaIva ? `IVA: ${Importes.etiquetaModo(actual.iva_modo, actual.iva_tasa)} → ${Importes.etiquetaModo(req.body.iva_modo, req.body.iva_tasa)}` : '';
    const texto = cambiaImporte
      ? `Importe de la orden cambiado: ${fmt(totalActualCent)} → ${fmt(totalNuevoCent)}${iva ? ' (' + iva + ')' : ''}.`
      : `${iva} en la orden; el total no cambia (${fmt(totalNuevoCent)}).`;
    db.prepare(`INSERT INTO historial (lead_id, tipo, texto, usuario, origen) VALUES (?, 'observacion', ?, ?, 'sistema')`)
      .run(id, texto, req.usuarioSesion.nombre);
  }
  res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(id));
}));

// ---------- Historial: observaciones y alertas ----------
app.post('/api/leads/:id/historial', h((req, res) => {
  const { tipo, texto, fecha_alerta } = req.body;
  const usuario = req.usuarioSesion.nombre; // nunca se confía en el valor que mande el navegador
  const origen = req.body.origen === 'sistema' ? 'sistema' : 'manual'; // cualquier otro valor cae en 'manual'
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto requerido' });
  const tipoFinal = tipo || 'observacion';
  if (!['observacion', 'alerta'].includes(tipoFinal)) return res.status(400).json({ error: 'Tipo inválido' });
  if (tipoFinal === 'alerta' && !fecha_alerta) return res.status(400).json({ error: 'Los recordatorios requieren fecha y hora' });
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Cotización no encontrada' });

  const info = db.prepare(`
    INSERT INTO historial (lead_id, tipo, texto, fecha_alerta, usuario, origen)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, tipoFinal, texto, fecha_alerta || null, usuario || null, origen);
  db.prepare("UPDATE leads SET updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM historial WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/historial/:id/resolver', h((req, res) => {
  const info = db.prepare('UPDATE historial SET resuelta = 1 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Registro de historial no encontrado' });
  res.json({ ok: true });
}));

// ---------- Eliminar cotización ----------
// Borrar es definitivo (se pierden importe, notas y bitácora): solo un administrador puede hacerlo.
app.delete('/api/leads/:id', h((req, res) => {
  if (req.usuarioSesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede eliminar cotizaciones u órdenes de servicio' });
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Cotización no encontrada' });
  // Los pagos son el rastro del dinero: una orden que alguna vez tuvo pagos no se borra.
  if (db.prepare('SELECT 1 FROM cobros WHERE lead_id = ? LIMIT 1').get(lead.id)) {
    return res.status(409).json({ error: 'Esta orden tiene pagos registrados y no se puede eliminar, para conservar el rastro del dinero.' });
  }
  // Tampoco una con gastos en Cuentas por pagar (quedarían sueltos, sin su orden).
  if (db.prepare('SELECT 1 FROM cuentas_por_pagar WHERE lead_id = ? AND cancelada = 0 LIMIT 1').get(lead.id)) {
    return res.status(409).json({ error: 'Esta orden tiene gastos en Cuentas por pagar. Cancélalos primero si de verdad quieres eliminarla.' });
  }
  console.log(`[eliminado] registro #${lead.id} (${lead.estatus}, ${lead.valor ?? 'sin importe'}) de cliente #${lead.cliente_id} por ${req.usuarioSesion.nombre}`);
  // El historial se borra en cascada (ON DELETE CASCADE). El cliente y sus otros servicios/cotizaciones no se tocan.
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
}));

// ---------- Clientes (post-venta: clientes reales, separado del pipeline de leads) ----------
// Un "cliente" aquí es alguien con AL MENOS un servicio en estatus 'ganado' (servicio confirmado y realizado) (servicio realizado/cerrado).
// El pipeline de cotizaciones queda exclusivo para estatus 'abierto'; en cuanto una se marca 'ganado',
// deja de aparecer ahí y el cliente (con todo su historial) vive en este apartado.
function tipoClienteValido(clave) { return !!db.prepare('SELECT clave FROM tipos_cliente WHERE clave = ?').get(clave); }
function validarCorreo(correo) {
  if (correo === undefined || correo === null || correo === '') return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(correo).trim());
}

// Contactos guardados que aún no tienen ninguna cotización ni orden: el Pipeline los muestra en
// "Recolección de datos" para que nadie se quede sin seguimiento.
app.get('/api/contactos/sin-cotizacion', h((req,res)=>{
  const { q, desde, hasta } = req.query;
  let sql = `SELECT c.id, c.nombre, c.telefono, c.empresa_contacto, c.created_at, c.updated_at, ca.nombre AS canal_nombre
    FROM clientes c LEFT JOIN canales ca ON ca.id = c.canal_origen_id
    WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.cliente_id = c.id)`;
  const params = [];
  if (q) { sql += ' AND (c.nombre LIKE ? OR c.telefono LIKE ? OR c.empresa_contacto LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (desde) { sql += ' AND date(c.created_at) >= date(?)'; params.push(desde); }
  if (hasta) { sql += ' AND date(c.created_at) <= date(?)'; params.push(hasta); }
  sql += ' ORDER BY c.created_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
}));
// RFC mexicano: 3 letras (moral) o 4 (física), 6 dígitos de fecha y 3 de homoclave. Vacío se permite.
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const normalizarRfc = v => (v === undefined || v === null) ? v : String(v).trim().toUpperCase();
app.post('/api/contactos', h((req,res)=>{
  const {nombre,telefono,empresa_contacto,direccion,correo,telefono_alterno,giro,rfc,notas_generales}=req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({error:'El nombre del contacto es obligatorio'});
  const malNombre = unicos.problemaNombreCliente(nombre, 'El nombre') || (empresa_contacto && String(empresa_contacto).trim() ? unicos.problemaNombreCliente(empresa_contacto, 'La empresa') : null);
  if (malNombre) return res.status(400).json({ error: malNombre });
  const norm=normalizarTelefono(telefono);
  if(norm.length!==10) return res.status(400).json({error:'El teléfono debe tener 10 dígitos'});
  if (unicos.telefonoFalso(norm)) return res.status(400).json({ error: 'Ese teléfono no parece real (' + norm + '): escribe el teléfono del contacto' });
  // El teléfono alterno también identifica al cliente: debe ser válido y no ser de otro cliente.
  const altNormNuevo = telefono_alterno && String(telefono_alterno).trim() ? normalizarTelefono(telefono_alterno) : '';
  if (altNormNuevo && altNormNuevo.length !== 10) return res.status(400).json({ error: 'El teléfono alterno debe tener 10 dígitos' });
  if (altNormNuevo && altNormNuevo !== norm) {
    const dueñoAlt = unicos.porTelefono(altNormNuevo);
    if (dueñoAlt) return res.status(409).json({ error: `El teléfono alterno ya es de ${unicos.folioCliente(dueñoAlt.id)} · ${dueñoAlt.empresa_contacto || dueñoAlt.nombre}`, cliente_id: dueñoAlt.id, cliente: unicos.resumen(dueñoAlt) });
  }
  if (!validarCorreo(correo)) return res.status(400).json({error:'El correo electrónico no es válido'});
  if (giro && !tipoClienteValido(giro)) return res.status(400).json({error:'Giro inválido'});
  if (normalizarRfc(rfc) && !RFC.test(normalizarRfc(rfc))) return res.status(400).json({error:'El RFC no es válido (p. ej. ABC010101AB1)'});
  const existente=unicos.porTelefono(norm);
  if(existente) return res.status(409).json({error:`Este teléfono ya es de ${unicos.folioCliente(existente.id)} · ${existente.empresa_contacto||existente.nombre}`,cliente_id:existente.id,cliente:unicos.resumen(existente)});
  // «Es el mismo cliente»: solo se le agrega este teléfono.
  if (req.body.agregar_telefono_a) {
    const destino = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(req.body.agregar_telefono_a));
    if (!destino) return res.status(404).json({ error: 'Cliente no encontrado' });
    const r = unicos.agregarTelefono(destino.id, telefono, 'Contacto: ' + String(nombre).trim().slice(0, 50));
    if (r.error) return res.status(409).json(r);
    return res.json({ ...db.prepare('SELECT * FROM clientes WHERE id = ?').get(destino.id), telefono_agregado: true });
  }
  const deRfc = normalizarRfc(rfc) ? unicos.porRfc(normalizarRfc(rfc)) : null;
  if (deRfc) return res.status(409).json({ error: `Este RFC ya es de ${unicos.folioCliente(deRfc.id)} · ${deRfc.empresa_contacto || deRfc.nombre}`, rfc_de: unicos.resumen(deRfc) });
  const distintoDe = Array.isArray(req.body.distinto_de) ? req.body.distinto_de.map(Number).filter(Boolean) : [];
  const pendiente = unicos.exigirConfirmacion({ nombre, empresa: empresa_contacto }, distintoDe);
  if (pendiente) return res.status(409).json(pendiente);
  if (!req.body.canal_origen_id || !db.prepare('SELECT id FROM canales WHERE id = ?').get(req.body.canal_origen_id)) return res.status(400).json({error:'Selecciona cómo se enteró de nosotros'});
  const info=db.prepare(`INSERT INTO clientes (nombre,telefono,telefono_normalizado,empresa_contacto,direccion,correo,telefono_alterno,giro,rfc,notas_generales,canal_origen_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(String(nombre).trim(),telefono,norm,empresa_contacto||null,direccion||null,correo?.trim()||null,telefono_alterno||null,giro||null,normalizarRfc(rfc)||null,notas_generales||null,req.body.canal_origen_id);
  unicos.recordarDistintos(Number(info.lastInsertRowid), distintoDe, req.usuarioSesion.id);
  if (altNormNuevo && altNormNuevo !== norm) unicos.agregarTelefono(Number(info.lastInsertRowid), telefono_alterno, 'Alterno');
  res.status(201).json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid));
}));

app.get('/api/clientes', h((req, res) => {
  const { q, desde, hasta, incluir_prospectos, tipo } = req.query;
  let sql = `
    SELECT c.*,
      COUNT(l.id) AS total_solicitudes,
      SUM(CASE WHEN l.estatus = 'ganado' THEN 1 ELSE 0 END) AS servicios_ganados,
      SUM(CASE WHEN l.estatus = 'abierto' THEN 1 ELSE 0 END) AS solicitudes_abiertas,
      COALESCE(SUM(CASE WHEN l.estatus = 'ganado' THEN l.valor ELSE 0 END), 0) AS valor_ganado_total,
      MAX(COALESCE(l.updated_at,c.updated_at)) AS ultima_actividad
    FROM clientes c
    LEFT JOIN leads l ON l.cliente_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (q) { sql += ' AND (c.nombre LIKE ? OR c.telefono LIKE ? OR CAST(c.id AS TEXT) = ?)'; params.push(`%${q}%`, `%${q}%`, q); }
  sql += ' GROUP BY c.id HAVING 1=1';
  if (incluir_prospectos !== '1' || tipo === 'clientes') sql += ' AND servicios_ganados > 0';
  if (incluir_prospectos === '1' && tipo === 'prospectos') sql += ' AND servicios_ganados = 0';
  // Filtro por tiempo: se aplica sobre la última actividad del cliente (última vez que se movió
  // alguna de sus solicitudes), para responder "¿qué clientes tuvieron actividad en este periodo?".
  if (desde) { sql += ' AND date(MAX(COALESCE(l.updated_at,c.updated_at))) >= date(?)'; params.push(desde); }
  if (hasta) { sql += ' AND date(MAX(COALESCE(l.updated_at,c.updated_at))) <= date(?)'; params.push(hasta); }
  sql += ' ORDER BY ultima_actividad DESC';
  res.json(db.prepare(sql).all(...params));
}));

app.get('/api/clientes/:id', h((req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const servicios = db.prepare(`
    SELECT l.*, s.nombre AS servicio_nombre, s.dias_recurrencia, u.nombre AS responsable_nombre, ca.nombre AS canal_nombre
    FROM leads l
    LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
    LEFT JOIN usuarios u ON u.id = l.responsable_id
    LEFT JOIN canales ca ON ca.id = l.canal_id
    WHERE l.cliente_id = ?
    ORDER BY l.created_at DESC
  `).all(cliente.id);
  const totales = db.prepare(`
    SELECT
      COUNT(*) AS total_solicitudes,
      SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) AS servicios_ganados,
      SUM(CASE WHEN estatus = 'abierto' THEN 1 ELSE 0 END) AS solicitudes_abiertas,
      COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN valor ELSE 0 END), 0) AS valor_ganado_total,
      COALESCE(SUM(valor), 0) AS valor_cotizado_total,
      MIN(created_at) AS cliente_desde
    FROM leads WHERE cliente_id = ?
  `).get(cliente.id);

  // Próxima recompra sugerida para este cliente (la más próxima entre todos sus servicios recurrentes).
  const recurrentes = db.prepare(`
    SELECT s.nombre AS servicio_nombre, s.dias_recurrencia,
      MAX(COALESCE(l.fecha_servicio, date(l.created_at))) AS ultima_fecha,
      (SELECT COUNT(*) FROM leads l2 WHERE l2.cliente_id = l.cliente_id AND l2.servicio_id = s.id AND l2.estatus = 'abierto') AS ya_en_leads
    FROM leads l JOIN catalogo_servicios s ON s.id = l.servicio_id
    WHERE l.cliente_id = ? AND l.estatus = 'ganado' AND s.dias_recurrencia IS NOT NULL
    GROUP BY s.id
  `).all(cliente.id).filter(r => r.ya_en_leads === 0).map(r => {
    const sugerida = new Date(new Date(r.ultima_fecha + 'T00:00:00').getTime() + r.dias_recurrencia * 86400000);
    return { servicio_nombre: r.servicio_nombre, fecha_sugerida: sugerida.toISOString().slice(0, 10), dias_restantes: Math.round((sugerida - new Date()) / 86400000) };
  }).sort((a, b) => a.dias_restantes - b.dias_restantes);

  res.json({ ...cliente, servicios, ...totales, proxima_recompra: recurrentes[0] || null });
}));

// Edición de los datos maestros del cliente (independiente de cualquier solicitud puntual).
app.put('/api/clientes/:id', h((req, res) => {
  if (req.body.nombre !== undefined && !String(req.body.nombre).trim()) return res.status(400).json({error:'El nombre del contacto es obligatorio'});
  if (req.body.correo !== undefined && !validarCorreo(req.body.correo)) return res.status(400).json({ error: 'El correo electrónico no es válido' });
  if (req.body.giro !== undefined && req.body.giro !== null && req.body.giro !== '' && !tipoClienteValido(req.body.giro)) return res.status(400).json({ error: 'Giro inválido' });
  if (req.body.rfc !== undefined) { req.body.rfc = normalizarRfc(req.body.rfc) || null; if (req.body.rfc && !RFC.test(req.body.rfc)) return res.status(400).json({ error: 'El RFC no es válido (p. ej. ABC010101AB1)' }); }
  const id = req.params.id;
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Un cliente importado sin teléfono puede guardar sus otros datos mientras el teléfono siga vacío.
  if (req.body.telefono !== undefined && !String(req.body.telefono).trim() && !cliente.telefono) delete req.body.telefono;
  let nuevoNorm = null;
  if (req.body.telefono !== undefined) {
    nuevoNorm = normalizarTelefono(req.body.telefono);
    if (nuevoNorm.length !== 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos' });
    if (unicos.telefonoFalso(nuevoNorm) && nuevoNorm !== cliente.telefono_normalizado) return res.status(400).json({ error: 'Ese teléfono no parece real (' + nuevoNorm + ')' });
    const otro = unicos.porTelefono(nuevoNorm);
    if (otro && String(otro.id) !== String(id)) return res.status(409).json({ error: `Ese teléfono ya es de ${unicos.folioCliente(otro.id)} · ${otro.empresa_contacto || otro.nombre}` });
    // Si era uno de sus teléfonos adicionales, pasa a ser el principal.
    db.prepare('DELETE FROM telefonos_cliente WHERE cliente_id = ? AND telefono_normalizado = ?').run(id, nuevoNorm);
  }
  // El teléfono alterno también identifica al cliente: no puede ser de otro.
  const altNorm = req.body.telefono_alterno && String(req.body.telefono_alterno).trim() ? normalizarTelefono(req.body.telefono_alterno) : '';
  if (altNorm && altNorm.length !== 10) return res.status(400).json({ error: 'El teléfono alterno debe tener 10 dígitos' });
  if (altNorm.length === 10) {
    const dueñoAlt = unicos.porTelefono(altNorm);
    if (dueñoAlt && String(dueñoAlt.id) !== String(id)) return res.status(409).json({ error: `El teléfono alterno ya es de ${unicos.folioCliente(dueñoAlt.id)} · ${dueñoAlt.empresa_contacto || dueñoAlt.nombre}` });
  }
  // Nombre o empresa: válidos y, si cambian, que no queden iguales a otro cliente (se pregunta antes).
  for (const [campo, etiqueta] of [['nombre', 'El nombre'], ['empresa_contacto', 'La empresa']]) {
    if (req.body[campo] === undefined || req.body[campo] === null || !String(req.body[campo]).trim()) continue;
    const mal = unicos.problemaNombreCliente(req.body[campo], etiqueta);
    if (mal) return res.status(400).json({ error: mal });
  }
  const cambiaNombre = ['nombre', 'empresa_contacto'].some(c => req.body[c] !== undefined && unicos.clave(req.body[c]) !== unicos.clave(cliente[c]));
  if (cambiaNombre) {
    const distintoDe = Array.isArray(req.body.distinto_de) ? req.body.distinto_de.map(Number).filter(Boolean) : [];
    const nuevo = { nombre: req.body.nombre ?? cliente.nombre, empresa: req.body.empresa_contacto ?? cliente.empresa_contacto };
    const pendiente = unicos.exigirConfirmacion(nuevo, [...distintoDe, Number(id)], [Number(id)]);
    if (pendiente) return res.status(409).json({ ...pendiente, mensaje: 'Con este nombre quedaría igual a otro cliente. Si es el mismo, un administrador puede juntarlos.' });
    if (distintoDe.length) unicos.recordarDistintos(Number(id), distintoDe, req.usuarioSesion.id);
  }
  // El RFC no se repite: si ya lo tiene otro cliente, es la misma razón social (se ofrece juntarlos).
  if (req.body.rfc) {
    const deRfc = unicos.porRfc(req.body.rfc, Number(id));
    if (deRfc) return res.status(409).json({ error: `Este RFC ya es de ${unicos.folioCliente(deRfc.id)} · ${deRfc.empresa_contacto || deRfc.nombre}. Si es la misma razón social, un administrador puede juntarlos.`, rfc_de: unicos.resumen(deRfc) });
  }

  const campos = ['nombre', 'empresa_contacto', 'direccion', 'telefono', 'correo', 'telefono_alterno', 'giro', 'rfc', 'notas_generales'];
  const set = [];
  const params = [];
  campos.forEach(c => {
    if (req.body[c] !== undefined) { set.push(`${c} = ?`); params.push(req.body[c]); }
  });
  if (nuevoNorm !== null) { set.push('telefono_normalizado = ?'); params.push(nuevoNorm); }
  if (set.length === 0) return res.status(400).json({ error: 'Sin cambios' });
  set.push("updated_at = datetime('now','localtime')");
  params.push(id);

  db.prepare(`UPDATE clientes SET ${set.join(', ')} WHERE id = ?`).run(...params);
  if (altNorm.length === 10 && altNorm !== normalizarTelefono(db.prepare('SELECT telefono FROM clientes WHERE id = ?').get(id).telefono || '')) unicos.agregarTelefono(Number(id), req.body.telefono_alterno, 'Alterno');
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(id));
}));

// ---------- KPIs por etapa (pipeline de cotizaciones) ----------
app.get('/api/kpis', h((req, res) => {
  const { responsable_id } = req.query;
  const filtroResp = responsable_id ? 'AND responsable_id = ?' : '';
  const paramsResp = responsable_id ? [responsable_id] : [];

  // "total" y "valor_total" son el pipeline VIVO: solo cotizaciones abiertas.
  // Las cotizaciones ganadas/perdidas se reportan aparte (contexto histórico), pero
  // ya no cuentan como activas en el pipeline.
  const porEtapa = db.prepare(`
    SELECT etapa,
      SUM(CASE WHEN estatus = 'abierto' THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN estatus = 'abierto' THEN 1 ELSE 0 END) AS abiertos,
      SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) AS ganados,
      SUM(CASE WHEN estatus = 'perdido' THEN 1 ELSE 0 END) AS perdidos,
      COALESCE(SUM(CASE WHEN estatus = 'abierto' THEN valor ELSE 0 END), 0) AS valor_total,
      COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN valor ELSE 0 END), 0) AS valor_ganado,
      SUM(CASE WHEN estatus = 'abierto' AND
        (SELECT COUNT(*) FROM historial h WHERE h.lead_id = leads.id AND h.tipo='alerta' AND h.resuelta=0 AND h.fecha_alerta <= datetime('now','localtime')) > 0
        THEN 1 ELSE 0 END) AS con_alertas
    FROM leads
    WHERE 1=1 ${filtroResp}
    GROUP BY etapa
  `).all(...paramsResp);

  const kpisPorEtapa = { 1: {}, 2: {}, 3: {}, 4: {} };
  for (let e = 1; e <= 4; e++) {
    const row = porEtapa.find(r => r.etapa === e) || { total: 0, abiertos: 0, ganados: 0, perdidos: 0, valor_total: 0, valor_ganado: 0, con_alertas: 0 };
    kpisPorEtapa[e] = row;
  }

  const antiguedad = db.prepare(`
    SELECT etapa, AVG(julianday('now','localtime') - julianday(updated_at)) AS dias_prom
    FROM leads WHERE estatus = 'abierto' ${filtroResp}
    GROUP BY etapa
  `).all(...paramsResp);
  antiguedad.forEach(a => { if (kpisPorEtapa[a.etapa]) kpisPorEtapa[a.etapa].dias_promedio = Math.round((a.dias_prom || 0) * 10) / 10; });

  // Resumen de clientes: distingue Prospectos (nunca han cerrado un servicio) de Clientes (al menos 1 "ganado"),
  // y separa a los Clientes recurrentes (2+ servicios ganados). No es una etapa del pipeline por-solicitud,
  // sino un corte transversal por CLIENTE (persona/empresa), útil para ver qué tanto de la cartera ya compró.
  // El directorio incluye también contactos sin registros comerciales.
  const resumenClientes = db.prepare(`
    SELECT
      COUNT(DISTINCT c.id) AS total_clientes,
      SUM(CASE WHEN g.ganados > 0 THEN 1 ELSE 0 END) AS clientes_activos,
      SUM(CASE WHEN g.ganados IS NULL OR g.ganados = 0 THEN 1 ELSE 0 END) AS prospectos,
      SUM(CASE WHEN g.ganados >= 2 THEN 1 ELSE 0 END) AS recurrentes
    FROM clientes c
    LEFT JOIN (
      SELECT cliente_id, SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) AS ganados
      FROM leads GROUP BY cliente_id
    ) g ON g.cliente_id = c.id
  `).get();
  const valorHistorico = db.prepare(`SELECT COALESCE(SUM(valor), 0) AS v FROM leads WHERE estatus = 'ganado'`).get().v;

  res.json({
    etapas: kpisPorEtapa,
    resumen_clientes: {
      total_clientes: resumenClientes.total_clientes || 0,
      clientes_activos: resumenClientes.clientes_activos || 0,
      prospectos: resumenClientes.prospectos || 0,
      recurrentes: resumenClientes.recurrentes || 0,
      valor_historico_ganado: valorHistorico || 0
    }
  });
}));

// ---------- Recompras sugeridas (servicios recurrentes por vencer) ----------
// Un servicio de saneamiento (fosas, trampas de grasa, plantas de tratamiento) no es una
// venta única: se vuelve a necesitar cada N días. Este endpoint calcula, por cada combinación
// cliente + servicio con al menos un "ganado" y con recurrencia definida en el catálogo,
// cuándo debería volver a contactarse para agendar — ordenado de más urgente a menos.
app.get('/api/recompras', h((req, res) => {
  const filas = db.prepare(`
    SELECT c.id AS cliente_id, c.telefono, c.nombre, c.empresa_contacto, c.direccion,
      s.id AS servicio_id, s.nombre AS servicio_nombre, s.dias_recurrencia,
      MAX(COALESCE(l.fecha_servicio, date(l.created_at))) AS ultima_fecha,
      (SELECT COUNT(*) FROM leads l2 WHERE l2.cliente_id = c.id AND l2.servicio_id = s.id AND l2.estatus = 'abierto') AS ya_en_leads,
      (SELECT l3.valor FROM leads l3 WHERE l3.cliente_id = c.id AND l3.servicio_id = s.id AND l3.estatus = 'ganado'
        ORDER BY COALESCE(l3.fecha_servicio, date(l3.created_at)) DESC LIMIT 1) AS ultimo_valor,
      -- La última orden de ese servicio: el botón "Registrar servicio nuevo" la duplica.
      (SELECT l4.id FROM leads l4 WHERE l4.cliente_id = c.id AND l4.servicio_id = s.id AND l4.estatus = 'ganado'
        ORDER BY COALESCE(l4.fecha_servicio, date(l4.created_at)) DESC, l4.id DESC LIMIT 1) AS ultimo_lead_id
    FROM leads l
    JOIN clientes c ON c.id = l.cliente_id
    JOIN catalogo_servicios s ON s.id = l.servicio_id
    WHERE l.estatus = 'ganado' AND s.dias_recurrencia IS NOT NULL
    GROUP BY c.id, s.id
  `).all();

  const hoy = new Date();
  const resultado = filas
    .filter(f => f.ya_en_leads === 0) // ya se le está gestionando una nueva solicitud de este mismo servicio
    .map(f => {
      const ultima = new Date(f.ultima_fecha + 'T00:00:00');
      const sugerida = new Date(ultima.getTime() + f.dias_recurrencia * 86400000);
      if (Number.isNaN(sugerida.getTime())) return null; // fecha o recurrencia inválida: se omite en vez de tumbar la lista
      const dias_restantes = Math.round((sugerida - hoy) / 86400000);
      return {
        cliente_id: f.cliente_id, telefono: f.telefono, nombre: f.nombre,
        empresa_contacto: f.empresa_contacto, direccion: f.direccion,
        servicio_id: f.servicio_id, servicio_nombre: f.servicio_nombre,
        ultima_fecha: f.ultima_fecha, ultimo_valor: f.ultimo_valor, ultimo_lead_id: f.ultimo_lead_id,
        fecha_sugerida: sugerida.toISOString().slice(0, 10),
        dias_restantes
      };
    })
    .filter(r => r && r.dias_restantes <= 30) // vencidos o próximos a vencer en 30 días
    .sort((a, b) => a.dias_restantes - b.dias_restantes);

  res.json(resultado);
}));

// ---------- Recordatorios pendientes (dashboard de hoy) ----------
app.get('/api/alertas', h((req, res) => {
  const rows = db.prepare(`
    SELECT h.*, l.nombre AS lead_nombre, l.telefono, l.id AS lead_id, u.nombre AS responsable_nombre
    FROM historial h
    JOIN leads l ON l.id = h.lead_id
    LEFT JOIN usuarios u ON u.id = l.responsable_id
    WHERE h.tipo = 'alerta' AND h.resuelta = 0 AND h.fecha_alerta <= datetime('now','localtime','+1 day','start of day')
    ORDER BY h.fecha_alerta ASC
  `).all();
  res.json(rows);
}));

// ---------- Generador: ventas por servicio (una fila por partida de cada orden de servicio) ----------
// Columnas del generador de ventas de Saneadren: mes, fecha, orden, factura, producto, precios
// unitarios con y sin IVA, cantidad, subtotal, IVA, total, canal, cliente, proyecto, unidad y empleado.
// El subtotal, IVA y total de cada partida suman exactamente los de la orden (public/importes.js).
const MESES_LETRA = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
app.get('/api/generador', h((req, res) => {
  const desde = req.query.desde || null, hasta = req.query.hasta || null;
  const fechaOk = v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)));
  if (!fechaOk(desde) || !fechaOk(hasta) || (desde && hasta && desde > hasta)) return res.status(400).json({ error: 'Revisa el rango de fechas' });
  const q = String(req.query.q || '').trim().toLowerCase();
  const ordenes = db.prepare(`SELECT l.id, l.created_at, l.fecha_servicio, l.factura_folio, l.orden_generador, l.cliente_id, l.partidas_json, l.valor, l.iva_modo, l.iva_tasa, l.iva_cent,
      l.proyecto, l.equipo, l.operador, l.manifiestos, l.tiros, l.realizado_por, COALESCE(c.empresa_contacto, c.nombre, l.empresa_contacto, l.nombre) AS cliente,
      COALESCE(cl.nombre, cc.nombre) AS canal, s.nombre AS servicio_nombre,
      COALESCE(l.fecha_realizado, l.fecha_servicio, date(l.created_at)) AS fecha
    FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id LEFT JOIN canales cl ON cl.id = l.canal_id
    LEFT JOIN canales cc ON cc.id = c.canal_origen_id LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
    WHERE l.estatus = 'ganado' AND l.ejecucion = 'realizado' AND (? IS NULL OR COALESCE(l.fecha_realizado, l.fecha_servicio, date(l.created_at)) >= ?) AND (? IS NULL OR COALESCE(l.fecha_realizado, l.fecha_servicio, date(l.created_at)) <= ?)
    ORDER BY fecha DESC, l.id DESC`).all(desde, desde, hasta, hasta);
  const pesos = cent => cent == null ? null : Math.round(cent) / 100;
  // Costos con terceros: gastos de Cuentas por pagar ligados a cada orden (proveedor que hizo el servicio).
  const METODO_TXT = { transferencia: 'Transferencia', efectivo: 'Efectivo', deposito: 'Depósito', cheque: 'Cheque', tarjeta: 'Tarjeta', otro: 'Otro', nomina: 'Nómina' };
  const costos = new Map();
  for (const x of db.prepare(`SELECT x.lead_id, p.nombre AS proveedor, x.concepto, x.total_cent,
      (SELECT COALESCE(SUM(monto_cent), 0) FROM pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) AS pagado_cent,
      (SELECT fecha || '|' || metodo || '|' || COALESCE(referencia, '') FROM pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0 ORDER BY fecha DESC, id DESC LIMIT 1) AS ultimo_pago
    FROM cuentas_por_pagar x JOIN proveedores p ON p.id = x.proveedor_id WHERE x.cancelada = 0 AND x.lead_id IS NOT NULL ORDER BY x.id`).all()) {
    if (!costos.has(x.lead_id)) costos.set(x.lead_id, []);
    costos.get(x.lead_id).push(x);
  }
  function costoDe(leadId) {
    const lista = costos.get(leadId);
    if (!lista) return { proveedor: '', concepto: '', costo: null, estatus_pago: '', via_pago: '' };
    const unicos = a => [...new Set(a.filter(Boolean))].join(' · ');
    const total = lista.reduce((t, x) => t + x.total_cent, 0), pagado = lista.reduce((t, x) => t + x.pagado_cent, 0);
    const ultimo = lista.map(x => x.ultimo_pago).filter(Boolean).sort().at(-1)?.split('|');
    const fecha = ultimo ? ultimo[0].split('-').reverse().join('/') : '';
    return { proveedor: unicos(lista.map(x => x.proveedor)), concepto: unicos(lista.map(x => x.concepto)), costo: pesos(total),
      estatus_pago: pagado >= total ? 'Pagado ' + fecha : pagado > 0 ? 'Pagado en parte (' + pesos(pagado).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) + ')' : 'Pendiente',
      via_pago: ultimo ? [METODO_TXT[ultimo[1]] || ultimo[1], ultimo[2]].filter(Boolean).join(' · ') : '' };
  }
  const filas = [];
  for (const o of ordenes) {
    let items; try { items = JSON.parse(o.partidas_json || 'null'); } catch { items = null; }
    if (!Array.isArray(items) || !items.length) items = [{ servicio: o.servicio_nombre || '', importe: o.valor || 0 }];
    const lineas = Importes.desglosarPartidas(items, o.iva_modo, o.iva_tasa);
    const folio = 'OS-' + String(o.created_at).slice(0, 7).replace('-', '') + '-' + String(o.id).padStart(4, '0');
    const costo = costoDe(o.id);
    items.forEach((it, n) => {
      const l = lineas[n], cantidad = Importes.cantidadDe(it);
      filas.push({
        lead_id: o.id, mes: MESES_LETRA[Number(String(o.fecha).slice(5, 7)) - 1] || '', fecha: o.fecha, orden: folio, orden_generador: o.orden_generador || '', factura: o.factura_folio || '',
        cliente_id: o.cliente_id,
        producto: it.servicio || o.servicio_nombre || 'Servicio', cantidad,
        precio_con_iva: Math.round(l.total_cent / cantidad) / 100, precio_sin_iva: Math.round(l.subtotal_cent / cantidad) / 100,
        subtotal: pesos(l.subtotal_cent), iva: pesos(l.iva_cent), total: pesos(l.total_cent), iva_por_definir: !o.iva_modo,
        canal: o.canal || '', cliente: o.cliente || '', proyecto: o.proyecto || '', unidad: o.equipo || '', empleado: o.operador || '',
        manifiestos: o.manifiestos || '', tiros: o.tiros || '', realizado_por: o.realizado_por === 'subcontratado' ? 'Subcontratado' : 'Propio',
        // El costo con terceros es de la orden: va solo en su primer renglón para no sumarlo dos veces.
        ...(n === 0 ? costo : { proveedor: '', concepto: '', costo: null, estatus_pago: '', via_pago: '' }),
      });
    });
  }
  const visibles = q ? filas.filter(f => [f.orden, f.factura, f.producto, f.cliente, f.proyecto, f.unidad, f.empleado, f.canal, f.mes, f.proveedor, f.concepto, f.manifiestos].some(v => String(v).toLowerCase().includes(q))) : filas;
  const suma = k => Math.round(visibles.reduce((t, f) => t + (f[k] || 0) * 100, 0)) / 100;
  // Órdenes con fecha ya pasada que nadie ha marcado: no están en el Generador hasta concluirlas.
  const porConcluir = db.prepare("SELECT COUNT(*) n FROM leads WHERE estatus = 'ganado' AND ejecucion IS NULL AND fecha_servicio IS NOT NULL AND fecha_servicio <= ?").get(hoyMexico()).n;
  res.json({ filas: visibles, por_concluir: porConcluir, totales: { subtotal: suma('subtotal'), iva: suma('iva'), total: suma('total'), costo: suma('costo'), ordenes: new Set(visibles.map(f => f.lead_id)).size } });
}));

// ---------- Análisis y métricas (vista Resultados) ----------
app.get('/api/analisis/comercial', h((req,res)=>{
  const desde=req.query.desde||null,hasta=req.query.hasta||null;
  const fechaValida=v=>!v||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v)));
  if(!fechaValida(desde)||!fechaValida(hasta)||(desde&&hasta&&desde>hasta))return res.status(400).json({error:'Revisa el rango de fechas'});
  const clientes=db.prepare(`SELECT c.id,c.nombre,c.telefono,c.canal_origen_id,COALESCE(ca.nombre,'Sin origen registrado') canal,c.created_at,
    CASE WHEN (? IS NULL OR date(c.created_at)>=?) AND (? IS NULL OR date(c.created_at)<=?) THEN 1 ELSE 0 END nuevo,
    COALESCE(a.ganados_historicos,0) ganados_historicos,COALESCE(a.total_historico,0) total_historico,
    COALESCE(a.servicios,0) servicios,COALESCE(a.contratado,0) contratado,COALESCE(a.registros,0) registros,
    COALESCE(a.abiertas,0) abiertas,COALESCE(a.propuesto,0) propuesto,a.ultima_fecha
    FROM clientes c LEFT JOIN canales ca ON ca.id=c.canal_origen_id
    LEFT JOIN (SELECT cliente_id,
      SUM(CASE WHEN estatus='ganado' THEN 1 ELSE 0 END) ganados_historicos,
      SUM(CASE WHEN estatus='ganado' THEN COALESCE(valor,0) ELSE 0 END) total_historico,
      SUM(CASE WHEN estatus='ganado' AND (? IS NULL OR date(fecha_servicio)>=?) AND (? IS NULL OR date(fecha_servicio)<=?) THEN 1 ELSE 0 END) servicios,
      SUM(CASE WHEN estatus='ganado' AND (? IS NULL OR date(fecha_servicio)>=?) AND (? IS NULL OR date(fecha_servicio)<=?) THEN COALESCE(valor,0) ELSE 0 END) contratado,
      SUM(CASE WHEN (? IS NULL OR date(created_at)>=?) AND (? IS NULL OR date(created_at)<=?) THEN 1 ELSE 0 END) registros,
      SUM(CASE WHEN estatus='abierto' AND (? IS NULL OR date(created_at)>=?) AND (? IS NULL OR date(created_at)<=?) THEN 1 ELSE 0 END) abiertas,
      SUM(CASE WHEN estatus='abierto' AND (? IS NULL OR date(created_at)>=?) AND (? IS NULL OR date(created_at)<=?) THEN COALESCE(valor,0) ELSE 0 END) propuesto,
      MAX(CASE WHEN estatus='ganado' THEN fecha_servicio END) ultima_fecha
      FROM leads GROUP BY cliente_id) a ON a.cliente_id=c.id`).all(...Array.from({length:6},()=>[desde,desde,hasta,hasta]).flat());
  const canales=new Map();
  for(const c of clientes){const k=c.canal_origen_id||0;if(!canales.has(k))canales.set(k,{canal:c.canal,nuevos:0,convertidos:0,clientes:0,recurrentes:0,servicios:0,contratado:0,registros:0,abiertas:0,propuesto:0});const r=canales.get(k);r.nuevos+=c.nuevo;r.convertidos+=c.nuevo&&c.ganados_historicos>0?1:0;r.clientes+=c.servicios>0?1:0;r.recurrentes+=c.servicios>0&&c.ganados_historicos>1?1:0;for(const campo of ['servicios','contratado','registros','abiertas','propuesto'])r[campo]+=c[campo];}
  const filas=[...canales.values()].sort((a,b)=>b.contratado-a.contratado);
  const resumen={nuevos:0,convertidos:0,clientes:0,recurrentes:0,servicios:0,contratado:0,registros:0,abiertas:0,propuesto:0};for(const r of filas)for(const k of Object.keys(resumen))resumen[k]+=r[k];
  const sinFecha=db.prepare("SELECT COUNT(*) total FROM leads WHERE estatus='ganado' AND fecha_servicio IS NULL").get().total;
  const mensual=db.prepare("SELECT strftime('%Y-%m',fecha_servicio) mes,COUNT(*) servicios,SUM(COALESCE(valor,0)) importe FROM leads WHERE estatus='ganado' AND date(fecha_servicio) IS NOT NULL AND (? IS NULL OR date(fecha_servicio)>=?) AND (? IS NULL OR date(fecha_servicio)<=?) GROUP BY mes ORDER BY mes").all(desde,desde,hasta,hasta);
  const antiguedad=db.prepare(`SELECT CASE WHEN julianday(date('now','localtime'))-julianday(date(created_at))<=7 THEN 0 WHEN julianday(date('now','localtime'))-julianday(date(created_at))<=30 THEN 1 WHEN julianday(date('now','localtime'))-julianday(date(created_at))<=60 THEN 2 ELSE 3 END grupo,COUNT(*) cantidad,SUM(COALESCE(valor,0)) importe FROM leads WHERE estatus='abierto' AND (? IS NULL OR date(created_at)>=?) AND (? IS NULL OR date(created_at)<=?) GROUP BY grupo ORDER BY grupo`).all(desde,desde,hasta,hasta);
  // Órdenes anteriores al IVA: su importe se suma como se capturó (puede o no incluir IVA).
  const ivaPorDefinir=db.prepare("SELECT COUNT(*) servicios,COALESCE(SUM(valor),0) importe FROM leads WHERE estatus='ganado' AND iva_modo IS NULL AND (? IS NULL OR date(fecha_servicio)>=?) AND (? IS NULL OR date(fecha_servicio)<=?)").get(desde,desde,hasta,hasta);
  res.json({resumen,mensual,antiguedad,canales:filas,clientes:clientes.filter(c=>c.nuevo||c.registros||c.servicios).sort((a,b)=>b.contratado-a.contratado),sinFecha,ivaPorDefinir});
}));
app.get('/api/analisis/top-clientes', h((req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.nombre, c.telefono,
      COUNT(l.id) AS servicios_ganados,
      COALESCE(SUM(CASE WHEN l.estatus = 'ganado' THEN l.valor ELSE 0 END), 0) AS valor_ganado
    FROM clientes c
    JOIN leads l ON l.cliente_id = c.id
    WHERE l.estatus = 'ganado'
    GROUP BY c.id
    ORDER BY valor_ganado DESC
    LIMIT 20
  `).all();
  res.json(rows);
}));

app.get('/api/analisis/top-servicios', h((req, res) => {
  const rows = db.prepare(`
    SELECT s.nombre AS servicio_nombre,
      COUNT(l.id) AS total,
      COALESCE(SUM(CASE WHEN l.estatus = 'ganado' THEN l.valor ELSE 0 END), 0) AS valor_ganado
    FROM catalogo_servicios s
    LEFT JOIN leads l ON l.servicio_id = s.id
    WHERE s.activo = 1
    GROUP BY s.id
    ORDER BY total DESC
  `).all();
  res.json(rows);
}));

app.get('/api/analisis/por-canal', h((req, res) => {
  const rows = db.prepare(`
    SELECT ca.id AS canal_id, ca.nombre AS canal_nombre, COUNT(l.id) AS total
    FROM canales ca
    LEFT JOIN leads l ON l.canal_id = ca.id
    GROUP BY ca.id
    ORDER BY total DESC, ca.orden ASC
  `).all();
  res.json(rows);
}));

app.get('/api/analisis/evolucion-mensual', h((req, res) => {
  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) AS mes,
      strftime('%m/%Y', created_at) AS mes_corto,
      SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) AS ganados,
      COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN valor ELSE 0 END), 0) AS ingresos
    FROM leads
    WHERE estatus = 'ganado'
    GROUP BY mes
    ORDER BY mes DESC
    LIMIT 12
  `).all();
  res.json(rows.reverse());
}));

app.get('/api/analisis/resumen-mensual', h((req, res) => {
  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) AS mes,
      strftime('%m/%Y', created_at) AS mes_corto,
      COUNT(*) AS creados,
      SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) AS ganados,
      SUM(CASE WHEN estatus = 'perdido' THEN 1 ELSE 0 END) AS perdidos,
      COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN valor ELSE 0 END), 0) AS ingresos
    FROM leads
    GROUP BY mes
    ORDER BY mes DESC
    LIMIT 12
  `).all();
  res.json(rows.reverse());
}));

// ---------- Respaldo de la base de datos (solo admin) ----------
// SQLite vive en un solo archivo en el disco del servidor: sin un respaldo descargable,
// perder ese disco (o el contenedor, si se aloja en una plataforma sin disco persistente)
// significa perder todo el historial comercial. db.backup() genera una copia consistente
// aunque haya escrituras en curso en ese momento.
app.get('/api/admin/backup', async (req, res) => {
  try {
    if (!req.usuarioSesion || req.usuarioSesion.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede respaldar la base de datos' });
    }
    const nombreArchivo = `saneadren_backup_${hoyMexico()}.db`;
    const destino = path.join(__dirname, '..', nombreArchivo);
    await db.backup(destino);
    res.download(destino, nombreArchivo, () => fs.unlink(destino, () => {}));
  } catch (err) {
    console.error('Error generando respaldo:', err);
    res.status(500).json({ error: 'No se pudo generar el respaldo' });
  }
});

// Red de seguridad final: cualquier error no capturado responde 500 en vez de tumbar el proceso.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo o los datos son demasiado grandes. Divídelos en partes más pequeñas.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Los datos enviados no tienen un formato válido.' });
  console.error('Error no manejado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});
process.on('uncaughtException', err => console.error('uncaughtException (servidor sigue vivo):', err));
process.on('unhandledRejection', err => console.error('unhandledRejection (servidor sigue vivo):', err));

app.listen(PORT, () => console.log(`Saneadren CRM corriendo en http://localhost:${PORT}`));
