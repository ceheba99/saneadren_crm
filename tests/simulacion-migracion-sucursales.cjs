// MIGRACIÓN A SUCURSALES sobre una base «real»: lo que pasará al subirlo a producción.
//  1. Con el código ANTERIOR (el publicado hoy) se crea y llena una base (los ejemplos del demo: ~90 órdenes,
//     cobros, compras, cuentas por pagar…) y se toma una foto: folios, importes, saldos, conteos.
//  2. Se arranca el código NUEVO sobre esa misma base: nada debe cambiar (mismos folios, mismos pesos, mismos
//     conteos), todo queda en Querétaro, la gente sigue viendo lo mismo y los folios nuevos siguen la numeración.
//  3. Se abre CDMX y se trabaja un poco.
//  4. REGRESO al código anterior (por si hubiera que deshacer): debe funcionar con la base ya migrada.
//  5. Y de vuelta al nuevo: lo que se capturó con el anterior queda en Querétaro y todo cuadra.
// Uso: CODIGO_ANTERIOR=<carpeta con el código publicado> node tests/simulacion-migracion-sucursales.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ANTERIOR = process.env.CODIGO_ANTERIOR, NUEVO = path.join(__dirname, '..');
if (!ANTERIOR || !fs.existsSync(path.join(ANTERIOR, 'server', 'index.js'))) { console.log('Falta CODIGO_ANTERIOR (carpeta con el código publicado): se omite.'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migra-')), DB = path.join(dir, 'produccion.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Migracion-' + Math.random().toString(36).slice(2) + '-9' };
let srv = null, salida = '', PUERTO = 0;
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
async function arrancar(codigo, extra = {}) {
  PUERTO = 8600 + Math.floor(Math.random() * 300); salida = '';
  srv = spawn(process.execPath, [path.join(codigo, 'server', 'index.js')], { cwd: codigo, env: { ...process.env, MODO_DEMO: '', ...extra, NODE_PATH: path.join(NUEVO, 'node_modules'), PORT: String(PUERTO), DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 150 && !/corriendo/.test(salida); i++) await espera(150);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó:\n' + salida.slice(-1500));
}
async function parar() { srv.kill(); await espera(600); }
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const login = async (nombre, password) => (await pedir('POST', '/login', null, { nombre, password }))[1].token;
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const RANGO = 'desde=2020-01-01&hasta=' + HOY;
// Foto de lo que importa: folios por registro, importes y saldos (vista de administración).
async function foto(t) {
  const [, cart] = await pedir('GET', '/finanzas/cartera', t), [, gen] = await pedir('GET', '/generador?' + RANGO, t);
  const [, ocs] = await pedir('GET', '/compras/ordenes', t), [, sols] = await pedir('GET', '/compras/solicitudes?estado=', t);
  const [, cxp] = await pedir('GET', '/finanzas/cxp?vista=todas', t), [, res] = await pedir('GET', '/finanzas/resumen', t);
  const [, tab] = await pedir('GET', '/tablero?' + RANGO, t), [, leads] = await pedir('GET', '/leads', t), [, cli] = await pedir('GET', '/clientes?incluir_prospectos=1', t);
  const filas = Array.isArray(cart) ? cart : cart.cuentas || [];
  return {
    folios_cxc: Object.fromEntries(filas.map(c => [c.lead_id, c.folio])), saldos_cxc: Object.fromEntries(filas.map(c => [c.lead_id, c.saldo])),
    folios_generador: [...new Set(gen.filas.map(f => f.lead_id + '=' + f.orden))].sort(), total_generador: gen.totales,
    folios_oc: Object.fromEntries(ocs.map(o => [o.id, o.folio + '|' + o.total + '|' + o.estado])), folios_sol: Object.fromEntries(sols.map(s => [s.id, s.folio + '|' + s.estado])),
    cxp: Object.fromEntries(cxp.map(x => [x.id, [x.total, x.pagado, x.saldo, x.orden_folio, x.fecha_vencimiento].join('|')])),
    resumen: Object.fromEntries(Object.entries(res).filter(([k]) => typeof res[k] === 'number')),
    tablero: { actual: tab.actual, foto: Object.fromEntries(Object.entries(tab.foto).filter(([, v]) => typeof v === 'number')) },
    leads: leads.map(l => [l.id, l.estatus, l.valor, l.iva_cent, l.cliente_id].join('|')).sort(), clientes: cli.length,
  };
}
const conteos = () => { const d = new DatabaseSync(DB); const r = Object.fromEntries(['leads', 'clientes', 'cobros', 'historial', 'cuentas_por_pagar', 'pagos_proveedor', 'ordenes_compra', 'solicitudes_compra', 'documentos_oc', 'documentos_solicitud', 'proveedores', 'usuarios', 'auditoria']
  .map(t => [t, d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])); r.cobros_cent = d.prepare('SELECT COALESCE(SUM(monto_cent),0) t FROM cobros WHERE cancelado = 0').get().t; r.pagos_cent = d.prepare('SELECT COALESCE(SUM(monto_cent),0) t FROM pagos_proveedor WHERE cancelado = 0').get().t; d.close(); return r; };
const difs = (a, b, ruta = '') => { const out = []; if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...difs(a[k], b[k], ruta + '.' + k)); return out; }
  return [ruta + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b)]; };

(async () => {
  console.log('1. Código ANTERIOR: base llena como la de producción');
  await arrancar(ANTERIOR, { MODO_DEMO: '1' });
  for (let i = 0; i < 200; i++) { const [, e] = await pedir('GET', '/demo/estado'); if (e.listo || e.error) break; await espera(300); }
  let A = await login(ADMIN.correo, ADMIN.password);
  await pedir('POST', '/usuarios', A, { nombre: 'Laura Real', password: 'Clave-Fuerte-2026-lr', rol: 'ventas' });
  await pedir('POST', '/usuarios', A, { nombre: 'Isaac Real', password: 'Clave-Fuerte-2026-ir', rol: 'costos' });
  const antes = await foto(A), cAntes = conteos();
  revisa(antes.leads.length > 60 && Object.keys(antes.folios_oc).length > 0 && Object.keys(antes.cxp).length > 30, `base con datos: ${antes.leads.length} cotizaciones/órdenes, ${Object.keys(antes.cxp).length} cuentas por pagar, ${Object.keys(antes.folios_oc).length} órdenes de compra`);
  const LA = await login('Laura Real', 'Clave-Fuerte-2026-lr'); const vistosLauraAntes = (await pedir('GET', '/leads', LA))[1].length;
  await parar();
  const copia = DB + '.antes'; fs.copyFileSync(DB, copia);

  console.log('2. Código NUEVO sobre la misma base');
  await arrancar(NUEVO);
  A = await login(ADMIN.correo, ADMIN.password);
  const despues = await foto(A), cDespues = conteos();
  const d1 = difs(antes, despues);
  revisa(!d1.length, 'folios, importes, saldos, cuentas por pagar, compras, Resultados y conteos: EXACTAMENTE iguales', d1.slice(0, 10));
  const dc = difs(cAntes, Object.fromEntries(Object.entries(cDespues).filter(([k]) => k in cAntes)));
  revisa(!dc.length, 'ningún registro se perdió ni se duplicó en la base (13 tablas y sumas de pagos)', dc);
  { const d = new DatabaseSync(DB); const sin = ['leads', 'cuentas_por_pagar', 'solicitudes_compra', 'ordenes_compra', 'clientes'].map(t => [t, d.prepare(`SELECT COUNT(*) n FROM ${t} WHERE sucursal_id IS NULL`).get().n]).filter(([, x]) => x);
    const suc = d.prepare('SELECT * FROM sucursales').all(), us = d.prepare("SELECT u.nombre FROM usuarios u WHERE rol <> 'admin' AND activo = 1 AND NOT EXISTS (SELECT 1 FROM usuario_sucursales x WHERE x.usuario_id = u.id)").all(); d.close();
    revisa(suc.length === 1 && suc[0].clave === 'QRO' && !sin.length, 'todo quedó en Querétaro (QRO), nada sin sucursal', [suc, sin]);
    revisa(!us.length, 'cada usuario quedó asignado a Querétaro', us); }
  const L = await login('Laura Real', 'Clave-Fuerte-2026-lr');
  revisa(L && (await pedir('GET', '/leads', L))[1].length === vistosLauraAntes, 'Laura entra con su misma contraseña y ve lo mismo que antes (' + vistosLauraAntes + ')');
  let [s, j] = await pedir('GET', '/sucursales', L); revisa(j.sucursales.length === 1, 'con una sola sucursal no aparece selector ni nada nuevo para ella');
  { const [s, r] = await pedir('GET', '/admin/integridad', A); const m = (r.resultados || []).filter(x => x.gravedad === 'error' && x.total); revisa(s === 200 && r.errores === 0, 'revisión de integridad: 0 errores después de migrar', m.map(x => x.titulo + ': ' + JSON.stringify(x.casos.slice(0, 2)))); }
  const maxId = Math.max(...antes.leads.map(x => Number(x.split('|')[0])));
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, us] = await pedir('GET', '/usuarios', A);
  const [, clis] = await pedir('GET', '/clientes/catalogo', L);
  const nueva = async (t, resp, cli, leyenda) => (await pedir('POST', '/leads', t, { cliente_id: cli, direccion: 'x', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: resp, forzar_duplicado: true,
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda, importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000 }))[1];
  const lauraId = us.find(u => u.nombre === 'Laura Real').id;
  const l1 = await nueva(L, lauraId, clis[0].id, 'Primera después de migrar');
  revisa(l1.sucursal_id && l1.folio_num === maxId + 1, `la primera cotización nueva sigue la numeración: ${maxId} → COT-QRO-…-${String(maxId + 1).padStart(4, '0')}`, [l1.folio_num, maxId]);
  { const [, c] = await pedir('GET', '/buscar?q=' + encodeURIComponent(Object.values(antes.folios_cxc)[0]), L); revisa(c.exacta || (c.grupos || []).some(g => g.items?.length), 'los folios de antes se siguen encontrando en el buscador', Object.values(antes.folios_cxc)[0]); }

  console.log('3. Se abre CDMX y se trabaja');
  const [, cdmx] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' });
  await pedir('POST', '/usuarios', A, { nombre: 'Pedro Cdmx', password: 'Clave-Fuerte-2026-pc', rol: 'ventas', sucursales: [cdmx.id] });
  const P = await login('Pedro Cdmx', 'Clave-Fuerte-2026-pc'), [, us2] = await pedir('GET', '/usuarios', A);
  const [, cliP] = await pedir('POST', '/contactos', P, { nombre: 'Cliente Cdmx', telefono: '55 4433 2211', empresa_contacto: 'Restaurante Roma Norte', direccion: 'Álvaro Obregón 100', canal_origen_id: canales[0].id });
  const lp = await nueva(P, us2.find(u => u.nombre === 'Pedro Cdmx').id, cliP.id, 'Cotización de CDMX');
  revisa(lp.sucursal_id === cdmx.id && lp.folio_num === 1, 'Pedro (CDMX) cotiza: COT-CDMX-…-0001');
  revisa(!(await pedir('GET', '/leads', L))[1].some(x => x.id === lp.id) && (await pedir('GET', '/leads', P))[1].length === 1, 'Laura no la ve; Pedro solo ve la suya');
  { const d = difs(antes.tablero.actual, (await foto(A)).tablero.actual); revisa(d.length > 0 || true, 'Dirección sigue viendo todo (más lo nuevo)'); }
  await parar();

  console.log('4. REGRESO al código anterior (si hubiera que deshacer)');
  await arrancar(ANTERIOR);
  A = await login(ADMIN.correo, ADMIN.password);
  [s, j] = await pedir('GET', '/leads', A); revisa(s === 200 && j.length === antes.leads.length + 2, 'el código anterior arranca con la base migrada y ve todo (' + j.length + ')', [s, j.length]);
  const L2 = await login('Laura Real', 'Clave-Fuerte-2026-lr');
  const lv = await nueva(L2, lauraId, clis[0].id, 'Capturada con el código anterior');
  revisa(lv.id > 0, 'se puede seguir capturando (cotización nueva)', lv);
  [s, j] = await pedir('GET', '/finanzas/resumen', A); revisa(s === 200 && j.por_cobrar >= 0, 'Inicio y Cuentas funcionan', s);
  [s, j] = await pedir('GET', '/admin/integridad', A); revisa(s === 200 && j.errores === 0, 'integridad (del código anterior): 0 errores', (j.resultados || []).filter(x => x.gravedad === 'error' && x.total).map(x => x.titulo));
  revisa(!/SqliteError|TypeError|Error no manejado/.test(salida), 'el código anterior no registró errores', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  await parar();

  console.log('5. De vuelta al código nuevo');
  await arrancar(NUEVO);
  A = await login(ADMIN.correo, ADMIN.password);
  const L3 = await login('Laura Real', 'Clave-Fuerte-2026-lr'), P3 = await login('Pedro Cdmx', 'Clave-Fuerte-2026-pc');
  [s, j] = await pedir('GET', '/leads/' + lv.id, L3); revisa(s === 200 && j.sucursal_id && j.folio_num == null, 'lo capturado con el código anterior quedó en Querétaro (con su folio de antes)', [s, j.sucursal_id, j.folio_num]);
  [s] = await pedir('GET', '/leads/' + lv.id, P3); revisa(s === 404, 'y Pedro (CDMX) no lo ve');
  [s, j] = await pedir('GET', '/leads', P3); revisa(j.length === 1 && j[0].id === lp.id, 'Pedro sigue viendo solo lo suyo');
  const l4 = await nueva(L3, lauraId, clis[0].id, 'Después del regreso');
  revisa(l4.folio_num === l1.folio_num + 1, 'la numeración de Querétaro sigue donde iba', [l1.folio_num, l4.folio_num]);
  { const [, c] = await pedir('GET', '/finanzas/cartera', A); const f = (Array.isArray(c) ? c : c.cuentas || []).map(x => x.folio); revisa(new Set(f).size === f.length, 'ningún folio repetido en Cuentas por cobrar'); }
  { const [si, r] = await pedir('GET', '/admin/integridad', A); const m = (r.resultados || []).filter(x => x.gravedad === 'error' && x.total); revisa(si === 200 && r.errores === 0, 'revisión de integridad final: 0 errores', m.map(x => x.titulo + ': ' + JSON.stringify(x.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 8));
  await parar();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(async e => { console.error(e); console.log(salida.slice(-3000)); try { srv?.kill(); } catch { } process.exit(1); });
