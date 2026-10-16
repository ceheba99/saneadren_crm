// SUCURSALES — los procesos completos, paso a paso, como los haría la gente (y como intentaría saltarse las reglas).
//  1. Dirección abre la sucursal CDMX y da de alta a su gente (gerente, ventas, compras, técnico).
//  2. Lo primero que ve Pedro (ventas CDMX) al entrar.
//  3. Venta completa en CDMX: contacto → cotización → orden → realizado con costo → factura → cobro.
//  4. Compra completa en CDMX: solicitud → aprobación de la gerente → 3 cotizaciones → orden → autorización → recepción → pago.
//  5. Clientes compartidos: KFC de Querétaro también le compra a CDMX; qué ve cada quien.
//  6. Intentos de saltar de sucursal: encabezados raros, campos escondidos, sesiones viejas, sucursal desactivada,
//     usuarios que cambian de sucursal, roles que se intentan subir, folios a mano y dos sucursales creando a la vez.
//  7. Lo que ve Dirección: todas juntas, una por una y el comparativo.
// Uso: node tests/simulacion-sucursales-procesos.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sucp-')); const PUERTO = String(8500 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Procesos-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const URL = `http://localhost:${PUERTO}/api`;
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* archivo */ }
  return [x.status, j, texto];
};
const subir = async (r, t, buf, enc) => {
  const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t };
  for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v));
  const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf }); return [x.status, await x.json().catch(() => ({}))];
};
const pdf = t => Buffer.from(`%PDF-1.4\n% ${t} ${crypto.randomBytes(6).toString('hex')}\n%%EOF`);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(48)]);
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const MES = HOY.slice(0, 7).replace('-', '');
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const total = sub => Math.round(sub * 116) / 100;

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  let s, j, t;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);
  const SERV = servicios[0];
  const partidas = (leyenda, importe) => JSON.stringify([{ servicio: SERV.nombre, leyenda, importe }]);

  // Querétaro ya trabaja antes de que exista CDMX (como hoy en producción).
  await pedir('POST', '/usuarios', A, { nombre: 'Laura Ventas', password: 'Clave-Fuerte-2026-lv', rol: 'ventas' });
  const LQ = (await pedir('POST', '/login', null, { nombre: 'Laura Ventas', password: 'Clave-Fuerte-2026-lv' }))[1].token;
  const [, kfc] = await pedir('POST', '/contactos', LQ, { nombre: 'Ing. Sofía Hernández', telefono: '442 690 1122', empresa_contacto: 'Operadora KFC', direccion: 'Blvd. Bernardo Quintana 400', canal_origen_id: canales[0].id, rfc: 'OKB980512AB3' });
  const [, usQ] = await pedir('GET', '/usuarios', A), laura = usQ.find(u => u.nombre === 'Laura Ventas');
  const [, cotQ] = await pedir('POST', '/leads', LQ, { cliente_id: kfc.id, direccion: 'Sucursal Juriquilla', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: laura.id, partidas_json: partidas('Trampa de grasa Juriquilla (QRO)', 4800), iva_modo: 'mas_iva', valor: 4800, fecha_cotizacion: dia(-10) });
  { const [, l] = await pedir('GET', '/leads/' + cotQ.id, LQ); await pedir('PUT', '/leads/' + cotQ.id, LQ, { version: l.version, estatus: 'ganado', fecha_servicio: dia(-8) }); }
  await pedir('POST', '/leads/' + cotQ.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-8), realizado_por: 'propio' });
  await pedir('PUT', '/leads/' + cotQ.id + '/facturacion', A, { dias_credito: 0, factura_folio: 'Q-1', factura_fecha: dia(-8) });
  revisa(cotQ.folio_num != null, 'antes de abrir CDMX, Querétaro ya trabaja normal (folio ' + cotQ.folio_num + ')');

  console.log('1. Dirección abre CDMX y da de alta a su gente');
  [s, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX', direccion: 'Insurgentes Sur 1602', telefono: '55 5250 7700' });
  const cdmx = j, qro = (await pedir('GET', '/sucursales', A))[1].sucursales.find(x => x.clave === 'QRO');
  revisa(s === 201, 'Ajustes → Sucursales → «Crear sucursal» CDMX');
  [s, j] = await pedir('GET', '/usuarios', A); revisa(j.find(u => u.nombre === 'Laura Ventas')?.sucursales?.join() === String(qro.id), 'Laura (que ya existía) queda en Querétaro; no pierde nada', j.find(u => u.nombre === 'Laura Ventas'));
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Pedro Ventas', password: 'Clave-Fuerte-2026-pv', rol: 'ventas' }); revisa(s === 400 && /sucursal/i.test(j.error), 'si se olvida elegir la sucursal, el sistema lo pide', j.error);
  const alta = async (nombre, rol, sucs, quien = A) => pedir('POST', '/usuarios', quien, { nombre, password: 'Clave-Fuerte-2026-' + rol, rol, sucursales: sucs, temporal: false });
  [s] = await alta('Mónica Gerente', 'gerente', [cdmx.id]); revisa(s === 201, 'Dirección crea a la gerente de CDMX');
  const MG = (await pedir('POST', '/login', null, { nombre: 'Mónica Gerente', password: 'Clave-Fuerte-2026-gerente' }))[1];
  revisa(MG.rol === 'admin' && MG.rol_real === 'gerente', 'la gerente entra con permisos de administración (pero de su sucursal)', MG);
  [s] = await alta('Pedro Ventas', 'ventas', [cdmx.id], MG.token); revisa(s === 201, 'la gerente da de alta a Pedro (ventas) en CDMX');
  [s] = await alta('Óscar Compras', 'costos', [cdmx.id], MG.token); revisa(s === 201, 'y a Óscar (compras)');
  [s] = await alta('Juan Tecnico', 'tecnico', [cdmx.id], MG.token); revisa(s === 201, 'y a Juan (técnico)');
  const entrar = async (nombre, rol) => (await pedir('POST', '/login', null, { nombre, password: 'Clave-Fuerte-2026-' + rol }))[1].token;
  const P = await entrar('Pedro Ventas', 'ventas'), O = await entrar('Óscar Compras', 'costos'), J = await entrar('Juan Tecnico', 'tecnico'), G = MG.token;
  const [, todos] = await pedir('GET', '/usuarios', A), uid = nombre => todos.find(u => u.nombre === nombre).id;

  console.log('2. Lo primero que ve Pedro al entrar');
  [s, j] = await pedir('GET', '/sucursales', P);
  revisa(j.sucursales.length === 1 && j.sucursales[0].clave === 'CDMX' && !j.admin_general, 'solo conoce su sucursal (no hay selector: tiene una sola)', j);
  [s, j] = await pedir('GET', '/leads', P); revisa(Array.isArray(j) && j.length === 0, 'Ventas: vacío (lo de Querétaro no existe para él)', j.length);
  [s, j] = await pedir('GET', '/finanzas/resumen', P); revisa(j.por_cobrar === 0 && j.por_pagar === 0 && j.cobrado_mes === 0, 'Inicio: «Te deben $0», «Pagar $0»', j);
  [s, j] = await pedir('GET', '/clientes?incluir_prospectos=1', P); revisa(j.length === 0, 'Clientes: vacío');
  [s, j] = await pedir('GET', '/usuarios', P); revisa(j.every(u => u.sucursales.includes(cdmx.id)) && !j.some(u => u.nombre === 'Laura Ventas'), 'en la lista de responsables solo aparece la gente de CDMX', j.map(u => u.nombre));
  [s, j] = await pedir('GET', '/servicios', P); revisa(j.length === servicios.length, 'los catálogos (servicios, canales, proveedores) son los mismos para todos');

  console.log('3. Venta completa en CDMX');
  [s, j] = await pedir('POST', '/contactos', P, { nombre: 'Arq. Daniela Ríos', telefono: '55 5250 1234', empresa_contacto: 'Corporativo Torre Reforma', direccion: 'Paseo de la Reforma 483', canal_origen_id: canales[0].id });
  const torre = j; revisa(s === 201 && torre.sucursal_id === cdmx.id, 'Pedro da de alta un contacto: queda en CDMX', [s, j.sucursal_id]);
  [s, j] = await pedir('POST', '/leads', P, { cliente_id: torre.id, direccion: 'Sótano 3', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: uid('Pedro Ventas'), partidas_json: partidas('Desazolve de cárcamo', 28500), iva_modo: 'mas_iva', valor: 28500, fecha_cotizacion: dia(-6) });
  const cot = j; revisa(s === 201 && cot.sucursal_id === cdmx.id && cot.folio_num === 1, 'cotiza: COT-CDMX-…-0001 (su primer folio)', [s, cot.sucursal_id, cot.folio_num]);
  [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent('COT-CDMX-' + MES + '-0001'), P); revisa(j.length === 1 && j[0].id === cot.id, 'la encuentra por su folio');
  { const [, l] = await pedir('GET', '/leads/' + cot.id, P); [s, j] = await pedir('PUT', '/leads/' + cot.id, P, { version: l.version, estatus: 'ganado', fecha_servicio: dia(-4) }); }
  revisa(s === 200 && j.folio_num === 1, 'el cliente acepta: pasa a OS-CDMX-…-0001 (mismo número)', [s, j.folio_num]);
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas del Valle', categoria: 'renta_maquinaria', dias_credito: 15 });
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/ejecucion', J, { estado: 'realizado', fecha: dia(-4), realizado_por: 'subcontratado', gastos: [{ proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Pipa 20 m3', total: 9000 }] });
  revisa(s === 200 || s === 201, 'Juan (técnico CDMX) lo marca realizado con el costo de la pipa', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', O); const costo = j.find(x => x.lead_id === cot.id);
  revisa(costo && costo.sucursal_id === cdmx.id && costo.orden_folio === `OS-CDMX-${MES}-0001`, 'el costo cae en Cuentas por pagar de CDMX, ligado a su orden', costo);
  [s, j] = await pedir('PUT', '/leads/' + cot.id + '/facturacion', G, { dias_credito: 15, factura_folio: 'C-101', factura_fecha: dia(-4) }); revisa(s === 200, 'la gerente registra la factura');
  [s, j] = await pedir('POST', '/leads/' + cot.id + '/cobros', P, { monto: 10000, metodo: 'transferencia', fecha: dia(-1), referencia: 'Anticipo Torre' });
  revisa(s === 201 && !j.confirmado, 'Pedro registra un pago: queda «por confirmar»', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cobros/' + j.id + '/confirmar', G); revisa(s === 200, 'la gerente lo confirma');
  [s, j] = await pedir('GET', '/finanzas/cartera', P); const filaT = (Array.isArray(j) ? j : j.cuentas || []).find(x => x.lead_id === cot.id);
  revisa(filaT && Math.round(filaT.saldo * 100) === Math.round((total(28500) - 10000) * 100) && filaT.folio === `OS-CDMX-${MES}-0001`, 'Cuentas por cobrar de CDMX: debe ' + (total(28500) - 10000).toFixed(2), filaT);

  console.log('4. Compra completa en CDMX');
  [s, j] = await pedir('POST', '/compras/solicitudes', P, { que: 'Hidrolavadora agua caliente', para_que: 'Para las trampas de grasa de CDMX', centro_id: centros[0].id });
  const sol = j; revisa(s === 201 && sol.folio === `SOL-CDMX-${MES}-0001`, 'Pedro pide una compra: SOL-CDMX-…-0001', sol.folio);
  [s] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', P); revisa(s === 403, 'Pedro no puede aprobar su propia solicitud');
  [s] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/aprobar', G); revisa(s === 200, 'la gerente la aprueba');
  const provs = [prov];
  for (const nombre of ['Karcher Centro', 'Hidro Equipos']) provs.push((await pedir('POST', '/finanzas/proveedores', O, { nombre, categoria: 'herramientas', dias_credito: 0 }))[1]);
  for (const [k, p] of provs.entries()) [s, j] = await subir('/compras/solicitudes/' + sol.id + '/documentos', O, pdf('cot' + k), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': 31000 + k * 500, 'X-Nombre': 'cot' + k + '.pdf' });
  revisa(s === 201 || s === 200, 'Óscar sube las 3 cotizaciones', [s, j.error]);
  const cots = (await pedir('GET', '/compras/solicitudes/' + sol.id, O))[1].cotizaciones;
  [s] = await pedir('POST', '/compras/solicitudes/' + sol.id + '/elegir', O, { cotizacion_id: cots[0].id }); revisa(s === 200, 'elige la más barata');
  [s, j] = await pedir('POST', '/compras/ordenes', O, { solicitud_id: sol.id, proveedor_id: cots[0].proveedor_id, centro_id: centros[0].id, categoria: 'herramientas', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Hidrolavadora', unidad: 'PZA', precio: 31000 }] });
  const oc = j; revisa(s === 201 && oc.folio === `OC-CDMX-${MES}-0001` && oc.sucursal_id === cdmx.id, 'genera la orden: OC-CDMX-…-0001', [s, oc.folio, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', G, { dias_credito: 15 }); revisa(s === 200, 'la gerente la autoriza con 15 días de crédito');
  const cxpOC = j.cxp_id;
  await subir('/compras/ordenes/' + oc.id + '/documentos', O, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'firma.png' });
  [s] = await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', O, { recibio: 'Juan', nota: 'Llegó completa' }); revisa(s === 200, 'Óscar la marca recibida con firma');
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cxpOC + '/pagos', O, { monto: 31000, metodo: 'transferencia', fecha: HOY, referencia: 'SPEI hidrolavadora', cuenta_origen: 'BBVA CDMX' }); revisa(s === 201, 'y la paga');
  [s, j] = await pedir('GET', '/finanzas/proveedores/' + cots[0].proveedor_id + '/estado-cuenta', O);
  revisa(j.ordenes.some(o => o.folio === oc.folio) && j.pagos.some(g => g.cuenta_origen === 'BBVA CDMX'), 'la ficha del proveedor (en CDMX) muestra la orden y el pago');
  [s, j] = await pedir('GET', '/finanzas/proveedores/' + cots[0].proveedor_id + '/estado-cuenta', LQ);
  revisa(s === 200 && !j.ordenes.length && !j.pagos.length && j.debe === 0, 'el mismo proveedor visto desde Querétaro: sin las compras de CDMX', [j.ordenes?.length, j.pagos?.length]);

  console.log('5. Clientes compartidos (KFC)');
  const sinDatosKFC = txt => !/Operadora KFC|Sofía|OKB980512|690 1122|Bernardo Quintana/i.test(txt.replace(/4426901122|442 690 1122/g, ''));
  [s, j, t] = await pedir('GET', '/leads/buscar-telefono/4426901122', P);
  revisa(j.cliente?.id === kfc.id && j.cliente.otra_sucursal && j.cliente.folio && j.solicitudes.length === 0 && sinDatosKFC(t), 'Pedro escribe el teléfono de KFC: «ya está registrado en otra sucursal (CLI-…)», sin nombre, empresa ni RFC', j);
  [s, j, t] = await pedir('POST', '/contactos', P, { nombre: 'Gerente KFC Reforma', telefono: '442 690 1122', empresa_contacto: 'KFC Reforma', direccion: 'Reforma 222', canal_origen_id: canales[0].id });
  revisa(s === 409 && j.cliente_id === kfc.id && /otra sucursal/.test(j.error) && sinDatosKFC(t), 'si intenta darlo de alta otra vez: no lo duplica y tampoco le enseña sus datos', [s, j.error]);
  [s, j, t] = await pedir('POST', '/contactos', P, { nombre: 'Ing. Sofía Hernández', telefono: '55 1234 9876', empresa_contacto: 'Operadora KFC', direccion: 'Reforma 222', canal_origen_id: canales[0].id });
  revisa(s === 409 && j.error === 'posible_duplicado' && j.parecidos.every(p => p.otra_sucursal && !p.telefono && !p.rfc) && !/OKB980512|690 1122|Bernardo/.test(t), 'con el mismo nombre en otro teléfono: pregunta «¿es el mismo?» sin enseñar teléfono ni RFC del otro', j.parecidos);
  [s, j] = await pedir('POST', '/contactos', P, { nombre: 'Ing. Sofía Hernández', telefono: '55 1234 9876', empresa_contacto: 'Operadora KFC', direccion: 'Reforma 222', canal_origen_id: canales[0].id, agregar_telefono_a: kfc.id });
  revisa(s === 409 && j.cliente_id === kfc.id && j.cliente?.otra_sucursal, 'si dice «es el mismo»: se usa ese cliente, pero NO se le agrega el teléfono (sus datos son de Querétaro)', [s, j.error]);
  [s, j] = await pedir('GET', '/clientes/' + kfc.id + '/telefonos', A); revisa(!j.some(x => x.telefono_normalizado === '5512349876'), 'el teléfono de CDMX no se agregó a KFC', j);
  [s, j] = await pedir('POST', '/leads', P, { cliente_id: kfc.id, direccion: 'Sucursal Reforma, CDMX', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: uid('Pedro Ventas'), partidas_json: partidas('Trampa de grasa Reforma (CDMX)', 5200), iva_modo: 'mas_iva', valor: 5200, fecha_cotizacion: HOY });
  const cotK = j; revisa(s === 201 && cotK.sucursal_id === cdmx.id, '«Cotizarle a este cliente»: la cotización es de CDMX, al mismo KFC', [s, j.error]);
  [s, j] = await pedir('POST', '/leads', P, { agregar_telefono_a: kfc.id, telefono: '55 1234 9877', direccion: 'Sucursal Polanco, CDMX', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: uid('Pedro Ventas'), forzar_duplicado: true, partidas_json: partidas('Trampa de grasa Polanco (CDMX)', 5200), iva_modo: 'mas_iva', valor: 5200 });
  { const [, tel] = await pedir('GET', '/clientes/' + kfc.id + '/telefonos', A); revisa(s === 201 && j.cliente_id === kfc.id && !tel.some(x => x.telefono_normalizado === '5512349877'), 'cotizar con «agregar este teléfono» desde CDMX: se cotiza a KFC sin tocar sus teléfonos', [s, j.error]); }
  [s, j, t] = await pedir('GET', '/clientes/' + kfc.id, P);
  revisa(s === 200 && j.servicios.length === 2 && j.servicios.every(x => x.sucursal_id === cdmx.id) && !/Juriquilla/.test(t), 'ya que le vende, Pedro ve la ficha de KFC (para la cotización), pero solo con lo de CDMX', j.servicios?.map(x => x.id));
  [s, j, t] = await pedir('GET', '/clientes/' + kfc.id, LQ);
  revisa(j.servicios.length === 1 && j.servicios[0].id === cotQ.id && !/\(CDMX\)/.test(t), 'y Laura (Querétaro) ve solo lo de Querétaro', j.servicios?.map(x => x.id));
  [s, j] = await pedir('GET', '/finanzas/clientes/' + kfc.id + '/estado-cuenta?completo=1', P); revisa(j.ordenes.every(o => o.lead_id !== cotQ.id), 'estado de cuenta de KFC en CDMX: sin la deuda de Querétaro');
  [s, j, t] = await pedir('GET', '/clientes/' + kfc.id + '/movimientos', P); revisa(!/Juriquilla|Q-1/.test(t), 'historial de KFC en CDMX: sin los movimientos de Querétaro');
  [s, j] = await pedir('GET', '/clientes/' + kfc.id, A); revisa(j.servicios.length === 3, 'Dirección ve a KFC completo: Querétaro + CDMX');
  // Quién corrige los datos del cliente compartido.
  [s, j] = await pedir('PUT', '/clientes/' + kfc.id, P, { correo: 'mantenimiento@kfc.mx' });
  revisa(s === 403 && j.codigo === 'CLIENTE_DE_OTRA_SUCURSAL' && /Querétaro/.test(j.error), 'Pedro NO puede cambiar los datos de KFC (lo dio de alta Querétaro); el aviso le dice quién sí', [s, j.error]);
  [s, j] = await pedir('PUT', '/finanzas/clientes/' + kfc.id + '/credito', G, { dias_credito: 90 }); revisa(s === 403, 'la gerente de CDMX tampoco le cambia el crédito a KFC');
  [s, j] = await pedir('POST', '/clientes/' + kfc.id + '/telefonos', G, { telefono: '55 1111 2233' }); revisa(s === 403, 'ni le agrega teléfonos');
  [s, j] = await pedir('PUT', '/clientes/' + kfc.id, LQ, { correo: 'mantenimiento@kfc.mx' }); revisa(s === 200, 'Laura (Querétaro, quien lo dio de alta) sí lo corrige');
  [s, j] = await pedir('GET', '/clientes/' + kfc.id, P); revisa(j.correo === 'mantenimiento@kfc.mx', 'y Pedro ve el dato corregido (el cliente es uno solo)');
  [s, j] = await pedir('PUT', '/finanzas/clientes/' + kfc.id + '/credito', A, { dias_credito: 30 }); revisa(s === 200, 'Dirección sí puede corregir cualquier cliente (p. ej. su crédito)');
  [s, j] = await pedir('GET', '/auditoria?entidad=cliente&id=' + kfc.id, A); revisa(j.some(x => x.usuario === 'Laura Ventas' && /correo/i.test(x.detalle)), 'y queda en la bitácora quién lo cambió');
  [s, j] = await pedir('PUT', '/clientes/' + torre.id, P, { correo: 'mantenimiento@torre.mx' }); revisa(s === 200, 'Pedro sí corrige a sus propios clientes (Torre Reforma)');
  [s] = await pedir('GET', '/clientes/' + torre.id, LQ); revisa(s === 404, 'Torre Reforma (cliente solo de CDMX) no existe para Querétaro');
  [s, j, t] = await pedir('GET', '/leads/buscar-telefono/5552501234', LQ); revisa(j.cliente?.otra_sucursal && !/Torre|Daniela/.test(t), 'y si Laura escribe su teléfono, tampoco ve sus datos');

  console.log('6. Intentos de saltar de sucursal');
  for (const h of [String(qro.id), 'todas', '1,2', ' ' + qro.id, qro.id + '.0', '-1', '0', 'abc', '999999', 'QRO', 'null', '[1]']) {
    [s, j, t] = await pedir('GET', '/leads', P, undefined, { 'X-Sucursal': h });
    if (s === 200 && /Juriquilla/.test(t)) revisa(false, 'encabezado X-Sucursal «' + h + '» abre Querétaro', t.slice(0, 100));
  }
  revisa(true, 'ningún valor raro en el encabezado de sucursal abre Querétaro (12 intentos)');
  [s, j] = await pedir('GET', '/leads', P, undefined, { 'X-Sucursal': String(qro.id) }); revisa(s === 403 && j.codigo === 'SUCURSAL', 'pedir Querétaro directamente → prohibido (y la pantalla olvida esa selección)', [s, j]);
  // Campos escondidos que intentan mover o crear algo en otra sucursal.
  [s, j] = await pedir('POST', '/leads', P, { sucursal_id: qro.id, folio_num: 999, cliente_id: torre.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: uid('Pedro Ventas'), forzar_duplicado: true, partidas_json: partidas('x', 10), iva_modo: 'sin_iva', valor: 10 });
  revisa(s === 201 && j.sucursal_id === cdmx.id && j.folio_num !== 999, 'mandar «sucursal_id» o «folio_num» al crear se ignora', [j.sucursal_id, j.folio_num]);
  { const [, l] = await pedir('GET', '/leads/' + cot.id, P); [s, j] = await pedir('PUT', '/leads/' + cot.id, P, { version: l.version, sucursal_id: qro.id, folio_num: 5, notas_cotizacion: 'cambio' }); }
  revisa(j.sucursal_id === cdmx.id && j.folio_num === 1, 'ni al editar (la orden sigue en CDMX con su folio)', [j.sucursal_id, j.folio_num]);
  [s, j] = await pedir('POST', '/finanzas/cxp', O, { sucursal_id: qro.id, proveedor_id: prov.id, categoria: 'otro', concepto: 'Prueba', total: 10, fecha_documento: HOY, dias_credito: 0 });
  { const [, l] = await pedir('GET', '/finanzas/cxp?vista=todas', A, undefined, { 'X-Sucursal': String(cdmx.id) }); revisa(l.some(x => x.id === j.id), 'una cuenta por pagar con «sucursal_id» de Querétaro queda en CDMX'); }
  [s, j] = await pedir('POST', '/compras/solicitudes', P, { sucursal_id: qro.id, que: 'Guantes de nitrilo', para_que: 'Para el equipo de campo', centro_id: centros[0].id });
  revisa(/-CDMX-/.test(j.folio), 'una solicitud con «sucursal_id» de Querétaro queda en CDMX', j.folio);
  // Roles y usuarios.
  [s] = await pedir('PUT', '/usuarios/' + uid('Pedro Ventas'), P, { rol: 'admin' }); revisa(s === 403, 'Pedro no puede subirse a administrador');
  [s] = await pedir('PUT', '/usuarios/' + uid('Mónica Gerente'), G, { sucursales: [cdmx.id, qro.id] }); revisa(s === 404 || s === 400 || s === 403, 'la gerente no puede darse a sí misma Querétaro', s);
  [s] = await pedir('PUT', '/usuarios/' + uid('Pedro Ventas'), G, { sucursales: [cdmx.id, qro.id] }); revisa(s === 400, 'ni dárselo a Pedro');
  [s] = await pedir('PUT', '/usuarios/' + uid('Pedro Ventas'), G, { rol: 'gerente' }); revisa(s === 403, 'ni hacerlo gerente');
  [s] = await pedir('POST', '/usuarios', P, { nombre: 'Colado', password: 'Clave-Fuerte-2026-x', rol: 'ventas', sucursales: [qro.id] }); revisa(s === 403, 'ventas no da de alta usuarios');
  [s, j] = await pedir('GET', '/usuarios', G); revisa(!j.some(u => u.nombre === 'Laura Ventas'), 'la gerente no ve a la gente de Querétaro');
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_compra&id=' + oc.id, G); revisa(Array.isArray(j) && j.some(x => /autoriz/i.test(x.accion)), 'la gerente sí ve el historial de SUS órdenes de compra', j);
  [s, j] = await pedir('GET', '/auditoria', G); revisa(s === 403, 'pero no la bitácora completa (es de todas las sucursales)');
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', G, { filas: [{ fila: 2, proveedor: 'Pipas del Valle', categoria: 'Otro', concepto: 'Importado por la gerente', fecha_documento: HOY, fecha_vencimiento: HOY, total: 1500 }] });
  { const [, l] = await pedir('GET', '/finanzas/cxp?vista=todas', A, undefined, { 'X-Sucursal': String(cdmx.id) }); revisa(s < 300 && l.some(x => x.concepto === 'Importado por la gerente'), 'la gerente puede importar su plantilla de cuentas por pagar y queda en CDMX', [s, j.error || j]); }
  { const [, l] = await pedir('GET', '/finanzas/cxp?vista=todas', LQ); revisa(!l.some(x => x.concepto === 'Importado por la gerente'), 'y Querétaro no ve lo que ella importó'); }
  [s, j] = await pedir('GET', '/auditoria?entidad=cliente&id=' + kfc.id, P); revisa(Array.isArray(j) && j.length > 0, 'Pedro ve el historial de datos de KFC (cliente compartido con el que trabaja)');
  [s, j] = await pedir('GET', '/auditoria?entidad=usuario&id=' + laura.id, G); revisa(Array.isArray(j) && !j.length, 'y nadie de CDMX ve el historial de los usuarios de Querétaro');
  // Sesiones: si Dirección cambia a alguien de sucursal, su sesión se cierra y al volver ve la nueva.
  [s] = await pedir('PUT', '/usuarios/' + uid('Juan Tecnico'), A, { sucursales: [qro.id] }); revisa(s === 200, 'Dirección cambia a Juan a Querétaro');
  [s] = await pedir('GET', '/leads', J); revisa(s === 401, 'su sesión vieja ya no sirve (debe volver a entrar)', s);
  const J2 = await entrar('Juan Tecnico', 'tecnico');
  [s, j, t] = await pedir('GET', '/leads', J2); revisa(/Juriquilla/.test(t) && !/Torre Reforma/.test(t), 'al volver a entrar ve Querétaro y ya no CDMX');
  // Sucursal desactivada.
  [s] = await pedir('PUT', '/sucursales/' + cdmx.id, A, { activo: false }); revisa(s === 200, 'Dirección desactiva CDMX (por ejemplo, si cierra)');
  [s, j, t] = await pedir('GET', '/leads', P); revisa(s === 403 && j.codigo === 'SIN_SUCURSAL' && !/Juriquilla|Torre/.test(t), 'Pedro deja de ver todo al instante (con un aviso de que su sucursal está desactivada)', [s, j]);
  [s, j] = await pedir('POST', '/leads', P, { cliente_id: torre.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: uid('Pedro Ventas'), forzar_duplicado: true, partidas_json: partidas('x', 10), iva_modo: 'sin_iva', valor: 10 });
  revisa(s === 403, 'y no puede registrar nada (ni en CDMX ni «por defecto» en Querétaro)', [s, j.error]);
  [s, j] = await pedir('GET', '/leads', A, undefined, { 'X-Sucursal': String(qro.id) }); revisa(!j.some(l => l.sucursal_id === qro.id && /^x$/.test(l.direccion || '')), 'no se coló nada en Querétaro');
  [s, j, t] = await pedir('GET', '/leads', A); revisa(/Torre Reforma/.test(t), 'pero la información de CDMX se conserva para Dirección');
  [s] = await pedir('PUT', '/sucursales/' + cdmx.id, A, { activo: true }); revisa(s === 200, 'al reactivarla todo vuelve');
  [s, j] = await pedir('GET', '/leads', P); revisa(j.length > 0, 'Pedro vuelve a ver lo suyo');
  // Dos sucursales cotizando al mismo tiempo: los folios no se repiten ni se brincan.
  const lotes = await Promise.all([...Array(10)].map((_, k) => pedir('POST', '/leads', k % 2 ? LQ : P, { cliente_id: kfc.id, direccion: 'x', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: k % 2 ? laura.id : uid('Pedro Ventas'), forzar_duplicado: true, partidas_json: partidas('Simultánea ' + k, 100), iva_modo: 'sin_iva', valor: 100 })));
  const porSuc = id => lotes.map(([, x]) => x).filter(x => x.sucursal_id === id).map(x => x.folio_num).sort((a, b) => a - b);
  const fc = porSuc(cdmx.id), fq = porSuc(qro.id);
  revisa(lotes.every(([x]) => x === 201) && new Set(fc).size === 5 && new Set(fq).size === 5 && fc[4] - fc[0] === 4 && fq[4] - fq[0] === 4, '10 cotizaciones al mismo tiempo (5 y 5): folios seguidos, sin repetir, cada sucursal los suyos', [fc, fq]);

  console.log('7. Lo que ve Dirección');
  const res = async h => (await pedir('GET', '/finanzas/resumen', A, undefined, h))[1].por_cobrar;
  const rT = await res({}), rQ = await res({ 'X-Sucursal': String(qro.id) }), rC = await res({ 'X-Sucursal': String(cdmx.id) });
  revisa(Math.round(rT * 100) === Math.round((rQ + rC) * 100), `«Te deben»: todas (${rT}) = Querétaro (${rQ}) + CDMX (${rC})`);
  [s, j] = await pedir('GET', '/tablero?desde=' + dia(-30) + '&hasta=' + HOY, A);
  revisa(j.por_sucursal?.length === 2 && Math.round(j.por_sucursal.reduce((a, x) => a + x.venta * 100, 0)) === Math.round(j.actual.venta * 100), 'Resultados: el comparativo por sucursal suma el total', j.por_sucursal?.map(x => [x.clave, x.venta]));
  [s, j] = await pedir('GET', '/tablero?desde=' + dia(-30) + '&hasta=' + HOY, G); revisa(s === 200 && !j.por_sucursal?.length, 'la gerente ve Resultados solo de CDMX (sin comparativo)');
  [s, j] = await pedir('GET', '/generador?desde=' + dia(-30) + '&hasta=' + HOY, A); revisa(j.filas.every(f => f.orden.includes('-' + f.sucursal + '-')), 'Generador: cada renglón con su sucursal');
  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'revisión de integridad: 0 errores', m.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 8));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-3000)); srv.kill(); process.exit(1); });
