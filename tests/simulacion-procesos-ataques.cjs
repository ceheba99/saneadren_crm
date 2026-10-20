// ROMPER CADA PROCESO: desde cada pantalla se intenta hacer lo que no le toca a cada quien.
//  · Cotización/orden: editar, convertir, duplicar, anotar o borrar la de otro; hacerse responsable; cambiar el
//    precio sin permiso; colar campos que no se editan (sucursal, folio, cliente, estatus de cobranza).
//  · Cuentas por cobrar: cobrar en una orden ajena, cobrar de más/negativo/futuro, confirmarse a sí mismo, cancelar
//    cobros sin permiso, ver o tocar la cuenta de un cliente ajeno, importar cobranza a clientes ajenos.
//  · Desde cuentas por cobrar: modificar la cotización o los datos del cliente (Cobranza no vende).
//  · Cuentas por pagar: gastos en órdenes ajenas, pagar sin permiso o de más, cancelar, cambiar la CLABE de un proveedor.
//  · Compras: aprobar, cancelar o editar solicitudes ajenas, crear/autorizar/recibir órdenes de compra sin permiso.
//  · Contactos: editar, agregar o quitar teléfonos, juntar clientes ajenos.
//  · Usuarios, roles, prospección, generador.
// Antes y después de todos los ataques se toma una FOTO completa (como Dirección): nada debe cambiar. Al final se
// revisa que cada quien sí pueda hacer lo suyo (que los candados no estorben).
// Uso: node tests/simulacion-procesos-ataques.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-procesos-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Procesos-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-Procesos-2026x';
const PUERTO = String(8990 + Math.floor(Math.random() * 280)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);
  const SERV = servicios[0], partidas = (leyenda, importe) => JSON.stringify([{ servicio: SERV.nombre, leyenda, importe }]);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  [, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }); const cdmx = j;
  // Rol inventado «Cobranza»: toda la cobranza, nada de ventas.
  [, j] = await pedir('POST', '/roles', A, { nombre: 'Cobranza' }); const COB = j.clave;
  await pedir('PUT', '/roles/' + COB + '/permisos', A, { permisos: ['cobros.registrar', 'cobros.confirmar', 'cobranza.factura'], alcances: { ventas: 0, cxc: 2, cxp: 0, compras: 0 } });
  const T = {}, ID = {};
  for (const [nombre, rol, suc] of [['Laura Ventas', 'ventas', qro.id], ['Beto Ventas', 'ventas', qro.id], ['Raul Tecnico', 'tecnico', qro.id], ['Ana Atencion', 'atencion', qro.id],
    ['Isaac Compras', 'costos', qro.id], ['Carla Cobranza', COB, qro.id], ['Monica Gerente', 'gerente', qro.id], ['Pedro Ventas', 'ventas', cdmx.id]]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] });
    if (s !== 201) throw new Error('No se creó ' + nombre + ': ' + JSON.stringify(j));
    ID[nombre.split(' ')[0]] = j.id; T[nombre.split(' ')[0]] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const { Laura: L, Beto: B, Raul: R, Ana: N, Isaac: I, Carla: C, Monica: M, Pedro: P } = T;

  // ---------- Datos de trabajo (lo normal de cada quien) ----------
  const [, prov] = await pedir('POST', '/finanzas/proveedores', I, { nombre: 'Pipas del Bajío', tipo_comprobante: 'factura', clabe: '014680655039528945', banco: 'Santander' });
  const contacto = async (t, nombre, tel, empresa) => (await pedir('POST', '/contactos', t, { nombre, telefono: tel, empresa_contacto: empresa, direccion: 'Querétaro centro', canal_origen_id: canales[0].id }))[1];
  const cotizar = async (t, quien, cliente, leyenda, imp, ganada) => {
    const [st, x] = await pedir('POST', '/leads', t, { cliente_id: cliente.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID[quien], partidas_json: partidas(leyenda, imp), iva_modo: 'mas_iva', valor: imp,
      ...(ganada ? { estatus: 'ganado', fecha_servicio: dia(-1) } : {}) });
    if (st !== 201) throw new Error('No se cotizó ' + leyenda + ': ' + JSON.stringify(x)); return x;
  };
  const cZafiro = await contacto(L, 'Lic. Zafiro Uno', '442 111 0001', 'Clinica Zafiro'), cRubi = await contacto(L, 'Ing. Rubi Dos', '442 111 0002', 'Planta Rubi');
  const cTopacio = await contacto(B, 'Sra. Topacio Tres', '442 111 0003', 'Hotel Topacio'), cJaspe = await contacto(P, 'Lic. Jaspe Cinco', '55 1111 0005', 'Oficinas Jaspe');
  const L1 = await cotizar(L, 'Laura', cZafiro, 'Desazolve Zafiro', 7000), L2 = await cotizar(L, 'Laura', cRubi, 'Limpieza Rubi', 8000, true);
  const L3 = await cotizar(B, 'Beto', cTopacio, 'Trampa Topacio', 9000, true), L5 = await cotizar(P, 'Pedro', cJaspe, 'Carcamo Jaspe', 5000, true);
  await pedir('PUT', '/leads/' + L2.id, L, { version: (await pedir('GET', '/leads/' + L2.id, L))[1].version, tecnico_id: ID.Raul });
  const cobro = async (t, lead, monto, ref) => (await pedir('POST', '/leads/' + lead.id + '/cobros', t, { monto, metodo: 'transferencia', referencia: ref }))[1].id;
  const kAnaL2 = await cobro(N, L2, 1000, 'k1'), kAnaL3 = await cobro(N, L3, 1500, 'k2'), kRaul = await cobro(R, L2, 500, 'k3'), kPedro = await cobro(P, L5, 700, 'k4');
  await pedir('POST', '/leads/' + L2.id + '/ejecucion', R, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diesel de Raul', total: 800 }] });
  [, j] = await pedir('POST', '/finanzas/cxp', I, { proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Pipa de Isaac', total: 2500, fecha_documento: HOY, lead_id: L3.id, dias_credito: 15 }); const gIsaac = j.id;
  [, j] = await pedir('POST', '/finanzas/cxp', L, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Casetas de Laura', total: 300, fecha_documento: HOY, lead_id: L2.id, dias_credito: 0 }); const gLaura = j.id;
  [, j] = await pedir('POST', '/finanzas/cxp/' + gIsaac + '/pagos', I, { monto: 1000, metodo: 'transferencia', fecha: HOY, referencia: 'P1' }); const pIsaac = j.id;
  [, j] = await pedir('POST', '/compras/solicitudes', L, { que: 'Botas', para_que: 'Visitas de obra', centro_id: centros[0].id }); const solLaura = j.id;
  [, j] = await pedir('POST', '/compras/solicitudes', R, { que: 'Manguera', para_que: 'Se rompió', centro_id: centros[0].id }); const solRaul = j.id;
  [s, j] = await pedir('POST', '/compras/ordenes', I, { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Bomba', precio: 3000 }] });
  const oc = j.id; revisa(s === 201, 'datos listos: cotizaciones, órdenes, cobros, gastos, pagos, solicitudes y una orden de compra', [s, j]);
  const [, hist1] = await pedir('GET', '/leads/' + L1.id, L); const hL1 = hist1.historial?.[0]?.id;
  // Estados para atacar la lógica: un gasto cancelado y una orden de compra ya autorizada.
  [, j] = await pedir('POST', '/finanzas/cxp', I, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Gasto que se cancela', total: 400, fecha_documento: HOY, lead_id: L3.id, dias_credito: 0 }); const gCancelado = j.id;
  [s, j] = await pedir('POST', '/finanzas/cxp/' + gCancelado + '/cancelar', I, { motivo: 'Se capturó dos veces' }); revisa(s === 200, 'Isaac cancela un gasto mal capturado', [s, j]);
  [, j] = await pedir('POST', '/compras/ordenes', I, { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 2, descripcion: 'Llantas', precio: 1500 }] }); const oc2 = j.id;
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc2 + '/autorizar', M, { dias_credito: 0 }); revisa(s === 200, 'Mónica autoriza otra orden de compra', [s, j]);

  // ---------- FOTO completa (como Dirección) ----------
  async function foto() {
    const f = {};
    const [, leads] = await pedir('GET', '/leads', A);
    f.leads = leads.map(l => [l.id, l.estatus, l.valor, l.iva_cent, l.responsable_id, l.tecnico_id, l.cliente_id, l.sucursal_id, l.folio_num, l.direccion, l.ejecucion, l.factura_folio, l.dias_credito, l.partidas_json, l.cobranza_por_revisar, l.etapa].join('|')).sort();
    f.cobros = []; for (const l of leads) { const [, c] = await pedir('GET', '/leads/' + l.id + '/cobros', A); f.cobros.push(...(c.cobros || []).map(k => [k.id, k.lead_id, k.monto_cent, k.tipo, k.confirmado, k.cancelado].join('|'))); }
    f.historialAlertas = []; for (const l of leads) { const [, d] = await pedir('GET', '/leads/' + l.id, A); f.historialAlertas.push(...(d.historial || []).filter(h => h.tipo === 'alerta').map(h => h.id + '|' + h.resuelta)); }
    const [, cxp] = await pedir('GET', '/finanzas/cxp?vista=todas', A); f.cxp = cxp.map(x => [x.id, x.lead_id, x.total, x.pagado, x.concepto].join('|')).sort();
    const [, clientes] = await pedir('GET', '/clientes?incluir_prospectos=1', A); f.clientes = clientes.map(c => [c.id, c.nombre, c.empresa_contacto, c.telefono, c.rfc, c.correo, c.dias_credito].join('|')).sort();
    f.telefonos = []; for (const c of clientes) { const [, d] = await pedir('GET', '/clientes/' + c.id, A); f.telefonos.push(c.id + ':' + JSON.stringify(d.telefonos || d.telefonos_adicionales || [])); }
    const [, provs] = await pedir('GET', '/finanzas/proveedores', A); f.proveedores = provs.map(p => [p.id, p.nombre, p.clabe, p.banco, p.activo].join('|'));
    const [, sols] = await pedir('GET', '/compras/solicitudes?estado=', A); f.solicitudes = sols.map(x => [x.id, x.estado, x.que].join('|'));
    const [, ocs] = await pedir('GET', '/compras/ordenes', A); f.ocs = ocs.map(o => [o.id, o.estado, o.total, o.recibida_at].join('|'));
    const [, us] = await pedir('GET', '/usuarios', A); f.usuarios = us.map(u => [u.id, u.nombre, u.rol, u.activo].join('|'));
    const [, perms] = await pedir('GET', '/permisos', A); f.roles = perms.roles.map(r => r.clave + ':' + r.permisos.sort().join(','));
    return f;
  }
  const antes = await foto();

  // ---------- ATAQUES ----------
  const v = async (t, id) => (await pedir('GET', '/leads/' + id, t))[1].version;
  const vA = async id => (await pedir('GET', '/leads/' + id, A))[1].version;
  const ATAQUES = [
    // [proceso, quién, token, método, ruta, cuerpo]
    ['Cotización', 'Beto edita la cotización de Laura', B, 'PUT', '/leads/' + L1.id, async () => ({ direccion: 'HACK', version: await vA(L1.id) })],
    ['Cotización', 'Beto la convierte en orden', B, 'PUT', '/leads/' + L1.id, async () => ({ estatus: 'ganado', fecha_servicio: HOY, version: await vA(L1.id) })],
    ['Cotización', 'Beto anota en la cotización de Laura', B, 'POST', '/leads/' + L1.id + '/historial', { tipo: 'observacion', texto: 'hack' }],
    ['Cotización', 'Beto resuelve una anotación de Laura', B, 'PUT', '/historial/' + hL1 + '/resolver', {}],
    ['Cotización', 'Beto borra la cotización de Laura', B, 'DELETE', '/leads/' + L1.id, { motivo: 'hack hack hack' }],
    ['Cotización', 'Beto duplica la orden de Laura', B, 'POST', '/leads', { cliente_id: cRubi.id, duplicado_de: L2.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Beto, partidas_json: partidas('dup', 10), iva_modo: 'sin_iva', valor: 10, estatus: 'ganado', fecha_servicio: HOY, forzar_duplicado: true }],
    ['Cotización', 'Beto le agrega su teléfono al cliente de Laura al cotizar', B, 'POST', '/leads', { agregar_telefono_a: cZafiro.id, telefono: '442 999 0101', direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Beto, partidas_json: partidas('x', 10), iva_modo: 'sin_iva', valor: 10 }],
    ['Cotización', 'Raúl (técnico) se hace responsable de la orden', R, 'PUT', '/leads/' + L2.id, async () => ({ responsable_id: ID.Raul, version: await vA(L2.id) })],
    ['Cotización', 'Raúl le baja el precio a la orden', R, 'PUT', '/leads/' + L2.id, async () => ({ partidas_json: partidas('Limpieza Rubi', 10), valor: 10, version: await vA(L2.id) })],
    ['Cotización', 'Laura cambia la orden a otro cliente', L, 'PUT', '/leads/' + L2.id, async () => ({ cliente_id: cTopacio.id, version: await vA(L2.id) })],
    ['Cotización', 'Laura cuela sucursal, folio, estatus de cobranza y ejecución', L, 'PUT', '/leads/' + L2.id, async () => ({ sucursal_id: cdmx.id, folio_num: 999, cobranza_por_revisar: 1, ejecucion: 'no_realizado', factura_total_cent: 1, version: await vA(L2.id) })],
    ['Cotización', 'Pedro (CDMX) edita una orden de QRO', P, 'PUT', '/leads/' + L2.id, async () => ({ direccion: 'HACK', version: await vA(L2.id) })],
    ['Desde CxC', 'Carla (cobranza) modifica la orden', C, 'PUT', '/leads/' + L2.id, async () => ({ direccion: 'HACK', version: await vA(L2.id) })],
    ['Desde CxC', 'Carla le asigna técnico a la orden', C, 'PUT', '/leads/' + L3.id, async () => ({ tecnico_id: ID.Carla, version: await vA(L3.id) })],
    ['Desde CxC', 'Carla marca el servicio como realizado', C, 'POST', '/leads/' + L3.id + '/ejecucion', { estado: 'realizado', fecha: HOY }],
    ['Desde CxC', 'Carla modifica los datos del cliente', C, 'PUT', '/clientes/' + cRubi.id, { nombre: 'HACK', rfc: 'XAXX010101000' }],
    ['Desde CxC', 'Carla le agrega un teléfono al cliente', C, 'POST', '/clientes/' + cRubi.id + '/telefonos', { telefono: '442 999 0202' }],
    ['Desde CxC', 'Carla importa cobranza (crea órdenes y cobros)', C, 'POST', '/finanzas/importar/cxc', { filas: [{ nombre: 'Hotel Topacio', id_cliente: 'CLI-' + String(cTopacio.id).padStart(4, '0'), folio: 'F1', total: 100, fecha: HOY, pagado: 100 }] }],
    ['CxC', 'Laura cobra en la orden de Beto', L, 'POST', '/leads/' + L3.id + '/cobros', { monto: 1, metodo: 'efectivo' }],
    ['CxC', 'Isaac (compras) cobra en una orden', I, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'efectivo' }],
    ['CxC', 'Pedro (CDMX) cobra en una orden de QRO', P, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'efectivo' }],
    ['CxC', 'Laura cobra más que el saldo', L, 'POST', '/leads/' + L2.id + '/cobros', { monto: 999999, metodo: 'efectivo' }],
    ['CxC', 'Laura cobra en negativo', L, 'POST', '/leads/' + L2.id + '/cobros', { monto: -50, metodo: 'efectivo' }],
    ['CxC', 'Laura cobra con fracciones de centavo', L, 'POST', '/leads/' + L2.id + '/cobros', { monto: 0.001, metodo: 'efectivo' }],
    ['CxC', 'Laura cobra con fecha futura', L, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'efectivo', fecha: dia(5) }],
    ['CxC', 'Laura registra un descuento (ajuste) sin permiso', L, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'efectivo', tipo: 'ajuste' }],
    ['CxC', 'Laura cobra en una cotización (no es orden)', L, 'POST', '/leads/' + L1.id + '/cobros', { monto: 1, metodo: 'efectivo' }],
    ['CxC', 'Laura confirma un cobro de la orden de Beto', L, 'POST', '/finanzas/cobros/' + kAnaL3 + '/confirmar', {}],
    ['CxC', 'Raúl se confirma su propio cobro', R, 'POST', '/finanzas/cobros/' + kRaul + '/confirmar', {}],
    ['CxC', 'Isaac (compras) cancela un cobro de cliente', I, 'POST', '/finanzas/cobros/' + kAnaL2 + '/cancelar', { motivo: 'hack hack hack' }],
    ['CxC', 'Laura cancela un cobro', L, 'POST', '/finanzas/cobros/' + kAnaL2 + '/cancelar', { motivo: 'hack hack hack' }],
    ['CxC', 'Pedro (CDMX) cancela un cobro de QRO', P, 'POST', '/finanzas/cobros/' + kAnaL2 + '/cancelar', { motivo: 'hack hack hack' }],
    ['CxC', 'Laura cambia la factura de la orden de Beto', L, 'PUT', '/leads/' + L3.id + '/facturacion', { dias_credito: 90, factura_folio: 'HACK' }],
    ['CxC', 'Laura cambia el crédito del cliente de Beto', L, 'PUT', '/finanzas/clientes/' + cTopacio.id + '/credito', { dias_credito: 90 }],
    ['CxC', 'Laura hace la revisión inicial de cobranza', L, 'POST', '/finanzas/revision-inicial', { cobradas: [L3.id, L2.id] }],
    ['CxC', 'Laura importa cobranza', L, 'POST', '/finanzas/importar/cxc', { filas: [{ nombre: 'Hotel Topacio', folio: 'F2', total: 100, fecha: HOY }] }],
    ['CxP', 'Laura liga un gasto a la orden de Beto', L, 'POST', '/finanzas/cxp', { proveedor_id: prov.id, categoria: 'otro', concepto: 'Gasto ajeno', total: 10, fecha_documento: HOY, lead_id: L3.id, dias_credito: 0 }],
    ['CxP', 'Raúl liga un gasto a una cotización', R, 'POST', '/finanzas/cxp', { proveedor_id: prov.id, categoria: 'otro', concepto: 'Gasto raro', total: 10, fecha_documento: HOY, lead_id: L1.id, dias_credito: 0 }],
    ['CxP', 'Laura registra una compra sin orden (directa)', L, 'POST', '/finanzas/cxp', { proveedor_id: prov.id, categoria: 'otro', concepto: 'Compra directa', total: 10, fecha_documento: HOY, dias_credito: 0 }],
    ['CxP', 'Laura paga a un proveedor', L, 'POST', '/finanzas/cxp/' + gIsaac + '/pagos', { monto: 10, metodo: 'efectivo', fecha: HOY }],
    ['CxP', 'Isaac paga de más', I, 'POST', '/finanzas/cxp/' + gIsaac + '/pagos', { monto: 999999, metodo: 'transferencia', fecha: HOY }],
    ['CxP', 'Isaac paga en negativo', I, 'POST', '/finanzas/cxp/' + gIsaac + '/pagos', { monto: -10, metodo: 'transferencia', fecha: HOY }],
    ['CxP', 'Pedro (CDMX) paga un gasto de QRO', P, 'POST', '/finanzas/cxp/' + gIsaac + '/pagos', { monto: 10, metodo: 'efectivo', fecha: HOY }],
    ['CxP', 'Laura cancela su propio gasto', L, 'POST', '/finanzas/cxp/' + gLaura + '/cancelar', { motivo: 'hack hack hack' }],
    ['CxP', 'Laura cancela un pago a proveedor', L, 'POST', '/finanzas/pagos-proveedor/' + pIsaac + '/cancelar', { motivo: 'hack hack hack' }],
    ['CxP', 'Laura cambia la CLABE del proveedor', L, 'PUT', '/finanzas/proveedores/' + prov.id, { clabe: '012180001234567899', banco: 'BBVA' }],
    ['CxP', 'Raúl cambia la CLABE del proveedor', R, 'PUT', '/finanzas/proveedores/' + prov.id, { clabe: '012180001234567899' }],
    ['CxP', 'Ana (sin cuentas por pagar) cambia la CLABE', N, 'PUT', '/finanzas/proveedores/' + prov.id, { clabe: '012180001234567899' }],
    ['CxP', 'Laura importa cuentas por pagar', L, 'POST', '/finanzas/importar/cxp', { filas: [{ proveedor: 'X', total: 10 }] }],
    ['Compras', 'Laura aprueba la solicitud de Raúl', L, 'POST', '/compras/solicitudes/' + solRaul + '/aprobar', {}],
    ['Compras', 'Laura se aprueba su propia solicitud', L, 'POST', '/compras/solicitudes/' + solLaura + '/aprobar', {}],
    ['Compras', 'Raúl cancela la solicitud de Laura', R, 'POST', '/compras/solicitudes/' + solLaura + '/cancelar', { motivo: 'hack hack' }],
    ['Compras', 'Laura edita la solicitud de Raúl', L, 'PUT', '/compras/solicitudes/' + solRaul, { que: 'HACK', para_que: 'HACK hack', centro_id: centros[0].id }],
    ['Compras', 'Laura rechaza la solicitud de Raúl', L, 'POST', '/compras/solicitudes/' + solRaul + '/rechazar', { motivo: 'hack hack' }],
    ['Compras', 'Laura crea una orden de compra', L, 'POST', '/compras/ordenes', { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'X', precio: 1 }] }],
    ['Compras', 'Isaac autoriza su propia orden de compra', I, 'POST', '/compras/ordenes/' + oc + '/autorizar', {}],
    ['Compras', 'Laura recibe la orden de compra', L, 'POST', '/compras/ordenes/' + oc + '/recibir', { recibio: 'Laura' }],
    ['Compras', 'Pedro (CDMX) cancela la orden de compra de QRO', P, 'POST', '/compras/ordenes/' + oc + '/cancelar', { motivo: 'hack hack' }],
    ['Compras', 'Laura edita la orden de compra', L, 'PUT', '/compras/ordenes/' + oc, { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'HACK', precio: 1 }] }],
    ['Contactos', 'Beto edita el cliente de Laura', B, 'PUT', '/clientes/' + cZafiro.id, { nombre: 'HACK' }],
    ['Contactos', 'Beto le agrega un teléfono al cliente de Laura', B, 'POST', '/clientes/' + cZafiro.id + '/telefonos', { telefono: '442 999 0303' }],
    ['Contactos', 'Beto le quita el teléfono al cliente de Laura', B, 'DELETE', '/clientes/' + cZafiro.id + '/telefonos/4421110001', undefined],
    ['Contactos', 'Raúl (técnico) edita los datos del cliente de la orden', R, 'PUT', '/clientes/' + cRubi.id, { nombre: 'HACK' }],
    ['Contactos', 'Isaac (compras) edita un cliente', I, 'PUT', '/clientes/' + cRubi.id, { nombre: 'HACK' }],
    ['Contactos', 'Laura junta dos clientes', L, 'POST', '/clientes/' + cZafiro.id + '/fusionar', { con: cRubi.id }],
    ['Contactos', 'Pedro (CDMX) edita un cliente de QRO', P, 'PUT', '/clientes/' + cRubi.id, { nombre: 'HACK' }],
    ['Servicio', 'Laura marca realizada la orden de Beto', L, 'POST', '/leads/' + L3.id + '/ejecucion', { estado: 'realizado', fecha: HOY }],
    ['Servicio', 'Raúl marca una orden que no es suya', R, 'POST', '/leads/' + L3.id + '/ejecucion', { estado: 'no_realizado', motivo: 'hack hack' }],
    ['Servicio', 'Isaac marca una orden', I, 'POST', '/leads/' + L2.id + '/ejecucion', { estado: 'no_realizado', motivo: 'hack hack' }],
    ['Usuarios', 'Laura crea un usuario', L, 'POST', '/usuarios', { nombre: 'Intruso Uno', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }],
    ['Usuarios', 'Ana se sube a gerente', N, 'PUT', '/usuarios/' + ID.Ana, { rol: 'gerente' }],
    ['Usuarios', 'Laura le cambia la contraseña a Beto', L, 'POST', '/usuarios/' + ID.Beto + '/password', { password: 'Otra-Clave-2026x' }],
    ['Roles', 'Mónica (gerente) se da más permisos', M, 'PUT', '/roles/gerente/permisos', { permisos: [], alcances: { ventas: 2 } }],
    ['Roles', 'Laura cambia lo que ve ventas', L, 'PUT', '/roles/ventas/permisos', { permisos: [], alcances: { ventas: 2, cxc: 2 } }],
    ['Generador', 'Laura carga el generador (crea órdenes a cualquier cliente)', L, 'POST', '/generador/importar', { filas: [] }],
    ['Prospección', 'Isaac (compras) entra a prospección', I, 'GET', '/prospeccion', undefined],
    // Lógica de negocio (personas que SÍ tienen permiso, haciendo algo que no cuadra).
    ['Lógica', 'Mónica elimina una orden que ya tiene cobros', M, 'DELETE', '/leads/' + L2.id, { motivo: 'Se capturó mal la orden' }],
    ['Lógica', 'Mónica baja el precio de la orden por debajo de lo ya cobrado', M, 'PUT', '/leads/' + L2.id, async () => ({ partidas_json: partidas('Limpieza Rubi', 100), valor: 100, version: await vA(L2.id) })],
    ['Lógica', 'Ana factura por menos de lo ya cobrado', N, 'PUT', '/leads/' + L2.id + '/facturacion', { factura_folio: 'A-1', factura_fecha: HOY, factura_total: 100 }],
    ['Lógica', 'Ana usa una fecha imposible en un cobro', N, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'efectivo', fecha: '2026-02-30' }],
    ['Lógica', 'Ana cobra un monto gigante', N, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1e15, metodo: 'efectivo' }],
    ['Lógica', 'Ana cobra con texto en vez de número', N, 'POST', '/leads/' + L2.id + '/cobros', { monto: 'cien', metodo: 'efectivo' }],
    ['Lógica', 'Ana cobra con un método inventado', N, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'bitcoin' }],
    ['Lógica', 'Ana confirma un cobro que no existe', N, 'POST', '/finanzas/cobros/999999/confirmar', {}],
    ['Lógica', 'Isaac paga un gasto cancelado', I, 'POST', '/finanzas/cxp/' + gCancelado + '/pagos', { monto: 10, metodo: 'transferencia', fecha: HOY }],
    ['Lógica', 'Isaac cancela un gasto que ya tiene pagos', I, 'POST', '/finanzas/cxp/' + gIsaac + '/cancelar', { motivo: 'Ya no se necesita' }],
    ['Lógica', 'Isaac paga con fecha futura', I, 'POST', '/finanzas/cxp/' + gIsaac + '/pagos', { monto: 10, metodo: 'transferencia', fecha: dia(10) }],
    ['Lógica', 'Isaac recibe una orden de compra sin autorizar', I, 'POST', '/compras/ordenes/' + oc + '/recibir', { recibio: 'Isaac' }],
    ['Lógica', 'Mónica autoriza dos veces la misma orden de compra', M, 'POST', '/compras/ordenes/' + oc2 + '/autorizar', { dias_credito: 0 }],
    ['Lógica', 'Isaac cancela una orden de compra ya autorizada', I, 'POST', '/compras/ordenes/' + oc2 + '/cancelar', { motivo: 'Ya no se necesita' }],
    ['Lógica', 'Isaac edita una orden de compra ya autorizada', I, 'PUT', '/compras/ordenes/' + oc2, { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 2, descripcion: 'Llantas', precio: 1 }] }],
    ['Lógica', 'Isaac elige cotización de una solicitud sin cotizaciones', I, 'POST', '/compras/solicitudes/' + solLaura + '/elegir', { documento_id: 1 }],
    ['Lógica', 'Laura guarda la cotización con una versión vieja', L, 'PUT', '/leads/' + L1.id, { direccion: 'Pisando cambios', version: 0 }],
    ['Lógica', 'Ana (de QRO) pide ver CDMX', N, 'GET', '/leads', undefined, { 'X-Sucursal': String(cdmx.id) }],
    ['Lógica', 'Mónica se desactiva a sí misma', M, 'DELETE', '/usuarios/' + ID.Monica, undefined],
    ['Lógica', 'Dirección «viendo como ventas» intenta guardar', A, 'POST', '/leads/' + L2.id + '/cobros', { monto: 1, metodo: 'efectivo' }, { 'X-Ver-Como': 'ventas' }],
  ];
  console.log(`${ATAQUES.length} ataques:`);
  for (const [proceso, que, t, m, r, cuerpo, extra] of ATAQUES) {
    const b = typeof cuerpo === 'function' ? await cuerpo() : cuerpo;
    const [st, x] = await pedir(m, r, t, b, extra);
    revisa(st >= 400 && st < 500, `[${proceso}] ${que}: se niega (${st})`, [st, x]);
  }
  // Carrera: dos cobros a la vez que juntos pasan el saldo.
  const [, cta] = await pedir('GET', '/leads/' + L3.id + '/cobros', A);
  const saldo = cta.cuenta.saldo, mitad = Math.round(saldo * 0.6 * 100) / 100;
  const dobles = await Promise.all([pedir('POST', '/leads/' + L3.id + '/cobros', N, { monto: mitad, metodo: 'efectivo', referencia: 'carrera1' }), pedir('POST', '/leads/' + L3.id + '/cobros', N, { monto: mitad, metodo: 'transferencia', referencia: 'carrera2' })]);
  revisa(dobles.filter(([st]) => st === 201).length === 1, 'dos cobros a la vez que juntos pasan el saldo: solo entra uno', dobles.map(([st]) => st));
  const [, cta2] = await pedir('GET', '/leads/' + L3.id + '/cobros', A);
  revisa(cta2.cuenta.saldo >= 0, 'el saldo nunca queda negativo', cta2.cuenta.saldo);
  const [, cxpAhora] = await pedir('GET', '/finanzas/cxp?vista=todas', A); const saldoG = cxpAhora.find(x => x.id === gIsaac).saldo, parte = Math.round(saldoG * 0.6 * 100) / 100;
  const pagos2 = await Promise.all([1, 2].map(k => pedir('POST', '/finanzas/cxp/' + gIsaac + '/pagos', I, { monto: parte, metodo: 'transferencia', fecha: HOY, referencia: 'carrera-p' + k })));
  revisa(pagos2.filter(([st]) => st === 201).length === 1, 'dos pagos a proveedor a la vez que juntos pasan lo que se debe: solo entra uno', pagos2.map(([st]) => st));
  const legitP = pagos2.filter(([st]) => st === 201).map(([, x]) => x.id);

  // ---------- FOTO después: nada cambió (salvo el cobro legítimo de la carrera) ----------
  const despues = await foto();
  const legit = dobles.filter(([st]) => st === 201).map(([, x]) => x.id);
  despues.cobros = despues.cobros.filter(k => !legit.includes(Number(k.split('|')[0])));
  // El pago legítimo de la carrera cambia lo pagado de ese gasto: se compara sin esa cifra.
  const sinPagado = l => l.map(x => x.split('|').filter((_, i) => i !== 3).join('|'));
  antes.cxp = sinPagado(antes.cxp); despues.cxp = sinPagado(despues.cxp); void legitP;
  for (const k of Object.keys(antes)) {
    const a = new Set(antes[k]), d = new Set(despues[k]);
    const cambios = [...[...d].filter(x => !a.has(x)).map(x => '+ ' + x), ...[...a].filter(x => !d.has(x)).map(x => '- ' + x)];
    revisa(!cambios.length, `después de los ataques, ${k} sigue igual`, cambios.slice(0, 6));
  }

  // ---------- Cada quien sí puede hacer lo suyo ----------
  console.log('\nLo legítimo sigue funcionando:');
  [s] = await pedir('PUT', '/leads/' + L1.id, L, { direccion: 'Calle nueva 10', version: await v(L, L1.id) }); revisa(s === 200, 'Laura edita su cotización');
  [s] = await pedir('PUT', '/clientes/' + cZafiro.id, L, { nombre: 'Lic. Zafiro Uno Martínez' }); revisa(s === 200, 'Laura corrige los datos de su cliente');
  [s] = await pedir('POST', '/leads/' + L2.id + '/cobros', L, { monto: 10, metodo: 'efectivo', referencia: 'legit' }); revisa(s === 201, 'Laura cobra en su orden');
  [s] = await pedir('POST', '/finanzas/cobros/' + kRaul + '/confirmar', L); revisa(s === 200, 'Laura confirma el cobro que registró Raúl en su orden (otra persona)');
  [s] = await pedir('POST', '/leads/' + L3.id + '/cobros', C, { monto: 10, metodo: 'efectivo', referencia: 'carla' }); revisa(s === 201, 'Carla (cobranza) cobra en cualquier orden de la sucursal');
  [s] = await pedir('PUT', '/leads/' + L3.id + '/facturacion', C, { dias_credito: 30 }); revisa(s === 200, 'Carla captura crédito y factura');
  [s] = await pedir('POST', '/leads/' + L3.id + '/historial', C, { tipo: 'observacion', texto: 'Prometió pagar el viernes' }); revisa(s === 200 || s === 201, 'Carla anota el seguimiento de cobranza en la orden', s);
  [s] = await pedir('PUT', '/finanzas/proveedores/' + prov.id, I, { clabe: '014680655039528945', banco: 'Santander' }); revisa(s === 200, 'Isaac (compras) sí corrige datos bancarios del proveedor');
  [s] = await pedir('POST', '/finanzas/cxp/' + gIsaac + '/pagos', I, { monto: 100, metodo: 'transferencia', fecha: HOY, referencia: 'P2' }); revisa(s === 201, 'Isaac paga a proveedores');
  [s] = await pedir('POST', '/compras/solicitudes/' + solRaul + '/aprobar', I); revisa(s === 200, 'Isaac aprueba la solicitud de Raúl');
  [s] = await pedir('POST', '/compras/ordenes/' + oc + '/autorizar', M, { dias_credito: 15 }); revisa(s === 200, 'Mónica (gerente) autoriza la orden de compra');
  [s] = await pedir('PUT', '/leads/' + L1.id, M, { responsable_id: ID.Beto, version: await v(M, L1.id) }); revisa(s === 200, 'Mónica pasa la cotización de Laura a Beto');
  [s] = await pedir('PUT', '/leads/' + L2.id, A, { tecnico_id: null, version: await vA(L2.id) }); revisa(s === 200, 'Dirección le quita la orden al técnico');

  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
