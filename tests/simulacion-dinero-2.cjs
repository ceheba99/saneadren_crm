// Uso: node tests/simulacion-dinero-2.cjs   (base temporal; no toca saneadren.db)
// Simulación integral, ronda 2: permisos, descuentos, conflictos, proveedores, IVA y consistencia.
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-integral2-')); const PUERTO = String(3900 + Math.floor(Math.random() * 400));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Integral2-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'i.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const sumarDias = (f, d) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  const servicios = (await pedir('GET', '/servicios', A))[1], canales = (await pedir('GET', '/canales', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  await pedir('POST', '/usuarios', A, { nombre: 'Vendedora Dos', correo: 'v2@saneadren.com.mx', password: 'Ventas-Dos-2026', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'v2@saneadren.com.mx', password: 'Ventas-Dos-2026' }))[1].token;
  const vid = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'ventas').id;
  const partida = (precio, cantidad = 1, sv = 0) => ({ servicio: servicios[sv].nombre, leyenda: 'x', importe: precio, cantidad, precio });
  const P = (...p) => JSON.stringify(p);
  const lead = async id => (await pedir('GET', '/leads/' + id, A))[1];
  const cuenta = async id => (await pedir('GET', '/leads/' + id + '/cobros', A))[1].cuenta;
  const cartera = async () => (await pedir('GET', '/finanzas/cartera?filtro=todas', A))[1];
  let s, j;
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Fábrica Norte', telefono: '4426660001', direccion: 'Parque Industrial 1', canal_origen_id: canales[0].id });
  const C = j.id;
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Escuela Luz', telefono: '4426660002', direccion: 'Calle Luz 5', canal_origen_id: canales[0].id });
  const C2 = j.id;
  const alta = (cuerpo, t = A, cli = C) => pedir('POST', '/leads', t, { cliente_id: cli, direccion: 'Planta', responsable_id: t === V ? vid : yo, forzar_duplicado: true, iva_modo: 'mas_iva', ...cuerpo });

  sec('1. Permisos de ventas');
  [s, j] = await alta({ partidas_json: P(partida(3000)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, -1) });
  const o1 = j;
  [s, j] = await pedir('PUT', '/leads/' + o1.id, V, { version: o1.version, partidas_json: P(partida(10)), iva_modo: 'mas_iva' });
  revisa(s === 403, 'ventas no puede bajar el importe de una orden', [s, j.error]);
  [s, j] = await pedir('DELETE', '/leads/' + o1.id, V); revisa(s === 403, 'ventas no puede eliminar órdenes');
  [s, j] = await pedir('GET', '/admin/backup', V); revisa(s === 403, 'ventas no descarga la base de datos', s);
  [s, j] = await pedir('POST', '/leads/' + o1.id + '/cobros', V, { monto: 100, metodo: 'efectivo', tipo: 'ajuste' }); revisa(s === 403, 'ventas no hace descuentos/ajustes');
  [s, j] = await pedir('POST', '/usuarios', V, { nombre: 'Hacker', correo: 'h@x.com', password: 'Abcdefgh-123', rol: 'admin' }); revisa(s === 403, 'ventas no crea usuarios', s);

  sec('2. Descuento (ajuste) y Resultados');
  [s, j] = await pedir('POST', '/leads/' + o1.id + '/cobros', A, { monto: 480, metodo: 'otro', tipo: 'ajuste', notas: 'Descuento por pronto pago' });
  revisa(s === 201 && j.cuenta.saldo === 3000, 'descuento de $480 baja el saldo a $3,000', j.cuenta);
  [s, j] = await pedir('POST', '/leads/' + o1.id + '/cobros', A, { monto: 3000, metodo: 'transferencia' });
  revisa(s === 201 && j.cuenta.estado === 'pagada', 'liquidada con descuento', j.cuenta);
  const per = (await pedir('GET', `/finanzas/periodo?desde=${HOY}&hasta=${HOY}`, A))[1];
  revisa(per.cobrado === 3000, 'Resultados: el descuento NO cuenta como dinero cobrado', per);
  const rs = (await pedir('GET', '/finanzas/resumen', A))[1];
  revisa(rs.cobrado_mes === 3000, 'resumen "Cobrado este mes" sin el descuento', rs.cobrado_mes);

  sec('3. Orden con pagos no se descarta / conflicto de versiones');
  [s, j] = await alta({ partidas_json: P(partida(1000)) });
  const cot = j;
  [s, j] = await pedir('PUT', '/leads/' + cot.id, A, { version: cot.version, estatus: 'ganado', fecha_servicio: HOY });
  [s, j] = await pedir('PUT', '/leads/' + cot.id, A, { version: cot.version, notas_cotizacion: 'cambio con versión vieja' });
  revisa(s === 409, 'guardar con una versión vieja avisa del conflicto', [s, j.error]);
  await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: 500, metodo: 'efectivo' });
  [s, j] = await pedir('PUT', '/leads/' + cot.id, A, { version: (await lead(cot.id)).version, estatus: 'perdido' });
  revisa(s === 409, 'una orden con pagos no se puede marcar perdida', [s, j.error]);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, A, { version: (await lead(cot.id)).version, estatus: 'abierto' });
  revisa(s === 409, 'una orden con pagos no vuelve a ser cotización', [s, j.error]);

  sec('4. Pago por confirmar y cancelado');
  [s, j] = await alta({ partidas_json: P(partida(2000)), estatus: 'ganado', fecha_servicio: HOY, iva_modo: 'sin_iva' });
  const o3 = j;
  [s, j] = await pedir('POST', '/leads/' + o3.id + '/cobros', V, { monto: 2000, metodo: 'efectivo' });
  const pv = j.id;
  revisa(s === 201 && j.cuenta.saldo === 0, 'un pago por confirmar ya descuenta el saldo', j.cuenta);
  let cc = (await cartera()).find(c => c.lead_id === o3.id);
  revisa(cc && cc.por_confirmar === 1, 'la cuenta marca "pago por confirmar"', cc && cc.por_confirmar);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + pv + '/confirmar', V); revisa(s === 200 || s === 403, 'confirmar pago (según permisos)', s);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + pv + '/cancelar', A, { motivo: 'El efectivo no llegó' });
  revisa(s === 200 && j.cuenta.saldo === 2000, 'cancelar el pago regresa el saldo', j.cuenta);

  sec('5. IVA incluido y redondeos');
  [s, j] = await alta({ partidas_json: P(partida(1160)), estatus: 'ganado', fecha_servicio: HOY, iva_modo: 'incluido' });
  const o4 = j;
  revisa(j.valor === 1000 && j.iva_cent === 16000, 'IVA incluido: $1,160 = $1,000 + $160', [j.valor, j.iva_cent]);
  [s, j] = await pedir('POST', '/leads/' + o4.id + '/cobros', A, { monto: 1160, metodo: 'tarjeta' });
  revisa(s === 201 && j.cuenta.saldo === 0, 'pagar $1,160 la liquida exacta', j.cuenta);
  [s, j] = await alta({ partidas_json: P(partida(333.33, 3), partida(0.01, 7, 1), partida(99.99, 1.5)), estatus: 'ganado', fecha_servicio: HOY, iva_modo: 'mas_iva' });
  const o5 = j;
  await pedir('POST', '/leads/' + o5.id + '/ejecucion', A, { estado: 'realizado', realizado_por: 'propio' });
  const gen = (await pedir('GET', `/generador?desde=${HOY}&hasta=${HOY}`, A))[1];
  const filas = gen.filas.filter(f => f.lead_id === o5.id);
  const c5 = await cuenta(o5.id);
  const sumaFilas = Math.round(filas.reduce((t, f) => t + f.total * 100, 0)) / 100;
  revisa(filas.length === 3 && sumaFilas === c5.total, 'generador: los renglones suman exacto el total de la orden (centavos)', { sumaFilas, total: c5.total });

  sec('6. Extras después de pagar');
  [s, j] = await alta({ partidas_json: P(partida(1500)), estatus: 'ganado', fecha_servicio: HOY, iva_modo: 'sin_iva' });
  const o6 = j;
  await pedir('POST', '/leads/' + o6.id + '/cobros', A, { monto: 1500, metodo: 'efectivo' });
  [s, j] = await pedir('PUT', '/leads/' + o6.id, A, { version: (await lead(o6.id)).version, partidas_json: P(partida(1500), partida(600, 1, 1)), iva_modo: 'sin_iva' });
  cc = await cuenta(o6.id);
  revisa(s === 200 && cc.saldo === 600 && cc.estado === 'parcial', 'extra de $600 después de pagar: vuelve a deber $600', cc);

  sec('7. No realizado: cancelar el anticipo después');
  [s, j] = await alta({ partidas_json: P(partida(4000)), estatus: 'ganado', fecha_servicio: sumarDias(HOY, 4), iva_modo: 'sin_iva' });
  const o7 = j;
  [s, j] = await pedir('POST', '/leads/' + o7.id + '/cobros', A, { monto: 1000, metodo: 'efectivo' });
  const ant = j.id;
  [s, j] = await pedir('POST', '/leads/' + o7.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'Cliente canceló' });
  revisa(s === 200 && j.a_favor === 1000, 'avisa que hay $1,000 a favor del cliente', j.a_favor);
  [s, j] = await pedir('POST', '/leads/' + o7.id + '/cobros', A, { monto: 10, metodo: 'efectivo' });
  revisa(s === 400 && /NO realizado/.test(j.error), 'no se registran pagos en un servicio no realizado', j);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + ant + '/cancelar', A, { motivo: 'Se devolvió el anticipo al cliente' });
  revisa(s === 200 && j.cuenta.a_favor === 0 && j.cuenta.saldo === 0, 'al devolver el anticipo (cancelarlo) ya no hay saldo a favor', j.cuenta);
  revisa(!(await cartera()).some(c => c.lead_id === o7.id), 'sin pagos, el no realizado sale de Cuentas por cobrar');
  const cal = (await pedir('GET', `/calendario?desde=${HOY}&hasta=${sumarDias(HOY, 10)}`, A))[1];
  const evO7 = cal.eventos.find(e => e.tipo === 'orden' && e.lead_id === o7.id);
  revisa(evO7 && evO7.estado === 'no_realizada', 'calendario: la orden aparece como no realizada', evO7);
  revisa(!cal.eventos.some(e => e.tipo === 'cobro' && e.lead_id === o7.id), 'calendario: no muestra cobro de un no realizado');

  sec('8. Proveedores: cancelar pago y cuenta');
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refacciones Bajío', categoria: 'otro', dias_credito: 0 });
  const prov = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Bomba', total: 1200, factura_folio: 'F-1' });
  const x1 = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Bomba', total: 1200, factura_folio: 'F-1' });
  revisa(s === 409, 'la misma factura del mismo proveedor dos veces se detecta', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + x1.id + '/pagos', A, { monto: 1200, metodo: 'transferencia' });
  const pg = j.id;
  [s, j] = await pedir('POST', '/finanzas/cxp/' + x1.id + '/cancelar', A, { motivo: 'Factura cancelada por el proveedor' });
  revisa(s === 400 || s === 409, 'no se cancela una cuenta por pagar que ya tiene pagos', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/pagos-proveedor/' + (pg || 0) + '/cancelar', A, { motivo: 'Transferencia rebotada' });
  revisa(s === 200, 'cancelar el pago al proveedor', [s, j]);
  let lista = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1];
  revisa(lista.find(x => x.id === x1.id)?.saldo === 1200, 'la cuenta vuelve a deber $1,200', lista.find(x => x.id === x1.id));
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Negativo', total: -5 });
  revisa(s === 400, 'gasto negativo se rechaza');

  sec('9. Contactos: editar a teléfono repetido');
  [s, j] = await pedir('PUT', '/clientes/' + C2, A, { telefono: '4426660001' });
  revisa(s === 409 || s === 400, 'cambiar el teléfono a uno que ya existe se rechaza', [s, j.error]);
  [s, j] = await pedir('PUT', '/clientes/' + C2, A, { rfc: 'abc' });
  revisa(s === 400, 'RFC inválido al editar se rechaza', [s, j.error]);

  sec('10. Consistencia: estado de cuenta = Cuentas por cobrar');
  const cart = await cartera();
  for (const cli of [C, C2]) {
    const ec = (await pedir('GET', '/finanzas/clientes/' + cli + '/estado-cuenta', A))[1];
    const deCart = Math.round(cart.filter(c => c.cliente_id === cli && c.saldo > 0 && !c.programada).reduce((t, c) => t + c.saldo * 100, 0)) / 100;
    revisa(ec.saldo === deCart, `cliente ${cli}: saldo del estado de cuenta = Cuentas por cobrar`, { ec: ec.saldo, cart: deCart });
  }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
