// SUCURSALES — simulación aleatoria de uso real (reproducible con SEMILLA=n).
// Tres sucursales (QRO, CDMX, MTY), cada una con ventas, compras, técnico, atención y gerente, más una persona de
// dos sucursales. Cientos de operaciones al azar, de 8 en 8 al mismo tiempo: contactos, cotizaciones, órdenes,
// realizados con costos, facturas, cobros y confirmaciones, cuentas por pagar y pagos, solicitudes, cotizaciones,
// órdenes de compra, recepción, clientes compartidos… y, revueltos, intentos de tocar lo de otra sucursal.
// Al final se comprueba: cada registro en su sucursal, nadie ve lo ajeno en ninguna lista, «Todas» = suma de
// sucursales, folios seguidos sin repetir por sucursal, ningún intento ajeno cambió nada, integridad 0 errores
// y ninguna respuesta 500.
// Uso: node tests/simulacion-sucursales-aleatoria.cjs   (OPERACIONES=600 SEMILLA=7 para variar)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const SEMILLA = Number(process.env.SEMILLA || 20261016), OPS = Number(process.env.OPERACIONES || 400);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-alea-')); const PUERTO = String(8300 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Aleatoria-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
// Azar reproducible.
let semilla = SEMILLA >>> 0; const azar = () => { semilla = (semilla + 0x6D2B79F5) >>> 0; let t = semilla; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const uno = arr => arr[Math.floor(azar() * arr.length)];
const errores500 = [];
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* archivo */ }
  if (x.status >= 500) errores500.push(m + ' ' + r + ' → ' + x.status + ' ' + texto.slice(0, 120));
  return [x.status, j, texto];
};
const subir = async (r, t, buf, enc) => {
  const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t };
  for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v));
  const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: 'POST', headers: h, body: buf }); if (x.status >= 500) errores500.push('subir ' + r + ' → ' + x.status); return [x.status, await x.json().catch(() => ({}))];
};
const pdf = () => Buffer.from(`%PDF-1.4\n% ${crypto.randomBytes(8).toString('hex')}\n%%EOF`);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(48)]);
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const LETRAS = 'bcdfghjklmnprstvz', VOCALES = 'aeiou';
const palabra = () => { let p = ''; for (let i = 0; i < 3; i++) p += uno(LETRAS) + uno(VOCALES); return p[0].toUpperCase() + p.slice(1); };
let telSec = 0; const telefono = pre => pre + String(10 ** (10 - pre.length) + Math.floor(azar() * 8 * 10 ** (9 - pre.length)) + (++telSec)).slice(-(10 - pre.length)); // siempre 10 dígitos

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  console.log(`Semilla ${SEMILLA} · ${OPS} operaciones`);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, centros] = await pedir('GET', '/compras/centros', A);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = (await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }))[1];
  const mty = (await pedir('POST', '/sucursales', A, { nombre: 'Monterrey', clave: 'MTY' }))[1];
  const SUC = [qro, cdmx, mty], LADA = { [qro.id]: '442', [cdmx.id]: '55', [mty.id]: '81' };
  // Gente de cada sucursal.
  const GENTE = [];
  for (const s of SUC) for (const rol of ['ventas', 'costos', 'tecnico', 'atencion', 'gerente']) {
    const nombre = `${rol[0].toUpperCase() + rol.slice(1)} ${s.clave}`;
    await pedir('POST', '/usuarios', A, { nombre, password: 'Clave-Fuerte-2026-' + s.clave, rol, sucursales: [s.id] });
    GENTE.push({ nombre, rol, sucs: [s.id], token: (await pedir('POST', '/login', null, { nombre, password: 'Clave-Fuerte-2026-' + s.clave }))[1].token });
  }
  await pedir('POST', '/usuarios', A, { nombre: 'Ana Dos Sucursales', password: 'Clave-Fuerte-2026-ana', rol: 'costos', sucursales: [qro.id, mty.id] });
  GENTE.push({ nombre: 'Ana Dos Sucursales', rol: 'costos', sucs: [qro.id, mty.id], token: (await pedir('POST', '/login', null, { nombre: 'Ana Dos Sucursales', password: 'Clave-Fuerte-2026-ana' }))[1].token });
  const [, usuarios] = await pedir('GET', '/usuarios', A);
  for (const g of GENTE) g.id = usuarios.find(u => u.nombre === g.nombre).id;
  revisa(GENTE.every(g => g.token && g.id), `${GENTE.length} personas en 3 sucursales entran al sistema`);
  const provs = [];
  for (const nombre of ['Ferretería Hidalgo', 'Pipas del Norte', 'Llantas Ramírez', 'Combustibles Bajío', 'Refacciones Torres', 'Equipos Sanitarios Vega']) {
    const [st, p] = await pedir('POST', '/finanzas/proveedores', A, { nombre, categoria: 'otro', dias_credito: uno([0, 7, 15, 30]), forzar: true }); if (st === 201) provs.push(p);
  }
  revisa(provs.length === 6 && provs.every(p => p.id), 'proveedores compartidos dados de alta');

  // Lo que se va creando, con la sucursal en la que DEBE quedar.
  const R = { clientes: [], leads: [], cxp: [], sols: [], ocs: [] };
  const deSuc = (lista, s) => lista.filter(x => x.suc === s);
  const persona = (rol, s) => GENTE.find(g => g.rol === rol && g.sucs.length === 1 && g.sucs[0] === s);
  // Quién y en qué sucursal: Ana elige al azar entre sus dos.
  const actor = (roles) => { const g = uno(GENTE.filter(x => roles.includes(x.rol))); const s = uno(g.sucs); return { g, s, h: g.sucs.length > 1 ? { 'X-Sucursal': String(s) } : {} }; };
  const intentos = []; // intentos sobre lo de otra sucursal: [descripción, status]
  let soloIntrusos = false;
  const estadoDe = async (tipo, id) => { const ruta = { leads: '/leads/', ocs: '/compras/ordenes/', sols: '/compras/solicitudes/' }[tipo]; return ruta ? JSON.stringify((await pedir('GET', ruta + id, A))[1]) : null; };

  const ACCIONES = {
    async contacto() {
      const { g, s, h } = actor(['ventas', 'atencion', 'gerente']);
      const cuerpo = { nombre: palabra() + ' ' + palabra(), telefono: telefono(LADA[s]), empresa_contacto: palabra() + ' ' + palabra() + ' ' + palabra(), direccion: 'Calle ' + palabra(), canal_origen_id: uno(canales).id };
      let [st, c] = await pedir('POST', '/contactos', g.token, cuerpo, h);
      if (st === 409 && c.error === 'posible_duplicado') [st, c] = await pedir('POST', '/contactos', g.token, { ...cuerpo, distinto_de: c.parecidos.map(p => p.id) }, h);
      if (st === 201) R.clientes.push({ id: c.id, suc: s, tel: c.telefono });
    },
    async cotizar() {
      const { g, s, h } = actor(['ventas', 'atencion', 'gerente']);
      // A veces un cliente propio y a veces uno de otra sucursal (cliente compartido: se le cotiza sin duplicarlo).
      const propios = deSuc(R.clientes, s), ajenos = R.clientes.filter(c => c.suc !== s);
      const cli = azar() < 0.25 && ajenos.length ? uno(ajenos) : uno(propios.length ? propios : R.clientes); if (!cli) return;
      const imp = Math.round(500 + azar() * 40000);
      const [st, l] = await pedir('POST', '/leads', g.token, { cliente_id: cli.id, direccion: 'Sitio ' + palabra(), canal_id: uno(canales).id, servicio_id: uno(servicios).id, responsable_id: g.id, forzar_duplicado: true,
        partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Servicio ' + palabra(), importe: imp }]), iva_modo: uno(['mas_iva', 'incluido', 'sin_iva']), valor: imp, fecha_cotizacion: dia(-Math.floor(azar() * 20)) }, h);
      if (st === 201) { R.leads.push({ id: l.id, suc: s, estatus: 'abierto' }); cli.vendido = cli.vendido || new Set(); cli.vendido.add(s); }
    },
    async ganar() {
      const { g, s, h } = actor(['ventas', 'gerente']); const l = uno(deSuc(R.leads, s).filter(x => x.estatus === 'abierto')); if (!l) return;
      const [, d] = await pedir('GET', '/leads/' + l.id, g.token, undefined, h);
      const [st] = await pedir('PUT', '/leads/' + l.id, g.token, { version: d.version, estatus: 'ganado', fecha_servicio: d.fecha_cotizacion > dia(-2) ? d.fecha_cotizacion : dia(-2) }, h);
      if (st === 200) l.estatus = 'ganado';
    },
    async realizar() {
      const { g, s, h } = actor(['tecnico', 'costos', 'gerente']); const l = uno(deSuc(R.leads, s).filter(x => x.estatus === 'ganado' && !x.hecho)); if (!l) return;
      const [, d] = await pedir('GET', '/leads/' + l.id, g.token, undefined, h);
      const sub = azar() < 0.5;
      const [st] = await pedir('POST', '/leads/' + l.id + '/ejecucion', g.token, { estado: 'realizado', fecha: d.fecha_servicio > HOY ? HOY : d.fecha_servicio, realizado_por: sub ? 'subcontratado' : 'propio',
        gastos: sub ? [{ proveedor_id: uno(provs).id, categoria: 'otro', concepto: 'Costo ' + palabra(), total: Math.round(200 + azar() * 5000) }] : [] }, h);
      if (st < 300) { l.hecho = true; if (sub) l.conCosto = true; }
    },
    async facturar() {
      const { g, s, h } = actor(['gerente', 'atencion']); const l = uno(deSuc(R.leads, s).filter(x => x.hecho && !x.factura)); if (!l) return;
      const [, d] = await pedir('GET', '/leads/' + l.id, g.token, undefined, h);
      const [st] = await pedir('PUT', '/leads/' + l.id + '/facturacion', g.token, { dias_credito: uno([0, 15, 30]), factura_folio: 'F' + l.id + '-' + palabra(), factura_fecha: d.fecha_servicio > HOY ? HOY : d.fecha_servicio }, h);
      if (st === 200) l.factura = true;
    },
    async cobrar() {
      const { g, s, h } = actor(['ventas', 'atencion', 'gerente']); const l = uno(deSuc(R.leads, s).filter(x => x.estatus === 'ganado')); if (!l) return;
      const [, c] = await pedir('GET', '/leads/' + l.id + '/cobros', g.token, undefined, h); const saldo = c.cuenta?.saldo || 0; if (saldo <= 1) return;
      const [st, k] = await pedir('POST', '/leads/' + l.id + '/cobros', g.token, { monto: Math.max(1, Math.round(saldo * (0.2 + azar() * 0.8) * 100) / 100), metodo: uno(['transferencia', 'efectivo', 'cheque']), fecha: HOY, referencia: 'Ref ' + palabra() }, h);
      if (st === 201 && !k.confirmado && azar() < 0.6) { const c2 = persona('gerente', s); await pedir('POST', '/finanzas/cobros/' + k.id + '/confirmar', c2.token); }
    },
    async gasto() {
      const { g, s, h } = actor(['costos', 'gerente']);
      const [st, x] = await pedir('POST', '/finanzas/cxp', g.token, { proveedor_id: uno(provs).id, categoria: 'otro', concepto: 'Gasto ' + palabra(), total: Math.round(100 + azar() * 20000), fecha_documento: dia(-Math.floor(azar() * 15)), dias_credito: uno([0, 15, 30]) }, h);
      if (st === 201) R.cxp.push({ id: x.id, suc: s });
    },
    async pagar() {
      const { g, s, h } = actor(['costos', 'gerente']);
      const [, lista] = await pedir('GET', '/finanzas/cxp', g.token, undefined, h); const x = uno((lista || []).filter(c => c.saldo > 0)); if (!x) return;
      await pedir('POST', '/finanzas/cxp/' + x.id + '/pagos', g.token, { monto: Math.round(x.saldo * (azar() < 0.5 ? 1 : 0.4) * 100) / 100, metodo: 'transferencia', fecha: HOY, cuenta_origen: 'Cuenta ' + s }, h);
    },
    async solicitud() {
      const { g, s, h } = actor(['ventas', 'tecnico', 'atencion', 'costos']);
      const [st, x] = await pedir('POST', '/compras/solicitudes', g.token, { que: 'Material ' + palabra() + ' ' + palabra(), para_que: 'Para la operación de ' + palabra(), centro_id: uno(centros).id, forzar: true }, h);
      if (st === 201) R.sols.push({ id: x.id, suc: s, de: g.id });
    },
    async compra() {
      // Toda la cadena con la gente de esa sucursal: aprueba la gerente, compras cotiza, elige, ordena, autoriza, recibe.
      const s = uno(SUC).id, x = uno(deSuc(R.sols, s).filter(y => !y.listo)); if (!x) return; x.listo = true;
      const ger = persona('gerente', s), com = persona('costos', s);
      await pedir('POST', '/compras/solicitudes/' + x.id + '/aprobar', ger.token);
      const ps = [...provs].sort(() => azar() - 0.5).slice(0, 3);
      for (const [k, p] of ps.entries()) await subir('/compras/solicitudes/' + x.id + '/documentos', com.token, pdf(), { 'X-Tipo': 'cotizacion', 'X-Proveedor': p.id, 'X-Monto': 1000 + k * 100, 'X-Nombre': 'c' + k + '.pdf' });
      const [, d] = await pedir('GET', '/compras/solicitudes/' + x.id, com.token); const c = (d.cotizaciones || []).sort((a, b) => a.monto - b.monto)[0]; if (!c) return;
      await pedir('POST', '/compras/solicitudes/' + x.id + '/elegir', com.token, { cotizacion_id: c.id });
      const [st, oc] = await pedir('POST', '/compras/ordenes', com.token, { solicitud_id: x.id, proveedor_id: c.proveedor_id, centro_id: uno(centros).id, categoria: 'otro', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Artículo ' + palabra(), unidad: 'PZA', precio: c.monto }] });
      if (st !== 201) return; R.ocs.push({ id: oc.id, suc: s });
      if (azar() < 0.8) { await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', ger.token, { dias_credito: uno([0, 15]) }); if (azar() < 0.6) { await subir('/compras/ordenes/' + oc.id + '/documentos', com.token, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'f.png' }); await pedir('POST', '/compras/ordenes/' + oc.id + '/recibir', com.token, { recibio: 'Almacén' }); } }
    },
    async datosCliente() {
      // Corregir datos de un cliente: solo su sucursal (o Dirección).
      const { g, s, h } = actor(['ventas', 'atencion', 'gerente']); const c = uno(R.clientes); if (!c) return;
      const [st] = await pedir('PUT', '/clientes/' + c.id, g.token, { notas_generales: 'Nota ' + palabra() }, h);
      if (c.suc === s && st !== 200) intentos.push(['su propia sucursal no pudo corregir su cliente ' + c.id, st]);
      if (c.suc !== s && st === 200) intentos.push(['otra sucursal corrigió al cliente ' + c.id, st]);
    },
    async intruso() {
      // Intento de tocar algo de OTRA sucursal (por número): debe responder «no existe» y no cambiar nada.
      const { g, s, h } = actor(['ventas', 'costos', 'tecnico', 'atencion', 'gerente']);
      const tipo = uno(['leads', 'ocs', 'sols']); const x = uno(R[tipo].filter(y => !g.sucs.includes(y.suc))); if (!x) return;
      const antes = soloIntrusos ? await estadoDe(tipo, x.id) : null;
      const ruta = { leads: ['GET /leads/:id', 'PUT /leads/:id', 'POST /leads/:id/cobros', 'POST /leads/:id/ejecucion', 'PUT /leads/:id/facturacion', 'DELETE /leads/:id', 'POST /leads/:id/historial'],
        ocs: ['GET /compras/ordenes/:id', 'PUT /compras/ordenes/:id', 'POST /compras/ordenes/:id/autorizar', 'POST /compras/ordenes/:id/cancelar', 'POST /compras/ordenes/:id/recibir'],
        sols: ['GET /compras/solicitudes/:id', 'PUT /compras/solicitudes/:id', 'POST /compras/solicitudes/:id/aprobar', 'POST /compras/solicitudes/:id/rechazar', 'POST /compras/solicitudes/:id/cancelar'] }[tipo];
      const [m, r] = uno(ruta).split(' ');
      const [st] = await pedir(m, r.replace(':id', x.id), g.token, m === 'GET' ? undefined : { version: 1, monto: 1, motivo: 'Intento de otra sucursal', estado: 'realizado', fecha: HOY, realizado_por: 'propio', dias_credito: 1, texto: 'x', recibio: 'x', que: 'x cambiado', para_que: 'x cambiado de otra', centro_id: centros[0].id }, h);
      if (st !== 404) intentos.push([g.nombre + ' ' + m + ' ' + r + ' #' + x.id + ' (' + tipo + ' de otra sucursal)', st]);
      if (soloIntrusos && antes !== await estadoDe(tipo, x.id)) intentos.push([g.nombre + ' ' + m + ' ' + r + ' CAMBIÓ #' + x.id, st]);
    },
  };
  const PESOS = [['contacto', 6], ['cotizar', 10], ['ganar', 7], ['realizar', 6], ['facturar', 4], ['cobrar', 7], ['gasto', 5], ['pagar', 4], ['solicitud', 3], ['compra', 2], ['datosCliente', 3], ['intruso', 8]];
  const bolsa = PESOS.flatMap(([k, p]) => Array(p).fill(k));
  // Para arrancar: unos contactos en cada sucursal.
  for (const s of SUC) for (let i = 0; i < 3; i++) { const v = persona('ventas', s.id); const cuerpo = { nombre: palabra() + ' ' + palabra(), telefono: telefono(LADA[s.id]), empresa_contacto: palabra() + ' ' + palabra() + ' ' + palabra(), direccion: 'x', canal_origen_id: canales[0].id };
    let [st, c] = await pedir('POST', '/contactos', v.token, cuerpo); if (st === 409 && c.error === 'posible_duplicado') [st, c] = await pedir('POST', '/contactos', v.token, { ...cuerpo, distinto_de: c.parecidos.map(p => p.id) }); if (st === 201) R.clientes.push({ id: c.id, suc: s.id }); }
  revisa(R.clientes.length === 9, 'tres contactos iniciales en cada sucursal', R.clientes.length);
  const cuenta = {};
  for (let i = 0; i < OPS; i += 8) {
    const lote = Array.from({ length: Math.min(8, OPS - i) }, () => uno(bolsa));
    lote.forEach(k => { cuenta[k] = (cuenta[k] || 0) + 1; });
    await Promise.all(lote.map(k => ACCIONES[k]().catch(e => errores500.push('acción ' + k + ': ' + e.message))));
  }
  console.log('  operaciones: ' + Object.entries(cuenta).map(([k, v]) => k + ' ' + v).join(' · '));
  // Fase aparte: solo intrusos (uno tras otro) y foto completa de todo antes y después.
  soloIntrusos = true;
  const fotoTodo = async () => JSON.stringify(await Promise.all(['/leads', '/finanzas/cxp?vista=todas', '/compras/ordenes', '/compras/solicitudes?estado=', '/finanzas/cartera', '/clientes?incluir_prospectos=1'].map(async r => (await pedir('GET', r, A))[1])));
  const fotoAntes = await fotoTodo();
  for (let i = 0; i < 150; i++) await ACCIONES.intruso();
  cuenta.intruso_solo = 150;
  const fotoDespues = await fotoTodo();
  console.log(`  creado: ${R.clientes.length} clientes, ${R.leads.length} cotizaciones/órdenes, ${R.cxp.length} gastos, ${R.sols.length} solicitudes, ${R.ocs.length} órdenes de compra`);
  revisa(R.leads.length > 40 && R.leads.filter(l => l.hecho).length > 5 && R.ocs.length > 0 && R.clientes.length > 20, 'hubo suficiente actividad para que la prueba valga');
  revisa(fotoAntes === fotoDespues, '150 intentos más, uno tras otro, sobre registros de otra sucursal: TODO quedó exactamente igual');
  { const [st, j] = await pedir('POST', '/finanzas/cxp', persona('costos', qro.id).token, { categoria: 'otro', concepto: 'Sin proveedor', total: 10, fecha_documento: HOY, dias_credito: 0 }); revisa(st === 400, 'un gasto sin proveedor responde «elige el proveedor» (antes era error 500)', [st, j.error]); }

  console.log('Comprobaciones');
  revisa(!errores500.length, 'ninguna respuesta 500 ni error de la simulación', errores500.slice(0, 8)); if (errores500.length) console.log(salida.split('\n').filter(l => /Error en|at /.test(l)).slice(0, 12).join('\n'));
  revisa(!intentos.length, `${cuenta.intruso || 0} intentos sobre registros de otra sucursal y ${cuenta.datosCliente || 0} correcciones de clientes: todos se comportaron como deben`, intentos.slice(0, 8));
  // 1. Cada registro en la sucursal de quien lo creó (lo que dice la base).
  const [, todos] = await pedir('GET', '/leads', A), porId = new Map(todos.map(l => [l.id, l]));
  const malLeads = R.leads.filter(l => porId.get(l.id)?.sucursal_id !== l.suc);
  revisa(!malLeads.length, `las ${R.leads.length} cotizaciones/órdenes quedaron en la sucursal de quien las hizo`, malLeads.slice(0, 5));
  const [, cxpT] = await pedir('GET', '/finanzas/cxp?vista=todas', A), cxpPor = new Map(cxpT.map(x => [x.id, x]));
  revisa(R.cxp.every(x => cxpPor.get(x.id)?.sucursal_id === x.suc), 'los gastos quedaron en su sucursal');
  revisa(cxpT.filter(x => x.lead_id).every(x => x.sucursal_id === porId.get(x.lead_id)?.sucursal_id), 'cada costo de una orden está en la misma sucursal que su orden');
  const [, ocsT] = await pedir('GET', '/compras/ordenes', A), [, solsT] = await pedir('GET', '/compras/solicitudes?estado=', A);
  revisa(R.ocs.every(o => ocsT.find(x => x.id === o.id)?.sucursal_id === o.suc) && R.sols.every(o => solsT.find(x => x.id === o.id)?.sucursal_id === o.suc), 'solicitudes y órdenes de compra en su sucursal');
  // 2. Nadie ve lo ajeno en ninguna lista (con la verdad de Dirección).
  const sucDe = { leads: id => porId.get(id)?.sucursal_id, cxp: id => cxpPor.get(id)?.sucursal_id, ocs: id => ocsT.find(x => x.id === id)?.sucursal_id, sols: id => solsT.find(x => x.id === id)?.sucursal_id };
  const ajenos = [];
  for (const g of GENTE) for (const h of g.sucs.length > 1 ? [{}, ...g.sucs.map(s => ({ 'X-Sucursal': String(s) }))] : [{}]) {
    const ve = h['X-Sucursal'] ? [Number(h['X-Sucursal'])] : g.sucs;
    const listas = [['/leads', 'leads', x => x.id], ['/finanzas/cxp?vista=todas', 'cxp', x => x.id], ['/compras/ordenes', 'ocs', x => x.id], ['/compras/solicitudes?estado=', 'sols', x => x.id],
      ['/finanzas/cartera', 'leads', x => x.lead_id], ['/generador?desde=2020-01-01&hasta=' + HOY, 'leads', x => x.lead_id], ['/calendario?desde=' + dia(-60) + '&hasta=' + dia(60), 'leads', x => x.lead_id]];
    for (const [r, tipo, id] of listas) {
      const [, j] = await pedir('GET', r, g.token, undefined, h); const filas = Array.isArray(j) ? j : j.filas || j.cuentas || j.eventos || [];
      for (const f of filas) { const i = id(f); if (i != null && !ve.includes(sucDe[tipo](i))) ajenos.push(g.nombre + ' ' + r + ' #' + i); }
    }
    // Clientes: los suyos o con los que su sucursal trabaja.
    const [, cl] = await pedir('GET', '/clientes/catalogo', g.token, undefined, h);
    for (const c of cl) { const rc = R.clientes.find(x => x.id === c.id); if (rc && !ve.includes(rc.suc) && !ve.some(s => rc.vendido?.has(s))) ajenos.push(g.nombre + ' cliente #' + c.id); }
  }
  revisa(!ajenos.length, `${GENTE.length} personas × 8 listas (y Ana en cada una de sus vistas): nadie ve nada de otra sucursal`, ajenos.slice(0, 8));
  // 3. «Todas» = suma de las sucursales (Inicio y Resultados), y lo que ve cada sucursal = lo que ve Dirección de ella.
  const res = async (t, h = {}) => (await pedir('GET', '/finanzas/resumen', t, undefined, h))[1];
  const rT = await res(A), rS = await Promise.all(SUC.map(s => res(A, { 'X-Sucursal': String(s.id) })));
  const sumaOk = k => Math.round(rS.reduce((a, r) => a + r[k] * 100, 0)) === Math.round(rT[k] * 100);
  revisa(['por_cobrar', 'vencido', 'por_pagar', 'cobrado_mes', 'pagado_mes', 'a_favor'].every(sumaOk), 'Inicio: «Todas» = QRO + CDMX + MTY (por cobrar, vencido, por pagar, cobrado y pagado del mes, a favor)', [rT, rS]);
  for (const s of SUC) { const ger = persona('gerente', s.id); const r = await res(ger.token); const d = rS[SUC.indexOf(s)];
    if (['por_cobrar', 'por_pagar', 'cobrado_mes'].some(k => Math.round(r[k] * 100) !== Math.round(d[k] * 100))) revisa(false, 'la gerente de ' + s.clave + ' ve lo mismo que Dirección viendo ' + s.clave, [r, d]); }
  revisa(true, 'cada gerente ve exactamente lo que Dirección ve de su sucursal');
  const [, tab] = await pedir('GET', '/tablero?desde=2020-01-01&hasta=' + HOY, A);
  revisa(['venta', 'gasto', 'utilidad', 'cobrado', 'pagado'].every(k => Math.round(tab.por_sucursal.reduce((a, x) => a + x[k] * 100, 0)) === Math.round(tab.actual[k] * 100)), 'Resultados: el comparativo por sucursal suma el total (venta, gastos, utilidad, cobrado, pagado)', tab.por_sucursal);
  // 4. Folios: seguidos y sin repetir dentro de cada sucursal.
  const seguidos = nums => { const o = [...nums].sort((a, b) => a - b); return o.length === new Set(o).size && o.every((v, i) => v === i + 1); };
  const fol = SUC.map(s => [s.clave, todos.filter(l => l.sucursal_id === s.id).map(l => l.folio_num)]);
  revisa(fol.every(([, f]) => seguidos(f)), 'folios de cotizaciones/órdenes: 1, 2, 3… sin huecos ni repetidos en cada sucursal', fol.map(([c, f]) => c + ': ' + f.length));
  const solF = SUC.map(s => solsT.filter(x => x.sucursal_id === s.id).map(x => Number(x.folio.slice(-4))));
  const ocF = SUC.map(s => ocsT.filter(x => x.sucursal_id === s.id).map(x => Number(x.folio.slice(-4))));
  revisa(solF.every(seguidos) && ocF.every(seguidos), 'folios de solicitudes y órdenes de compra: seguidos y sin repetir en cada sucursal', [solF, ocF]);
  { const [, c] = await pedir('GET', '/finanzas/cartera', A); const fs2 = (Array.isArray(c) ? c : c.cuentas || []); revisa(fs2.every(x => x.folio.includes('-' + SUC.find(s => s.id === x.sucursal_id).clave + '-')) && new Set(fs2.map(x => x.folio)).size === fs2.length, 'en Cuentas por cobrar cada folio lleva la clave de su sucursal y ninguno se repite'); }
  // 5. Integridad y errores.
  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const m = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'revisión de integridad: 0 errores', m.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 8));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-3000)); srv.kill(); process.exit(1); });
