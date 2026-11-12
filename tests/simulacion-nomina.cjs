// MÓDULO CONTABLE F3 (2026-11-11, aprobado por Dirección): NÓMINA SEMANAL.
// Dos sueldos semanales en la ficha (IMSS y bono, cifrados); la nómina de la semana se prepara con ellos y el tiempo
// extra del checador; las faltas solo se reportan (el descuento lo pone RH a mano, con nota); el neto del IMSS lo da el
// contador; se cierra, Dirección la puede reabrir, se paga (gasto de «Sueldos» pagado) y se baja la lista para el banco.
// Uso: node tests/simulacion-nomina.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-nomina-')), DB = path.join(dir, 'n.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Nomina-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Nomina-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9550 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), MES = HOY.slice(0, 7);
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/roles', A, { nombre: 'Contador', base: '' }), 'rol Contador');
  const rolCont = (await pedir('GET', '/roles', A))[1].find(r => r.nombre === 'Contador').clave;
  exigir(await pedir('PUT', '/roles/' + rolCont + '/permisos', A, { permisos: ['contabilidad.ver', 'nomina.preparar'] }), 'permisos del contador');
  const usuario = async (nombre, rol) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }), nombre); return exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token; };
  const G = await usuario('Gema Gerente', 'gerente'), V = await usuario('Valeria Ventas', 'ventas'), Cm = await usuario('Carlos Compras', 'costos'), C = await usuario('Carmen Contadora', rolCont);
  const ficha = (nombre, extra) => exigir(pedir('POST', '/personal', A, { nombre, puesto: 'Operador', sucursal_id: qro.id, ...extra }).then(r => r), 'ficha ' + nombre);
  const ana = exigir(await pedir('POST', '/personal', A, { nombre: 'Ana Operadora', puesto: 'Operador', sucursal_id: qro.id, sueldo_imss_semanal: 2000, bono_semanal: 500, clabe: '012180555888222117', banco: 'BBVA' }), 'ficha Ana');
  const beto = exigir(await pedir('POST', '/personal', A, { nombre: 'Beto Ayudante', puesto: 'Ayudante', sucursal_id: qro.id, bono_semanal: 700 }), 'ficha Beto');
  const carla = exigir(await pedir('POST', '/personal', A, { nombre: 'Carla Sin Sueldo', puesto: 'Operador', sucursal_id: qro.id }), 'ficha Carla');
  void ficha;

  console.log('1. Sueldos en la ficha');
  { const d = new DatabaseSync(DB); const f = d.prepare('SELECT sueldo_imss_semanal_cent s, bono_semanal_cent b FROM personal WHERE id = ?').get(ana.id); d.close();
    revisa(String(f.s).startsWith('enc1:') && String(f.b).startsWith('enc1:'), 'Los dos sueldos se guardan cifrados en la base', f); }
  let [s, r] = await pedir('GET', '/personal/' + ana.id, A);
  revisa(s === 200 && r.sueldo_imss_semanal === 2000 && r.bono_semanal === 500, 'Dirección ve los dos sueldos en la ficha', { a: r.sueldo_imss_semanal, b: r.bono_semanal });
  [s, r] = await pedir('GET', '/personal/' + ana.id, V);
  revisa(!('sueldo_imss_semanal' in (r || {})) && !('bono_semanal' in (r || {})) && !JSON.stringify(r).includes('enc1:'), 'Quien no ve datos sensibles no recibe los sueldos', s);
  revisa((await pedir('PUT', '/personal/' + ana.id, A, { version: (await pedir('GET', '/personal/' + ana.id, A))[1].version, bono_semanal: -5 }))[0] === 400, 'Un bono negativo se rechaza');

  console.log('2. Quién ve la nómina');
  const SEM = '/nomina?desde=' + dia(-7) + '&sucursal=' + qro.id;
  revisa((await pedir('GET', SEM, V))[0] === 403, 'Ventas no la ve');
  revisa((await pedir('GET', SEM, Cm))[0] === 403, 'Compras (mueve dinero, sin ver sueldos) no la ve');
  [s, r] = await pedir('GET', SEM, G);
  revisa(s === 200 && r.estado === 'sin_preparar' && r.lineas.length === 3, 'El Gerente ve la propuesta: Ana, Beto y Carla (checa)', r.lineas?.map(l => l.nombre));
  revisa(r.lineas.find(l => /Carla/.test(l.nombre))?.pendientes.some(x => /Sin sueldo semanal/.test(x)), 'Carla checa pero no tiene sueldo semanal: sale como pendiente');
  revisa((await pedir('GET', SEM, C))[0] === 200, 'El Contador (con «Preparar la nómina») la ve');

  console.log('3. Preparar y capturar');
  const nom = exigir(await pedir('POST', '/nomina/preparar', G, { desde: dia(-7), sucursal_id: qro.id }), 'preparar');
  revisa(nom.estado === 'abierta' && nom.lineas.length === 3, 'Preparada: queda abierta con tres líneas');
  revisa(exigir(await pedir('POST', '/nomina/preparar', G, { desde: dia(-7), sucursal_id: qro.id }), 'preparar otra vez').id === nom.id, 'Preparar dos veces la misma semana no la duplica');
  const lAna = nom.lineas.find(l => /Ana/.test(l.nombre)), lBeto = nom.lineas.find(l => /Beto/.test(l.nombre));
  revisa(lAna.falta_neto && !lBeto.falta_neto, 'Ana (tiene sueldo IMSS) espera el neto del contador; Beto (solo bono) no');
  [s, r] = await pedir('POST', '/nomina/' + nom.id + '/cerrar', G, {});
  revisa(s === 409 && r.codigo === 'FALTA_NETO' && /Ana/.test(r.error), 'Sin el neto del IMSS no se cierra', r);
  revisa((await pedir('PUT', '/nomina/lineas/' + lAna.id, G, { descuento: 100 }))[0] === 400, 'Un descuento sin nota se rechaza');
  revisa((await pedir('PUT', '/nomina/lineas/' + lAna.id, G, { neto_imss: 2500 }))[0] === 400, 'Un neto mayor que el sueldo IMSS se rechaza');
  revisa((await pedir('PUT', '/nomina/lineas/' + lBeto.id, G, { descuento: 800, descuento_nota: 'Prueba' }))[0] === 400, 'Un descuento que deja el total negativo se rechaza');
  revisa((await pedir('PUT', '/nomina/lineas/' + lAna.id, C, { neto_imss: 1800 }))[0] === 200, 'El Contador captura el neto del IMSS de Ana');
  exigir(await pedir('PUT', '/nomina/lineas/' + lAna.id, G, { descuento: 100, descuento_nota: 'Falta del martes (decidió RH)', otros: 50, otros_nota: 'Bono de puntualidad' }), 'descuento y otros');
  r = exigir(await pedir('GET', SEM, G), 'ver');
  revisa(r.lineas.find(l => /Ana/.test(l.nombre)).total === 2250 && r.lineas.find(l => /Beto/.test(l.nombre)).total === 700 && r.totales.total === 2950,
    'Totales: Ana 1,800 neto + 500 bono + 50 − 100 = 2,250; Beto 700 (Carla todavía sin sueldo)', r.totales);

  console.log('4. Cerrar y reabrir');
  [s, r] = await pedir('POST', '/nomina/' + nom.id + '/cerrar', G, {});
  revisa(s === 409 && r.codigo === 'PENDIENTES' && /Carla/.test(r.error) && !r.puede_forzar, 'Con pendientes (Carla sin sueldo) el Gerente no la cierra', r);
  // RH le captura el sueldo a Carla y su neto del IMSS: se vuelve a leer la ficha.
  exigir(await pedir('PUT', '/personal/' + carla.id, A, { version: (await pedir('GET', '/personal/' + carla.id, A))[1].version, sueldo_imss_semanal: 1500 }), 'sueldo de Carla');
  { const rr = exigir(await pedir('POST', '/nomina/' + nom.id + '/actualizar', G, {}), 'actualizar'); const lc = rr.lineas.find(l => /Carla/.test(l.nombre));
    revisa(lc.sueldo_imss === 1500 && !lc.pendientes.length && rr.lineas.find(l => /Ana/.test(l.nombre)).neto_imss === 1800, '«Actualizar» lee el sueldo nuevo de Carla y conserva lo capturado (el neto de Ana)', lc);
    exigir(await pedir('PUT', '/nomina/lineas/' + lc.id, C, { neto_imss: 1400 }), 'neto de Carla'); }
  revisa((await pedir('POST', '/nomina/' + nom.id + '/cerrar', G, {}))[0] === 200, 'Con todo capturado, el Gerente la cierra');
  revisa((await pedir('PUT', '/nomina/lineas/' + lAna.id, G, { otros: 999, otros_nota: 'Cambio tardío' }))[0] === 409, 'Cerrada ya no se cambia');
  revisa((await pedir('POST', '/nomina/' + nom.id + '/reabrir', G, { motivo: 'Faltó un bono' }))[0] === 403, 'El Gerente no la reabre');
  revisa((await pedir('POST', '/nomina/' + nom.id + '/reabrir', A, { motivo: 'Faltó un bono de Beto' }))[0] === 200, 'Dirección la reabre con motivo');
  exigir(await pedir('POST', '/nomina/' + nom.id + '/cerrar', A, {}), 'cerrar otra vez');

  console.log('5. Lista para el banco y pago');
  revisa((await pedir('GET', '/nomina/' + nom.id + '/lista-banco', C))[0] === 403, 'El Contador (no mueve dinero) no baja la lista con las CLABE');
  revisa((await pedir('POST', '/nomina/' + nom.id + '/pagar', C, { metodo: 'layout', cuenta_origen: 'Santander nómina' }))[0] === 403, 'El Contador no la paga');
  const [sl, , csv] = await pedir('GET', '/nomina/' + nom.id + '/lista-banco', G);
  revisa(sl === 200 && csv.includes('012180555888222117') && /Ana Operadora.*2250\.00/.test(csv) && /Beto Ayudante.*700\.00.*SIN CLABE/.test(csv), 'El Gerente baja la lista: Ana con su CLABE y Beto marcado «SIN CLABE»', csv.slice(0, 300));
  revisa((await pedir('POST', '/nomina/' + nom.id + '/pagar', G, { metodo: 'vales', cuenta_origen: 'Santander' }))[0] === 400, 'Vía de pago inválida se rechaza');
  revisa((await pedir('POST', '/nomina/' + nom.id + '/pagar', G, { metodo: 'layout' }))[0] === 400, 'Sin cuenta de salida se rechaza');
  [s, r] = await pedir('POST', '/nomina/' + nom.id + '/pagar', G, { metodo: 'layout', cuenta_origen: 'Santander nómina', fecha: HOY });
  revisa(s === 200 && r.estado === 'pagada' && r.cxp_id, 'Se paga: queda «pagada» con su gasto', r);
  revisa((await pedir('POST', '/nomina/' + nom.id + '/pagar', G, { metodo: 'layout', cuenta_origen: 'Santander nómina' }))[0] === 409, 'No se paga dos veces');
  { const x = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(c => c.id === r.cxp_id);
    revisa(x && x.categoria === 'sueldos' && Math.abs(x.total - 4350) < 0.001 && x.saldo === 0, 'En Cuentas por pagar: gasto de «Sueldos» por $4,350 (con Carla), pagado', x && { cat: x.categoria, t: x.total, s: x.saldo }); }
  { const ex = exigir(await pedir('GET', '/contabilidad/excel?mes=' + MES, A), 'Excel del mes');
    revisa(!HOY.startsWith(MES) || ex.flujo.some(f => /Nómina \(sueldos\)/.test(f.beneficiario) && f.egreso === 4350 && f.cuenta_salida === 'Santander nómina'), 'Flujo de banco: sale el pago de la nómina desde «Santander nómina»'); }

  console.log('6. Avisos y candados');
  const av = (await pedir('GET', '/nomina/avisos', G))[1].avisos;
  revisa(!av.some(a => a.tipo === 'pagar'), 'Pagada: ya no sale «cerrada sin pagar»', av);
  revisa((await pedir('GET', '/nomina/avisos', V))[1].avisos.length === 0, 'A Ventas no le sale nada');
  { const d = new DatabaseSync(DB); let e1 = '', e2 = '';
    try { d.prepare('DELETE FROM nominas WHERE id = ?').run(nom.id); } catch (e) { e1 = e.message; }
    try { d.prepare('UPDATE nomina_lineas SET otros_cent = 1 WHERE nomina_id = ?').run(nom.id); } catch (e) { e2 = e.message; }
    d.close();
    revisa(/no se borran/.test(e1) && /no se cambia/.test(e2), 'La base no deja borrar ni cambiar una nómina pagada', [e1, e2]); }
  const integ = (await pedir('GET', '/admin/integridad', A))[1];
  revisa(integ.errores === 0, 'La revisión de integridad sigue sin errores', (integ.resultados || []).filter(x => x.gravedad === 'error' && x.total).map(x => x.titulo));
  revisa(!/TypeError|SqliteError|Error no manejado/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(x => /Error/.test(x)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
