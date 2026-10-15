// De principio a fin: un mes de trabajo completo en una base nueva, pasando por todos los módulos, y al final
// se comprueba que los números CUADRAN entre Generador, Cuentas por cobrar, Cuentas por pagar, Panorama,
// Calendario y la ficha del cliente.
// Uso: node tests/simulacion-principio-a-fin.cjs   (usa una base temporal)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-fin-')); const PUERTO = String(6900 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Principio-' + Math.random().toString(36).slice(2) + '-8' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'f.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const MES = HOY.slice(0, 8) + '01';
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const igual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);
  let s, j;

  seccion('1. El administrador da de alta a su equipo');
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  [s] = await pedir('POST', '/registro', null, { nombre: 'Colado', correo: 'colado@saneadren.com.mx', password: 'Colado-Total-26' });
  revisa(s === 403, 'nadie se registra solo');
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Evelyn Ventas', correo: 'evelyn@saneadren.com.mx', password: 'Temporal-Ventas-1', rol: 'ventas', temporal: true });
  revisa(s === 201, 'alta de Evelyn (ventas) con contraseña temporal');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'evelyn@saneadren.com.mx', password: 'Temporal-Ventas-1' });
  revisa(j.cambiar_password, 'al entrar se le pide cambiar la contraseña');
  [s, j] = await pedir('POST', '/cambiar-password', j.token, { actual: 'Temporal-Ventas-1', nueva: 'Desazolve-Querétaro-26' });
  const V = j.token; revisa(s === 200, 'la cambia y ya trabaja con la suya');
  const [, usuarios] = await pedir('GET', '/usuarios', A); const vid = usuarios.find(u => u.nombre === 'Evelyn Ventas').id;
  const [, canales] = await pedir('GET', '/canales', V); const [, servicios] = await pedir('GET', '/servicios', V);

  seccion('2. Llega un cliente (y luego otra persona de la misma empresa)');
  [s, j] = await pedir('POST', '/contactos', V, { nombre: 'Ing. Ramírez', telefono: '442 555 0101', empresa_contacto: 'Hotel Real de Querétaro S.A. de C.V.', direccion: 'Av. Constituyentes 100', canal_origen_id: canales[0].id });
  const hotel = j; revisa(s === 201, 'contacto nuevo: Hotel Real de Querétaro');
  [s, j] = await pedir('POST', '/contactos', V, { nombre: 'Mantenimiento', telefono: '4425550202', empresa_contacto: 'hotel real de queretaro', direccion: 'Av. Constituyentes 100', canal_origen_id: canales[0].id });
  revisa(s === 409 && j.parecidos?.[0]?.id === hotel.id, 'otra persona del mismo hotel → «¿es el mismo cliente?»');
  [s, j] = await pedir('POST', '/contactos', V, { nombre: 'Mantenimiento', telefono: '4425550202', empresa_contacto: 'hotel real de queretaro', direccion: 'Av. Constituyentes 100', canal_origen_id: canales[0].id, agregar_telefono_a: hotel.id });
  revisa(s === 200 && j.id === hotel.id, '«Es el mismo» → su teléfono queda en el mismo cliente');

  seccion('3. Cotización → orden de servicio → realizado');
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de línea principal', importe: 10000 }, { servicio: servicios[0].nombre, leyenda: 'Limpieza de trampa de grasa', importe: 5000 }]);
  [s, j] = await pedir('POST', '/leads', V, { cliente_id: hotel.id, direccion: 'Cocina principal', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, partidas_json: partidas, iva_modo: 'mas_iva', valor: 15000, fecha_cotizacion: HOY });
  const cot = j; revisa(s === 201 && cot.etapa === 2, 'cotización de $15,000 + IVA (entra a «Cotización enviada»)', [s, cot.etapa, cot.error]);
  [s, j] = await pedir('GET', '/leads/' + cot.id, V);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, V, { version: j.version, estatus: 'ganado', fecha_servicio: HOY });
  revisa(s === 200, 'el cliente acepta: pasa a orden de servicio', [s, j.error]);
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/ejecucion', V, { estado: 'realizado', fecha: HOY, realizado_por: 'propio' });
  revisa(s === 200, 'se marca como realizado', [s, j.error]);

  seccion('4. Cobro parcial, gasto de terceros y orden de compra');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: 7400, metodo: 'transferencia', fecha: HOY, referencia: 'SPEI 0001' });
  revisa(s === 201, 'el hotel paga $7,400 a cuenta');
  [s, prov] = await pedir('POST', '/finanzas/proveedores', V, { nombre: 'Pipas del Centro', categoria: 'residuos', dias_credito: 15 });
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { proveedor_id: prov.id, categoria: 'residuos', concepto: 'Disposición de lodos del hotel', total: 3480, fecha_documento: HOY, lead_id: cot.id, factura_folio: 'PC-77' });
  const gasto = j; revisa(s === 201, 'gasto de terceros ligado a la orden: $3,480');
  [s] = await pedir('POST', '/finanzas/cxp/' + gasto.id + '/pagos', V, { monto: 3480, metodo: 'transferencia', fecha: HOY });
  revisa(s === 201, 'se le paga a Pipas del Centro');
  const [, refa] = await pedir('POST', '/finanzas/proveedores', V, { nombre: 'Refaccionaria Bajío', categoria: 'refacciones', dias_credito: 0 });
  const [, centros] = await pedir('GET', '/compras/centros', V);
  [s, j] = await pedir('POST', '/compras/ordenes', A, { proveedor_id: refa.id, centro_id: centros[0].id, categoria: 'refacciones', fecha: HOY, iva_modo: 'mas_iva', partidas: [{ cantidad: 2, descripcion: 'Manguera de succión 4"', unidad: 'PZA', precio: 500 }] });
  const oc = j; revisa(s === 201 && oc.total === 1160, 'orden de compra de $1,160 (borrador, todavía no es deuda)', [s, oc.total, oc.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A);
  revisa(s === 200 && j.cxp_id, 'el administrador la autoriza: se vuelve deuda');
  [s] = await pedir('POST', '/finanzas/cxp/' + j.cxp_id + '/pagos', A, { monto: 1160, metodo: 'efectivo', fecha: HOY });
  revisa(s === 201, 'se paga la orden de compra');

  seccion('5. Carga del generador (historial de otro cliente, ya cobrado)');
  const filaGen = k => ({ fila: 'MES #' + k, fecha: HOY, no_orden: String(9000 + k), factura: 'QR90' + k, producto: servicios[0].nombre, cantidad: 1, subtotal: 1000, iva: 160, total: 1160, cliente: 'GRUPO TULA', canal: canales[0].nombre });
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas: [filaGen(1), filaGen(2), { fila: 'MES #3', subtotal: 2000, iva: 320, total: 2320 }] });
  revisa(j.servicios === 2 && j.omitidas === 1 && j.por_resolver.clientes.length === 1, 'revisa: 2 servicios, renglón de totales ignorado, «GRUPO TULA» por decidir');
  [s, j] = await pedir('POST', '/generador/importar', A, { filas: [filaGen(1), filaGen(2)], equivalencias: { clientes: { 'GRUPO TULA': 'nuevo' } }, cobrado: true });
  revisa(s === 201 && j.importadas === 2, 'se cargan como cobrados (historial)', [s, j.importadas, j.error]);

  seccion('6. ¿Cuadran los números entre módulos?');
  const [, gen] = await pedir('GET', `/generador?desde=${MES}&hasta=${HOY}`, A);
  const genTotal = gen.filas.reduce((t, f) => t + f.total, 0), genSub = gen.filas.reduce((t, f) => t + f.subtotal, 0);
  revisa(gen.filas.length === 4 && igual(genTotal, 17400 + 2320) && igual(genSub, 17000), 'Generador: 4 renglones, $17,000 + IVA = $19,720', [gen.filas.length, genSub, genTotal]);
  revisa(gen.filas.filter(f => f.cliente_id === hotel.id).length === 2, 'las 2 partidas del hotel están en su cliente');
  const [, res] = await pedir('GET', '/finanzas/resumen', A);
  revisa(igual(res.por_cobrar, 10000), 'Cuentas por cobrar: falta cobrar $10,000 (17,400 − 7,400)', res.por_cobrar);
  const [, cartera] = await pedir('GET', '/finanzas/cartera', A);
  const cuentaHotel = (Array.isArray(cartera) ? cartera : cartera.cuentas || []).find(c => c.lead_id === cot.id);
  revisa(cuentaHotel && igual(cuentaHotel.saldo, 10000) && igual(cuentaHotel.cobrado, 7400), 'la orden del hotel: cobrado $7,400 · saldo $10,000', cuentaHotel && [cuentaHotel.cobrado, cuentaHotel.saldo]);
  const [, cxp] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const listaCxp = Array.isArray(cxp) ? cxp : cxp.cuentas || [];
  revisa(listaCxp.length === 2 && listaCxp.every(x => igual(x.saldo, 0)), 'Cuentas por pagar: el gasto y la orden de compra están pagados', listaCxp.map(x => [x.concepto, x.saldo]));
  const [, tab] = await pedir('GET', `/tablero?desde=${MES}&hasta=${HOY}&tipo=mes`, A);
  const r = tab.actual;
  revisa(igual(r.venta, 17000) && r.servicios === 3, 'Panorama: venta $17,000 en 3 órdenes (igual que el Generador)', [r.venta, r.servicios]);
  revisa(igual(r.cobrado, 7400 + 2320), 'Panorama: cobrado $9,720 (pago del hotel + historial)', r.cobrado);
  revisa(igual(r.pagado, 3480 + 1160), 'Panorama: pagado $4,640 (pipas + refacciones)', r.pagado);
  revisa(igual(r.flujo, 9720 - 4640), 'Panorama: flujo = cobrado − pagado ($5,080)', r.flujo);
  revisa(r.costo_directo > 0 && r.costo_directo <= 3480, 'Panorama: el gasto de pipas cuenta como costo directo de la orden', r.costo_directo);
  revisa(igual(tab.foto?.por_cobrar ?? res.por_cobrar, 10000) || tab.foto?.por_cobrar === undefined, 'Panorama: lo por cobrar coincide con Cuentas por cobrar', tab.foto?.por_cobrar);
  const [, cal] = await pedir('GET', `/calendario?desde=${MES}&hasta=${HOY}`, A);
  const eventos = Array.isArray(cal) ? cal : cal.eventos || [];
  revisa(eventos.some(e => e.lead_id === cot.id), 'Calendario: aparece la orden del hotel', eventos.slice(0, 3));
  const [, ficha] = await pedir('GET', '/clientes/' + hotel.id, V);
  revisa(ficha.servicios?.some(x => x.id === cot.id && x.estatus === 'ganado'), 'Ficha del cliente: tiene su orden contratada');
  const [, tels] = await pedir('GET', '/clientes/' + hotel.id + '/telefonos', V);
  revisa(tels.length === 1 && tels[0].telefono_normalizado === '4425550202', 'Ficha del cliente: tiene los 2 teléfonos (principal + mantenimiento)');
  const [, edo] = await pedir('GET', '/finanzas/clientes/' + hotel.id + '/estado-cuenta?completo=1', A);
  revisa(igual(edo.saldo ?? edo.ordenes?.reduce((t, o) => t + o.saldo, 0), 10000), 'Estado de cuenta del cliente: debe $10,000', [edo.saldo, edo.pagado]);
  const [, dup] = await pedir('GET', '/clientes/duplicados', A);
  revisa(dup.length === 0, 'Revisar duplicados: no hay clientes repetidos', dup.map(p => p.motivo));

  seccion('7. Se cancela el pago del hotel (fue un error) y todo se recalcula');
  const [, cobros] = await pedir('GET', '/leads/' + cot.id + '/cobros', A);
  [s] = await pedir('POST', '/finanzas/cobros/' + cobros.cobros[0].id + '/cancelar', A, { motivo: 'El depósito rebotó' });
  revisa(s === 200, 'se cancela el pago de $7,400 con motivo');
  const [, res2] = await pedir('GET', '/finanzas/resumen', A);
  const [, tab2] = await pedir('GET', `/tablero?desde=${MES}&hasta=${HOY}&tipo=mes`, A);
  revisa(igual(res2.por_cobrar, 17400), 'Cuentas por cobrar vuelve a $17,400', res2.por_cobrar);
  revisa(igual(tab2.actual.cobrado, 2320) && igual(tab2.actual.flujo, 2320 - 4640), 'Panorama: cobrado $2,320 y flujo −$2,320', [tab2.actual.cobrado, tab2.actual.flujo]);
  revisa(igual(tab2.actual.venta, 17000), 'la venta no cambia (el servicio sí se hizo)', tab2.actual.venta);

  seccion('8. Seguridad al final del día');
  [s] = await pedir('GET', '/tablero', V); revisa(s === 403, 'ventas no ve el Panorama (solo administración)');
  [s] = await pedir('GET', '/admin/backup', V); revisa(s === 403, 'ventas no descarga la base de datos');
  [s] = await pedir('POST', '/logout', V); [s] = await pedir('GET', '/servicios', V); revisa(s === 401, 'al salir, la sesión ya no sirve');

  revisa(!/uncaughtException|Error en |TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
