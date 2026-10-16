// «¿Se realizó el servicio?»: Sí (con la fecha de la orden) o No (con motivo obligatorio) y, en ambos casos, los
// gastos generados del servicio (proveedor, categoría, concepto, monto con IVA, si ya se pagó) van a Cuentas por
// pagar con el número de la orden. Ya no se pregunta ni se muestra quién realizó el servicio.
// Uso: node tests/simulacion-servicio-realizado.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-real-')); const PUERTO = String(8700 + Math.floor(Math.random() * 200));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Realizado-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, us] = await pedir('GET', '/usuarios', A);
  const [, cli] = await pedir('POST', '/contactos', A, { nombre: 'Ing. Mariana Torres', telefono: '442 238 7700', empresa_contacto: 'Planta Norte', direccion: 'Parque Industrial', canal_origen_id: canales[0].id });
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas del Valle', categoria: 'renta_maquinaria', dias_credito: 15 });
  const orden = async (leyenda, fServ) => {
    const [, l] = await pedir('POST', '/leads', A, { cliente_id: cli.id, direccion: 'Planta', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: us[0].id, forzar_duplicado: true,
      partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda, importe: 9000 }]), iva_modo: 'mas_iva', valor: 9000, fecha_cotizacion: dia(-10) });
    const [, d] = await pedir('GET', '/leads/' + l.id, A); await pedir('PUT', '/leads/' + l.id, A, { version: d.version, estatus: 'ganado', fecha_servicio: fServ }); return l;
  };
  let s, j;

  console.log('1. Sí se realizó');
  const o1 = await orden('Retiro de agua residual', dia(-3));
  [s, j] = await pedir('POST', '/leads/' + o1.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-3), gastos: [{ proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Renta de pipa 20 m³', total: '5,800', ya_pagado: true, metodo: 'transferencia', fecha_pago: dia(-2) }] });
  revisa(s === 200 && j.lead.ejecucion === 'realizado' && j.lead.fecha_realizado === dia(-3) && j.gastos === 1, '«Sí» con la fecha de la orden y un gasto: queda realizado y el gasto cargado', [s, j.error || j.lead?.ejecucion]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A); const g1 = j.find(x => x.lead_id === o1.id);
  revisa(g1 && g1.concepto === 'Renta de pipa 20 m³' && g1.total === 5800 && g1.saldo === 0 && g1.orden_folio && /^OS-/.test(g1.orden_folio), 'el gasto queda en Cuentas por pagar con el número de la orden, pagado', g1);
  [s, j] = await pedir('GET', '/leads/' + o1.id, A);
  const nota = j.historial.find(h => /Servicio realizado/.test(h.texto))?.texto || '';
  revisa(/Gastos generados/.test(nota) && !/tercero|subcontrat|nuestro equipo/i.test(nota), 'la bitácora dice «gastos generados» (sin «tercero», «subcontratado» ni «nuestro equipo»)', nota);
  [s, j] = await pedir('GET', '/generador?desde=' + dia(-5) + '&hasta=' + HOY, A);
  revisa(j.filas.some(f => f.lead_id === o1.id && f.costo === 5800), 'en el Generador aparece con su gasto');

  console.log('2. Sí, sin gastos');
  const o2 = await orden('Desazolve', dia(-1));
  [s, j] = await pedir('POST', '/leads/' + o2.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-1) });
  revisa(s === 200 && j.lead.ejecucion === 'realizado' && j.gastos === 0, 'se puede marcar realizado sin gastos (ya no se pregunta quién lo hizo)', [s, j.error]);

  console.log('3. No se realizó');
  const o3 = await orden('Limpieza de cárcamo', dia(-2));
  [s, j] = await pedir('POST', '/leads/' + o3.id + '/ejecucion', A, { estado: 'no_realizado', motivo: '' }); revisa(s === 400 && /por qué no se realizó/.test(j.error), 'sin motivo no se puede marcar «No»', j.error);
  [s, j] = await pedir('POST', '/leads/' + o3.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'El cliente canceló en el sitio', gastos: [{ proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Pipa en falso (traslado)', total: 1500 }] });
  revisa(s === 200 && j.lead.ejecucion === 'no_realizado' && j.gastos === 1, '«No» con motivo y el gasto que sí se generó (la pipa fue en falso)', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A); const g3 = j.find(x => x.lead_id === o3.id);
  revisa(g3 && g3.concepto === 'Pipa en falso (traslado)' && g3.saldo === 1500, 'ese gasto queda por pagar, con el número de la orden', g3);
  [s, j] = await pedir('GET', '/generador?desde=' + dia(-5) + '&hasta=' + HOY, A); revisa(!j.filas.some(f => f.lead_id === o3.id), 'una orden no realizada no cuenta en el Generador');
  [s, j] = await pedir('POST', '/leads/' + o3.id + '/ejecucion', A, { estado: 'no_realizado', motivo: 'Otra vez', gastos: [{ proveedor_id: null, concepto: 'X', total: 10 }] }); revisa(s === 400 && /proveedor/.test(j.error), 'un gasto sin proveedor pide elegirlo', j.error);

  console.log('4. Validaciones del gasto');
  const o4 = await orden('Video inspección', dia(-1));
  [s, j] = await pedir('POST', '/leads/' + o4.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, concepto: '', total: 100 }] }); revisa(s === 400 && /concepto del gasto/.test(j.error), 'el concepto es obligatorio', j.error);
  [s, j] = await pedir('POST', '/leads/' + o4.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, concepto: 'Video inspección', total: 100 }] }); revisa(s === 400 && /en qué se gastó/.test(j.error), 'el concepto no puede ser el mismo servicio que se le vende al cliente', j.error);
  [s, j] = await pedir('POST', '/leads/' + o4.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, concepto: 'Diésel', total: 0 }] }); revisa(s === 400 && /monto/.test(j.error), 'el monto debe ser mayor a 0', j.error);
  [s, j] = await pedir('POST', '/leads/' + o4.id + '/ejecucion', A, { estado: 'realizado', fecha: dia(-1), gastos: [{ proveedor_id: prov.id, concepto: 'Diésel', total: 300, ya_pagado: true }] }); revisa(s === 400 && /cómo se pagó/.test(j.error), 'si ya se pagó, pide cómo', j.error);
  [s, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A); revisa(!j.some(x => x.lead_id === o4.id), 'con un gasto inválido no se carga nada (ni se marca realizado)');
  [s, j] = await pedir('GET', '/leads/' + o4.id, A); revisa(!j.ejecucion, 'la orden sigue sin marcar');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); revisa(si === 200 && ri.errores === 0, 'revisión de integridad: 0 errores', (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total).map(r => r.titulo)); }
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
