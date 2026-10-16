// Ficha del proveedor: cuadra con «Por pagar» para cada proveedor (debe, vencido, pagado, comprado), muestra
// pagos cancelados sin sumarlos, sus órdenes de compra y cotizaciones (cuál ganó) y los cambios a sus datos.
// Usa los datos de ejemplo del modo demo (muchos casos reales a la vez) en una base temporal.
// Uso: node tests/simulacion-ficha-proveedor.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-fprov-')); const PUERTO = String(8500 + Math.floor(Math.random() * 300));
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '1', PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: 'marketing@saneadren.com.mx', ADMIN_PASSWORD: 'Ficha-Prov-' + Math.random().toString(36).slice(2) + '-9', SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const c = x => Math.round(x * 100);
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  let s, j;
  for (let i = 0; i < 400; i++) { [s, j] = await pedir('GET', '/demo/estado'); if (j.listo || j.error) break; await espera(250); }
  const entrar = async rol => (await pedir('POST', '/demo/entrar', null, { rol }))[1].token;
  const A = await entrar('admin'), V = await entrar('ventas'), C = await entrar('costos');

  console.log('1. La ficha cuadra con «Por pagar» para cada proveedor');
  const [, provs] = await pedir('GET', '/finanzas/proveedores', A);
  const [, todas] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const descuadres = [];
  for (const p of provs) {
    const [, f] = await pedir('GET', '/finanzas/proveedores/' + p.id + '/estado-cuenta', A);
    const mias = todas.filter(x => x.proveedor_id === p.id);
    const debe = mias.reduce((t, x) => t + c(x.saldo), 0), venc = mias.filter(x => x.vencida).reduce((t, x) => t + c(x.saldo), 0);
    const pagado = mias.reduce((t, x) => t + c(x.pagado), 0), comprado = mias.reduce((t, x) => t + c(x.total), 0);
    const pagosVivos = f.pagos.filter(g => !g.cancelado).reduce((t, g) => t + c(g.monto), 0);
    if (c(f.debe) !== debe || c(f.vencido) !== venc || c(f.pagado) !== pagado || c(f.comprado) !== comprado || pagosVivos !== pagado || f.cuentas.length !== mias.length || c(p.saldo) !== debe)
      descuadres.push({ p: p.nombre, ficha: [f.debe, f.vencido, f.pagado, f.comprado, f.cuentas.length], lista: [debe / 100, venc / 100, pagado / 100, comprado / 100, mias.length], catalogo: p.saldo });
  }
  revisa(provs.length >= 13 && !descuadres.length, `los ${provs.length} proveedores: le debemos, vencido, pagado, comprado y número de facturas igual que en Por pagar y en el catálogo`, descuadres);

  console.log('2. Proveedor de pipas (Symrise)');
  const pipas = provs.find(p => p.nombre === 'Pipas Hermanos Ramírez');
  [s, j] = await pedir('GET', '/finanzas/proveedores/' + pipas.id + '/estado-cuenta', V);
  revisa(s === 200 && j.proveedor.clabe === '014680655039528945' && j.proveedor.banco === 'Santander', 'trae banco y CLABE para pagar (y todos la pueden consultar)', [s, j.proveedor?.clabe]);
  revisa(j.cuentas.every(x => x.orden_folio && /^OS-/.test(x.orden_folio)), 'cada renta de pipa dice de qué orden de servicio viene');
  revisa(j.cuentas.every((x, i, a) => i === 0 || a[i - 1].fecha_documento >= x.fecha_documento), 'las facturas van de la más nueva a la más vieja');
  const semana = new Date(Date.parse(HOY + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  const esperado = j.cuentas.filter(x => x.saldo > 0 && !x.vencida && x.fecha_vencimiento <= semana).reduce((t, x) => t + c(x.saldo), 0);
  revisa(c(j.esta_semana) === esperado, '«vence en 7 días» suma solo lo no vencido que vence en la semana', [j.esta_semana, esperado / 100]);

  console.log('3. Pago cancelado: se ve, pero no cuenta');
  const conSaldo = j.cuentas.find(x => x.saldo > 0);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + conSaldo.id + '/pagos', C, { monto: 1000, metodo: 'transferencia', fecha: HOY, referencia: 'PRUEBA-FICHA', cuenta_origen: 'Santander empresa' });
  const pagoId = j.id; revisa(s === 201, 'se registra un pago de $1,000', [s, j.error]);
  [, j] = await pedir('GET', '/finanzas/proveedores/' + pipas.id + '/estado-cuenta', A);
  const g = j.pagos.find(x => x.referencia === 'PRUEBA-FICHA');
  revisa(g && g.cuenta_origen === 'Santander empresa' && g.registrado_por_nombre === 'Isaac Compras (demo)' && g.concepto === conSaldo.concepto, 'el pago aparece con cuenta de salida, quién lo registró y qué se pagó', g);
  const debeAntes = j.debe;
  [s] = await pedir('POST', '/finanzas/pagos-proveedor/' + (pagoId || g.id) + '/cancelar', C, { motivo: 'Prueba de la ficha' });
  [, j] = await pedir('GET', '/finanzas/proveedores/' + pipas.id + '/estado-cuenta', A);
  const g2 = j.pagos.find(x => x.referencia === 'PRUEBA-FICHA');
  revisa(s === 200 && g2?.cancelado === true && g2.motivo_cancelacion === 'Prueba de la ficha', 'al cancelarlo sigue en la lista marcado «Cancelado» con su motivo', [s, g2]);
  revisa(c(j.debe) === c(debeAntes) + 100000, 'y la deuda vuelve a subir los $1,000', [debeAntes, j.debe]);

  console.log('4. Compras: órdenes y cotizaciones');
  const bajio = provs.find(p => p.nombre === 'Llantas del Bajío'), llantera = provs.find(p => p.nombre === 'Llantera Querétaro');
  [, j] = await pedir('GET', '/finanzas/proveedores/' + bajio.id + '/estado-cuenta', A);
  revisa(j.ordenes.length === 1 && j.ordenes[0].recibida && /^SOL-/.test(j.ordenes[0].solicitud_folio) && j.ordenes[0].total === 15800, 'Llantas del Bajío: su orden de compra, de qué solicitud viene y que ya se recibió', j.ordenes);
  revisa(j.cotizaciones.length === 1 && j.cotizaciones[0].gano === true, 'su cotización aparece como ganadora', j.cotizaciones);
  [, j] = await pedir('GET', '/finanzas/proveedores/' + llantera.id + '/estado-cuenta', A);
  revisa(j.cotizaciones.length === 2 && j.cotizaciones.some(x => x.decidida && !x.gano) && j.cotizaciones.some(x => !x.decidida), 'Llantera Querétaro: una cotización que no se eligió y otra todavía en revisión', j.cotizaciones);
  revisa(c(j.debe) === 0 && j.cuentas.length === 0 && j.ordenes.length === 0, 'un proveedor que solo ha cotizado no debe nada ni tiene órdenes');

  console.log('5. Historial de cambios a sus datos');
  [s] = await pedir('PUT', '/finanzas/proveedores/' + llantera.id, C, { telefono: '442 123 4567', dias_credito: 30 });
  [, j] = await pedir('GET', '/finanzas/proveedores/' + llantera.id + '/estado-cuenta', A);
  revisa(s === 200 && j.historial[0]?.accion === 'editado' && /442 123 4567/.test(j.historial[0].detalle) && j.historial[0].usuario === 'Isaac Compras (demo)' && j.historial.some(h => h.accion === 'creado'),
    'se ve quién cambió qué (teléfono y crédito) y cuándo se dio de alta', j.historial);
  revisa(j.proveedor.dias_credito === 30, 'y la ficha ya muestra el crédito nuevo');

  console.log('6. Casos raros');
  [s] = await pedir('GET', '/finanzas/proveedores/999999/estado-cuenta', A); revisa(s === 404, 'un proveedor que no existe → 404');
  [s] = await pedir('GET', '/finanzas/proveedores/abc/estado-cuenta', A); revisa(s === 404, 'un id que no es número → 404');
  [s] = await pedir('GET', '/finanzas/proveedores/' + pipas.id + '/estado-cuenta'); revisa(s === 401, 'sin sesión no se ve');
  { const [si, ri] = await pedir('GET', '/admin/integridad', A); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores', (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total).map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
