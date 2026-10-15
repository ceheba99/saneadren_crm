// Folios a prueba de trampas: formato, que no se repitan, que sean los mismos en todas las pantallas,
// cambio de mes, búsqueda por folio y datos tramposos (campos que no se deben poder mandar, números raros,
// clics dobles al mismo tiempo). Uso: node tests/simulacion-folios.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-folios-')); const PUERTO = String(6000 + Math.floor(Math.random() * 300));
const DB = path.join(dir, 'f.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Folios-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const pdf = () => Buffer.from('%PDF-1.4\n% ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const mes = c => String(c).slice(0, 7).replace('-', '');
const pad = id => String(id).padStart(4, '0');
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

// Las funciones de folio de la página (public/app.js) se prueban tal cual, fuera del navegador.
function funcionesPagina() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const tomar = nombre => { const i = src.indexOf('function ' + nombre + '('); let j = src.indexOf('\n}', i); return src.slice(i, j + 2); };
  const extra = ['mesDeFolio'].filter(f => src.includes('function ' + f + '(')).map(tomar).join('\n');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(extra + '\n' + tomar('folioCotizacion') + '\n' + tomar('folioOrdenServicio') + '\nthis.fc = folioCotizacion; this.fo = folioOrdenServicio;', ctx);
  return ctx;
}

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Vende Folios', correo: 'vende.folios@saneadren.com.mx', password: 'Vende-Folios-2026', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Costos Folios', correo: 'costos.folios@saneadren.com.mx', password: 'Costos-Folios-2026', rol: 'costos' });
  const V = (await pedir('POST', '/login', null, { nombre: 'vende.folios@saneadren.com.mx', password: 'Vende-Folios-2026' }))[1].token;
  const C = (await pedir('POST', '/login', null, { nombre: 'costos.folios@saneadren.com.mx', password: 'Costos-Folios-2026' }))[1].token;
  const [, usuarios] = await pedir('GET', '/usuarios', A), vid = usuarios.find(u => u.nombre === 'Vende Folios').id;
  const [, canales] = await pedir('GET', '/canales', V), [, servicios] = await pedir('GET', '/servicios', V), [, centros] = await pedir('GET', '/compras/centros', V);
  let s, j;

  seccion('1. Formato de cada folio');
  [s, j] = await pedir('POST', '/contactos', V, { nombre: 'Gerente KFC', telefono: '442 555 7001', empresa_contacto: 'KFC Querétaro', direccion: 'Centro', canal_origen_id: canales[0].id });
  const cli = j; revisa(s === 201, 'cliente nuevo');
  [s, j] = await pedir('GET', '/clientes/' + cli.id, V);
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve cocina', importe: 5000 }]);
  const nuevaCot = async () => (await pedir('POST', '/leads', V, { cliente_id: cli.id, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'mas_iva', valor: 5000, fecha_cotizacion: HOY }))[1];
  const cot1 = await nuevaCot(), cot2 = await nuevaCot(), cot3 = await nuevaCot();
  revisa(cot1.id && cot2.id === cot1.id + 1 && cot3.id === cot2.id + 1, 'las cotizaciones llevan números seguidos', [cot1.id, cot2.id, cot3.id]);
  [s, j] = await pedir('GET', '/leads/' + cot2.id, V);
  [s, j] = await pedir('PUT', '/leads/' + cot2.id, V, { version: j.version, estatus: 'ganado', fecha_servicio: HOY }); revisa(s === 200, 'la 2.ª se gana: pasa a orden de servicio');
  await pedir('POST', '/leads/' + cot2.id + '/ejecucion', V, { estado: 'realizado', fecha: HOY, realizado_por: 'propio' });
  [s, j] = await pedir('GET', '/finanzas/cartera', A);
  const filaCxc = (Array.isArray(j) ? j : j.cuentas || j.filas || []).find(x => x.lead_id === cot2.id);
  const osEsperado = 'OS-' + mes(cot2.created_at) + '-' + pad(cot2.id);
  revisa(filaCxc?.folio === osEsperado, 'Cuentas por cobrar muestra la OS con el MISMO número que la cotización (' + osEsperado + ')', filaCxc?.folio);
  [s, j] = await pedir('GET', '/generador', A);
  revisa(j.filas?.some(f => f.orden === osEsperado), 'el Generador muestra el mismo folio de OS', j.filas?.map(f => f.orden));
  const pagina = funcionesPagina();
  revisa(pagina.fc(cot1) === 'COT-' + mes(cot1.created_at) + '-' + pad(cot1.id) && pagina.fo(cot2) === osEsperado, 'la página arma el mismo folio que el servidor (COT y OS)', [pagina.fc(cot1), pagina.fo(cot2)]);
  revisa(/^COT-\d{6}-\d{4}$/.test(pagina.fc(cot1)) && /^OS-\d{6}-\d{4}$/.test(osEsperado), 'formato COT-AAAAMM-0000 y OS-AAAAMM-0000');

  seccion('2. Cambio de mes y fechas raras (el folio no debe brincar de mes)');
  revisa(pagina.fc({ id: 7, created_at: '2026-09-30 23:59:59' }) === 'COT-202609-0007', 'creada el 30/sep a las 23:59 → sigue siendo de septiembre', pagina.fc({ id: 7, created_at: '2026-09-30 23:59:59' }));
  revisa(pagina.fo({ id: 8, created_at: '2026-10-01 00:00:01' }) === 'OS-202610-0008', 'creada el 1/oct a las 00:00 → es de octubre', pagina.fo({ id: 8, created_at: '2026-10-01 00:00:01' }));
  revisa(pagina.fc({ id: 9, created_at: '2026-12-31T23:30:00' }) === 'COT-202612-0009', 'fecha con «T» en medio (como la manda otro navegador) → mismo mes', pagina.fc({ id: 9, created_at: '2026-12-31T23:30:00' }));
  revisa(!/NaN|undefined/.test(pagina.fc({ id: 10, created_at: 'basura' }) + pagina.fo({ id: 11 })), 'una fecha que no se entiende no deja «NaN» en el folio', [pagina.fc({ id: 10, created_at: 'basura' }), pagina.fo({ id: 11 })]);
  revisa(pagina.fc({ id: 12345, created_at: '2027-01-02 10:00:00' }) === 'COT-202701-12345', 'después de 9999 el número sigue creciendo sin cortarse');
  // Se mueve a mano la fecha de creación de una orden al último segundo de septiembre: todas las pantallas deben decir 202609.
  { const db = new DatabaseSync(DB); db.prepare("UPDATE leads SET created_at = '2026-09-30 23:59:59' WHERE id = ?").run(cot2.id); db.close(); }
  [s, j] = await pedir('GET', '/finanzas/cartera', A);
  const fila2 = (Array.isArray(j) ? j : j.cuentas || j.filas || []).find(x => x.lead_id === cot2.id);
  [s, j] = await pedir('GET', '/generador', A);
  revisa(fila2?.folio === 'OS-202609-' + pad(cot2.id) && j.filas?.some(f => f.orden === 'OS-202609-' + pad(cot2.id)), 'orden creada el 30/sep 23:59:59 → OS-202609 en Cuentas por cobrar y en el Generador', [fila2?.folio]);

  seccion('3. Los folios no se repiten ni se reutilizan');
  [s] = await pedir('DELETE', '/leads/' + cot3.id, A); revisa(s === 200, 'administración borra la última cotización');
  const cot4 = await nuevaCot();
  revisa(cot4.id > cot3.id, 'la siguiente cotización NO reutiliza el número borrado', [cot3.id, cot4.id]);
  [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent('COT-' + mes(cot3.created_at) + '-' + pad(cot3.id)), A);
  revisa(Array.isArray(j) && !j.some(l => l.id === cot3.id), 'el folio borrado ya no aparece');

  seccion('4. Buscar por folio');
  const folioCot1 = 'COT-' + mes(cot1.created_at) + '-' + pad(cot1.id);
  for (const q of [folioCot1, folioCot1.toLowerCase(), 'cot ' + mes(cot1.created_at) + ' ' + pad(cot1.id), pad(cot1.id)]) {
    [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent(q), V);
    revisa(Array.isArray(j) && j.some(l => l.id === cot1.id), 'buscar cotizaciones por «' + q + '» la encuentra', Array.isArray(j) ? j.map(l => l.id) : j);
  }
  [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent('OS-202609-' + pad(cot2.id)), V);
  revisa(Array.isArray(j) && j.some(l => l.id === cot2.id), 'buscar «OS-…» encuentra la orden de servicio', Array.isArray(j) ? j.map(l => l.id) : j);
  [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent('COT-199901-' + pad(cot1.id)), V);
  revisa(Array.isArray(j) && !j.some(l => l.id === cot1.id), 'un folio con el mes equivocado NO encuentra otra cotización (no confunde)', Array.isArray(j) ? j.map(l => l.id) : j);
  [s, j] = await pedir('GET', '/clientes?q=' + encodeURIComponent('CLI-' + pad(cli.id)), V);
  revisa(Array.isArray(j) && j.some(c => c.id === cli.id), 'buscar clientes por «CLI-' + pad(cli.id) + '» lo encuentra', Array.isArray(j) ? j.map(c => c.id) : j);
  [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent("COT-' OR 1=1 --"), V); revisa(s === 200 && Array.isArray(j) && !j.length, 'una búsqueda tramposa (inyección) no trae todo');

  seccion('5. Solicitudes y órdenes de compra');
  const provs = [];
  for (const nombre of ['Ferretería Hidalgo', 'Mangueras del Centro', 'Suministros Querétaro']) provs.push((await pedir('POST', '/finanzas/proveedores', A, { nombre, categoria: 'otro', dias_credito: 10 }))[1]);
  // Campos que nadie debe poder mandar: id, fecha de creación, estado, quién pidió, orden ligada…
  [s, j] = await pedir('POST', '/compras/solicitudes', V, { id: 777, created_at: '2020-01-01 00:00:00', estado: 'recibida', solicitante_id: 1, solicitante_nombre: 'Otro', oc_id: 5, excepcion_motivo: 'x', que: 'Manguera de 4 pulgadas', para_que: 'Para la unidad E44 que la rompió', centro_id: centros[0].id });
  const sol = j;
  revisa(s === 201 && sol.id !== 777 && sol.estado === 'por_aprobar' && sol.solicitante_nombre === 'Vende Folios' && !sol.oc_id && !sol.excepcion_motivo && mes(sol.created_at) !== '202001', 'mandar id, fecha, estado o quién pidió por fuera se ignora', [sol.id, sol.estado, sol.solicitante_nombre, sol.created_at]);
  revisa(sol.folio === 'SOL-' + mes(sol.created_at) + '-' + pad(sol.id), 'folio SOL-AAAAMM-0000', sol.folio);
  [s, j] = await pedir('PUT', '/compras/solicitudes/' + sol.id, V, { que: 'Manguera de 4 pulgadas', para_que: 'Para la unidad E44 que la rompió', centro_id: centros[0].id, estado: 'elegida', ganadora_id: 1, aprobada_por: 'Yo mismo' });
  revisa(s === 200 && j.estado === 'por_aprobar' && !j.aprobada_por, 'tampoco al corregir se puede cambiar el estado o aprobarse uno mismo', [s, j.estado, j.aprobada_por]);
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', C);
  for (const [i, monto] of [['0x10', 'hexadecimal'], ['1e3', 'notación científica'], ['Infinity', 'infinito'], ['12.345', 'tres decimales'], ['-50', 'negativo'], ['50 pesos', 'con texto']].entries()) {
    [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': provs[0].id, 'X-Monto': monto[0], 'X-Nombre': 'c' + i + '.pdf' });
    revisa(s === 400, 'un total «' + monto[0] + '» (' + monto[1] + ') no se acepta', [s, j.error]);
  }
  for (const [k, p] of provs.entries()) { [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': String(1000 + k * 100), 'X-Nombre': 'c' + k + '.pdf' }); }
  revisa(j.solicitud?.cotizaciones_faltan === 0, 'tres cotizaciones válidas', [s, j.error]);
  const cots = (await pedir('GET', '/compras/solicitudes/' + sol.id, C))[1].cotizaciones;
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cots[0].id });
  const baseOC = { solicitud_id: sol.id, proveedor_id: cots[0].proveedor_id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Manguera de 4 pulgadas', precio: 1000 }] };
  // Dos clics al mismo tiempo en «Crear orden de compra»
  const dobles = await Promise.all([pedir('POST', '/compras/ordenes', C, baseOC), pedir('POST', '/compras/ordenes', C, baseOC)]);
  revisa(dobles.filter(([x]) => x === 201).length === 1 && dobles.filter(([x]) => x === 409).length === 1, 'dos clics al mismo tiempo crean UNA sola orden', dobles.map(([x, y]) => [x, y.error]));
  const oc = dobles.find(([x]) => x === 201)[1];
  revisa(oc.folio === 'OC-' + mes(oc.created_at) + '-' + pad(oc.id) && oc.solicitud_folio === sol.folio, 'la orden lleva su folio OC y el de su solicitud', [oc.folio, oc.solicitud_folio]);
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, C, { ...baseOC, version: oc.version, estado: 'autorizada', cxp_id: 1, creado_por: 1, solicitud_id: 999 });
  revisa(s === 200 && j.estado === 'borrador' && !j.cxp_id && j.solicitud_id === sol.id, 'al editar la orden no se puede autorizar a escondidas ni cambiarle la solicitud', [s, j.estado, j.cxp_id, j.solicitud_id]);
  [s, j] = await pedir('GET', '/compras/ordenes?q=' + encodeURIComponent(oc.folio.toLowerCase()), V); revisa(j.length === 1 && j[0].id === oc.id, 'buscar la orden por su folio (en minúsculas)');
  [s, j] = await pedir('GET', '/compras/ordenes?q=' + encodeURIComponent(sol.folio), V); revisa(j.some(o => o.id === oc.id), 'buscar la orden por el folio de su solicitud', j.map(o => o.folio));
  [s, j] = await pedir('GET', '/compras/solicitudes?estado=&q=' + encodeURIComponent(oc.folio), V); revisa(j.some(x => x.id === sol.id), 'buscar la solicitud por el folio de su orden');

  seccion('6. Autorizar con crédito tramposo');
  for (const [v, txt] of [[true, 'verdadero'], ['0x1e', 'hexadecimal'], ['7 días', 'con texto'], [[7], 'lista'], ['1e1', 'notación científica'], [' ', 'espacio']]) {
    [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: v });
    revisa(s === 400, 'crédito ' + JSON.stringify(v) + ' (' + txt + ') no se acepta', [s, j.error]);
  }
  const aut = await Promise.all([pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: '10' }), pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 10 })]);
  revisa(aut.filter(([x]) => x === 200).length === 1, 'dos «Autorizar» al mismo tiempo: una sola cuenta por pagar', aut.map(([x]) => x));
  const cxpId = aut.find(([x]) => x === 200)[1].cxp_id;
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const cxp = j.find(x => x.id === cxpId);
  revisa(cxp?.concepto.startsWith(oc.folio + ' · ') && cxp.fecha_vencimiento > cxp.fecha_documento, 'Cuentas por pagar empieza con el folio de la orden y vence 10 días después', cxp && [cxp.concepto, cxp.fecha_documento, cxp.fecha_vencimiento]);

  seccion('7. Orden cancelada y nueva orden de la misma solicitud');
  const sol2 = (await pedir('POST', '/compras/solicitudes', V, { que: 'Llave Stilson 24 pulgadas', para_que: 'Para el taller de mantenimiento', centro_id: centros[0].id }))[1];
  await pedir('POST', '/compras/solicitudes/' + sol2.id + '/aprobar', A);
  for (const [k, p] of provs.entries()) await subir('/compras/solicitudes/' + sol2.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': String(800 + k), 'X-Nombre': 's2-' + k + '.pdf' });
  const c2 = (await pedir('GET', '/compras/solicitudes/' + sol2.id, C))[1].cotizaciones[0];
  await pedir('POST', '/compras/solicitudes/' + sol2.id + '/elegir', C, { cotizacion_id: c2.id });
  const base2 = { solicitud_id: sol2.id, proveedor_id: c2.proveedor_id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Llave Stilson 24 pulgadas', precio: 800 }] };
  const ocA = (await pedir('POST', '/compras/ordenes', C, base2))[1];
  await pedir('POST', '/compras/ordenes/' + ocA.id + '/cancelar', C, { motivo: 'Se equivocó el precio' });
  [s, j] = await pedir('POST', '/compras/ordenes', C, base2); const ocB = j;
  revisa(s === 201 && ocB.id !== ocA.id && ocB.folio !== ocA.folio, 'la orden nueva tiene OTRO folio (la cancelada conserva el suyo)', [ocA.folio, ocB.folio]);
  [s, j] = await pedir('GET', '/compras/ordenes/' + ocA.id, C); revisa(j.estado === 'cancelada' && j.folio === ocA.folio, 'la cancelada sigue existiendo con su folio');
  [s, j] = await pedir('GET', '/compras/solicitudes/' + sol2.id, C); revisa(j.oc_folio === ocB.folio, 'la solicitud apunta a la orden vigente', [j.oc_folio, ocB.folio]);
  [s, j] = await pedir('GET', '/auditoria?entidad=solicitud_compra&id=' + sol2.id, A);
  revisa(j.some(r => r.detalle?.includes(ocA.folio)) && j.some(r => r.detalle?.includes(ocB.folio)), 'el historial de la solicitud nombra las dos órdenes por su folio');

  seccion('8. Procesos fuera de orden');
  [s, j] = await subir('/compras/ordenes/' + ocA.id + '/documentos', C, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(40)]), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'f.png' });
  [s, j] = await pedir('POST', '/compras/ordenes/' + ocA.id + '/recibir', C, { recibio: 'Alguien' }); revisa(s === 409, 'no se marca recibida una orden cancelada', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + ocA.id + '/autorizar', A, { dias_credito: 5 }); revisa(s === 409, 'no se autoriza una orden cancelada', [s, j.error]);
  const sol3 = (await pedir('POST', '/compras/solicitudes', V, { que: 'Escritorio en L', para_que: 'Para la recepción de la oficina', centro_id: centros[0].id }))[1];
  await pedir('POST', '/compras/solicitudes/' + sol3.id + '/rechazar', C, { motivo: 'No hay presupuesto este mes' });
  [s, j] = await subir('/compras/solicitudes/' + sol3.id + '/documentos', V, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': provs[0].id, 'X-Monto': '3000', 'X-Nombre': 'e.pdf' }); revisa(s === 409, 'no se cotiza una solicitud rechazada');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol3.id + '/aprobar', A); revisa(s === 409, 'una rechazada no se puede aprobar después a escondidas');
  [s, j] = await pedir('POST', '/compras/solicitudes/' + sol3.id + '/elegir', A, { cotizacion_id: cots[0].id }); revisa(s === 409 || s === 400, 'tampoco se elige una cotización de OTRA solicitud en una rechazada', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, solicitud_id: sol3.id }); revisa(s === 409, 'no se hace orden de una solicitud rechazada', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: provs[0].id, categoria: 'otro', concepto: 'Prueba tramposa', total: '0x10', fecha_documento: HOY }); revisa(s === 400, 'Cuentas por pagar: total «0x10» no se acepta');
  [s, j] = await pedir('POST', '/leads/' + cot2.id + '/cobros', A, { monto: '1e3', metodo: 'transferencia', fecha: HOY }); revisa(s === 400, 'Cobro: monto «1e3» no se acepta');
  [s, j] = await pedir('POST', '/leads/' + cot2.id + '/cobros', A, { monto: 999999, metodo: 'transferencia', fecha: HOY }); revisa(s === 400 || s === 409, 'Cobro: no se cobra más de lo que se debe', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, solicitud_id: undefined, partidas: [{ cantidad: '0x2', descripcion: 'Cinta', precio: 10 }] }); revisa(s === 400, 'Orden: cantidad «0x2» no se acepta');
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, solicitud_id: undefined, partidas: [{ cantidad: 1, descripcion: 'Cinta', precio: '1e2' }] }); revisa(s === 400, 'Orden: precio «1e2» no se acepta');

  seccion('9. Folios distintos por tipo (no se confunden)');
  revisa(new Set([sol.folio.split('-')[0], oc.folio.split('-')[0], osEsperado.split('-')[0], folioCot1.split('-')[0]]).size === 4, 'cada tipo tiene su prefijo: SOL, OC, OS, COT');

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
