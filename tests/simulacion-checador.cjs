// RELOJ CHECADOR (F1, 2026-11-03): se ataca el kiosco y la administración de las checadas.
//  1. PIN: nunca en claro (ni en la base, ni en las respuestas, ni en la bitácora); temporal → la persona elige el suyo;
//     PINes obvios rechazados; mismo mensaje para código inexistente y PIN malo; bloqueo a los 5 y a los 10 fallos;
//     desbloqueo por RH; tope por kiosco.
//  2. Kiosco: sin token, con token inventado o revocado no checa; el ticket es de un solo uso, caduca y no sirve en
//     otro kiosco; al kiosco solo le llega el primer nombre y la hora (del servidor, en hora de México).
//  3. Checadas: doble toque no duplica; otra sucursal queda «por revisar»; a mano solo con motivo y nunca en el futuro;
//     anular con motivo; la base no deja borrar ni cambiar la hora (triggers).
//  4. Permisos y sucursales: sin «Ver asistencia» no ve checadas; otra sucursal «no existe».
// Uso: node tests/simulacion-checador.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-checador-')), DB = path.join(dir, 'checador.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Checador-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Checador-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9100 + Math.floor(Math.random() * 300)), URLB = 'http://localhost:' + PUERTO;
const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
let ipFalsa = 0;
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.0.' + (1 + (ipFalsa % 250)), ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const kio = (tk, m, r, b) => pedir(m, '/publico/kiosco/' + r, null, b, tk ? { 'X-Kiosco': tk } : {});
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

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
  const juan = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Juan Pérez Operador', puesto: 'Operador' }), 'alta de Juan');
  const ana = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Ana López Admin', puesto: 'Administración' }), 'alta de Ana');
  const mx = exigir(await pedir('POST', '/personal', T.Gus, { nombre: 'Mario CDMX', puesto: 'Técnico' }), 'alta en CDMX');

  console.log('1. PIN');
  const [sp, altaJuan] = await pedir('POST', '/asistencia/personal/' + juan.id + '/pin', T.Gema);
  revisa(sp === 200 && /^\d{4}$/.test(altaJuan.codigo) && /^\d{4}$/.test(altaJuan.pin), 'RH da de alta en el checador: código y PIN temporal de 4 dígitos', altaJuan);
  const altaAna = exigir(await pedir('POST', '/asistencia/personal/' + ana.id + '/pin', T.Gema), 'PIN de Ana');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/pin', T.Valeria))[0] === 403, 'Ventas no puede dar PINes');
  revisa((await pedir('POST', '/asistencia/personal/' + mx.id + '/pin', T.Gema))[0] === 404, 'La gerente de Querétaro no da PIN a alguien de CDMX (no existe para ella)');
  const crudo = conBase(d => d.prepare('SELECT * FROM personal WHERE id = ?').get(juan.id));
  revisa(crudo.pin_hash && !crudo.pin_hash.includes(altaJuan.pin) && crudo.pin_hash.startsWith('p1:'), 'En la base el PIN está como hash con pimienta, no en claro');
  const [, ficha, fichaTxt] = await pedir('GET', '/personal/' + juan.id, A), [, lista] = await pedir('GET', '/personal', A, undefined);
  revisa(!('pin_hash' in ficha) && !fichaTxt.includes(crudo.pin_hash) && !JSON.stringify(lista).includes('p1:'), 'La ficha y la lista del personal nunca mandan el hash del PIN');
  const [, bita] = await pedir('GET', '/auditoria?entidad=personal&id=' + juan.id, A);
  revisa(!JSON.stringify(bita).includes(altaJuan.pin) || altaJuan.pin === altaJuan.codigo, 'La bitácora no guarda el PIN', bita);

  // Kiosco de Querétaro.
  const [sk, k1] = await pedir('POST', '/asistencia/dispositivos', T.Gema, { nombre: 'Entrada Querétaro', sucursal_id: qro.id });
  revisa(sk === 201 && k1.token?.length >= 40, 'La gerente registra el kiosco y recibe su token una sola vez', k1);
  revisa(!conBase(d => d.prepare('SELECT 1 FROM checador_dispositivos WHERE token_hash = ?').get(k1.token)), 'La base guarda solo el hash del token del kiosco');
  revisa((await pedir('POST', '/asistencia/dispositivos', T.Gema, { nombre: 'Otro', sucursal_id: cdmx.id }))[0] === 400, 'No registra kioscos en una sucursal que no es suya');
  revisa((await pedir('POST', '/asistencia/dispositivos', T.Valeria, { nombre: 'Tableta de Valeria', sucursal_id: qro.id }))[0] === 403, 'Ventas no registra kioscos');
  const KQ = k1.token;

  const [s0, id0] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: altaJuan.pin });
  revisa(s0 === 200 && id0.cambiar_pin && id0.ticket && id0.nombre === 'Juan', 'Con el PIN temporal, el kiosco pide elegir uno nuevo (solo dice «Juan»)', id0);
  let tk = id0.ticket;
  for (const debil of ['1111', '1234', '4321', '1212', altaJuan.codigo]) {
    const [s, j] = await kio(KQ, 'POST', 'cambiar-pin', { ticket: tk, nuevo: debil }); tk = j.ticket;
    revisa(s === 400, `Rechaza el PIN obvio ${debil}`, j);
  }
  const PIN = altaJuan.codigo === '3958' ? '3957' : '3958';
  const [s1, c1] = await kio(KQ, 'POST', 'cambiar-pin', { ticket: tk, nuevo: PIN });
  revisa(s1 === 200 && c1.sugerido === 'entrada' && c1.ticket, 'Elige su PIN y el kiosco sugiere «Entrada»', c1);
  revisa((await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: altaJuan.pin }))[0] === 401, 'El PIN temporal ya no sirve');
  const [, noExiste] = await kio(KQ, 'POST', 'identificar', { codigo: '0000', pin: '5555' }), [, malo] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: '0000' });
  revisa(noExiste.error === malo.error && malo.error === 'Código o PIN incorrecto', 'Mismo mensaje si el código no existe o si el PIN está mal');
  // Bloqueo: ya lleva 2 fallos (temporal y 0000); 3 más → 15 min.
  for (let i = 0; i < 3; i++) await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: '0000' });
  const [sb, jb] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  revisa(sb === 423 && /minuto/.test(jb.error), 'A los 5 fallos se bloquea 15 minutos, aunque luego ponga el PIN correcto', jb);
  conBase(d => d.prepare('UPDATE personal SET pin_bloqueado_hasta = 1 WHERE id = ?').run(juan.id)); // «pasan» los 15 min
  for (let i = 0; i < 5; i++) await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: '0000' });
  const [sb2, jb2] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  revisa(sb2 === 423 && /RH/.test(jb2.error), 'A los 10 fallos queda bloqueado hasta que RH lo desbloquee', jb2);
  const [, est] = await pedir('GET', '/asistencia/personal/' + juan.id, T.Gema);
  revisa(est.bloqueado && est.bloqueo_total && !('pin_hash' in est), 'RH ve que está bloqueado (sin ver el PIN)', est);
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/desbloquear', T.Valeria))[0] === 403, 'Ventas no desbloquea');
  exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/desbloquear', T.Gema), 'desbloquear');

  console.log('2. Kiosco');
  revisa((await kio(null, 'GET', 'estado'))[0] === 401, 'Sin token de kiosco no entra');
  revisa((await kio(crypto.randomBytes(32).toString('base64url'), 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN }))[0] === 401, 'Con un token inventado no entra');
  const [se, estado] = await kio(KQ, 'GET', 'estado');
  revisa(se === 200 && estado.fecha === HOY && /^\d\d:\d\d$/.test(estado.hora), 'El kiosco muestra la fecha y hora del servidor en hora de México', estado);
  const [, i1] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  const [sc, ch] = await kio(KQ, 'POST', 'checar', { ticket: i1.ticket, tipo: 'entrada' });
  revisa(sc === 201 && ch.nombre === 'Juan' && ch.tipo === 'Entrada' && Object.keys(ch).sort().join() === 'hora,id,nombre,tipo', 'Checa su entrada; el kiosco solo recibe nombre corto, tipo y hora', ch);
  const fila = conBase(d => d.prepare('SELECT * FROM checadas WHERE id = ?').get(ch.id));
  const ahoraMx = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  revisa(fila.fecha === HOY && fila.hora.slice(0, 5) <= ahoraMx && Math.abs(Date.parse(fila.momento_utc) - Date.now()) < 60000 && fila.estado === 'valida', 'Se guarda con la hora del servidor (UTC y hora de México)', fila);
  revisa((await kio(KQ, 'POST', 'checar', { ticket: i1.ticket, tipo: 'salida' }))[0] === 401, 'El ticket es de un solo uso');
  const [, i2] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  revisa(i2.sugerido === 'comida_sale' && i2.ultima?.tipo === 'Entrada', 'Después de la entrada sugiere «Salida a comer»', i2);
  const [, dup] = await kio(KQ, 'POST', 'checar', { ticket: i2.ticket, tipo: 'entrada' });
  revisa(dup.repetida && dup.id === ch.id && conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE personal_id = ? AND tipo = 'entrada'").get(juan.id).n) === 1, 'Doble toque: la misma checada en menos de 2 minutos no se duplica', dup);
  // Otro kiosco (CDMX): el ticket de Querétaro no sirve ahí; y Juan checando en CDMX queda por revisar.
  const KM = exigir(await pedir('POST', '/asistencia/dispositivos', T.Gus, { nombre: 'Entrada CDMX', sucursal_id: cdmx.id }), 'kiosco CDMX').token;
  const [, i3] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  revisa((await kio(KM, 'POST', 'checar', { ticket: i3.ticket, tipo: 'comida_sale' }))[0] === 401, 'Un ticket de un kiosco no sirve en otro');
  const [, i4] = await kio(KM, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  const [, ch4] = await kio(KM, 'POST', 'checar', { ticket: i4.ticket, tipo: 'comida_sale' });
  revisa(conBase(d => d.prepare('SELECT estado FROM checadas WHERE id = ?').get(ch4.id)?.estado) === 'por_revisar', 'Si checa en un kiosco de otra sucursal, queda «por revisar»', ch4);
  // Tope por kiosco: 20 fallos en 10 minutos.
  for (let i = 0; i < 20; i++) await kio(KM, 'POST', 'identificar', { codigo: '0' + String(100 + i), pin: '9999' });
  revisa((await kio(KM, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN }))[0] === 429, 'A los 20 fallos en 10 minutos el kiosco se pausa');
  // Revocar: el kiosco deja de checar.
  const kmId = (await pedir('GET', '/asistencia/dispositivos', T.Gus))[1].find(x => x.nombre === 'Entrada CDMX').id;
  revisa((await pedir('POST', '/asistencia/dispositivos/' + kmId + '/revocar', T.Gema))[0] === 404, 'La gerente de Querétaro no ve ni revoca el kiosco de CDMX');
  exigir(await pedir('POST', '/asistencia/dispositivos/' + kmId + '/revocar', T.Gus), 'revocar kiosco');
  revisa((await kio(KM, 'GET', 'estado'))[0] === 401, 'Un kiosco dado de baja ya no entra');
  // Persona dada de baja: ya no checa.
  const [, iA] = await kio(KQ, 'POST', 'identificar', { codigo: altaAna.codigo, pin: altaAna.pin });
  const [, cA] = await kio(KQ, 'POST', 'cambiar-pin', { ticket: iA.ticket, nuevo: '5072' });
  exigir(await pedir('POST', '/personal/' + ana.id + '/baja', T.Gema, { motivo: 'Renuncia voluntaria' }), 'baja de Ana');
  revisa((await kio(KQ, 'POST', 'checar', { ticket: cA.ticket, tipo: 'entrada' }))[0] === 401 && (await kio(KQ, 'POST', 'identificar', { codigo: altaAna.codigo, pin: '5072' }))[0] === 403, 'Una persona dada de baja ya no checa');

  console.log('3. Checadas');
  const [, hoyLista] = await pedir('GET', '/asistencia/checadas?fecha=' + HOY, T.Gema);
  revisa(Array.isArray(hoyLista) && hoyLista.some(c => c.id === ch.id), 'La gerente ve las checadas del día', hoyLista);
  revisa((await pedir('GET', '/asistencia/checadas', T.Valeria))[0] === 403, 'Ventas no ve la asistencia');
  revisa(!(await pedir('GET', '/asistencia/checadas?fecha=' + HOY, T.Gus))[1].some(c => c.personal_id === juan.id), 'El gerente de CDMX no ve las checadas de alguien de Querétaro');
  revisa((await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: juan.id, tipo: 'salida', fecha: HOY, hora: '08:00' }))[0] === 400, 'Agregar a mano sin motivo: no');
  revisa((await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: juan.id, tipo: 'salida', fecha: '2099-01-01', hora: '08:00', motivo: 'Prueba del futuro' }))[0] === 400, 'Agregar a mano en el futuro: no');
  const ayer = new Date(Date.parse(HOY + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const [sm, man] = await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: juan.id, tipo: 'salida', fecha: ayer, hora: '18:32', motivo: 'Se le olvidó checar la salida' });
  revisa(sm === 201 && conBase(d => d.prepare('SELECT momento_utc FROM checadas WHERE id = ?').get(man.id).momento_utc) === new Date(ayer + 'T18:32:00-06:00').toISOString(), 'Agrega una salida olvidada de ayer con motivo (hora de México → UTC)', man);
  revisa((await pedir('POST', '/asistencia/checadas/' + ch.id + '/anular', T.Valeria, { motivo: 'Intento' }))[0] === 403, 'Ventas no anula checadas');
  revisa((await pedir('POST', '/asistencia/checadas/' + ch.id + '/anular', T.Gema, {}))[0] === 400, 'Anular sin motivo: no');
  exigir(await pedir('POST', '/asistencia/checadas/' + ch.id + '/anular', T.Gema, { motivo: 'Checó por error' }), 'anular');
  revisa((await pedir('POST', '/asistencia/checadas/' + ch.id + '/anular', T.Gema, { motivo: 'Otra vez' }))[0] === 409, 'Una anulada no se vuelve a anular');
  const [, hist] = await pedir('GET', '/asistencia/checadas/' + ch.id + '/correcciones', T.Gema);
  revisa(hist.length === 1 && hist[0].accion === 'anular' && hist[0].motivo === 'Checó por error' && hist[0].usuario_nombre === 'Gema Gerente', 'La corrección queda con motivo, quién y cuándo', hist);
  exigir(await pedir('POST', '/asistencia/checadas/' + ch4.id + '/aceptar', T.Gema, { motivo: 'Fue a apoyar a CDMX' }), 'aceptar por revisar');
  const intento = sql => { try { conBase(d => d.exec(sql)); return false; } catch { return true; } };
  revisa(intento('DELETE FROM checadas'), 'La base no deja borrar checadas');
  revisa(intento(`UPDATE checadas SET hora = '07:00:00' WHERE id = ${man.id}`), 'La base no deja cambiar la hora de una checada');
  revisa(intento(`UPDATE checadas SET estado = 'valida' WHERE id = ${ch.id}`), 'Una checada anulada no se «revive» a mano');
  revisa(intento('DELETE FROM checadas_correcciones') && intento("UPDATE checadas_correcciones SET motivo = 'otro motivo'"), 'La bitácora de correcciones no se borra ni se cambia');
  revisa(conBase(d => d.prepare('SELECT COUNT(*) n FROM checadas').get().n) === 3, 'Siguen todas las checadas (incluida la anulada)');
  revisa(!salida.includes(PIN + '"') && !salida.includes(altaJuan.pin + '"'), 'Los PINes no salen en el registro del servidor');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
