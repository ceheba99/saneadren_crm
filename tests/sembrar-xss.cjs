// Siembra «código trampa» (HTML/JS escondido en textos) en TODOS los campos de texto que se pueden capturar, sobre un
// servidor de prueba en modo demo. Después se recorre la pantalla en el navegador: si alguna vista no escapa un texto,
// el código se ejecuta y deja window.__xss > 0 (o aparecen elementos con onerror/onload en la página).
// Uso: node tests/sembrar-xss.cjs http://localhost:3917   (solo contra un servidor con MODO_DEMO=1)
const BASE = (process.argv[2] || 'http://localhost:3917').replace(/\/$/, '') + '/api';
const X = n => `<img src=x onerror="window.__xss=(window.__xss||0)+1;window.__xssDe=(window.__xssDe||[]).concat('${n}')">"><svg onload="window.__xss=(window.__xss||0)+1">'+alert(1)+'`;
let ok = 0, rechazados = 0;
const pedir = async (m, r, t, b) => { const x = await fetch(BASE + r, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b === undefined ? undefined : JSON.stringify(b) }); const j = await x.json().catch(() => ({})); if (x.status < 300) ok++; else rechazados++; return [x.status, j]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(BASE + r, { method: 'POST', headers: h, body: buf }); if (x.status < 300) ok++; else rechazados++; return x.status; };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
(async () => {
  const est = await fetch(BASE + '/demo/estado').then(r => r.json()); if (!est.demo) throw new Error('Solo contra un servidor demo');
  const A = (await fetch(BASE + '/demo/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol: 'admin' }) }).then(r => r.json())).token;
  const [, servicios] = await pedir('GET', '/servicios', A), [, canales] = await pedir('GET', '/canales', A), [, centros] = await pedir('GET', '/compras/centros', A), [, usuarios] = await pedir('GET', '/usuarios', A);
  const vend = usuarios.find(u => u.rol === 'ventas').id;
  // Cliente y cotización/orden con trampas en cada texto libre.
  const [, cli] = await pedir('POST', '/contactos', A, { nombre: 'Trampa Cliente Xss', telefono: '4425550199', empresa_contacto: 'Empresa Trampa SA', direccion: X('direccion cliente'), canal_origen_id: canales[0].id, notas_generales: X('notas cliente') });
  if (cli.id) await pedir('PUT', '/clientes/' + cli.id, A, { notas_generales: X('notas cliente 2'), direccion: X('direccion cliente 2'), giro: X('giro') });
  const [, l] = await pedir('POST', '/leads', A, { cliente_id: cli.id, direccion: X('direccion orden'), canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vend, forzar_duplicado: true, notas_iniciales: X('notas iniciales'),
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: X('leyenda partida'), importe: 1000 }]), iva_modo: 'mas_iva', valor: 1, notas_cotizacion: X('notas cotizacion') });
  const [, lx] = await pedir('GET', '/leads/' + l.id, A);
  await pedir('PUT', '/leads/' + l.id, A, { version: lx.version, estatus: 'ganado', fecha_servicio: HOY, equipo: X('equipo'), operador: X('operador'), observaciones: X('observaciones'), proyecto: X('proyecto'), manifiestos: X('manifiestos'), tiros: X('tiros') });
  await pedir('POST', '/leads/' + l.id + '/historial', A, { tipo: 'observacion', texto: X('historial') });
  await pedir('POST', '/leads/' + l.id + '/historial', A, { tipo: 'alerta', texto: X('recordatorio'), fecha_alerta: HOY + ' 09:00:00' });
  const [, provs] = await pedir('GET', '/finanzas/proveedores', A);
  await pedir('POST', '/leads/' + l.id + '/ejecucion', A, { estado: 'realizado', fecha: HOY, gastos: [{ proveedor_id: provs[0].id, categoria: 'combustible', concepto: X('concepto gasto orden'), total: 100 }] });
  await pedir('PUT', '/leads/' + l.id + '/facturacion', A, { dias_credito: 5, factura_folio: X('folio factura'), factura_fecha: HOY });
  await pedir('POST', '/leads/' + l.id + '/cobros', A, { monto: 10, metodo: 'efectivo', fecha: HOY, referencia: X('referencia cobro'), notas: X('notas cobro') });
  const [, lx2] = await pedir('GET', '/leads/' + l.id, A);
  await pedir('PUT', '/leads/' + l.id, A, { version: lx2.version, encuesta_calificacion: 2, encuesta_comentario: X('encuesta') });
  // Proveedor, cuentas por pagar y pagos.
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Proveedor Trampa', categoria: 'otro', dias_credito: 0, contacto: X('contacto proveedor'), notas: X('notas proveedor'), banco: X('banco'), telefono: '4425550198' });
  const [, cx] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id || provs[0].id, categoria: 'otro', concepto: X('concepto cxp'), total: 500, fecha_documento: HOY, dias_credito: 5, tipo_comprobante: 'recibo', notas: X('notas cxp'), equipo: X('equipo cxp'), beneficiario: X('beneficiario') });
  if (cx.id) await pedir('POST', '/finanzas/cxp/' + cx.id + '/pagos', A, { monto: 100, metodo: 'transferencia', fecha: HOY, referencia: X('referencia pago'), cuenta_origen: X('cuenta origen') });
  // Compras: solicitud, cotización (nombre de archivo), orden de compra.
  const [, so] = await pedir('POST', '/compras/solicitudes', A, { que: X('que solicitud'), para_que: X('para que solicitud') + ' con suficiente texto', centro_id: centros[0].id, equipo: X('equipo solicitud'), urgente: true });
  if (so.id) await subir('/compras/solicitudes/' + so.id + '/documentos', A, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Tipo': 'cotizacion', 'X-Proveedor': provs[0].id, 'X-Monto': 900, 'X-Entrega': X('entrega'), 'X-Nombre': X('nombre archivo') + '.pdf' });
  const [, oc] = await pedir('POST', '/compras/ordenes', A, { forzar: true, proveedor_id: provs[0].id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', nota: X('nota oc'), observaciones: X('observaciones oc'),
    solicitante_nombre: X('solicitante'), solicitante_cargo: X('cargo'), partidas: [{ cantidad: 1, descripcion: X('descripcion partida oc'), unidad: X('unidad'), clave: X('clave'), precio: 100 }] });
  if (oc.id) await subir('/compras/ordenes/' + oc.id + '/documentos', A, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Tipo': 'factura', 'X-Nombre': X('archivo oc') + '.pdf' });
  // Catálogos, personal y prospección.
  await pedir('POST', '/compras/centros', A, { nombre: 'Centro Trampa', responsable: X('responsable centro') });
  await pedir('POST', '/tipos-cliente', A, { nombre: 'Tipo Trampa', descripcion: X('descripcion tipo') });
  await pedir('PUT', '/canales/' + canales[0].id, A, { nombre: canales[0].nombre, descripcion: X('descripcion canal') });
  const [, per] = await pedir('POST', '/personal', A, { nombre: 'Persona Trampa', puesto: 'Operador', direccion: X('direccion persona'), contacto_emergencia: X('emergencia'), notas: X('notas persona'), licencia_numero: X('licencia'), banco: X('banco persona') });
  if (per.id) {
    await pedir('POST', '/personal/' + per.id + '/incidencias', A, { tipo: 'permiso', fecha_inicio: HOY, notas: X('notas incidencia') });
    await subir('/personal/' + per.id + '/documentos', A, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Tipo': 'otro', 'X-Nombre': X('archivo persona') + '.pdf' });
  }
  const [, sectores] = await pedir('GET', '/prospeccion/sectores', A);
  await pedir('POST', '/prospeccion', A, { nombre: 'Establecimiento Trampa', sector_id: sectores[0].id, zona: X('zona'), direccion: X('direccion prospecto'), persona: X('persona'), cargo: X('cargo prospecto'), fuente: X('fuente'), necesidades: X('necesidades'), estado: 'pendiente', responsable_id: vend, proximo_contacto: HOY });
  await pedir('POST', '/roles', A, { nombre: 'Rol Trampa', descripcion: X('descripcion rol') });
  console.log(JSON.stringify({ guardados: ok, rechazados, lead: l.id, cliente: cli.id, solicitud: so.id, oc: oc.id, persona: per.id, cxp: cx.id, proveedor: prov.id }));
})().catch(e => { console.error(e); process.exit(1); });
