// MÁS EJEMPLOS PARA EL DEMO (2026-11-11). Solo lo llama server/demo.js, que a su vez solo corre con MODO_DEMO=1 y en
// una base vacía (Render). Nunca toca un sistema real. Todo es inventado: nombres, teléfonos, RFC y CLABE son de ejemplo.
// Llena seis meses de historia para que Inicio, Cobranza, Cuentas por pagar, Contabilidad (Flujo de banco), Reportes,
// Prospección, Marketing y Asistencia tengan mucho qué mostrar. Se crea con el propio sistema (API), salvo las checadas
// del reloj, que se escriben directo porque el kiosco necesita PIN, foto y un dispositivo.
module.exports = async function masEjemplos(x) {
  const { db, pedir, orden, total, dia, HOY, tok, A, V, C, T, VC, GC, prov, PER, persona, clabe, servicios, canal, idDe, cdmx, qroId, centros, subir, pdf } = x;
  // Azar con semilla fija: el demo sale igual cada vez.
  let semilla = 20261111;
  const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  const toma = l => l[Math.floor(azar() * l.length)];
  const hay = n => servicios.some(s => s.nombre === n);

  // ===== Personal: más gente de campo =====
  const NUEVOS = [
    ['Alejandro Vargas Luna', 'Operador', '442 700 3001', -820, null], ['Fernando Castillo Ruiz', 'Operador', '442 700 3002', -560, null],
    ['José Manuel Torres', 'Ayudante', '442 700 3003', -330, null], ['Ricardo Núñez Olvera', 'Ayudante', '442 700 3004', -150, null],
    ['Emilio Guzmán Reyes', 'Técnico', '442 700 3005', -1250, null], ['Brenda Morales Ibarra', 'Administración', '442 700 3006', -410, null],
    ['Hugo Sánchez Paredes', 'Operador', '55 7000 3007', -260, 'CDMX'], ['Iván Rosales Cruz', 'Ayudante', '55 7000 3008', -95, 'CDMX'],
    ['Andrés Mejía Lozano', 'Ayudante', '442 700 3009', -40, null], ['Tomás Aguilar Peña', 'Operador', '442 700 3010', -1900, null],
  ];
  const NUE = [];
  for (const [i, [nombre, puesto, tel, ingreso, suc]] of NUEVOS.entries()) NUE.push({ nombre, suc, id: await persona({ nombre, puesto, telefono: tel, fecha_ingreso: dia(ingreso), ...(suc ? { sucursal_id: cdmx.id } : {}),
    tipo_contrato: ingreso > -60 ? 'Periodo de prueba' : 'Indeterminado', ...(ingreso > -60 ? { contrato_vence: dia(ingreso + 90) } : {}),
    ...(/Operador|Técnico/.test(puesto) ? { licencia_tipo: 'Federal E', licencia_vence: dia(40 + i * 37) } : {}),
    banco: ['BBVA', 'Banorte', 'Santander'][i % 3], clabe: clabe(['01218000', '07268001', '01468065'][i % 3] + String(300000001 + i * 7919).slice(-9)), salario: /Operador|Técnico/.test(puesto) ? 480 + i * 5 : 400, salario_periodo: 'diario' }) });
  await pedir('POST', '/personal/' + NUE[2].id + '/incidencias', A, { tipo: 'retardo', fecha_inicio: dia(-4), dias: 0.5, notas: 'Llegó a las 9:20' });
  await pedir('POST', '/personal/' + NUE[3].id + '/incidencias', A, { tipo: 'falta', fecha_inicio: dia(-11), notas: 'Avisó que estaba enfermo' });
  await pedir('POST', '/personal/' + NUE[4].id + '/incidencias', A, { tipo: 'vacaciones', fecha_inicio: dia(8), fecha_fin: dia(14), notas: 'Vacaciones de fin de año (adelantadas)' });

  // ===== Clientes nuevos (QRO y CDMX) =====
  const GIROS = ['Restaurante', 'Hotel', 'Plaza comercial', 'Fábrica', 'Clínica', 'Colegio', 'Condominio', 'Taller', 'Lavandería', 'Panadería', 'Gimnasio', 'Bodega'];
  const NOMBRES = ['Los Arcos', 'San Miguel', 'La Cañada', 'El Roble', 'Santa Fe', 'Las Fuentes', 'Del Valle', 'La Pradera', 'Bugambilias', 'El Mirador', 'Real del Bosque', 'Las Palmas', 'Tres Ríos', 'La Joya', 'El Faro'];
  const CONTACTOS = ['Ing. Martha Ruiz', 'Lic. Óscar Ibáñez', 'Sr. Ramón Galindo', 'Arq. Paola Treviño', 'Ing. Javier Montes', 'Lic. Diana Cortés', 'Sra. Leticia Barrios', 'Ing. Saúl Mendoza'];
  const CALLES = ['Av. Universidad', 'Blvd. Bernardo Quintana', 'Av. Zaragoza', 'Av. 5 de Febrero', 'Prol. Corregidora', 'Av. Constituyentes', 'Paseo de la República', 'Av. Pie de la Cuesta'];
  const CANALES = ['Llamada telefónica', 'WhatsApp', 'Correo electrónico', 'Recomendación', 'Facebook', 'Instagram'];
  const clientesQ = [], clientesC = [];
  // Alta como lo haría una persona: si el sistema avisa «hay clientes parecidos», se confirma que es otro cliente.
  const nuevoCliente = async (t, cuerpo) => {
    try { return await pedir('POST', '/contactos', t, cuerpo); } catch (e) { if (!/posible_duplicado/.test(e.message)) throw e; }
    const r = await fetch(x.URL + '/contactos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(cuerpo) }).then(r => r.json());
    return pedir('POST', '/contactos', t, { ...cuerpo, distinto_de: (r.parecidos || []).map(p => p.id) });
  };
  for (let i = 0; i < 30; i++) {
    const emp = `${GIROS[i % GIROS.length]} ${NOMBRES[(i * 7) % NOMBRES.length]}`;
    const c = await nuevoCliente(V, { nombre: `${CONTACTOS[i % CONTACTOS.length]} · ${i % 2 ? 'Mantenimiento' : 'Compras'}`, telefono: `442 710 ${String(4000 + i).padStart(4, '0')}`, empresa_contacto: emp, direccion: `${CALLES[i % CALLES.length]} ${100 + i * 13}, Querétaro`, canal_origen_id: canal(CANALES[i % CANALES.length]) });
    clientesQ.push(c);
  }
  for (let i = 0; i < 10; i++) {
    const c = await nuevoCliente(VC, { nombre: `${CONTACTOS[(i + 3) % CONTACTOS.length]} · Mantenimiento`, telefono: `55 7100 ${String(5000 + i).padStart(4, '0')}`, empresa_contacto: `${GIROS[(i + 5) % GIROS.length]} ${NOMBRES[(i * 4 + 2) % NOMBRES.length]} CDMX`,
      direccion: `${['Av. Insurgentes Sur', 'Paseo de la Reforma', 'Av. Revolución', 'Calz. de Tlalpan'][i % 4]} ${200 + i * 31}, CDMX`, canal_origen_id: canal(CANALES[(i + 1) % CANALES.length]) });
    clientesC.push(c);
  }

  // ===== Seis meses de órdenes: realizadas, facturadas, cobradas, parciales, vencidas, perdidas y programadas =====
  const TRAB = [['Desazolve de drenaje', 'Desazolve de red sanitaria con equipo hidroneumático', 7800], ['Limpieza de fosas y cárcamos', 'Limpieza de fosa séptica y retiro de lodos', 13800],
    ['Servicio industrial (aceitosos)', 'Retiro de agua aceitosa de cárcamo industrial', 39000], ['Video inspección de tuberías', 'Video inspección de línea sanitaria con reporte', 9200],
    ['Retiro de agua / bombeo', 'Bombeo de agua pluvial en sótano', 16500], ['Rehabilitación de tuberías (CIPP)', 'Rehabilitación de tubería con manga CIPP', 64000],
    ['Limpieza de trampas de grasa', 'Limpieza de trampa de grasa de cocina', 4600], ['Mantenimiento a plantas de tratamiento', 'Mantenimiento mensual a planta de tratamiento', 42000]].filter(([s]) => hay(s));
  const PERDIDAS = ['Precio alto: eligió a otro proveedor', 'Lo resolvió su personal de mantenimiento', 'Pospuso el trabajo para el próximo año', 'No contestó después de la cotización'];
  const OPER = ['Diego Arturo Hdz', 'Juan Carlos Ríos', 'Miguel Ángel Soto'];
  let folioQ = 3000, folioC = 500;
  for (let i = 0; i < 140; i++) {
    const enCdmx = i % 5 === 4, d = i < 125 ? -182 + Math.floor(i * 1.43) : 1 + (i - 125) * 2;
    const cl = enCdmx ? toma(clientesC) : toma(clientesQ), [serv, ley, base] = toma(TRAB);
    const imp = Math.round(base * (0.8 + azar() * 0.6) / 100) * 100, suerte = azar();
    const quien = enCdmx ? { quien: VC, tec: GC, resp: 'ventas_cdmx', eq: [{ personal_id: PER.oscar, papel: 'responsable' }, { personal_id: NUE[6].id, papel: 'operador' }] } : {};
    const partidas = [{ leyenda: ley, importe: imp }];
    if (d < -3 && suerte < 0.12) { // cotización perdida
      const c = await orden({ cliente: cl, serv, partidas, fCot: dia(d), ...quien });
      await pedir('PUT', '/leads/' + c.id, enCdmx ? VC : V, { version: (await pedir('GET', '/leads/' + c.id, enCdmx ? VC : V)).version, estatus: 'perdido', motivo_perdida: toma(PERDIDAS) });
      continue;
    }
    if (d > -25 && d < 0 && suerte < 0.25) { await orden({ cliente: cl, serv, partidas, fCot: dia(d), etapa: 1 + Math.floor(azar() * 3), ...quien }); continue; } // cotización abierta
    if (d > 0) { await orden({ cliente: cl, serv, partidas, fCot: dia(-2), fServ: dia(d), equipo: enCdmx ? 'CDMX-01' : toma(['E-37', 'E-44', 'V-12']), operador: enCdmx ? 'Óscar Medina' : toma(OPER), ...quien }); continue; } // programada
    const credito = toma([0, 0, 15, 30, 30]), facturar = d < -2 && azar() < 0.88, vence = d + credito;
    const metodo = credito && imp > 30000 && azar() < 0.5 ? 'PPD' : 'PUE';
    const gastos = [{ proveedor_id: prov.gasolinera.id, categoria: 'combustible', concepto: 'Diésel del servicio', total: Math.round(imp * 0.06), ya_pagado: true, metodo: 'tarjeta', fecha_pago: dia(d) }];
    if (/fosa|aceitosa|cárcamo|planta/i.test(ley)) gastos.push({ proveedor_id: prov.disposicion.id, categoria: 'residuos', concepto: 'Disposición de lodos y agua residual', total: Math.round(imp * 0.1) });
    const t = total(imp), r = azar();
    // 70 % se cobra completo, 12 % a medias, el resto sigue pendiente (y si ya venció, sale como vencido en cobranza).
    const cobros = !facturar ? [] : vence >= -1 ? (credito === 0 ? [{ monto: t, metodo: 'transferencia', fecha: dia(Math.min(d + 1, -1)), ref: 'SPEI contado' }] : [])
      : r < 0.7 ? [{ monto: t, metodo: azar() < 0.2 ? 'efectivo' : 'transferencia', fecha: dia(Math.min(vence + Math.floor(azar() * 8), -1)), ref: 'SPEI ' + cl.empresa_contacto.split(' ')[0] }]
        : r < 0.82 ? [{ monto: Math.round(t * 0.5 * 100) / 100, fecha: dia(Math.min(vence + 2, -1)), ref: 'Parcialidad 1' }] : [];
    await orden({ cliente: cl, serv, partidas, fCot: dia(d - 4), fServ: dia(d), realizado: dia(d), equipo: enCdmx ? 'CDMX-01' : toma(['E-37', 'E-44', 'V-12']), operador: enCdmx ? 'Óscar Medina' : toma(OPER),
      propio: gastos, factura: facturar ? { dias: credito, folio: enCdmx ? 'C-' + (++folioC) : 'A-' + (++folioQ), fecha: dia(d), metodo } : null, cobros, ...quien });
  }

  // Encuestas de satisfacción y notas de seguimiento en más órdenes.
  const todas = await pedir('GET', '/leads', A);
  const COMENT = ['Muy puntuales', 'Dejaron todo limpio', 'Rápidos y amables', 'Tardaron en llegar', 'Excelente trabajo', 'Buen precio', 'Explicaron bien el problema', 'Volveremos a llamarlos'];
  for (const [i, l] of todas.filter(l => l.ejecucion === 'realizado' && !l.encuesta_calificacion).slice(4, 34).entries())
    await pedir('PUT', '/leads/' + l.id, A, { version: (await pedir('GET', '/leads/' + l.id, A)).version, encuesta_calificacion: [4, 4, 3, 4, 4, 2, 4, 3][i % 8], encuesta_comentario: COMENT[i % COMENT.length] });
  for (const [i, l] of todas.filter(l => l.estatus === 'abierto').slice(3, 15).entries()) {
    await pedir('POST', '/leads/' + l.id + '/historial', A, { tipo: 'observacion', texto: ['Se mandó la cotización por WhatsApp', 'El cliente pidió una visita técnica', 'Comparando con otro proveedor', 'Lo revisa con su administrador'][i % 4] });
    if (i % 2 === 0) await pedir('POST', '/leads/' + l.id + '/historial', A, { tipo: 'alerta', texto: 'Llamar para dar seguimiento', fecha_alerta: dia((i % 5) - 2) + ' 11:00:00' });
  }

  // ===== Gastos fijos de los meses anteriores (pagados) y facturas de proveedores pendientes o vencidas =====
  const cxp = (cuerpo, quien = C) => pedir('POST', '/finanzas/cxp', quien, cuerpo);
  const pagar = (id, monto, fecha, metodo, cuenta, ref) => pedir('POST', '/finanzas/cxp/' + id + '/pagos', C, { monto, metodo, fecha, cuenta_origen: cuenta, referencia: ref || null });
  const telmex = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Internet y Telefonía del Centro (ejemplo)', categoria: 'servicios_oficina', dias_credito: 0 });
  const contador = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Despacho Contable Ejemplo', categoria: 'servicios_oficina', dias_credito: 5, clabe: clabe('01218000555666777'), banco: 'BBVA' });
  const refa = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refaccionaria Diésel Querétaro', categoria: 'refacciones', dias_credito: 15, clabe: clabe('07268001044455566'), banco: 'Banorte' });
  for (let m = 5; m >= 2; m--) {
    const f = dia(-30 * m - 2);
    const renta = await cxp({ proveedor_id: prov.renta.id, categoria: 'renta_inmuebles', concepto: `Renta de oficina y patio · hace ${m} meses`, total: 28000, fecha_documento: f, dias_credito: 5, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'R-' + (495 + 5 - m), iva: 3862.07 });
    await pagar(renta.id, 28000, dia(-30 * m + 2), 'transferencia', 'Santander empresa', 'SPEI renta');
    const imss = await cxp({ proveedor_id: prov.imss.id, categoria: 'impuestos', concepto: `Cuotas IMSS, RCV e INFONAVIT · hace ${m} meses`, total: 46000 + m * 450, fecha_documento: dia(-30 * m - 6), dias_credito: 10, tipo_comprobante: 'linea_captura' });
    await pagar(imss.id, 46000 + m * 450, dia(-30 * m + 3), 'transferencia', 'Santander empresa', 'Pago SUA');
    const tel = await cxp({ proveedor_id: telmex.id, categoria: 'servicios_oficina', concepto: `Internet y teléfono · hace ${m} meses`, total: 1899, fecha_documento: dia(-30 * m - 1), dias_credito: 0, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'TEL-' + (8800 + m), iva: 261.93 });
    await pagar(tel.id, 1899, dia(-30 * m - 1), 'domiciliado', 'Santander empresa');
    const cont = await cxp({ proveedor_id: contador.id, categoria: 'servicios_oficina', concepto: `Honorarios contables · hace ${m} meses`, total: 9280, fecha_documento: dia(-30 * m), dias_credito: 5, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'HC-' + (120 + 5 - m), iva: 1280 });
    await pagar(cont.id, 9280, dia(-30 * m + 4), 'transferencia', 'Santander empresa', 'SPEI honorarios');
    if (m % 2 === 0) { const luz = await cxp({ proveedor_id: prov.cfe.id, categoria: 'servicios_oficina', concepto: `Luz de oficina y taller · bimestre de hace ${m} meses`, total: 6800 + m * 120, fecha_documento: dia(-30 * m - 8), dias_credito: 10, tipo_comprobante: 'recibo' }); await pagar(luz.id, 6800 + m * 120, dia(-30 * m), 'transferencia', 'Santander empresa'); }
  }
  for (const [k, concepto, monto, hace, credito, pagado] of [['Balatas y tambores para el C-22', 14250, 50, 15, true], ['Filtros y aceite para E-37 y E-44', 8640, 34, 15, true], ['Bomba de inyección reconstruida (V-12)', 23800, 26, 15, false],
    ['Mangueras hidráulicas', 5420, 19, 15, false], ['Juego de toberas para hidrojet', 11900, 8, 15, false], ['Kit de empaques para bomba de vacío', 3150, 3, 15, false]]) {
    const g = await cxp({ proveedor_id: refa.id, categoria: 'refacciones', concepto: k, total: concepto, fecha_documento: dia(-monto), dias_credito: hace, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'RD-' + (700 + monto), iva: Math.round(concepto / 1.16 * 16) / 100 });
    if (credito) await pagar(g.id, concepto, dia(-monto + 14), 'transferencia', 'Santander empresa', 'SPEI refacciones');
    if (pagado === false && monto > 20) await pagar(g.id, 10000, dia(-monto + 15), 'transferencia', 'Santander empresa', 'Abono');
  }
  for (let s = 8; s >= 4; s--) { const c = await cxp({ proveedor_id: prov.comidas.id, categoria: 'casetas_viaticos', concepto: `Comidas del personal · semana de hace ${s}`, total: 6800 + s * 35, fecha_documento: dia(-7 * s - 1), dias_credito: 0, tipo_comprobante: 'sin_factura' }); await pagar(c.id, 6800 + s * 35, dia(-7 * s - 1), 'pagadora', 'Pagadora'); }

  // ===== Compras: más solicitudes en cada paso y dos compras completas =====
  const mantto = centros.find(c => c.nombre === 'Mantenimiento') || centros[0], opera = centros.find(c => c.nombre === 'Operaciones') || centros[0];
  for (const [que, para, quien, accion] of [['Casco y botas de seguridad (8 juegos)', 'Equipo de protección para la cuadrilla nueva', T, null], ['Cámara de video inspección de repuesto', 'La actual falla con el cable largo', T, 'aprobar'],
    ['Aceite hidráulico 200 L', 'Mantenimiento programado de la E-44', T, null], ['Impresora para la oficina', 'La de ventas ya no imprime a color', V, 'rechazar'], ['Lona y señalamientos viales', 'Para trabajos en vía pública', T, 'aprobar']]) {
    const s = await pedir('POST', '/compras/solicitudes', quien, { que, para_que: para, centro_id: opera.id, urgente: false });
    if (accion === 'aprobar') await pedir('POST', '/compras/solicitudes/' + s.id + '/aprobar', A);
    if (accion === 'rechazar') await pedir('POST', '/compras/solicitudes/' + s.id + '/rechazar', A, { motivo: 'Se usará la de dirección mientras tanto' });
  }
  // Proveedores propios de estos ejemplos (los del primer bloque tienen su historia fija en las pruebas).
  const pv = { refa };
  for (const [k, nombre] of [['baterias', 'Baterías y Acumuladores del Bajío'], ['ferre', 'Suministros Hidráulicos Sierra Gorda']]) pv[k] = await pedir('POST', '/finanzas/proveedores', A, { nombre, categoria: 'refacciones', dias_credito: 0 });
  for (const [que, partida, precio, prov3] of [['2 baterías para el camión C-22', 'Batería 12V 190 Ah', 4200, [['baterias', 8400], ['refa', 9100], ['ferre', 8900]]], ['Bomba de achique 3"', 'Bomba de achique 3" gasolina', 12900, [['ferre', 12900], ['refa', 14100], ['baterias', 13650]]]]) {
    const s = await pedir('POST', '/compras/solicitudes', T, { que, para_que: 'Reposición por desgaste', centro_id: mantto.id, urgente: false });
    await pedir('POST', '/compras/solicitudes/' + s.id + '/aprobar', A);
    for (const [k, monto] of prov3) await subir('/compras/solicitudes/' + s.id + '/documentos', C, pdf('cotizacion ' + k), { 'X-Tipo': 'cotizacion', 'X-Proveedor': pv[k].id, 'X-Monto': monto, 'X-Entrega': '2 días', 'X-Nombre': 'cotizacion-' + k + '.pdf' });
    const det = await pedir('GET', '/compras/solicitudes/' + s.id, C), elegida = det.cotizaciones.reduce((a, b) => (b.monto < a.monto ? b : a));
    await pedir('POST', '/compras/solicitudes/' + s.id + '/elegir', C, { cotizacion_id: elegida.id });
    const cant = /2 baterías/.test(que) ? 2 : 1;
    const oc = await pedir('POST', '/compras/ordenes', C, { solicitud_id: s.id, proveedor_id: elegida.proveedor_id, centro_id: mantto.id, categoria: 'refacciones', iva_modo: 'incluido', partidas: [{ cantidad: cant, descripcion: partida, unidad: 'PZA', precio: elegida.monto / cant }] });
    const aut = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 0 });
    await subir('/compras/ordenes/' + oc.id + '/documentos', C, x.png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'firma-almacen.png' });
    await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: 'Raúl Técnico', nota: 'Completo' });
    await pagar(aut.cxp_id, elegida.monto, dia(-1), 'transferencia', 'Santander empresa', 'SPEI ' + partida);
  }

  // ===== Prospección: 24 establecimientos más, con historial =====
  const sectores = await pedir('GET', '/prospeccion/sectores', A), sector = n => (sectores.find(s => s.nombre === n) || sectores[0]).id;
  const ZONAS = ['Centro', 'Juriquilla', 'El Marqués', 'Corregidora', 'Centro Sur', 'Zibatá', 'Milenio III', 'El Refugio'];
  const ESTADOS = ['investigar', 'pendiente', 'contactado', 'interesado', 'no_contactar'];
  for (let i = 0; i < 24; i++) {
    const sec = ['Restaurantes', 'Hoteles', 'Hospitales'][i % 3], est = ESTADOS[(i * 3) % 5];
    const nombre = `${['Restaurante', 'Hotel', 'Clínica'][i % 3]} ${NOMBRES[(i * 5 + 1) % NOMBRES.length]} ${ZONAS[i % ZONAS.length]}`;
    let e = await pedir('POST', '/prospeccion', V, { nombre, sector_id: sector(sec), zona: ZONAS[i % ZONAS.length], direccion: `${CALLES[(i + 2) % CALLES.length]} ${50 + i * 9}`, telefono: est === 'investigar' ? '' : `442 720 ${String(6000 + i).padStart(4, '0')}`,
      persona: est === 'investigar' ? '' : CONTACTOS[i % CONTACTOS.length], cargo: est === 'investigar' ? '' : ['Gerente', 'Mantenimiento', 'Compras'][i % 3], fuente: toma(['Recorrido de campo', 'Google Maps', 'Recomendación']),
      necesidades: est === 'investigar' ? '' : toma(['Trampa de grasa se satura', 'Cárcamo con malos olores', 'Planta de tratamiento sin mantenimiento', 'Drenaje se regresa en lluvias']), estado: 'investigar', responsable_id: idDe('ventas'), proximo_contacto: null });
    if (est === 'investigar') continue;
    const pasos = est === 'pendiente' ? [['llamada', 'No contestó; volver a marcar', 'pendiente', dia(i % 4)]]
      : est === 'contactado' ? [['visita', 'Se dejó tarjeta y tríptico', 'pendiente', dia(-6)], ['llamada', 'Habló el encargado; pidió precios por correo', 'contactado', dia(2 + (i % 5))]]
        : est === 'interesado' ? [['llamada', 'Interesado; agendar visita técnica', 'contactado', dia(-3)], ['visita', 'Se revisó el sitio; mandar cotización', 'interesado', dia(1)]]
          : [['llamada', 'Tienen contrato con otra empresa', 'no_contactar', null]];
    for (const [medio, texto, estado, sig] of pasos) e = await pedir('POST', '/prospeccion/' + e.id + '/seguimientos', V, { version: e.version, medio, texto, estado, proximo_contacto: sig });
  }

  // ===== Marketing: más publicaciones en cada paso, con resultados de las ya publicadas =====
  const MK = tok('marketing'), GM = tok('marketing_gerente');
  const paso = async (t, p, accion, extra = {}) => pedir('POST', '/marketing/publicaciones/' + p.id + '/estado', t, { accion, version: (await pedir('GET', '/marketing/publicaciones/' + p.id, t)).version, ...extra });
  const TEMAS = ['¿Cada cuánto limpiar la fosa séptica?', 'Señales de que tu drenaje está por taparse', 'Así trabaja nuestro hidrojet', 'Mitos sobre la grasa en el drenaje', 'Conoce a la cuadrilla de Querétaro',
    'Video inspección: qué es y para qué sirve', 'Temporada de lluvias: prepara tu cárcamo', 'Caso de éxito: planta industrial', 'Tip: no tires toallitas al WC', 'Rehabilitación sin romper (CIPP)',
    'Atención 24 horas', 'Detrás de cámaras: un día en servicio', 'Cuida el agua en tu negocio', 'Trampa de grasa: guía rápida', 'Preguntas frecuentes', 'Nuestra flota'];
  const REDES = [['facebook', 'instagram'], ['tiktok'], ['instagram'], ['linkedin'], ['facebook'], ['tiktok', 'instagram']];
  for (const [i, titulo] of TEMAS.entries()) {
    const d = -75 + i * 6, redes = REDES[i % REDES.length], quien = i % 4 === 3 ? GM : MK;
    const p = await pedir('POST', '/marketing/publicaciones', quien, { titulo, redes, formato: redes.includes('tiktok') ? 'reel' : 'post', sucursal: 'empresa', fecha: dia(d), hora: ['10:00', '13:00', '18:30'][i % 3], campana: ['Tips de mantenimiento', 'Detrás de cámaras', 'Temporada de lluvias'][i % 3], copy: titulo + ' 💧' });
    if (d < -2) {
      await paso(quien, p, 'enviar'); await paso(GM, p, 'aprobar'); await paso(quien, p, 'publicar');
      for (const red of redes) await pedir('PUT', '/marketing/publicaciones/' + p.id + '/metricas', quien, { red, valores: { alcance: 600 + i * 210, impresiones: 800 + i * 260, me_gusta: 30 + i * 9, comentarios: 2 + (i % 7), compartidos: 3 + (i % 9), mensajes: i % 5 }, enlace: '' });
    } else {
      const k = i % 5;
      if (k >= 1) await paso(quien, p, 'enviar');
      if (k === 2) await paso(GM, p, 'pedir_cambios', { comentario: 'Cambia la foto por una de la cuadrilla con uniforme' });
      if (k >= 3) await paso(GM, p, 'aprobar');
      if (k === 4) await paso(quien, p, 'programar');
    }
  }
  const mesDe = n => { const d = new Date(HOY + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  for (const [n, concepto, rubro, monto] of [[-4, 'Pauta Facebook · desazolve', 'pauta', 8200], [-3, 'Pauta Instagram · trampas de grasa', 'pauta', 7600], [-3, 'Diseño de 8 piezas', 'diseno', 6400], [-2, 'Video de la flota', 'video', 9500], [-2, 'Pauta TikTok · detrás de cámaras', 'pauta', 5200]])
    await pedir('POST', '/marketing/gastos', GM, { fecha: dia(Math.round((Date.parse(mesDe(n)) - Date.parse(HOY)) / 86400000) + 10), concepto, rubro, monto, proveedor: rubro === 'pauta' ? 'Meta' : 'Estudio de ejemplo' });

  // ===== Anticipos por comprobar (módulo contable F2, 2026-11-11): abiertos, uno vencido, uno que pasó del anticipo y uno cerrado con reintegro =====
  {
    const casetas = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Autopista y Peaje del Centro (ejemplo)', categoria: 'casetas_viaticos', dias_credito: 0 });
    const diesel = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Combustibles La Cañada (ejemplo)', categoria: 'combustible', dias_credito: 0 });
    const fonda = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Fonda Doña Chela (ejemplo)', categoria: 'casetas_viaticos', dias_credito: 0 });
    const anticipo = (t, cuerpo) => pedir('POST', '/anticipos', t, cuerpo);
    const gasto = (t, anticipo_id, proveedor, categoria, concepto, total, fecha, extra = {}) => pedir('POST', '/finanzas/cxp', t, { anticipo_id, proveedor_id: proveedor.id, categoria, concepto, total, fecha_documento: fecha, tipo_comprobante: 'recibo', ...extra });
    // Raúl (tiene usuario): ruta larga hace 12 días; comprobó casetas y diésel; le faltan $510 y ya pasó de 7 días (aviso a Dirección).
    const a1 = await anticipo(A, { personal_id: PER.raul, monto: 3000, metodo: 'efectivo', cuenta_origen: 'Caja chica', fecha: dia(-12), motivo: 'Casetas y diésel de la ruta a San Luis Potosí' });
    await gasto(T, a1.id, casetas, 'casetas_viaticos', 'Casetas Querétaro–San Luis ida y vuelta', 640, dia(-12));
    await gasto(T, a1.id, diesel, 'combustible', 'Diésel del camión de vacío', 1850, dia(-11), { tipo_comprobante: 'factura', factura_folio: 'CLC-7781', iva: 255.17 });
    // Juan: comida de la cuadrilla; comprobó $980 y regresó $520: cerrado con reintegro.
    const a2 = await anticipo(A, { personal_id: PER.juan, monto: 1500, metodo: 'transferencia', cuenta_origen: 'Santander empresa', referencia: 'SPEI 448812', fecha: dia(-20), motivo: 'Comida de la cuadrilla, semana de mantenimiento en planta' });
    await gasto(A, a2.id, fonda, 'casetas_viaticos', 'Comidas de la cuadrilla (5 días)', 980, dia(-18));
    await pedir('POST', '/anticipos/' + a2.id + '/cerrar', A, { metodo: 'efectivo', fecha: dia(-16), cuenta: 'Caja chica', nota: 'Regresó el sobrante en efectivo' });
    // Miguel: el gasto pasó del anticipo: $350 quedan por reembolsarle en Cuentas por pagar.
    const a3 = await anticipo(A, { personal_id: PER.miguel, monto: 2000, metodo: 'efectivo', cuenta_origen: 'Caja chica', fecha: dia(-3), motivo: 'Diésel para el servicio foráneo en Celaya' });
    await gasto(A, a3.id, diesel, 'combustible', 'Diésel de ida y vuelta a Celaya', 2350, dia(-2));
    // Luis: recién entregado, sin gastos todavía.
    await anticipo(A, { personal_id: PER.luis, monto: 1200, metodo: 'efectivo', cuenta_origen: 'Caja chica', fecha: dia(-1), motivo: 'Material menudo de campo (cinta, tornillería)' });
  }

  // ===== Asistencia: 4 semanas de checadas en el kiosco (con retardos, tiempo extra y olvidos) =====
  const insChecada = db.prepare(`INSERT INTO main.checadas (personal_id, tipo, momento_utc, fecha, hora, origen, sucursal_id, estado, biometria) VALUES (?, ?, ?, ?, ?, 'kiosco', ?, 'valida', 'coincide')`);
  const checar = (pid, suc, fecha, tipo, hora) => insChecada.run(pid, tipo, new Date(`${fecha}T${hora}:00-06:00`).toISOString(), fecha, hora + ':00', suc);
  const CAMPO = [[PER.raul, qroId], [PER.diego, qroId], [PER.juan, qroId], [PER.miguel, qroId], [PER.luis, qroId], [PER.oscar, cdmx.id], ...NUE.map(n => [n.id, n.suc ? cdmx.id : qroId])];
  const ausente = db.prepare(`SELECT 1 FROM main.incidencias_personal WHERE personal_id = ? AND cancelada = 0 AND tipo IN ('vacaciones','incapacidad','permiso','falta') AND ? BETWEEN fecha_inicio AND COALESCE(fecha_fin, fecha_inicio)`);
  const mm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  db.transaction(() => {
    for (let k = -28; k <= -1; k++) {
      const f = dia(k), dow = new Date(f + 'T12:00:00Z').getUTCDay(); if (dow === 0) continue;
      for (const [j, [pid, suc]] of CAMPO.entries()) {
        let falta = false; try { falta = !!ausente.get(pid, f); } catch { /* sin tabla de incidencias */ }
        if (falta) continue;
        const r = azar(), ent = 8 * 60 - 8 + Math.floor(azar() * 20) + (r < 0.06 ? 25 : 0) - (r > 0.97 ? 50 : 0); // a veces retardo; a veces llega muy temprano
        checar(pid, suc, f, 'entrada', mm(ent));
        if (dow === 6) { checar(pid, suc, f, 'salida', mm(14 * 60 + Math.floor(azar() * 10))); continue; }
        if (!(k === -2 && j === 3)) { checar(pid, suc, f, 'comida_sale', mm(14 * 60 + Math.floor(azar() * 15))); checar(pid, suc, f, 'comida_regresa', mm(15 * 60 + Math.floor(azar() * 12))); } // uno no marcó su comida
        if (k === -1 && j === 2) continue; // uno olvidó su salida ayer
        const sal = 18 * 60 + Math.floor(azar() * 12); checar(pid, suc, f, 'salida', mm(sal));
        if (azar() < 0.18 && !(k === -3 && j === 1)) { checar(pid, suc, f, 'extra_inicia', mm(sal + 20)); checar(pid, suc, f, 'extra_termina', mm(sal + 80 + Math.floor(azar() * 90))); }
        if (k === -3 && j === 1) checar(pid, suc, f, 'extra_inicia', mm(sal + 15)); // tiempo extra sin fin
      }
    }
  })();

  // ===== Nómina semanal (módulo contable F3, 2026-11-11): sueldos en las fichas, una semana pagada y la semana a pagar abierta =====
  {
    const SUELDOS = [[PER.raul, 2400, 600], [PER.diego, 2200, 500], [PER.juan, 2100, 450], [PER.miguel, 2100, 450], [PER.luis, 1800, 300], [PER.oscar, 2300, 550], ...NUE.map((n, i) => [n.id, 1900 + (i % 4) * 100, 250 + (i % 3) * 100])];
    // El resto del personal (oficina) también con sueldo semanal, para que la nómina de ejemplo no salga llena de pendientes.
    const conSueldo = new Set(SUELDOS.map(x => x[0]));
    for (const p of (await pedir('GET', '/personal?estado=activos', A)).filter(p => !conSueldo.has(p.id))) SUELDOS.push([p.id, 3200 + (p.id % 5) * 150, 0]);
    for (const [id, imss, bono] of SUELDOS) {
      const p = await pedir('GET', '/personal/' + id, A);
      await pedir('PUT', '/personal/' + id, A, { version: p.version, sueldo_imss_semanal: imss, bono_semanal: bono });
    }
    const netos = async nom => { for (const l of nom.lineas) if (l.sueldo_imss > 0) await pedir('PUT', '/nomina/lineas/' + l.id, A, { neto_imss: Math.round(l.sueldo_imss * 0.88 * 100) / 100 }); };
    // Bono de puntualidad (por puesto): Operador y Técnico $250 sin retardos ni faltas; Ayudante $150 con un retardo permitido.
    for (const [puesto, monto, ret] of [['Operador', 250, 0], ['Técnico', 250, 0], ['Ayudante', 150, 1]])
      await pedir('POST', '/nomina/reglas-puntualidad', A, { sucursal_id: qroId, puesto, monto, max_retardos: ret, max_faltas: 0, desde: dia(-60) });
    // Hace dos semanas (Querétaro): preparada, con un descuento por falta que decidió RH, cerrada y pagada por Santander.
    const vieja = await pedir('POST', '/nomina/preparar', A, { desde: dia(-14), sucursal_id: qroId });
    await netos(vieja);
    const conFalta = vieja.lineas.find(l => l.faltas > 0 && l.bono > 0);
    if (conFalta) await pedir('PUT', '/nomina/lineas/' + conFalta.id, A, { descuento: Math.min(conFalta.bono, 300), descuento_nota: 'Falta sin aviso (decidió RH descontarla)' });
    await pedir('POST', '/nomina/' + vieja.id + '/cerrar', A, { forzar: true, motivo: 'Ejemplo del demo: checadas olvidadas revisadas con el supervisor' });
    await pedir('POST', '/nomina/' + vieja.id + '/pagar', A, { metodo: 'layout', cuenta_origen: 'Santander nómina', fecha: dia(-6), referencia: 'Layout nómina' });
    // La semana a pagar (Querétaro): preparada y abierta, con netos a medias (el contador todavía no termina).
    const actual = await pedir('POST', '/nomina/preparar', A, { desde: dia(-7), sucursal_id: qroId });
    for (const l of actual.lineas.slice(0, 4)) if (l.sueldo_imss > 0) await pedir('PUT', '/nomina/lineas/' + l.id, A, { neto_imss: Math.round(l.sueldo_imss * 0.88 * 100) / 100 });
  }

  // ===== Conciliación bancaria (módulo contable F4, 2026-11-11): cuenta Santander con su estado de cuenta del último mes =====
  {
    const cta = await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Santander empresa', banco: 'Santander', terminacion: '4821', sucursal_id: qroId });
    const desde = dia(-35), hoyD = dia(0), masUno = f => (f >= hoyD ? f : dia(Math.min(0, Math.round((Date.parse(f + 'T12:00:00Z') - Date.parse(hoyD + 'T12:00:00Z')) / 864e5) + 1)));
    const dmy = f => f.split('-').reverse().join('/'), filas = [];
    for (const g of db.prepare("SELECT g.fecha, g.monto_cent, p.nombre FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id JOIN main.proveedores p ON p.id = x.proveedor_id WHERE g.cancelado = 0 AND g.cuenta_origen = 'Santander empresa' AND g.fecha >= ? AND x.sucursal_id = ?").all(desde, qroId))
      filas.push({ fecha: dmy(masUno(g.fecha)), concepto: 'SPEI ENVIADO ' + g.nombre.toUpperCase().slice(0, 30), referencia: '', cargo: (g.monto_cent / 100).toFixed(2), abono: '' });
    const cobros = db.prepare("SELECT k.fecha, k.monto_cent FROM main.cobros k JOIN main.leads l ON l.id = k.lead_id WHERE k.cancelado = 0 AND k.confirmado = 1 AND k.metodo = 'transferencia' AND k.fecha >= ? AND l.sucursal_id = ? ORDER BY k.fecha").all(desde, qroId);
    cobros.slice(0, Math.max(0, cobros.length - 2)).forEach((k, i) => filas.push({ fecha: dmy(masUno(k.fecha)), concepto: 'SPEI RECIBIDO CLIENTE', referencia: String(70000 + i), cargo: '', abono: (k.monto_cent / 100).toFixed(2) }));
    for (const k of [-30, -20, -10]) filas.push({ fecha: dmy(dia(k)), concepto: 'COMISION POR SPEI E IVA', referencia: '', cargo: '17.40', abono: '' });
    filas.push({ fecha: dmy(dia(-15)), concepto: 'TRASPASO A CUENTA BANORTE NOMINA', referencia: 'TR-1', cargo: '50000.00', abono: '' });
    filas.push({ fecha: dmy(dia(-8)), concepto: 'DEPOSITO EN EFECTIVO SUCURSAL', referencia: '', cargo: '', abono: '3480.00' });
    if (filas.length) await pedir('POST', '/conciliacion/cargar', A, { cuenta_id: cta.id, filas, archivo: 'estado_santander_ejemplo.xlsx', columnas: { fecha: 0, concepto: 1, referencia: 2, cargo: 3, abono: 4, importe: -1, saldo: -1, desde: 1 } });
  }
};
