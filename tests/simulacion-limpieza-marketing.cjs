// MARKETING · LIMPIEZA AUTOMÁTICA DE ARCHIVOS (2026-10-27): lo que se quitó hace más de 60 días (imágenes de publicaciones,
// archivos de avances y de la biblioteca) se borra del disco y el registro queda para el historial; las imágenes de una
// publicación cancelada hace más de 60 días también se borran (con nota «Sistema»). Lo que sigue en uso, lo quitado hace
// menos de 60 días y lo de publicaciones vigentes no se toca. Las fechas se adelantan escribiendo en la base de prueba.
// Uso: node tests/simulacion-limpieza-marketing.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-limpieza-mk-')), DB = path.join(dir, 'sim.db'), ARCH = path.join(dir, 'archivos', 'marketing');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Limpieza-' + Math.random().toString(36).slice(2) + '-7Q' };
const PUERTO = String(9300 + Math.floor(Math.random() * 150)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', MARKETING_LIMPIEZA_MS: '1500' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const binario = Buffer.isBuffer(b);
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': binario ? 'application/octet-stream' : 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : binario ? b : JSON.stringify(b) });
  const tipo = x.headers.get('content-type') || ''; let j = {};
  if (/json/.test(tipo)) { try { j = await x.json(); } catch { /* */ } } else j = { _bytes: (await x.arrayBuffer()).byteLength };
  return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = color => { const ih = Buffer.alloc(13); ih.writeUInt32BE(1, 0); ih.writeUInt32BE(1, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ih), trozo('IDAT', zlib.deflateSync(Buffer.from([0, ...color]))), trozo('IEND', Buffer.alloc(0))]); };
const existe = rel => !!rel && fs.existsSync(path.join(ARCH, rel));

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const base = { redes: ['instagram'], formato: 'post', fecha: HOY, sucursal: 'empresa' };
  const subir = async (pub, color, nombre) => (await pedir('POST', '/marketing/publicaciones/' + pub + '/imagenes', A, png(color), { 'X-Nombre': nombre }))[1];

  console.log('1. Preparar');
  const vigente = (await pedir('POST', '/marketing/publicaciones', A, { ...base, titulo: 'Vigente' }))[1];
  await subir(vigente.id, [1, 2, 3], 'sigue.png'); await subir(vigente.id, [4, 5, 6], 'quitada-hace-90.png');
  j = await subir(vigente.id, [7, 8, 9], 'quitada-hace-10.png');
  const img = Object.fromEntries(j.lista_imagenes.map(i => [i.nombre, i.id]));
  await pedir('POST', '/marketing/imagenes/' + img['quitada-hace-90.png'] + '/quitar', A, {});
  await pedir('POST', '/marketing/imagenes/' + img['quitada-hace-10.png'] + '/quitar', A, {});
  const cancelada = (await pedir('POST', '/marketing/publicaciones', A, { ...base, titulo: 'Cancelada vieja' }))[1];
  j = await subir(cancelada.id, [10, 11, 12], 'de-cancelada.png'); const imgCancelada = j.lista_imagenes[0].id;
  [s, j] = await pedir('POST', '/marketing/publicaciones/' + cancelada.id + '/estado', A, { accion: 'cancelar', version: j.version, comentario: 'Ya no va' });
  revisa(s === 200 && j.estado === 'cancelada', 'una publicación con imagen se cancela', j);
  const recien = (await pedir('POST', '/marketing/publicaciones', A, { ...base, titulo: 'Cancelada reciente' }))[1];
  j = await subir(recien.id, [13, 14, 15], 'de-cancelada-reciente.png');
  await pedir('POST', '/marketing/publicaciones/' + recien.id + '/estado', A, { accion: 'cancelar', version: j.version, comentario: 'Se pospone' });
  [s, j] = await pedir('POST', '/marketing/biblioteca', A, png([20, 21, 22]), { 'X-Nombre': 'bib-vieja.png', 'X-Carpeta': 'Fotos' }); const bibVieja = j.id;
  await pedir('POST', '/marketing/biblioteca/' + bibVieja + '/quitar', A, {});
  [s, j] = await pedir('POST', '/marketing/biblioteca', A, png([23, 24, 25]), { 'X-Nombre': 'bib-sigue.png', 'X-Carpeta': 'Fotos' }); const bibSigue = j.id;

  const db = new DatabaseSync(DB);
  const fila = (t, id) => db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id);
  const antes = { sigue: fila('publicacion_imagenes', img['sigue.png']).archivo, h90: fila('publicacion_imagenes', img['quitada-hace-90.png']).archivo, h10: fila('publicacion_imagenes', img['quitada-hace-10.png']).archivo,
    canc: fila('publicacion_imagenes', imgCancelada).archivo, bibV: fila('biblioteca_marketing', bibVieja).archivo, bibS: fila('biblioteca_marketing', bibSigue).archivo };
  revisa(Object.values(antes).every(existe), 'todos los archivos están en disco antes de la limpieza', antes);
  revisa(existe(antes.h90) && fila('publicacion_imagenes', img['quitada-hace-90.png']).eliminado === 1, '«Quitar» solo oculta: el archivo sigue en disco (aún no pasan 60 días)');
  // Adelantar el tiempo: quitada hace 90 días, otra hace 10, la publicación cancelada hace 61 días, lo de la biblioteca hace 70.
  db.prepare("UPDATE publicacion_imagenes SET eliminado_at = datetime('now','localtime','-90 days') WHERE id = ?").run(img['quitada-hace-90.png']);
  db.prepare("UPDATE publicacion_imagenes SET eliminado_at = datetime('now','localtime','-10 days') WHERE id = ?").run(img['quitada-hace-10.png']);
  db.prepare("UPDATE publicaciones SET updated_at = datetime('now','localtime','-61 days') WHERE id = ?").run(cancelada.id);
  db.prepare("UPDATE publicaciones SET updated_at = datetime('now','localtime','-20 days') WHERE id = ?").run(recien.id);
  db.prepare("UPDATE biblioteca_marketing SET eliminado_at = datetime('now','localtime','-70 days') WHERE id = ?").run(bibVieja);
  for (let i = 0; i < 40 && !/limpieza automática/.test(salida); i++) await espera(250);

  console.log('2. Lo que se borra');
  revisa(/limpieza automática, 3 archivo\(s\) borrados/.test(salida), 'la limpieza corre sola y avisa en el registro del servidor cuántos archivos borró', salida.split('\n').filter(l => /limpieza/.test(l)));
  revisa(!existe(antes.h90) && fila('publicacion_imagenes', img['quitada-hace-90.png']).archivo === '', 'la imagen quitada hace 90 días se borra del disco (el registro queda)');
  revisa(!existe(antes.bibV) && fila('biblioteca_marketing', bibVieja).archivo === '', 'el archivo quitado de la biblioteca hace 70 días se borra del disco');
  const c = fila('publicacion_imagenes', imgCancelada);
  revisa(!existe(antes.canc) && c.eliminado === 1 && c.archivo === '' && c.eliminado_por === null, 'las imágenes de una publicación cancelada hace 61 días se borran (las quita el sistema)', c);
  [s, j] = await pedir('GET', '/marketing/publicaciones/' + cancelada.id, A);
  const notaSis = j.historial?.find(h => /Se borraron 1 imagen/.test(h.texto));
  revisa(s === 200 && notaSis && !notaSis.usuario && j.lista_imagenes.length === 0, 'la publicación cancelada queda con su historial y una nota de por qué ya no tiene imágenes', j.historial);
  [s] = await pedir('GET', '/marketing/imagenes/' + imgCancelada, A); revisa(s === 404, 'pedir la imagen borrada responde 404 (no un error interno)', s);
  [s, j] = await pedir('POST', '/marketing/publicaciones/' + cancelada.id + '/estado', A, { accion: 'reabrir', version: j.version }); revisa(s === 200 && j.estado === 'borrador', 'la cancelada se puede reabrir (sin imágenes; se suben de nuevo)', j.estado);

  console.log('3. Lo que NO se toca');
  revisa(existe(antes.sigue), 'la imagen en uso de una publicación vigente sigue');
  [s, j] = await pedir('GET', '/marketing/imagenes/' + img['sigue.png'], A); revisa(s === 200 && j._bytes > 0, 'y se sigue viendo', s);
  revisa(existe(antes.h10) && fila('publicacion_imagenes', img['quitada-hace-10.png']).archivo === antes.h10, 'la quitada hace 10 días sigue en disco (falta para los 60)');
  revisa(fs.readdirSync(path.join(ARCH, String(recien.id))).length === 1, 'la publicación cancelada hace 20 días conserva sus imágenes');
  revisa(existe(antes.bibS), 'lo que sigue en la biblioteca no se toca');

  console.log('4. Una segunda pasada no repite nada');
  const n1 = (salida.match(/limpieza automática/g) || []).length; await espera(3500);
  revisa((salida.match(/limpieza automática/g) || []).length === n1, 'si no hay nada nuevo que borrar, no hace nada (ni escribe en el registro)');
  db.close();

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|no se pudo hacer la limpieza|Error en (GET|POST|PUT|DELETE)/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error|limpieza/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
