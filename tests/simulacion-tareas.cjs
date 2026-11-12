// PROYECTOS Y TAREAS CON GANTT (2026-11-11, aprobado por Dirección).
// Asignan Dirección y el Gerente (este solo a gente de su sucursal); cada quien ve y avanza las suyas, las marca
// terminadas y quien asignó las acepta o las regresa. Dependencias, hitos, archivos, avisos en Inicio y nada se borra.
// Uso: node tests/simulacion-tareas.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tareas-')), DB = path.join(dir, 't.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Tareas-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Tareas-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9850 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', FACTURA_ENV: 'sandbox', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { ...(Buffer.isBuffer(b) ? { 'Content-Type': 'application/octet-stream', 'X-Nombre': 'evidencia.png' } : { 'Content-Type': 'application/json' }), ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : Buffer.isBuffer(b) ? b : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'CDMX');
  const ID = {};
  const usuario = async (nombre, rol, suc = qro.id) => { exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] }), nombre); const u = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre); ID[nombre] = u.id; return u.token; };
  const G = await usuario('Gema Gerente', 'gerente'), V = await usuario('Valeria Ventas', 'ventas'), T = await usuario('Tomas Tecnico', 'tecnico'), D = await usuario('Diego Ventas', 'ventas', cdmx.id);

  console.log('1. Asignar');
  revisa((await pedir('POST', '/tareas', V, { titulo: 'Tarea de Valeria', asignado_a: ID['Tomas Tecnico'], inicio: HOY, fin: dia(3) }))[0] === 403, 'Ventas no asigna tareas');
  revisa((await pedir('POST', '/tareas', G, { titulo: 'Para CDMX', asignado_a: ID['Diego Ventas'], inicio: HOY, fin: dia(3) }))[0] === 403, 'El Gerente de Querétaro no asigna a alguien de CDMX');
  revisa((await pedir('POST', '/tareas', G, { titulo: 'Fechas al revés', asignado_a: ID['Tomas Tecnico'], inicio: dia(5), fin: dia(1) }))[0] === 400, 'La entrega antes del inicio se rechaza');
  const pr = exigir(await pedir('POST', '/tareas/proyectos', G, { nombre: 'Arranque de la pipa nueva', descripcion: 'Dejarla lista para operar' }), 'proyecto');
  const t1 = exigir(await pedir('POST', '/tareas', G, { titulo: 'Tramitar placas de la pipa', asignado_a: ID['Tomas Tecnico'], inicio: dia(-3), fin: dia(-1), prioridad: 'alta', proyecto_id: pr.id }), 'tarea 1');
  const t2 = exigir(await pedir('POST', '/tareas', G, { titulo: 'Rotular la pipa', asignado_a: ID['Valeria Ventas'], inicio: dia(0), fin: dia(1), proyecto_id: pr.id, depende_de: t1.id }), 'tarea 2');
  const hito = exigir(await pedir('POST', '/tareas', G, { titulo: 'Pipa operando', asignado_a: ID['Gema Gerente'], inicio: dia(4), fin: dia(4), es_hito: true, proyecto_id: pr.id, depende_de: t2.id }), 'hito');
  exigir(await pedir('POST', '/tareas', A, { titulo: 'Visitar clientes CDMX', asignado_a: ID['Diego Ventas'], inicio: HOY, fin: dia(10) }), 'tarea Dirección a CDMX');
  revisa((await pedir('PUT', '/tareas/' + t1.id, G, { depende_de: hito.id }))[0] === 400, 'Una dependencia en círculo se rechaza');

  console.log('2. Quién ve qué');
  const lista = async (t, q = 'vista=todas') => (await pedir('GET', '/tareas?' + q, t))[1];
  let l = await lista(G); revisa(l.puede_asignar && l.tareas.length === 3 && l.proyectos.length === 1 && l.equipo.some(u => u.nombre === 'Tomas Tecnico') && !l.equipo.some(u => u.nombre === 'Diego Ventas'), 'El Gerente ve las 3 de Querétaro, el proyecto y su equipo (sin la gente de CDMX)', l.tareas.map(x => x.titulo));
  l = await lista(T); revisa(!l.puede_asignar && l.tareas.length === 1 && l.tareas[0].id === t1.id && l.tareas[0].es_mia, 'Tomás ve solo la suya');
  l = await lista(D); revisa(l.tareas.length === 1 && /CDMX/.test(l.tareas[0].titulo), 'Diego (CDMX) ve la que le asignó Dirección');
  l = await lista(A); revisa(l.tareas.length === 4, 'Dirección ve todas');
  revisa((await pedir('GET', '/tareas/' + t1.id, V))[0] === 404, 'Valeria no abre la tarea de Tomás');
  revisa(l.tareas.find(x => x.id === t1.id).vencida, 'La de Tomás (entrega ayer) sale vencida');

  console.log('3. La persona asignada');
  revisa((await pedir('PUT', '/tareas/' + t1.id, T, { fin: dia(10) }))[0] === 403, 'Tomás no se cambia la fecha de entrega');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/avance', T, { avance: 100 }))[0] === 400, 'El avance llega a 99 %; el 100 % es marcarla terminada');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/avance', T, { avance: 60, comentario: 'Ya entregué papeles' }))[0] === 200, 'Tomás pone 60 % con comentario');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/archivos', T, PNG))[0] === 201, 'Tomás adjunta una foto de evidencia');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/archivos', T, Buffer.from('MZ ejecutable falso')))[0] === 400, 'Un archivo que no es PDF/JPG/PNG se rechaza');
  revisa((await pedir('POST', '/tareas/' + t2.id + '/terminar', V, {}))[0] === 409, 'Valeria no termina «Rotular» antes que «Placas» (depende de ella)');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/terminar', V, {}))[0] === 404, 'Valeria no termina la de Tomás');
  let [s, r] = await pedir('POST', '/tareas/' + t1.id + '/terminar', T, { comentario: 'Placas listas' });
  revisa(s === 200 && r.estado === 'por_revisar', 'Tomás la marca terminada: queda «por revisar»', r);
  revisa((await pedir('POST', '/tareas/' + t1.id + '/avance', T, { avance: 50 }))[0] === 409, 'Por revisar ya no cambia el avance');
  let av = (await pedir('GET', '/tareas/avisos', G))[1].avisos;
  revisa(av.some(a => a.tipo === 'revisar' && a.id === t1.id), 'Al Gerente le sale «Por revisar» en Inicio', av);

  console.log('4. Revisar');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/revisar', T, { acepta: true }))[0] === 403, 'Tomás no se acepta su propia tarea');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/revisar', G, { acepta: false }))[0] === 400, 'Regresarla sin decir qué falta se rechaza');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/revisar', G, { acepta: false, comentario: 'Falta la tarjeta de circulación' }))[0] === 200, 'El Gerente la regresa con comentario');
  revisa(exigir(await pedir('GET', '/tareas/' + t1.id, T), 'detalle').estado === 'en_proceso', 'Regresada: vuelve a «en proceso»');
  exigir(await pedir('POST', '/tareas/' + t1.id + '/terminar', T, { comentario: 'Ya con tarjeta' }), 'terminar otra vez');
  revisa((await pedir('POST', '/tareas/' + t1.id + '/revisar', G, { acepta: true }))[0] === 200, 'El Gerente la acepta');
  const det = exigir(await pedir('GET', '/tareas/' + t1.id, G), 'detalle');
  revisa(det.estado === 'terminada' && det.avance === 100 && det.historial.some(h => h.tipo === 'regresada') && det.historial.some(h => h.archivo), 'Terminada al 100 %, con su historial (regresada, archivo)', det.historial.map(h => h.tipo));
  { const arch = det.historial.find(h => h.archivo); const [sa] = await pedir('GET', '/tareas/archivos/' + arch.id, T); const [sb] = await pedir('GET', '/tareas/archivos/' + arch.id, V);
    revisa(sa === 200 && sb === 404, 'El archivo lo descarga Tomás; Valeria no'); }
  revisa((await pedir('POST', '/tareas/' + t2.id + '/terminar', V, {}))[0] === 200, 'Ya terminada «Placas», Valeria sí termina «Rotular»');

  console.log('5. Avisos, cancelar y candados');
  av = (await pedir('GET', '/tareas/avisos', V))[1].avisos; revisa(!av.some(a => a.id === t2.id), 'A Valeria ya no le sale «Rotular» (está por revisar)');
  av = (await pedir('GET', '/tareas/avisos', D))[1].avisos; revisa(av.length === 1 && /CDMX/.test(av[0].texto), 'A Diego le sale su tarea en Inicio', av);
  const t3 = exigir(await pedir('POST', '/tareas', G, { titulo: 'Tarea vieja', asignado_a: ID['Tomas Tecnico'], inicio: dia(-9), fin: dia(-5) }), 'tarea vieja');
  av = (await pedir('GET', '/tareas/avisos', G))[1].avisos; revisa(av.some(a => a.tipo === 'vencida' && a.id === t3.id), 'Al Gerente le sale la vencida de Tomás');
  revisa((await pedir('POST', '/tareas/' + t3.id + '/cancelar', G, { motivo: 'no' }))[0] === 400, 'Cancelar sin motivo se rechaza');
  revisa((await pedir('POST', '/tareas/' + t3.id + '/cancelar', G, { motivo: 'Ya no hace falta' }))[0] === 200, 'Se cancela con motivo');
  revisa((await pedir('POST', '/tareas/proyectos/' + pr.id + '/cancelar', G, { motivo: 'Prueba de cancelar' }))[0] === 409, 'Un proyecto con tareas abiertas no se cancela');
  { const d = new DatabaseSync(DB); let e1 = ''; try { d.prepare('DELETE FROM tareas WHERE id = ?').run(t3.id); } catch (e) { e1 = e.message; } d.close();
    revisa(/no se borran/.test(e1), 'La base no deja borrar una tarea', e1); }
  revisa(!/TypeError|SqliteError|Error no manejado/.test(salida), 'El servidor no registró errores internos', salida.split('\n').filter(x => /Error/.test(x)).slice(0, 5));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
