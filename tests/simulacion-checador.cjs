// RELOJ CHECADOR (F1, 2026-11-03): se ataca el kiosco y la administración de las checadas.
//  1. PIN: nunca en claro (ni en la base, ni en las respuestas, ni en la bitácora); temporal → la persona elige el suyo;
//     PINes obvios rechazados; mismo mensaje para código inexistente y PIN malo; bloqueo a los 5 y a los 10 fallos;
//     desbloqueo por RH; tope por kiosco.
//  2. Kiosco: sin token, con token inventado o revocado no checa; el ticket es de un solo uso, caduca y no sirve en
//     otro kiosco; al kiosco solo le llega el primer nombre y la hora (del servidor, en hora de México).
//  3. Checadas: doble toque no duplica; otra sucursal queda «por revisar»; a mano solo con motivo y nunca en el futuro;
//     anular con motivo; la base no deja borrar ni cambiar la hora (triggers).
//  4. Permisos y sucursales: sin «Ver asistencia» no ve checadas; otra sucursal «no existe».
//  5. F2: foto cifrada en disco (sin foto → «por revisar»), solo la ve quien ve la asistencia; checadas sin conexión
//     (PIN revisado al subir, hora calculada con la «edad», una sola vez aunque se reintente, «por revisar»); la cámara
//     solo se permite en /kiosco.
//  6. F5 celular: enlace de un solo uso que caduca, un celular por persona y solo para ella, PIN + selfie + ubicación
//     (sin ubicación o poco precisa → «por revisar»), tokens de kiosco y de celular no se cruzan, quitar el celular.
//  7. F6 privacidad: las fotos de más de 90 días se borran (archivo y referencia; la checada queda), salvo las «por
//     revisar»; solo Dirección lo corre a mano; aviso de privacidad publicado; aviso firmado en el expediente.
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
// Una «foto» JPEG de prueba con una marca para buscarla en el disco.
const MARCA_FOTO = 'FOTO-SECRETA-' + crypto.randomBytes(6).toString('hex');
const FOTO = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(MARCA_FOTO), crypto.randomBytes(3000), Buffer.from([0xff, 0xd9])]).toString('base64');
const archivosDe = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? archivosDe(path.join(d, e.name)) : [path.join(d, e.name)]);

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
  revisa(/^p1:[0-9a-f]{8}:[0-9a-f]{32}:[0-9a-f]{64}$/.test(crudo.pin_hash || '') && !Object.values(crudo).includes(altaJuan.pin), 'En la base el PIN está como hash con pimienta (sal + scrypt), no en claro', crudo.pin_hash);
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
  { const hasta = conBase(d => d.prepare('SELECT pin_bloqueado_hasta h FROM personal WHERE id = ?').get(juan.id).h), horas = (hasta - Date.now()) / 3600000;
    revisa(horas > 23 && horas <= 24, 'El bloqueo largo dura 24 h, no para siempre: quien sepa el código de otro no lo deja sin checar', { horas }); }
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/desbloquear', T.Valeria))[0] === 403, 'Ventas no desbloquea');
  exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/desbloquear', T.Gema), 'desbloquear');

  console.log('2. Kiosco');
  revisa((await kio(null, 'GET', 'estado'))[0] === 401, 'Sin token de kiosco no entra');
  revisa((await kio(crypto.randomBytes(32).toString('base64url'), 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN }))[0] === 401, 'Con un token inventado no entra');
  const [se, estado] = await kio(KQ, 'GET', 'estado');
  revisa(se === 200 && estado.fecha === HOY && /^\d\d:\d\d$/.test(estado.hora), 'El kiosco muestra la fecha y hora del servidor en hora de México', estado);
  const [, i1] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  const [sc, ch] = await kio(KQ, 'POST', 'checar', { ticket: i1.ticket, tipo: 'entrada', foto: FOTO });
  revisa(sc === 201 && ch.nombre === 'Juan' && ch.tipo === 'Entrada' && Object.keys(ch).sort().join() === 'avisos,hora,id,nombre,servicios,tipo' && Array.isArray(ch.servicios) && Array.isArray(ch.avisos), 'Checa su entrada; el kiosco solo recibe nombre corto, tipo, hora, sus servicios asignados (simulacion-mis-servicios) y sus avisos (simulacion-avisos)', ch);
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
  // Eliminar (2026-11-11): solo Dirección. Usado → sale de la lista y se conservan sus checadas; sin usar → se borra.
  revisa((await pedir('DELETE', '/asistencia/dispositivos/' + kmId, T.Gus))[0] === 403, 'El gerente no elimina kioscos (solo Dirección)');
  const [sEl, jEl] = await pedir('DELETE', '/asistencia/dispositivos/' + kmId, A);
  revisa(sEl === 200 && jEl.borrado === false, 'Dirección elimina un kiosco que ya se usó: no se borra de la base', [sEl, jEl]);
  revisa(!(await pedir('GET', '/asistencia/dispositivos', A))[1].some(x => x.id === kmId), 'Ya no sale en la lista de kioscos');
  revisa(conBase(d => d.prepare('SELECT COUNT(*) n FROM checadas WHERE dispositivo_id = ?').get(kmId).n) >= 1 && conBase(d => d.prepare('SELECT eliminado_por FROM checador_dispositivos WHERE id = ?').get(kmId).eliminado_por), 'Sus checadas se conservan y queda quién lo eliminó');
  revisa((await pedir('DELETE', '/asistencia/dispositivos/' + kmId, A))[0] === 404, 'Un kiosco eliminado no se elimina dos veces');
  const KX = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Tableta de prueba', sucursal_id: qro.id }), 'kiosco de prueba');
  revisa((await kio(KX.token, 'GET', 'estado'))[0] === 200, 'El kiosco de prueba entra');
  const [, jx] = await pedir('DELETE', '/asistencia/dispositivos/' + KX.id, A);
  revisa(jx.borrado === true && !conBase(d => d.prepare('SELECT 1 FROM checador_dispositivos WHERE id = ?').get(KX.id)), 'Un kiosco que nunca se usó se borra por completo', jx);
  revisa((await kio(KX.token, 'GET', 'estado'))[0] === 401, 'Eliminado, ya no puede checar al instante');
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'checador_dispositivo' AND accion = 'eliminar'").get().n) === 2, 'Queda en la bitácora');
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
  // Nadie se corrige a sí mismo (auditoría 2026-11-03): la gerente tiene su ficha ligada a su cuenta.
  { const gemaId = exigir(await pedir('GET', '/permisos/mios', T.Gema), 'mis permisos').usuario_id;
    const gema = exigir(await pedir('POST', '/personal', A, { nombre: 'Gema Gerente', puesto: 'Supervisor', sucursal_id: qro.id, usuario_id: gemaId }), 'ficha de Gema');
    const propio = r => r[0] === 403 && r[1]?.codigo === 'PROPIO';
    revisa(propio(await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: gema.id, tipo: 'entrada', fecha: ayer, hora: '08:30', motivo: 'Me la agrego yo' })), 'La gerente no se agrega checadas a sí misma');
    revisa(propio(await pedir('POST', '/asistencia/extra', T.Gema, { personal_id: gema.id, fecha: ayer, minutos: 0 })), 'Ni se autoriza su propio tiempo extra');
    revisa(propio(await pedir('POST', '/personal/' + gema.id + '/incidencias', T.Gema, { tipo: 'permiso', fecha_inicio: ayer })), 'Ni se registra sus propios permisos o vacaciones');
    const suya = exigir(await pedir('POST', '/asistencia/checadas', A, { personal_id: gema.id, tipo: 'entrada', fecha: ayer, hora: '08:40', motivo: 'Dirección se la agrega' }), 'Dirección sí corrige a la gerente');
    revisa(propio(await pedir('POST', '/asistencia/checadas/' + suya.id + '/anular', T.Gema, { motivo: 'No me gusta' })), 'Ni anula sus propias checadas');
    revisa((await pedir('POST', '/asistencia/checadas', T.Gema, { personal_id: ana.id, tipo: 'entrada', fecha: ayer, hora: '08:30', motivo: 'Olvidó checar' }))[0] === 201, 'A los demás sí los corrige'); }

  console.log('5. Foto, sin conexión y cámara');
  revisa(!!fila.foto_archivo && !archivosDe(dir).some(f => fs.readFileSync(f).includes(MARCA_FOTO)), 'La foto se guarda cifrada: su contenido no aparece en ningún archivo del servidor', fila.foto_archivo);
  const [sf, , , fotoBuf] = await (async () => { const x = await fetch(URLB + '/api/asistencia/checadas/' + ch.id + '/foto', { headers: { Authorization: 'Bearer ' + T.Gema } }); return [x.status, null, null, Buffer.from(await x.arrayBuffer())]; })();
  revisa(sf === 200 && fotoBuf.includes(MARCA_FOTO), 'La gerente ve la foto de la checada (descifrada)');
  revisa((await pedir('GET', '/asistencia/checadas/' + ch.id + '/foto', T.Valeria))[0] === 403, 'Ventas no ve la foto');
  revisa((await pedir('GET', '/asistencia/checadas/' + ch.id + '/foto', T.Gus))[0] === 404, 'El gerente de otra sucursal no ve la foto');
  revisa((await pedir('GET', '/auditoria?entidad=personal&id=' + juan.id, A))[2].includes('vio la foto'), 'Ver la foto queda en la bitácora');
  const [, i6] = await kio(KQ, 'POST', 'identificar', { codigo: altaJuan.codigo, pin: PIN });
  const [, ch6] = await kio(KQ, 'POST', 'checar', { ticket: i6.ticket, tipo: 'comida_regresa', foto: 'data:image/jpeg;base64,bm8gZXMgdW5hIGZvdG8=' });
  revisa(ch6.sin_foto && conBase(d => d.prepare('SELECT estado, observaciones FROM checadas WHERE id = ?').get(ch6.id)).estado === 'por_revisar', 'Sin foto (o con algo que no es foto) la checada queda «por revisar»', ch6);
  // Sin conexión: hace 2 horas, con el reloj interno del kiosco.
  const uid1 = crypto.randomBytes(15).toString('base64url'), hace = 2 * 3600000;
  const [so, off] = await kio(KQ, 'POST', 'sin-conexion', { uid: uid1, codigo: altaJuan.codigo, pin: PIN, tipo: 'salida', foto: FOTO, edad_ms: hace, monotonica: true, hora_dispositivo: new Date(Date.now() - hace).toISOString() });
  const fo = conBase(d => d.prepare('SELECT * FROM checadas WHERE id = ?').get(off.id) || {});
  revisa(so === 201 && fo.sin_conexion === 1 && fo.estado === 'por_revisar' && Math.abs(Date.parse(fo.momento_utc) - (Date.now() - hace)) < 60000 && /reloj interno/.test(fo.observaciones), 'Checada sin conexión: se sube con la hora de cuando se hizo y queda «por revisar»', { off, fo });
  const [, rep2] = await kio(KQ, 'POST', 'sin-conexion', { uid: uid1, codigo: altaJuan.codigo, pin: PIN, tipo: 'salida', foto: FOTO, edad_ms: hace + 30000, monotonica: true });
  revisa(rep2.repetida && rep2.id === off.id && conBase(d => d.prepare('SELECT COUNT(*) n FROM checadas WHERE uid_kiosco = ?').get(uid1).n) === 1, 'Si el kiosco la reintenta, no se duplica', rep2);
  const [sw, jw] = await kio(KQ, 'POST', 'sin-conexion', { uid: crypto.randomBytes(15).toString('base64url'), codigo: altaJuan.codigo, pin: '0000', tipo: 'entrada', edad_ms: 1000 });
  revisa(sw === 401 && jw.descartar, 'Sin conexión con PIN equivocado: se rechaza al subir (y el kiosco la descarta)', jw);
  const [sv, jv] = await kio(KQ, 'POST', 'sin-conexion', { uid: crypto.randomBytes(15).toString('base64url'), codigo: altaJuan.codigo, pin: PIN, tipo: 'entrada', edad_ms: 8 * 86400000 });
  revisa(sv === 400 && jv.descartar, 'Una checada guardada de hace más de 7 días no se acepta (se registra a mano con motivo)', jv);
  revisa((await kio(KQ, 'POST', 'sin-conexion', { uid: crypto.randomBytes(15).toString('base64url'), codigo: altaJuan.codigo, pin: PIN, tipo: 'entrada', edad_ms: -5000 }))[0] === 400, 'Una «edad» negativa (hora en el futuro) no se acepta');
  const altaNueva = exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/pin', T.Gema), 'PIN temporal nuevo');
  const [st2, jt2] = await kio(KQ, 'POST', 'sin-conexion', { uid: crypto.randomBytes(15).toString('base64url'), codigo: altaJuan.codigo, pin: altaNueva.pin, tipo: 'entrada', edad_ms: 1000 });
  revisa(st2 === 409 && jt2.descartar, 'Con PIN temporal no se acepta sin conexión (el PIN se elige con internet)', jt2);
  revisa(!conBase(d => d.prepare("SELECT 1 FROM checadas WHERE momento_utc > ?").get(new Date(Date.now() + 60000).toISOString())), 'Ninguna checada quedó en el futuro');
  const hk = await fetch(URLB + '/kiosco'), hi = await fetch(URLB + '/');
  revisa(hk.status === 200 && /camera=\(self\)/.test(hk.headers.get('permissions-policy')) && /camera=\(\)/.test(hi.headers.get('permissions-policy')), 'La cámara solo se permite en la página del kiosco', [hk.headers.get('permissions-policy'), hi.headers.get('permissions-policy')]);
  revisa(!salida.includes(PIN + '"') && !salida.includes(altaJuan.pin + '"'), 'Los PINes no salen en el registro del servidor');


  console.log('6. Celular');
  const cel = (tk, m, r, b) => pedir(m, '/publico/celular/' + r, null, b, tk ? { 'X-Celular': tk } : {});
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/celular', T.Valeria))[0] === 403, 'Ventas no genera enlaces para el celular');
  revisa((await pedir('POST', '/asistencia/personal/' + mx.id + '/celular', T.Gema))[0] === 404, 'La gerente no genera enlace para alguien de otra sucursal');
  revisa((await pedir('POST', '/asistencia/personal/' + mx.id + '/celular', T.Gus))[0] === 409, 'Sin alta en el checador no hay enlace');
  const [se1, en1] = await pedir('POST', '/asistencia/personal/' + juan.id + '/celular', T.Gema);
  const tok1 = String(en1.ruta || '').split('#e=')[1];
  revisa(se1 === 200 && /^\/checar#e=[\w-]{40,}$/.test(en1.ruta) && (en1.url === null || en1.url.endsWith(en1.ruta)) && !conBase(d => d.prepare('SELECT 1 FROM checador_enlaces WHERE token_hash = ?').get(tok1)), 'RH genera el enlace (va después de «#») y la base guarda solo su hash', en1);
  const [, en2] = await pedir('POST', '/asistencia/personal/' + juan.id + '/celular', T.Gema), tok2 = en2.ruta.split('#e=')[1];
  revisa((await cel(null, 'POST', 'ligar', { enlace: tok1 }))[0] === 401, 'Al generar otro enlace, el anterior deja de servir');
  const [sl, lig] = await cel(null, 'POST', 'ligar', { enlace: tok2 });
  revisa(sl === 200 && lig.token && lig.nombre === 'Juan', 'Con el enlace, el celular queda ligado a Juan', lig);
  revisa((await cel(null, 'POST', 'ligar', { enlace: tok2 }))[0] === 401, 'El enlace sirve una sola vez');
  const [, en3] = await pedir('POST', '/asistencia/personal/' + juan.id + '/celular', T.Gema), tok3 = en3.ruta.split('#e=')[1];
  conBase(d => d.prepare('UPDATE checador_enlaces SET expira_ms = 1 WHERE usado_at IS NULL').run());
  revisa((await cel(null, 'POST', 'ligar', { enlace: tok3 }))[0] === 401, 'Un enlace de más de 24 horas ya no sirve');
  const C1 = lig.token;
  revisa((await kio(C1, 'GET', 'estado'))[0] === 401 && (await cel(KQ, 'GET', 'estado'))[0] === 401, 'El token del celular no sirve como kiosco, ni el del kiosco como celular');
  const [, est1] = await cel(C1, 'GET', 'estado');
  revisa(est1.nombre === 'Juan' && est1.pin_temporal === true, 'El celular saluda a Juan y sabe que tiene PIN temporal', est1);
  revisa((await cel(C1, 'POST', 'checar', { pin: altaNueva.pin, tipo: 'entrada' }))[1].codigo === 'PIN_TEMPORAL', 'Con PIN temporal pide elegir su PIN antes de checar');
  revisa((await cel(C1, 'POST', 'cambiar-pin', { pin: altaNueva.pin, nuevo: '1234' }))[0] === 400, 'Desde el celular tampoco acepta un PIN obvio');
  exigir(await cel(C1, 'POST', 'cambiar-pin', { pin: altaNueva.pin, nuevo: '8261' }), 'elegir PIN desde el celular');
  revisa((await cel(C1, 'POST', 'checar', { pin: '0000', tipo: 'entrada', foto: FOTO, lat: 20.5888, lon: -100.3899, precision: 15 }))[0] === 401, 'Con PIN equivocado no checa');
  const [scel1, cel1] = await cel(C1, 'POST', 'checar', { pin: '8261', tipo: 'extra_inicia', foto: FOTO, lat: 20.5888123, lon: -100.3899456, precision: 15 });
  const fc1 = conBase(d => d.prepare('SELECT * FROM checadas WHERE id = ?').get(cel1.id) || {});
  revisa(scel1 === 201 && fc1.origen === 'celular' && fc1.estado === 'valida' && fc1.lat === 20.588812 && fc1.lon === -100.389946 && fc1.precision_m === 15 && !!fc1.foto_archivo && Math.abs(Date.parse(fc1.momento_utc) - Date.now()) < 60000,
    'Con PIN, selfie y ubicación precisa queda válida, con hora del servidor y su ubicación', fc1);
  const [, cel2] = await cel(C1, 'POST', 'checar', { pin: '8261', tipo: 'extra_termina', foto: FOTO });
  revisa(/Sin ubicación/.test(conBase(d => d.prepare('SELECT observaciones FROM checadas WHERE id = ?').get(cel2.id).observaciones)) && cel2.por_revisar, 'Sin ubicación queda «por revisar»', cel2);
  const [, cel3] = await cel(C1, 'POST', 'checar', { pin: '8261', tipo: 'salida', foto: FOTO, lat: 20.6, lon: -100.4, precision: 900 });
  revisa(/poco precisa/.test(cel3.por_revisar || ''), 'Con ubicación poco precisa (900 m) queda «por revisar»', cel3);
  const [, lista2] = await pedir('GET', '/asistencia/checadas?fecha=' + HOY + '&personal_id=' + juan.id, T.Gema);
  revisa(lista2.some(c => c.id === cel1.id && c.lat === 20.588812), 'La gerente ve la ubicación de la checada');
  // Ligar otro celular: el primero deja de servir. Quitar celular: tampoco sirve.
  const [, en4] = await pedir('POST', '/asistencia/personal/' + juan.id + '/celular', T.Gema), [, lig2] = await cel(null, 'POST', 'ligar', { enlace: en4.ruta.split('#e=')[1] });
  revisa((await cel(C1, 'GET', 'estado'))[0] === 401 && (await cel(lig2.token, 'GET', 'estado'))[0] === 200, 'Al ligar otro celular, el anterior ya no sirve');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/celular/quitar', T.Valeria))[0] === 403, 'Ventas no quita celulares');
  exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/celular/quitar', T.Gema), 'quitar celular');
  revisa((await cel(lig2.token, 'POST', 'checar', { pin: '8261', tipo: 'entrada', foto: FOTO }))[0] === 401, 'Un celular quitado ya no checa');
  const hc = await fetch(URLB + '/checar');
  revisa(hc.status === 200 && /camera=\(self\)/.test(hc.headers.get('permissions-policy')) && /geolocation=\(self\)/.test(hc.headers.get('permissions-policy')), 'La página del celular es la única con cámara y ubicación', hc.headers.get('permissions-policy'));

  console.log('7. Privacidad');
  // Se «envejecen» dos checadas con foto: una válida/anulada (se borra) y una por revisar (se conserva).
  const conFoto = conBase(d => d.prepare("SELECT id, foto_archivo FROM checadas WHERE id IN (?, ?)").all(ch.id, off.id));
  conBase(d => { d.exec('DROP TRIGGER checadas_no_cambiar'); d.prepare("UPDATE checadas SET fecha = '2020-01-01' WHERE id IN (?, ?)").run(ch.id, off.id); });
  revisa((await pedir('POST', '/asistencia/fotos/limpiar', T.Gema))[0] === 403, 'Solo Dirección corre a mano el borrado de fotos');
  const [sb3, lim] = await pedir('POST', '/asistencia/fotos/limpiar', A);
  const tras = conBase(d => d.prepare('SELECT id, foto_archivo, foto_borrada_at, estado FROM checadas WHERE id IN (?, ?)').all(ch.id, off.id));
  const borrada = tras.find(x => x.id === ch.id), conservada = tras.find(x => x.id === off.id), archivo = conFoto.find(x => x.id === ch.id).foto_archivo;
  revisa(sb3 === 200 && lim.dias === 90 && !borrada.foto_archivo && borrada.foto_borrada_at && !fs.existsSync(path.join(dir, 'archivos', 'checadas', archivo)), 'Una foto de más de 90 días se borra (archivo incluido) y la checada se queda', { lim, borrada });
  revisa(conservada.foto_archivo && conservada.estado === 'por_revisar', 'Una foto de una checada «por revisar» se conserva hasta revisarla', conservada);
  revisa((await pedir('GET', '/asistencia/checadas/' + ch.id + '/foto', T.Gema))[0] === 404, 'La foto borrada ya no se puede ver');
  const av = await fetch(URLB + '/aviso-privacidad-checador.html');
  revisa(av.status === 200 && /consentimiento expreso/i.test(await av.text()), 'El aviso de privacidad está publicado');
  revisa((await pedir('GET', '/asistencia/personal/' + juan.id, T.Gema))[1].aviso_firmado === false, 'La ficha avisa que falta el aviso firmado');
  { const x = await fetch(URLB + '/api/personal/' + juan.id + '/documentos', { method: 'POST', headers: { Authorization: 'Bearer ' + T.Gema, 'Content-Type': 'application/octet-stream', 'X-Tipo': 'privacidad', 'X-Nombre': encodeURIComponent('aviso-juan.pdf') }, body: Buffer.from('%PDF-1.4 aviso firmado ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF') }); revisa(x.status === 201, 'Se sube el aviso firmado al expediente'); }
  revisa((await pedir('GET', '/asistencia/personal/' + juan.id, T.Gema))[1].aviso_firmado === true, 'Con el aviso firmado en el expediente, la alerta desaparece');

  // Diagnóstico del kiosco (2026-11-11): lo que su vigilante recuperó llega a los Logs del sistema de Dirección.
  revisa((await kio(null, 'POST', 'diagnostico', { eventos: [{ t: new Date().toISOString(), m: 'pantalla vacía' }] }))[0] === 401, 'Sin token de kiosco no se aceptan diagnósticos');
  revisa((await kio(KQ, 'POST', 'diagnostico', {}))[0] === 400, 'Un diagnóstico sin eventos se rechaza');
  revisa((await kio(KQ, 'POST', 'diagnostico', { eventos: [{ t: new Date().toISOString(), m: 'pantalla vacía <script>alert(1)</script>' }, { m: '' }] }))[0] === 200, 'El kiosco manda lo que su vigilante recuperó');
  const logK = ((await pedir('GET', '/registro-sistema?q=Kiosco', A))[1].filas || []).filter(f => f.evento === 'kiosco_recuperado');
  revisa(logK.length === 1 && /pantalla vacía/.test(JSON.stringify(logK[0])) && !/[<>]/.test(logK[0].detalle || ''), 'Dirección lo ve en los Logs del sistema (un renglón, sin símbolos raros)', logK);
  for (let i = 0; i < 5; i++) await kio(KQ, 'POST', 'diagnostico', { eventos: Array.from({ length: 10 }, (_, k) => ({ m: 'prueba ' + i + '-' + k })) });
  revisa(((await pedir('GET', '/registro-sistema?q=Kiosco', A))[1].filas || []).length <= 31, 'Tope de 30 diagnósticos por kiosco por hora');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
