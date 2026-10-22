// Uso: node tests/simulacion-dinero.cjs   (base temporal; no toca saneadren.db)
// Simulación integral de punta a punta en busca de errores (base nueva, servidor real).
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-integral-')); const PUERTO = String(3900 + Math.floor(Math.random() * 400));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Integral-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'i.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0, malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const sumarDias = (f, d) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A); // esta prueba es de cobros y cuentas, no de «qué ve cada rol»
  const servicios = (await pedir('GET', '/servicios', A))[1], canales = (await pedir('GET', '/canales', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  // Usuario de ventas (sus pagos quedan por confirmar).
  let [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Vendedor Sim', correo: 'ventas.sim@saneadren.com.mx', password: 'Ventas-Sim-2026', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.sim@saneadren.com.mx', password: 'Ventas-Sim-2026' }))[1].token;
  const partida = (precio, cantidad = 1, sv = 0) => ({ servicio: servicios[sv].nombre, leyenda: 'Servicio ' + servicios[sv].nombre, importe: precio, cantidad, precio });
  const P = (...p) => JSON.stringify(p);
  const cartera = async () => (await pedir('GET', '/finanzas/cartera?filtro=todas', A))[1];
  const enCartera = async id => (await cartera()).find(c => c.lead_id === id);
  const cuenta = async id => (await pedir('GET', '/leads/' + id + '/cobros', A))[1].cuenta;
  const lead = async id => (await pedir('GET', '/leads/' + id, A))[1];
  const resumen = async () => (await pedir('GET', '/finanzas/resumen', A))[1];

  sec('1. Contactos');
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Hotel Real', telefono: '442-555-0001', direccion: 'Av. 5 de Febrero 10', canal_origen_id: canales[0].id, empresa_contacto: 'Hotel Real SA', rfc: 'HRE010101AB1' });
  revisa(s === 201, 'alta de contacto con teléfono con guiones y RFC', j); const C1 = j.id;
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Duplicado', telefono: '4425550001', direccion: 'x', canal_origen_id: canales[0].id });
  revisa(s === 409 || s === 400, 'teléfono repetido se rechaza', [s, j]);
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'RFC malo', telefono: '4425550002', direccion: 'x', canal_origen_id: canales[0].id, rfc: 'XX' });
  revisa(s === 400, 'RFC inválido se rechaza', [s, j]);
  [s, j] = await pedir('POST', '/contactos', A, { nombre: '', telefono: '4425550003', direccion: 'x', canal_origen_id: canales[0].id });
  revisa(s === 400, 'contacto sin nombre se rechaza', [s, j]);
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Taller Gómez', telefono: '4425550004', direccion: 'Calle 2', canal_origen_id: canales[0].id });
  const C2 = j.id;
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Plaza Sur', telefono: '4425550005', direccion: 'Calle 3', canal_origen_id: canales[0].id });
  const C3 = j.id;
  [s] = await pedir('PUT', '/finanzas/clientes/' + C1 + '/credito', A, { dias_credito: 30 });
  revisa(s === 200, 'crédito de 30 días al cliente');

  const alta = (cliente, cuerpo, t = A) => pedir('POST', '/leads', t, { cliente_id: cliente, direccion: 'Ubicación de prueba', responsable_id: yo, forzar_duplicado: true, iva_modo: 'mas_iva', ...cuerpo });

  sec('2. Cotización → orden, con extras');
  [s, j] = await alta(C1, { partidas_json: P(partida(10000)), notas_cotizacion: 'Anticipo 50 %', fecha_cotizacion: sumarDias(HOY, -3) });
  const cot = j; revisa(s === 201 && j.etapa === 2 && j.iva_cent === 160000, 'cotización $10,000 + IVA en "Cotización enviada"', j);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, A, { version: cot.version, estatus: 'ganado', fecha_servicio: sumarDias(HOY, 5) });
  revisa(s === 200 && j.dias_credito === 30, 'convertir en orden copia el crédito del cliente (30 días)', { s, dias: j.dias_credito, err: j.error });
  const ord1 = await lead(cot.id);
  // Anticipo de 50 % antes de realizar el servicio
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 5800, metodo: 'transferencia', referencia: 'SPEI 1' });
  const cobroAnt = j.id;
  revisa(s === 201, 'anticipo de $5,800 (50 %) antes de realizar', j);
  let k = (await pedir('GET', '/leads/' + ord1.id + '/cobros', A))[1];
  revisa(k.cobros[0]?.tipo === 'anticipo', 'se registra como "anticipo" porque el servicio es futuro', k.cobros[0]);
  let cc = await enCartera(ord1.id);
  revisa(cc && cc.programada && cc.saldo === 5800, 'orden programada con anticipo: saldo $5,800 (aún no se cobra)', cc);
  let rs = await resumen();
  revisa(rs.por_cobrar === 0 && rs.programado === 5800, 'resumen: nada "te deben" todavía; $5,800 por realizar', rs);
  // Extra: se agrega un servicio adicional a la orden
  [s, j] = await pedir('PUT', '/leads/' + ord1.id, A, { version: (await lead(ord1.id)).version, partidas_json: P(partida(10000), partida(2000, 1, 1)), iva_modo: 'mas_iva' });
  revisa(s === 200 && j.valor === 12000 && j.iva_cent === 192000, 'agregar servicio extra de $2,000 a la orden', [s, j.valor, j.iva_cent, j.error]);
  cc = await cuenta(ord1.id);
  revisa(cc.total === 13920 && cc.saldo === 8120, 'el saldo sube con el extra ($13,920 − $5,800 = $8,120)', cc);
  // Quitar servicios dejando el total por debajo de lo cobrado
  [s, j] = await pedir('PUT', '/leads/' + ord1.id, A, { version: (await lead(ord1.id)).version, partidas_json: P(partida(3000)), iva_modo: 'mas_iva' });
  revisa(s === 400, 'no se puede bajar el total de la orden por debajo de lo ya cobrado ($3,480 < $5,800)', [s, j.error, j.valor]);
  if (s === 200) await pedir('PUT', '/leads/' + ord1.id, A, { version: (await lead(ord1.id)).version, partidas_json: P(partida(10000), partida(2000, 1, 1)), iva_modo: 'mas_iva' });

  sec('3. Pagos: errores comunes');
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 999999, metodo: 'efectivo' });
  revisa(s === 400, 'pago mayor al saldo se rechaza');
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: -5, metodo: 'efectivo' });
  revisa(s === 400, 'pago negativo se rechaza');
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 100, metodo: 'bitcoin' });
  revisa(s === 400, 'método de pago inválido se rechaza');
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 100, metodo: 'efectivo', fecha: sumarDias(HOY, 1) });
  revisa(s === 400, 'pago con fecha futura se rechaza');
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 100, metodo: 'efectivo' });
  const p100 = j.id;
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 100, metodo: 'efectivo' });
  revisa(s === 409, 'doble toque del mismo pago se detecta', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + p100 + '/cancelar', A, { motivo: 'Capturado por error' });
  revisa(s === 200 && j.cuenta.saldo === 8120, 'cancelar pago devuelve el saldo', j.cuenta);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + p100 + '/cancelar', A, { motivo: 'Capturado por error' });
  revisa(s === 400, 'no se cancela dos veces');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: 0.001, metodo: 'efectivo' });
  revisa(s === 400, 'monto con más de 2 decimales se rechaza');
  // Pago de vendedor: queda por confirmar
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', V, { monto: 120, metodo: 'efectivo' });
  revisa(s === 201 && j.confirmado === false, 'pago registrado por ventas queda "por confirmar"', j);
  const pV = j.id;
  rs = await resumen();
  revisa(rs.por_confirmar.cantidad === 1 && rs.por_confirmar.monto === 120, 'resumen muestra 1 pago por confirmar', rs.por_confirmar);
  await pedir('POST', '/finanzas/cobros/' + pV + '/cancelar', A, { motivo: 'Prueba de simulación' });

  sec('4. Realizar el servicio con anticipo cobrado');
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/ejecucion', A, { estado: 'realizado', realizado_por: 'propio' });
  revisa(s === 200, 'marcar realizado (hoy, antes de su fecha programada)', j);
  cc = await enCartera(ord1.id);
  revisa(cc && !cc.programada && cc.saldo === 8120 && cc.vence === sumarDias(HOY, 30), 'ya se cobra: saldo $8,120, vence en 30 días desde que se realizó', cc && { programada: cc.programada, saldo: cc.saldo, vence: cc.vence });
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/ejecucion', A, { estado: 'realizado', realizado_por: 'propio' });
  revisa(s === 400 || s === 409 || (s === 200 && j.gastos === 0), 'marcar realizado dos veces no duplica nada', [s, j.error]);
  // Liquidar
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 8120, metodo: 'transferencia' });
  revisa(s === 201 && j.cuenta.saldo === 0 && j.cuenta.estado === 'pagada', 'liquidar la orden deja saldo 0 y "pagada"', j.cuenta);
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/cobros', A, { monto: 1, metodo: 'efectivo' });
  revisa(s === 400, 'no se puede pagar de más una orden pagada');

  sec('5. Cobrado, sin marcar realizado, y después "no realizado"');
  [s, j] = await alta(C2, { partidas_json: P(partida(5000)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, -2), iva_modo: 'sin_iva' });
  const ord2 = j;
  [s, j] = await pedir('POST', '/leads/' + ord2.id + '/cobros', A, { monto: 5000, metodo: 'efectivo' });
  revisa(s === 201 && j.cuenta.estado === 'pagada', 'orden cobrada completa sin marcar si se realizó', j.cuenta);
  cc = await enCartera(ord2.id);
  revisa(cc && cc.por_concluir, 'aparece como "falta marcar si se realizó"', cc);
  [s, j] = await pedir('POST', '/leads/' + ord2.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'El cliente canceló, ya había pagado' });
  revisa(s === 200, 'marcar NO realizado una orden ya cobrada', [s, j.error]);
  cc = await enCartera(ord2.id);
  revisa(cc && cc.ejecucion === 'no_realizado', 'sigue visible en Cuentas por cobrar (tiene dinero del cliente)', cc);
  revisa(cc && cc.saldo === 0, 'saldo 0: el cliente no debe nada', cc && cc.saldo);
  revisa(cc && (cc.saldo_a_favor === 5000 || cc.a_favor === 5000 || cc.por_devolver === 5000), 'se indica que hay $5,000 a favor del cliente (devolver o aplicar)', cc);
  // Anticipo parcial y no realizado
  [s, j] = await alta(C2, { partidas_json: P(partida(4000)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, 3), iva_modo: 'sin_iva' });
  const ord3 = j;
  await pedir('POST', '/leads/' + ord3.id + '/cobros', A, { monto: 1000, metodo: 'transferencia' });
  [s, j] = await pedir('POST', '/leads/' + ord3.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'Se canceló el servicio con anticipo' });
  cc = await enCartera(ord3.id);
  revisa(cc && cc.saldo === 0, 'no realizado con anticipo de $1,000: el cliente NO debe los $3,000 restantes', cc && { saldo: cc.saldo, estado: cc.estado });
  rs = await resumen();
  const cart = await cartera();
  const sumaSaldo = Math.round(cart.filter(c => c.saldo > 0 && !c.programada).reduce((t, c) => t + c.saldo * 100, 0)) / 100;
  revisa(rs.por_cobrar === sumaSaldo, 'resumen "Te deben" = suma de la lista de Cuentas por cobrar', { resumen: rs.por_cobrar, lista: sumaSaldo });
  const ec = (await pedir('GET', '/finanzas/clientes/' + C2 + '/estado-cuenta', A))[1];
  revisa(ec.saldo === 0 && !ec.ordenes.some(o => o.lead_id === ord3.id && o.saldo > 0), 'estado de cuenta del cliente: no le cobra servicios no realizados', { saldo: ec.saldo, ordenes: ec.ordenes.map(o => [o.lead_id, o.saldo]) });
  // Regresar un "no realizado" a realizado
  [s, j] = await pedir('POST', '/leads/' + ord3.id + '/ejecucion', A, { estado: 'realizado', realizado_por: 'propio' });
  revisa(s === 200, 'se puede corregir: de "no realizado" a "realizado"', [s, j.error]);
  cc = await enCartera(ord3.id);
  revisa(cc && cc.saldo === 3000, 'al corregirlo a realizado vuelve a deber $3,000', cc && cc.saldo);

  sec('6. Vencidos con servicio realizado');
  [s, j] = await alta(C3, { partidas_json: P(partida(2500, 2)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, -40), iva_modo: 'mas_iva' });
  const ord4 = j;
  revisa(j.valor === 5000, 'cantidad 2 × $2,500 = $5,000', j.valor);
  [s, j] = await pedir('POST', '/leads/' + ord4.id + '/ejecucion', A, { estado: 'realizado', fecha: sumarDias(HOY, -40), realizado_por: 'propio' });
  await pedir('PUT', '/leads/' + ord4.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'QR-9001', factura_fecha: sumarDias(HOY, -38) });
  cc = await enCartera(ord4.id);
  revisa(cc && cc.vencida && cc.dias_vencido === 23 && cc.tramo === '16-30', 'factura de hace 38 días con 15 de crédito: vencida hace 23 días (tramo 16-30)', cc && { v: cc.vencida, d: cc.dias_vencido, t: cc.tramo });
  await pedir('POST', '/leads/' + ord4.id + '/cobros', A, { monto: 2000, metodo: 'cheque' });
  cc = await enCartera(ord4.id);
  revisa(cc && cc.estado === 'parcial' && cc.saldo === 3800 && cc.vencida, 'pago parcial de una vencida: sigue vencida con $3,800', cc && { e: cc.estado, s: cc.saldo });
  // Factura por otro total (retención)
  [s, j] = await pedir('PUT', '/leads/' + ord4.id + '/facturacion', A, { factura_total: 5300 });
  revisa(s === 200 && j.cuenta.total === 5300 && j.cuenta.saldo === 3300, 'factura con retención ($5,300): el saldo se ajusta', j.cuenta);
  [s, j] = await pedir('PUT', '/leads/' + ord4.id + '/facturacion', A, { factura_total: 1000 });
  revisa(s === 400, 'el total facturado no puede quedar debajo de lo cobrado');
  rs = await resumen();
  revisa(rs.vencido >= 3300 && rs.clientes_con_vencido >= 1, 'resumen cuenta lo vencido', rs);
  const cal = (await pedir('GET', `/calendario?desde=${sumarDias(HOY, -45)}&hasta=${sumarDias(HOY, 40)}`, A))[1];
  revisa(cal.eventos.some(e => e.tipo === 'cobro' && e.lead_id === ord4.id && e.estado === 'vencido'), 'calendario muestra el cobro vencido', cal.eventos.filter(e => e.lead_id === ord4.id));
  revisa(!cal.eventos.some(e => e.tipo === 'cobro' && (e.lead_id === ord2.id || e.lead_id === ord3.id && false)), 'calendario no muestra cobros de órdenes sin saldo');

  sec('7. Pagos a terceros (extras / proveedores)');
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas del Centro', categoria: 'subcontratacion', dias_credito: 7 });
  const prov = j;
  [s, j] = await alta(C3, { partidas_json: P(partida(8000)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, -1) });
  const ord5 = j;
  [s, j] = await pedir('POST', '/leads/' + ord5.id + '/ejecucion', A, { estado: 'realizado', realizado_por: 'subcontratado', gastos: [
    { proveedor_id: prov.id, concepto: 'Servicio subcontratado', total: 5000, ya_pagado: false },
    { proveedor_id: prov.id, categoria: 'casetas_viaticos', concepto: 'Casetas', total: 300, ya_pagado: true, metodo: 'efectivo' }] });
  revisa(s === 200 && j.gastos === 2, 'realizado por tercero con 2 gastos', [s, j.error]);
  let cxp = (await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ord5.id, A))[1];
  const sub = cxp.find(x => x.concepto === 'Servicio subcontratado');
  revisa(sub && sub.saldo === 5000 && sub.fecha_vencimiento === sumarDias(sumarDias(HOY, 0), 7), 'gasto pendiente vence según el crédito del proveedor (7 días)', sub);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + sub.id + '/pagos', A, { monto: 6000, metodo: 'transferencia' });
  revisa(s === 400, 'pagarle al proveedor más del saldo se rechaza', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + sub.id + '/pagos', A, { monto: 2000, metodo: 'transferencia' });
  revisa(s === 201, 'pago parcial al proveedor', [s, j]);
  // "Extra" que no estaba: gasto adicional después
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Extra: manguera adicional', total: 450, lead_id: ord5.id, ya_pagado: true, metodo: 'efectivo' });
  revisa(s === 201, 'gasto extra ligado a la orden, pagado de contado', [s, j]);
  const gen = (await pedir('GET', `/generador?desde=${HOY}&hasta=${HOY}`, A))[1];
  const fila = gen.filas.find(f => f.lead_id === ord5.id);
  revisa(fila && fila.costo === 5750, 'generador: costo total del tercero $5,000 + $300 + $450 = $5,750', fila);
  // Marcar no realizado una orden con gastos ya cargados
  [s, j] = await pedir('POST', '/leads/' + ord5.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'Se capturó mal, no se hizo' });
  cxp = (await pedir('GET', '/finanzas/cxp?vista=pendientes&lead_id=' + ord5.id, A))[1];
  revisa(s !== 200 || j.aviso || j.gastos_ligados !== undefined, 'al marcar NO realizado una orden con gastos, avisa que tiene gastos en Cuentas por pagar', [s, j]);
  // Volver a realizado: ¿duplica los gastos?
  [s, j] = await pedir('POST', '/leads/' + ord5.id + '/ejecucion', A, { estado: 'realizado', realizado_por: 'subcontratado', gastos: [{ proveedor_id: prov.id, concepto: 'Servicio subcontratado', total: 5000 }] });
  cxp = (await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ord5.id, A))[1];
  revisa(cxp.filter(x => x.concepto === 'Servicio subcontratado').length === 1, 'volver a marcar realizado no duplica el pago al tercero', cxp.map(x => [x.concepto, x.total]));
  const per = (await pedir('GET', `/finanzas/periodo?desde=${HOY.slice(0, 8)}01&hasta=${HOY}`, A))[1];
  revisa(per.pagado >= 2750, 'Resultados: pagado a proveedores del mes', per);

  sec('8. Borrar y duplicar');
  [s, j] = await pedir('DELETE', '/leads/' + ord1.id, A);
  revisa(s === 409, 'no se borra una orden con pagos', [s, j]);
  [s, j] = await pedir('DELETE', '/leads/' + ord5.id, A);
  revisa(s === 409, 'no se borra una orden con gastos en Cuentas por pagar', [s, j]);
  [s, j] = await alta(C3, { partidas_json: P(partida(700)), estatus: 'ganado', fecha_servicio: HOY, duplicado_de: ord5.id });
  revisa(s === 201 && j.duplicado_de === ord5.id && !j.ejecucion, 'duplicar una orden realizada crea una nueva sin marcar', j);
  [s, j] = await alta(C1, { partidas_json: P(partida(700)), estatus: 'ganado', fecha_servicio: HOY, duplicado_de: ord5.id });
  revisa(s === 400, 'no se duplica una orden en otro cliente', [s, j]);

  sec('9. Cotización perdida / convertir dos veces');
  [s, j] = await alta(C2, { partidas_json: P(partida(900)) });
  const cot2 = j;
  [s, j] = await pedir('PUT', '/leads/' + cot2.id, A, { version: cot2.version, estatus: 'perdido', motivo_perdida: 'Precio' });
  revisa(s === 200 && j.estatus === 'perdido', 'marcar cotización como perdida', [s, j.error, j.estatus]);
  [s, j] = await pedir('POST', '/leads/' + cot2.id + '/cobros', A, { monto: 10, metodo: 'efectivo' });
  revisa(s === 400, 'no se registran pagos en cotizaciones perdidas');
  [s, j] = await pedir('PUT', '/leads/' + cot2.id, A, { version: (await lead(cot2.id)).version, estatus: 'ganado', fecha_servicio: HOY });
  revisa(s === 200 || s === 400, 'reabrir/convertir una perdida no truena', [s, j.error]);
  [s, j] = await pedir('POST', '/leads/' + ord1.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'xx' });
  revisa(s === 400, 'motivo demasiado corto se rechaza');

  sec('9b. Calendario: lo atrasado (vista «Hoy»)');
  [s, j] = await alta(C3, { partidas_json: P(partida(2500)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, -3) });
  const sinConcluir = j;
  [s, j] = await pedir('GET', '/calendario/atrasados', A);
  const atr = j.eventos || [];
  revisa(s === 200 && atr.some(e => e.tipo === 'cobro' && e.lead_id === ord4.id && e.estado === 'vencido' && e.monto === 3300), 'atrasado: el cobro vencido con su saldo', atr.filter(e => e.lead_id === ord4.id));
  revisa(atr.some(e => e.tipo === 'orden' && e.lead_id === sinConcluir.id && e.estado === 'por_concluir' && e.fecha === sumarDias(HOY, -3)), 'atrasado: la orden con fecha pasada sin concluir', atr.filter(e => e.lead_id === sinConcluir.id));
  revisa(!atr.some(e => e.tipo === 'cobro' && e.lead_id === sinConcluir.id), 'atrasado: una orden sin concluir ni facturar no es un cobro');
  revisa(!atr.some(e => e.tipo === 'orden' && e.lead_id === ord4.id), 'atrasado: la orden ya realizada no sale como por concluir');
  revisa(atr.every(e => e.fecha < j.hoy), 'atrasado: solo lo de días anteriores a hoy', atr.filter(e => e.fecha >= j.hoy));
  const cal2 = (await pedir('GET', `/calendario?desde=${sumarDias(HOY, -45)}&hasta=${sumarDias(HOY, 40)}`, A))[1];
  revisa(cal2.eventos.some(e => e.tipo === 'orden' && e.lead_id === sinConcluir.id && e.estado === 'por_concluir') && !cal2.eventos.some(e => e.tipo === 'cobro' && e.lead_id === sinConcluir.id),
    'calendario: la orden sin concluir sale como orden por concluir, no como cobro', cal2.eventos.filter(e => e.lead_id === sinConcluir.id));

  sec('10. Consistencia general');
  const todas = await cartera();
  revisa(todas.every(c => c.saldo >= 0), 'ningún saldo negativo', todas.filter(c => c.saldo < 0));
  revisa(todas.every(c => c.ejecucion === 'no_realizado' ? c.saldo === 0 && Math.abs(c.a_favor - c.cobrado) < 0.005 : Math.abs(c.total - c.cobrado - c.saldo) < 0.005 || c.saldo === 0), 'total − cobrado = saldo en todas las cuentas', todas.filter(c => Math.abs(c.total - c.cobrado - c.saldo) >= 0.005 && c.saldo !== 0).map(c => [c.lead_id, c.total, c.cobrado, c.saldo]));
  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
