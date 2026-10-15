// Cuentas: solo un administrador las crea (no hay registro público). Aquí quedan la verificación del correo
// (para cuentas antiguas) y el restablecimiento de contraseña por correo. Todas estas rutas son públicas (sin sesión), por
// eso cada una tiene límite de intentos y respuestas que no revelan si un correo existe.
const { problemaNombre, hashPassword, problemaPassword, normalizarCorreo, correoPermitido, DOMINIO, hashToken, nuevoToken, limitador } = require('./seguridad');
const correo = require('./correo');

const VIGENCIA_VERIFICACION_MS = 24 * 60 * 60 * 1000;
const VIGENCIA_RESTABLECER_MS = 30 * 60 * 1000;

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
  // Datos internos del servidor (p. ej. la huella de las variables del admin ya aplicadas).
  db.exec("CREATE TABLE IF NOT EXISTS config_servidor (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)");
}

// Administrador desde variables de entorno (ADMIN_USUARIO, ADMIN_CORREO, ADMIN_PASSWORD).
// Las variables del servidor mandan: cada vez que se ESCRIBE un valor nuevo (otro usuario, correo o
// contraseña), al reiniciar se aplica una vez a la cuenta del admin (se crea, se reactiva, se
// confirma su correo y se cierran sus sesiones). Si después se cambia la contraseña desde el CRM,
// reiniciar con las mismas variables NO la sobrescribe. Así quien administra el servidor siempre
// puede recuperar el acceso: basta con poner una contraseña nueva en ADMIN_PASSWORD y reiniciar.
function asegurarAdminInicial(db, { verificarPassword }) {
  const nombre = (process.env.ADMIN_USUARIO || '').trim().replace(/\s+/g, ' '), correo = normalizarCorreo(process.env.ADMIN_CORREO), password = process.env.ADMIN_PASSWORD || '';
  if (!nombre || !correo || !password) {
    if (nombre || correo || password) console.error('[admin inicial] Falta ADMIN_USUARIO, ADMIN_CORREO o ADMIN_PASSWORD; no se aplicó.');
    return;
  }
  const problema = problemaNombre(nombre) || (correoPermitido(correo) ? null : 'ADMIN_CORREO debe ser @' + DOMINIO) || problemaPassword(password, { nombre, correo });
  if (problema) { console.error('[admin inicial] No se aplicó:', problema); return; }

  const huella = `${nombre.toLowerCase()}\n${correo}\n${password}`;
  const marca = db.prepare("SELECT valor FROM config_servidor WHERE clave = 'admin_env'").get();
  const porCorreo = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo);
  const porNombre = db.prepare('SELECT * FROM usuarios WHERE lower(nombre) = lower(?)').get(nombre);
  const existente = porCorreo || porNombre
    || db.prepare("SELECT * FROM usuarios WHERE nombre = 'Admin' AND rol = 'admin' AND correo IS NULL").get();
  const valoresNuevos = !marca || !verificarPassword(huella, marca.valor);
  if (existente && !valoresNuevos && !verificarPassword('1234', existente.password)) {
    console.log(`[admin inicial] "${existente.nombre}" ya está configurado; no se cambia.`);
    return;
  }
  db.transaction(() => {
    let id;
    if (!existente) {
      id = db.prepare("INSERT INTO usuarios (nombre, password, rol, correo, correo_verificado) VALUES (?, ?, 'admin', ?, 1)").run(nombre, hashPassword(password), correo).lastInsertRowid;
    } else {
      // Si el nombre lo usa OTRA cuenta, esa se renombra para que el admin entre con su usuario.
      if (porNombre && porNombre.id !== existente.id) db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(`${porNombre.nombre} (${porNombre.id})`, porNombre.id);
      db.prepare("UPDATE usuarios SET nombre = ?, correo = ?, correo_verificado = 1, password = ?, rol = 'admin', activo = 1, debe_cambiar_password = 0 WHERE id = ?").run(nombre, correo, hashPassword(password), existente.id);
      db.prepare('DELETE FROM tokens_cuenta WHERE usuario_id = ?').run(existente.id);
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(existente.id);
      id = existente.id;
    }
    db.prepare("INSERT INTO config_servidor (clave, valor) VALUES ('admin_env', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(hashPassword(huella));
    console.log(`[admin inicial] ${existente ? 'Configurado' : 'Creado'} "${nombre}" (${correo}), id ${id}.`);
  })();
}

// Usuario de prueba desde variables de entorno (USUARIO_PRUEBA_NOMBRE, USUARIO_PRUEBA_PASSWORD y,
// opcionales, USUARIO_PRUEBA_ROL y USUARIO_PRUEBA_CORREO). Útil en un servidor de pruebas cuya base se
// borra en cada despliegue. La contraseña NUNCA va en el código (el repositorio es público).
// Igual que el admin inicial: solo se crea si no existe; si ya existe no se toca su contraseña.
// Mismo mecanismo para más usuarios fijos: USUARIO_2_* (por defecto "Luis Perea"; solo se crea
// cuando se define USUARIO_2_PASSWORD en el servidor, nunca con una contraseña escrita en el código).
function asegurarUsuarioPrueba(db, prefijo = 'USUARIO_PRUEBA', nombrePorDefecto = '') {
  const env = k => process.env[prefijo + '_' + k];
  const nombre = (env('NOMBRE') || nombrePorDefecto).trim().replace(/\s+/g, ' '), password = env('PASSWORD') || '';
  if (!nombre || !password) return;
  const rol = (env('ROL') || 'ventas').trim().toLowerCase();
  const correo = env('CORREO') ? normalizarCorreo(env('CORREO')) : null;
  const problema = problemaNombre(nombre)
    || (['admin', 'ventas', 'atencion', 'tecnico', 'costos'].includes(rol) ? null : prefijo + '_ROL debe ser admin, ventas, atencion, tecnico o costos')
    || (correo && !correoPermitido(correo) ? prefijo + '_CORREO debe ser @' + DOMINIO : null)
    || problemaPassword(password, { nombre, correo: correo || '' });
  if (problema) { console.error(`[usuario ${nombre}] No se aplicó:`, problema); return; }
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
  asegurarUsuarioPrueba(db, 'USUARIO_2', 'Luis Perea');
  db.prepare('DELETE FROM tokens_cuenta WHERE expira < ? OR usado = 1').run(Date.now() - VIGENCIA_VERIFICACION_MS);

  const porIp = (max, minutos) => limitador({ max, ventanaMs: minutos * 60000, clave: req => req.ipCliente || req.ip });
  const porCorreo = (max, minutos) => limitador({ max, ventanaMs: minutos * 60000, clave: req => normalizarCorreo(req.body?.correo) || req.ipCliente || req.ip,
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

  // Las cuentas solo las crea un administrador (Ajustes → Usuarios). La ruta pública de registro queda
  // cerrada y lo dice claro, aunque alguien la llame directamente desde fuera del CRM.
  app.post('/api/registro', porIp(20, 60), h((req, res) => {
    res.status(403).json({ error: 'Las cuentas las crea un administrador. Pídele a tu administrador que te dé de alta.' });
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
    app.locals.auditoria?.registrar({ usuarioSesion: { id: usuario.id, nombre: usuario.nombre } }, 'usuario', usuario.id, 'contraseña', 'Restableció su contraseña con el enlace del correo');
    if (usuario.correo) enviarSinBloquear(usuario.correo, 'Tu contraseña cambió · Saneadren CRM', {
      titulo: 'Tu contraseña cambió', saludo: `Hola ${usuario.nombre}:`,
      mensaje: 'La contraseña de tu cuenta del CRM se cambió correctamente y se cerraron tus sesiones abiertas.',
      pie: 'Si no fuiste tú, avisa de inmediato al administrador del sistema.'
    });
    res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión con la nueva.' });
  }));
};
module.exports.migrarCuentas = migrarCuentas;
