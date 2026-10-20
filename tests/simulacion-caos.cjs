// SIMULACIÓN DE CAOS: cientos de operaciones al azar (pero reproducibles con SEMILLA) por todos los roles y las dos
// sucursales, mezcladas con ataques, datos basura y peticiones simultáneas. Después de cada ronda se revisa que TODO
// cuadre, leyendo la base directamente (sin pasar por la API):
//  · Dinero: cada orden cobra a lo más su total; el importe guardado = la suma de sus partidas con su IVA; ninguna
//    cuenta por pagar recibe más de lo que debe; orden de compra = su cuenta por pagar; canceladas sin pagos vivos.
//  · Folios: toda cotización/orden tiene folio único en su sucursal (la cotización y la orden comparten número).
//  · Reportes: Generador = Resultados = suma por sucursal; la cartera de la API = el cálculo desde la base.
//  · Robo de información: nadie ve registros de otra sucursal, ventas solo ve lo suyo, nadie sin permiso ve datos
//    sensibles del personal; un ataque rechazado no cambia NADA en la base.
//  · Datos basura (tipos raros, números imposibles, __proto__, textos enormes): nunca un error 500 ni el servidor caído.
//  · La revisión de integridad del sistema sale sin errores al final de cada ronda.
// Uso: node tests/simulacion-caos.cjs   ·   SEMILLA=azar RONDAS=6 OPS=120 node tests/simulacion-caos.cjs (corrida nueva y más larga)
// DEPURAR='POST /leads' muestra las peticiones rechazadas que coincidan (para ajustar la simulación).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Importes = require('../public/importes.js');

// Sin SEMILLA usa una fija (la batería de npm test siempre repite la misma corrida); SEMILLA=azar busca casos nuevos.
const SEMILLA = process.env.SEMILLA === 'azar' ? Date.now() % 1e9 : Number(process.env.SEMILLA) || 20261020, RONDAS = Number(process.env.RONDAS) || 4, OPS = Number(process.env.OPS) || 80;
// Generador pseudoaleatorio con semilla (mulberry32): la misma semilla repite exactamente la misma corrida.
let estadoAzar = SEMILLA >>> 0;
const azar = () => { estadoAzar = (estadoAzar + 0x6D2B79F5) >>> 0; let t = estadoAzar; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entero = (a, b) => a + Math.floor(azar() * (b - a + 1));
const uno = arr => arr[Math.floor(azar() * arr.length)];
const quizas = p => azar() < p;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-caos-')), DB = path.join(dir, 'caos.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Caos-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Caos-Usuarios-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9700 + Math.floor(Math.random() * 250)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
let peticiones = 0, errores500 = [];
const pedir = async (m, r, t, b, extra = {}) => {
  peticiones++;
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* binario */ }
  if (process.env.DEPURAR && x.status >= 400 && new RegExp(process.env.DEPURAR).test(m + ' ' + r)) console.log('   [dep]', m, r, x.status, texto.slice(0, 200), JSON.stringify(b)?.slice(0, 160));
  if (x.status >= 500) errores500.push(`${m} ${r} → ${x.status} ${texto.slice(0, 160)} · cuerpo ${JSON.stringify(b)?.slice(0, 160)}`);
  return [x.status, j, texto];
};
const subir = async (r, t, buf, enc) => { const hh = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) hh[k] = encodeURIComponent(String(v)); peticiones++; const x = await fetch(URLB + '/api' + r, { method: 'POST', headers: hh, body: buf }); if (x.status >= 500) errores500.push('subir ' + r + ' → ' + x.status); return [x.status, await x.json().catch(() => ({}))]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); } else if (process.env.DETALLE) console.log('  ✔ ' + texto); return cond; };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const leerBase = fn => { const d = new DatabaseSync(DB, { readOnly: true }); try { return fn(d); } finally { d.close(); } };
const pdf = t => Buffer.from(`%PDF-1.4\n% ${t} ${crypto.randomBytes(4).toString('hex')}\n%%EOF`);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(40)]);
// Nombres inventados con sílabas al azar: muy distintos entre sí (el sistema detecta clientes parecidos y pide confirmar).
const SIL = ['ba', 'ce', 'di', 'fo', 'gu', 'la', 'me', 'ni', 'po', 'ru', 'sa', 'te', 'vi', 'zo', 'cra', 'pli', 'tro', 'gra', 'blu', 'fre'];
const palabra = () => { const w = Array.from({ length: entero(2, 4) }, () => uno(SIL)).join(''); return w[0].toUpperCase() + w.slice(1); };
const conDigito = p17 => { const w = [3, 7, 1]; let s = 0; for (let i = 0; i < 17; i++) s += (Number(p17[i]) * w[i % 3]) % 10; return p17 + ((10 - (s % 10)) % 10); };

// Montos «tramposos» para cobros y pagos (la mayoría deben rechazarse).
const MONTOS_BASURA = [0, -1, -0.01, '0', '', null, 'abc', '1e309', 'Infinity', 'NaN', '1,0,0', '$-5', 0.001, 10.005, '10.999', 1e12, [100], { monto: 100 }, true, '  ', '٣٠٠'];
// Cuerpos basura para cualquier ruta.
const BASURA = () => uno([
  null, [], 'texto', 12, true, { __proto__: { admin_general: true } }, JSON.parse('{"__proto__":{"rol":"admin","admin_general":true}}'),
  { constructor: { prototype: { esAdmin: true } } }, { version: 'x', estatus: ['ganado'], valor: { $gt: 0 } },
  { nombre: 'A'.repeat(20000), notas: 'B'.repeat(50000) }, { monto: '9'.repeat(400) }, { fecha: '2026-02-30', fecha_servicio: '0000-00-00', fecha_documento: '9999-99-99' },
  { partidas_json: '[{"servicio":"x","importe":-100}]', iva_modo: 'mas_iva' }, { partidas_json: '{{{', iva_modo: 'raro' }, { partidas: 'no-es-lista' },
  { id: 1, sucursal_id: 999, responsable_id: 1, registrado_por: 1, cancelado: 0, confirmado: 1 }, { telefono: '<script>alert(1)</script>' },
  { equipo_personal: [{ personal_id: '1 OR 1=1', papel: 'responsable' }] }, { total: '1e3', dias_credito: '-5' }, { cotizacion_id: [1, 2] },
]);

(async () => {
  for (let i = 0; i < 120 && !/corriendo/.test(salida); i++) await espera(150);
  console.log(`Semilla ${SEMILLA} · ${RONDAS} rondas × ${OPS} operaciones (repetir: SEMILLA=${SEMILLA} node tests/simulacion-caos.cjs)`);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  [, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }); const cdmx = j;
  const SUC = { QRO: qro.id, CDMX: cdmx.id };
  // Rol extra: Recursos humanos (para atacar los datos sensibles).
  [, j] = await pedir('POST', '/roles', A, { nombre: 'Recursos humanos' }); const RH = j.clave;
  await pedir('PUT', '/roles/' + RH + '/permisos', A, { permisos: ['personal.ver', 'personal.editar', 'personal.sensibles'], alcances: {} });
  const ACT = { admin: { token: A, rol: 'admin', suc: null, id: (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id } };
  for (const [k, nombre, rol, suc] of [['gq', 'Gerente Queretaro', 'gerente', 'QRO'], ['v1', 'Vendedor Uno', 'ventas', 'QRO'], ['v2', 'Vendedor Dos', 'ventas', 'QRO'], ['tec', 'Tecnico Campo', 'tecnico', 'QRO'],
    ['at', 'Atencion Clientes', 'atencion', 'QRO'], ['co', 'Compras Costos', 'costos', 'QRO'], ['rh', 'Recursos Humanos', RH, 'QRO'], ['gc', 'Gerente Cdmx', 'gerente', 'CDMX'], ['vc', 'Vendedor Cdmx', 'ventas', 'CDMX'], ['tc', 'Tecnico Cdmx', 'tecnico', 'CDMX']]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [SUC[suc]] }); if (s !== 201) throw new Error(nombre + ' ' + JSON.stringify(j));
    ACT[k] = { token: (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token, rol, suc, id: j.id, nombre };
  }
  const deSuc = suc => Object.entries(ACT).filter(([, a]) => a.suc === suc).map(([k]) => k);
  const [canales, servicios, centros] = await Promise.all([pedir('GET', '/canales', A), pedir('GET', '/servicios', A), pedir('GET', '/compras/centros', A)].map(p => p.then(r => r[1])));
  const provs = [];
  for (const [nombre, cat] of [['Pipas del Centro', 'renta_maquinaria'], ['Combustibles Norte', 'combustible'], ['Refacciones Bajio', 'refacciones'], ['Llantas Rapidas', 'mantto_vehiculos'], ['Disposicion Limpia', 'residuos']])
    provs.push((await pedir('POST', '/finanzas/proveedores', A, { nombre, categoria: cat, dias_credito: entero(0, 30), clabe: conDigito('0121800' + String(entero(1e9, 9e9))) }))[1]);
  // Personal de cada sucursal (con datos sensibles, para intentar robarlos).
  const PER = { QRO: [], CDMX: [] }, SECRETOS = [];
  for (const [suc, cuantos] of [['QRO', 5], ['CDMX', 3]]) for (let i = 0; i < cuantos; i++) {
    const cl = conDigito('0721800' + String(entero(1e9, 9e9))); SECRETOS.push(cl);
    [s, j] = await pedir('POST', '/personal', A, { nombre: `Persona ${suc} ${'ABCDEFG'[i]} Caos`, puesto: uno(['Técnico', 'Operador', 'Ayudante']), sucursal_id: SUC[suc], fecha_ingreso: dia(-entero(10, 2000)), clabe: cl, salario: entero(300, 900), salario_periodo: 'diario' });
    if (s === 201) PER[suc].push(j.id);
  }

  // Registro de lo que se va creando (con su sucursal), para elegir sobre qué operar.
  const REG = { clientes: { QRO: [], CDMX: [] }, leads: [], cxp: [], sols: [], ocs: [], cobros: [], pagos: [] };
  const sucDeActor = k => ACT[k].suc || uno(['QRO', 'CDMX']);
  const tokDe = k => ACT[k].token;
  const fechaCot = () => dia(-entero(5, 90));
  const partidasAlAzar = () => Array.from({ length: entero(1, 4) }, () => quizas(0.5)
    ? (() => { const cantidad = uno([1, 2, 3, 1.5, 0.25, 7, 0.333]), precio = Number((entero(100, 900000) / 100).toFixed(2)); return { servicio: uno(servicios).nombre, leyenda: 'Trabajo ' + entero(1, 999), cantidad, precio, importe: Math.round(cantidad * precio * 100) / 100 }; })()
    : { servicio: uno(servicios).nombre, leyenda: 'Servicio ' + entero(1, 999), importe: Number((entero(100, 5000000) / 100).toFixed(2)) });
  const leadsDe = (suc, f = () => true) => REG.leads.filter(l => l.suc === suc && f(l));
  const leer = (id, t = A) => pedir('GET', '/leads/' + id, t).then(r => r[1]);

  // ---------- Operaciones «normales» (cualquiera puede ser rechazada: lo importante es que todo siga cuadrando) ----------
  const OPERACIONES = {
    async contacto() {
      const k = uno(['admin', 'gq', 'v1', 'v2', 'at', 'gc', 'vc']), suc = sucDeActor(k);
      const [st, c] = await pedir('POST', '/contactos', tokDe(k), { nombre: palabra() + ' ' + palabra() + ' ' + palabra(), telefono: '44' + entero(21000000, 98999999), empresa_contacto: palabra() + ' ' + palabra() + ' SA de CV', direccion: 'Calle ' + entero(1, 999), canal_origen_id: uno(canales).id }, ACT[k].suc ? {} : { 'X-Sucursal': String(SUC[suc]) });
      if (st === 201 || st === 200) REG.clientes[suc].push({ id: c.id, k });
    },
    async cotizacion() {
      const k = uno(['admin', 'gq', 'v1', 'v2', 'at', 'gc', 'vc']), suc = ACT[k].suc || 'QRO', cl = uno(REG.clientes[suc]); if (!cl) return;
      const resp = ACT[k].rol === 'ventas' ? ACT[k].id : uno(deSuc(suc).filter(x => ACT[x].rol === 'ventas').map(x => ACT[x].id));
      const [st, l] = await pedir('POST', '/leads', tokDe(k), { cliente_id: cl.id, direccion: 'Obra ' + entero(1, 99), canal_id: uno(canales).id, servicio_id: uno(servicios).id, responsable_id: resp, forzar_duplicado: true,
        partidas_json: JSON.stringify(partidasAlAzar()), iva_modo: uno(['mas_iva', 'incluido', 'sin_iva']), valor: 1, fecha_cotizacion: fechaCot() });
      if (st === 201) REG.leads.push({ id: l.id, suc, resp });
    },
    async ganar() {
      const l = uno(REG.leads.filter(x => x.estado !== 'perdido')); if (!l) return;
      const k = uno(deSuc(l.suc).concat('admin')), x = await leer(l.id); if (!x.version) return;
      const eq = quizas(0.5) && PER[l.suc].length ? [{ personal_id: uno(PER[l.suc]), papel: 'responsable' }] : undefined;
      const [st] = await pedir('PUT', '/leads/' + l.id, tokDe(k), { version: x.version, estatus: 'ganado', fecha_servicio: dia(entero(-30, 10)), ...(eq ? { equipo_personal: eq } : {}) });
      if (st === 200) l.estado = 'ganado';
    },
    async perder() {
      const l = uno(REG.leads); if (!l) return; const k = uno(deSuc(l.suc).concat('admin')), x = await leer(l.id); if (!x.version) return;
      const [st] = await pedir('PUT', '/leads/' + l.id, tokDe(k), { version: x.version, estatus: 'perdido', motivo_perdida: 'Precio alto' });
      if (st === 200) l.estado = 'perdido';
    },
    async cambiarImporte() { // también sobre órdenes con cobros: no debe quedar cobrado > total
      const l = uno(REG.leads); if (!l) return; const k = uno(deSuc(l.suc).concat('admin')), x = await leer(l.id); if (!x.version) return;
      await pedir('PUT', '/leads/' + l.id, tokDe(k), { version: x.version, partidas_json: JSON.stringify(partidasAlAzar()), iva_modo: uno(['mas_iva', 'incluido', 'sin_iva']) });
    },
    async realizar() {
      const l = uno(REG.leads.filter(x => x.estado === 'ganado')); if (!l) return; const k = uno(deSuc(l.suc).concat('admin'));
      const gastos = quizas(0.6) ? [{ proveedor_id: uno(provs).id, categoria: 'combustible', concepto: 'Diesel del servicio ' + entero(1, 99), total: entero(100, 5000), ya_pagado: quizas(0.5), metodo: 'transferencia', fecha_pago: dia(-1) }] : [];
      if (quizas(0.15)) return pedir('POST', '/leads/' + l.id + '/ejecucion', tokDe(k), { estado: 'no_realizado', motivo: 'El cliente canceló la visita' });
      await pedir('POST', '/leads/' + l.id + '/ejecucion', tokDe(k), { estado: 'realizado', fecha: dia(-entero(0, 3)), realizado_por: 'propio', gastos });
    },
    async facturar() {
      const l = uno(REG.leads.filter(x => x.estado === 'ganado')); if (!l) return; const k = uno(deSuc(l.suc).concat('admin'));
      const x = await leer(l.id), total = Math.round((Number(x.valor || 0) * 100) + (x.iva_cent || 0));
      await pedir('PUT', '/leads/' + l.id + '/facturacion', tokDe(k), { dias_credito: entero(0, 45), factura_folio: 'F-' + entero(1, 1e6), factura_fecha: dia(-entero(0, 10)), factura_metodo: uno(['PUE', 'PPD']),
        ...(quizas(0.3) ? { factura_total: (total + uno([-100, -1, 0, 1, 50])) / 100 } : {}) });
    },
    async cobrar() {
      const l = uno(REG.leads.filter(x => x.estado === 'ganado')); if (!l) return; const k = uno(deSuc(l.suc).concat('admin'));
      const [, cu] = await pedir('GET', '/leads/' + l.id + '/cobros', A); const saldo = cu?.cuenta?.saldo ?? cu?.saldo ?? 0;
      const monto = quizas(0.25) ? uno(MONTOS_BASURA) : uno([saldo, saldo + 0.01, saldo * 2, Math.round(saldo * 50) / 100, 1, saldo - 0.01]);
      const [st, r] = await pedir('POST', '/leads/' + l.id + '/cobros', tokDe(k), { monto, metodo: uno(['transferencia', 'efectivo', 'cheque', 'raro']), fecha: uno([HOY, dia(-1), dia(5), '2020-01-01']), tipo: uno([undefined, 'pago', 'anticipo', 'ajuste', 'regalo']), forzar: true });
      if (st === 201) REG.cobros.push({ id: r.id, lead: l.id, suc: l.suc });
    },
    // Versiones «bien hechas» (para que el dinero sí se mueva y haya qué cuadrar).
    async cobrarBien() {
      const l = uno(REG.leads.filter(x => x.estado === 'ganado')); if (!l) return; const k = uno(['admin', ...deSuc(l.suc).filter(x => ['gerente', 'atencion', 'ventas'].includes(ACT[x].rol))]);
      const [, cu] = await pedir('GET', '/leads/' + l.id + '/cobros', A); const saldo = cu?.cuenta?.saldo ?? 0; if (!(saldo > 0)) return;
      const monto = quizas(0.5) ? saldo : Math.max(0.01, Math.round(saldo * entero(10, 90)) / 100);
      const [st, r] = await pedir('POST', '/leads/' + l.id + '/cobros', tokDe(k), { monto, metodo: uno(['transferencia', 'efectivo', 'cheque']), fecha: HOY, referencia: 'Pago ' + entero(1, 9999), forzar: true });
      if (st === 201) REG.cobros.push({ id: r.id, lead: l.id, suc: l.suc });
    },
    async pagarBien() {
      const x = uno(REG.cxp); if (!x) return; const k = uno(['admin', ...deSuc(x.suc).filter(y => ACT[y].rol === 'gerente')]);
      const [, lista] = await pedir('GET', '/finanzas/cxp?vista=todas', A); const c = (Array.isArray(lista) ? lista : []).find(y => y.id === x.id); if (!(c?.saldo > 0)) return;
      const [st, r] = await pedir('POST', '/finanzas/cxp/' + x.id + '/pagos', tokDe(k), { monto: quizas(0.5) ? c.saldo : Math.max(0.01, Math.round(c.saldo * entero(10, 90)) / 100), metodo: 'transferencia', fecha: HOY, forzar: true });
      if (st === 201) REG.pagos.push({ id: r.id, cxp: x.id, suc: x.suc });
    },
    async ganarBien() {
      const l = uno(REG.leads.filter(x => !x.estado)); if (!l) return; const x = await leer(l.id); if (!x.version) return;
      const [st] = await pedir('PUT', '/leads/' + l.id, A, { version: x.version, estatus: 'ganado', fecha_servicio: dia(-entero(0, 4)), ...(PER[l.suc].length ? { equipo_personal: [{ personal_id: uno(PER[l.suc]), papel: 'responsable' }] } : {}) });
      if (st === 200) l.estado = 'ganado';
    },
    async cancelarCobro() {
      const c = uno(REG.cobros); if (!c) return; const k = uno(deSuc(c.suc).concat('admin'));
      await pedir('POST', '/finanzas/cobros/' + c.id + '/cancelar', tokDe(k), { motivo: 'Se capturó dos veces' });
    },
    async confirmarCobro() { const c = uno(REG.cobros); if (c) await pedir('POST', '/finanzas/cobros/' + c.id + '/confirmar', tokDe(uno(deSuc(c.suc).concat('admin'))), {}); },
    async eliminar() { const l = uno(REG.leads); if (l) { const [st] = await pedir('DELETE', '/leads/' + l.id, tokDe(uno(deSuc(l.suc).concat('admin')))); if (st === 200) { l.borrado = true; REG.leads.splice(REG.leads.indexOf(l), 1); } } },
    async gasto() {
      const k = uno(['admin', 'gq', 'co', 'gc', 'v1', 'tec']), suc = ACT[k].suc || 'QRO', l = quizas(0.6) ? uno(leadsDe(suc, x => x.estado === 'ganado')) : null;
      const total = quizas(0.2) ? uno(MONTOS_BASURA) : entero(50, 90000) + entero(0, 99) / 100;
      const factura = quizas(0.5);
      const [st, r] = await pedir('POST', '/finanzas/cxp', tokDe(k), { proveedor_id: uno(provs).id, categoria: uno(['combustible', 'refacciones', 'renta_maquinaria', 'activos', 'movimientos']), concepto: 'Gasto caos ' + entero(1, 1e6),
        total, fecha_documento: dia(-entero(0, 40)), dias_credito: entero(0, 30), tipo_comprobante: factura ? 'factura' : uno(['recibo', 'sin_factura', 'informativo', 'raro']), factura_folio: factura ? 'P-' + entero(1, 1e7) : undefined,
        iva: factura && quizas(0.5) ? uno([Math.round(Number(total) * 16 / 116 * 100) / 100, 0, Number(total), -5, 'x']) : undefined, lead_id: l?.id, forzar: true }, ACT[k].suc ? {} : { 'X-Sucursal': String(SUC[suc]) });
      if (st === 201) REG.cxp.push({ id: r.id, suc });
    },
    async pagarProveedor() {
      const x = uno(REG.cxp); if (!x) return; const k = uno(deSuc(x.suc).concat('admin'));
      const [, lista] = await pedir('GET', '/finanzas/cxp?vista=todas', A); const c = (Array.isArray(lista) ? lista : []).find(y => y.id === x.id); const saldo = c?.saldo ?? 100;
      const monto = quizas(0.25) ? uno(MONTOS_BASURA) : uno([saldo, saldo + 0.01, saldo * 3, Math.round(saldo * 30) / 100]);
      const [st, r] = await pedir('POST', '/finanzas/cxp/' + x.id + '/pagos', tokDe(k), { monto, metodo: uno(['transferencia', 'efectivo', 'nomina', 'raro']), fecha: uno([HOY, dia(-2), dia(3)]), forzar: true });
      if (st === 201) REG.pagos.push({ id: r.id, cxp: x.id, suc: x.suc });
    },
    async cancelarPago() { const p = uno(REG.pagos); if (p) await pedir('POST', '/finanzas/pagos-proveedor/' + p.id + '/cancelar', tokDe(uno(deSuc(p.suc).concat('admin'))), { motivo: 'Pago duplicado por error' }); },
    async cancelarCxp() { const x = uno(REG.cxp); if (x) await pedir('POST', '/finanzas/cxp/' + x.id + '/cancelar', tokDe(uno(deSuc(x.suc).concat('admin'))), { motivo: 'Factura cancelada por el proveedor' }); },
    async ivaGasto() { const x = uno(REG.cxp); if (x) await pedir('POST', '/finanzas/cxp/' + x.id + '/iva', tokDe(uno(deSuc(x.suc).concat('admin'))), { iva: uno([0, 1, 160, '16.00', -1, 'x', 1e9]) }); },
    async solicitud() {
      const k = uno(['v1', 'v2', 'tec', 'co', 'gq', 'vc', 'tc', 'gc']), suc = ACT[k].suc;
      const [st, r] = await pedir('POST', '/compras/solicitudes', tokDe(k), { que: 'Material ' + entero(1, 1e5), para_que: 'Para la unidad ' + entero(1, 99) + ' que lo necesita', centro_id: uno(centros).id, urgente: quizas(0.3), equipo: 'E-' + entero(1, 99) });
      if (st === 201) REG.sols.push({ id: r.id, suc });
    },
    async avanzarSolicitud() {
      const so = uno(REG.sols); if (!so) return; const k = uno(deSuc(so.suc).concat('admin')), t = tokDe(k);
      const accion = uno(['aprobar', 'rechazar', 'cancelar', 'cotizar', 'cotizar', 'elegir', 'oc']);
      if (accion === 'aprobar') return pedir('POST', '/compras/solicitudes/' + so.id + '/aprobar', t, {});
      if (accion === 'rechazar' || accion === 'cancelar') return pedir('POST', '/compras/solicitudes/' + so.id + '/' + accion, t, { motivo: 'Ya no se necesita' });
      if (accion === 'cotizar') return subir('/compras/solicitudes/' + so.id + '/documentos', t, pdf('cot'), { 'X-Tipo': 'cotizacion', 'X-Proveedor': uno(provs).id, 'X-Monto': uno([entero(100, 50000), -1, 'abc', 0]), 'X-Entrega': '2 días', 'X-Nombre': 'cot.pdf' });
      const [, d] = await pedir('GET', '/compras/solicitudes/' + so.id, A); const cot = uno(d.cotizaciones || []);
      if (accion === 'elegir') return cot && pedir('POST', '/compras/solicitudes/' + so.id + '/elegir', t, { cotizacion_id: cot.id, motivo_urgencia: quizas(0.5) ? 'Es urgente: la unidad está parada' : undefined, motivo_excepcion: 'Solo hay un proveedor' });
      const elegida = d.ganadora || cot; if (!elegida) return;
      const [st, oc] = await pedir('POST', '/compras/ordenes', t, { solicitud_id: so.id, proveedor_id: elegida.proveedor_id, centro_id: d.centro_id || uno(centros).id, categoria: 'refacciones', iva_modo: uno(['mas_iva', 'incluido', 'sin_iva']),
        partidas: [{ cantidad: uno([1, 2, 3.5]), descripcion: 'Pieza ' + entero(1, 99), unidad: 'PZA', precio: Number((entero(100, 900000) / 100).toFixed(2)) }] });
      if (st === 201) REG.ocs.push({ id: oc.id, suc: so.suc });
    },
    async ordenCompraDirecta() {
      const k = uno(['admin', 'gq', 'co', 'gc']), suc = ACT[k].suc || 'QRO';
      const [st, oc] = await pedir('POST', '/compras/ordenes', tokDe(k), { forzar: true, proveedor_id: uno(provs).id, centro_id: uno(centros).id, categoria: 'refacciones', fecha: HOY, fecha_requerida: dia(3), iva_modo: uno(['mas_iva', 'incluido', 'sin_iva']),
        partidas: Array.from({ length: entero(1, 3) }, () => ({ cantidad: uno([1, 2, 0.5, 12]), descripcion: 'Material ' + entero(1, 999), unidad: 'PZA', precio: Number((entero(100, 500000) / 100).toFixed(2)) })) }, ACT[k].suc ? {} : { 'X-Sucursal': String(SUC[suc]) });
      if (st === 201) REG.ocs.push({ id: oc.id, suc });
    },
    async avanzarOC() {
      const o = uno(REG.ocs); if (!o) return; const k = uno(deSuc(o.suc).concat('admin')), t = tokDe(k);
      const accion = uno(['autorizar', 'autorizar', 'pagar', 'evidencia', 'recibir', 'cancelar', 'editar']);
      if (accion === 'autorizar') return pedir('POST', '/compras/ordenes/' + o.id + '/autorizar', t, { dias_credito: uno([0, 15, '', -1, 'x']) });
      if (accion === 'cancelar') return pedir('POST', '/compras/ordenes/' + o.id + '/cancelar', t, { motivo: 'El proveedor no surtió' });
      if (accion === 'evidencia') return subir('/compras/ordenes/' + o.id + '/documentos', t, png(), { 'X-Tipo': uno(['evidencia', 'firma_recepcion', 'factura']), 'X-Nombre': 'evidencia.png' });
      if (accion === 'recibir') return pedir('POST', '/compras/ordenes/' + o.id + '/recibir', t, { recibio: 'Almacén', nota: 'Completo' });
      const [, d] = await pedir('GET', '/compras/ordenes/' + o.id, A);
      if (accion === 'editar' && d.version) return pedir('PUT', '/compras/ordenes/' + o.id, t, { ...d, version: d.version, partidas: [{ cantidad: 1, descripcion: 'Cambio', precio: entero(1, 99999) }] });
      if (accion === 'pagar' && d.cxp_id) { const [st, r] = await pedir('POST', '/finanzas/cxp/' + d.cxp_id + '/pagos', t, { monto: uno([d.total, d.total + 1, d.total / 2]), metodo: 'transferencia', fecha: HOY, forzar: true }); if (st === 201) REG.pagos.push({ id: r.id, cxp: d.cxp_id, suc: o.suc }); }
    },
    async personal() {
      const suc = uno(['QRO', 'CDMX']), p = uno(PER[suc]); if (!p) return; const k = uno(['admin', 'rh', 'gq', 'gc', 'v1', 'tec']);
      await uno([
        () => pedir('POST', '/personal/' + p + '/incidencias', tokDe(k), { tipo: uno(['vacaciones', 'falta', 'permiso', 'incapacidad', 'fiesta']), fecha_inicio: dia(-entero(0, 300)), notas: 'Nota ' + entero(1, 99), forzar: quizas(0.5) }),
        () => pedir('PUT', '/personal/' + p, tokDe(k), { telefono: '442 ' + entero(1000000, 9999999), clabe: uno([conDigito('0141800' + String(entero(1e9, 9e9))), '123', '']) }),
      ])();
    },
  };
  const PESOS = { cobrarBien: 9, pagarBien: 7, ganarBien: 7, contacto: 6, cotizacion: 10, ganar: 5, perder: 2, cambiarImporte: 4, realizar: 6, facturar: 5, cobrar: 10, cancelarCobro: 2, confirmarCobro: 2, eliminar: 2, gasto: 7, pagarProveedor: 6, cancelarPago: 2, cancelarCxp: 1, ivaGasto: 2,
    solicitud: 4, avanzarSolicitud: 8, ordenCompraDirecta: 2, avanzarOC: 6, personal: 3 };
  const BOLSA = Object.entries(PESOS).flatMap(([k, p]) => Array(p).fill(k));

  // ---------- Ataques: quien NO debe, intenta; la respuesta debe ser rechazo y la base no cambia ni un byte ----------
  const foto = () => leerBase(d => JSON.stringify(['leads', 'cobros', 'cuentas_por_pagar', 'pagos_proveedor', 'solicitudes_compra', 'ordenes_compra', 'personal', 'incidencias_personal', 'clientes', 'proveedores']
    .map(t => d.prepare(`SELECT * FROM ${t} ORDER BY id`).all())));
  async function ataque() {
    // Alguien de la OTRA sucursal (o un rol sin permiso) contra un registro existente.
    const blancos = [...REG.leads.map(x => ['lead', x]), ...REG.cxp.map(x => ['cxp', x]), ...REG.sols.map(x => ['sol', x]), ...REG.ocs.map(x => ['oc', x]), ...REG.cobros.map(x => ['cobro', x]), ...PER.QRO.map(id => ['per', { id, suc: 'QRO' }]), ...PER.CDMX.map(id => ['per', { id, suc: 'CDMX' }])];
    if (!blancos.length) return;
    const [tipo, b] = uno(blancos), otra = b.suc === 'QRO' ? 'CDMX' : 'QRO', k = uno(deSuc(otra)), t = tokDe(k);
    const intentos = {
      lead: [['GET', '/leads/' + b.id], ['PUT', '/leads/' + b.id, { version: 1, estatus: 'perdido' }], ['DELETE', '/leads/' + b.id], ['POST', '/leads/' + b.id + '/cobros', { monto: 1, metodo: 'efectivo' }],
        ['POST', '/leads/' + b.id + '/ejecucion', { estado: 'realizado', fecha: HOY }], ['PUT', '/leads/' + b.id + '/facturacion', { dias_credito: 5, factura_folio: 'X' }], ['POST', '/leads/' + b.id + '/historial', { texto: 'hack' }], ['GET', '/leads/' + b.id + '/cobros']],
      cxp: [['POST', '/finanzas/cxp/' + b.id + '/pagos', { monto: 1, metodo: 'efectivo' }], ['POST', '/finanzas/cxp/' + b.id + '/cancelar', { motivo: 'hack hack hack' }], ['POST', '/finanzas/cxp/' + b.id + '/iva', { iva: 0 }], ['GET', '/finanzas/cxp/' + b.id + '/pagos']],
      sol: [['GET', '/compras/solicitudes/' + b.id], ['POST', '/compras/solicitudes/' + b.id + '/aprobar', {}], ['POST', '/compras/solicitudes/' + b.id + '/cancelar', { motivo: 'hack hack' }], ['PUT', '/compras/solicitudes/' + b.id, { que: 'hack' }]],
      oc: [['GET', '/compras/ordenes/' + b.id], ['POST', '/compras/ordenes/' + b.id + '/autorizar', { dias_credito: 0 }], ['POST', '/compras/ordenes/' + b.id + '/cancelar', { motivo: 'hack hack' }], ['POST', '/compras/ordenes/' + b.id + '/recibir', { recibio: 'x' }]],
      cobro: [['POST', '/finanzas/cobros/' + b.id + '/cancelar', { motivo: 'hack hack hack' }], ['POST', '/finanzas/cobros/' + b.id + '/confirmar', {}]],
      per: [['GET', '/personal/' + b.id], ['PUT', '/personal/' + b.id, { clabe: conDigito('01218000123456789') }], ['POST', '/personal/' + b.id + '/baja', { motivo: 'hack hack' }], ['POST', '/personal/' + b.id + '/incidencias', { tipo: 'falta', fecha_inicio: HOY }]],
    }[tipo];
    const [m, r, body] = uno(intentos);
    const antes = foto(); const [st, resp, texto] = await pedir(m, r, t, body); const despues = foto();
    const negado = st === 403 || st === 404 || (m === 'GET' && st === 200 && Array.isArray(resp) && resp.length === 0);
    revisa(negado && antes === despues, `ataque desde ${otra} (${ACT[k].nombre}): ${m} ${r.replace(/\d+/g, ':id')} → rechazado y la base no cambia`, [st, texto.slice(0, 200), antes === despues]);
    if (tipo === 'per' && m === 'GET') revisa(!SECRETOS.some(x => texto.includes(x)), 'ni una CLABE de otra sucursal en la respuesta');
  }
  // Roles sin permiso dentro de la misma sucursal (ventas no mueve dinero de proveedores, técnico no elimina, etc.).
  async function ataqueRol() {
    const opciones = [
      ['v1', () => { const x = uno(REG.cxp.filter(c => c.suc === 'QRO')); return x && ['POST', '/finanzas/cxp/' + x.id + '/pagos', { monto: 1, metodo: 'efectivo' }]; }],
      ['tec', () => { const l = uno(leadsDe('QRO')); return l && ['DELETE', '/leads/' + l.id]; }],
      ['at', () => { const o = uno(REG.ocs.filter(c => c.suc === 'QRO')); return o && ['POST', '/compras/ordenes/' + o.id + '/autorizar', { dias_credito: 0 }]; }],
      ['v2', () => { const c = uno(REG.cobros.filter(c => c.suc === 'QRO')); return c && ['POST', '/finanzas/cobros/' + c.id + '/cancelar', { motivo: 'no me gusto' }]; }],
      ['co', () => { const l = uno(leadsDe('QRO')); return l && ['PUT', '/leads/' + l.id + '/facturacion', { dias_credito: 90 }]; }],
      ['v1', () => ['GET', '/admin/backup']], ['tec', () => ['GET', '/tablero']], ['v2', () => ['GET', '/auditoria']], ['co', () => ['PUT', '/roles/ventas/permisos', { permisos: ['dinero.mover'], alcances: {} }]],
      ['v1', () => ['POST', '/usuarios', { nombre: 'Intruso Total', password: 'Intruso-12345', rol: 'gerente' }]], ['tec', () => { const p = uno(PER.QRO); return p && ['GET', '/personal/' + p]; }],
      ['v2', () => { const l = uno(leadsDe('QRO', x => x.resp === ACT.v1.id)); return l && ['GET', '/leads/' + l.id]; }], ['v2', () => { const l = uno(leadsDe('QRO', x => x.resp === ACT.v1.id)); return l && ['PUT', '/leads/' + l.id, { version: 1, notas_iniciales: 'mío' }]; }],
    ];
    const [k, f] = uno(opciones), x = f(); if (!x) return;
    const antes = foto(); const [st, , texto] = await pedir(x[0], x[1], tokDe(k), x[2]); const despues = foto();
    const negado = st === 403 || st === 404 || st === 401;
    revisa(negado && antes === despues, `ataque de rol (${ACT[k].nombre}): ${x[0]} ${x[1].replace(/\d+/g, ':id')} → rechazado y sin cambios`, [st, texto.slice(0, 160)]);
  }
  // ---------- Peticiones simultáneas: solo una debe pasar ----------
  async function rafagas() {
    const l = uno(REG.leads.filter(x => x.estado === 'ganado'));
    if (l) {
      const [, cu] = await pedir('GET', '/leads/' + l.id + '/cobros', A), saldo = cu?.cuenta?.saldo ?? 0;
      if (saldo > 0) {
        const r = await Promise.all(Array.from({ length: 8 }, (_, i) => pedir('POST', '/leads/' + l.id + '/cobros', A, { monto: saldo, metodo: 'transferencia', fecha: HOY, referencia: 'rafaga ' + i, forzar: true })));
        revisa(r.filter(x => x[0] === 201).length <= 1, '8 cobros simultáneos por el saldo completo: entra a lo más uno', r.map(x => x[0]));
        r.filter(x => x[0] === 201).forEach(x => REG.cobros.push({ id: x[1].id, lead: l.id, suc: l.suc }));
      }
      const x = await leer(l.id);
      if (x.version) { const r = await Promise.all(Array.from({ length: 6 }, (_, i) => pedir('PUT', '/leads/' + l.id, A, { version: x.version, observaciones: 'Edición simultánea ' + i }))); revisa(r.filter(y => y[0] === 200).length === 1, '6 ediciones simultáneas con la misma versión: solo una gana (las demás «alguien más lo cambió»)', r.map(y => y[0])); }
    }
    const c = uno(REG.cxp);
    if (c) {
      const [, lista] = await pedir('GET', '/finanzas/cxp?vista=todas', A), cx = (Array.isArray(lista) ? lista : []).find(y => y.id === c.id);
      if (cx && cx.saldo > 0) { const r = await Promise.all(Array.from({ length: 8 }, (_, i) => pedir('POST', '/finanzas/cxp/' + c.id + '/pagos', A, { monto: cx.saldo, metodo: 'transferencia', fecha: HOY, referencia: 'rafaga ' + i, forzar: true })));
        revisa(r.filter(x => x[0] === 201).length <= 1, '8 pagos simultáneos al proveedor por el saldo completo: entra a lo más uno', r.map(x => x[0])); r.filter(x => x[0] === 201).forEach(x => REG.pagos.push({ id: x[1].id, cxp: c.id, suc: c.suc })); }
    }
    const o = uno(REG.ocs);
    if (o) { const r = await Promise.all(Array.from({ length: 5 }, () => pedir('POST', '/compras/ordenes/' + o.id + '/autorizar', A, { dias_credito: 0 }))); revisa(r.filter(x => x[0] === 200).length <= 1, '5 autorizaciones simultáneas de la misma orden de compra: a lo más una (una sola deuda)', r.map(x => x[0])); }
    const cb = uno(REG.cobros);
    if (cb) { const r = await Promise.all(Array.from({ length: 4 }, () => pedir('POST', '/finanzas/cobros/' + cb.id + '/cancelar', A, { motivo: 'Cancelación simultánea' }))); revisa(r.filter(x => x[0] === 200).length <= 1, '4 cancelaciones simultáneas del mismo cobro: a lo más una', r.map(x => x[0])); }
  }
  // ---------- Datos basura a todas las rutas que escriben ----------
  const RUTAS_ESCRITURA = () => {
    const l = uno(REG.leads)?.id || 1, c = uno(REG.cxp)?.id || 1, so = uno(REG.sols)?.id || 1, o = uno(REG.ocs)?.id || 1, p = uno(PER.QRO) || 1, cb = uno(REG.cobros)?.id || 1;
    return [['POST', '/contactos'], ['POST', '/leads'], ['PUT', '/leads/' + l], ['POST', '/leads/' + l + '/cobros'], ['POST', '/leads/' + l + '/ejecucion'], ['PUT', '/leads/' + l + '/facturacion'], ['POST', '/leads/' + l + '/historial'],
      ['POST', '/finanzas/cxp'], ['POST', '/finanzas/cxp/' + c + '/pagos'], ['POST', '/finanzas/cxp/' + c + '/iva'], ['POST', '/finanzas/cobros/' + cb + '/cancelar'], ['POST', '/finanzas/proveedores'], ['PUT', '/finanzas/proveedores/' + provs[0].id],
      ['POST', '/compras/solicitudes'], ['PUT', '/compras/solicitudes/' + so], ['POST', '/compras/solicitudes/' + so + '/elegir'], ['POST', '/compras/ordenes'], ['PUT', '/compras/ordenes/' + o], ['POST', '/compras/ordenes/' + o + '/autorizar'],
      ['POST', '/personal'], ['PUT', '/personal/' + p], ['POST', '/personal/' + p + '/incidencias'], ['POST', '/usuarios'], ['PUT', '/roles/ventas/permisos'], ['POST', '/prospeccion'], ['PUT', '/clientes/' + (REG.clientes.QRO[0]?.id || 1)],
      ['POST', '/finanzas/importar/cxp'], ['POST', '/finanzas/importar/cxc'], ['POST', '/generador/importar'], ['POST', '/clientes/verificar'], ['PUT', '/finanzas/clientes/' + (REG.clientes.QRO[0]?.id || 1) + '/credito'], ['POST', '/sucursales']];
  };
  async function basura() {
    for (let i = 0; i < 12; i++) {
      const [m, r] = uno(RUTAS_ESCRITURA()), k = uno(Object.keys(ACT)), cuerpo = quizas(0.1) ? '{"roto": ' : BASURA();
      await pedir(m, r, tokDe(k), cuerpo);
    }
    const [st] = await pedir('GET', '/salud'); revisa(st === 200, 'el servidor sigue vivo después de la basura');
    const [s2] = await pedir('GET', '/admin/integridad', ACT.v1.token); revisa(s2 === 403, 'un __proto__ con «admin_general» no convierte en Dirección a ventas', s2);
  }
  // ---------- Robo de información: cada quien solo recibe lo de su sucursal (y ventas, solo lo suyo) ----------
  async function barridoFugas() {
    const suc = leerBase(d => ({ leads: new Map(d.prepare('SELECT id, sucursal_id, responsable_id, tecnico_id FROM leads').all().map(r => [r.id, r])), cxp: new Map(d.prepare('SELECT id, sucursal_id FROM cuentas_por_pagar').all().map(r => [r.id, r.sucursal_id])),
      sol: new Map(d.prepare('SELECT id, sucursal_id FROM solicitudes_compra').all().map(r => [r.id, r.sucursal_id])), oc: new Map(d.prepare('SELECT id, sucursal_id FROM ordenes_compra').all().map(r => [r.id, r.sucursal_id])), per: new Map(d.prepare('SELECT id, sucursal_id FROM personal').all().map(r => [r.id, r.sucursal_id])) }));
    for (const k of Object.keys(ACT).filter(x => x !== 'admin')) {
      const a = ACT[k], mia = SUC[a.suc], t = a.token, fuera = [];
      const lista = async r => { const [st, j] = await pedir('GET', r, t); return st === 200 ? (Array.isArray(j) ? j : j.ordenes || j.cuentas || j.lista || []) : []; };
      for (const l of await lista('/leads')) { const x = suc.leads.get(l.id); if (x && x.sucursal_id !== mia) fuera.push('lead ' + l.id); if (x && a.rol === 'ventas' && x.responsable_id !== a.id && x.tecnico_id !== a.id) fuera.push('lead ajeno ' + l.id); }
      for (const c of await lista('/finanzas/cartera')) { const x = suc.leads.get(c.lead_id); if (x && x.sucursal_id !== mia) fuera.push('cartera ' + c.lead_id); }
      for (const c of await lista('/finanzas/cxp?vista=todas')) if (suc.cxp.get(c.id) !== undefined && suc.cxp.get(c.id) !== mia) fuera.push('cxp ' + c.id);
      for (const c of await lista('/compras/solicitudes')) if (suc.sol.get(c.id) !== undefined && suc.sol.get(c.id) !== mia) fuera.push('solicitud ' + c.id);
      for (const c of await lista('/compras/ordenes')) if (suc.oc.get(c.id) !== undefined && suc.oc.get(c.id) !== mia) fuera.push('oc ' + c.id);
      const [sp, per, textoPer] = await pedir('GET', '/personal', t);
      if (sp === 200) for (const p of per) if (suc.per.get(p.id) !== mia) fuera.push('persona ' + p.id);
      if (SECRETOS.some(x => (textoPer || '').includes(x))) fuera.push('CLABE completa en la lista de personal');
      revisa(!fuera.length, `${a.nombre} (${a.suc}, ${a.rol}): no recibe nada de otra sucursal ni de otro vendedor`, fuera.slice(0, 8));
    }
  }
  // ---------- Todo cuadra (leyendo la base directamente) ----------
  async function cuadra(ronda) {
    const v = leerBase(d => {
      const mal = [];
      const leads = d.prepare('SELECT * FROM leads').all();
      for (const l of leads) {
        if (l.folio_num == null || l.sucursal_id == null) mal.push(`lead ${l.id} sin folio o sin sucursal`);
        if (l.iva_modo) { let items; try { items = JSON.parse(l.partidas_json || '[]'); } catch { items = null; }
          if (Array.isArray(items) && items.length) { const r = Importes.calcular(items, l.iva_modo, l.iva_tasa); if (r.subtotal_cent !== Math.round(Number(l.valor) * 100) || r.iva_cent !== l.iva_cent) mal.push(`lead ${l.id}: importe guardado ${l.valor}+${l.iva_cent / 100} ≠ partidas ${r.subtotal_cent / 100}+${r.iva_cent / 100}`); } }
        const total = l.factura_total_cent ?? (Math.round(Number(l.valor || 0) * 100) + (l.iva_cent || 0));
        const cobrado = d.prepare('SELECT COALESCE(SUM(monto_cent),0) t FROM cobros WHERE lead_id = ? AND cancelado = 0').get(l.id).t;
        if (l.ejecucion !== 'no_realizado' && cobrado > total) mal.push(`lead ${l.id}: cobrado ${cobrado / 100} > total ${total / 100}`);
        if (cobrado > 0 && l.estatus !== 'ganado') mal.push(`lead ${l.id}: tiene cobros vivos pero está «${l.estatus}»`);
      }
      const dup = d.prepare('SELECT sucursal_id, folio_num, COUNT(*) n FROM leads WHERE folio_num IS NOT NULL GROUP BY 1, 2 HAVING n > 1').all(); if (dup.length) mal.push('folios repetidos: ' + JSON.stringify(dup));
      for (const c of d.prepare('SELECT x.*, (SELECT COALESCE(SUM(monto_cent),0) FROM pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) pagado FROM cuentas_por_pagar x').all()) {
        if (c.pagado > c.total_cent) mal.push(`cxp ${c.id}: pagado ${c.pagado / 100} > total ${c.total_cent / 100}`);
        if (c.cancelada && c.pagado > 0) mal.push(`cxp ${c.id}: cancelada con pagos vivos`);
        if (c.iva_cent != null && (c.iva_cent < 0 || c.iva_cent >= c.total_cent)) mal.push(`cxp ${c.id}: IVA imposible ${c.iva_cent}`);
        if (c.lead_id) { const l = leads.find(x => x.id === c.lead_id); if (l && l.sucursal_id !== c.sucursal_id) mal.push(`cxp ${c.id}: de otra sucursal que su orden`); }
      }
      for (const o of d.prepare('SELECT o.*, x.total_cent cxp_total, x.cancelada cxp_cancelada FROM ordenes_compra o LEFT JOIN cuentas_por_pagar x ON x.id = o.cxp_id').all()) {
        let items; try { items = JSON.parse(o.partidas_json); } catch { items = []; }
        const r = Importes.calcular(items.map(p => ({ ...p, importe: p.importe ?? Importes.importeDe(p.cantidad, p.precio) })), o.iva_modo, o.iva_tasa);
        if (r.total_cent !== o.total_cent || r.subtotal_cent !== o.subtotal_cent || r.iva_cent !== o.iva_cent) mal.push(`oc ${o.id}: totales ${o.subtotal_cent}/${o.iva_cent}/${o.total_cent} ≠ partidas ${r.subtotal_cent}/${r.iva_cent}/${r.total_cent}`);
        if (['autorizada', 'recibida'].includes(o.estado) && (!o.cxp_id || o.cxp_total !== o.total_cent || o.cxp_cancelada)) mal.push(`oc ${o.id} (${o.estado}): su cuenta por pagar no cuadra (${o.cxp_total} vs ${o.total_cent})`);
        if (o.estado === 'cancelada' && o.cxp_id && !o.cxp_cancelada) mal.push(`oc ${o.id} cancelada con su cuenta por pagar viva`);
        if (o.solicitud_id) { const so = d.prepare('SELECT sucursal_id FROM solicitudes_compra WHERE id = ?').get(o.solicitud_id); if (so && so.sucursal_id !== o.sucursal_id) mal.push(`oc ${o.id}: de otra sucursal que su solicitud`); }
      }
      const vivasPorSol = d.prepare("SELECT solicitud_id, COUNT(*) n FROM ordenes_compra WHERE solicitud_id IS NOT NULL AND estado <> 'cancelada' GROUP BY 1 HAVING n > 1").all(); if (vivasPorSol.length) mal.push('solicitudes con más de una orden de compra viva: ' + JSON.stringify(vivasPorSol));
      for (const p of d.prepare('SELECT id, clabe, rfc, curp, nss, salario_cent FROM personal').all()) for (const k of ['clabe', 'rfc', 'curp', 'nss', 'salario_cent']) if (p[k] != null && !String(p[k]).startsWith('enc1:')) mal.push(`personal ${p.id}: ${k} sin cifrar`);
      return mal;
    });
    revisa(!v.length, `ronda ${ronda}: dinero, folios, compras y cifrado cuadran en la base`, v.slice(0, 12));
    // Reportes contra la base.
    const desde = dia(-120), hasta = HOY;
    const [, gen] = await pedir('GET', `/generador?desde=${desde}&hasta=${hasta}`, A), [, tab] = await pedir('GET', `/tablero?desde=${desde}&hasta=${hasta}`, A);
    const subGen = Math.round((gen.totales?.subtotal ?? 0) * 100), ventaTab = Math.round((tab.actual?.venta ?? 0) * 100), porSuc = Math.round((tab.por_sucursal || []).reduce((t, x) => t + x.venta * 100, 0));
    revisa(subGen === ventaTab && (!tab.por_sucursal?.length || porSuc === ventaTab), `ronda ${ronda}: Generador = Resultados = suma por sucursal`, { subGen, ventaTab, porSuc });
    const [, cart] = await pedir('GET', '/finanzas/cartera?filtro=todas', A), lista = Array.isArray(cart) ? cart : cart.ordenes || [];
    const malCart = leerBase(d => lista.filter(c => { const l = d.prepare('SELECT * FROM leads WHERE id = ?').get(c.lead_id); if (!l) return true; const total = l.factura_total_cent ?? (Math.round(Number(l.valor || 0) * 100) + (l.iva_cent || 0)); const cob = d.prepare('SELECT COALESCE(SUM(monto_cent),0) t FROM cobros WHERE lead_id = ? AND cancelado = 0').get(l.id).t; return l.ejecucion !== 'no_realizado' && Math.round(c.saldo * 100) !== Math.max(0, total - cob); }).map(c => c.lead_id));
    revisa(!malCart.length, `ronda ${ronda}: el saldo de cada orden en la cartera = total − cobrado`, malCart.slice(0, 8));
    const [, integ] = await pedir('GET', '/admin/integridad', A);
    revisa(integ.errores === 0, `ronda ${ronda}: la revisión de integridad del sistema no encuentra errores`, (integ.resultados || []).filter(r => r.gravedad === 'error' && r.total).map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2))));
  }

  // ---------- Casos fijos de lo que esta simulación encontró (para que no regresen) ----------
  {
    const cl = (await pedir('POST', '/contactos', ACT.v1.token, { nombre: 'Hallazgo Costos Ligados', telefono: '4429876543', empresa_contacto: 'Planta Hallazgo SA de CV', direccion: 'Parque Industrial', canal_origen_id: canales[0].id }))[1];
    const [, l] = await pedir('POST', '/leads', ACT.v1.token, { cliente_id: cl.id, direccion: 'Planta', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: ACT.v1.id, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 5000 }]), iva_modo: 'mas_iva', valor: 1 });
    let x = await leer(l.id); await pedir('PUT', '/leads/' + l.id, A, { version: x.version, estatus: 'ganado', fecha_servicio: HOY });
    const [, g] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: provs[0].id, categoria: 'combustible', concepto: 'Diesel de la orden hallazgo', total: 800, fecha_documento: HOY, dias_credito: 0, lead_id: l.id });
    x = await leer(l.id); [s, j] = await pedir('PUT', '/leads/' + l.id, A, { version: x.version, estatus: 'perdido', motivo_perdida: 'Prueba de costos ligados' });
    revisa(s === 409 && j.codigo === 'TIENE_COSTOS', 'una orden con gastos de proveedores ligados no se puede descartar (antes quedaban colgados)', [s, j]);
    x = await leer(l.id); [s, j] = await pedir('PUT', '/leads/' + l.id, A, { version: x.version, estatus: 'abierto' });
    revisa(s === 409, 'ni regresar a cotización', [s, j.error]);
    await pedir('POST', '/finanzas/cxp/' + g.id + '/cancelar', A, { motivo: 'Se capturó en la orden equivocada' });
    x = await leer(l.id); [s] = await pedir('PUT', '/leads/' + l.id, A, { version: x.version, estatus: 'perdido', motivo_perdida: 'Prueba de costos ligados' });
    revisa(s === 200, 'con el gasto cancelado, ya se puede descartar', s);
  }

  // ---------- Rondas ----------
  const conteo = {};
  for (let ronda = 1; ronda <= RONDAS; ronda++) {
    for (let i = 0; i < OPS; i++) { const op = uno(BOLSA); conteo[op] = (conteo[op] || 0) + 1; await OPERACIONES[op](); if (quizas(0.12)) await ataque(); if (quizas(0.06)) await ataqueRol(); }
    await rafagas(); await basura(); await barridoFugas(); await cuadra(ronda);
    console.log(`Ronda ${ronda}: ${REG.leads.length} cotizaciones/órdenes, ${REG.cobros.length} cobros, ${REG.cxp.length} cuentas por pagar, ${REG.pagos.length} pagos, ${REG.sols.length} solicitudes, ${REG.ocs.length} órdenes de compra · ${peticiones} peticiones · ${malos.length} fallas`);
  }
  revisa(!errores500.length, 'ninguna petición provocó un error interno del servidor (500)', errores500.slice(0, 10));
  const internos = salida.split('\n').filter(l => /Error en |no manejado|uncaught|unhandledRejection/i.test(l));
  revisa(!internos.length, 'el registro del servidor no tiene errores internos', internos.slice(0, 10));
  console.log('Operaciones intentadas: ' + Object.entries(conteo).map(([k, v]) => k + ' ' + v).join(', '));
  console.log(`\n${n - malos.length}/${n} correctas · semilla ${SEMILLA}`);
  if (malos.length) { console.log('FALLARON:\n - ' + [...new Set(malos)].join('\n - ')); process.exitCode = 1; }
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
})().catch(e => { console.error('ERROR', e); console.error(salida.slice(-2000)); srv.kill(); process.exit(1); });
