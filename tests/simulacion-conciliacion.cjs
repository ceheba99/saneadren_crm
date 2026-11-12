// MÓDULO CONTABLE F4 (2026-11-11, aprobado por Dirección): CONCILIACIÓN BANCARIA.
// Se da de alta una cuenta, se sube su estado de cuenta (renglones ya acomodados por la pantalla) y el sistema empareja
// solo lo que coincide con el CRM (misma dirección, mismo monto, hasta 3 días); lo dudoso queda para hacerlo a mano.
// Lo que no está en el CRM se empareja a mano, se registra como gasto (quien mueve dinero) o se marca «no aplica».
// Uso: node tests/simulacion-conciliacion.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-concilia-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Concilia-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Concilia-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9650 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
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
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const dma = f => f.split('-').reverse().join('/');

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol Contador');
  const rolCont = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + rolCont + '/permisos', A, { permisos: ['contabilidad.ver'] }), 'permiso del contador');
  const usuario = async (nombre, rol) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }), nombre); const u = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); ID[nombre] = u.id; return u.token; };
  const ID = {};
  const G = await usuario('Gema Gerente', 'gerente'), V = await usuario('Valeria Ventas', 'ventas'), Cm = await usuario('Carlos Compras', 'costos'), C = await usuario('Carmen Contadora', rolCont);
  // Lo del CRM: una orden con cobros y un proveedor con un pago desde la cuenta.
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Banco', telefono: '4425550101', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Planta', canal_id: canal.id, servicio_id: servicio.id, responsable_id: ID['Valeria Ventas'], forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'x', importe: 10000 }]), iva_modo: 'mas_iva', valor: 10000 }), 'cotización');
  { const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(DB); d.prepare("UPDATE leads SET created_at = ?, fecha_cotizacion = ? WHERE id = ?").run(dia(-20) + ' 09:00:00', dia(-20), l.id); d.close(); } // cotización de hace 20 días
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: dia(-10) }), 'orden');
  const cobro = (monto, metodo, fecha, referencia) => pedir('POST', '/leads/' + o.id + '/cobros', A, { monto, metodo, fecha, referencia, forzar: true });
  exigir(await cobro(1160, 'transferencia', dia(-5), 'SPEI 111'), 'cobro 1160');
  exigir(await cobro(500, 'efectivo', dia(-5)), 'cobro en efectivo');
  exigir(await cobro(800, 'transferencia', dia(-2), 'A'), 'cobro 800 A');
  exigir(await cobro(800, 'deposito', dia(-2), 'B'), 'cobro 800 B');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refacciones Banco Ejemplo', categoria: 'otro', dias_credito: 0 }), 'proveedor');
  const banco = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Banco Santander (ejemplo)', categoria: 'comisiones_bancarias', dias_credito: 0 }), 'proveedor banco');
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Refacciones', total: 2320, fecha_documento: dia(-4), dias_credito: 0, tipo_comprobante: 'recibo', ya_pagado: true, metodo: 'transferencia', fecha_pago: dia(-4), cuenta_origen: 'Santander empresa' }), 'gasto pagado');

  console.log('1. Cuentas');
  revisa((await pedir('POST', '/conciliacion/cuentas', V, { nombre: 'Santander empresa', banco: 'Santander', sucursal_id: qro.id }))[0] === 403, 'Ventas no da de alta cuentas');
  revisa((await pedir('POST', '/conciliacion/cuentas', Cm, { nombre: 'Santander empresa', banco: 'Santander', sucursal_id: qro.id }))[0] === 403, 'Compras tampoco (no tiene «Contabilidad del mes»)');
  const cta = exigir(await pedir('POST', '/conciliacion/cuentas', G, { nombre: 'Santander empresa', banco: 'Santander', terminacion: '1234', sucursal_id: qro.id }), 'cuenta');
  revisa((await pedir('POST', '/conciliacion/cuentas', G, { nombre: 'santander EMPRESA', banco: 'Santander', sucursal_id: qro.id }))[0] === 409, 'El mismo nombre dos veces se rechaza');

  console.log('2. Subir el estado de cuenta');
  const filas = [
    { fecha: dma(dia(-4)), concepto: 'SPEI RECIBIDO CLIENTE BANCO', referencia: '111', cargo: '', abono: '1,160.00', saldo: '10,000.00' },
    { fecha: dma(dia(-3)), concepto: 'SPEI ENVIADO REFACCIONES', referencia: '222', cargo: '2,320.00', abono: '', saldo: '7,680.00' },
    { fecha: dma(dia(-3)), concepto: 'COMISION SPEI', referencia: '', cargo: '15.66', abono: '', saldo: '7,664.34' },
    { fecha: dma(dia(-2)), concepto: 'DEPOSITO', referencia: '', cargo: '', abono: '800.00', saldo: '8,464.34' },
    { fecha: dma(dia(-1)), concepto: 'TRASPASO A BANORTE', referencia: '', cargo: '5,000.00', abono: '', saldo: '3,464.34' },
  ];
  revisa((await pedir('POST', '/conciliacion/cargar', V, { cuenta_id: cta.id, filas }))[0] === 403, 'Ventas no sube estados de cuenta');
  let [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas: [...filas, { fecha: '31/02/2026', concepto: 'x', cargo: '1' }] });
  revisa(s === 400 && r.errores?.length === 1, 'Un renglón con fecha imposible: no se guarda nada y dice cuál', r);
  [s, r] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas, archivo: 'santander.xlsx', columnas: { fecha: 0, concepto: 1, cargo: 3, abono: 4 } });
  revisa(s === 201 && r.nuevos === 5 && r.emparejados === 2, 'El Contador sube 5 movimientos; se emparejan solos 2 (el cobro de 1,160 y el pago de 2,320)', r);
  r = exigir(await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas }), 'subir otra vez');
  revisa(r.nuevos === 0 && r.repetidos === 5, 'Subir el mismo archivo otra vez no duplica nada', r);
  const MES = dia(-1).slice(0, 7), VER = `/conciliacion?cuenta=${cta.id}&mes=${MES}`;
  let v = exigir(await pedir('GET', VER, C), 'ver');
  const enMes = f => f.slice(0, 7) === MES;
  revisa(v.cuenta.columnas?.fecha === 0, 'Se recuerdan las columnas del archivo para esa cuenta');
  revisa(v.conciliados.length === [dia(-4), dia(-3)].filter(enMes).length && v.conciliados.every(b => b.conciliado.auto), 'Conciliados (solos): el cobro y el pago', v.conciliados.map(b => b.concepto));
  const dep = v.banco_sin_crm.find(b => b.concepto === 'DEPOSITO'), com = v.banco_sin_crm.find(b => /COMISION/.test(b.concepto)), tras = v.banco_sin_crm.find(b => /TRASPASO/.test(b.concepto));
  revisa(!enMes(dia(-2)) || (dep && com && tras), 'En el banco y no en el CRM: el depósito de 800 (hay dos cobros de 800: no adivina), la comisión y el traspaso');
  revisa(!v.crm_sin_banco.some(m => m.monto === 500), 'El cobro en efectivo no se espera en el banco');
  revisa(!enMes(dia(-2)) || v.crm_sin_banco.filter(m => m.monto === 800).length === 2, 'En el CRM y no en el banco: los dos cobros de 800');
  revisa(v.totales.saldo_final_banco === 3464.34, 'Saldo final del banco: el del último renglón', v.totales);

  console.log('3. A mano');
  if (dep) {
    const cand = exigir(await pedir('GET', '/conciliacion/movimientos/' + dep.id + '/candidatos', C), 'candidatos').candidatos;
    revisa(cand.length === 2 && cand.every(c => c.monto === 800), 'Para el depósito de 800 hay dos candidatos');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/emparejar', C, { tipo: 'pago', id: 1 }))[0] >= 400, 'Emparejar con algo de otra dirección o monto se rechaza');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/emparejar', C, { tipo: cand[1].tipo, id: cand[1].id }))[0] === 200, 'El Contador elige el cobro B a mano');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/emparejar', C, { tipo: cand[0].tipo, id: cand[0].id }))[0] === 409, 'Un movimiento del banco no se concilia dos veces');
  }
  revisa((await pedir('POST', '/conciliacion/movimientos/' + tras.id + '/no-aplica', C, { motivo: 'no' }))[0] === 400, '«No aplica» sin motivo se rechaza');
  revisa((await pedir('POST', '/conciliacion/movimientos/' + tras.id + '/no-aplica', C, { motivo: 'Traspaso entre cuentas propias' }))[0] === 200, 'El traspaso se marca «no aplica» con motivo');
  revisa((await pedir('POST', '/conciliacion/movimientos/' + com.id + '/gasto', C, { proveedor_id: banco.id, categoria: 'comisiones_bancarias', concepto: 'Comisión SPEI' }))[0] === 403, 'El Contador (no mueve dinero) no registra el gasto');
  if (dep) revisa((await pedir('POST', '/conciliacion/movimientos/' + dep.id + '/gasto', G, { proveedor_id: banco.id }))[0] === 409, 'Un abono ya conciliado no se registra como gasto');
  [s, r] = await pedir('POST', '/conciliacion/movimientos/' + com.id + '/gasto', G, { proveedor_id: banco.id, categoria: 'comisiones_bancarias', concepto: 'Comisión SPEI' });
  revisa(s === 201 && r.cxp_id, 'El Gerente registra la comisión como gasto', r);
  { const x = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(c => c.id === r.cxp_id);
    revisa(x && x.categoria === 'comisiones_bancarias' && Math.abs(x.total - 15.66) < 0.001 && x.saldo === 0, 'Queda en Cuentas por pagar como comisión bancaria de $15.66, ya pagada', x && { c: x.categoria, t: x.total, s: x.saldo }); }
  v = exigir(await pedir('GET', VER, C), 'ver');
  revisa(v.banco_sin_crm.length === 0 && v.no_aplica.length === (enMes(dia(-1)) ? 1 : 0), 'Ya no queda nada del banco sin explicar', v.banco_sin_crm.map(b => b.concepto));
  revisa(!enMes(dia(-2)) || (v.crm_sin_banco.length === 1 && v.crm_sin_banco[0].monto === 800), 'Del CRM solo queda el cobro A de 800 (no pasó por este banco)', v.crm_sin_banco);

  console.log('4. Soltar e integridad');
  const conc = v.conciliados.find(b => b.abono === 1160);
  if (conc) {
    // Si se cancela el cobro ya conciliado, la revisión de integridad lo marca.
    const k = (await pedir('GET', '/leads/' + o.id + '/cobros', A))[1].cobros.find(x => x.monto === 1160);
    exigir(await pedir('POST', '/finanzas/cobros/' + k.id + '/cancelar', A, { motivo: 'Cobro duplicado de prueba' }), 'cancelar cobro');
    let integ = (await pedir('GET', '/admin/integridad', A))[1];
    revisa((integ.resultados || []).some(x => /conciliado con algo del CRM que ya se canceló/.test(x.titulo) && x.total === 1), 'La integridad avisa: un movimiento conciliado con un cobro cancelado');
    revisa((await pedir('POST', '/conciliacion/movimientos/' + conc.id + '/soltar', C, {}))[0] === 200, 'Se suelta');
    integ = (await pedir('GET', '/admin/integridad', A))[1];
    revisa(integ.errores === 0, 'Después de soltarlo, la integridad sigue sin errores', (integ.resultados || []).filter(x => x.gravedad === 'error' && x.total).map(x => x.titulo));
  }
  { const [sa, ra] = await pedir('POST', '/conciliacion/cargar', C, { cuenta_id: cta.id, filas: [{ fecha: dia(-1), concepto: 'Con importe con signo', importe: '-1,250.50' }] });
    revisa(sa === 201 && ra.nuevos === 1, 'También entiende una sola columna de importe con signo (negativo = cargo)', ra); }
  revisa((await pedir('GET', VER, V))[0] === 403, 'Ventas no ve la conciliación');
  revisa(!/TypeError|SqliteError|Error no manejado/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(x => /Error/.test(x)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
