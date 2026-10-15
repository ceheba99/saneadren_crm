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
    USUARIO_PRUEBA_NOMBRE: 'Karla Prueba', USUARIO_PRUEBA_PASSWORD: 'Pruebas-Campo-31', USUARIO_PRUEBA_ROL: 'tecnico', USUARIO_2_PASSWORD: 'Cobranza-Luis-2026' }
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
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);

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
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Luis Perea', password: 'Cobranza-Luis-2026' });
  ok(s === 200 && j.nombre === 'Luis Perea' && j.rol === 'ventas', 'Luis Perea se crea al definir USUARIO_2_PASSWORD (ventas por defecto)', j);

  seccion('2. Cuentas: solo las crea un administrador; recuperación de contraseña');
  [s, j] = await pedir('POST', '/registro', null, { nombre: 'Laura Pérez', correo: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 403 && /administrador/.test(j.error), 'nadie puede crearse una cuenta desde fuera (registro cerrado)', j);
  [s] = await pedir('POST', '/login', null, { nombre: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 401, 'ese intento no dejó ninguna cuenta');
  [s] = await pedir('POST', '/usuarios', null, { nombre: 'Laura Pérez', correo: 'laura@saneadren.com.mx', password: 'Desazolve-2026', rol: 'admin' });
  ok(s === 401, 'tampoco se crean usuarios sin sesión');
  [s] = await pedir('POST', '/usuarios', A, { nombre: 'Laura Pérez', correo: 'laura@sanedaren.com.mx', password: 'Desazolve-2026', rol: 'ventas' });
  ok(s === 400, 'correo de otro dominio rechazado');
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Laura Pérez', correo: 'laura@saneadren.com.mx', password: 'Desazolve-2026', rol: 'ventas', temporal: true });
  ok(s === 201, 'el administrador crea la cuenta con contraseña temporal', j);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 200 && j.cambiar_password, 'al entrar con la temporal se le pide cambiarla', j);
  let L = j.token;
  [s] = await pedir('GET', '/servicios', L);
  ok(s === 403, 'con la contraseña temporal no puede usar el CRM hasta cambiarla', s);
  [s, j] = await pedir('POST', '/cambiar-password', L, { actual: 'Desazolve-2026', nueva: 'Pipa-Elegida-2026' });
  ok(s === 200 && j.token, 'la cambia por una que solo ella conoce', j);
  L = j.token;
  [s, j] = await pedir('GET', '/servicios', L);
  ok(s === 200, 'ya puede usar el CRM');
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
  [s, j] = await pedir('PUT', '/leads/' + cot.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'A-123', factura_fecha: hoy, factura_total: 4060 }); // la factura no puede tener fecha futura
  ok(s === 200 && j.cuenta.total === 4060 && j.cuenta.saldo === 3060 && j.cuenta.vence === (d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 15); return x.toISOString().slice(0, 10); })(hoy), 'factura con IVA: el total pasa a $4,060 y vence en 15 días', j.cuenta);
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
  [s, j] = await pedir('POST', '/finanzas/cxp', L, { proveedor_id: provVentas.id, concepto: 'Gasto de ventas', total: 10, ya_pagado: true, metodo: 'efectivo' }); ok(s === 403, 'ventas NO registra compras sin orden de servicio (van por Solicitud de compra)');
  [s, j] = await pedir('POST', '/finanzas/cxp', L, { proveedor_id: provVentas.id, concepto: 'Casetas del viaje', total: 10, ya_pagado: true, metodo: 'efectivo', lead_id: cot.id }); ok(s === 201, 'ventas SÍ registra un costo ya pagado de un servicio');
  const gastoVentas = (await pedir('POST', '/finanzas/cxp', L, { proveedor_id: provVentas.id, concepto: 'Renta de herramienta', total: 50, dias_credito: 0, lead_id: cot.id }))[1];
  [s] = await pedir('POST', '/finanzas/cxp/' + gastoVentas.id + '/pagos', L, { monto: 50, metodo: 'efectivo' }); ok(s === 403, 'ventas NO paga a proveedores (lo hace administración o el encargado de costos)');
  [s] = await pedir('POST', '/finanzas/cxp/' + gastoVentas.id + '/cancelar', L, { motivo: 'Me equivoqué de monto' }); ok(s === 403, 'ventas NO cancela cuentas por pagar');
  await pedir('POST', '/finanzas/cxp/' + gastoVentas.id + '/cancelar', A, { motivo: 'Prueba de permisos' });
  [s] = await pedir('GET', '/admin/backup', L); ok(s === 403, 'ventas sigue SIN poder descargar la base de datos');
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Disposición del Bajío', categoria: 'residuos', dias_credito: 30 });
  ok(s === 201, 'proveedor creado');
  const prov = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Disposición 12 m3 lodos', total: 2400.5, fecha_documento: '2026-10-01', lead_id: cot.id, dias_credito: 30 });
  ok(s === 201, 'factura de proveedor a 30 días ligada a la orden');
  const cxp1 = j.id;
  [s, j] = await pedir('GET', '/finanzas/cxp', A);
  const c1 = j.find(x => x.id === cxp1);
  ok(c1 && c1.fecha_vencimiento === '2026-10-31' && c1.saldo === 2400.5, 'vencimiento calculado con los días de crédito escritos', c1);
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
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Disposición octubre', total: 500, factura_folio: 'F-77', dias_credito: 30 });
  ok(s === 201, 'factura F-77 registrada');
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Disposición octubre', total: 500, factura_folio: 'F-77', dias_credito: 30 });
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
  // Renglones con el formato de la hoja de cobranza de Saneadren (una factura por renglón).
  const filasCxc = [
    { fila: 3, serie: 'QR', folio: '2201', fecha: '2025-02-20', nombre: 'CORPORATIVO DE SERVICIOS AMBIENTALES', metodo_pago: 'PPD', subtotal: '491,985.00', iva: '$78,717.60', total: '$570,702.60', credito: 30, fecha_vence: '2025-03-22', dias_vencidos: 'PAGADO', status: 'PAGADO', fecha_pago: '17-July', cp: 'CP 1105', abonado: '491,985.00', flujo: 'QRO', observaciones: 'BANORTE' },
    { fila: 4, serie: 'QR', folio: '2484', fecha: '2025-06-25', nombre: 'Corporativo de Servicios Ambientales', metodo_pago: 'PPD', subtotal: '290,000.00', iva: '$46,400.00', total: '$336,400.00', credito: 30, fecha_vence: '2025-07-25', dias_vencidos: '-445', status: 'PENDIENTE 2025' },
    { fila: 5, serie: 'QR', folio: '2786', fecha: '2026-01-12', nombre: 'PREMIUM RESTAURANT BRANDS', metodo_pago: 'PUE', subtotal: '$2150.00', iva: '$344.00', total: '$2,494.00', credito: 30, status: 'PAGADO', fecha_pago: '19-February', cp: '990', abonado: '2,494.00', flujo: 'MX', observaciones: 'SANTANDER' },
    { fila: 6, serie: 'QR', folio: '2763', fecha: '2025-12-03', nombre: 'YUSEN LOGISTICS (MEXICO)', metodo_pago: 'PPD', subtotal: '1,850,000.00', iva: '296,000.00', status: 'CANCELADO', fecha_pago: '15-ENERO-26 CANCELADO con ACEPTACION' },
    { fila: 9, iva: '5,376,182.40', total: '36,831,322.40', abonado: '35,987,463.00' }, // renglón de totales
  ];
  [s] = await pedir('POST', '/finanzas/importar/cxc?simular=1', L, { filas: filasCxc }); ok(s === 200, 'ventas SÍ puede importar plantillas (simulación)');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [...filasCxc, { fila: 10, nombre: 'Con Errores', fecha: '2026-02-31', subtotal: -5, status: 'RARO', telefono: '123' }] });
  ok(s === 200 && j.errores.length === 1 && j.errores[0].fila === 10 && j.errores[0].errores.length >= 4, 'la simulación marca los errores por renglón', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [...filasCxc, { fila: 10, nombre: 'Con Errores' }] });
  ok(j.importadas === 0, 'con un renglón con error no se importa nada (todo o nada)');
  [s, j] = await pedir('GET', '/finanzas/cartera?filtro=todas&q=CORPORATIVO DE SERVICIOS', A);
  ok(!j.length, 'tras el intento fallido no quedó nada guardado');
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: filasCxc });
  ok(s === 200 && !j.errores.length && j.omitidas === 2 && j.resumen[0].cliente_nuevo === true && j.resumen[1].cliente_nuevo === false
    && /cancelada/.test(j.resumen[3].omitida) && /totales/.test(j.resumen[4].omitida), 'simulación: cliente nuevo una sola vez; cancelada y totales se omiten', j);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: filasCxc });
  ok(s === 201 && j.importadas === 3 && j.omitidas === 2, 'se importan 3 facturas (2 omitidas)', j);
  [s, j] = await pedir('GET', '/finanzas/cartera?vista=orden&filtro=todas&q=CORPORATIVO DE SERVICIOS', A);
  const imp = j.find(c => c.factura_folio === 'QR-2201');
  ok(j.length === 2 && imp && imp.total === 570702.6 && imp.cobrado === 491985 && imp.saldo === 78717.6 && imp.vence === '2025-03-22' && imp.iva_modo === 'mas_iva',
    'pago parcial: factura de $570,702.60 con $491,985 cobrados deja $78,717.60 de saldo', j);
  ok(j.every(c => c.cliente_id === j[0].cliente_id), 'el mismo cliente (sin importar mayúsculas) se usa en las dos facturas');
  // Cliente importado sin teléfono: puede guardar sus demás datos; el RFC se valida.
  [s, j] = await pedir('PUT', '/clientes/' + imp.cliente_id, A, { telefono: '', nombre: 'CORPORATIVO DE SERVICIOS AMBIENTALES', rfc: 'csa010101ab1' });
  ok(s === 200 && j.rfc === 'CSA010101AB1' && j.telefono === '', 'un cliente sin teléfono guarda su RFC (en mayúsculas) sin exigir teléfono', j);
  [s, j] = await pedir('PUT', '/clientes/' + imp.cliente_id, A, { rfc: 'abc' });
  ok(s === 400 && /RFC/.test(j.error), 'un RFC inválido se rechaza', j);
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Proveedor RFC Malo', rfc: '123' });
  ok(s === 400 && /RFC/.test(j.error), 'el RFC de un proveedor también se valida', j);
  [s, j] = await pedir('GET', '/leads/' + imp.lead_id + '/cobros', A);
  ok(j.cobros.length === 1 && j.cobros[0].fecha === '2025-07-17' && j.cobros[0].referencia === 'CP 1105 · BANORTE' && j.cobros[0].metodo === 'transferencia',
    'el pago queda con su fecha (17-July → 2025-07-17), complemento y banco', j.cobros);
  [s, j] = await pedir('GET', '/finanzas/cartera?vista=orden&filtro=todas&q=PREMIUM RESTAURANT', A);
  ok(j.length === 1 && j[0].estado === 'pagada' && j[0].total === 2494, 'la factura PAGADO queda pagada', j);
  [s, j] = await pedir('GET', '/leads/' + j[0].lead_id + '/cobros', A);
  ok(j.cobros[0]?.fecha === '2026-02-19', 'fecha de pago sin año (19-February) toma el año correcto', j.cobros);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: filasCxc });
  ok(j.errores.length === 3 && /ya se importó/.test(j.errores[0].errores.join()), 'subir el mismo archivo otra vez se detecta como duplicado', j.errores);

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
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ fila: 2, nombre: 'Coma Decimal', fecha: '2026-09-01', subtotal: '3500,50' }] });
  ok(j.errores.length === 1 && /formato no válido/.test(j.errores[0].errores.join()), '"3500,50" (coma decimal) se rechaza en vez de guardarse como $350,050', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ fila: 2, nombre: 'Error Excel', fecha: '2026-09-01', subtotal: 1000, abonado: '#ERROR_EXCEL:#N/A' }] });
  ok(j.errores.length === 1 && /error de Excel \(#N\/A\)/.test(j.errores[0].errores.join()), 'una celda con #N/A se reporta como error (no como vacía)', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [
    { fila: 2, serie: 'S', folio: '1', nombre: 'Sucursales SA', fecha: '2026-10-03', subtotal: 2000, status: 'PAGADO', fecha_pago: '2026-10-03', direccion: 'Sucursal Norte' },
    { fila: 3, serie: 'S', folio: '2', nombre: 'SUCURSALES SA', fecha: '2026-10-03', subtotal: 2000, direccion: 'Sucursal Sur', telefono: '4429990002' }] });
  ok(s === 201 && j.importadas === 2, 'dos facturas del mismo cliente, fecha e importe (distinto folio) se importan', j);
  [s, j] = await pedir('GET', '/finanzas/periodo?desde=2026-10-03&hasta=2026-10-03', A);
  ok(j.cobrado >= 2320, 'lo cobrado importado (PAGADO sin A/C = total con IVA) cuenta en Resultados', j);
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

  // Ninguna cotización u orden sale en ceros.
  [s, j] = await altaIva({ partidas_json: part(0), iva_modo: 'mas_iva' }); ok(s === 400 && /\$0\.00/.test(j.error), 'una cotización en $0.00 se rechaza', j);
  [s, j] = await altaIva({ partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'a', importe: 500 }, { servicio: servicios[0].nombre, leyenda: 'b', importe: 0 }]), iva_modo: 'mas_iva' });
  ok(s === 400, 'un servicio en $0.00 dentro de la cotización se rechaza', j);
  [s, j] = await altaIva({ partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'a', importe: 1, cantidad: 2, precio: 0 }]), iva_modo: 'sin_iva', estatus: 'ganado', fecha_servicio: '2026-10-01', valor: 0 });
  ok(s === 400, 'una orden de servicio con precio unitario $0 se rechaza', j);
  [s, j] = await altaIva({}); ok(s === 400 && /servicio con su precio/.test(j.error), 'no se crea una cotización sin servicios ni precio', j);
  // Notas y condiciones de la cotización (se imprimen en el documento).
  [s, j] = await altaIva({ partidas_json: part(2500), iva_modo: 'mas_iva', notas_cotizacion: '  Anticipo 50 %.\nNo incluye obra civil.  ' });
  const cotNotas = j;
  ok(s === 201 && j.notas_cotizacion === 'Anticipo 50 %.\nNo incluye obra civil.','la cotización guarda sus notas y condiciones', j);
  [s, j] = await pedir('PUT', '/leads/' + cotNotas.id, L, { version: cotNotas.version, notas_cotizacion: 'Precio especial por volumen.' });
  ok(s === 200 && j.notas_cotizacion === 'Precio especial por volumen.', 'las notas se pueden editar desde la ficha', j);
  [s, j] = await altaIva({ partidas_json: part(2500), iva_modo: 'mas_iva', notas_cotizacion: 'x'.repeat(3001) });
  ok(s === 400, 'notas de más de 3,000 caracteres se rechazan');
  // Una cotización nueva entra al Pipeline en "Cotización enviada", no en "Recolección de datos".
  ok(cotNotas.etapa === 2, 'la cotización recién creada queda en "Cotización enviada" (etapa 2)', cotNotas.etapa);
  // Convertir en orden: la fecha del servicio no puede ser anterior a la cotización.
  [s, j] = await altaIva({ partidas_json: part(1200), iva_modo: 'mas_iva', fecha_cotizacion: '2026-10-05' });
  const cotFecha = j;
  ok(s === 201 && j.fecha_cotizacion === '2026-10-05', 'cotización con fecha 05/10/2026', j);
  [s, j] = await pedir('PUT', '/leads/' + cotFecha.id, L, { version: cotFecha.version, estatus: 'ganado', fecha_servicio: '2026-10-01' });
  ok(s === 400 && /anterior a la fecha de la cotización \(05\/10\/2026\)/.test(j.error), 'no se convierte en orden con fecha de servicio anterior a la cotización', j);
  [s, j] = await pedir('PUT', '/leads/' + cotFecha.id, L, { version: cotFecha.version, estatus: 'ganado', fecha_servicio: '2026-10-05' });
  ok(s === 200 && j.estatus === 'ganado' && j.etapa === 4, 'sí se convierte con fecha igual o posterior a la cotización', j);
  [s, j] = await pedir('PUT', '/leads/' + cotFecha.id, L, { version: j.version, fecha_servicio: '2026-09-30' });
  [s, j] = await altaIva({ partidas_json: part(1200), iva_modo: 'mas_iva', fecha_cotizacion: '2099-01-01' });
  ok(s === 400 && /futura/.test(j.error), 'la fecha de la cotización no puede ser futura', j);
  ok(s === 400, 'tampoco se puede mover después la fecha de la orden antes de la cotización', j);
  // Vigencia desde la ventana de crear cotización.
  [s, j] = await altaIva({ partidas_json: part(1800), iva_modo: 'mas_iva', incluye_vigencia: true, vigencia_hasta: '2099-12-31' });
  ok(s === 201 && j.incluye_vigencia === 1 && j.vigencia_hasta === '2099-12-31', 'cotización con vigencia hasta la fecha elegida', j);
  [s, j] = await altaIva({ partidas_json: part(1800), iva_modo: 'mas_iva', incluye_vigencia: false, vigencia_hasta: '2099-12-31' });
  ok(s === 201 && j.incluye_vigencia === 0 && j.vigencia_hasta === null, 'cotización sin vigencia (no aplica)', j);
  [s, j] = await altaIva({ partidas_json: part(1800), iva_modo: 'mas_iva', incluye_vigencia: true, vigencia_hasta: '2020-01-01' });
  ok(s === 400 && /vigencia/.test(j.error), 'la vigencia no puede ser anterior a la fecha de la cotización', j);
  [s, j] = await altaIva({ partidas_json: part(3500), iva_modo: 'mas_iva', iva_tasa: 16, valor: 99, iva_cent: 1 });
  ok(s === 201 && j.valor === 3500 && j.iva_cent === 56000 && j.iva_modo === 'mas_iva' && j.iva_tasa === 16, 'cotización "más IVA": $3,500 + IVA $560 (el servidor ignora valor e IVA del navegador)', j);
  ok(j.incluye_vigencia === 1 && j.vigencia_hasta === null, 'sin indicar vigencia, la cotización la incluye (15 días en el documento)', j);
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
  ok(s === 201 && (await cuenta(j.id)).total === 1740, 'ejemplo: subtotal $1,500 → total $1,740');
  [s, j] = await altaIva({ partidas_json: part(1160), iva_modo: 'incluido', estatus: 'ganado', fecha_servicio: '2026-11-22' });
  c = await cuenta(j.id);
  ok(s === 201 && j.valor === 1000 && j.iva_cent === 16000 && c.total === 1160, 'ejemplo: $1,160 con IVA incluido → $1,000 + $160', { j, c });
  [s, j] = await altaIva({ partidas_json: part(5000), iva_modo: 'incluido', estatus: 'ganado', fecha_servicio: '2026-11-23' });
  const ordenInc = j;
  c = await cuenta(ordenInc.id);
  ok(s === 201 && j.valor === 4310.34 && j.iva_cent === 68966 && c.total === 5000, 'IVA incluido: $5,000 = $4,310.34 + $689.66', { j, c });

  [s, j] = await altaIva({ partidas_json: part(1000), iva_modo: 'sin_iva', iva_tasa: 16, estatus: 'ganado', fecha_servicio: '2026-11-25' });
  const ordenSinIva = j;
  ok(s === 201 && j.valor === 1000 && j.iva_cent === 0 && j.iva_tasa === 0 && (await cuenta(j.id)).total === 1000, 'sin IVA: $1,000 se cobran $1,000 (tasa 0)', j);
  [s, j] = await pedir('PUT', '/leads/' + ordenSinIva.id, A, { version: ordenSinIva.version, iva_modo: 'mas_iva' });
  ok(s === 200 && j.iva_tasa === 16 && (await cuenta(ordenSinIva.id)).total === 1160, 'pasar una orden de sin IVA a más IVA usa el 16 %', j);
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

  // Carga masiva: el IVA sale de las columnas SUBTOTAL / IVA / TOTAL.
  const filasIva = [
    { fila: 2, folio: 'P-1', nombre: 'Plaza IVA', fecha: '2026-09-05', subtotal: 1000, iva: 160, total: 1160 },
    { fila: 3, folio: 'P-2', nombre: 'Plaza IVA', fecha: '2026-09-06', subtotal: 1000, iva: 0, total: 1000 },
    { fila: 4, folio: 'P-3', nombre: 'Plaza IVA', fecha: '2026-09-07', subtotal: 1000 },
    { fila: 5, folio: 'P-4', nombre: 'Plaza IVA', fecha: '2026-09-08', subtotal: 1000, iva: 160, total: '1,159.99' },
  ];
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: filasIva });
  ok(s === 201 && j.importadas === 4 && j.resumen.map(x => x.total).join() === '1160,1000,1160,1159.99', 'IVA desde la plantilla: 16 %, IVA 0 = sin IVA, IVA vacío = 16 %, y el TOTAL de la factura manda', j);
  [s, j] = await pedir('GET', '/finanzas/cartera?filtro=todas&q=Plaza IVA', A);
  ok(j.length === 4 && j.map(x => x.iva_modo).sort().join() === 'mas_iva,mas_iva,mas_iva,sin_iva' && j.some(x => x.dif_cfdi === -0.01), 'las órdenes importadas guardan su IVA y avisan si el total de la factura difiere', j);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [
    { fila: 2, folio: 'T-1', nombre: 'Tope IVA', fecha: '2026-08-10', subtotal: 90000000, iva: 14400000 },
    { fila: 3, folio: 'T-2', nombre: 'Tope IVA', fecha: '2026-08-10', subtotal: 100, iva: 'abc' },
    { fila: 4, folio: 'T-2', nombre: 'Tope IVA', fecha: '2026-08-10', subtotal: 100, status: 'PAGADO', fecha_pago: 'ayer' }] });
  ok(j.errores?.length === 3 && /100,000,000/.test(j.errores[0].errores.join()) && /IVA/.test(j.errores[1].errores.join()) && /repetida/.test(j.errores[2].errores.join()) && /pago/.test(j.errores[2].errores.join()),
    'tope del total con IVA, IVA no válido, factura repetida y fecha de pago incomprensible se marcan', j.errores);
  [s, j] = await altaIva({ partidas_json: part(3500), estatus: 'ganado', fecha_servicio: '2026-12-01', duplicado_de: ordenMas.id });
  ok(s === 201 && j.iva_modo === 'mas_iva' && j.iva_cent === 56000, 'duplicar sin mandar el IVA (versión anterior) hereda el IVA de la orden original', j);

  [s, j] = await pedir('GET', '/analisis/comercial', A);
  ok(s === 200 && j.ivaPorDefinir && j.ivaPorDefinir.servicios >= 1, 'Resultados cuenta los servicios con IVA por definir', j.ivaPorDefinir);

  seccion('12. Cantidad × precio unitario, proyecto y Generador');
  const partCant = JSON.stringify([
    { servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 1, cantidad: 3, precio: 1166.67 },
    { servicio: servicios[1].nombre, leyenda: 'Bombeo', importe: 1, cantidad: 2.5, precio: 400 }]);
  [s, j] = await altaIva({ partidas_json: partCant, iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: '2026-09-15', proyecto: 'Planta Norte 2026', equipo: 'E-37-04', operador: 'Diego Arturo' });
  const ordenGen = j;
  ok(s === 201 && j.valor === 4500.01 && j.iva_cent === 72000 && j.proyecto === 'Planta Norte 2026' && JSON.parse(j.partidas_json)[0].importe === 3500.01,
    'el servidor calcula importe = cantidad × precio (3 × 1,166.67 + 2.5 × 400 = 4,500.01) y guarda el proyecto', j);
  [s] = await altaIva({ partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 1, cantidad: 0, precio: 100 }]), iva_modo: 'mas_iva' });
  ok(s === 400, 'cantidad 0 se rechaza');
  [s, j] = await pedir('GET', '/generador?q=Planta Norte', L);
  ok(s === 200 && j.filas.length === 0, 'una orden que no se ha marcado como realizada no aparece en el generador', j.filas);
  [s, j] = await pedir('POST', '/leads/' + ordenGen.id + '/ejecucion', L, { estado: 'realizado', fecha: '2026-09-15', realizado_por: 'subcontratado', gastos: [] });
  ok(s === 400 && /subcontrat/.test(j.error), 'si se subcontrató, exige registrar lo que se le paga al tercero', j);
  [s, j] = await pedir('POST', '/leads/' + ordenGen.id + '/ejecucion', L, { estado: 'realizado', fecha: '2099-01-01', realizado_por: 'propio' });
  ok(s === 400, 'la fecha de realizado no puede ser futura');
  [s, j] = await pedir('POST', '/leads/' + ordenGen.id + '/ejecucion', L, { estado: 'realizado', fecha: '2026-09-15', realizado_por: 'propio' });
  ok(s === 200 && j.lead.ejecucion === 'realizado' && j.lead.realizado_por === 'propio' && j.gastos === 0, 'servicio realizado por nuestro equipo sin gastos', j);
  [s, j] = await pedir('GET', '/generador?desde=2026-09-15&hasta=2026-09-15&q=Planta Norte', L);
  const g = j.filas || [];
  ok(s === 200 && g.length === 2 && g[0].mes === 'SEPTIEMBRE' && g[0].orden === 'OS-' + ordenGen.created_at.slice(0, 7).replace('-', '') + '-' + String(ordenGen.id).padStart(4, '0')
    && g[0].cantidad === 3 && g[0].precio_sin_iva === 1166.67 && g[0].unidad === 'E-37-04' && g[0].empleado === 'Diego Arturo' && g[0].proyecto === 'Planta Norte 2026' && g[0].cliente === 'Restaurante IVA',
    'el generador da un renglón por servicio con mes, orden, cantidad, precio, unidad, empleado, proyecto y cliente', g);
  ok(j.totales.subtotal === 4500.01 && j.totales.iva === 720 && j.totales.total === 5220.01 && Math.round((g[0].total + g[1].total) * 100) === 522001,
    'los renglones del generador suman exactamente el subtotal, IVA y total de la orden', j.totales);
  [s] = await pedir('GET', '/generador?desde=2026-12-01&hasta=2026-01-01', L); ok(s === 400, 'generador: periodo al revés rechazado');
  // Servicio realizado por un tercero: gasto ligado a la orden, pagado por nómina.
  [s, j] = await pedir('PUT', '/leads/' + ordenGen.id, A, { version: (await pedir('GET', '/leads/' + ordenGen.id, A))[1].version, manifiestos: 'M-1020', tiros: '2' });
  ok(s === 200 && j.manifiestos === 'M-1020' && j.tiros === '2', 'la orden guarda manifiestos y tiros', j);
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas del Centro' });
  const pipas = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: pipas.id, concepto: 'Renta de pipas', total: 7500, fecha_documento: '2026-09-15', lead_id: ordenGen.id, ya_pagado: true, metodo: 'nomina', fecha_pago: '2026-09-17', referencia: 'Semana 38' });
  ok(s === 201, 'costo con tercero registrado como pagado por nómina', j);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ordenGen.id, A);
  ok(j.length === 1 && j[0].saldo === 0 && /^2026-09-17\|nomina\|Semana 38$/.test(j[0].ultimo_pago) && j[0].orden_folio === g[0].orden, 'los costos de una orden se consultan por la orden', j);
  [s, j] = await pedir('GET', '/generador?desde=2026-09-15&hasta=2026-09-15&q=Planta Norte', L);
  ok(j.filas[0].proveedor === 'Pipas del Centro' && j.filas[0].concepto === 'Renta de pipas' && j.filas[0].costo === 7500 && j.filas[0].estatus_pago === 'Pagado 17/09/2026'
    && j.filas[0].via_pago === 'Nómina · Semana 38' && j.filas[0].manifiestos === 'M-1020' && j.filas[0].tiros === '2' && j.filas[1].costo === null && j.totales.costo === 7500,
    'el generador muestra proveedor, concepto, costo, estatus y vía de pago (una vez por orden)', j.filas);

  // Servicio subcontratado: al marcarlo realizado, el pago al tercero y otros gastos se cargan en Cuentas por pagar.
  [s, j] = await altaIva({ partidas_json: part(27510), iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: '2026-10-01', equipo: 'C-22', operador: 'Eduardo Hernández' });
  const ordenSub = j;
  [s, j] = await pedir('POST', '/leads/' + ordenSub.id + '/ejecucion', L, { estado: 'realizado', fecha: '2026-10-01', realizado_por: 'subcontratado', gastos: [
    { proveedor_id: pipas.id, categoria: 'subcontratacion', concepto: 'Renta de pipas', total: '7,500.00', ya_pagado: true, metodo: 'nomina', fecha_pago: '2026-10-02', referencia: 'Semana 40' },
    { proveedor_id: pipas.id, categoria: 'casetas_viaticos', concepto: 'Casetas', total: 350 }] });
  ok(s === 200 && j.gastos === 2 && j.lead.realizado_por === 'subcontratado', 'servicio subcontratado: se registran 2 gastos', j);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ordenSub.id, A);
  ok(j.length === 2 && j.find(x => x.concepto === 'Renta de pipas')?.saldo === 0 && j.find(x => x.concepto === 'Casetas')?.saldo === 350 && j.every(x => x.equipo === 'C-22'),
    'los gastos quedan en Cuentas por pagar ligados a la orden (el pagado por nómina con saldo 0, el otro pendiente)', j);
  [s, j] = await pedir('GET', '/generador?desde=2026-10-01&hasta=2026-10-01', L);
  const filaSub = j.filas.find(f => f.lead_id === ordenSub.id);
  ok(filaSub && filaSub.realizado_por === 'Subcontratado' && filaSub.costo === 7850 && filaSub.estatus_pago.startsWith('Pagado en parte') && filaSub.via_pago === 'Nómina · Semana 40',
    'el generador muestra el servicio subcontratado con su costo total y el estatus de pago', filaSub);
  // Cuentas por cobrar: la orden realizada se cobra con los datos de su ejecución; el crédito corre desde que se realizó.
  const enCartera = async id => (await pedir('GET', '/finanzas/cartera?filtro=todas', A))[1].find(c => c.lead_id === id);
  let cxc = await enCartera(ordenSub.id);
  ok(cxc && cxc.ejecucion === 'realizado' && cxc.fecha_realizado === '2026-10-01' && cxc.realizado_por === 'subcontratado' && cxc.equipo === 'C-22' && cxc.operador === 'Eduardo Hernández'
    && cxc.total === 31911.6 && cxc.subtotal === 27510 && cxc.iva === 4401.6 && cxc.vence >= '2026-10-01' && !cxc.programada,
    'Cuentas por cobrar: la orden realizada aparece con total con IVA, fecha y quién la realizó, unidad y operador', cxc);
  [s, j] = await altaIva({ partidas_json: part(900), iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: '2099-01-15' });
  const ordenAdelantada = j;
  ok((await enCartera(ordenAdelantada.id))?.programada === true, 'una orden programada a futuro aún no se cobra (servicio programado)');
  await pedir('POST', '/leads/' + ordenAdelantada.id + '/ejecucion', L, { estado: 'realizado', realizado_por: 'propio' });
  cxc = await enCartera(ordenAdelantada.id);
  [s, j] = await altaIva({ partidas_json: part(700), iva_modo: 'sin_iva', estatus: 'ganado', fecha_servicio: '2026-09-20' });
  const sinMarcar = j.id;
  [s, j] = await pedir('GET', '/finanzas/cartera?filtro=por_concluir', A);
  ok(s === 200 && j.some(c => c.lead_id === sinMarcar && c.por_concluir) && !j.some(c => c.ejecucion === 'realizado'), 'filtro "Falta marcar realizado": órdenes con fecha pasada sin marcar', j.map(c => c.lead_id));
  ok(cxc && !cxc.programada && cxc.ejecucion === 'realizado' && cxc.saldo === 1044, 'si se realiza antes de su fecha, ya se cobra (deja de estar programada)', cxc);
  [s, j] = await pedir('POST', '/leads/' + ordenSub.id + '/ejecucion', L, { estado: 'no_realizado', motivo: 'no' });
  ok(s === 400, 'no realizado exige motivo');
  [s, j] = await pedir('POST', '/leads/' + ordenSub.id + '/ejecucion', L, { estado: 'no_realizado', motivo: 'El cliente canceló el día del servicio' });
  ok(s === 200 && j.lead.ejecucion === 'no_realizado', 'servicio marcado como no realizado', j);
  ok(!(await enCartera(ordenSub.id)), 'una orden NO realizada (sin pagos) sale de Cuentas por cobrar');
  [s, j] = await pedir('GET', '/generador?desde=2026-10-01&hasta=2026-10-01', L);
  ok(!j.filas.some(f => f.lead_id === ordenSub.id), 'una orden no realizada sale del generador');

  // Duplicar una orden con costos con terceros: se copian a la nueva orden, pendientes de pago.
  const costosSub = (await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ordenSub.id, A))[1];
  const renta = costosSub.find(x => x.concepto === 'Renta de pipas');
  [s, j] = await altaIva({ partidas_json: part(27510), iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: '2026-11-01', duplicado_de: ordenSub.id, costos_duplicar: [{ cxp_id: ordenGen.id + 99999, total: 1 }] });
  ok(s === 400 && /no pertenece/.test(j.error), 'no se puede copiar un costo que no es de la orden original', j);
  [s, j] = await altaIva({ partidas_json: part(27510), iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: '2026-11-01', equipo: 'C-22', duplicado_de: ordenSub.id, costos_duplicar: [{ cxp_id: renta.id, total: '8,000.00' }] });
  const ordenDup = j;
  ok(s === 201 && ordenDup.duplicado_de === ordenSub.id, 'orden duplicada con su costo con tercero', j);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ordenDup.id, A);
  ok(j.length === 1 && j[0].concepto === 'Renta de pipas' && j[0].proveedor_id === renta.proveedor_id && j[0].total === 8000 && j[0].saldo === 8000 && j[0].fecha_documento === '2026-11-01' && j[0].equipo === 'C-22',
    'el costo copiado queda en la nueva orden con el monto ajustado y pendiente de pago (la original no cambia)', j);
  ok((await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ordenSub.id, A))[1].length === 2, 'la orden original conserva sus costos');
  ok((await pedir('GET', '/leads/' + ordenDup.id, A))[1].historial.some(h => /Costos con terceros copiados/.test(h.texto)), 'la bitácora de la nueva orden registra los costos copiados');

  // Calendario: órdenes por fecha de servicio, alertas, cobros y pagos que vencen.
  [s, j] = await pedir('GET', '/calendario?desde=2026-11-30&hasta=2026-11-01', A); ok(s === 400, 'calendario: rango invertido rechazado');
  [s, j] = await pedir('GET', '/calendario?desde=2026-01-01&hasta=2026-12-31', A); ok(s === 400, 'calendario: rango de más de 100 días rechazado');
  [s, j] = await pedir('POST', '/leads/' + ordenDup.id + '/historial', A, { tipo: 'alerta', texto: 'Llamar para confirmar acceso', fecha_alerta: '2026-11-01T09:30' });
  const costoDup = (await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + ordenDup.id, A))[1][0];
  [s, j] = await pedir('GET', '/calendario?desde=2026-10-26&hasta=2026-12-06', L);
  const evs = j.eventos || [];
  ok(s === 200 && evs.some(e => e.tipo === 'orden' && e.lead_id === ordenDup.id && e.fecha === '2026-11-01' && /^OS-/.test(e.titulo)), 'calendario: la orden aparece en su fecha de servicio', evs.filter(e => e.tipo === 'orden'));
  ok(evs.some(e => e.tipo === 'alerta' && e.lead_id === ordenDup.id && e.fecha === '2026-11-01' && e.hora === '09:30' && e.estado === 'pendiente'), 'calendario: la alerta aparece con su hora', evs.filter(e => e.tipo === 'alerta'));
  ok(evs.some(e => e.tipo === 'cobro' && e.lead_id === cot.id && e.fecha === (d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 15); return x.toISOString().slice(0, 10); })(hoy) && e.monto > 0), 'calendario: el cobro aparece el día que vence', evs.filter(e => e.tipo === 'cobro'));
  ok(costoDup.fecha_vencimiento < '2026-10-26' || costoDup.fecha_vencimiento > '2026-12-06' || evs.some(e => e.tipo === 'pago' && e.cxp_id === costoDup.id && e.fecha === costoDup.fecha_vencimiento && e.monto === 8000), 'calendario: el pago al proveedor aparece el día que vence', evs.filter(e => e.tipo === 'pago'));
  ok(!evs.some(e => e.fecha < '2026-10-26' || e.fecha > '2026-12-06'), 'calendario: solo eventos dentro del rango');

  seccion('13. Pipeline: contactos sin cotización');
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Solo Contacto', telefono: '4427770099', canal_origen_id: canales[0].id });
  const soloId = j.id;
  [s, j] = await pedir('GET', '/contactos/sin-cotizacion?q=Solo Contacto', L);
  ok(s === 200 && j.length === 1 && j[0].id === soloId, 'un contacto guardado sin cotización aparece para el Pipeline', j);
  [s, j] = await pedir('GET', '/contactos/sin-cotizacion', L);
  ok(!j.some(c => c.id === clienteId), 'un contacto con cotizaciones u órdenes no aparece como "sin cotización"');
  await pedir('POST', '/leads', L, { cliente_id: soloId, direccion: 'x', responsable_id: usuarioL.id, partidas_json: part(500), iva_modo: 'mas_iva' });
  [s, j] = await pedir('GET', '/contactos/sin-cotizacion?q=Solo Contacto', L);
  ok(s === 200 && j.length === 0, 'al crearle su cotización deja de aparecer como contacto (ya está como cotización)');

  seccion('14. Seguridad general');
  const raiz = await fetch(`http://localhost:${PUERTO}/`);
  ok(raiz.headers.get('content-security-policy') && raiz.headers.get('x-frame-options') === 'DENY' && !raiz.headers.get('x-powered-by'), 'encabezados de seguridad');
  [s] = await pedir('GET', '/leads', 'token-inventado'); ok(s === 401, 'token inventado rechazado');
  [s] = await pedir('POST', '/usuarios', A, { nombre: '<script>alert(1)</script>', correo: 'x@saneadren.com.mx', password: 'Desazolve-2026', rol: 'ventas' }); ok(s === 400, 'nombre con código rechazado');
  ok(!/uncaughtException|Error no manejado/.test(salida), 'sin errores no controlados en el servidor');

  console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
  srv.kill();
  await espera(300);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
