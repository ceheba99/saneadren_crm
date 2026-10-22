// QUÉ VE CADA ROL («lo suyo»): un equipo real de Querétaro y lo que cada quien puede ver.
//  · Laura y Beto (ventas, lo suyo), Raúl (técnico, órdenes asignadas), Ana (atención, toda la sucursal en ventas y
//    cobranza, nada de proveedores), Isaac (compras: nada de ventas ni cobranza, todas las cuentas por pagar y compras)
//    y Mónica (gerente: todo su sucursal). Más Pedro en CDMX, para que «lo suyo» no se cruce con las sucursales.
//  · Cada dato lleva una palabra única (nombres de piedras). Para cada persona se piden TODAS las rutas del sistema
//    (listas, detalles con cada id, reportes, buscador, Excel) y se revisa el texto completo de las respuestas: lo que
//    no le toca no debe aparecer en ninguna, y lo que sí, debe aparecer.
//  · Luego, reglas: no cotizar a un cliente de otro vendedor (aviso sin detalles), no pasarse cotizaciones, técnico
//    que pierde la orden al desasignarlo, Compras liga gastos a órdenes sin ver montos, cambios de nivel al momento,
//    un rol «Cobranza» inventado, y «ver como».
// Uso: node tests/simulacion-alcance-roles.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-alcance-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Alcance-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-Alcance-2026x';
const PUERTO = String(8700 + Math.floor(Math.random() * 280)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const RANGO = 'desde=2020-01-01&hasta=' + dia(60);

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j, texto;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);
  const SERV = servicios[0], partidas = (leyenda, importe) => JSON.stringify([{ servicio: SERV.nombre, leyenda, importe }]);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  [, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }); const cdmx = j;
  const T = {}, ID = {};
  for (const [nombre, rol, suc] of [['Laura Ventas', 'ventas', qro.id], ['Beto Ventas', 'ventas', qro.id], ['Raul Tecnico', 'tecnico', qro.id], ['Ana Atencion', 'atencion', qro.id],
    ['Isaac Compras', 'costos', qro.id], ['Monica Gerente', 'gerente', qro.id], ['Pedro Ventas', 'ventas', cdmx.id]]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] });
    if (s !== 201) throw new Error('No se creó ' + nombre + ': ' + JSON.stringify(j));
    ID[nombre.split(' ')[0]] = j.id; T[nombre.split(' ')[0]] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const { Laura: L, Beto: B, Raul: R, Ana: N, Isaac: I, Monica: M, Pedro: P } = T;
  const [, prov] = await pedir('POST', '/finanzas/proveedores', I, { nombre: 'Pipas del Bajío', tipo_comprobante: 'factura' });

  // ----- Datos: cada uno con su palabra única -----
  const contacto = async (t, nombre, tel, empresa) => (await pedir('POST', '/contactos', t, { nombre, telefono: tel, empresa_contacto: empresa, direccion: 'Querétaro centro', canal_origen_id: canales[0].id }))[1];
  const cotizar = async (t, quien, cliente, leyenda, imp, ganada) => {
    const [st, x] = await pedir('POST', '/leads', t, { cliente_id: cliente.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID[quien], partidas_json: partidas(leyenda, imp), iva_modo: 'mas_iva', valor: imp,
      ...(ganada ? { estatus: 'ganado', fecha_servicio: dia(-1) } : {}) });
    if (st !== 201) throw new Error('No se cotizó ' + leyenda + ': ' + JSON.stringify(x)); return x;
  };
  const cZafiro = await contacto(L, 'Lic. Zafiro Uno', '442 111 0001', 'Clinica Zafiro');
  const cRubi = await contacto(L, 'Ing. Rubi Dos', '442 111 0002', 'Planta Rubi');
  const cTopacio = await contacto(B, 'Sra. Topacio Tres', '442 111 0003', 'Hotel Topacio');
  const cOnix = await contacto(B, 'Arq. Onix Cuatro', '442 111 0004', 'Torre Onix');
  const cJaspe = await contacto(P, 'Lic. Jaspe Cinco', '55 1111 0005', 'Oficinas Jaspe');
  const L1 = await cotizar(L, 'Laura', cZafiro, 'Desazolve Zafiro', 7123.41);
  const L2 = await cotizar(L, 'Laura', cRubi, 'Limpieza Rubi', 8231.57, true);
  const L3 = await cotizar(B, 'Beto', cTopacio, 'Trampa Topacio', 9347.23, true);
  const L4 = await cotizar(B, 'Beto', cOnix, 'Video Onix', 4417.89);
  const L5 = await cotizar(P, 'Pedro', cJaspe, 'Carcamo Jaspe', 5591.37, true);
  // Técnico asignado a la orden de Laura.
  [s, j] = await pedir('PUT', '/leads/' + L2.id, L, { version: (await pedir('GET', '/leads/' + L2.id, L))[1].version, tecnico_id: ID.Raul });
  revisa(s === 200 && j.tecnico_id === ID.Raul, 'Laura asigna a Raúl como técnico de su orden', j);
  // Cobros: Ana (atención) en ambas órdenes; Raúl en campo en la suya.
  for (const [lead, monto] of [[L2, 1013.29], [L3, 1517.83]]) { [s, j] = await pedir('POST', '/leads/' + lead.id + '/cobros', N, { monto, metodo: 'transferencia', referencia: 'CobroAna' + lead.id }); revisa(s === 201, 'Ana registra un cobro en ' + lead.id, j); }
  [s, j] = await pedir('POST', '/leads/' + L2.id + '/cobros', R, { monto: 503.61, metodo: 'efectivo', referencia: 'CobroRaulGranate' }); revisa(s === 201 && j.confirmado === false, 'Raúl registra un cobro en campo (queda por confirmar)', j);
  revisa(j.cuenta === undefined, 'al registrarlo no recibe la cuenta de la orden (total ni saldo)', j);
  // El técnico, en cuentas por cobrar, solo ve los cobros que él registró (2026-10-21): sin total, saldo ni vencido.
  [s, j] = await pedir('GET', '/leads/' + L2.id + '/cobros', R);
  revisa(s === 200 && j.solo_propios === true && j.cuenta === null && j.cobros.length === 1 && j.cobros[0].referencia === 'CobroRaulGranate' && j.puede_registrar === true && j.puede_operar === false,
    'Raúl abre la cobranza de su orden: solo su cobro, sin la cuenta', j);
  [s, j] = await pedir('POST', '/leads/' + L2.id + '/cobros', R, { monto: 99999, metodo: 'efectivo' });
  revisa(s === 400 && !/\$|\d{3}/.test(j.error), 'si el monto pasa lo que falta por cobrar, el aviso no dice cuánto falta', j);
  [s, j] = await pedir('PUT', '/leads/' + L2.id + '/facturacion', R, { dias_credito: 30 }); revisa(s === 403, 'Raúl no cambia crédito ni factura', [s, j]);
  [s, j] = await pedir('GET', '/finanzas/por-confirmar', R); revisa(s === 403, 'Raúl no confirma cobros (no ve la lista por confirmar)', s);
  [s, j] = await pedir('GET', '/leads/' + L2.id + '/cobros', L);
  revisa(s === 200 && j.cuenta && j.cobros.length === 2 && j.cuenta.cobrado === 1516.9, 'Laura (cobranza de sus órdenes) ve la cuenta completa con los dos cobros', j.cuenta);
  [s, j] = await pedir('GET', '/calendario?desde=' + dia(-40) + '&hasta=' + dia(60), R);
  revisa(s === 200 && !j.eventos.some(e => e.tipo === 'cobro') && j.eventos.some(e => e.tipo === 'orden' && e.lead_id === L2.id), 'en el calendario de Raúl está su orden pero ningún cobro', j.eventos?.map(e => e.tipo));
  // Gastos: Raúl al marcar realizado; Laura uno en su orden; Isaac uno ligado a la orden de Beto (sin ver sus ventas).
  [s, j] = await pedir('POST', '/leads/' + L2.id + '/ejecucion', R, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, categoria: 'combustible', concepto: 'Diesel GastoAmatista', total: 813.37 }] });
  revisa(s === 200, 'Raúl marca su orden como realizada con un gasto', j);
  [s, j] = await pedir('POST', '/finanzas/cxp', L, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Casetas GastoCuarzo', total: 311.13, fecha_documento: HOY, lead_id: L2.id, dias_credito: 0 });
  revisa(s === 201, 'Laura registra un gasto en su orden', j);
  [s, j] = await pedir('GET', '/finanzas/ordenes-para-gasto', I);
  const paraIsaac = JSON.stringify(j);
  revisa(s === 200 && j.some(o => o.id === L3.id) && j.some(o => o.id === L2.id) && !j.some(o => o.id === L1.id || o.id === L4.id || o.id === L5.id), 'Isaac ve las órdenes contratadas de QRO para ligar gastos (no cotizaciones ni CDMX)', j.map?.(o => o.id));
  revisa(!/valor|partidas_json|iva_cent|9347/.test(paraIsaac), 'y en esa lista no viene ningún monto de la venta', paraIsaac.slice(0, 300));
  [s, j] = await pedir('POST', '/finanzas/cxp', I, { proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Pipa GastoJade', total: 2577.19, fecha_documento: HOY, lead_id: L3.id, dias_credito: 15 });
  revisa(s === 201, 'Isaac liga un gasto a la orden de Beto aunque no ve sus ventas', j);
  // Solicitudes de compra.
  [s, j] = await pedir('POST', '/compras/solicitudes', L, { que: 'Botas SolPerla', para_que: 'Para visitas de obra', centro_id: centros[0].id }); revisa(s === 201, 'Laura pide una compra', j);
  [s, j] = await pedir('POST', '/compras/solicitudes', R, { que: 'Manguera SolCoral', para_que: 'Se rompió en servicio', centro_id: centros[0].id }); revisa(s === 201, 'Raúl pide una compra', j);

  // ----- Rastreo: todas las rutas de cada persona -----
  const rutasGet = [];
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'server')).filter(f => f.endsWith('.js')))
    for (const m of fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8').matchAll(/app\.get\(\s*'\/api(\/[^']+)'/g)) rutasGet.push(m[1]);
  const [, cxpTodas] = await pedir('GET', '/finanzas/cxp?vista=todas', A);
  const [, sols] = await pedir('GET', '/compras/solicitudes?estado=', A);
  const ids = [...new Set([L1, L2, L3, L4, L5].map(x => x.id).concat([cZafiro, cRubi, cTopacio, cOnix, cJaspe].map(c => c.id), cxpTodas.map(x => x.id), sols.map(x => x.id)))];
  const EXTRA = ['/leads', '/leads?estatus=ganado', '/clientes', '/clientes?incluir_prospectos=1', '/clientes/catalogo', '/finanzas/cartera', '/finanzas/cartera?vista=clientes', '/finanzas/resumen', '/finanzas/periodo?' + RANGO,
    '/finanzas/cxp?vista=todas', '/finanzas/por-confirmar', '/finanzas/cxp/formato-excel', '/tablero?' + RANGO, '/generador?' + RANGO, '/calendario?' + RANGO, '/compras/solicitudes?estado=', '/compras/ordenes',
    '/kpis', '/pendientes', '/resultados?' + RANGO, '/contactos-sin-cotizacion', ...['Zafiro', 'Rubi', 'Topacio', 'Onix', 'Jaspe', 'Amatista', 'Jade', 'Cuarzo', 'Perla', 'Coral', 'Granate'].map(p => '/buscar?q=' + p),
    ...['442 111 0001', '442 111 0002', '442 111 0003', '442 111 0004', '55 1111 0005'].map(t => '/leads/buscar-telefono/' + encodeURIComponent(t))];
  async function rastrear(t) {
    let todo = '';
    const urls = new Set(EXTRA);
    for (const r of rutasGet) {
      if (/^\/(demo|permisos|roles|admin)\b|buscar-telefono/.test(r)) continue;
      if (!/:[a-z_]+/i.test(r)) { urls.add(r); continue; }
      for (const id of ids) urls.add(r.replace(/:[a-z_]+/gi, String(id)));
    }
    for (const u of urls) { const [st, , tx] = await pedir('GET', u, t); if (st === 200) todo += '\n' + u.replace(/[?].*/, '') + ' ' + tx.replace(/"q":"[^"]*"/, ''); } // solo la respuesta cuenta (el buscador repite lo buscado)
    return todo;
  }
  const formas = v => { const c = Math.round(v * 100), t = Math.round(c * 1.16); return [c, t].flatMap(x => [(x / 100).toFixed(2), String(x), (x / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })]); };
  const MARCAS = Object.fromEntries(['Zafiro', 'Rubi', 'Topacio', 'Onix', 'Jaspe', 'Amatista', 'Cuarzo', 'Jade', 'SolPerla', 'SolCoral', 'Granate'].map(w => [w, [w]]));
  Object.assign(MARCAS, { '$venta-Zafiro': formas(7123.41), '$venta-Rubi': formas(8231.57), '$venta-Topacio': formas(9347.23), '$venta-Onix': formas(4417.89), '$venta-Jaspe': formas(5591.37),
    '$cobro-Ana-Rubi': formas(1013.29), '$cobro-Ana-Topacio': formas(1517.83), '$cobro-Raul': formas(503.61),
    '$gasto-Amatista': formas(813.37), '$gasto-Cuarzo': formas(311.13), '$gasto-Jade': formas(2577.19) });
  const PALABRAS = Object.keys(MARCAS);
  const aparece = (todo, m) => MARCAS[m].find(f => todo.includes(f));
  // Lo que cada uno DEBE ver (lo demás no debe aparecer en ninguna respuesta).
  const ESPERADO = {
    Laura: ['Zafiro', 'Rubi', 'Cuarzo', 'SolPerla', '$venta-Zafiro', '$venta-Rubi', '$cobro-Ana-Rubi', '$cobro-Raul', '$gasto-Cuarzo'], // lo suyo y la cobranza de sus órdenes
    Beto: ['Topacio', 'Onix', '$venta-Topacio', '$venta-Onix', '$cobro-Ana-Topacio'],
    Raul: ['Rubi', 'Amatista', 'SolCoral', 'Granate', '$venta-Rubi', '$cobro-Raul', '$gasto-Amatista'], // la orden asignada, solo el cobro que él registró, su gasto, su solicitud
    Ana: ['Zafiro', 'Rubi', 'Topacio', 'Onix', 'Granate', '$venta-Zafiro', '$venta-Rubi', '$venta-Topacio', '$venta-Onix', '$cobro-Ana-Rubi', '$cobro-Ana-Topacio', '$cobro-Raul'], // nada de proveedores
    Isaac: ['Rubi', 'Topacio', 'Amatista', 'Cuarzo', 'Jade', 'SolPerla', 'SolCoral', '$gasto-Amatista', '$gasto-Cuarzo', '$gasto-Jade'], // folio y cliente (sin montos de venta), todo CxP y compras
    Monica: Object.keys(MARCAS).filter(m => !/Jaspe/.test(m)),
    Pedro: ['Jaspe', '$venta-Jaspe'],
  };
  ESPERADO.Laura.push('Granate'); // el cobro de Raúl es de la orden de Laura: ella ve la cobranza de sus órdenes
  console.log(`Rastreo de ${rutasGet.length} rutas con ${ids.length} ids por persona:`);
  for (const [quien, debe] of Object.entries(ESPERADO)) {
    const todo = await rastrear(T[quien]);
    const fugas = PALABRAS.filter(p => !debe.includes(p) && aparece(todo, p));
    const faltan = debe.filter(p => !aparece(todo, p));
    const donde = p => { const f = aparece(todo, p); const l = todo.split('\n').find(x => x.includes(f)) || ''; const i = l.indexOf(f); return l.slice(0, 40) + ' … ' + l.slice(Math.max(0, i - 80), i + 40); };
    revisa(!fugas.length, `${quien}: no aparece nada que no le toca`, fugas.map(p => p + ' en ' + donde(p)));
    revisa(!faltan.length, `${quien}: sí ve lo suyo (${debe.join(', ')})`, faltan);
  }
  // Isaac ve folio y cliente de las órdenes, pero nada de la venta: ni montos ni cobranza.
  [s] = await pedir('GET', '/finanzas/cartera', I); revisa(s === 403, 'Isaac no entra a cuentas por cobrar');
  [s] = await pedir('GET', '/leads/' + L3.id, I); revisa(s === 404, 'Isaac no abre la orden de venta (no existe para él)');
  [s] = await pedir('GET', '/finanzas/cxp', N); revisa(s === 403, 'Ana no entra a cuentas por pagar');

  // ----- Acceso directo por número: lo ajeno «no existe» -----
  for (const [quien, t, lead] of [['Laura', L, L3], ['Laura', L, L4], ['Beto', B, L1], ['Raul', R, L1], ['Raul', R, L3], ['Pedro', P, L2], ['Isaac', I, L2]]) {
    [s] = await pedir('GET', '/leads/' + lead.id, t); revisa(s === 404, `${quien} abre la orden ${lead.id} de otro escribiendo su número: no existe`);
    [s] = await pedir('PUT', '/leads/' + lead.id, t, { notas_iniciales: 'hack' }); revisa(s === 404, `${quien} no la puede editar`);
    [s] = await pedir('POST', '/leads/' + lead.id + '/cobros', t, { monto: 1, metodo: 'efectivo' }); revisa(s === 404 || s === 403, `${quien} no le registra cobros`, s);
  }
  [s] = await pedir('GET', '/clientes/' + cTopacio.id, L); revisa(s === 404, 'Laura no abre la ficha del cliente de Beto');
  const cxpRaul = cxpTodas.find(x => /Amatista/.test(x.concepto));
  [s] = await pedir('GET', '/finanzas/cxp/' + cxpRaul.id + '/pagos', L); revisa(s === 404 || s === 403, 'Laura no ve los pagos del gasto de Raúl', s);

  console.log('\nReglas de «lo suyo»');
  // Beto intenta cotizarle al cliente de Laura.
  [s, j, texto] = await pedir('GET', '/leads/buscar-telefono/' + encodeURIComponent('442 111 0001'), B);
  revisa(j.cliente?.otro_vendedor === true && j.cliente.atendido_por === 'Laura Ventas' && !/Zafiro/.test(texto), 'al capturar el teléfono, a Beto se le avisa «lo atiende Laura Ventas» sin datos del cliente', j);
  [s, j] = await pedir('POST', '/leads', B, { cliente_id: cZafiro.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Beto, partidas_json: partidas('Robo', 100), iva_modo: 'sin_iva', valor: 100, forzar_duplicado: true });
  revisa(s === 409 && j.codigo === 'CLIENTE_DE_OTRO', 'Beto no puede cotizarle a un cliente de Laura', j);
  [s, j] = await pedir('POST', '/leads', B, { telefono: '442 111 0001', nombre: 'Otro nombre', direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Beto, partidas_json: partidas('Robo 2', 100), iva_modo: 'sin_iva', valor: 100 });
  revisa(s === 409 && j.codigo === 'CLIENTE_DE_OTRO', 'ni capturándolo como contacto nuevo con el mismo teléfono', j);
  [s, j] = await pedir('POST', '/contactos', B, { nombre: 'Copia Zafiro', telefono: '442 111 0001', direccion: 'x', canal_origen_id: canales[0].id });
  revisa(s === 409 && !/Zafiro/.test(JSON.stringify(j)), 'ni dándolo de alta otra vez (y el aviso no revela su nombre)', j);
  [s, j] = await pedir('POST', '/leads', B, { cliente_id: cOnix.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Laura, partidas_json: partidas('A nombre de otra', 100), iva_modo: 'sin_iva', valor: 100, forzar_duplicado: true });
  revisa(s === 403, 'Beto no registra cotizaciones a nombre de Laura', j);
  [s, j] = await pedir('PUT', '/leads/' + L4.id, B, { version: (await pedir('GET', '/leads/' + L4.id, B))[1].version, responsable_id: ID.Laura });
  revisa(s === 403, 'Beto no se pasa una cotización a otro vendedor (lo hace el gerente)', j);
  [s, j] = await pedir('POST', '/leads', P, { cliente_id: cTopacio.id, direccion: 'Sucursal CDMX', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Pedro, partidas_json: partidas('Cliente compartido', 100), iva_modo: 'sin_iva', valor: 100, forzar_duplicado: true });
  revisa(s === 201, 'Pedro (CDMX) sí le cotiza al cliente de QRO: entre sucursales se comparten como antes', j);
  // El gerente reasigna.
  [s, j] = await pedir('PUT', '/leads/' + L1.id, M, { version: (await pedir('GET', '/leads/' + L1.id, M))[1].version, responsable_id: ID.Beto });
  revisa(s === 200, 'Mónica (gerente) pasa la cotización de Zafiro a Beto');
  [s] = await pedir('GET', '/leads/' + L1.id, B); revisa(s === 200, 'ahora Beto la ve');
  [s] = await pedir('GET', '/leads/' + L1.id, L); revisa(s === 404, 'y Laura ya no');
  // El técnico pierde la orden al desasignarlo, pero conserva su gasto.
  [s] = await pedir('PUT', '/leads/' + L2.id, L, { version: (await pedir('GET', '/leads/' + L2.id, L))[1].version, tecnico_id: null }); revisa(s === 200, 'Laura le quita la orden a Raúl');
  [s] = await pedir('GET', '/leads/' + L2.id, R); revisa(s === 404, 'Raúl ya no ve esa orden');
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', R); revisa(s === 200 && j.some(x => /Amatista/.test(x.concepto)) && !j.some(x => /Cuarzo|Jade/.test(x.concepto)), 'pero sigue viendo el gasto que él registró (y solo ese)', j.map?.(x => x.concepto));
  [s, j] = await pedir('PUT', '/leads/' + L2.id, L, { version: (await pedir('GET', '/leads/' + L2.id, L))[1].version, tecnico_id: 999999 }); revisa(s === 400, 'no se asigna un técnico que no existe');

  console.log('\nCambios de nivel al momento y roles inventados');
  const nivel = async (rol, alcances) => { const t = (await pedir('GET', '/permisos', A))[1].roles.find(r => r.clave === rol); return pedir('PUT', '/roles/' + rol + '/permisos', A, { permisos: t.permisos, alcances }); };
  [s, j] = await nivel('ventas', { ventas: 2 }); revisa(s === 200, 'Dirección cambia a ventas: ve toda su sucursal');
  [s, j] = await pedir('GET', '/leads', L); revisa(j.some(x => x.id === L3.id) && !j.some(x => x.id === L5.id), 'Laura ya ve las de Beto (y no las de CDMX)', j.map(x => x.id));
  [s, j] = await nivel('ventas', { ventas: 1 }); revisa(s === 200, 'y la regresa a «lo suyo»');
  [s, j] = await pedir('GET', '/leads', L); revisa(!j.some(x => x.id === L3.id), 'al instante deja de verlas');
  [s, j] = await nivel('ventas', { cxc: 0 }); revisa(s === 400 && /necesita/.test(j.error), 'no se le quita la cobranza a ventas mientras pueda confirmar cobros', j);
  [s, j] = await nivel('costos', { compras: 1 }); revisa(s === 400, 'ni «lo suyo» en compras a quien gestiona compras (necesita toda su sucursal)', j);
  [s, j] = await pedir('POST', '/roles', A, { nombre: 'Cobranza' }); const COB = j.clave;
  [s, j] = await pedir('PUT', '/roles/' + COB + '/permisos', A, { permisos: ['cobros.registrar', 'cobros.confirmar'], alcances: { ventas: 0, cxc: 2, cxp: 0, compras: 0 } }); revisa(s === 200, 'rol «Cobranza»: nada de ventas, toda la cobranza', j);
  [s] = await pedir('POST', '/usuarios', A, { nombre: 'Carla Cobranza', password: CLAVE, rol: COB, sucursales: [qro.id] });
  const C = (await pedir('POST', '/login', null, { nombre: 'Carla Cobranza', password: CLAVE }))[1].token;
  [s, j] = await pedir('GET', '/leads', C); revisa(j.some(x => x.id === L2.id) && j.some(x => x.id === L3.id) && !j.some(x => x.id === L1.id || x.id === L4.id), 'Carla ve las órdenes contratadas (para cobrarlas), no las cotizaciones', j.map(x => x.id));
  [s] = await pedir('POST', '/compras/solicitudes', C, { que: 'Algo', para_que: 'Prueba', centro_id: centros[0].id }); revisa(s === 403, 'sin compras no hace solicitudes');
  [s] = await pedir('POST', '/leads', C, { cliente_id: cRubi.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: (await pedir('GET', '/usuarios', A))[1].find(u => u.nombre === 'Carla Cobranza').id, partidas_json: partidas('x', 1), iva_modo: 'sin_iva', valor: 1, forzar_duplicado: true });
  revisa(s === 403, 'sin ventas no cotiza');
  // «Ver como»: Dirección mira con los niveles de ventas (lo suyo de Dirección: nada).
  [s, j] = await pedir('GET', '/leads', A, undefined, { 'X-Ver-Como': 'ventas' }); revisa(s === 200 && !j.length, 'Dirección «viendo como ventas» no ve las cotizaciones de los vendedores', j.length);
  [s, j] = await pedir('GET', '/permisos/mios', L); revisa(j.alcances?.ventas === 1 && j.permisos.includes('ventas.ver') && !j.permisos.includes('ventas.sucursal'), 'la pantalla de Laura sabe qué ve (para esconder menús)', j.alcances);
  [s, j] = await pedir('GET', '/permisos/mios', I); revisa(!j.permisos.includes('ventas.ver') && !j.permisos.includes('cxc.ver'), 'la de Isaac sabe que no ve ventas ni cobranza');

  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
