// Expediente de la orden de compra (documentos, factura XML, pagos e historial), datos del formato, concepto
// obligatorio en costos con terceros y que quede registro de todo (historial de órdenes y bitácora general).
// Uso: node tests/simulacion-expediente.cjs   (usa una base temporal; los archivos quedan junto a ella)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-exp-')); const PUERTO = String(7300 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Expediente-' + Math.random().toString(36).slice(2) + '-4' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'e.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (t, oc, tipo, nombre, buf, nota = '') => { const x = await fetch(URL + '/compras/ordenes/' + oc + '/documentos', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t, 'X-Tipo': tipo, 'X-Nombre': encodeURIComponent(nombre), 'X-Nota': encodeURIComponent(nota) }, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const PDF = txt => Buffer.from('%PDF-1.4\n% ' + txt + '\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const CFDI = ({ total, rfc = 'RBA010101AB1', uuid = 'A1B2C3D4-0000-4000-8000-00000000000' + Math.floor(Math.random() * 9), folio = '501' }) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="${folio}" Fecha="${HOY}T10:00:00" SubTotal="${(total / 1.16).toFixed(2)}" Total="${total.toFixed(2)}" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE">
  <cfdi:Emisor Rfc="${rfc}" Nombre="REFACCIONARIA BAJIO"/><cfdi:Receptor Rfc="SAN010101AB1" Nombre="SANEADREN"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}"/></cfdi:Complemento>
</cfdi:Comprobante>`);

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A); // esta prueba es de el expediente de compras, no de «qué ve cada rol»
  await pedir('POST', '/usuarios', A, { nombre: 'Compras Exp', correo: 'compras.exp@saneadren.com.mx', password: 'Compras-Exp-2026', rol: 'costos' }); // encargado de centro de costos: hace las órdenes de compra
  const V = (await pedir('POST', '/login', null, { nombre: 'compras.exp@saneadren.com.mx', password: 'Compras-Exp-2026' }))[1].token;
  let s, j;

  seccion('1. Código del formato (sin revisión ni fechas de 2023)');
  [s, j] = await pedir('GET', '/compras/formato', V);
  revisa(j.codigo === 'CM-F-03' && j.revision === undefined && j.fecha_elaboracion === undefined && j.fecha_revision === undefined, 'el formato solo tiene su código: CM-F-03 (ya no revisión ni fechas de 2023)', j);
  [s] = await pedir('PUT', '/compras/formato', V, { codigo: 'CM-F-04' }); revisa(s === 403, 'ventas no cambia el código del formato');
  [s] = await pedir('PUT', '/compras/formato', A, { codigo: '<b>x</b>' }); revisa(s === 400, 'un código con símbolos raros no se acepta');
  [s, j] = await pedir('PUT', '/compras/formato', A, { codigo: 'CM-F-04', revision: '9', fecha_revision: '2023-01-01' });
  revisa(s === 200 && j.codigo === 'CM-F-04' && j.revision === undefined, 'el administrador cambia el código (lo de revisión se ignora)', j);
  [s, j] = await pedir('GET', '/auditoria?entidad=catalogo', A);
  revisa(j.some(r => r.accion === 'formato de orden de compra' && /codigo: CM-F-03 → CM-F-04/.test(r.detalle)), 'y queda en la bitácora', j.slice(0, 2));

  seccion('2. Orden de compra con historial');
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refaccionaria Bajío', categoria: 'refacciones', dias_credito: 15, rfc: 'RBA010101AB1' });
  const [, centros] = await pedir('GET', '/compras/centros', V);
  const base = { proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'refacciones', fecha: HOY, iva_modo: 'mas_iva', partidas: [{ cantidad: 2, descripcion: 'Manguera de succión', unidad: 'PZA', precio: 1000 }] };
  [s, j] = await pedir('POST', '/compras/ordenes', V, base); const oc = j; revisa(s === 201 && oc.total === 2320, 'orden de $2,320');
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, V, { ...base, version: oc.version, nota: 'Urgente para el E-37', partidas: [{ cantidad: 3, descripcion: 'Manguera de succión', unidad: 'PZA', precio: 1000 }] });
  revisa(s === 200 && j.total === 3480, 'se edita: 3 piezas, $3,480');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 30 }); revisa(s === 200, 'se autoriza');
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id + '/expediente', V);
  const acciones = j.historial.map(h => h.accion);
  revisa(['creada', 'editada', 'autorizada'].every(a => acciones.includes(a)), 'historial de la orden: creada, editada y autorizada (con quién y cuándo)', acciones);
  const editada = j.historial.find(h => h.accion === 'editada');
  revisa(/Nota: \(vacío\) → Urgente para el E-37/.test(editada?.detalle) && /Total: \$2,320\.00 → \$3,480\.00/.test(editada?.detalle) && /partidas: 3 PZA Manguera/.test(editada?.detalle), 'la edición dice exactamente qué cambió (nota, total y partidas)', editada?.detalle);
  revisa(j.lista.find(x => x.clave === 'autorizacion')?.listo && !j.lista.find(x => x.clave === 'factura_xml')?.listo, 'la lista del expediente: autorizada ✔, falta la factura', j.lista);

  seccion('3. Documentos del expediente');
  [s, j] = await subir(V, oc.id, 'cotizacion', 'cotizacion proveedor.pdf', PDF('cotizacion'), 'Cotización por WhatsApp');
  revisa(s === 201, 'sube la cotización del proveedor (PDF)', [s, j.error]);
  [s, j] = await subir(V, oc.id, 'cotizacion', 'otra vez.pdf', PDF('cotizacion')); revisa(s === 409, 'el mismo archivo dos veces → «ya está en este expediente»', [s, j.error]);
  [s, j] = await subir(V, oc.id, 'factura_xml', 'factura.pdf', PDF('no es xml')); revisa(s === 400, 'un PDF como «Factura XML» se rechaza', [s, j.error]);
  [s, j] = await subir(V, oc.id, 'evidencia', 'virus.exe', Buffer.from('MZ\x90\x00 esto no es un documento')); revisa(s === 400, 'un archivo que no es PDF, imagen o XML se rechaza (aunque se llame .pdf o .exe)', [s, j.error]);
  [s, j] = await subir(V, oc.id, 'evidencia', 'falso.pdf', Buffer.from('<html><script>alert(1)</script></html>')); revisa(s === 400, 'un HTML disfrazado de PDF se rechaza', [s, j.error]);
  [s, j] = await subir(V, oc.id, 'inventado', 'x.pdf', PDF('x')); revisa(s === 400, 'tipo de documento inventado');
  [s, j] = await subir(V, oc.id, 'otro', 'enorme.pdf', Buffer.concat([PDF('grande'), Buffer.alloc(10 * 1024 * 1024 + 10)])); revisa(s === 413, 'más de 10 MB se rechaza', s);
  [s, j] = await subir(V, oc.id, 'factura_xml', 'factura.xml', CFDI({ total: 3480, uuid: 'AAAA1111-2222-4333-8444-555566667777' }));
  revisa(s === 201 && !j.avisos.length && j.datos.uuid === 'AAAA1111-2222-4333-8444-555566667777' && j.datos.total === 3480, 'factura XML: se leen folio fiscal y total, y coinciden con la orden', [s, j]);
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id + '/expediente', V);
  revisa(j.orden.factura_folio === 'F-501' && j.cuenta_por_pagar.factura_folio === 'F-501', 'el folio de la factura queda en la orden y en su cuenta por pagar', [j.orden.factura_folio, j.cuenta_por_pagar.factura_folio]);
  [s, j2] = await pedir('POST', '/compras/ordenes', V, { ...base, partidas: [{ cantidad: 1, descripcion: 'Válvula', unidad: 'PZA', precio: 500 }] });
  [s, j] = await subir(V, j2.id, 'factura_xml', 'misma factura.xml', CFDI({ total: 580, uuid: 'AAAA1111-2222-4333-8444-555566667777' }));
  revisa(s === 409 && /OC-/.test(j.error), 'la misma factura (folio fiscal) en otra orden → se detiene', [s, j.error]);
  [s, j] = await subir(V, j2.id, 'factura_xml', 'factura rara.xml', CFDI({ total: 999, rfc: 'OTR010101AB1', uuid: 'BBBB1111-2222-4333-8444-555566667777', folio: '777' }));
  revisa(s === 201 && j.avisos.length === 2, 'factura con otro total y otro RFC → se sube pero con 2 avisos', [s, j.avisos]);
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id + '/expediente', V);
  const doc = j.documentos.find(d => d.tipo === 'cotizacion');
  const r = await fetch(URL + '/compras/documentos/' + doc.id, { headers: { Authorization: 'Bearer ' + V } });
  const bytes = Buffer.from(await r.arrayBuffer());
  revisa(r.status === 200 && bytes.equals(PDF('cotizacion')) && r.headers.get('x-content-type-options') === 'nosniff' && /attachment/.test(r.headers.get('content-disposition')), 'se descarga idéntico y como archivo adjunto (nunca se abre como página)');
  revisa((await fetch(URL + '/compras/documentos/' + doc.id)).status === 401, 'sin sesión no se descarga nada');
  [s] = await pedir('POST', '/compras/documentos/' + doc.id + '/quitar', V, { motivo: 'Me equivoqué' }); revisa(s === 403, 'ventas no quita documentos de una orden ya autorizada');
  [s] = await pedir('POST', '/compras/documentos/' + doc.id + '/quitar', A, { motivo: '....' }); revisa(s === 400, 'quitar exige un motivo real');
  [s] = await pedir('POST', '/compras/documentos/' + doc.id + '/quitar', A, { motivo: 'Era de otro proveedor' }); revisa(s === 200, 'administración lo quita con motivo');
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id + '/expediente', V);
  const quitado = j.documentos.find(d => d.id === doc.id);
  revisa(quitado.eliminado && quitado.eliminado_por === 'admin' && /otro proveedor/.test(quitado.motivo_eliminado), 'el documento quitado sigue a la vista: quién, cuándo y por qué');
  revisa(j.historial.filter(h => /documento/.test(h.accion)).length >= 3, 'cada documento subido o quitado queda en el historial', j.historial.map(h => h.accion));
  await pedir('POST', '/finanzas/cxp/' + j.cuenta_por_pagar.id + '/pagos', A, { monto: 3480, metodo: 'transferencia', fecha: HOY, referencia: 'SPEI 99' });
  [s, j] = await subir(A, oc.id, 'comprobante_pago', 'spei.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]));
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id + '/expediente', V);
  revisa(j.cuenta_por_pagar.saldo === 0 && j.cuenta_por_pagar.pagos.length === 1 && j.lista.find(x => x.clave === 'pago').listo && j.lista.find(x => x.clave === 'comprobante_pago').listo, 'pagada y con comprobante: la lista lo marca completo', j.lista);

  seccion('4. Costos con terceros: el concepto lo escribe quien registra');
  const [, canales] = await pedir('GET', '/canales', V); const [, servicios] = await pedir('GET', '/servicios', V); const [, usuarios] = await pedir('GET', '/usuarios', A);
  const vid = usuarios.find(u => u.nombre === 'Compras Exp').id;
  const [, cli] = await pedir('POST', '/contactos', V, { nombre: 'Ing. Pérez', telefono: '4426660101', empresa_contacto: 'Planta Norte', direccion: 'Qro', canal_origen_id: canales[0].id });
  [s, j] = await pedir('POST', '/leads', V, { cliente_id: cli.id, direccion: 'Planta', responsable_id: vid, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de cárcamo principal', importe: 9000 }]), valor: 9000, estatus: 'ganado', fecha_servicio: HOY });
  const os = j;
  const [, pipas] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas del Centro', categoria: 'residuos' });
  const gasto = c => ({ estado: 'realizado', fecha: HOY, realizado_por: 'subcontratado', gastos: [{ proveedor_id: pipas.id, categoria: 'residuos', concepto: c, total: 2000 }] });
  for (const [c, txt] of [['', 'vacío'], ['...', 'puros puntos'], [servicios[0].nombre, 'igual al nombre del servicio'], ['desazolve de carcamo principal', 'igual a la descripción del servicio (sin acentos)']]) {
    [s, j] = await pedir('POST', '/leads/' + os.id + '/ejecucion', V, gasto(c)); revisa(s === 400, `concepto del costo ${txt} → se rechaza`, [s, j.error]);
  }
  [s, j] = await pedir('POST', '/leads/' + os.id + '/ejecucion', V, gasto('Renta de pipa 20 m³ para lodos')); revisa(s === 200, 'con su concepto propio sí se registra');
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { proveedor_id: pipas.id, categoria: 'residuos', concepto: servicios[0].nombre, total: 500, fecha_documento: HOY, dias_credito: 15, lead_id: os.id });
  revisa(s === 400, 'tampoco desde Cuentas por pagar con el nombre del servicio', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { proveedor_id: pipas.id, categoria: 'residuos', concepto: 'Disposición final de lodos', total: 500, fecha_documento: HOY, dias_credito: 15, lead_id: os.id });
  revisa(s === 201, 'costo extra con concepto propio ligado a la orden');

  seccion('5. Historial de la orden de servicio: queda registro de todo');
  [s, j] = await pedir('GET', '/leads/' + os.id, V);
  [s] = await pedir('PUT', '/leads/' + os.id, V, { version: j.version, direccion: 'Cárcamo norte', equipo: 'E-37', operador: 'Bogar Tamayo', notas_iniciales: 'Llevar manguera de 30 m' });
  const [, hist] = await pedir('GET', '/leads/' + os.id, V);
  const textos = (Array.isArray(hist) ? hist : hist.historial || []).map(h => h.texto);
  const tiene = re => textos.some(t => re.test(t));
  revisa(tiene(/Servicio registrado directamente como contratado/), 'alta de la orden');
  revisa(tiene(/Servicio realizado el/) && tiene(/Gastos generados cargados.*Renta de pipa 20 m³ para lodos/), 'realizado y, en su anotación de gastos, el concepto de cada costo con terceros');
  revisa(tiene(/Costo con terceros registrado: «Disposición final de lodos» de Pipas del Centro/), 'costo agregado después desde Cuentas por pagar');
  revisa(tiene(/Cambios: .*ubicación: Planta → Cárcamo norte.*equipo: \(vacío\) → E-37.*operador: \(vacío\) → Bogar Tamayo/), 'cambios de ubicación, equipo y operador (de qué a qué)', textos.filter(t => /Cambios/.test(t)));
  [s, j] = await pedir('POST', '/leads', V, { cliente_id: cli.id, direccion: 'Planta', responsable_id: vid, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 1000 }]), valor: 1000, fecha_cotizacion: HOY });
  const cot = j;
  [s, j] = await pedir('GET', '/leads/' + cot.id, V);
  [s] = await pedir('PUT', '/leads/' + cot.id, V, { version: j.version, etapa: 3, responsable_id: 1 });
  [s, j] = await pedir('GET', '/leads/' + cot.id, V);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, V, { version: j.version, estatus: 'perdido' }); revisa(s === 400 && j.codigo === 'FALTA_MOTIVO_PERDIDA', 'marcar como no aceptada pide el motivo', [s, j.error]);
  [s] = await pedir('PUT', '/leads/' + cot.id, V, { version: j.version, estatus: 'perdido', motivo_perdida: 'Precio alto, eligió a otro' });
  const [, h2] = await pedir('GET', '/leads/' + cot.id, V);
  const t2 = (Array.isArray(h2) ? h2 : h2.historial || []).map(h => h.texto);
  revisa(t2.some(t => /Cotización creada/.test(t)) && t2.some(t => /etapa Cotización enviada → Negociación/.test(t)) && t2.some(t => /responsable Compras Exp → admin/.test(t)) && t2.some(t => /marcada como no aceptada/.test(t)), 'cotización: creada, cambio de etapa, cambio de responsable y marcada como no aceptada', t2);
  [s] = await pedir('DELETE', '/leads/' + cot.id, A, { motivo: 'Cotización de prueba' });
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_servicio', A);
  revisa(s === 200 && j.some(r => r.entidad_id === cot.id && r.accion === 'eliminado' && /COT-/.test(r.detalle) && /movimientos en su historial/.test(r.detalle)), 'al eliminarla queda una foto en la bitácora (qué era y cuántos movimientos tenía)', j.slice(0, 1));

  seccion('6. Bitácora general');
  await pedir('PUT', '/clientes/' + cli.id, V, { correo: 'perez@plantanorte.mx', rfc: 'PNO010101AB1' });
  [s, j] = await pedir('GET', '/auditoria?entidad=cliente&id=' + cli.id, V);
  revisa(j.some(r => r.accion === 'creado') && j.some(r => r.accion === 'editado' && /Correo: \(vacío\) → perez@plantanorte.mx/.test(r.detalle) && /RFC/.test(r.detalle)), 'cliente: alta y cambios de datos (de qué a qué)', j.map(r => r.accion + ': ' + r.detalle));
  [s, j] = await pedir('GET', '/auditoria?entidad=usuario', A);
  revisa(j.some(r => r.accion === 'creado' && /Compras Exp/.test(r.detalle)), 'usuarios: queda quién los dio de alta');
  [s, j] = await pedir('GET', '/auditoria?entidad=cuenta_por_pagar', A);
  revisa(j.some(r => r.accion === 'pago' && /SPEI 99/.test(r.detalle)), 'pagos a proveedores con su referencia');
  [s] = await pedir('GET', '/auditoria', V); revisa(s === 403, 'la bitácora completa es solo para administración');
  [s, j] = await pedir('GET', '/auditoria?q=Pipas', A); revisa(s === 200 && j.length >= 1, 'se puede buscar en la bitácora');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error en |TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(400); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
