// MÓDULO CONTABLE F1 (2026-11-11): «Contabilidad del mes» y «Repetir» un gasto fijo. Un rol «Contador» hecho por
// Dirección con solo «Contabilidad del mes» ve el resumen y descarga Excel y XML; los demás no. Las cifras cuadran con lo
// capturado (facturado, cobrado confirmado, gastos, pagado e IVA) y los pendientes de comprobar se cuentan.
// Uso: node tests/simulacion-contabilidad.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-contab-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Contab-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Contab-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9350 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const tipo = x.headers.get('content-type') || '', buf = Buffer.from(await x.arrayBuffer());
  let j = {}; if (/json/.test(tipo)) { try { j = JSON.parse(buf.toString()); } catch { /* */ } } return [x.status, j, buf, tipo];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), MES = HOY.slice(0, 7);

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  // Dirección crea el rol «Contador» con solo «Contabilidad del mes».
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol Contador');
  const clave = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + clave + '/permisos', A, { permisos: ['contabilidad.ver'] }), 'permiso del contador');
  const usuario = async (nombre, rol) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }), nombre); return exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); };
  const C = (await usuario('Carmen Contadora', clave)).token, vU = await usuario('Valeria Ventas', 'ventas'), V = vU.token, G = (await usuario('Gema Gerente', 'gerente')).token;
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Contable', telefono: '4425559900', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Cocina', canal_id: canal.id, servicio_id: servicio.id, responsable_id: vU.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Desazolve', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: HOY }), 'cotización');
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'orden');
  exigir(await pedir('POST', '/leads/' + o.id + '/cobros', A, { monto: 580, metodo: 'transferencia' }), 'cobro confirmado (Dirección)');
  exigir(await pedir('POST', '/leads/' + o.id + '/cobros', V, { monto: 100, metodo: 'efectivo' }), 'cobro por confirmar (ventas)');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Gasolinera Centro', categoria: 'combustible', dias_credito: 0, clabe: '012180001234567899', banco: 'BBVA' }), 'proveedor');
  const g1 = exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diésel', total: 1160, iva: 160, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'factura', factura_folio: 'G-1', ya_pagado: true, metodo: 'transferencia' }), 'gasto con IVA');
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasolina sin IVA capturado', total: 580, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'factura', factura_folio: 'G-2' }), 'gasto IVA estimado');
  // Un camión (categoría «activos»: inversión, no es gasto) con su IVA.
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'activos', concepto: 'Camión Vactor', total: 116000, iva: 16000, fecha_documento: HOY, dias_credito: 30, tipo_comprobante: 'factura', factura_folio: 'G-3' }), 'compra de un camión');
  // Una factura emitida en sandbox (timbrada, con su XML) y una cancelada.
  { const d = new DatabaseSync(DB);
    d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, tipo_documento, estatus, entorno, serie, folio, uuid, receptor_rfc, receptor_razon_social, subtotal_cent, iva_cent, total_cent, fecha_timbrado, xml) VALUES (?, ?, 'N-1', 'factura', 'timbrada', 'sandbox', 'F', '1', 'UUID-UNO', 'CCO010101AB1', 'CLIENTE CONTABLE', 100000, 16000, 116000, ?, '<cfdi:Comprobante Folio=\"1\"/>')").run(o.id, qro.id, HOY + ' 10:00:00');
    d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, tipo_documento, estatus, entorno, serie, folio, uuid, subtotal_cent, iva_cent, total_cent, fecha_timbrado, cancelada_at) VALUES (?, ?, 'N-2', 'factura', 'cancelada', 'sandbox', 'F', '2', 'UUID-DOS', 50000, 8000, 58000, ?, ?)").run(o.id, qro.id, HOY + ' 11:00:00', HOY + ' 12:00:00');
    d.close(); }

  console.log('1. Quién la ve');
  revisa((await pedir('GET', '/contabilidad/resumen?mes=' + MES, V))[0] === 403, 'Ventas no la ve');
  revisa((await pedir('GET', '/contabilidad/resumen?mes=' + MES, G))[0] === 200, 'El Gerente sí (de su sucursal)');
  revisa((await pedir('GET', '/contabilidad/resumen?mes=2026-13', C))[0] === 400, 'Un mes imposible se rechaza');
  let [s, r] = await pedir('GET', '/contabilidad/resumen?mes=' + MES, C);
  revisa(s === 200, 'El rol Contador (solo «Contabilidad del mes») sí la ve', r);

  console.log('2. Las cifras');
  revisa(r.ingresos.facturas === 1 && r.ingresos.facturado_subtotal === 1000 && r.ingresos.facturado_iva === 160 && r.ingresos.canceladas === 1, 'Facturado: solo la vigente; la cancelada aparte', r.ingresos);
  revisa(r.ingresos.cobrado === 580 && r.ingresos.por_confirmar === 100 && r.ingresos.cobrado_iva === 80, 'Cobrado solo lo confirmado (580, con IVA 80) y por confirmar aparte (100)', r.ingresos);
  revisa(r.egresos.gastos === 2 && r.egresos.gastos_total === 1740 && r.egresos.gastos_iva === 16240 && r.egresos.gastos_iva_estimado === 80 && r.egresos.pagado === 1160 && r.egresos.pagado_iva === 160, 'Gastos (sin el camión) con el IVA de gastos y compras (80 estimado) y lo pagado con su IVA', r.egresos);
  revisa(r.egresos.no_gasto === 1 && r.egresos.no_gasto_total === 116000, 'La compra del camión va aparte: no es gasto del mes', r.egresos);
  revisa(r.iva.segun_facturas === 160 - 16240 && r.iva.segun_flujo === 80 - 160, 'IVA según facturas (con el IVA del camión, que sí se acredita) y según el dinero (−80)', r.iva);
  revisa(r.pendientes.gastos_sin_xml === 3 && r.pendientes.gastos_iva_estimado === 1 && r.pendientes.cobros_por_confirmar === 1 && r.pendientes.facturas_canceladas === 1, 'Pendientes de comprobar contados', r.pendientes);

  console.log('3. Descargas');
  [s, r] = await pedir('GET', '/contabilidad/excel?mes=' + MES, C);
  revisa(s === 200 && r.facturas.length === 2 && r.cobros.length === 2 && r.gastos.length === 3 && r.pagos.length === 1 && r.gastos.find(x => x.folio === 'G-2').xml === 'Falta', 'El Excel trae facturas, cobros, gastos (también el camión) y pagos del mes', [r.facturas?.length, r.cobros?.length, r.gastos?.length, r.pagos?.length]);
  const d1 = r.gastos.find(x => x.folio === 'G-1'), d2 = r.gastos.find(x => x.folio === 'G-2');
  revisa(d1.status === 'PAGADO' && d1.pagado === 1160 && d1.pendiente === 0 && d1.fecha_pago === HOY && d1.via === 'transferencia' && d1.capturo === 'admin' && d1.categoria !== 'combustible'
    && d2.status === 'PENDIENTE' && d2.pendiente === 580 && d2.vence, 'Los gastos traen las columnas del Excel CXP (status, pagado, pendiente, fecha y vía de pago, capturó, categoría con nombre)', [d1, d2]);
  // Flujo de banco (hoja «BNT»): solo dinero que se movió, en orden, con saldo y su factura.
  const fl = r.flujo;
  revisa(r.saldo_inicial === 0 && fl.length === 2 && fl[0].ingreso === 580 && fl[0].metodo === 'PUE' && /F-1/.test(fl[0].cfdi) && fl[1].egreso === 1160 && fl[1].saldo === 580 - 1160,
    'Flujo de banco: el cobro confirmado (no el por confirmar) y el pago, con saldo corrido y la factura de cada uno', fl);
  revisa(fl[1].clabe === '•••7899' && /•••7899/.test(fl[1].cuenta_tercero) && fl[1].cfdi_monto === 1160 && fl[1].no_deducible === 0 && fl[1].por_comprobar === 0 && fl[1].tipo_gasto !== 'combustible',
    'El contador ve la CLABE tapada; el gasto con factura es deducible y no queda por comprobar', fl[1]);
  revisa((await pedir('GET', '/contabilidad/excel?mes=' + MES, A))[1].flujo[1].clabe === '012180001234567899', 'Dirección (hace pagos) ve la CLABE completa');
  let [s2, , buf, tipo] = await pedir('GET', '/contabilidad/xml?mes=' + MES, C);
  const txt = buf.toString('latin1');
  revisa(s2 === 200 && /x-tar/.test(tipo) && txt.includes('emitidas/F-1_UUID-UNO.xml') && txt.includes('<cfdi:Comprobante Folio="1"/>') && txt.includes('LEEME.txt'), 'Los XML del mes salen en un .tar (emitidas/ y LEEME)', [s2, tipo]);
  revisa((await pedir('GET', '/contabilidad/xml?mes=' + MES, V))[0] === 403, 'Ventas no descarga los XML');
  { const rr = await pedir('POST', '/finanzas/cxp/' + g1.id + '/repetir', C, {}); revisa(rr[0] === 403 || rr[0] === 404, 'El contador solo consulta: no repite gastos (para él ni existe)', [rr[0], rr[2].toString().slice(0, 200)]); }

  console.log('4. Repetir un gasto fijo');
  [s, r] = await pedir('POST', '/finanzas/cxp/' + g1.id + '/repetir', A, {});
  const sig = r;
  revisa(s === 201 && sig.fecha > HOY, 'Dirección lo repite al mes siguiente', r);
  const copia = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.id === sig.id);
  revisa(copia && copia.concepto === 'Diésel' && copia.total === 1160 && copia.saldo === 1160 && !copia.factura_folio, 'La copia queda por pagar, sin folio ni pago', copia);
  [s, r] = await pedir('POST', '/finanzas/cxp/' + g1.id + '/repetir', A, {});
  revisa(s === 409 && r.codigo === 'POSIBLE_DUPLICADO', 'Repetirlo otra vez para el mismo mes pregunta antes (no duplica sin querer)', [s, r]);
  revisa([403, 404].includes((await pedir('POST', '/finanzas/cxp/' + g1.id + '/repetir', V, {}))[0]), 'Ventas no repite gastos');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
