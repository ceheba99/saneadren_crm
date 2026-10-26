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

  console.log('5. Prospección: cada quien lo suyo (decisión del dueño, 2026-10-21)');
  [s, j] = await pedir('POST', '/usuarios', T.admin, { nombre: 'Segundo Vendedor Qro', password: 'Clave-Otro-2026x', rol: 'ventas', sucursales: [qro.id] }); const v2 = j;
  const V2 = (await pedir('POST', '/login', null, { nombre: 'Segundo Vendedor Qro', password: 'Clave-Otro-2026x' }))[1].token;
  const est = extra => ({ nombre: 'Restaurante La Esquina', sector_id: sectores[0].id, zona: 'Querétaro', direccion: 'Av. Universidad 12', telefono: '', correo: '', persona: '', cargo: '', fuente: '', necesidades: '', estado: 'investigar', responsable_id: ID.ventas, proximo_contacto: '', ...extra });
  [s, j] = await pedir('POST', '/prospeccion', T.ventas, est()); const e1 = j; revisa(s === 201, 'Laura registra un establecimiento a su nombre', j);
  [s, j] = await pedir('GET', '/prospeccion', V2); revisa(s === 200 && !j.some(e => e.id === e1.id), 'otro vendedor de la misma sucursal no lo ve en su lista', s);
  [s] = await pedir('GET', '/prospeccion/' + e1.id, V2); revisa(s === 404, 'ni abriéndolo directo', s);
  [s] = await pedir('PUT', '/prospeccion/' + e1.id, V2, est({ version: e1.version, responsable_id: v2.id })); revisa(s === 404, 'ni puede quitárselo a Laura', s);
  [s, j] = await pedir('POST', '/prospeccion', V2, est({ responsable_id: v2.id }));
  revisa(s === 409 && /ya lo trabaja Laura/.test(j.error || '') && !j.id, 'si lo da de alta otra vez: «Ese establecimiento ya lo trabaja Laura…», sin más datos', j);
  [s, j] = await pedir('POST', '/prospeccion', V2, est({ nombre: 'Hotel Centro', responsable_id: ID.ventas })); revisa(s === 403, 'un vendedor no registra a nombre de otro', [s, j.error]);
  [s, j] = await pedir('POST', '/prospeccion', V2, est({ nombre: 'Hotel Centro', responsable_id: v2.id })); revisa(s === 201, 'a su nombre sí', j);
  [s, j] = await pedir('GET', '/prospeccion', T.ventas); revisa(s === 200 && j.some(e => e.id === e1.id) && !j.some(e => e.responsable_id === v2.id), 'Laura ve los suyos y no los del otro vendedor', s);
  for (const rol of ['tecnico', 'costos']) { [s] = await pedir('GET', '/prospeccion', T[rol]); revisa(s === 403, `${rol}: no ve Prospección`, s); }
  [s, j] = await pedir('GET', '/prospeccion', T.atencion); revisa(s === 200 && j.some(e => e.id === e1.id) && j.some(e => e.responsable_id === v2.id), 'Atención (ve toda la sucursal) ve los de los dos vendedores', s);
  [s, j] = await pedir('POST', '/prospeccion', T.atencion, est({ nombre: 'Hospital Norte', responsable_id: ID.tecnico })); revisa(s === 403 && /no tiene acceso a Prospección/.test(j.error || ''), 'no se asigna a quien no tiene Prospección (el técnico)', j);
  [s, j] = await pedir('POST', '/prospeccion', T.atencion, est({ nombre: 'Hospital Norte', responsable_id: v2.id })); revisa(s === 201, 'Atención sí asigna a un vendedor', j);
  [s, j] = await pedir('GET', '/permisos', T.admin); revisa(s === 200 && JSON.stringify(j).includes('prospeccion.ver'), '«Prospección» aparece en Roles y permisos (Dirección la da o la quita por rol)', s);

  console.log('6. Orden de compra: recordar artículos ya comprados (decisión del dueño, 2026-10-21)');
  const oc_ = (prov, partidas) => pedir('POST', '/compras/ordenes', T.costos, { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: cats[0].clave, factura_a: '', fecha: HOY, fecha_requerida: null, lead_id: null, nota: '', observaciones: '', solicitante_nombre: '', solicitante_cargo: '', iva_modo: 'mas_iva', partidas });
  const [provA, provB] = provs;
  [s, j] = await oc_(provA, [{ cantidad: 4, descripcion: 'Llanta Prueba Revisión 11R22.5', unidad: 'PZA', clave: 'LL-11R', precio: 4850 }]); revisa(s === 201, 'orden con 4 llantas a $4,850 (proveedor A)', j);
  [s, j] = await oc_(provB, [{ cantidad: 2, descripcion: 'llanta prueba revision 11R22.5', unidad: 'PZA', clave: '', precio: 5200 }, { cantidad: 300, descripcion: 'Diésel de prueba revisión', unidad: 'L', clave: '', precio: 23.8 }]);
  revisa(s === 201, 'después, 2 de la misma llanta a $5,200 (proveedor B) y diésel', j);
  [s, j] = await oc_(provA, [{ cantidad: 1, descripcion: 'Llanta Prueba Revisión cancelada', unidad: 'PZA', clave: '', precio: 99 }]); const ocCancelada = j;
  [s] = await pedir('POST', '/compras/ordenes/' + ocCancelada.id + '/cancelar', T.costos, { motivo: 'Se pidió por error' }); revisa(s === 200, 'una orden cancelada', s);
  [s, j] = await pedir('GET', '/compras/articulos?q=' + encodeURIComponent('llanta prueba'), T.costos);
  const ll = (j || []).find(a => /11R22\.5/.test(a.descripcion));
  revisa(s === 200 && ll && ll.unidad === 'PZA' && ll.precio === 5200 && ll.veces === 2, 'sugiere la llanta una sola vez (aunque se escribió distinto), con su unidad y el último precio ($5,200)', j);
  revisa(!(j || []).some(a => /cancelada/.test(a.descripcion)), 'no sugiere artículos de órdenes canceladas', j);
  [s, j] = await pedir('GET', '/compras/articulos?q=' + encodeURIComponent('llanta prueba') + '&proveedor_id=' + provA.id, T.costos);
  revisa((j || []).find(a => /11R22\.5/.test(a.descripcion))?.precio_proveedor === 4850, 'con el proveedor A elegido, sugiere el último precio de ese proveedor ($4,850)', j);
  [s, j] = await pedir('GET', '/compras/articulos?q=diesel%20prueba', T.costos); revisa(s === 200 && j.some(a => a.unidad === 'L' && a.precio === 23.8), 'sin acentos también lo encuentra (diesel → Diésel), con su unidad L', j);
  [s, j] = await pedir('GET', '/compras/articulos?q=l', T.costos); revisa(s === 200 && Array.isArray(j) && !j.length, 'con una sola letra no sugiere nada', j);
  [s] = await pedir('GET', '/compras/articulos?q=llanta', T.ventas); revisa(s === 403, 'quien no hace órdenes de compra no consulta artículos', s);
  const G2 = (await pedir('POST', '/demo/entrar', null, { rol: 'gerente_cdmx' }))[1].token;
  [s, j] = await pedir('GET', '/compras/articulos?q=' + encodeURIComponent('llanta prueba'), G2); revisa(s === 200 && !j.length, 'otra sucursal (CDMX) no ve lo que compró Querétaro', [s, j]);

  console.log('7. Regresar una orden a cotización (decisión del dueño, 2026-10-21)');
  const vv = async id => (await pedir('GET', '/leads/' + id, T.admin))[1].version;
  const ptd = imp => JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: imp, cantidad: 1, precio: imp }]);
  const cotOrden = async (imp, extra = {}) => {
    const [, l] = await pedir('POST', '/leads', T.ventas, { cliente_id: cli.id, direccion: 'Planta', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: ID.ventas, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: ptd(imp), valor: imp, fecha_cotizacion: HOY });
    const [st] = await pedir('PUT', '/leads/' + l.id, T.admin, { version: await vv(l.id), estatus: 'ganado', fecha_servicio: HOY, partidas_json: ptd(imp), valor: imp, iva_modo: 'mas_iva', ...extra });
    return [l, st];
  };
  let [r1, st1] = await cotOrden(10000); revisa(st1 === 200, 'una cotización de $10,000 se vuelve orden', st1);
  [s, j] = await pedir('PUT', '/leads/' + r1.id, T.ventas, { version: await vv(r1.id), estatus: 'abierto' });
  revisa(s === 403 && /administración/.test(j.error || ''), 'el vendedor (sin permiso de cambiar importes) ya no la regresa a cotización', [s, j.error]);
  [s] = await pedir('PUT', '/leads/' + r1.id, T.ventas, { version: await vv(r1.id), estatus: 'perdido', motivo_perdida: 'Ya no lo necesita el cliente' }); revisa(s === 403, 'ni la descarta como no aceptada', s);
  [s] = await pedir('PUT', '/leads/' + r1.id, T.admin, { version: await vv(r1.id), estatus: 'abierto' }); revisa(s === 200, 'Dirección (puede cambiar importes) la regresa a cotización (Atención ya no: la orden no es suya, 2026-10-26)', s);
  [s] = await pedir('PUT', '/leads/' + r1.id, T.ventas, { version: await vv(r1.id), partidas_json: ptd(8000), valor: 8000, iva_modo: 'mas_iva' }); revisa(s === 200, 'ya como cotización, el vendedor ajusta el precio a $8,000', s);
  [s] = await pedir('PUT', '/leads/' + r1.id, T.ventas, { version: await vv(r1.id), estatus: 'ganado', fecha_servicio: HOY, partidas_json: ptd(8000), valor: 8000, iva_modo: 'mas_iva' }); revisa(s === 200, 'y la vuelve a ganar', s);
  [, j] = await pedir('GET', '/leads/' + r1.id, T.admin);
  revisa((j.historial || []).some(h => /Se volvió a ganar con otro importe: \$11,600\.00 → \$9,280\.00.*PDF/.test(h.texto || '')), 'el historial avisa: otro importe ($11,600 → $9,280 con IVA) y que el PDF anterior ya no vale', (j.historial || []).slice(0, 3).map(h => h.texto));
  [s] = await pedir('PUT', '/leads/' + r1.id, T.admin, { version: await vv(r1.id), estatus: 'abierto' });
  [s] = await pedir('PUT', '/leads/' + r1.id, T.admin, { version: await vv(r1.id), estatus: 'ganado', fecha_servicio: HOY, partidas_json: ptd(8000), valor: 8000, iva_modo: 'mas_iva' });
  [, j] = await pedir('GET', '/leads/' + r1.id, T.admin);
  revisa((j.historial || []).filter(h => /Se volvió a ganar con otro importe/.test(h.texto || '')).length === 1, 'si se vuelve a ganar con el mismo importe, no hay aviso de más', s);
  // Realizada: no se regresa a cotización hasta que Dirección la deja «por realizar».
  [s] = await pedir('POST', '/leads/' + r1.id + '/ejecucion', T.admin, { estado: 'realizado', fecha: HOY });
  [s, j] = await pedir('PUT', '/leads/' + r1.id, T.admin, { version: await vv(r1.id), estatus: 'abierto' });
  revisa(s === 409 && /realizada.*Dirección/.test(j.error || ''), 'una orden REALIZADA no se regresa a cotización (antes se salía de las ventas)', [s, j.error]);
  [s] = await pedir('POST', '/leads/' + r1.id + '/ejecucion', T.admin, { estado: 'pendiente', motivo: 'El cliente cambió lo que se hará' });
  [s] = await pedir('PUT', '/leads/' + r1.id, T.admin, { version: await vv(r1.id), estatus: 'abierto' }); revisa(s === 200, 'cuando Dirección la deja «por realizar», ya se puede regresar', s);
  // Técnico asignado: solo ve órdenes.
  let [r2] = await cotOrden(7000, { tecnico_id: ID.tecnico });
  [s] = await pedir('GET', '/leads/' + r2.id, T.tecnico); revisa(s === 200, 'el técnico ve la orden que tiene asignada', s);
  [s] = await pedir('PUT', '/leads/' + r2.id, T.admin, { version: await vv(r2.id), estatus: 'abierto' });
  [s] = await pedir('GET', '/leads/' + r2.id, T.tecnico); revisa(s === 404, 'si regresa a cotización, el técnico deja de verla (ni su precio)', s);
  [s, j] = await pedir('GET', '/leads', T.tecnico); revisa(!j.some(l => l.id === r2.id), 'tampoco en sus listas', s);
  [s] = await pedir('PUT', '/leads/' + r2.id, T.admin, { version: await vv(r2.id), estatus: 'ganado', fecha_servicio: HOY, partidas_json: ptd(7000), valor: 7000, iva_modo: 'mas_iva' });
  [s, j] = await pedir('GET', '/leads/' + r2.id, T.tecnico); revisa(s === 200 && j.tecnico_id === ID.tecnico, 'al volverse orden, la ve otra vez (su asignación no se perdió)', s);
  // Una cotización no aceptada la reabre quien la edita (nunca fue orden).
  const [, cp] = await pedir('POST', '/leads', T.ventas, { cliente_id: cli.id, direccion: 'Planta', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: ID.ventas, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: ptd(3000), valor: 3000, fecha_cotizacion: HOY });
  [s] = await pedir('PUT', '/leads/' + cp.id, T.ventas, { version: await vv(cp.id), estatus: 'perdido', motivo_perdida: 'Precio alto por ahora' });
  [s] = await pedir('PUT', '/leads/' + cp.id, T.ventas, { version: await vv(cp.id), estatus: 'abierto' }); revisa(s === 200, 'una cotización no aceptada la reabre el vendedor (nunca fue orden)', s);

  console.log('8. Una orden cuenta cuando se concluye (decisión del dueño, 2026-10-21)');
  const D1 = HOY.slice(0, 8) + '01';
  const numeros = async () => {
    const [, r] = await pedir('GET', '/finanzas/resumen', T.admin), [, c] = await pedir('GET', `/analisis/comercial?desde=${D1}&hasta=${HOY}`, T.admin), [, t] = await pedir('GET', `/tablero?desde=${D1}&hasta=${HOY}&tipo=mes`, T.admin);
    return { teDeben: r.por_cobrar, porConcluir: r.por_concluir, servicios: c.resumen.servicios, vendido: c.resumen.contratado, porRealizar: c.resumen.por_realizar, venta: t.actual.venta, teDebenPanorama: t.foto.te_deben };
  };
  const n0 = await numeros();
  const [ox] = await cotOrden(20000);
  const n1 = await numeros();
  revisa(n1.teDeben === n0.teDeben && n1.teDebenPanorama === n0.teDebenPanorama, 'orden de hoy sin concluir: no cuenta en «Te deben» (ni en Cuentas por cobrar ni en Panorama)', [n0.teDeben, n1.teDeben]);
  revisa(Math.round((n1.porConcluir - n0.porConcluir) * 100) === 2320000, 'aparece aparte como «por concluir» ($23,200 con IVA)', [n0.porConcluir, n1.porConcluir]);
  revisa(n1.servicios === n0.servicios && n1.vendido === n0.vendido && n1.venta === n0.venta, 'ni como servicio ni como venta (Análisis comercial y Panorama)', [n0, n1]);
  revisa(n1.porRealizar - n0.porRealizar === 20000, 'en Análisis comercial sale como «por realizar» ($20,000 sin IVA)', [n0.porRealizar, n1.porRealizar]);
  [s] = await pedir('POST', '/leads/' + ox.id + '/ejecucion', T.admin, { estado: 'realizado', fecha: HOY });
  const n2 = await numeros();
  revisa(Math.round((n2.teDeben - n1.teDeben) * 100) === 2320000 && n2.porConcluir === n0.porConcluir, 'al marcarla realizada pasa a «Te deben» ($23,200)', [n1.teDeben, n2.teDeben]);
  revisa(n2.servicios === n0.servicios + 1 && n2.vendido - n0.vendido === 20000 && n2.venta - n0.venta === 20000, 'y cuenta como servicio y venta, igual en las dos pestañas de Resultados ($20,000 sin IVA)', [n2.vendido - n0.vendido, n2.venta - n0.venta]);
  const [oy] = await cotOrden(5000);
  [s] = await pedir('PUT', '/leads/' + oy.id + '/facturacion', T.admin, { dias_credito: 15, factura_folio: 'F-REV-1', factura_fecha: HOY });
  const n3 = await numeros();
  revisa(s === 200 && Math.round((n3.teDeben - n2.teDeben) * 100) === 580000, 'facturada sin concluir también se debe ($5,800): hay servicios sin factura, por eso basta cualquiera de las dos', [s, n2.teDeben, n3.teDeben]);
  const [oz] = await cotOrden(3000);
  [s] = await pedir('POST', '/leads/' + oz.id + '/ejecucion', T.admin, { estado: 'no_realizado', motivo: 'El cliente canceló el servicio' });
  const n4 = await numeros();
  revisa(n4.teDeben === n3.teDeben && n4.servicios === n3.servicios && n4.vendido === n3.vendido && n4.porConcluir === n3.porConcluir && n4.porRealizar === n3.porRealizar, 'una orden NO realizada no cuenta en ningún lado (antes seguía como «contratado»)', [n3, n4]);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exitCode = 1; }
  const errores = salida.split('\n').filter(l => /Error en|no manejado|uncaught/i.test(l));
  if (errores.length) { console.log('Errores del servidor:\n' + errores.slice(0, 5).join('\n')); process.exitCode = 1; }
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
})().catch(e => { console.error('ERROR', e); console.error(salida.slice(-1500)); srv.kill(); process.exit(1); });
