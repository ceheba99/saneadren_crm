// MÓDULO CONTABLE F2 (2026-11-11, aprobado por Dirección): ANTICIPOS POR COMPROBAR.
// Quien mueve dinero entrega un anticipo a una persona del personal; la persona (o quien mueve dinero) comprueba con
// gastos normales de Cuentas por pagar, que se pagan con el anticipo hasta donde alcance (lo que pase queda «Reembolso a
// <persona>»); al cerrar, lo que sobró se regresa (reintegro). Flujo de banco: la entrega sale, el reintegro entra y los
// gastos pagados con el anticipo no salen dos veces. Avisos en Inicio a los 7 días. Nada se borra.
// Uso: node tests/simulacion-anticipos.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-anticipos-')), DB = path.join(dir, 'a.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Antic-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Antic-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9450 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), MES = HOY.slice(0, 7);
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol Contador');
  const rolCont = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + rolCont + '/permisos', A, { permisos: ['contabilidad.ver'] }), 'permiso del contador');
  const usuario = async (nombre, rol) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }), nombre); return exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); };
  const gU = await usuario('Gema Gerente', 'gerente'), G = gU.token, tU = await usuario('Tomas Tecnico', 'tecnico'), T = tU.token, tito = await usuario('Tito Tecnico', 'tecnico');
  const V = (await usuario('Valeria Ventas', 'ventas')).token, C = (await usuario('Carmen Contadora', rolCont)).token;
  // Personal: Tomás y Tito con usuario, Pedro sin usuario (operador de campo).
  const ficha = async (nombre, usuario_id, extra = {}) => exigir(await pedir('POST', '/personal', A, { nombre, puesto: 'Operador', sucursal_id: qro.id, ...(usuario_id ? { usuario_id } : {}), ...extra }), 'ficha ' + nombre);
  // Tito y Pedro con CLABE capturada (dato sensible, se guarda cifrado): no debe salir en el Flujo de banco.
  const pTomas = await ficha('Tomas Tecnico', tU.id), pTito = await ficha('Tito Tecnico', tito.id, { clabe: '012180555888222117', banco: 'BBVA' }), pPedro = await ficha('Pedro Operador', null, { clabe: '012180555888222117', banco: 'BBVA' });
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Casetas Capufe Ejemplo', categoria: 'casetas_viaticos', dias_credito: 0 }), 'proveedor');
  const prov2 = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Gasolinera Ruta Norte', categoria: 'combustible', dias_credito: 0 }), 'proveedor 2');

  console.log('1. Entregar');
  revisa((await pedir('POST', '/anticipos', V, { personal_id: pTomas.id, monto: 1000, metodo: 'efectivo', motivo: 'Casetas de la ruta' }))[0] === 403, 'Ventas no entrega anticipos (no mueve dinero)');
  revisa((await pedir('POST', '/anticipos', T, { personal_id: pTomas.id, monto: 1000, metodo: 'efectivo', motivo: 'Casetas de la ruta' }))[0] === 403, 'El técnico no se entrega anticipos a sí mismo');
  revisa((await pedir('POST', '/anticipos', G, { personal_id: pTomas.id, monto: 0, metodo: 'efectivo', motivo: 'Casetas' }))[0] === 400, 'Monto en cero se rechaza');
  revisa((await pedir('POST', '/anticipos', G, { personal_id: pTomas.id, monto: 100, metodo: 'efectivo', motivo: 'Casetas', fecha: dia(3) }))[0] === 400, 'Fecha futura se rechaza');
  revisa((await pedir('POST', '/anticipos', G, { personal_id: pTomas.id, monto: 100, metodo: 'vales', motivo: 'Casetas' }))[0] === 400, 'Vía de entrega inválida se rechaza');
  revisa((await pedir('POST', '/anticipos', G, { personal_id: pTomas.id, monto: 100, metodo: 'efectivo', motivo: '' }))[0] === 400, 'Sin «para qué» se rechaza');
  const aT = exigir(await pedir('POST', '/anticipos', G, { personal_id: pTomas.id, monto: 1000, metodo: 'efectivo', cuenta_origen: 'Caja chica', motivo: 'Casetas y diésel ruta San Juan del Río', fecha: dia(-10) }), 'anticipo a Tomás');
  revisa((await pedir('POST', '/anticipos', G, { personal_id: pTomas.id, monto: 1000, metodo: 'efectivo', motivo: 'Casetas y diésel ruta San Juan del Río', fecha: dia(-10) }))[0] === 409, 'El mismo anticipo dos veces seguidas pide confirmar (posible duplicado)');
  const aP = exigir(await pedir('POST', '/anticipos', G, { personal_id: pPedro.id, monto: 500, metodo: 'transferencia', cuenta_origen: 'BBVA 1234', referencia: 'SPEI 991', motivo: 'Comida de la cuadrilla', fecha: dia(-2) }), 'anticipo a Pedro');

  console.log('2. Quién ve qué');
  const lista = async t => (await pedir('GET', '/anticipos?estado=todos', t))[1];
  let l = await lista(G); revisa(l.puede_entregar && l.anticipos.length === 2 && l.personas.length >= 3, 'El Gerente (mueve dinero) ve los dos y la lista de personas', l);
  l = await lista(C); revisa(!l.puede_entregar && l.anticipos.length === 2 && !l.personas.length, 'El Contador ve los dos, sin poder entregar');
  l = await lista(T); revisa(l.anticipos.length === 1 && l.anticipos[0].id === aT.id && l.anticipos[0].es_mio, 'Tomás ve solo el suyo', l.anticipos.map(a => a.persona));
  l = await lista(tito.token); revisa(l.anticipos.length === 0, 'Tito (otro técnico) no ve el de Tomás');
  l = await lista(V); revisa(l.anticipos.length === 0, 'Ventas no ve anticipos ajenos');

  console.log('3. Comprobar con gastos');
  const gasto = (t, anticipo_id, total, concepto, extra = {}) => pedir('POST', '/finanzas/cxp', t, { proveedor_id: prov.id, categoria: 'casetas_viaticos', concepto, total, fecha_documento: dia(-9), tipo_comprobante: 'recibo', anticipo_id, ...extra });
  let [s, r] = await gasto(T, aT.id, 300, 'Casetas ida y vuelta');
  revisa(s === 201 && r.anticipo?.usado === 300 && r.anticipo.por_reembolsar === 0, 'Tomás comprueba $300 de casetas sin orden de servicio (se paga con el anticipo)', r);
  revisa((await gasto(T, aT.id, 50, 'Casetas extra', { ya_pagado: true, metodo: 'efectivo' }))[0] === 400, 'Con anticipo no se marca «ya lo pagué»');
  revisa((await gasto(T, aP.id, 50, 'Casetas de Pedro'))[0] === 404, 'Tomás no comprueba con el anticipo de Pedro');
  revisa((await gasto(V, aT.id, 50, 'Casetas'))[0] === 404, 'Ventas no comprueba con el anticipo de Tomás');
  [s, r] = await gasto(T, aT.id, 800, 'Diésel de la ruta', { proveedor_id: prov2.id, categoria: 'combustible' });
  revisa(s === 201 && r.anticipo?.usado === 700 && r.anticipo.por_reembolsar === 100, 'Un gasto que pasa del anticipo: $700 con el anticipo y $100 por reembolsar a Tomás', r);
  const cxpDiesel = r.id;
  { const x = (await pedir('GET', '/finanzas/cxp?vista=todas', G))[1].find(c => c.id === cxpDiesel);
    revisa(x && /^Reembolso a Tomas Tecnico/.test(x.beneficiario || '') && Math.abs(x.saldo - 100) < 0.001, 'En Cuentas por pagar queda «Reembolso a Tomas Tecnico» con $100 de saldo', x && { b: x.beneficiario, s: x.saldo }); }
  [s, r] = await gasto(G, aP.id, 200, 'Comida de la cuadrilla (ticket)', { categoria: 'casetas_viaticos' });
  revisa(s === 201 && r.anticipo?.usado === 200, 'El Gerente comprueba el gasto de Pedro (no tiene usuario)', r);
  l = await lista(G);
  const verT = l.anticipos.find(a => a.id === aT.id), verP = l.anticipos.find(a => a.id === aP.id);
  revisa(verT.comprobado === 1000 && verT.saldo === 0 && verT.gastos.length === 2, 'Anticipo de Tomás: $1,000 comprobados, saldo 0, 2 gastos', verT);
  revisa(verP.comprobado === 200 && verP.saldo === 300, 'Anticipo de Pedro: $200 comprobados, $300 por comprobar', verP);
  revisa(verT.vencido && verT.dias === 10, 'El de Tomás (hace 10 días) se marca vencido');

  console.log('4. Avisos en Inicio');
  let av = (await pedir('GET', '/anticipos/avisos', G))[1].avisos;
  revisa(av.length === 1 && av[0].id === aT.id && /sin cerrar/.test(av[0].texto), 'A Gema (lo entregó) le avisa del de Tomás (más de 7 días), no del de Pedro (2 días)', av);
  av = (await pedir('GET', '/anticipos/avisos', T))[1].avisos;
  revisa(av.length === 0, 'A Tomás no le sale aviso: ya comprobó todo', av);
  av = (await pedir('GET', '/anticipos/avisos', V))[1].avisos; revisa(av.length === 0, 'A Ventas no le sale nada');

  console.log('5. Cerrar');
  revisa((await pedir('POST', '/anticipos/' + aT.id + '/cerrar', T, {}))[0] === 403, 'Tomás no cierra su propio anticipo');
  revisa((await pedir('POST', '/anticipos/' + aT.id + '/cerrar', G, {}))[0] === 200, 'Tomás comprobó todo: el Gerente lo cierra sin reintegro');
  revisa((await pedir('POST', '/anticipos/' + aP.id + '/cerrar', G, {}))[0] === 400, 'Pedro tiene $300 de sobra: cerrar sin decir cómo los regresó se rechaza');
  [s, r] = await pedir('POST', '/anticipos/' + aP.id + '/cerrar', G, { metodo: 'efectivo', fecha: HOY, cuenta: 'Caja chica', nota: 'Regresó el cambio' });
  revisa(s === 200 && r.reintegro === 300, 'Pedro regresa $300: se cierra con reintegro', r);
  revisa((await gasto(T, aT.id, 50, 'Casetas tardías'))[0] === 409, 'Un anticipo cerrado ya no recibe gastos');
  { const pago = (await pedir('GET', '/finanzas/cxp/' + cxpDiesel + '/pagos', G))[1].find(p => p.metodo === 'anticipo');
    revisa(pago && (await pedir('POST', '/finanzas/pagos-proveedor/' + pago.id + '/cancelar', G, { motivo: 'Prueba de descomprobar' }))[0] === 409, 'El pago con un anticipo cerrado no se cancela (no se descomprueba)'); }

  console.log('6. Cancelar uno mal capturado');
  const aMal = exigir(await pedir('POST', '/anticipos', G, { personal_id: pTito.id, monto: 250, metodo: 'efectivo', motivo: 'Capturado por error' }), 'anticipo equivocado');
  revisa((await pedir('POST', '/anticipos/' + aMal.id + '/cancelar', G, { motivo: 'no' }))[0] === 400, 'Cancelar sin motivo se rechaza');
  revisa((await pedir('POST', '/anticipos/' + aMal.id + '/cancelar', G, { motivo: 'Era para otra persona' }))[0] === 200, 'Sin gastos, se cancela con motivo');
  const aCon = exigir(await pedir('POST', '/anticipos', G, { personal_id: pTito.id, monto: 400, metodo: 'efectivo', motivo: 'Material de campo' }), 'anticipo a Tito');
  exigir(await gasto(tito.token, aCon.id, 150, 'Cinta y tornillería'), 'gasto de Tito');
  revisa((await pedir('POST', '/anticipos/' + aCon.id + '/cancelar', G, { motivo: 'Prueba con gastos' }))[0] === 409, 'Con gastos comprobados no se cancela');

  console.log('7. Contabilidad y Flujo de banco');
  [s, r] = await pedir('GET', '/contabilidad/resumen?mes=' + MES, C);
  const esperado = (dia(-10).slice(0, 7) === MES ? 1000 : 0) + (dia(-2).slice(0, 7) === MES ? 500 : 0) + 400;
  revisa(s === 200 && r.egresos.anticipos_entregados === esperado && r.egresos.anticipos_reintegrados === 300, `Resumen: entregado en el mes ${esperado}, reintegrado 300 (el cancelado no cuenta)`, r.egresos);
  revisa(r.pendientes.anticipos_abiertos === 1 && r.pendientes.anticipos_por_comprobar === 250 && r.pendientes.anticipos[0].persona === 'Tito Tecnico', 'Pendientes: el de Tito, con $250 por comprobar', r.pendientes);
  const ex = exigir(await pedir('GET', '/contabilidad/excel?mes=' + MES, C), 'Excel del mes');
  const filasAnt = ex.flujo.filter(f => f.cuenta_abono === 'ANTICIPO');
  revisa(filasAnt.some(f => /Anticipo por comprobar a Tito/.test(f.concepto_banco) && f.egreso === 400) && filasAnt.some(f => /Reintegro de anticipo de Pedro/.test(f.concepto_banco) && f.ingreso === 300),
    'Flujo de banco: la entrega a Tito sale y el reintegro de Pedro entra', filasAnt.map(f => [f.concepto_banco, f.egreso, f.ingreso]));
  revisa(!ex.flujo.some(f => f.via === 'anticipo'), 'Flujo de banco: los gastos pagados con el anticipo no salen otra vez del banco');
  revisa(filasAnt.every(f => !f.clabe && !f.cuenta_tercero) && !JSON.stringify(ex.flujo).includes('enc1:') && !JSON.stringify(ex.flujo).includes('2221'), 'Flujo de banco: no muestra la CLABE del personal (dato sensible)');
  { const tito = filasAnt.find(f => /Anticipo por comprobar a Tito/.test(f.concepto_banco)), pedro = filasAnt.find(f => /Anticipo por comprobar a Pedro/.test(f.concepto_banco));
    revisa(tito && tito.no_deducible === 150 && tito.por_comprobar === 250 && /comprueba con los gastos/.test(tito.revisar), 'Flujo de banco: el anticipo de Tito dice $150 comprobados (sin factura) y $250 por comprobar', tito);
    revisa(!pedro || (pedro.por_comprobar === 0 && pedro.no_deducible === 200 && !/comprobar/i.test(pedro.revisar || '')), 'Flujo de banco: el de Pedro (comprobó $200 y regresó $300) ya no tiene nada por comprobar', pedro); }
  revisa(!filasAnt.some(f => /Capturado por error/.test(f.concepto)), 'Flujo de banco: el anticipo cancelado no aparece');
  revisa(ex.pagos.some(p => p.metodo === 'anticipo' && p.monto === 300), 'Pagos a proveedores: el gasto aparece pagado con vía «anticipo»');

  console.log('8. Candados en la base');
  { const d = new DatabaseSync(DB); let e1 = '', e2 = '';
    try { d.prepare('UPDATE anticipos SET monto_cent = 1 WHERE id = ?').run(aP.id); } catch (e) { e1 = e.message; }
    try { d.prepare('DELETE FROM anticipos WHERE id = ?').run(aMal.id); } catch (e) { e2 = e.message; }
    revisa(/no se modifica/.test(e1), 'La base no deja cambiar el monto de un anticipo', e1);
    revisa(/no se borran/.test(e2), 'La base no deja borrar un anticipo', e2);
    d.close(); }
  revisa(!/TypeError|SqliteError|Error no manejado/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(x => /Error/.test(x)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
