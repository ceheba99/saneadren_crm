// Integridad y cuadre: (1) un mes de operación normal NO debe dejar ninguna incongruencia; (2) las mismas cifras
// deben coincidir en todas las pantallas (cuentas por cobrar, Generador, Resultados, Cuentas por pagar, calendario),
// recalculadas aparte desde la base; (3) cada tipo de dato incongruente que se cuele debe detectarse.
// Uso: node tests/simulacion-integridad.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-integridad-')); const PUERTO = String(7900 + Math.floor(Math.random() * 200));
const DB = path.join(dir, 'i.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Integridad-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b) => { const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const subir = async (r, t, buf, enc) => { const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const pdf = () => Buffer.from('%PDF-1.4\n% ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(40)]);
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const cent = p => Math.round(Number(p || 0) * 100);

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Mes', correo: 'ventas.mes@saneadren.com.mx', password: 'Saneadren-Ventas-Mes-26', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Costos Mes', correo: 'costos.mes@saneadren.com.mx', password: 'Saneadren-Costos-Mes-26', rol: 'costos' });
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.mes@saneadren.com.mx', password: 'Saneadren-Ventas-Mes-26' }))[1].token;
  const C = (await pedir('POST', '/login', null, { nombre: 'costos.mes@saneadren.com.mx', password: 'Saneadren-Costos-Mes-26' }))[1].token;
  const [, usuarios] = await pedir('GET', '/usuarios', A), vid = usuarios.find(u => u.nombre === 'Ventas Mes').id;
  const [, canales] = await pedir('GET', '/canales', V), [, servicios] = await pedir('GET', '/servicios', V), [, centros] = await pedir('GET', '/compras/centros', V);
  let s, j;

  seccion('1. Un mes de operación normal');
  const INI = dias(HOY, -20);
  const clientes = [];
  for (const [k, emp] of ['Hotel Uno', 'Restaurante Dos', 'Planta Tres', 'Plaza Cuatro', 'Hospital Cinco', 'Escuela Seis'].entries())
    clientes.push((await pedir('POST', '/contactos', V, { nombre: 'Contacto ' + emp, telefono: '44255570' + String(10 + k), empresa_contacto: emp, direccion: 'Calle ' + k, canal_origen_id: canales[k % canales.length].id }))[1]);
  const prov = [];
  for (const nm of ['Pipas del Centro', 'Ferretería Hidalgo', 'Llantera Norte']) prov.push((await pedir('POST', '/finanzas/proveedores', A, { nombre: nm, categoria: 'otro', dias_credito: 15 }))[1]);
  const ordenes = [];
  // Seis órdenes con distinto IVA, importes con centavos y varios renglones
  const casos = [['mas_iva', [12500.50, 3800]], ['incluido', [9999.99]], ['sin_iva', [4500, 4500, 1250.25]], ['mas_iva', [0.99, 1000.01]], ['incluido', [23456.78, 100]], ['mas_iva', [7800]]];
  for (const [k, [modo, imp]] of casos.entries()) {
    const partidas = JSON.stringify(imp.map((v, i) => ({ servicio: servicios[i % servicios.length].nombre, leyenda: 'Trabajo ' + (i + 1), importe: v })));
    const [, c] = await pedir('POST', '/leads', V, { cliente_id: clientes[k].id, direccion: 'Sitio', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: partidas, iva_modo: modo, valor: 1, fecha_cotizacion: INI });
    const [, l] = await pedir('GET', '/leads/' + c.id, V);
    [s, j] = await pedir('PUT', '/leads/' + c.id, V, { version: l.version, estatus: 'ganado', fecha_servicio: dias(INI, 2 + k) });
    ordenes.push(c);
  }
  revisa(ordenes.every(o => o.id), 'seis órdenes de servicio con IVA más, incluido y sin IVA');
  // Realizar (una no realizada con anticipo), facturar (una con total distinto por retención), cobrar parcial y total
  for (const [k, o] of ordenes.entries()) {
    if (k === 5) { await pedir('POST', '/leads/' + o.id + '/cobros', A, { monto: 1000, metodo: 'transferencia', fecha: dias(INI, 3) }); await pedir('POST', '/leads/' + o.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'El cliente canceló el servicio' }); continue; }
    await pedir('POST', '/leads/' + o.id + '/ejecucion', V, { estado: 'realizado', fecha: dias(INI, 3 + k), realizado_por: 'propio' });
  }
  await pedir('PUT', '/leads/' + ordenes[0].id + '/facturacion', A, { dias_credito: 30, factura_folio: 'M-1', factura_fecha: dias(INI, 5) });
  const [, l1] = await pedir('GET', '/leads/' + ordenes[1].id, A);
  await pedir('PUT', '/leads/' + ordenes[1].id + '/facturacion', A, { dias_credito: 15, factura_folio: 'M-2', factura_fecha: dias(INI, 6), factura_total: 9500 });
  await pedir('POST', '/leads/' + ordenes[0].id + '/cobros', A, { monto: 5000, metodo: 'transferencia', fecha: dias(INI, 8) });
  await pedir('POST', '/leads/' + ordenes[1].id + '/cobros', A, { monto: 9500, metodo: 'transferencia', fecha: dias(INI, 9) });
  [s, j] = await pedir('POST', '/leads/' + ordenes[2].id + '/cobros', V, { monto: 2000, metodo: 'efectivo', fecha: dias(INI, 10) });
  const cobroCancelar = j.id || j.cobro?.id;
  await pedir('POST', '/finanzas/cobros/' + cobroCancelar + '/cancelar', A, { motivo: 'Se registró en la orden equivocada' });
  await pedir('POST', '/leads/' + ordenes[2].id + '/cobros', A, { monto: 3000, metodo: 'efectivo', fecha: dias(INI, 10) });
  // Costos con terceros y su pago
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { proveedor_id: prov[0].id, categoria: 'otro', concepto: 'Renta de pipa 10 m3', total: 2320, fecha_documento: dias(INI, 4), dias_credito: 7, lead_id: ordenes[0].id });
  await pedir('POST', '/finanzas/cxp/' + j.id + '/pagos', A, { monto: 1000, metodo: 'transferencia', fecha: dias(INI, 6) });
  // Compras: solicitud → 3 cotizaciones → orden → autorizar → pagar → recibir; y una orden cancelada
  const sol = (await pedir('POST', '/compras/solicitudes', V, { que: 'Manguera 4 pulgadas 20 m', para_que: 'Para la unidad E44 que se rompió', centro_id: centros[0].id }))[1];
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', C);
  for (const [k, p] of prov.entries()) await subir('/compras/solicitudes/' + sol.id + '/documentos', C, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': String(3480 + k * 100), 'X-Nombre': 'c' + k + '.pdf' });
  const cot = (await pedir('GET', '/compras/solicitudes/' + sol.id, C))[1].cotizaciones[0];
  await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', C, { cotizacion_id: cot.id });
  const [, oc] = await pedir('POST', '/compras/ordenes', C, { solicitud_id: sol.id, proveedor_id: cot.proveedor_id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'mas_iva', partidas: [{ cantidad: 2, descripcion: 'Manguera 4 pulgadas', unidad: 'M', precio: 1500 }] });
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 15 });
  await pedir('POST', '/finanzas/cxp/' + j.cxp_id + '/pagos', A, { monto: 3480, metodo: 'transferencia', fecha: HOY });
  await subir('/compras/ordenes/' + oc.id + '/documentos', C, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'firma.png' });
  await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', C, { recibio: 'Almacén' });
  const [, oc2] = await pedir('POST', '/compras/ordenes', C, { proveedor_id: prov[1].id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Cinta métrica', precio: 250 }] });
  await pedir('POST', '/compras/ordenes/' + oc2.id + '/autorizar', A, { dias_credito: 0 });
  await pedir('POST', '/compras/ordenes/' + oc2.id + '/cancelar', A, { motivo: 'El proveedor no la tenía' });
  // Una cotización que no se aceptó y una eliminada
  const [, cp] = await pedir('POST', '/leads', V, { cliente_id: clientes[0].id, direccion: 'Sitio', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, importe: 900 }]), iva_modo: 'mas_iva', valor: 900, fecha_cotizacion: HOY });
  await pedir('PUT', '/leads/' + cp.id, V, { version: (await pedir('GET', '/leads/' + cp.id, V))[1].version, estatus: 'perdido', motivo_perdida: 'Eligió a otro proveedor' });
  const [, ce] = await pedir('POST', '/leads', V, { cliente_id: clientes[1].id, direccion: 'Sitio', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, importe: 500 }]), iva_modo: 'mas_iva', valor: 500, fecha_cotizacion: HOY });
  await pedir('DELETE', '/leads/' + ce.id, A, { motivo: 'Se capturó dos veces' });

  seccion('2. Después de un mes normal no debe haber ninguna incongruencia');
  [s, j] = await pedir('GET', '/admin/integridad', V); revisa(s === 403, 'ventas no corre la revisión de integridad');
  { const x = await fetch(URL + '/admin/integridad'); revisa(x.status === 401, 'sin sesión tampoco'); }
  [s, j] = await pedir('GET', '/admin/integridad', A);
  const conError = (j.resultados || []).filter(r => r.gravedad === 'error' && r.total);
  revisa(s === 200 && j.revisiones >= 25 && j.errores === 0, `la revisión (${j.revisiones} revisiones) no encuentra ningún error`, conError.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2))));
  const avisos = (j.resultados || []).filter(r => r.gravedad === 'aviso' && r.total).map(r => r.titulo);
  revisa(avisos.length === 1 && /NO realizado con pagos/.test(avisos[0]), 'solo avisa lo esperado: el servicio no realizado con anticipo (hay que devolver o aplicar)', avisos);

  seccion('3. Las mismas cifras en todas las pantallas (recalculadas aparte desde la base)');
  const db = new DatabaseSync(DB, { readOnly: true });
  const leads = db.prepare("SELECT * FROM leads WHERE estatus = 'ganado'").all();
  const cobradoDe = id => db.prepare("SELECT COALESCE(SUM(monto_cent),0) t FROM cobros WHERE lead_id = ? AND cancelado = 0 AND tipo <> 'ajuste'").get(id).t;
  const totalDe = l => l.factura_total_cent ?? cent(l.valor) + (l.iva_cent || 0);
  [s, j] = await pedir('GET', '/finanzas/cartera?filtro=todas', A);
  const cartera = Array.isArray(j) ? j : [];
  const malCartera = cartera.filter(c => { const l = leads.find(x => x.id === c.lead_id); if (!l) return true; const t = totalDe(l), co = cobradoDe(l.id), sal = l.ejecucion === 'no_realizado' ? 0 : Math.max(t - co, 0); return cent(c.total) !== t || cent(c.cobrado) !== co || cent(c.saldo) !== sal; });
  revisa(cartera.length >= 5 && !malCartera.length, 'Cuentas por cobrar: total, cobrado y saldo de cada orden cuadran con la base (' + cartera.length + ' órdenes)', malCartera.map(c => [c.folio, c.total, c.cobrado, c.saldo]));
  revisa(cartera.find(c => c.lead_id === ordenes[1].id)?.total === 9500, 'la orden con factura por otro total (retención) usa el total facturado', cartera.find(c => c.lead_id === ordenes[1].id));
  const realizados = leads.filter(l => l.ejecucion === 'realizado');
  const fechaVenta = l => l.fecha_realizado || l.fecha_servicio || String(l.created_at).slice(0, 10);
  const sub = realizados.filter(l => fechaVenta(l) >= INI && fechaVenta(l) <= HOY).reduce((t, l) => t + cent(l.valor), 0);
  const iva = realizados.filter(l => fechaVenta(l) >= INI && fechaVenta(l) <= HOY).reduce((t, l) => t + (l.iva_cent || 0), 0);
  [s, j] = await pedir('GET', '/generador?desde=' + INI + '&hasta=' + HOY, A);
  revisa(cent(j.totales?.subtotal) === sub && cent(j.totales?.iva) === iva && cent(j.totales?.total) === sub + iva, 'Generador: subtotal, IVA y total = suma de las órdenes realizadas', [j.totales, sub, iva]);
  const porOrden = new Map(); for (const f of j.filas || []) porOrden.set(f.lead_id, (porOrden.get(f.lead_id) || 0) + cent(f.subtotal));
  revisa([...porOrden].every(([id, t]) => t === cent(leads.find(l => l.id === id).valor)), 'Generador: los renglones de cada orden suman exactamente su subtotal (también con centavos)');
  [s, j] = await pedir('GET', '/tablero?desde=' + INI + '&hasta=' + HOY, A);
  const cobradoPeriodo = db.prepare("SELECT COALESCE(SUM(monto_cent),0) t FROM cobros WHERE cancelado = 0 AND tipo <> 'ajuste' AND fecha BETWEEN ? AND ?").get(INI, HOY).t;
  const pagadoPeriodo = db.prepare('SELECT COALESCE(SUM(monto_cent),0) t FROM pagos_proveedor WHERE cancelado = 0 AND fecha BETWEEN ? AND ?').get(INI, HOY).t;
  // Gastos del periodo como se pagan (con IVA) y sin IVA (a cada factura se le quita su IVA: ver ivaDeGasto).
  const { ivaDeGasto } = require('../server/finanzas');
  const filasGasto = db.prepare("SELECT total_cent, iva_cent, tipo_comprobante, factura_folio FROM cuentas_por_pagar WHERE cancelada = 0 AND COALESCE(tipo_comprobante, '') <> 'informativo' AND fecha_documento BETWEEN ? AND ?").all(INI, HOY);
  const gastoPeriodo = filasGasto.reduce((t, x) => t + x.total_cent, 0), gastoSinIva = filasGasto.reduce((t, x) => t + x.total_cent - ivaDeGasto(x).iva_cent, 0);
  revisa(cent(j.actual?.venta) === sub && cent(j.actual?.venta_con_iva) === sub + iva, 'Resultados: la venta es la misma que en el Generador', [j.actual?.venta, sub]);
  revisa(cent(j.actual?.cobrado) === cobradoPeriodo && cent(j.actual?.pagado) === pagadoPeriodo && cent(j.actual?.flujo) === cobradoPeriodo - pagadoPeriodo, 'Resultados: cobrado, pagado y flujo cuadran (el cobro cancelado no cuenta)', [j.actual?.cobrado, cobradoPeriodo, j.actual?.pagado, pagadoPeriodo]);
  revisa(cent(j.actual?.gasto_con_iva) === gastoPeriodo && cent(j.actual?.gasto) === gastoSinIva && cent(j.actual?.utilidad) === sub - gastoSinIva, 'Resultados: gastos (con y sin IVA) y utilidad estimada cuadran (la orden de compra cancelada no cuenta)', [j.actual?.gasto, gastoSinIva, j.actual?.gasto_con_iva, gastoPeriodo]);
  [s, j] = await pedir('GET', '/finanzas/periodo?desde=' + INI + '&hasta=' + HOY, A);
  revisa(cent(j.cobrado) === cobradoPeriodo, 'Finanzas por periodo: mismo cobrado que Resultados');
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const malCxp = j.filter(x => { const pag = db.prepare('SELECT COALESCE(SUM(monto_cent),0) t FROM pagos_proveedor WHERE cxp_id = ? AND cancelado = 0').get(x.id).t; return cent(x.pagado) !== pag || cent(x.saldo) !== Math.max(cent(x.total) - pag, 0); });
  revisa(j.length >= 2 && !malCxp.length, 'Cuentas por pagar: pagado y saldo de cada cuenta cuadran con la base', malCxp.map(x => [x.concepto, x.total, x.pagado, x.saldo]));
  const ocDb = db.prepare('SELECT o.total_cent, x.total_cent cxp FROM ordenes_compra o JOIN cuentas_por_pagar x ON x.id = o.cxp_id WHERE o.id = ?').get(oc.id);
  revisa(ocDb && ocDb.total_cent === ocDb.cxp, 'la orden de compra autorizada y su cuenta por pagar tienen el mismo total', ocDb);
  [s, j] = await pedir('GET', '/calendario?desde=' + dias(HOY, -40) + '&hasta=' + dias(HOY, 50), A);
  const evCobro = (j.eventos || []).filter(e => e.tipo === 'cobro');
  const malCal = evCobro.filter(e => { const c = cartera.find(x => x.lead_id === e.lead_id); return !c || cent(e.monto) !== cent(c.saldo) || e.fecha !== c.vence; });
  revisa(evCobro.length >= 1 && !malCal.length, 'Calendario: cada cobro aparece el día que vence y por su saldo', malCal);
  db.close();

  seccion('4. Si algo incongruente se cuela, la revisión lo encuentra');
  // Si la base misma ya impide la incongruencia (candados internos), cuenta como bien y no hay nada que detectar.
  let bloqueada = false;
  const romper = (sql, ...p) => { bloqueada = false; const d = new DatabaseSync(DB); d.exec('PRAGMA foreign_keys = OFF'); try { d.prepare(sql).run(...p); } catch (err) { if (!/constraint|no se modifican|no se puede/i.test(err.message)) throw err; bloqueada = err.message; } finally { d.close(); } };
  const encuentra = async (titulo, que) => { if (bloqueada) { revisa(true, 'la base misma impide: ' + que + ' («' + bloqueada + '»)'); return; } const [, r] = await pedir('GET', '/admin/integridad', A); const x = (r.resultados || []).find(y => y.titulo.includes(titulo)); revisa(x && x.total >= 1, 'detecta: ' + que, x || r.resultados?.map(y => y.titulo)); };
  romper('UPDATE leads SET fecha_servicio = NULL WHERE id = ?', ordenes[3].id); await encuentra('sin fecha de servicio', 'orden ganada sin fecha de servicio');
  romper("UPDATE leads SET fecha_servicio = date(fecha_cotizacion, '-3 days') WHERE id = ?", ordenes[3].id); await encuentra('ANTES de la fecha de la cotización', 'servicio antes de cotizar');
  romper("UPDATE leads SET fecha_realizado = date('now', '+5 days') WHERE id = ?", ordenes[2].id); await encuentra('Realizado sin fecha', 'realizado con fecha futura');
  romper('UPDATE leads SET valor = valor + 1 WHERE id = ?', ordenes[4].id); await encuentra('distinto a la suma de sus partidas', 'importe que no cuadra con sus partidas');
  romper("UPDATE leads SET factura_folio = 'm 1' WHERE id = ?", ordenes[2].id); await encuentra('Folio de factura repetido', 'factura repetida (escrita distinto)');
  romper("UPDATE leads SET factura_fecha = date('now', '+9 days') WHERE id = ?", ordenes[0].id); await encuentra('Factura con fecha futura', 'factura con fecha futura');
  romper("UPDATE cobros SET fecha = date('now', '+2 days') WHERE lead_id = ? AND cancelado = 0", ordenes[0].id); await encuentra('Pagos con fecha futura', 'pago con fecha futura');
  romper('UPDATE cobros SET monto_cent = monto_cent * 10 WHERE lead_id = ? AND cancelado = 0', ordenes[1].id); await encuentra('Se cobró más', 'cobro mayor a lo que se debía');
  romper("UPDATE leads SET estatus = 'perdido' WHERE id = ?", ordenes[2].id); await encuentra('Pagos en cotizaciones', 'pagos en algo que ya no es orden de servicio');
  romper("UPDATE cuentas_por_pagar SET fecha_vencimiento = date(fecha_documento, '-1 day') WHERE lead_id = ?", ordenes[0].id); await encuentra('Vence antes', 'cuenta por pagar que vence antes de su documento');
  romper('UPDATE pagos_proveedor SET monto_cent = monto_cent * 100 WHERE id = (SELECT MIN(id) FROM pagos_proveedor)'); await encuentra('más de lo que se debía', 'pago a proveedor mayor a la deuda');
  romper('UPDATE ordenes_compra SET total_cent = total_cent + 500 WHERE id = ?', oc.id); await encuentra('distinto a la suma de sus partidas', 'orden de compra con total que no cuadra');
  await encuentra('sin su cuenta por pagar', 'orden de compra autorizada con otro monto que su cuenta por pagar');
  romper('UPDATE cuentas_por_pagar SET cancelada = 0 WHERE id = (SELECT cxp_id FROM ordenes_compra WHERE id = ?)', oc2.id); await encuentra('cancelada con cuenta por pagar vigente', 'orden cancelada con su cuenta por pagar activa');
  romper("UPDATE ordenes_compra SET fecha_requerida = date(fecha, '-2 days') WHERE id = ?", oc.id); await encuentra('Fecha requerida antes', 'orden requerida antes de su fecha');
  romper("UPDATE documentos_oc SET eliminado = 1 WHERE oc_id = ? AND tipo = 'firma_recepcion'", oc.id); await encuentra('Recibida sin foto ni firma', 'recibida sin foto ni firma');
  romper("UPDATE solicitudes_compra SET oc_id = ? WHERE id = ?", oc2.id, sol.id); await encuentra('sin una orden válida', 'solicitud que apunta a una orden cancelada');
  romper("UPDATE documentos_solicitud SET eliminado = 1 WHERE solicitud_id = ? AND id <> ?", sol.id, cot.id); await encuentra('sin las 3 cotizaciones', 'se eligió sin 3 cotizaciones ni excepción');
  romper("UPDATE clientes SET telefono_normalizado = (SELECT telefono_normalizado FROM clientes WHERE id = ?) WHERE id = ?", clientes[0].id, clientes[1].id); await encuentra('Mismo teléfono', 'mismo teléfono en dos clientes');
  romper("UPDATE clientes SET rfc = 'ABC010101AB1' WHERE id IN (?, ?)", clientes[2].id, clientes[3].id); await encuentra('Mismo RFC', 'mismo RFC en dos clientes');
  romper('UPDATE leads SET cliente_id = 99999 WHERE id = ?', ordenes[5].id); await encuentra('sin cliente', 'orden de un cliente que no existe');
  { const d = new DatabaseSync(DB, { readOnly: true }); const doc = d.prepare('SELECT archivo FROM documentos_solicitud WHERE id = ?').get(cot.id); d.close(); fs.unlinkSync(path.join(dir, 'archivos', 'solicitudes', doc.archivo)); }
  await encuentra('Cotizaciones y fotos de solicitudes: archivos que faltan', 'un archivo subido que ya no está en el servidor');
  [s, j] = await pedir('GET', '/auditoria?entidad=catalogo', A); revisa(j.some(r => r.accion === 'revisión de integridad'), 'cada revisión queda en la bitácora (quién la corrió y qué encontró)');

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
