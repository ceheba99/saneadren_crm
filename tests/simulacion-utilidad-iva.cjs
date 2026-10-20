// UTILIDAD SIN IVA en Resultados: la venta se cuenta sin IVA y los gastos también (antes se restaban con IVA y la
// utilidad salía más baja). Con datos conocidos, cada número debe cuadrar exacto:
//  · factura con IVA capturado, factura sin capturar (se estima 16 % y se avisa), recibo sin factura (cuenta completo),
//    comprobante informativo (no se suma), inversión (no es gasto), orden de compra (su IVA pasa solo);
//  · capturar o corregir el IVA después, y sus validaciones; la tendencia de 12 meses cuadra con el periodo.
// Uso: node tests/simulacion-utilidad-iva.cjs   (base temporal; no toca saneadren.db)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-utilidad-iva-')); const PUERTO = String(5100 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Utilidad-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'u.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const sumarDias = (f, d) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
// Para que el periodo y el mes de la tendencia coincidan, todo cae en el mes en curso (desde el día 1 hasta hoy).
const DIA1 = HOY.slice(0, 8) + '01';

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Iva', correo: 'vi@saneadren.com.mx', password: 'Ventas-Iva-2026', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'vi@saneadren.com.mx', password: 'Ventas-Iva-2026' }))[1].token;
  const servicios = (await pedir('GET', '/servicios', A))[1], canales = (await pedir('GET', '/canales', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  let s, j;
  const cli = (await pedir('POST', '/contactos', A, { nombre: 'Planta Iva', telefono: '4421119001', direccion: 'x', canal_origen_id: canales[0].id, empresa_contacto: 'Planta Iva SA' }))[1].id;
  // Venta: un servicio de $10,000 más IVA ($11,600), realizado hoy.
  const [, orden] = await pedir('POST', '/leads', A, { cliente_id: cli, direccion: 'x', responsable_id: yo, forzar_duplicado: true, estatus: 'ganado', iva_modo: 'mas_iva', partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 10000 }]), fecha_servicio: HOY });
  [s, j] = await pedir('POST', '/leads/' + orden.id + '/ejecucion', A, { estado: 'realizado', fecha: HOY, realizado_por: 'propio' }); revisa(s === 200, 'servicio de $10,000 + IVA realizado hoy', j);
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Combustibles del Centro', categoria: 'combustible', dias_credito: 0 });
  const gasto = (extra) => pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', fecha_documento: HOY, dias_credito: 15, ...extra });

  console.log('1. Captura del IVA de cada gasto');
  [s, j] = await gasto({ concepto: 'Diesel de la orden', total: 1160, tipo_comprobante: 'factura', factura_folio: 'A-1', iva: 160, lead_id: orden.id }); const g1 = j.id;
  revisa(s === 201, 'factura de $1,160 con IVA $160 capturado (ligada a la orden)', j);
  [s, j] = await gasto({ concepto: 'Diesel sin desglose', total: 2320, tipo_comprobante: 'factura', factura_folio: 'A-2' }); const g2 = j.id;
  revisa(s === 201, 'factura de $2,320 sin capturar el IVA', j);
  [s, j] = await gasto({ concepto: 'Casetas', total: 500, tipo_comprobante: 'recibo' }); revisa(s === 201, 'recibo de $500 (sin factura)');
  [s, j] = await gasto({ concepto: 'Saldo informativo', total: 9999, tipo_comprobante: 'informativo' }); revisa(s === 201, 'comprobante informativo de $9,999');
  [s, j] = await gasto({ concepto: 'Camioneta usada', total: 116000, categoria: 'activos', tipo_comprobante: 'factura', factura_folio: 'V-1', iva: 16000 }); revisa(s === 201, 'compra de una camioneta (inversión) de $116,000 con IVA $16,000', j);
  for (const [b, que] of [[{ total: 1000, tipo_comprobante: 'factura', iva: 1000 }, 'IVA igual al total'], [{ total: 1000, tipo_comprobante: 'factura', iva: 1500 }, 'IVA mayor que el total'],
    [{ total: 1000, tipo_comprobante: 'factura', iva: 'abc' }, 'IVA que no es número'], [{ total: 1000, tipo_comprobante: 'factura', iva: -5 }, 'IVA negativo'], [{ total: 1000, tipo_comprobante: 'factura', iva: 10.555 }, 'IVA con 3 decimales'],
    [{ total: 1000, tipo_comprobante: 'recibo', iva: 160 }, 'IVA en un recibo (no es acreditable)']]) {
    [s, j] = await gasto({ concepto: 'Prueba de IVA', ...b }); revisa(s === 400, `se rechaza: ${que}`, j);
  }
  [s, j] = await gasto({ concepto: 'Factura tasa cero', total: 300, tipo_comprobante: 'factura', factura_folio: 'Z-1', iva: '0', categoria: 'otro' }); const g0 = j.id; revisa(s === 201, 'factura tasa 0: IVA 0 se acepta', j);

  console.log('2. Resultados del mes');
  [s, j] = await pedir('GET', `/tablero?desde=${DIA1}&hasta=${HOY}&tipo=mes`, A);
  const a = j.actual;
  // Gastos sin IVA: 1,000 (factura con IVA) + 2,000 (estimada 16 %) + 500 (recibo) + 300 (tasa 0) = 3,800. Con IVA: 1,160 + 2,320 + 500 + 300 = 4,280.
  revisa(a.venta === 10000 && a.gasto === 3800 && a.gasto_con_iva === 4280, 'venta $10,000 sin IVA; gastos $3,800 sin IVA ($4,280 con IVA)', [a.venta, a.gasto, a.gasto_con_iva]);
  revisa(a.utilidad === 6200 && a.margen_pct === 62, 'utilidad $6,200 (62 %): antes salía $5,720 por restar gastos con IVA', [a.utilidad, a.margen_pct]);
  revisa(a.iva_gastos === 480 && a.iva_estimado === 320 && a.iva_estimado_n === 1, 'IVA de gastos $480, de él $320 estimado (1 factura sin capturar)', [a.iva_gastos, a.iva_estimado, a.iva_estimado_n]);
  revisa(a.no_gasto === 100000, 'la camioneta no resta a la utilidad: aparece aparte como inversión, sin IVA ($100,000)', a.no_gasto);
  revisa(a.costo_directo === 1000 && a.margen_directo === 9000, 'costo de terceros de la orden: $1,000 sin IVA; margen directo $9,000', [a.costo_directo, a.margen_directo]);
  revisa(!JSON.stringify(j.gastos).includes('9999') && j.gastos.find(g => g.categoria === 'combustible')?.total === 3500 && j.gastos.find(g => g.categoria === 'combustible')?.con_iva === 3980, 'por categoría: combustible $3,500 sin IVA ($3,980 con IVA); el informativo no aparece', j.gastos);
  revisa(j.alertas.some(x => /1 factura de gasto sin IVA capturado.*\$320\.00/.test(x.texto) && x.ir === 'pagar'), 'alerta: 1 factura sin IVA capturado, estimado en $320 (lleva a Cuentas por pagar)', j.alertas.map(x => x.texto));
  const mes = j.tendencia[11];
  revisa(mes.venta === 10000 && mes.gasto === 3800 && mes.utilidad === 6200, 'la tendencia del mes cuadra con el periodo (sin IVA y sin la inversión)', mes);
  // Debes: lo que falta pagar, sin el informativo: 1,160 + 2,320 + 500 + 116,000 + 300.
  revisa(j.foto.debes === 120280, '«Debes» no suma el comprobante informativo', j.foto.debes);

  console.log('3. Capturar o corregir el IVA después');
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const x2 = j.find?.(x => x.id === g2);
  revisa(x2 && x2.iva === 320 && x2.iva_estimado === true && x2.es_factura, 'en Cuentas por pagar, la factura sin desglose muestra IVA $320 «estimado»', x2 && { iva: x2.iva, est: x2.iva_estimado });
  [s, j] = await pedir('POST', '/finanzas/cxp/' + g2 + '/iva', V, { iva: 0 }); revisa(s === 403 || s === 404, 'ventas no cambia el IVA de un gasto (ni lo ve: ' + s + ')', s);
  for (const [v, que] of [[2320, 'igual al total'], ['x', 'texto'], ['', 'vacío'], [-1, 'negativo']]) { [s, j] = await pedir('POST', '/finanzas/cxp/' + g2 + '/iva', A, { iva: v }); revisa(s === 400, `IVA ${que}: se rechaza`, j); }
  const recibo = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.concepto === 'Casetas');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + recibo.id + '/iva', A, { iva: 50 }); revisa(s === 400, 'a un recibo no se le pone IVA acreditable', j);
  [s, j] = await pedir('POST', '/finanzas/cxp/999999/iva', A, { iva: 0 }); revisa(s === 404, 'cuenta que no existe: 404');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + g2 + '/iva', A, { iva: '0' }); revisa(s === 200, 'administración captura el IVA real de la factura: 0 (tasa cero)', j);
  [s, j] = await pedir('GET', `/tablero?desde=${DIA1}&hasta=${HOY}&tipo=mes`, A);
  revisa(j.actual.gasto === 4120 && j.actual.utilidad === 5880 && j.actual.iva_estimado_n === 0 && !j.alertas.some(x => /sin IVA capturado/.test(x.texto)), 'con el IVA real ya no hay estimados: gastos $4,120, utilidad $5,880, sin alerta', [j.actual.gasto, j.actual.utilidad, j.actual.iva_estimado_n]);
  [s, j] = await pedir('GET', '/auditoria?entidad=cuenta_por_pagar&id=' + g2, A);
  revisa(j.some?.(r => r.accion === 'IVA' && /\$320\.00 \(estimado\) → \$0\.00/.test(r.detalle)), 'queda en la bitácora: IVA $320 (estimado) → $0', j.slice?.(0, 2));

  console.log('4. Orden de compra: su IVA pasa solo a la cuenta por pagar');
  const centro = (await pedir('GET', '/compras/centros', A))[1][0];
  [s, j] = await pedir('POST', '/compras/ordenes', A, { forzar: true, proveedor_id: prov.id, centro_id: centro.id, categoria: 'combustible', fecha: HOY, fecha_requerida: HOY, iva_modo: 'mas_iva', partidas: [{ cantidad: 2, descripcion: 'Aceite hidráulico', precio: 500 }] });
  const oc = j; revisa(s === 201 && oc.iva === 160 && oc.total === 1160, 'orden de compra: $1,000 + IVA $160', [s, oc.iva, oc.total, oc.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 0 });
  const cxpOc = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.id === j.cxp_id);
  revisa(s === 200 && cxpOc && cxpOc.iva === 160 && cxpOc.iva_estimado === false, 'al autorizarla, su cuenta por pagar trae el IVA de la orden ($160, no estimado)', [s, cxpOc?.iva, cxpOc?.iva_estimado, j.error]);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exitCode = 1; }
  const errores = salida.split('\n').filter(l => /Error en|no manejado|uncaught/i.test(l));
  if (errores.length) { console.log('Errores del servidor:\n' + errores.slice(0, 5).join('\n')); process.exitCode = 1; }
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
})().catch(e => { console.error('ERROR', e); console.error(salida.slice(-1500)); srv.kill(); process.exit(1); });
