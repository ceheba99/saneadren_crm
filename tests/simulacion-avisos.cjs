// AVISOS (2026-11-11, pedido de Dirección): comunicados a personas elegidas con «Enterado».
//  1. Solo quien tiene «Publicar avisos» (Dirección) publica y ve a quién se le puede mandar.
//  2. Revisa lo que se escribe: título, texto, fecha, personas que no existen, correo y WhatsApp sin configurar.
//  3. Reloj checador: al identificarse le salen sus avisos; «Enterado» solo con el token de ese kiosco; luego ya no sale.
//  4. Sistema: el usuario lo ve en Inicio y toca «Enterado»; si es la misma persona que checa, ya no le sale en el reloj.
//  5. Quién lo leyó, cuándo y dónde; retirar; no se borra ni se cambia.
// Uso: node tests/simulacion-avisos.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-avisos-')), DB = path.join(dir, 'avisos.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Avisos-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Avis-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9850 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex'),
  WHATSAPP_TOKEN: '', WHATSAPP_PLANTILLA_AVISO: '' };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const kio = (tk, r, b) => pedir('POST', '/publico/kiosco/' + r, null, b, { 'X-Kiosco': tk });
let n = 0; const malos = [];
const revisa = (cond, t, extra) => { n++; if (!cond) { malos.push(t); console.log('  ✘ ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + t); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const intento = sql => { const d = new DatabaseSync(DB); try { d.exec(sql); return false; } catch { return true; } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const vUsr = exigir(await pedir('POST', '/usuarios', A, { nombre: 'Valeria Ventas', password: CLAVE, rol: 'ventas', sucursales: [qro.id] }), 'usuario ventas');
  const tUsr = exigir(await pedir('POST', '/usuarios', A, { nombre: 'Toño Técnico', password: CLAVE, rol: 'tecnico', sucursales: [qro.id] }), 'usuario técnico');
  const gUsr = exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'usuario gerente');
  const entrar = async nombre => exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  const V = await entrar('Valeria Ventas'), T = await entrar('Toño Técnico'), G = await entrar('Gema Gerente');
  const PIN = {};
  const alta = async (nombre, pin, extra = {}) => {
    const p = exigir(await pedir('POST', '/personal', A, { nombre, puesto: 'Operador', sucursal_id: qro.id, ...extra }), 'alta ' + nombre);
    const c = exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', A), 'checador ' + nombre);
    p.codigo = c.codigo; p.temporal = c.pin; PIN[p.id] = pin; return p;
  };
  const oscar = await alta('Óscar Operador', '5813', { correo: 'oscar@ejemplo.mx', telefono: '442 555 0199' }), tono = await alta('Toño Técnico', '9275', { usuario_id: tUsr.id });
  const K = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Entrada', sucursal_id: qro.id }), 'kiosco').token;
  const K2 = exigir(await pedir('POST', '/asistencia/dispositivos', A, { nombre: 'Patio', sucursal_id: qro.id }), 'kiosco 2').token;
  for (const p of [oscar, tono]) { const i = exigir(await kio(K, 'identificar', { codigo: p.codigo, pin: p.temporal }), 'identificar'); exigir(await kio(K, 'cambiar-pin', { ticket: i.ticket, nuevo: PIN[p.id] }), 'PIN'); }
  const enKiosco = async (p, k = K) => exigir(await kio(k, 'identificar', { codigo: p.codigo, pin: PIN[p.id] }), 'identificar ' + p.nombre);

  console.log('1. Quién publica');
  revisa((await pedir('GET', '/avisos/destinatarios', V))[0] === 403 && (await pedir('POST', '/avisos', G, { titulo: 'Hola', texto: 'Prueba', destinatarios: ['p' + oscar.id] }))[0] === 403,
    'Ventas y el Gerente no publican (no tienen «Publicar avisos»)');
  const [, dst] = await pedir('GET', '/avisos/destinatarios', A), pk = dst.personas || [];
  const po = pk.find(x => x.clave === 'p' + oscar.id), pt = pk.find(x => x.clave === 'p' + tono.id);
  revisa(po && po.correo && po.whatsapp && pt && pt.usuario_id === tUsr.id && pk.some(x => x.clave === 'u' + vUsr.id) && !pk.some(x => x.clave === 'u' + tUsr.id),
    'Dirección elige del personal y de los usuarios; Toño (personal ligado a su usuario) sale una sola vez', pk.map(x => x.clave));
  revisa(dst.whatsapp === false && dst.correo === false, 'Sin plantilla de Meta ni SMTP, WhatsApp y correo salen apagados', dst);

  console.log('2. Lo que se escribe');
  const base = { titulo: 'Junta general', texto: 'El viernes a las 8:00 en la bodega.\nTraigan su EPP.', destinatarios: ['p' + oscar.id, 'p' + tono.id, 'u' + vUsr.id] };
  revisa((await pedir('POST', '/avisos', A, { ...base, titulo: '' }))[0] === 400, 'Sin título no se publica');
  revisa((await pedir('POST', '/avisos', A, { ...base, destinatarios: [] }))[0] === 400, 'Sin personas no se publica');
  revisa((await pedir('POST', '/avisos', A, { ...base, vence: sumar(HOY, -1) }))[0] === 400, 'No puede vencer antes de hoy');
  revisa((await pedir('POST', '/avisos', A, { ...base, destinatarios: ['p999999'] }))[0] === 400, 'Una persona que no existe no se acepta');
  revisa((await pedir('POST', '/avisos', A, { ...base, whatsapp: true }))[0] === 400 && (await pedir('POST', '/avisos', A, { ...base, correo: true }))[0] === 400, 'Sin configurar, no deja mandar por WhatsApp ni por correo');
  const av = exigir(await pedir('POST', '/avisos', A, { ...base, urgente: true }), 'publicar');
  revisa(av.destinatarios === 3, 'Publicado para 3 personas', av);

  console.log('3. Reloj checador');
  const i1 = await enKiosco(oscar), a1 = (i1.avisos || []).find(x => x.id === av.id);
  revisa(a1 && a1.titulo === 'Junta general' && a1.urgente === 1 && a1.texto.includes('EPP') && a1.enterado, 'Al identificarse le sale el aviso (urgente, con su texto)', i1.avisos);
  revisa((await kio(K2, 'enterado', { enterado: a1?.enterado }))[0] === 401, 'El «Enterado» no sirve desde otro kiosco');
  revisa((await kio(K, 'enterado', { enterado: 'inventado-' + 'x'.repeat(20) }))[0] === 401, 'Un token inventado no sirve');
  revisa((await kio(K, 'enterado', { enterado: a1?.enterado }))[0] === 200, '«Enterado» desde el kiosco');
  revisa((await kio(K, 'enterado', { enterado: a1?.enterado }))[0] === 401, 'El mismo token no se usa dos veces');
  revisa(!((await enKiosco(oscar)).avisos || []).length, 'Ya no le sale');

  console.log('4. En el sistema');
  const [, mv] = await pedir('GET', '/avisos-mios', V);
  revisa(mv.avisos?.length === 1 && mv.avisos[0].id === av.id && !('enterado' in mv.avisos[0]), 'Valeria lo ve en su Inicio', mv);
  revisa(!(await pedir('GET', '/avisos-mios', G))[1].avisos?.length, 'A quien no se lo mandaron no le sale');
  revisa((await pedir('POST', '/avisos-mios/' + av.id + '/enterado', G))[0] === 404, 'No puede marcar «Enterado» un aviso que no es suyo');
  exigir(await pedir('POST', '/avisos-mios/' + av.id + '/enterado', V), 'enterado Valeria');
  revisa(!(await pedir('GET', '/avisos-mios', V))[1].avisos.length, 'Después de «Enterado» ya no le sale');
  revisa((await pedir('GET', '/avisos-mios', T))[1].avisos?.length === 1, 'Toño (usuario ligado a su ficha) lo ve en el sistema');
  exigir(await pedir('POST', '/avisos-mios/' + av.id + '/enterado', T), 'enterado Toño');
  revisa(!((await enKiosco(tono)).avisos || []).length, 'Como ya lo marcó en el sistema, en el reloj ya no le sale');

  console.log('5. Quién lo leyó, retirar e historial');
  const [, det] = await pedir('GET', '/avisos/' + av.id, A), d = det.destinatarios || [];
  revisa(det.aviso?.leidos === 3 && det.aviso.total === 3 && d.find(x => x.nombre === 'Óscar Operador')?.enterado_en === 'reloj checador «Entrada»' && d.find(x => x.nombre === 'Valeria Ventas')?.enterado_en === 'sistema',
    'Se ve quién lo leyó (3 de 3), cuándo y dónde', det);
  revisa((await pedir('GET', '/avisos/' + av.id, V))[0] === 403 && (await pedir('GET', '/avisos', V))[0] === 403, 'Ventas no ve quién lo leyó');
  const av2 = exigir(await pedir('POST', '/avisos', A, { titulo: 'Se suspende la junta', texto: 'Ya no hay junta el viernes.', destinatarios: ['p' + oscar.id], vence: HOY }), 'segundo aviso');
  revisa(((await enKiosco(oscar)).avisos || []).some(x => x.id === av2.id), 'Un aviso que vence hoy todavía sale hoy');
  exigir(await pedir('POST', '/avisos/' + av2.id + '/retirar', A), 'retirar');
  revisa(!((await enKiosco(oscar)).avisos || []).length, 'Retirado, ya no sale');
  revisa((await pedir('GET', '/avisos', A))[1].avisos?.find(x => x.id === av2.id)?.retirado_at, 'Retirado queda en la lista con su fecha');
  revisa(intento('DELETE FROM avisos') && intento('DELETE FROM avisos_destinatarios') && intento("UPDATE avisos SET texto = 'otro'"), 'Los avisos no se borran ni se cambian (solo se retiran)');
  const [, bit] = await pedir('GET', '/auditoria?entidad=avisos', A);
  revisa(JSON.stringify(bit).includes('Junta general'), 'Publicar y retirar quedan en la bitácora');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
