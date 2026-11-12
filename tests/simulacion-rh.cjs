// PESTAÑA RH Y CARGA DE TRABAJADORES (2026-11-03): número de empleado consecutivo que no se reusa ni se cambia, resumen
// de RH, y carga en lote: revisión fila por fila sin guardar, todo o nada al guardar, horario y alta en el checador con
// PIN temporal, sucursales y permisos.
// Uso: node tests/simulacion-rh.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-rh-')), DB = path.join(dir, 'rh.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'RH-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-RH-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9760 + Math.floor(Math.random() * 200)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
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
  const T = {};
  for (const [nombre, rol, s] of [['Gema Gerente', 'gerente', qro.id], ['Valeria Ventas', 'ventas', qro.id], ['Gus GerenteMx', 'gerente', cdmx.id]]) {
    exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), 'crear ' + nombre);
    T[nombre.split(' ')[0]] = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  }
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente', 'Gus GerenteMx']); // etapa 6: quien edita personal tiene su ficha ligada

  console.log('1. Número de empleado');
  const p1 = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Ana Primera', puesto: 'Administración' }), 'alta 1');
  const p2 = exigir(await pedir('POST', '/personal', T.Gus, { nombre: 'Beto Segundo', puesto: 'Técnico' }), 'alta 2');
  revisa(/^\d{4}$/.test(p1.numero_empleado) && Number(p2.numero_empleado) === Number(p1.numero_empleado) + 1, 'Cada alta recibe el siguiente número de empleado (de toda la empresa)', [p1.numero_empleado, p2.numero_empleado]);
  exigir(await pedir('POST', '/personal/' + p2.id + '/baja', T.Gus, { motivo: 'Renuncia voluntaria' }), 'baja');
  const p3 = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Carla Tercera', puesto: 'Operador' }), 'alta 3');
  revisa(Number(p3.numero_empleado) === Number(p2.numero_empleado) + 1, 'El número de quien se dio de baja no se reusa', p3.numero_empleado);
  exigir(await pedir('PUT', '/personal/' + p1.id, T.Gema, { numero_empleado: '9999', telefono: '442 111 2233' }), 'editar');
  revisa(conBase(d => d.prepare('SELECT numero_empleado FROM personal WHERE id = ?').get(p1.id).numero_empleado) === p1.numero_empleado, 'El número de empleado no se cambia desde la pantalla');
  revisa((() => { try { conBase(d => d.prepare("UPDATE personal SET numero_empleado = '7777' WHERE id = ?").run(p1.id)); return false; } catch { return true; } })(), 'Ni editando la base a mano');
  revisa((await pedir('GET', '/personal?q=' + p3.numero_empleado, T.Gema))[1].some(x => x.id === p3.id), 'Se busca a alguien por su número de empleado');

  console.log('2. Resumen de RH');
  const [sr, res] = await pedir('GET', '/rh/resumen', T.Gema);
  revisa(sr === 200 && res.activos === 2 && res.sin_checador === 2, 'La gerente ve el resumen de su sucursal (2 activas, sin checador)', res);
  revisa((await pedir('GET', '/rh/resumen', T.Valeria))[0] === 403, 'Ventas no ve la pestaña RH');

  console.log('3. Carga en lote: revisar');
  const filas = [
    { fila: 2, nombre: 'Diego Carga Uno', puesto: 'operador', sucursal: 'QRO', telefono: '442 555 0001', fecha_ingreso: sumar(HOY, -30), horario: 'Operaciones', checador: 'Sí' },
    { fila: 3, nombre: 'Elena Carga Dos', puesto: 'Administración', sucursal: '', correo: 'elena@ejemplo.mx', horario: 'Administrativo', checador: 'No' },
    { fila: 4, nombre: '', puesto: 'Operador' },
    { fila: 5, nombre: 'Fede Puesto Raro', puesto: 'Astronauta' },
    { fila: 6, nombre: 'Gina Otra Sucursal', puesto: 'Técnico', sucursal: 'CDMX' },
    { fila: 7, nombre: 'Hugo Horario', puesto: 'Técnico', horario: 'Nocturno' },
    { fila: 8, nombre: 'diego carga uno', puesto: 'Operador' },
    { fila: 9, nombre: 'Ana Primera', puesto: 'Operador' },
    { fila: 10, nombre: 'Iván Futuro', puesto: 'Operador', fecha_ingreso: sumar(HOY, 10) },
    { fila: 11, nombre: 'Juan Checador', puesto: 'Operador', checador: 'quizá' },
  ];
  revisa((await pedir('POST', '/rh/importar/revisar', T.Valeria, { filas }))[0] === 403, 'Ventas no carga trabajadores');
  const [sv, rev] = await pedir('POST', '/rh/importar/revisar', T.Gema, { filas });
  const err = f => rev.filas.find(x => x.fila === f)?.errores.join(' | ') || '';
  revisa(sv === 200 && rev.hay_errores && !err(2) && !err(3), 'Revisar no guarda nada y las filas buenas salen sin errores (puesto en minúsculas y sucursal vacía con una sola sucursal)', rev.filas.slice(0, 2));
  revisa(/nombre/i.test(err(4)) && /Astronauta/.test(err(5)) && /CDMX/.test(err(6)) && /Nocturno/.test(err(7)) && /repetido en la fila 2/.test(err(8)) && /activa con ese nombre/.test(err(9)) && /futura/.test(err(10)) && /Sí o No/.test(err(11)),
    'Cada fila mala dice qué corregir (nombre, puesto, sucursal ajena, horario, repetido, ya existe, fecha futura, Sí/No)', rev.filas.map(f => [f.fila, f.errores]));
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM personal WHERE nombre LIKE '%Carga%'").get().n) === 0, 'Revisar no guardó nada');

  console.log('4. Carga en lote: guardar');
  const [sg, g1] = await pedir('POST', '/rh/importar/guardar', T.Gema, { filas });
  revisa(sg === 400 && g1.hay_errores && conBase(d => d.prepare("SELECT COUNT(*) n FROM personal WHERE nombre LIKE '%Carga%'").get().n) === 0, 'Con una sola fila mala no se guarda ninguna');
  const buenas = filas.slice(0, 2);
  const [sg2, g2] = await pedir('POST', '/rh/importar/guardar', T.Gema, { filas: buenas });
  const [d1, d2] = g2.creados || [];
  revisa(sg2 === 201 && d1 && d2 && Number(d1.numero_empleado) === Number(p3.numero_empleado) + 1 && Number(d2.numero_empleado) === Number(d1.numero_empleado) + 1, 'Se guardan con números de empleado consecutivos', g2);
  revisa(/^\d{4}$/.test(d1.codigo) && /^\d{4}$/.test(d1.pin) && d2.codigo === null && d2.pin === null, 'Quien lleva «Sí» en checador recibe código y PIN temporal; quien lleva «No», no', [d1, d2]);
  const f1 = conBase(d => d.prepare('SELECT * FROM personal WHERE numero_empleado = ?').get(d1.numero_empleado));
  revisa(f1.pin_temporal === 1 && f1.pin_hash && !Object.values(f1).includes(d1.pin) && f1.puesto === 'Operador' && f1.sucursal_id === qro.id, 'En la base: PIN temporal solo como hash, puesto con su nombre correcto y su sucursal', { puesto: f1.puesto, suc: f1.sucursal_id });
  const hor = conBase(d => d.prepare('SELECT h.nombre, ph.desde FROM personal_horario ph JOIN horarios h ON h.id = ph.horario_id WHERE ph.personal_id = ?').get(f1.id));
  revisa(hor?.nombre === 'Operaciones' && hor.desde === sumar(HOY, -30), 'Su horario queda asignado desde su fecha de ingreso', hor);
  revisa((await pedir('GET', '/auditoria?entidad=personal&id=' + f1.id, A))[2].includes('alta') && !(await pedir('GET', '/auditoria?entidad=personal&id=' + f1.id, A))[2].includes('"' + d1.pin + '"'), 'Cada alta queda en la bitácora (sin el PIN)');
  const [, rep] = await pedir('POST', '/rh/importar/revisar', T.Gema, { filas: buenas });
  revisa(rep.filas.every(f => /activa con ese nombre/.test(f.errores.join())), 'Si se vuelve a subir el mismo archivo, avisa que ya existen (no duplica)', rep.filas);
  revisa((await pedir('POST', '/rh/importar/revisar', T.Gema, { filas: Array.from({ length: 301 }, (_, i) => ({ nombre: 'Persona ' + i, puesto: 'Operador' })) }))[0] === 400, 'Máximo 300 trabajadores por archivo');
  const [, resMx] = await pedir('POST', '/rh/importar/revisar', T.Gus, { filas: [{ nombre: 'Kiko CDMX', puesto: 'Técnico', sucursal: 'QRO' }] });
  revisa(/QRO/.test(resMx.filas[0].errores.join()), 'El gerente de CDMX no puede cargar gente en Querétaro', resMx.filas);
  const [, res2] = await pedir('GET', '/rh/resumen', T.Gema);
  revisa(res2.activos === 4 && res2.sin_aviso === 1, 'El resumen cuenta a los nuevos y a quien le falta el aviso firmado', res2);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
