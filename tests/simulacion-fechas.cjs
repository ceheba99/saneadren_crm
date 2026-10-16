// Fechas a lupa: que cada fecha se guarde y se muestre igual en todas partes (sin brincar un día por zona
// horaria), cuentas de vencimiento en fin de mes y años bisiestos, que los procesos sigan un orden lógico de fechas
// (no se cobra ni se realiza antes de cotizar, no hay fechas futuras donde no van) y que la página no cambie
// la fecha aunque la computadora esté en otra zona horaria. Uso: node tests/simulacion-fechas.cjs
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-fechas-')); const PUERTO = String(7600 + Math.floor(Math.random() * 250));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Fechas-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'f.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const MX = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' });
const HOY = MX.format(new Date());
const dias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const horaMX = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', hour12: false }).format(new Date()));
const pdf = () => Buffer.from('%PDF-1.4\n% ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Costos Fechas', correo: 'costos.fechas@saneadren.com.mx', password: 'Saneadren-Costos-Fechas-26', rol: 'costos' });
  const C = (await pedir('POST', '/login', null, { nombre: 'costos.fechas@saneadren.com.mx', password: 'Saneadren-Costos-Fechas-26' }))[1].token;
  const [, usuarios] = await pedir('GET', '/usuarios', A), aid = usuarios.find(u => u.rol === 'admin').id;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);
  let s, j;

  seccion('1. «Hoy» y la hora del servidor son de Querétaro');
  [s, j] = await pedir('GET', '/salud');
  revisa(j.hoy === HOY, 'el servidor dice que hoy es ' + HOY + ' (hora de México)', j);
  const cli = (await pedir('POST', '/contactos', A, { nombre: 'Gerente Fechas', telefono: '442 555 6101', empresa_contacto: 'Hotel Calendario', direccion: 'Centro', canal_origen_id: canales[0].id }))[1];
  revisa(String(cli.created_at).slice(0, 10) === HOY && Math.abs(Number(String(cli.created_at).slice(11, 13)) - horaMX()) <= 1, 'la hora de alta del cliente es la de México (no la de Londres)', [cli.created_at, horaMX()]);

  seccion('2. Cotización → orden de servicio: la fecha se guarda tal cual');
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 1000 }]);
  const cotizar = async (fecha_cotizacion = HOY) => pedir('POST', '/leads', A, { cliente_id: cli.id, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: aid, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'sin_iva', valor: 1000, fecha_cotizacion });
  [s, j] = await cotizar(dias(HOY, 3)); revisa(s === 400, 'una cotización con fecha futura no se acepta', [s, j.error]);
  const FCOT = dias(HOY, -10);
  [s, j] = await cotizar(FCOT); const c1 = j;
  revisa(s === 201 && c1.fecha_cotizacion === FCOT, 'la fecha de la cotización se guarda igual (' + FCOT + ')', [s, c1.fecha_cotizacion]);
  revisa(c1.folio === undefined || /^COT-\d{6}-\d{4}$/.test(c1.folio), 'folio con el mes de creación');
  const ganar = async (id, extra) => { const [, l] = await pedir('GET', '/leads/' + id, A); return pedir('PUT', '/leads/' + id, A, { version: l.version, estatus: 'ganado', ...extra }); };
  [s, j] = await ganar(c1.id, { fecha_servicio: dias(FCOT, -5) });
  revisa(s === 400, 'INCONGRUENCIA: un servicio con fecha ANTES de la cotización no se acepta', [s, j.error]);
  for (const f of ['2026-10-31', '2027-02-28', '2028-02-29', '2027-12-31']) {
    const [, c] = await cotizar(FCOT); [s, j] = await ganar(c.id, { fecha_servicio: f });
    const [, l] = await pedir('GET', '/leads/' + c.id, A);
    revisa(s === 200 && l.fecha_servicio === f, 'fecha de servicio ' + f + ' se guarda igual (fin de mes / bisiesto)', [s, l.fecha_servicio, j.error]);
  }
  [s, j] = await ganar(c1.id, { fecha_servicio: dias(HOY, -2) });
  revisa(s === 200, 'se gana la cotización con servicio hace 2 días');

  seccion('3. Realizar, facturar y cobrar: orden lógico de fechas');
  [s, j] = await pedir('POST', '/leads/' + c1.id + '/ejecucion', A, { estado: 'realizado', fecha: dias(HOY, 1), realizado_por: 'propio' }); revisa(s === 400, 'no se realiza en el futuro');
  [s, j] = await pedir('POST', '/leads/' + c1.id + '/ejecucion', A, { estado: 'realizado', fecha: dias(FCOT, -1), realizado_por: 'propio' }); revisa(s === 400, 'INCONGRUENCIA: no se realiza ANTES de cotizarse', [s, j.error]);
  [s, j] = await pedir('POST', '/leads/' + c1.id + '/ejecucion', A, { estado: 'realizado', fecha: dias(HOY, -2), realizado_por: 'propio' }); revisa(s === 200, 'realizado hace 2 días');
  [s, j] = await pedir('PUT', '/leads/' + c1.id + '/facturacion', A, { dias_credito: 30, factura_folio: 'FX-1', factura_fecha: dias(FCOT, -3) }); revisa(s === 400, 'INCONGRUENCIA: factura con fecha ANTES de la cotización no se acepta', [s, j.error]);
  [s, j] = await pedir('PUT', '/leads/' + c1.id + '/facturacion', A, { dias_credito: 30, factura_folio: 'FX-1', factura_fecha: '2026-01-31' === HOY ? HOY : dias(HOY, -1) });
  revisa(s === 200, 'factura de ayer, a 30 días');
  [s, j] = await pedir('GET', '/finanzas/cartera', A);
  const fila = (Array.isArray(j) ? j : []).find(x => x.lead_id === c1.id);
  revisa(fila?.vence === dias(dias(HOY, -1), 30), 'vence = fecha de la factura + 30 días (' + dias(dias(HOY, -1), 30) + ')', fila?.vence);
  [s, j] = await pedir('POST', '/leads/' + c1.id + '/cobros', A, { monto: 100, metodo: 'transferencia', fecha: dias(FCOT, -1) }); revisa(s === 400, 'INCONGRUENCIA: un cobro ANTES de existir la cotización no se acepta', [s, j.error]);
  [s, j] = await pedir('POST', '/leads/' + c1.id + '/cobros', A, { monto: 100, metodo: 'transferencia', fecha: HOY }); revisa(s === 201, 'cobro de hoy');
  [s, j] = await pedir('GET', '/leads/' + c1.id + '/cobros', A);
  revisa(j.cobros?.some(k => k.fecha === HOY), 'el cobro conserva la fecha de hoy', j.cobros?.map(k => k.fecha));
  [s, j] = await pedir('GET', '/finanzas/periodo?desde=' + HOY + '&hasta=' + HOY, A);
  revisa(j.cobrado === 100, 'Resultados: el cobro de hoy cuenta en el periodo de hoy (límites inclusivos)', j);
  [s, j] = await pedir('GET', '/finanzas/periodo?desde=' + dias(HOY, 1) + '&hasta=' + dias(HOY, 5), A);
  revisa(j.cobrado === 0, 'y no en el periodo de mañana', j.cobrado);

  seccion('4. Vencimientos en fin de mes y bisiestos');
  const prov = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas Calendario', categoria: 'otro', dias_credito: 30 }))[1];
  for (const [f, d, esperado] of [['2026-01-31', 30, '2026-03-02'], ['2028-02-28', 1, '2028-02-29'], ['2027-02-28', 1, '2027-03-01'], ['2026-12-31', 1, '2027-01-01'], ['2026-10-15', 0, '2026-10-15']]) {
    if (f > dias(HOY, 60)) continue;
    [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Viaje ' + f, total: 100, fecha_documento: f, dias_credito: d, lead_id: c1.id });
    const x = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(y => y.id === j.id);
    revisa(x?.fecha_vencimiento === esperado, `cuenta por pagar del ${f} a ${d} días vence el ${esperado}`, x?.fecha_vencimiento);
  }

  seccion('5. Compras: solicitud, orden, autorización y recepción');
  const sol = (await pedir('POST', '/compras/solicitudes', A, { que: 'Bomba sumergible', para_que: 'Para achique de emergencia', centro_id: centros[0].id, fecha_requerida: dias(HOY, 7) }))[1];
  revisa(sol.fecha_requerida === dias(HOY, 7) && String(sol.created_at).slice(0, 10) === HOY, 'la solicitud guarda «para cuándo» y su fecha de hoy', [sol.fecha_requerida, sol.created_at]);
  [s, j] = await pedir('POST', '/compras/solicitudes', A, { que: 'Bomba vieja', para_que: 'Para otra cosa distinta', centro_id: centros[0].id, fecha_requerida: dias(HOY, -1) }); revisa(s === 400, 'una solicitud «para ayer» no se acepta');
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', A);
  const ps = [prov]; for (const nm of ['Ferretería Calendario', 'Suministros Mes']) ps.push((await pedir('POST', '/finanzas/proveedores', A, { nombre: nm, categoria: 'otro', dias_credito: 7 }))[1]);
  for (const p of ps) await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': '5000', 'X-Nombre': 'c.pdf' });
  const cot = (await pedir('GET', '/compras/solicitudes/' + sol.id, C))[1].cotizaciones[0];
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cot.id });
  const baseOC = { solicitud_id: sol.id, proveedor_id: cot.proveedor_id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Bomba sumergible', precio: 5000 }] };
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, fecha_requerida: dias(HOY, -1) }); revisa(s === 400, 'la orden no puede requerirse antes de su fecha');
  [s, j] = await pedir('POST', '/compras/ordenes', C, { ...baseOC, fecha: dias(HOY, 40) }); revisa(s === 400, 'una orden a más de un mes en el futuro se rechaza (año mal escrito)');
  [s, j] = await pedir('POST', '/compras/ordenes', C, baseOC); const oc = j;
  revisa(s === 201 && oc.fecha === HOY && oc.folio.slice(3, 9) === HOY.slice(0, 7).replace('-', ''), 'la orden toma la fecha de hoy y su folio el mes de hoy', [oc.fecha, oc.folio]);
  [s, j] = await pedir('GET', '/compras/formato', C);
  revisa(!JSON.stringify(j).includes('2023'), 'el formato de la orden ya no trae fechas de 2023 ni revisión', j);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 15 });
  const x = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(y => y.id === j.cxp_id);
  revisa(x?.fecha_documento === HOY && x?.fecha_vencimiento === dias(HOY, 15), 'al autorizar: la cuenta por pagar es de hoy y vence en 15 días', x && [x.fecha_documento, x.fecha_vencimiento]);
  await subir('/compras/ordenes/' + oc.id + '/documentos', C, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(30)]), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'f.png' });
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: 'Almacén' });
  revisa(String(j.recibida_at).slice(0, 10) === HOY && Math.abs(Number(String(j.recibida_at).slice(11, 13)) - horaMX()) <= 1, 'la recepción guarda la fecha y hora de México', j.recibida_at);
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_compra&id=' + oc.id, A);
  revisa(j.every(r => String(r.fecha).slice(0, 10) === HOY), 'la bitácora de la orden tiene la fecha de hoy en cada movimiento', j.map(r => r.fecha));
  revisa(j.every((r, i) => i === 0 || r.fecha <= j[i - 1].fecha), 'y en orden (lo más reciente primero)');

  seccion('6. Calendario y recompras');
  const desde = dias(HOY, -40), hasta = dias(HOY, 40);
  [s, j] = await pedir('GET', '/calendario?desde=' + desde + '&hasta=' + hasta, A);
  const ev = j.eventos || [];
  revisa(ev.some(e => e.tipo === 'orden' && e.lead_id === c1.id && e.fecha === dias(HOY, -2)), 'la orden aparece el día de su servicio', ev.filter(e => e.lead_id === c1.id));
  revisa(ev.some(e => e.tipo === 'cobro' && e.lead_id === c1.id && e.fecha === dias(dias(HOY, -1), 30)), 'el cobro aparece el día que vence', ev.filter(e => e.tipo === 'cobro' && e.lead_id === c1.id));
  revisa(ev.filter(e => e.fecha).every(e => e.fecha >= desde && e.fecha <= hasta), 'el calendario solo trae eventos dentro del rango pedido');
  [s, j] = await pedir('PUT', '/servicios/' + servicios[0].id, A, { dias_recurrencia: 30 }); revisa(s === 200, 'el servicio se recompra cada 30 días', [s, j.error]);
  const cli2 = (await pedir('POST', '/contactos', A, { nombre: 'Gerente Recompra', telefono: '442 555 6202', empresa_contacto: 'Restaurante Recompra', direccion: 'Norte', canal_origen_id: canales[0].id }))[1];
  const [, cr] = await pedir('POST', '/leads', A, { cliente_id: cli2.id, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: aid, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'sin_iva', valor: 1000, fecha_cotizacion: dias(HOY, -30) });
  await ganar(cr.id, { fecha_servicio: dias(HOY, -25) });
  [s, j] = await pedir('GET', '/recompras', A);
  const rc = (Array.isArray(j) ? j : j.lista || []).find(r => r.cliente_id === cli2.id);
  if (rc) {
    revisa(rc.fecha_sugerida === dias(rc.ultima_fecha.slice(0, 10), 30), 'recompra: sugerida = último servicio + 30 días exactos', rc);
    revisa(rc.dias_restantes === Math.round((Date.parse(rc.fecha_sugerida + 'T00:00:00Z') - Date.parse(HOY + 'T00:00:00Z')) / 86400000), 'recompra: los días que faltan se cuentan por fecha (no por hora)', rc);
  } else revisa(false, 'la recompra aparece', j);

  seccion('7. La página no cambia la fecha aunque la computadora esté en otra zona horaria');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const tomar = nombre => { const re = new RegExp('(?:^|\\n)(?:const ' + nombre + ' = [^\\n]+|function ' + nombre + '\\([^]*?\\n\\})'); const m = src.match(re); return m ? m[0] : ''; };
  const codigo = ['hoyISO', 'sumarDiasISO', 'mesDeFolio', 'folioCotizacion'].map(tomar).join('\n');
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const r = execFileSync(process.execPath, ['-e', codigo + '\nconsole.log(JSON.stringify([hoyISO(), sumarDiasISO("2028-02-28", 1), sumarDiasISO("2026-12-31", 1), folioCotizacion({ id: 5, created_at: "2026-09-30 23:59:59" })]))'], { env: { ...process.env, TZ: tz } }).toString().trim();
    const [h, b, a, fo] = JSON.parse(r);
    revisa(h === HOY && b === '2028-02-29' && a === '2027-01-01' && fo === 'COT-202609-0005', 'computadora en ' + tz + ': hoy, sumas de días y folio salen igual', [h, b, a, fo]);
  }
  for (const [archivo, patron] of [['servicios-tabla.js', /const hoy = new Date\(\)\.toISOString/], ['app.js', /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/]]) {
    revisa(!patron.test(fs.readFileSync(path.join(__dirname, '..', 'public', archivo), 'utf8')), archivo + ': no calcula «hoy» en hora de Londres');
  }

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
