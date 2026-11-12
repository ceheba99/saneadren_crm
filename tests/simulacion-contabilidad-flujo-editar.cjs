// EDITAR CONTABILIDAD · parte 3 (2026-11-12): corregir celdas del Flujo de banco («Editar tabla», «Guardar cambios»,
// «Bloquear edición»). La corrección queda encima del dato del sistema con quién, cuándo y el valor anterior; se puede
// regresar al del sistema; todo junto o nada; el saldo, X comprobar, importes y fechas no se tocan aquí. Corrigen
// Dirección, el Gerente y quien tiene «Contabilidad del mes»; un mes cerrado, solo Dirección.
// Uso: node tests/simulacion-contabilidad-flujo-editar.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-flujoed-')), DB = path.join(dir, 'c.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'FlujoEd-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-FlujoEd-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9650 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
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
  const C = (await usuario('Carmen Contadora', rC)).token, G = (await usuario('Gema Gerente', 'gerente')).token, vU = await usuario('Valeria Ventas', 'ventas'), V = vU.token, K = (await usuario('Carlos Compras', 'costos')).token;

  const santander = exigir(await pedir('POST', '/conciliacion/cuentas', A, { nombre: 'Santander operación', banco: 'Santander', terminacion: '1234', sucursal_id: qro.id }), 'cuenta');
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', A, { nombre: 'Cliente Edita', telefono: '4425559933', canal_origen_id: canal.id }), 'cliente');
  const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Patio', canal_id: canal.id, servicio_id: servicio.id, responsable_id: vU.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Desazolve', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: MP + '-01' }), 'cotización');
  const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'orden');
  exigir(await pedir('POST', '/leads/' + o.id + '/cobros', A, { monto: 580, metodo: 'transferencia', referencia: 'SPEI 1' }), 'cobro');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Proveedor Edita', categoria: 'combustible', dias_credito: 0 }), 'proveedor');
  const gasto = (extra) => pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'combustible', dias_credito: 0, ya_pagado: true, metodo: 'transferencia', tipo_comprobante: 'sin_factura', ...extra });
  exigir(await gasto({ concepto: 'Pago facturas Marco', total: 1000, fecha_documento: HOY, referencia: 'R-9', cuenta_origen: 'Santander operación' }), 'pago');
  exigir(await gasto({ concepto: 'Pago del mes pasado', total: 300, fecha_documento: MP + '-12', fecha_pago: MP + '-12' }), 'pago del mes pasado');
  const flujo = async (t, mes = MES, extra = '') => (await pedir('GET', `/contabilidad/flujo?mes=${mes}${extra}`, t))[1];
  let fl = await flujo(C); const cobro = fl.flujo.find(f => f.ingreso === 580), pago = fl.flujo.find(f => f.concepto === 'Pago facturas Marco');
  const guardar = (t, cambios, mes = MES) => pedir('POST', '/contabilidad/flujo/correcciones', t, { mes, cambios });

  console.log('1. Quién corrige');
  revisa(fl.puede_editar === true && cobro.editable === true && fl.editables.includes('cuenta_id') && !fl.editables.includes('egreso'), 'El Contador puede editar; el saldo y los importes no están entre lo editable', fl.editables);
  revisa((await guardar(V, [{ ref: cobro.ref, campo: 'observaciones_z', valor: 'x' }]))[0] === 403, 'Ventas no corrige el flujo');
  revisa((await guardar(K, [{ ref: cobro.ref, campo: 'observaciones_z', valor: 'x' }]))[0] === 403, 'Compras (mueve dinero pero no ve la contabilidad) tampoco');
  revisa((await guardar(G, [{ ref: pago.ref, campo: 'unidad', valor: 'E39-F350' }]))[0] === 200, 'El Gerente sí');

  console.log('2. Guardar cambios: varias celdas a la vez');
  let [s, r] = await guardar(C, [{ ref: cobro.ref, campo: 'cuenta_id', valor: String(santander.id) }, { ref: cobro.ref, campo: 'marca_comp', valor: 's' }, { ref: pago.ref, campo: 'concepto_banco', valor: 'PAGO FACTURAS' },
    { ref: pago.ref, campo: 'cfdi_monto', valor: '$600.50' }, { ref: pago.ref, campo: 'observaciones_z', valor: '  falta  la de casetas ' }, { ref: pago.ref, campo: 'proyecto', valor: 'KFC' }]);
  revisa(s === 200 && r.guardados === 6, 'Se guardan 6 correcciones juntas', r);
  fl = await flujo(C);
  const c2 = fl.flujo.find(f => f.ref === cobro.ref), p2 = fl.flujo.find(f => f.ref === pago.ref);
  revisa(c2.cuenta === 'Santander operación' && c2.marca_comp === 'S' && c2.corregido?.cuenta_id?.sistema === 0 && c2.corregido.marca_comp.sistema === 'FALTA' && c2.corregido.marca_comp.usuario === 'Carmen Contadora', 'El cobro pasó a Santander y su C a S; se sabe qué decía el sistema y quién lo cambió', c2);
  revisa(p2.concepto_banco === 'PAGO FACTURAS' && p2.cfdi_monto === 600.5 && p2.no_deducible === 1000 && p2.observaciones_z === 'falta la de casetas' && p2.proyecto === 'KFC' && p2.unidad === 'E39-F350', 'El pago trae sus textos y el monto CFDI corregidos', p2);
  revisa(p2.corregido.cfdi_monto.sistema === 0 && p2.egreso === 1000, 'Lo que decía el sistema en el monto CFDI se guarda en pesos; el importe del pago no cambia', p2.corregido);
  const s2 = await flujo(C, MES, `&cuenta=${santander.id}`);
  revisa(s2.flujo.some(f => f.ref === cobro.ref) && !(await flujo(C, MES, '&cuenta=0')).flujo.some(f => f.ref === cobro.ref), 'Con la cuenta corregida, el cobro sale en el flujo de Santander y ya no en «Sin cuenta»');
  const ex = (await pedir('GET', '/contabilidad/excel?mes=' + MES, C))[1];
  revisa(ex.flujo.find(f => f.ref === pago.ref)?.concepto_banco === 'PAGO FACTURAS', 'El Excel trae lo corregido');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'proyecto', valor: 'KFC' }]))[1].guardados === 0, 'Guardar el mismo valor no deja otro renglón');

  console.log('3. Volver al dato del sistema');
  [s, r] = await guardar(C, [{ ref: pago.ref, campo: 'proyecto', valor: null }]);
  const p3 = (await flujo(C)).flujo.find(f => f.ref === pago.ref);
  revisa(s === 200 && r.guardados === 1 && p3.proyecto === qro.clave && !p3.corregido?.proyecto, 'Con «volver al del sistema» el proyecto regresa a la sucursal', p3);

  console.log('4. Lo que no se acepta (y nada se guarda a medias)');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'egreso', valor: '1' }]))[0] === 400, 'El importe no se corrige aquí');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'saldo', valor: '1' }]))[0] === 400, 'El saldo tampoco');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'marca_oc', valor: 'DOMICILIADO' }]))[0] === 400, 'B solo acepta S, FALTA o NA');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'no_deducible', valor: '-5' }]))[0] === 400, 'Un monto negativo se rechaza');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'cuenta_id', valor: '99999' }]))[0] === 400, 'Una cuenta que no es de la sucursal se rechaza');
  revisa((await guardar(C, [{ ref: 'pago:99999', campo: 'concepto', valor: 'x' }]))[0] === 404, 'Un renglón que no existe se rechaza');
  revisa((await guardar(C, [{ ref: pago.ref, campo: 'concepto', valor: 'x'.repeat(301) }]))[0] === 400, 'Más de 300 letras se rechaza');
  revisa((await guardar(C, []))[0] === 400, 'Sin cambios no hay nada que guardar');
  [s] = await guardar(C, [{ ref: pago.ref, campo: 'tercero', valor: 'MARCO ANTONIO HERRERA' }, { ref: pago.ref, campo: 'marca_comp', valor: 'QUIZÁ' }]);
  revisa(s === 400 && (await flujo(C)).flujo.find(f => f.ref === pago.ref).tercero === 'Proveedor Edita', 'Si un cambio está mal, no se guarda ninguno');

  console.log('5. Mes cerrado');
  const viejo = (await flujo(C, MP)).flujo.find(f => f.concepto === 'Pago del mes pasado');
  exigir(await pedir('POST', '/contabilidad/cierre', A, { mes: MP }), 'cerrar el mes pasado');
  revisa((await flujo(C, MP)).flujo.find(f => f.ref === viejo.ref).editable === false && (await flujo(A, MP)).flujo.find(f => f.ref === viejo.ref).editable === true, 'En el mes cerrado el renglón ya no es editable para el Contador; para Dirección sí');
  revisa((await guardar(C, [{ ref: viejo.ref, campo: 'observaciones', valor: 'tarde' }], MP))[1].codigo === 'MES_CERRADO', 'El Contador no corrige un mes cerrado');
  revisa((await guardar(A, [{ ref: viejo.ref, campo: 'observaciones', valor: 'Corrige Dirección' }], MP))[0] === 200, 'Dirección sí');

  console.log('6. El rastro');
  const bit = (await pedir('GET', '/auditoria?entidad=contabilidad', A))[1].filter(b => b.accion === 'flujo corregido');
  revisa(bit.some(b => /Cuenta de banco: Sin cuenta → Santander operación/.test(b.detalle) && b.usuario === 'Carmen Contadora') && bit.some(b => /Monto real CFDI \(R\): \$0\.00 → \$600\.50/.test(b.detalle)) && bit.some(b => /Proyecto \(V\): KFC → .*\(el del sistema\)/.test(b.detalle)), 'La bitácora dice quién, el valor anterior y el nuevo', bit.map(b => b.detalle));
  { const d = new DatabaseSync(DB); let borro = false; try { d.exec('DELETE FROM flujo_correcciones'); borro = true; } catch { /* */ } try { d.exec("UPDATE flujo_correcciones SET valor = 'x'"); borro = true; } catch { /* */ } d.close();
    revisa(!borro, 'Las correcciones no se borran ni se cambian ni desde la base'); }

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); console.log(salida.slice(-1500)); srv.kill(); process.exit(1); });
