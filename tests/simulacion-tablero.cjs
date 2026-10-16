// Panorama general (Resultados): con datos conocidos, cada número debe cuadrar exacto.
// Uso: node tests/simulacion-tablero.cjs   (base temporal; no toca saneadren.db)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tablero-')); const PUERTO = String(4700 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Tablero-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 't.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const sumarDias = (f, d) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Tab', correo: 'vt@saneadren.com.mx', password: 'Ventas-Tab-2026', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'vt@saneadren.com.mx', password: 'Ventas-Tab-2026' }))[1].token;
  const servicios = (await pedir('GET', '/servicios', A))[1], canales = (await pedir('GET', '/canales', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  const P = (...p) => JSON.stringify(p);
  const partida = (precio, sv = 0) => ({ servicio: servicios[sv].nombre, leyenda: 'x', importe: precio });
  let s, j;
  // Periodo de prueba: los últimos 10 días (hoy incluido); el anterior, los 10 días previos.
  const desde = sumarDias(HOY, -9), dAnt = sumarDias(HOY, -15);
  const c1 = (await pedir('POST', '/contactos', A, { nombre: 'Planta Uno', telefono: '4421110001', direccion: 'x', canal_origen_id: canales[0].id, empresa_contacto: 'Planta Uno SA' }))[1].id;
  const c2 = (await pedir('POST', '/contactos', A, { nombre: 'Hotel Dos', telefono: '4421110002', direccion: 'x', canal_origen_id: canales[1]?.id || canales[0].id }))[1].id;
  const orden = async (cli, cuerpo) => (await pedir('POST', '/leads', A, { cliente_id: cli, direccion: 'x', responsable_id: yo, forzar_duplicado: true, estatus: 'ganado', iva_modo: 'mas_iva', ...cuerpo }))[1];
  const realizar = (id, fecha, extra = {}) => pedir('POST', '/leads/' + id + '/ejecucion', A, { estado: 'realizado', fecha, realizado_por: 'propio', ...extra });
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Tercero SA', categoria: 'subcontratacion', dias_credito: 0 });
  // Periodo actual: 2 servicios realizados de Planta Uno ($10,000 y $5,000) y 1 de Hotel Dos ($2,000, subcontratado con costo $1,200).
  const o1 = await orden(c1, { partidas_json: P(partida(10000)), fecha_servicio: sumarDias(HOY, -5), equipo: 'E-1', operador: 'Ana' }); await realizar(o1.id, sumarDias(HOY, -5));
  const o2 = await orden(c1, { partidas_json: P(partida(3000), partida(2000, 1)), fecha_servicio: sumarDias(HOY, -3), equipo: 'E-1', operador: 'Beto' }); await realizar(o2.id, sumarDias(HOY, -3));
  const o3 = await orden(c2, { partidas_json: P(partida(2000)), fecha_servicio: sumarDias(HOY, -2), iva_modo: 'sin_iva', equipo: 'E-2' });
  await realizar(o3.id, sumarDias(HOY, -2), { realizado_por: 'subcontratado', gastos: [{ proveedor_id: prov.id, concepto: 'Pipa', total: 1200, ya_pagado: true, metodo: 'transferencia', fecha_pago: sumarDias(HOY, -1) }] });
  // Gasto general del periodo (sin orden): $800, pendiente
  await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diesel', total: 800, fecha_documento: sumarDias(HOY, -4), dias_credito: 7 });
  // Cobros del periodo: $11,600 (o1 completo con IVA) y un descuento de $100 que no cuenta como cobrado
  await pedir('POST', '/leads/' + o1.id + '/cobros', A, { monto: 11600, metodo: 'transferencia', fecha: sumarDias(HOY, -1) });
  await pedir('POST', '/leads/' + o2.id + '/cobros', A, { monto: 100, metodo: 'otro', tipo: 'ajuste', fecha: sumarDias(HOY, -1) });
  // Periodo anterior: 1 servicio de Planta Uno de $4,000 (así Planta Uno es recurrente y Hotel Dos nuevo)
  const o0 = await orden(c1, { partidas_json: P(partida(4000)), fecha_servicio: sumarDias(HOY, -12) }); await realizar(o0.id, sumarDias(HOY, -12));
  // Pendientes: servicio sin marcar con fecha pasada, cotización abierta que vence en 3 días, servicio vencido +30 días
  await orden(c2, { partidas_json: P(partida(700)), fecha_servicio: sumarDias(HOY, -1) });
  const cot = (await pedir('POST', '/leads', A, { cliente_id: c2, direccion: 'x', responsable_id: yo, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: P(partida(9000)), incluye_vigencia: true, vigencia_hasta: sumarDias(HOY, 3) }))[1];
  const c3 = (await pedir('POST', '/contactos', A, { nombre: 'Taller Tres', telefono: '4421110003', direccion: 'x', canal_origen_id: canales[0].id }))[1].id;
  const viejo = await orden(c3, { partidas_json: P(partida(1000)), fecha_servicio: sumarDias(HOY, -60), iva_modo: 'sin_iva' }); await realizar(viejo.id, sumarDias(HOY, -60));

  [s, j] = await pedir('GET', `/tablero?desde=${desde}&hasta=${HOY}`, V);
  revisa(s === 403, 'el panorama general es solo para administración', s);
  [s, j] = await pedir('GET', `/tablero?desde=${HOY}&hasta=${desde}`, A); revisa(s === 400, 'rango invertido se rechaza');
  [s, j] = await pedir('GET', `/tablero?desde=${desde}&hasta=${HOY}`, A);
  revisa(s === 200, 'el panorama responde', [s, j.error]);
  const a = j.actual, p = j.previo;
  revisa(j.anterior.desde === sumarDias(HOY, -19) && j.anterior.hasta === sumarDias(HOY, -10), 'el periodo anterior tiene la misma duración (10 días antes)', j.anterior);
  revisa(a.venta === 17000 && a.servicios === 3 && a.ticket === 5666.67, 'ventas realizadas: $17,000 sin IVA en 3 servicios (ticket $5,666.67)', [a.venta, a.servicios, a.ticket]);
  revisa(a.venta_con_iva === 19400, 'ventas con IVA: $11,600 + $5,800 + $2,000 = $19,400', a.venta_con_iva);
  revisa(a.costo_directo === 1200 && a.margen_directo === 15800, 'costo directo de terceros $1,200; margen directo $15,800', [a.costo_directo, a.margen_directo]);
  revisa(a.gasto === 2000 && a.utilidad === 15000 && a.margen_pct === 88.2, 'gastos del periodo $2,000; utilidad estimada $15,000 (88.2 %)', [a.gasto, a.utilidad, a.margen_pct]);
  revisa(a.cobrado === 11600 && a.descuentos === 100 && a.pagado === 1200 && a.flujo === 10400, 'flujo: cobrado $11,600 − pagado $1,200 = $10,400 (el descuento no es cobro)', [a.cobrado, a.descuentos, a.pagado, a.flujo]);
  revisa(a.clientes_activos === 2 && a.clientes_nuevos === 1 && a.clientes_recurrentes === 1, 'clientes: 2 activos, 1 nuevo (Hotel Dos) y 1 recurrente (Planta Uno)', [a.clientes_activos, a.clientes_nuevos, a.clientes_recurrentes]);
  revisa(a.subcontratado_pct === 11.8, 'el 11.8 % de la venta se subcontrató', a.subcontratado_pct);
  revisa(p.venta === 4000 && p.servicios === 1, 'periodo anterior: $4,000 en 1 servicio', [p.venta, p.servicios]);
  const tc = j.top_clientes;
  revisa(tc[0].nombre === 'Planta Uno SA' && tc[0].venta === 15000 && tc[0].pct === 88.2 && tc[1].costo === 1200, 'top clientes: Planta Uno SA $15,000 (88.2 %), Hotel Dos con su costo', tc);
  revisa(j.por_servicio.reduce((t, x) => t + x.venta, 0) === 17000 && j.por_servicio.find(x => x.nombre === servicios[1].nombre)?.venta === 2000, 'por servicio: las partidas suman la venta', j.por_servicio);
  revisa(j.por_unidad[0].nombre === 'E-1' && j.por_unidad[0].venta === 15000, 'por unidad: E-1 vendió $15,000', j.por_unidad);
  revisa(j.gastos.find(g => g.categoria === 'subcontratacion')?.total === 1200 && j.gastos.find(g => g.categoria === 'combustible')?.total === 800, 'gastos por categoría', j.gastos);
  const t = j.tendencia;
  revisa(t.length === 12 && t[11].mes === HOY.slice(0, 7) && t.reduce((x, m) => x + m.venta, 0) >= 22000, 'tendencia de 12 meses que termina este mes', t.slice(-2));
  const f = j.foto;
  revisa(f.vencido_30 === 1000 && f.tramos.find(x => x.tramo === '31-60')?.total === 1000, 'cartera: $1,000 con más de 30 días vencido (tramo 31 a 60)', [f.vencido_30, f.tramos]);
  revisa(f.te_deben === 1000 + 5700 + 2000 + 812 + 4640, 'te deben: viejo ,000 + o2 ,700 + o3 ,000 + sin marcar 12 + periodo anterior ,640', f.te_deben);
  revisa(f.por_concluir === 1 && f.pipeline.abiertas === 1 && f.pipeline.vencen_7 === 1, 'operación y comercial: 1 por concluir, 1 cotización abierta que vence en 7 días', [f.por_concluir, f.pipeline]);
  revisa(f.debes === 800 && f.dias_cobro === 4, 'debes $800 a proveedores; el pago de o1 llegó 4 días después del servicio', [f.debes, f.dias_cobro]);
  revisa(j.alertas.some(x => x.nivel === 'rojo' && /30 días/.test(x.texto)) && j.alertas.some(x => /sin marcar/.test(x.texto)) && j.alertas.some(x => /Concentración/.test(x.texto)) && j.alertas.some(x => /vence/.test(x.texto)),
    'alertas: cobranza +30 días, servicios sin marcar, concentración en un cliente y cotización por vencer', j.alertas.map(x => x.texto));
  // Comparaciones naturales: mes pasado contra el mes anterior completo; año contra el mismo tramo del año pasado.
  [s, j] = await pedir('GET', '/tablero?desde=2026-09-01&hasta=2026-09-30&tipo=mes_pasado', A);
  revisa(j.anterior.desde === '2026-08-01' && j.anterior.hasta === '2026-08-31', 'septiembre se compara con agosto completo', j.anterior);
  [s, j] = await pedir('GET', '/tablero?desde=2026-03-01&hasta=2026-03-31&tipo=mes_pasado', A);
  revisa(j.anterior.desde === '2026-02-01' && j.anterior.hasta === '2026-02-28', 'marzo se compara con febrero completo (28 días)', j.anterior);
  [s, j] = await pedir('GET', '/tablero?desde=2026-01-01&hasta=2026-10-13&tipo=anio', A);
  revisa(j.anterior.desde === '2025-01-01' && j.anterior.hasta === '2025-10-13', 'el año en curso se compara con el mismo tramo del año pasado', j.anterior);
  [s, j] = await pedir('GET', '/tablero?desde=2026-10-01&hasta=2026-10-13&tipo=trimestre', A);
  revisa(j.anterior.desde === '2026-07-01' && j.anterior.hasta === '2026-07-13', 'el trimestre en curso se compara con el mismo tramo del trimestre anterior', j.anterior);
  // Por defecto: el mes actual
  [s, j] = await pedir('GET', '/tablero', A);
  revisa(s === 200 && j.desde === HOY.slice(0, 8) + '01' && j.hasta === HOY, 'sin fechas muestra el mes en curso', [j.desde, j.hasta]);
  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
