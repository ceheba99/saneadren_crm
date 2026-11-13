// Uso: node tests/simulacion-cxc-auditoria.cjs   (base temporal; no toca saneadren.db)
// Auditoría de Cuentas por cobrar (2026-11-13): cobrado = solo confirmado, quién confirma, a favor por motivo, cobrar lo no reportado.
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-integral2-')); const PUERTO = String(3900 + Math.floor(Math.random() * 400));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Integral2-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'i.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const sumarDias = (f, d) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  let s, j;
  sec('0. Permisos de fábrica (antes de cualquier cambio)');
  [s, j] = await pedir('GET', '/permisos', A);
  const tiene = (rol, p) => !!(j.roles || []).find(r => r.clave === rol)?.permisos?.includes(p);
  revisa(s === 200 && !tiene('ventas', 'cobros.confirmar') && !tiene('costos', 'cobros.confirmar') && !tiene('tecnico', 'cobros.confirmar') && tiene('atencion', 'cobros.confirmar') && tiene('gerente', 'cobros.confirmar'),
    'confirmar cobros: solo gerente y atención', (j.roles || []).map(r => [r.clave, r.permisos?.includes('cobros.confirmar')]));

  // El resto prueba cálculos: roles como antes de los niveles (cada quien ve su sucursal).
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A);
  const servicios = (await pedir('GET', '/servicios', A))[1], canales = (await pedir('GET', '/canales', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  await pedir('POST', '/usuarios', A, { nombre: 'Vendedora Tres', correo: 'v3@saneadren.com.mx', password: 'Ventas-Tres-2026', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Atención Uno', correo: 'at1@saneadren.com.mx', password: 'Atencion-Uno-2026', rol: 'atencion' });
  const V = (await pedir('POST', '/login', null, { nombre: 'v3@saneadren.com.mx', password: 'Ventas-Tres-2026' }))[1].token;
  const AT = (await pedir('POST', '/login', null, { nombre: 'at1@saneadren.com.mx', password: 'Atencion-Uno-2026' }))[1].token;
  const vid = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'ventas').id;
  const P = (...p) => JSON.stringify(p);
  const partida = precio => ({ servicio: servicios[0].nombre, leyenda: 'x', importe: precio, cantidad: 1, precio });
  const cuenta = async id => (await pedir('GET', '/leads/' + id + '/cobros', A))[1].cuenta;
  const resumen = async () => (await pedir('GET', '/finanzas/resumen', A))[1];
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Hotel Prueba', telefono: '4426661111', direccion: 'Centro 1', canal_origen_id: canales[0].id });
  const C = j.id;
  const alta = cuerpo => pedir('POST', '/leads', A, { cliente_id: C, direccion: 'Planta', responsable_id: vid, forzar_duplicado: true, iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: sumarDias(HOY, -1), ...cuerpo });

  sec('1. Cobrado este mes = solo confirmado');
  [s, j] = await alta({ partidas_json: P(partida(1000)) }); const o1 = j.id;
  await pedir('POST', '/leads/' + o1 + '/ejecucion', A, { estado: 'realizado', fecha: sumarDias(HOY, -1), realizado_por: 'propio', gastos: [] });
  const r0 = await resumen();
  [s, j] = await pedir('POST', '/leads/' + o1 + '/cobros', V, { monto: 400, metodo: 'efectivo' });
  revisa(s === 201 && j.confirmado === false, 'el pago que anota ventas queda por confirmar', [s, j]);
  const pagoV = j.id;
  const r1 = await resumen();
  revisa(r1.cobrado_mes === r0.cobrado_mes, 'un pago sin confirmar NO suma en «Cobrado este mes»', [r0.cobrado_mes, r1.cobrado_mes]);
  revisa(r1.por_confirmar.monto === r0.por_confirmar.monto + 400, 'sí suma en «Por confirmar»', r1.por_confirmar);
  const per = (await pedir('GET', `/finanzas/periodo?desde=${HOY.slice(0, 8)}01&hasta=${HOY}`, A))[1];
  revisa(per.cobrado === r1.cobrado_mes, 'Resultados (periodo) da lo mismo que la tarjeta', [per.cobrado, r1.cobrado_mes]);

  sec('2. Registrar pago con un pago por confirmar');
  let c = await cuenta(o1);
  revisa(c.sin_reportar === 760 && c.saldo === 1160, 'falta por reportar $760 (el saldo confirmado sigue en $1,160)', c);
  [s, j] = await pedir('POST', '/leads/' + o1 + '/cobros', A, { monto: c.sin_reportar, metodo: 'transferencia' });
  revisa(s === 201, 'el monto que precarga la pantalla (lo no reportado) se acepta', [s, j.error]);
  c = await cuenta(o1);
  revisa(c.sin_reportar === 0 && c.estado === 'por_confirmar', 'todo reportado: la orden queda «por confirmar» (sin botón de pagar)', c);

  sec('3. Quién confirma');
  [s, j] = await pedir('POST', '/finanzas/cobros/' + pagoV + '/confirmar', V, {});
  revisa(s === 403, 'quien registró el pago no lo confirma', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + pagoV + '/confirmar', AT, {});
  revisa(s === 200 || (s === 400 && /cuenta/i.test(j.error || '')), 'atención sí puede confirmar', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + pagoV + '/confirmar', A, {});
  revisa(s === 200, 'Dirección confirma', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + pagoV + '/confirmar', A, {});
  revisa(s === 200, 'confirmar dos veces no falla', [s, j]);
  const r2 = await resumen();
  revisa(r2.cobrado_mes === r0.cobrado_mes + 1160, 'ya confirmado todo, «Cobrado este mes» sube $1,160', [r0.cobrado_mes, r2.cobrado_mes]);

  sec('4. A favor: solo confirmado y por motivo');
  [s, j] = await alta({ partidas_json: P(partida(2000)), fecha_servicio: sumarDias(HOY, 3) }); const o2 = j.id;
  [s, j] = await pedir('POST', '/leads/' + o2 + '/cobros', V, { monto: 500, metodo: 'efectivo', tipo: 'anticipo' });
  revisa(s === 201 && j.confirmado === false, 'anticipo de ventas por confirmar', [s, j]);
  await pedir('POST', '/leads/' + o2 + '/ejecucion', A, { estado: 'no_realizado', motivo: 'El cliente canceló el servicio' });
  c = await cuenta(o2);
  revisa(c.a_favor === 0 && c.estado === 'por_confirmar', 'un anticipo sin confirmar NO cuenta «a favor»', c);
  const r3 = await resumen();
  revisa(r3.a_favor === r2.a_favor, 'la tarjeta «A favor» no cambia', [r2.a_favor, r3.a_favor]);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + j.id + '/confirmar', A, {});
  const anticipo = (await pedir('GET', '/leads/' + o2 + '/cobros', A))[1].cobros.find(k => k.tipo === 'anticipo');
  [s, j] = await pedir('POST', '/finanzas/cobros/' + anticipo.id + '/confirmar', A, {});
  c = await cuenta(o2);
  revisa(c.a_favor === 500 && c.a_favor_motivo === 'no_realizado', 'confirmado, sí queda $500 a favor (no realizado)', c);
  revisa((await resumen()).ordenes_pago_de_mas === 0, 'no se cuenta como «pagaron de más»');

  sec('5. Estado de cuenta: pagado = confirmado');
  [s, j] = await alta({ partidas_json: P(partida(300)) }); const o3 = j.id;
  await pedir('POST', '/leads/' + o3 + '/ejecucion', A, { estado: 'realizado', fecha: sumarDias(HOY, -1), realizado_por: 'propio', gastos: [] });
  await pedir('POST', '/leads/' + o3 + '/cobros', V, { monto: 100, metodo: 'efectivo' });
  [s, j] = await pedir('GET', '/finanzas/clientes/' + C + '/estado-cuenta?completo=1', A);
  revisa(s === 200 && j.por_confirmar === 100 && j.pagado === 1660, 'pagado $1,660 (confirmado) y $100 aparte por confirmar', { pagado: j.pagado, pc: j.por_confirmar });

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores', m.map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
