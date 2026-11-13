// Cuentas por pagar con la estructura del Excel «CXP»: categorías (y cuáles no son gasto), a quién se paga,
// tipo de comprobante, método del SAT, vías de pago, cuenta de salida, CLABE y la descarga con el mismo formato.
// Uso: node tests/simulacion-cxp-formato.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cxpfmt-')); const PUERTO = String(8100 + Math.floor(Math.random() * 200));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'CxpFormato-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Letty Pagos', correo: 'letty.pagos@saneadren.com.mx', password: 'Saneadren-Costos-Pagos-26', rol: 'costos' });
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Fmt', correo: 'ventas.fmt@saneadren.com.mx', password: 'Saneadren-Ventas-Fmt-26', rol: 'ventas' });
  const C = (await pedir('POST', '/login', null, { nombre: 'letty.pagos@saneadren.com.mx', password: 'Saneadren-Costos-Pagos-26' }))[1].token;
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.fmt@saneadren.com.mx', password: 'Saneadren-Ventas-Fmt-26' }))[1].token;
  let s, j;

  console.log('1. Categorías del Excel');
  [s, j] = await pedir('GET', '/finanzas/categorias', V);
  const cat = Object.fromEntries((j || []).map(c => [c.clave, c]));
  revisa(['sueldos', 'impuestos', 'creditos', 'mantto_vehiculos', 'renta_inmuebles', 'activos', 'prestamos', 'movimientos'].every(k => cat[k]), 'existen las categorías nuevas (sueldos, impuestos, créditos, mantenimiento de vehículos, renta, inversión…)', Object.keys(cat));
  revisa(cat.activos?.es_gasto === 0 && cat.prestamos?.es_gasto === 0 && cat.movimientos?.es_gasto === 0 && cat.sueldos?.es_gasto === 1, 'inversión, préstamos y traspasos NO cuentan como gasto; las demás sí');
  revisa(cat.combustible && cat.refacciones && cat.otro, 'las categorías de antes siguen igual');
  [s] = await pedir('PUT', '/finanzas/categorias/sueldos', C, { es_gasto: false }); revisa(s === 403, 'solo administración cambia si una categoría cuenta como gasto');
  [s, j] = await pedir('PUT', '/finanzas/categorias/sueldos', C, { nombre: 'Sueldos y nómina' }); revisa(s === 200 && j.es_gasto === 1, 'renombrar no cambia la marca de gasto');

  console.log('2. Proveedor con CLABE y banco');
  [s, j] = await pedir('POST', '/finanzas/proveedores', C, { nombre: 'Aceros Morlet', categoria: 'herramientas', dias_credito: 15, clabe: '12345', banco: 'Santander' }); revisa(s === 400 && /18 dígitos/.test(j.error), 'una CLABE incompleta no se acepta');
  [s, j] = await pedir('POST', '/finanzas/proveedores', C, { nombre: 'Aceros Morlet', categoria: 'herramientas', dias_credito: 15, clabe: '0146 8065 5039 528945', banco: 'Santander' });
  const morlet = j; revisa(s === 201 && morlet.clabe === '014680655039528945' && morlet.banco === 'Santander', 'CLABE con espacios se guarda limpia', [s, j.clabe, j.error]);
  const camiones = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Camiones Groso', categoria: 'activos', dias_credito: 0 }))[1];

  console.log('3. Cuenta por pagar con comprobante, método SAT y a quién se paga');
  const base = { proveedor_id: morlet.id, categoria: 'herramientas', concepto: 'Soldadura y discos', total: 2760, fecha_documento: HOY, dias_credito: 15 };
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...base, tipo_comprobante: 'inventado' }); revisa(s === 400, 'un tipo de comprobante que no existe no se acepta');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...base, tipo_comprobante: 'recibo', metodo_sat: 'PUE' }); revisa(s === 400 && /solo aplica a facturas/.test(j.error), 'PUE/PPD solo en facturas');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...base, tipo_comprobante: 'factura', metodo_sat: 'XYZ' }); revisa(s === 400, 'método del SAT inválido');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...base, tipo_comprobante: 'factura', metodo_sat: 'ppd', factura_folio: '7233', beneficiario: 'Marco Antonio Herrera Hernandez' });
  const cx1 = j; revisa(s === 201, 'factura PPD pagada a otra persona (reembolso a Marco)', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...base, concepto: 'Brocas', factura_folio: '7240', beneficiario: 'ACEROS  MORLET' });
  const cx2 = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: camiones.id, categoria: 'activos', concepto: 'Tracto camión FAW 2026', total: 1825000, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'FAW-1' });
  const cxActivo = j;

  console.log('4. Pagos con las vías del Excel');
  for (const via of ['layout', 'pagadora', 'domiciliado', 'linea_captura', 'directo']) {
    const [, c] = await pedir('POST', '/finanzas/cxp', C, { ...base, concepto: 'Prueba ' + via, total: 100, factura_folio: 'V-' + via });
    [s, j] = await pedir('POST', '/finanzas/cxp/' + c.id + '/pagos', C, { monto: 100, metodo: via, fecha: HOY, cuenta_origen: 'Santander empresa' });
    revisa(s === 201, 'vía de pago «' + via + '» aceptada', [s, j.error]);
  }
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cx1.id + '/pagos', C, { monto: 1000, metodo: 'transferencia', fecha: HOY, referencia: 'SPEI 1', cuenta_origen: 'Tarjeta de Luis Perea' });
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cx1.id + '/pagos', C, { monto: 760, metodo: 'transferencia', fecha: HOY, referencia: 'SPEI 2', cuenta_origen: 'Santander empresa', forzar: true });
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cx1.id + '/pagos', C, { monto: 1, metodo: 'bitcoin', fecha: HOY }); revisa(s === 400, 'una vía que no existe no se acepta');

  console.log('5. Datos para descargar con el formato CXP');
  [s] = await pedir('GET', '/finanzas/cxp/formato-excel', V); revisa(s === 403, 'ventas no descarga el Excel');
  [s] = await pedir('GET', '/finanzas/cxp/formato-excel', C); revisa(s === 403, 'tampoco el encargado (las exportaciones son de administración)');
  [s, j] = await pedir('GET', '/finanzas/cxp/formato-excel', A);
  const x1 = j.cuentas?.find(c => c.id === cx1.id), x2 = j.cuentas?.find(c => c.id === cx2.id);
  revisa(s === 200 && x1 && x1.beneficiario === 'Marco Antonio Herrera Hernandez' && x1.proveedor === 'Aceros Morlet' && x1.metodo_sat === 'PPD' && x1.tipo_comprobante === 'factura' && x1.clabe === '014680655039528945' && x1.banco === 'Santander' && x1.dias_credito === 15 && x1.capturo === 'Letty Pagos',
    'cada cuenta trae proveedor, a quién se paga, comprobante, SAT, CLABE, banco, días y quién capturó', x1);
  revisa(x2?.beneficiario === 'Aceros Morlet', 'si «a quién se paga» es el mismo proveedor (aunque escrito distinto), queda como el proveedor', x2?.beneficiario);
  const p1 = j.pagos.filter(g => g.cxp_id === cx1.id);
  revisa(p1.length === 2 && p1.some(g => g.cuenta_origen === 'Tarjeta de Luis Perea') && p1.reduce((t, g) => t + g.monto, 0) === 1760, 'cada pago con su fecha, vía, referencia y cuenta de salida', p1);
  revisa(j.no_gasto.includes('activos') && j.cuentas.find(c => c.id === cxActivo.id)?.es_gasto === false, 'la compra del tracto camión viene marcada como «no es gasto»');

  console.log('6. Resultados: la inversión no se resta como gasto');
  [s, j] = await pedir('GET', '/tablero?desde=' + HOY + '&hasta=' + HOY, A);
  // Es factura sin IVA capturado: se cuenta sin IVA (16 % incluido estimado): $1,825,000 − $251,724.14.
  revisa(Math.round(j.actual.no_gasto * 100) === 182500000 - Math.round(182500000 * 16 / 116) && j.actual.gasto < 100000, 'el tracto camión ($1,825,000 con IVA) va en «no es gasto» (sin IVA), no en gastos', [j.actual.gasto, j.actual.no_gasto]);
  revisa(j.gastos.find(g => g.categoria === 'activos')?.es_gasto === false, 'en la lista de gastos aparece marcado como inversión');

  console.log('7. Tipo de gasto y observaciones (como el Excel, 2026-11-12)');
  const fijo = { proveedor_id: morlet.id, categoria: 'renta_inmuebles', concepto: 'Renta casa Atotonilco noviembre', total: 8500, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'recibo' };
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...fijo, tipo_gasto: 'cada rato' }); revisa(s === 400 && /tipo de gasto/.test(j.error), 'un tipo de gasto que no está en la lista no se acepta', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...fijo, tipo_gasto: '12' }); revisa(s === 400, 'tampoco los números sueltos de la hoja LISTA');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...fijo, tipo_gasto: 'mensual', notas: 'Se paga los días 5' });
  const renta = j; revisa(s === 201, 'gasto MENSUAL con observaciones', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...fijo, concepto: 'Caseta de vigilancia', categoria: 'otro' }); const sinTipo = j; revisa(s === 201, 'sin tipo de gasto también se puede (es opcional)', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  let r1 = (j || []).find(x => x.id === renta.id), r2 = (j || []).find(x => x.id === sinTipo.id);
  revisa(r1?.tipo_gasto === 'mensual' && r1?.tipo_gasto_nombre === 'Mensual' && r1?.notas === 'Se paga los días 5', 'la lista trae el tipo de gasto y las observaciones', r1);
  revisa(r2 && r2.tipo_gasto === null && r2.tipo_gasto_nombre === '', 'sin tipo de gasto queda «sin indicar»', r2);
  // Editar después: solo tipo de gasto y observaciones; los montos no se mueven aunque se manden.
  [s] = await pedir('POST', '/finanzas/cxp/' + renta.id + '/datos', V, { tipo_gasto: 'unico' }); revisa(s === 403 || s === 404, 'ventas no cambia los datos de un gasto', s);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + renta.id + '/datos', C, { tipo_gasto: 'diario' }); revisa(s === 400, 'al editar tampoco se acepta un tipo que no está en la lista');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + renta.id + '/datos', C, { notas: 'x'.repeat(1001) }); revisa(s === 400, 'observaciones de más de 1000 letras no se aceptan (no se recortan a escondidas)');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + sinTipo.id + '/datos', C, { tipo_gasto: 'unico', notas: 'Construcción única', total: 1, total_cent: 100, fecha_documento: '2020-01-01', proveedor_id: camiones.id });
  revisa(s === 200 && j.tipo_gasto === 'unico' && j.notas === 'Construcción única', 'quien paga cambia el tipo de gasto y las observaciones', [s, j]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C); r2 = (j || []).find(x => x.id === sinTipo.id);
  revisa(r2?.total === 8500 && r2?.fecha_documento === HOY && r2?.proveedor_id === morlet.id && r2?.tipo_gasto_nombre === 'Único', 'el total, la fecha y el proveedor NO cambian aunque se manden', r2);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + sinTipo.id + '/datos', C, { tipo_gasto: 'unico', notas: 'Construcción única' }); revisa(s === 200 && j.sin_cambios, 'guardar lo mismo no deja un cambio en el historial');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + sinTipo.id + '/datos', A, { tipo_gasto: '' }); revisa(s === 200 && j.tipo_gasto === null && j.notas === 'Construcción única', 'se puede regresar a «sin indicar» sin borrar las observaciones', j);
  [s, j] = await pedir('GET', '/auditoria?entidad=cuenta_por_pagar&id=' + sinTipo.id, A);
  const hist = (j || []).filter(f => f.accion === 'datos').map(f => f.detalle);
  revisa(s === 200 && hist.length === 2 && hist.some(d => /tipo de gasto: sin indicar → Único/.test(d) && /observaciones: «» → «Construcción única»/.test(d)) && hist.some(d => /tipo de gasto: Único → sin indicar/.test(d)), 'el historial guarda qué cambió (antes → después), una vez por cambio real', hist);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + renta.id + '/repetir', C, {});
  [, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  const copia = (j || []).find(x => x.concepto === fijo.concepto && x.id !== renta.id);
  revisa(copia?.tipo_gasto === 'mensual', '«🔁 Repetir» copia también el tipo de gasto', copia);
  [s, j] = await pedir('GET', '/finanzas/cxp/formato-excel', A);
  revisa(j.cuentas?.find(c => c.id === renta.id)?.tipo_gasto === 'mensual' && j.cuentas?.find(c => c.id === cx1.id)?.tipo_gasto === null, 'la descarga trae el tipo de gasto de cada cuenta');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + renta.id + '/cancelar', A, { motivo: 'Prueba de cancelación de renta' });
  [s] = await pedir('POST', '/finanzas/cxp/' + renta.id + '/datos', C, { tipo_gasto: 'unico' }); revisa(s === 404, 'una cuenta cancelada ya no se edita');

  console.log('8. La tabla con las columnas del Excel (fase 2)');
  const masDias = d => { const f = new Date(HOY + 'T12:00:00Z'); f.setUTCDate(f.getUTCDate() + d); return f.toISOString().slice(0, 10); };
  // Se paga una parte HOY de una factura con fecha de dentro de 10 días: eso es ANTICIPO (pagado antes de la fecha de la factura).
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { proveedor_id: morlet.id, categoria: 'herramientas', concepto: 'Lote de herramientas para taller', total: 48006, fecha_documento: masDias(10), dias_credito: 15, tipo_comprobante: 'pagadora', tipo_gasto: 'unico' });
  const lote = j; revisa(s === 201, 'factura de pagadora con fecha de dentro de 10 días', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + lote.id + '/pagos', C, { monto: 8000, metodo: 'transferencia', fecha: HOY, cuenta_origen: 'Santander empresa' }); revisa(s === 201, 'se paga una parte antes de la fecha de la factura', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  let t = (j || []).find(x => x.id === lote.id);
  revisa(t?.capturo === 'Letty Pagos' && t?.anticipo === 8000 && t?.pagado === 8000 && t?.saldo === 40006, 'cada renglón trae quién capturó, ANTICIPO, PAGADO y PENDIENTE', t && { capturo: t.capturo, anticipo: t.anticipo, pagado: t.pagado, saldo: t.saldo });
  revisa(t?.clabe === '014680655039528945' && t?.banco === 'Santander', 'quien paga ve CUENTA BANCARIA y BANCO del proveedor', t && [t.clabe, t.banco]);
  revisa(t && t.total_cent === 4800600 && t.pagado_cent === 800000, 'trae los montos en centavos para sacar el STATUS sin redondeos', t && [t.total_cent, t.pagado_cent]);
  const t1 = (j || []).find(x => x.id === cx1.id);
  revisa(t1?.anticipo === 0, 'lo pagado el mismo día de la factura (o después) no es anticipo', t1?.anticipo);
  // Alguien que ve las cuentas por pagar pero no paga: sin CLABE ni banco.
  await pedir('POST', '/usuarios', A, { nombre: 'Tito Tecnico', correo: 'tito.fmt@saneadren.com.mx', password: 'Saneadren-Tecnico-Fmt-26', rol: 'tecnico' });
  const T = (await pedir('POST', '/login', null, { nombre: 'tito.fmt@saneadren.com.mx', password: 'Saneadren-Tecnico-Fmt-26' }))[1].token;
  for (const [tok, quien] of [[V, 'ventas'], [T, 'técnico']]) {
    [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', tok);
    revisa(s !== 200 || (Array.isArray(j) && j.every(x => !('clabe' in x) && !('banco' in x)) && !JSON.stringify(j).includes('014680655039528945')), quien + ': si ve cuentas por pagar, no le llegan CLABE ni banco', s);
  }
  // STATUS y METODO DE PAGO salen de los datos, con la misma regla que la descarga (public/cxp-excel.js).
  const X = require('../public/cxp-excel.js');
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  t = j.find(x => x.id === lote.id);
  const via = r => (r.ultimo_pago ? r.ultimo_pago.split('|')[1] : null);
  revisa(X.statusDe(t.total_cent, t.pagado_cent) === 'PARCIAL' && X.metodoExcel(t, via(t)) === 'PAGADORA', 'el lote sale PARCIAL y PAGADORA');
  const lay = j.find(x => x.concepto === 'Prueba layout'), ppd = j.find(x => x.id === cx1.id), ren = j.find(x => x.concepto === 'Caseta de vigilancia');
  revisa(X.statusDe(lay.total_cent, lay.pagado_cent) === 'PAGADO' && X.statusDe(ren.total_cent, ren.pagado_cent) === 'PENDIENTE' && X.statusDe(ppd.total_cent, ppd.pagado_cent) === 'PARCIAL', 'PAGADO, PENDIENTE y PARCIAL según lo pagado', [lay.pagado, ren.pagado, ppd.pagado]);
  revisa(X.metodoExcel(ppd, via(ppd)) === 'PPD' && X.metodoExcel(ren, via(ren)) === 'SIN FACTURA', 'factura PPD → PPD; recibo sin pagar → SIN FACTURA');

  console.log('9. ¿A qué corresponde? Solicitud u orden de compra y centro de costos (2026-11-13)');
  const taller = (await pedir('POST', '/compras/centros', A, { nombre: 'Taller de prueba' }))[1];
  const oficina = (await pedir('POST', '/compras/centros', A, { nombre: 'Oficina de prueba' }))[1];
  const sol = (await pedir('POST', '/compras/solicitudes', A, { que: '4 llantas 11R22.5', para_que: 'Al camión de vacío se le reventó una', centro_id: taller.id, equipo: 'C-22' }))[1];
  let oc = (await pedir('POST', '/compras/ordenes', A, { forzar: true, proveedor_id: morlet.id, centro_id: taller.id, categoria: 'herramientas', fecha: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Llantas', precio: 9000 }] }))[1];
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 0 }); revisa(s === 200 && j.cxp_id, 'la orden de compra autorizada crea su cuenta por pagar (como siempre)', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/compras-para-gasto', V); revisa(s === 403, 'ventas no recibe la lista de solicitudes y órdenes de compra');
  [s, j] = await pedir('GET', '/finanzas/compras-para-gasto', C);
  revisa(s === 200 && j.solicitudes.some(x => x.id === sol.id && /^SOL-/.test(x.folio) && x.centro_nombre === 'Taller de prueba') && j.ordenes.some(x => x.id === oc.id && /^OC-/.test(x.folio) && x.cxp_id && x.total === 9000) && j.centros.some(c => c.id === oficina.id),
    'Compras recibe solicitudes, órdenes de compra (con folio, centro y si ya tienen cuenta por pagar) y centros', [s, j.error]);
  const extra = { proveedor_id: morlet.id, categoria: 'herramientas', concepto: 'Flete de las llantas', total: 650, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'recibo' };
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, oc_id: oc.id });
  revisa(s === 409 && j.codigo === 'POSIBLE_DUPLICADO' && /ya tiene su cuenta por pagar de \$9,000\.00/.test(j.error) && /EXTRA/.test(j.error), 'ligar a una OC que ya tiene su cuenta avisa antes de guardar (¿es un gasto extra?)', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, oc_id: oc.id, forzar: true }); const gExtra = j;
  revisa(s === 201, 'confirmado, se guarda como gasto extra de esa compra', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, concepto: 'Desmontaje', solicitud_id: sol.id, oc_id: oc.id }); revisa(s === 400, 'no se liga a la solicitud y a la orden a la vez');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, concepto: 'Desmontaje', solicitud_id: 999999 }); revisa(s === 400, 'una solicitud que no existe no se acepta');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, concepto: 'Desmontaje', centro_id: 999999 }); revisa(s === 400, 'un centro de costos que no existe no se acepta');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, concepto: 'Desmontaje de llantas', solicitud_id: sol.id }); const gSol = j; revisa(s === 201, 'gasto ligado a la solicitud', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...extra, concepto: 'Papelería', centro_id: oficina.id, categoria: 'otro' }); const gCen = j; revisa(s === 201, 'gasto solo con centro de costos', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  const e1 = j.find(x => x.id === gExtra.id), e2 = j.find(x => x.id === gSol.id), e3 = j.find(x => x.id === gCen.id);
  revisa(/^OC-/.test(e1?.compra_folio) && e1.centro_nombre === 'Taller de prueba', 'el gasto extra muestra el folio de la OC y toma su centro de costos', e1 && [e1.compra_folio, e1.centro_nombre]);
  revisa(/^SOL-/.test(e2?.compra_folio) && e2.centro_nombre === 'Taller de prueba', 'el de la solicitud muestra su folio SOL y su centro', e2 && [e2.compra_folio, e2.centro_nombre]);
  revisa(e3?.compra_folio === null && e3.centro_nombre === 'Oficina de prueba', 'el de solo centro muestra el centro elegido', e3 && [e3.compra_folio, e3.centro_nombre]);
  revisa(j.filter(x => x.oc_id === oc.id || x.id === oc.cxp_id).length >= 1 && j.find(x => x.id === (j.find(y => y.concepto && y.total === 9000 && y.proveedor_id === morlet.id)?.id))?.total === 9000, 'la cuenta de la OC sigue igual ($9,000): el flete se suma aparte');
  revisa(e1?.repetible === false && e2?.repetible === false && e3?.repetible === true, '«🔁 Repetir» no sale en gastos de compras (sí en uno solo con centro)', [e1?.repetible, e2?.repetible, e3?.repetible]);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + gExtra.id + '/repetir', C, {}); revisa(s === 409 && /compra/.test(j.error), 'y el servidor tampoco lo repite', [s, j.error]);
  // Quien no paga (técnico) no liga compras.
  const T2 = (await pedir('POST', '/login', null, { nombre: 'tito.fmt@saneadren.com.mx', password: 'Saneadren-Tecnico-Fmt-26' }))[1].token;
  [s, j] = await pedir('POST', '/finanzas/cxp', T2, { ...extra, concepto: 'Flete', solicitud_id: sol.id }); revisa(s === 403, 'el técnico no liga gastos a compras', s);
  [s, j] = await pedir('GET', '/finanzas/cxp/formato-excel', A);
  const x9 = j.cuentas.find(x => x.id === gExtra.id);
  revisa(/^OC-/.test(x9?.compra_folio) && x9.centro_nombre === 'Taller de prueba', 'la descarga «CXP» trae la compra y el centro (van en OBSERVACIONES)');
  const obs = require('../public/cxp-excel.js').renglonesCxp({ cuentas: [x9], pagos: [] })[0][19];
  revisa(/Compra OC-/.test(obs) && /Centro de costos: Taller de prueba/.test(obs), 'OBSERVACIONES dice «Compra OC-…» y el centro', obs);

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', m.map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
