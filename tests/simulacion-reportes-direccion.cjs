// REPORTES DE DIRECCIÓN (2026-11-11, aprobado por Dirección): cumplimiento (cobrado y pagado a tiempo, servicios en su
// fecha, satisfacción), ranking por vendedor, metas con semáforo (solo Dirección las pone), indicadores del Análisis
// comercial con lo que ve cada quien, y el reporte del mes por correo a Dirección.
// Uso: node tests/simulacion-reportes-direccion.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-reportes-')), DB = path.join(dir, 'r.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Reportes-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Reportes-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9750 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const RANGO = `desde=${dia(-40)}&hasta=${HOY}`;

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const ID = {};
  const usuario = async (nombre, rol) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }), nombre); const u = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); ID[nombre] = u.id; return u.token; };
  const G = await usuario('Gema Gerente', 'gerente'), V = await usuario('Valeria Ventas', 'ventas'), B = await usuario('Bruno Ventas', 'ventas'), T = await usuario('Tomas Tecnico', 'tecnico');
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  // Dos órdenes: la de Valeria se hizo en su fecha y se cobró a tiempo; la de Bruno se hizo tarde y se cobró tarde.
  const orden = async (quien, tel, fechaServ, fechaReal, importe) => {
    const cli = exigir(await pedir('POST', '/contactos', A, { nombre: quien === 'Valeria Ventas' ? 'Hotel Amanecer' : 'Planta Zafiro', telefono: tel, canal_origen_id: canal.id }), 'cliente');
    const l = exigir(await pedir('POST', '/leads', A, { cliente_id: cli.cliente_id || cli.id, direccion: 'Planta', canal_id: canal.id, servicio_id: servicio.id, responsable_id: ID[quien], forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'x', importe }]), iva_modo: 'mas_iva', valor: importe }), 'cotización');
    { const d = new DatabaseSync(DB); d.prepare('UPDATE leads SET created_at = ?, fecha_cotizacion = ? WHERE id = ?').run(dia(-40) + ' 09:00:00', dia(-40), l.id); d.close(); }
    const o = exigir(await pedir('PUT', '/leads/' + l.id, A, { version: l.version, estatus: 'ganado', fecha_servicio: fechaServ }), 'orden');
    exigir(await pedir('POST', '/leads/' + o.id + '/ejecucion', A, { estado: 'realizado', fecha: fechaReal }), 'realizado');
    exigir(await pedir('PUT', '/leads/' + o.id + '/facturacion', A, { dias_credito: 0 }).then(r => (r[0] === 404 ? [200, {}] : r)), 'crédito');
    return o;
  };
  const oV = await orden('Valeria Ventas', '4425550201', dia(-10), dia(-10), 1000);
  const oB = await orden('Bruno Ventas', '4425550202', dia(-15), dia(-12), 2000);
  exigir(await pedir('POST', '/leads/' + oV.id + '/cobros', A, { monto: 1160, metodo: 'transferencia', fecha: dia(-10) }), 'cobro a tiempo');
  exigir(await pedir('POST', '/leads/' + oB.id + '/cobros', A, { monto: 2320, metodo: 'transferencia', fecha: dia(-2) }), 'cobro tarde');
  // Proveedores: uno pagado a tiempo y otro tarde.
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Proveedor Reportes', categoria: 'otro', dias_credito: 0 }), 'proveedor');
  const g1 = exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Material a tiempo', total: 500, fecha_documento: dia(-20), dias_credito: 10, tipo_comprobante: 'recibo' }), 'gasto 1');
  const g2 = exigir(await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'otro', concepto: 'Material tarde', total: 700, fecha_documento: dia(-20), dias_credito: 5, tipo_comprobante: 'recibo' }), 'gasto 2');
  exigir(await pedir('POST', '/finanzas/cxp/' + g1.id + '/pagos', A, { monto: 500, metodo: 'transferencia', fecha: dia(-12) }), 'pago a tiempo');
  exigir(await pedir('POST', '/finanzas/cxp/' + g2.id + '/pagos', A, { monto: 700, metodo: 'transferencia', fecha: dia(-3) }), 'pago tarde');
  // Encuesta contestada de la orden de Valeria (cliente contento).
  const tok = String((await pedir('GET', '/leads/' + oV.id + '/encuesta', A))[1].url).split('/e/')[1];
  const [, preg] = await pedir('GET', '/publico/encuesta/' + tok);
  exigir(await pedir('POST', '/publico/encuesta/' + tok, null, { aspectos: Object.fromEntries(preg.preguntas.aspectos.flatMap(m => m.items.map(i => [i.clave, 5]))), facturacion: 'si', nps: 10, preventivo: 'no' }), 'encuesta');

  console.log('1. Cumplimiento en el Panorama');
  let [s, r] = await pedir('GET', '/tablero?' + RANGO, G);
  revisa(s === 200 && r.cumplimiento, 'El Gerente ve el cumplimiento en el Panorama', s);
  const c = r.cumplimiento;
  revisa(c.cobranza.liquidadas === 2 && c.cobranza.a_tiempo === 1 && c.cobranza.pct === 50, 'Cobrado a tiempo: 1 de 2 órdenes liquidadas (50 %)', c.cobranza);
  revisa(c.pagos.liquidadas === 2 && c.pagos.a_tiempo === 1 && c.pagos.pct === 50, 'Pagado a tiempo a proveedores: 1 de 2 (50 %)', c.pagos);
  revisa(c.operacion.realizados === 2 && c.operacion.en_fecha === 1 && c.operacion.pct === 50, 'Servicios en su fecha: 1 de 2 (50 %)', c.operacion);
  revisa(c.satisfaccion?.encuestas === 1 && c.satisfaccion.nps === 100 && c.encuestas.contestadas === 1, 'Satisfacción: 1 encuesta, NPS 100, contestada', c.satisfaccion);
  const vv = r.vendedores.find(x => x.nombre === 'Valeria Ventas'), vb = r.vendedores.find(x => x.nombre === 'Bruno Ventas');
  revisa(vv && vb && vv.cobro_a_tiempo_pct === 100 && vb.cobro_a_tiempo_pct === 0 && vb.venta === 2000 && vv.satisfaccion === 5, 'Ranking por vendedor: Valeria cobra a tiempo (100 %, satisfacción 5); Bruno no (0 %), con más venta', r.vendedores);
  revisa(r.contabilidad && 'anticipos_abiertos' in r.contabilidad && 'banco_conciliado_pct' in r.contabilidad, 'Trae la caja de contabilidad (anticipos, nómina, banco)', r.contabilidad);

  console.log('2. Metas');
  revisa((await pedir('PUT', '/tablero/metas', G, { mes: HOY.slice(0, 7), metas: { venta: 1000 } }))[0] === 403, 'El Gerente no pone metas');
  revisa((await pedir('PUT', '/tablero/metas', A, { mes: HOY.slice(0, 7), metas: { cobro_a_tiempo_pct: 150 } }))[0] === 400, 'Un porcentaje mayor a 100 se rechaza');
  revisa((await pedir('PUT', '/tablero/metas', A, { mes: HOY.slice(0, 7), metas: { inventado: 1 } }))[0] === 400, 'Un indicador que no existe se rechaza');
  const meses = [...new Set([dia(-40).slice(0, 7), dia(-20).slice(0, 7), HOY.slice(0, 7)])];
  for (const m of meses) exigir(await pedir('PUT', '/tablero/metas', A, { mes: m, metas: { venta: 1000000, servicios_en_fecha_pct: 50, cobro_a_tiempo_pct: 54, nps: 50 } }), 'metas ' + m);
  r = exigir(await pedir('GET', '/tablero?' + RANGO, G), 'panorama con metas');
  const ind = k => r.metas.indicadores.find(i => i.clave === k);
  revisa(ind('venta').semaforo === 'rojo' && ind('venta').meta > 1000000 && ind('venta').meta < 1000000 * meses.length && r.metas.proporcional, 'Venta muy debajo de la meta: rojo (las de dinero se suman por mes, en proporción a los días del periodo)', ind('venta'));
  { const m1 = exigir(await pedir('GET', `/tablero?desde=${HOY.slice(0, 7)}-01&hasta=${HOY}`, G), 'este mes').metas, [y, mo] = HOY.split('-').map(Number), dias = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    revisa(Math.abs(m1.indicadores.find(i => i.clave === 'venta').meta - Math.round(1000000 * Number(HOY.slice(8)) / dias * 100) / 100) < 0.02 && m1.crudos.venta === 1000000, 'A medio mes, la meta de venta es la parte proporcional de los días que van (y se guarda la del mes completo)', m1.indicadores.find(i => i.clave === 'venta')); }
  revisa(ind('servicios_en_fecha_pct').semaforo === 'verde', 'Servicios en fecha 50 % con meta 50 %: verde', ind('servicios_en_fecha_pct'));
  revisa(ind('cobro_a_tiempo_pct').semaforo === 'ambar', 'Cobrado a tiempo 50 % con meta 54 %: ámbar (90 % o más de la meta)', ind('cobro_a_tiempo_pct'));
  revisa(ind('nps').semaforo === 'verde' && ind('margen_pct').semaforo === null, 'NPS 100 con meta 50: verde; sin meta de margen: sin semáforo');
  revisa(!r.metas.puede_editar && exigir(await pedir('GET', '/tablero?' + RANGO, A), 'panorama Dirección').metas.puede_editar, 'Solo Dirección ve el botón para editar metas');
  revisa(exigir(await pedir('GET', '/tablero/metas?mes=' + HOY.slice(0, 7), G), 'metas').indicadores.find(i => i.clave === 'nps').valor === 50, 'El Gerente ve las metas del mes');
  revisa((await pedir('GET', '/tablero/metas', V))[0] === 403, 'Ventas no ve las metas');

  console.log('3. Indicadores del Análisis comercial');
  revisa((await pedir('GET', '/analisis/indicadores?' + RANGO, T))[0] === 403, 'El técnico no ve el análisis comercial');
  const iV = exigir(await pedir('GET', '/analisis/indicadores?' + RANGO, V), 'indicadores Valeria'), iB = exigir(await pedir('GET', '/analisis/indicadores?' + RANGO, B), 'indicadores Bruno'), iG = exigir(await pedir('GET', '/analisis/indicadores?' + RANGO, G), 'indicadores Gerente');
  revisa(iV.satisfaccion.encuestas === 1 && iB.satisfaccion.encuestas === 0 && iG.satisfaccion.encuestas === 1, 'Satisfacción: Valeria ve su encuesta; Bruno no ve la de Valeria', [iV.satisfaccion.encuestas, iB.satisfaccion.encuestas]);
  revisa(iV.operacion.realizados === 1 && iB.operacion.realizados === 1 && iG.operacion.realizados === 2, 'Servicios en fecha: cada vendedor ve los suyos; el Gerente, los dos');
  revisa(iV.cobranza?.liquidadas === 1 && iV.cobranza.pct === 100 && iB.cobranza?.pct === 0, 'Cobrado a tiempo: con la cobranza de sus órdenes', [iV.cobranza, iB.cobranza]);
  revisa(!('pagos' in iV) && !JSON.stringify(iV).includes('Proveedor Reportes'), 'En el análisis comercial no hay cuentas por pagar');
  revisa(!JSON.stringify(iB).includes('Valeria'), 'Bruno no ve el nombre de Valeria en sus indicadores');

  console.log('4. Reporte por correo');
  revisa((await pedir('POST', '/tablero/enviar-reporte', G, {}))[0] === 403, 'El Gerente no manda el reporte por correo');
  [s, r] = await pedir('POST', '/tablero/enviar-reporte', A, {});
  revisa(s === 409 && /no está configurado/.test(r.error), 'Sin correo configurado, Dirección recibe un aviso claro (no truena)', r);
  [s, r] = await pedir('GET', '/tablero/reporte-correo?mes=' + HOY.slice(0, 7), A);
  revisa(s === 200 && /Reporte de Dirección/.test(r.asunto) && /Cobrado a tiempo: 50 %/.test(r.mensaje) && /Metas del mes/.test(r.mensaje) && r.correo_configurado === false && r.destinatarios.length >= 1,
    'Vista previa del correo: trae el cumplimiento y las metas del mes, y a quién le llegaría', r);
  revisa((await pedir('GET', '/tablero/reporte-correo', G))[0] === 403, 'El Gerente no ve la vista previa del correo');
  revisa(!/TypeError|SqliteError|Error no manejado|reporte mensual\] no se pudo/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(x => /Error/.test(x)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
