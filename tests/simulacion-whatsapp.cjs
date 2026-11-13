// CHECAR POR WHATSAPP (F5b, 2026-11-05): se simula Meta con un servidor falso (recibe lo que el bot manda) y se
// mandan al webhook mensajes firmados como los manda Meta.
//  1. Webhook: verificación con el token correcto; sin firma, con firma falsa o sin configurar → nada se procesa.
//  2. Quién: número no autorizado, no activado por RH, dado de baja o repetido en dos fichas → no checa (y se le avisa).
//  3. Flujo: cualquier texto → menú (lista, máx. 10 filas, títulos ≤ 24); elegir → checada «por revisar», origen
//     WhatsApp, sin foto ni ubicación, con aviso de confirmación; el mismo mensaje reenviado no duplica; doble toque no
//     duplica; un mensaje que llega tarde usa la hora en que se mandó (y se anota el retraso); tope de mensajes por número;
//     un número de otro país con los mismos 10 dígitos no checa; un mensaje a otro número de la app de Meta se ignora.
//  4. Activar: solo quien edita el personal, de su sucursal, nunca para sí mismo; exige celular de 10 dígitos y alta en
//     el checador; el mismo celular no puede estar en dos personas.
// Uso: node tests/simulacion-whatsapp.cjs
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-whatsapp-')), DB = path.join(dir, 'wa.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'WhatsApp-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Wa-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9950 + Math.floor(Math.random() * 40)), URLB = 'http://localhost:' + PUERTO;
const SECRETO = crypto.randomBytes(16).toString('hex'), VERIF = 'frase-' + crypto.randomBytes(6).toString('hex');
// Meta falso: guarda lo que el bot envía.
const enviados = [];
// Fotos (2026-11-13): GET /v27.0/MEDIA_OK da la dirección de la foto; /descarga/foto.jpg la entrega (con el token).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
const meta = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  if (req.method === 'GET') {
    const bueno = req.headers.authorization === 'Bearer token-de-prueba';
    if (/^\/v27\.0\/MEDIA_OK\?/.test(req.url) && bueno) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ url: 'http://localhost:' + meta.address().port + '/descarga/foto.jpg', mime_type: 'image/jpeg', file_size: JPEG.length })); }
    if (req.url === '/descarga/foto.jpg' && bueno) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(JPEG); }
    res.writeHead(404); return res.end('{}');
  }
  try { enviados.push({ url: req.url, auth: req.headers.authorization, cuerpo: JSON.parse(b) }); } catch { /* */ } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"messages":[{"id":"wamid.salida"}]}'); }); });
let srv, salida = '';
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let sec = 0;
const msj = (de, extra, ts = Math.floor(Date.now() / 1000)) => ({ from: de, id: 'wamid.' + (++sec) + crypto.randomBytes(4).toString('hex'), timestamp: String(ts), ...extra });
const cuerpoDe = (mensajes, telefonoId = '106540352242922') => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: telefonoId }, messages: mensajes } }] }] });
const webhook = async (mensajes, { firma = true, secreto = SECRETO, telefonoId } = {}) => {
  const cuerpo = cuerpoDe(mensajes, telefonoId), f = 'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');
  const r = await fetch(URLB + '/api/publico/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(firma ? { 'X-Hub-Signature-256': f } : {}) }, body: cuerpo });
  await espera(250); return r.status;
};
const texto = (de, body, ts) => msj(de, { type: 'text', text: { body } }, ts);
const elige = (de, tipo, ts) => msj(de, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'checar:' + tipo, title: tipo } } }, ts);
let n = 0; const malos = [];
const revisa = (cond, t, extra) => { n++; if (!cond) { malos.push(t); console.log('  ✘ ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + t); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const ultimo = () => enviados[enviados.length - 1];

(async () => {
  await new Promise(ok => meta.listen(0, ok));
  const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex'),
    WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_PHONE_ID: '106540352242922', WHATSAPP_VERIFY_TOKEN: VERIF, WHATSAPP_APP_SECRET: SECRETO, WHATSAPP_API_URL: 'http://localhost:' + meta.address().port + '/v27.0', WHATSAPP_ESPERA_MS: '3000', WHATSAPP_REVISAR_MS: '400' };
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const T = {}, U = {};
  for (const [nombre, rol, s] of [['Gema Gerente', 'gerente', qro.id], ['Valeria Ventas', 'ventas', qro.id], ['Gus GerenteMx', 'gerente', cdmx.id]]) {
    U[nombre.split(' ')[0]] = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), 'crear ' + nombre);
    T[nombre.split(' ')[0]] = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  }
  require('./ligar-fichas.cjs')(DB, ['Gema Gerente', 'Gus GerenteMx']); // etapa 6: quien edita personal tiene su ficha ligada
  const alta = async (nombre, telefono) => { const p = exigir(await pedir('POST', '/personal', T.Gema, { nombre, puesto: 'Técnico', telefono }), 'alta'); exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', T.Gema), 'checador'); return p; };
  const juan = await alta('Juan Pérez Foráneo', '442 123 4567'), beto = await alta('Beto Ruiz', '442 765 4321'), sinTel = await alta('Sin Teléfono', '');
  const JUAN = '5214421234567', BETO = '5214427654321'; // así llegan los números de México en WhatsApp (con 52 y a veces 1)

  console.log('1. Webhook');
  const v = await fetch(URLB + '/api/publico/whatsapp?hub.mode=subscribe&hub.verify_token=' + VERIF + '&hub.challenge=987654');
  revisa(v.status === 200 && (await v.text()) === '987654', 'Meta verifica el webhook con la frase correcta');
  revisa((await fetch(URLB + '/api/publico/whatsapp?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=1')).status === 401, 'Con otra frase, no');
  revisa(await webhook([texto(JUAN, 'hola')], { firma: false }) === 401, 'Sin firma: rechazado');
  revisa(await webhook([texto(JUAN, 'hola')], { secreto: 'falso' }) === 401, 'Con firma falsa: rechazado');
  revisa(enviados.length === 0, 'Y no se contestó nada');

  console.log('2. Quién puede');
  revisa(await webhook([texto(JUAN, 'hola')]) === 200 && /no está autorizado/.test(ultimo()?.cuerpo?.text?.body || ''), 'Juan aún no está activado: se le dice que pida a RH activarlo', ultimo());
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp', T.Valeria, { activo: true }))[0] === 403, 'Ventas no activa WhatsApp');
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp', T.Gus, { activo: true }))[0] === 404, 'El gerente de CDMX no activa a alguien de Querétaro');
  revisa((await pedir('PUT', '/asistencia/personal/' + sinTel.id + '/whatsapp', T.Gema, { activo: true }))[0] === 409, 'Sin celular de 10 dígitos no se activa');
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp', T.Gema, { activo: true }), 'activar a Juan');
  // Juan checa «sin nada» (como antes del 13-nov): en la sección 4 se prueba la foto y la ubicación con Rosa.
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp/config', T.Valeria, { pide: 'nada', zonas: [] }))[0] === 403, 'Ventas no cambia qué pide el bot');
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp/config', T.Gema, { pide: 'nada', zonas: [] }), 'Juan sin foto ni ubicación');
  exigir(await pedir('PUT', '/personal/' + beto.id, T.Gema, { telefono: '4421234567', version: conBase(d => d.prepare('SELECT version FROM personal WHERE id = ?').get(beto.id).version) }), 'poner a Beto el número de Juan');
  revisa((await pedir('PUT', '/asistencia/personal/' + beto.id + '/whatsapp', T.Gema, { activo: true }))[0] === 409, 'El mismo celular no se activa en dos personas');
  require('./ligar-fichas.cjs').soltar(DB, 'Gema Gerente'); // su ficha de verdad sustituye a la de prueba
  const gemaFicha = exigir(await pedir('POST', '/personal', A, { nombre: 'Gema Gerente Ficha', puesto: 'Administración', telefono: '4429990000', usuario_id: U.Gema.id, sucursal_id: qro.id }), 'ficha de Gema');
  exigir(await pedir('POST', '/asistencia/personal/' + gemaFicha.id + '/pin', A), 'checador de Gema');
  const [sp, jp] = await pedir('PUT', '/asistencia/personal/' + gemaFicha.id + '/whatsapp', T.Gema, { activo: true });
  revisa(sp === 403 && jp.codigo === 'PROPIO', 'Gema no se activa a sí misma', [sp, jp]);

  console.log('3. Checar');
  const antes = enviados.length;
  await webhook([texto(JUAN, 'entrada')]);
  const lista = ultimo()?.cuerpo;
  const filas = lista?.interactive?.action?.sections?.[0]?.rows || [];
  revisa(enviados.length === antes + 1 && lista.to === '524421234567' && lista.type === 'interactive' && lista.interactive.type === 'list' && filas.length === 6 && filas.length <= 10, 'Cualquier mensaje → menú con las 6 opciones (contesta a 52 + 10 dígitos, sin el «1» que manda WhatsApp)', lista);
  revisa(filas.every(f => f.title.length <= 24) && lista.interactive.action.button.length <= 20 && filas[0].id === 'checar:entrada', 'Títulos de máx. 24 caracteres, botón de máx. 20, y «Entrada» primero (sugerida)');
  revisa(ultimo().auth === 'Bearer token-de-prueba' && /\/v27\.0\/106540352242922\/messages$/.test(ultimo().url), 'Envía al número de la empresa con su token', ultimo().url);
  const m1 = elige(JUAN, 'entrada');
  await webhook([m1]);
  let ch = conBase(d => d.prepare("SELECT * FROM checadas WHERE personal_id = ? AND origen = 'whatsapp'").all(juan.id));
  revisa(ch.length === 1 && ch[0].estado === 'por_revisar' && ch[0].tipo === 'entrada' && /sin foto ni ubicación/i.test(ch[0].observaciones) && ch[0].lat === null && ch[0].foto_archivo === null, 'Elegir «Entrada» → checada por WhatsApp, por revisar, sin foto ni ubicación', ch[0]);
  revisa(/Entrada registrada a las/.test(ultimo().cuerpo.text?.body || '') && /por revisar/.test(ultimo().cuerpo.text.body), 'Le confirma la hora y que queda por revisar', ultimo().cuerpo);
  await webhook([m1]);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE personal_id = ? AND origen = 'whatsapp'").get(juan.id).n) === 1, 'Si Meta reenvía el mismo mensaje, no se duplica');
  await webhook([elige(JUAN, 'entrada')]);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE personal_id = ? AND origen = 'whatsapp'").get(juan.id).n) === 1 && /ya estaba registrada/.test(ultimo().cuerpo.text?.body || ''), 'Doble toque: no se repite la checada');
  // Número de otro país con los mismos 10 últimos dígitos que Juan: no checa.
  const nE = enviados.length;
  await webhook([elige('14421234567', 'comida_sale')]);
  revisa(!conBase(d => d.prepare("SELECT 1 FROM checadas WHERE personal_id = ? AND tipo = 'comida_sale'").get(juan.id)) && /no está autorizado/.test(enviados[nE]?.cuerpo?.text?.body || ''), 'Un número de otro país (+1) con los mismos 10 dígitos no checa como Juan', enviados[nE]);
  // Mensaje que llegó a OTRO número de la misma app de Meta (p. ej. el de prueba): se ignora y no se contesta.
  const nO = enviados.length;
  await webhook([elige(JUAN, 'comida_sale')], { telefonoId: '999999999999999' });
  revisa(!conBase(d => d.prepare("SELECT 1 FROM checadas WHERE personal_id = ? AND tipo = 'comida_sale'").get(juan.id)) && enviados.length === nO, 'Un mensaje a otro número de la app de Meta se ignora');
  const logs = conBase(d => { const t = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%evento%' AND sql LIKE '%detalle%'").all().map(x => x.name); return t.flatMap(n => d.prepare(`SELECT * FROM ${n} WHERE evento = 'whatsapp_rechazado'`).all()); });
  revisa(logs.some(l => /firma/i.test(l.detalle)) && logs.some(l => /WHATSAPP_PHONE_ID/.test(l.detalle)), 'Firma mala y mensaje a otro número quedan en Logs (para saber por qué no contesta)', logs);
  const hace1h = Math.floor(Date.now() / 1000) - 3600;
  await webhook([elige(JUAN, 'comida_sale', hace1h)]);
  ch = conBase(d => d.prepare("SELECT * FROM checadas WHERE personal_id = ? AND tipo = 'comida_sale'").get(juan.id));
  revisa(ch && /llegó con 1 h 0 min de retraso/.test(ch.observaciones) && Math.abs(Date.parse(ch.momento_utc) - hace1h * 1000) < 2000, 'Un mensaje que llega 1 hora tarde se registra con la hora en que lo mandó y se anota el retraso', ch);
  await webhook([elige(JUAN, 'comida_regresa', Math.floor(Date.now() / 1000) + 3600)]);
  ch = conBase(d => d.prepare("SELECT * FROM checadas WHERE personal_id = ? AND tipo = 'comida_regresa'").get(juan.id));
  revisa(ch && /no era válida/.test(ch.observaciones) && Math.abs(Date.parse(ch.momento_utc) - Date.now()) < 120000, 'Una hora del futuro no se cree: se usa la del servidor y se anota', ch);
  const [, dia] = await pedir('GET', '/asistencia/checadas?fecha=' + ch.fecha + '&personal_id=' + juan.id, T.Gema);
  revisa(dia.some(c => c.origen === 'whatsapp' && c.estado === 'por_revisar'), 'RH la ve por revisar en Asistencia');
  revisa(!conBase(d => JSON.stringify(d.prepare('SELECT * FROM whatsapp_mensajes').all())).includes('4421234567'), 'La bitácora de mensajes no guarda el número completo');
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp', T.Gema, { activo: false }), 'quitar WhatsApp');
  await webhook([elige(JUAN, 'salida')]);
  revisa(!conBase(d => d.prepare("SELECT 1 FROM checadas WHERE personal_id = ? AND tipo = 'salida'").get(juan.id)), 'Si RH le quita WhatsApp, ya no puede checar así');
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/whatsapp', T.Gema, { activo: true }), 'reactivar');
  exigir(await pedir('POST', '/personal/' + juan.id + '/baja', T.Gema, { motivo: 'Renuncia voluntaria' }), 'baja');
  await webhook([elige(JUAN, 'salida')]);
  revisa(!conBase(d => d.prepare("SELECT 1 FROM checadas WHERE personal_id = ? AND tipo = 'salida'").get(juan.id)), 'Dado de baja: ya no checa por WhatsApp');
  const n0 = enviados.length;
  for (let i = 0; i < 35; i++) await webhook([texto(BETO, 'spam ' + i)]);
  revisa(enviados.length - n0 <= 3, 'Un número que manda mensajes sin parar recibe a lo más 3 respuestas', enviados.length - n0);

  console.log('4. Foto y ubicación (zonas)');
  const rosa = await alta('Rosa Foránea', '442 555 0001'), ROSA = '5214425550001';
  exigir(await pedir('PUT', '/asistencia/personal/' + rosa.id + '/whatsapp', T.Gema, { activo: true }), 'activar a Rosa');
  revisa((await pedir('POST', '/asistencia/whatsapp/zonas', T.Valeria, { nombre: 'X', ubicacion: '20.5, -100.8' }))[0] === 403, 'Ventas no da de alta zonas');
  revisa((await pedir('POST', '/asistencia/whatsapp/zonas', T.Gema, { nombre: 'Mala', ubicacion: 'https://maps.app.goo.gl/abc' }))[0] === 400, 'Enlace corto de Maps: se pide el largo');
  revisa((await pedir('GET', '/asistencia/whatsapp/buscar?q=Celaya%20centro', T.Valeria))[0] === 403 && (await pedir('GET', '/asistencia/whatsapp/buscar?q=ab', T.Gema))[0] === 400, 'Buscar dirección: solo quien edita el personal, y con al menos 4 letras (sin salir a internet)');
  const zc = exigir(await pedir('GET', '/asistencia/whatsapp/zonas', T.Gema), 'centro');
  revisa(Number.isFinite(zc.centro?.lat) && Number.isFinite(zc.centro?.lon), 'El mapa sabe dónde empezar (sucursal o Querétaro)');
  const cspZ = (await fetch(URLB + '/')).headers.get('content-security-policy') || '';
  revisa(/img-src[^;]*https:\/\/tile\.openstreetmap\.org/.test(cspZ) && (await fetch(URLB + '/vendor/leaflet/leaflet.js')).status === 200, 'Mapa: Leaflet alojado en el ERP y las imágenes de OpenStreetMap permitidas');
  const obra = exigir(await pedir('POST', '/asistencia/whatsapp/zonas', T.Gema, { nombre: 'Obra Celaya', ubicacion: 'https://www.google.com/maps/place/Obra/@20.52,-100.81,17z/data=!3m1!4b1!3d20.5234!4d-100.8123', radio_m: 300 }), 'zona');
  const z = exigir(await pedir('GET', '/asistencia/whatsapp/zonas', T.Gema), 'ver zonas').zonas.find(x => x.id === obra.id);
  revisa(z && z.lat === 20.5234 && z.lon === -100.8123 && z.radio_m === 300, 'Zona desde enlace largo de Google Maps (toma el punto exacto !3d/!4d)', z);
  revisa((await pedir('PUT', '/asistencia/personal/' + gemaFicha.id + '/whatsapp/config', T.Gema, { pide: 'nada', zonas: [] }))[0] === 403, 'Gema no cambia su propia forma de checar');
  const cfg0 = exigir(await pedir('GET', '/asistencia/personal/' + rosa.id + '/whatsapp', T.Gema), 'config Rosa');
  revisa(cfg0.pide === 'ambas' && cfg0.zonas.some(x => x.id === obra.id && !x.asignada), 'Por omisión pide foto y ubicación; la zona aún no es suya', cfg0);
  exigir(await pedir('PUT', '/asistencia/personal/' + rosa.id + '/whatsapp/config', T.Gema, { pide: 'ambas', zonas: [obra.id] }), 'zona a Rosa');
  const ub = (lat, lon, extra = {}) => msj(ROSA, { type: 'location', location: { latitude: lat, longitude: lon, ...extra } });
  const img = (id, extra = {}) => msj(ROSA, { type: 'image', image: { id, mime_type: 'image/jpeg' }, ...extra });
  const deRosa = tipo => conBase(d => d.prepare('SELECT * FROM checadas WHERE personal_id = ? AND tipo = ?').get(rosa.id, tipo));
  // a) Todo bien: ubicación dentro de la zona + selfie → vale, con foto.
  await webhook([elige(ROSA, 'entrada')]);
  revisa(ultimo().cuerpo.type === 'interactive' && ultimo().cuerpo.interactive.type === 'location_request_message' && ultimo().cuerpo.interactive.action.name === 'send_location' && !deRosa('entrada'), 'Al elegir, pide la ubicación con el botón de WhatsApp (todavía no guarda)', ultimo().cuerpo);
  await webhook([ub(20.5240, -100.8120)]);
  revisa(/selfie/.test(ultimo().cuerpo.text?.body || ''), 'Con la ubicación, pide la selfie', ultimo().cuerpo);
  await webhook([img('MEDIA_OK')]);
  let c = deRosa('entrada');
  revisa(c && c.estado === 'valida' && c.foto_archivo && c.lat === 20.524 && c.distancia_m < 300 && /zona «Obra Celaya»/.test(c.observaciones) && /Gracias/.test(ultimo().cuerpo.text?.body || ''), 'Foto + ubicación dentro de su zona → checada válida, con foto cifrada', c);
  const [, diaR] = await pedir('GET', '/asistencia/checadas?fecha=' + c.fecha + '&personal_id=' + rosa.id, T.Gema);
  revisa(diaR.some(x => x.origen === 'whatsapp' && x.tiene_foto && x.lat != null), 'RH la ve en Asistencia con foto y mapa');
  // b) Foto primero y ubicación lejos → por revisar.
  await webhook([elige(ROSA, 'comida_sale')]);
  await webhook([img('MEDIA_OK')]);
  revisa(ultimo().cuerpo.interactive?.type === 'location_request_message', 'Si manda la foto primero, le vuelve a pedir la ubicación', ultimo().cuerpo);
  await webhook([ub(20.6, -100.4)]);
  c = deRosa('comida_sale');
  revisa(c && c.estado === 'por_revisar' && /km de la zona «Obra Celaya»/.test(c.observaciones) && c.foto_archivo, 'Fuera de su zona → por revisar, con la distancia', c);
  const avisoZona = async t => { const r = (await pedir('GET', '/personal/avisos', t))[1]; return (Array.isArray(r) ? r : []).filter(x => x.tipo === 'whatsapp_ubicacion' && x.persona_id === rosa.id); };
  let av = await avisoZona(T.Gema);
  revisa(av.length === 1 && /Salida a comer .* por WhatsApp: a .*km de la zona «Obra Celaya»/.test(av[0].texto) && av[0].nivel === 'rojo', 'Fuera de zona: aviso rojo en Inicio para quien corrige la asistencia', av);
  revisa(!(await avisoZona(T.Gus)).length && !(await avisoZona(T.Valeria)).length, 'No le sale al gerente de otra sucursal ni a Ventas');
  conBase(d => d.prepare("UPDATE checadas SET estado = 'valida' WHERE id = ?").run(c.id));
  revisa(!(await avisoZona(T.Gema)).length, 'Al aceptarla, el aviso se quita');
  // c) Lugar elegido en el mapa + foto reenviada + no termina → a los «5 min» se guarda por revisar.
  await webhook([elige(ROSA, 'comida_regresa')]);
  await webhook([ub(20.5236, -100.8122, { name: 'Oxxo', address: 'Calle 1' })]);
  await webhook([img('MEDIA_OK', { context: { forwarded: true } })]);
  revisa(/reenviadas/.test(ultimo().cuerpo.text?.body || '') && !deRosa('comida_regresa'), 'Foto reenviada: no se acepta');
  await espera(4500);
  c = deRosa('comida_regresa');
  revisa(c && c.estado === 'por_revisar' && /no mandó foto/i.test(c.observaciones) && /elegida en el mapa/.test(c.observaciones) && /Se acabó el tiempo/.test(ultimo().cuerpo.text?.body || ''), 'Sin foto a tiempo y lugar elegido en el mapa → se guarda sola, por revisar, y se le avisa', c);
  // d) Elige otra cosa sin terminar: la anterior se guarda; foto que Meta no entrega → por revisar.
  await webhook([elige(ROSA, 'salida')]);
  await webhook([elige(ROSA, 'extra_inicia')]);
  c = deRosa('salida');
  revisa(c && c.estado === 'por_revisar' && /no mandó su ubicación/i.test(c.observaciones), 'Eligió otra opción: la anterior no se pierde (por revisar)', c);
  await webhook([ub(20.5240, -100.8120)]); await webhook([img('MEDIA_MALA')]);
  c = deRosa('extra_inicia');
  revisa(c && c.estado === 'por_revisar' && /no se pudo bajar su foto/i.test(c.observaciones) && !c.foto_archivo, 'Foto que no se puede bajar → por revisar (y queda en Logs)', c);
  // e) Sin zonas asignadas → por revisar.
  exigir(await pedir('PUT', '/asistencia/personal/' + rosa.id + '/whatsapp/config', T.Gema, { pide: 'ubicacion', zonas: [] }), 'Rosa sin zonas');
  await webhook([elige(ROSA, 'extra_termina')]); await webhook([ub(20.5240, -100.8120)]);
  c = deRosa('extra_termina');
  revisa(c && c.estado === 'por_revisar' && /no tiene zonas/i.test(c.observaciones) && !c.foto_archivo, 'Solo ubicación y sin zonas → por revisar sin pedir foto', c);
  revisa(!conBase(d => d.prepare('SELECT COUNT(*) n FROM whatsapp_pendientes').get().n), 'No quedan checadas en espera');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); meta.close(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv?.kill(); meta.close(); process.exit(1); });
