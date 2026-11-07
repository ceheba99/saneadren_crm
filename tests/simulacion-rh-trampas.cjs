// AUDITORÍA TRAMPOSA DE RH (2026-11-05): lo que haría alguien que quiere hacer trampa o fastidiar al reloj checador.
//  1. Una tableta dada de baja que se queda prendida (o alguien con tokens inventados) desde la misma conexión de la
//     oficina NO debe bloquear al kiosco bueno; los tokens inventados sí se siguen frenando.
//  2. Alguien con el PIN bloqueado que sigue tecleando NO debe pausar el kiosco para todos.
//  3. Días festivos: valen para toda la empresa; el gerente de UNA sucursal no los cambia (si no, en otra sucursal todo
//     lo trabajado ese día se vuelve tiempo extra).
//  4. Nadie se quita a sí mismo del checador («no checa» = sin faltas) ni se manda el enlace para checar desde su celular.
//  5. Tiempo extra inflado: «Inicio / Fin de tiempo extra» apretados dentro del horario normal no cuentan como extra.
//  6. (2026-11-05) Intento fallido en el kiosco: queda registrado con su foto (una sola, del mismo kiosco), lo ven
//     Dirección y el Gerente de su sucursal y abrir la foto queda en la bitácora.
//  7. Red: el kiosco aprende su red al registrarse; desde otra, la checada vale con aviso y sale en RH; «es la nueva red».
//  8. Celular lejos de su sucursal (más de su radio) → «por revisar» con la distancia; la ubicación la captura Dirección.
// Uso: node tests/simulacion-rh-trampas.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-rh-trampas-')), DB = path.join(dir, 'trampas.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Trampas-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Trampas-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9400 + Math.floor(Math.random() * 300)), URLB = 'http://localhost:' + PUERTO;
const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
let ip = '10.30.0.1';
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const kio = (tk, m, r, b) => pedir(m, '/publico/kiosco/' + r, null, b, tk ? { 'X-Kiosco': tk } : {});
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
// Un miércoles ya pasado (laboral en «Administrativo») que no sea festivo.
const FOTO = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000), Buffer.from([0xff, 0xd9])]).toString('base64');
let MIERCOLES = sumar(HOY, -1); while (new Date(MIERCOLES + 'T12:00:00Z').getUTCDay() !== 3) MIERCOLES = sumar(MIERCOLES, -1);

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const T = {}, U = {};
  for (const [nombre, rol, s] of [['Gema Gerente', 'gerente', qro.id], ['Gus GerenteMx', 'gerente', cdmx.id]]) {
    U[nombre.split(' ')[0]] = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), 'crear ' + nombre);
    T[nombre.split(' ')[0]] = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  }
  const alta = async (nombre, puesto) => exigir(await pedir('POST', '/personal', T.Gema, { nombre, puesto }), 'alta de ' + nombre);
  const juan = await alta('Juan Pérez Operador', 'Operador'), ana = await alta('Ana López Admin', 'Administración'), beto = await alta('Beto Ruiz Técnico', 'Técnico');
  const pinDe = {};
  for (const p of [juan, ana, beto]) pinDe[p.id] = exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', T.Gema), 'PIN');
  const K1 = exigir(await pedir('POST', '/asistencia/dispositivos', T.Gema, { nombre: 'Entrada Querétaro', sucursal_id: qro.id }), 'kiosco 1').token;
  const k2 = exigir(await pedir('POST', '/asistencia/dispositivos', T.Gema, { nombre: 'Tableta vieja', sucursal_id: qro.id }), 'kiosco 2');
  // Cada quien elige su PIN (el temporal obliga a cambiarlo).
  const PIN = { [juan.id]: '5813', [ana.id]: '7392', [beto.id]: '2958' };
  for (const p of [juan, ana, beto]) {
    const id = exigir(await kio(K1, 'POST', 'identificar', { codigo: pinDe[p.id].codigo, pin: pinDe[p.id].pin }), 'identificar');
    exigir(await kio(K1, 'POST', 'cambiar-pin', { ticket: id.ticket, nuevo: PIN[p.id] }), 'elegir PIN');
  }

  console.log('1. Tableta dada de baja que sigue prendida en la oficina');
  exigir(await pedir('POST', '/asistencia/dispositivos/' + k2.id + '/revocar', T.Gema), 'dar de baja la tableta vieja');
  ip = '10.30.0.50'; // la conexión de la oficina: la comparten la tableta vieja y el kiosco bueno
  for (let i = 0; i < 40; i++) await kio(k2.token, 'GET', 'estado'); // la tableta vieja pregunta cada minuto
  revisa((await kio(K1, 'GET', 'estado'))[0] === 200, 'El kiosco bueno sigue funcionando aunque la tableta vieja insista desde la misma conexión');
  const [sJ, idJ] = await kio(K1, 'POST', 'identificar', { codigo: pinDe[juan.id].codigo, pin: PIN[juan.id] });
  revisa(sJ === 200 && idJ.ticket, 'Y se puede checar en él', [sJ, idJ]);
  for (let i = 0; i < 35; i++) await kio('X'.repeat(43) + i, 'GET', 'estado'); // tokens inventados
  revisa((await kio('Y'.repeat(44), 'GET', 'estado'))[0] === 429, 'Quien prueba tokens inventados sí se frena (429)');
  revisa((await kio(K1, 'GET', 'estado'))[0] === 200, 'Pero el kiosco bueno de esa misma conexión no se bloquea');

  console.log('2. PIN bloqueado que sigue tecleando');
  ip = '10.30.0.60';
  for (let i = 0; i < 5; i++) await kio(K1, 'POST', 'identificar', { codigo: pinDe[beto.id].codigo, pin: '0' + String(100 + i) });
  const [sB] = await kio(K1, 'POST', 'identificar', { codigo: pinDe[beto.id].codigo, pin: PIN[beto.id] });
  revisa(sB === 423, 'A los 5 fallos su PIN se bloquea (aunque ya ponga el bueno)', sB);
  for (let i = 0; i < 25; i++) await kio(K1, 'POST', 'identificar', { codigo: pinDe[beto.id].codigo, pin: PIN[beto.id] });
  const [sA, idA] = await kio(K1, 'POST', 'identificar', { codigo: pinDe[ana.id].codigo, pin: PIN[ana.id] });
  revisa(sA === 200 && idA.ticket, 'Que Beto siga tecleando con su PIN bloqueado no pausa el kiosco: Ana sí checa', [sA, idA]);
  exigir(await pedir('POST', '/asistencia/personal/' + beto.id + '/desbloquear', T.Gema), 'desbloquear a Beto');

  console.log('3. Días festivos: solo para toda la empresa');
  const [sF] = await pedir('POST', '/asistencia/festivos', T.Gus, { fecha: MIERCOLES, nombre: 'Día inventado en CDMX' });
  revisa(sF === 403, 'El gerente de CDMX no puede declarar un festivo (valdría también en Querétaro)', sF);
  revisa(!conBase(d => d.prepare('SELECT 1 FROM dias_festivos WHERE fecha = ? AND activo = 1').get(MIERCOLES)), 'Y el día no quedó como festivo');
  const [sF2] = await pedir('POST', '/asistencia/festivos', T.Gema, { fecha: sumar(HOY, 40), nombre: 'Otro inventado' });
  revisa(sF2 === 403, 'Tampoco la gerente de Querétaro (solo ve su sucursal)', sF2);
  const [sF3] = await pedir('POST', '/asistencia/festivos', A, { fecha: sumar(HOY, 41), nombre: 'Jornada electoral' });
  revisa(sF3 === 200, 'Dirección (todas las sucursales) sí los agrega', sF3);
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Rita RH', password: CLAVE, rol: 'gerente', sucursales: [qro.id, cdmx.id] }), 'crear RH de la empresa');
  const R = exigir(await pedir('POST', '/login', null, { nombre: 'Rita RH', password: CLAVE }), 'entrar RH').token;
  const [sF4] = await pedir('POST', '/asistencia/festivos', R, { fecha: sumar(HOY, 42), nombre: 'Día de la empresa' });
  revisa(sF4 === 200 && (await pedir('GET', '/asistencia/festivos', R))[1].puede.editar === true, 'RH que ve todas las sucursales sí los agrega', sF4);
  revisa((await pedir('GET', '/asistencia/festivos', T.Gema))[1].puede.editar === false, 'A la gerente de una sola sucursal la pantalla no le ofrece cambiarlos');

  console.log('4. Nadie se quita a sí mismo del checador');
  const yo = exigir(await pedir('POST', '/personal', A, { nombre: 'Gema Gerente Ficha', puesto: 'Administración', usuario_id: U.Gema.id, sucursal_id: qro.id }), 'ficha de Gema');
  exigir(await pedir('POST', '/asistencia/personal/' + yo.id + '/pin', A), 'alta de Gema en el checador');
  const [sNo, jNo] = await pedir('PUT', '/asistencia/personal/' + yo.id, T.Gema, { checa: false });
  revisa(sNo === 403 && jNo.codigo === 'PROPIO', 'Gema no puede marcarse «no checa» (así no tendría faltas)', [sNo, jNo]);
  revisa(conBase(d => d.prepare('SELECT checa FROM personal WHERE id = ?').get(yo.id).checa) === 1, 'Y sigue checando');
  const [sCel, jCel] = await pedir('POST', '/asistencia/personal/' + yo.id + '/celular', T.Gema);
  revisa(sCel === 403 && jCel.codigo === 'PROPIO', 'Gema no puede mandarse el enlace para checar desde su celular', [sCel, jCel]);
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id, T.Gema, { checa: true }))[0] === 200, 'Con otra persona sí puede');

  console.log('5. Tiempo extra inflado con los botones');
  exigir(await pedir('PUT', '/asistencia/personal/' + ana.id + '/horario', T.Gema, { horario_id: conBase(d => d.prepare("SELECT id FROM horarios WHERE nombre = 'Administrativo' AND sucursal_id = ?").get(qro.id).id), desde: '2020-01-01' }), 'horario de Ana');
  for (const [tipo, hora] of [['entrada', '08:30'], ['extra_inicia', '09:00'], ['extra_termina', '17:00'], ['salida', '18:00']])
    exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo, fecha: MIERCOLES, hora, motivo: 'Prueba de trampa' }), 'checada ' + tipo);
  let fila = (await pedir('GET', '/asistencia/dia?fecha=' + MIERCOLES, T.Gema))[1].filas.find(f => f.personal_id === ana.id);
  revisa(fila && fila.extra_min === 0, 'Apretar «Inicio/Fin de tiempo extra» dentro del horario (9:00–17:00) no suma tiempo extra', fila && fila.extra_min);
  exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo: 'extra_inicia', fecha: MIERCOLES, hora: '17:30', motivo: 'Prueba de trampa' }), 'extra 2');
  exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo: 'extra_termina', fecha: MIERCOLES, hora: '19:00', motivo: 'Prueba de trampa' }), 'extra 3');
  fila = (await pedir('GET', '/asistencia/dia?fecha=' + MIERCOLES, T.Gema))[1].filas.find(f => f.personal_id === ana.id);
  revisa(fila && fila.extra_min === 60, 'Un bloque 17:30–19:00 cuenta solo lo que pasa de su salida (18:00–19:00 = 60 min)', fila && fila.extra_min);
  for (const [tipo, hora] of [['extra_inicia', '07:00'], ['extra_termina', '08:00']])
    exigir(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo, fecha: MIERCOLES, hora, motivo: 'Prueba de trampa' }), 'extra temprano');
  fila = (await pedir('GET', '/asistencia/dia?fecha=' + MIERCOLES, T.Gema))[1].filas.find(f => f.personal_id === ana.id);
  revisa(fila && fila.extra_min === 120, 'Un bloque marcado antes de su entrada (7:00–8:00) sí cuenta: 60 + 60 = 120 min', fila && fila.extra_min);

  console.log('6. Intentos fallidos con foto');
  ip = '10.30.0.1'; // la red con la que se registró el kiosco
  const [s6, j6] = await kio(K1, 'POST', 'identificar', { codigo: pinDe[juan.id].codigo, pin: '0000' });
  revisa(s6 === 401 && typeof j6.intento === 'string' && j6.intento.length > 20, 'Un PIN malo responde como siempre y trae permiso para subir la foto', [s6, j6]);
  revisa((await kio(K1, 'POST', 'intento-foto', { intento: j6.intento, foto: 'no-es-foto' }))[0] === 400, 'Algo que no es foto se rechaza');
  const [s6b, j6b] = await kio(K1, 'POST', 'identificar', { codigo: '0000', pin: '1357' });
  revisa((await kio(K1, 'POST', 'intento-foto', { intento: j6b.intento, foto: FOTO }))[0] === 200, 'El kiosco sube la foto del intento', [s6b, j6b]);
  revisa((await kio(K1, 'POST', 'intento-foto', { intento: j6b.intento, foto: FOTO }))[0] === 401, 'El permiso sirve una sola vez');
  const [s6c, j6c] = await kio(K1, 'POST', 'identificar', { codigo: pinDe[ana.id].codigo, pin: '0001' });
  const K3 = exigir(await pedir('POST', '/asistencia/dispositivos', T.Gema, { nombre: 'Otra entrada', sucursal_id: qro.id }), 'kiosco 3').token;
  revisa((await kio(K3, 'POST', 'intento-foto', { intento: j6c.intento, foto: FOTO }))[0] === 401, 'Otro kiosco no puede usar ese permiso', s6c);
  const enDisco = conBase(d => d.prepare('SELECT foto_archivo FROM checador_intentos WHERE foto_archivo IS NOT NULL').all());
  revisa(enDisco.length === 1 && /\.cifrado$/.test(enDisco[0].foto_archivo), 'La foto queda cifrada en el disco', enDisco);
  const [si, li] = await pedir('GET', '/asistencia/intentos?fecha=' + HOY, T.Gema);
  revisa(si === 200 && li.some(i => i.persona === 'Juan Pérez Operador' && i.motivo === 'Código o PIN incorrecto') && li.some(i => i.codigo === '0000' && !i.persona && i.tiene_foto), 'La gerente ve los intentos: con el código de Juan, y con un código que no es de nadie (con foto)', li);
  revisa((await pedir('GET', '/asistencia/intentos?fecha=' + HOY, T.Gus))[1].length === 0, 'El gerente de CDMX no ve los intentos de Querétaro');
  const conFoto = li.find(i => i.tiene_foto);
  const [sfi, , tfi] = await pedir('GET', '/asistencia/intentos/' + conFoto.id + '/foto', T.Gema);
  revisa(sfi === 200 && tfi.length > 2000, 'La gerente abre la foto del intento', sfi);
  revisa((await pedir('GET', '/asistencia/intentos/' + conFoto.id + '/foto', T.Gus))[0] === 404, 'El de CDMX no la abre (no existe para él)');
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM auditoria WHERE detalle LIKE '%intento fallido%'").get().n) >= 1, 'Abrir la foto queda en la bitácora');
  revisa((await pedir('GET', '/rh/resumen', T.Gema))[1].intentos_hoy >= 3, 'El resumen de RH cuenta los intentos de hoy');
  revisa(conBase(d => { try { d.prepare('DELETE FROM checador_intentos').run(); return false; } catch { return true; } }), 'La base no deja borrar los intentos');

  console.log('7. Red de cada checada');
  const idR = exigir(await kio(K1, 'POST', 'identificar', { codigo: pinDe[juan.id].codigo, pin: PIN[juan.id] }), 'identificar');
  const c7 = exigir(await kio(K1, 'POST', 'checar', { ticket: idR.ticket, tipo: 'entrada', foto: FOTO }), 'checar desde su red');
  let ch = conBase(d => d.prepare('SELECT estado, observaciones, ip FROM checadas WHERE id = ?').get(c7.id));
  revisa(ch.estado === 'valida' && !ch.observaciones && ch.ip === '10.30.0.1', 'Desde la red de siempre: válida y con su IP guardada', ch);
  ip = '187.190.5.9'; // otra red (p. ej. la tableta se la llevaron a otro lado)
  const idR2 = exigir(await kio(K1, 'POST', 'identificar', { codigo: pinDe[juan.id].codigo, pin: PIN[juan.id] }), 'identificar');
  const c8 = exigir(await kio(K1, 'POST', 'checar', { ticket: idR2.ticket, tipo: 'comida_sale', foto: FOTO }), 'checar desde otra red');
  ch = conBase(d => d.prepare('SELECT estado, observaciones FROM checadas WHERE id = ?').get(c8.id));
  revisa(ch.estado === 'valida' && /otra red/.test(ch.observaciones || ''), 'Desde otra red: vale, pero con el aviso «desde otra red»', ch);
  revisa((await pedir('GET', '/rh/resumen', T.Gema))[1].otra_red >= 1, 'El resumen de RH cuenta las checadas desde otra red');
  let kl = (await pedir('GET', '/asistencia/dispositivos', T.Gema))[1].find(k => k.nombre === 'Entrada Querétaro');
  revisa(kl && kl.red_cambiada === 1, 'La lista de kioscos avisa que su última checada llegó desde otra red', kl);
  revisa((await pedir('POST', '/asistencia/dispositivos/' + kl.id + '/red', T.Gus))[0] === 404, 'El de CDMX no cambia la red de un kiosco de Querétaro');
  exigir(await pedir('POST', '/asistencia/dispositivos/' + kl.id + '/red', T.Gema), 'nueva red');
  kl = (await pedir('GET', '/asistencia/dispositivos', T.Gema))[1].find(k => k.nombre === 'Entrada Querétaro');
  revisa(kl.red_cambiada === 0, '«Es la nueva red de la oficina»: deja de avisar', kl);
  revisa(conBase(d => { try { d.prepare("UPDATE checadas SET ip = '1.1.1.1' WHERE id = ?").run(c7.id); return false; } catch { return true; } }), 'La IP de una checada no se puede cambiar en la base');

  console.log('8. Celular lejos de su sucursal');
  revisa((await pedir('PUT', '/asistencia/sucursales/' + qro.id + '/ubicacion', T.Gema, { ubicacion: '20.5888, -100.3899' }))[0] === 403, 'La gerente no captura la ubicación de la sucursal (solo Dirección)');
  revisa((await pedir('PUT', '/asistencia/sucursales/' + qro.id + '/ubicacion', A, { ubicacion: 'en el centro' }))[0] === 400, 'Una ubicación que no son números se rechaza');
  exigir(await pedir('PUT', '/asistencia/sucursales/' + qro.id + '/ubicacion', A, { ubicacion: '20.5888, -100.3899', radio_m: 500 }), 'ubicación de Querétaro');
  const enl = exigir(await pedir('POST', '/asistencia/personal/' + beto.id + '/celular', T.Gema), 'enlace de Beto');
  const cel = exigir(await pedir('POST', '/publico/celular/ligar', null, { enlace: enl.ruta.split('#e=')[1] }), 'ligar celular').token;
  const celu = (b) => pedir('POST', '/publico/celular/checar', null, { pin: PIN[beto.id], foto: FOTO, precision: 10, ...b }, { 'X-Celular': cel });
  const [sc1, jc1] = await celu({ tipo: 'entrada', lat: 20.5890, lon: -100.3901 });
  revisa(sc1 === 201 && !jc1.por_revisar, 'Cerca de la sucursal (unos metros): válida', [sc1, jc1]);
  const [sc2, jc2] = await celu({ tipo: 'comida_sale', lat: 20.6200, lon: -100.4100 });
  revisa(sc2 === 201 && /A \d+(\.\d)? km de la sucursal Querétaro/.test(jc2.por_revisar || ''), 'A unos kilómetros: «por revisar» con la distancia', [sc2, jc2]);
  const dist = conBase(d => d.prepare('SELECT distancia_m FROM checadas WHERE id = ?').get(jc2.id).distancia_m);
  revisa(dist > 3000 && dist < 5000, 'La distancia queda guardada en metros', dist);
  const [, rs] = await pedir('GET', '/rh/resumen', T.Gus);
  revisa(rs.sucursales_sin_ubicacion === 0, 'CDMX no tiene celulares ligados: no avisa que le falta ubicación', rs);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
