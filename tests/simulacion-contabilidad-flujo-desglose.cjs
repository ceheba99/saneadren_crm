// EDITAR CONTABILIDAD · parte 4 (2026-11-12): desglosar un pago y agregar movimientos que no pasaron por el sistema.
//  · Caso 9 de la hoja de Dirección: una transferencia de $9,022.76 a COMBUCENTAR con una factura, repartida por unidad.
//    Los renglones del desglose van debajo con el mismo número (K), sin egreso ni saldo; el de arriba suma su monto CFDI y
//    dice DESGLOSADO o X DESGLOSAR. No puede pasar del pago. Se quita un renglón sin borrarlo.
//  · Los gastos comprobados con un anticipo salen solos debajo de la entrega (no se editan aquí).
//  · Movimientos propios (traspaso, comisión…): cuentan en el saldo de su cuenta, se cancelan con motivo, nunca se borran.
//  · Mes cerrado: solo Dirección. Quién: Dirección, el Gerente y el Contador.
// Uso: node tests/simulacion-contabilidad-flujo-desglose.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-desglose-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Desglose-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Desglose-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9750 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 800) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), MES = HOY.slice(0, 7);
const [ay, am] = MES.split('-').map(Number), MP = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, '0')}`;
const manana = (() => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })();

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol');
  const rC = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + rC + '/permisos', A, { permisos: ['contabilidad.ver'] }), 'permisos');
  const usuario = async (nombre, r) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol: r, sucursales: [qro.id] }), nombre); return exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); };
  const C = (await usuario('Carmen Contadora', rC)).token, G = (await usuario('Gema Gerente', 'gerente')).token, vU = await usuario('Valeria Ventas', 'ventas'), V = vU.token;

  const santander = exigir(await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Santander operación', banco: 'Santander', terminacion: '1234', sucursal_id: qro.id }), 'cuenta');
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Desglose', telefono: '4425559944', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Patio', canal_id: canal.id, servicio_id: servicio.id, responsable_id: vU.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Desazolve', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: MP + '-01' }), 'cotización');
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'orden');
  exigir(await pedir('POST', '/leads/' + o.id + '/cobros', A, { monto: 580, metodo: 'transferencia', referencia: 'SPEI 1' }), 'cobro');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'COMBUCENTAR', categoria: 'combustible', dias_credito: 0 }), 'proveedor');
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'COMBUSTIBLE', total: 9022.76, iva: 1244.52, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'factura', factura_folio: '291256', ya_pagado: true, metodo: 'transferencia', referencia: 'R-9', cuenta_origen: 'Santander operación' }), 'pago caso 9');
  const flujo = async (t, mes = MES, extra = '') => (await pedir('GET', `/contabilidad/flujo?mes=${mes}${extra}`, t))[1];
  const guardar = (t, cambios, mes = MES) => pedir('POST', '/contabilidad/flujo/correcciones', t, { mes, cambios });
  let fl = await flujo(C); const pago = fl.flujo.find(f => f.concepto === 'COMBUSTIBLE'), cobro = fl.flujo.find(f => f.ingreso === 580);

  console.log('1. Desglosar el caso 9 por unidad');
  revisa((await pedir('POST', '/contabilidad/flujo/desglose', V, { mes: MES, ref: pago.ref }))[0] === 403, 'Ventas no desglosa');
  let [s, r] = await pedir('POST', '/contabilidad/flujo/desglose', C, { mes: MES, ref: pago.ref });
  revisa(s === 201 && r.monto_cfdi === 9022.76, 'El Contador desglosa: el primer renglón trae todo lo que falta ($9,022.76)', r);
  const h1 = r.ref;
  exigir(await guardar(C, [{ ref: h1, campo: 'cfdi_monto', valor: '4050' }, { ref: h1, campo: 'unidad', valor: 'E45' }, { ref: h1, campo: 'concepto', valor: 'COMBUSTIBLES' }]), 'ajustar el renglón 1');
  fl = await flujo(C); let p = fl.flujo.find(f => f.ref === pago.ref), hs = fl.flujo.filter(f => f.padre === pago.ref);
  revisa(p.concepto === 'X DESGLOSAR' && p.cfdi_monto === 4050 && p.por_comprobar === 4972.76 && /Falta desglosar/.test(p.revisar), 'Con $4,050 desglosados: arriba dice X DESGLOSAR, R = 4,050 y faltan 4,972.76', p);
  revisa(hs.length === 1 && hs[0].cfdi === '291256' && hs[0].tercero === 'COMBUCENTAR' && hs[0].unidad === 'E45' && hs[0].egreso === 0 && hs[0].saldo === null && hs[0].consecutivo === p.consecutivo, 'El renglón de abajo trae la factura y el proveedor del pago, su unidad, sin egreso ni saldo y con el mismo número K', hs[0]);
  r = exigir(await pedir('POST', '/contabilidad/flujo/desglose', C, { mes: MES, ref: pago.ref }), 'segundo renglón');
  revisa(r.monto_cfdi === 4972.76, 'El segundo renglón trae lo que falta ($4,972.76)', r);
  const h2 = r.ref;
  exigir(await guardar(C, [{ ref: h2, campo: 'unidad', valor: 'C33-MERCEDES' }]), 'unidad del renglón 2');
  fl = await flujo(C); p = fl.flujo.find(f => f.ref === pago.ref); hs = fl.flujo.filter(f => f.padre === pago.ref);
  const idx = fl.flujo.findIndex(f => f.ref === pago.ref);
  revisa(p.concepto === 'DESGLOSADO' && p.cfdi_monto === 9022.76 && p.por_comprobar === 0 && !/Falta desglosar|Por comprobar/.test(p.revisar), 'Cuadra: arriba dice DESGLOSADO y no queda nada por comprobar ni por desglosar', p);
  revisa(fl.flujo[idx + 1]?.padre === pago.ref && fl.flujo[idx + 2]?.padre === pago.ref, 'Los renglones del desglose van justo debajo de su pago', fl.flujo.map(f => f.ref));
  const fin = fl.flujo.filter(f => !f.es_desglose).at(-1).saldo;
  revisa(fin === 580 - 9022.76, 'El saldo se mueve una sola vez (el desglose no resta otra vez)', fin);
  revisa((await flujo(C, MES, `&cuenta=${santander.id}`)).flujo.filter(f => f.padre === pago.ref).length === 2, 'En el flujo de Santander el desglose va con su pago');
  revisa((await guardar(C, [{ ref: h2, campo: 'cfdi_monto', valor: '5000' }]))[0] === 400, 'El desglose no puede pasar del pago');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'cfdi_monto', valor: '1' }]))[0] === 400, 'En un pago desglosado, su monto CFDI no se escribe (es la suma)');
  revisa((await guardar(C, [{ ref: h2, campo: 'marca_oc', valor: 'S' }]))[0] === 400, 'En un renglón del desglose solo se cambian sus columnas');
  revisa((await pedir('POST', '/contabilidad/flujo/desglose', C, { mes: MES, ref: cobro.ref }))[0] === 400, 'Un cobro (entrada) no se desglosa');
  [s] = await pedir('POST', `/contabilidad/flujo/desglose/${h2.split(':')[1]}/quitar`, C, {});
  fl = await flujo(C); p = fl.flujo.find(f => f.ref === pago.ref);
  revisa(s === 200 && !fl.flujo.some(f => f.ref === h2) && p.concepto === 'X DESGLOSAR' && p.cfdi_monto === 4050, 'Se quita un renglón: ya no sale y arriba vuelve a X DESGLOSAR', p);
  revisa((await pedir('GET', '/contabilidad/excel?mes=' + MES, C))[1].flujo.some(f => f.ref === h1 && f.es_desglose), 'El Excel trae el desglose');

  console.log('2. Anticipo: sus gastos salen solos debajo de la entrega');
  const persona = exigir(await pedir('POST', '/personal', A, { nombre: 'Marco Antonio Herrera', puesto: 'Operador', sucursal_id: qro.id }), 'ficha');
  const ant = exigir(await pedir('POST', '/anticipos', A, { personal_id: persona.id, monto: 1000, metodo: 'transferencia', motivo: 'Casetas y combustible KFC', referencia: 'A-1' }), 'anticipo');
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'casetas_viaticos', concepto: 'Casetas', total: 339, fecha_documento: HOY, tipo_comprobante: 'factura', factura_folio: '3909053', anticipo_id: ant.id }), 'gasto del anticipo 1');
  exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diésel', total: 500, fecha_documento: HOY, tipo_comprobante: 'recibo', anticipo_id: ant.id }), 'gasto del anticipo 2');
  fl = await flujo(C); const ea = fl.flujo.find(f => f.ref === 'anticipo:' + ant.id), ha = fl.flujo.filter(f => f.padre === ea?.ref);
  revisa(ha.length === 2 && ha.every(h => h.auto && h.editable === false) && ha.find(h => h.concepto === 'Casetas')?.cfdi_monto === 339 && ha.find(h => h.concepto === 'Diésel')?.no_deducible === 500, 'Los 2 gastos del anticipo salen debajo (con factura en R, sin factura en S) y no se editan aquí', ha);
  revisa((await guardar(C, [{ ref: ha[0].ref, campo: 'unidad', valor: 'X' }]))[0] === 400 && (await pedir('POST', '/contabilidad/flujo/desglose', C, { mes: MES, ref: ea.ref }))[0] === 400, 'Ni se corrigen ni se desglosa a mano la entrega del anticipo');

  console.log('3. Movimientos que no pasaron por el sistema');
  const mov = (t, extra) => pedir('POST', '/contabilidad/flujo/movimientos', t, { fecha: HOY, tipo: 'ingreso', monto: '23548', categoria: 'traspaso', concepto: 'TRASPASO KFC', cuenta: santander.id, ...extra });
  revisa((await mov(V))[0] === 403, 'Ventas no agrega movimientos');
  revisa((await mov(C, { fecha: manana }))[0] === 400, 'Fecha futura no');
  revisa((await mov(C, { monto: '0' }))[0] === 400, 'Monto en cero no');
  revisa((await mov(C, { categoria: 'regalo' }))[0] === 400, 'Un tipo inventado no');
  revisa((await mov(C, { concepto: 'x' }))[0] === 400, 'Sin concepto no');
  revisa((await mov(C, { cuenta: 99999 }))[0] === 400, 'Una cuenta que no es de la sucursal no');
  [s, r] = await mov(C, { referencia: 'TRA-1' });
  fl = await flujo(C, MES, `&cuenta=${santander.id}`); const tr = fl.flujo.find(f => f.ref === r.ref);
  revisa(s === 201 && tr?.manual && tr.ingreso === 23548 && tr.concepto === 'TRASPASO ENTRE CUENTAS' && tr.marca_transf === 'S' && tr.por_comprobar === 0 && /Agregado a mano por Carmen Contadora/.test(tr.datos_sistema), 'El Contador agrega un traspaso: sale en Santander, marcado como agregado a mano y sin «por comprobar»', tr);
  exigir(await guardar(C, [{ ref: tr.ref, campo: 'cuenta_abono', valor: 'SANTANDER' }]), 'corregir texto del movimiento');
  revisa((await flujo(C)).flujo.find(f => f.ref === tr.ref).cuenta_abono === 'SANTANDER', 'Sus textos se corrigen como cualquier renglón');
  const g = exigir(await pedir('POST', '/contabilidad/flujo/movimientos', G, { fecha: HOY, tipo: 'egreso', monto: '0.33', categoria: 'comision', concepto: 'COMISION KONFIO', cuenta: santander.id }), 'comisión del Gerente');
  revisa((await flujo(G)).flujo.find(f => f.ref === g.ref)?.por_comprobar === 0.33, 'Una comisión sí queda por comprobar hasta que tenga su factura');
  revisa((await pedir('POST', `/contabilidad/flujo/movimientos/${g.id}/cancelar`, C, { motivo: 'no' }))[0] === 400, 'Cancelar pide motivo');
  revisa((await pedir('POST', `/contabilidad/flujo/movimientos/${g.id}/cancelar`, C, { motivo: 'Era de otra cuenta' }))[0] === 200 && !(await flujo(C)).flujo.some(f => f.ref === g.ref), 'Cancelado, deja de contar en el flujo');

  console.log('4. Saldo y mes cerrado');
  const viejo = exigir(await pedir('POST', '/contabilidad/flujo/movimientos', C, { fecha: MP + '-20', tipo: 'egreso', monto: '100', categoria: 'retiro', concepto: 'RETIRO CAJERO', cuenta: santander.id }), 'movimiento del mes pasado');
  revisa((await flujo(C, MES, `&sucursal=${qro.id}&cuenta=${santander.id}`)).saldo_inicial === -100, 'El movimiento del mes pasado cuenta en el saldo inicial de Santander de este mes');
  exigir(await pedir('POST', '/contabilidad/cierre', A, { mes: MP }), 'cerrar el mes pasado');
  revisa((await pedir('POST', `/contabilidad/flujo/movimientos/${viejo.id}/cancelar`, C, { motivo: 'Se capturó mal' }))[1].codigo === 'MES_CERRADO', 'El Contador no cancela un movimiento de un mes cerrado');
  revisa((await mov(C, { fecha: MP + '-21' }))[1].codigo === 'MES_CERRADO', 'Ni agrega uno en el mes cerrado');
  revisa((await pedir('POST', `/contabilidad/flujo/movimientos/${viejo.id}/cancelar`, A, { motivo: 'Lo corrige Dirección' }))[0] === 200, 'Dirección sí');

  console.log('5. El rastro');
  const bit = (await pedir('GET', '/auditoria?entidad=contabilidad', A))[1].map(b => b.accion);
  revisa(['desglose agregado', 'desglose corregido', 'desglose quitado', 'movimiento agregado', 'movimiento cancelado'].every(a => bit.includes(a)), 'La bitácora tiene todo lo que se hizo', [...new Set(bit)]);
  { const d = new DatabaseSync(DB); let mal = false;
    for (const q of ['DELETE FROM flujo_desglose', 'DELETE FROM flujo_movimientos', 'UPDATE flujo_movimientos SET monto_cent = 1']) try { d.exec(q); mal = true; } catch { /* */ }
    d.close(); revisa(!mal, 'Ni el desglose ni los movimientos se borran, ni cambia un importe, ni desde la base'); }

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); console.log(salida.slice(-1500)); srv.kill(); process.exit(1); });
