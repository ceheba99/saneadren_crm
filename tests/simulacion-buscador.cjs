// Buscador general a prueba de trampas: folios exactos y flexibles, acentos, varias palabras, teléfono y RFC,
// cliente fusionado, inyección y comodines, textos enormes, datos que no deben salir, límite de búsquedas por
// minuto y rapidez con miles de registros. Uso: node tests/simulacion-buscador.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-buscador-')); const PUERTO = String(6400 + Math.floor(Math.random() * 300));
const DB = path.join(dir, 'b.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Busca-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const buscar = async (t, q) => { const x = await fetch(URL + '/buscar?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + t } }); const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch {} return [x.status, j, texto]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const pdf = () => Buffer.from('%PDF-1.4\n% ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const mes = c => String(c).slice(0, 7).replace('-', ''), pad = id => String(id).padStart(4, '0');
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const grupo = (j, tipo) => (j.grupos || []).find(g => g.tipo === tipo);
const tiene = (j, tipo, id) => !!grupo(j, tipo)?.items.some(x => x.id === id);

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Vende Busca', correo: 'vende.busca@saneadren.com.mx', password: 'Vende-Busca-2026', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Tecnico Busca', correo: 'tec.busca@saneadren.com.mx', password: 'Tecnico-Busca-2026', rol: 'tecnico' });
  await pedir('POST', '/usuarios', A, { nombre: 'Costos Busca', correo: 'costos.busca@saneadren.com.mx', password: 'Costos-Busca-2026', rol: 'costos' });
  const V = (await pedir('POST', '/login', null, { nombre: 'vende.busca@saneadren.com.mx', password: 'Vende-Busca-2026' }))[1].token;
  const T = (await pedir('POST', '/login', null, { nombre: 'tec.busca@saneadren.com.mx', password: 'Tecnico-Busca-2026' }))[1].token;
  const C = (await pedir('POST', '/login', null, { nombre: 'costos.busca@saneadren.com.mx', password: 'Costos-Busca-2026' }))[1].token;
  const [, usuarios] = await pedir('GET', '/usuarios', A), vid = usuarios.find(u => u.nombre === 'Vende Busca').id;
  const [, canales] = await pedir('GET', '/canales', V), [, servicios] = await pedir('GET', '/servicios', V), [, centros] = await pedir('GET', '/compras/centros', V);
  let s, j, texto;

  seccion('Datos de prueba');
  const kfc = (await pedir('POST', '/contactos', V, { nombre: 'Gerente Sucursal', telefono: '442 555 0101', empresa_contacto: 'KFC Querétaro', direccion: 'Av. Zaragoza 10', canal_origen_id: canales[0].id }))[1];
  await pedir('PUT', '/clientes/' + kfc.id, A, { ...kfc, rfc: 'KQU900101AB1', correo: 'contacto@kfc-ejemplo.com' });
  const hotel = (await pedir('POST', '/contactos', V, { nombre: 'Ing. Ramírez', telefono: '4425550202', empresa_contacto: 'Hotel Real de Querétaro', direccion: 'Constituyentes 100', canal_origen_id: canales[0].id }))[1];
  const doble = (await pedir('POST', '/contactos', V, { nombre: 'Compras', telefono: '4425550303', empresa_contacto: 'Hotelera Real del Bajío', direccion: 'Bernardo Quintana 5', canal_origen_id: canales[0].id }))[1];
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de cocina y trampa de grasa', importe: 5000 }]);
  const nuevaCot = async cli => (await pedir('POST', '/leads', V, { cliente_id: cli, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'mas_iva', valor: 5000, fecha_cotizacion: HOY }))[1];
  const cotA = await nuevaCot(kfc.id), cotB = await nuevaCot(kfc.id);
  [s, j] = await pedir('GET', '/leads/' + cotB.id, V); await pedir('PUT', '/leads/' + cotB.id, V, { version: j.version, estatus: 'ganado', fecha_servicio: HOY });
  const prov = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas del Centro', categoria: 'otro', dias_credito: 15, rfc: 'PCE010101AA1', telefono: '442 111 2233' }))[1];
  const prov2 = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Llantera Querétaro', categoria: 'otro', dias_credito: 7 }))[1];
  const prov3 = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Servillantas', categoria: 'otro', dias_credito: 7 }))[1];
  const cxp = (await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Disposición de lodos KFC', total: 3480, fecha_documento: HOY, factura_folio: 'PC-77', dias_credito: 15 }))[1];
  const sol = (await pedir('POST', '/compras/solicitudes', V, { que: '4 llantas 11R22.5', para_que: 'Para el camión C-22 que se poncho', centro_id: centros[0].id, equipo: 'C-22' }))[1];
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', C);
  for (const p of [prov, prov2, prov3]) await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': '15800', 'X-Nombre': 'c.pdf' });
  const cot = (await pedir('GET', '/compras/solicitudes/' + sol.id, C))[1].cotizaciones.find(c => c.proveedor_id === prov2.id);
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cot.id });
  const oc = (await pedir('POST', '/compras/ordenes', C, { solicitud_id: sol.id, proveedor_id: prov2.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 4, descripcion: 'Llanta 11R22.5', precio: 3950 }] }))[1];
  const ocCancelada = (await pedir('POST', '/compras/ordenes', C, { proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Viaje de pipa cancelado', precio: 900 }] }))[1];
  await pedir('POST', '/compras/ordenes/' + ocCancelada.id + '/cancelar', C, { motivo: 'Se duplicó el viaje' });
  revisa(kfc.id && hotel.id && cotB.id && cxp.id && oc.id && ocCancelada.id, 'se armaron clientes, cotización, orden de servicio, solicitud, órdenes de compra y cuenta por pagar', [kfc.id, cotB.id, cxp.id, oc.id]);

  seccion('1. Seguridad básica');
  { const x = await fetch(URL + '/buscar?q=kfc'); revisa(x.status === 401, 'sin sesión no se busca nada'); }
  [s, j] = await buscar(V, ''); revisa(s === 400, 'búsqueda vacía');
  [s, j] = await buscar(V, 'k'); revisa(s === 400 && /al menos 2/.test(j.error), 'una sola letra pide al menos 2', j.error);
  [s, j] = await buscar(V, 'x'.repeat(81)); revisa(s === 400, 'más de 80 caracteres no');
  [s, j] = await buscar(V, 'a'.repeat(5000)); revisa(s === 400, 'un texto de 5,000 caracteres no tumba nada');
  { const x = await fetch(URL + '/buscar?q=kfc&q=hotel', { headers: { Authorization: 'Bearer ' + V } }); revisa(x.status === 400, 'mandar «q» dos veces (truco de parámetros) no se acepta'); }
  for (const t of ["' OR 1=1 --", '%%', '%_%', '__', '\\%', "kfc'; DROP TABLE clientes; --"]) {
    [s, j] = await buscar(V, t);
    const cuantos = (j.grupos || []).reduce((a, g) => a + (g.total || 0), 0);
    revisa(s === 200 && cuantos === 0, 'búsqueda tramposa «' + t + '» no trae todo ni rompe nada', [s, cuantos, j.error]);
  }
  [s, j] = await buscar(V, 'kfc'); revisa(s === 200 && tiene(j, 'cliente', kfc.id), 'después de los intentos, la base sigue bien (KFC sigue ahí)');
  [s, j, texto] = await buscar(V, 'kfc');
  revisa(!/password|contacto@kfc|correo_verificado|token|"rol"/.test(texto), 'los resultados no traen correos, contraseñas ni datos de usuarios', texto.slice(0, 300));
  [s, j, texto] = await buscar(A, 'admin'); revisa(s === 200 && !/marketing@saneadren/.test(texto), 'buscar «admin» no expone las cuentas de usuario');

  seccion('2. Folios');
  const fCot = 'COT-' + mes(cotA.created_at) + '-' + pad(cotA.id), fOS = 'OS-' + mes(cotB.created_at) + '-' + pad(cotB.id);
  [s, j] = await buscar(V, fCot); revisa(j.exacta?.tipo === 'cotizacion' && j.exacta.id === cotA.id && j.exacta.folio === fCot, 'folio de cotización exacto → se abre directo', j.exacta);
  [s, j] = await buscar(V, fOS); revisa(j.exacta?.tipo === 'orden_servicio' && j.exacta.id === cotB.id, 'folio de orden de servicio exacto', j.exacta);
  [s, j] = await buscar(V, 'COT-' + mes(cotB.created_at) + '-' + pad(cotB.id)); revisa(!j.exacta && !tiene(j, 'cotizacion', cotB.id), 'el COT- de una cotización que ya es OS no la confunde con otra cotización', j.exacta);
  [s, j] = await buscar(V, 'COT-199901-' + pad(cotA.id)); revisa(!j.exacta && !(j.grupos || []).length, 'folio con el mes equivocado no trae otro registro', j);
  [s, j] = await buscar(V, oc.folio.toLowerCase()); revisa(j.exacta?.tipo === 'orden_compra' && j.exacta.id === oc.id, 'folio de orden de compra en minúsculas', j.exacta);
  [s, j] = await buscar(V, 'oc ' + mes(oc.created_at) + ' ' + oc.id); revisa(j.exacta?.id === oc.id, 'folio escrito con espacios y sin ceros («oc 202610 1»)');
  [s, j] = await buscar(V, sol.folio); revisa(j.exacta?.tipo === 'solicitud' && j.exacta.id === sol.id && tiene(j, 'orden_compra', oc.id) === false, 'folio de solicitud exacto', j.exacta);
  [s, j] = await buscar(V, 'CLI-' + pad(kfc.id)); revisa(j.exacta?.tipo === 'cliente' && j.exacta.id === kfc.id, 'ID de cliente exacto (CLI-)', j.exacta);
  [s, j] = await buscar(V, pad(oc.id)); revisa(tiene(j, 'orden_compra', oc.id) && tiene(j, 'cliente', oc.id) && !j.exacta, 'solo el número muestra lo que tiene ese número en cada tipo (sin abrir nada solo)');
  [s, j] = await buscar(V, 'OC-' + mes(oc.created_at) + '-9999'); revisa(!j.exacta && !(j.grupos || []).length, 'un folio que no existe no trae nada');
  [s, j] = await buscar(V, ocCancelada.folio); revisa(j.exacta?.estado === 'Cancelada', 'una orden cancelada aparece marcada «Cancelada»', j.exacta);

  seccion('3. Texto, acentos, varias palabras');
  [s, j] = await buscar(V, 'queretaro'); revisa(tiene(j, 'cliente', kfc.id) && tiene(j, 'cliente', hotel.id) && tiene(j, 'proveedor', prov2.id), '«queretaro» sin acento encuentra «Querétaro» (clientes y proveedores)');
  [s, j] = await buscar(V, 'QUERÉTARO'); revisa(tiene(j, 'cliente', kfc.id), 'en mayúsculas con acento también');
  [s, j] = await buscar(V, 'kfc desazolve'); revisa(tiene(j, 'orden_servicio', cotB.id) && tiene(j, 'cotizacion', cotA.id), 'dos palabras: cotizaciones de KFC con «desazolve»');
  [s, j] = await buscar(V, 'kfc llantas'); revisa(!(j.grupos || []).length, 'dos palabras que no están juntas en ningún registro → nada', j.grupos?.map(g => g.tipo));
  [s, j] = await buscar(V, 'trampa de grasa'); revisa(tiene(j, 'cotizacion', cotA.id), 'busca dentro de la descripción del servicio');
  [s, j] = await buscar(V, 'llanta'); revisa(tiene(j, 'solicitud', sol.id) && tiene(j, 'orden_compra', oc.id) && tiene(j, 'proveedor', prov3.id), '«llanta» encuentra la solicitud (llantas), la orden de compra (Llanta) y el proveedor (Servillantas)');
  [s, j] = await buscar(V, 'C-22'); revisa(tiene(j, 'solicitud', sol.id), 'por unidad o equipo (C-22)');
  [s, j] = await buscar(V, 'PC-77'); revisa(tiene(j, 'cuenta_por_pagar', cxp.id), 'por folio de factura del proveedor');
  [s, j] = await buscar(V, 'hotel real'); revisa(tiene(j, 'cliente', hotel.id) && tiene(j, 'cliente', doble.id), '«hotel real» encuentra los dos hoteles parecidos');

  seccion('4. Teléfono y RFC');
  for (const t of ['4425550101', '442 555 0101', '(442) 555-0101', '+52 442 555 0101', '5550101']) { [s, j] = await buscar(V, t); revisa(tiene(j, 'cliente', kfc.id), 'teléfono escrito «' + t + '» encuentra a KFC'); }
  [s, j] = await buscar(V, 'kqu900101ab1'); revisa(tiene(j, 'cliente', kfc.id), 'RFC en minúsculas encuentra al cliente');
  [s, j] = await buscar(V, 'PCE010101AA1'); revisa(tiene(j, 'proveedor', prov.id) && tiene(j, 'cuenta_por_pagar', cxp.id), 'RFC del proveedor encuentra al proveedor y sus cuentas por pagar');
  [s, j] = await buscar(V, '442-111-2233'); revisa(tiene(j, 'proveedor', prov.id), 'teléfono del proveedor');

  seccion('5. Cliente que se juntó con otro');
  [s, j] = await pedir('POST', '/clientes/' + doble.id + '/fusionar', A, { con: hotel.id }); revisa(s === 200, 'administración junta «Hotelera Real del Bajío» dentro de «Hotel Real»', [s, j.error]);
  [s, j] = await buscar(V, 'CLI-' + pad(doble.id)); revisa(j.exacta?.id === hotel.id && /se juntó/.test(j.exacta?.detalle || ''), 'su ID viejo lleva al cliente que quedó y lo explica', j.exacta);

  seccion('6. Todos los usuarios pueden buscar');
  [s, j] = await buscar(T, 'kfc'); revisa(s === 200 && tiene(j, 'cliente', kfc.id), 'técnico busca');
  [s, j] = await buscar(C, 'PC-77'); revisa(s === 200 && tiene(j, 'cuenta_por_pagar', cxp.id), 'el encargado de centro de costos busca');

  seccion('7. Datos raros guardados no rompen la búsqueda');
  { const db = new DatabaseSync(DB); db.prepare("UPDATE clientes SET nombre = '<img src=x onerror=alert(1)>' WHERE id = ?").run(kfc.id); db.close(); }
  [s, j, texto] = await buscar(V, 'trampa grasa'); revisa(s === 200 && tiene(j, 'cotizacion', cotA.id), 'después de cambios directos en la base, la búsqueda sigue bien', [s, j.error]);
  [s, j, texto] = await buscar(V, 'onerror'); revisa(s === 200 && tiene(j, 'cliente', kfc.id), 'un nombre con código se encuentra como texto (la página lo escapa al mostrarlo)');

  seccion('8. Rapidez con miles de registros');
  { const db = new DatabaseSync(DB); const ins = db.prepare('INSERT INTO clientes (nombre, empresa_contacto, telefono, telefono_normalizado) VALUES (?, ?, ?, ?)'); db.exec('BEGIN'); for (let k = 0; k < 5000; k++) ins.run('Contacto ' + k, 'Empresa Prueba ' + k, '44' + String(10000000 + k), '44' + String(10000000 + k)); db.exec('COMMIT'); db.close(); }
  let peor = 0;
  for (const t of ['empresa prueba', 'zzzz', 'queretaro', '4410000', 'CLI-0003']) { const t0 = Date.now(); [s, j] = await buscar(V, t); peor = Math.max(peor, Date.now() - t0); }
  revisa(peor < 600, 'con 5,000 clientes más, cada búsqueda tarda menos de 0.6 s (peor: ' + peor + ' ms)');
  [s, j] = await buscar(V, 'empresa prueba'); revisa(grupo(j, 'cliente')?.total === 5000 && grupo(j, 'cliente').items.length <= 6, 'dice cuántos hay en total (5,000) pero solo manda unos cuantos', grupo(j, 'cliente')?.total);

  seccion('9. Límite de búsquedas por minuto');
  const r = []; for (let k = 0; k < 70; k++) r.push((await buscar(T, 'kf' + k))[0]);
  revisa(r.filter(x => x === 429).length >= 5 && r.slice(0, 50).every(x => x !== 429), 'más de 60 búsquedas en un minuto se frenan (para que nadie «barra» la base)', r.filter(x => x === 429).length);
  [s] = await buscar(V, 'kfc'); revisa(s === 200, 'el freno es por usuario: los demás siguen buscando');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError|\[buscar\]/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error|\[buscar\]/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
