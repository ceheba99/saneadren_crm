// REVISIÓN DESDE LA PANTALLA (lo que el usuario ve y puede hacer), sobre el demo con sus roles:
//  1. Formularios como los manda la pantalla, con lo marcado «(opcional)» vacío y el rol que los usa: el servidor los acepta.
//     (Y la orden en los gastos, que dice «(obligatorio)» para quien no mueve dinero, sí se exige.)
//  2. Datos que antes no se veían: el motivo de las cotizaciones no aceptadas y la encuesta salen en Resultados.
//  3. Usuarios desactivados: se reactivan (y su nombre o correo ya no queda bloqueado para siempre).
//  4. Deshacer, solo Dirección y con registro: servicio realizado → «por realizar», recepción de una orden de compra,
//     aviso resuelto → reabierto.
// Uso: node tests/simulacion-revision-pantallas.cjs   (base temporal en modo demo; no toca saneadren.db)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-revision-')); const PUERTO = String(5900 + Math.floor(Math.random() * 300));
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '1', PORT: PUERTO, DB_PATH: path.join(dir, 'r.db'), APP_URL: 'http://localhost:' + PUERTO, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(extra || {}) }, body: b === undefined ? undefined : (Buffer.isBuffer(b) ? b : JSON.stringify(b)) }); const tx = await x.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; } return [x.status, j]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const PDF = Buffer.from('%PDF-1.4\n% prueba\n%%EOF');

(async () => {
  for (let i = 0; i < 400; i++) { await espera(250); try { const [, e] = await pedir('GET', '/demo/estado'); if (e.listo) break; } catch { /* arrancando */ } }
  const T = {}, ID = {};
  for (const rol of ['admin', 'ventas', 'costos', 'tecnico', 'atencion', 'rh', 'supervisor']) { const [s, j] = await pedir('POST', '/demo/entrar', null, { rol }); if (s !== 200) throw new Error(rol + ' ' + JSON.stringify(j)); T[rol] = j.token; ID[rol] = j.id; }
  const [, canales] = await pedir('GET', '/canales', T.ventas), [, servicios] = await pedir('GET', '/servicios', T.ventas);
  const [, cats] = await pedir('GET', '/finanzas/categorias', T.admin), [, provs] = await pedir('GET', '/finanzas/proveedores', T.admin);
  const [, centros] = await pedir('GET', '/compras/centros', T.costos), [, sectores] = await pedir('GET', '/prospeccion/sectores', T.ventas);
  const [, sucs] = await pedir('GET', '/sucursales', T.admin); const qro = sucs.sucursales.find(s => s.clave === 'QRO') || sucs.sucursales[0];
  const partidas = (imp = 1000) => JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Prueba', importe: imp, cantidad: 1, precio: imp }]);
  let s, j;

  console.log('1. Formularios con lo «opcional» vacío, como los manda la pantalla');
  [s, j] = await pedir('POST', '/contactos', T.ventas, { canal_origen_id: String(canales[0].id), nombre: 'Contacto Opcionales Vacios', telefono: '442 777 1001', empresa_contacto: '', direccion: '', correo: '', giro: '', telefono_alterno: '', rfc: '', notas_generales: '' });
  const cli = j; revisa(s === 201, 'alta de contacto (ventas)', j);
  [s, j] = await pedir('PUT', '/clientes/' + cli.id, T.ventas, { telefono: '4427771001', telefono_alterno: '', nombre: 'Contacto Opcionales Vacios', correo: '', empresa_contacto: '', rfc: '', direccion: '', giro: '', notas_generales: '', canal_origen_id: canales[0].id });
  revisa(s === 200, 'guardar su ficha (ventas)', j);
  const base = { telefono: '4427771001', nombre: 'Contacto Opcionales Vacios', empresa_contacto: null, cliente_id: cli.id, establecimiento_id: null, partidas_json: partidas(), canal_id: canales[0].id, direccion: 'Planta', servicio_id: String(servicios[0].id), responsable_id: ID.ventas, forzar_duplicado: true, iva_modo: 'mas_iva' };
  [s, j] = await pedir('POST', '/leads', T.ventas, { ...base, valor: null, fecha_servicio: null, fecha_cotizacion: HOY, incluye_vigencia: true, notas_cotizacion: '', vigencia_hasta: HOY });
  const cot = j; revisa(s === 201, 'cotización nueva sin importe ni notas (ventas)', j);
  [s, j] = await pedir('POST', '/leads', T.ventas, { ...base, valor: 1000, fecha_servicio: HOY, estatus: 'ganado', equipo: '', operador: '', observaciones: '', proyecto: '', manifiestos: '', tiros: '' });
  const orden = j; revisa(s === 201, 'orden nueva con lo opcional vacío (ventas)', j);
  [s, j] = await pedir('POST', '/usuarios', T.admin, { nombre: 'Usuario Sin Correo', password: 'Clave-Prueba-2026', rol: 'ventas', correo: null, temporal: false, sucursales: [qro.id] });
  revisa(s === 201, 'usuario nuevo sin correo (Dirección)', j);
  for (const [rol, nombre] of [['admin', 'Ferreteria Del Norte'], ['costos', 'Grúas Industriales Bajío']]) {
    [s, j] = await pedir('POST', '/finanzas/proveedores', T[rol], { nombre, categoria: cats[0].clave, dias_credito: '0', rfc: '', telefono: '', contacto: '', clabe: '', banco: '' });
    revisa(s === 201, `proveedor nuevo con lo opcional vacío (${rol})`, j);
  }
  const gasto = lead => ({ proveedor_id: provs[0].id, categoria: cats[0].clave, concepto: 'Gasto de prueba', total: '116', fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'recibo', metodo_sat: null, beneficiario: null, iva: null, factura_folio: '', lead_id: lead, equipo: '', ya_pagado: false, metodo: null, fecha_pago: null, referencia: null });
  for (const rol of ['admin', 'costos']) { [s, j] = await pedir('POST', '/finanzas/cxp', T[rol], gasto(null)); revisa(s === 201, `gasto sin orden (${rol}: mueve dinero, la orden es opcional)`, j); }
  for (const rol of ['tecnico', 'ventas', 'atencion']) { [s, j] = await pedir('POST', '/finanzas/cxp', T[rol], gasto(null)); revisa(s === 403, `gasto sin orden (${rol}): se exige, como dice «(obligatorio)» en su pantalla`, [s, j]); }
  [s, j] = await pedir('POST', '/finanzas/cxp', T.admin, gasto(orden.id)); const g = j; revisa(s === 201, 'gasto ligado a la orden', j);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + g.id + '/pagos', T.admin, { monto: '10', metodo: 'transferencia', fecha: HOY, referencia: '', cuenta_origen: '' }); revisa(s === 201, 'pago a proveedor sin referencia ni cuenta', j);
  for (const rol of ['admin', 'atencion', 'ventas']) { [s, j] = await pedir('POST', '/leads/' + orden.id + '/cobros', T[rol], { monto: '10', metodo: 'transferencia', fecha: HOY, referencia: '', notas: '' }); revisa(s === 201, `cobro sin referencia ni nota (${rol})`, j); }
  for (const rol of ['tecnico', 'ventas', 'costos']) { [s, j] = await pedir('POST', '/compras/solicitudes', T[rol], { que: 'Guantes de nitrilo ' + rol, para_que: 'Para la cuadrilla de limpieza', centro_id: centros[0].id, fecha_requerida: null, equipo: '', lead_id: null, urgente: false }); revisa(s === 201, `solicitud de compra mínima (${rol})`, j); }
  [s, j] = await pedir('POST', '/compras/ordenes', T.costos, { proveedor_id: provs[0].id, centro_id: centros[0].id, categoria: cats[0].clave, factura_a: '', fecha: HOY, fecha_requerida: null, lead_id: null, nota: '', observaciones: '', solicitante_nombre: '', solicitante_cargo: '', iva_modo: 'mas_iva', partidas: [{ cantidad: 1, descripcion: 'Material de prueba', unidad: 'PZA', clave: '', precio: 100 }] });
  const oc = j; revisa(s === 201, 'orden de compra con lo opcional vacío (compras)', j);
  [s, j] = await pedir('POST', '/personal', T.rh, { nombre: 'Persona Campos Vacios', puesto: 'Operador', telefono: '', correo: '', direccion: '', fecha_ingreso: null, contacto_emergencia: '', tel_emergencia: '', licencia_tipo: null, licencia_numero: '', licencia_vence: null, notas: '', usuario_id: null, banco: '', clabe: '', rfc: '', curp: '', nss: '', salario: null, salario_periodo: null, tipo_contrato: null, contrato_vence: null });
  revisa(s === 201, 'persona nueva solo con nombre y puesto (RH)', j);
  [s, j] = await pedir('POST', '/prospeccion', T.ventas, { nombre: 'Plaza Vacia', sector_id: sectores[0].id, zona: 'Querétaro', direccion: '', telefono: '', correo: '', persona: '', cargo: '', fuente: '', necesidades: '', estado: 'investigar', responsable_id: ID.ventas, proximo_contacto: '' });
  revisa(s === 201, 'establecimiento con lo opcional vacío (ventas)', j);

  console.log('2. Lo que antes no se veía: por qué no se aceptan las cotizaciones y la encuesta');
  let [, c2] = await pedir('GET', '/leads/' + cot.id, T.ventas);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, T.ventas, { version: c2.version, estatus: 'perdido', motivo_perdida: 'Eligió a otro proveedor más barato' });
  revisa(s === 200, 'la cotización se marca como no aceptada, con su motivo', j);
  [s, j] = await pedir('GET', '/leads/' + cot.id, T.ventas); revisa(j.motivo_perdida === 'Eligió a otro proveedor más barato', 'la ficha de la cotización tiene el motivo (se muestra arriba)', j.motivo_perdida);
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', T.admin, { estado: 'realizado', fecha: HOY }); revisa(s === 200, 'la orden se marca realizada', j);
  let [, o2] = await pedir('GET', '/leads/' + orden.id, T.admin);
  [s, j] = await pedir('PUT', '/leads/' + orden.id, T.admin, { version: o2.version, encuesta_calificacion: 3, encuesta_comentario: 'Bien, llegaron puntuales' });
  revisa(s === 200, 'la encuesta del cliente se captura en la orden', j);
  [s, j] = await pedir('GET', `/tablero?desde=${HOY.slice(0, 8)}01&hasta=${HOY}&tipo=mes`, T.admin);
  revisa(s === 200 && (j.perdidas || []).some(x => x.id === cot.id && x.motivo_perdida === 'Eligió a otro proveedor más barato'), 'Resultados lista la cotización no aceptada con su motivo', (j.perdidas || []).slice(0, 3));
  revisa(j.actual?.encuestas >= 1 && j.actual?.calificacion >= 1 && j.actual?.calificacion <= 4, 'Resultados muestra la satisfacción (promedio de encuestas)', [j.actual?.encuestas, j.actual?.calificacion]);

  console.log('3. Usuarios desactivados: se reactivan');
  [s, j] = await pedir('POST', '/usuarios', T.admin, { nombre: 'Vendedor Que Regresa', password: 'Clave-Volver-2026x', rol: 'ventas', correo: 'regresa@saneadren.com.mx', sucursales: [qro.id] });
  const vu = j; revisa(s === 201, 'se crea a «Vendedor Que Regresa»', j);
  [s] = await pedir('DELETE', '/usuarios/' + vu.id, T.admin); revisa(s === 200, 'se desactiva', s);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Vendedor Que Regresa', password: 'Clave-Volver-2026x' }); revisa(s >= 400, 'ya no puede entrar', s);
  [s, j] = await pedir('POST', '/usuarios', T.admin, { nombre: 'Vendedor Que Regresa', password: 'Otra-Clave-2026x', rol: 'ventas', sucursales: [qro.id] });
  revisa(s === 409 && j.codigo === 'USUARIO_DESACTIVADO' && j.usuario_id === vu.id, 'crear otro con su nombre: avisa que existe desactivado (y se ofrece reactivarlo)', j);
  [s, j] = await pedir('POST', '/usuarios', T.admin, { nombre: 'Otro Nombre Cualquiera', password: 'Otra-Clave-2026x', rol: 'ventas', correo: 'regresa@saneadren.com.mx', sucursales: [qro.id] });
  revisa(s === 409 && j.codigo === 'USUARIO_DESACTIVADO', 'con su correo: igual', j);
  [s, j] = await pedir('GET', '/usuarios/desactivados', T.admin); revisa(s === 200 && j.some(u => u.id === vu.id), 'aparece en «Usuarios desactivados»', s);
  [s] = await pedir('GET', '/usuarios/desactivados', T.ventas); revisa(s === 403, 'ventas no ve esa lista', s);
  [s] = await pedir('POST', '/usuarios/' + vu.id + '/reactivar', T.ventas, {}); revisa(s === 403, 'ventas no reactiva usuarios', s);
  [s, j] = await pedir('POST', '/usuarios/' + vu.id + '/reactivar', T.admin, {}); revisa(s === 200, 'Dirección lo reactiva', j);
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Vendedor Que Regresa', password: 'Clave-Volver-2026x' }); revisa(s === 200 && j.cambiar_password === true, 'vuelve a entrar y debe cambiar su contraseña', [s, j.cambiar_password]);
  [s] = await pedir('POST', '/usuarios/' + vu.id + '/reactivar', T.admin, {}); revisa(s === 404, 'reactivar a alguien activo: no aplica', s);
  [s, j] = await pedir('GET', '/auditoria?entidad=usuario&id=' + vu.id, T.admin); revisa(j.some(a => a.accion === 'reactivado'), 'la reactivación queda en la bitácora', j.map(a => a.accion));
  // Personal: la persona regresa pero su cuenta sigue desactivada → se avisa.
  [s, j] = await pedir('POST', '/usuarios', T.admin, { nombre: 'Tecnico Con Cuenta', password: 'Clave-Tecnico-2026', rol: 'tecnico', sucursales: [qro.id] }); const tu = j;
  [s, j] = await pedir('POST', '/personal', T.admin, { nombre: 'Técnico Con Cuenta', puesto: 'Técnico', usuario_id: tu.id, sucursal_id: qro.id }); const per = j;
  [s, j] = await pedir('POST', '/personal/' + per.id + '/baja', T.admin, { motivo: 'Renuncia voluntaria', desactivar_usuario: true }); revisa(s === 200, 'baja de la persona y de su cuenta', j);
  [s, j] = await pedir('POST', '/personal/' + per.id + '/reactivar', T.admin, {}); revisa(s === 200 && /cuenta del sistema sigue desactivada/.test(j.aviso || ''), 'al reactivar a la persona avisa que su cuenta sigue desactivada', j.aviso);

  console.log('4. Deshacer (solo Dirección, con motivo y registro)');
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', T.ventas, { estado: 'pendiente', motivo: 'Se marcó por error' }); revisa(s === 403, 'ventas no regresa un servicio a «por realizar»', s);
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', T.admin, { estado: 'pendiente' }); revisa(s === 400, 'sin motivo no se regresa', s);
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', T.admin, { estado: 'pendiente', motivo: 'Se marcó por error, el servicio es mañana' });
  revisa(s === 200 && j.lead?.ejecucion === null && !j.lead?.fecha_realizado, 'Dirección lo regresa a «por realizar»', j.lead && [j.lead.ejecucion, j.lead.fecha_realizado]);
  [s, j] = await pedir('GET', '/leads/' + orden.id, T.admin); revisa((j.historial || []).some(h => /Se regresó a «por realizar»/.test(h.texto || '')), 'queda en la bitácora de la orden', (j.historial || []).slice(0, 3).map(h => h.texto));
  [s] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', T.admin, { estado: 'pendiente', motivo: 'Otra vez por error' }); revisa(s === 409, 'si ya está por realizar: no aplica', s);
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', T.admin, { estado: 'realizado', fecha: HOY }); revisa(s === 200, 'se vuelve a marcar realizado sin problema', j);
  // Orden de compra: recibir → deshacer → recibir de nuevo.
  [s] = await pedir('POST', '/compras/ordenes/' + oc.id + '/documentos', T.costos, PDF, { 'Content-Type': 'application/octet-stream', 'X-Tipo': 'evidencia', 'X-Nombre': 'foto.pdf' });
  revisa(s === 201, 'se sube la evidencia de lo que llegó', s);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', T.costos, { recibio: 'Pedro Almacén', nota: '' }); revisa(s === 200 && j.recibida_at, 'compras la marca recibida', j);
  [s] = await pedir('POST', '/compras/ordenes/' + oc.id + '/deshacer-recepcion', T.costos, { motivo: 'Se marcó por error' }); revisa(s === 403, 'compras no deshace la recepción', s);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/deshacer-recepcion', T.admin, { motivo: 'Quien recibió fue otra persona' });
  revisa(s === 200 && !j.recibida_at && !j.recibio_nombre, 'Dirección la deshace: vuelve a «por recibir»', j);
  [s] = await pedir('POST', '/compras/ordenes/' + oc.id + '/deshacer-recepcion', T.admin, { motivo: 'Otra vez' }); revisa(s === 409, 'si no está recibida: no aplica', s);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', T.costos, { recibio: 'Laura Almacén', nota: 'Llegó completo' }); revisa(s === 200 && j.recibio_nombre === 'Laura Almacén', 'se vuelve a recibir con el dato correcto (la foto sigue en el expediente)', j);
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_compra&id=' + oc.id, T.admin); revisa(j.some(a => a.accion === 'recepción deshecha'), 'queda en la bitácora de la orden de compra', j.map(a => a.accion));
  // Aviso resuelto → reabierto.
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/historial', T.admin, { tipo: 'alerta', texto: 'Llamar para agendar la segunda visita', fecha_alerta: HOY + ' 09:00:00' });
  [, o2] = await pedir('GET', '/leads/' + orden.id, T.admin); const aviso = (o2.historial || []).find(h => h.tipo === 'alerta' && /segunda visita/.test(h.texto));
  [s] = await pedir('PUT', '/historial/' + aviso.id + '/resolver', T.admin, {}); revisa(s === 200, 'el aviso se marca resuelto', s);
  [s] = await pedir('PUT', '/historial/' + aviso.id + '/reabrir', T.ventas, {}); revisa(s === 403, 'ventas no reabre avisos', s);
  [s] = await pedir('PUT', '/historial/' + aviso.id + '/reabrir', T.admin, {}); revisa(s === 200, 'Dirección lo reabre', s);
  [, o2] = await pedir('GET', '/leads/' + orden.id, T.admin);
  revisa((o2.historial || []).some(h => h.id === aviso.id && !h.resuelta) && (o2.historial || []).some(h => /Se reabrió el aviso/.test(h.texto || '')), 'vuelve a estar pendiente y queda anotado', (o2.historial || []).slice(0, 3).map(h => h.texto));
  [s] = await pedir('PUT', '/historial/' + aviso.id + '/reabrir', T.admin, {}); revisa(s === 409, 'si no está resuelto: no aplica', s);
  [s] = await pedir('PUT', '/historial/999999/reabrir', T.admin, {}); revisa(s === 404, 'un aviso que no existe: 404', s);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exitCode = 1; }
  const errores = salida.split('\n').filter(l => /Error en|no manejado|uncaught/i.test(l));
  if (errores.length) { console.log('Errores del servidor:\n' + errores.slice(0, 5).join('\n')); process.exitCode = 1; }
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
})().catch(e => { console.error('ERROR', e); console.error(salida.slice(-1500)); srv.kill(); process.exit(1); });
