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

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', m.map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
