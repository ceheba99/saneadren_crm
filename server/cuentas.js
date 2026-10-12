// Autoservicio de cuentas: registro con correo @saneadren.com.mx, verificación del correo y
// restablecimiento de contraseña por correo. Todas estas rutas son públicas (sin sesión), por
// eso cada una tiene límite de intentos y respuestas que no revelan si un correo existe.
const { problemaNombre, hashPassword, problemaPassword, normalizarCorreo, correoPermitido, DOMINIO, hashToken, nuevoToken, limitador } = require('./seguridad');
const correo = require('./correo');

const VIGENCIA_VERIFICACION_MS = 24 * 60 * 60 * 1000;
const VIGENCIA_RESTABLECER_MS = 30 * 60 * 1000;
const ROL_REGISTRO = 'ventas'; // rol con el que entra quien se registra solo; un admin puede cambiarlo

// Columnas y tablas de cuentas (también lo usa herramientas/configurar-admin.js).
function migrarCuentas(db) {
  const columnas = db.prepare('PRAGMA table_info(usuarios)').all().map(c => c.name);
  if (!columnas.includes('correo')) db.exec('ALTER TABLE usuarios ADD COLUMN correo TEXT');
  if (!columnas.includes('correo_verificado')) db.exec('ALTER TABLE usuarios ADD COLUMN correo_verificado INTEGER NOT NULL DEFAULT 0');
  // Se marca al iniciar sesión con una contraseña que ya no cumple la política (p. ej. el '1234'
  // inicial): la sesión solo sirve para cambiarla hasta que lo haga.
  if (!columnas.includes('debe_cambiar_password')) db.exec('ALTER TABLE usuarios ADD COLUMN debe_cambiar_password INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_correo ON usuarios(correo) WHERE correo IS NOT NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS tokens_cuenta (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK(tipo IN ('verificar','restablecer')),
    expira INTEGER NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0
  )`);
}

// Administrador inicial desde variables de entorno (ADMIN_USUARIO, ADMIN_CORREO, ADMIN_PASSWORD).
// Pensado para servidores como Render, donde la base nace con usuarios de ejemplo bloqueados.
// Solo fija la contraseña si la cuenta no existe o sigue con la inicial '1234': si después se
// cambia desde el CRM, reiniciar el servidor NO la sobrescribe.
function asegurarAdminInicial(db, { verificarPassword }) {
  const nombre = (process.env.ADMIN_USUARIO || '').trim(), correo = normalizarCorreo(process.env.ADMIN_CORREO), password = process.env.ADMIN_PASSWORD || '';
  if (!nombre || !correo || !password) return;
  const problema = problemaNombre(nombre) || (correoPermitido(correo) ? null : 'ADMIN_CORREO debe ser @' + DOMINIO) || problemaPassword(password, { nombre, correo });
  if (problema) { console.error('[admin inicial] No se aplicó:', problema); return; }
  const existente = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo)
    || db.prepare('SELECT * FROM usuarios WHERE lower(nombre) = lower(?)').get(nombre)
    || db.prepare("SELECT * FROM usuarios WHERE nombre = 'Admin' AND rol = 'admin' AND correo IS NULL").get();
  if (!existente) {
    db.prepare("INSERT INTO usuarios (nombre, password, rol, correo, correo_verificado) VALUES (?, ?, 'admin', ?, 1)").run(nombre, hashPassword(password), correo);
    console.log(`[admin inicial] Creado "${nombre}" (${correo}).`);
  } else if (verificarPassword('1234', existente.password)) {
    db.prepare("UPDATE usuarios SET nombre = ?, correo = ?, correo_verificado = 1, password = ?, rol = 'admin', activo = 1, debe_cambiar_password = 0 WHERE id = ?").run(nombre, correo, hashPassword(password), existente.id);
    console.log(`[admin inicial] Configurado "${nombre}" (${correo}).`);
  }
}

// Usuario de prueba desde variables de entorno (USUARIO_PRUEBA_NOMBRE, USUARIO_PRUEBA_PASSWORD y,
// opcionales, USUARIO_PRUEBA_ROL y USUARIO_PRUEBA_CORREO). Útil en un servidor de pruebas cuya base se
// borra en cada despliegue. La contraseña NUNCA va en el código (el repositorio es público).
// Igual que el admin inicial: solo se crea si no existe; si ya existe no se toca su contraseña.
function asegurarUsuarioPrueba(db) {
  const nombre = (process.env.USUARIO_PRUEBA_NOMBRE || '').trim().replace(/\s+/g, ' '), password = process.env.USUARIO_PRUEBA_PASSWORD || '';
  if (!nombre || !password) return;
  const rol = (process.env.USUARIO_PRUEBA_ROL || 'ventas').trim().toLowerCase();
  const correo = process.env.USUARIO_PRUEBA_CORREO ? normalizarCorreo(process.env.USUARIO_PRUEBA_CORREO) : null;
  const problema = problemaNombre(nombre)
    || (['admin', 'ventas', 'atencion', 'tecnico'].includes(rol) ? null : 'USUARIO_PRUEBA_ROL debe ser admin, ventas, atencion o tecnico')
    || (correo && !correoPermitido(correo) ? 'USUARIO_PRUEBA_CORREO debe ser @' + DOMINIO : null)
    || problemaPassword(password, { nombre, correo: correo || '' });
  if (problema) { console.error('[usuario de prueba] No se aplicó:', problema); return; }
  const existente = db.prepare('SELECT id FROM usuarios WHERE lower(nombre) = lower(?)').get(nombre)
    || (correo ? db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo) : null);
  if (existente) return;
  db.prepare('INSERT INTO usuarios (nombre, password, rol, correo, correo_verificado) VALUES (?, ?, ?, ?, ?)').run(nombre, hashPassword(password), rol, correo, correo ? 1 : 0);
  console.log(`[usuario de prueba] Creado "${nombre}" con rol ${rol}.`);
}

module.exports = function cuentas(app, db, h, { sesiones, urlBase }) {
  migrarCuentas(db);
  asegurarAdminInicial(db, require('./seguridad'));
  asegurarUsuarioPrueba(db);
  db.prepare('DELETE FROM tokens_cuenta WHERE expira < ? OR usado = 1').run(Date.now() - VIGENCIA_VERIFICACION_MS);

  const porIp = (max, minutos) => limitador({ max, ventanaMs: minutos * 60000, clave: req => req.ip });
  const porCorreo = (max, minutos) => limitador({ max, ventanaMs: minutos * 60000, clave: req => normalizarCorreo(req.body?.correo) || req.ip,
    mensaje: 'Ya enviamos varios correos a esta dirección. Revisa tu bandeja (y spam) o intenta más tarde.' });

  // Un token nuevo invalida los anteriores del mismo tipo: solo el último enlace enviado sirve.
  function emitirToken(usuarioId, tipo) {
    const token = nuevoToken();
    db.transaction(() => {
      db.prepare('DELETE FROM tokens_cuenta WHERE usuario_id = ? AND tipo = ?').run(usuarioId, tipo);
      db.prepare('INSERT INTO tokens_cuenta (token_hash, usuario_id, tipo, expira) VALUES (?, ?, ?, ?)')
        .run(hashToken(token), usuarioId, tipo, Date.now() + (tipo === 'verificar' ? VIGENCIA_VERIFICACION_MS : VIGENCIA_RESTABLECER_MS));
    })();
    return token;
  }
  // Consume el token (un solo uso). Devuelve el usuario o null si no es válido / expiró.
  function consumirToken(token, tipo) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    return db.transaction(() => {
      const fila = db.prepare('SELECT * FROM tokens_cuenta WHERE token_hash = ? AND tipo = ?').get(hashToken(token), tipo);
      if (!fila || fila.usado || fila.expira < Date.now()) return null;
      db.prepare('UPDATE tokens_cuenta SET usado = 1 WHERE token_hash = ?').run(fila.token_hash);
      return db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(fila.usuario_id) || null;
    })();
  }
  // El enlace se arma con APP_URL (configuración), nunca con el encabezado Host de la petición:
  // así nadie puede hacer que el correo apunte a un sitio suyo. El token va después de "#" para
  // que no quede en bitácoras de servidores ni proxies.
  const enlace = (accion, token) => `${urlBase}/#${accion}=${encodeURIComponent(token)}`;
  const enviarSinBloquear = (...args) => correo.enviar(...args).catch(err => console.error('No se pudo enviar el correo:', err.message));

  function enviarVerificacion(usuario) {
    return enviarSinBloquear(usuario.correo, 'Confirma tu correo · Saneadren CRM', {
      titulo: 'Confirma tu correo', saludo: `Hola ${usuario.nombre}:`,
      mensaje: 'Recibimos una solicitud para crear tu cuenta en el CRM de Saneadren. Confirma que este correo es tuyo para poder iniciar sesión. El enlace vence en 24 horas.',
      boton: 'Confirmar mi correo', enlace: enlace('verificar', emitirToken(usuario.id, 'verificar')),
      pie: 'Si tú no solicitaste esta cuenta, ignora este mensaje; la cuenta no se activará.'
    });
  }

  const RESPUESTA_REGISTRO = { ok: true, mensaje: 'Si el correo es válido, te enviamos un enlace para confirmar tu cuenta. Revisa tu bandeja de entrada (y spam).' };

  app.post('/api/registro', porIp(20, 60), porCorreo(3, 60), h((req, res) => {
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim().replace(/\s+/g, ' ') : '';
    const email = normalizarCorreo(req.body.correo);
    const password = req.body.password;
    const problemaN = problemaNombre(nombre);
    if (problemaN) return res.status(400).json({ error: problemaN });
    if (!correoPermitido(email)) return res.status(400).json({ error: `Solo se pueden registrar correos @${DOMINIO}` });
    const problema = problemaPassword(password, { nombre, correo: email });
    if (problema) return res.status(400).json({ error: problema });

    const existente = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(email);
    if (existente) {
      // No se revela si el correo ya tenía cuenta: se responde igual y se avisa por correo al dueño.
      if (existente.activo && !existente.correo_verificado) enviarVerificacion(existente);
      else if (existente.activo) enviarSinBloquear(email, 'Ya tienes una cuenta · Saneadren CRM', {
        titulo: 'Ya tienes una cuenta', saludo: `Hola ${existente.nombre}:`,
        mensaje: 'Alguien intentó registrar de nuevo este correo. Tu cuenta ya existe; si olvidaste tu contraseña, usa la opción "¿Olvidaste tu contraseña?" en la pantalla de inicio de sesión.',
        pie: 'Si no fuiste tú, puedes ignorar este mensaje; tu cuenta no cambió.'
      });
      return res.status(202).json(RESPUESTA_REGISTRO);
    }
    if (db.prepare('SELECT id FROM usuarios WHERE lower(nombre) = lower(?)').get(nombre)) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre; agrega tu apellido para distinguirte' });
    }
    const info = db.prepare('INSERT INTO usuarios (nombre, password, rol, correo, correo_verificado) VALUES (?, ?, ?, ?, 0)')
      .run(nombre, hashPassword(password), ROL_REGISTRO, email);
    enviarVerificacion({ id: info.lastInsertRowid, nombre, correo: email });
    res.status(202).json(RESPUESTA_REGISTRO);
  }));

  app.post('/api/verificar-correo', porIp(20, 15), h((req, res) => {
    const usuario = consumirToken(req.body.token, 'verificar');
    if (!usuario) return res.status(400).json({ error: 'El enlace no es válido o ya venció. Regístrate de nuevo con el mismo correo para recibir otro.' });
    db.prepare('UPDATE usuarios SET correo_verificado = 1 WHERE id = ?').run(usuario.id);
    res.json({ ok: true, mensaje: 'Correo confirmado. Ya puedes iniciar sesión.' });
  }));

  const RESPUESTA_OLVIDE = { ok: true, mensaje: 'Si el correo pertenece a una cuenta activa, te enviamos un enlace para restablecer la contraseña. Vence en 30 minutos.' };
  app.post('/api/olvide-password', porIp(10, 15), porCorreo(3, 15), h((req, res) => {
    const email = normalizarCorreo(req.body.correo);
    const usuario = correoPermitido(email) ? db.prepare('SELECT * FROM usuarios WHERE correo = ? AND activo = 1').get(email) : null;
    if (usuario) enviarSinBloquear(email, 'Restablece tu contraseña · Saneadren CRM', {
      titulo: 'Restablecer contraseña', saludo: `Hola ${usuario.nombre}:`,
      mensaje: 'Recibimos una solicitud para cambiar la contraseña de tu cuenta del CRM. El enlace sirve una sola vez y vence en 30 minutos. Al cambiarla se cerrarán todas tus sesiones abiertas.',
      boton: 'Crear contraseña nueva', enlace: enlace('restablecer', emitirToken(usuario.id, 'restablecer')),
      pie: 'Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue funcionando.'
    });
    res.json(RESPUESTA_OLVIDE); // misma respuesta exista o no el correo
  }));

  app.post('/api/restablecer-password', porIp(10, 15), h((req, res) => {
    const fila = typeof req.body.token === 'string' ? db.prepare("SELECT u.nombre, u.correo FROM tokens_cuenta t JOIN usuarios u ON u.id = t.usuario_id WHERE t.token_hash = ? AND t.tipo = 'restablecer'").get(hashToken(req.body.token)) : null;
    const problema = problemaPassword(req.body.password, { nombre: fila?.nombre || '', correo: fila?.correo || '' });
    if (problema) return res.status(400).json({ error: problema });
    const usuario = consumirToken(req.body.token, 'restablecer');
    if (!usuario) return res.status(400).json({ error: 'El enlace no es válido, ya se usó o venció. Solicita uno nuevo.' });
    db.transaction(() => {
      // Abrir el enlace prueba que el correo es suyo, así que también queda verificado.
      db.prepare('UPDATE usuarios SET password = ?, correo_verificado = 1, debe_cambiar_password = 0 WHERE id = ?').run(hashPassword(req.body.password), usuario.id);
      db.prepare("DELETE FROM tokens_cuenta WHERE usuario_id = ? AND tipo = 'restablecer'").run(usuario.id);
      sesiones.revocarUsuario(usuario.id);
    })();
    if (usuario.correo) enviarSinBloquear(usuario.correo, 'Tu contraseña cambió · Saneadren CRM', {
      titulo: 'Tu contraseña cambió', saludo: `Hola ${usuario.nombre}:`,
      mensaje: 'La contraseña de tu cuenta del CRM se cambió correctamente y se cerraron tus sesiones abiertas.',
      pie: 'Si no fuiste tú, avisa de inmediato al administrador del sistema.'
    });
    res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión con la nueva.' });
  }));
};
module.exports.migrarCuentas = migrarCuentas;
