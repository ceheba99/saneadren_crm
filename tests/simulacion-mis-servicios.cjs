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

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
