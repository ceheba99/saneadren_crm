// MÓDULO CONTABLE F4 (2026-11-11, aprobado por Dirección): CONCILIACIÓN BANCARIA.
// Se da de alta una cuenta, se sube su estado de cuenta (renglones ya acomodados por la pantalla) y el sistema empareja
// solo lo que coincide con el CRM (misma dirección, mismo monto, hasta 3 días); lo dudoso queda para hacerlo a mano.
// Lo que no está en el CRM se empareja a mano, se registra como gasto (quien mueve dinero) o se marca «no aplica».
// Uso: node tests/simulacion-conciliacion.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-concilia-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Concilia-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Concilia-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9650 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const dma = f => f.split('-').reverse().join('/');

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol Contador');
  const rolCont = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + rolCont + '/permisos', A, { permisos: ['contabilidad.ver'] }), 'permiso del contador');
  const usuario = async (nombre, rol) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }), nombre); const u = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); ID[nombre] = u.id; return u.token; };
  const ID = {};
  const G = await usuario('Gema Gerente', 'gerente'), V = await usuario('Valeria Ventas', 'ventas'), Cm = await usuario('Carlos Compras', 'costos'), C = await usuario('Carmen Contadora', rolCont);
  // Lo del CRM: una orden con cobros y un proveedor con un pago desde la cuenta.
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Banco', telefono: '4425550101', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Planta', canal_id: canal.id, servicio_id: servicio.id, responsable_id: ID['Valeria Ventas'], forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'x', importe: 10000 }]), iva_modo: 'mas_iva', valor: 10000 }), 'cotización');
  { const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(DB); d.prepare("UPDATE leads SET created_at = ?, fecha_cotizacion = ? WHERE id = ?").run(dia(-20) + ' 09:00:00', dia(-20), l.id); d.close(); } // cotización de hace 20 días
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: dia(-10) }), 'orden');
  const cobro = (monto, metodo, fecha, referencia) => pedir('POST', '/leads/' + o.id + '/cobros', A, { monto, metodo, fecha, referencia, forzar: true });
  exigir(await cobro(1160, 'transferencia', dia(-5), 'SPEI 111'), 'cobro 1160');
  exigir(await cobro(500, 'efectivo', dia(-5)), 'cobro en efectivo');
  exigir(await cobro(800, 'transferencia', dia(-2), 'A'), 'cobro 800 A');
  exigir(await cobro(800, 'deposito', dia(-2), 'B'), 'cobro 800 B');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refacciones Banco Ejemplo', categoria: 'otro', dias_credito: 0 }), 'proveedor');
  const banco = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Banco Santander (ejemplo)', categoria: 'comisiones_bancarias', dias_credito: 0 }), 'proveedor banco');
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Refacciones', total: 2320, fecha_documento: dia(-4), dias_credito: 0, tipo_comprobante: 'recibo', ya_pagado: true, metodo: 'transferencia', fecha_pago: dia(-4), cuenta_origen: 'Santander empresa' }), 'gasto pagado');

  console.log('1. Cuentas');
  revisa((await pedir('POST', '/conciliacion/cuentas', V, { nombre: 'Santander empresa', banco: 'Santander', sucursal_id: qro.id }))[0] === 403, 'Ventas no da de alta cuentas');
  revisa((await pedir('POST', '/conciliacion/cuentas', Cm, { nombre: 'Santander empresa', banco: 'Santander', sucursal_id: qro.id }))[0] === 403, 'Compras tampoco (no tiene «Contabilidad del mes»)');
  const cta = exigir(await pedir('POST', '/conciliacion/cuentas', G, { nombre: 'Santander empresa', banco: 'Santander', terminacion: '1234', sucursal_id: qro.id }), 'cuenta');
  revisa((await pedir('POST', '/conciliacion/cuentas', G, { nombre: 'santander EMPRESA', banco: 'Santander', sucursal_id: qro.id }))[0] === 409, 'El mismo nombre dos veces se rechaza');

  console.log('2. Subir el estado de cuenta');
  const filas = [
    { fecha: dma(dia(-4)), concepto: 'SPEI RECIBIDO CLIENTE BANCO', referencia: '111', cargo: '', abono: '1,160.00', saldo: '10,000.00' },
    { fecha: dma(dia(-3)), concepto: 'SPEI ENVIADO REFACCIONES', referencia: '222', cargo: '2,320.00', abono: '', saldo: '7,680.00' },
    { fecha: dma(dia(-3)), concepto: 'COMISION SPEI', referencia: '', cargo: '15.66', abono: '', saldo: '7,664.34' },
    { fecha: dma(dia(-2)), concepto: 'DEPOSITO', referencia: '', cargo: '', abono: '800.00', saldo: '8,464.34' },
    { fecha: dma(dia(-1)), concepto: 'TRASPASO A BANORTE', referencia: '', cargo: '5,000.00', abono: '', saldo: '3,464.34' },
  ];
  revisa((await pedir('POST', '/conciliacion/cargar', V, { cuenta_id: cta.id, filas }))[0] === 403, 'Ventas no sube estados de cuenta');
  let [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas: [...filas, { fecha: '31/02/2026', concepto: 'x', cargo: '1' }] });
  revisa(s === 400 && r.errores?.length === 1, 'Un renglón con fecha imposible: no se guarda nada y dice cuál', r);
  [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas, archivo: 'santander.xlsx', columnas: { fecha: 0, concepto: 1, cargo: 3, abono: 4 } });
  revisa(s === 201 && r.nuevos === 5 && r.emparejados === 2, 'El Contador sube 5 movimientos; se emparejan solos 2 (el cobro de 1,160 y el pago de 2,320)', r);
  r = exigir(await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas }), 'subir otra vez');
  revisa(r.nuevos === 0 && r.repetidos === 5, 'Subir el mismo archivo otra vez no duplica nada', r);
  const MES = dia(-1).slice(0, 7), VER = `/conciliacion?cuenta=${cta.id}&mes=${MES}`;
  let v = exigir(await pedir('GET', VER, C), 'ver');
  const enMes = f => f.slice(0, 7) === MES;
  revisa(v.cuenta.columnas?.fecha === 0, 'Se recuerdan las columnas del archivo para esa cuenta');
  revisa(v.conciliados.length === [dia(-4), dia(-3)].filter(enMes).length && v.conciliados.every(b => b.conciliado.auto), 'Conciliados (solos): el cobro y el pago', v.conciliados.map(b => b.concepto));
  const dep = v.banco_sin_crm.find(b => b.concepto === 'DEPOSITO'), com = v.banco_sin_crm.find(b => /COMISION/.test(b.concepto)), tras = v.banco_sin_crm.find(b => /TRASPASO/.test(b.concepto));
  revisa(!enMes(dia(-2)) || (dep && com && tras), 'En el banco y no en el CRM: el depósito de 800 (hay dos cobros de 800: no adivina), la comisión y el traspaso');
  revisa(!v.crm_sin_banco.some(m => m.monto === 500), 'El cobro en efectivo no se espera en el banco');
  revisa(!enMes(dia(-2)) || v.crm_sin_banco.filter(m => m.monto === 800).length === 2, 'En el CRM y no en el banco: los dos cobros de 800');
  revisa(v.totales.saldo_final_banco === 3464.34, 'Saldo final del banco: el del último renglón', v.totales);

  console.log('2b. Formatos del banco reconocidos solos (Santander y Banorte)');
  { const d8 = n => dia(n).split('-').reverse().join(''), ap = t => `'${t}'`;
    const std = [['Cuenta', 'Fecha', 'Hora', 'Sucursal', 'Descripcion', 'Cargo/Abono', ' Importe ', ' Saldo ', 'Referencia', 'Concepto', 'Banco Participante', 'Clabe Beneficiario', 'Nombre Beneficiario', 'Cta Ordenante', 'Nombre Ordenante', 'Codigo Devolucion', 'Causa Devolucion', 'RFC Beneficiario', 'RFC Ordenante', 'Clave de Rastreo', 'Descripcion Larga'],
      ["'65500005678", ap(d8(-6)), '08:24', "'7465'", 'ABONO TRANSFERENCIA SPEI                ', '+', '9,512.00', '55,996.64', '2128454', 'PAGO FACTURA 10', 'BBVA MEXICO', "'BBVA 680655000000000'", '  ', "'012680000000000001   '", 'DEL CLIENTE EMPAQUES DE EJEMPLO SA DE CV', '', '', 'XAXX010101000', 'EEJ9410117P6', 'CIE-0100261001738653          ', 'ABONO TRANSFERENCIA SPEI'],
      ["'65500005678", ap(d8(-6)), '14:14', "'0981'", 'PAGO TRANSFERENCIA SPEI                 ', '-', '718.4', '55,278.24', '6919813', 'PAPELERIA REF 0000000', 'BBVA MEXICO', "'012420000000000002   '", 'JUAN PEREZ EJEMPLO            ', "'00140327065500005678'", '  ', '', '', '', 'XAXX010101000', '20261001400140BET0000469198130', 'PAGO TRANSFERENCIA SPEI'],
      ["'65500005678", ap(d8(-5)), '16:19', "'0970'", 'I V A  POR COMISION', '-', '139.2', '55,139.04', "'000000000179794", 'OPER ADIC BASIC', '', '', '', '', '', '', '', '', '', '', 'I V A  POR COMISION']];
    const ctaS = exigir(await pedir('POST', '/conciliacion/cuentas', G, { nombre: 'Santander cheques', banco: 'Santander', terminacion: '5678', sucursal_id: qro.id }), 'cuenta Santander');
    [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: ctaS.id, crudo: std, archivo: 'MovimientosCheque.csv', previa: true });
    revisa(s === 200 && r.previa && r.formato?.banco === 'Santander' && r.formato.cuenta === '••5678' && r.leidos === 3 && r.nuevos === 3 && r.abonos === 9512 && r.cargos === 857.6 && r.saldo_final === 55139.04 && r.desde === dia(-6) && r.hasta === dia(-5),
      'Santander: se reconoce solo (fecha pegada, signo aparte) y la vista previa dice movimientos, abonos, cargos y saldo', r);
    revisa((await pedir('GET', '/conciliacion?mes=' + MES + '&cuenta=' + ctaS.id, C))[1].totales.movimientos === 0 && (await pedir('GET', '/conciliacion?mes=' + dia(-6).slice(0, 7) + '&cuenta=' + ctaS.id, C))[1].totales.movimientos === 0, 'La vista previa no guarda nada');
    [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, crudo: std, previa: true });
    revisa(s === 400 && r.codigo === 'OTRA_CUENTA', 'El archivo de una cuenta no se sube en otra (se comparan los últimos 4 dígitos)', r);
    [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: ctaS.id, crudo: std, archivo: 'MovimientosCheque.csv' });
    revisa(s === 201 && r.nuevos === 3, 'Santander: se suben los 3 movimientos', r);
    r = exigir(await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: ctaS.id, crudo: std }), 'subir otra vez Santander');
    revisa(r.nuevos === 0 && r.repetidos === 3, 'Subirlo otra vez no duplica', r);
    { const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(DB), m = d.prepare('SELECT * FROM movimientos_banco WHERE cuenta_id = ? ORDER BY id').all(ctaS.id); d.close();
      revisa(m[0].abono_cent === 951200 && m[0].contraparte === 'EMPAQUES DE EJEMPLO SA DE CV' && m[0].contraparte_rfc === 'EEJ9410117P6' && m[0].rastreo === 'CIE-0100261001738653' && m[0].hora === '08:24' && m[0].fecha === dia(-6),
        'Un abono guarda quién pagó (sin «DEL CLIENTE»), su RFC, el rastreo y la hora', m[0]);
      revisa(m[1].cargo_cent === 71840 && m[1].contraparte === 'JUAN PEREZ EJEMPLO' && m[1].contraparte_rfc === null && /PAPELERIA/.test(m[1].concepto), 'Un cargo guarda al beneficiario y el concepto que se escribió al pagar', m[1]); }
    const bnt = [['CUENTA', 'FECHA DE OPERACIÓN', 'FECHA', 'REFERENCIA', 'DESCRIPCIÓN', 'COD. TRANSAC', 'SUCURSAL', 'DEPÓSITOS', 'RETIROS', 'SALDO', 'MONEDA', 'MOVIMIENTO', 'DESCRIPCIÓN DETALLADA', 'CHEQUE'],
      ["'1300009765", dma(dia(-6)), dma(dia(-6)), '-', 'SPEI 01102026', '3', '5663', '$0.02', '-', '$35,966.97', 'MXP', '562', 'COMPENSACION DESFASE SPEI, RASTREO :, 8846APR1202609305833408513', '-'],
      ["'1300009765", dma(dia(-5)), dma(dia(-5)), '0', '036INBU16102026305101570', '3', '5663', '$544,040.00', '-', '$580,006.97', 'MXP', '563', 'SPEI RECIBIDO, BCO:0036 INBURSA             HR LIQ: 13:44:19, DEL CLIENTE AGUAS DE EJEMPLO DEL VALLE, S.A., DE LA CLABE 036180500000000001   CON RFC AEV100104SUA, CONCEPTO: ODS MES 491, REFERENCIA: 0009770 CVE RAST: 036INBU16102026305101570', '-'],
      ["'1300009765", dma(dia(-5)), dma(dia(-5)), '1610', 'COMPRA ORDEN DE PAGO SPEI', '511', '8846', '-', '$500,000.00', '$80,006.97', 'MXP', '564', '=REFERENCIA  CTA/CLABE: 014680655000000000, BEM SPEI, BCO:014 BENEF:SANEADREN QUERETAR (DATO NO VERIFICADO, POR ESTA INSTITUCION), TRASPASO, CVE RASTREO: 8846APR2202610165900007009 RFC: SAN1211168C3, IVA: 000000000000.00 SANTANDER           HORA LIQ: 16:23:24', '-'],
      ["'1300009765", dma(dia(-4)), dma(dia(-4)), '0', 'INTERESES EXENTO TASA092039404', '3', '5663', '-', '$30,187.36', '$49,819.61', 'MXP', '565', '-', '-']];
    const ctaB = exigir(await pedir('POST', '/conciliacion/cuentas', G, { nombre: 'Banorte cheques', banco: 'Banorte', terminacion: '9765', sucursal_id: qro.id }), 'cuenta Banorte');
    [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: ctaB.id, crudo: bnt, archivo: 'Cuentas de Cheques.csv' });
    revisa(s === 201 && r.formato?.banco === 'Banorte' && r.nuevos === 4, 'Banorte: se reconoce solo y se suben los 4 movimientos', r);
    { const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(DB), m = d.prepare('SELECT * FROM movimientos_banco WHERE cuenta_id = ? ORDER BY id').all(ctaB.id); d.close();
      revisa(m[0].abono_cent === 2 && m[0].referencia === null && m[0].rastreo === '8846APR1202609305833408513', 'Banorte: «-» es vacío y dos centavos son dos centavos', m[0]);
      revisa(m[1].abono_cent === 54404000 && m[1].contraparte === 'AGUAS DE EJEMPLO DEL VALLE, S.A.' && m[1].contraparte_rfc === 'AEV100104SUA' && m[1].rastreo === '036INBU16102026305101570' && m[1].saldo_cent === 58000697, 'Banorte: del detalle salen el cliente, su RFC y el rastreo', m[1]);
      revisa(m[2].cargo_cent === 50000000 && m[2].contraparte === 'SANEADREN QUERETAR' && m[2].contraparte_rfc === 'SAN1211168C3' && m[2].hora === '16:23', 'Banorte: un SPEI enviado guarda al beneficiario, su RFC y la hora', m[2]);
      revisa(m[3].cargo_cent === 3018736 && !m[3].contraparte && !m[3].detalle, 'Banorte: un cargo sin detalle (intereses) entra con su concepto', m[3]); }
    [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: ctaB.id, crudo: [['Dia', 'Texto', 'Monto'], ['01/10/2026', 'algo', '5']], previa: true });
    revisa(s === 422 && r.codigo === 'FORMATO_DESCONOCIDO', 'Un archivo de otro formato no se adivina: la pantalla pregunta las columnas', r);
    revisa((await pedir('POST', '/conciliacion/cargar', V, { cuenta_id: ctaB.id, crudo: bnt }))[0] === 403, 'Ventas tampoco sube un archivo reconocido'); }

  console.log('2c. Traspasos entre cuentas propias y propuesta de gasto');
  { const cuentas = (await pedir('GET', '/conciliacion?mes=' + MES, C))[1].cuentas, ctaS = cuentas.find(c => c.nombre === 'Santander cheques'), ctaB = cuentas.find(c => c.nombre === 'Banorte cheques');
    const ver = async (c, f) => (await pedir('GET', `/conciliacion?cuenta=${c.id}&mes=${f.slice(0, 7)}`, C))[1];
    // El SPEI de 500,000 que salió de Banorte (arriba) llega a Santander con la MISMA clave de rastreo: se ligan solos.
    const d8 = n => dia(n).split('-').reverse().join('');
    const enc = ['Cuenta', 'Fecha', 'Hora', 'Sucursal', 'Descripcion', 'Cargo/Abono', ' Importe ', ' Saldo ', 'Referencia', 'Concepto', 'Banco Participante', 'Clabe Beneficiario', 'Nombre Beneficiario', 'Cta Ordenante', 'Nombre Ordenante', 'Codigo Devolucion', 'Causa Devolucion', 'RFC Beneficiario', 'RFC Ordenante', 'Clave de Rastreo', 'Descripcion Larga'];
    const std2 = [enc,
      ["'65500005678", `'${d8(-5)}'`, '16:23', "'7465'", 'ABONO TRANSFERENCIA SPEI', '+', '500,000.00', '555,139.04', '4600184', 'TRASPASO', 'BANORTE', "'BANORTE 680655000000000'", '', "'072680010000000001'", 'DEL CLIENTE SANEADREN SA DE CV', '', '', 'SAN1211168C3', 'SAN1211168C3', '8846APR2202610165900007009', 'ABONO TRANSFERENCIA SPEI'],
      ["'65500005678", `'${d8(-4)}'`, '10:00', "'0981'", 'ABONO TRANSFERENCIA ENLACE', '+', '30,187.36', '585,326.40', '184065A531', 'TRASPASO KFC', '', '', '', "'01418065500000000001'", 'SANEADREN SA DE CV', '', '', '', 'SAN1211168C3', '', 'ABONO TRANSFERENCIA ENLACE'],
      ["'65500005678", `'${d8(-4)}'`, '13:51', "'0981'", 'CGO IMPTO FED TRANSF ELECT', '-', '15,675.00', '569,651.40', '500488Z071', "'04266Z5L510051220495", '', '', '', '', '', '', '', '', '', '', 'CGO IMPTO FED TRANSF ELECT'],
      ["'65500005678", `'${d8(-3)}'`, '13:57', "'0981'", 'CGO IMPTO FED TRANSF ELECT', '-', '15,590.00', '554,061.40', '530635Z298', "'04266Z5N200051220480", '', '', '', '', '', '', '', '', '', '', 'CGO IMPTO FED TRANSF ELECT']];
    [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: ctaS.id, crudo: std2, archivo: 'MovimientosCheque-2.csv' });
    revisa(s === 201 && r.nuevos === 4 && r.traspasos === 1, 'Al subir Santander, el traspaso que viene de Banorte (misma clave de rastreo) se liga solo', r);
    let vS = await ver(ctaS, dia(-5)), vB = await ver(ctaB, dia(-5));
    revisa(vS.traspasos.length === 1 && vS.traspasos[0].abono === 500000 && vS.traspasos[0].traspaso.con_pareja && vS.traspasos[0].traspaso.auto && /Traspaso de Banorte cheques/.test(vS.traspasos[0].traspaso.texto), 'En Santander queda como «Traspaso de Banorte cheques»', vS.traspasos);
    revisa(vB.traspasos.length === 1 && vB.traspasos[0].cargo === 500000 && /Traspaso a Santander cheques/.test(vB.traspasos[0].traspaso.texto) && !vB.banco_sin_crm.some(b => b.cargo === 500000), 'En Banorte queda como «Traspaso a Santander cheques» y ya no está pendiente', vB.traspasos);
    // En el Flujo de banco: un egreso en Banorte y un ingreso en Santander, con folio, sin contar como gasto.
    { const fl = async c => (await pedir('GET', `/contabilidad/flujo?mes=${dia(-5).slice(0, 7)}&sucursal=${qro.id}&cuenta=${c.id}`, C))[1].flujo.filter(f => /^Traspaso (a|de) /.test(f.concepto_banco));
      const fS = await fl(ctaS), fB = await fl(ctaB);
      revisa(fS.length === 1 && fS[0].ingreso === 500000 && fS[0].egreso === 0 && fS[0].por_comprobar === 0 && fB.length === 1 && fB[0].egreso === 500000 && fB[0].por_comprobar === 0, 'El Flujo de banco de cada cuenta trae su lado del traspaso, sin nada por comprobar', [fS, fB]);
      const g = (await pedir('GET', '/contabilidad/resumen?mes=' + dia(-5).slice(0, 7), C))[1];
      revisa(g.egresos.gastos_total < 100000, 'El traspaso no cuenta como gasto del mes', g.egresos);
      const idMov = Number(fS[0].ref.split(':')[1]);
      [s, r] = await pedir('POST', '/contabilidad/flujo/movimientos/' + idMov + '/cancelar', C, { motivo: 'Probar que no se cancela aquí' });
      revisa(s === 409 && /conciliación/.test(r.error), 'Ese traspaso no se cancela desde el Flujo: se suelta en la conciliación', r); }
    // A mano: los intereses de 30,187.36 que salieron de Banorte NO son traspaso del abono de 30,187.36 de Santander (sin rastreo): no se ligan solos…
    const bInt = vB.banco_sin_crm.find(b => b.cargo === 30187.36), sAb = (await ver(ctaS, dia(-4))).banco_sin_crm.find(b => b.abono === 30187.36);
    revisa(!!bInt && !!sAb, 'Mismo monto en dos cuentas pero sin clave de rastreo: no se liga solo', [bInt, sAb]);
    r = (await pedir('GET', '/conciliacion/movimientos/' + sAb.id + '/candidatos', C))[1];
    revisa(r.traspasos.length === 1 && r.traspasos[0].id === bInt.id && r.traspasos[0].cuenta === 'Banorte cheques', '…pero al pedir «Traspaso» sí se ofrece como posible pareja', r.traspasos);
    revisa((await pedir('POST', '/conciliacion/movimientos/' + sAb.id + '/traspaso', V, { con: bInt.id }))[0] === 403, 'Ventas no liga traspasos');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + sAb.id + '/traspaso', C, { con: sAb.id }))[0] === 400, 'Un movimiento no es traspaso de sí mismo');
    [s, r] = await pedir('POST', '/conciliacion/movimientos/' + sAb.id + '/traspaso', C, { con: bInt.id });
    revisa(s === 201 && (await ver(ctaB, dia(-4))).traspasos.some(b => b.id === bInt.id && !b.traspaso.auto), 'El Contador liga a mano la pareja', r);
    revisa((await pedir('POST', '/conciliacion/movimientos/' + bInt.id + '/no-aplica', C, { motivo: 'ya es traspaso' }))[0] === 409, 'Lo ligado como traspaso ya no se marca «no aplica»');
    [s, r] = await pedir('POST', '/conciliacion/movimientos/' + bInt.id + '/soltar', C, {});
    vS = await ver(ctaS, dia(-4)); vB = await ver(ctaB, dia(-4));
    revisa(s === 200 && vS.banco_sin_crm.some(b => b.id === sAb.id) && vB.banco_sin_crm.some(b => b.id === bInt.id), 'Soltar un lado suelta los dos: vuelven a quedar pendientes', [vS.traspasos, vB.traspasos]);
    { const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(DB), m = d.prepare("SELECT cancelado, motivo_cancelacion FROM flujo_movimientos WHERE monto_cent = 3018736").all(); d.close();
      revisa(m.length === 2 && m.every(x => x.cancelado === 1 && /soltó/.test(x.motivo_cancelacion)), 'Sus movimientos del flujo quedan cancelados con motivo (no se borran)', m); }
    // Solo este lado: el abono viene de otra cuenta de la empresa que no está dada de alta.
    [s, r] = await pedir('POST', '/conciliacion/movimientos/' + sAb.id + '/traspaso', C, { con: null });
    revisa(s === 201 && (await ver(ctaS, dia(-4))).traspasos.some(b => b.id === sAb.id && !b.traspaso.con_pareja), 'Traspaso de una cuenta que no está aquí: se marca solo este lado', r);
    // Propuesta: el primer «CGO IMPTO FED» se registra como gasto del SAT; el segundo ya viene propuesto.
    const sat = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'SAT (ejemplo)', categoria: 'impuestos', dias_credito: 0 }), 'proveedor SAT');
    const imp = (await ver(ctaS, dia(-4))).banco_sin_crm.filter(b => /CGO IMPTO FED/.test(b.concepto)).concat((await ver(ctaS, dia(-3))).banco_sin_crm.filter(b => /CGO IMPTO FED/.test(b.concepto))).filter((b, i, a) => a.findIndex(x => x.id === b.id) === i);
    revisa(imp.length === 2 && (await pedir('GET', '/conciliacion/movimientos/' + imp[0].id + '/candidatos', A))[1].propuesta === null, 'Sin historia no hay propuesta', imp);
    exigir(await pedir('POST', '/conciliacion/movimientos/' + imp[0].id + '/gasto', A, { proveedor_id: sat.id, categoria: 'impuestos', concepto: 'Impuestos federales' }), 'gasto SAT');
    r = (await pedir('GET', '/conciliacion/movimientos/' + imp[1].id + '/candidatos', A))[1].propuesta;
    revisa(r && r.proveedor_id === sat.id && r.categoria === 'impuestos' && r.concepto === 'Impuestos federales' && r.veces === 1, 'El siguiente cargo igual ya propone proveedor, categoría y concepto', r); }

  console.log('3. A mano');
  if (dep) {
    const cand = exigir(await pedir('GET', '/conciliacion/movimientos/' + dep.id + '/candidatos', C), 'candidatos').candidatos;
    revisa(cand.length === 2 && cand.every(c => c.monto === 800), 'Para el depósito de 800 hay dos candidatos');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/emparejar', C, { tipo: 'pago', id: 1 }))[0] >= 400, 'Emparejar con algo de otra dirección o monto se rechaza');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/emparejar', C, { tipo: cand[1].tipo, id: cand[1].id }))[0] === 200, 'El Contador elige el cobro B a mano');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/emparejar', C, { tipo: cand[0].tipo, id: cand[0].id }))[0] === 409, 'Un movimiento del banco no se concilia dos veces');
  }
  revisa((await pedir('POST', '/conciliacion/movimientos/' + tras.id + '/no-aplica', C, { motivo: 'no' }))[0] === 400, '«No aplica» sin motivo se rechaza');
  revisa((await pedir('POST', '/conciliacion/movimientos/' + tras.id + '/no-aplica', C, { motivo: 'Traspaso entre cuentas propias' }))[0] === 200, 'El traspaso se marca «no aplica» con motivo');
  revisa((await pedir('POST', '/conciliacion/movimientos/' + com.id + '/gasto', C, { proveedor_id: banco.id, categoria: 'comisiones_bancarias', concepto: 'Comisión SPEI' }))[0] === 403, 'El Contador (no mueve dinero) no registra el gasto');
  if (dep) revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/gasto', G, { proveedor_id: banco.id }))[0] === 409, 'Un abono ya conciliado no se registra como gasto');
  [s, r] = await pedir('POST', '/conciliacion/movimientos/' + com.id + '/gasto', G, { proveedor_id: banco.id, categoria: 'comisiones_bancarias', concepto: 'Comisión SPEI' });
  revisa(s === 201 && r.cxp_id, 'El Gerente registra la comisión como gasto', r);
  { const x = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(c => c.id === r.cxp_id);
    revisa(x && x.categoria === 'comisiones_bancarias' && Math.abs(x.total - 15.66) < 0.001 && x.saldo === 0, 'Queda en Cuentas por pagar como comisión bancaria de $15.66, ya pagada', x && { c: x.categoria, t: x.total, s: x.saldo }); }
  v = exigir(await pedir('GET', VER, C), 'ver');
  revisa(v.banco_sin_crm.length === 0 && v.no_aplica.length === (enMes(dia(-1)) ? 1 : 0), 'Ya no queda nada del banco sin explicar', v.banco_sin_crm.map(b => b.concepto));
  revisa(!enMes(dia(-2)) || (v.crm_sin_banco.length === 1 && v.crm_sin_banco[0].monto === 800), 'Del CRM solo queda el cobro A de 800 (no pasó por este banco)', v.crm_sin_banco);

  console.log('4. Soltar e integridad');
  const conc = v.conciliados.find(b => b.abono === 1160);
  if (conc) {
    // Si se cancela el cobro ya conciliado, la revisión de integridad lo marca.
    const k = (await pedir('GET', '/leads/' + o.id + '/cobros', A))[1].cobros.find(x => x.monto === 1160);
    exigir(await pedir('POST', '/finanzas/cobros/' + k.id + '/cancelar', A, { motivo: 'Cobro duplicado de prueba' }), 'cancelar cobro');
    let integ = (await pedir('GET', '/admin/integridad', A))[1];
    revisa((integ.resultados || []).some(x => /conciliado con algo del CRM que ya se canceló/.test(x.titulo) && x.total === 1), 'La integridad avisa: un movimiento conciliado con un cobro cancelado');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + conc.id + '/soltar', C, {}))[0] === 200, 'Se suelta');
    integ = (await pedir('GET', '/admin/integridad', A))[1];
    revisa(integ.errores === 0, 'Después de soltarlo, la integridad sigue sin errores', (integ.resultados || []).filter(x => x.gravedad === 'error' && x.total).map(x => x.titulo));
  }
  { const [sa, ra] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas: [{ fecha: dia(-1), concepto: 'Con importe con signo', importe: '-1,250.50' }] });
    revisa(sa === 201 && ra.nuevos === 1, 'También entiende una sola columna de importe con signo (negativo = cargo)', ra); }
  revisa((await pedir('GET', VER, V))[0] === 403, 'Ventas no ve la conciliación');
  revisa(!/TypeError|SqliteError|Error no manejado/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(x => /Error/.test(x)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
