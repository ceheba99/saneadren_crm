// Auditoría de procesos: recorre ventas → servicio → factura → cobranza → costos, y compras → pago → recepción,
// intentando hacerlo MAL en cada paso. No falla la batería: imprime un informe con
//   ✔ el sistema lo impide o lo hace bien     ⚠ el sistema lo permite (decisión del negocio / revisar)
// Uso: node tests/auditoria-procesos.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-procesos-')); const PUERTO = String(7000 + Math.floor(Math.random() * 250));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Procesos-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'p.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const pdf = () => Buffer.from('%PDF-1.4\n% ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(40)]);
const espera = ms => new Promise(r => setTimeout(r, ms));
const informe = [];
// bloquea=true: lo correcto es que el sistema lo IMPIDA. ok = ¿lo impidió?
const prueba = (proceso, intento, [s, j], { bloquea = true, nota = '' } = {}) => {
  const impidio = s >= 400;
  const bien = bloquea ? impidio : !impidio;
  informe.push({ proceso, intento, bien, detalle: impidio ? (j.error || s) : 'lo permitió', nota });
  console.log(`  ${bien ? '✔' : '⚠'} [${proceso}] ${intento} → ${impidio ? 'IMPEDIDO: ' + (j.error || s) : 'PERMITIDO'}${nota ? ' · ' + nota : ''}`);
};
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const masDias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 80 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  for (const [n, c, r] of [['Vende Proc', 'vende.proc', 'ventas'], ['Tecnico Proc', 'tec.proc', 'tecnico'], ['Costos Proc', 'costos.proc', 'costos'], ['Atencion Proc', 'aten.proc', 'atencion']])
    await pedir('POST', '/usuarios', A, { nombre: n, correo: c + '@saneadren.com.mx', password: 'Saneadren-Prueba-' + r + '-26', rol: r });
  const tok = async (c, r) => (await pedir('POST', '/login', null, { nombre: c + '@saneadren.com.mx', password: 'Saneadren-Prueba-' + r + '-26' }))[1].token;
  const V = await tok('vende.proc', 'ventas'), T = await tok('tec.proc', 'tecnico'), C = await tok('costos.proc', 'costos'), AT = await tok('aten.proc', 'atencion');
  const [, usuarios] = await pedir('GET', '/usuarios', A), vid = usuarios.find(u => u.nombre === 'Vende Proc').id;
  const [, canales] = await pedir('GET', '/canales', V), [, servicios] = await pedir('GET', '/servicios', V), [, centros] = await pedir('GET', '/compras/centros', V);
  const cli = (await pedir('POST', '/contactos', V, { nombre: 'Gerente Hotel', telefono: '442 555 8101', empresa_contacto: 'Hotel Procesos', direccion: 'Centro', canal_origen_id: canales[0].id }))[1];
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de cocina', importe: 10000 }]);
  const cotizar = async (extra = {}) => (await pedir('POST', '/leads', V, { cliente_id: cli.id, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'mas_iva', valor: 10000, fecha_cotizacion: HOY, ...extra }))[1];
  const ganar = async (id, extra = {}) => { const [, l] = await pedir('GET', '/leads/' + id, V); return pedir('PUT', '/leads/' + id, V, { version: l.version, estatus: 'ganado', ...extra }); };
  const prov = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas Procesos', categoria: 'otro', dias_credito: 15 }))[1];
  const prov2 = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refacciones Norte', categoria: 'otro', dias_credito: 7 }))[1];
  const prov3 = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Ferretería Sur', categoria: 'otro', dias_credito: 0 }))[1];
  let r, s, j;

  console.log('\nVENTAS: cotización → orden de servicio');
  prueba('Ventas', 'Cotización con importe $0', await pedir('POST', '/leads', V, { cliente_id: cli.id, canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, importe: 0 }]), iva_modo: 'mas_iva', valor: 0, fecha_cotizacion: HOY }));
  prueba('Ventas', 'Cotización sin responsable', await pedir('POST', '/leads', V, { cliente_id: cli.id, canal_id: canales[0].id, servicio_id: servicios[0].id, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'mas_iva', valor: 10000 }));
  await cotizar();
  prueba('Ventas', 'La misma cotización dos veces seguidas (sin confirmar)', await pedir('POST', '/leads', V, { cliente_id: cli.id, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, partidas_json: partidas, iva_modo: 'mas_iva', valor: 10000, fecha_cotizacion: HOY }), { nota: 'pregunta antes de crear otra' });
  const c1 = await cotizar();
  prueba('Ventas', 'Ganar (pasar a orden de servicio) SIN fecha de servicio', await ganar(c1.id), { nota: 'sin fecha no sale en calendario ni en «por realizar»' });
  const c3 = await cotizar(); await ganar(c3.id, { fecha_servicio: HOY });
  [s, j] = await pedir('GET', '/leads/' + c3.id, V);
  prueba('Ventas', 'Ventas cambia el importe de una orden ya ganada', await pedir('PUT', '/leads/' + c3.id, V, { version: j.version, valor: 5000, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, importe: 5000 }]) }));
  await pedir('POST', '/leads/' + c3.id + '/cobros', A, { monto: 1000, metodo: 'transferencia', fecha: HOY });
  [s, j] = await pedir('GET', '/leads/' + c3.id, V);
  prueba('Ventas', 'Regresar a cotización (o perdida) una orden que ya tiene pagos', await pedir('PUT', '/leads/' + c3.id, V, { version: j.version, estatus: 'perdido' }));
  const c4 = await cotizar(); [s, j] = await pedir('GET', '/leads/' + c4.id, V);
  prueba('Ventas', 'Marcar cotización como perdida sin escribir motivo', await pedir('PUT', '/leads/' + c4.id, V, { version: j.version, estatus: 'perdido' }), { nota: 'sin motivo no se sabe por qué se pierden ventas' });

  console.log('\nOPERACIÓN: realizar el servicio');
  prueba('Operación', 'Marcar realizada una cotización que no se ha ganado', await pedir('POST', '/leads/' + c4.id + '/ejecucion', T, { estado: 'realizado', fecha: HOY, realizado_por: 'propio' }));
  const c5 = await cotizar(); await ganar(c5.id, { fecha_servicio: masDias(HOY, 5) });
  prueba('Operación', 'Marcar realizado con fecha futura', await pedir('POST', '/leads/' + c5.id + '/ejecucion', T, { estado: 'realizado', fecha: masDias(HOY, 3), realizado_por: 'propio' }));
  prueba('Operación', 'Marcar realizado HOY un servicio programado para dentro de 5 días', await pedir('POST', '/leads/' + c5.id + '/ejecucion', T, { estado: 'realizado', fecha: HOY, realizado_por: 'propio' }), { bloquea: false, nota: 'se permite: a veces se adelanta' });
  const c6 = await cotizar(); await ganar(c6.id, { fecha_servicio: HOY });
  prueba('Operación', '«No realizado» sin motivo', await pedir('POST', '/leads/' + c6.id + '/ejecucion', T, { estado: 'no_realizado' }));
  prueba('Operación', 'Realizado sin decir si fue propio o subcontratado', await pedir('POST', '/leads/' + c6.id + '/ejecucion', T, { estado: 'realizado', fecha: HOY }));
  prueba('Operación', 'Subcontratado sin registrar a quién y cuánto se le paga', await pedir('POST', '/leads/' + c6.id + '/ejecucion', T, { estado: 'realizado', fecha: HOY, realizado_por: 'subcontratado' }), { nota: 'si se permite, la utilidad sale inflada' });

  console.log('\nFACTURA Y COBRANZA');
  const c7 = await cotizar(); await ganar(c7.id, { fecha_servicio: HOY }); await pedir('POST', '/leads/' + c7.id + '/ejecucion', V, { estado: 'realizado', fecha: HOY, realizado_por: 'propio' });
  prueba('Cobranza', 'Cobrar más de lo que se debe ($11,600 de deuda, cobrar $20,000)', await pedir('POST', '/leads/' + c7.id + '/cobros', A, { monto: 20000, metodo: 'transferencia', fecha: HOY }));
  prueba('Cobranza', 'Cobro con fecha futura', await pedir('POST', '/leads/' + c7.id + '/cobros', A, { monto: 100, metodo: 'transferencia', fecha: masDias(HOY, 10) }));
  prueba('Cobranza', 'Cobro en una cotización (no ganada)', await pedir('POST', '/leads/' + c4.id + '/cobros', A, { monto: 100, metodo: 'transferencia', fecha: HOY }));
  [s, j] = await pedir('POST', '/leads/' + c7.id + '/cobros', V, { monto: 2000, metodo: 'efectivo', fecha: HOY });
  const cobroV = j;
  prueba('Cobranza', 'Ventas registra un pago en efectivo (queda «por confirmar»)', [s, j], { bloquea: false, nota: (j.confirmado === 0 || j.cobro?.confirmado === 0 || j.confirmado === false) ? 'queda por confirmar ✔' : 'OJO: quedó confirmado' });
  const idCobro = cobroV.id || cobroV.cobro?.id;
  prueba('Cobranza', 'Ventas CONFIRMA su propio cobro en efectivo', await pedir('POST', '/finanzas/cobros/' + idCobro + '/confirmar', V, {}), { nota: 'la misma persona que recibe el efectivo no debería confirmarlo' });
  prueba('Cobranza', 'Técnico cancela un pago de cliente', await pedir('POST', '/finanzas/cobros/' + idCobro + '/cancelar', T, { motivo: 'me equivoqué de cliente' }), { nota: 'cancelar pagos es delicado' });
  await pedir('PUT', '/leads/' + c7.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'A-100', factura_fecha: HOY });
  const c8 = await cotizar(); await ganar(c8.id, { fecha_servicio: HOY });
  prueba('Cobranza', 'Usar el mismo folio de factura (A-100) en otra orden', await pedir('PUT', '/leads/' + c8.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'a-100', factura_fecha: HOY }));
  prueba('Cobranza', 'Facturar con fecha futura', await pedir('PUT', '/leads/' + c8.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'A-101', factura_fecha: masDias(HOY, 20) }), { nota: 'una factura no puede ser de una fecha que aún no llega' });
  prueba('Cobranza', 'Ventas cambia los días de crédito y la factura de una orden', await pedir('PUT', '/leads/' + c8.id + '/facturacion', V, { dias_credito: 90 }), { nota: 'el crédito al cliente es una decisión de dinero' });

  console.log('\nCOSTOS CON TERCEROS (pipas, tiros…)');
  prueba('Costos', 'Gasto con terceros sin concepto', await pedir('POST', '/finanzas/cxp', V, { proveedor_id: prov.id, categoria: 'otro', concepto: '', total: 1500, fecha_documento: HOY, lead_id: c7.id }));
  prueba('Costos', 'Gasto con terceros en una cotización NO ganada', await pedir('POST', '/finanzas/cxp', V, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Renta de pipa', total: 1500, fecha_documento: HOY, lead_id: c4.id }));
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Renta de pipa 10 m3', total: 1500, fecha_documento: HOY, lead_id: c7.id });
  const gasto = j;
  prueba('Costos', 'Pagar al proveedor más de lo que se le debe', await pedir('POST', '/finanzas/cxp/' + gasto.id + '/pagos', A, { monto: 5000, metodo: 'transferencia', fecha: HOY }));
  prueba('Costos', 'Pago a proveedor con fecha futura', await pedir('POST', '/finanzas/cxp/' + gasto.id + '/pagos', A, { monto: 100, metodo: 'transferencia', fecha: masDias(HOY, 10) }));
  prueba('Costos', 'Técnico registra un pago a proveedor', await pedir('POST', '/finanzas/cxp/' + gasto.id + '/pagos', T, { monto: 100, metodo: 'efectivo', fecha: HOY }), { nota: 'pagar es delicado' });

  console.log('\nCOMPRAS: solicitud → cotizaciones → orden → pago → recepción');
  prueba('Compras', 'Ventas registra una «cuenta por pagar» de una compra SIN solicitud ni orden', await pedir('POST', '/finanzas/cxp', V, { proveedor_id: prov2.id, categoria: 'otro', concepto: 'Compra de llantas', total: 15800, fecha_documento: HOY }), { nota: 'se salta solicitud, 3 cotizaciones y autorización' });
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov2.id, categoria: 'otro', concepto: 'Compra directa de prueba', total: 1000, fecha_documento: HOY });
  prueba('Compras', 'Cuenta por pagar directa sin escribir el crédito (lo toma solo del proveedor)', [s, j], { bloquea: true, nota: 'en las órdenes de compra el crédito es obligatorio' });
  const sol = (await pedir('POST', '/compras/solicitudes', C, { que: 'Bomba sumergible 2 HP', para_que: 'Para achique en servicios de emergencia', centro_id: centros[0].id }))[1];
  prueba('Compras', 'El encargado de costos aprueba SU PROPIA solicitud', await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', C), { nota: 'la misma persona pide y aprueba' });
  for (const p of [prov, prov2, prov3]) await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': p.id === prov3.id ? '7000' : '9000', 'X-Nombre': 'c.pdf' });
  const cots = (await pedir('GET', '/compras/solicitudes/' + sol.id, C))[1].cotizaciones;
  prueba('Compras', 'Elegir la cotización MÁS CARA sin explicar por qué', await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cots.find(x => x.proveedor_id === prov.id).id }), { nota: 'queda anotado, pero no se pide el motivo' });
  const oc = (await pedir('POST', '/compras/ordenes', C, { solicitud_id: sol.id, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Bomba sumergible 2 HP', precio: 12000 }] }))[1];
  prueba('Compras', 'La orden se hace por MÁS de lo cotizado ($12,000 vs $9,000)', [oc.id ? 201 : 400, oc], { nota: 'debería avisar o pedir motivo' });
  await subir('/compras/ordenes/' + oc.id + '/documentos', C, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'f.png' });
  prueba('Compras', 'Marcar RECIBIDA una orden que aún no se autoriza', await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: 'Almacén' }), { nota: 'se compró antes de autorizar' });
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id, C);
  prueba('Compras', 'Editar la orden DESPUÉS de recibida (cambiar el precio)', await pedir('PUT', '/compras/ordenes/' + oc.id, C, { solicitud_id: sol.id, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', version: j.version, partidas: [{ cantidad: 1, descripcion: 'Bomba sumergible 2 HP', precio: 15000 }] }));
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 15 });
  const cxpOC = j.cxp_id;
  const sol2 = (await pedir('POST', '/compras/solicitudes', V, { que: 'Manguera 4 pulgadas 20 m', para_que: 'Para la unidad E44', centro_id: centros[0].id }))[1];
  await pedir('POST', '/compras/solicitudes/' + sol2.id + '/aprobar', A);
  for (const p of [prov, prov2, prov3]) await subir('/compras/solicitudes/' + sol2.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': '3000', 'X-Nombre': 'm.pdf' });
  const cots2 = (await pedir('GET', '/compras/solicitudes/' + sol2.id, C))[1].cotizaciones;
  await pedir('POST', '/compras/solicitudes/' + sol2.id + '/elegir', C, { cotizacion_id: cots2[0].id });
  const oc2 = (await pedir('POST', '/compras/ordenes', C, { solicitud_id: sol2.id, proveedor_id: cots2[0].proveedor_id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Manguera 4 pulgadas 20 m', precio: 3000 }] }))[1];
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc2.id + '/autorizar', A, { dias_credito: 0 });
  prueba('Compras', 'Pagar al proveedor una orden que AÚN NO se recibe', await pedir('POST', '/finanzas/cxp/' + j.cxp_id + '/pagos', A, { monto: 3000, metodo: 'transferencia', fecha: HOY }), { nota: 'se paga algo que no ha llegado (válido si es de contado/anticipo)' });
  prueba('Compras', 'El encargado cancela una orden ya recibida', await pedir('POST', '/compras/ordenes/' + oc.id + '/cancelar', C, { motivo: 'Ya no la queremos' }), { nota: 'solo administración (p. ej. si se devolvió)' });
  prueba('Compras', 'Subir como cotización de otra solicitud un archivo ya usado', await subir('/compras/solicitudes/' + sol2.id + '/documentos', C, Buffer.from('%PDF-1.4\n% ya usado\n%%EOF'), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.id, 'X-Monto': '1', 'X-Nombre': 'x.pdf' }));

  console.log('\nRESULTADOS');
  [s, j] = await pedir('GET', '/tablero/panorama', A).catch(() => [0, {}]);
  if (s !== 200) [s, j] = await pedir('GET', '/tablero', A);
  console.log('  (panorama:', s, ')');

  const bien = informe.filter(x => x.bien), mal = informe.filter(x => !x.bien);
  console.log(`\n=== RESUMEN: ${bien.length} bien, ${mal.length} para revisar ===`);
  for (const x of mal) console.log(`  ⚠ [${x.proceso}] ${x.intento} → ${x.detalle}${x.nota ? ' (' + x.nota + ')' : ''}`);
  fs.writeFileSync(path.join(__dirname, '..', 'entregables', 'auditoria-procesos.json'), JSON.stringify(informe, null, 2));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
