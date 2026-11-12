// GASTOS CON EL XML DE SU FACTURA (2026-11-04): al registrar un gasto (o después, en su detalle) se sube el XML del CFDI y el
// sistema llena solo el IVA, para que la utilidad sin IVA de Resultados sea exacta. Facturas 100 % inventadas (tests/cfdi-inventado.cjs):
//  · gasolina con IVA e IEPS: solo el IVA se resta; el IEPS se queda en el gasto;
//  · factura sin IVA (tasa 0 / sin impuestos), con retenciones, en dólares y nota de crédito: se guardan y se avisa lo que no se adivina;
//  · la misma factura dos veces (alta y detalle), a nombre de otro RFC, de otro tipo, sin timbre o que no es XML: se rechazan;
//  · el total del XML debe coincidir; el XML se descarga tal cual; el botón «IVA» sigue y queda en la bitácora;
//  · sin XML todo sigue igual que antes (factura sin IVA = estimado 16 %).
// Uso: node tests/simulacion-gastos-xml.cjs   (base temporal; no toca saneadren.db)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { cfdi, RECEPTOR_RFC } = require('./cfdi-inventado.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gastos-xml-')); const PUERTO = String(5400 + Math.floor(Math.random() * 300)), DB = path.join(dir, 'g.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'GastosXml-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', FACTURA_PROD_EMISOR_RFC: RECEPTOR_RFC } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL_API = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL_API + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (r, t, cuerpo) => { const x = await fetch(URL_API + r, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t, 'X-Nombre': encodeURIComponent('factura proveedor.xml') }, body: cuerpo }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const DIA1 = HOY.slice(0, 8) + '01';
const FECHA = HOY + 'T09:30:00';

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Gasolinera Inventada', categoria: 'combustible', dias_credito: 0, rfc: 'GAS010101AB1' });
  const [, prov2] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Despacho Inventado', categoria: 'profesionales', dias_credito: 0 });
  const lista = async () => (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1];
  const gasto = extra => pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasolina de la pipa', fecha_documento: HOY, dias_credito: 0, ...extra });
  let s, j;

  console.log('1. Gasolina con IVA e IEPS (leer y registrar)');
  const GASOLINA = cfdi({ total: '1255.14', traslados: [['002', '160.00'], ['003', '95.14', 'Cuota', '0.453900']], fecha: FECHA, serie: 'GA', folio: '7781' });
  [s, j] = await subir('/finanzas/cxp/leer-xml?proveedor_id=' + prov.id, A, GASOLINA);
  revisa(s === 200 && j.total === 1255.14 && j.iva === 160 && j.ieps === 95.14 && j.subtotal === 1000 && j.avisos.length === 0, 'leer el XML (sin guardar): total $1,255.14, IVA $160, IEPS $95.14, sin avisos', j);
  revisa(j.serie === 'GA' && j.folio === '7781' && j.fecha === HOY && j.emisor_rfc === 'GAS010101AB1' && j.metodo_pago === 'PUE', 'trae serie/folio, fecha, RFC del emisor y método de pago', j);
  revisa((await lista()).length === 0, 'leer el XML no registra ningún gasto');
  [s, j] = await gasto({ xml: GASOLINA, xml_nombre: 'gasolina.xml', tipo_comprobante: 'factura' }); const gGas = j.id;
  revisa(s === 201 && j.iva === 160 && Array.isArray(j.avisos), 'se registra el gasto con el XML y sin escribir el total', j);
  let x = (await lista()).find(c => c.id === gGas);
  revisa(x && x.total === 1255.14 && x.iva === 160 && !x.iva_estimado && x.iva_origen === 'xml', 'el total sale del XML y el IVA queda CAPTURADO ($160, ya no «estimado»)', x);
  revisa(x.factura_folio === 'GA-7781' && x.tipo_comprobante === 'factura' && x.metodo_sat === 'PUE', 'folio GA-7781, tipo factura y método PUE del XML', x);
  revisa(x.xml && x.xml.uuid && x.xml.ieps === 95.14 && x.xml.iva === 160 && x.xml.ret_isr === 0 && x.xml.emisor_rfc === 'GAS010101AB1', 'se guardan UUID, emisor, IVA e IEPS por separado', x.xml);
  [s, j] = await pedir('GET', `/tablero?desde=${DIA1}&hasta=${HOY}&tipo=mes`, A);
  revisa(j.actual.gasto === 1095.14 && j.actual.gasto_con_iva === 1255.14 && j.actual.iva_gastos === 160 && j.actual.iva_estimado === 0, 'Resultados: gasto sin IVA $1,095.14 (el IEPS $95.14 se queda en el gasto; solo se quita el IVA)', j.actual);

  console.log('2. La misma factura dos veces');
  [s, j] = await gasto({ xml: GASOLINA, total: 1255.14 });
  revisa(s === 409 && j.codigo === 'UUID_REPETIDO' && j.error.includes('#' + gGas) && j.error.includes('Gasolina de la pipa'), 'al registrar otro gasto con el mismo XML: se rechaza y dice cuál gasto ya lo tiene', j);
  [s, j] = await subir('/finanzas/cxp/leer-xml', A, GASOLINA); revisa(s === 409 && j.codigo === 'UUID_REPETIDO', 'leerlo de nuevo ya avisa que está registrada', j);
  [s, j] = await gasto({ concepto: 'Gasolina sin XML', total: 1255.14, tipo_comprobante: 'factura' }); const gSin = j.id;
  [s, j] = await subir('/finanzas/cxp/' + gSin + '/xml', A, GASOLINA); revisa(s === 409 && j.codigo === 'UUID_REPETIDO', 'subirlo al detalle de otro gasto: también se rechaza', j);
  const REPETIDA_OTRO_ARCHIVO = GASOLINA.replace('Concepto inventado', 'Concepto inventado ').replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0" encoding="utf-8"?>');
  [s, j] = await gasto({ xml: REPETIDA_OTRO_ARCHIVO }); revisa(s === 409 && j.codigo === 'UUID_REPETIDO', 'aunque el archivo cambie un poco, el mismo UUID se detecta', j);

  console.log('3. Factura sin IVA (tasa 0 o sin impuestos)');
  [s, j] = await gasto({ concepto: 'Agua purificada', xml: cfdi({ total: '500.00', fecha: FECHA }) }); const gCero = j.id;
  x = (await lista()).find(c => c.id === gCero);
  revisa(s === 201 && x.total === 500 && x.iva === 0 && !x.iva_estimado && x.iva_origen === 'xml', 'factura sin impuestos: IVA $0 capturado (no se estima 16 %)', x || j);
  [s, j] = await gasto({ concepto: 'Medicamento tasa 0', xml: cfdi({ total: '300.00', traslados: [['002', '0.00', 'Tasa', '0.000000']], fecha: FECHA }) });
  x = (await lista()).find(c => c.id === j.id); revisa(s === 201 && x.iva === 0 && !x.iva_estimado, 'factura tasa 0 %: IVA $0', x || j);
  [s, j] = await gasto({ concepto: 'Exento', xml: cfdi({ total: '250.00', traslados: [['002', '0', 'Exento']], fecha: FECHA }) });
  x = (await lista()).find(c => c.id === j.id); revisa(s === 201 && x.iva === 0 && !x.iva_estimado, 'factura exenta: IVA $0', x || j);

  console.log('4. Factura con retenciones (honorarios): se guarda y se avisa');
  const HONORARIOS = cfdi({ total: '953.33', traslados: [['002', '160.00']], retenciones: [['001', '100.00'], ['002', '106.67']], emisorRfc: 'DES010101AB1', emisorNombre: 'DESPACHO INVENTADO', fecha: FECHA, metodo: 'PPD' });
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov2.id, categoria: 'profesionales', concepto: 'Asesoría contable', fecha_documento: HOY, dias_credito: 15, xml: HONORARIOS }); const gRet = j.id;
  revisa(s === 201 && j.avisos.some(a => /retenciones/i.test(a) && a.includes('100.00') && a.includes('106.67') && /contador/.test(a)), 'se registra, avisando las retenciones (ISR $100, IVA $106.67) y que lo vea el contador', j);
  x = (await lista()).find(c => c.id === gRet);
  revisa(x.total === 953.33 && x.iva === 160 && x.xml.ret_isr === 100 && x.xml.ret_iva === 106.67 && x.metodo_sat === 'PPD', 'IVA trasladado $160; retenciones guardadas aparte; método PPD', x);
  revisa(x.xml.avisos.length >= 1, 'los avisos quedan guardados con el XML (se ven en el detalle)', x.xml);

  console.log('5. Otra moneda y nota de crédito');
  const DOLARES = cfdi({ total: '116.00', traslados: [['002', '16.00']], moneda: 'USD', tipoCambio: '18.50', fecha: FECHA });
  [s, j] = await gasto({ concepto: 'Refacción importada', xml: DOLARES }); revisa(s === 400, 'en dólares sin escribir el total en pesos: pide el total', j);
  [s, j] = await gasto({ concepto: 'Refacción importada', xml: DOLARES, total: 2146 }); const gUsd = j.id;
  revisa(s === 201 && j.avisos.some(a => a.includes('USD') && /NO se tomaron/.test(a)) && j.iva === null, 'con el total en pesos se registra, avisando que el IVA no se tomó del XML', j);
  x = (await lista()).find(c => c.id === gUsd); revisa(x.total === 2146 && x.iva_estimado === true && x.xml.moneda === 'USD', 'el IVA sigue estimado hasta que alguien lo capture en pesos (no se adivina el tipo de cambio)', x);
  [s, j] = await gasto({ concepto: 'Nota de crédito', xml: cfdi({ tipo: 'E', total: '116.00', traslados: [['002', '16.00']], fecha: FECHA }) });
  revisa(s === 201 && j.avisos.some(a => /nota de crédito/.test(a)), 'nota de crédito (E): se acepta, avisando que no es un gasto nuevo', j);
  [s, j] = await gasto({ concepto: 'Hotel de cuadrilla', xml: cfdi({ total: '1180.00', traslados: [['002', '160.00']], locales: true, fecha: FECHA }) });
  revisa(s === 201 && j.avisos.some(a => /locales/.test(a)), 'impuestos locales (hospedaje): se guarda y se avisa', j);

  console.log('6. Validaciones');
  const casos = [
    [cfdi({ total: '116.00', receptorRfc: 'OTR010101AB1', receptorNombre: 'OTRA EMPRESA', fecha: FECHA }), 400, /otro RFC.*OTR010101AB1/, 'a nombre de otro RFC: se rechaza'],
    [cfdi({ tipo: 'P', total: '0', fecha: FECHA }), 400, /tipo «P»/, 'complemento de pago (tipo P): se rechaza'],
    [cfdi({ tipo: 'N', total: '116.00', fecha: FECHA }), 400, /tipo «N»/, 'nómina (tipo N): se rechaza'],
    [cfdi({ version: '3.2', total: '116.00', fecha: FECHA }), 400, /3\.3 o 4\.0/, 'CFDI versión 3.2: se rechaza'],
    [cfdi({ uuid: '', total: '116.00', fecha: FECHA }), 400, /timbre/, 'sin timbre del SAT (sin UUID): se rechaza'],
    ['<?xml version="1.0"?><pedido><total>5</total></pedido>', 400, /no es el XML de una factura/, 'un XML que no es factura: se rechaza'],
  ];
  for (const [xmlTxt, st, re, que] of casos) { [s, j] = await gasto({ concepto: 'Prueba de validación', xml: xmlTxt, total: 116 }); revisa(s === st && re.test(j.error || ''), que, [s, j]); }
  { // A-03: un XML mal formado no congela el servidor, y uno de más de 2 MB se rechaza
    const malo = Buffer.from('<?xml version="1.0"?><cfdi:Comprobante Version="4.0" Total="1.00">' + '<cfdi:Conceptos>'.repeat(40000));
    const t0 = Date.now(); [s, j] = await subir('/finanzas/cxp/leer-xml', A, malo); const ms = Date.now() - t0;
    revisa(ms < 500 && s === 400, 'leer-xml: un XML mal formado de 640 KB se rechaza en menos de 0.5 s (A-03)', [s, ms + ' ms']);
    [s, j] = await subir('/finanzas/cxp/leer-xml', A, Buffer.from('<?xml version="1.0"?><cfdi:Comprobante Version="4.0">' + ' '.repeat(2 * 1024 * 1024 + 10))); revisa(s === 413, 'leer-xml: un XML de más de 2 MB se rechaza (A-03)', [s, j.error]); }
  [s, j] = await subir('/finanzas/cxp/leer-xml', A, Buffer.from('%PDF-1.4 algo %%EOF')); revisa(s === 400 && /XML/.test(j.error), 'subir el PDF en lugar del XML: se pide el XML', j);
  [s, j] = await gasto({ concepto: 'Total distinto', xml: cfdi({ total: '580.00', traslados: [['002', '80.00']], fecha: FECHA }), total: 2000 });
  revisa(s === 400 && j.codigo === 'TOTAL_DISTINTO' && j.error.includes('580.00') && j.error.includes('2,000.00'), 'el total capturado no coincide con el del XML: se rechaza diciendo los dos', j);
  [s, j] = await gasto({ concepto: 'Recibo con XML', xml: cfdi({ total: '580.00', traslados: [['002', '80.00']], fecha: FECHA }), tipo_comprobante: 'recibo' });
  revisa(s === 400 && /Factura/.test(j.error), 'XML con tipo de comprobante «recibo»: pide elegir Factura', j);
  [s, j] = await gasto({ concepto: 'CFDI 3.3', xml: cfdi({ version: '3.3', total: '232.00', traslados: [['002', '32.00']], fecha: FECHA }).replace('http://www.sat.gob.mx/cfd/4', 'http://www.sat.gob.mx/cfd/3') });
  x = (await lista()).find(c => c.id === j.id); revisa(s === 201 && x.iva === 32, 'una factura CFDI 3.3 también se lee (IVA $32)', x || j);
  [s, j] = await gasto({ concepto: 'Redondeo', xml: cfdi({ total: '229.90', subtotal: '198.19', traslados: [['002', '31.71']], fecha: FECHA }) });
  x = (await lista()).find(c => c.id === j.id); revisa(s === 201 && x.total === 229.9 && x.iva === 31.71, 'montos con centavos ($229.90, IVA $31.71) se leen exactos', x || j);

  { const grande = cfdi({ concepto: 'x', total: '348.00', traslados: [['002', '48.00']], fecha: FECHA }).replace('Descripcion="Concepto inventado"', 'Descripcion="' + 'Refacción inventada '.repeat(15000) + '"');
    [s, j] = await gasto({ concepto: 'Factura con muchas partidas', xml: grande }); x = (await lista()).find(c => c.id === j.id);
    revisa(grande.length > 250000 && s === 201 && x.iva === 48, 'una factura grande (~300 KB, muchas partidas) también se registra', [grande.length, s, j]); }
  console.log('7. Subir el XML en el detalle de un gasto ya registrado');
  x = (await lista()).find(c => c.id === gSin); revisa(x.iva_estimado && !x.xml, 'antes: gasto sin XML con IVA estimado', x);
  const OTRA = cfdi({ total: '1255.14', traslados: [['002', '160.00'], ['003', '95.14', 'Cuota', '0.453900']], fecha: FECHA, serie: 'GA', folio: '7799' });
  [s, j] = await subir('/finanzas/cxp/' + gSin + '/xml', A, cfdi({ total: '999.00', traslados: [['002', '137.79']], fecha: FECHA }));
  revisa(s === 400 && j.codigo === 'TOTAL_DISTINTO', 'XML con otro total: se rechaza', j);
  [s, j] = await subir('/finanzas/cxp/' + gSin + '/xml', A, OTRA);
  revisa(s === 201 && j.iva === 160 && j.ieps === 95.14, 'XML correcto: se guarda y llena el IVA', j);
  x = (await lista()).find(c => c.id === gSin);
  revisa(x.iva === 160 && !x.iva_estimado && x.iva_origen === 'xml' && x.factura_folio === 'GA-7799' && x.xml?.ieps === 95.14, 'después: IVA capturado $160, folio GA-7799 y el IEPS guardado', x);
  [s, j] = await subir('/finanzas/cxp/' + gSin + '/xml', A, cfdi({ total: '1255.14', traslados: [['002', '160.00']], fecha: FECHA }));
  revisa(s === 409 && /ya tiene su XML/.test(j.error), 'un segundo XML al mismo gasto: se rechaza', j);
  [s, j] = await gasto({ concepto: 'Recibo de gasolina', total: 1255.14, tipo_comprobante: 'recibo' }); const gRecibo = j.id;
  [s, j] = await subir('/finanzas/cxp/' + gRecibo + '/xml', A, cfdi({ total: '1255.14', traslados: [['002', '160.00'], ['003', '95.14', 'Cuota', '0.453900']], fecha: FECHA, folio: '8001' }));
  x = (await lista()).find(c => c.id === gRecibo); revisa(s === 201 && x.tipo_comprobante === 'factura' && x.iva === 160, 'a un «recibo» se le sube el XML: pasa a factura con su IVA', x || j);

  console.log('8. Descargar el XML');
  { const r = await fetch(URL_API + '/finanzas/cxp/' + gGas + '/xml', { headers: { Authorization: 'Bearer ' + A } }); const t = await r.text();
    revisa(r.status === 200 && t === GASOLINA && /xml/.test(r.headers.get('content-type')) && /gasolina\.xml/.test(r.headers.get('content-disposition')), 'se descarga el mismo XML que se subió, con su nombre'); }
  [s, j] = await pedir('GET', '/finanzas/cxp/' + gRet + '/xml'); revisa(s === 401, 'sin sesión no se descarga', s);
  { const [, g2] = await gasto({ concepto: 'Sin XML todavía', total: 100, tipo_comprobante: 'recibo' }); [s, j] = await pedir('GET', '/finanzas/cxp/' + g2.id + '/xml', A); revisa(s === 404, 'un gasto sin XML: «no tiene XML»', j); }

  console.log('9. Botón «IVA» a mano y bitácora');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + gUsd + '/iva', A, { iva: 296 });
  x = (await lista()).find(c => c.id === gUsd); revisa(s === 200 && x.iva === 296 && !x.iva_estimado && x.iva_origen === 'manual', 'el IVA en pesos de la factura en dólares se captura a mano', x);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + gGas + '/iva', A, { iva: 150 }); revisa(s === 200, 'también se puede corregir a mano un IVA que vino del XML');
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
    const b = d.prepare("SELECT accion, detalle, usuario FROM auditoria WHERE entidad = 'cuenta_por_pagar' AND entidad_id = ? ORDER BY id").all(gGas);
    revisa(b.some(r => r.accion === 'creada' && r.detalle.includes('XML folio fiscal') && r.detalle.includes('IEPS $95.14')), 'bitácora del alta: el folio fiscal, el IVA y el IEPS leídos', b);
    revisa(b.some(r => r.accion === 'IVA' && r.detalle.includes('(del XML)') && r.detalle.includes('$150.00') && r.usuario), 'bitácora del cambio a mano: de cuánto a cuánto y quién lo cambió', b);
    const bs = d.prepare("SELECT accion, detalle FROM auditoria WHERE entidad = 'cuenta_por_pagar' AND entidad_id = ? ORDER BY id").all(gSin);
    revisa(bs.some(r => r.accion === 'XML de factura' && r.detalle.includes('(estimado) → $160.00')), 'bitácora al subir el XML en el detalle: el IVA estimado → el del XML', bs);
    const f = d.prepare('SELECT archivo, sha256 FROM cfdi_gastos WHERE cxp_id = ?').get(gGas);
    revisa(f && fs.existsSync(path.join(dir, 'archivos', 'cuentas_por_pagar', f.archivo)), 'el archivo XML quedó guardado junto a la base (archivos/cuentas_por_pagar)', f);
    d.close(); }

  console.log('10. Sin XML, todo sigue igual; cancelar libera la factura');
  [s, j] = await gasto({ concepto: 'Factura sin XML', total: 2320, tipo_comprobante: 'factura', factura_folio: 'X-9' });
  x = (await lista()).find(c => c.id === j.id); revisa(s === 201 && x.iva === 320 && x.iva_estimado && !x.xml && x.iva_origen === null, 'factura sin XML ni IVA: se estima el 16 % como antes', x || j);
  [s, j] = await gasto({ concepto: 'Factura con IVA a mano', total: 1160, tipo_comprobante: 'factura', factura_folio: 'X-10', iva: 160 });
  x = (await lista()).find(c => c.id === j.id); revisa(s === 201 && x.iva === 160 && !x.iva_estimado && x.iva_origen === 'manual', 'factura con el IVA escrito a mano: como antes', x || j);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + gCero + '/cancelar', A, { motivo: 'Se registró por error' }); revisa(s === 200, 'se cancela el gasto del agua (tenía XML)', j);
  [s, j] = await gasto({ concepto: 'Agua purificada (bien)', xml: cfdi({ total: '500.00', fecha: FECHA }).replace(/UUID="[^"]+"/, 'UUID="' + (await (async () => { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB); const u = d.prepare('SELECT uuid FROM cfdi_gastos WHERE cxp_id = ?').get(gCero).uuid; d.close(); return u; })()) + '"') });
  revisa(s === 201, 'con el gasto cancelado, su factura se puede volver a registrar bien', j);

  console.log('11. Integridad');
  [s, j] = await pedir('GET', '/admin/integridad', A);
  revisa(s === 200 && !(j.resultados || []).some(r => /XML de facturas de gastos/.test(r.titulo) && r.total), 'la revisión de integridad encuentra todos los XML en el servidor', (j.resultados || []).filter(r => /XML/.test(r.titulo)));

  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${n - malos.length}/${n} correctas`);
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
