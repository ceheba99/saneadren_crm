// Simulación de punta a punta sobre una base de datos NUEVA (como un servidor recién creado en
// Render): admin inicial por variables de entorno, cuentas, permisos y el flujo completo
// contacto → cotización → orden de servicio → duplicado.
// Uso: node tests/simulacion.cjs   (no toca saneadren.db: usa una base temporal)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sim-'));
const PUERTO = String(3400 + Math.floor(Math.random() * 500));
const ADMIN = { usuario: 'admin', correo: 'marketing@saneadren.com.mx', password: 'Simulacion-Segura-41' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'sim.db'), APP_URL: 'http://localhost:' + PUERTO,
    ADMIN_USUARIO: ADMIN.usuario, ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '',
    USUARIO_PRUEBA_NOMBRE: 'Karla Prueba', USUARIO_PRUEBA_PASSWORD: 'Pruebas-Campo-31', USUARIO_PRUEBA_ROL: 'tecnico' }
});
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);

const API = `http://localhost:${PUERTO}/api`;
let pruebas = 0, fallos = 0;
const ok = (c, t, extra) => { pruebas++; if (!c) fallos++; console.log((c ? '  ✔ ' : '  ✘ ') + t + (!c && extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const seccion = t => console.log('\n' + t);
async function pedir(metodo, ruta, token, cuerpo) {
  const r = await fetch(API + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return [r.status, await r.json().catch(() => ({}))];
}
const enlace = accion => { const m = [...salida.matchAll(new RegExp('#' + accion + '=([\\w-]+)', 'g'))]; return m.length ? m.at(-1)[1] : null; };
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);

  seccion('1. Servidor nuevo y admin inicial');
  ok(/\[admin inicial\] Configurado "admin"/.test(salida), 'el admin se configuró desde variables de entorno');
  let [s, j] = await pedir('POST', '/login', null, { nombre: 'Ventas 1', password: '1234' });
  ok(s === 403, 'los usuarios de ejemplo con 1234 están bloqueados');
  [s, j] = await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password });
  ok(s === 200 && j.rol === 'admin' && !j.cambiar_password, 'admin entra con su correo', j);
  const A = j.token;

  ok(salida.includes('[usuario de prueba] Creado "Karla Prueba" con rol tecnico'), 'el usuario de prueba se crea desde variables de entorno');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Karla Prueba', password: 'Pruebas-Campo-31' });
  ok(s === 200 && j.rol === 'tecnico' && !j.cambiar_password, 'el usuario de prueba entra con su rol', j);

  seccion('2. Registro de personal y recuperación de contraseña');
  [s] = await pedir('POST', '/registro', null, { nombre: 'Laura Pérez', correo: 'laura@sanedaren.com.mx', password: 'Desazolve-2026' });
  ok(s === 400, 'correo de otro dominio rechazado');
  [s] = await pedir('POST', '/registro', null, { nombre: 'Laura Pérez', correo: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 202, 'registro aceptado');
  [s] = await pedir('POST', '/login', null, { nombre: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 403, 'no entra sin confirmar el correo');
  await espera(200);
  [s] = await pedir('POST', '/verificar-correo', null, { token: enlace('verificar') });
  ok(s === 200, 'correo confirmado con el enlace');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 200 && j.rol === 'ventas', 'entra como ventas');
  let L = j.token;
  [s] = await pedir('POST', '/olvide-password', null, { correo: 'laura@saneadren.com.mx' });
  await espera(200);
  [s] = await pedir('POST', '/restablecer-password', null, { token: enlace('restablecer'), password: 'Bombeo-Pipa-2026' });
  ok(s === 200, 'contraseña restablecida por correo');
  [s] = await pedir('GET', '/servicios', L);
  ok(s === 401, 'la sesión anterior se cerró');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Laura Pérez', password: 'Bombeo-Pipa-2026' });
  L = j.token;
  ok(s === 200, 'entra con la contraseña nueva');

  seccion('3. Permisos');
  [s] = await pedir('GET', '/admin/backup', L); ok(s === 403, 'ventas no descarga la base de datos');
  [s] = await pedir('POST', '/usuarios', L, { nombre: 'Otro Admin', password: 'Intruso-Total-9', rol: 'admin' }); ok(s === 403, 'ventas no crea usuarios');
  [s] = await pedir('POST', '/servicios', L, { nombre: 'Servicio nuevo' }); ok(s === 403, 'ventas no da de alta servicios');
  const servicios = (await pedir('GET', '/servicios', L))[1];
  [s] = await pedir('PUT', '/servicios/' + servicios[0].id, L, { descripcion: 'Limpieza integral con equipo Vactor.' }); ok(s === 200, 'ventas edita la descripción de un servicio');
  [s] = await pedir('PUT', '/servicios/orden', L, { ids: servicios.map(x => x.id).reverse() }); ok(s === 200, 'ventas reordena servicios');
  [s] = await pedir('POST', '/canales', L, { nombre: 'Recomendación' }); ok(s === 201, 'ventas agrega un canal');
  const r = await fetch(API + '/admin/backup', { headers: { Authorization: 'Bearer ' + A } }); ok(r.status === 200, 'admin descarga la base de datos');

  seccion('4. Contacto → cotización → orden de servicio → duplicado');
  const canales = (await pedir('GET', '/canales', L))[1];
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Empresa Salia', telefono: '4426164961', direccion: 'Carpinteros 9 Peñuelas', canal_origen_id: canales[0].id });
  ok(s === 201, 'contacto creado', j);
  const clienteId = j.id;
  const usuarioL = (await pedir('GET', '/usuarios', L))[1].find(u => u.nombre === 'Laura Pérez');
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de rejillas', importe: 3500 }]);
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteId, direccion: 'Carpinteros 9 Peñuelas', responsable_id: usuarioL.id, partidas_json: partidas });
  ok(s === 201 && j.estatus === 'abierto' && j.origen === 'cotizacion', 'cotización creada', j);
  const cot = j;
  [s, j] = await pedir('PUT', '/leads/' + cot.id, L, { version: cot.version, estatus: 'ganado', fecha_servicio: '2026-11-16', equipo: 'E-37-04', operador: 'Diego Arturo Hdz' });
  ok(s === 200 && j.estatus === 'ganado' && j.equipo === 'E-37-04', 'cotización convertida en orden de servicio con equipo y operador', j);
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteId, direccion: 'Carpinteros 9 Peñuelas', responsable_id: usuarioL.id, partidas_json: partidas, estatus: 'ganado', fecha_servicio: '2026-12-16', duplicado_de: cot.id, equipo: 'E-37-04', operador: 'Diego Arturo Hdz', forzar_duplicado: true });
  ok(s === 201 && j.origen === 'directo' && j.duplicado_de === cot.id && j.fecha_cotizacion === null, 'orden duplicada sin cotización fantasma', j);
  [s] = await pedir('PUT', '/leads/' + j.id, L, { version: j.version, estatus: 'abierto' });
  ok(s === 400, 'una orden duplicada no se puede "reabrir" como cotización');
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteId, direccion: 'x', responsable_id: usuarioL.id, partidas_json: partidas, duplicado_de: cot.id, forzar_duplicado: true });
  ok(s === 400, 'no se pueden duplicar cotizaciones');

  seccion('5. Recompras, fechas y borrado');
  const recurrente = servicios.find(x => x.dias_recurrencia);
  const partidasRec = JSON.stringify([{ servicio: recurrente.nombre, leyenda: 'Servicio periódico', importe: 2000 }]);
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Hotel Recompra', telefono: '4421112233', direccion: 'Av. Constituyentes 10', canal_origen_id: canales[0].id });
  const clienteRec = j.id;
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteRec, direccion: 'Av. Constituyentes 10', responsable_id: usuarioL.id, partidas_json: partidasRec, estatus: 'ganado', fecha_servicio: '2025-01-15', forzar_duplicado: true });
  const ordenVieja = j;
  [s, j] = await pedir('GET', '/recompras', L);
  const rec = (j || []).find(x => x.cliente_id === clienteRec && x.servicio_id === recurrente.id);
  ok(rec && rec.ultimo_lead_id === ordenVieja.id, 'la recompra trae la orden que se va a duplicar (botón "Registrar servicio nuevo")', rec);
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  ok(cot.fecha_cotizacion === hoy, 'la fecha de la cotización es la de hoy en México', { fecha: cot.fecha_cotizacion, hoy });
  [s, j] = await pedir('GET', '/salud', null);
  ok(s === 200 && j.ok && j.hoy === hoy, 'ruta de salud pública con la fecha de México', j);
  [s] = await pedir('DELETE', '/leads/' + ordenVieja.id, L); ok(s === 403, 'ventas NO puede borrar una orden');
  [s] = await pedir('DELETE', '/leads/' + ordenVieja.id, A); ok(s === 200, 'admin sí puede borrarla');
  [s] = await pedir('PUT', '/servicios/' + recurrente.id, A, { dias_recurrencia: 99999999 }); ok(s === 400, 'recurrencia absurda rechazada');

  seccion('6. Datos que no se aceptan');
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Prueba Tel', telefono: '<img src=x onerror=alert(1)>4426160000', canal_origen_id: canales[0].id });
  ok(s === 400, 'teléfono con código o letras rechazado', j);
  [s] = await pedir('POST', '/leads/' + cot.id + '/historial', L, { tipo: 'observacion', texto: 'x'.repeat(5000) });
  ok(s === 400, 'nota de 5,000 caracteres rechazada');
  [s] = await pedir('POST', '/leads/' + cot.id + '/historial', L, { tipo: 'observacion', texto: 'Llamar el lunes' });
  ok(s === 201 || s === 200, 'nota normal aceptada');

  seccion('7. Cuentas por cobrar');
  // La orden convertida (cot) y su duplicado nacieron con el módulo instalado: entran directo a la cartera.
  [s, j] = await pedir('GET', '/leads/' + cot.id + '/cobros', L);
  ok(s === 200 && j.cuenta.total === 3500 && j.cuenta.saldo === 3500 && j.cuenta.estado === 'pendiente', 'la orden es una cuenta por cobrar de $3,500 pendiente', j.cuenta);
  [s] = await pedir('GET', '/finanzas/cartera', L); ok(s === 200, 'ventas SÍ ve la cartera (todos ven Cuentas)');
  [s] = await pedir('GET', '/finanzas/por-confirmar', L); ok(s === 200, 'ventas SÍ ve la bandeja de pagos por confirmar');
  [s] = await pedir('GET', '/finanzas/revision-inicial', L); ok(s === 403, 'ventas NO hace la revisión inicial (solo admin)');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', L, { monto: 1000, metodo: 'efectivo' });
  ok(s === 201 && j.confirmado === false && j.cuenta.saldo === 2500 && j.cuenta.estado === 'parcial', 'ventas registra un anticipo en campo: queda por confirmar y baja el saldo', j);
  const cobroVentas = j.id;
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', L, { monto: 1000, metodo: 'efectivo' });
  ok(s === 409 && j.codigo === 'POSIBLE_DUPLICADO', 'doble toque detectado');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: 9999, metodo: 'transferencia' });
  ok(s === 400, 'un pago mayor al saldo se rechaza', j);
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: '10.555', metodo: 'transferencia' });
  ok(s === 400, 'montos con más de 2 decimales se rechazan');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: 100, metodo: 'transferencia', fecha: '2099-01-01' });
  ok(s === 400, 'no se aceptan pagos con fecha futura');
  [s, j] = await pedir('POST', '/finanzas/cobros/' + cobroVentas + '/confirmar', L); ok(s === 200, 'ventas (p. ej. facturación) SÍ puede confirmar pagos');
  [s, j] = await pedir('GET', '/leads/' + cot.id + '/cobros', A); ok(j.cobros.find(k => k.id === cobroVentas)?.confirmado === 1, 'el pago quedó confirmado');
  [s] = await pedir('POST', '/leads/' + cot.id + '/cobros', L, { monto: 1, metodo: 'efectivo', tipo: 'ajuste' }); ok(s === 403, 'los ajustes o descuentos siguen siendo solo del admin');
  [s, j] = await pedir('PUT', '/leads/' + cot.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'A-123', factura_fecha: '2026-11-16', factura_total: 4060 });
  ok(s === 200 && j.cuenta.total === 4060 && j.cuenta.saldo === 3060 && j.cuenta.vence === '2026-12-01', 'factura con IVA: el total pasa a $4,060 y vence en 15 días', j.cuenta);
  [s, j] = await pedir('PUT', '/leads/' + cot.id + '/facturacion', A, { factura_total: 500 });
  ok(s === 400, 'el total facturado no puede quedar debajo de lo cobrado');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', A, { monto: 3060, metodo: 'transferencia', referencia: 'SPEI 99' });
  ok(s === 201 && j.cuenta.estado === 'pagada' && j.cuenta.saldo === 0, 'pago final: la orden queda pagada', j.cuenta);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, A, { version: (await pedir('GET', '/leads/' + cot.id, A))[1].version, estatus: 'abierto' });
  ok(s === 409, 'una orden con pagos no puede volver a ser cotización');
  [s] = await pedir('DELETE', '/leads/' + cot.id, A); ok(s === 409, 'una orden con pagos no se puede borrar');
  [s, j] = await pedir('POST', '/finanzas/cobros/' + cobroVentas + '/cancelar', A, { motivo: 'no' });
  ok(s === 400, 'cancelar exige un motivo');
  [s, j] = await pedir('POST', '/finanzas/cobros/' + cobroVentas + '/cancelar', A, { motivo: 'Era un pago de otra orden' });
  ok(s === 200 && j.cuenta.saldo === 1000 && j.cuenta.estado === 'parcial', 'cancelar un pago devuelve el saldo', j.cuenta);
  [s, j] = await pedir('GET', '/leads/' + cot.id, A);
  ok((j.historial || []).some(x => /CANCELADO/.test(x.texto)) && (j.historial || []).some(x => /Facturación/.test(x.texto)), 'la bitácora registra pagos, cancelaciones y facturación');
  [s, j] = await pedir('GET', '/finanzas/cartera?vista=cliente', A);
  ok(s === 200 && j.some(c => c.cliente_id === clienteId && c.saldo > 0), 'la cartera por cliente muestra el saldo', j);
  [s, j] = await pedir('GET', '/finanzas/resumen', A);
  ok(s === 200 && j.por_cobrar > 0 && j.cobrado_mes > 0, 'resumen de cobranza para Inicio', j);

  // Órdenes programadas (servicio futuro, sin factura): no cuentan como "te deben".
  [s, j] = await pedir('POST', '/leads', A, { cliente_id: clienteRec, direccion: 'Av. Constituyentes 10', responsable_id: usuarioL.id, partidas_json: partidasRec, estatus: 'ganado', fecha_servicio: '2099-06-01', forzar_duplicado: true });
  const programada = j;
  [s, j] = await pedir('GET', '/leads/' + programada.id + '/cobros', A);
  ok(j.cuenta.programada === true && j.cuenta.tramo === null && j.cuenta.folio && /^OS-\d{6}-\d{4}$/.test(j.cuenta.folio), 'una orden con servicio futuro queda como programada y con folio OS', j.cuenta);
  [s, j] = await pedir('GET', '/finanzas/cartera?filtro=programadas', A);
  ok(j.some(c => c.lead_id === programada.id), 'filtro Programadas la muestra');
  [s, j] = await pedir('GET', '/finanzas/cartera', A);
  ok(!j.some(c => c.lead_id === programada.id), 'no aparece en "con saldo" (todavía no se hace el trabajo)');
  [s, j] = await pedir('GET', '/finanzas/resumen', A);
  ok(j.programado >= 2000, 'el resumen la suma aparte como "programado"', j);

  // Estado de cuenta: importes para admin/atención; ventas solo ve el aviso.
  [s, j] = await pedir('GET', '/finanzas/clientes/' + clienteId + '/estado-cuenta', A);
  ok(s === 200 && j.saldo !== undefined && Array.isArray(j.ordenes) && Array.isArray(j.ultimos_cobros), 'estado de cuenta completo para admin', j);
  [s, j] = await pedir('GET', '/finanzas/clientes/' + clienteId + '/estado-cuenta', L);
  ok(s === 200 && j.saldo !== undefined, 'ventas también ve el estado de cuenta completo', j);
  [s] = await pedir('PUT', '/finanzas/clientes/' + clienteId + '/credito', L, { dias_credito: 30 }); ok(s === 200, 'ventas SÍ puede cambiar el crédito del cliente');
  [s, j] = await pedir('GET', '/finanzas/periodo?desde=2026-01-01&hasta=' + hoy, A);
  ok(s === 200 && j.cobrado > 0 && j.pagado !== undefined, 'cobrado y pagado del periodo para Resultados', j);
  [s] = await pedir('GET', '/finanzas/periodo?desde=2026-12-01&hasta=2026-01-01', A); ok(s === 400, 'periodo al revés rechazado');

  // Importe de una orden: ventas no lo puede bajar (antes "saldaba" la deuda editando partidas).
  const otra = (await pedir('GET', '/leads/' + programada.id, A))[1];
  [s, j] = await pedir('PUT', '/leads/' + programada.id, L, { version: otra.version, partidas_json: JSON.stringify([{ servicio: recurrente.nombre, leyenda: 'x', importe: 1 }]) });
  ok(s === 403, 'ventas NO puede cambiar el importe de una orden de servicio', j);
  [s, j] = await pedir('PUT', '/leads/' + programada.id, L, { version: otra.version, operador: 'Fernando Lecón' });
  ok(s === 200, 'ventas sí puede editar otros datos de la orden (operador)');
  [s, j] = await pedir('PUT', '/leads/' + programada.id, A, { version: j.version, partidas_json: JSON.stringify([{ servicio: recurrente.nombre, leyenda: 'x', importe: 1800 }]) });
  ok(s === 200, 'admin sí puede cambiar el importe');
  [s, j] = await pedir('GET', '/leads/' + programada.id, A);
  ok((j.historial || []).some(x => /Importe de la orden cambiado: \$2,000\.00 → \$1,800\.00/.test(x.texto)), 'el cambio de importe queda en la bitácora');

  seccion('8. Cuentas por pagar');
  [s] = await pedir('GET', '/finanzas/cxp', L); ok(s === 200, 'ventas SÍ ve cuentas por pagar');
  [s, j] = await pedir('POST', '/finanzas/proveedores', L, { nombre: 'Proveedor de ventas', categoria: 'otro' }); ok(s === 201, 'ventas SÍ da de alta proveedores');
  const provVentas = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', L, { proveedor_id: provVentas.id, concepto: 'Gasto de ventas', total: 10, ya_pagado: true, metodo: 'efectivo' }); ok(s === 201, 'ventas SÍ registra gastos y pagos a proveedores');
  [s] = await pedir('GET', '/admin/backup', L); ok(s === 403, 'ventas sigue SIN poder descargar la base de datos');
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Disposición del Bajío', categoria: 'residuos', dias_credito: 30 });
  ok(s === 201, 'proveedor creado');
  const prov = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Disposición 12 m3 lodos', total: 2400.5, fecha_documento: '2026-10-01', lead_id: cot.id });
  ok(s === 201, 'factura de proveedor a 30 días ligada a la orden');
  const cxp1 = j.id;
  [s, j] = await pedir('GET', '/finanzas/cxp', A);
  const c1 = j.find(x => x.id === cxp1);
  ok(c1 && c1.fecha_vencimiento === '2026-10-31' && c1.saldo === 2400.5, 'vencimiento calculado con el crédito del proveedor', c1);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cxp1 + '/pagos', A, { monto: 400.5, metodo: 'transferencia' });
  ok(s === 201, 'pago parcial al proveedor');
  [s] = await pedir('POST', '/finanzas/cxp/' + cxp1 + '/cancelar', A, { motivo: 'Factura duplicada' });
  ok(s === 409, 'no se cancela una cuenta con pagos activos');
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diésel pipa', total: 1800, ya_pagado: true, metodo: 'efectivo' });
  ok(s === 201, 'gasto de contado ("ya lo pagué") en un solo paso');
  [s, j] = await pedir('GET', '/finanzas/cxp', A);
  ok(!j.some(x => x.concepto === 'Diésel pipa'), 'el gasto de contado no queda como pendiente');
  [s, j] = await pedir('GET', '/finanzas/resumen', A);
  ok(j.por_pagar === 2000 && j.pagado_mes >= 1800, 'resumen de pagos: $2,000 por pagar', j);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Disposición octubre', total: 500, factura_folio: 'F-77' });
  ok(s === 201, 'factura F-77 registrada');
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Disposición octubre', total: 500, factura_folio: 'F-77' });
  ok(s === 409 && j.codigo === 'POSIBLE_DUPLICADO', 'la misma factura del mismo proveedor avisa que está repetida');
  const adminId = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  [s, j] = await pedir('POST', '/prospeccion', A, { nombre: 'Restaurante La Fuente', sector_id: 1, zona: 'Centro', responsable_id: adminId, fuente: 'https://www.google.com/maps/place/' + 'x'.repeat(150) });
  ok(s === 201 || s === 200, 'prospección acepta enlaces largos en "fuente" (como antes)', j);

  seccion('9. Correcciones de la revisión');
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Oficina Ext', telefono: '442 123 4567 ext. 3', canal_origen_id: canales[0].id });
  ok(s === 201 || s === 409, 'se aceptan teléfonos con extensión (datos que antes eran válidos)', j);
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Varios Tel', telefono: '4421234567 / 4427654321', canal_origen_id: canales[0].id });
  ok(s !== 400 || !/teléfono admite/.test(j.error || ''), 'se aceptan dos teléfonos separados por /', j);
  // 45 inicios de sesión CORRECTOS seguidos desde la misma IP no deben bloquear a nadie.
  let bloqueoPorExito = false;
  for (let i = 0; i < 45; i++) { const [st] = await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }); if (st === 429) { bloqueoPorExito = true; break; } }
  ok(!bloqueoPorExito, 'los inicios de sesión correctos no cuentan para el tope por IP');
  let bloqueoPorFallo = false;
  for (let i = 0; i < 45; i++) { const [st] = await pedir('POST', '/login', null, { nombre: 'inventado' + i, password: 'NoExiste-123x' }); if (st === 429) { bloqueoPorFallo = true; break; } }
  ok(bloqueoPorFallo, 'muchos intentos fallidos con usuarios distintos sí se bloquean por IP');

  seccion('10. Carga masiva desde plantilla de Excel');
  const filasCxc = [
    { fila: 2, telefono: '442 555 0101', nombre: 'Hotel Importado', empresa: 'Hotel Centro', direccion: 'Av. Zaragoza 1', servicio: servicios[0].nombre, fecha_servicio: '2026-09-01', importe: 5000, dias_credito: 30, factura_folio: 'B-1', factura_fecha: '2026-09-02', factura_total: 5800, pagado: 800 },
    { fila: 3, telefono: '4425550101', nombre: '', direccion: 'Bodega 2', servicio: servicios[0].nombre.toUpperCase(), fecha_servicio: '2026-09-10', importe: '1,250.50' },
  ];
  [s] = await pedir('POST', '/finanzas/importar/cxc?simular=1', L, { filas: filasCxc }); ok(s === 200, 'ventas SÍ puede importar plantillas (simulación)');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [...filasCxc, { fila: 4, telefono: '123', servicio: 'No existe', fecha_servicio: '31/02/2026', importe: -5 }] });
  ok(s === 200 && j.errores.length === 1 && j.errores[0].fila === 4 && j.errores[0].errores.length >= 4, 'la simulación marca los errores por renglón', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [...filasCxc, { fila: 4, telefono: '123' }] });
  ok(j.importadas === 0, 'con un renglón con error no se importa nada (todo o nada)');
  [s, j] = await pedir('GET', '/finanzas/cartera?q=Hotel Importado', A);
  ok(!j.length, 'tras el intento fallido no quedó nada guardado');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: filasCxc });
  ok(s === 200 && !j.errores.length && j.resumen[0].cliente_nuevo === true, 'simulación correcta: avisa que el cliente es nuevo', j);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: filasCxc });
  ok(s === 201 && j.importadas === 2, 'se importan 2 órdenes', j);
  [s, j] = await pedir('GET', '/finanzas/cartera?vista=orden&filtro=todas&q=Hotel Importado', A);
  const imp = j.find(c => c.factura_folio === 'B-1');
  ok(j.length === 2 && imp && imp.total === 5800 && imp.cobrado === 800 && imp.saldo === 5000 && imp.vence === '2026-10-02', 'saldos, factura y vencimiento importados correctamente', j);
  ok(j.every(c => c.cliente_id === j[0].cliente_id), 'los dos renglones con el mismo teléfono usan un solo cliente');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: filasCxc });
  ok(j.errores.length === 2 && /ya se importó/.test(j.errores[0].errores.join()), 'subir el mismo archivo otra vez se detecta como duplicado', j.errores);

  const filasCxp = [
    { fila: 2, proveedor: 'Refaccionaria Vactor', categoria: 'Refacciones y mantenimiento', concepto: 'Manguera', factura_folio: 'R-10', fecha_documento: '2026-10-01', total: 3000, pagado: 1000, metodo: 'Efectivo', equipo: 'E-37-04' },
    { fila: 3, proveedor: 'refaccionaria vactor', categoria: 'refacciones', concepto: 'Filtro', factura_folio: 'R-11', fecha_documento: '2026-10-02', fecha_vencimiento: '2026-11-01', total: 450 },
    { fila: 4, proveedor: 'Disposición del Bajío', categoria: '', concepto: 'Lodos', fecha_documento: '2026-10-03', total: 900, orden: imp.folio },
  ];
  [s, j] = await pedir('POST', '/finanzas/importar/cxp?simular=1', A, { filas: [...filasCxp, { fila: 5, proveedor: 'X', categoria: 'Inventada', concepto: 'Y', fecha_documento: '2026-10-05', fecha_vencimiento: '2026-09-01', total: 10, pagado: 20, orden: 'OS-202610-9999' }] });
  ok(j.errores.length === 1 && j.errores[0].fila === 5 && j.errores[0].errores.length >= 4, 'CxP: errores por renglón (categoría, vencimiento, pagado > total, orden)', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: filasCxp });
  ok(s === 201 && j.importadas === 3, 'se importan 3 cuentas por pagar', j);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const manguera = j.find(x => x.concepto === 'Manguera'), lodos = j.find(x => x.concepto === 'Lodos');
  ok(manguera && manguera.saldo === 2000 && manguera.categoria === 'refacciones', 'saldo y categoría de la factura importada', manguera);
  ok(lodos && lodos.lead_id === imp.lead_id && lodos.fecha_vencimiento === '2026-11-02', 'proveedor existente con 30 días de crédito y orden ligada por folio', lodos);
  [s, j] = await pedir('GET', '/finanzas/proveedores', A);
  ok(j.filter(p => /refaccionaria vactor/i.test(p.nombre)).length === 1, 'el proveedor nuevo se creó una sola vez (sin importar mayúsculas)');
  [s, j] = await pedir('POST', '/finanzas/importar/cxp?simular=1', A, { filas: filasCxp });
  ok(j.errores.some(e => /ya está registrada/.test(e.errores.join())), 'subir otra vez las mismas facturas se detecta');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: Array.from({ length: 1001 }, (_, i) => ({ fila: i + 2 })) });
  ok(s === 400, 'más de 1,000 renglones se rechaza');

  // Correcciones de la revisión de la importación
  [s, j] = await pedir('POST', '/finanzas/importar/cxp?simular=1', A, { filas: [{ fila: 2, proveedor: 'DISPOSICIÓN DEL BAJÍO', concepto: 'Lodos', factura_folio: 'F-77', fecha_documento: '2026-10-01', total: 900 }] });
  ok(j.resumen[0].proveedor_nuevo === false && j.errores.some(e => /ya está registrada/.test(e.errores.join())), 'proveedor con acentos y mayúsculas distintas se reconoce (y su factura repetida también)', j);
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'DISPOSICION DEL BAJIO' });
  ok(s === 409, 'tampoco se puede dar de alta a mano el mismo proveedor sin acentos');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ fila: 2, telefono: '4429990001', nombre: 'Coma Decimal', direccion: 'x', servicio: servicios[0].nombre, fecha_servicio: '2026-09-01', importe: '3500,50' }] });
  ok(j.errores.length === 1 && /formato no válido/.test(j.errores[0].errores.join()), '"3500,50" (coma decimal) se rechaza en vez de guardarse como $350,050', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ fila: 2, telefono: '4429990001', nombre: 'Error Excel', direccion: 'x', servicio: servicios[0].nombre, fecha_servicio: '2026-09-01', importe: 1000, pagado: '#ERROR_EXCEL:#N/A' }] });
  ok(j.errores.length === 1 && /error de Excel \(#N\/A\)/.test(j.errores[0].errores.join()), 'una celda con #N/A se reporta como error (no como vacía)', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [
    { fila: 2, telefono: '4429990002', nombre: 'Sucursales SA', direccion: 'Sucursal Norte', servicio: servicios[0].nombre, fecha_servicio: '2026-10-03', importe: 2000, factura_folio: 'S-1', pagado: 2000 },
    { fila: 3, telefono: '4429990002', direccion: 'Sucursal Sur', servicio: servicios[0].nombre, fecha_servicio: '2026-10-03', importe: 2000, factura_folio: 'S-2' }] });
  ok(s === 201 && j.importadas === 2, 'dos sucursales con el mismo servicio, fecha e importe (distinta factura) se importan', j);
  [s, j] = await pedir('GET', '/finanzas/periodo?desde=2026-10-03&hasta=2026-10-03', A);
  ok(j.cobrado >= 2000, 'lo "ya pagado" importado cuenta como cobrado en Resultados', j);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp?simular=1', A, { filas: [null] });
  ok(s === 400, 'un renglón inválido responde 400 (no tumba el servidor)');
  const mil = Array.from({ length: 1000 }, (_, i) => ({ fila: i + 2, proveedor: 'Proveedor de prueba con nombre largo para llenar', categoria: 'Otro', concepto: 'Concepto de prueba bastante descriptivo número ' + i, factura_folio: 'MIL-' + i, fecha_documento: '2026-10-01', total: 100 + i, notas: 'n'.repeat(400) }));
  [s, j] = await pedir('POST', '/finanzas/importar/cxp?simular=1', A, { filas: mil });
  ok(s === 200 && j.total === 1000 && !j.errores.length, '1,000 renglones (más de 1 MB) se procesan sin error interno', { s, total: j.total, err: j.error });

  seccion('11. IVA');
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Restaurante IVA', telefono: '4427770001', direccion: 'Calle IVA 16', canal_origen_id: canales[0].id });
  const clienteIva = j.id;
  const part = importe => JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Servicio con IVA', importe }]);
  const altaIva = (cuerpo, token = L) => pedir('POST', '/leads', token, { cliente_id: clienteIva, direccion: 'Calle IVA 16', responsable_id: usuarioL.id, forzar_duplicado: true, ...cuerpo });
  const cuenta = async id => (await pedir('GET', '/leads/' + id + '/cobros', A))[1].cuenta;
  const verLead = async id => (await pedir('GET', '/leads/' + id, A))[1];

  [s, j] = await altaIva({ partidas_json: part(3500), iva_modo: 'mas_iva', iva_tasa: 16, valor: 99, iva_cent: 1 });
  ok(s === 201 && j.valor === 3500 && j.iva_cent === 56000 && j.iva_modo === 'mas_iva' && j.iva_tasa === 16, 'cotización "más IVA": $3,500 + IVA $560 (el servidor ignora valor e IVA del navegador)', j);
  const cotIva = j;
  [s, j] = await pedir('PUT', '/leads/' + cotIva.id, L, { version: cotIva.version, etapa: 2 });
  ok(s === 200 && j.iva_cent === 56000 && j.iva_modo === 'mas_iva', 'mover de etapa conserva el IVA', j);
  [s] = await pedir('PUT', '/leads/' + cotIva.id, L, { version: j.version, valor: 4060 });
  ok(s === 400, 'el importe no se cambia sin editar las partidas (ni poniendo el total con IVA)');
  [s, j] = await pedir('PUT', '/leads/' + cotIva.id, L, { version: j.version, estatus: 'ganado', fecha_servicio: '2026-11-20' });
  ok(s === 200 && j.estatus === 'ganado', 'cotización con IVA convertida en orden');
  const ordenMas = j;
  let c = await cuenta(ordenMas.id);
  ok(c.total === 4060 && c.saldo === 4060 && c.subtotal === 3500 && c.iva === 560 && c.total_orden === 4060 && c.dif_cfdi === null, 'la orden "más IVA" es una cuenta por cobrar de $4,060 sin capturar factura', c);

  [s, j] = await altaIva({ partidas_json: part(1500), iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: '2026-11-21' });
  ok(s === 201 && (await cuenta(j.id)).total === 1740, 'ejemplo del dueño: subtotal $1,500 → total $1,740');
  [s, j] = await altaIva({ partidas_json: part(1160), iva_modo: 'incluido', estatus: 'ganado', fecha_servicio: '2026-11-22' });
  c = await cuenta(j.id);
  ok(s === 201 && j.valor === 1000 && j.iva_cent === 16000 && c.total === 1160, 'ejemplo del dueño: $1,160 con IVA incluido → $1,000 + $160', { j, c });
  [s, j] = await altaIva({ partidas_json: part(5000), iva_modo: 'incluido', estatus: 'ganado', fecha_servicio: '2026-11-23' });
  const ordenInc = j;
  c = await cuenta(ordenInc.id);
  ok(s === 201 && j.valor === 4310.34 && j.iva_cent === 68966 && c.total === 5000, 'IVA incluido: $5,000 = $4,310.34 + $689.66', { j, c });

  [s] = await altaIva({ partidas_json: part(1000), iva_modo: 'mas_iva', iva_tasa: 8 }); ok(s === 400, 'tasa de 8 % no permitida');
  [s] = await altaIva({ partidas_json: part(1000), iva_modo: 'raro' }); ok(s === 400, 'modo de IVA inválido rechazado');
  [s] = await altaIva({ iva_modo: 'mas_iva', valor: 1000 }); ok(s === 400, 'IVA sin partidas rechazado');
  [s] = await altaIva({ partidas_json: part(100000000), iva_modo: 'mas_iva' }); ok(s === 400, 'documento con IVA de más de $100,000,000 rechazado');
  [s, j] = await altaIva({ partidas_json: part(900), estatus: 'ganado', fecha_servicio: '2026-11-24' });
  const ordenSin = j;
  ok(s === 201 && j.iva_modo === null && j.iva_cent === null && j.valor === 900 && (await cuenta(j.id)).total === 900, 'sin campos de IVA queda "por definir" y se cobra el importe como hoy', j);

  // Permisos: el IVA de una orden lo cambian solo administración o atención.
  let o = await verLead(ordenMas.id);
  [s] = await pedir('PUT', '/leads/' + ordenMas.id, L, { version: o.version, iva_modo: 'incluido' });
  ok(s === 403, 'ventas NO puede cambiar el IVA de una orden');
  [s] = await pedir('PUT', '/leads/' + ordenSin.id, L, { version: (await verLead(ordenSin.id)).version, iva_modo: 'incluido' });
  ok(s === 403, 'ventas NO puede indicar el IVA de una orden por definir (aunque el total no cambie)');
  [s, j] = await pedir('PUT', '/leads/' + ordenMas.id, L, { version: o.version, partidas_json: part(3500), iva_modo: 'mas_iva', iva_tasa: 16, operador: 'Fernando' });
  ok(s === 200 && j.iva_cent === 56000, 'ventas sí guarda la orden si no cambia el importe ni el IVA');
  [s, j] = await pedir('PUT', '/leads/' + ordenMas.id, L, { version: j.version, partidas_json: part(3500) });
  ok(s === 200 && j.iva_modo === 'mas_iva' && j.iva_cent === 56000, 'guardar partidas sin campos de IVA conserva el IVA guardado (pestañas viejas)', j);
  [s] = await pedir('PUT', '/leads/' + ordenMas.id, A, { version: j.version, iva_modo: null });
  ok(s === 400, 'un IVA ya indicado no puede volver a "por definir"');

  [s, j] = await pedir('PUT', '/leads/' + ordenSin.id, A, { version: (await verLead(ordenSin.id)).version, iva_modo: 'incluido' });
  ok(s === 200 && j.valor === 775.86 && j.iva_cent === 12414 && (await cuenta(ordenSin.id)).total === 900, 'admin indica "IVA incluido" en una orden por definir: el total sigue en $900', j);
  ok((await verLead(ordenSin.id)).historial.some(x => /IVA: IVA por definir → IVA incluido 16% en la orden; el total no cambia \(\$900\.00\)/.test(x.texto)), 'la bitácora registra que se indicó el IVA');

  // Pagos y factura sobre el total con IVA.
  [s] = await pedir('POST', '/leads/' + ordenMas.id + '/cobros', A, { monto: 4060.01, metodo: 'transferencia' });
  ok(s === 400, 'un pago mayor al total con IVA se rechaza');
  [s, j] = await pedir('PUT', '/leads/' + ordenMas.id + '/facturacion', A, { factura_folio: 'IVA-1', factura_total: 4059.99 });
  ok(s === 200 && j.cuenta.total === 4059.99 && j.cuenta.dif_cfdi === -0.01, 'un CFDI distinto manda y se avisa la diferencia', j.cuenta);
  [s, j] = await pedir('PUT', '/leads/' + ordenMas.id + '/facturacion', A, { factura_total: '' });
  ok(s === 200 && j.cuenta.total === 4060 && j.cuenta.dif_cfdi === null, 'sin CFDI capturado vuelve al total de la orden con IVA', j.cuenta);
  [s, j] = await pedir('POST', '/leads/' + ordenMas.id + '/cobros', A, { monto: 4060, metodo: 'transferencia' });
  ok(s === 201 && j.cuenta.estado === 'pagada', 'el pago del total con IVA deja la orden pagada', j.cuenta);

  [s] = await pedir('POST', '/leads/' + ordenInc.id + '/cobros', A, { monto: 4000, metodo: 'transferencia' });
  [s, j] = await pedir('PUT', '/leads/' + ordenInc.id, A, { version: (await verLead(ordenInc.id)).version, iva_modo: 'mas_iva' });
  ok(s === 200 && (await cuenta(ordenInc.id)).total === 5800, 'admin cambia una orden a "más IVA" solo con el modo: $5,000 + IVA = $5,800');
  ok((await verLead(ordenInc.id)).historial.some(x => /Importe de la orden cambiado: \$5,000\.00 → \$5,800\.00 \(IVA: IVA incluido 16% → Más IVA 16%\)/.test(x.texto)), 'la bitácora registra el cambio de total y de IVA');
  [s] = await pedir('PUT', '/leads/' + ordenInc.id, A, { version: (await verLead(ordenInc.id)).version, partidas_json: part(3000) });
  ok(s === 400, 'el total con IVA ($3,480) no puede quedar debajo de lo cobrado ($4,000)');

  // Carga masiva con la columna de IVA (vacía = por definir, como las plantillas anteriores).
  const filasIva = [
    { fila: 2, telefono: '4427770002', nombre: 'Plaza IVA', direccion: 'Local 1', servicio: servicios[0].nombre, fecha_servicio: '2026-09-05', importe: 1000, iva: 'Más IVA 16%' },
    { fila: 3, telefono: '4427770002', direccion: 'Local 1', servicio: servicios[0].nombre, fecha_servicio: '2026-09-06', importe: 1000, iva: '' },
    { fila: 4, telefono: '4427770002', direccion: 'Local 1', servicio: servicios[0].nombre, fecha_servicio: '2026-09-07', importe: 1000, iva: 'IVA incluido 16%' },
  ];
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [...filasIva, { fila: 5, telefono: '4427770002', direccion: 'Local 1', servicio: servicios[0].nombre, fecha_servicio: '2026-09-08', importe: 1000, iva: 'Sin IVA' }] });
  ok(j.errores.length === 1 && j.errores[0].fila === 5 && /IVA/.test(j.errores[0].errores.join()), 'un valor de IVA no válido se marca en su renglón', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: filasIva });
  ok(s === 201 && j.importadas === 3 && j.resumen.map(x => x.total).join() === '1160,1000,1000', 'importación con IVA: totales $1,160 / $1,000 / $1,000', j);
  [s, j] = await pedir('GET', '/finanzas/cartera?filtro=todas&q=Plaza IVA', A);
  ok(j.length === 3 && j.map(x => x.iva_modo || '').sort().join() === ',incluido,mas_iva', 'las órdenes importadas guardan su IVA', j);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ ...filasIva[0], importe: 1160, iva: '' }] });
  ok(/ya se importó/.test(j.errores?.[0]?.errores.join()), 'subir la misma orden con el total con IVA también se detecta como duplicada', j);

  const filaBase = { telefono: '4427770003', nombre: 'Textos IVA', direccion: 'Local 2', servicio: servicios[0].nombre, importe: 1000 };
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: ['IVA no incluido', 'Más IVA 8%', 'mas iva exento', 'IVA incluido 0%'].map((iva, i) => ({ ...filaBase, fila: i + 2, fecha_servicio: '2026-08-0' + (i + 1), iva })) });
  ok(j.errores?.length === 4, 'textos de IVA fuera de la lista ("IVA no incluido", "8%"…) se marcan como error', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ ...filaBase, fila: 2, fecha_servicio: '2026-08-10', importe: 90000000, iva: 'Más IVA 16%' }] });
  ok(j.errores?.length === 1 && /100,000,000/.test(j.errores[0].errores.join()), 'la importación respeta el tope del total con IVA', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ ...filaBase, fila: 2, fecha_servicio: '2026-08-11', importe: 1160 }, { ...filaBase, fila: 3, fecha_servicio: '2026-08-11', iva: 'Más IVA 16%' }] });
  ok(j.errores?.length === 1 && j.errores[0].fila === 3 && /repetida/.test(j.errores[0].errores.join()), 'en el mismo archivo, $1,160 sin IVA y $1,000 + IVA son la misma orden', j.errores);
  [s, j] = await altaIva({ partidas_json: part(3500), estatus: 'ganado', fecha_servicio: '2026-12-01', duplicado_de: ordenMas.id });
  ok(s === 201 && j.iva_modo === 'mas_iva' && j.iva_cent === 56000, 'duplicar sin mandar el IVA (versión anterior) hereda el IVA de la orden original', j);

  [s, j] = await pedir('GET', '/analisis/comercial', A);
  ok(s === 200 && j.ivaPorDefinir && j.ivaPorDefinir.servicios >= 1, 'Resultados cuenta los servicios con IVA por definir', j.ivaPorDefinir);

  seccion('12. Seguridad general');
  const raiz = await fetch(`http://localhost:${PUERTO}/`);
  ok(raiz.headers.get('content-security-policy') && raiz.headers.get('x-frame-options') === 'DENY' && !raiz.headers.get('x-powered-by'), 'encabezados de seguridad');
  [s] = await pedir('GET', '/leads', 'token-inventado'); ok(s === 401, 'token inventado rechazado');
  [s] = await pedir('POST', '/registro', null, { nombre: '<script>alert(1)</script>', correo: 'x@saneadren.com.mx', password: 'Desazolve-2026' }); ok(s === 400, 'nombre con código rechazado');
  ok(!/uncaughtException|Error no manejado/.test(salida), 'sin errores no controlados en el servidor');

  console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
  srv.kill();
  await espera(300);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
