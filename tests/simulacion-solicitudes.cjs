// Solicitud de compra → aprobación → 3 cotizaciones → elegir → orden de compra → recibido con foto o firma.
// Incluye la excepción por urgencia, permisos por rol y trampas (archivos repetidos, mismo proveedor dos veces…).
// Uso: node tests/simulacion-solicitudes.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-solicitudes-')); const PUERTO = String(5700 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Sol-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 's.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const pdf = () => Buffer.from('%PDF-1.4\n% cotizacion ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A); // esta prueba es de el flujo de solicitudes, no de «qué ve cada rol»
  let s, j;
  console.log('1. Rol «costos»');
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Isaac Compras', correo: 'isaac.compras@saneadren.com.mx', password: 'Isaac-Compras-2026', rol: 'costos' });
  revisa(s === 201 || s === 200, 'administración crea un usuario con rol costos (encargado de centro de costos)', [s, j.error]);
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Rol Inventado', password: 'Inventado-Rol-2026', rol: 'jefe' }); revisa(s === 400, 'un rol que no existe se rechaza');
  await pedir('POST', '/usuarios', A, { nombre: 'Laura Ventas', correo: 'laura.v@saneadren.com.mx', password: 'Ventas-Sol-2026x', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Pedro Tecnico', correo: 'pedro.t@saneadren.com.mx', password: 'Tecnico-Sol-2026x', rol: 'tecnico' });
  const C = (await pedir('POST', '/login', null, { nombre: 'isaac.compras@saneadren.com.mx', password: 'Isaac-Compras-2026' }))[1].token;
  const V = (await pedir('POST', '/login', null, { nombre: 'laura.v@saneadren.com.mx', password: 'Ventas-Sol-2026x' }))[1].token;
  const T = (await pedir('POST', '/login', null, { nombre: 'pedro.t@saneadren.com.mx', password: 'Tecnico-Sol-2026x' }))[1].token;
  revisa(C && V && T, 'los tres usuarios entran');
  const centros = (await pedir('GET', '/compras/centros', V))[1], mantto = centros.find(c => c.nombre === 'Mantenimiento');
  const prov = {};
  for (const [k, nombre] of [['a', 'LLANTERA QUERETARO'], ['b', 'LLANTAS DEL BAJIO'], ['c', 'SERVILLANTAS']]) prov[k] = (await pedir('POST', '/finanzas/proveedores', A, { nombre, categoria: 'refacciones', dias_credito: 15 }))[1];
  revisa(prov.a?.id && prov.b?.id && prov.c?.id, 'hay 3 proveedores de llantas', prov);

  console.log('2. Cualquiera pide');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '', para_que: 'para el camión', centro_id: mantto.id }); revisa(s === 400, 'sin decir qué necesita no se acepta');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '4 llantas 11R22.5', para_que: 'ya', centro_id: mantto.id }); revisa(s === 400, 'el para qué necesita al menos 5 letras');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '4 llantas 11R22.5', para_que: 'Al camión C-22 se le reventó una' }); revisa(s === 400, 'sin área (centro de costos) no se acepta');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '<script>x</script>', para_que: 'Al camión C-22 se le reventó una', centro_id: mantto.id }); revisa(s === 400, 'no acepta código en el texto');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '4 llantas 11R22.5', para_que: 'Al camión C-22 se le reventó una', centro_id: mantto.id, fecha_requerida: '2020-01-01' }); revisa(s === 400, 'para cuándo no puede ser en el pasado');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '4 llantas 11R22.5', para_que: 'Al camión C-22 se le reventó una y las demás están lisas', centro_id: mantto.id, equipo: 'C-22' });
  const sol = j;
  revisa(s === 201 && sol.estado === 'por_aprobar' && /^SOL-QRO-\d{6}-0001$/.test(sol.folio) && sol.solicitante_nombre === 'Laura Ventas', 'ventas pide: queda «por aprobar» con folio SOL', [s, j.folio, j.error]);
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: '4 LLANTAS 11R22.5 ', para_que: 'Otra vez lo mismo por error de doble clic', centro_id: mantto.id });
  revisa(s === 409 && j.codigo === 'POSIBLE_DUPLICADO', 'pedir lo mismo otra vez pregunta antes (aunque cambien mayúsculas)', [s, j]);
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', V, png(), { 'X-Tipo': 'foto', 'X-Nombre': 'llanta.png' }); revisa(s === 201, 'quien pidió sube la foto de la llanta', [s, j.error]);
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', V, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '16800', 'X-Nombre': 'a.pdf' });
  revisa(s === 409, 'no se cotiza antes de aprobar', [s, j.error]);

  console.log('3. Aprobar: encargado de centro de costos o administración');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', V); revisa(s === 403, 'ventas no aprueba');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', T); revisa(s === 403, 'técnico no aprueba');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', C); revisa(s === 200 && j.estado === 'cotizando' && j.aprobada_por === 'Isaac Compras', 'el encargado de centro de costos la aprueba: pasa a cotizar', [s, j.estado, j.error]);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', A); revisa(s === 409, 'no se aprueba dos veces');

  console.log('4. Tres cotizaciones de proveedores distintos');
  const archivoA = pdf();
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', T, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '16800', 'X-Nombre': 't.pdf' }); revisa(s === 403, 'otro usuario (ni quien pidió ni el encargado) no sube cotizaciones');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', V, archivoA, { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '0', 'X-Nombre': 'a.pdf' }); revisa(s === 400, 'una cotización de $0 no se acepta');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', V, Buffer.from('hola esto no es pdf'), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '16800', 'X-Nombre': 'falso.pdf' }); revisa(s === 400, 'un archivo que no es PDF ni imagen (aunque se llame .pdf) no se acepta');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', V, Buffer.alloc(0), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '16800' }); revisa(s === 400, 'sin archivo no hay cotización');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', V, archivoA, { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '$16,800.00', 'X-Entrega': '1 día', 'X-Nombre': 'cotizacion llantera qro.pdf' });
  revisa(s === 201 && j.solicitud.cotizaciones_count === 1, 'quien pidió sube la 1.ª cotización ($16,800 escrito con signo y comas)', [s, j.error]);
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', C, archivoA, { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.b.id, 'X-Monto': '15800', 'X-Nombre': 'copia.pdf' }); revisa(s === 409, 'el MISMO archivo no cuenta como otra cotización');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '16500', 'X-Nombre': 'a2.pdf' }); revisa(s === 409, 'dos cotizaciones del mismo proveedor no cuentan como dos');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.b.id, 'X-Monto': '15800', 'X-Entrega': '2 días', 'X-Nombre': 'bajio.pdf' });
  revisa(s === 201 && j.solicitud.cotizaciones_count === 2 && j.solicitud.cotizaciones_faltan === 1, 'el encargado sube la 2.ª: falta 1', [s, j.error]);
  const cotB = (await pedir('GET', '/compras/solicitudes/' + sol.id, V))[1].cotizaciones.find(c => c.proveedor_id === prov.b.id);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cotB.id }); revisa(s === 409 && j.codigo === 'FALTAN_COTIZACIONES', 'con 2 de 3 no se puede elegir', [s, j]);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cotB.id, motivo_urgencia: 'ya' }); revisa(s === 409, 'la excepción necesita un motivo de verdad (mínimo 10 letras)');
  [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', C, png(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.c.id, 'X-Monto': '17200', 'X-Entrega': '3 días', 'X-Nombre': 'servillantas.png' });
  revisa(s === 201 && j.solicitud.cotizaciones_faltan === 0, 'la 3.ª cotización (foto PNG) completa las 3', [s, j.error]);
  [s, j] = await pedir('GET', '/compras/solicitudes/' + sol.id, V);
  revisa(j.mas_barata_id === cotB.id && j.cotizaciones.length === 3, 'el cuadro marca la más barata (Llantas del Bajío $15,800)', [j.mas_barata_id, cotB.id]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { solicitud_id: sol.id, proveedor_id: prov.b.id, centro_id: mantto.id, iva_modo: 'incluido', partidas: [{ cantidad: 4, descripcion: 'Llanta 11R22.5', precio: 3950 }] });
  revisa(s === 409, 'no se hace la orden antes de elegir la cotización', [s, j.error]);

  console.log('5. Elegir (encargado o administración)');
  const cotA = j && (await pedir('GET', '/compras/solicitudes/' + sol.id, V))[1].cotizaciones.find(c => c.proveedor_id === prov.a.id);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', V, { cotizacion_id: cotB.id }); revisa(s === 403, 'ventas no elige');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: 999999 }); revisa(s === 400, 'no se elige una cotización de otra solicitud');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cotA.id }); revisa(s === 409 && j.codigo === 'MOTIVO_ELECCION', 'si no es la más barata, pide el motivo', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cotA.id, motivo_eleccion: 'Entrega en un día, el camión no puede esperar' }); revisa(s === 200 && j.estado === 'elegida' && j.ganadora.proveedor_id === prov.a.id && /no puede esperar/.test(j.motivo_eleccion), 'con motivo, el encargado elige una que no es la más barata', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cotB.id }); revisa(s === 200 && j.ganadora.proveedor_id === prov.b.id, 'puede cambiar de opinión antes de hacer la orden');
  [s, j] = await pedir('GET', '/auditoria?entidad=solicitud_compra&id=' + sol.id, V);
  revisa(j.some(r => r.accion === 'cotización elegida' && /no es la más barata.*motivo: Entrega en un día/.test(r.detalle)), 'queda registrado con su motivo cuando no era la más barata');
  [s, j] = await pedir('POST', '/compras/solicitudes/documentos/' + cotB.id + '/quitar', C, { motivo: 'ya no me gusta esta' }); revisa(s === 409, 'la cotización elegida no se puede quitar');

  console.log('6. Orden de compra desde la solicitud');
  const baseOC = { solicitud_id: sol.id, centro_id: mantto.id, categoria: 'refacciones', iva_modo: 'incluido', partidas: [{ cantidad: 4, descripcion: 'Llanta 11R22.5', unidad: 'PZA', precio: 3950 }] };
  [s, j] = await pedir('POST', '/compras/ordenes', V, { ...baseOC, proveedor_id: prov.b.id }); revisa(s === 403 && /Solicitud de compra/.test(j.error), 'ventas no hace órdenes de compra (se le dice que haga una solicitud)', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, proveedor_id: prov.a.id }); revisa(s === 400, 'la orden debe ir con el proveedor de la cotización elegida', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, proveedor_id: prov.b.id });
  const oc = j;
  revisa(s === 201 && oc.solicitud_folio === sol.folio && oc.total === 15800, 'el encargado crea la orden: lleva el folio de la solicitud y $15,800', [s, j.error, j.solicitud_folio, j.total]);
  [s, j] = await pedir('GET', '/compras/solicitudes/' + sol.id, V); revisa(j.estado === 'con_orden' && j.oc_id === oc.id && j.oc_folio === oc.folio, 'la solicitud queda «con orden de compra»', [j.estado, j.oc_folio]);
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id + '/expediente', V);
  revisa(j.documentos.some(d => d.tipo === 'cotizacion' && d.nombre === 'bajio.pdf'), 'la cotización elegida pasó sola al expediente de la orden', j.documentos?.map(d => d.nombre));
  revisa(j.lista.some(x => x.clave === 'recepcion' && !x.listo), 'el expediente muestra «Recibido» pendiente');
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, proveedor_id: prov.b.id }); revisa(s === 409, 'no se hacen dos órdenes de la misma solicitud');
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, C, { ...baseOC, proveedor_id: prov.c.id, version: oc.version }); revisa(s === 400, 'en la orden no se cambia el proveedor de la cotización elegida');
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, V, { ...baseOC, proveedor_id: prov.b.id, version: oc.version }); revisa(s === 403, 'ventas no edita la orden');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/cancelar', V, { motivo: 'no la quiero' }); revisa(s === 403, 'ventas no cancela la orden');

  console.log('7. Recibido con foto y/o firma (encargado)');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', V, { recibio: 'Laura' }); revisa(s === 403, 'ventas no marca recibido');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: 'Isaac Hernández' }); revisa(s === 400 && /foto|firma/.test(j.error), 'sin foto ni firma no se marca recibido', [s, j.error]);
  [s, j] = await subir('/compras/ordenes/' + oc.id + '/documentos', C, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'firma.png', 'X-Nota': 'Recepción' }); revisa(s === 201, 'se sube la firma de quien recibe', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: '' }); revisa(s === 400, 'hay que decir quién recibió');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: 'Isaac Hernández', nota: 'Llegaron las 4' });
  revisa(s === 200 && j.recibida_at && j.recibio_nombre === 'Isaac Hernández', 'el encargado la marca recibida', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', A, { recibio: 'Otro' }); revisa(s === 409, 'no se marca recibida dos veces');
  [s, j] = await pedir('GET', '/compras/solicitudes/' + sol.id, V); revisa(j.estado === 'recibida', 'la solicitud termina como «Recibida»');
  const pasos = j.historial.map(r => r.accion);
  revisa(['creada', 'foto', 'aprobada', 'cotización', 'cotización elegida', 'orden de compra', 'recibida'].every(a => pasos.includes(a)), 'el historial tiene todo: pidió, foto, aprobó, cotizaciones, eligió, orden y recibido', pasos);
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, C, { ...baseOC, proveedor_id: prov.b.id, version: (await pedir('GET', '/compras/ordenes/' + oc.id, C))[1].version, partidas: [{ cantidad: 4, descripcion: 'Llanta 11R22.5', precio: 5000 }] }); revisa(s === 409, 'una orden ya recibida no se edita (no se le puede cambiar el precio)', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/cancelar', C, { motivo: 'Se devolvieron las llantas' }); revisa(s === 403, 'una orden recibida solo la cancela un administrador', [s, j.error]);

  console.log('8. Urgente sin las 3 cotizaciones');
  [s, j] = await pedir('POST', '/compras/solicitudes', T, { que: 'Bomba de achique 2 pulgadas', para_que: 'Se quemó la bomba en servicio de emergencia KFC', centro_id: mantto.id, urgente: true });
  const urg = j; revisa(s === 201 && urg.urgente, 'el técnico pide algo urgente');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + urg.id + '/aprobar', A); revisa(s === 200, 'administración también aprueba');
  [s, j] = await subir('/compras/solicitudes/' + urg.id + '/documentos', T, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.c.id, 'X-Monto': '8900', 'X-Nombre': 'bomba.pdf' });
  const cotU = j.solicitud && (await pedir('GET', '/compras/solicitudes/' + urg.id, C))[1].cotizaciones[0];
  [s, j] = await pedir('POST', '/compras/solicitudes/' + urg.id + '/elegir', C, { cotizacion_id: cotU.id, motivo_urgencia: 'El cliente está inundado y no hay otra bomba en almacén' });
  revisa(s === 200 && j.excepcion_motivo && j.cotizaciones_faltan === 2, 'con 1 de 3 se sigue SOLO con motivo de urgencia (queda la excepción)', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { solicitud_id: urg.id, proveedor_id: prov.c.id, centro_id: mantto.id, iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Bomba de achique 2 pulgadas', precio: 8900 }] });
  const ocU = j; revisa(s === 201 && /no hay otra bomba/.test(ocU.excepcion_motivo || ''), 'la orden muestra la excepción (la ve administración al autorizar)', [s, j.error, j.excepcion_motivo]);
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_compra&id=' + ocU.id, A); revisa(j.some(r => /EXCEPCIÓN POR URGENCIA/.test(r.detalle || '')), 'la excepción queda en la bitácora de la orden');
  [s, j] = await subir('/compras/solicitudes/' + urg.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.a.id, 'X-Monto': '9500', 'X-Nombre': 'bomba-2.pdf' });
  revisa(s === 201 && j.solicitud.cotizaciones_faltan === 1, 'después se pueden completar las cotizaciones que faltaron', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + ocU.id + '/cancelar', C, { motivo: 'El proveedor ya no la tiene' });
  [s, j] = await pedir('GET', '/compras/solicitudes/' + urg.id, C); revisa(j.estado === 'elegida' && !j.oc_id, 'si se cancela la orden, la solicitud queda lista para hacer otra', [j.estado, j.oc_id]);

  console.log('9. Rechazar, cancelar y orden sin solicitud');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: 'Silla ejecutiva de piel', para_que: 'Para la oficina de ventas, la actual está bien', centro_id: mantto.id });
  const lujo = j;
  [s, j] = await pedir('POST', '/compras/solicitudes/' + lujo.id + '/rechazar', V, { motivo: 'no me gusta' }); revisa(s === 403, 'quien pidió no se la rechaza a sí mismo');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + lujo.id + '/rechazar', C, { motivo: 'no' }); revisa(s === 400, 'rechazar pide motivo');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + lujo.id + '/rechazar', C, { motivo: 'No hay presupuesto este mes' }); revisa(s === 200 && j.estado === 'rechazada' && j.motivo_cierre === 'No hay presupuesto este mes', 'el encargado la rechaza con motivo');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + lujo.id + '/cancelar', V, { motivo: 'ya no la quiero' }); revisa(s === 409, 'una rechazada ya no se cancela');
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { que: 'Cable de corriente 20 metros', para_que: 'Extensión para la hidrolavadora', centro_id: mantto.id });
  [s, j] = await pedir('POST', '/compras/solicitudes/' + j.id + '/cancelar', V, { motivo: 'Lo encontramos en el almacén' }); revisa(s === 200 && j.estado === 'cancelada', 'quien pidió puede cancelar la suya');
  [s, j] = await pedir('POST', '/compras/ordenes', V, { proveedor_id: prov.a.id, centro_id: mantto.id, categoria: 'otro', iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Pago de recargas', precio: 400 }] });
  revisa(s === 403, 'ventas no hace una orden sin solicitud');
  [s, j] = await pedir('POST', '/compras/ordenes', C, { proveedor_id: prov.a.id, centro_id: mantto.id, categoria: 'otro', iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Pago de recargas', precio: 400 }] });
  revisa(s === 201 && !j.solicitud_id, 'el encargado SÍ hace una orden sin solicitud', [s, j.error]);
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_compra&id=' + j.id, A); revisa(j.some(r => /SIN SOLICITUD/.test(r.detalle || '')), 'queda marcado en la bitácora que fue sin solicitud');

  console.log('9b. Controles de la auditoría');
  const propia = (await pedir('POST', '/compras/solicitudes', C, { que: 'Rotomartillo industrial', para_que: 'Para romper registros en obra', centro_id: mantto.id }))[1];
  [s, j] = await pedir('POST', '/compras/solicitudes/' + propia.id + '/aprobar', C); revisa(s === 403 && /Tú pediste/.test(j.error), 'el encargado NO se aprueba su propia solicitud', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/solicitudes/' + propia.id + '/aprobar', A); revisa(s === 200, 'la aprueba un administrador');
  for (const [k, p] of Object.values(prov).entries()) await subir('/compras/solicitudes/' + propia.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': String(5000 + k), 'X-Nombre': 'r' + k + '.pdf' });
  const barata = (await pedir('GET', '/compras/solicitudes/' + propia.id, C))[1].cotizaciones[0];
  await pedir('POST', '/compras/solicitudes/' + propia.id + '/elegir', C, { cotizacion_id: barata.id });
  const baseR = { solicitud_id: propia.id, proveedor_id: barata.proveedor_id, centro_id: mantto.id, categoria: 'otro', iva_modo: 'incluido' };
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseR, partidas: [{ cantidad: 1, descripcion: 'Rotomartillo industrial', precio: 6500 }] }); revisa(s === 409 && j.codigo === 'SUPERA_COTIZACION', 'una orden por más de lo cotizado pide el motivo', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseR, motivo_diferencia: 'Se agregó el juego de brocas que no venía', partidas: [{ cantidad: 1, descripcion: 'Rotomartillo industrial', precio: 6500 }] }); revisa(s === 201 && /brocas/.test(j.motivo_diferencia), 'con motivo se crea y lo guarda', [s, j.error]);
  const ocR = j;
  [s, j] = await pedir('PUT', '/compras/ordenes/' + ocR.id, C, { ...baseR, version: ocR.version, partidas: [{ cantidad: 1, descripcion: 'Rotomartillo industrial', precio: 7000 }] }); revisa(s === 200, 'al editar conserva el motivo ya escrito');
  [s, j] = await pedir('POST', '/compras/ordenes', C, { solicitud_id: undefined, proveedor_id: prov.a.id, centro_id: mantto.id, categoria: 'otro', iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Cinta de aislar', precio: 40 }] }); revisa(s === 201, 'una orden sin solicitud no pide comparar contra cotización');

  console.log('10. Archivos y lista');
  const r = await fetch(URL + '/compras/solicitudes/documentos/' + cotB.id, { headers: { Authorization: 'Bearer ' + V } });
  revisa(r.status === 200 && r.headers.get('x-content-type-options') === 'nosniff' && /attachment/.test(r.headers.get('content-disposition')), 'la cotización se descarga como archivo adjunto (seguro)');
  [s, j] = await pedir('GET', '/compras/solicitudes?estado=abiertas', V); revisa(s === 200 && j.every(x => ['por_aprobar', 'cotizando', 'elegida'].includes(x.estado)) && j.some(x => x.id === urg.id), 'filtro «abiertas»', j.map(x => x.estado));
  [s, j] = await pedir('GET', '/compras/solicitudes?estado=mias', T); revisa(j.length === 1 && j[0].id === urg.id, 'filtro «las que yo pedí»');
  [s, j] = await pedir('GET', '/compras/solicitudes?q=llantas', V); revisa(j.length === 1 && j[0].id === sol.id, 'buscar «llantas»');
  [s, j] = await pedir('GET', '/compras/solicitudes', null); revisa(s === 401, 'sin sesión no se ve nada');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
