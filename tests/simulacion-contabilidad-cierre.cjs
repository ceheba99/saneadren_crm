// EDITAR CONTABILIDAD · parte 1 (2026-11-12): el mes cerrado y el saldo inicial del banco guardado en el sistema.
//  · Cierran Dirección y quien tenga «Cerrar el mes de contabilidad» (el Contador); el Gerente y quien solo ve no.
//  · Solo un mes que ya terminó. Cerrado, solo Dirección registra, confirma, corrige o cancela cobros, pagos y anticipos
//    con fecha de ese mes (desde cualquier pantalla), y cambia su saldo inicial. Reabrir: solo Dirección, con motivo.
//  · Todo deja rastro (quién, cuándo, valor anterior) y el rastro no se borra.
// Uso: node tests/simulacion-contabilidad-cierre.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cierre-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Cierre-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Cierre-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9450 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), MES = HOY.slice(0, 7);
const [ay, am] = MES.split('-').map(Number), MP = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, '0')}`; // el mes pasado
const DP = MP + '-10', DP2 = MP + '-20';
const cerrada = (r) => r[0] === 409 && r[1].codigo === 'MES_CERRADO';

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const rol = async (nombre, permisos) => { exigir(await pedir('POST', '/roles', A, { nombre, base: '' }), 'rol ' + nombre); const c = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === nombre).clave; exigir(await pedir('PUT', '/roles/' + c + '/permisos', A, { permisos }), 'permisos ' + nombre); return c; };
  const rContador = await rol('Contador', ['contabilidad.ver', 'contabilidad.cerrar']), rAuxiliar = await rol('Auxiliar contable', ['contabilidad.ver']);
  const usuario = async (nombre, r) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol: r, sucursales: [qro.id] }), nombre); return exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); };
  const C = (await usuario('Carmen Contadora', rContador)).token, X = (await usuario('Xóchitl Auxiliar', rAuxiliar)).token, G = (await usuario('Gema Gerente', 'gerente')).token;
  const vU = await usuario('Valeria Ventas', 'ventas'), V = vU.token, K = (await usuario('Carlos Compras', 'costos')).token;

  // Datos del mes pasado: una orden con un cobro confirmado y otro por confirmar, un gasto pagado y un anticipo.
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Cierre', telefono: '4425559911', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Patio', canal_id: canal.id, servicio_id: servicio.id, responsable_id: vU.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Desazolve', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: MP + '-01' }), 'cotización');
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'orden');
  const k1 = exigir(await pedir('POST', '/leads/' + o.id + '/cobros', A, { monto: 300, metodo: 'transferencia', fecha: DP }), 'cobro del mes pasado');
  const k2 = exigir(await pedir('POST', '/leads/' + o.id + '/cobros', V, { monto: 100, metodo: 'efectivo', fecha: DP }), 'cobro por confirmar del mes pasado');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Ferretería Cierre', categoria: 'combustible', dias_credito: 0 }), 'proveedor');
  const g1 = exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Mangueras', total: 200, fecha_documento: DP, dias_credito: 0, tipo_comprobante: 'recibo', ya_pagado: true, metodo: 'transferencia', fecha_pago: DP }), 'gasto pagado');
  const g2 = exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Codos por pagar', total: 500, fecha_documento: DP, dias_credito: 0, tipo_comprobante: 'recibo' }), 'gasto por pagar');
  const pago1 = (await pedir('GET', '/finanzas/cxp/' + g1.id + '/pagos', A))[1][0];
  const persona = exigir(await pedir('POST', '/personal', A, { nombre: 'Tomás Técnico', puesto: 'Operador', sucursal_id: qro.id }), 'ficha');
  const an1 = exigir(await pedir('POST', '/anticipos', A, { personal_id: persona.id, monto: 400, metodo: 'efectivo', motivo: 'Casetas de la ruta', fecha: DP }), 'anticipo del mes pasado');
  const an2 = exigir(await pedir('POST', '/anticipos', A, { personal_id: persona.id, monto: 150, metodo: 'efectivo', motivo: 'Comidas de la cuadrilla', fecha: DP2 }), 'otro anticipo del mes pasado');

  console.log('1. Quién cierra el mes');
  revisa((await pedir('POST', '/contabilidad/cierre', C, { mes: MES }))[0] === 400, 'El mes en curso no se cierra (todavía no termina)');
  for (const [t, quien] of [[G, 'El Gerente'], [X, 'Quien solo ve la contabilidad'], [V, 'Ventas'], [K, 'Compras']]) revisa((await pedir('POST', '/contabilidad/cierre', t, { mes: MP }))[0] === 403, quien + ' no cierra el mes');
  let [s, r] = await pedir('GET', '/contabilidad/cierre?mes=' + MP, C);
  revisa(s === 200 && r.cerrado === false && r.puede_cerrar === true && r.puede_reabrir === false, 'El Contador ve el mes abierto y puede cerrarlo, no reabrirlo', r);
  revisa((await pedir('GET', '/contabilidad/cierre?mes=' + MP, V))[0] === 403, 'Ventas no ve el estado del cierre');
  // El saldo inicial se escribe con el mes abierto (lo guarda el Contador).
  [s, r] = await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MP, sucursal: qro.id, saldo: '10000.50' });
  revisa(s === 200 && r.saldo === 10000.5 && r.escrito === true && r.historial[0].usuario === 'Carmen Contadora', 'El Contador guarda el saldo inicial del mes abierto, con su nombre', r);
  revisa((await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MP, sucursal: qro.id, saldo: '12,5' }))[0] === 400, 'Un saldo mal escrito se rechaza');
  revisa((await pedir('POST', '/contabilidad/saldo-inicial', V, { mes: MP, sucursal: qro.id, saldo: '1' }))[0] === 403, 'Ventas no cambia el saldo inicial');
  [s, r] = await pedir('GET', '/contabilidad/excel?mes=' + MP + '&sucursal=' + qro.id, X);
  const fin = r.flujo?.length ? r.flujo[r.flujo.length - 1].saldo : null;
  revisa(s === 200 && r.saldo_inicial === 10000.5 && r.saldo_inicial_crm === 0 && fin === 10000.5 + 300 - 200 - 400 - 150, 'El flujo de banco usa el saldo guardado para todos (también para quien solo ve)', { ini: r.saldo_inicial, crm: r.saldo_inicial_crm, fin });
  [s, r] = await pedir('POST', '/contabilidad/cierre', C, { mes: MP });
  revisa(s === 201 && r.cerrado === true && r.cerradas === 1 && r.sucursales[0].ultimo.usuario === 'Carmen Contadora', 'El Contador cierra el mes pasado', r);
  revisa((await pedir('POST', '/contabilidad/cierre', C, { mes: MP }))[1].cerradas === 0, 'Cerrarlo otra vez no repite el cierre');

  console.log('2. Mes cerrado: nadie más que Dirección cambia sus movimientos');
  revisa(cerrada(await pedir('POST', '/leads/' + o.id + '/cobros', V, { monto: 50, metodo: 'efectivo', fecha: DP2 })), 'Ventas no registra un cobro con fecha del mes cerrado');
  revisa(cerrada(await pedir('POST', '/leads/' + o.id + '/cobros', G, { monto: 50, metodo: 'efectivo', fecha: DP2 })), 'El Gerente tampoco');
  revisa(cerrada(await pedir('POST', '/finanzas/cobros/' + k2.id + '/confirmar', G, {})), 'El Gerente no confirma un cobro del mes cerrado (cambiaría el flujo de banco)');
  revisa(cerrada(await pedir('POST', '/finanzas/cobros/' + k1.id + '/cancelar', G, { motivo: 'Se capturó dos veces' })), 'El Gerente no cancela un cobro del mes cerrado');
  revisa(cerrada(await pedir('POST', '/finanzas/cxp/' + g2.id + '/pagos', K, { monto: 100, metodo: 'transferencia', fecha: DP2 })), 'Compras no registra un pago con fecha del mes cerrado');
  revisa(cerrada(await pedir('POST', '/finanzas/pagos-proveedor/' + pago1.id + '/cancelar', G, { motivo: 'Pago equivocado' })), 'El Gerente no cancela un pago del mes cerrado');
  revisa(cerrada(await pedir('POST', '/finanzas/cxp', G, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Tubo pagado al registrar', total: 80, fecha_documento: DP2, dias_credito: 0, tipo_comprobante: 'recibo', ya_pagado: true, metodo: 'efectivo', fecha_pago: DP2 })), 'Un gasto «ya pagado» con fecha de pago del mes cerrado tampoco entra (y no queda el gasto a medias)');
  revisa(Array.isArray((await pedir('GET', '/finanzas/cxp?vista=todas', A))[1]) && !(await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].some(x => x.concepto === 'Tubo pagado al registrar'), 'El gasto rechazado no quedó guardado sin su pago');
  // Gastos (2026-11-13): el gasto cuenta en el mes de su fecha de documento, aunque no se haya pagado.
  revisa(cerrada(await pedir('POST', '/finanzas/cxp', G, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasto atrasado por pagar', total: 70, fecha_documento: DP2, dias_credito: 0, tipo_comprobante: 'recibo' })), 'El Gerente no registra un gasto (aunque sea por pagar) con fecha del mes cerrado');
  revisa(!(await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].some(x => x.concepto === 'Gasto atrasado por pagar'), 'El gasto rechazado no quedó guardado');
  revisa(cerrada(await pedir('POST', '/finanzas/cxp/' + g2.id + '/cancelar', G, { motivo: 'Se capturó dos veces' })), 'El Gerente no cancela un gasto del mes cerrado');
  revisa(cerrada(await pedir('POST', '/anticipos', G, { personal_id: persona.id, monto: 90, metodo: 'efectivo', motivo: 'Casetas atrasadas', fecha: DP2 })), 'El Gerente no entrega un anticipo con fecha del mes cerrado');
  revisa(cerrada(await pedir('POST', '/anticipos/' + an2.id + '/cancelar', G, { motivo: 'Se capturó mal' })), 'El Gerente no cancela un anticipo entregado en el mes cerrado');
  revisa(cerrada(await pedir('POST', '/contabilidad/saldo-inicial', C, { mes: MP, sucursal: qro.id, saldo: '1' })), 'El Contador ya no cambia el saldo inicial del mes cerrado');
  console.log('   … lo del mes abierto sigue normal');
  revisa((await pedir('POST', '/leads/' + o.id + '/cobros', G, { monto: 50, metodo: 'efectivo' }))[0] === 201, 'El Gerente sí registra un cobro de hoy');
  revisa((await pedir('POST', '/finanzas/cxp/' + g2.id + '/pagos', K, { monto: 100, metodo: 'transferencia' }))[0] === 201, 'Compras sí paga con fecha de hoy un gasto del mes cerrado');
  [s, r] = await pedir('POST', '/anticipos/' + an1.id + '/cerrar', G, { metodo: 'efectivo' });
  revisa(s === 200 && r.reintegro === 400, 'Cerrar hoy un anticipo del mes cerrado sí se puede: el reintegro cae en este mes', r);
  console.log('   … y Dirección sí corrige');
  revisa((await pedir('POST', '/finanzas/pagos-proveedor/' + pago1.id + '/cancelar', A, { motivo: 'Pago equivocado' }))[0] === 200, 'Dirección cancela un pago del mes cerrado');
  revisa((await pedir('POST', '/leads/' + o.id + '/cobros', A, { monto: 20, metodo: 'efectivo', fecha: DP2 }))[0] === 201, 'Dirección registra un cobro con fecha del mes cerrado');
  revisa((await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasto que faltaba', total: 70, fecha_documento: DP2, dias_credito: 0, tipo_comprobante: 'recibo' }))[0] === 201, 'Dirección registra un gasto con fecha del mes cerrado');
  revisa((await pedir('POST', '/finanzas/cxp', G, { proveedor_id: prov.id, categoria: 'combustible', concepto: 'Gasto de hoy', total: 70, dias_credito: 0, tipo_comprobante: 'recibo' }))[0] === 201, 'El Gerente sí registra un gasto de hoy');
  [s, r] = await pedir('POST', '/contabilidad/saldo-inicial', A, { mes: MP, sucursal: qro.id, saldo: null });
  revisa(s === 200 && r.escrito === false && r.saldo === 0 && r.historial.length === 2 && r.historial[1].saldo === 10000.5 && r.historial[1].usuario === 'Carmen Contadora', 'Dirección regresa el saldo al del CRM; el historial guarda el anterior y quién lo puso', r);

  console.log('3. Reabrir');
  revisa((await pedir('POST', '/contabilidad/cierre/reabrir', C, { mes: MP, sucursal: qro.id, motivo: 'Falta un cobro' }))[0] === 403, 'El Contador no reabre');
  revisa((await pedir('POST', '/contabilidad/cierre/reabrir', A, { mes: MP, sucursal: qro.id, motivo: 'no' }))[0] === 400, 'Sin motivo no se reabre');
  [s, r] = await pedir('POST', '/contabilidad/cierre/reabrir', A, { mes: MP, sucursal: qro.id, motivo: 'Falta capturar un cobro del banco' });
  revisa(s === 200 && r.cerrado === false && r.sucursales[0].historial.length === 2 && r.sucursales[0].ultimo.motivo === 'Falta capturar un cobro del banco', 'Dirección reabre con motivo; el cierre anterior sigue en el historial', r);
  revisa((await pedir('POST', '/finanzas/cobros/' + k2.id + '/confirmar', G, {}))[0] === 200, 'Reabierto, el Gerente ya confirma el cobro del mes pasado');

  console.log('4. El rastro');
  const bit = (await pedir('GET', '/auditoria?entidad=contabilidad', A))[1];
  revisa(Array.isArray(bit) && ['mes cerrado', 'mes reabierto', 'saldo inicial'].every(a => bit.some(b => b.accion === a)), 'La bitácora tiene el cierre, la reapertura y los cambios de saldo', bit);
  revisa(bit.some(b => b.accion === 'saldo inicial' && /\$10,000\.50 → \$0\.00 \(el calculado\)/.test(b.detalle)), 'El cambio de saldo dice el valor anterior → el nuevo', bit.filter(b => b.accion === 'saldo inicial'));
  { const d = new DatabaseSync(DB); let borro = false, cambio = false;
    try { d.exec('DELETE FROM contabilidad_cierres'); borro = true; } catch { /* */ }
    try { d.exec("UPDATE flujo_saldos_iniciales SET saldo_cent = 1"); cambio = true; } catch { /* */ }
    d.close(); revisa(!borro && !cambio, 'El historial de cierres y saldos no se borra ni se cambia ni desde la base'); }

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); console.log(salida.slice(-1500)); srv.kill(); process.exit(1); });
