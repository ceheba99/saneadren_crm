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
  ['clientes.exportar', 'Contactos y clientes', 'Exportar a Excel', 'Descargar contactos, cotizaciones, cuentas y órdenes de compra en Excel', ['gerente']],
  ['ordenes.importes', 'Cotizaciones y órdenes', 'Ver importes', 'Precios, totales e IVA de las cotizaciones y órdenes que ve. Sin esto ve sus órdenes para trabajar (cliente, dirección, fecha y servicio) sin dinero', ['gerente', 'ventas', 'atencion', 'tecnico']],
  ['ventas.editar_otros', 'Cotizaciones y órdenes', 'Editar lo de otros', 'Cambiar contactos, cotizaciones y órdenes de otras personas de su sucursal, pasarlas a otro responsable y marcar realizadas sus órdenes. Sin esto cada quien edita solo lo que capturó o tiene a su nombre', ['gerente']],
  ['generador.cargar', 'Cotizaciones y órdenes', 'Cargar el generador', 'Subir el Excel del generador de órdenes', ['gerente', 'atencion', 'ventas']],
  ['ordenes.importe_ganada', 'Cotizaciones y órdenes', 'Cambiar importe o IVA de una orden', 'Modificar el importe o el IVA cuando la cotización ya es orden de servicio, y regresar una orden a cotización', ['gerente', 'atencion']],
  ['cobros.registrar', 'Cuentas por cobrar', 'Registrar cobros', 'Anotar pagos que hizo un cliente', TODOS.filter(r => r !== 'costos')],
  ['cobros.confirmar', 'Cuentas por cobrar', 'Confirmar cobros', 'Revisar y confirmar cobros que están «por confirmar»', TODOS.filter(r => r !== 'tecnico')],
  ['cobros.directo', 'Cuentas por cobrar', 'Sus cobros entran ya confirmados', 'Si no lo tiene, lo que registra queda «por confirmar» para que otra persona lo revise', ['gerente', 'atencion']],
  ['cobranza.factura', 'Cuentas por cobrar', 'Crédito y datos de factura', 'Cambiar días de crédito y datos de facturación', TODOS],
  ['cobros.ajustes', 'Cuentas por cobrar', 'Ajustes, descuentos y revisión inicial', '', ['gerente']],
  ['gastos.registrar', 'Cuentas por pagar', 'Registrar gastos de una orden', 'Gastos de un servicio, proveedores y plantillas', TODOS],
  ['gastos.ver_orden', 'Cuentas por pagar', 'Ver los gastos de sus órdenes', 'Todos los gastos de las órdenes donde es responsable o técnico, aunque los anote otra persona (para saber cuánto le deja la orden)', ['gerente', 'ventas']],
  ['dinero.mover', 'Cuentas por pagar', 'Mover dinero', 'Pagar a proveedores, cancelar cobros, pagos y cuentas, importar cuentas por pagar y compras directas', ['gerente', 'costos']],
  ['compras.importes', 'Compras', 'Ver montos de compras', 'Precios y totales de las cotizaciones de proveedores y de las órdenes de compra', ['gerente', 'ventas', 'atencion', 'costos']],
  ['compras.gestionar', 'Compras', 'Gestionar compras', 'Aprobar solicitudes, elegir cotización, hacer y recibir órdenes de compra', ['gerente', 'costos']],
  ['compras.aprobar_propias', 'Compras', 'Aprobar sus propias solicitudes', 'Sin esto, una solicitud propia la aprueba otra persona', ['gerente']],
  ['compras.autorizar', 'Compras', 'Autorizar órdenes de compra', 'Autorizar (se vuelven deuda), cancelar autorizadas y quitar documentos', ['gerente']],
  ['reportes.analisis', 'Reportes', 'Análisis comercial', 'Contactos nuevos, conversión, vendido y recurrentes de lo que ve', ['gerente', 'ventas', 'atencion']],
  ['reportes.panorama', 'Reportes', 'Panorama general', 'Ventas, cobranza, gastos y utilidad de la empresa', ['gerente']],
  ['catalogos.editar', 'Catálogos', 'Catálogos compartidos', 'Canales, tipos de cliente, centros de costo, unidades, categorías de gasto y descripción y orden de los servicios (los usan todas las sucursales)', ['gerente', 'costos']],
  ['personal.ver', 'Personal', 'Ver personal', 'Lista y fichas del personal de su sucursal (sin datos de pago ni expediente)', ['gerente']],
  ['personal.editar', 'Personal', 'Editar personal', 'Altas, cambios, bajas, vacaciones e incidencias', ['gerente']],
  ['personal.sensibles', 'Personal', 'Datos sensibles del personal', 'CLABE, RFC, CURP, NSS, salario, contrato y documentos del expediente', ['gerente']],
  ['usuarios.administrar', 'Administración', 'Usuarios', 'Crear usuarios, cambiar su rol, contraseña y sucursales', ['gerente']],
  // Marketing (2026-10-26): aprueban Dirección (siempre) y el Gerente de marketing.
  ['marketing.aprobar', 'Marketing', 'Aprobar publicaciones', 'Aprobar o pedir cambios a las publicaciones antes de subirlas a redes', ['marketing_gerente']],
].map(([clave, seccion, nombre, ayuda, roles]) => ({ clave, seccion, nombre, ayuda, roles }));
// Áreas y lo que ve cada rol en ellas: 0 nada, 1 lo suyo, 2 toda su sucursal, 3 toda la empresa (Dirección: todo).
// Cada pantalla es su propia área (decidido con Dirección el 2026-10-26). En las que tienen «editable», además de qué ve
// se decide si edita (✎): sin eso, todo es solo lectura. Contactos, cotizaciones y órdenes se editan solo si son suyos
// (los capturó o están a su nombre); lo de otros, con «Editar lo de otros» (Gerente).
const AREAS = [
  ['contactos', 'Contactos', 'los que él dio de alta o atiende', '', true],
  ['prospeccion', 'Prospección', 'los establecimientos a su nombre', '', true],
  ['generador', 'Generador', 'las órdenes realizadas donde es responsable'],
  ['cotizaciones', 'Cotizaciones', 'las que capturó o están a su nombre', '', true],
  ['ordenes', 'Órdenes de servicio', 'las que capturó, están a su nombre o tiene asignadas como técnico', '', true],
  ['cxc', 'Cuentas por cobrar', 'la cobranza de sus órdenes', 'si puede registrar cobros, solo ve los que él registró (sin saldos ni vencidos)'],
  ['cxp', 'Cuentas por pagar', 'los gastos y facturas que él registró'],
  ['solicitudes', 'Solicitudes de compra', 'las que él pidió', '', true],
  ['ordenes_compra', 'Órdenes de compra', 'las que él hizo o salen de sus solicitudes'],
  // Calendario de publicaciones (2026-10-26).
  ['marketing', 'Marketing', 'las publicaciones que creó o tiene a su nombre', '', true],
].map(([clave, nombre, suyo, nada = '', editable = false]) => ({ clave, nombre, suyo, nada, editable }));
const NIVELES = ['Nada', 'Lo suyo', 'Toda su sucursal', 'Toda la empresa'];
const EDITABLES = AREAS.filter(a => a.editable).map(a => a.clave);
// Con qué arranca cada rol de fábrica (aprobado por Dirección el 2026-10-26), en el orden de AREAS: nivel y «e» si edita.
// Marketing (2026-10-26): solo los dos roles de Marketing (toda la empresa, editan); los demás no lo ven hasta que
// Dirección lo prenda.
const ALCANCE_INICIAL = {
  gerente: ['2e', '2e', '2', '2e', '2e', '2', '2', '2e', '2', '0'],
  ventas: ['1e', '1e', '1', '1e', '1e', '1', '1', '1e', '1', '0'],
  atencion: ['2e', '2e', '2', '2e', '2e', '2', '1', '1e', '1', '0'],
  tecnico: ['0', '0', '0', '0', '1', '0', '1', '1e', '0', '0'],
  costos: ['0', '0', '0', '0', '0', '0', '2', '2e', '2', '0'],
  marketing: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '3e'],
  marketing_gerente: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '3e'],
};
// Permisos virtuales de las áreas: «X.ver» (ve algo), «X.sucursal» (toda su sucursal), «X.empresa» (todas las
// sucursales) y «X.editar». Además «ventas.ver» y «compras.ver»: ve alguna pantalla de ese grupo (menú e Inicio).
const VIRTUALES = [...AREAS.flatMap(a => [a.clave + '.ver', a.clave + '.sucursal', a.clave + '.empresa', ...(a.editable ? [a.clave + '.editar'] : [])]), 'ventas.ver', 'compras.ver'];
const GRUPO_VENTAS = ['contactos', 'prospeccion', 'generador', 'cotizaciones', 'ordenes'], GRUPO_COMPRAS = ['solicitudes', 'ordenes_compra'];
const virtualesDe = (niv, edita = {}) => [
  ...AREAS.flatMap(a => [...(niv[a.clave] >= 1 ? [a.clave + '.ver'] : []), ...(niv[a.clave] >= 2 ? [a.clave + '.sucursal'] : []), ...(niv[a.clave] >= 3 ? [a.clave + '.empresa'] : []),
    ...(a.editable && edita[a.clave] && niv[a.clave] >= 1 ? [a.clave + '.editar'] : [])]),
  ...(GRUPO_VENTAS.some(a => niv[a] >= 1) ? ['ventas.ver'] : []), ...(GRUPO_COMPRAS.some(a => niv[a] >= 1) ? ['compras.ver'] : []),
];
const CLAVES = new Set([...CATALOGO.map(p => p.clave), ...VIRTUALES]);
const REALES = new Set(CATALOGO.map(p => p.clave));
// Permiso → los que necesita para tener sentido (y para que la pantalla los marque juntos).
const DEPENDE = {
  'dinero.mover': ['cxp.ver', 'gastos.registrar'],
  'cobros.confirmar': ['cxc.ver'],
  'cobranza.factura': ['cxc.ver'], // crédito y datos de factura: solo quien ve la cobranza
  'gastos.ver_orden': ['cxp.ver', 'ordenes.ver'],
  'cobros.directo': ['cobros.registrar'],
  'cobros.ajustes': ['cobros.registrar', 'cxc.ver'],
  'compras.aprobar_propias': ['compras.gestionar'],
  'compras.gestionar': ['solicitudes.sucursal', 'ordenes_compra.sucursal', 'compras.importes'],
  'compras.autorizar': ['ordenes_compra.sucursal', 'compras.importes'],
  'ordenes.importe_ganada': ['ordenes.editar', 'ordenes.importes'],
  'ventas.editar_otros': ['ordenes.sucursal'],
  'generador.cargar': ['generador.sucursal', 'ordenes.editar', 'ordenes.importes'], // crea órdenes de cualquier cliente de la sucursal
  'reportes.analisis': ['ordenes.importes'],
  'reportes.panorama': ['reportes.analisis'],
  'clientes.exportar': ['ordenes.importes', 'contactos.ver'], // el Excel lleva los importes
  'personal.editar': ['personal.ver'],
  'personal.sensibles': ['personal.ver'],
  'marketing.aprobar': ['marketing.ver'],
};
const nombreDe = c => {
  const p = CATALOGO.find(x => x.clave === c); if (p) return p.nombre;
  const [area, tipo] = c.split('.'), a = AREAS.find(x => x.clave === area);
  if (c === 'ventas.ver') return 'ver alguna pantalla de ventas';
  if (c === 'compras.ver') return 'ver solicitudes u órdenes de compra';
  return a ? `${a.nombre}: ${{ sucursal: 'ver toda su sucursal', empresa: 'ver toda la empresa', editar: 'editar' }[tipo] || 'ver al menos lo suyo'}` : c;
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
  ['marketing', 'Marketing', 'Calendario de publicaciones: las escribe, sube imágenes y comenta'], ['marketing_gerente', 'Gerente de marketing', 'Marketing, y aprueba las publicaciones'],
];

module.exports = function crearPermisos(db, app, h) {
  db.exec(`CREATE TABLE IF NOT EXISTS roles (
    clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT, sistema INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1, orden INTEGER NOT NULL DEFAULT 0, creado_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS rol_permisos (rol TEXT NOT NULL REFERENCES roles(clave), permiso TEXT NOT NULL, PRIMARY KEY (rol, permiso));
  CREATE TABLE IF NOT EXISTS permisos_sembrados (permiso TEXT PRIMARY KEY);`);
  // Qué ve cada rol en cada área (0 a 3) y si edita. La tabla de antes (0 a 2, sin «editar») se rehace con lo que tenía.
  const sqlAlcances = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rol_alcances'").get()?.sql || '';
  const TABLA_ALCANCES = `(rol TEXT NOT NULL REFERENCES roles(clave), area TEXT NOT NULL, nivel INTEGER NOT NULL CHECK(nivel BETWEEN 0 AND 3),
    editar INTEGER NOT NULL DEFAULT 0 CHECK(editar IN (0, 1)), PRIMARY KEY (rol, area))`;
  if (!sqlAlcances) db.exec('CREATE TABLE rol_alcances ' + TABLA_ALCANCES);
  else if (!/editar/.test(sqlAlcances)) db.transaction(() => {
    db.exec('CREATE TABLE rol_alcances_nueva ' + TABLA_ALCANCES);
    db.exec('INSERT INTO rol_alcances_nueva (rol, area, nivel) SELECT rol, area, nivel FROM rol_alcances');
    db.exec('DROP TABLE rol_alcances');
    db.exec('ALTER TABLE rol_alcances_nueva RENAME TO rol_alcances');
  })();
  db.transaction(() => {
    const insRol = db.prepare('INSERT OR IGNORE INTO roles (clave, nombre, descripcion, sistema, orden) VALUES (?, ?, ?, 1, ?)');
    ROLES_BASE.forEach(([c, n, d], i) => insRol.run(c, n, d, i));
    const ya = new Set(db.prepare('SELECT permiso FROM permisos_sembrados').all().map(r => r.permiso));
    const roles = new Set(db.prepare('SELECT clave FROM roles').all().map(r => r.clave));
    const dar = db.prepare('INSERT OR IGNORE INTO rol_permisos (rol, permiso) VALUES (?, ?)');
    const marcar = m => db.prepare('INSERT OR IGNORE INTO permisos_sembrados (permiso) VALUES (?)').run(m);
    const tenia = (rol, p) => !!db.prepare('SELECT 1 FROM rol_permisos WHERE rol = ? AND permiso = ?').get(rol, p);
    // Los roles que inventó Dirección: lo que tenían antes de un permiso nuevo (para no quitarles ni darles de más).
    const inventados = [...roles].filter(r => r !== 'admin' && !ALCANCE_INICIAL[r]);
    const antes = Object.fromEntries(inventados.map(r => [r, { importes: tenia(r, 'ordenes.importes'), prospeccion: tenia(r, 'prospeccion.ver') }]));
    let sembroAlgo = false;
    for (const p of CATALOGO) {
      if (ya.has(p.clave)) continue;
      p.roles.filter(r => roles.has(r)).forEach(r => dar.run(r, p.clave));
      marcar(p.clave);
      sembroAlgo = true;
    }
    // Qué ve cada rol: se siembra una vez por área. Los roles de fábrica con la tabla aprobada; los que inventó Dirección
    // a partir de las áreas de antes (2026-10-26: «Contactos, cotizaciones y órdenes» y «Compras» se separaron), sin
    // editar: Dirección prende ✎ donde sí deba editar (así lo decidió).
    const nivelViejo = (r, area) => db.prepare('SELECT nivel FROM rol_alcances WHERE rol = ? AND area = ?').get(r, area)?.nivel ?? 0;
    const fijar = db.prepare('INSERT OR IGNORE INTO rol_alcances (rol, area, nivel, editar) VALUES (?, ?, ?, ?)');
    AREAS.forEach((a, i) => {
      if (ya.has('area:' + a.clave)) return;
      sembroAlgo = true;
      for (const r of roles) {
        if (r === 'admin') continue;
        if (ALCANCE_INICIAL[r]) { const v = ALCANCE_INICIAL[r][i]; fijar.run(r, a.clave, Number(v[0]), v.endsWith('e') ? 1 : 0); continue; }
        const ventas = nivelViejo(r, 'ventas'), compras = nivelViejo(r, 'compras');
        const nivel = { contactos: ventas, cotizaciones: ventas, ordenes: ventas, generador: antes[r].importes ? ventas : 0, prospeccion: antes[r].prospeccion ? ventas : 0,
          solicitudes: compras, ordenes_compra: compras }[a.clave] ?? nivelViejo(r, a.clave);
        fijar.run(r, a.clave, nivel, 0);
      }
      marcar('area:' + a.clave);
    });
    // Decisiones de Dirección del 2026-10-26, una sola vez: el técnico ve el importe de sus órdenes; nadie más que Dirección
    // borra (se quita «Eliminar»); marcar realizado es de quien hizo la orden, el Gerente y Dirección (se quita la casilla).
    // Los roles inventados conservan el Análisis comercial y los montos de compras que ya veían.
    if (!ya.has('decisiones:2026-10-26')) {
      if (roles.has('tecnico')) dar.run('tecnico', 'ordenes.importes');
      db.prepare("DELETE FROM rol_permisos WHERE permiso IN ('prospeccion.ver', 'ordenes.estatus', 'ordenes.eliminar', 'cxc.ver', 'cxp.ver')").run();
      db.prepare("DELETE FROM rol_alcances WHERE area IN ('ventas', 'compras')").run();
      for (const r of inventados) {
        if (antes[r].importes) dar.run(r, 'reportes.analisis');
        dar.run(r, 'compras.importes');
      }
      sembroAlgo = true;
      marcar('decisiones:2026-10-26');
    }
    // Las decisiones anteriores ya vienen en la tabla de arriba (técnico: solo sus cobros; Atención: sus gastos; catálogos).
    ['prospeccion:otros', 'ordenes.importes', 'tecnico:solo-sus-cobros', 'decisiones:2026-10-22'].forEach(marcar);
    // Al sembrar, lo que quedó sin sentido (p. ej. «Cambiar importe» para quien ya no edita órdenes) se quita.
    if (sembroAlgo) for (const r of roles) {
      if (r === 'admin') continue;
      const filas = db.prepare('SELECT area, nivel, editar FROM rol_alcances WHERE rol = ?').all(r);
      const niv = Object.fromEntries(filas.map(x => [x.area, x.nivel])), ed = Object.fromEntries(filas.map(x => [x.area, !!x.editar]));
      const set = new Set([...db.prepare('SELECT permiso FROM rol_permisos WHERE rol = ?').all(r).map(x => x.permiso), ...virtualesDe(niv, ed)]);
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
  // Qué ve el rol en cada área ({ contactos: 0|1|2|3, … }) y en cuáles edita ({ contactos: true, … }). Dirección: todo.
  const leerAlcances = () => {
    if (cacheNiv) return cacheNiv;
    cacheNiv = new Map();
    for (const { rol: r, area, nivel, editar } of db.prepare('SELECT rol, area, nivel, editar FROM rol_alcances').all()) {
      if (!cacheNiv.has(r)) cacheNiv.set(r, { niv: {}, ed: {} });
      cacheNiv.get(r).niv[area] = nivel; cacheNiv.get(r).ed[area] = !!editar;
    }
    return cacheNiv;
  };
  const nivelesDe = rol => {
    if (rol === 'admin') return Object.fromEntries(AREAS.map(a => [a.clave, 3]));
    const n = leerAlcances().get(rol)?.niv || {};
    return Object.fromEntries(AREAS.map(a => [a.clave, n[a.clave] ?? 0]));
  };
  const edicionesDe = rol => {
    if (rol === 'admin') return Object.fromEntries(EDITABLES.map(a => [a, true]));
    const e = leerAlcances().get(rol)?.ed || {};
    return Object.fromEntries(EDITABLES.map(a => [a, !!e[a]]));
  };
  const virtualesRol = rol => virtualesDe(nivelesDe(rol), edicionesDe(rol));
  const olvidar = () => { cache = null; cacheNiv = null; };
  // «Ver como este rol» (solo Dirección): las revisiones usan los permisos de ese rol (ver las rutas).
  const rolDe = req => req.usuarioSesion?.ver_como || req.usuarioSesion?.rol_real || req.usuarioSesion?.rol;
  const delRol = rol => (rol === 'admin' ? new Set(CLAVES) : new Set([...[...(mapa().get(rol) || [])].filter(c => REALES.has(c)), ...virtualesRol(rol)]));
  const tieneRol = (rol, clave) => rol === 'admin' || (REALES.has(clave) ? !!mapa().get(rol)?.has(clave) : virtualesRol(rol).includes(clave));
  const puede = (req, clave) => {
    if (!CLAVES.has(clave)) throw new Error('Permiso desconocido: ' + clave);
    return tieneRol(rolDe(req), clave);
  };
  // Qué ve el rol de quien pide: se guarda en el alcance de la petición para que las vistas de la base filtren
  // «lo suyo». Lo llama sucursales.js al armar el alcance (antes del candado por número). Dirección ve todo, salvo
  // cuando «ve como» otro rol (encabezado X-Ver-Como válido; si no es válido, la petición se rechaza después).
  function prepararAlcance(req, a) {
    const u = req.usuarioSesion; if (!u || !a) return;
    a.usuarioId = u.id; // quién pide (también Dirección: así queda quién capturó lo que registra)
    const real = u.rol_real || u.rol;
    let rol = real;
    if (real === 'admin') { const v = req.get('X-Ver-Como'); if (!v || v === 'admin' || !rolValido(v)) return; rol = v; }
    a.usuarioId = u.id; a.niveles = nivelesDe(rol); a.gastosOrden = tieneRol(rol, 'gastos.ver_orden'); a.editarOtros = tieneRol(rol, 'ventas.editar_otros');
  }
  // ¿Puede editar este contacto, cotización u orden? (2026-10-26) Dirección siempre; los demás, si su rol edita esa área
  // y es suyo (lo capturó o está a su nombre), o si tiene «Editar lo de otros» (Gerente). Ver una orden no basta.
  // «suyo»: true si quien pide lo capturó o lo tiene a su nombre (lo calcula quien llama, según la tabla).
  const puedeEditar = (req, area, suyo) => direccion(req) || (puede(req, area + '.editar') && (suyo || puede(req, 'ventas.editar_otros')));
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

  // Borrar es solo de Dirección (2026-10-26): cotizaciones, órdenes, usuarios, roles, servicios y catálogos. Quitar un
  // teléfono de un contacto es corregirlo (lo hace quien edita el contacto). Cancelar cobros, pagos o documentos no
  // borra: queda el rastro con su motivo.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'DELETE' || !req.usuarioSesion || direccion(req) || /^\/clientes\/\d+\/telefonos\//.test(req.path)) return next();
    res.status(403).json({ error: 'Borrar solo lo hace Dirección', codigo: 'SOLO_DIRECCION' });
  });

  // Reportes de ventas (2026-10-26): el Generador es su propia área y el Análisis comercial su propio permiso (el técnico
  // ve el importe de sus órdenes, pero no los reportes).
  app.use('/api', (req, res, next) => {
    if (!req.usuarioSesion) return next();
    if (/^\/generador(\/|$)/.test(req.path) && req.method === 'GET' && !puede(req, 'generador.ver')) return res.status(403).json({ error: 'Tu rol no ve el Generador' });
    if (/^\/analisis(\/|$)/.test(req.path) && !puede(req, 'reportes.analisis')) return res.status(403).json({ error: 'Tu rol no ve el Análisis comercial' });
    next();
  });

  // Prospección es de ventas: quien no ve ventas no entra (las vistas tampoco le muestran establecimientos).
  app.use('/api/prospeccion', (req, res, next) => {
    if (!req.usuarioSesion) return next();
    if (!puede(req, 'prospeccion.ver')) return res.status(403).json({ error: 'Tu rol no ve prospección' });
    if (req.method !== 'GET' && !puede(req, 'prospeccion.editar')) return res.status(403).json({ error: 'Tu rol solo consulta la prospección' });
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
    res.json({ rol, rol_nombre: nombreRol(rol), ver_como: req.usuarioSesion.ver_como || null, permisos: [...delRol(rol)], todas: [...CLAVES], alcances: nivelesDe(rol), ediciones: edicionesDe(rol), direccion: esGeneral(req), usuario_id: req.usuarioSesion.id });
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
      roles: roles().filter(r => r.activo).map(r => ({ ...r, editable: r.clave !== 'admin', usuarios: usuarios[r.clave] || 0, permisos: [...delRol(r.clave)], alcances: nivelesDe(r.clave), ediciones: edicionesDe(r.clave) })),
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
    const nivAntes = nivelesDe(rol.clave), al = req.body.alcances, edAntes = edicionesDe(rol.clave), ed = req.body.ediciones;
    if (al !== undefined && (al === null || typeof al !== 'object' || Array.isArray(al) || Object.entries(al).some(([k, v]) => !AREAS.some(a => a.clave === k) || ![0, 1, 2, 3].includes(v))))
      return res.status(400).json({ error: 'Niveles de «qué ve» inválidos' });
    if (ed !== undefined && (ed === null || typeof ed !== 'object' || Array.isArray(ed) || Object.entries(ed).some(([k, v]) => !EDITABLES.includes(k) || typeof v !== 'boolean')))
      return res.status(400).json({ error: 'Casillas de «edita» inválidas' });
    const nivNuevos = { ...nivAntes, ...(al || {}) };
    // Sin ver nada en un área, tampoco la edita.
    const edNuevos = Object.fromEntries(EDITABLES.map(a => [a, !!({ ...edAntes, ...(ed || {}) })[a] && nivNuevos[a] >= 1]));
    // Los permisos virtuales salen de los niveles, no de la lista.
    const nuevos = new Set([...lista.filter(c => REALES.has(c)), ...virtualesDe(nivNuevos, edNuevos)]), antes = delRol(rol.clave);
    // «antes» = lo que la persona vio al abrir la pantalla. Si alguien más guardó este rol mientras tanto, no se pisa.
    if (Array.isArray(req.body.antes) && [...antes].sort().join() !== [...new Set(req.body.antes)].filter(c => CLAVES.has(c)).sort().join())
      return res.status(409).json({ error: `Alguien más cambió los permisos de «${rol.nombre}» mientras los editabas. Recarga para ver lo actual.`, codigo: 'CAMBIADO' });
    const malas = faltantes(nuevos);
    if (malas.length) return res.status(400).json({ error: malas.map(([p, r]) => `«${nombreDe(p)}» necesita «${nombreDe(r)}»`).join('; '), faltan: malas });
    const dados = [...nuevos].filter(c => REALES.has(c) && !antes.has(c)), quitados = [...antes].filter(c => REALES.has(c) && !nuevos.has(c));
    const areasCambian = AREAS.filter(a => nivNuevos[a.clave] !== nivAntes[a.clave] || (a.editable && edNuevos[a.clave] !== edAntes[a.clave]));
    if (!dados.length && !quitados.length && !areasCambian.length) return res.json({ ok: true, cambios: 0 });
    db.transaction(() => {
      const del = db.prepare('DELETE FROM rol_permisos WHERE rol = ? AND permiso = ?'), ins = db.prepare('INSERT OR IGNORE INTO rol_permisos (rol, permiso) VALUES (?, ?)');
      quitados.forEach(c => del.run(rol.clave, c)); dados.forEach(c => ins.run(rol.clave, c));
      const fija = db.prepare('INSERT INTO rol_alcances (rol, area, nivel, editar) VALUES (?, ?, ?, ?) ON CONFLICT(rol, area) DO UPDATE SET nivel = excluded.nivel, editar = excluded.editar');
      areasCambian.forEach(a => fija.run(rol.clave, a.clave, nivNuevos[a.clave], edNuevos[a.clave] ? 1 : 0));
    })();
    olvidar();
    audit(req, rol.clave, 'permisos', `${rol.nombre}: ` + [dados.length ? 'se dio ' + dados.map(nombreDe).join(', ') : '', quitados.length ? 'se quitó ' + quitados.map(nombreDe).join(', ') : '',
      ...areasCambian.map(a => `${a.nombre}: ${NIVELES[nivAntes[a.clave]]}${edAntes[a.clave] ? ' ✎' : ''} → ${NIVELES[nivNuevos[a.clave]]}${edNuevos[a.clave] ? ' ✎' : ''}`)].filter(Boolean).join(' · '));
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
      const niv = copiar ? nivelesDe(copiar.clave) : {}, edc = copiar ? edicionesDe(copiar.clave) : {};
      AREAS.forEach(a => db.prepare('INSERT INTO rol_alcances (rol, area, nivel, editar) VALUES (?, ?, ?, ?)').run(clave, a.clave, niv[a.clave] ?? 0, edc[a.clave] ? 1 : 0));
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

  return { CATALOGO, CLAVES, DEPENDE, AREAS, nivelesDe, edicionesDe, prepararAlcance, puede, puedeEditar, exigir, direccion, tieneRol, delRol, rolDe, cabe, roles, rolValido, nombreRol, olvidar };
};
