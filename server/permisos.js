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
//  · QUÉ VE cada rol, por área (AREAS): nada, «lo suyo» o toda su sucursal. Lo aplica la base (vistas de
//    sucursales.js con ve_lead / ve_registro / nivel_area), así que cualquier pantalla, reporte o Excel queda
//    filtrado sin depender de cada ruta. Cada área da permisos «virtuales» (ventas.ver, cxc.sucursal…) que se usan
//    igual que los demás (dependencias, «nadie da más de lo que tiene»).
//  · Los valores iniciales reproducen exactamente las reglas que estaban escritas en el código. Cuando se agrega un
//    permiso nuevo al catálogo, se siembra una sola vez con sus valores iniciales (si Dirección después lo quita,
//    no vuelve a aparecer).
const TODOS = ['gerente', 'ventas', 'atencion', 'tecnico', 'costos'];
const CATALOGO = [
  // [clave, sección, nombre, explicación, roles que lo tienen al inicio (además de Dirección)]
  ['prospeccion.ver', 'Contactos y clientes', 'Prospección', 'Buscar establecimientos y darles seguimiento: los suyos, o los de toda su sucursal si ve las ventas de la sucursal', ['gerente', 'ventas', 'atencion']],
  ['clientes.exportar', 'Contactos y clientes', 'Exportar a Excel', 'Descargar contactos, cotizaciones, cuentas y órdenes de compra en Excel', ['gerente']],
  ['ordenes.importes', 'Cotizaciones y órdenes', 'Ver importes', 'Precios, totales e IVA de cotizaciones y órdenes, el Generador y Resultados. Sin esto ve sus órdenes para trabajar (cliente, dirección, fecha y servicio) sin dinero, y no cotiza', ['gerente', 'ventas', 'atencion']],
  ['generador.cargar', 'Cotizaciones y órdenes', 'Cargar el generador', 'Subir el Excel del generador de órdenes', ['gerente', 'atencion', 'ventas']],
  ['ordenes.importe_ganada', 'Cotizaciones y órdenes', 'Cambiar importe o IVA de una orden', 'Modificar el importe o el IVA cuando la cotización ya es orden de servicio, y regresar una orden a cotización', ['gerente', 'atencion']],
  ['ordenes.estatus', 'Cotizaciones y órdenes', 'Actualizar estatus del servicio', 'Marcar si el servicio se realizó, con sus gastos', TODOS],
  ['ordenes.eliminar', 'Cotizaciones y órdenes', 'Eliminar cotizaciones y órdenes', '', ['gerente']],
  ['cobros.registrar', 'Cuentas por cobrar', 'Registrar cobros', 'Anotar pagos que hizo un cliente', TODOS.filter(r => r !== 'costos')],
  ['cobros.confirmar', 'Cuentas por cobrar', 'Confirmar cobros', 'Revisar y confirmar cobros que están «por confirmar»', TODOS.filter(r => r !== 'tecnico')],
  ['cobros.directo', 'Cuentas por cobrar', 'Sus cobros entran ya confirmados', 'Si no lo tiene, lo que registra queda «por confirmar» para que otra persona lo revise', ['gerente', 'atencion']],
  ['cobranza.factura', 'Cuentas por cobrar', 'Crédito y datos de factura', 'Cambiar días de crédito y datos de facturación', TODOS],
  ['cobros.ajustes', 'Cuentas por cobrar', 'Ajustes, descuentos y revisión inicial', '', ['gerente']],
  ['gastos.registrar', 'Cuentas por pagar', 'Registrar gastos de una orden', 'Gastos de un servicio, proveedores y plantillas', TODOS],
  ['gastos.ver_orden', 'Cuentas por pagar', 'Ver los gastos de sus órdenes', 'Todos los gastos de las órdenes donde es responsable o técnico, aunque los anote otra persona (para saber cuánto le deja la orden)', ['gerente', 'ventas']],
  ['dinero.mover', 'Cuentas por pagar', 'Mover dinero', 'Pagar a proveedores, cancelar cobros, pagos y cuentas, importar cuentas por pagar y compras directas', ['gerente', 'costos']],
  ['compras.gestionar', 'Compras', 'Gestionar compras', 'Aprobar solicitudes, elegir cotización, hacer y recibir órdenes de compra', ['gerente', 'costos']],
  ['compras.aprobar_propias', 'Compras', 'Aprobar sus propias solicitudes', 'Sin esto, una solicitud propia la aprueba otra persona', ['gerente']],
  ['compras.autorizar', 'Compras', 'Autorizar órdenes de compra', 'Autorizar (se vuelven deuda), cancelar autorizadas y quitar documentos', ['gerente']],
  ['reportes.panorama', 'Reportes', 'Panorama general', 'Ventas, cobranza, gastos y utilidad de la empresa', ['gerente']],
  ['catalogos.editar', 'Catálogos', 'Catálogos compartidos', 'Canales, tipos de cliente, centros de costo, unidades, categorías de gasto y descripción y orden de los servicios (los usan todas las sucursales)', ['gerente', 'costos']],
  ['personal.ver', 'Personal', 'Ver personal', 'Lista y fichas del personal de su sucursal (sin datos de pago ni expediente)', ['gerente']],
  ['personal.editar', 'Personal', 'Editar personal', 'Altas, cambios, bajas, vacaciones e incidencias', ['gerente']],
  ['personal.sensibles', 'Personal', 'Datos sensibles del personal', 'CLABE, RFC, CURP, NSS, salario, contrato y documentos del expediente', ['gerente']],
  ['usuarios.administrar', 'Administración', 'Usuarios', 'Crear usuarios, cambiar su rol, contraseña y sucursales', ['gerente']],
].map(([clave, seccion, nombre, ayuda, roles]) => ({ clave, seccion, nombre, ayuda, roles }));
// Áreas y lo que ve cada rol en ellas: 0 nada, 1 lo suyo, 2 toda su sucursal (Dirección: todo).
const AREAS = [
  ['ventas', 'Contactos, cotizaciones y órdenes', 'sus clientes y las órdenes donde es responsable o técnico asignado'],
  ['cxc', 'Cuentas por cobrar', 'la cobranza de sus órdenes', 'si puede registrar cobros, solo ve los que él registró (sin saldos ni vencidos)'],
  ['cxp', 'Cuentas por pagar', 'los gastos y facturas que él registró'],
  ['compras', 'Solicitudes y órdenes de compra', 'lo que él pidió'],
].map(([clave, nombre, suyo, nada = '']) => ({ clave, nombre, suyo, nada }));
const NIVELES = ['Nada', 'Lo suyo', 'Toda su sucursal'];
// Con qué arranca cada rol (decidido con Dirección el 2026-10-19): [ventas, cxc, cxp, compras]. El técnico, en cuentas por
// cobrar, solo los cobros que él registró (2026-10-21). Atención, en cuentas por pagar, los gastos que ella anota (2026-10-22).
const ALCANCE_INICIAL = { gerente: [2, 2, 2, 2], ventas: [1, 1, 1, 1], atencion: [2, 2, 1, 1], tecnico: [1, 0, 1, 1], costos: [0, 0, 2, 2] };
// Permisos virtuales de las áreas: «X.ver» (ve algo) y «X.sucursal» (ve toda su sucursal).
const VIRTUALES = AREAS.flatMap(a => [a.clave + '.ver', a.clave + '.sucursal']);
const virtualesDe = niv => AREAS.flatMap(a => [...(niv[a.clave] >= 1 ? [a.clave + '.ver'] : []), ...(niv[a.clave] >= 2 ? [a.clave + '.sucursal'] : [])]);
const CLAVES = new Set([...CATALOGO.map(p => p.clave), ...VIRTUALES]);
const REALES = new Set(CATALOGO.map(p => p.clave));
// Permiso → los que necesita para tener sentido (y para que la pantalla los marque juntos).
const DEPENDE = {
  'prospeccion.ver': ['ventas.ver'],
  'dinero.mover': ['cxp.ver', 'gastos.registrar'],
  'cobros.confirmar': ['cxc.ver'],
  'cobranza.factura': ['cxc.ver'], // crédito y datos de factura: solo quien ve la cobranza
  'gastos.ver_orden': ['cxp.ver', 'ventas.ver'],
  'cobros.directo': ['cobros.registrar'],
  'cobros.ajustes': ['cobros.registrar', 'cxc.ver'],
  'compras.aprobar_propias': ['compras.gestionar'],
  'compras.gestionar': ['compras.sucursal'],
  'compras.autorizar': ['compras.sucursal'],
  'ordenes.estatus': ['ventas.ver'],
  'ordenes.importe_ganada': ['ventas.ver', 'ordenes.importes'],
  'ordenes.eliminar': ['ventas.ver'],
  'generador.cargar': ['ventas.sucursal', 'ordenes.importes'], // crea órdenes de cualquier cliente de la sucursal
  'reportes.panorama': ['ordenes.importes'],
  'clientes.exportar': ['ordenes.importes'], // el Excel lleva los importes
  'personal.editar': ['personal.ver'],
  'personal.sensibles': ['personal.ver'],
};
const nombreDe = c => {
  const p = CATALOGO.find(x => x.clave === c); if (p) return p.nombre;
  const [area, tipo] = c.split('.'), a = AREAS.find(x => x.clave === area);
  return a ? `${a.nombre}: ${tipo === 'sucursal' ? 'ver toda su sucursal' : 'ver al menos lo suyo'}` : c;
};
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
  CREATE TABLE IF NOT EXISTS permisos_sembrados (permiso TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS rol_alcances (rol TEXT NOT NULL REFERENCES roles(clave), area TEXT NOT NULL, nivel INTEGER NOT NULL CHECK(nivel BETWEEN 0 AND 2), PRIMARY KEY (rol, area));`);
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
    // Qué ve cada rol: se siembra una vez por área. Los roles de fábrica con la tabla acordada; los que inventó
    // Dirección, a partir de lo que ya tenían (antes «Ver cuentas por cobrar/pagar» eran casillas).
    const tenia = (rol, p) => !!db.prepare('SELECT 1 FROM rol_permisos WHERE rol = ? AND permiso = ?').get(rol, p);
    const fijar = db.prepare('INSERT OR IGNORE INTO rol_alcances (rol, area, nivel) VALUES (?, ?, ?)');
    let sembroAlgo = false;
    AREAS.forEach((a, i) => {
      if (ya.has('area:' + a.clave)) return;
      sembroAlgo = true;
      for (const r of roles) {
        if (r === 'admin') continue;
        const nivel = ALCANCE_INICIAL[r] ? ALCANCE_INICIAL[r][i]
          : a.clave === 'ventas' ? 2 : a.clave === 'compras' ? (tenia(r, 'compras.gestionar') ? 2 : 1) : (tenia(r, a.clave + '.ver') ? 2 : 0);
        fijar.run(r, a.clave, nivel);
      }
      db.prepare('INSERT INTO permisos_sembrados (permiso) VALUES (?)').run('area:' + a.clave);
    });
    db.prepare("DELETE FROM rol_permisos WHERE permiso IN ('cxc.ver', 'cxp.ver')").run(); // ahora son el área
    // «Prospección» (2026-10-21): antes la veía todo el que veía ventas. Los roles que inventó Dirección y ya veían
    // ventas la conservan; de los de fábrica la tienen Gerente, Ventas y Atención (el técnico no busca clientes).
    if (!ya.has('prospeccion:otros')) {
      for (const r of roles) {
        if (r === 'admin' || ALCANCE_INICIAL[r]) continue;
        const v = db.prepare("SELECT nivel FROM rol_alcances WHERE rol = ? AND area = 'ventas'").get(r);
        if (v && v.nivel >= 1) dar.run(r, 'prospeccion.ver');
      }
      db.prepare('INSERT INTO permisos_sembrados (permiso) VALUES (?)').run('prospeccion:otros');
    }
    // «Ver importes» (2026-10-21): antes todos los que veían órdenes veían sus importes. Los de fábrica arrancan con la
    // tabla (sin el técnico ni costos); los roles que inventó Dirección lo conservan para no quitarles nada.
    if (!ya.has('ordenes.importes')) {
      for (const r of roles) if (r !== 'admin' && !ALCANCE_INICIAL[r]) dar.run(r, 'ordenes.importes');
      sembroAlgo = true; // lo que necesita ver importes (cambiar el importe, cargar el generador…) se quita a quien no los ve
    }
    // Técnico (2026-10-21, acordado con Dirección): en cuentas por cobrar solo los cobros que él registra, sin saldos ni
    // vencidos, y no confirma cobros de otros. Una sola vez; después Dirección lo cambia en Roles y permisos.
    if (!ya.has('tecnico:solo-sus-cobros')) {
      if (roles.has('tecnico')) {
        db.prepare("UPDATE rol_alcances SET nivel = 0 WHERE rol = 'tecnico' AND area = 'cxc' AND nivel = 1").run();
        db.prepare("DELETE FROM rol_permisos WHERE rol = 'tecnico' AND permiso = 'cobros.confirmar'").run();
      }
      sembroAlgo = true; // «Crédito y factura» ahora necesita ver la cobranza: se quita a quien no la ve
      db.prepare('INSERT INTO permisos_sembrados (permiso) VALUES (?)').run('tecnico:solo-sus-cobros');
    }
    // Decisiones de Dirección (2026-10-22), una sola vez: catálogos compartidos solo Gerente y Compras (además de
    // Dirección); Atención ve en cuentas por pagar los gastos que ella anota; Compras deja «Registrar cobros» (no abre
    // órdenes). «Ver los gastos de sus órdenes» lo siembra el catálogo (Ventas y Gerente). Lo que cambie después, se respeta.
    if (!ya.has('decisiones:2026-10-22')) {
      const quitar = db.prepare('DELETE FROM rol_permisos WHERE rol = ? AND permiso = ?');
      for (const r of ['ventas', 'atencion', 'tecnico']) quitar.run(r, 'catalogos.editar');
      quitar.run('costos', 'cobros.registrar');
      db.prepare("UPDATE rol_alcances SET nivel = 1 WHERE rol = 'atencion' AND area = 'cxp' AND nivel = 0").run();
      sembroAlgo = true;
      db.prepare('INSERT INTO permisos_sembrados (permiso) VALUES (?)').run('decisiones:2026-10-22');
    }
    // Al sembrar los niveles, lo que quedó sin sentido (p. ej. «Actualizar estatus» para quien ya no ve órdenes) se quita.
    if (sembroAlgo) for (const r of roles) {
      if (r === 'admin') continue;
      const niv = Object.fromEntries(db.prepare('SELECT area, nivel FROM rol_alcances WHERE rol = ?').all(r).map(x => [x.area, x.nivel]));
      const set = new Set([...db.prepare('SELECT permiso FROM rol_permisos WHERE rol = ?').all(r).map(x => x.permiso), ...virtualesDe(niv)]);
      for (let malas = faltantes(set); malas.length; malas = faltantes(set)) for (const [p] of malas) { set.delete(p); db.prepare('DELETE FROM rol_permisos WHERE rol = ? AND permiso = ?').run(r, p); }
    }
  })();

  let cache = null, cacheNiv = null;
  const mapa = () => {
    if (cache) return cache;
    cache = new Map();
    for (const { rol, permiso } of db.prepare('SELECT rol, permiso FROM rol_permisos').all()) {
      if (!cache.has(rol)) cache.set(rol, new Set());
      cache.get(rol).add(permiso);
    }
    return cache;
  };
  // Qué ve el rol en cada área ({ ventas: 0|1|2, … }). Dirección: todo.
  const nivelesDe = rol => {
    if (rol === 'admin') return Object.fromEntries(AREAS.map(a => [a.clave, 2]));
    if (!cacheNiv) { cacheNiv = new Map(); for (const { rol: r, area, nivel } of db.prepare('SELECT rol, area, nivel FROM rol_alcances').all()) { if (!cacheNiv.has(r)) cacheNiv.set(r, {}); cacheNiv.get(r)[area] = nivel; } }
    const n = cacheNiv.get(rol) || {};
    return Object.fromEntries(AREAS.map(a => [a.clave, n[a.clave] ?? 0]));
  };
  const olvidar = () => { cache = null; cacheNiv = null; };
  // «Ver como este rol» (solo Dirección): las revisiones usan los permisos de ese rol (ver las rutas).
  const rolDe = req => req.usuarioSesion?.ver_como || req.usuarioSesion?.rol_real || req.usuarioSesion?.rol;
  const delRol = rol => (rol === 'admin' ? new Set(CLAVES) : new Set([...[...(mapa().get(rol) || [])].filter(c => REALES.has(c)), ...virtualesDe(nivelesDe(rol))]));
  const tieneRol = (rol, clave) => rol === 'admin' || (REALES.has(clave) ? !!mapa().get(rol)?.has(clave) : virtualesDe(nivelesDe(rol)).includes(clave));
  const puede = (req, clave) => {
    if (!CLAVES.has(clave)) throw new Error('Permiso desconocido: ' + clave);
    return tieneRol(rolDe(req), clave);
  };
  // Qué ve el rol de quien pide: se guarda en el alcance de la petición para que las vistas de la base filtren
  // «lo suyo». Lo llama sucursales.js al armar el alcance (antes del candado por número). Dirección ve todo, salvo
  // cuando «ve como» otro rol (encabezado X-Ver-Como válido; si no es válido, la petición se rechaza después).
  function prepararAlcance(req, a) {
    const u = req.usuarioSesion; if (!u || !a) return;
    const real = u.rol_real || u.rol;
    let rol = real;
    if (real === 'admin') { const v = req.get('X-Ver-Como'); if (!v || v === 'admin' || !rolValido(v)) return; rol = v; }
    a.usuarioId = u.id; a.niveles = nivelesDe(rol); a.gastosOrden = tieneRol(rol, 'gastos.ver_orden');
  }
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

  // Prospección es de ventas: quien no ve ventas no entra (las vistas tampoco le muestran establecimientos).
  app.use('/api/prospeccion', (req, res, next) => (!req.usuarioSesion || puede(req, 'prospeccion.ver') ? next() : res.status(403).json({ error: 'Tu rol no ve prospección' })));

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
    res.json({ rol, rol_nombre: nombreRol(rol), ver_como: req.usuarioSesion.ver_como || null, permisos: [...delRol(rol)], todas: [...CLAVES], alcances: nivelesDe(rol), direccion: esGeneral(req) });
  }));
  // Nombres de los roles (para la lista de usuarios y el selector de rol).
  app.get('/api/roles', h((req, res) => res.json(roles().filter(r => r.activo).map(r => ({ ...r, cabe: cabe(req, r.clave) })))));
  // Catálogo completo y quién tiene qué (pantalla «Roles y permisos»).
  app.get('/api/permisos', h((req, res) => {
    if (!esGeneral(req)) return res.status(403).json(SOLO_DIRECCION);
    const usuarios = Object.fromEntries(db.prepare('SELECT rol, COUNT(*) n FROM usuarios WHERE activo = 1 GROUP BY rol').all().map(r => [r.rol, r.n]));
    res.json({
      catalogo: CATALOGO.map(({ clave, seccion, nombre, ayuda }) => ({ clave, seccion, nombre, ayuda })),
      dependencias: DEPENDE, areas: AREAS, niveles: NIVELES,
      roles: roles().filter(r => r.activo).map(r => ({ ...r, editable: r.clave !== 'admin', usuarios: usuarios[r.clave] || 0, permisos: [...delRol(r.clave)], alcances: nivelesDe(r.clave) })),
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
    const nivAntes = nivelesDe(rol.clave), al = req.body.alcances;
    if (al !== undefined && (al === null || typeof al !== 'object' || Array.isArray(al) || Object.entries(al).some(([k, v]) => !AREAS.some(a => a.clave === k) || ![0, 1, 2].includes(v))))
      return res.status(400).json({ error: 'Niveles de «qué ve» inválidos' });
    const nivNuevos = { ...nivAntes, ...(al || {}) };
    // Los permisos virtuales salen de los niveles, no de la lista.
    const nuevos = new Set([...lista.filter(c => REALES.has(c)), ...virtualesDe(nivNuevos)]), antes = delRol(rol.clave);
    // «antes» = lo que la persona vio al abrir la pantalla. Si alguien más guardó este rol mientras tanto, no se pisa.
    if (Array.isArray(req.body.antes) && [...antes].sort().join() !== [...new Set(req.body.antes)].filter(c => CLAVES.has(c)).sort().join())
      return res.status(409).json({ error: `Alguien más cambió los permisos de «${rol.nombre}» mientras los editabas. Recarga para ver lo actual.`, codigo: 'CAMBIADO' });
    const malas = faltantes(nuevos);
    if (malas.length) return res.status(400).json({ error: malas.map(([p, r]) => `«${nombreDe(p)}» necesita «${nombreDe(r)}»`).join('; '), faltan: malas });
    const dados = [...nuevos].filter(c => REALES.has(c) && !antes.has(c)), quitados = [...antes].filter(c => REALES.has(c) && !nuevos.has(c));
    const areasCambian = AREAS.filter(a => nivNuevos[a.clave] !== nivAntes[a.clave]);
    if (!dados.length && !quitados.length && !areasCambian.length) return res.json({ ok: true, cambios: 0 });
    db.transaction(() => {
      const del = db.prepare('DELETE FROM rol_permisos WHERE rol = ? AND permiso = ?'), ins = db.prepare('INSERT OR IGNORE INTO rol_permisos (rol, permiso) VALUES (?, ?)');
      quitados.forEach(c => del.run(rol.clave, c)); dados.forEach(c => ins.run(rol.clave, c));
      const fija = db.prepare('INSERT INTO rol_alcances (rol, area, nivel) VALUES (?, ?, ?) ON CONFLICT(rol, area) DO UPDATE SET nivel = excluded.nivel');
      areasCambian.forEach(a => fija.run(rol.clave, a.clave, nivNuevos[a.clave]));
    })();
    olvidar();
    audit(req, rol.clave, 'permisos', `${rol.nombre}: ` + [dados.length ? 'se dio ' + dados.map(nombreDe).join(', ') : '', quitados.length ? 'se quitó ' + quitados.map(nombreDe).join(', ') : '',
      ...areasCambian.map(a => `ve en ${a.nombre}: ${NIVELES[nivAntes[a.clave]]} → ${NIVELES[nivNuevos[a.clave]]}`)].filter(Boolean).join(' · '));
    res.json({ ok: true, cambios: dados.length + quitados.length + areasCambian.length });
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
      if (copiar) [...delRol(copiar.clave)].filter(c => REALES.has(c)).forEach(c => db.prepare('INSERT INTO rol_permisos (rol, permiso) VALUES (?, ?)').run(clave, c));
      const niv = copiar ? nivelesDe(copiar.clave) : {};
      AREAS.forEach(a => db.prepare('INSERT INTO rol_alcances (rol, area, nivel) VALUES (?, ?, ?)').run(clave, a.clave, niv[a.clave] ?? 0));
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
      db.prepare('DELETE FROM rol_alcances WHERE rol = ?').run(rol.clave);
    })();
    olvidar();
    audit(req, rol.clave, 'quitado', rol.nombre);
    res.json({ ok: true });
  }));

  return { CATALOGO, CLAVES, DEPENDE, AREAS, nivelesDe, prepararAlcance, puede, exigir, direccion, tieneRol, delRol, rolDe, cabe, roles, rolValido, nombreRol, olvidar };
};
