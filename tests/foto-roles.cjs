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
const { cfdi } = require('./cfdi-inventado.cjs');
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
// Foto de prueba para la credencial (JPEG mínimo válido por su firma).
const FOTO_JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), require('crypto').randomBytes(2000), Buffer.from([0xff, 0xd9])]);
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
  const COBRO_ALICIA = exigir(await pedir('POST', '/leads/' + O1.id + '/cobros', T.Alicia, { monto: 1013.29, metodo: 'transferencia' }), 'cobro de Alicia');
  exigir(await pedir('POST', '/leads/' + O1.id + '/cobros', T.Tomas, { monto: 503.61, metodo: 'efectivo' }), 'cobro de Tomás');
  const saldoO1 = (await pedir('GET', '/leads/' + O1.id + '/cobros', A))[1].cuenta.saldo;
  // Gastos: Tomás, Valeria, Carlos y Alicia en cuentas por pagar; Valeria marca realizada su orden.
  const clabeProv = '012180555888222117'; // CLABE válida (dígito verificador), marcada para buscarla
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', T.Carlos, { nombre: 'Pipas del Centro', tipo_comprobante: 'factura', clabe: clabeProv, banco: 'BBVA' }), 'crear proveedor');
  exigir(await pedir('POST', '/finanzas/cxp', T.Tomas, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diesel de campo', total: 813.37, fecha_documento: HOY, lead_id: O1.id, dias_credito: 0 }), 'gasto de Tomás');
  exigir(await pedir('POST', '/leads/' + O1.id + '/ejecucion', T.Valeria, { estado: 'realizado', fecha: dia(-1) }), 'realizado');
  exigir(await pedir('POST', '/finanzas/cxp', T.Valeria, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Casetas de visita', total: 311.13, fecha_documento: HOY, lead_id: O1.id, dias_credito: 0 }), 'gasto de Valeria');
  exigir(await pedir('POST', '/finanzas/cxp', T.Carlos, { proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Renta de pipa', total: 2577.19, fecha_documento: HOY, lead_id: O4.id, dias_credito: 15 }), 'gasto de Carlos');
  // Gasto fijo sin orden de servicio: con él se prueba quién puede «Repetir» (un costo de una orden ya no se repite, FLW-H07).
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Renta de bodega fija', total: 5000, fecha_documento: HOY, dias_credito: 15 }), 'gasto fijo');
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
  // Google Ads (2026-11-04): Dirección sube el reporte «Detalles de las llamadas» con una campaña marcada (número inventado, que no está en el CRM).
  const fechaAds = new Date(dia(-2) + 'T12:00:00Z'), MES_ADS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][fechaAds.getUTCMonth()];
  const CSV_ADS = 'Detalles de las llamadas\nRango\nHora de inicio,Duración (segundos),Código de país de la persona que llama,Prefijo de la persona que llama,Número de teléfono de la persona que llama,Grabación,Estado,Fuente de la llamada,Tipo de llamada,Campaña\n'
    + `"${fechaAds.getUTCDate()} ${MES_ADS} ${fechaAds.getUTCFullYear()}, 11:00:00",95,52,55, +52 55 7777 0909,No disponible,Recibida,Anuncio,Clics de llamada de móviles,Campaña Peridoto\n`;
  exigir(await pedir('POST', '/marketing/google-ads/cargar', A, { csv: CSV_ADS }), 'cargar el reporte de Google Ads');
  const ideaAgata = exigir(await pedir('POST', '/marketing/ideas', T.Mara, { titulo: 'Idea Ágata', descripcion: 'Reto en TikTok Ágata' }), 'idea Ágata');
  const PNG1 = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex');
  { const x = await fetch(URL + '/marketing/biblioteca', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + T.Mara, 'X-Nombre': encodeURIComponent('logo-Jaspe.png'), 'X-Carpeta': encodeURIComponent('Logos') }, body: PNG1 }); if (x.status !== 201) throw new Error('No se pudo subir a la biblioteca: ' + x.status); }
  await publicacion(A, 'Campaña Zafiro', 'empresa'); await publicacion(A, 'Evento Topacio', cdmx.id);
  // Personal: un empleado con datos sensibles.
  const CLABE = '072180001234567898'.slice(0, 17); const conDigito = p17 => { const w = [3, 7, 1]; let s = 0; for (let i = 0; i < 17; i++) s += (Number(p17[i]) * w[i % 3]) % 10; return p17 + ((10 - (s % 10)) % 10); };
  const clabe = conDigito(CLABE), salario = 23456.78;
  // Etapa 6 (2026-11-12): quien no tiene su ficha ligada no captura sueldos; Dirección liga la de Gema antes.
  exigir(await pedir('POST', '/personal', A, { nombre: 'Gema Gerente', puesto: 'Administración', sucursal_id: qro.id, usuario_id: ID.Gema }), 'ficha de Gema');
  const EMP = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Ernesto Obsidiana', puesto: 'Operador', telefono: '442 987 6543', fecha_ingreso: dia(-200), clabe, salario, salario_periodo: 'mensual' }), 'alta de personal');
  // Reloj checador (2026-11-03): una checada de ayer agregada a mano, con su motivo marcado.
  exigir(await pedir('POST', '/asistencia/checadas', A, { personal_id: EMP.id, tipo: 'entrada', fecha: dia(-1), hora: '08:31', motivo: 'Checada Turmalina' }), 'checada de Obsidiana');
  // F2 (2026-11-03): una checada en el kiosco con su foto (JPEG de prueba con una marca).
  let CHECADA_FOTO;
  { const pin = exigir(await pedir('POST', '/asistencia/personal/' + EMP.id + '/pin', A), 'PIN de Obsidiana'), kio = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Kiosco foto', sucursal_id: qro.id }), 'kiosco');
    const k = async (r, b) => { const x = await fetch(URL + '/publico/kiosco/' + r, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kiosco': kio.token }, body: JSON.stringify(b) }); return x.json(); };
    const i = await k('identificar', { codigo: pin.codigo, pin: pin.pin }), c = await k('cambiar-pin', { ticket: i.ticket, nuevo: '5072' });
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('FOTO-ZIRCON'), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]).toString('base64');
    CHECADA_FOTO = (await k('checar', { ticket: c.ticket, tipo: 'entrada', foto: jpg })).id; if (!CHECADA_FOTO) throw new Error('No se pudo checar con foto');
    // F5: su celular ligado y una checada con ubicación (marcada).
    const enlace = exigir(await pedir('POST', '/asistencia/personal/' + EMP.id + '/celular', A), 'enlace del celular').ruta.split('#e=')[1];
    const cel = async (r, b, tk) => { const x = await fetch(URL + '/publico/celular/' + r, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { 'X-Celular': tk } : {}) }, body: JSON.stringify(b) }); return x.json(); };
    const tk = (await cel('ligar', { enlace })).token;
    if (!(await cel('checar', { pin: '5072', tipo: 'salida', foto: jpg, lat: 20.612345, lon: -100.398765, precision: 12 }, tk)).id) throw new Error('No se pudo checar desde el celular'); }

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
      ['gAds', 'Reporte de llamadas de Google Ads (por campaña, lada y horario, y las llamadas sin registrar)', ['Campaña Peridoto']],
    ]],
    ['Personal', [
      ['obsidiana', 'Un empleado activo: nombre y puesto (para asignarlo a una orden)', ['Obsidiana']],
      ['fichaEmp', 'Su ficha: teléfono, licencia, ingreso', ['442 987 6543', '4429876543']],
      ['clabe', 'Sus datos sensibles: CLABE y salario', [clabe, ...formas(salario)]],
      ['turmalina', 'Sus checadas del reloj checador (entradas, salidas) y su motivo', ['Checada Turmalina']],
      ['fotoChecada', 'La foto que se tomó al checar en el kiosco', ['FOTO-ZIRCON']],
      ['ubicacion', 'La ubicación GPS de una checada desde el celular', ['20.612345']],
    ]],
  ];

  // ----- Rastreo: todas las rutas del sistema como cada rol -----
  const rutasGet = [];
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'server')).filter(f => f.endsWith('.js')))
    for (const m of fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8').matchAll(/app\.get\(\s*'\/api(\/[^']+)'/g)) rutasGet.push(m[1]);
  const ids = new Set([O1, Q2, O3, O4].map(x => x.id).concat([cAmbar, cBerilo, cDiamante, cCoral, clienteFiscal, OF, OB, OP].map(c => c.id), [CHECADA_FOTO]));
  for (const r of ['/finanzas/cxp?vista=todas', '/compras/solicitudes?estado=', '/compras/ordenes', '/personal', '/prospeccion', '/marketing/publicaciones?desde=' + dia(-40) + '&hasta=' + dia(50), '/marketing/proyectos', '/marketing/ideas']) {
    const [, j] = await pedir('GET', r, A); for (const x of (Array.isArray(j) ? j : j.lista || j.items || [])) if (x && x.id) ids.add(x.id);
  }
  const EXTRA = ['/leads', '/leads?estatus=ganado', '/clientes', '/clientes?incluir_prospectos=1', '/clientes/catalogo', '/finanzas/cartera', '/finanzas/cartera?vista=clientes', '/finanzas/resumen',
    '/finanzas/periodo?' + RANGO, '/finanzas/cxp?vista=todas', '/finanzas/por-confirmar', '/tablero?' + RANGO, '/generador?' + RANGO, '/calendario?desde=' + dia(-40) + '&hasta=' + dia(50),
    '/calendario/atrasados', '/compras/solicitudes?estado=', '/compras/ordenes', '/kpis', '/pendientes', '/analisis/comercial?' + RANGO, '/contactos/sin-cotizacion', '/personal', '/personal/avisos', '/asistencia/checadas?fecha=' + dia(-1),
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
    ['creaSerie', 'Crear la serie de facturas de una sucursal (con el nombre que se escriba)'],
    ['claveServicio', 'Cambiar la clave del SAT de un servicio'],
    ['capturaFiscal', 'Capturar los datos fiscales de un cliente'],
    ['timbra', 'Timbrar la factura (CFDI) de una orden'],
    ['reenvia', 'Reenviar una factura por correo'],
    ['descarta', 'Descartar un borrador de factura atorado'],
    ['cancela', 'Cancelar una factura timbrada (CFDI)'],
    ['complementa', 'Timbrar el complemento de pago de un cobro (factura PPD)'],
    ['importaClientesFact', 'Cargar de golpe los datos fiscales de los clientes desde el CSV de factura.com (revisar y aplicar)'],
    ['exportaFact', 'Descargar en Excel la lista de facturas y complementos (folio, cliente, RFC, importes, estatus)'],
    ['revisaProd', 'Ver la revisión de «¿está lista la facturación para producción?» (llaves, series, claves del SAT, respaldo)'],
    ['editaFolioReal', 'Cambiar a mano el folio o el total de una orden que ya tiene factura real timbrada'],
    ['capturaRes', 'Capturar los resultados (alcance, me gusta…) de una publicación ya publicada'],
    ['daPin', 'Dar de alta a una persona en el reloj checador (código y PIN temporal) o desbloquear su PIN'],
    ['registraKiosco', 'Registrar una tableta o computadora como kiosco del reloj checador'],
    ['eliminaKiosco', 'Eliminar un kiosco de la lista de kioscos del reloj checador'],
    ['corrigeChecada', 'Agregar a mano una checada olvidada (con motivo)'],
    ['cambiaHorario', 'Cambiar un horario (entrada, salida, tolerancia o comida)'],
    ['marcaFestivo', 'Marcar o quitar días festivos (valen para todas las sucursales)'],
    ['autorizaExtra', 'Autorizar el tiempo extra de una persona'],
    ['corrigeSuyo', 'Corregir su PROPIA asistencia (agregarse una checada o autorizarse su tiempo extra)'],
    ['cambiaSuSueldo', 'Cambiar su PROPIO sueldo o datos de pago, o desligarse de su ficha'],
    ['pinSuyo', 'Darse a sí mismo el PIN del checador'],
    ['reiniciaPin', 'Darle un PIN nuevo a quien ya tiene uno (reiniciar su PIN)'],
    ['mandaEnlace', 'Mandar a una persona el enlace para checar desde su celular'],
    ['precioExtra', 'Ponerle precio a la hora de cada puesto (para pagar el tiempo extra)'],
    ['dineroExtra', 'Ver cuánto dinero sale por tiempo extra (en la semana y en el Excel de nómina)'],
    ['cambiaCredito', 'Cambiar los días de crédito y los datos de factura de una orden'],
    ['buscaProveedor', 'Encontrar proveedores en el buscador general (Ctrl K)'],
    ['veContabilidad', 'Ver la contabilidad del mes y descargar su Excel y los XML (para el contador)'],
    ['repiteGasto', 'Repetir un gasto fijo al mes siguiente (renta, internet…)'],
    ['pagaAlRegistrar', 'Registrar un gasto «ya pagado» como pago a proveedor (sin esto queda «por reembolsar» a quien lo pagó)'],
    ['cargaClientes', 'Cargar clientes con la plantilla de Excel (revisar y guardar) y ver las cargas anteriores'],
    ['eliminaCliente', 'Eliminar un cliente que no tiene cotizaciones, órdenes ni cobros'],
    ['eliminaUsuario', 'Eliminar un usuario (se borra si nunca se usó; si ya tiene registros, se archiva)'],
    ['veLogs', 'Ver los logs del sistema (entradas y salidas, contraseñas equivocadas, bloqueos, errores del servidor y quién está conectado)'],
    ['eliminaSucursal', 'Eliminar una sucursal (se borra si nunca se usó; si ya tiene registros, se archiva)'],
    ['daCelular', 'Mandar a una persona el enlace para checar desde su celular, o quitarle el celular'],
    ['veIntentos', 'Ver los intentos fallidos en el kiosco (código o PIN malo, PIN bloqueado) con su foto y la red de cada checada'],
    ['ubicaSucursal', 'Capturar la ubicación de una sucursal (para revisar dónde checan con el celular)'],
    ['fotoCredencial', 'Subir o tomar la foto de una persona para su credencial'],
    ['emiteCredencial', 'Imprimir credenciales (con su QR de verificación para clientes y su vigencia)'],
    ['activaWhatsapp', 'Activar o quitar a una persona el checar por WhatsApp (foráneos)'],
    ['registraRostro', 'Dar el código para registrar la cara de una persona en el kiosco, o borrar su registro (biométrico)'],
    ['veAvisoCara', 'Ver en Inicio (ficha «Personal») el aviso de que la cara no coincidió en el kiosco'],
    ['revisaCara', 'Marcar como revisado el aviso de que la cara no coincidió'],
    ['reglasExtra', 'Cambiar las reglas del tiempo extra (semana de nómina, desde cuándo cuenta, redondeo…)'],
    ['veRH', 'Ver la pestaña RH (resumen del personal: sin horario, sin checador, sin aviso firmado…)'],
    ['importaPersonal', 'Cargar trabajadores en lote desde la plantilla de Excel (revisar y guardar)'],
    ['veAsistencia', 'Ver la asistencia del día y de la semana (retardos, faltas, tiempo extra)'],
    ['cargaAds', 'Cargar el reporte de llamadas de Google Ads (CSV) y verlo cruzado con los contactos'],
    ['subeXmlGasto', 'Subir el XML de la factura a un gasto que registró Tomás (el sistema llena el IVA)'],
    ['corrigeIvaGasto', 'Corregir a mano el IVA de ese gasto (botón «IVA»)'],
    ['editaListaServ', 'Agregar o quitar opciones en la lista de un servicio (p. ej. 4M3, 8M3 para [VOLUMEN])'],
    ['preparaNomina', 'Ver y preparar la nómina semanal (los dos sueldos de cada persona, descuentos y neto del IMSS)'],
    ['pagaNomina', 'Pagar la nómina y bajar la lista para el banco (con la CLABE de cada persona)'],
    ['reglaPuntualidad', 'Poner o cambiar las reglas del bono de puntualidad (monto por puesto, retardos y faltas permitidos)'],
    ['concilia', 'Conciliación bancaria: dar de alta una cuenta de banco, subir su estado de cuenta y emparejar sus movimientos con el CRM'],
    ['editaMetas', 'Poner las metas del mes (venta, cobranza, margen, satisfacción…) contra las que se mide el semáforo del Panorama'],
    ['enviaReporte', 'Mandar por correo a Dirección el reporte ejecutivo del mes'],
    ['veIndicadores', 'Ver los indicadores del Análisis comercial (satisfacción, cobranza a tiempo, servicios en fecha y recompras de lo que ve)'],
    ['asignaTarea', 'Asignar una tarea (con fechas, para el Gantt) a alguien del equipo de su sucursal'],
    ['veTareaAjena', 'Ver una tarea asignada a otra persona (la que Dirección le asignó a Tito)'],
    ['avanzaTareaPropia', 'Actualizar el avance de una tarea que le asignaron a él'],
    ['entregaAnticipo', 'Entregar un anticipo por comprobar a una persona del personal (y cerrarlo o cancelarlo)'],
    ['veAnticipoAjeno', 'Ver los anticipos por comprobar de otras personas (el de Ernesto Obsidiana)'],
    ['cambiaSaldo', 'Contabilidad › Flujo de banco: guardar el saldo inicial del banco de un mes (queda para todos, con quién y cuándo)'],
    ['cierraMes', 'Contabilidad: cerrar un mes ya terminado (después solo Dirección cambia cobros, pagos y anticipos de ese mes)'],
    ['editaFlujo', 'Contabilidad › Flujo de banco: «Editar tabla» y guardar correcciones en las celdas (marcas, textos, monto CFDI, cuenta de banco)'],
    ['veCuentasBanco', 'Elegir la cuenta de banco al pagar, cobrar o confirmar un cobro (con ella el movimiento recibe su folio)'],
    ['poneClaveFolio', 'Poner la clave de folio de una cuenta de banco (STD, BNT, PAG, CAJ…)'],
    ['asignaFolios', 'Contabilidad › Flujo de banco: «Asignar folios pendientes» a lo que ya tiene cuenta con clave'],
    ['agregaMovFlujo', 'Contabilidad › Flujo de banco: agregar un movimiento que no pasó por el sistema (traspaso, préstamo, comisión…) y desglosar un pago en varios renglones'],
  ];
  // Proyectos y tareas (2026-11-11): Dirección le asigna una tarea a Tito (técnico que no es observador de ningún rol).
  const TAREA_TOMAS = exigir(await pedir('POST', '/tareas', A, { titulo: 'Tarea Coral de Tito', asignado_a: ID.Tito, inicio: dia(0), fin: dia(7) }), 'tarea de Tito');
  const OBS_ID = { admin: (() => { const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(DB), r = d.prepare("SELECT id FROM usuarios WHERE nombre = 'admin'").get(); d.close(); return r.id; })(), gerente: ID.Gema, ventas: ID.Valeria, atencion: ID.Alicia, tecnico: ID.Tomas, costos: ID.Carlos, marketing: ID.Mara, marketing_gerente: ID.Gil };
  // Nómina semanal (F3, 2026-11-11): Dirección prepara y cierra la de la semana pasada de Querétaro.
  const NOM = exigir(await pedir('POST', '/nomina/preparar', A, { desde: dia(-7), sucursal_id: qro.id }), 'preparar la nómina');
  exigir(await pedir('POST', '/nomina/' + NOM.id + '/cerrar', A, { forzar: true }), 'cerrar la nómina');
  // Anticipo por comprobar de Ernesto Obsidiana (no tiene usuario): lo entrega Dirección (módulo contable F2, 2026-11-11).
  const ANT_OBS = exigir(await pedir('POST', '/anticipos', A, { personal_id: EMP.id, monto: 777.31, metodo: 'efectivo', motivo: 'Anticipo Turquesa' }), 'anticipo de Obsidiana');
  const ok = r => r[0] === 200 || r[0] === 201;
  // Un renglón del flujo de banco para corregir (Editar Contabilidad parte 3, 2026-11-12): del mes en curso o, a inicio de mes, del anterior.
  const FLUJO_ED = await (async () => { for (const mes of [HOY.slice(0, 7), dia(-31).slice(0, 7)]) { const f = (await pedir('GET', '/contabilidad/flujo?mes=' + mes, A))[1].flujo?.[0]; if (f) return { mes, ref: f.ref }; } throw new Error('No hay renglones en el flujo de banco para la foto'); })();
  // Folios de banco (parte 5, 2026-11-12): una cuenta SIN clave para probar quién la pone (con clave inválida, así no
  // cambia nada: las demás pruebas pagan sin elegir cuenta).
  const CUENTA_CLAVE = exigir(await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Cuenta foto clave', banco: 'Santander', sucursal_id: qro.id }), 'cuenta para la clave').id;
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
    { const [st] = await pedir('POST', '/facturacion/sucursales/' + qro.id + '/crear-serie', t, { tipo: 'factura', letra: 'QRO' }); VE[rol].creaSerie = ![401, 403, 404].includes(st); } // sin llaves no llega a crearse: Dirección recibe 400
    VE[rol].capturaFiscal = ok(await pedir('POST', '/facturacion/clientes/' + clienteFiscal.id, t, { rfc: 'ABC010203AB' + String.fromCharCode(65 + ROLES.findIndex(r => r[0] === rol)), razon_social: 'Prueba de ' + rol }));
    { const [st] = await pedir('POST', '/facturacion/ordenes/' + OF.id + '/timbrar', t, { forma_pago: '03' }); VE[rol].timbra = ![401, 403, 404].includes(st); } // ya está timbrada: quien puede recibe 409, quien no, 403/404
    { const [st] = await pedir('POST', '/facturacion/facturas/' + FACT_OF + '/reenviar', t, {}); VE[rol].reenvia = ![401, 403, 404].includes(st); } // es de pruebas: quien puede recibe 409; quien no, 403
    { const [st] = await pedir('POST', '/facturacion/facturas/' + FACT_BORRADOR + '/descartar', t, {}); VE[rol].descarta = ![401, 403, 404].includes(st); } // sin llaves de factura.com no llega a borrarse: Dirección recibe 400
    { const [st] = await pedir('POST', '/facturacion/facturas/' + FACT_OF + '/cancelar', t, { motivo: '02' }); VE[rol].cancela = ![401, 403, 404].includes(st); } // sin llaves de factura.com no llega a cancelarse: quien puede recibe 400
    { const [st] = await pedir('POST', '/facturacion/complementos/cobros/' + COBRO_ALICIA.id + '/timbrar', t, { forma_pago: '03' }); VE[rol].complementa = ![401, 403, 404].includes(st); } // la orden no tiene factura PPD: quien puede recibe 400, quien no, 403
    { const [st] = await pedir('POST', '/facturacion/importar-clientes/vista-previa', t, { csv: 'UID,RFC,Razon_Social,Regimen,CP,Email\n' }); VE[rol].importaClientesFact = ![401, 403, 404].includes(st); } // quien puede recibe 200; quien no, 403
    VE[rol].exportaFact = ok(await pedir('GET', '/facturacion/facturas/exportar', t));
    VE[rol].revisaProd = ok(await pedir('GET', '/facturacion/revision-produccion', t));
    VE[rol].cambiaCredito = ok(await pedir('PUT', '/leads/' + O1.id + '/facturacion', t, { dias_credito: 15 }));
    VE[rol].editaFolioReal = ok(await pedir('PUT', '/leads/' + OP.id + '/facturacion', t, { factura_folio: 'X-' + rol + '-9', factura_total: '1.00' }));
    VE[rol].daPin = ok(await pedir('POST', '/asistencia/personal/' + EMP.id + '/desbloquear', t));
    { // Etapa 6 (2026-11-12): un PIN nuevo a quien ya tiene uno (una persona aparte, para no tocar el PIN de Obsidiana).
      const otra = exigir(await pedir('POST', '/personal', A, { nombre: 'Persona PIN ' + rol, puesto: 'Ayudante', sucursal_id: qro.id }), 'persona con PIN');
      exigir(await pedir('POST', '/asistencia/personal/' + otra.id + '/pin', A), 'PIN de la persona');
      VE[rol].reiniciaPin = ok(await pedir('POST', '/asistencia/personal/' + otra.id + '/pin', t));
      VE[rol].mandaEnlace = ok(await pedir('POST', '/asistencia/personal/' + otra.id + '/celular', t)); }
    VE[rol].registraKiosco = ok(await pedir('POST', '/asistencia/dispositivos', t, { nombre: 'Kiosco de ' + rol, sucursal_id: qro.id }));
    { const k = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Kiosco a eliminar ' + rol, sucursal_id: qro.id }), 'kiosco a eliminar'); VE[rol].eliminaKiosco = ok(await pedir('DELETE', '/asistencia/dispositivos/' + k.id, t)); }
    VE[rol].corrigeChecada = ok(await pedir('POST', '/asistencia/checadas', t, { personal_id: EMP.id, tipo: 'salida', fecha: dia(-2), hora: '18:30', motivo: 'Prueba de ' + rol }));
    { // Su propia ficha (ligada a su cuenta): intenta agregarse una checada y autorizarse el tiempo extra.
      const uid = (await pedir('GET', '/permisos/mios', t))[1].usuario_id;
      const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
      let pid = d.prepare('SELECT id FROM personal WHERE usuario_id = ?').get(uid)?.id; d.close();
      if (!pid) pid = exigir(await pedir('POST', '/personal', A, { nombre: 'Ficha propia ' + rol, puesto: 'Otro', sucursal_id: qro.id, usuario_id: uid }), 'ficha propia de ' + rol).id;
      VE[rol].corrigeSuyo = ok(await pedir('POST', '/asistencia/checadas', t, { personal_id: pid, tipo: 'salida', fecha: dia(-3), hora: '18:30', motivo: 'Me corrijo yo' }))
        || ok(await pedir('POST', '/asistencia/extra', t, { personal_id: pid, fecha: dia(-3), minutos: 0 }));
      // Etapa 6 (2026-11-12): subirse el sueldo o desligarse de su ficha; darse su propio PIN.
      VE[rol].cambiaSuSueldo = ok(await pedir('PUT', '/personal/' + pid, t, { salario: 34567.89 })) || ok(await pedir('PUT', '/personal/' + pid, t, { usuario_id: null }));
      VE[rol].pinSuyo = ok(await pedir('POST', '/asistencia/personal/' + pid + '/pin', t)); }
    { const hor = (await pedir('GET', '/asistencia/horarios', A))[1].horarios.find(x => x.sucursal_id === qro.id);
      VE[rol].cambiaHorario = ok(await pedir('PUT', '/asistencia/horarios/' + hor.id, t, { dias: hor.vigente.dias, tolerancia_min: hor.vigente.tolerancia_min, comida_min: hor.vigente.comida_min })); }
    VE[rol].marcaFestivo = ok(await pedir('POST', '/asistencia/festivos', t, { fecha: dia(60), nombre: 'Festivo de prueba ' + rol, activo: false }));
    VE[rol].veIntentos = ok(await pedir('GET', '/asistencia/intentos?fecha=' + HOY, t));
    VE[rol].ubicaSucursal = ok(await pedir('PUT', '/asistencia/sucursales/' + qro.id + '/ubicacion', t, { ubicacion: '20.5888, -100.3899', radio_m: 500 }));
    VE[rol].fotoCredencial = (await fetch(URL + '/personal/' + EMP.id + '/foto', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + t }, body: FOTO_JPG })).ok;
    VE[rol].emiteCredencial = ok(await pedir('POST', '/rh/credenciales', t, { ids: [], vigencia: dia(365) })) || (await pedir('POST', '/rh/credenciales', t, { ids: [], vigencia: dia(365) }))[0] === 400;
    VE[rol].activaWhatsapp = ok(await pedir('PUT', '/asistencia/personal/' + EMP.id + '/whatsapp', t, { activo: false }));
    { const [s] = await pedir('POST', '/asistencia/personal/' + EMP.id + '/biometria/borrar', t); VE[rol].registraRostro = s === 200; }
    { // Cara que no coincidió (2026-11-09): un intento nuevo de Obsidiana en el kiosco; el aviso de Inicio y marcarlo revisado.
      const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
      const kid = d.prepare("SELECT id FROM checador_dispositivos WHERE nombre = 'Kiosco foto'").get().id;
      d.prepare("INSERT INTO checador_intentos (dispositivo_id, personal_id, codigo, motivo, momento_utc, fecha, hora) VALUES (?, ?, '0000', 'La cara no coincide', ?, ?, '08:31:00')").run(kid, EMP.id, new Date().toISOString(), dia(-1)); d.close();
      const [sa, av] = await pedir('GET', '/personal/avisos', t);
      VE[rol].veAvisoCara = sa === 200 && Array.isArray(av) && av.some(a => a.tipo === 'cara' && a.persona_id === EMP.id);
      VE[rol].revisaCara = ok(await pedir('POST', '/asistencia/intentos/revisar', t, { personal_id: EMP.id, fecha: dia(-1) })); }
    { const [sr, rg] = await pedir('GET', '/asistencia/reglas-extra', A), v = sr === 200 ? rg.vigente : null;
      VE[rol].reglasExtra = !!v && ok(await pedir('PUT', '/asistencia/reglas-extra', t, { desde: HOY, inicio_semana: v.inicio_semana, modo: v.modo, despues_min: v.despues_min, antes_cuenta: !!v.antes_cuenta, antes_min: v.antes_min, bloque_min: v.bloque_min, descanso_todo: !!v.descanso_todo })); }
    VE[rol].veRH = ok(await pedir('GET', '/rh/resumen', t));
    VE[rol].importaPersonal = ok(await pedir('POST', '/rh/importar/revisar', t, { filas: [{ nombre: 'Prueba Carga ' + rol, puesto: 'Ayudante' }] }));
    VE[rol].daCelular = ok(await pedir('POST', '/asistencia/personal/' + EMP.id + '/celular/quitar', t));
    VE[rol].autorizaExtra = ok(await pedir('POST', '/asistencia/extra', t, { personal_id: EMP.id, fecha: dia(-1), minutos: 0 }));
    VE[rol].precioExtra = ok(await pedir('PUT', '/asistencia/precios', t, { sucursal_id: qro.id, puesto: 'Operador', valor: 50 + ROLES.findIndex(r => r[0] === rol) }));
    { const [st, sem] = await pedir('GET', '/asistencia/semana', t); VE[rol].dineroExtra = st === 200 && !!sem?.dinero; }
    { // Eliminar (2026-11-04): Dirección crea un usuario y una sucursal desechables y cada rol intenta eliminarlos.
      const k = ROLES.findIndex(r => r[0] === rol), u = exigir(await pedir('POST', '/usuarios', A, { nombre: 'Desechable ' + String.fromCharCode(65 + k), password: 'Desechable-' + k + '-2026xQ', rol: 'ventas', sucursales: [qro.id] }), 'usuario desechable');
      VE[rol].eliminaUsuario = ok(await pedir('POST', '/usuarios/' + u.id + '/eliminar', t, {}));
      const s = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Sucursal Desechable ' + String.fromCharCode(65 + k), clave: 'DS' + String.fromCharCode(65 + k) }), 'sucursal desechable');
      VE[rol].eliminaSucursal = ok(await pedir('POST', '/sucursales/' + s.id + '/eliminar', t, {})); }
    VE[rol].veAsistencia = ok(await pedir('GET', '/asistencia/semana', t));
    VE[rol].veLogs = ok(await pedir('GET', '/registro-sistema', t));
    VE[rol].veContabilidad = ok(await pedir('GET', '/contabilidad/resumen?mes=' + HOY.slice(0, 7), t));
    VE[rol].preparaNomina = ok(await pedir('GET', '/nomina?desde=' + dia(-7) + '&sucursal=' + qro.id, t));
    VE[rol].pagaNomina = ok(await pedir('GET', '/nomina/' + NOM.id + '/lista-banco', t));
    { const k = ROLES.findIndex(r => r[0] === rol), [sc, c] = await pedir('POST', '/conciliacion/cuentas', t, { nombre: 'Cuenta foto ' + String.fromCharCode(65 + k), banco: 'Santander', sucursal_id: qro.id });
      VE[rol].concilia = sc === 201 && ok(await pedir('POST', '/conciliacion/cargar', t, { cuenta_id: c.id, filas: [{ fecha: dia(-2), concepto: 'Depósito foto', cargo: '', abono: '123.45' }] })); }
    // Editar Contabilidad (2026-11-12): cada rol con un mes viejo distinto y sin movimientos (2025-01, 2025-02…), para no estorbar a los demás.
    { const mesViejo = '2025-' + String(ROLES.findIndex(r => r[0] === rol) + 1).padStart(2, '0');
      VE[rol].cambiaSaldo = ok(await pedir('POST', '/contabilidad/saldo-inicial', t, { mes: mesViejo, sucursal: qro.id, cuenta: 0, saldo: '1000.00' }));
      VE[rol].cierraMes = ok(await pedir('POST', '/contabilidad/cierre', t, { mes: mesViejo, sucursal: qro.id })); }
    VE[rol].veCuentasBanco = ok(await pedir('GET', '/cuentas-banco', t));
    { const [sc] = await pedir('POST', `/cuentas-banco/${CUENTA_CLAVE}/clave`, t, { clave: '!!' }); VE[rol].poneClaveFolio = sc === 400; } // 400 = sí puede (la clave inválida no se guarda); 403 = no
    VE[rol].asignaFolios = ok(await pedir('POST', '/contabilidad/flujo/folios-pendientes', t, {}));
    VE[rol].agregaMovFlujo = ok(await pedir('POST', '/contabilidad/flujo/movimientos', t, { sucursal: qro.id, fecha: dia(0), tipo: 'egreso', monto: '1.' + String(ROLES.findIndex(r => r[0] === rol) + 10), categoria: 'comision', concepto: 'Comisión foto ' + rol, cuenta: 0 }));
    VE[rol].editaFlujo = ok(await pedir('POST', '/contabilidad/flujo/correcciones', t, { mes: FLUJO_ED.mes, cambios: [{ ref: FLUJO_ED.ref, campo: 'observaciones_z', valor: 'Foto ' + rol }] }));
    VE[rol].editaMetas = ok(await pedir('PUT', '/tablero/metas', t, { mes: HOY.slice(0, 7), metas: { venta: 100000 } }));
    { const [se] = await pedir('POST', '/tablero/enviar-reporte', t, { mes: HOY.slice(0, 7) }); VE[rol].enviaReporte = se !== 403 && se !== 401; } // sin correo configurado responde 409: aun así sí puede
    { const k = ROLES.findIndex(r => r[0] === rol);
      VE[rol].asignaTarea = ok(await pedir('POST', '/tareas', t, { titulo: 'Tarea foto ' + String.fromCharCode(65 + k), asignado_a: ID.Tito, inicio: dia(0), fin: dia(5) }));
      const [sv, lv] = await pedir('GET', '/tareas?vista=todas', t); VE[rol].veTareaAjena = sv === 200 && (lv.tareas || []).some(x => x.id === TAREA_TOMAS.id);
      const propia = exigir(await pedir('POST', '/tareas', A, { titulo: 'Propia ' + String.fromCharCode(65 + k), asignado_a: OBS_ID[rol], inicio: dia(0), fin: dia(3) }), 'tarea propia');
      VE[rol].avanzaTareaPropia = ok(await pedir('POST', '/tareas/' + propia.id + '/avance', t, { avance: 50 })); }
    VE[rol].veIndicadores = ok(await pedir('GET', '/analisis/indicadores?' + RANGO, t));
    VE[rol].reglaPuntualidad = ok(await pedir('POST', '/nomina/reglas-puntualidad', t, { sucursal_id: qro.id, puesto: 'Operador', monto: 150, max_retardos: 0, max_faltas: 0, desde: dia(1) }));
    { const [st, a] = await pedir('POST', '/anticipos', t, { personal_id: EMP.id, monto: 10, metodo: 'efectivo', motivo: 'Prueba de ' + rol, forzar: true });
      VE[rol].entregaAnticipo = st === 201 && ok(await pedir('POST', '/anticipos/' + a.id + '/cancelar', t, { motivo: 'Prueba de la foto de roles' }));
      const [sl, l] = await pedir('GET', '/anticipos?estado=todos', t); VE[rol].veAnticipoAjeno = sl === 200 && (l.anticipos || []).some(x => x.id === ANT_OBS.id); }
    { const g = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.concepto === 'Renta de bodega fija');
      VE[rol].repiteGasto = !!g && [200, 201].includes((await pedir('POST', '/finanzas/cxp/' + g.id + '/repetir', t, { forzar: true }))[0]); }
    { // Gasto «ya pagado» (2026-11-11, H01): quien mueve dinero lo deja pagado; los demás, por reembolsar a ellos.
      const [st, g] = await pedir('POST', '/finanzas/cxp', t, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasolina de prueba ' + rol, total: 100, fecha_documento: HOY, lead_id: O1.id, dias_credito: 0, ya_pagado: true, metodo: 'efectivo' });
      VE[rol].pagaAlRegistrar = st === 201 && !g.por_reembolsar; }
    { const [st, b] = await pedir('GET', '/buscar?q=' + encodeURIComponent('Pipas del Centro'), t); VE[rol].buscaProveedor = st === 200 && JSON.stringify(b).includes('"proveedor"') && JSON.stringify(b).includes('Pipas del Centro'); }
    VE[rol].cargaClientes = ok(await pedir('POST', '/clientes-carga/revisar', t, { filas: [{ nombre: 'Cliente Carga', telefono: '4429' + String(100000 + ROLES.findIndex(r => r[0] === rol)).slice(-6) }] })) && ok(await pedir('GET', '/clientes-carga', t));
    { // Eliminar cliente (2026-11-09): Dirección da de alta uno sin registros y cada rol intenta eliminarlo.
      const k = ROLES.findIndex(r => r[0] === rol), canal = (await pedir('GET', '/canales', A))[1][0];
      const alta = { nombre: 'Desechable Cliente ' + String.fromCharCode(65 + k), telefono: '4427' + String(200000 + k).slice(-6), canal_origen_id: canal.id };
      let rc = await pedir('POST', '/contactos', A, alta);
      if (rc[1]?.parecidos) rc = await pedir('POST', '/contactos', A, { ...alta, distinto_de: rc[1].parecidos.map(x => x.id) }); // es otro cliente
      const c = exigir(rc, 'cliente desechable');
      VE[rol].eliminaCliente = ok(await pedir('POST', '/clientes/' + (c.id || c.cliente_id) + '/eliminar', t, {})); }
    VE[rol].cargaAds = ok(await pedir('POST', '/marketing/google-ads/cargar', t, { csv: CSV_ADS })); // el mismo archivo: no duplica nada
    // XML de la factura de un gasto (2026-11-04): Tomás registra un gasto nuevo y cada rol intenta subirle su XML y corregirle el IVA.
    { const g = exigir(await pedir('POST', '/finanzas/cxp', T.Tomas, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasolina ' + rol, total: 1160, tipo_comprobante: 'factura', fecha_documento: HOY, lead_id: O1.id, dias_credito: 0 }), 'gasto para el XML');
      const r = await fetch(URL + '/finanzas/cxp/' + g.id + '/xml', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t, 'X-Nombre': 'factura.xml' }, body: cfdi({ total: '1160.00', traslados: [['002', '160.00']] }) });
      VE[rol].subeXmlGasto = r.status === 201;
      VE[rol].corrigeIvaGasto = ok(await pedir('POST', '/finanzas/cxp/' + g.id + '/iva', t, { iva: 160 })); }
    { // Listas de los servicios (2026-11-05): agregar una opción, o quitar una que agrega Dirección en cada vuelta.
      const base = '/servicios/' + SERV.id + '/listas', otra = exigir(await pedir('POST', base, A, { marca: 'VOLUMEN', valor: 'POR QUITAR ' + rol }), 'opción por quitar');
      VE[rol].editaListaServ = ok(await pedir('POST', base, t, { marca: 'VOLUMEN', valor: 'NUEVA ' + rol })) || ok(await pedir('POST', base + '/' + otra.id + '/desactivar', t, {})); }
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
  const veMenu = (rol, m) => m.clases.every(c => { const p = c.match(/^perm-([a-z_]+)-([a-z_]+)$/), n = c.match(/^noperm-([a-z_]+)-([a-z_]+)$/); return p ? rol === 'admin' || permisosDe(rol).has(p[1] + '.' + p[2]) : n ? !(rol === 'admin' || permisosDe(rol).has(n[1] + '.' + n[2])) : c === 'solo-general' ? rol === 'admin' : true; });
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
    ['2026-11-03', 'Reloj checador: ver las checadas del personal, corregirlas con motivo, dar código y PIN y registrar kioscos lo hacen Dirección y el Gerente (de su sucursal); los demás roles no. Nadie ve un PIN ni borra una checada.', {
      admin: { turmalina: 1, daPin: 1, registraKiosco: 1, corrigeChecada: 1 }, gerente: { turmalina: 1, daPin: 1, registraKiosco: 1, corrigeChecada: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { turmalina: 0, daPin: 0, registraKiosco: 0, corrigeChecada: 0 }])) }],
    ['2026-11-03', 'Foto de cada checada del kiosco (para revisar quién checó): la ven Dirección y el Gerente (de su sucursal), y cada vez queda en la bitácora; los demás roles no. Se guarda cifrada.', {
      admin: { fotoChecada: 1 }, gerente: { fotoChecada: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { fotoChecada: 0 }])) }],
    ['2026-11-03', 'Asistencia (horarios, retardos, faltas y tiempo extra): la ven Dirección y el Gerente; cambian horarios y días festivos y autorizan el tiempo extra Dirección y el Gerente (Dirección se los da a RH en Roles y permisos); los demás roles no.', {
      admin: { veAsistencia: 1, cambiaHorario: 1, autorizaExtra: 1 }, gerente: { veAsistencia: 1, cambiaHorario: 1, autorizaExtra: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { veAsistencia: 0, cambiaHorario: 0, autorizaExtra: 0 }])) }],
    ['2026-11-05', 'Días festivos: valen para TODAS las sucursales, así que los marca o quita quien tiene «Horarios y días festivos» y ve todas las sucursales (Dirección, o RH de la empresa). El Gerente de una sola sucursal ya no (auditoría: su festivo convertía en tiempo extra lo trabajado en las demás).', {
      admin: { marcaFestivo: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { marcaFestivo: 0 }])) }],
    ['2026-11-05', 'Intentos fallidos en el kiosco (código o PIN malo, PIN bloqueado): el kiosco les toma foto; los intentos, su foto y la red (IP) desde la que se checó los ven Dirección y el Gerente (de su sucursal), y cada foto que se abre queda en la bitácora. Los demás roles no.', {
      admin: { veIntentos: 1 }, gerente: { veIntentos: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { veIntentos: 0 }])) }],
    ['2026-11-05', 'Ubicación de cada sucursal (para el celular: a más de su radio, 500 m por omisión, la checada queda «por revisar» y se ve en el mapa): la captura solo Dirección.', {
      admin: { ubicaSucursal: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { ubicaSucursal: 0 }])) }],
    ['2026-11-05', 'Credenciales de empleado (foto, nombre, puesto, número de empleado, vigencia, contacto de emergencia, QR del checador y QR de verificación para clientes): tomar la foto e imprimirlas lo hacen quienes editan el personal (Dirección y el Gerente, de su sucursal). Imprimir una nueva anula la anterior. La página de verificación es pública solo con el QR y muestra foto, nombre y puesto si la persona sigue trabajando y la credencial está vigente; si no, solo dice que no es válida.', {
      admin: { fotoCredencial: 1, emiteCredencial: 1 }, gerente: { fotoCredencial: 1, emiteCredencial: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { fotoCredencial: 0, emiteCredencial: 0 }])) }],
    ['2026-11-05', 'Checar por WhatsApp (foráneos, respaldo del celular): solo quien RH active en su ficha y desde el celular de su ficha; sin foto ni ubicación, cada checada queda «por revisar». Activarlo o quitarlo lo hacen quienes editan el personal (Dirección y el Gerente, de su sucursal), nunca para sí mismos (salvo Dirección).', {
      admin: { activaWhatsapp: 1 }, gerente: { activaWhatsapp: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { activaWhatsapp: 0 }])) }],
    ['2026-11-11', 'Módulo contable F1: «Contabilidad del mes» (resumen de ingresos, egresos e IVA, pendientes de comprobar y descarga del Excel y los XML) la ven Dirección, el Gerente (de su sucursal) y el rol que Dirección cree con el permiso «Contabilidad del mes» (p. ej. Contador); los demás roles de fábrica no. Es solo consulta. «Repetir» un gasto fijo al mes siguiente lo hace quien paga a proveedores (Dirección, Gerente, Compras).', {
      admin: { veContabilidad: 1, repiteGasto: 1 }, gerente: { veContabilidad: 1, repiteGasto: 1 }, costos: { veContabilidad: 0, repiteGasto: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { veContabilidad: 0, repiteGasto: 0 }])) }],
    ['2026-11-11', 'Auditoría externa, decisiones de Dirección. H01: un gasto marcado «ya pagado» solo se registra como pago a proveedor si quien lo registra paga a proveedores (Dirección, Gerente, Compras); para los demás (Ventas, Atención, Técnico) queda por pagar como «Reembolso a <su nombre>», vence ese día, y el pago lo hace quien tiene permiso. H11: si RH da de baja a alguien y su usuario sigue activo, Dirección ve un pendiente en Inicio hasta desactivarlo. (H06 y H10 no cambian quién hace qué: cobrado y «pagada» cuentan solo lo confirmado; los choques de agenda solo avisan.)', {}],
    ['2026-11-11', 'Auditoría externa (H02 y H04): los proveedores salen en el buscador general solo a quien trabaja con ellos (cuentas por pagar o compras), y su historial también; la CLABE de los cambios viejos se ve tapada (últimos 4 dígitos) a quien no hace pagos. Las notas y recordatorios de una orden los agregan quien puede editarla, su técnico o quien lleva su cobranza; ver la orden ya no basta. Marcar resuelto un aviso pide lo mismo.', {}],
    ['2026-11-09', 'Clientes con plantilla (Configuración → Ajustes): cargar clientes en lote con la plantilla de Excel, ver las cargas anteriores y deshacerlas, y eliminar un cliente lo hace solo Dirección; ningún otro rol, ni el Gerente. Un cliente solo se elimina si no tiene cotizaciones, órdenes, cobros ni facturas; si ya tiene, se queda. Queda en la bitácora.', {
      admin: { cargaClientes: 1, eliminaCliente: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cargaClientes: 0, eliminaCliente: 0 }])) }],
    ['2026-11-05', 'Crédito al cliente y datos de factura de una orden (días de crédito, folio, fecha y total): los cambian solo Dirección y el Gerente, porque el crédito es una decisión de dinero. Ventas, Atención y los demás roles lo ven pero no lo cambian. (Antes lo cambiaba cualquiera que viera la cobranza.)', {
      admin: { cambiaCredito: 1 }, gerente: { cambiaCredito: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cambiaCredito: 0 }])) }],
    ['2026-11-05', 'Logs del sistema (Configuración → Ajustes): quién entró y salió, desde qué IP y equipo, contraseñas equivocadas, bloqueos por intentos, contraseñas restablecidas, errores del servidor y quién está conectado ahora. Los ve solo Dirección; ningún otro rol, ni el Gerente. Nunca guardan contraseñas.', {
      admin: { veLogs: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { veLogs: 0 }])) }],
    ['2026-11-05', 'Biométrico facial en el kiosco (solo de quien firmó su consentimiento; los expedientes son físicos, así que RH marca en la ficha que lo firmó, con quién y cuándo): marcar el consentimiento, dar el código de un solo uso para registrar su cara en el kiosco o borrar su registro lo hacen quienes editan el personal (Dirección y el Gerente, de su sucursal), nunca para sí mismos (salvo Dirección). Nadie ve ni descarga la plantilla de la cara: solo se compara al checar. Si no coincide, la checada queda por revisar.', {
      admin: { registraRostro: 1 }, gerente: { registraRostro: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { registraRostro: 0 }])) }],
    ['2026-11-04', 'Eliminar usuarios y sucursales: solo Dirección. Si nunca se usaron se borran; si ya tienen registros (cotizaciones, cobros, bitácora…) se archivan: desaparecen de las listas y su historial se conserva. La sucursal principal y la propia cuenta no se eliminan.', {
      admin: { eliminaUsuario: 1, eliminaSucursal: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { eliminaUsuario: 0, eliminaSucursal: 0 }])) }],
    ['2026-11-03', 'Precio de la hora de cada puesto y el dinero del tiempo extra (dobles y triples, en la semana y en el Excel de nómina): lo ven y lo cambian quienes ven sueldos (Dirección y el Gerente, de su sucursal); los demás roles solo ven horas.', {
      admin: { precioExtra: 1, dineroExtra: 1 }, gerente: { precioExtra: 1, dineroExtra: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { precioExtra: 0, dineroExtra: 0 }])) }],
    ['2026-11-03', 'Nadie corrige su PROPIA asistencia (agregar, anular o aceptar sus checadas, autorizarse tiempo extra, cambiarse el horario, registrarse vacaciones o permisos), ni el Gerente: lo hace otra persona con permiso. Dirección sí, porque no tiene a quién pedírselo.', {
      admin: { corrigeSuyo: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { corrigeSuyo: 0 }])) }],
    ['2026-11-03', 'Checar desde el celular: mandar el enlace o quitar el celular lo hacen Dirección y el Gerente (quien edita el personal); la ubicación de cada checada la ven solo Dirección y el Gerente (se toma solo al checar). Los demás roles no.', {
      admin: { daCelular: 1, ubicacion: 1 }, gerente: { daCelular: 1, ubicacion: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { daCelular: 0, ubicacion: 0 }])) }],
    ['2026-11-03', 'Pestaña RH (junta Personal, asistencia, horarios, kioscos, nómina y aviso de privacidad): la ve quien ve el personal (Gerente y Dirección); cargar trabajadores en lote desde la plantilla, solo quien edita el personal (Gerente y Dirección). Los demás roles no.', {
      admin: { veRH: 1, importaPersonal: 1 }, gerente: { veRH: 1, importaPersonal: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { veRH: 0, importaPersonal: 0 }])) }],
    ['2026-11-04', 'Gastos con factura: subir el XML a un gasto ya registrado (el sistema llena solo el IVA) lo hacen quien registró el gasto y quien paga cuentas por pagar (Dirección, Gerente y Compras). Corregir el IVA a mano, solo quien paga (como antes). Los demás roles no.', {
      admin: { subeXmlGasto: 1, corrigeIvaGasto: 1 }, gerente: { subeXmlGasto: 1, corrigeIvaGasto: 1 }, costos: { subeXmlGasto: 1, corrigeIvaGasto: 1 }, tecnico: { subeXmlGasto: 1, corrigeIvaGasto: 0 },
      ...Object.fromEntries(['ventas', 'atencion', 'marketing', 'marketing_gerente'].map(r => [r, { subeXmlGasto: 0, corrigeIvaGasto: 0 }])) }],
    ['2026-10-26', 'Marketing: aprueban las publicaciones Dirección y el Gerente de marketing; nadie más (ni Marketing, aunque la haya escrito).', { admin: { apruebaPub: 1 }, marketing_gerente: { apruebaPub: 1 }, marketing: { apruebaPub: 0 }, gerente: { apruebaPub: 0 }, ventas: { apruebaPub: 0 }, atencion: { apruebaPub: 0 }, tecnico: { apruebaPub: 0 }, costos: { apruebaPub: 0 } }],
    ['2026-10-26', 'Marketing y Gerente de marketing: ven, editan y comentan las publicaciones de toda la empresa (de cualquier sucursal y las generales), y nada más del sistema: ni ventas, cobranza, gastos, compras, prospección ni personal.', Object.fromEntries(['marketing', 'marketing_gerente'].map(r => [r, {
      rubi: 1, zafiro: 1, topacio: 1, editaPub: 1, comentaPub: 1, ambar: 0, berilo: 0, coral: 0, cobroAlicia: 0, cobroTomas: 0, saldo: 0, gastoTomas: 0, gastoCarlos: 0, clabeProv: 0, jade: 0, perla: 0, granate: 0, cuarzo: 0, obsidiana: 0, clabe: 0, editaO1: 0, borra: 0 }]))],
    ['2026-10-26', 'Los demás roles (Gerente, Ventas, Atención, Técnico, Compras) no ven Marketing; Dirección lo puede prender en Roles y permisos.', Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { rubi: 0, zafiro: 0, topacio: 0, editaPub: 0, comentaPub: 0 }]))],
    ['2026-10-26', 'Dirección ve y aprueba todo Marketing.', { admin: { rubi: 1, zafiro: 1, topacio: 1, editaPub: 1, comentaPub: 1 } }],
    ['2026-10-27', 'Dinero de Marketing (presupuesto, gastos, costo por contacto y retorno): lo ven Dirección y el Gerente de marketing; el rol Marketing y los demás roles no.', {
      admin: { presupMk: 1, gastoMk: 1 }, marketing_gerente: { presupMk: 1, gastoMk: 1 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { presupMk: 0, gastoMk: 0 }])) }],
    ['2026-11-04', 'Llamadas de Google Ads (subir el reporte «Detalles de las llamadas» y verlo cruzado con los contactos, ventas e importes): lo ven y lo cargan solo Dirección y el Gerente de marketing; el rol Marketing y los demás roles no.', {
      admin: { gAds: 1, cargaAds: 1 }, marketing_gerente: { gAds: 1, cargaAds: 1 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { gAds: 0, cargaAds: 0 }])) }],
    ['2026-11-09', 'Cara que no coincide en el kiosco (o parece foto o pantalla): además de pedir el PIN y tomar la foto, sale un aviso en Inicio (ficha «Personal») por persona y día, hasta que alguien lo revisa. Lo ven quienes ven los intentos fallidos (Dirección y el Gerente, de su sucursal); marcarlo revisado lo hacen quienes corrigen la asistencia (Dirección y el Gerente). Los demás roles no.', {
      admin: { veAvisoCara: 1, revisaCara: 1 }, gerente: { veAvisoCara: 1, revisaCara: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { veAvisoCara: 0, revisaCara: 0 }])) }],
    ['2026-11-09', 'Reglas del tiempo extra (semana de nómina —semana vencida de lunes a domingo—, desde cuántos minutos después de la salida cuenta, llegar antes, redondeo, descansos y festivos): valen para TODA la empresa, así que las cambia quien cambia los días festivos (Dirección, o RH de la empresa); cada cambio vale desde una fecha y lo pasado no cambia. El Gerente de una sola sucursal y los demás roles no.', {
      admin: { reglasExtra: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { reglasExtra: 0 }])) }],
    ['2026-11-11', 'Descargar la nómina (la semana con horas trabajadas, retardos, faltas y tiempo extra de cada persona, con el pago del tiempo extra, y su Excel): es un permiso aparte, «Descargar la nómina», que Dirección puede dar a cualquier rol en Roles y permisos. Quien solo tiene ese permiso ve únicamente esa pantalla: nada más de RH (fichas, checadas, fotos, intentos, horarios, precios, kioscos). De fábrica lo tienen Dirección y el Gerente; los demás roles no.', {
      admin: { 'perm:asistencia.nomina': 1 }, gerente: { 'perm:asistencia.nomina': 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { 'perm:asistencia.nomina': 0 }])) }],
    ['2026-11-12', 'Personal y checador (etapa 6 de la auditoría): nadie cambia su propio sueldo o datos de pago, ni la cuenta ligada a su ficha, ni liga su propio usuario a una ficha; tampoco se da su propio PIN, enlace del celular o código de la cara. Quien no tiene su ficha ligada no cambia sueldos ni datos de pago ni da PIN, enlaces o códigos de cara, hasta que Dirección o RH la liguen. La primera alta en el checador la da quien edita el personal; reiniciar un PIN que ya existe, mandar el enlace del celular y dar el código de la cara, solo quien además corrige la asistencia (Dirección y el Gerente, de su sucursal). Dirección sí puede todo, también sobre sí misma.', {
      admin: { cambiaSuSueldo: 1, pinSuyo: 1, reiniciaPin: 1, mandaEnlace: 1 }, gerente: { cambiaSuSueldo: 0, pinSuyo: 0, reiniciaPin: 1, mandaEnlace: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cambiaSuSueldo: 0, pinSuyo: 0, reiniciaPin: 0, mandaEnlace: 0 }])) }],
    ['2026-11-11', 'Eliminar un kiosco de la lista de kioscos del reloj checador: solo Dirección (ni el Gerente, que sí registra y da de baja kioscos). Las checadas e intentos que hizo ese kiosco se conservan.', {
      admin: { eliminaKiosco: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { eliminaKiosco: 0 }])) }],
    ['2026-11-11', 'Avisos (comunicados): los publica quien tenga el permiso «Publicar avisos» (Dirección siempre; los demás roles no, hasta que Dirección se lo dé en Roles y permisos). Se mandan a personas elegidas (personal y usuarios del sistema), que lo ven en el reloj checador, en su celular o en el Inicio del CRM hasta que tocan «Enterado»; también por correo y WhatsApp si se elige. Un aviso no se borra: se retira y queda quién lo leyó y cuándo.', {
      admin: { 'perm:avisos.publicar': 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { 'perm:avisos.publicar': 0 }])) }],
    ['2026-11-05', 'Listas de los servicios (las opciones que se eligen para la parte que cambia de la descripción, p. ej. [VOLUMEN]: 4M3, 8M3… o [SUCURSAL] de KFC): las agregan o quitan solo Dirección; ningún otro rol, ni el Gerente. Quienes cotizan solo eligen de la lista. Quitar no borra: queda en la bitácora.', {
      admin: { editaListaServ: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { editaListaServ: 0 }])) }],
    ['2026-10-27', 'Presupuesto de Marketing: lo propone el Gerente de marketing y lo aprueba solo Dirección.', {
      admin: { apruebaPresup: 1 }, marketing_gerente: { proponePresup: 1, apruebaPresup: 0 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { proponePresup: 0, apruebaPresup: 0 }])) }],
    ['2026-10-27', 'Gastos de Marketing: los registran Dirección y el Gerente de marketing, y son control interno del departamento: no aparecen en Cuentas por pagar.', {
      admin: { registraGasto: 1, mkEnCxp: 0 }, marketing_gerente: { registraGasto: 1 }, ...Object.fromEntries(['marketing', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { registraGasto: 0, mkEnCxp: 0 }])) }],
    ['2026-10-27', 'Resultados de cada publicación (alcance, me gusta, mensajes…): los capturan Marketing, el Gerente de marketing y Dirección, cuando ya está publicada; los demás roles no.', {
      admin: { capturaRes: 1 }, marketing: { capturaRes: 1 }, marketing_gerente: { capturaRes: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, { capturaRes: 0 }])) }],
    ['2026-10-27', 'Facturación (conexión con factura.com, código postal de expedición y series de cada sucursal, incluido crear la serie propia de una sucursal —agregado el 2026-10-29—): la cambia solo Dirección. El código postal de expedición lo ve además quien timbra (Gerente y quien factura), porque sale en cada factura; los demás roles no lo ven, tampoco por la lista de sucursales. (Ajustada el 2026-10-27 al llegar el timbrado: «ven, no cambian».)', {
      admin: { cpFact: 1, configuraFact: 1, creaSerie: 1 }, gerente: { cpFact: 1, configuraFact: 0, creaSerie: 0 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cpFact: 0, configuraFact: 0, creaSerie: 0 }])) }],
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
    ['2026-10-29', 'Cancelar una factura timbrada (motivos 01 a 03, y pedir su estatus y acuse): Dirección, el Gerente y quien tenga «Timbrar facturas» (quien factura); los demás roles no.', {
      admin: { cancela: 1 }, gerente: { cancela: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { cancela: 0 }])) }],
    ['2026-11-03', 'Timbrar el complemento de pago de un cobro de una factura a crédito (PPD), y cancelarlo: Dirección, el Gerente y quien tenga «Timbrar facturas» (quien factura); los demás roles no. Nada se timbra solo: alguien con permiso lo revisa y lo pulsa.', {
      admin: { complementa: 1 }, gerente: { complementa: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { complementa: 0 }])) }],
    ['2026-11-03', 'Cargar de golpe los datos fiscales de los clientes desde el CSV de factura.com (revisar qué cliente del CRM es cada uno y aplicar): solo Dirección. Nunca crea clientes del CRM ni sobrescribe datos fiscales ya capturados.', {
      admin: { importaClientesFact: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { importaClientesFact: 0 }])) }],
    ['2026-11-03', 'Descargar en Excel la lista de facturas y complementos (con los filtros de la pantalla «Facturas»): Dirección, el Gerente y quien tenga «Timbrar facturas» (quien factura); los demás roles no. Es lo mismo que ya ven en la lista.', {
      admin: { exportaFact: 1 }, gerente: { exportaFact: 1 }, ...Object.fromEntries(['ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { exportaFact: 0 }])) }],
    ['2026-11-03', 'Ver la revisión «¿está lista la facturación para producción?» (qué falta en llaves, series, claves del SAT y respaldos, sin mostrar nunca una llave): solo Dirección, como el resto de la configuración de facturación.', {
      admin: { revisaProd: 1 }, ...Object.fromEntries(['gerente', 'ventas', 'atencion', 'tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { revisaProd: 0 }])) }],
    ['2026-11-11', 'Nómina semanal: la ven, preparan y cierran Dirección, el Gerente y a quien Dirección le dé «Preparar la nómina» (p. ej. el contador): ven los dos sueldos de cada persona (IMSS y bono). Los demás roles no.', {
      admin: { preparaNomina: 1 }, gerente: { preparaNomina: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { preparaNomina: 0 }])) }],
    ['2026-11-11', 'Pagar la nómina y bajar la lista para el banco con la CLABE de cada persona: quien prepara la nómina y además mueve dinero (Dirección y el Gerente). Compras mueve dinero pero no ve sueldos: no.', {
      admin: { pagaNomina: 1 }, gerente: { pagaNomina: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { pagaNomina: 0 }])) }],
    ['2026-11-11', 'Proyectos y tareas con Gantt: asignan tareas Dirección y el Gerente (este solo a gente de su sucursal) y ven las del equipo; cada persona ve y avanza solo las suyas (las marca terminadas y quien la asignó la acepta o la regresa). Al asignarla le llega en Inicio y por correo.', {
      admin: { asignaTarea: 1, veTareaAjena: 1, avanzaTareaPropia: 1 }, gerente: { asignaTarea: 1, veTareaAjena: 1, avanzaTareaPropia: 1 },
      ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { asignaTarea: 0, veTareaAjena: 0, avanzaTareaPropia: 1 }])) }],
    ['2026-11-11', 'Reporte de Dirección: las metas del mes (venta, cobranza, margen, satisfacción y cumplimiento) las pone solo Dirección; el Gerente las ve en su Panorama. El reporte ejecutivo del mes llega por correo a Dirección el día 1, y mandarlo a mano también es solo de Dirección.', {
      admin: { editaMetas: 1, enviaReporte: 1 }, ...Object.fromEntries(['gerente', 'costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { editaMetas: 0, enviaReporte: 0 }])) }],
    ['2026-11-11', 'Análisis comercial: los indicadores nuevos (satisfacción, cobranza a tiempo, servicios en fecha, recompras) los ve quien ve el análisis comercial, cada quien con lo suyo; nada de cuentas por pagar ni dinero de la empresa (eso queda en el Panorama, para Dirección y el Gerente).', {
      admin: { veIndicadores: 1 }, gerente: { veIndicadores: 1 }, ventas: { veIndicadores: 1 }, atencion: { veIndicadores: 1 }, ...Object.fromEntries(['tecnico', 'costos', 'marketing', 'marketing_gerente'].map(r => [r, { veIndicadores: 0 }])) }],
    ['2026-11-12', 'Folios de banco: cada movimiento recibe su folio al registrarse con su cuenta (STD-E-0001…). Eligen la cuenta quienes pagan, cobran ya confirmado o confirman cobros (Dirección, Gerente, Ventas, Atención y Compras); el técnico no. La clave de folio de una cuenta y «Asignar folios pendientes» los hacen Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Los folios nunca se reusan ni se borran.', {
      admin: { veCuentasBanco: 1, poneClaveFolio: 1, asignaFolios: 1 }, gerente: { veCuentasBanco: 1, poneClaveFolio: 1, asignaFolios: 1 },
      ...Object.fromEntries(['ventas', 'atencion', 'costos'].map(r => [r, { veCuentasBanco: 1, poneClaveFolio: 0, asignaFolios: 0 }])),
      ...Object.fromEntries(['tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { veCuentasBanco: 0, poneClaveFolio: 0, asignaFolios: 0 }])) }],
    ['2026-11-12', 'Contabilidad › Flujo de banco: agregar movimientos que no pasaron por el sistema (traspasos, préstamos, comisiones, devoluciones) y desglosar un pago en varios renglones (varias facturas o una factura por unidad) lo hacen Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Un movimiento no se borra: se cancela con motivo; un renglón del desglose se quita y queda en la bitácora. Un mes cerrado, solo Dirección. Los demás roles no.', {
      admin: { agregaMovFlujo: 1 }, gerente: { agregaMovFlujo: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { agregaMovFlujo: 0 }])) }],
    ['2026-11-12', 'Contabilidad › Flujo de banco: «Editar tabla» y guardar correcciones en las celdas (marcas S/FALTA/NA, textos, monto CFDI, cuenta de banco) lo hacen Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Cada corrección queda con quién, cuándo y el valor anterior, y se puede regresar al dato del sistema. El saldo, X comprobar, los importes y las fechas no se corrigen ahí. Un mes cerrado lo corrige solo Dirección. Los demás roles no.', {
      admin: { editaFlujo: 1 }, gerente: { editaFlujo: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { editaFlujo: 0 }])) }],
    ['2026-11-12', 'Contabilidad: el saldo inicial del banco (Flujo de banco) lo guardan en el sistema Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador), y queda quién y cuándo. Cerrar un mes ya terminado: Dirección y el rol que Dirección cree con «Cerrar el mes de contabilidad» (el Contador); el Gerente no. Ya cerrado, solo Dirección registra, confirma, corrige o cancela cobros, pagos y anticipos con fecha de ese mes (en cualquier pantalla) y cambia su saldo inicial; reabrirlo es solo de Dirección, con motivo.', {
      admin: { cambiaSaldo: 1, cierraMes: 1 }, gerente: { cambiaSaldo: 1, cierraMes: 0 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { cambiaSaldo: 0, cierraMes: 0 }])) }],
    ['2026-11-11', 'Conciliación bancaria (subir el estado de cuenta de Santander o Banorte y emparejarlo con cobros, pagos, anticipos y nómina del CRM): Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Registrar como gasto un cargo del banco que no está en el CRM (p. ej. una comisión) además pide «Mover dinero». Los demás roles no.', {
      admin: { concilia: 1 }, gerente: { concilia: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { concilia: 0 }])) }],
    ['2026-11-11', 'Bono de puntualidad: sus reglas (monto por puesto y sucursal, retardos y faltas permitidos; vacaciones, incapacidades y permisos se respetan) las ponen quienes preparan la nómina: Dirección y el Gerente. Los demás roles no.', {
      admin: { reglaPuntualidad: 1 }, gerente: { reglaPuntualidad: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { reglaPuntualidad: 0 }])) }],
    ['2026-11-11', 'Anticipos por comprobar: los entregan, cierran y cancelan Dirección y quien mueve dinero y ya ve al personal (el Gerente). Compras mueve dinero pero no ve al personal (regla del 2026-10-19): por ahora no; los demás roles tampoco.', {
      admin: { entregaAnticipo: 1 }, gerente: { entregaAnticipo: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { entregaAnticipo: 0 }])) }],
    ['2026-11-11', 'Anticipos por comprobar: Dirección, el Gerente y quien tiene «Contabilidad del mes» ven todos los de su sucursal; cada persona ve solo los suyos (los comprueba con sus gastos, aunque no tenga orden de servicio).', {
      admin: { veAnticipoAjeno: 1 }, gerente: { veAnticipoAjeno: 1 }, ...Object.fromEntries(['costos', 'ventas', 'atencion', 'tecnico', 'marketing', 'marketing_gerente'].map(r => [r, { veAnticipoAjeno: 0 }])) }],
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

  // ----- Roles hechos a mano en «Roles y permisos» (2026-11-03) -----
  // Dirección apagó áreas de un rol y aún le salían Cotizaciones, «Servicios por concluir» y Recompras. Cada rol de prueba
  // ve toda su sucursal en lo que tiene prendido; se revisa el menú, las fichas de Inicio y lo que le manda el servidor.
  exigir(await pedir('PUT', '/servicios/' + SERV.id, A, { dias_recurrencia: 30 }), 'recompra del servicio');
  const cMano = await contacto(T.Valeria, 'Sr. Ulises Recompra', '442 222 0099', 'Fábrica Recompra');
  const OM = await cotizar(T.Valeria, 'Valeria', cMano, 'Orden Mano', 1500, true);
  const cCot = await contacto(T.Valeria, 'Sra. Nidia Cotiza', '442 222 0098', 'Oficinas Cotiza');
  const QM = await cotizar(T.Valeria, 'Valeria', cCot, 'Cotización Mano', 900);
  exigir(await pedir('POST', '/leads/' + OM.id + '/historial', T.Valeria, { tipo: 'alerta', texto: 'Aviso Orden Mano', fecha_alerta: dia(-1) + ' 09:00:00' }), 'aviso de la orden');
  exigir(await pedir('POST', '/leads/' + QM.id + '/historial', T.Valeria, { tipo: 'alerta', texto: 'Aviso Cotización Mano', fecha_alerta: dia(-1) + ' 09:00:00' }), 'aviso de la cotización');
  const BLOQUES = [...html.matchAll(/class="inicio-bloque ([^"]*)" data-titulo-corto="([^"]+)"/g)].map(([, cl, t]) => ({ t, cl: cl.split(/\s+/) }));
  const veClases = (set, cl) => cl.every(c => { const p = c.match(/^perm-([a-z_]+)-([a-z_]+)$/); return !p || set.has(p[1] + '.' + p[2]); });
  const NIVEL_0 = Object.fromEntries(PERM.areas.map(a => [a.clave, 0]));
  const MANO = [['cobranza', 'Cobranza sin ventas (contactos y cuentas por cobrar)', { contactos: 2, cxc: 2 }], ['cotiza', 'Cotiza sin órdenes (contactos, cotizaciones y cobranza)', { contactos: 2, cotizaciones: 2, cxc: 2 }],
    ['contactos', 'Solo contactos', { contactos: 2 }], ['atencion', 'Atención (de fábrica, para comparar)', null]];
  const VM = {};
  for (const [k, nombre, niveles] of MANO) {
    let t = T.Alicia;
    if (niveles) {
      const rol = exigir(await pedir('POST', '/roles', A, { nombre: 'Mano ' + k }), 'crear rol ' + k);
      exigir(await pedir('PUT', '/roles/' + rol.clave + '/permisos', A, { permisos: [], alcances: { ...NIVEL_0, ...niveles } }), 'permisos del rol ' + k);
      const quien = 'Mano ' + { cobranza: 'Cobra', cotiza: 'Cotiza', contactos: 'Contacta' }[k];
      exigir(await pedir('POST', '/usuarios', A, { nombre: quien, password: CLAVE, rol: rol.clave, sucursales: [qro.id] }), 'usuario ' + quien);
      t = (await pedir('POST', '/login', null, { nombre: quien, password: CLAVE }))[1].token;
    }
    const set = new Set((await pedir('GET', '/permisos/mios', t))[1].permisos), texto = async r => (await pedir('GET', r, t))[2] || '';
    const cal = await texto('/calendario?desde=' + dia(-10) + '&hasta=' + dia(10));
    VM[k] = { nombre,
      menuCot: veClases(set, MENU.find(m => m.vista === 'leads').clases), menuCal: veClases(set, MENU.find(m => m.vista === 'calendario').clases),
      ...Object.fromEntries(BLOQUES.map(b => ['inicio:' + b.t, veClases(set, b.cl)])),
      recompra: /Fábrica Recompra/.test(await texto('/recompras')),
      alertaOrden: /Aviso Orden Mano/.test(await texto('/alertas')), alertaCot: /Aviso Cotización Mano/.test(await texto('/alertas')),
      porConcluir: /Fábrica Recompra/.test(await texto('/leads?estatus=ganado&solo_area=1')),
      calOrden: /"tipo":"orden"[^}]*Fábrica Recompra/.test(cal), cobranza: (await pedir('GET', '/leads/' + OM.id + '/cobros', t))[0] === 200 };
  }
  const NOMBRE_MANO = { menuCot: 'Menú: Cotizaciones', menuCal: 'Menú: Calendario', 'inicio:Avisos': 'Inicio: Avisos y seguimiento', 'inicio:Por concluir': 'Inicio: Servicios por concluir', 'inicio:Recompras': 'Inicio: Recompras', 'inicio:Finanzas': 'Inicio: Finanzas',
    recompra: 'Le llega la recompra de una orden', alertaOrden: 'Le llega el aviso de una orden', alertaCot: 'Le llega el aviso de una cotización', porConcluir: 'Le llega la orden por concluir', calOrden: 'Ve la orden en el calendario', cobranza: 'Ve la cobranza de la orden' };
  const REGLAS_MANO = [
    ['2026-11-03', 'Un rol sin cotizaciones ni órdenes no ve «Cotizaciones» en el menú ni sus avisos en Inicio, aunque vea contactos o la cobranza.', { cobranza: { menuCot: 0, 'inicio:Avisos': 0, alertaOrden: 0, alertaCot: 0 }, contactos: { menuCot: 0, 'inicio:Avisos': 0, alertaOrden: 0, alertaCot: 0 } }],
    ['2026-11-03', '«Servicios por concluir» y las órdenes del calendario: solo quien ve órdenes de servicio. Quien solo ve la cobranza sigue viendo la cobranza de esas órdenes, no la orden para concluirla.', { cobranza: { 'inicio:Por concluir': 0, porConcluir: 0, calOrden: 0, cobranza: 1 }, cotiza: { 'inicio:Por concluir': 0, porConcluir: 0, calOrden: 0, alertaOrden: 0, menuCot: 1, 'inicio:Avisos': 1, alertaCot: 1 }, contactos: { 'inicio:Por concluir': 0, porConcluir: 0, calOrden: 0 } }],
    ['2026-11-03', 'Recompras: salen de las órdenes de servicio, así que solo las ve quien ve órdenes (no quien solo ve contactos o la cobranza).', { cobranza: { 'inicio:Recompras': 0, recompra: 0 }, cotiza: { 'inicio:Recompras': 0, recompra: 0 }, contactos: { 'inicio:Recompras': 0, recompra: 0, menuCal: 0 } }],
    ['2026-11-03', 'Atención (con órdenes de toda su sucursal) sigue viendo todo eso: avisos, servicios por concluir, recompras y calendario.', { atencion: { menuCot: 1, menuCal: 1, 'inicio:Avisos': 1, 'inicio:Por concluir': 1, 'inicio:Recompras': 1, recompra: 1, alertaOrden: 1, alertaCot: 1, porConcluir: 1, calOrden: 1 } }],
  ];
  console.log('Roles hechos a mano:');
  for (const [fecha, regla, esperado] of REGLAS_MANO) {
    const fallan = Object.entries(esperado).flatMap(([k, filas]) => Object.entries(filas).filter(([c, v]) => VM[k][c] !== !!v).map(([c, v]) => `${VM[k].nombre}: «${NOMBRE_MANO[c]}» ${v ? 'debería verse y no se ve' : 'NO debería verse y se ve'}`));
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
    '## Roles hechos a mano (lo que Dirección apaga en «Roles y permisos»)',
    '',
    `| Qué se revisa | ${MANO.map(m => m[1]).join(' | ')} |`, `|---|${MANO.map(() => ':-:').join('|')}|`,
    ...Object.entries(NOMBRE_MANO).map(([c, t]) => `| ${t} | ${MANO.map(([k]) => si(VM[k][c])).join(' | ')} |`),
    '',
    ...REGLAS_MANO.map(([fecha, regla]) => `- **${fecha}** · ${regla}`),
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
