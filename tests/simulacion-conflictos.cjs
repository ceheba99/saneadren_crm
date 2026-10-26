// Simulación de conflictos graves: peticiones simultáneas, datos maliciosos, montos extremos,
// referencias inválidas y permisos. Uso: node tests/simulacion-conflictos.cjs (base temporal).
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-conflictos-')); const PUERTO = String(4300 + Math.floor(Math.random() * 400));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Conflictos-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'c.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, crudo) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: crudo !== undefined ? crudo : b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const sumarDias = (f, d) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  const servicios = (await pedir('GET', '/servicios', A))[1], canales = (await pedir('GET', '/canales', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  await pedir('POST', '/usuarios', A, { nombre: 'Atención Sim', correo: 'atn.sim@saneadren.com.mx', password: 'Atencion-Sim-2026', rol: 'atencion' });
  const B = (await pedir('POST', '/login', null, { nombre: 'atn.sim@saneadren.com.mx', password: 'Atencion-Sim-2026' }))[1].token;
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A); // aquí se prueban los choques, no quién edita qué
  const partida = (precio, cantidad = 1) => ({ servicio: servicios[0].nombre, leyenda: 'x', importe: precio, cantidad, precio });
  const P = (...p) => JSON.stringify(p);
  const lead = async id => (await pedir('GET', '/leads/' + id, A))[1];
  const cuenta = async id => (await pedir('GET', '/leads/' + id + '/cobros', A))[1].cuenta;
  let s, j;
  const XSS = '<img src=x onerror=alert(1)>"\'; DROP TABLE leads;--';
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Cliente ' + XSS, telefono: '4428880001', direccion: XSS, canal_origen_id: canales[0].id, empresa_contacto: XSS });
  const C = j.id;
  revisa(s === 201 || s === 400, 'contacto con texto malicioso: se guarda como texto o se rechaza, sin tronar', [s, j.error]);
  const cli = C || (await pedir('POST', '/contactos', A, { nombre: 'Cliente Normal', telefono: '4428880009', direccion: 'Calle', canal_origen_id: canales[0].id }))[1].id;
  const alta = (cuerpo, t = A) => pedir('POST', '/leads', t, { cliente_id: cli, direccion: 'Planta', responsable_id: yo, forzar_duplicado: true, iva_modo: 'sin_iva', ...cuerpo });

  sec('1. Pagos simultáneos que juntos exceden el saldo');
  [s, j] = await alta({ partidas_json: P(partida(1000)), estatus: 'ganado', fecha_servicio: HOY });
  const o1 = j;
  const montos = [400, 400, 400, 400, 400];
  const res = await Promise.all(montos.map((m, i) => pedir('POST', '/leads/' + o1.id + '/cobros', i % 2 ? B : A, { monto: m, metodo: 'efectivo', referencia: 'r' + i, forzar: true })));
  const ok201 = res.filter(r => r[0] === 201).length;
  const c1 = await cuenta(o1.id);
  revisa(c1.cobrado <= 1000 && c1.saldo >= 0, 'con 5 pagos de $400 al mismo tiempo, nunca se cobra más de $1,000', { aceptados: ok201, cobrado: c1.cobrado, saldo: c1.saldo });
  revisa(ok201 === 2, 'solo entran 2 pagos ($800) y los demás se rechazan', ok201);

  sec('2. Ediciones simultáneas con la misma versión');
  [s, j] = await alta({ partidas_json: P(partida(500)), iva_modo: 'mas_iva' });
  const cot = j;
  const ed = await Promise.all([
    pedir('PUT', '/leads/' + cot.id, A, { version: cot.version, notas_cotizacion: 'Versión A' }),
    pedir('PUT', '/leads/' + cot.id, B, { version: cot.version, notas_cotizacion: 'Versión B' })]);
  revisa(ed.filter(r => r[0] === 200).length === 1 && ed.filter(r => r[0] === 409).length === 1, 'dos personas guardan a la vez: una gana y la otra recibe aviso de conflicto', ed.map(r => r[0]));
  // Convertir en orden dos veces al mismo tiempo
  const v = (await lead(cot.id)).version;
  const conv = await Promise.all([0, 1].map(() => pedir('PUT', '/leads/' + cot.id, A, { version: v, estatus: 'ganado', fecha_servicio: HOY })));
  revisa(conv.filter(r => r[0] === 200).length === 1, 'convertir la misma cotización dos veces al mismo tiempo: solo una vez', conv.map(r => r[0]));

  sec('3. Marcar realizado dos veces al mismo tiempo (gastos duplicados)');
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Proveedor Conflicto', categoria: 'subcontratacion', dias_credito: 0 });
  const prov = j;
  [s, j] = await alta({ partidas_json: P(partida(3000)), estatus: 'ganado', fecha_servicio: HOY });
  const o3 = j;
  const gasto = { estado: 'realizado', realizado_por: 'subcontratado', gastos: [{ proveedor_id: prov.id, concepto: 'Pago al tercero', total: 2000 }] };
  await Promise.all([pedir('POST', '/leads/' + o3.id + '/ejecucion', A, gasto), pedir('POST', '/leads/' + o3.id + '/ejecucion', B, gasto)]);
  const cx = (await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + o3.id, A))[1];
  revisa(cx.length === 1, 'el pago al tercero queda una sola vez', cx.map(x => [x.id, x.concepto]));
  // Realizado y no realizado al mismo tiempo
  await Promise.all([pedir('POST', '/leads/' + o3.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'Prueba de choque' }), pedir('POST', '/leads/' + o3.id + '/ejecucion', B, { estado: 'realizado', realizado_por: 'propio' })]);
  const l3 = await lead(o3.id);
  revisa(['realizado', 'no_realizado'].includes(l3.ejecucion) && (l3.ejecucion === 'realizado') === !!l3.fecha_realizado, 'choque realizado / no realizado deja un estado coherente', [l3.ejecucion, l3.fecha_realizado, l3.motivo_no_realizado]);

  sec('4. Pagar y cancelar la orden al mismo tiempo');
  [s, j] = await alta({ partidas_json: P(partida(800)), iva_modo: 'sin_iva' });
  const cot4 = j;
  await pedir('PUT', '/leads/' + cot4.id, A, { version: cot4.version, estatus: 'ganado', fecha_servicio: HOY });
  const v4 = (await lead(cot4.id)).version;
  const r4 = await Promise.all([pedir('POST', '/leads/' + cot4.id + '/cobros', A, { monto: 800, metodo: 'efectivo' }), pedir('PUT', '/leads/' + cot4.id, B, { version: v4, estatus: 'perdido' })]);
  const l4 = await lead(cot4.id), c4 = l4.estatus === 'ganado' ? await cuenta(cot4.id) : null;
  const cobros4 = (await pedir('GET', '/finanzas/cobros-de-prueba-inexistente', A))[0];
  revisa(!(l4.estatus !== 'ganado' && r4[0][0] === 201), 'no queda un pago registrado en una orden que se descartó', [l4.estatus, r4.map(r => r[0])]);

  sec('5. Montos y cantidades extremas');
  for (const [cuerpo, texto] of [
    [{ partidas_json: P(partida(1e13)) }, 'precio de 10 billones se rechaza'],
    [{ partidas_json: P(partida(100, -2)) }, 'cantidad negativa se rechaza'],
    [{ partidas_json: P(partida(100, 0.0001)) }, 'cantidad con más de 3 decimales se rechaza'],
    [{ partidas_json: P(partida(Number.NaN)) }, 'precio NaN se rechaza'],
    [{ partidas_json: P(...Array.from({ length: 101 }, () => partida(1))) }, '101 partidas se rechazan'],
    [{ partidas_json: '{"no":"lista"}' }, 'partidas que no son lista se rechazan'],
    [{ partidas_json: 'no es json' }, 'partidas con JSON roto se rechazan'],
    [{ partidas_json: P({ servicio: 'Servicio que no existe', leyenda: 'x', importe: 100 }) }, 'servicio fuera del catálogo se rechaza'],
    [{ partidas_json: P(partida(99999999.99, 2)), iva_modo: 'mas_iva' }, 'total arriba de $100 millones se rechaza'],
  ]) { [s, j] = await alta(cuerpo); revisa(s === 400, texto, [s, j.error]); }
  [s, j] = await alta({ partidas_json: P(partida(0.01)), estatus: 'ganado', fecha_servicio: HOY });
  revisa(s === 201, 'un servicio de $0.01 sí se puede', [s, j.error]);
  [s, j] = await pedir('POST', '/leads/' + j.id + '/cobros', A, { monto: '0.01', metodo: 'efectivo' });
  revisa(s === 201 && j.cuenta.saldo === 0, 'pagar $0.01 como texto liquida', [s, j.cuenta]);
  for (const m of ['1e3', '  ', '1,0,0', '12.3.4', 'abc', Infinity, -0, null, true, [100], { m: 1 }]) {
    [s, j] = await pedir('POST', '/leads/' + o1.id + '/cobros', A, { monto: m, metodo: 'efectivo' });
    revisa(s === 400, 'monto raro ' + JSON.stringify(m) + ' se rechaza', [s, j.error]);
  }

  sec('6. Referencias inválidas');
  for (const [m, r, b, texto] of [
    ['POST', '/leads/999999/cobros', { monto: 1, metodo: 'efectivo' }, 'pago a orden inexistente'],
    ['POST', '/leads/abc/ejecucion', { estado: 'realizado', realizado_por: 'propio' }, 'ejecución con id no numérico'],
    ['PUT', '/leads/999999', { notas_cotizacion: 'x' }, 'editar orden inexistente'],
    ['POST', '/finanzas/cobros/999999/cancelar', { motivo: 'no existe este pago' }, 'cancelar pago inexistente'],
    ['POST', '/finanzas/cxp', { proveedor_id: 999999, concepto: 'x', total: 10 }, 'gasto con proveedor inexistente'],
    ['POST', '/finanzas/cxp', { proveedor_id: prov.id, concepto: 'x', total: 10, lead_id: 999999 }, 'gasto ligado a orden inexistente'],
    ['POST', '/leads', { cliente_id: 999999, direccion: 'x', responsable_id: yo, partidas_json: P(partida(10)) }, 'cotización a contacto inexistente'],
    ['POST', '/leads', { cliente_id: cli, direccion: 'x', responsable_id: 999999, partidas_json: P(partida(10)) }, 'cotización con responsable inexistente'],
    ['GET', '/calendario?desde=2026-02-30&hasta=2026-03-01', undefined, 'calendario con fecha imposible (30 feb)'],
    ['GET', '/finanzas/clientes/999999/estado-cuenta', undefined, 'estado de cuenta de cliente inexistente'],
  ]) { [s, j] = await pedir(m, r, A, b); revisa(s >= 400 && s < 500, texto + ' → error controlado', [s, j.error]); }
  [s, j] = await pedir('POST', '/leads', A, undefined, '{"roto": ');
  revisa(s === 400, 'cuerpo JSON roto → 400', s);

  sec('7. Sesión y permisos');
  [s] = await pedir('GET', '/finanzas/cartera', null); revisa(s === 401, 'sin sesión no se ve la cartera');
  [s] = await pedir('GET', '/finanzas/cartera', A + 'x'); revisa(s === 401, 'token alterado se rechaza');
  [s] = await pedir('POST', '/logout', B);
  [s] = await pedir('GET', '/finanzas/cartera', B); revisa(s === 401, 'después de cerrar sesión el token ya no sirve', s);
  [s, j] = await pedir('PUT', '/usuarios/' + yo, A, { rol: 'ventas' });
  revisa(s === 400 || s === 403 || s === 409, 'el único administrador no se puede quitar a sí mismo el rol', [s, j.error]);

  sec('8. Texto malicioso en las listas');
  const cart = (await pedir('GET', '/finanzas/cartera?filtro=todas', A))[1];
  revisa(Array.isArray(cart), 'la cartera carga con nombres con código', typeof cart);
  const cal = (await pedir('GET', `/calendario?desde=${sumarDias(HOY, -5)}&hasta=${sumarDias(HOY, 5)}`, A));
  revisa(cal[0] === 200, 'el calendario carga con nombres con código', cal[0]);
  const gen = (await pedir('GET', '/generador', A));
  revisa(gen[0] === 200, 'el generador carga', gen[0]);

  sec('9. Consistencia final');
  const todas = (await pedir('GET', '/finanzas/cartera?filtro=todas', A))[1];
  revisa(todas.every(c => c.saldo >= 0 && c.cobrado <= c.total + 0.001 || c.ejecucion === 'no_realizado'), 'ninguna cuenta con saldo negativo ni cobrada de más', todas.filter(c => c.saldo < 0 || c.cobrado > c.total + 0.001).map(c => [c.lead_id, c.total, c.cobrado, c.saldo]));
  const rs = (await pedir('GET', '/finanzas/resumen', A))[1];
  const suma = Math.round(todas.filter(c => c.saldo > 0 && !c.programada).reduce((t, c) => t + c.saldo * 100, 0)) / 100;
  revisa(rs.por_cobrar === suma, '"Te deben" = suma de la lista', { rs: rs.por_cobrar, suma });
  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  const salud = await pedir('GET', '/salud', null);
  revisa(salud[0] === 200, 'el servidor sigue vivo al final', salud);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
