// FOTO DE QUÉ VE Y QUÉ HACE CADA ROL (pedida por Dirección el 2026-10-21, para que no haya sorpresas).
//  · Arma un equipo de prueba en Querétaro (y un vendedor en CDMX) con datos marcados: cada dato lleva una palabra o
//    un monto único. Como cada rol pide TODAS las rutas del sistema (listas, detalles con cada id, reportes, buscador)
//    y se anota qué datos le llegan. También las pantallas del menú, sus niveles y sus permisos.
//  · Con eso escribe una tabla legible, tests/foto-roles.md, que Dirección revisa y aprueba. Si después algo cambia
//    lo que ve un rol, esta prueba falla y muestra la diferencia: el cambio se ve en el PR antes de subir.
//  · Aparte, las REGLAS acordadas con Dirección se revisan una por una, con su fecha. Una regla no se ajusta al
//    código: si el código no la cumple, falla.
// Uso: node tests/foto-roles.cjs                (compara con la foto aprobada)
//      node tests/foto-roles.cjs --actualizar   (reescribe la foto; la diferencia se revisa en el PR)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const FOTO = path.join(__dirname, 'foto-roles.md'), ACTUALIZAR = process.argv.includes('--actualizar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-foto-')), DB = path.join(dir, 'foto.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Foto-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-Foto-2026x';
const PUERTO = String(8980 + Math.floor(Math.random() * 15)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const RANGO = 'desde=2020-01-01&hasta=' + dia(60);
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };

// Columnas de la foto: un integrante por rol (Dirección es el admin).
const ROLES = [['admin', 'Dirección'], ['gerente', 'Gerente'], ['ventas', 'Ventas'], ['atencion', 'Atención'], ['tecnico', 'Técnico'], ['costos', 'Costos y compras']];
// Un monto se busca escrito de las formas en que puede salir: 7123.41, 712341 (centavos) y 7,123.41.
const formas = v => { const c = Math.round(v * 100); return [(c / 100).toFixed(2), String(c), (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })]; };
const conIva = v => [...formas(v), ...formas(Math.round(v * 116) / 100)];

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);
  const SERV = servicios[0], partidas = (leyenda, importe) => JSON.stringify([{ servicio: SERV.nombre, leyenda, importe }]);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  // El equipo: quién observa por cada rol, y otros para que «lo suyo» se note.
  const T = { Direccion: A }, ID = {};
  for (const [nombre, rol, suc] of [['Valeria Ventas', 'ventas', qro.id], ['Bruno Ventas', 'ventas', qro.id], ['Tomas Tecnico', 'tecnico', qro.id], ['Tito Tecnico', 'tecnico', qro.id],
    ['Alicia Atencion', 'atencion', qro.id], ['Carlos Compras', 'costos', qro.id], ['Gema Gerente', 'gerente', qro.id], ['Diego Ventas', 'ventas', cdmx.id]]) {
    const u = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] }), 'crear a ' + nombre);
    const k = nombre.split(' ')[0]; ID[k] = u.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const OBSERVA = { admin: T.Direccion, gerente: T.Gema, ventas: T.Valeria, atencion: T.Alicia, tecnico: T.Tomas, costos: T.Carlos };

  // ----- Datos marcados -----
  const contacto = async (t, nombre, tel, empresa) => exigir(await pedir('POST', '/contactos', t, { nombre, telefono: tel, empresa_contacto: empresa, direccion: 'Querétaro centro', canal_origen_id: canales[0].id }), 'crear contacto ' + empresa);
  const cotizar = async (t, quien, cliente, leyenda, imp, ganada) => exigir(await pedir('POST', '/leads', t, { cliente_id: cliente.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID[quien],
    partidas_json: partidas(leyenda, imp), iva_modo: 'mas_iva', valor: imp, ...(ganada ? { estatus: 'ganado', fecha_servicio: dia(-5) } : {}) }), 'cotizar ' + leyenda);
  const cAmbar = await contacto(T.Valeria, 'Lic. Ambar Uno', '442 222 0001', 'Planta Ambar');
  const cBerilo = await contacto(T.Bruno, 'Sra. Berilo Dos', '442 222 0002', 'Hotel Berilo');
  const cDiamante = await contacto(T.Bruno, 'Ing. Diamante Tres', '442 222 0003', 'Torre Diamante');
  const cCoral = await contacto(T.Diego, 'Arq. Coral Cuatro', '55 2222 0004', 'Plaza Coral');
  const O1 = await cotizar(T.Valeria, 'Valeria', cAmbar, 'Limpieza Ambar', 7123.41, true);
  const Q2 = await cotizar(T.Bruno, 'Bruno', cBerilo, 'Trampa Berilo', 8231.57);
  const O4 = await cotizar(T.Bruno, 'Bruno', cDiamante, 'Desazolve Diamante', 4417.89, true);
  const O3 = await cotizar(T.Diego, 'Diego', cCoral, 'Carcamo Coral', 9347.23, true);
  const asignar = async (t, lead, tec) => exigir(await pedir('PUT', '/leads/' + lead.id, t, { version: (await pedir('GET', '/leads/' + lead.id, t))[1].version, tecnico_id: ID[tec] }), 'asignar técnico');
  await asignar(T.Valeria, O1, 'Tomas'); await asignar(T.Bruno, O4, 'Tito');
  // Cobros en la orden de Valeria: uno de Alicia (atención) y uno de Tomás en campo.
  exigir(await pedir('POST', '/leads/' + O1.id + '/cobros', T.Alicia, { monto: 1013.29, metodo: 'transferencia' }), 'cobro de Alicia');
  exigir(await pedir('POST', '/leads/' + O1.id + '/cobros', T.Tomas, { monto: 503.61, metodo: 'efectivo' }), 'cobro de Tomás');
  const saldoO1 = (await pedir('GET', '/leads/' + O1.id + '/cobros', A))[1].cuenta.saldo;
  // Gastos: Tomás al marcar realizado; Valeria y Carlos en cuentas por pagar.
  const clabeProv = '012180555888222117'; // CLABE válida (dígito verificador), marcada para buscarla
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', T.Carlos, { nombre: 'Pipas del Centro', tipo_comprobante: 'factura', clabe: clabeProv, banco: 'BBVA' }), 'crear proveedor');
  exigir(await pedir('POST', '/leads/' + O1.id + '/ejecucion', T.Tomas, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diesel de campo', total: 813.37 }] }), 'realizado con gasto');
  exigir(await pedir('POST', '/finanzas/cxp', T.Valeria, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Casetas de visita', total: 311.13, fecha_documento: HOY, lead_id: O1.id, dias_credito: 0 }), 'gasto de Valeria');
  exigir(await pedir('POST', '/finanzas/cxp', T.Carlos, { proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Renta de pipa', total: 2577.19, fecha_documento: HOY, lead_id: O4.id, dias_credito: 15 }), 'gasto de Carlos');
  exigir(await pedir('POST', '/finanzas/cxp', T.Alicia, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Mensajería de documentos', total: 419.23, fecha_documento: HOY, lead_id: O4.id, dias_credito: 0 }), 'gasto de Alicia');
  // Solicitudes de compra.
  exigir(await pedir('POST', '/compras/solicitudes', T.Tomas, { que: 'Manguera Jade', para_que: 'Se rompió en servicio', centro_id: centros[0].id }), 'solicitud de Tomás');
  exigir(await pedir('POST', '/compras/solicitudes', T.Valeria, { que: 'Botas Perla', para_que: 'Para visitas de obra', centro_id: centros[0].id }), 'solicitud de Valeria');
  // Prospección.
  const [, sectores] = await pedir('GET', '/prospeccion/sectores', T.Valeria);
  const prospecto = async (t, quien, nombre) => exigir(await pedir('POST', '/prospeccion', t, { nombre, sector_id: sectores[0].id, zona: 'Querétaro', direccion: '', telefono: '', correo: '', persona: '', cargo: '', fuente: '', necesidades: '', estado: 'investigar', responsable_id: ID[quien], proximo_contacto: '' }), 'prospecto ' + nombre);
  await prospecto(T.Valeria, 'Valeria', 'Taller Granate'); await prospecto(T.Bruno, 'Bruno', 'Taller Cuarzo');
  // Personal: un empleado con datos sensibles.
  const CLABE = '072180001234567898'.slice(0, 17); const conDigito = p17 => { const w = [3, 7, 1]; let s = 0; for (let i = 0; i < 17; i++) s += (Number(p17[i]) * w[i % 3]) % 10; return p17 + ((10 - (s % 10)) % 10); };
  const clabe = conDigito(CLABE), salario = 23456.78;
  exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Ernesto Obsidiana', puesto: 'Operador', telefono: '442 987 6543', fecha_ingreso: dia(-200), clabe, salario, salario_periodo: 'mensual' }), 'alta de personal');

  // ----- Qué datos se buscan (fila de la foto → marcas que la delatan) -----
  const DATOS = [
    ['Ventas', [
      ['ambar', 'Orden de Valeria (vendedora), asignada a Tomás (técnico): cliente y servicio', ['Ambar']],
      ['ambar$', '… y su importe', conIva(7123.41)],
      ['berilo', 'Cotización de Bruno (otro vendedor de la sucursal): cliente', ['Berilo']],
      ['berilo$', '… y su importe', conIva(8231.57)],
      ['diamante', 'Orden de Bruno asignada a Tito (otro técnico): cliente', ['Diamante']],
      ['coral', 'Orden de Diego (otra sucursal): cliente', ['Coral']],
    ]],
    ['Cuentas por cobrar', [
      ['cobroTomas', 'Cobro que registró Tomás (técnico) en la orden de Valeria', formas(503.61)],
      ['cobroAlicia', 'Cobro que registró Alicia (atención) en la orden de Valeria', formas(1013.29)],
      ['saldo', 'Saldo de la orden de Valeria (lo que debe el cliente)', formas(saldoO1)],
    ]],
    ['Cuentas por pagar', [
      ['gastoTomas', 'Gasto que registró Tomás (técnico) en la orden de Valeria', formas(813.37)],
      ['gastoValeria', 'Gasto que registró Valeria (ventas) en su orden', formas(311.13)],
      ['gastoCarlos', 'Gasto que registró Carlos (compras) en la orden de Bruno', formas(2577.19)],
      ['gastoAlicia', 'Gasto que registró Alicia (atención) en la orden de Bruno', formas(419.23)],
    ]],
    ['Proveedores', [
      ['clabeProv', 'Datos bancarios de un proveedor (CLABE)', [clabeProv]],
    ]],
    ['Compras', [
      ['jade', 'Solicitud de compra de Tomás', ['Jade']],
      ['perla', 'Solicitud de compra de Valeria', ['Perla']],
    ]],
    ['Prospección', [
      ['granate', 'Prospecto de Valeria', ['Granate']],
      ['cuarzo', 'Prospecto de Bruno', ['Cuarzo']],
    ]],
    ['Personal', [
      ['obsidiana', 'Un empleado activo: nombre y puesto (para asignarlo a una orden)', ['Obsidiana']],
      ['fichaEmp', 'Su ficha: teléfono, licencia, ingreso', ['442 987 6543', '4429876543']],
      ['clabe', 'Sus datos sensibles: CLABE y salario', [clabe, ...formas(salario)]],
    ]],
  ];

  // ----- Rastreo: todas las rutas del sistema como cada rol -----
  const rutasGet = [];
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'server')).filter(f => f.endsWith('.js')))
    for (const m of fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8').matchAll(/app\.get\(\s*'\/api(\/[^']+)'/g)) rutasGet.push(m[1]);
  const ids = new Set([O1, Q2, O3, O4].map(x => x.id).concat([cAmbar, cBerilo, cDiamante, cCoral].map(c => c.id)));
  for (const r of ['/finanzas/cxp?vista=todas', '/compras/solicitudes?estado=', '/compras/ordenes', '/personal', '/prospeccion']) {
    const [, j] = await pedir('GET', r, A); for (const x of (Array.isArray(j) ? j : j.lista || j.items || [])) if (x && x.id) ids.add(x.id);
  }
  const EXTRA = ['/leads', '/leads?estatus=ganado', '/clientes', '/clientes?incluir_prospectos=1', '/clientes/catalogo', '/finanzas/cartera', '/finanzas/cartera?vista=clientes', '/finanzas/resumen',
    '/finanzas/periodo?' + RANGO, '/finanzas/cxp?vista=todas', '/finanzas/por-confirmar', '/tablero?' + RANGO, '/generador?' + RANGO, '/calendario?desde=' + dia(-40) + '&hasta=' + dia(50),
    '/calendario/atrasados', '/compras/solicitudes?estado=', '/compras/ordenes', '/kpis', '/pendientes', '/analisis/comercial?' + RANGO, '/contactos/sin-cotizacion', '/personal', '/personal/avisos',
    '/prospeccion', '/prospeccion?pendientes=1', ...['Ambar', 'Berilo', 'Diamante', 'Coral', 'Jade', 'Perla', 'Granate', 'Cuarzo', 'Obsidiana'].map(p => '/buscar?q=' + p)];
  async function rastrear(t) {
    let todo = '';
    const urls = new Set(EXTRA);
    for (const r of rutasGet) {
      if (/^\/(demo|permisos|roles|admin)\b|buscar-telefono/.test(r)) continue;
      if (!/:[a-z_]+/i.test(r)) { urls.add(r); continue; }
      for (const id of ids) urls.add(r.replace(/:[a-z_]+/gi, String(id)));
    }
    for (const u of urls) { const [st, , tx] = await pedir('GET', u, t); if (st === 200) todo += '\n' + tx.replace(/"q":"[^"]*"/, ''); } // el buscador repite lo buscado
    return todo;
  }
  const VE = {};
  for (const [rol] of ROLES) {
    const todo = await rastrear(OBSERVA[rol]);
    VE[rol] = {};
    for (const [, filas] of DATOS) for (const [clave, , marcas] of filas) VE[rol][clave] = marcas.some(m => todo.includes(m));
  }
  // Reportes: ¿entra?
  const REPORTES = [['generador', 'Generador', '/generador?' + RANGO], ['analisis', 'Resultados · análisis comercial', '/analisis/comercial?' + RANGO], ['panorama', 'Resultados · panorama general', '/tablero?' + RANGO]];
  for (const [rol] of ROLES) for (const [clave, , ruta] of REPORTES) VE[rol]['rep:' + clave] = (await pedir('GET', ruta, OBSERVA[rol]))[0] === 200;

  // ----- Pantallas, niveles y permisos de cada rol -----
  const [, PERM] = await pedir('GET', '/permisos', A);
  const permisosDe = rol => new Set(PERM.roles.find(r => r.clave === rol)?.permisos || []);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const MENU = [...html.matchAll(/<button[^>]*class="(menu-item[^"]*)"[^>]*data-vista="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(([, clases, vista, txt]) => ({ vista, nombre: txt.replace(/<span id="badge[^>]*>[^<]*<\/span>/g, '').replace(/<span class="menu-icono"[^>]*>([^<]*)<\/span>/, '$1 ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), clases: clases.split(/\s+/) }));
  const veMenu = (rol, m) => m.clases.every(c => { const p = c.match(/^perm-([a-z_]+)-([a-z_]+)$/); return p ? rol === 'admin' || permisosDe(rol).has(p[1] + '.' + p[2]) : c === 'solo-general' ? rol === 'admin' : true; });
  for (const [rol] of ROLES) for (const p of PERM.catalogo) VE[rol]['perm:' + p.clave] = rol === 'admin' || permisosDe(rol).has(p.clave);
  const nivelTxt = (rol, area) => {
    if (rol === 'admin') return 'Todo';
    const r = PERM.roles.find(x => x.clave === rol), nv = r.alcances[area], set = permisosDe(rol);
    return area === 'cxc' && nv === 0 && set.has('cobros.registrar') && set.has('ventas.ver') ? 'Solo lo que él registra' : PERM.niveles[nv];
  };

  // ----- Reglas acordadas con Dirección (cada una con su fecha). No se ajustan al código. -----
  const REGLAS = [
    ['2026-10-19', 'Dirección ve todo, en todas las sucursales.', { admin: { ambar: 1, 'ambar$': 1, berilo: 1, coral: 1, cobroAlicia: 1, saldo: 1, gastoCarlos: 1, jade: 1, perla: 1, cuarzo: 1, obsidiana: 1, clabe: 1 } }],
    ['2026-10-19', 'Gerente: todo lo de su sucursal, nada de otra.', { gerente: { ambar: 1, 'ambar$': 1, berilo: 1, diamante: 1, coral: 0, cobroAlicia: 1, saldo: 1, gastoCarlos: 1, gastoTomas: 1, jade: 1, perla: 1, cuarzo: 1 } }],
    ['2026-10-19', 'Ventas ve lo suyo: sus clientes, cotizaciones y órdenes (no las de otro vendedor ni de otra sucursal) y la cobranza de sus órdenes.', { ventas: { ambar: 1, 'ambar$': 1, berilo: 0, diamante: 0, coral: 0, cobroAlicia: 1, cobroTomas: 1, saldo: 1 } }],
    ['2026-10-19', 'Técnico, en cuentas por pagar: solo los gastos que él registró.', { tecnico: { gastoTomas: 1, gastoValeria: 0, gastoCarlos: 0, gastoAlicia: 0 } }],
    ['2026-10-22', 'Ventas, en cuentas por pagar: los gastos que registró y todos los de sus órdenes, aunque los anote otra persona.', { ventas: { gastoValeria: 1, gastoTomas: 1, gastoCarlos: 0, gastoAlicia: 0 } }],
    ['2026-10-22', 'Atención, en cuentas por pagar: solo los gastos que ella registró.', { atencion: { gastoAlicia: 1, gastoTomas: 0, gastoValeria: 0, gastoCarlos: 0 } }],
    ['2026-10-22', 'Catálogos compartidos: los cambian Dirección, Gerente y Compras; Ventas, Atención y Técnico no.', { gerente: { 'perm:catalogos.editar': 1 }, costos: { 'perm:catalogos.editar': 1 }, ventas: { 'perm:catalogos.editar': 0 }, atencion: { 'perm:catalogos.editar': 0 }, tecnico: { 'perm:catalogos.editar': 0 } }],
    ['2026-10-22', 'Costos y compras no registra cobros (no abre órdenes de servicio).', { costos: { 'perm:cobros.registrar': 0 } }],
    ['2026-10-22', 'La CLABE de los proveedores solo la ve quien paga (Dirección, Gerente y Compras); Ventas, Atención y Técnico no.', { admin: { clabeProv: 1 }, gerente: { clabeProv: 1 }, costos: { clabeProv: 1 }, ventas: { clabeProv: 0 }, atencion: { clabeProv: 0 }, tecnico: { clabeProv: 0 } }],
    ['2026-10-19', 'En compras, ventas y técnico ven solo lo que ellos pidieron.', { ventas: { perla: 1, jade: 0 }, tecnico: { jade: 1, perla: 0 } }],
    ['2026-10-19', 'Atención: ventas y cobranza de toda su sucursal.', { atencion: { ambar: 1, berilo: 1, diamante: 1, coral: 0, cobroTomas: 1, saldo: 1 } }],
    ['2026-10-19', 'Técnico: solo las órdenes que tiene asignadas.', { tecnico: { ambar: 1, diamante: 0, berilo: 0, coral: 0 } }],
    ['2026-10-19', 'Costos y compras: ve folio y cliente de las órdenes para ligar gastos, sin montos de venta ni cobranza; todas las cuentas por pagar y compras de su sucursal.', { costos: { ambar: 1, 'ambar$': 0, cobroAlicia: 0, cobroTomas: 0, saldo: 0, gastoTomas: 1, gastoValeria: 1, gastoCarlos: 1, jade: 1, perla: 1 } }],
    ['2026-10-21', 'Técnico, en cuentas por cobrar: solo los cobros que él registró (sin saldos ni vencidos).', { tecnico: { cobroTomas: 1, cobroAlicia: 0, saldo: 0 } }],
    ['2026-10-21', 'Técnico sin «Ver importes»: sus órdenes sin precios ni totales, sin Generador ni Resultados.', { tecnico: { 'ambar$': 0, 'rep:generador': 0, 'rep:analisis': 0, 'rep:panorama': 0 } }],
    ['2026-10-21', 'Prospección: cada quien lo suyo (quien ve toda su sucursal en ventas, todos los de su sucursal); el técnico no prospecta.', { ventas: { granate: 1, cuarzo: 0 }, atencion: { granate: 1, cuarzo: 1 }, tecnico: { granate: 0, cuarzo: 0 } }],
    ['2026-10-19', 'Personal: quien ve órdenes ve nombre y puesto del personal activo, para asignarlo a una orden; la ficha y los datos sensibles, solo Gerente y Dirección.', { gerente: { obsidiana: 1, fichaEmp: 1, clabe: 1 }, ventas: { obsidiana: 1, fichaEmp: 0, clabe: 0 }, atencion: { obsidiana: 1, fichaEmp: 0, clabe: 0 }, tecnico: { obsidiana: 1, fichaEmp: 0, clabe: 0 }, costos: { obsidiana: 0, fichaEmp: 0, clabe: 0 } }],
  ];
  const NOMBRE = Object.fromEntries(DATOS.flatMap(([, f]) => f.map(([k, t]) => [k, t])).concat(REPORTES.map(([k, t]) => ['rep:' + k, t]), PERM.catalogo.map(p => ['perm:' + p.clave, 'puede: ' + p.nombre])));
  console.log('Reglas acordadas:');
  for (const [fecha, regla, esperado] of REGLAS) {
    const fallan = Object.entries(esperado).flatMap(([rol, filas]) => Object.entries(filas).filter(([k, v]) => VE[rol][k] !== !!v)
      .map(([k, v]) => `${ROLES.find(r => r[0] === rol)[1]}: «${NOMBRE[k]}» ${v ? 'debería verse y no se ve' : 'NO debería verse y se ve'}`));
    revisa(!fallan.length, `${fecha} · ${regla}`, fallan);
  }

  // ----- La foto -----
  const si = v => (v ? '✔' : '—');
  const tabla = (titulo, filas) => [`| ${titulo} | ${ROLES.map(r => r[1]).join(' | ')} |`, `|---|${ROLES.map(() => ':-:').join('|')}|`, ...filas.map(([t, celdas]) => `| ${t} | ${celdas.join(' | ')} |`)].join('\n');
  const partes = [
    '# Qué ve y qué hace cada rol',
    '',
    'Foto generada por `tests/foto-roles.cjs` con un equipo de prueba: en Querétaro, Valeria y Bruno (ventas), Tomás y Tito (técnicos), Alicia (atención), Carlos (compras) y Gema (gerente); en CDMX, Diego (ventas). Cada columna es lo que le llega a esa persona al pedir **todas** las rutas del sistema, no solo lo que muestra la pantalla.',
    '',
    'Dirección la revisa y la aprueba. Si un cambio altera lo que ve un rol, la prueba falla hasta actualizar la foto, y la diferencia se ve en el PR antes de subir.',
    '',
    '## Pantallas del menú',
    '',
    tabla('Pantalla', MENU.map(m => [m.nombre, ROLES.map(([rol]) => si(veMenu(rol, m)))])),
    '',
    '## Qué ve en cada área (Roles y permisos)',
    '',
    tabla('Área', PERM.areas.map(a => [a.nombre, ROLES.map(([rol]) => nivelTxt(rol, a.clave))])),
    '',
    '## Qué datos le llegan',
    '',
    ...DATOS.flatMap(([grupo, filas]) => [`### ${grupo}`, '', tabla('Dato', filas.map(([k, t]) => [t, ROLES.map(([rol]) => si(VE[rol][k]))])), '']),
    '### Reportes',
    '',
    tabla('Reporte', REPORTES.map(([k, t]) => [t, ROLES.map(([rol]) => si(VE[rol]['rep:' + k]))])),
    '',
    '## Qué puede hacer',
    '',
    tabla('Permiso', PERM.catalogo.map(p => [`${p.seccion} · ${p.nombre}`, ROLES.map(([rol]) => si(rol === 'admin' || permisosDe(rol).has(p.clave)))])),
    '',
    '## Reglas acordadas que se revisan una por una',
    '',
    ...REGLAS.map(([fecha, regla]) => `- **${fecha}** · ${regla}`),
    '',
  ];
  const foto = partes.join('\n');
  const aprobada = fs.existsSync(FOTO) ? fs.readFileSync(FOTO, 'utf8').replace(/\r\n/g, '\n') : null;
  console.log('Foto de los roles:');
  if (ACTUALIZAR) { fs.writeFileSync(FOTO, foto); revisa(true, 'foto reescrita en tests/foto-roles.md: revisa la diferencia antes de subir'); }
  else if (aprobada === null) revisa(false, 'no hay foto aprobada: corre «node tests/foto-roles.cjs --actualizar» y que Dirección la revise');
  else {
    const a = aprobada.split('\n'), b = foto.split('\n'), cambios = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) cambios.push(`antes: ${a[i] ?? '(nada)'}\n    ahora: ${b[i] ?? '(nada)'}`);
    revisa(!cambios.length, 'lo que ve y hace cada rol coincide con la foto aprobada (tests/foto-roles.md)', cambios.slice(0, 12));
    if (cambios.length) console.log('  Si el cambio es a propósito: node tests/foto-roles.cjs --actualizar, y que Dirección lo revise en el PR.\n    ' + cambios.slice(0, 12).join('\n    '));
  }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
