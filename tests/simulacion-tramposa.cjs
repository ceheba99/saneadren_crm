// «A prueba de tontos»: intentos tramposos o descuidados de colar duplicados, nombres mal escritos, órdenes de
// compra, conceptos y pagos mal hechos. Cada intento debe detenerse con un mensaje claro (o pedir confirmación).
// Uso: node tests/simulacion-tramposa.cjs   (usa una base temporal)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tramposa-')); const PUERTO = String(6100 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Tramposa-' + Math.random().toString(36).slice(2) + '-3' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 't.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const rechaza = (r, texto) => revisa(r[0] >= 400 && r[0] < 500 && r[1].error, texto, r);

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Tramposa', correo: 'ventas.t@saneadren.com.mx', password: 'Ventas-Tramposa-26', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.t@saneadren.com.mx', password: 'Ventas-Tramposa-26' }))[1].token;
  const [, canales] = await pedir('GET', '/canales', V);
  const [, usuarios] = await pedir('GET', '/usuarios', A);
  const vid = usuarios.find(u => u.nombre === 'Ventas Tramposa').id;
  const contacto = (nombre, telefono, extra = {}, t = V) => pedir('POST', '/contactos', t, { nombre, telefono, direccion: 'Querétaro', canal_origen_id: canales[0].id, ...extra });
  let s, j;

  seccion('1. Contactos duplicados tramposos');
  [s, j] = await contacto('Laura Gómez', '4421000001', { empresa_contacto: 'Grupo Industrial del Bajío S.A. de C.V.' });
  const gib = j; revisa(s === 201, 'alta original: Grupo Industrial del Bajío');
  for (const tel of ['+52 442 100 0001', '(442) 100-0001', '442.100.0001', '52 1 442 100 0001', ' 4421000001 ']) {
    [s, j] = await contacto('Otra Persona', tel); revisa(s === 409 && j.cliente_id === gib.id, `mismo teléfono escrito «${tel}» → ya existe`, [s, j.error]);
  }
  for (const empresa of ['grupo industrial del bajio', 'GRUPO INDUSTRIAL DEL BAJÍO, S.A. DE C.V.', 'Grupo  Industrial   del Bajío', 'Grupo Industrial del Bajio SAPI de CV', 'Grupo Indsutrial del Bajío', 'G R U P O Industrial del Bajío',
    'Grupo Industrial del Bajío', 'Grupo Industrial del Bajío​', 'Grupo Industrial del Bajío!!!', 'Industrial del Bajío']) {
    [s, j] = await contacto('Pedro', '44220' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0'), { empresa_contacto: empresa });
    revisa(s === 409 && j.parecidos?.some(p => p.id === gib.id), `empresa «${empresa.replace(/[ ​]/g, '·')}» → pregunta si es la misma`, [s, j.error]);
  }
  [s, j] = await contacto('Grupo Industrial del Bajío', '4423000001');
  revisa(s === 409 && j.parecidos?.some(p => p.id === gib.id), 'la razón social escrita en el NOMBRE (sin empresa) también se detecta');
  [s, j] = await contacto('Laura', '4423000002', { empresa_contacto: 'Otra Empresa', telefono_alterno: '442 100 0001' });
  revisa(s === 409, 'el teléfono de otro cliente escrito como «teléfono alterno» del nuevo → se detiene', [s, j.error]);
  [s, j] = await contacto('Recepción', '4423000003', { empresa_contacto: 'Comercializadora Norte' }); const norte = j;
  [s, j] = await pedir('PUT', '/clientes/' + norte.id, V, { empresa_contacto: 'GRUPO INDUSTRIAL DEL BAJIO' });
  revisa(s === 409 && j.parecidos?.some(p => p.id === gib.id), 'renombrar un cliente para que quede igual a otro → pregunta antes', [s, j.error]);
  [s, j] = await pedir('PUT', '/clientes/' + norte.id, V, { telefono_alterno: '(442) 100-0001' });
  rechaza([s, j], 'poner como alterno el teléfono de otro cliente');
  [s, j] = await pedir('PUT', '/clientes/' + norte.id, V, { telefono: '4421000001' });
  rechaza([s, j], 'cambiarle el teléfono por el de otro cliente');
  // RFC genérico (público en general) no es un RFC de cliente: no debe bloquear a otros
  [s] = await pedir('PUT', '/clientes/' + gib.id, V, { rfc: 'XAXX010101000' });
  [s, j] = await pedir('PUT', '/clientes/' + norte.id, V, { rfc: 'XAXX010101000' });
  revisa(s === 200, 'el RFC genérico XAXX010101000 lo pueden tener varios clientes', [s, j.error]);
  [s] = await pedir('PUT', '/clientes/' + gib.id, V, { rfc: 'GIB010101AB1' });
  [s, j] = await pedir('PUT', '/clientes/' + norte.id, V, { rfc: ' gib010101ab1 ' });
  revisa(s === 409 && j.rfc_de?.id === gib.id, 'el mismo RFC con minúsculas y espacios → ya es de otro cliente', [s, j.error]);
  [s, j] = await pedir('PUT', '/clientes/' + norte.id, V, { rfc: 'GIB 010101 AB1' }); rechaza([s, j], 'RFC con espacios en medio');
  // «Es otro» por descuido: el administrador lo sigue viendo en la revisión
  [s, j] = await contacto('Laura', '4423000004', { empresa_contacto: 'Grupo Industrial del Bajio' });
  [s, j] = await contacto('Laura', '4423000004', { empresa_contacto: 'Grupo Industrial del Bajio', distinto_de: j.parecidos.map(p => p.id) });
  revisa(s === 201, 'ventas dice «es otro» por descuido y se crea');
  [s, j] = await pedir('GET', '/clientes/duplicados', A);
  revisa(j.some(p => [p.a.id, p.b.id].includes(gib.id) && p.marcado_distinto_por), 'el administrador lo sigue viendo en Revisar duplicados («marcado como distinto por ventas»)', j.map(p => p.motivo));

  seccion('2. Nombres mal escritos o basura');
  for (const nombre of ['', '   ', '.', '---', '😀😀', '<script>alert(1)</script>', 'x']) {
    [s, j] = await contacto(nombre, '44240' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0'));
    revisa(s === 400 || (s === 201 && !/[<>]/.test(j.nombre)), `nombre «${nombre}» → se rechaza`, [s, j.error, j.nombre]);
  }
  for (const tel of ['442100000', '44210000011', 'cuatro cuatro dos', '442-100-OOO1', '0000000000', '1111111111']) {
    [s, j] = await contacto('Nombre Válido ' + tel.length, tel); revisa(s === 400, `teléfono «${tel}» → se rechaza`, [s, j.error]);
  }

  seccion('3. Órdenes de compra mal hechas');
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refaccionaria Tramposa', categoria: 'refacciones', dias_credito: 15 });
  const [, centros] = await pedir('GET', '/compras/centros', V);
  const base = { proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'refacciones', fecha: HOY, iva_modo: 'mas_iva', partidas: [{ cantidad: 2, descripcion: 'Manguera de 4 pulgadas', unidad: 'PZA', precio: 1500 }] };
  const oc = (p, t = A) => // las órdenes las hace el encargado de centro de costos o administración
    pedir('POST', '/compras/ordenes', t, { ...base, ...p });
  const P = x => ({ partidas: [{ ...base.partidas[0], ...x }] });
  for (const [cambio, texto] of [
    [P({ cantidad: -2 }), 'cantidad negativa'], [P({ cantidad: 0 }), 'cantidad 0'], [P({ cantidad: '2 piezas' }), 'cantidad «2 piezas»'], [P({ cantidad: 'NaN' }), 'cantidad NaN'], [P({ cantidad: 1e9 }), 'cantidad absurda'],
    [P({ precio: -1500 }), 'precio negativo'], [P({ precio: 0 }), 'precio 0'], [P({ precio: '1,5OO' }), 'precio con letra O'], [P({ precio: 1500.555 }), 'precio con 3 decimales'], [P({ precio: 1e12 }), 'precio absurdo'],
    [P({ descripcion: '' }), 'descripción vacía'], [P({ descripcion: '     ' }), 'descripción de espacios'], [P({ descripcion: '....' }), 'descripción «....»'], [P({ descripcion: '-' }), 'descripción «-»'],
    [P({ unidad: 'CAJITAS' }), 'unidad que no está en el catálogo'], [P({ unidad: '<b>' }), 'unidad con código'],
    [{ partidas: [] }, 'sin partidas'], [{ partidas: 'hola' }, 'partidas que no son lista'], [{ proveedor_id: 999999 }, 'proveedor que no existe'], [{ centro_id: 999999 }, 'centro de costos que no existe'],
    [{ categoria: 'inventada' }, 'categoría inventada'], [{ iva_modo: 'medio_iva' }, 'IVA inventado'], [{ fecha: '2026-02-30' }, 'fecha 30 de febrero'], [{ fecha: dias(HOY, 400) }, 'fecha a más de un año'],
    [{ fecha_requerida: dias(HOY, -3) }, 'fecha requerida antes de la orden'], [{ lead_id: 999999 }, 'orden de servicio que no existe']]) {
    rechaza(await oc(cambio), 'OC: ' + texto);
  }
  [s, j] = await oc({ partidas: [{ cantidad: '2', descripcion: '  Manguera  ', unidad: 'pza', precio: '$1,500.00' }] });
  revisa(s === 201 && j.total === 3480 && j.partidas[0].descripcion === 'Manguera' && j.partidas[0].unidad === 'PZA', 'texto con $, comas y espacios se limpia bien ($3,480)', [s, j.total, j.partidas?.[0], j.error]);
  const oc1 = j;
  [s, j] = await oc({ partidas: [{ cantidad: '2', descripcion: 'Manguera', unidad: 'PZA', precio: 1500 }] });
  revisa(s === 409 && j.codigo === 'POSIBLE_DUPLICADO', 'la misma orden capturada dos veces (doble clic) → pregunta si es otra', [s, j.error]);
  [s, j] = await oc({ partidas: [{ cantidad: 2, descripcion: 'Manguera', unidad: 'PZA', precio: 1500 }], forzar: true });
  revisa(s === 201, 'si confirma que es otra, se crea'); const oc2 = j;
  // Categoría dada de baja
  await pedir('POST', '/finanzas/categorias', A, { nombre: 'Papelería vieja' });
  await pedir('PUT', '/finanzas/categorias/papeleria_vieja', A, { activo: false });
  rechaza(await oc({ categoria: 'papeleria_vieja' }), 'OC con categoría dada de baja');
  // Autorizar / editar / cancelar a destiempo
  rechaza(await pedir('POST', '/compras/ordenes/' + oc1.id + '/autorizar', V), 'ventas autoriza una OC');
  const aut = await Promise.all([pedir('POST', '/compras/ordenes/' + oc1.id + '/autorizar', A, { dias_credito: 7 }), pedir('POST', '/compras/ordenes/' + oc1.id + '/autorizar', A, { dias_credito: 7 })]);
  revisa(aut.filter(r => r[0] === 200).length === 1, 'dos clics en «Autorizar» al mismo tiempo → solo una cuenta por pagar', aut.map(r => r[0]));
  rechaza(await pedir('PUT', '/compras/ordenes/' + oc1.id, V, { ...base, version: 99 }), 'editar una OC ya autorizada');
  rechaza(await pedir('POST', '/compras/ordenes/' + oc2.id + '/cancelar', V, { motivo: '.....' }), 'cancelar con motivo «.....»');
  rechaza(await pedir('POST', '/compras/ordenes/' + oc2.id + '/cancelar', V, { motivo: '' }), 'cancelar sin motivo');

  seccion('4. Gastos (cuentas por pagar) con conceptos malos');
  const gasto = x => pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'refacciones', concepto: 'Balatas camión E-37', total: 2400, fecha_documento: HOY, dias_credito: 15, ...x }); // compra directa: solo administración o costos
  for (const [x, texto] of [[{ concepto: '' }, 'concepto vacío'], [{ concepto: '   ' }, 'concepto de espacios'], [{ concepto: '...' }, 'concepto «...»'], [{ concepto: 'x' }, 'concepto de una letra'],
    [{ total: 0 }, 'total 0'], [{ total: -50 }, 'total negativo'], [{ total: '2,4OO' }, 'total con letra O'], [{ total: 10.555 }, 'total con 3 decimales'], [{ total: true }, 'total «true»'],
    [{ categoria: 'papeleria_vieja' }, 'categoría dada de baja'], [{ categoria: 'inventada' }, 'categoría inventada'], [{ proveedor_id: 999999 }, 'proveedor que no existe'],
    [{ fecha_documento: '2026-13-01' }, 'fecha mes 13'], [{ fecha_documento: dias(HOY, 400) }, 'fecha a más de un año'], [{ dias_credito: -10 }, 'días de crédito negativos'], [{ dias_credito: '' }, 'sin días de crédito'],
    [{ ya_pagado: true, metodo: 'trueque' }, 'pagado con método inventado'], [{ ya_pagado: true, metodo: 'efectivo', fecha_pago: dias(HOY, 5) }, 'pagado en el futuro']]) {
    rechaza(await gasto(x), 'Gasto: ' + texto);
  }
  [s, j] = await gasto({ factura_folio: 'A-100' }); revisa(s === 201, 'gasto correcto con factura A-100'); const g1 = j;
  [s, j] = await gasto({ factura_folio: 'a-100' }); revisa(s === 409, 'la misma factura con minúsculas → pregunta si es otra', [s, j.error]);
  [s, j] = await gasto({ factura_folio: ' A-100 ' }); revisa(s === 409, 'la misma factura con espacios → pregunta si es otra', [s, j.error]);

  seccion('5. Pagos mal hechos');
  const [, servicios] = await pedir('GET', '/servicios', V);
  const partida = (precio) => JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: precio }]);
  [s, j] = await pedir('POST', '/leads', V, { cliente_id: gib.id, direccion: 'Planta', responsable_id: vid, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: partida(10000), valor: 10000, estatus: 'ganado', fecha_servicio: dias(HOY, -1) });
  const os1 = j; revisa(s === 201, 'orden de servicio de $11,600 para cobrar', [s, j.error]);
  const cobro = (x, t = V) => pedir('POST', '/leads/' + os1.id + '/cobros', t, { monto: 1000, metodo: 'transferencia', fecha: HOY, ...x });
  for (const [x, texto] of [[{ monto: 0 }, 'monto 0'], [{ monto: -100 }, 'monto negativo'], [{ monto: '1,OOO' }, 'monto con letra O'], [{ monto: 100.555 }, 'monto con 3 decimales'], [{ monto: 'mil' }, 'monto «mil»'],
    [{ monto: 99999 }, 'monto mayor al saldo'], [{ metodo: 'trueque' }, 'método inventado'], [{ fecha: dias(HOY, 3) }, 'fecha futura'], [{ fecha: '2026-02-31' }, 'fecha 31 de febrero'], [{ tipo: 'ajuste' }, 'ventas registra un «ajuste»']]) {
    rechaza(await cobro(x), 'Cobro: ' + texto);
  }
  [s, j] = await cobro({ monto: 1000 }); revisa(s === 201, 'cobro correcto de $1,000');
  [s, j] = await cobro({ monto: 1000 }); revisa(s === 409, 'el mismo cobro dos veces (doble clic) → pregunta', [s, j.error]);
  const dobles = await Promise.all([cobro({ monto: 500, fecha: dias(HOY, -1) }), cobro({ monto: 500, fecha: dias(HOY, -1) })]);
  revisa(dobles.filter(r => r[0] === 201).length === 1, 'dos clics al mismo tiempo en «Registrar pago» → solo uno', dobles.map(r => r[0]));
  const [, cot] = await pedir('POST', '/leads', V, { cliente_id: gib.id, direccion: 'Planta', responsable_id: vid, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: partida(5000), valor: 5000 });
  rechaza(await pedir('POST', '/leads/' + cot.id + '/cobros', V, { monto: 100, metodo: 'efectivo' }), 'cobrar una cotización (no es orden)');
  // Pagos a proveedor
  const pagoProv = x => pedir('POST', '/finanzas/cxp/' + g1.id + '/pagos', A, { monto: 400, metodo: 'transferencia', fecha: HOY, ...x });
  for (const [x, texto] of [[{ monto: 0 }, 'monto 0'], [{ monto: 99999 }, 'más que el saldo'], [{ monto: -1 }, 'negativo'], [{ metodo: 'trueque' }, 'método inventado'], [{ fecha: dias(HOY, 2) }, 'fecha futura']]) {
    rechaza(await pagoProv(x), 'Pago a proveedor: ' + texto);
  }
  const dp = await Promise.all([pagoProv({}), pagoProv({})]);
  revisa(dp.filter(r => r[0] === 201).length === 1, 'pago a proveedor con doble clic → solo uno', dp.map(r => r[0]));
  rechaza(await pedir('POST', '/finanzas/pagos-proveedor/999999/cancelar', V, { motivo: 'ya no aplica' }), 'cancelar un pago que no existe');

  seccion('5b. Cargas por Excel con nombres basura');
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas: [{ fila: 'X #1', fecha: HOY, producto: servicios[0].nombre, subtotal: 100, iva: 16, total: 116, cliente: '<b>Malo</b>' }, { fila: 'X #2', fecha: HOY, producto: servicios[0].nombre, subtotal: 100, iva: 16, total: 116, cliente: '...' }] });
  revisa(j.errores?.length === 2, 'generador: clientes «<b>Malo</b>» y «...» se marcan como error', j.errores);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc?simular=1', A, { filas: [{ fila: 2, nombre: '{{basura}}', fecha: HOY, subtotal: 100, status: 'PENDIENTE', folio: 'Z1' }] });
  revisa(j.errores?.length === 1, 'cobranza: cliente «{{basura}}» se marca como error', j.errores);

  seccion('6. Proveedores duplicados');
  for (const nombre of ['REFACCIONARIA TRAMPOSA S.A. DE C.V.', 'refaccionaria tramposa', 'Refaccionaria  Tramposa.', 'Refacionaria Tramposa']) {
    [s, j] = await pedir('POST', '/finanzas/proveedores', V, { nombre, categoria: 'refacciones' });
    revisa(s === 409, `proveedor «${nombre}» → ya existe uno igual o parecido`, [s, j.error]);
  }
  [s, j] = await pedir('POST', '/finanzas/proveedores', V, { nombre: 'Refacionaria Tramposa', categoria: 'refacciones', forzar: true });
  revisa(s === 201, 'si confirma que es otro proveedor, se crea');
  await pedir('PUT', '/finanzas/proveedores/' + prov.id, A, { nombre: prov.nombre, categoria: 'refacciones', rfc: 'RTR010101AB1' });
  [s, j] = await pedir('POST', '/finanzas/proveedores', V, { nombre: 'Distribuidora Diferente', categoria: 'refacciones', rfc: 'rtr010101ab1' });
  revisa(s === 409, 'proveedor con el RFC de otro → se detiene', [s, j.error]);
  for (const nombre of ['', '...', '<b>Prov</b>', 'x']) { [s, j] = await pedir('POST', '/finanzas/proveedores', V, { nombre, categoria: 'refacciones' }); rechaza([s, j], `proveedor con nombre «${nombre}»`); }

  seccion('7. Cancelaciones con motivos basura');
  const [, cobros] = await pedir('GET', '/leads/' + os1.id + '/cobros', A);
  const cobroId = cobros.cobros?.find(c => !c.cancelado)?.id;
  for (const motivo of ['', '.....', '     ', '-----', 'aaa']) rechaza(await pedir('POST', '/finanzas/cobros/' + cobroId + '/cancelar', A, { motivo }), `cancelar un cobro con motivo «${motivo}»`);
  rechaza(await pedir('POST', '/finanzas/cxp/' + g1.id + '/cancelar', V, { motivo: '.....' }), 'cancelar un gasto con motivo «.....»');
  rechaza(await pedir('POST', '/leads/' + os1.id + '/ejecucion', V, { estado: 'no_realizado', motivo: '.....' }), 'marcar «no realizado» con motivo «.....»');

  seccion('8. Cotizaciones y órdenes mal hechas');
  const cotizar = x => pedir('POST', '/leads', V, { cliente_id: gib.id, direccion: 'Planta', responsable_id: vid, forzar_duplicado: true, iva_modo: 'mas_iva', partidas_json: partida(1000), valor: 1000, ...x });
  for (const [x, texto] of [[{ partidas_json: partida(0) }, 'servicio en $0'], [{ partidas_json: partida(-500) }, 'precio negativo'], [{ partidas_json: '[]' }, 'sin servicios'], [{ partidas_json: 'basura' }, 'partidas basura'],
    [{ partidas_json: JSON.stringify([{ servicio: 'Servicio inventado', leyenda: 'x', importe: 100 }]) }, 'servicio que no está en el catálogo'], [{ direccion: '   ' }, 'sin dirección'],
    [{ estatus: 'ganado', fecha_servicio: null }, 'orden sin fecha de servicio'], [{ fecha_cotizacion: dias(HOY, 5) }, 'cotización con fecha futura'], [{ iva_modo: 'iva_raro' }, 'IVA inventado'],
    [{ cliente_id: 999999 }, 'cliente que no existe']]) {
    rechaza(await cotizar(x), 'Cotización: ' + texto);
  }

  seccion('9. Cuentas: nadie entra ni se crea una cuenta desde fuera');
  for (const cuerpo of [{ nombre: 'Intruso Total', correo: 'intruso@saneadren.com.mx', password: 'Intruso-Total-26' }, { nombre: 'Intruso Dos', correo: 'otro@gmail.com', password: 'Intruso-Total-26' }, {}]) {
    [s, j] = await pedir('POST', '/registro', null, cuerpo); revisa(s === 403 && /administrador/.test(j.error), 'registro desde fuera → cerrado («las cuentas las crea un administrador»)', [s, j]);
  }
  [s] = await pedir('POST', '/login', null, { nombre: 'intruso@saneadren.com.mx', password: 'Intruso-Total-26' }); revisa(s === 401, 'y no quedó ninguna cuenta del intruso');
  rechaza(await pedir('POST', '/usuarios', null, { nombre: 'Intruso Total', password: 'Intruso-Total-26', rol: 'admin' }), 'crear usuario sin sesión');
  rechaza(await pedir('POST', '/usuarios', V, { nombre: 'Intruso Total', password: 'Intruso-Total-26', rol: 'admin' }), 'ventas crea un usuario administrador');
  rechaza(await pedir('PUT', '/usuarios/' + vid, V, { rol: 'admin' }), 'ventas se sube a sí mismo a administrador');
  rechaza(await pedir('POST', '/usuarios/1/password', V, { password: 'Robo-De-Cuenta-26' }), 'ventas le cambia la contraseña al administrador');
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Débil Prueba', password: '1234567890', rol: 'ventas' }); rechaza([s, j], 'el administrador crea un usuario con contraseña débil');
  // Recuperar contraseña
  [s, j] = await pedir('POST', '/olvide-password', null, { correo: 'no-existe@saneadren.com.mx' });
  const [, j2] = await pedir('POST', '/olvide-password', null, { correo: 'ventas.t@saneadren.com.mx' });
  revisa(s === 200 && j.mensaje === j2.mensaje, 'recuperar contraseña responde igual exista o no el correo (no revela quién tiene cuenta)');
  await espera(300);
  const tokens = [...salida.matchAll(/#restablecer=([\w-]+)/g)].map(m => m[1]);
  const token = tokens.at(-1);
  rechaza(await pedir('POST', '/restablecer-password', null, { token: 'x'.repeat(40), password: 'Nueva-Segura-2026' }), 'restablecer con un enlace inventado');
  rechaza(await pedir('POST', '/restablecer-password', null, { token, password: '12345' }), 'restablecer con una contraseña débil');
  [s, j] = await pedir('POST', '/restablecer-password', null, { token, password: 'Nueva-Segura-2026' }); revisa(s === 200, 'el enlace del correo sí cambia la contraseña', [s, j]);
  rechaza(await pedir('POST', '/restablecer-password', null, { token, password: 'Otra-Segura-2027' }), 'el mismo enlace no sirve dos veces');
  [s] = await pedir('GET', '/servicios', V); revisa(s === 401, 'al cambiar la contraseña se cierran las sesiones abiertas');
  let bloqueado = false;
  for (let i = 0; i < 15 && !bloqueado; i++) { const [st] = await pedir('POST', '/login', null, { nombre: 'admin', password: 'Adivinando-' + i }); bloqueado = st === 429; }
  revisa(bloqueado, 'adivinar contraseñas una y otra vez → se bloquea por un rato');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error en |TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
