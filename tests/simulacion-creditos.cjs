// Créditos (Cuentas por pagar fase 5, 2026-11-13): alta con todos los datos, mensualidades iguales o con la corrida del
// banco (capital, intereses, IVA), abonos, reprogramar, saldo de capital, liquidar y quién puede.
// Uso: node tests/simulacion-creditos.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cred-')); const PUERTO = String(8500 + Math.floor(Math.random() * 200));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Cred-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const [AH, MH] = HOY.split('-').map(Number);
const mes = k => { const t = AH * 12 + MH - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

(async () => {
  console.log('1. Fechas y corrida pegada (cálculo puro)');
  const K = require('../server/creditos.js');
  revisa(K.fechaMensualidad('2026-01-31', 2) === '2026-02-28' && K.fechaMensualidad('2026-01-31', 3) === '2026-03-31' && K.fechaMensualidad('2025-11-15', 3) === '2026-01-15', 'mensualidades mes con mes: día 31 en febrero = 28, y cruza de año');
  const corrida = ['', 'MENSUALIDAD\tFECHA PAGO\tCAPITAL\tINTERESES\tIVA\tTOTAL A PAGAR', '\tTOTALES\t349470.69\t314158.10\t0\t663628.79',
    '5\t09/12/2025\t$37,589.75\t39,728.04\t0\t77,317.79', '6\t2026-01-09\t39218.32\t38099.47\t\t77317.79', '7\t09/02/2026\t\t\t\t77317.79'].join('\n');
  let l = K.leerCorrida(corrida);
  revisa(l.errores.length === 0 && l.filas.length === 3 && l.filas[0].num === 5 && l.filas[0].fecha === '2025-12-09' && l.filas[0].capital === 3758975 && l.filas[0].total === 7731779 && l.filas[2].capital === null,
    'lee la corrida pegada de Excel: brinca títulos y totales, acepta $ y comas, dd/mm/aaaa y AAAA-MM-DD, columnas vacías', l);
  l = K.leerCorrida('3\t31/02/2026\t1\t1\t0\t2\n4\t10/03/2026\tabc\t1\t0\t2\n5\t10/04/2026\t1\t1\t0\t\n5\t10/05/2026\t1\t1\t0\t2');
  revisa(l.errores.length >= 3, 'avisa fecha inválida, montos que no son número, falta de total y mensualidad repetida', l.errores);

  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Letty Cred', correo: 'letty.cred@saneadren.com.mx', password: 'Saneadren-Costos-Cred-26', rol: 'costos' });
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Cred', correo: 'ventas.cred@saneadren.com.mx', password: 'Saneadren-Ventas-Cred-26', rol: 'ventas' });
  const C = (await pedir('POST', '/login', null, { nombre: 'letty.cred@saneadren.com.mx', password: 'Saneadren-Costos-Cred-26' }))[1].token;
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.cred@saneadren.com.mx', password: 'Saneadren-Ventas-Cred-26' }))[1].token;
  const banco = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Banco de Prueba', categoria: 'creditos', dias_credito: 0 }))[1];
  let s, j;

  console.log('2. Alta con todos los datos');
  [s] = await pedir('GET', '/creditos', V); revisa(s === 403, 'ventas no ve los créditos');
  const base = { nombre: 'Crédito PyME Prueba', proveedor_id: banco.id, tipo: 'pyme_simple', numero: 'PRUEBA-77', fecha_contrato: mes(-3) + '-01', monto: '350,000', total_pagar: 432000, enganche: 0.5,
    apertura: 3500, comisiones: 1160, tasa_anual: '14.25%', plazo_meses: 6, mensualidad: 60000, fecha_primer_pago: mes(-1) + '-15', fecha_fin: mes(4) + '-15', cuenta_cargo: 'Cuenta de prueba', domiciliado: true, unidad: '', notas: 'Prueba' };
  [s] = await pedir('POST', '/creditos', V, base); revisa(s === 403, 'ventas no da de alta créditos');
  for (const [cambio, que] of [[{ nombre: '' }, 'sin nombre'], [{ proveedor_id: 99999 }, 'banco que no existe'], [{ tipo: 'inventado' }, 'tipo que no existe'], [{ monto: 0 }, 'monto 0'],
    [{ plazo_meses: 0 }, 'plazo 0'], [{ plazo_meses: 601 }, 'plazo de más de 600'], [{ tasa_anual: 'mucha' }, 'tasa que no es número'], [{ fecha_primer_pago: '2026-02-30' }, 'fecha inválida'],
    [{ fecha_fin: mes(-6) + '-01' }, 'fin antes de la primera mensualidad'], [{ pagadas_antes: 6 }, 'pagadas antes = plazo'], [{ mensualidad: -5 }, 'mensualidad negativa']]) {
    [s, j] = await pedir('POST', '/creditos', C, { ...base, ...cambio }); revisa(s === 400, 'no se acepta: ' + que, [s, j.error]);
  }
  [s, j] = await pedir('POST', '/creditos', C, base); const cr = j;
  revisa(s === 201 && cr.monto === 350000 && cr.tasa_anual === 14.25 && cr.total_pagar === 432000 && cr.apertura === 3500 && cr.enganche === 0.5 && cr.domiciliado === 1 && cr.categoria === 'creditos' && cr.resumen.por_programar === 6,
    'Compras da de alta el crédito con monto, tasa, total, apertura, comisiones, fechas y cuenta; faltan 6 por programar', [s, j.error || j]);
  [s, j] = await pedir('POST', '/creditos', C, { ...base, nombre: 'crédito pyme prueba ' }); revisa(s === 409, 'no se repite el nombre de un crédito vigente');

  console.log('3. Mensualidades iguales');
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', V, { modo: 'iguales', cuantas: 2 }); revisa(s === 403 || s === 404, 'ventas no programa mensualidades');
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'iguales', cuantas: 0 }); revisa(s === 400, '0 mensualidades no');
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'iguales', cuantas: 2 });
  revisa(s === 201 && j.programadas === 2 && j.desde === 1 && j.hasta === 2, 'programa las 2 primeras de $60,000', [s, j.error || j]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  const m1 = j.find(x => x.credito_id === cr.id && x.credito_num === 1), m2 = j.find(x => x.credito_id === cr.id && x.credito_num === 2);
  revisa(m1 && m1.total === 60000 && m1.fecha_documento === mes(-1) + '-15' && m1.fecha_vencimiento === m1.fecha_documento && m2.fecha_vencimiento === mes(0) + '-15' && m1.concepto === 'Mensualidad 1 de 6 · Crédito PyME Prueba'
    && m1.categoria === 'creditos' && m1.tipo_comprobante === 'estado_cuenta' && m1.proveedor_id === banco.id && /PRUEBA-77/.test(m1.notas) && /domiciliado a Cuenta de prueba/.test(m1.notas),
    'cada mensualidad es una cuenta por pagar normal: banco, concepto «Mensualidad 1 de 6», vence el día de cargo, estado de cuenta, notas con contrato y cuenta', m1);
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'iguales', cuantas: 10, monto: 61000 });
  revisa(s === 201 && j.programadas === 4 && j.desde === 3 && j.hasta === 6, 'pedir 10 más solo programa las 4 que faltan del plazo (3 a 6), con otro monto', [s, j.error || j]);
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'iguales', cuantas: 1 }); revisa(s === 409, 'ya no hay más que programar');

  console.log('4. Pagar, abono y reprogramar con la corrida del banco');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + m1.id + '/pagos', C, { monto: 60000, metodo: 'domiciliado', fecha: HOY, cuenta_origen: 'Cuenta de prueba' }); revisa(s === 201, 'la mensualidad 1 se paga en Cuentas por pagar como cualquier gasto', [s, j.error]);
  [s, j] = await pedir('GET', '/creditos/' + cr.id, C);
  revisa(j.credito.resumen.mensualidades_pagadas === 1 && j.credito.resumen.pagado === 60000 && j.credito.resumen.saldo_capital_estimado === true && j.cuentas[0].status === 'PAGADO',
    'la ficha cuenta 1 pagada; sin desglose de capital, el saldo de capital se marca estimado', j.credito?.resumen);
  // Abono extra: un gasto normal ligado al crédito; ya pagado.
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { proveedor_id: banco.id, categoria: 'creditos', concepto: 'Abono', total: 50000, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'estado_cuenta', credito_id: cr.id });
  revisa(s === 403, 'ventas no registra abonos');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { proveedor_id: banco.id, categoria: 'creditos', concepto: 'Abono a capital', total: 50000, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'estado_cuenta',
    credito_id: cr.id, ya_pagado: true, metodo: 'transferencia', fecha_pago: HOY, cuenta_origen: 'Cuenta de prueba' });
  revisa(s === 201, 'Compras registra un abono de $50,000 ya pagado', [s, j.error]);
  [s, j] = await pedir('GET', '/creditos/' + cr.id, C);
  const ab = j.cuentas.find(x => x.tipo === 'abono');
  revisa(ab && ab.capital === 50000 && ab.status === 'PAGADO' && j.credito.resumen.abonos === 50000 && j.credito.resumen.saldo_capital === 300000, 'el abono es todo capital: saldo de capital 350,000 − 50,000 = 300,000 (la mensualidad sin desglose no resta)', j.credito.resumen);
  // El banco bajó la mensualidad: se reprograma y se pega la corrida nueva.
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/reprogramar', C, { motivo: 'x' }); revisa(s === 400, 'reprogramar pide motivo');
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/reprogramar', C, { motivo: 'Abono a capital: el banco bajó la mensualidad' });
  revisa(s === 200 && j.canceladas === 5 && j.credito.resumen.mensualidades_programadas === 1 && j.credito.resumen.por_programar === 5, 'reprogramar cancela las 5 sin pago (la pagada se queda)', [s, j.error || j.credito?.resumen]);
  const f = k => mes(k) + '-15', fd = k => f(k).split('-').reverse().join('/');
  const nueva = ['MENSUALIDAD\tFECHA\tCAPITAL\tINTERESES\tIVA\tTOTAL', `2\t${fd(0)}\t48000\t3500\t560\t52060`, `3\t${fd(1)}\t48600\t2900\t464\t51964`, `9\t${fd(7)}\t1\t1\t0\t2`].join('\n');
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'corrida', corrida: nueva }); revisa(s === 400 && /plazo/.test(j.error), 'una corrida con mensualidad mayor al plazo no se acepta', [s, j.error]);
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'corrida', corrida: 'hola\nesto no es una corrida' }); revisa(s === 400, 'texto sin renglones de corrida no se acepta');
  const buena = ['MENSUALIDAD\tFECHA\tCAPITAL\tINTERESES\tIVA\tTOTAL', `1\t${fd(-1)}\t58000\t1700\t300\t60000`, `2\t${fd(0)}\t48000\t3500\t560\t52060`, `3\t${fd(1)}\t48600\t2900\t464\t51964`].join('\n');
  [s, j] = await pedir('POST', '/creditos/' + cr.id + '/programar', C, { modo: 'corrida', corrida: buena });
  revisa(s === 201 && j.programadas === 2 && j.desde === 2 && j.hasta === 3, 'pega la corrida nueva: brinca la 1 (ya pagada) y programa la 2 y la 3 con sus montos', [s, j.error || j]);
  [s, j] = await pedir('GET', '/creditos/' + cr.id, C);
  const c2 = j.cuentas.find(x => x.num === 2);
  revisa(c2 && c2.total === 52060 && c2.capital === 48000 && c2.interes === 3500 && c2.iva === 560 && c2.fecha === f(0), 'cada mensualidad de la corrida guarda capital, intereses, IVA y total', c2);
  const cxp2 = (await pedir('GET', '/finanzas/cxp?vista=todas', C))[1].find(x => x.credito_id === cr.id && x.credito_num === 2 && !x.cancelada);
  await pedir('POST', '/finanzas/cxp/' + cxp2.id + '/pagos', C, { monto: 52060, metodo: 'domiciliado', fecha: HOY, cuenta_origen: 'Cuenta de prueba' });
  [s, j] = await pedir('GET', '/creditos/' + cr.id, C);
  revisa(j.credito.resumen.saldo_capital === 252000 && j.credito.resumen.mensualidades_pagadas === 2, 'pagada la 2: el saldo de capital baja su capital (300,000 − 48,000 = 252,000)', j.credito.resumen);

  console.log('5. Saldo inicial, pagadas antes, editar y liquidar');
  [s, j] = await pedir('POST', '/creditos', C, { ...base, nombre: 'Camioneta (prueba)', tipo: 'automotriz', plazo_meses: 60, pagadas_antes: 20, saldo_inicial: 1000000, unidad: 'Camioneta de prueba', factura_unidad: 'F-1' });
  const auto = j; revisa(s === 201 && auto.resumen.por_programar === 40 && auto.resumen.mensualidades_pagadas === 20 && auto.resumen.saldo_capital === 1000000, 'automotriz con 20 pagadas antes del sistema: faltan 40, saldo de capital = el inicial', auto.resumen);
  [s, j] = await pedir('POST', '/creditos/' + auto.id + '/programar', C, { modo: 'iguales', cuantas: 12 });
  revisa(s === 201 && j.desde === 21 && j.hasta === 32, 'programa 12 a partir de la 21', [s, j.error || j]);
  [s, j] = await pedir('PUT', '/creditos/' + auto.id, C, { plazo_meses: 30 }); revisa(s === 409, 'no se puede bajar el plazo por debajo de las ya programadas');
  [s, j] = await pedir('PUT', '/creditos/' + auto.id, C, { tasa_anual: 13.9, cuenta_cargo: 'Otra cuenta' });
  revisa(s === 200 && j.tasa_anual === 13.9 && j.cuenta_cargo === 'Otra cuenta' && j.monto === 350000 && j.pagadas_antes === 20, 'editar cambia lo que se manda y deja lo demás', [s, j.error]);
  [s, j] = await pedir('POST', '/creditos/' + auto.id + '/estado', C, { estado: 'liquidado', motivo: 'Se pagó todo' }); revisa(s === 409, 'no se marca liquidado si tiene mensualidades por pagar');
  [s, j] = await pedir('POST', '/creditos/' + auto.id + '/estado', C, { estado: 'cancelado', motivo: 'Capturado por error' }); revisa(s === 409, 'con mensualidades no se cancela (se liquida)');
  await pedir('POST', '/creditos/' + auto.id + '/reprogramar', C, { motivo: 'Se liquidó por anticipado' });
  [s, j] = await pedir('POST', '/creditos/' + auto.id + '/estado', C, { estado: 'liquidado', motivo: 'x' }); revisa(s === 400, 'liquidar pide motivo');
  [s, j] = await pedir('POST', '/creditos/' + auto.id + '/estado', C, { estado: 'liquidado', motivo: 'Se liquidó por anticipado' }); revisa(s === 200 && j.credito.estado === 'liquidado', 'sin nada por pagar, se marca liquidado');
  [s, j] = await pedir('POST', '/creditos/' + auto.id + '/programar', C, { modo: 'iguales', cuantas: 1 }); revisa(s === 409, 'a un crédito liquidado ya no se le programan mensualidades');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { proveedor_id: banco.id, categoria: 'creditos', concepto: 'Abono', total: 10, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'estado_cuenta', credito_id: auto.id });
  revisa(s === 409, 'ni abonos');
  [s, j] = await pedir('POST', '/creditos', C, { ...base, nombre: 'Capturado mal' }); const mal = j;
  [s, j] = await pedir('POST', '/creditos/' + mal.id + '/estado', C, { estado: 'cancelado', motivo: 'Capturado por error' }); revisa(s === 200, 'un crédito sin movimientos se cancela');
  [s, j] = await pedir('GET', '/creditos', C);
  revisa(j.creditos.length === 3 && j.creditos[0].estado === 'vigente' && j.tipos.automotriz, 'la lista trae los 3 (vigentes primero) y los tipos');
  [s, j] = await pedir('GET', '/auditoria?entidad=credito&id=' + cr.id, A);
  const hist = (Array.isArray(j) ? j : []).map(x => x.accion);
  revisa(['creado', 'mensualidades programadas', 'reprogramado'].every(a => hist.includes(a)), 'el historial guarda alta, programar y reprogramar', hist);
  [s, j] = await pedir('GET', '/finanzas/cxp/formato-excel', A);
  revisa(j.cuentas.some(x => /Mensualidad 3 de 6/.test(x.concepto)), 'las mensualidades salen en la descarga «CXP» como cualquier cuenta');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', m.map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
