// Roles y permisos: qué puede ver y hacer cada rol. Lo decide Dirección desde «Roles y permisos».
//  · Cada permiso tiene una clave (sección.acción). El servidor revisa la clave con puede(req, clave): ese es el
//    candado real; la pantalla solo esconde lo que no aplica.
//  · Dirección (admin) siempre tiene todos los permisos y no se edita. El gerente (admin de sus sucursales) es un rol
//    editable, pero además nunca hace lo que afecta a todas las sucursales (SOLO_GENERAL en sucursales.js).
//  · Permiso = QUÉ hace la persona; sucursal = DÓNDE (las sucursales siguen funcionando igual).
//  · Lo que abarca o decide por todas las sucursales es solo de Dirección y no está en el catálogo: bitácora completa,
//    integridad, respaldo, sucursales, roles, duplicados de clientes, alta y baja de servicios (y su recompra), qué
//    categoría cuenta como gasto, sectores de prospección y el formato de compras. Ver direccion().
//  · Algunos permisos necesitan otro (DEPENDE): no se guardan combinaciones sin sentido.
//  · Los valores iniciales reproducen exactamente las reglas que estaban escritas en el código. Cuando se agrega un
//    permiso nuevo al catálogo, se siembra una sola vez con sus valores iniciales (si Dirección después lo quita,
//    no vuelve a aparecer).
const TODOS = ['gerente', 'ventas', 'atencion', 'tecnico', 'costos'];
const CATALOGO = [
  // [clave, sección, nombre, explicación, roles que lo tienen al inicio (además de Dirección)]
  ['clientes.exportar', 'Contactos y clientes', 'Exportar a Excel', 'Descargar contactos, cotizaciones, cuentas y órdenes de compra en Excel', ['gerente']],
  ['generador.cargar', 'Cotizaciones y órdenes', 'Cargar el generador', 'Subir el Excel del generador de órdenes', ['gerente', 'atencion', 'ventas']],
  ['ordenes.importe_ganada', 'Cotizaciones y órdenes', 'Cambiar importe o IVA de una orden', 'Modificar el importe o el IVA cuando la cotización ya es orden de servicio', ['gerente', 'atencion']],
  ['ordenes.estatus', 'Cotizaciones y órdenes', 'Actualizar estatus del servicio', 'Marcar si el servicio se realizó, con sus gastos', TODOS],
  ['ordenes.eliminar', 'Cotizaciones y órdenes', 'Eliminar cotizaciones y órdenes', '', ['gerente']],
  ['cxc.ver', 'Cuentas por cobrar', 'Ver cuentas por cobrar', 'Cartera, estados de cuenta de clientes y resúmenes', TODOS],
  ['cobros.registrar', 'Cuentas por cobrar', 'Registrar cobros', 'Anotar pagos que hizo un cliente', TODOS],
  ['cobros.confirmar', 'Cuentas por cobrar', 'Confirmar cobros', 'Revisar y confirmar cobros que están «por confirmar»', TODOS],
  ['cobros.directo', 'Cuentas por cobrar', 'Sus cobros entran ya confirmados', 'Si no lo tiene, lo que registra queda «por confirmar» para que otra persona lo revise', ['gerente', 'atencion']],
  ['cobranza.factura', 'Cuentas por cobrar', 'Crédito y datos de factura', 'Cambiar días de crédito y datos de facturación', TODOS],
  ['cobros.ajustes', 'Cuentas por cobrar', 'Ajustes, descuentos y revisión inicial', '', ['gerente']],
  ['cxp.ver', 'Cuentas por pagar', 'Ver cuentas por pagar', 'Facturas de proveedores, proveedores y sus estados de cuenta', TODOS],
  ['gastos.registrar', 'Cuentas por pagar', 'Registrar gastos de una orden', 'Gastos de un servicio, proveedores y plantillas', TODOS],
  ['dinero.mover', 'Cuentas por pagar', 'Mover dinero', 'Pagar a proveedores, cancelar cobros, pagos y cuentas, importar cuentas por pagar y compras directas', ['gerente', 'costos']],
  ['compras.gestionar', 'Compras', 'Gestionar compras', 'Aprobar solicitudes, elegir cotización, hacer y recibir órdenes de compra', ['gerente', 'costos']],
  ['compras.aprobar_propias', 'Compras', 'Aprobar sus propias solicitudes', 'Sin esto, una solicitud propia la aprueba otra persona', ['gerente']],
  ['compras.autorizar', 'Compras', 'Autorizar órdenes de compra', 'Autorizar (se vuelven deuda), cancelar autorizadas y quitar documentos', ['gerente']],
  ['reportes.panorama', 'Reportes', 'Panorama general', 'Ventas, cobranza, gastos y utilidad de la empresa', ['gerente']],
  ['catalogos.editar', 'Catálogos', 'Catálogos compartidos', 'Canales, tipos de cliente, centros de costo, unidades, categorías de gasto y descripción y orden de los servicios (los usan todas las sucursales)', TODOS],
  ['usuarios.administrar', 'Administración', 'Usuarios', 'Crear usuarios, cambiar su rol, contraseña y sucursales', ['gerente']],
].map(([clave, seccion, nombre, ayuda, roles]) => ({ clave, seccion, nombre, ayuda, roles }));
const CLAVES = new Set(CATALOGO.map(p => p.clave));
// Permiso → los que necesita para tener sentido (y para que la pantalla los marque juntos).
const DEPENDE = {
  'dinero.mover': ['cxp.ver', 'gastos.registrar'],
  'cobros.confirmar': ['cxc.ver'],
  'cobros.directo': ['cobros.registrar'],
  'cobros.ajustes': ['cobros.registrar', 'cxc.ver'],
  'compras.aprobar_propias': ['compras.gestionar'],
};
const nombreDe = c => CATALOGO.find(p => p.clave === c)?.nombre || c;
// Combinaciones sin sentido en un conjunto de permisos: [[permiso, el que le falta], …]
const faltantes = set => Object.entries(DEPENDE).flatMap(([p, req]) => set.has(p) ? req.filter(r => !set.has(r)).map(r => [p, r]) : []);
// Nombres que no puede llevar un rol nuevo (se confunden con Dirección o con el gerente).
const RESERVADOS = ['admin', 'administrador', 'administracion', 'direccion', 'director', 'directora', 'direccion general', 'gerente', 'gerencia', 'superusuario', 'root', 'sistema', 'dueno'];
const llave = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ROLES_BASE = [
  ['admin', 'Dirección', 'Todo, en todas las sucursales'],
  ['gerente', 'Gerente', 'Administra su sucursal'],
  ['ventas', 'Ventas', ''], ['atencion', 'Atención a clientes', ''], ['tecnico', 'Técnico', ''], ['costos', 'Costos y compras', 'Encargado de centro de costos'],
];

module.exports = function crearPermisos(db, app, h) {
  db.exec(`CREATE TABLE IF NOT EXISTS roles (
    clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT, sistema INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1, orden INTEGER NOT NULL DEFAULT 0, creado_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS rol_permisos (rol TEXT NOT NULL REFERENCES roles(clave), permiso TEXT NOT NULL, PRIMARY KEY (rol, permiso));
  CREATE TABLE IF NOT EXISTS permisos_sembrados (permiso TEXT PRIMARY KEY);`);
  db.transaction(() => {
    const insRol = db.prepare('INSERT OR IGNORE INTO roles (clave, nombre, descripcion, sistema, orden) VALUES (?, ?, ?, 1, ?)');
    ROLES_BASE.forEach(([c, n, d], i) => insRol.run(c, n, d, i));
    const ya = new Set(db.prepare('SELECT permiso FROM permisos_sembrados').all().map(r => r.permiso));
    const roles = new Set(db.prepare('SELECT clave FROM roles').all().map(r => r.clave));
    const dar = db.prepare('INSERT OR IGNORE INTO rol_permisos (rol, permiso) VALUES (?, ?)');
    for (const p of CATALOGO) {
      if (ya.has(p.clave)) continue;
      p.roles.filter(r => roles.has(r)).forEach(r => dar.run(r, p.clave));
      db.prepare('INSERT INTO permisos_sembrados (permiso) VALUES (?)').run(p.clave);
    }
  })();

  let cache = null;
  const mapa = () => {
    if (cache) return cache;
    cache = new Map();
    for (const { rol, permiso } of db.prepare('SELECT rol, permiso FROM rol_permisos').all()) {
      if (!cache.has(rol)) cache.set(rol, new Set());
      cache.get(rol).add(permiso);
    }
    return cache;
  };
  const olvidar = () => { cache = null; };
  // «Ver como este rol» (solo Dirección): las revisiones usan los permisos de ese rol (ver las rutas).
  const rolDe = req => req.usuarioSesion?.ver_como || req.usuarioSesion?.rol_real || req.usuarioSesion?.rol;
  const delRol = rol => (rol === 'admin' ? new Set(CLAVES) : new Set([...(mapa().get(rol) || [])].filter(c => CLAVES.has(c))));
  const tieneRol = (rol, clave) => rol === 'admin' || !!mapa().get(rol)?.has(clave);
  const puede = (req, clave) => {
    if (!CLAVES.has(clave)) throw new Error('Permiso desconocido: ' + clave);
    return tieneRol(rolDe(req), clave);
  };
  // Solo Dirección (lo que abarca todas las sucursales).
  const direccion = req => (req.usuarioSesion?.rol_real || req.usuarioSesion?.rol) === 'admin' && !req.usuarioSesion?.ver_como;
  // Para las rutas: true si puede; si no, responde 403 con el mensaje.
  const exigir = (req, res, clave, mensaje) => {
    if (puede(req, clave)) return true;
    res.status(403).json({ error: mensaje || 'No tienes permiso para esto' });
    return false;
  };
  // ¿Puede quien pide dar (o administrar a alguien con) este rol? Nadie da más permisos de los que tiene:
  // Dirección todo; los demás, solo roles cuyos permisos están todos dentro de los suyos.
  const cabe = (req, rol) => {
    const mio = rolDe(req);
    if (mio === 'admin') return true;
    if (rol === 'admin') return false;
    const mios = delRol(mio);
    return [...delRol(rol)].every(c => mios.has(c));
  };
  const roles = () => db.prepare('SELECT clave, nombre, descripcion, sistema, activo, orden FROM roles ORDER BY orden, nombre').all();
  const rolValido = rol => !!db.prepare('SELECT 1 FROM roles WHERE clave = ? AND activo = 1').get(String(rol || ''));
  const nombreRol = rol => db.prepare('SELECT nombre FROM roles WHERE clave = ?').get(rol)?.nombre || rol;

  // ---------- Rutas ----------
  const esGeneral = req => (req.usuarioSesion?.rol_real || req.usuarioSesion?.rol) === 'admin';
  const audit = (req, clave, accion, detalle) => app.locals.auditoria?.registrar(req, 'rol', clave, accion, detalle);
  const SOLO_DIRECCION = { error: 'Los roles y permisos solo los cambia Dirección' };

  // «Ver como este rol»: Dirección revisa cómo le queda el sistema a un rol antes de soltarlo. Con el encabezado
  // X-Ver-Como las revisiones de permisos usan los de ese rol (las sucursales siguen siendo las de Dirección) y
  // nada se puede guardar: solo se mira.
  app.use('/api', (req, res, next) => {
    const v = req.get('X-Ver-Como');
    if (!v || !req.usuarioSesion) return next();
    if (!esGeneral(req)) return res.status(403).json({ error: 'Solo Dirección puede ver el sistema como otro rol', codigo: 'VER_COMO' });
    if (v === 'admin' || !rolValido(v)) return res.status(400).json({ error: 'Ese rol no existe', codigo: 'VER_COMO' });
    if (req.method !== 'GET' && req.path !== '/logout')
      return res.status(403).json({ error: 'Estás viendo el sistema como «' + nombreRol(v) + '»: solo se puede mirar. Sal de esa vista para hacer cambios.', codigo: 'VER_COMO' });
    if (require('./sucursales').esSoloGeneral(req)) return res.status(403).json({ error: 'Esto solo lo hace Dirección (afecta a todas las sucursales)' });
    req.usuarioSesion.ver_como = v;
    next();
  });

  // Catálogos compartidos (los usan todas las sucursales): agregar, corregir, ordenar o quitar pide «catalogos.editar».
  const CATALOGOS = [/^\/(canales|tipos-cliente)(\/|$)/, /^\/compras\/(centros|unidades)(\/|$)/, /^\/finanzas\/categorias(\/|$)/, /^\/servicios\/(\d+|orden)$/];
  app.use('/api', (req, res, next) => {
    if (!req.usuarioSesion || !['POST', 'PUT', 'DELETE'].includes(req.method) || !CATALOGOS.some(r => r.test(req.path))) return next();
    if (puede(req, 'catalogos.editar')) return next();
    res.status(403).json({ error: 'No tienes permiso para cambiar los catálogos compartidos' });
  });

  // Lo que puede quien está conectado (la pantalla lo usa para esconder lo que no aplica).
  app.get('/api/permisos/mios', h((req, res) => {
    const rol = rolDe(req);
    res.json({ rol, rol_nombre: nombreRol(rol), ver_como: req.usuarioSesion.ver_como || null, permisos: [...delRol(rol)], todas: [...CLAVES], direccion: esGeneral(req) });
  }));
  // Nombres de los roles (para la lista de usuarios y el selector de rol).
  app.get('/api/roles', h((req, res) => res.json(roles().filter(r => r.activo).map(r => ({ ...r, cabe: cabe(req, r.clave) })))));
  // Catálogo completo y quién tiene qué (pantalla «Roles y permisos»).
  app.get('/api/permisos', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json(SOLO_DIRECCION);
    const usuarios = Object.fromEntries(db.prepare('SELECT rol, COUNT(*) n FROM usuarios WHERE activo = 1 GROUP BY rol').all().map(r => [r.rol, r.n]));
    res.json({
      catalogo: CATALOGO.map(({ clave, seccion, nombre, ayuda }) => ({ clave, seccion, nombre, ayuda })),
      dependencias: DEPENDE,
      roles: roles().filter(r => r.activo).map(r => ({ ...r, editable: r.clave !== 'admin', usuarios: usuarios[r.clave] || 0, permisos: [...delRol(r.clave)] })),
    });
  }));
  const nombreLimpio = t => String(t ?? '').trim().replace(/\s+/g, ' ');
  // Nombre de rol: letras (con acentos), números, espacios, punto y guion; 3 a 40; que no se confunda con otro.
  function problemaNombreRol(nombre, clave) {
    if (nombre.length < 3 || nombre.length > 40) return [400, 'Escribe un nombre de 3 a 40 letras'];
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .\-]*$/u.test(nombre)) return [400, 'El nombre solo puede llevar letras, números, espacios, punto y guion'];
    const k = llave(nombre);
    if (RESERVADOS.includes(k)) return [409, 'Ese nombre se confunde con Dirección o con el gerente; elige otro'];
    if (roles().some(r => r.activo && r.clave !== clave && llave(r.nombre) === k)) return [409, 'Ya hay un rol con ese nombre'];
    return null;
  }
  // Cambia los permisos de un rol (lista completa de claves que debe tener).
  app.put('/api/roles/:clave/permisos', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json(SOLO_DIRECCION);
    const rol = db.prepare('SELECT * FROM roles WHERE clave = ? AND activo = 1').get(req.params.clave);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.clave === 'admin') return res.status(400).json({ error: 'Dirección siempre tiene todos los permisos' });
    const lista = req.body?.permisos;
    if (!Array.isArray(lista) || lista.some(c => typeof c !== 'string' || !CLAVES.has(c))) return res.status(400).json({ error: 'Lista de permisos inválida' });
    const nuevos = new Set(lista), antes = delRol(rol.clave);
    // «antes» = lo que la persona vio al abrir la pantalla. Si alguien más guardó este rol mientras tanto, no se pisa.
    if (Array.isArray(req.body.antes) && [...antes].sort().join() !== [...new Set(req.body.antes)].filter(c => CLAVES.has(c)).sort().join())
      return res.status(409).json({ error: `Alguien más cambió los permisos de «${rol.nombre}» mientras los editabas. Recarga para ver lo actual.`, codigo: 'CAMBIADO' });
    const malas = faltantes(nuevos);
    if (malas.length) return res.status(400).json({ error: malas.map(([p, r]) => `«${nombreDe(p)}» necesita «${nombreDe(r)}»`).join('; '), faltan: malas });
    const dados = [...nuevos].filter(c => !antes.has(c)), quitados = [...antes].filter(c => !nuevos.has(c));
    if (!dados.length && !quitados.length) return res.json({ ok: true, cambios: 0 });
    db.transaction(() => {
      const del = db.prepare('DELETE FROM rol_permisos WHERE rol = ? AND permiso = ?'), ins = db.prepare('INSERT OR IGNORE INTO rol_permisos (rol, permiso) VALUES (?, ?)');
      quitados.forEach(c => del.run(rol.clave, c)); dados.forEach(c => ins.run(rol.clave, c));
    })();
    olvidar();
    const nom = c => CATALOGO.find(p => p.clave === c).nombre;
    audit(req, rol.clave, 'permisos', `${rol.nombre}: ` + [dados.length ? 'se dio ' + dados.map(nom).join(', ') : '', quitados.length ? 'se quitó ' + quitados.map(nom).join(', ') : ''].filter(Boolean).join(' · '));
    res.json({ ok: true, cambios: dados.length + quitados.length });
  }));
  // Rol nuevo, copiando los permisos de otro (o sin permisos).
  app.post('/api/roles', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json(SOLO_DIRECCION);
    const nombre = nombreLimpio(req.body?.nombre);
    const malo = problemaNombreRol(nombre, null);
    if (malo) return res.status(malo[0]).json({ error: malo[1] });
    const copiar = req.body?.copiar_de ? db.prepare('SELECT clave FROM roles WHERE clave = ? AND activo = 1').get(String(req.body.copiar_de)) : null;
    if (req.body?.copiar_de && !copiar) return res.status(400).json({ error: 'El rol a copiar no existe' });
    const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'rol';
    let clave = base, i = 2;
    while (db.prepare('SELECT 1 FROM roles WHERE clave = ?').get(clave) || ['admin', 'gerente'].includes(clave)) clave = base + '_' + i++;
    const orden = (db.prepare('SELECT MAX(orden) m FROM roles').get().m || 0) + 1;
    db.transaction(() => {
      db.prepare('INSERT INTO roles (clave, nombre, descripcion, sistema, orden) VALUES (?, ?, ?, 0, ?)').run(clave, nombre, nombreLimpio(req.body?.descripcion).slice(0, 120), orden);
      if (copiar) [...delRol(copiar.clave)].forEach(c => db.prepare('INSERT INTO rol_permisos (rol, permiso) VALUES (?, ?)').run(clave, c));
    })();
    olvidar();
    audit(req, clave, 'creado', nombre + (copiar ? ' · copia de ' + nombreRol(copiar.clave) : ' · sin permisos'));
    res.status(201).json({ clave, nombre });
  }));
  // Renombrar un rol (la clave interna no cambia; Dirección conserva su nombre).
  app.put('/api/roles/:clave', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json(SOLO_DIRECCION);
    const rol = db.prepare('SELECT * FROM roles WHERE clave = ? AND activo = 1').get(req.params.clave);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.clave === 'admin') return res.status(400).json({ error: 'Dirección no se renombra' });
    const nombre = req.body?.nombre !== undefined ? nombreLimpio(req.body.nombre) : rol.nombre;
    const descripcion = req.body?.descripcion !== undefined ? nombreLimpio(req.body.descripcion).slice(0, 120) : rol.descripcion;
    if (nombre !== rol.nombre) { const malo = problemaNombreRol(nombre, rol.clave); if (malo) return res.status(malo[0]).json({ error: malo[1] }); }
    db.prepare('UPDATE roles SET nombre = ?, descripcion = ? WHERE clave = ?').run(nombre, descripcion, rol.clave);
    if (nombre !== rol.nombre) audit(req, rol.clave, 'renombrado', rol.nombre + ' → ' + nombre);
    res.json({ ok: true });
  }));
  // Quitar un rol creado por Dirección: solo si nadie activo lo tiene.
  app.delete('/api/roles/:clave', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json(SOLO_DIRECCION);
    const rol = db.prepare('SELECT * FROM roles WHERE clave = ? AND activo = 1').get(req.params.clave);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.sistema) return res.status(400).json({ error: 'Los roles de fábrica no se quitan; puedes dejarlos sin permisos' });
    const n = db.prepare('SELECT COUNT(*) n FROM usuarios WHERE rol = ? AND activo = 1').get(rol.clave).n;
    if (n) return res.status(409).json({ error: `${n === 1 ? 'Una persona tiene' : n + ' personas tienen'} este rol: cámbiales el rol antes de quitarlo` });
    db.transaction(() => {
      db.prepare('UPDATE roles SET activo = 0 WHERE clave = ?').run(rol.clave);
      db.prepare('DELETE FROM rol_permisos WHERE rol = ?').run(rol.clave);
    })();
    olvidar();
    audit(req, rol.clave, 'quitado', rol.nombre);
    res.json({ ok: true });
  }));

  return { CATALOGO, CLAVES, DEPENDE, puede, exigir, direccion, tieneRol, delRol, rolDe, cabe, roles, rolValido, nombreRol, olvidar };
};
