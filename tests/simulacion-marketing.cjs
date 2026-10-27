// MARKETING · CALENDARIO DE PUBLICACIONES (2026-10-26): flujo borrador → revisión → aprobada → publicada, quién aprueba
// (Dirección y Gerente de marketing), comentarios, versiones del copy, imágenes (solo imágenes reales, máx. 10 MB),
// la aprobación se pierde si cambia el contenido, y qué ve cada quien (empresa / sucursal / lo suyo).
// Uso: node tests/simulacion-marketing.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-marketing-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Mercadeo-' + Math.random().toString(36).slice(2) + '-3Q' };
const CLAVE = 'Clave-Mercadeo-2026x';
const PUERTO = String(9100 + Math.floor(Math.random() * 150)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const binario = Buffer.isBuffer(b);
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': binario ? 'application/octet-stream' : 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : binario ? b : JSON.stringify(b) });
  const tipo = x.headers.get('content-type') || ''; let j = {};
  if (/json/.test(tipo)) { try { j = await x.json(); } catch { /* */ } } else j = { _bytes: (await x.arrayBuffer()).byteLength, _tipo: tipo };
  return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dias = d => { const f = new Date(HOY + 'T12:00:00'); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };
// PNG real de 1×1 (con su CRC), para subir.
const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = color => { const ih = Buffer.alloc(13); ih.writeUInt32BE(1, 0); ih.writeUInt32BE(1, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ih), trozo('IDAT', zlib.deflateSync(Buffer.from([0, ...color]))), trozo('IEND', Buffer.alloc(0))]); };

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = (await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }))[1];
  const T = {}, ID = {};
  for (const [nombre, rol, suc] of [['Mara Marketing', 'marketing', qro.id], ['Gil Mercadotecnia', 'marketing_gerente', qro.id], ['Vale Ventas', 'ventas', qro.id], ['Gema Gerente', 'gerente', qro.id]]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] });
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  revisa(Object.values(T).every(Boolean), 'se crean los usuarios de Marketing (roles nuevos «Marketing» y «Gerente de marketing»)', ID);

  console.log('1. Crear');
  const base = { titulo: 'Promo de temporada', redes: ['instagram', 'facebook'], formato: 'carrusel', fecha: dias(4), hora: '10:30', copy: 'Línea 1\nLínea 2', hashtags: '#saneamiento', sucursal: qro.id };
  for (const [cuerpo, que] of [[{ ...base, redes: [] }, 'sin red'], [{ ...base, redes: ['myspace'] }, 'una red inventada'], [{ ...base, fecha: '2026-02-30' }, 'una fecha imposible'], [{ ...base, hora: '25:00' }, 'una hora imposible'],
    [{ ...base, enlace: 'javascript:alert(1)' }, 'un enlace que no es https'], [{ ...base, titulo: '  ' }, 'sin título'], [{ ...base, formato: 'x' }, 'un formato inventado'], [{ ...base, sucursal: 999 }, 'una sucursal que no existe']]) {
    [s] = await pedir('POST', '/marketing/publicaciones', T.Mara, cuerpo); revisa(s === 400, 'rechaza ' + que, s);
  }
  [s, j] = await pedir('POST', '/marketing/publicaciones', T.Mara, base);
  revisa(s === 201 && j.estado === 'borrador' && j.redes.join() === 'facebook,instagram' && j.responsable_id === ID.Mara && j.copy === 'Línea 1\nLínea 2' && j.puede.editar && !j.puede.aprobar, 'Marketing crea un borrador (a su nombre; no aprueba)', j);
  let pub = j;
  [s] = await pedir('POST', '/marketing/publicaciones', T.Vale, base); revisa(s === 403, 'Ventas no entra a Marketing', s);
  [s] = await pedir('GET', '/marketing/publicaciones?desde=' + dias(-10) + '&hasta=' + dias(30), T.Gema); revisa(s === 403, 'el Gerente de sucursal tampoco (hasta que Dirección lo prenda)', s);

  console.log('2. Imágenes');
  [s, j] = await pedir('POST', '/marketing/publicaciones/' + pub.id + '/imagenes', T.Mara, png([255, 0, 0]), { 'X-Nombre': encodeURIComponent('portada.png') });
  revisa(s === 201 && j.lista_imagenes.length === 1 && j.portada_id === j.lista_imagenes[0].id, 'sube una imagen y queda de portada', j);
  pub = j;
  [s] = await pedir('POST', '/marketing/publicaciones/' + pub.id + '/imagenes', T.Mara, png([255, 0, 0])); revisa(s === 409, 'la misma imagen dos veces, no', s);
  [s] = await pedir('POST', '/marketing/publicaciones/' + pub.id + '/imagenes', T.Mara, Buffer.from('<svg onload=alert(1)>')); revisa(s === 400, 'un archivo que no es imagen (aunque diga .png), no', s);
  [s, j] = await pedir('GET', '/marketing/imagenes/' + pub.lista_imagenes[0].id, T.Gil); revisa(s === 200 && j._tipo === 'image/png' && j._bytes > 50, 'la imagen se descarga como imagen', j);
  [s] = await pedir('GET', '/marketing/imagenes/' + pub.lista_imagenes[0].id, T.Vale); revisa(s === 403 || s === 404, 'quien no ve Marketing no ve la imagen', s);

  console.log('3. Flujo de aprobación');
  const estado = async (t, accion, extra = {}) => { const v = (await pedir('GET', '/marketing/publicaciones/' + pub.id, A))[1].version; return pedir('POST', '/marketing/publicaciones/' + pub.id + '/estado', t, { accion, version: v, ...extra }); };
  [s] = await estado(T.Mara, 'aprobar'); revisa(s === 403, 'Marketing no aprueba (ni lo suyo)', s);
  [s, j] = await estado(T.Mara, 'enviar'); revisa(s === 200 && j.estado === 'revision', 'Marketing la envía a revisión', j.estado);
  [s] = await estado(T.Gil, 'pedir_cambios'); revisa(s === 400, 'pedir cambios exige decir cuáles', s);
  [s, j] = await estado(T.Gil, 'pedir_cambios', { comentario: 'Cambia la foto de portada' }); revisa(s === 200 && j.estado === 'cambios' && j.historial[0].tipo === 'cambios', 'el Gerente de marketing pide cambios y queda en el historial', j.historial?.[0]);
  [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pub.id, T.Mara, { version: j.version, copy: 'Nuevo copy' });
  revisa(s === 200 && j.versiones.length === 1 && j.versiones[0].copy === 'Línea 1\nLínea 2', 'al cambiar el copy se guarda la versión anterior', j.versiones);
  [s] = await pedir('PUT', '/marketing/publicaciones/' + pub.id, T.Mara, { version: 1, copy: 'otra' }); revisa(s === 409, 'con una versión vieja no se guarda (otra persona la cambió)', s);
  [s, j] = await estado(T.Mara, 'enviar'); [s, j] = await estado(T.Gil, 'aprobar');
  revisa(s === 200 && j.estado === 'aprobada' && j.aprobado_por_nombre === 'Gil Mercadotecnia', 'el Gerente de marketing la aprueba', [j.estado, j.aprobado_por_nombre]);
  [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pub.id, T.Mara, { version: j.version, fecha: dias(6), hora: '12:00' });
  revisa(s === 200 && j.estado === 'aprobada', 'mover fecha u hora no quita la aprobación', j.estado);
  [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pub.id, T.Mara, { version: j.version, copy: 'Copy cambiado después de aprobar' });
  revisa(s === 200 && j.estado === 'borrador' && !j.aprobado_por, 'cambiar el contenido después de aprobada la regresa a borrador', [j.estado, j.aprobado_por]);
  [s, j] = await estado(T.Mara, 'enviar'); [s, j] = await estado(A, 'aprobar'); revisa(s === 200 && j.estado === 'aprobada', 'Dirección también aprueba', j.estado);
  [s, j] = await estado(T.Mara, 'programar'); revisa(j.estado === 'programada', 'Marketing la marca programada en la red', j.estado);
  [s] = await estado(T.Mara, 'publicar', { url: 'ftp://x' }); revisa(s === 400, 'el enlace de la publicación debe ser https', s);
  [s, j] = await estado(T.Mara, 'publicar', { url: 'https://instagram.com/p/abc' }); revisa(s === 200 && j.estado === 'publicada' && j.publicado_url === 'https://instagram.com/p/abc' && !j.puede.editar, 'la marca publicada con su enlace; ya no se edita', [j.estado, j.puede]);
  [s] = await pedir('PUT', '/marketing/publicaciones/' + pub.id, T.Mara, { version: j.version, copy: 'x' }); revisa(s === 409, 'publicada: no se cambia', s);
  [s, j] = await pedir('POST', '/marketing/publicaciones/' + pub.id + '/comentarios', T.Gil, { texto: '¡Buen alcance!' }); revisa(s === 201 && j.historial[0].texto === '¡Buen alcance!', 'publicada: sí se comenta', s);
  [s] = await estado(T.Mara, 'cancelar', { comentario: 'ya no' }); revisa(s === 409, 'publicada: no se cancela', s);

  console.log('4. Quién ve qué');
  const empresa = (await pedir('POST', '/marketing/publicaciones', A, { ...base, titulo: 'De toda la empresa', sucursal: 'empresa' }))[1];
  const deCdmx = (await pedir('POST', '/marketing/publicaciones', A, { ...base, titulo: 'De CDMX', sucursal: cdmx.id }))[1];
  const ver = async t => (await pedir('GET', '/marketing/publicaciones?desde=' + dias(-10) + '&hasta=' + dias(30), t))[1].map(p => p.id);
  const deMara = await ver(T.Mara);
  revisa([pub.id, empresa.id, deCdmx.id].every(id => deMara.includes(id)), 'Marketing ve toda la empresa: las generales y las de cualquier sucursal', deMara);
  // Si Dirección le pone «toda su sucursal», ya no ve la de CDMX pero sí las generales.
  const [, permisos] = await pedir('GET', '/permisos', A); const rolMk = permisos.roles.find(r => r.clave === 'marketing');
  [s] = await pedir('PUT', '/roles/marketing/permisos', A, { permisos: rolMk.permisos.filter(p => !/^marketing\.|^ventas\.ver|^compras\.ver/.test(p) || p === 'marketing.aprobar'), alcances: { ...rolMk.alcances, marketing: 2 }, ediciones: { ...rolMk.ediciones, marketing: true } });
  const deMara2 = await ver(T.Mara);
  revisa(s === 200 && deMara2.includes(pub.id) && deMara2.includes(empresa.id) && !deMara2.includes(deCdmx.id), 'con «toda su sucursal»: la suya y las generales, no las de otra sucursal', [s, deMara2]);
  [s] = await pedir('GET', '/marketing/publicaciones/' + deCdmx.id, T.Mara); revisa(s === 404, 'ni escribiendo su número', s);
  [s] = await pedir('PUT', '/roles/marketing/permisos', A, { permisos: rolMk.permisos.filter(p => !/^marketing\.|^ventas\.ver|^compras\.ver/.test(p) || p === 'marketing.aprobar'), alcances: { ...rolMk.alcances, marketing: 1 }, ediciones: { ...rolMk.ediciones, marketing: true } });
  const deMara3 = await ver(T.Mara);
  revisa(deMara3.includes(pub.id) && !deMara3.includes(empresa.id), 'con «lo suyo»: solo las que creó o tiene a su nombre', deMara3);

  console.log('5. Pendientes de Inicio');
  const otra = (await pedir('POST', '/marketing/publicaciones', T.Gil, { ...base, titulo: 'Para aprobar', fecha: dias(1) }))[1];
  await pedir('POST', '/marketing/publicaciones/' + otra.id + '/estado', T.Gil, { accion: 'enviar', version: otra.version });
  [, j] = await pedir('GET', '/marketing/pendientes', T.Gil);
  revisa(j.some(p => p.id === otra.id && p.motivo === 'aprobar'), 'al Gerente de marketing le sale «por aprobar»', j.map(p => [p.titulo, p.motivo]));
  [, j] = await pedir('GET', '/marketing/pendientes', T.Mara);
  revisa(!j.some(p => p.motivo === 'aprobar'), 'a Marketing no le sale «por aprobar»', j.map(p => [p.titulo, p.motivo]));

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
