// Gastos programados (Cuentas por pagar fase 4, 2026-11-13): luz, renta… con los meses en que llegan; avisan cuando toca,
// se registran desde el aviso (el mes queda ligado a su cuenta por pagar) o se marcan «no llegó».
// Uso: node tests/simulacion-gastos-programados.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gprog-')); const PUERTO = String(8300 + Math.floor(Math.random() * 200));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'GProg-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const [AH, MH, DH] = HOY.split('-').map(Number);
const per = k => { const t = AH * 12 + MH - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const mesDe = k => Number(per(k).slice(5));

(async () => {
  console.log('1. Cuándo avisa (cálculo puro)');
  const G = require('../server/gastos-programados.js');
  revisa(G.fechaDe('2026-04', 31) === '2026-04-30' && G.fechaDe('2027-02', 30) === '2027-02-28' && G.fechaDe('2028-02', 30) === '2028-02-29' && G.fechaDe('2026-11', 10) === '2026-11-10', 'día 31 en un mes corto = el último día del mes (abril 30, febrero 28/29)');
  const base = { meses: '1,3,5,7,9,11', dia: 10, aviso_dias: 5, desde: '2026-01-01' };
  revisa(JSON.stringify(G.periodosPorAvisar(base, '2026-03-04').map(x => x.periodo)) === '["2026-01"]', 'bimestral día 10, avisa 5 días antes: el 4 de marzo todavía no toca marzo (solo el pendiente de enero)');
  revisa(JSON.stringify(G.periodosPorAvisar(base, '2026-03-05').map(x => x.periodo)) === '["2026-01","2026-03"]', 'el 5 de marzo ya toca marzo');
  revisa(G.periodosPorAvisar({ ...base, desde: '2026-03-01' }, '2026-03-20').map(x => x.periodo).join() === '2026-03', '«avisar a partir de»: no avisa de meses anteriores');
  revisa(G.periodosPorAvisar({ ...base, meses: '12', dia: 1, desde: '2025-01-01' }, '2026-11-28').map(x => x.periodo).join() === '2025-12,2026-12', 'el día 1 de diciembre avisa desde finales de noviembre (cruza de año) y uno sin atender sigue hasta un año');
  revisa(G.periodosPorAvisar({ ...base, meses: '1,2,3,4,5,6,7,8,9,10,11,12', desde: '2020-01-01' }, '2026-11-13').length === 13, 'un aviso sin atender se muestra hasta 12 meses atrás (no infinitos)');

  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Letty Pagos', correo: 'letty.gp@saneadren.com.mx', password: 'Saneadren-Costos-GP-26', rol: 'costos' });
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas GP', correo: 'ventas.gp@saneadren.com.mx', password: 'Saneadren-Ventas-GP-26', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Tito GP', correo: 'tito.gp@saneadren.com.mx', password: 'Saneadren-Tecnico-GP-26', rol: 'tecnico' });
  const C = (await pedir('POST', '/login', null, { nombre: 'letty.gp@saneadren.com.mx', password: 'Saneadren-Costos-GP-26' }))[1].token;
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.gp@saneadren.com.mx', password: 'Saneadren-Ventas-GP-26' }))[1].token;
  const T = (await pedir('POST', '/login', null, { nombre: 'tito.gp@saneadren.com.mx', password: 'Saneadren-Tecnico-GP-26' }))[1].token;
  const cfe = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'CFE', categoria: 'servicios_oficina', dias_credito: 0 }))[1];
  const casero = (await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Inmobiliaria Arcos', categoria: 'renta_inmuebles', dias_credito: 0 }))[1];
  let s, j;

  console.log('2. Quién los maneja');
  for (const [tok, quien] of [[V, 'ventas'], [T, 'técnico']]) {
    [s] = await pedir('GET', '/gastos-programados', tok); revisa(s === 403, quien + ' no ve los gastos programados', s);
    [s] = await pedir('POST', '/gastos-programados', tok, { nombre: 'Luz', proveedor_id: cfe.id, categoria: 'otro', meses: [1], dia: 1 }); revisa(s === 403, quien + ' no los da de alta', s);
    [s, j] = await pedir('GET', '/gastos-programados/avisos', tok); revisa(s === 200 && j.avisos.length === 0, quien + ': Inicio no le muestra avisos de gastos programados');
  }

  console.log('3. Alta con sus datos revisados');
  const luz = { nombre: 'Luz Cancún', proveedor_id: cfe.id, categoria: 'servicios_oficina', meses: [mesDe(0), mesDe(2), mesDe(4)], dia: Math.min(28, DH + 3), aviso_dias: 5, tipo_gasto: 'bimestral', tipo_comprobante: 'recibo' };
  for (const [cambio, que] of [[{ nombre: '' }, 'sin nombre'], [{ meses: [] }, 'sin meses'], [{ meses: [13] }, 'mes 13'], [{ dia: 32 }, 'día 32'], [{ dia: 0 }, 'día 0'], [{ aviso_dias: 31 }, 'aviso de 31 días'],
    [{ tipo_gasto: 'diario' }, 'tipo de gasto que no existe'], [{ monto: 0 }, 'monto fijo 0'], [{ proveedor_id: 999999 }, 'proveedor que no existe'], [{ tipo_comprobante: 'inventado' }, 'comprobante que no existe'], [{ categoria: 'no_existe' }, 'categoría que no existe']]) {
    [s, j] = await pedir('POST', '/gastos-programados', C, { ...luz, ...cambio }); revisa(s === 400, 'no se acepta: ' + que, [s, j.error]);
  }
  [s, j] = await pedir('POST', '/gastos-programados', C, luz); const L = j;
  revisa(s === 201 && L.nombre === 'Luz Cancún' && L.meses.length === 3 && L.tipo_gasto_nombre === 'Bimestral' && L.monto === null && L.desde === HOY.slice(0, 8) + '01', 'Compras da de alta «Luz Cancún» (bimestral, sin monto fijo, avisa desde este mes)', [s, j.error || j]);
  [s, j] = await pedir('POST', '/gastos-programados', A, { ...luz, nombre: '  luz cancún ' }); revisa(s === 409, 'no se repite el nombre de uno activo (sin importar mayúsculas)');
  [s, j] = await pedir('POST', '/gastos-programados', A, { ...luz, nombre: 'Luz casa de Miguel', meses: [mesDe(1)], dia: 28, aviso_dias: 0 }); const M = j;
  revisa(s === 201, '«Luz casa de Miguel» (llega el mes que entra)');
  [s, j] = await pedir('POST', '/gastos-programados', A, { nombre: 'Renta bodega', proveedor_id: casero.id, categoria: 'renta_inmuebles', meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], dia: 1, aviso_dias: 0, monto: '12,000.50', tipo_gasto: 'mensual', tipo_comprobante: 'recibo', desde: per(-2) + '-01' });
  const R = j; revisa(s === 201 && R.monto === 12000.5, 'renta mensual con monto fijo de $12,000.50 desde hace dos meses', [s, j.error || j.monto]);

  console.log('4. Lo que falta registrar');
  [s, j] = await pedir('GET', '/gastos-programados', C);
  const pend = j.pendientes || [];
  const pl = pend.filter(x => x.programado_id === L.id), pm = pend.filter(x => x.programado_id === M.id), pr = pend.filter(x => x.programado_id === R.id);
  revisa(pl.length === 1 && pl[0].periodo === per(0), 'la luz de este mes ya toca (llega en 3 días o menos y avisa 5 antes)', pl);
  revisa(pm.length === 0, 'la luz de Miguel del mes que entra todavía no avisa', pm);
  revisa(pr.map(x => x.periodo).join() === [per(-2), per(-1), per(0)].join() && pr[0].monto === 12000.5 && pr[0].vencido, 'la renta: faltan los 3 meses (desde que se dio de alta), con su monto fijo y marcados vencidos', pr);
  [s, j] = await pedir('GET', '/gastos-programados/avisos', C);
  revisa(s === 200 && j.avisos.length === 4 && j.avisos.some(a => /Falta registrar Luz Cancún · /.test(a.texto)) && j.avisos.filter(a => a.urgente).length >= 2, 'Inicio de Compras: 4 avisos «Falta registrar…» (los vencidos, urgentes)', j.avisos);

  console.log('5. Registrar desde el aviso');
  const gastoLuz = { proveedor_id: cfe.id, categoria: 'servicios_oficina', concepto: 'Luz Cancún ' + per(0), total: 1635.48, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'recibo', tipo_gasto: 'bimestral' };
  [s, j] = await pedir('POST', '/finanzas/cxp', V, { ...gastoLuz, programado_id: L.id, programado_periodo: per(0) }); revisa(s === 403, 'ventas no registra un gasto programado', s);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...gastoLuz, programado_id: L.id, programado_periodo: per(1) }); revisa(s === 400, 'un mes que no le toca no se registra', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...gastoLuz, programado_id: L.id, programado_periodo: per(0) }); const cxLuz = j;
  revisa(s === 201, 'Compras registra la luz de este mes con el total del recibo', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...gastoLuz, concepto: 'Otra', programado_id: L.id, programado_periodo: per(0), forzar: true }); revisa(s === 409 && /ya está registrado/.test(j.error), 'el mismo mes no se registra dos veces', [s, j.error]);
  [s, j] = await pedir('GET', '/gastos-programados', C);
  let Ld = j.programados.find(p => p.id === L.id);
  revisa(!j.pendientes.some(x => x.programado_id === L.id) && Ld.ultimo?.periodo === per(0) && Ld.ultimo.monto === 1635.48, 'ya no aparece por registrar y muestra el último monto registrado', Ld.ultimo);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', C);
  revisa(j.find(x => x.id === cxLuz.id)?.total === 1635.48, 'la cuenta por pagar queda en la lista normal de Cuentas por pagar');
  // Si la cuenta se cancela, el mes vuelve a quedar pendiente; se puede registrar otra vez.
  await pedir('POST', '/finanzas/cxp/' + cxLuz.id + '/cancelar', A, { motivo: 'Capturé mal el recibo' });
  [s, j] = await pedir('GET', '/gastos-programados', C); revisa(j.pendientes.some(x => x.programado_id === L.id && x.periodo === per(0)), 'si la cuenta por pagar se cancela, el mes vuelve a quedar por registrar');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { ...gastoLuz, total: 1653.48, programado_id: L.id, programado_periodo: per(0), forzar: true }); revisa(s === 201, 'y se registra de nuevo', [s, j.error]);

  console.log('6. «No llegó» y reabrir');
  [s, j] = await pedir('POST', '/gastos-programados/' + R.id + '/omitir', C, { periodo: per(-2), motivo: 'x' }); revisa(s === 400, 'sin motivo no se marca «no llegó»');
  [s, j] = await pedir('POST', '/gastos-programados/' + L.id + '/omitir', C, { periodo: per(1), motivo: 'No llegó el recibo' }); revisa(s === 400, 'un mes que no le toca no se marca');
  [s, j] = await pedir('POST', '/gastos-programados/' + R.id + '/omitir', V, { periodo: per(-2), motivo: 'No llegó el recibo' }); revisa(s === 403 || s === 404, 'ventas no marca «no llegó»');
  [s, j] = await pedir('POST', '/gastos-programados/' + R.id + '/omitir', C, { periodo: per(-2), motivo: 'Se pagó junto con el mes siguiente' }); revisa(s === 200, 'Compras marca la renta de hace dos meses como «no llegó» con su motivo', [s, j.error]);
  [s, j] = await pedir('POST', '/gastos-programados/' + R.id + '/omitir', C, { periodo: per(-2), motivo: 'Otra vez' }); revisa(s === 409, 'no se marca dos veces');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { proveedor_id: casero.id, categoria: 'renta_inmuebles', concepto: 'Renta', total: 12000.5, fecha_documento: per(-2) + '-01', dias_credito: 0, tipo_comprobante: 'recibo', programado_id: R.id, programado_periodo: per(-2) });
  revisa(s === 409 && /no llegó/.test(j.error), 'un mes marcado «no llegó» no se registra sin reabrirlo', [s, j.error]);
  [s, j] = await pedir('GET', '/gastos-programados', C); revisa(j.pendientes.filter(x => x.programado_id === R.id).map(x => x.periodo).join() === [per(-1), per(0)].join(), 'la renta ya solo tiene pendientes el mes pasado y este');
  [s, j] = await pedir('POST', '/gastos-programados/' + R.id + '/reabrir', C, { periodo: per(-1) }); revisa(s === 400, 'solo se reabre un mes marcado «no llegó»');
  [s, j] = await pedir('POST', '/gastos-programados/' + R.id + '/reabrir', C, { periodo: per(-2) }); revisa(s === 200, 'reabrir el mes «no llegó»');
  [s, j] = await pedir('GET', '/gastos-programados', C); revisa(j.pendientes.some(x => x.programado_id === R.id && x.periodo === per(-2)), 'reabierto vuelve a aparecer por registrar');
  [s, j] = await pedir('POST', '/finanzas/cxp', C, { proveedor_id: casero.id, categoria: 'renta_inmuebles', concepto: 'Renta', total: 12000.5, fecha_documento: per(-2) + '-01', dias_credito: 0, tipo_comprobante: 'recibo', programado_id: R.id, programado_periodo: per(-2) });
  revisa(s === 201, 'y ya se registra', [s, j.error]);

  console.log('7. Editar, desactivar y el historial');
  [s, j] = await pedir('PUT', '/gastos-programados/' + M.id, C, { meses: [mesDe(0)], dia: Math.min(28, DH + 2), aviso_dias: 5, monto: 980 });
  revisa(s === 200 && j.meses.join() === String(mesDe(0)) && j.monto === 980 && j.nombre === 'Luz casa de Miguel' && j.proveedor_id === cfe.id, 'editar cambia meses, día y monto; lo demás se queda igual', [s, j.error || j]);
  revisa(j.pendientes.length === 1 && j.pendientes[0].monto === 980, 'con los meses nuevos ya toca este mes, con su monto');
  [s, j] = await pedir('PUT', '/gastos-programados/' + M.id, C, { nombre: 'Luz Cancún' }); revisa(s === 409, 'al editar tampoco se repite el nombre');
  [s, j] = await pedir('PUT', '/gastos-programados/' + M.id, C, { meses: [] }); revisa(s === 400, 'al editar se revisa igual (sin meses no)');
  [s, j] = await pedir('POST', '/gastos-programados/' + M.id + '/activo', C, { activo: false }); revisa(s === 200 && j.activo === 0, 'desactivar');
  [s, j] = await pedir('GET', '/gastos-programados/avisos', C); revisa(!j.avisos.some(a => a.programado_id === M.id), 'desactivado ya no avisa');
  [s, j] = await pedir('POST', '/gastos-programados', C, { ...luz, nombre: 'Luz casa de Miguel' }); const M2 = j; revisa(s === 201, 'con el viejo desactivado, el nombre se puede volver a usar');
  [s, j] = await pedir('POST', '/gastos-programados/' + M.id + '/activo', C, { activo: true }); revisa(s === 409, 'y entonces el viejo no se reactiva con el mismo nombre');
  await pedir('POST', '/gastos-programados/' + M2.id + '/activo', C, { activo: false });
  [s, j] = await pedir('POST', '/gastos-programados/' + M.id + '/activo', C, { activo: true }); revisa(s === 200 && j.activo === 1, 'desactivando el nuevo, el viejo se reactiva');
  [s, j] = await pedir('GET', '/auditoria?entidad=gasto_programado&id=' + M.id, A);
  const hist = (Array.isArray(j) ? j : []).map(f => f.accion);
  revisa(['creado', 'editado', 'desactivado', 'activado'].every(a => hist.includes(a)), 'el historial guarda alta, edición, desactivar y activar', hist);
  [s, j] = await pedir('PUT', '/gastos-programados/999999', C, { dia: 3 }); revisa(s === 404, 'uno que no existe: 404');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', m.map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
