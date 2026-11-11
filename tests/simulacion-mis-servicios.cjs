// MIS SERVICIOS EN EL RELOJ CHECADOR (2026-11-11, pedido de Dirección): al identificarse en el kiosco o en su celular,
// supervisores, operadores y técnicos ven las órdenes de servicio que les asignaron (de hoy y los próximos 6 días).
//  1. Kiosco: al identificarse y al checar llegan SUS servicios (equipo de la orden o técnico ligado a su usuario);
//     no los de otros, ni cotizaciones, ni órdenes ya pasadas o de dentro de más de una semana, ni ya realizadas de
//     otros días. Nunca precios ni teléfonos.
//  2. Supervisor (puesto): ve todas las órdenes de su sucursal, no las de otra.
//  3. Celular: «Ver mis servicios» con su PIN; PIN equivocado no muestra nada.
// Uso: node tests/simulacion-mis-servicios.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-servicios-')), DB = path.join(dir, 'servicios.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Servicios-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Serv-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9750 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const kio = (tk, r, b) => pedir('POST', '/publico/kiosco/' + r, null, b, { 'X-Kiosco': tk });
const cel = (tk, r, b) => pedir('POST', '/publico/celular/' + r, null, b, { 'X-Celular': tk });
let n = 0; const malos = [];
const revisa = (cond, t, extra) => { n++; if (!cond) { malos.push(t); console.log('  ✘ ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + t); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const tecUsr = exigir(await pedir('POST', '/usuarios', A, { nombre: 'Toño Técnico', password: CLAVE, rol: 'tecnico', sucursales: [qro.id] }), 'usuario técnico');
  const PIN = {};
  const alta = async (nombre, puesto, sucursal_id, pin, usuario_id) => {
    const p = exigir(await pedir('POST', '/personal', A, { nombre, puesto, sucursal_id, ...(usuario_id ? { usuario_id } : {}) }), 'alta ' + nombre);
    const c = exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', A), 'checador ' + nombre);
    p.codigo = c.codigo; p.temporal = c.pin; PIN[p.id] = pin; return p;
  };
  const oscar = await alta('Óscar Operador', 'Operador', qro.id, '5813'), alba = await alta('Alba Ayudante', 'Ayudante', qro.id, '7392');
  const sara = await alta('Sara Supervisora', 'Supervisor', qro.id, '6481'), toño = await alta('Toño Técnico', 'Técnico', qro.id, '9275', tecUsr.id);
  const memo = await alta('Memo Supervisor CDMX', 'Supervisor', cdmx.id, '3864');
  const K = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Entrada', sucursal_id: qro.id }), 'kiosco').token;
  const KM = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Entrada CDMX', sucursal_id: cdmx.id }), 'kiosco CDMX').token;
  for (const [p, k] of [[oscar, K], [alba, K], [sara, K], [toño, K], [memo, KM]]) { const i = exigir(await kio(k, 'identificar', { codigo: p.codigo, pin: p.temporal }), 'identificar'); exigir(await kio(k, 'cambiar-pin', { ticket: i.ticket, nuevo: PIN[p.id] }), 'PIN'); }

  // Órdenes (se escriben en la base: aquí se prueba qué ve cada quien, no cómo se crea una orden).
  const partidas = JSON.stringify([{ servicio: 'Desazolve de drenaje', leyenda: 'Línea principal de 8 pulgadas', cantidad: 1, precio: 4321.5 }]);
  const orden = (o) => conBase(d => Number(d.prepare(`INSERT INTO leads (telefono, telefono_normalizado, nombre, empresa_contacto, direccion, estatus, etapa, fecha_servicio, hora_servicio, sucursal_id, partidas_json, valor, equipo, tecnico_id, ejecucion)
    VALUES ('442 555 0101', '4425550101', ?, ?, ?, ?, 4, ?, ?, ?, ?, 4321.5, ?, ?, ?)`).run(o.nombre, o.empresa || null, o.direccion || 'Av. Siempre Viva 742, Querétaro', o.estatus || 'ganado', o.fecha, o.hora || null, o.sucursal || qro.id, partidas, o.equipo || null, o.tecnico || null, o.ejecucion || null).lastInsertRowid));
  const equipo = (lead, p, papel) => conBase(d => d.prepare('INSERT INTO orden_personal (lead_id, personal_id, papel) VALUES (?, ?, ?)').run(lead, p.id, papel));
  const hoy1 = orden({ nombre: 'Restaurante Hoy', empresa: 'Restaurante Hoy SA', fecha: HOY, hora: '09:30', equipo: 'Vactor 3' });
  equipo(hoy1, oscar, 'operador'); equipo(hoy1, alba, 'ayudante'); equipo(hoy1, sara, 'responsable');
  const manana = orden({ nombre: 'Hotel Mañana', fecha: sumar(HOY, 1), hora: '08:00' }); equipo(manana, oscar, 'responsable');
  const lejos = orden({ nombre: 'Planta Lejana', fecha: sumar(HOY, 9) }); equipo(lejos, oscar, 'operador');
  const ayer = orden({ nombre: 'Ayer Pasado', fecha: sumar(HOY, -1) }); equipo(ayer, oscar, 'operador');
  const cotiza = orden({ nombre: 'Solo Cotización', fecha: HOY, estatus: 'abierto' }); equipo(cotiza, oscar, 'operador');
  const deToño = orden({ nombre: 'Fábrica de Toño', fecha: sumar(HOY, 2), tecnico: tecUsr.id });
  const sinNadie = orden({ nombre: 'Escuela Sin Equipo', fecha: HOY, hora: '12:00' });
  const realizadaHoy = orden({ nombre: 'Ya Hecha Hoy', fecha: HOY, ejecucion: 'realizado' }); equipo(realizadaHoy, oscar, 'operador');
  const realizadaManana = orden({ nombre: 'Realizada Adelantada', fecha: sumar(HOY, 1), ejecucion: 'realizado' }); equipo(realizadaManana, oscar, 'operador');
  const deCdmx = orden({ nombre: 'Oficina CDMX', fecha: HOY, sucursal: cdmx.id });

  console.log('1. Kiosco: cada quien ve lo suyo');
  const i1 = exigir(await kio(K, 'identificar', { codigo: oscar.codigo, pin: PIN[oscar.id] }), 'identificar Óscar');
  const nombres = l => (l || []).map(x => x.cliente);
  revisa(JSON.stringify(nombres(i1.servicios)) === JSON.stringify(['Restaurante Hoy SA', 'Ya Hecha Hoy', 'Hotel Mañana']),
    'Óscar ve sus órdenes de hoy y mañana en orden; no la de dentro de 9 días, ni la de ayer, ni una cotización, ni la realizada de otro día', nombres(i1.servicios));
  const s1 = i1.servicios?.[0] || {};
  revisa(s1.hora === '09:30' && s1.fecha === HOY && s1.unidad === 'Vactor 3' && s1.papel === 'Operador' && (/Desazolve de drenaje: Línea principal/.test(s1.descripcion) || s1.descripcion === 'Línea principal de 8 pulgadas') && s1.direccion.includes('Siempre Viva') && /^OS-/.test(s1.folio)
    && s1.equipo.length === 3 && s1.equipo[0].startsWith('Sara Supervisora (Responsable)'), 'Trae hora, unidad, su papel, descripción del servicio, dirección, folio y quién va con él', s1);
  const crudo = JSON.stringify(i1.servicios);
  revisa(!/4321|442|0101|precio|valor|telefono/i.test(crudo), 'Sin precios ni teléfonos', crudo.slice(0, 300));
  const ch = exigir(await kio(K, 'checar', { ticket: i1.ticket, tipo: 'entrada' }), 'checar Óscar');
  revisa(nombres(ch.servicios).length === 3, 'Al checar también llegan sus servicios (para la pantalla de «listo»)', ch);
  const iA = exigir(await kio(K, 'identificar', { codigo: alba.codigo, pin: PIN[alba.id] }), 'identificar Alba');
  revisa(JSON.stringify(nombres(iA.servicios)) === JSON.stringify(['Restaurante Hoy SA']) && iA.servicios[0].papel === 'Ayudante', 'Alba ve solo la orden donde va de ayudante', iA.servicios);
  const iT = exigir(await kio(K, 'identificar', { codigo: toño.codigo, pin: PIN[toño.id] }), 'identificar Toño');
  revisa(JSON.stringify(nombres(iT.servicios)) === JSON.stringify(['Fábrica de Toño']) && iT.servicios[0].papel === 'Técnico', 'Toño (ficha ligada a su usuario) ve la orden donde es el técnico', iT.servicios);
  revisa((await kio(K, 'identificar', { codigo: oscar.codigo, pin: '0000' }))[1].servicios === undefined, 'Con PIN equivocado no llega nada');

  console.log('2. Supervisores');
  const iS = exigir(await kio(K, 'identificar', { codigo: sara.codigo, pin: PIN[sara.id] }), 'identificar Sara');
  const vs = nombres(iS.servicios);
  revisa(['Restaurante Hoy SA', 'Escuela Sin Equipo', 'Hotel Mañana', 'Fábrica de Toño'].every(x => vs.includes(x)) && !vs.includes('Oficina CDMX') && !vs.includes('Solo Cotización') && !vs.includes('Planta Lejana'),
    'La supervisora ve todas las órdenes de su sucursal de la semana (también las sin equipo), no las de CDMX', vs);
  revisa(iS.servicios.find(x => x.cliente === 'Restaurante Hoy SA').papel === 'Responsable' && iS.servicios.find(x => x.cliente === 'Escuela Sin Equipo').papel === 'Supervisor', 'Dice si ella va como responsable o solo supervisa');
  const iM = exigir(await kio(KM, 'identificar', { codigo: memo.codigo, pin: PIN[memo.id] }), 'identificar Memo');
  revisa(JSON.stringify(nombres(iM.servicios)) === JSON.stringify(['Oficina CDMX']), 'El supervisor de CDMX ve solo las de CDMX', nombres(iM.servicios));

  console.log('3. Celular');
  const ruta = exigir(await pedir('POST', '/asistencia/personal/' + oscar.id + '/celular', A), 'enlace').ruta.split('#e=')[1];
  const C = exigir(await cel(null, 'ligar', { enlace: ruta }), 'ligar').token;
  revisa((await cel(C, 'servicios', { pin: '0000' }))[0] === 401, 'Con PIN equivocado, el celular no muestra servicios');
  const [sc, jc] = await cel(C, 'servicios', { pin: PIN[oscar.id] });
  revisa(sc === 200 && nombres(jc.servicios).length === 3, 'Con su PIN, «Ver mis servicios» en el celular', jc);
  revisa((await cel(null, 'servicios', { pin: PIN[oscar.id] }))[0] === 401, 'Sin celular ligado, nada');

  console.log('4. Imprimir la orden de servicio y su factura (2026-11-11)');
  const i2 = exigir(await kio(K, 'identificar', { codigo: oscar.codigo, pin: PIN[oscar.id] }), 'identificar Óscar');
  const sv = i2.servicios.find(x => x.cliente === 'Restaurante Hoy SA');
  revisa(typeof sv.imprimir === 'string' && sv.imprimir.length > 20 && sv.con_factura === false, 'Cada servicio trae su permiso para imprimir (y si tiene factura)', sv);
  const [so, od] = await kio(K, 'orden', { permiso: sv.imprimir });
  revisa(so === 200 && od.folio === sv.folio && od.items.length === 1 && od.items[0].importe === undefined ? true : so === 200 && od.folio === sv.folio, 'La orden llega con su folio', [so, od.folio]);
  revisa(od.cliente?.telefono === '442 555 0101' && od.cliente.empresa === 'Restaurante Hoy SA' && od.fechaServicio === HOY.split('-').reverse().join('/') && /^https?:\/\/.+\/e\/[\w-]+$/.test(od.encuesta || ''),
    'Trae lo mismo que la orden impresa del CRM: cliente con teléfono, fecha y el enlace de su encuesta (para el QR)', od);
  revisa((await kio(KM, 'orden', { permiso: sv.imprimir }))[0] === 401, 'El permiso no sirve en otro kiosco');
  revisa((await kio(K, 'orden', { permiso: 'inventado-' + 'x'.repeat(20) }))[0] === 401, 'Un permiso inventado no sirve');
  revisa((await kio(K, 'factura', { permiso: sv.imprimir }))[0] === 404, 'Sin factura guardada, dice que la pida a la oficina');
  // Una factura timbrada con su PDF guardado (como la deja el timbrado: archivos/ junto a la base).
  fs.mkdirSync(path.join(dir, 'archivos', 'facturas'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'archivos', 'facturas', 'f-prueba.pdf'), '%PDF-1.4\nFACTURA-PRUEBA\n%%EOF');
  conBase(d => d.prepare("INSERT INTO facturas (lead_id, sucursal_id, estatus, num_order, entorno, receptor_rfc, receptor_razon_social, metodo_pago, forma_pago, subtotal_cent, iva_cent, total_cent, serie, folio, cfdi_uid, uuid, pdf_path) VALUES (?, ?, 'timbrada', 'SERV-1', 'sandbox', 'XAXX010101000', 'PUBLICO', 'PUE', '03', 432150, 69144, 501294, 'F', '7', 'uid-serv', '5A1D0C0B-F070-4C0B-8000-00000000AB01', 'facturas/f-prueba.pdf')").run(hoy1, qro.id));
  const i3 = exigir(await kio(K, 'identificar', { codigo: oscar.codigo, pin: PIN[oscar.id] }), 'identificar Óscar');
  const sv3 = i3.servicios.find(x => x.cliente === 'Restaurante Hoy SA');
  const rf = await fetch(URLB + '/api/publico/kiosco/factura', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kiosco': K }, body: JSON.stringify({ permiso: sv3.imprimir }) });
  const pdf = Buffer.from(await rf.arrayBuffer()).toString();
  revisa(sv3.con_factura === true && rf.status === 200 && /application\/pdf/.test(rf.headers.get('content-type')) && pdf.includes('FACTURA-PRUEBA') && /factura-F7-PRUEBA\.pdf/.test(rf.headers.get('content-disposition')), 'Con factura timbrada, se descarga su PDF', [sv3.con_factura, rf.status]);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'imprimió' AND detalle LIKE '%Óscar Operador%'").get().n) >= 2, 'Cada impresión queda en la bitácora con quién y dónde');
  const [, jc2] = await cel(C, 'servicios', { pin: PIN[oscar.id] }), svc = jc2.servicios.find(x => x.cliente === 'Restaurante Hoy SA');
  revisa((await cel(C, 'orden', { permiso: svc.imprimir }))[0] === 200 && (await kio(K, 'orden', { permiso: svc.imprimir }))[0] === 401, 'Desde el celular también; el permiso del celular no sirve en el kiosco');
  revisa((await cel(C, 'orden', { permiso: sv3.imprimir }))[0] === 401, 'Ni el del kiosco en el celular');

  console.log('5. Calendario para todos en el kiosco; para imprimir, código y PIN (2026-11-11)');
  const [scal, cal] = await pedir('GET', '/publico/kiosco/calendario', null, undefined, { 'X-Kiosco': K });
  const enCal = (cal.ordenes || []).map(o => o.cliente);
  revisa(scal === 200 && ['Restaurante Hoy SA', 'Escuela Sin Equipo', 'Hotel Mañana', 'Fábrica de Toño', 'Ya Hecha Hoy'].every(x => enCal.includes(x)) && !enCal.includes('Oficina CDMX') && !enCal.includes('Solo Cotización') && !enCal.includes('Planta Lejana'),
    'Sin identificarse, el kiosco muestra las órdenes de su sucursal de la semana (no las de otra, ni cotizaciones)', enCal);
  revisa(!/4321|442 555|0101|precio|valor|telefono|imprimir|permiso/i.test(JSON.stringify(cal.ordenes)), 'Sin precios, teléfonos ni permisos de impresión', JSON.stringify(cal.ordenes).slice(0, 200));
  revisa(cal.ordenes.find(o => o.cliente === 'Ya Hecha Hoy').estado === 'Realizada', 'Dice si ya se realizó');
  const [, sig] = await pedir('GET', '/publico/kiosco/calendario?desde=' + sumar(HOY, 7), null, undefined, { 'X-Kiosco': K });
  revisa(sig.ordenes.some(o => o.cliente === 'Planta Lejana') && sig.desde === sumar(HOY, 7), 'Se puede ver la semana siguiente', sig.ordenes.map(o => o.cliente));
  revisa((await pedir('GET', '/publico/kiosco/calendario', null))[0] === 401, 'Sin kiosco registrado, nada');
  const ordenCal = cal.ordenes.find(o => o.cliente === 'Hotel Mañana');
  const [sx, jx] = await kio(K, 'calendario-imprimir', { codigo: alba.codigo, pin: '0000', orden: ordenCal.id });
  revisa(sx === 401 && typeof jx.intento === 'string' && !jx.permiso, 'Con PIN equivocado no imprime y queda el intento (con foto)', [sx, jx]);
  const [sy, jy] = await kio(K, 'calendario-imprimir', { codigo: alba.codigo, pin: PIN[alba.id], orden: ordenCal.id });
  revisa(sy === 200 && jy.nombre === 'Alba' && typeof jy.permiso === 'string' && jy.con_factura === false, 'Con su código y PIN, alguien de la sucursal imprime aunque no vaya a esa orden', jy);
  const [sz, oz] = await kio(K, 'orden', { permiso: jy.permiso });
  revisa(sz === 200 && oz.folio === ordenCal.folio && conBase(d => d.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'imprimió' AND detalle LIKE '%Alba Ayudante%'").get().n) === 1, 'Y la orden sale a su nombre en la bitácora', [sz, oz.folio]);
  const conFact = cal.ordenes.find(o => o.cliente === 'Restaurante Hoy SA'), [, jf] = await kio(K, 'calendario-imprimir', { codigo: alba.codigo, pin: PIN[alba.id], orden: conFact.id });
  revisa(jf.con_factura === true && (await fetch(URLB + '/api/publico/kiosco/factura', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kiosco': K }, body: JSON.stringify({ permiso: jf.permiso }) })).status === 200, 'También la factura de una orden que la tiene');
  revisa((await kio(K, 'calendario-imprimir', { codigo: memo.codigo, pin: PIN[memo.id], orden: ordenCal.id }))[0] === 403, 'Alguien de otra sucursal no imprime en este kiosco');
  revisa((await kio(K, 'calendario-imprimir', { codigo: alba.codigo, pin: PIN[alba.id], orden: deCdmx }))[0] === 404 && (await kio(K, 'calendario-imprimir', { codigo: alba.codigo, pin: PIN[alba.id], orden: cotiza }))[0] === 404, 'Ni una orden de otra sucursal o una cotización');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
