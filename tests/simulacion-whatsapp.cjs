// CHECAR POR WHATSAPP (F5b, 2026-11-05): se simula Meta con un servidor falso (recibe lo que el bot manda) y se
// mandan al webhook mensajes firmados como los manda Meta.
//  1. Webhook: verificación con el token correcto; sin firma, con firma falsa o sin configurar → nada se procesa.
//  2. Quién: número no autorizado, no activado por RH, dado de baja o repetido en dos fichas → no checa (y se le avisa).
//  3. Flujo: cualquier texto → menú (lista, máx. 10 filas, títulos ≤ 24); elegir → checada «por revisar», origen
//     WhatsApp, sin foto ni ubicación, con aviso de confirmación; el mismo mensaje reenviado no duplica; doble toque no
//     duplica; un mensaje viejo usa la hora del servidor; tope de mensajes por número.
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
const meta = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { enviados.push({ url: req.url, auth: req.headers.authorization, cuerpo: JSON.parse(b) }); } catch { /* */ } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"messages":[{"id":"wamid.salida"}]}'); }); });
let srv, salida = '';
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let sec = 0;
const msj = (de, extra, ts = Math.floor(Date.now() / 1000)) => ({ from: de, id: 'wamid.' + (++sec) + crypto.randomBytes(4).toString('hex'), timestamp: String(ts), ...extra });
const cuerpoDe = mensajes => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '106540352242922' }, messages: mensajes } }] }] });
const webhook = async (mensajes, { firma = true, secreto = SECRETO } = {}) => {
  const cuerpo = cuerpoDe(mensajes), f = 'sha256=' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');
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
    WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_PHONE_ID: '106540352242922', WHATSAPP_VERIFY_TOKEN: VERIF, WHATSAPP_APP_SECRET: SECRETO, WHATSAPP_API_URL: 'http://localhost:' + meta.address().port + '/v27.0' };
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
  exigir(await pedir('PUT', '/personal/' + beto.id, T.Gema, { telefono: '4421234567', version: conBase(d => d.prepare('SELECT version FROM personal WHERE id = ?').get(beto.id).version) }), 'poner a Beto el número de Juan');
  revisa((await pedir('PUT', '/asistencia/personal/' + beto.id + '/whatsapp', T.Gema, { activo: true }))[0] === 409, 'El mismo celular no se activa en dos personas');
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
  revisa(ch.length === 1 && ch[0].estado === 'por_revisar' && ch[0].tipo === 'entrada' && /sin foto ni ubicación/.test(ch[0].observaciones) && ch[0].lat === null && ch[0].foto_archivo === null, 'Elegir «Entrada» → checada por WhatsApp, por revisar, sin foto ni ubicación', ch[0]);
  revisa(/Entrada registrada a las/.test(ultimo().cuerpo.text?.body || '') && /por revisar/.test(ultimo().cuerpo.text.body), 'Le confirma la hora y que queda por revisar', ultimo().cuerpo);
  await webhook([m1]);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE personal_id = ? AND origen = 'whatsapp'").get(juan.id).n) === 1, 'Si Meta reenvía el mismo mensaje, no se duplica');
  await webhook([elige(JUAN, 'entrada')]);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM checadas WHERE personal_id = ? AND origen = 'whatsapp'").get(juan.id).n) === 1 && /ya estaba registrada/.test(ultimo().cuerpo.text?.body || ''), 'Doble toque: no se repite la checada');
  await webhook([elige(JUAN, 'comida_sale', Math.floor(Date.now() / 1000) - 3600)]);
  ch = conBase(d => d.prepare("SELECT * FROM checadas WHERE personal_id = ? AND tipo = 'comida_sale'").get(juan.id));
  revisa(ch && /llegó tarde/.test(ch.observaciones) && Math.abs(Date.parse(ch.momento_utc) - Date.now()) < 120000, 'Un mensaje de hace 1 hora se registra con la hora del servidor (no la vieja) y se marca', ch);
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

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); meta.close(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv?.kill(); meta.close(); process.exit(1); });
