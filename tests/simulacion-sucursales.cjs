// SUCURSALES — prueba tramposa de fugas. Querétaro (QRO) y Ciudad de México (CDMX) operan cada una lo suyo:
// lo de QRO lleva la marca «Secretoqro» en nombres, conceptos y notas. Cada usuario de CDMX (ventas, compras,
// técnico, atención y gerente) recorre TODAS las rutas de la API (leídas del código), con los números de los
// registros de QRO, búsquedas y referencias escondidas en lo que manda; nada de QRO debe salir ni cambiar.
// También: el administrador general ve todas (juntas o una por una), folios con clave y consecutivo propio,
// clientes compartidos, el gerente limitado a su sucursal y la revisión de integridad limpia.
// Uso: node tests/simulacion-sucursales.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-suc-')); const PUERTO = String(8200 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Sucursales-' + Math.random().toString(36).slice(2) + '-9' };
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
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const MARCA = /secretoqro|-QRO-/i; // nada de QRO: ni su marca ni sus folios

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  let s, j;

  console.log('1. Sucursales');
  [s, j] = await pedir('GET', '/sucursales', A);
  const qro = j.sucursales?.[0];
  revisa(s === 200 && j.admin_general && j.sucursales.length === 1 && qro.clave === 'QRO', 'lo que ya existía es de la sucursal principal: Querétaro (QRO)', j);
  // Un usuario que se dio de alta por fuera (sin sucursal) mientras solo había una.
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(path.join(dir, 'x.db')); d.prepare("INSERT INTO usuarios (nombre, password, rol) VALUES ('Usuario Antiguo', 'x', 'ventas')").run(); d.close(); }
  [s, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'cd mx' }); revisa(s === 400, 'una clave con espacios no se acepta');
  [s, j] = await pedir('POST', '/sucursales', A, { nombre: 'Otra', clave: 'qro' }); revisa(s === 409, 'la clave no se repite (aunque venga en minúsculas)');
  [s, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'cdmx', direccion: 'Insurgentes Sur 100' });
  const cdmx = j; revisa(s === 201 && cdmx.clave === 'CDMX', 'el administrador general crea la sucursal CDMX', [s, j]);
  [s, j] = await pedir('GET', '/usuarios', A); revisa(j.find(u => u.nombre === 'Usuario Antiguo')?.sucursales?.join() === String(qro.id), 'al abrir la segunda sucursal, quien no tenía sucursal queda en la principal (no se queda sin ver nada)', j.find(u => u.nombre === 'Usuario Antiguo'));
  [s, j] = await pedir('PUT', '/sucursales/' + cdmx.id, A, { clave: 'MEX' }); revisa(s === 400, 'la clave ya no se cambia (va en los folios)');
  [s, j] = await pedir('PUT', '/sucursales/' + qro.id, A, { activo: false }); revisa(s === 400, 'la sucursal principal no se desactiva');

  console.log('2. Usuarios por sucursal');
  const crear = async (nombre, rol, sucursales, quien = A) => pedir('POST', '/usuarios', quien, { nombre, password: 'Clave-Fuerte-2026-' + rol, rol, sucursales });
  const entrar = async (nombre, rol) => (await pedir('POST', '/login', null, { nombre, password: 'Clave-Fuerte-2026-' + rol }))[1].token;
  [s, j] = await crear('Sin Sucursal', 'ventas', []); revisa(s === 400, 'con dos sucursales, un usuario nuevo debe tener al menos una', [s, j.error]);
  for (const [nombre, rol, sucs] of [['Vendedor Secretoqro', 'ventas', [qro.id]], ['Compras Secretoqro', 'costos', [qro.id]], ['Tecnico Secretoqro', 'tecnico', [qro.id]],
    ['Pedro Ventas', 'ventas', [cdmx.id]], ['Pedro Compras', 'costos', [cdmx.id]], ['Pedro Tecnico', 'tecnico', [cdmx.id]], ['Pedro Atencion', 'atencion', [cdmx.id]], ['Pedro Gerente', 'gerente', [cdmx.id]],
    ['Ana Ambas', 'costos', [qro.id, cdmx.id]]]) { [s, j] = await crear(nombre, rol, sucs); if (s !== 201) revisa(false, 'crear ' + nombre, [s, j.error]); }
  const Q = { ventas: await entrar('Vendedor Secretoqro', 'ventas'), costos: await entrar('Compras Secretoqro', 'costos'), tecnico: await entrar('Tecnico Secretoqro', 'tecnico') };
  const C = { ventas: await entrar('Pedro Ventas', 'ventas'), costos: await entrar('Pedro Compras', 'costos'), tecnico: await entrar('Pedro Tecnico', 'tecnico'), atencion: await entrar('Pedro Atencion', 'atencion'), gerente: await entrar('Pedro Gerente', 'gerente') };
  const AMBAS = await entrar('Ana Ambas', 'costos');
  revisa(Object.values(Q).concat(Object.values(C), [AMBAS]).every(Boolean), 'todos entran con su contraseña');
  const [, usuarios] = await pedir('GET', '/usuarios', A), uid = nombre => usuarios.find(u => u.nombre === nombre).id;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);

  // ---------- Datos de cada sucursal (los crea su propia gente) ----------
  const contacto = async (t, nombre, empresa, tel) => (await pedir('POST', '/contactos', t, { nombre, telefono: tel, empresa_contacto: empresa, direccion: 'Calle 1', canal_origen_id: canales[0].id }))[1];
  const cotizar = async (t, cliente, resp, leyenda, importe) => (await pedir('POST', '/leads', t, { cliente_id: cliente.id, direccion: 'Calle 1', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: resp,
    forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda, importe }]), iva_modo: 'mas_iva', valor: importe, fecha_cotizacion: dia(-5) }))[1];
  const ganar = async (t, lead, fecha = dia(-3)) => { const [, l] = await pedir('GET', '/leads/' + lead.id, t); return pedir('PUT', '/leads/' + lead.id, t, { version: l.version, estatus: 'ganado', fecha_servicio: fecha }); };
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Proveedor Compartido', categoria: 'otro', dias_credito: 15, clabe: '014680655039528945', banco: 'Santander' });
  const [, prov2] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Segundo Proveedor', categoria: 'otro', dias_credito: 0 });
  const [, prov3] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Tercer Proveedor', categoria: 'otro', dias_credito: 0 });
  async function sembrar(T, marca, tel0) {
    const r = {};
    r.cliente = marca === 'Secretoqro' ? await contacto(T.ventas, 'Contacto ' + marca, 'Empresa ' + marca, tel0 + '01') : await contacto(T.ventas, 'Roberto ' + marca, 'Taquería ' + marca, tel0 + '01');
    r.cot = await cotizar(T.ventas, r.cliente, uid(marca === 'Secretoqro' ? 'Vendedor Secretoqro' : 'Pedro Ventas'), 'Cotización abierta ' + marca, 1000);
    r.os = await cotizar(T.ventas, r.cliente, uid(marca === 'Secretoqro' ? 'Vendedor Secretoqro' : 'Pedro Ventas'), 'Servicio ' + marca, 5000);
    await ganar(T.ventas, r.os);
    await pedir('POST', '/leads/' + r.os.id + '/ejecucion', T.costos, { estado: 'realizado', fecha: dia(-3), realizado_por: 'subcontratado', gastos: [{ proveedor_id: prov.id, categoria: 'otro', concepto: 'Pipa ' + marca, total: 1200 }] });
    await pedir('PUT', '/leads/' + r.os.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'F-' + marca, factura_fecha: dia(-3) });
    [, r.cobro] = await pedir('POST', '/leads/' + r.os.id + '/cobros', T.ventas, { monto: 1000, metodo: 'transferencia', fecha: dia(-1), referencia: 'Anticipo ' + marca });
    [, r.nota] = await pedir('POST', '/leads/' + r.os.id + '/historial', T.ventas, { tipo: 'alerta', texto: 'Llamar ' + marca, fecha_alerta: dia(-1) + ' 10:00' });
    [, r.cxp] = await pedir('POST', '/finanzas/cxp', T.costos, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Renta ' + marca, total: 3000, fecha_documento: dia(-2), dias_credito: 10 });
    [, r.pago] = await pedir('POST', '/finanzas/cxp/' + r.cxp.id + '/pagos', T.costos, { monto: 500, metodo: 'transferencia', fecha: dia(-1), referencia: 'Pago ' + marca });
    [, r.sol] = await pedir('POST', '/compras/solicitudes', T.ventas, { que: 'Llantas ' + marca, para_que: 'Para el camión ' + marca, centro_id: centros[0].id });
    await pedir('POST', '/compras/solicitudes/' + r.sol.id + '/aprobar', A);
    for (const [k, p] of [prov, prov2, prov3].entries()) await subir('/compras/solicitudes/' + r.sol.id + '/documentos', T.costos, pdf(marca), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': 900 + k, 'X-Nombre': 'cot-' + marca + k + '.pdf' });
    const [, solD] = await pedir('GET', '/compras/solicitudes/' + r.sol.id, T.costos);
    r.cotDoc = solD.cotizaciones?.[0];
    await pedir('POST', '/compras/solicitudes/' + r.sol.id + '/elegir', T.costos, { cotizacion_id: r.cotDoc.id });
    [s, r.oc] = await pedir('POST', '/compras/ordenes', T.costos, { solicitud_id: r.sol.id, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Llanta ' + marca, unidad: 'PZA', precio: 900 }] });
    [, r.aut] = await pedir('POST', '/compras/ordenes/' + r.oc.id + '/autorizar', A, { dias_credito: 15 });
    [, r.ocDoc] = await subir('/compras/ordenes/' + r.oc.id + '/documentos', T.costos, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'firma-' + marca + '.png' });
    const [, sect] = await pedir('GET', '/prospeccion/sectores', A);
    [, r.est] = await pedir('POST', '/prospeccion', T.ventas, { nombre: 'Restaurante ' + marca, zona: 'Zona ' + marca, sector_id: sect[0].id, responsable_id: uid(marca === 'Secretoqro' ? 'Vendedor Secretoqro' : 'Pedro Ventas') });
    r.borrar = await cotizar(T.ventas, r.cliente, uid(marca === 'Secretoqro' ? 'Vendedor Secretoqro' : 'Pedro Ventas'), 'Para borrar ' + marca, 700);
    await pedir('DELETE', '/leads/' + r.borrar.id, A, { motivo: 'Capturada por error ' + marca });
    return r;
  }
  const RQ = await sembrar(Q, 'Secretoqro', '44218372');
  const RC = await sembrar(C, 'Visiblecdmx', '55382746');
  // Un cliente COMPARTIDO: lo dio de alta QRO y luego CDMX le cotiza.
  const kfc = await contacto(Q.ventas, 'Ing. Sofía Compartida', 'KFC Compartido', '4429183746');
  const kfcQ = await cotizar(Q.ventas, kfc, uid('Vendedor Secretoqro'), 'Trampa de grasa Secretoqro', 4800);

  console.log('3. Folios con clave y consecutivo propio');
  revisa(RQ.cot.sucursal_id === qro.id && RC.cot.sucursal_id === cdmx.id, 'cada cotización quedó en la sucursal de quien la hizo', [RQ.cot.sucursal_id, RC.cot.sucursal_id]);
  [s, j] = await pedir('GET', '/leads/' + RC.cot.id, C.ventas);
  const mes = HOY.slice(0, 7).replace('-', '');
  revisa(RC.cot.folio_num === 1 && RC.os.folio_num === 2, 'CDMX empieza su propio consecutivo en 1', [RC.cot.folio_num, RC.os.folio_num]);
  [s, j] = await pedir('GET', '/finanzas/cartera', C.ventas);
  const filaC = (Array.isArray(j) ? j : j.cuentas || []).find(x => x.lead_id === RC.os.id);
  revisa(filaC?.folio === `OS-CDMX-${mes}-0002`, 'la orden de CDMX se ve como OS-CDMX-AAAAMM-0002', filaC?.folio);
  revisa(RC.oc && RC.oc.folio === `OC-CDMX-${mes}-0001` && RC.sol.folio === `SOL-CDMX-${mes}-0001`, 'compras de CDMX: SOL-CDMX y OC-CDMX desde 0001', [RC.sol.folio, RC.oc?.folio]);
  revisa(RQ.oc && RQ.oc.folio === `OC-QRO-${mes}-0001`, 'y Querétaro lleva el suyo (OC-QRO-…-0001), sin chocar', RQ.oc?.folio);
  [s, j] = await pedir('GET', '/buscar?q=' + encodeURIComponent('cdmx 2'), C.ventas);
  revisa(j.exacta?.id === RC.os.id, 'el buscador encuentra «cdmx 2»', j.exacta);
  [s, j] = await pedir('GET', '/leads?q=' + encodeURIComponent(`OS-CDMX-${mes}-0002`), C.ventas);
  revisa(Array.isArray(j) && j.length === 1 && j[0].id === RC.os.id, 'la lista de cotizaciones encuentra el folio completo', j.map?.(x => x.id));

  console.log('4. Lo que ve CDMX: nada de Querétaro');
  // Instantánea de QRO antes de los ataques (vista del admin general sobre QRO).
  const verQ = { 'X-Sucursal': String(qro.id) };
  const foto = async () => JSON.stringify(await Promise.all(['/leads', '/finanzas/cxp?vista=todas', '/compras/ordenes', '/compras/solicitudes?estado=', '/finanzas/cartera', '/prospeccion', '/leads/' + RQ.os.id, '/leads/' + RQ.os.id + '/cobros', '/compras/ordenes/' + RQ.oc.id, '/compras/solicitudes/' + RQ.sol.id, '/finanzas/cxp/' + RQ.cxp.id + '/pagos', '/clientes/' + RQ.cliente.id]
    .map(async r => (await pedir('GET', r, A, undefined, verQ))[1])));
  const antes = await foto();
  revisa(MARCA.test(antes), 'el admin general sí ve lo de Querétaro (la prueba sirve)');

  // Todas las rutas GET del código, con los números de los registros de Querétaro.
  const fuentes = fs.readdirSync(path.join(__dirname, '..', 'server')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8')).join('\n');
  const rutas = [...fuentes.matchAll(/app\.(get|post|put|delete)\('\/api(\/[^']+)'/g)].map(m => [m[1].toUpperCase(), m[2]]);
  const idQ = r => r.startsWith('/leads/buscar-telefono') ? '4421837201' : r.startsWith('/leads') ? RQ.os.id : r.startsWith('/historial') ? RQ.nota.id : r.startsWith('/finanzas/cobros') ? RQ.cobro.id
    : r.startsWith('/finanzas/cxp') ? RQ.cxp.id : r.startsWith('/finanzas/pagos-proveedor') ? RQ.pago.id : r.startsWith('/compras/ordenes') ? RQ.oc.id
    : r.startsWith('/compras/solicitudes/documentos') ? RQ.cotDoc.id : r.startsWith('/compras/solicitudes') ? RQ.sol.id : r.startsWith('/compras/documentos') ? RQ.ocDoc.documento?.id ?? RQ.ocDoc.id
    : r.startsWith('/prospeccion') ? RQ.est.id : /clientes/.test(r) ? RQ.cliente.id : r.startsWith('/finanzas/proveedores') ? prov.id : r.startsWith('/usuarios') ? uid('Vendedor Secretoqro') : r.startsWith('/sucursales') ? qro.id : 1;
  const conIds = r => r.replace(/:id\b/g, () => idQ(r)).replace(/:clave\b/, 'otro').replace(/:tel\b/, '4421837201').replace(/:telefono\b/, '4421837201');
  const LECTURAS = rutas.filter(([m]) => m === 'GET').map(([, r]) => conIds(r))
    .concat(['/leads?q=secretoqro', '/clientes?q=secretoqro&incluir_prospectos=1', '/contactos/sin-cotizacion?q=secretoqro', '/buscar?q=secretoqro', '/buscar?q=' + encodeURIComponent('OS-QRO-' + mes + '-0002'),
      '/buscar?q=Proveedor%20Compartido', '/finanzas/cxp?vista=todas', '/compras/solicitudes?estado=', '/clientes?incluir_prospectos=1', '/calendario?desde=' + dia(-60) + '&hasta=' + dia(60),
      '/generador?desde=' + dia(-60) + '&hasta=' + dia(1), '/tablero?desde=' + dia(-60) + '&hasta=' + dia(1), '/finanzas/periodo?desde=' + dia(-60) + '&hasta=' + dia(1), '/alertas', '/recompras', '/kpis', '/compras/ordenes?q=llanta',
      '/auditoria?entidad=orden_compra&id=' + RQ.oc.id, '/auditoria?entidad=solicitud_compra&id=' + RQ.sol.id, '/auditoria?entidad=cuenta_por_pagar&id=' + RQ.cxp.id,
      '/auditoria?entidad=orden_servicio&id=' + RQ.borrar.id, '/auditoria?entidad=cliente&id=' + RQ.cliente.id, '/auditoria?entidad=usuario&id=' + uid('Vendedor Secretoqro')]);
  for (const [rol, T] of Object.entries(C)) {
    const fugas = [];
    for (const r of LECTURAS) {
      const [st, js, texto] = await pedir('GET', r, T);
      // buscar-telefono: el cliente es compartido (para no duplicarlo), pero sus servicios no se ven.
      if (r.startsWith('/leads/buscar-telefono') && (js.solicitudes || []).length) fugas.push(r + ' trae servicios de QRO');
      if (MARCA.test(texto.replace(/"q":"[^"]*"/, ''))) fugas.push(st + ' ' + r + ' → ' + (texto.match(/.{0,60}(secretoqro|-QRO-).{0,40}/i) || [''])[0]);
    }
    // Dar de alta un contacto con el teléfono o el nombre de uno de Querétaro: no regresa sus datos.
    for (const cuerpo of [{ nombre: 'Prueba Uno', telefono: '4421837201', empresa_contacto: 'Otra Empresa', direccion: 'x', canal_origen_id: canales[0].id },
      { nombre: 'Contacto Secretoqro', telefono: '5598761234', empresa_contacto: 'Empresa Secretoqro', direccion: 'x', canal_origen_id: canales[0].id }]) {
      const [st, , texto] = await pedir('POST', '/contactos', T, cuerpo);
      if (/4421837201|Calle 1/.test(texto) || (MARCA.test(texto.replace(/Secretoqro/g, '')) )) fugas.push('alta de contacto ' + st + ' → ' + texto.slice(0, 120));
    }
    revisa(!fugas.length, `${rol} de CDMX: ${LECTURAS.length} lecturas sin ningún dato de Querétaro`, fugas.slice(0, 8));
  }
  [s, j] = await pedir('GET', '/leads/' + RQ.os.id, C.ventas); revisa(s === 404, 'abrir una orden de QRO por su número → «no existe»');
  [s] = await pedir('GET', '/clientes/' + RQ.cliente.id, C.ventas); revisa(s === 404, 'abrir un cliente que solo es de QRO → «no existe»');
  [s, j] = await pedir('GET', '/leads', C.ventas, undefined, { 'X-Sucursal': String(qro.id) }); revisa(s === 403, 'pedir ver Querétaro cambiando el encabezado → prohibido', [s, j.error]);

  console.log('5. Intentos de cambiar lo de Querétaro');
  const ESCRITURAS = rutas.filter(([m, r]) => m !== 'GET' && /:(id|clave)\b/.test(r) && !/^\/(sucursales|servicios|canales|tipos-cliente|finanzas\/categorias|finanzas\/proveedores|prospeccion\/sectores|compras\/(centros|unidades))/.test(r)).map(([m, r]) => [m, conIds(r)]);
  const cuerpo = { version: 1, monto: 1, motivo: 'Intento tramposo de otra sucursal', estado: 'realizado', fecha: HOY, realizado_por: 'propio', dias_credito: 1, recibio: 'Pedro', estatus: 'perdido', motivo_perdida: 'Intento tramposo', nombre: 'Cambiado', texto: 'Nota tramposa', cotizacion_id: RQ.cotDoc.id, con: RC.cliente.id, telefono: '5533000077', password: 'Clave-Fuerte-2026-x', metodo: 'transferencia', activo: false, rol: 'ventas' };
  const aceptadas = [];
  for (const [rol, T] of Object.entries(C)) for (const [m, r] of ESCRITURAS) {
    const [st, js] = await pedir(m, r, T, cuerpo);
    if (st < 400) aceptadas.push(rol + ' ' + m + ' ' + r + ' → ' + st);
  }
  revisa(!aceptadas.length, `${ESCRITURAS.length} rutas de cambio × 5 usuarios de CDMX con números de QRO: ninguna pasa`, aceptadas.slice(0, 10));
  // Referencias escondidas en lo que se manda (no en la dirección).
  const trampas = [
    ['POST', '/leads', C.ventas, { cliente_id: RC.cliente.id, duplicado_de: RQ.os.id, estatus: 'ganado', direccion: 'x', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: uid('Pedro Ventas'), forzar_duplicado: true, fecha_servicio: HOY, valor: 10, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 10 }]), iva_modo: 'sin_iva' }, 'duplicar una orden de QRO'],
    ['POST', '/leads', C.ventas, { cliente_id: RC.cliente.id, establecimiento_id: RQ.est.id, direccion: 'x', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: uid('Pedro Ventas'), forzar_duplicado: true, valor: 10, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 10 }]), iva_modo: 'sin_iva' }, 'ligar un establecimiento de QRO'],
    ['POST', '/finanzas/cxp', C.costos, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Gasto tramposo', total: 10, fecha_documento: HOY, dias_credito: 0, lead_id: RQ.os.id }, 'cargar un gasto a una orden de QRO'],
    ['POST', '/compras/solicitudes', C.ventas, { que: 'Cosa tramposa', para_que: 'Para algo de otra sucursal', centro_id: centros[0].id, lead_id: RQ.os.id }, 'ligar una solicitud a una orden de QRO'],
    ['POST', '/compras/ordenes', C.costos, { solicitud_id: RQ.sol.id, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'x', precio: 900 }] }, 'hacer orden de compra de una solicitud de QRO'],
    ['POST', '/compras/ordenes', C.costos, { proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', iva_modo: 'incluido', lead_id: RQ.os.id, partidas: [{ cantidad: 1, descripcion: 'x', precio: 9 }] }, 'ligar una orden de compra a una orden de servicio de QRO'],
    ['POST', '/compras/solicitudes/' + RC.sol.id + '/elegir', C.costos, { cotizacion_id: RQ.cotDoc.id }, 'elegir en CDMX una cotización que se subió en QRO'],
  ];
  for (const [m, r, T, b, txt] of trampas) { const [st, js] = await pedir(m, r, T, b); revisa(st >= 400 || (js.lead_id == null && js.duplicado_de == null && js.establecimiento_id == null && js.solicitud_id !== RQ.sol.id), 'no se puede ' + txt, [st, js.error || js]); }
  const despues = await foto();
  revisa(antes === despues, 'después de todos los intentos, lo de Querétaro quedó EXACTAMENTE igual');

  console.log('6. Cliente compartido');
  [s, j] = await pedir('POST', '/contactos', C.ventas, { nombre: 'Otro contacto', telefono: '4429183746', empresa_contacto: 'KFC CDMX', direccion: 'x', canal_origen_id: canales[0].id });
  revisa(s === 409 && j.cliente_id === kfc.id, 'CDMX no puede duplicar a KFC: el sistema le dice que ya existe', [s, j.error]);
  const kfcC = await cotizar(C.ventas, kfc, uid('Pedro Ventas'), 'Trampa de grasa sucursal Reforma', 5200);
  revisa(kfcC?.id && kfcC.sucursal_id === cdmx.id, 'y le cotiza al mismo cliente (queda en CDMX)', kfcC);
  [s, j, texto] = await pedir('GET', '/clientes/' + kfc.id, C.ventas);
  revisa(s === 200 && j.servicios.length === 1 && j.servicios[0].id === kfcC.id && !MARCA.test(texto), 'en la ficha de KFC, CDMX ve solo su cotización (no la de Querétaro)', [s, j.servicios?.map(x => x.id)]);
  [s, j] = await pedir('GET', '/clientes/' + kfc.id, A);
  revisa(j.servicios.length === 2, 'el administrador general ve las dos cotizaciones de KFC', j.servicios?.length);
  var texto;

  console.log('7. Administrador general y usuario de varias sucursales');
  const montos = async (t, h = {}) => { const [, r] = await pedir('GET', '/finanzas/resumen', t, undefined, h); return [r.por_cobrar, r.por_pagar]; };
  const mC = await montos(C.atencion), mGenC = await montos(A, { 'X-Sucursal': String(cdmx.id) }), mGenQ = await montos(A, verQ), mGen = await montos(A);
  revisa(JSON.stringify(mC) === JSON.stringify(mGenC), 'el administrador viendo CDMX ve los mismos importes que la gente de CDMX', [mC, mGenC]);
  revisa(Math.round((mGenQ[0] + mGenC[0]) * 100) === Math.round(mGen[0] * 100) && Math.round((mGenQ[1] + mGenC[1]) * 100) === Math.round(mGen[1] * 100), '«Todas» = Querétaro + CDMX (por cobrar y por pagar)', [mGenQ, mGenC, mGen]);
  [s, j, texto] = await pedir('GET', '/leads', A, undefined, verQ); revisa(!/visiblecdmx/i.test(texto) && /secretoqro/i.test(texto), 'viendo solo Querétaro no aparece CDMX');
  [s, j, texto] = await pedir('GET', '/finanzas/cxp?vista=todas', AMBAS); revisa(/secretoqro/i.test(texto) && /visiblecdmx/i.test(texto), 'Ana (de las dos sucursales) ve ambas juntas');
  [s, j, texto] = await pedir('GET', '/finanzas/cxp?vista=todas', AMBAS, undefined, { 'X-Sucursal': String(cdmx.id) }); revisa(!/secretoqro/i.test(texto) && /visiblecdmx/i.test(texto), 'y al elegir CDMX, solo CDMX');
  [s, j] = await pedir('POST', '/finanzas/cxp', AMBAS, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Gasto de Ana', total: 10, fecha_documento: HOY, dias_credito: 0 }, { 'X-Sucursal': String(cdmx.id) });
  { const [, l] = await pedir('GET', '/finanzas/cxp?vista=todas', A, undefined, { 'X-Sucursal': String(cdmx.id) }); revisa(s === 201 && l.some(x => x.id === j.id), 'lo que registra viendo CDMX queda en CDMX', [s, j]); }

  [s, j] = await pedir('GET', '/generador?desde=' + dia(-30) + '&hasta=' + dia(1), A); revisa(j.filas?.some(f => f.sucursal === 'QRO') && j.filas?.some(f => f.sucursal === 'CDMX') && j.filas.every(f => f.orden.includes('-' + f.sucursal + '-')), 'Generador del admin general: cada renglón dice su sucursal (y coincide con su folio)', j.filas?.map(f => [f.sucursal, f.orden]));
  console.log('8. Gerente de sucursal');
  [s, j] = await crear('Nuevo Vendedor Cdmx', 'ventas', [cdmx.id], C.gerente); revisa(s === 201, 'el gerente da de alta usuarios de su sucursal', [s, j.error]);
  [s, j] = await crear('Vendedor Ajeno', 'ventas', [qro.id], C.gerente); revisa(s === 400, 'pero no en Querétaro', [s, j.error]);
  [s, j] = await crear('Otro Gerente', 'gerente', [cdmx.id], C.gerente); revisa(s === 403, 'ni gerentes o administradores', [s, j.error]);
  [s] = await pedir('PUT', '/usuarios/' + uid('Vendedor Secretoqro'), C.gerente, { nombre: 'Hackeado' }); revisa(s === 404, 'no puede modificar a la gente de Querétaro');
  [s] = await pedir('POST', '/usuarios/' + uid('Vendedor Secretoqro') + '/password', C.gerente, { password: 'Clave-Fuerte-2026-hack' }); revisa(s === 404, 'ni cambiarles la contraseña');
  [s] = await pedir('PUT', '/usuarios/' + uid('Pedro Atencion'), C.gerente, { sucursales: [qro.id] }); revisa(s === 400, 'ni mandar a su gente a otra sucursal');
  for (const [m, r, txt] of [['POST', '/sucursales', 'crear sucursales'], ['GET', '/admin/integridad', 'revisar la integridad de toda la base'], ['GET', '/admin/backup', 'descargar la base completa'], ['GET', '/auditoria', 'ver la bitácora de todas'], ['POST', '/servicios', 'cambiar catálogos de todos']]) {
    [s] = await pedir(m, r, C.gerente, m === 'POST' ? { nombre: 'X', clave: 'XX' } : undefined); revisa(s === 403, 'el gerente no puede ' + txt, s);
  }
  [s, j] = await pedir('GET', '/compras/ordenes', C.gerente); const ocC = j.find(o => o.id === RC.oc.id);
  revisa(ocC && !j.some(o => o.id === RQ.oc.id), 'el gerente ve las compras de su sucursal (no las de Querétaro)');
  [s, j] = await pedir('DELETE', '/leads/' + RC.cot.id, C.gerente, { motivo: 'La borra el gerente de su sucursal' }); revisa(s === 200, 'y administra lo suyo (p. ej. eliminar una cotización de CDMX)', [s, j.error]);

  console.log('9. Al final');
  { const [si, ri] = await pedir('GET', '/admin/integridad', A, undefined, { 'X-Sucursal': String(cdmx.id) }); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'la revisión de integridad (siempre de toda la base) no encuentra errores', m.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 8));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-3000)); srv.kill(); process.exit(1); });
