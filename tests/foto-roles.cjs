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
const ROLES = [['admin', 'Dirección'], ['gerente', 'Gerente'], ['ventas', 'Ventas'], ['atencion', 'Atención'], ['tecnico', 'Técnico'], ['costos', 'Costos y compras'], ['marketing', 'Marketing'], ['marketing_gerente', 'Gerente de marketing']];
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
    ['Alicia Atencion', 'atencion', qro.id], ['Carlos Compras', 'costos', qro.id], ['Gema Gerente', 'gerente', qro.id], ['Diego Ventas', 'ventas', cdmx.id],
    ['Mara Marketing', 'marketing', qro.id], ['Gil Mercadotecnia', 'marketing_gerente', qro.id]]) {
    const u = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] }), 'crear a ' + nombre);
    const k = nombre.split(' ')[0]; ID[k] = u.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const OBSERVA = { admin: T.Direccion, gerente: T.Gema, ventas: T.Valeria, atencion: T.Alicia, tecnico: T.Tomas, costos: T.Carlos, marketing: T.Mara, marketing_gerente: T.Gil };

  // ----- Datos marcados -----
  const contacto = async (t, nombre, tel, empresa) => exigir(await pedir('POST', '/contactos', t, { nombre, telefono: tel, empresa_contacto: empresa, direccion: 'Querétaro centro', canal_origen_id: canales[0].id }), 'crear contacto ' + empresa);
  const cotizar = async (t, quien, cliente, leyenda, imp, ganada) => exigir(await pedir('POST', '/leads', t, { cliente_id: cliente.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID[quien],
    partidas_json: partidas(leyenda, imp), iva_modo: 'mas_iva', valor: imp, forzar_duplicado: true, ...(ganada ? { estatus: 'ganado', fecha_servicio: dia(-5) } : {}) }), 'cotizar ' + leyenda);
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
  // Gastos: Tomás, Valeria, Carlos y Alicia en cuentas por pagar; Valeria marca realizada su orden.
  const clabeProv = '012180555888222117'; // CLABE válida (dígito verificador), marcada para buscarla
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', T.Carlos, { nombre: 'Pipas del Centro', tipo_comprobante: 'factura', clabe: clabeProv, banco: 'BBVA' }), 'crear proveedor');
  exigir(await pedir('POST', '/finanzas/cxp', T.Tomas, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diesel de campo', total: 813.37, fecha_documento: HOY, lead_id: O1.id, dias_credito: 0 }), 'gasto de Tomás');
  exigir(await pedir('POST', '/leads/' + O1.id + '/ejecucion', T.Valeria, { estado: 'realizado', fecha: dia(-1) }), 'realizado');
  exigir(await pedir('POST', '/finanzas/cxp', T.Valeria, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Casetas de visita', total: 311.13, fecha_documento: HOY, lead_id: O1.id, dias_credito: 0 }), 'gasto de Valeria');
  exigir(await pedir('POST', '/finanzas/cxp', T.Carlos, { proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Renta de pipa', total: 2577.19, fecha_documento: HOY, lead_id: O4.id, dias_credito: 15 }), 'gasto de Carlos');
  exigir(await pedir('POST', '/finanzas/cxp', T.Alicia, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Mensajería de documentos', total: 419.23, fecha_documento: HOY, lead_id: O4.id, dias_credito: 0 }), 'gasto de Alicia');
  // Solicitudes de compra.
  exigir(await pedir('POST', '/compras/solicitudes', T.Tomas, { que: 'Manguera Jade', para_que: 'Se rompió en servicio', centro_id: centros[0].id }), 'solicitud de Tomás');
  exigir(await pedir('POST', '/compras/solicitudes', T.Valeria, { que: 'Botas Perla', para_que: 'Para visitas de obra', centro_id: centros[0].id }), 'solicitud de Valeria');
  // Encuesta de la orden de Valeria, contestada por el cliente (insatisfecho): genera un aviso (2026-10-26).
  const tokenEnc = String((await pedir('GET', '/leads/' + O1.id + '/encuesta', T.Valeria))[1].url).split('/e/')[1];
  const [, pregEnc] = await pedir('GET', '/publico/encuesta/' + tokenEnc);
  exigir(await pedir('POST', '/publico/encuesta/' + tokenEnc, null, { aspectos: Object.fromEntries(pregEnc.preguntas.aspectos.flatMap(m => m.items.map(i => [i.clave, 2]))), facturacion: 'si', nps: 4, preventivo: 'no' }), 'contestar la encuesta');
  // Prospección.
  const [, sectores] = await pedir('GET', '/prospeccion/sectores', T.Valeria);
  const prospecto = async (t, quien, nombre) => exigir(await pedir('POST', '/prospeccion', t, { nombre, sector_id: sectores[0].id, zona: 'Querétaro', direccion: '', telefono: '', correo: '', persona: '', cargo: '', fuente: '', necesidades: '', estado: 'investigar', responsable_id: ID[quien], proximo_contacto: '' }), 'prospecto ' + nombre);
  await prospecto(T.Valeria, 'Valeria', 'Taller Granate'); await prospecto(T.Bruno, 'Bruno', 'Taller Cuarzo');
  // Marketing (2026-10-26): una publicación de Mara para Querétaro, una de toda la empresa y una de CDMX.
  const publicacion = async (t, titulo, sucursal) => exigir(await pedir('POST', '/marketing/publicaciones', t, { titulo, redes: ['instagram', 'facebook'], formato: 'post', fecha: dia(3), copy: 'Copy ' + titulo, sucursal }), 'publicación ' + titulo);
  const pubRubi = await publicacion(T.Mara, 'Promo Rubí', qro.id);
  // Proyecto de marketing de Mara con una tarea y un avance (2026-10-26, fase 2).
  const proyOnix = exigir(await pedir('POST', '/marketing/proyectos', T.Mara, { nombre: 'Campaña Ónix', inicio: dia(-5), fin: dia(20), sucursal: 'empresa' }), 'proyecto Ónix');
  const tareaOnix = exigir(await pedir('POST', '/marketing/proyectos/' + proyOnix.id + '/tareas', T.Mara, { titulo: 'Guion Ónix', inicio: dia(-5), fin: dia(2) }), 'tarea Ónix');
  exigir(await pedir('POST', '/marketing/proyectos/' + proyOnix.id + '/avances', T.Mara, { texto: 'Avance Ónix listo' }), 'avance Ónix');
  // Fase 3 (2026-10-27): una idea de Mara y un archivo de la biblioteca.
  exigir(await pedir('PUT', '/facturacion/sucursales/' + qro.id, A, { cp_expedicion: '31416' }), 'CP de expedición de facturación');
  // Catálogo del SAT de prueba (en la API real lo trae factura.com): se siembra en la base para poder validar las claves sin red.
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
    d.prepare("INSERT INTO sat_catalogos (catalogo, clave, nombre) VALUES ('ClaveProductServ', '76121600', 'Disposición de desechos no peligrosos'), ('ClaveUnidad', 'E48', 'Unidad de servicio')").run(); d.close(); }
  const clienteFiscal = await contacto(T.Valeria, 'Cliente Fiscal', '442 555 0188', 'Ónix Servicios');
  const servicioFact = (await pedir('GET', '/servicios', A))[1][0];
  exigir(await pedir('POST', '/facturacion/clientes/' + clienteFiscal.id, A, { rfc: 'COB010203AB1', razon_social: 'Cobalto Fiscal', cp: '76087', regimen: '601', uso_cfdi: 'G03', correo: 'fiscal@cobalto.mx' }), 'datos fiscales de un cliente');
  exigir(await pedir('PUT', '/facturacion/servicios/' + servicioFact.id, A, { clave_prod_serv: '76121600', clave_unidad: 'E48' }), 'clave del SAT de un servicio');
  // Timbrado (F3, 2026-10-27): una orden del cliente con datos fiscales y su factura ya timbrada (se escribe en la base: la prueba no se conecta con factura.com).
  const OF = await cotizar(T.Valeria, 'Valeria', clienteFiscal, 'Servicio Cobalto', 3519.27, true);
  const await_OB = await cotizar(T.Valeria, 'Valeria', clienteFiscal, 'Borrador Cobalto', 1293.20, true), await_OP = await cotizar(T.Valeria, 'Valeria', clienteFiscal, 'Factura real Cobalto', 1000, true);
  let FACT_OF, FACT_BORRADOR, OB, OP;
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
    FACT_OF = Number(d.prepare("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, receptor_rfc, receptor_razon_social, metodo_pago, forma_pago, subtotal_cent, iva_cent, total_cent, serie, folio, cfdi_uid, uuid) VALUES (?, ?, 'timbrada', 'FOTO-OF', 'sandbox', 'COB010203AB1', 'COBALTO FISCAL', 'PUE', '03', 351927, 56308, 408235, 'F', '1', 'foto-uid', '5A1D0C0B-F070-4C0B-8000-00000000F070')").run(OF.id, qro.id).lastInsertRowid);
    // F4 (2026-10-28): una orden con un borrador atorado y otra con una factura REAL ya timbrada (su folio y total se anotan en la cobranza).
    OB = await_OB; OP = await_OP;
    FACT_BORRADOR = Number(d.prepare("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, receptor_rfc, receptor_razon_social, serie, folio, cfdi_uid, subtotal_cent, iva_cent, total_cent) VALUES (?, ?, 'borrador_error', 'FOTO-OB', 'sandbox', 'COB010203AB1', 'COBALTO FISCAL', 'F', '2', 'foto-borrador', 129320, 20691, 150011)").run(OB.id, qro.id).lastInsertRowid);
    d.prepare("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, receptor_rfc, receptor_razon_social, metodo_pago, forma_pago, subtotal_cent, iva_cent, total_cent, serie, folio, cfdi_uid, uuid) VALUES (?, ?, 'timbrada', 'FOTO-OP', 'prod', 'COB010203AB1', 'COBALTO FISCAL', 'PUE', '03', 100000, 16000, 116000, 'F', '3', 'foto-uid-real', '6B2E1D1C-F070-4C0B-8000-00000000F071')").run(OP.id, qro.id);
    d.prepare("UPDATE leads SET factura_folio = 'F-3', factura_total_cent = 116000, factura_metodo = 'PUE' WHERE id = ?").run(OP.id); d.close(); }
  // Fase 4 (2026-10-27): presupuesto del mes propuesto por Gil (Gerente de marketing) y un gasto de marketing.
  const MES = HOY.slice(0, 7);
  exigir(await pedir('PUT', '/marketing/presupuestos/' + MES, T.Gil, { lineas: { pauta: 17345.67 } }), 'presupuesto de marketing');
  exigir(await pedir('POST', '/marketing/gastos', T.Gil, { fecha: HOY, concepto: 'Pauta Turquesa', rubro: 'pauta', monto: 4183.56, proveedor: 'Meta' }), 'gasto de marketing');
  const ideaAgata = exigir(await pedir('POST', '/marketing/ideas', T.Mara, { titulo: 'Idea Ágata', descripcion: 'Reto en TikTok Ágata' }), 'idea Ágata');
  const PNG1 = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex');
  { const x = await fetch(URL + '/marketing/biblioteca', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + T.Mara, 'X-Nombre': encodeURIComponent('logo-Jaspe.png'), 'X-Carpeta': encodeURIComponent('Logos') }, body: PNG1 }); if (x.status !== 201) throw new Error('No se pudo subir a la biblioteca: ' + x.status); }
  await publicacion(A, 'Campaña Zafiro', 'empresa'); await publicacion(A, 'Evento Topacio', cdmx.id);
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
    ['Encuesta', [
      ['avisoEnc', 'Aviso «cliente insatisfecho» de la encuesta de la orden de Valeria', ['Cliente insatisfecho en la encuesta']],
    ]],
    ['Prospección', [
      ['granate', 'Prospecto de Valeria', ['Granate']],
      ['cuarzo', 'Prospecto de Bruno', ['Cuarzo']],
    ]],
    ['Facturación', [
      ['cpFact', 'Código postal de expedición de las facturas (pantalla Facturación)', ['31416']],
      ['claveFact', 'Clave del SAT de un servicio (pantalla Facturación)', ['76121600']],
      ['fiscalCli', 'Datos fiscales de un cliente (razón social para facturar)', ['COBALTO FISCAL']],
      ['cfdiFact', 'Factura timbrada de una orden (folio fiscal / UUID)', ['5A1D0C0B-F070-4C0B-8000-00000000F070']],
    ]],
    ['Marketing', [
      ['rubi', 'Publicación de Mara (Marketing) para Querétaro', ['Rubí']],
      ['zafiro', 'Publicación para toda la empresa', ['Zafiro']],
      ['topacio', 'Publicación de CDMX (otra sucursal)', ['Topacio']],
      ['onix', 'Proyecto de marketing de Mara, con sus tareas y avances', ['Campaña Ónix', 'Guion Ónix', 'Avance Ónix']],
      ['agata', 'Idea de Mara en el banco de ideas', ['Idea Ágata']],
      ['jaspe', 'Archivo de la biblioteca de marketing', ['logo-Jaspe']],
      ['presupMk', 'Presupuesto de marketing del mes (monto)', formas(17345.67)],
      ['gastoMk', 'Gasto de marketing (concepto y monto)', ['Pauta Turquesa', ...formas(4183.56)]],
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
  const ids = new Set([O1, Q2, O3, O4].map(x => x.id).concat([cAmbar, cBerilo, cDiamante, cCoral, clienteFiscal, OF, OB, OP].map(c => c.id)));
  for (const r of ['/finanzas/cxp?vista=todas', '/compras/solicitudes?estado=', '/compras/ordenes', '/personal', '/prospeccion', '/marketing/publicaciones?desde=' + dia(-40) + '&hasta=' + dia(50), '/marketing/proyectos', '/marketing/ideas']) {
    const [, j] = await pedir('GET', r, A); for (const x of (Array.isArray(j) ? j : j.lista || j.items || [])) if (x && x.id) ids.add(x.id);
  }
  const EXTRA = ['/leads', '/leads?estatus=ganado', '/clientes', '/clientes?incluir_prospectos=1', '/clientes/catalogo', '/finanzas/cartera', '/finanzas/cartera?vista=clientes', '/finanzas/resumen',
    '/finanzas/periodo?' + RANGO, '/finanzas/cxp?vista=todas', '/finanzas/por-confirmar', '/tablero?' + RANGO, '/generador?' + RANGO, '/calendario?desde=' + dia(-40) + '&hasta=' + dia(50),
    '/calendario/atrasados', '/compras/solicitudes?estado=', '/compras/ordenes', '/kpis', '/pendientes', '/analisis/comercial?' + RANGO, '/contactos/sin-cotizacion', '/personal', '/personal/avisos',
    '/prospeccion', '/prospeccion?pendientes=1', '/marketing/publicaciones?desde=' + dia(-40) + '&hasta=' + dia(50), '/marketing/pendientes', '/marketing/proyectos', '/marketing/ideas', '/marketing/biblioteca', '/marketing/presupuestos/' + HOY.slice(0, 7), '/marketing/gastos?desde=' + dia(-40) + '&hasta=' + dia(50), '/marketing/tablero', '/marketing/resultados?desde=' + dia(-40) + '&hasta=' + dia(50), '/marketing/plan/' + HOY.slice(0, 4), ...['Ambar', 'Berilo', 'Diamante', 'Coral', 'Jade', 'Perla', 'Granate', 'Cuarzo', 'Obsidiana'].map(p => '/buscar?q=' + p)];
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

  // ----- Acciones: editar, marcar realizado y borrar (2026-10-26) -----
  // Cada rol intenta cambios inofensivos; marcar realizado y borrar, cada uno sobre su propia orden o cotización nueva.
  const ACCIONES = [
    ['editaO1', 'Editar la orden de Valeria (cliente, servicio, técnico…)'],
    ['editaO4', 'Editar la orden de Bruno (otro vendedor)'],
    ['editaAmbar', 'Editar el contacto de Valeria'],
    ['realizado', 'Marcar realizada una orden de Valeria'],
    ['borra', 'Borrar una cotización de Valeria'],
    ['editaPub', 'Editar la publicación de Mara (Marketing)'],
    ['comentaPub', 'Comentar la publicación de Mara'],
    ['apruebaPub', 'Aprobar una publicación en revisión'],
    ['editaProy', 'Editar el proyecto de marketing de Mara (datos, tareas y avances)'],
    ['votaIdea', 'Votar y comentar la idea de Mara'],
    ['decideIdea', 'Aprobar o descartar una idea'],
    ['subeBiblio', 'Subir un archivo a la biblioteca de marketing'],
    ['proponePresup', 'Proponer el presupuesto de marketing del mes'],
    ['apruebaPresup', 'Aprobar el presupuesto de marketing'],
    ['registraGasto', 'Registrar un gasto de marketing'],
    ['mkEnCxp', 'El gasto de marketing aparece en Cuentas por pagar'],
    ['configuraFact', 'Cambiar la configuración de facturación (CP de expedición de una sucursal)'],
    ['claveServicio', 'Cambiar la clave del SAT de un servicio'],
    ['capturaFiscal', 'Capturar los datos fiscales de un cliente'],
    ['timbra', 'Timbrar la factura (CFDI) de una orden'],
    ['reenvia', 'Reenviar una factura por correo'],
    ['descarta', 'Descartar un borrador de factura atorado'],
    ['editaFolioReal', 'Cambiar a mano el folio o el total de una orden que ya tiene factura real timbrada'],
    ['capturaRes', 'Capturar los resultados (alcance, me gusta…) de una publicación ya publicada'],
  ];
  const ok = r => r[0] === 200 || r[0] === 201;
  for (const [rol] of ROLES) {
    const t = OBSERVA[rol];
    const editar = async lead => { const v = (await pedir('GET', '/leads/' + lead.id, A))[1].version; return ok(await pedir('PUT', '/leads/' + lead.id, t, { version: v, observaciones: 'Revisión ' + rol })); };
    VE[rol].editaO1 = await editar(O1);
    VE[rol].editaO4 = await editar(O4);
    VE[rol].editaAmbar = ok(await pedir('PUT', '/clientes/' + cAmbar.id, t, { notas_generales: 'Revisión ' + rol }));
    const nueva = await cotizar(T.Valeria, 'Valeria', cAmbar, 'Prueba ' + rol, 1000, true);
    VE[rol].realizado = ok(await pedir('POST', '/leads/' + nueva.id + '/ejecucion', t, { estado: 'realizado', fecha: dia(-1) }));
    const cot = await cotizar(T.Valeria, 'Valeria', cAmbar, 'Borrar ' + rol, 1000);
    VE[rol].borra = ok(await pedir('DELETE', '/leads/' + cot.id, t, { motivo: 'Prueba de la foto de roles' }));
    const pub = (await pedir('GET', '/marketing/publicaciones/' + pubRubi.id, A))[1];
    VE[rol].editaPub = ok(await pedir('PUT', '/marketing/publicaciones/' + pubRubi.id, t, { version: pub.version, campana: 'Revisión ' + rol }));
    VE[rol].comentaPub = ok(await pedir('POST', '/marketing/publicaciones/' + pubRubi.id + '/comentarios', t, { texto: 'Comentario de ' + rol }));
    const proy = (await pedir('GET', '/marketing/proyectos/' + proyOnix.id, A))[1], tarea = proy.tareas.find(x => x.id === tareaOnix.id);
    VE[rol].editaProy = ok(await pedir('PUT', '/marketing/proyectos/' + proyOnix.id, t, { version: proy.version, objetivo: 'Revisión ' + rol }))
      && ok(await pedir('PUT', '/marketing/tareas/' + tareaOnix.id, t, { version: tarea.version, avance: 50 }))
      && ok(await pedir('POST', '/marketing/proyectos/' + proyOnix.id + '/avances', t, { texto: 'Avance de ' + rol }));
    VE[rol].votaIdea = ok(await pedir('POST', '/marketing/ideas/' + ideaAgata.id + '/voto', t, { voto: true })) && ok(await pedir('POST', '/marketing/ideas/' + ideaAgata.id + '/comentarios', t, { texto: 'Opinión de ' + rol }));
    const otraIdea = exigir(await pedir('POST', '/marketing/ideas', T.Mara, { titulo: 'Por decidir ' + rol }), 'idea por decidir');
    VE[rol].decideIdea = ok(await pedir('POST', '/marketing/ideas/' + otraIdea.id + '/estado', t, { accion: 'aprobar', version: otraIdea.version }));
    { const x = await fetch(URL + '/marketing/biblioteca', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t, 'X-Nombre': encodeURIComponent('prueba-' + rol + '.png'), 'X-Carpeta': encodeURIComponent('Fotos') }, body: Buffer.concat([PNG1, Buffer.from(rol)]) }); VE[rol].subeBiblio = x.status === 201; }
    // Presupuesto: cada rol intenta proponer el de un mes futuro propio y aprobar el del mes (que Gil envía cada vuelta).
    const mesRol = String(2030 + ROLES.findIndex(r => r[0] === rol)) + '-01';
    VE[rol].proponePresup = ok(await pedir('PUT', '/marketing/presupuestos/' + mesRol, t, { lineas: { diseno: 1000 } })) && ok(await pedir('POST', '/marketing/presupuestos/' + mesRol + '/estado', t, { accion: 'enviar', version: (await pedir('GET', '/marketing/presupuestos/' + mesRol, A))[1].version }));
    const mesAp = String(2040 + ROLES.findIndex(r => r[0] === rol)) + '-01';
    exigir(await pedir('PUT', '/marketing/presupuestos/' + mesAp, T.Gil, { lineas: { pauta: 500 } }), 'presupuesto por aprobar');
    exigir(await pedir('POST', '/marketing/presupuestos/' + mesAp + '/estado', T.Gil, { accion: 'enviar', version: (await pedir('GET', '/marketing/presupuestos/' + mesAp, A))[1].version }), 'enviar presupuesto');
    VE[rol].apruebaPresup = ok(await pedir('POST', '/marketing/presupuestos/' + mesAp + '/estado', t, { accion: 'aprobar', version: (await pedir('GET', '/marketing/presupuestos/' + mesAp, A))[1].version }));
    VE[rol].registraGasto = ok(await pedir('POST', '/marketing/gastos', t, { fecha: HOY, concepto: 'Gasto de prueba ' + rol, rubro: 'diseno', monto: 100 }));
    VE[rol].mkEnCxp = /Pauta Turquesa/.test((await pedir('GET', '/finanzas/cxp?vista=todas', t))[2] || '');
    VE[rol].configuraFact = ok(await pedir('PUT', '/facturacion/sucursales/' + qro.id, t, { cp_expedicion: '31416' }));
    VE[rol].capturaFiscal = ok(await pedir('POST', '/facturacion/clientes/' + clienteFiscal.id, t, { rfc: 'ABC010203AB' + String.fromCharCode(65 + ROLES.findIndex(r => r[0] === rol)), razon_social: 'Prueba de ' + rol }));
    { const [st] = await pedir('POST', '/facturacion/ordenes/' + OF.id + '/timbrar', t, { forma_pago: '03' }); VE[rol].timbra = ![401, 403, 404].includes(st); } // ya está timbrada: quien puede recibe 409, quien no, 403/404
    { const [st] = await pedir('POST', '/facturacion/facturas/' + FACT_OF + '/reenviar', t, {}); VE[rol].reenvia = ![401, 403, 404].includes(st); } // es de pruebas: quien puede recibe 409; quien no, 403
    { const [st] = await pedir('POST', '/facturacion/facturas/' + FACT_BORRADOR + '/descartar', t, {}); VE[rol].descarta = ![401, 403, 404].includes(st); } // sin llaves de factura.com no llega a borrarse: Dirección recibe 400
    VE[rol].editaFolioReal = ok(await pedir('PUT', '/leads/' + OP.id + '/facturacion', t, { factura_folio: 'X-' + rol + '-9', factura_total: '1.00' }));
    VE[rol].claveServicio = ok(await pedir('PUT', '/facturacion/servicios/' + servicioFact.id, t, { clave_prod_serv: '76121600', clave_unidad: 'E48' }));
    const nuevaPub = exigir(await pedir('POST', '/marketing/publicaciones', T.Mara, { titulo: 'Por aprobar ' + rol, redes: ['tiktok'], formato: 'video', fecha: dia(5), copy: 'Copy', sucursal: qro.id }), 'publicación por aprobar');
    const enRevision = exigir(await pedir('POST', '/marketing/publicaciones/' + nuevaPub.id + '/estado', T.Mara, { accion: 'enviar', version: nuevaPub.version }), 'enviar a revisión');
    VE[rol].apruebaPub = ok(await pedir('POST', '/marketing/publicaciones/' + nuevaPub.id + '/estado', t, { accion: 'aprobar', version: enRevision.version }));
    // Resultados de una publicación ya publicada (2026-10-27): Mara la publica y cada rol intenta capturarlos.
    { let p = exigir(await pedir('POST', '/marketing/publicaciones', T.Mara, { titulo: 'Publicada ' + rol, redes: ['instagram'], formato: 'post', fecha: dia(-1), copy: 'Copy', sucursal: qro.id }), 'publicación para resultados');
      for (const [tk, accion] of [[T.Mara, 'enviar'], [A, 'aprobar'], [T.Mara, 'publicar']]) p = exigir(await pedir('POST', '/marketing/publicaciones/' + p.id + '/estado', tk, { accion, version: p.version }), accion);
      VE[rol].capturaRes = ok(await pedir('PUT', '/marketing/publicaciones/' + p.id + '/metricas', t, { red: 'instagram', valores: { alcance: 100 } })); }
  }

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
    return area === 'cxc' && nv === 0 && set.has('cobros.registrar') && set.has('ventas.ver') ? 'Solo lo que él registra' : PERM.niveles[nv] + (r.ediciones[area] ? ' ✎' : '');
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
    ['2026-10-26', 'Técnico: ve el importe de sus órdenes, pero no las modifica; sin Generador ni Resultados (antes, 2026-10-21, no veía importes).', { tecnico: { 'ambar$': 1, editaO1: 0, 'rep:generador': 0, 'rep:analisis': 0, 'rep:panorama': 0 } }],
    ['2026-10-26', 'Contactos, cotizaciones y órdenes: los edita quien los capturó o los tiene a su nombre, el Gerente y Dirección. Quien solo los ve (Atención con lo de otra persona, Técnico, Compras) no los cambia.', {
      admin: { editaO1: 1, editaO4: 1, editaAmbar: 1 }, gerente: { editaO1: 1, editaO4: 1, editaAmbar: 1 }, ventas: { editaO1: 1, editaO4: 0, editaAmbar: 1 },
      atencion: { editaO1: 0, editaO4: 0, editaAmbar: 0 }, tecnico: { editaO1: 0, editaO4: 0, editaAmbar: 0 }, costos: { editaO1: 0, editaO4: 0, editaAmbar: 0 } }],
    ['2026-10-26', 'Marcar si se realizó: quien hizo la orden, el Gerente y Dirección (el técnico todavía no).', { admin: { realizado: 1 }, gerente: { realizado: 1 }, ventas: { realizado: 1 }, atencion: { realizado: 0 }, tecnico: { realizado: 0 }, costos: { realizado: 0 } }],
    ['2026-10-26', 'Borrar (cotizaciones, órdenes, usuarios, roles, catálogos): solo Dirección.', { admin: { borra: 1 }, gerente: { borra: 0 }, ventas: { borra: 0 }, atencion: { borra: 0 }, tecnico: { borra: 0 }, costos: { borra: 0 } }],
    ['2026-10-26', 'Encuesta: el aviso de cliente insatisfecho le llega a Dirección, al gerente y al responsable de la orden; no a quien solo ve la orden.', { admin: { avisoEnc: 1 }, gerente: { avisoEnc: 1 }, ventas: { avisoEnc: 1 }, atencion: { avisoEnc: 0 }, tecnico: { avisoEnc: 0 }, costos: { avisoEnc: 0 } }],
    ['2026-10-26', 'Técnico: ve su solicitud de compra, no las de otros, y no ve montos de compras.', { tecnico: { jade: 1, perla: 0, 'perm:compras.importes': 0 } }],
    ['2026-10-21', 'Prospección: cada quien lo suyo (quien ve toda su sucursal en ventas, todos los de su sucursal); el técnico no prospecta.', { ventas: { granate: 1, cuarzo: 0 }, atencion: { granate: 1, cuarzo: 1 }, tecnico: { granate: 0, cuarzo: 0 } }],
    ['2026-10-19', 'Personal: quien ve órdenes ve nombre y puesto del personal activo, para asignarlo a una orden; la ficha y los datos sensibles, solo Gerente y Dirección.', { gerente: { obsidiana: 1, fichaEmp: 1, clabe: 1 }, ventas: { obsidiana: 1, fichaEmp: 0, clabe: 0 }, atencion: { obsidiana: 1, fichaEmp: 0, clabe: 0 }, tecnico: { obsidiana: 1, fichaEmp: 0, clabe: 0 }, costos: { obsidiana: 0, fichaEmp: 0, clabe: 0 } }],
    ['2026-10-26', 'Marketing: aprueban las publicaciones Dirección y el Gerente de marketing; nadie más (ni Marketing, aunque la haya escrito).', { admin: { apruebaPub: 1 }, marketing_gerente: { apruebaPub: 1 }, marketing: { apruebaPub: 0 }, gerente: { apruebaPub: 0 }, ventas: { apruebaPub: 0 }, atencion: { apruebaPub: 0 }, tecnico: { apruebaPub: 0 }, costos: { apruebaPub: 0 } }],
    ['2026-10-26', 'Marketing y Gerente de marketing: ven, editan y comentan las publicaciones de toda la empresa (de cualquier sucursal y las generales), y nada más del sistema: ni ventas, cobranza, gastos, compras, prospección ni personal.', Object.fromEntries(['marketing', 'marketing_gerente'].map(r => [r, {
      rubi: 1, zafiro: 1, topacio: 1, editaPub: 1, comentaPub: 1, ambar: 0, berilo: 0, coral: 0, cobroAlicia: 0, cobroTomas: 0, saldo: 0, gastoTomas: 0, gastoCarlos: 0, clabeProv: 0, jade: 0, perla: 0, granate: 0, cuarzo: 0, obsidiana: 0, clabe: 0, editaO1: 0, borra: 0 }]))],
    ['2026-10-26', 'Los demás roles (Gerente, Ventas, Atención, Técnico, Compras) no ven Marketing; Dirección lo puede prender en Roles y permisos.', Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { rubi: 0, zafiro: 0, topacio: 0, editaPub: 0, comentaPub: 0 }]))],
    ['2026-10-26', 'Dirección ve y aprueba todo Marketing.', { admin: { rubi: 1, zafiro: 1, topacio: 1, editaPub: 1, comentaPub: 1 } }],
    ['2026-10-27', 'Dinero de Marketing (presupuesto, gastos, costo por contacto y retorno): lo ven Dirección y el Gerente de marketing; el rol Marketing y los demás roles no.', {
      admin: { presupMk: 1, gastoMk: 1 }, marketing_gerente: { presupMk: 1, gastoMk: 1 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { presupMk: 0, gastoMk: 0 }])) }],
    ['2026-10-27', 'Presupuesto de Marketing: lo propone el Gerente de marketing y lo aprueba solo Dirección.', {
      admin: { apruebaPresup: 1 }, marketing_gerente: { proponePresup: 1, apruebaPresup: 0 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { proponePresup: 0, apruebaPresup: 0 }])) }],
    ['2026-10-27', 'Gastos de Marketing: los registran Dirección y el Gerente de marketing, y son control interno del departamento: no aparecen en Cuentas por pagar.', {
      admin: { registraGasto: 1, mkEnCxp: 0 }, marketing_gerente: { registraGasto: 1 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { registraGasto: 0, mkEnCxp: 0 }])) }],
    ['2026-10-27', 'Resultados de cada publicación (alcance, me gusta, mensajes…): los capturan Marketing, el Gerente de marketing y Dirección, cuando ya está publicada; los demás roles no.', {
      admin: { capturaRes: 1 }, marketing: { capturaRes: 1 }, marketing_gerente: { capturaRes: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { capturaRes: 0 }])) }],
    ['2026-10-27', 'Facturación (conexión con factura.com, código postal de expedición y series de cada sucursal): la cambia solo Dirección. El código postal de expedición lo ve además quien timbra (Gerente y quien factura), porque sale en cada factura; los demás roles no lo ven, tampoco por la lista de sucursales. (Ajustada el 2026-10-27 al llegar el timbrado: «ven, no cambian».)', {
      admin: { cpFact: 1, configuraFact: 1 }, gerente: { cpFact: 1, configuraFact: 0 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cpFact: 0, configuraFact: 0 }])) }],
    ['2026-10-27', 'Claves del SAT de los servicios (clave de producto y unidad para facturar): las cambia solo Dirección. Las ve además quien timbra (Gerente y quien factura), porque salen en cada renglón de la factura; los demás roles ven los servicios sin esos datos. (Ajustada el 2026-10-27 al llegar el timbrado: «ven, no cambian».)', {
      admin: { claveFact: 1, claveServicio: 1 }, gerente: { claveFact: 1, claveServicio: 0 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { claveFact: 0, claveServicio: 0 }])) }],
    ['2026-10-27', 'Datos fiscales de los clientes (RFC, razón social, código postal, régimen, uso de CFDI y correo para facturar): los ven y los capturan Dirección, el Gerente y quien tenga el permiso «Datos fiscales de clientes» (quien factura); los demás roles no los ven ni los cambian.', {
      admin: { fiscalCli: 1, capturaFiscal: 1 }, gerente: { fiscalCli: 1, capturaFiscal: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { fiscalCli: 0, capturaFiscal: 0 }])) }],
    ['2026-10-27', 'Timbrar facturas (CFDI) y ver las facturas de una orden (folio fiscal, receptor, XML y PDF): Dirección, el Gerente y quien tenga el permiso «Timbrar facturas» (quien factura); los demás roles no.', {
      admin: { timbra: 1, cfdiFact: 1 }, gerente: { timbra: 1, cfdiFact: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { timbra: 0, cfdiFact: 0 }])) }],
    ['2026-10-28', 'Ver la lista de facturas (pantalla «Facturas» y el aviso de Inicio), bajar su XML y PDF y reenviarlas por correo: Dirección, el Gerente y quien tenga «Timbrar facturas»; los demás roles no.', {
      admin: { cfdiFact: 1, reenvia: 1 }, gerente: { cfdiFact: 1, reenvia: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cfdiFact: 0, reenvia: 0 }])) }],
    ['2026-10-28', 'Descartar un borrador de factura que quedó atorado: solo Dirección (ni el Gerente ni quien factura).', {
      admin: { descarta: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { descarta: 0 }])) }],
    ['2026-10-28', 'Una orden con factura real ya timbrada: su folio, fecha, total y método de pago salen de la factura y nadie los cambia a mano (ni Dirección); los días de crédito sí.', {
      ...Object.fromEntries(['admin', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { editaFolioReal: 0 }])) }],
    ['2026-10-27', 'Banco de ideas: las proponen, votan y comentan Marketing, Gerente de marketing y Dirección; las aprueban o descartan solo Dirección y el Gerente de marketing. Los demás roles no ven las ideas.', {
      admin: { agata: 1, votaIdea: 1, decideIdea: 1 }, marketing_gerente: { agata: 1, votaIdea: 1, decideIdea: 1 }, marketing: { agata: 1, votaIdea: 1, decideIdea: 0 },
      ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { agata: 0, votaIdea: 0, decideIdea: 0 }])) }],
    ['2026-10-27', 'Biblioteca de marketing (logos, fotos, plantillas): la ven y usan Marketing, Gerente de marketing y Dirección; los demás roles no.', {
      ...Object.fromEntries(['admin', 'marketing', 'marketing_gerente'].map(r => [r, { jaspe: 1, subeBiblio: 1 }])), ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { jaspe: 0, subeBiblio: 0 }])) }],
    ['2026-10-26', 'Proyectos de marketing (tareas, Gantt y avances): los ven y editan Marketing, Gerente de marketing y Dirección; los demás roles no.', {
      ...Object.fromEntries(['admin', 'marketing', 'marketing_gerente'].map(r => [r, { onix: 1, editaProy: 1 }])), ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { onix: 0, editaProy: 0 }])) }],
  ];
  const NOMBRE = Object.fromEntries(DATOS.flatMap(([, f]) => f.map(([k, t]) => [k, t])).concat(REPORTES.map(([k, t]) => ['rep:' + k, t]), ACCIONES, PERM.catalogo.map(p => ['perm:' + p.clave, 'puede: ' + p.nombre])));
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
    tabla('Acción (se intenta de verdad)', ACCIONES.map(([k, t]) => [t, ROLES.map(([rol]) => si(VE[rol][k]))])),
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
