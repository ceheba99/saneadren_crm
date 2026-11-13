// EDITAR CONTABILIDAD · parte 2 (2026-11-12): el Flujo de banco tal cual el Excel «flujo banco» de Dirección.
//  · A, B y C son marcas S / FALTA / NA (DOMICILIADO o LAYOUT en A); K es el número seguido de las salidas; la nómina va
//    con CN01 y «ANEXO NOMINA CFDI»; el proyecto sale de la orden (o la sucursal).
//  · Cada renglón va a una cuenta de banco: la del estado de cuenta si ya se concilió; si no, la escrita como cuenta de
//    salida (nombre, terminación o banco); si no, «Sin cuenta». Se puede ver el flujo de una sola cuenta.
//  · Saldo inicial por cuenta y encadenado: el último escrito más lo que se movió desde entonces.
// Uso: node tests/simulacion-contabilidad-flujo-formato.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-flujo-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Flujo-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Flujo-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9550 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), MES = HOY.slice(0, 7);
const [ay, am] = MES.split('-').map(Number), MP = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, '0')}`;

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol');
  const rC = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + rC + '/permisos', A, { permisos: ['contabilidad.ver'] }), 'permisos');
  const usuario = async (nombre, r) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol: r, sucursales: [qro.id] }), nombre); return exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); };
  const C = (await usuario('Carmen Contadora', rC)).token, vU = await usuario('Valeria Ventas', 'ventas'), V = vU.token;

  // Dos cuentas de banco (Conciliación) y los movimientos.
  const santander = exigir(await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Santander operación', banco: 'Santander', terminacion: '1234', sucursal_id: qro.id }), 'cuenta Santander');
  const banorte = exigir(await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Banorte pagos', banco: 'Banorte', terminacion: '9876', sucursal_id: qro.id }), 'cuenta Banorte');
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Flujo', telefono: '4425559922', canal_origen_id: canal.id }), 'cliente');
  const orden = async (modo, importe) => {
    const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Patio', canal_id: canal.id, servicio_id: servicio.id, responsable_id: vU.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Desazolve', importe }]), iva_modo: modo, valor: importe, fecha_cotizacion: MP + '-01' }), 'cotización');
    return exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'orden');
  };
  const oIva = await orden('mas_iva', 1000), oSin = await orden('sin_iva', 500);
  exigir(await pedir('POST', '/leads/' + oIva.id + '/cobros', A, { monto: 580, metodo: 'transferencia', referencia: 'SPEI 777' }), 'cobro con referencia');
  exigir(await pedir('POST', '/leads/' + oSin.id + '/cobros', A, { monto: 321.5, metodo: 'transferencia' }), 'cobro sin referencia');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Combustibles Flujo', categoria: 'combustible', dias_credito: 0 }), 'proveedor');
  const gasto = async (extra, que) => exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', total: 100, fecha_documento: HOY, dias_credito: 0, ya_pagado: true, metodo: 'transferencia', ...extra }), que);
  await gasto({ concepto: 'Diésel con factura', total: 1160, iva: 160, tipo_comprobante: 'factura', factura_folio: 'D-1', referencia: 'R-1', cuenta_origen: 'Santander operación' }, 'pago con factura');
  await gasto({ concepto: 'Crédito de la camioneta', total: 2000, tipo_comprobante: 'recibo', metodo: 'domiciliado', cuenta_origen: 'BNT 9876' }, 'pago domiciliado');
  await gasto({ concepto: 'Casetas sin factura', total: 150, tipo_comprobante: 'sin_factura', metodo: 'efectivo' }, 'pago sin cuenta');
  await gasto({ concepto: 'Nómina semana 45', categoria: 'nomina_eventual', total: 4300, tipo_comprobante: 'nomina', referencia: 'LAY-45', cuenta_origen: 'santander' }, 'pago de nómina');
  // El estado de cuenta de Banorte trae el cobro sin referencia: se empareja solo y el cobro queda en Banorte.
  exigir(await pedir('POST', '/conciliacion/cargar', A, { cuenta_id: banorte.id, filas: [{ fecha: HOY, concepto: 'Depósito cliente', cargo: '', abono: '321.50' }] }), 'estado de cuenta');

  console.log('1. Las columnas como el Excel');
  let [s, r] = await pedir('GET', '/contabilidad/excel?mes=' + MES, C);
  const fl = r.flujo || [], por = t => fl.find(f => f.concepto === t || f.concepto_banco === t);
  const cIva = fl.find(f => f.ingreso === 580), cSin = fl.find(f => f.ingreso === 321.5), pFac = por('Diésel con factura'), pDom = por('Crédito de la camioneta'), pEfe = por('Casetas sin factura'), pNom = por('Nómina semana 45');
  revisa(s === 200 && fl.length === 6, 'Salen los 2 cobros y los 4 pagos', fl.map(f => [f.concepto, f.ingreso, f.egreso]));
  revisa(cIva?.marca_transf === 'S' && cIva.marca_oc === 'NA' && cIva.marca_comp === 'FALTA', 'Cobro con referencia y con IVA sin factura: A = S, B = NA, C = FALTA', cIva);
  revisa(cSin?.marca_transf === 'S' && cSin.marca_comp === 'NA', 'Cobro sin referencia pero ya en el estado de cuenta: A = S; sin IVA, C = NA', cSin);
  revisa(pFac?.marca_transf === 'S' && pFac.marca_oc === 'FALTA' && pFac.marca_comp === 'FALTA' && pFac.metodo === 'PUE', 'Pago con factura sin XML ni orden de compra: A = S, B = FALTA, C = FALTA, PUE', pFac);
  revisa(pDom?.marca_transf === 'DOMICILIADO' && pDom.marca_oc === 'NA' && pDom.marca_comp === 'S' && pDom.metodo === 'NO APLICA', 'Pago domiciliado con recibo: A = DOMICILIADO, B = NA, C = S', pDom);
  revisa(pEfe?.marca_transf === 'FALTA' && pEfe.marca_comp === 'NA', 'Pago sin referencia y «sin factura»: A = FALTA, C = NA', pEfe);
  revisa(pNom?.metodo === 'CN01' && pNom.cfdi === 'ANEXO NOMINA CFDI' && pNom.cuenta_abono === 'NOMINA' && pNom.marca_oc === 'NA' && pNom.no_deducible === 0, 'Nómina: CN01, «ANEXO NOMINA CFDI», cuenta abono NOMINA, no cuenta como no deducible', pNom);
  const salidas = fl.filter(f => f.egreso > 0).map(f => f.consecutivo);
  // K es el folio de banco (parte 5, ver simulacion-contabilidad-folios): aquí las cuentas no tienen clave, así que no hay folio y se avisa.
  revisa(fl.every(f => f.consecutivo === '—' && /Sin folio/.test(f.revisar)), 'K: sin clave de folio en las cuentas, dice «—» y «revisar» avisa «Sin folio»', fl.map(f => [f.consecutivo, f.revisar]));
  revisa(fl.every(f => f.proyecto === qro.clave) && /ref\. R-1/.test(pFac.datos_sistema) && /Transferencia/.test(pFac.datos_sistema), 'Proyecto = sucursal cuando la orden no trae proyecto; la vía y la referencia van en «Datos del sistema»', [fl.map(f => f.proyecto), pFac?.datos_sistema]);

  console.log('2. Cada renglón en su cuenta');
  revisa(pFac?.cuenta === 'Santander operación' && pNom?.cuenta === 'Santander operación', 'La cuenta escrita por nombre (y solo «santander») va a Santander', [pFac?.cuenta, pNom?.cuenta]);
  revisa(pDom?.cuenta === 'Banorte pagos' && cSin?.cuenta === 'Banorte pagos', 'Por terminación («BNT 9876») y por el estado de cuenta conciliado van a Banorte', [pDom?.cuenta, cSin?.cuenta]);
  revisa(cIva?.cuenta === 'Sin cuenta' && pEfe?.cuenta === 'Sin cuenta', 'Lo que no se sabe de qué cuenta salió queda «Sin cuenta»', [cIva?.cuenta, pEfe?.cuenta]);
  const cs = Object.fromEntries((r.cuentas || []).map(c => [c.nombre, c.movimientos]));
  revisa(cs['Santander operación'] === 2 && cs['Banorte pagos'] === 2 && cs['Sin cuenta'] === 2, 'El selector dice cuántos movimientos tiene cada cuenta', r.cuentas);
  [s, r] = await pedir('GET', `/contabilidad/flujo?mes=${MES}&cuenta=${santander.id}`, C);
  revisa(s === 200 && r.flujo.length === 2, 'El flujo de Santander solo trae sus movimientos', r.flujo?.map(f => f.concepto));
  [s, r] = await pedir('GET', `/contabilidad/flujo?mes=${MES}&cuenta=0`, C);
  revisa(s === 200 && r.flujo.length === 2, '«Sin cuenta» trae lo que no tiene cuenta', r.flujo?.length);
  revisa((await pedir('GET', '/contabilidad/flujo?mes=' + MES, V))[0] === 403, 'Ventas no ve el flujo');

  console.log('3. Saldo inicial por cuenta y encadenado');
  revisa((await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MP, sucursal: qro.id, saldo: '1000' }))[0] === 400, 'Con cuentas de banco hay que decir de cuál es el saldo');
  revisa((await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MP, sucursal: qro.id, cuenta: 99999, saldo: '1000' }))[0] === 404, 'Una cuenta que no existe se rechaza');
  [s, r] = await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MP, sucursal: qro.id, cuenta: santander.id, saldo: '10000' });
  revisa(s === 200 && r.saldo === 10000 && r.cuenta === 'Santander operación', 'El Contador escribe el saldo de Santander del mes pasado', r);
  // Un pago de Santander en el mes pasado: el saldo de este mes arranca de 10,000 − 600.
  await gasto({ concepto: 'Refacción del mes pasado', total: 600, tipo_comprobante: 'recibo', fecha_documento: MP + '-15', fecha_pago: MP + '-15', cuenta_origen: 'Santander operación' }, 'pago del mes pasado');
  [s, r] = await pedir('GET', `/contabilidad/flujo?mes=${MES}&sucursal=${qro.id}&cuenta=${santander.id}`, C);
  const fin = r.flujo?.length ? r.flujo[r.flujo.length - 1].saldo : null;
  revisa(s === 200 && r.saldo_inicial === 9400 && r.saldos_iniciales?.[0]?.viene_de === MP && r.saldos_iniciales[0].escrito === false && fin === 9400 - 1160 - 4300, 'Este mes Santander arranca en 9,400 (lo escrito el mes pasado − lo que salió) y corre el saldo', { ini: r.saldo_inicial, si: r.saldos_iniciales, fin });
  [s, r] = await pedir('GET', `/contabilidad/flujo?mes=${MES}&sucursal=${qro.id}&cuenta=${banorte.id}`, C);
  revisa(s === 200 && r.saldo_inicial === 0, 'Banorte no se mezcla con Santander (arranca en 0)', r.saldo_inicial);
  [s, r] = await pedir('GET', `/contabilidad/excel?mes=${MES}&sucursal=${qro.id}`, C);
  revisa(s === 200 && r.saldo_inicial === 9400 && r.saldos_iniciales.length >= 3, 'Con todas las cuentas, el saldo inicial es la suma de cada una', { ini: r.saldo_inicial, n: r.saldos_iniciales?.length });
  [s, r] = await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MES, sucursal: qro.id, cuenta: santander.id, saldo: '9500.25' });
  revisa(s === 200 && r.saldo === 9500.25 && r.escrito && r.historial[0].usuario === 'Carmen Contadora', 'Si el banco dice otra cosa, se escribe el de este mes y manda ese', r);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); console.log(salida.slice(-1500)); srv.kill(); process.exit(1); });
