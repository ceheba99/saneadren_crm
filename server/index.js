const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, normalizarTelefono } = require('./db');

// ---------- Contraseñas (hash + verificación) ----------
// Antes las contraseñas se guardaban y comparaban en texto plano. Ahora se
// almacenan como "salt:hash" usando scrypt. verificarPassword() sigue
// aceptando contraseñas antiguas en texto plano (compatibilidad con datos
// existentes) y, si el login es correcto, la re-guarda ya cifrada.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verificarPassword(password, guardado) {
  if (!guardado) return false;
  if (guardado.includes(':')) {
    const [salt, hash] = guardado.split(':');
    const intento = crypto.scryptSync(password, salt, 64).toString('hex');
    const bufGuardado = Buffer.from(hash, 'hex');
    const bufIntento = Buffer.from(intento, 'hex');
    if (bufGuardado.length !== bufIntento.length) return false;
    return crypto.timingSafeEqual(bufGuardado, bufIntento);
  }
  // Contraseña heredada sin cifrar (p. ej. el '1234' de seed inicial)
  return guardado === password;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Sesiones (token) ----------
// Antes, cada acción "solo admin" confiaba en un solicitante_id que mandaba el propio navegador:
// bastaba con adivinar o inspeccionar el id de un admin para colarlo en el body y saltarse el login
// por completo. Ahora, /login entrega un token opaco; ese token es lo único que identifica al usuario
// en cada petición (vía encabezado Authorization), y las rutas leen req.usuarioSesion en vez de creer
// cualquier id que venga en el body.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas de inactividad
const sesiones = new Map(); // token -> { usuarioId, expira }
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
  const usuario = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE id = ? AND activo = 1').get(sesion.usuarioId);
  if (!usuario) { sesiones.delete(token); return res.status(401).json({ error: 'Usuario no válido' }); }
  sesion.expira = Date.now() + SESSION_TTL_MS; // renueva la sesión mientras siga activo
  req.usuarioSesion = usuario;
  next();
}
// Protección básica contra fuerza bruta en /login: bloquea por combinación IP+usuario
// tras varios intentos fallidos seguidos. No sustituye un WAF, pero detiene los intentos triviales.
const intentosLogin = new Map(); // clave "ip|usuario" -> { fallos, bloqueadoHasta }
const LOGIN_MAX_INTENTOS = 6;
const LOGIN_BLOQUEO_MS = 5 * 60 * 1000;
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
        return res.status(400).json({ error: 'Datos inválidos (referencia inexistente o restricción de base de datos)', detalle: err.message });
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
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  requireAuth(req, res, next);
});

require('./prospeccion')(app,db,h);

// ---------- Catálogos ----------
app.get('/api/usuarios', h((req, res) => {
  res.json(db.prepare('SELECT id, nombre, rol, activo FROM usuarios WHERE activo = 1 ORDER BY nombre').all());
}));

// ---------- Login ----------
app.post('/api/login', limitarLogin, h((req, res) => {
  const { nombre, password } = req.body;
  if (!nombre || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const usuario = db.prepare('SELECT * FROM usuarios WHERE nombre = ? AND activo = 1').get(nombre);
  if (!usuario || !verificarPassword(password, usuario.password)) {
    registrarLoginFallido(req);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  limpiarLoginFallidos(req);
  // Migración transparente: si la contraseña seguía en texto plano, se re-guarda cifrada.
  if (!usuario.password.includes(':')) {
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hashPassword(password), usuario.id);
  }
  const token = crearSesion(usuario.id);
  res.json({ token, id: usuario.id, nombre: usuario.nombre, rol: usuario.rol });
}));
app.post('/api/logout', h((req, res) => {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  if (token) sesiones.delete(token);
  res.json({ ok: true });
}));

// ---------- Crear usuario (solo admin) ----------
app.post('/api/usuarios', h((req, res) => {
  const { nombre, password, rol } = req.body;
  if (req.usuarioSesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (!['admin', 'ventas', 'atencion', 'tecnico'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

  const existente = db.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(nombre.trim());
  if (existente) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });

  const info = db.prepare('INSERT INTO usuarios (nombre, password, rol) VALUES (?, ?, ?)').run(nombre.trim(), hashPassword(password), rol);
  res.status(201).json({ id: info.lastInsertRowid, nombre: nombre.trim(), rol });
}));

app.get('/api/servicios', h((req, res) => {
  res.json(db.prepare('SELECT * FROM catalogo_servicios WHERE activo = 1 ORDER BY orden').all());
})); 
/* ---------- Eliminar usuario (soft delete, solo admin) ---------- */
app.delete('/api/usuarios/:id', h((req, res) => {
  if (req.usuarioSesion.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo un administrador puede eliminar usuarios' });
  }
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (usuario.rol === 'admin') {
    const totalAdmins = db.prepare('SELECT COUNT(*) c FROM usuarios WHERE rol = ? AND activo = 1').get('admin').c;
    if (totalAdmins <= 1) {
      return res.status(400).json({ error: 'No puedes eliminar el último administrador del sistema' });
    }
  }
  /* Soft delete: marcar como inactivo en lugar de borrar físicamente.
     Esto preserva el historial de quién creó/atendió cada lead. */
  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(req.params.id);
  /* Opcional: reasignar leads abiertos a un usuario "Sin asignar" o al admin.
  db.prepare('UPDATE leads SET responsable_id = ? WHERE responsable_id = ? AND estatus = ?')
    .run(solicitante_id, req.params.id, 'abierto'); */
  res.json({ ok: true, id: Number(req.params.id), nombre: usuario.nombre });
}));

// Ajustar la recurrencia sugerida de un servicio (cada cuántos días conviene recontactar
// al cliente para volver a ofrecérselo). Solo admin, igual que la creación de usuarios.
app.put('/api/servicios/:id', h((req, res) => {
  const { dias_recurrencia } = req.body;
  if (req.usuarioSesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede editar el catálogo de servicios' });
  const servicio = db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(req.params.id);
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
  let dias = null;
  if (dias_recurrencia !== null && dias_recurrencia !== '' && dias_recurrencia !== undefined) {
    dias = Number(dias_recurrencia);
    if (isNaN(dias) || dias <= 0) return res.status(400).json({ error: 'Los días de recurrencia deben ser un número mayor a 0 (o vacío para servicio de una sola vez)' });
  }
  if (req.body.descripcion !== undefined && (typeof req.body.descripcion !== 'string' || req.body.descripcion.length > 10000)) return res.status(400).json({ error: 'La descripción debe ser texto de hasta 10000 caracteres' });
  db.prepare('UPDATE catalogo_servicios SET dias_recurrencia = ?, descripcion = ? WHERE id = ?').run(dias_recurrencia === undefined ? servicio.dias_recurrencia : dias, req.body.descripcion === undefined ? servicio.descripcion : req.body.descripcion.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(req.params.id));
}));

// Agregar un servicio nuevo al catálogo (solo admin).
app.post('/api/servicios', h((req, res) => {
  const { nombre, dias_recurrencia } = req.body;
  if (req.usuarioSesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede agregar servicios' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del servicio es requerido' });
  const existente = db.prepare('SELECT id FROM catalogo_servicios WHERE nombre = ?').get(nombre.trim());
  if (existente) return res.status(409).json({ error: 'Ya existe un servicio con ese nombre' });
  let dias = null;
  if (dias_recurrencia !== null && dias_recurrencia !== '' && dias_recurrencia !== undefined) {
    dias = Number(dias_recurrencia);
    if (isNaN(dias) || dias <= 0) return res.status(400).json({ error: 'Los días de recurrencia deben ser un número mayor a 0 (o vacío para servicio de una sola vez)' });
  }
  const orden = (db.prepare('SELECT MAX(orden) m FROM catalogo_servicios').get().m || 0) + 1;
  if (req.body.descripcion !== undefined && (typeof req.body.descripcion !== 'string' || req.body.descripcion.length > 10000)) return res.status(400).json({ error: 'La descripción debe ser texto de hasta 10000 caracteres' });
  const info = db.prepare('INSERT INTO catalogo_servicios (nombre, orden, dias_recurrencia, descripcion) VALUES (?, ?, ?, ?)').run(nombre.trim(), orden, dias, (req.body.descripcion || '').trim());
  res.status(201).json(db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(info.lastInsertRowid));
}));

app.get('/api/tipos-cliente', h((req,res)=>res.json(db.prepare('SELECT * FROM tipos_cliente ORDER BY nombre').all())));
app.post('/api/tipos-cliente', h((req,res)=>{
  if(req.usuarioSesion.rol!=='admin')return res.status(403).json({error:'Solo un administrador puede modificar los tipos de cliente'});
  const nombre=typeof req.body.nombre==='string'?req.body.nombre.trim():'';
  if(!nombre || nombre.length>80)return res.status(400).json({error:'Escribe un nombre de hasta 80 caracteres'});
  if(db.prepare('SELECT clave FROM tipos_cliente WHERE nombre = ?').get(nombre))return res.status(409).json({error:'Ya existe ese tipo de cliente'});
  const clave=crypto.randomUUID();db.prepare('INSERT INTO tipos_cliente (clave,nombre) VALUES (?,?)').run(clave,nombre);
  res.status(201).json({clave,nombre});
}));
app.put('/api/tipos-cliente/:clave', h((req,res)=>{
  if(req.usuarioSesion.rol!=='admin')return res.status(403).json({error:'Solo un administrador puede modificar los tipos de cliente'});
  const nombre=typeof req.body.nombre==='string'?req.body.nombre.trim():'';
  if(!nombre || nombre.length>80)return res.status(400).json({error:'Escribe un nombre de hasta 80 caracteres'});
  if(!db.prepare('SELECT clave FROM tipos_cliente WHERE clave = ?').get(req.params.clave))return res.status(404).json({error:'Tipo no encontrado'});
  if(db.prepare('SELECT clave FROM tipos_cliente WHERE nombre = ? AND clave <> ?').get(nombre,req.params.clave))return res.status(409).json({error:'Ya existe ese tipo de cliente'});
  db.prepare('UPDATE tipos_cliente SET nombre = ? WHERE clave = ?').run(nombre,req.params.clave);res.json({clave:req.params.clave,nombre});
}));
app.get('/api/canales', h((req, res) => {
  res.json(db.prepare('SELECT * FROM canales ORDER BY orden').all());
}));

// Agregar un canal nuevo (solo admin).
app.post('/api/canales', h((req, res) => {
  const { nombre } = req.body;
  if (req.usuarioSesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede agregar canales' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del canal es requerido' });
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
  const cliente = db.prepare('SELECT * FROM clientes WHERE telefono_normalizado = ?').get(norm);
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
  const { etapa, responsable_id, estatus, q, desde, hasta } = req.query;
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
  sql += ' ORDER BY l.updated_at DESC';
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
  res.json({
    ...lead, otras_solicitudes,
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
function validarPartidas(req,res,next){
  if(req.body.partidas_json===undefined)return next();
  let items;try{items=JSON.parse(req.body.partidas_json);}catch{return res.status(400).json({error:'Partidas inválidas'});}
  if(!Array.isArray(items)||!items.length||items.length>100||items.some(i=>!i||typeof i.servicio!=='string'||!i.servicio.trim()||typeof i.leyenda!=='string'||i.leyenda.length>10000||typeof i.importe!=='number'||!Number.isFinite(i.importe)||i.importe<0||i.importe>1e12))return res.status(400).json({error:'Revisa servicios, descripciones e importes'});
  if(items.some(i=>!db.prepare('SELECT id FROM catalogo_servicios WHERE nombre = ?').get(i.servicio)))return res.status(400).json({error:'Todas las partidas deben tener un servicio del catálogo'});
  const primero=db.prepare('SELECT id FROM catalogo_servicios WHERE nombre = ?').get(items[0].servicio);
  if(!primero)return res.status(400).json({error:'Selecciona un servicio del catálogo'});
  req.body.servicio_id=primero.id;req.body.valor=items.reduce((t,i)=>t+Math.round(i.importe*100),0)/100;req.body.partidas_json=JSON.stringify(items);next();
}
app.post('/api/leads', validarPartidas, validarRegistro, h((req, res) => {
  let { telefono, nombre, empresa_contacto, direccion } = req.body;
  const { cliente_id, canal_id, servicio_id, notas_iniciales, responsable_id, forzar_duplicado, valor, fecha_servicio, correo, giro } = req.body;
  const creado_por = req.usuarioSesion.nombre; // nunca se confía en el valor que mande el navegador
  if (!validarCorreo(correo)) return res.status(400).json({ error: 'El correo electrónico no es válido' });
  if (giro && !tipoClienteValido(giro)) return res.status(400).json({ error: 'Giro inválido' });
  const contactoElegido = cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id) : null;
  if (cliente_id && !contactoElegido) return res.status(404).json({error:'Contacto no encontrado'});
  if (contactoElegido) { telefono=contactoElegido.telefono;nombre=contactoElegido.nombre;empresa_contacto=contactoElegido.empresa_contacto; }
  if (!responsable_id || !db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').get(responsable_id)) return res.status(400).json({error:'Selecciona un responsable activo'});
  let { estatus } = req.body;
  if (!telefono) return res.status(400).json({ error: 'Teléfono requerido' });
  const norm = normalizarTelefono(telefono);
  if (norm.length < 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del contacto es requerido' });
  if (!direccion || !direccion.trim()) return res.status(400).json({ error: 'La dirección es requerida' });
  if (valor !== undefined && valor !== null && (isNaN(Number(valor)) || Number(valor) < 0)) {
    return res.status(400).json({ error: 'El valor debe ser un número mayor o igual a 0' });
  }
  // Permite registrar un servicio ya confirmado directamente (estatus 'ganado') (p. ej. una recompra de un cliente
  // existente) sin que pase por el pipeline de leads. Por defecto sigue siendo 'abierto'.
  if (estatus !== undefined && !['abierto', 'ganado'].includes(estatus)) {
    return res.status(400).json({ error: 'Estatus inválido: use "abierto" para cotizaciones o "ganado" para servicios directos' });
  }
  if (!servicio_id) return res.status(400).json({error:'Selecciona un servicio para crear la cotización'});
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

  let cliente = contactoElegido || db.prepare('SELECT * FROM clientes WHERE telefono_normalizado = ?').get(norm);

  if (cliente && !forzar_duplicado) {
    const abierta = db.prepare(`SELECT id FROM leads WHERE cliente_id = ? AND estatus = 'abierto' LIMIT 1`).get(cliente.id);
    if (abierta) return res.status(409).json({ error: 'duplicado', lead_id: abierta.id });
  }

  if(req.body.establecimiento_id && !db.prepare("SELECT id FROM establecimientos WHERE id=? AND cliente_id=? AND estado<>'no_contactar'").get(req.body.establecimiento_id,cliente_id))return res.status(400).json({error:'El establecimiento no está vinculado a este contacto o está marcado como no contactar'});
  const creado=db.transaction(()=>{
  if (!cliente) {
    const infoC = db.prepare(`INSERT INTO clientes (telefono, telefono_normalizado, nombre, empresa_contacto, direccion, correo, giro)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(telefono, norm, nombre || null, empresa_contacto || null, direccion || null, correo?.trim() || null, giro || null);
    cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(infoC.lastInsertRowid);
  }


  // El responsable es siempre el usuario que inició sesión, no depende del canal.
  if (!responsable_id) return res.status(400).json({ error: 'Falta el usuario responsable (sesión no válida)' });
  const resp = responsable_id;

  const info = db.prepare(`
    INSERT INTO leads (cliente_id, telefono, telefono_normalizado, nombre, empresa_contacto, direccion, canal_id, servicio_id, responsable_id, notas_iniciales, creado_por, valor, fecha_servicio, estatus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cliente.id, telefono, norm,
    cliente.nombre || null,
    cliente.empresa_contacto || null,
    direccion || cliente.direccion || null,
    canal_id || null, servicio_id || null, resp || null, notas_iniciales || null, creado_por || null,
    valor !== undefined && valor !== null ? Number(valor) : null,
    fechaServicioFinal,
    estatus
  );

  if(req.body.partidas_json!==undefined)db.prepare('UPDATE leads SET partidas_json = ? WHERE id = ?').run(req.body.partidas_json,info.lastInsertRowid);
  if(req.body.establecimiento_id)db.prepare('UPDATE leads SET establecimiento_id=? WHERE id=?').run(req.body.establecimiento_id,info.lastInsertRowid);
  // Crear una cotización nunca modifica los datos maestros del contacto.

  return db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  })();
  res.status(201).json(creado);
}));

// ---------- Editar lead (datos, etapa, responsable, estatus) ----------
app.put('/api/leads/:id', validarPartidas, validarRegistro, h((req, res) => {
  const id = req.params.id;
  const actual = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!actual) return res.status(404).json({ error: 'Cotización no encontrada' });

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
  if ((req.body.estatus || actual.estatus) === 'ganado') {
    const valorEfectivo = req.body.valor !== undefined ? req.body.valor : actual.valor;
    if (valorEfectivo === null || valorEfectivo === undefined || valorEfectivo === '') {
      return res.status(400).json({ error: 'Se requiere el costo del servicio para cerrar la cotización como ganada' });
    }
    if (!(req.body.fecha_servicio !== undefined ? req.body.fecha_servicio : actual.fecha_servicio)) return res.status(400).json({error:'Indica la fecha acordada del servicio'});
    if (!(req.body.servicio_id !== undefined ? req.body.servicio_id : actual.servicio_id)) return res.status(400).json({error:'Selecciona el servicio que se contratará'});
    if (!String(req.body.direccion !== undefined ? req.body.direccion : actual.direccion || '').trim()) return res.status(400).json({error:'Indica la ubicación del servicio'});
  }

  if(actual.partidas_json && req.body.partidas_json===undefined && (req.body.valor!==undefined || req.body.servicio_id!==undefined)){
    const partidas=JSON.parse(actual.partidas_json),total=partidas.reduce((t,i)=>t+Math.round(i.importe*100),0)/100;
    if((req.body.valor!==undefined && req.body.valor!==total)||(req.body.servicio_id!==undefined && Number(req.body.servicio_id)!==actual.servicio_id))return res.status(400).json({error:'Edita las partidas de la cotización para cambiar su importe o servicio'});
  }
  if (['nombre','telefono','empresa_contacto'].some(c=>req.body[c]!==undefined)) return res.status(400).json({error:'Edita los datos de contacto desde su ficha; esta acción modifica solo la cotización o servicio.'});

  const campos = ['partidas_json', 'direccion', 'canal_id', 'servicio_id', 'responsable_id', 'etapa', 'estatus', 'valor', 'fecha_servicio', 'notas_iniciales'];
  const set = [];
  const params = [];
  campos.forEach(c => {
    if (req.body[c] !== undefined) { set.push(`${c} = ?`); params.push(req.body[c]); }
  });
  if (set.length === 0) return res.status(400).json({ error: 'Sin cambios' });
  set.push("updated_at = datetime('now','localtime')");
  params.push(id);

  db.prepare(`UPDATE leads SET ${set.join(', ')} WHERE id = ?`).run(...params);



  if (req.body.estatus !== undefined && req.body.estatus !== actual.estatus) {
    // Una cotización cerrada (ganada o perdida) ya no necesita recordatorios de seguimiento pendientes:
    // se resuelven solos para no dejar tareas obsoletas en la vista de Alertas.
    if (req.body.estatus === 'ganado' || req.body.estatus === 'perdido') {
      db.prepare(`UPDATE historial SET resuelta = 1 WHERE lead_id = ? AND tipo = 'alerta' AND resuelta = 0`).run(id);
    }
  }
  res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(id));
}));

// ---------- Historial: observaciones y alertas ----------
app.post('/api/leads/:id/historial', h((req, res) => {
  const { tipo, texto, fecha_alerta } = req.body;
  const usuario = req.usuarioSesion.nombre; // nunca se confía en el valor que mande el navegador
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto requerido' });
  const tipoFinal = tipo || 'observacion';
  if (!['observacion', 'alerta'].includes(tipoFinal)) return res.status(400).json({ error: 'Tipo inválido' });
  if (tipoFinal === 'alerta' && !fecha_alerta) return res.status(400).json({ error: 'Los recordatorios requieren fecha y hora' });
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Cotización no encontrada' });

  const info = db.prepare(`
    INSERT INTO historial (lead_id, tipo, texto, fecha_alerta, usuario)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, tipoFinal, texto, fecha_alerta || null, usuario || null);
  db.prepare("UPDATE leads SET updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM historial WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/historial/:id/resolver', h((req, res) => {
  const info = db.prepare('UPDATE historial SET resuelta = 1 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Registro de historial no encontrado' });
  res.json({ ok: true });
}));

// ---------- Eliminar cotización ----------
app.delete('/api/leads/:id', h((req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Cotización no encontrada' });
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

app.post('/api/contactos', h((req,res)=>{
  const {nombre,telefono,empresa_contacto,direccion,correo,telefono_alterno,giro,rfc,notas_generales}=req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({error:'El nombre del contacto es obligatorio'});
  const norm=normalizarTelefono(telefono);
  if(norm.length!==10) return res.status(400).json({error:'El teléfono debe tener 10 dígitos'});
  if (!validarCorreo(correo)) return res.status(400).json({error:'El correo electrónico no es válido'});
  if (giro && !tipoClienteValido(giro)) return res.status(400).json({error:'Giro inválido'});
  const existente=db.prepare('SELECT id FROM clientes WHERE telefono_normalizado = ?').get(norm);
  if(existente) return res.status(409).json({error:'Este contacto ya existe',cliente_id:existente.id});
  if (!req.body.canal_origen_id || !db.prepare('SELECT id FROM canales WHERE id = ?').get(req.body.canal_origen_id)) return res.status(400).json({error:'Selecciona cómo se enteró de nosotros'});
  const info=db.prepare(`INSERT INTO clientes (nombre,telefono,telefono_normalizado,empresa_contacto,direccion,correo,telefono_alterno,giro,rfc,notas_generales,canal_origen_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(String(nombre).trim(),telefono,norm,empresa_contacto||null,direccion||null,correo?.trim()||null,telefono_alterno||null,giro||null,rfc?.trim()||null,notas_generales||null,req.body.canal_origen_id);
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
  const id = req.params.id;
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  let nuevoNorm = null;
  if (req.body.telefono !== undefined) {
    nuevoNorm = normalizarTelefono(req.body.telefono);
    if (nuevoNorm.length < 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos' });
    const otro = db.prepare('SELECT id FROM clientes WHERE telefono_normalizado = ? AND id != ?').get(nuevoNorm, id);
    if (otro) return res.status(409).json({ error: 'Ese teléfono ya pertenece a otro cliente registrado (cliente #' + otro.id + ')' });
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
        ORDER BY COALESCE(l3.fecha_servicio, date(l3.created_at)) DESC LIMIT 1) AS ultimo_valor
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
      const dias_restantes = Math.round((sugerida - hoy) / 86400000);
      return {
        cliente_id: f.cliente_id, telefono: f.telefono, nombre: f.nombre,
        empresa_contacto: f.empresa_contacto, direccion: f.direccion,
        servicio_id: f.servicio_id, servicio_nombre: f.servicio_nombre,
        ultima_fecha: f.ultima_fecha, ultimo_valor: f.ultimo_valor,
        fecha_sugerida: sugerida.toISOString().slice(0, 10),
        dias_restantes
      };
    })
    .filter(r => r.dias_restantes <= 30) // vencidos o próximos a vencer en 30 días
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
  res.json({resumen,mensual,antiguedad,canales:filas,clientes:clientes.filter(c=>c.nuevo||c.registros||c.servicios).sort((a,b)=>b.contratado-a.contratado),sinFecha});
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
    const nombreArchivo = `saneadren_backup_${new Date().toISOString().slice(0, 10)}.db`;
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
  console.error('Error no manejado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});
process.on('uncaughtException', err => console.error('uncaughtException (servidor sigue vivo):', err));
process.on('unhandledRejection', err => console.error('unhandledRejection (servidor sigue vivo):', err));

const PORT = process.env.PORT || 3210;
app.listen(PORT, () => console.log(`Saneadren CRM corriendo en http://localhost:${PORT}`));
