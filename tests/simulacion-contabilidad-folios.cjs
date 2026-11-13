// EDITAR CONTABILIDAD · parte 5 (2026-11-12): folios de banco. Cada movimiento recibe su folio ANTES de llegar al flujo,
// al registrarse con su cuenta: una serie por cuenta y por tipo (STD-I / STD-E, BNT, PAG, CAJ), SIEMPRE consecutiva (no
// empieza de nuevo cada mes), nunca se reusa ni se borra; cancelado se queda en gris; cuenta corregida = folio reasignado.
// Uso: node tests/simulacion-contabilidad-folios.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-folios-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Folios-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Folios-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9850 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
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
  const T = (await usuario('Tito Técnico', 'tecnico')).token, AT = (await usuario('Alicia Atención', 'atencion')).token;

  console.log('1. Las cuentas y su clave de folio');
  const cuentaN = async (nombre, banco, clave) => exigir(await pedir('POST', '/conciliacion/cuentas', A, { nombre, banco, sucursal_id: qro.id, ...(clave ? { clave_folio: clave } : {}) }), 'cuenta ' + nombre).id;
  const STD = await cuentaN('Santander operación', 'Santander', 'std'), BNT = await cuentaN('Banorte pagos', 'Banorte', 'BNT'), PAG = await cuentaN('Pagadora', 'Pagadora', 'PAG'), CAJ = await cuentaN('Caja', 'Caja (efectivo)', 'CAJ');
  revisa((await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Otra Santander', banco: 'Santander', sucursal_id: qro.id, clave_folio: 'STD' }))[0] === 409, 'La clave STD no se repite en otra cuenta');
  revisa((await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Rara', banco: 'Otro', sucursal_id: qro.id, clave_folio: 'S T D' }))[0] === 400, 'Una clave con espacios se rechaza');
  let [s, r] = await pedir('GET', '/cuentas-banco', AT); // 2026-11-13: confirman cobros Gerente y Atención (Ventas ya no)
  revisa(s === 200 && r.requiere === true && r.cuentas.find(c => c.id === STD)?.clave_folio === 'STD', 'Quien confirma cobros (Atención) ve las cuentas para elegir; la clave se guarda en mayúsculas', r);
  revisa((await pedir('GET', '/cuentas-banco', T))[0] === 403, 'El técnico (no confirma ni paga) no las ve');
  revisa((await pedir('POST', `/cuentas-banco/${STD}/clave`, V, { clave: 'SAN' }))[0] === 403, 'Ventas no cambia la clave');

  // Datos: una orden y un proveedor.
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Folios', telefono: '4425559955', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Patio', canal_id: canal.id, servicio_id: servicio.id, responsable_id: vU.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Desazolve', importe: 10000 }]), iva_modo: 'mas_iva', valor: 10000, fecha_cotizacion: MP + '-01' }), 'cotización');
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'orden');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Combustibles Folio', categoria: 'combustible', dias_credito: 0 }), 'proveedor');
  const gasto = async (concepto, total) => exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto, total, fecha_documento: HOY, dias_credito: 0, tipo_comprobante: 'recibo' }), 'gasto ' + concepto).id;
  const pagar = (t, cxp, monto, cuenta, extra = {}) => pedir('POST', `/finanzas/cxp/${cxp}/pagos`, t, { monto, metodo: 'transferencia', ...(cuenta ? { cuenta_id: cuenta } : {}), ...extra });
  const folioDe = async ref => { const d = new DatabaseSync(DB); const x = d.prepare("SELECT folio FROM folios_banco WHERE ref = ? AND estado = 'vigente'").get(ref); d.close(); return x?.folio || null; };

  console.log('2. Pagos: el folio nace al pagar, por cuenta y consecutivo');
  const g1 = await gasto('Diésel uno', 1000), g2 = await gasto('Diésel dos', 2000), g3 = await gasto('Diésel tres', 3000);
  [s, r] = await pagar(A, g1, 100);
  revisa(s === 400 && r.codigo === 'FALTA_CUENTA', 'Sin cuenta no se paga (ya hay cuentas con clave)', r);
  const p1 = exigir(await pagar(A, g1, 100, STD), 'pago 1').id, p2 = exigir(await pagar(A, g1, 200, STD), 'pago 2').id, p3 = exigir(await pagar(G, g2, 300, BNT), 'pago 3').id, p4 = exigir(await pagar(A, g3, 400, PAG), 'pago 4').id;
  revisa(await folioDe('pago:' + p1) === 'STD-E-0001' && await folioDe('pago:' + p2) === 'STD-E-0002' && await folioDe('pago:' + p3) === 'BNT-E-0001' && await folioDe('pago:' + p4) === 'PAG-E-0001', 'Santander E-0001 y E-0002, Banorte E-0001, Pagadora E-0001', [await folioDe('pago:' + p1), await folioDe('pago:' + p2), await folioDe('pago:' + p3), await folioDe('pago:' + p4)]);
  revisa((await pagar(A, g1, 1, 99999))[0] === 400, 'Una cuenta que no existe se rechaza');

  console.log('3. Cobros: el folio nace al confirmar (entradas con su propia serie)');
  const k1 = exigir(await pedir('POST', `/leads/${o.id}/cobros`, V, { monto: 500, metodo: 'transferencia' }), 'cobro de ventas (por confirmar)').id;
  revisa(!(await folioDe('cobro:' + k1)), 'Un cobro por confirmar todavía no tiene folio (no está en el flujo)');
  revisa((await pedir('POST', `/finanzas/cobros/${k1}/confirmar`, G, {}))[1].codigo === 'FALTA_CUENTA', 'Al confirmarlo hay que decir a qué cuenta entró');
  exigir(await pedir('POST', `/finanzas/cobros/${k1}/confirmar`, G, { cuenta_id: STD }), 'confirmar');
  revisa(await folioDe('cobro:' + k1) === 'STD-I-0001', 'Confirmado en Santander: STD-I-0001 (la serie de entradas va aparte)', await folioDe('cobro:' + k1));
  revisa((await pedir('POST', `/leads/${o.id}/cobros`, AT, { monto: 100, metodo: 'efectivo' }))[1].codigo === 'FALTA_CUENTA', 'Quien registra cobros ya confirmados (Atención) dice la cuenta');
  const k2 = exigir(await pedir('POST', `/leads/${o.id}/cobros`, AT, { monto: 100, metodo: 'efectivo', cuenta_id: CAJ }), 'cobro en efectivo').id;
  revisa(await folioDe('cobro:' + k2) === 'CAJ-I-0001', 'Efectivo a la Caja: CAJ-I-0001', await folioDe('cobro:' + k2));

  console.log('4. Anticipo, reintegro, movimiento propio y conciliación');
  const persona = exigir(await pedir('POST', '/personal', A, { nombre: 'Luis Ángel Perea', puesto: 'Operador', sucursal_id: qro.id }), 'ficha');
  revisa((await pedir('POST', '/anticipos', A, { personal_id: persona.id, monto: 700, metodo: 'transferencia', motivo: 'Gastos de la ruta' }))[1].codigo === 'FALTA_CUENTA', 'El anticipo pide la cuenta');
  const an = exigir(await pedir('POST', '/anticipos', A, { personal_id: persona.id, monto: 700, metodo: 'transferencia', motivo: 'Gastos de la ruta', cuenta_id: STD }), 'anticipo').id;
  revisa(await folioDe('anticipo:' + an) === 'STD-E-0003', 'La entrega del anticipo sigue la serie de Santander: STD-E-0003', await folioDe('anticipo:' + an));
  revisa((await pedir('POST', `/anticipos/${an}/cerrar`, A, { metodo: 'efectivo' }))[1].codigo === 'FALTA_CUENTA', 'Al cerrarlo con reintegro, pide a qué cuenta regresó');
  exigir(await pedir('POST', `/anticipos/${an}/cerrar`, A, { metodo: 'efectivo', cuenta_id: CAJ }), 'cerrar con reintegro');
  revisa(await folioDe('reintegro:' + an) === 'CAJ-I-0002', 'El reintegro a la Caja: CAJ-I-0002', await folioDe('reintegro:' + an));
  revisa((await pedir('POST', '/contabilidad/flujo/movimientos', C, { sucursal: qro.id, fecha: HOY, tipo: 'ingreso', monto: '23548', categoria: 'traspaso', concepto: 'TRASPASO KFC', cuenta: 0 }))[1].codigo === 'FALTA_CUENTA', 'Un movimiento propio también pide su cuenta');
  const mv = exigir(await pedir('POST', '/contabilidad/flujo/movimientos', C, { sucursal: qro.id, fecha: HOY, tipo: 'ingreso', monto: '23548', categoria: 'traspaso', concepto: 'TRASPASO KFC', cuenta: BNT }), 'traspaso').id;
  revisa(await folioDe('manual:' + mv) === 'BNT-I-0001', 'El traspaso a Banorte: BNT-I-0001', await folioDe('manual:' + mv));
  exigir(await pedir('POST', '/conciliacion/cargar', A, { cuenta_id: BNT, filas: [{ fecha: HOY, concepto: 'COMISION', cargo: '17.40', abono: '' }] }), 'estado de cuenta');
  const movB = (await pedir('GET', `/conciliacion?mes=${MES}&cuenta=${BNT}`, A))[1].banco_sin_crm.find(b => b.cargo === 17.4);
  exigir(await pedir('POST', `/conciliacion/movimientos/${movB.id}/gasto`, A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Comisión bancaria' }), 'gasto desde la conciliación');
  const d0 = new DatabaseSync(DB), pc = d0.prepare("SELECT conciliado_id FROM movimientos_banco WHERE id = ?").get(movB.id).conciliado_id; d0.close();
  revisa(await folioDe('pago:' + pc) === 'BNT-E-0002', 'El cargo registrado desde el estado de cuenta de Banorte: BNT-E-0002', await folioDe('pago:' + pc));

  console.log('5. En el flujo');
  let fl = (await pedir('GET', `/contabilidad/flujo?mes=${MES}&cuenta=${STD}`, C))[1];
  const ks = fl.flujo.map(f => f.consecutivo);
  revisa(JSON.stringify(ks.slice().sort()) === JSON.stringify(['STD-E-0001', 'STD-E-0002', 'STD-E-0003', 'STD-I-0001']), 'La columna K del flujo de Santander trae sus folios (entradas y salidas)', ks);
  revisa(fl.sin_folio === 0, 'No queda nada sin folio', fl.sin_folio);

  console.log('6. Nunca se reusa ni se mueve');
  exigir(await pedir('POST', `/finanzas/pagos-proveedor/${p1}/cancelar`, A, { motivo: 'Pago duplicado' }), 'cancelar STD-E-0001');
  const p5 = exigir(await pagar(A, g1, 50, STD), 'pago 5').id;
  revisa(await folioDe('pago:' + p5) === 'STD-E-0004', 'Después de cancelar el 0001, el siguiente es STD-E-0004 (no se reusa)', await folioDe('pago:' + p5));
  fl = (await pedir('GET', `/contabilidad/flujo?mes=${MES}&cuenta=${STD}`, C))[1];
  const gris = fl.flujo.find(f => f.consecutivo === 'STD-E-0001');
  revisa(gris?.fantasma && gris.concepto === 'CANCELADO' && gris.egreso === 0 && gris.editable === false, 'El 0001 cancelado se queda en el flujo, en gris, sin importe', gris);
  // Un pago con fecha del mes pasado registrado hoy: sigue la serie (no empieza de nuevo por mes).
  const p6 = exigir(await pagar(A, g2, 60, STD, { fecha: MP + '-28' }), 'pago con fecha del mes pasado').id;
  revisa(await folioDe('pago:' + p6) === 'STD-E-0005', 'Un pago con fecha del mes pasado recibe el siguiente: STD-E-0005 (siempre consecutivo)', await folioDe('pago:' + p6));
  // La cuenta estaba mal: el folio se reasigna.
  [s, r] = await pedir('POST', '/contabilidad/flujo/correcciones', C, { mes: MES, cambios: [{ ref: 'pago:' + p2, campo: 'cuenta_id', valor: String(BNT) }] });
  revisa(s === 200 && await folioDe('pago:' + p2) === 'BNT-E-0003', 'Al corregir la cuenta a Banorte, el pago recibe BNT-E-0003', [s, r, await folioDe('pago:' + p2)]);
  fl = (await pedir('GET', `/contabilidad/flujo?mes=${MES}&cuenta=${STD}`, C))[1];
  revisa(fl.flujo.find(f => f.consecutivo === 'STD-E-0002')?.concepto === 'CAMBIÓ A BNT-E-0003', 'Y en Santander el 0002 dice «CAMBIÓ A BNT-E-0003»', fl.flujo.map(f => [f.consecutivo, f.concepto]));
  revisa((await pedir('POST', `/cuentas-banco/${STD}/clave`, A, { clave: 'SAN' }))[0] === 409, 'Una cuenta con folios ya no cambia de clave');

  console.log('7. Cuenta sin clave y folios pendientes');
  const BBV = await cuentaN('BBVA nueva', 'BBVA', null);
  const p7 = exigir(await pagar(A, g3, 70, BBV), 'pago a una cuenta sin clave').id;
  fl = (await pedir('GET', `/contabilidad/flujo?mes=${MES}`, C))[1];
  revisa(!(await folioDe('pago:' + p7)) && fl.sin_folio === 1 && /Sin folio/.test(fl.flujo.find(f => f.ref === 'pago:' + p7)?.revisar), 'Sin clave no hay folio, y el flujo lo avisa', fl.sin_folio);
  exigir(await pedir('POST', `/cuentas-banco/${BBV}/clave`, C, { clave: 'BBV' }), 'poner clave');
  [s, r] = await pedir('POST', '/contabilidad/flujo/folios-pendientes', C, {});
  revisa(s === 200 && r.asignados === 1 && await folioDe('pago:' + p7) === 'BBV-E-0001', 'Con la clave puesta, «Asignar folios pendientes» le da BBV-E-0001', [r, await folioDe('pago:' + p7)]);

  console.log('8. El rastro');
  { const d = new DatabaseSync(DB); let mal = false;
    for (const q of ['DELETE FROM folios_banco', 'UPDATE folios_banco SET numero = 99', "UPDATE folios_banco SET folio = 'X'"]) try { d.exec(q); mal = true; } catch { /* */ }
    d.close(); revisa(!mal, 'Un folio no se borra ni cambia su número, ni desde la base'); }
  const bit = (await pedir('GET', '/auditoria?entidad=contabilidad', A))[1].map(b => b.accion);
  revisa(bit.includes('folio reasignado') && bit.includes('folios asignados'), 'La bitácora tiene la reasignación y los folios pendientes', [...new Set(bit)]);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); console.log(salida.slice(-2500)); srv.kill(); process.exit(1); });
