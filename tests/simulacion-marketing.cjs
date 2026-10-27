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
  let s, j, k;
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

  console.log('6. Proyectos, tareas (Gantt) y avances (fase 2)');
  // Dirección le regresa a Marketing «toda la empresa».
  [s] = await pedir('PUT', '/roles/marketing/permisos', A, { permisos: rolMk.permisos.filter(p => !/^marketing\.|^ventas\.ver|^compras\.ver/.test(p) || p === 'marketing.aprobar'), alcances: { ...rolMk.alcances, marketing: 3 }, ediciones: { ...rolMk.ediciones, marketing: true } });
  for (const [cuerpo, que] of [[{ nombre: '', inicio: dias(0), fin: dias(10) }, 'sin nombre'], [{ nombre: 'X', inicio: dias(10), fin: dias(0) }, 'fin antes del inicio'], [{ nombre: 'X', inicio: '2026-02-30', fin: dias(5) }, 'una fecha imposible']]) {
    [s] = await pedir('POST', '/marketing/proyectos', T.Mara, cuerpo); revisa(s === 400, 'proyecto: rechaza ' + que, s);
  }
  [s, j] = await pedir('POST', '/marketing/proyectos', T.Mara, { nombre: 'Lanzamiento temporada de lluvias', objetivo: 'Más contactos de desazolve', inicio: dias(0), fin: dias(30), sucursal: 'empresa' });
  revisa(s === 201 && j.estado === 'planeacion' && j.avance === 0 && j.responsable_id === ID.Mara, 'Marketing crea un proyecto (en planeación, 0 %)', j);
  let proy = j;
  const tarea = async (datos, t = T.Mara) => pedir('POST', '/marketing/proyectos/' + proy.id + '/tareas', t, datos);
  [s, j] = await tarea({ titulo: 'Guion', inicio: dias(0), fin: dias(3) }); const t1 = j.tareas.at(-1);
  [s, j] = await tarea({ titulo: 'Grabación', inicio: dias(4), fin: dias(10), depende_de: t1.id }); const t2 = j.tareas.at(-1);
  [s, j] = await tarea({ titulo: 'Lanzamiento', inicio: dias(11), fin: dias(11), hito: true, depende_de: t2.id }); const t3 = j.tareas.at(-1);
  revisa(s === 201 && j.tareas.length === 3 && t2.depende_de === t1.id && t3.hito === 1 && j.proximo_hito?.titulo === 'Lanzamiento', 'tareas con dependencias y un hito', j.tareas);
  [s] = await tarea({ titulo: 'Mal', inicio: dias(5), fin: dias(1) }); revisa(s === 400, 'una tarea que termina antes de empezar, no', s);
  [s] = await pedir('PUT', '/marketing/tareas/' + t1.id, T.Mara, { version: t1.version, depende_de: t3.id }); revisa(s === 400, 'sin vueltas: Guion no puede depender de Lanzamiento (que depende de él)', s);
  [s] = await pedir('PUT', '/marketing/tareas/' + t1.id, T.Mara, { version: t1.version, depende_de: t1.id }); revisa(s === 400, 'una tarea no depende de sí misma', s);
  const otro = (await pedir('POST', '/marketing/proyectos', T.Mara, { nombre: 'Otro', inicio: dias(0), fin: dias(5) }))[1];
  const ajena = (await pedir('POST', '/marketing/proyectos/' + otro.id + '/tareas', T.Mara, { titulo: 'Ajena', inicio: dias(0), fin: dias(1) }))[1].tareas[0];
  [s] = await pedir('PUT', '/marketing/tareas/' + t2.id, T.Mara, { version: t2.version, depende_de: ajena.id }); revisa(s === 400, 'no depende de una tarea de otro proyecto', s);
  [s, j] = await pedir('PUT', '/marketing/tareas/' + t1.id, T.Mara, { version: t1.version, avance: 100 });
  revisa(s === 200 && j.avance === Math.round(100 * 4 / (4 + 7 + 1)), 'el % del proyecto pesa cada tarea por sus días (Guion 4 de 12 días → 33 %)', j.avance);
  [s] = await pedir('PUT', '/marketing/tareas/' + t1.id, T.Mara, { version: t1.version, avance: 50 }); revisa(s === 409, 'tarea con versión vieja: no se guarda', s);
  [s, j] = await pedir('POST', '/marketing/proyectos/' + proy.id + '/avances', T.Mara, { texto: 'Ya grabamos la mitad', tarea_id: t2.id, avance: 50 });
  revisa(s === 201 && j.tareas.find(x => x.id === t2.id).avance === 50 && j.avances[0].avance_antes === 0 && j.avances[0].avance_nuevo === 50, 'un avance puede mover el % de una tarea y queda el antes y el después', j.avances?.[0]);
  const avId = j.avance_id;
  [s, j] = await pedir('POST', '/marketing/avances/' + avId + '/archivos', T.Mara, png([0, 128, 255]), { 'X-Nombre': encodeURIComponent('set.png') });
  revisa(s === 201 && j.avances[0].archivos.length === 1, 'al avance se le sube una foto', j.avances?.[0]);
  [s] = await pedir('POST', '/marketing/avances/' + avId + '/archivos', T.Mara, Buffer.from('MZ ejecutable')); revisa(s === 400, 'un archivo que no es foto ni PDF, no', s);
  [s, j] = await pedir('GET', '/marketing/archivos/' + j.avances[0].archivos[0].id, T.Gil); revisa(s === 200 && j._tipo === 'image/png', 'la foto se descarga como imagen', j);
  // Publicación ligada al proyecto
  [s, j] = await pedir('POST', '/marketing/publicaciones', T.Mara, { ...base, titulo: 'Teaser lluvias', proyecto_id: proy.id });
  revisa(s === 201 && j.proyecto_nombre === 'Lanzamiento temporada de lluvias', 'una publicación se liga al proyecto', j.proyecto_nombre);
  [, j] = await pedir('GET', '/marketing/proyectos/' + proy.id, T.Gil); revisa(j.publicaciones_lista?.some(p => p.titulo === 'Teaser lluvias'), 'el proyecto muestra sus publicaciones', j.publicaciones_lista);
  // Quitar una tarea: las que dependían de ella se sueltan
  [s, j] = await pedir('POST', '/marketing/tareas/' + t2.id + '/quitar', T.Mara, {});
  revisa(s === 200 && !j.tareas.some(x => x.id === t2.id) && j.tareas.find(x => x.id === t3.id).depende_de === null && /Quitó la tarea «Grabación»/.test(j.avances[0].texto), 'quitar una tarea suelta a las que dependían de ella y queda en los avances', j.tareas);
  [s] = await pedir('PUT', '/marketing/proyectos/' + proy.id, T.Vale, { version: 1, nombre: 'x' }); revisa(s === 403 || s === 404, 'Ventas no toca proyectos', s);
  [s] = await pedir('GET', '/marketing/proyectos/' + proy.id, T.Gema); revisa(s === 403 || s === 404, 'el Gerente de sucursal no ve proyectos', s);
  // Pendientes: una tarea de Mara que vence mañana
  await tarea({ titulo: 'Revisar arte final', inicio: dias(-2), fin: dias(1) });
  [, j] = await pedir('GET', '/marketing/pendientes', T.Mara); revisa(j.some(p => p.motivo === 'tarea' && p.titulo === 'Revisar arte final'), 'a Marketing le sale en Inicio su tarea que vence pronto', j.map(p => [p.titulo, p.motivo]));

  console.log('8. Banco de ideas (fase 3)');
  for (const [cuerpo, que] of [[{ titulo: ' ' }, 'sin título'], [{ titulo: 'X', referencia: 'javascript:alert(1)' }, 'una referencia que no es https'], [{ titulo: 'X', redes: ['myspace'] }, 'una red inventada']]) {
    [s] = await pedir('POST', '/marketing/ideas', T.Mara, cuerpo); revisa(s === 400, 'idea: rechaza ' + que, s);
  }
  [s, j] = await pedir('POST', '/marketing/ideas', T.Mara, { titulo: 'Reto antes y después', descripcion: 'Video corto con una trampa de grasa', redes: ['tiktok', 'instagram'], referencia: 'https://www.tiktok.com/' });
  revisa(s === 201 && j.estado === 'nueva' && j.autor === 'Mara Marketing' && j.puede.editar && !j.puede.decidir, 'Marketing propone una idea (no la decide)', j);
  let idea = j;
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/voto', T.Gil, { voto: true }); [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/voto', T.Mara, { voto: true });
  revisa(j.votos === 2 && j.mi_voto === true && j.votantes.length === 2, 'votan dos personas (cada una cuenta una vez)', [j.votos, j.votantes]);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/voto', T.Mara, { voto: true }); revisa(j.votos === 2, 'votar dos veces no suma dos', j.votos);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/voto', T.Mara, { voto: false }); revisa(j.votos === 1 && j.mi_voto === false, 'se puede quitar el voto', j.votos);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/comentarios', T.Gil, { texto: 'Me gusta, hagámoslo en noviembre' }); revisa(s === 201 && j.historial[0].texto === 'Me gusta, hagámoslo en noviembre', 'se comenta', j.historial?.[0]);
  [s] = await pedir('POST', '/marketing/ideas/' + idea.id + '/estado', T.Mara, { accion: 'aprobar', version: j.version }); revisa(s === 403, 'Marketing no aprueba ideas', s);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/estado', T.Gil, { accion: 'evaluar', version: j.version }); revisa(s === 200 && j.estado === 'evaluacion', 'el Gerente de marketing la pasa a evaluación', j.estado);
  [s] = await pedir('POST', '/marketing/ideas/' + idea.id + '/estado', T.Gil, { accion: 'descartar', version: j.version }); revisa(s === 400, 'descartar exige motivo', s);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/convertir', T.Mara, { a: 'publicacion', version: j.version }); revisa(s === 409, 'no se convierte sin estar aprobada', s);
  [, j] = await pedir('GET', '/marketing/ideas/' + idea.id, T.Mara);
  // Una imagen de referencia (va a la biblioteca, carpeta «Ideas») y luego se aprueba y se convierte en publicación.
  [s, j] = await pedir('POST', '/marketing/biblioteca', T.Mara, png([200, 30, 30]), { 'X-Nombre': encodeURIComponent('referencia.png'), 'X-Carpeta': 'Ideas', 'X-Idea': String(idea.id) });
  revisa(s === 201 && j.idea?.adjuntos?.length === 1, 'se adjunta una imagen de referencia a la idea', j);
  [, j] = await pedir('GET', '/marketing/ideas/' + idea.id, T.Gil);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/estado', T.Gil, { accion: 'aprobar', version: j.version }); revisa(s === 200 && j.estado === 'aprobada' && j.decidido_por_nombre === 'Gil Mercadotecnia', 'el Gerente de marketing la aprueba', j.estado);
  [s, j] = await pedir('POST', '/marketing/ideas/' + idea.id + '/convertir', T.Mara, { a: 'publicacion', version: j.version });
  revisa(s === 200 && j.estado === 'realizada' && j.publicacion_id, 'se convierte en publicación y queda realizada', j);
  const pubIdea = (await pedir('GET', '/marketing/publicaciones/' + j.publicacion_id, T.Mara))[1];
  revisa(pubIdea.estado === 'borrador' && pubIdea.titulo === 'Reto antes y después' && pubIdea.copy === 'Video corto con una trampa de grasa' && pubIdea.redes.join() === 'tiktok,instagram' && pubIdea.lista_imagenes.length === 1, 'la publicación nace en borrador con su texto, sus redes y su imagen', pubIdea);
  [s] = await pedir('POST', '/marketing/ideas/' + idea.id + '/convertir', T.Mara, { a: 'proyecto', version: j.version }); revisa(s === 409, 'una idea realizada no se convierte otra vez', s);
  [s] = await pedir('PUT', '/marketing/ideas/' + idea.id, T.Mara, { version: j.version, titulo: 'x' }); revisa(s === 403, 'una idea realizada ya no se cambia', s);
  let otraI = (await pedir('POST', '/marketing/ideas', T.Mara, { titulo: 'Podcast con clientes' }))[1];
  otraI = (await pedir('POST', '/marketing/ideas/' + otraI.id + '/estado', A, { accion: 'aprobar', version: otraI.version }))[1];
  [s, j] = await pedir('POST', '/marketing/ideas/' + otraI.id + '/convertir', T.Mara, { a: 'proyecto', version: otraI.version });
  revisa(s === 200 && j.proyecto_id && (await pedir('GET', '/marketing/proyectos/' + j.proyecto_id, T.Mara))[1].nombre === 'Podcast con clientes', 'Dirección aprueba otra y se convierte en proyecto', j);
  let tercera = (await pedir('POST', '/marketing/ideas', T.Mara, { titulo: 'Idea a descartar' }))[1];
  [s, j] = await pedir('POST', '/marketing/ideas/' + tercera.id + '/estado', T.Gil, { accion: 'descartar', version: tercera.version, motivo: 'No va con la marca' });
  revisa(s === 200 && j.estado === 'descartada' && j.motivo === 'No va con la marca', 'se descarta con motivo', j);
  [s] = await pedir('GET', '/marketing/ideas', T.Vale); revisa(s === 403, 'Ventas no ve las ideas', s);
  [s] = await pedir('POST', '/marketing/ideas/' + tercera.id + '/voto', T.Vale, { voto: true }); revisa(s === 403 || s === 404, 'ni vota', s);

  console.log('9. Biblioteca (fase 3)');
  [s, j] = await pedir('POST', '/marketing/biblioteca', T.Mara, png([10, 120, 60]), { 'X-Nombre': encodeURIComponent('logo-verde.png'), 'X-Carpeta': 'Logos', 'X-Etiquetas': encodeURIComponent('logo, fondo blanco') });
  revisa(s === 201 && j.id, 'se sube un logo a la carpeta «Logos»', j); const logoId = j.id;
  [s, j] = await pedir('POST', '/marketing/biblioteca', T.Gil, png([10, 120, 60]), { 'X-Nombre': 'otro.png', 'X-Carpeta': 'Fotos' }); revisa(s === 409 && /ya está en la biblioteca/.test(j.error), 'el mismo archivo dos veces, no (dice dónde está)', j);
  [s] = await pedir('POST', '/marketing/biblioteca', T.Mara, Buffer.from('<svg onload=alert(1)></svg>'), { 'X-Nombre': 'x.svg' }); revisa(s === 400, 'un SVG o HTML disfrazado, no', s);
  [s] = await pedir('POST', '/marketing/biblioteca', T.Mara, png([1, 2, 3]), { 'X-Nombre': 'x.png', 'X-Carpeta': encodeURIComponent('<img src=x>') }); revisa(s === 400, 'una carpeta con código, no', s);
  [s, j] = await pedir('POST', '/marketing/biblioteca', T.Mara, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Nombre': 'manual-de-marca.pdf', 'X-Carpeta': 'Documentos' }); revisa(s === 201, 'se sube un PDF (manual de marca)', s); const pdfId = j.id;
  [s, j] = await pedir('GET', '/marketing/biblioteca?q=fondo%20blanco', T.Gil);
  revisa(s === 200 && j.archivos.length === 1 && j.archivos[0].id === logoId && j.carpetas.includes('Logos'), 'se busca por etiqueta', j.archivos);
  [, j] = await pedir('GET', '/marketing/biblioteca', T.Gil);
  revisa(['biblioteca', 'publicacion', 'avance'].every(o => j.archivos.some(f => f.origen === o)), 'muestra en un lugar lo subido, las imágenes de publicaciones y los archivos de avances', [...new Set(j.archivos.map(f => f.origen))]);
  [s] = await pedir('PUT', '/marketing/biblioteca/' + logoId, T.Mara, { nombre: 'Logo verde horizontal', carpeta: 'Logos oficiales', etiquetas: 'logo' }); revisa(s === 200, 'se renombra y se mueve de carpeta', s);
  [, j] = await pedir('GET', '/marketing/biblioteca?carpeta=' + encodeURIComponent('Logos oficiales'), T.Mara); revisa(j.archivos[0]?.nombre === 'Logo verde horizontal', 'aparece en su carpeta nueva', j.archivos);
  // De la biblioteca a una publicación
  const pubB = (await pedir('POST', '/marketing/publicaciones', T.Mara, { ...base, titulo: 'Con logo de la biblioteca' }))[1];
  [s, j] = await pedir('POST', '/marketing/publicaciones/' + pubB.id + '/desde-biblioteca', T.Mara, { biblioteca_id: logoId }); revisa(s === 201 && j.lista_imagenes.length === 1, 'una imagen de la biblioteca se agrega a una publicación', j.lista_imagenes);
  [s] = await pedir('POST', '/marketing/publicaciones/' + pubB.id + '/desde-biblioteca', T.Mara, { biblioteca_id: logoId }); revisa(s === 409, 'la misma imagen dos veces en una publicación, no', s);
  [s] = await pedir('POST', '/marketing/publicaciones/' + pubB.id + '/desde-biblioteca', T.Mara, { biblioteca_id: pdfId }); revisa(s === 400, 'un PDF no va como imagen de publicación', s);
  [s] = await pedir('POST', '/marketing/biblioteca/' + logoId + '/quitar', T.Mara, {}); revisa(s === 200, 'se quita de la biblioteca', s);
  [, j] = await pedir('GET', '/marketing/publicaciones/' + pubB.id, T.Mara);
  [s, k] = await pedir('GET', '/marketing/imagenes/' + j.lista_imagenes[0].id, T.Mara); revisa(s === 200 && k._tipo === 'image/png', 'la publicación conserva su copia aunque se quite de la biblioteca', [s, k]);
  [s] = await pedir('GET', '/marketing/biblioteca/' + logoId, T.Mara); revisa(s === 404, 'lo quitado ya no se descarga', s);
  [s] = await pedir('GET', '/marketing/biblioteca', T.Vale); revisa(s === 403, 'Ventas no ve la biblioteca', s);
  [s] = await pedir('POST', '/marketing/biblioteca', T.Gema, png([5, 5, 5]), { 'X-Nombre': 'x.png' }); revisa(s === 403, 'el Gerente de sucursal no sube a la biblioteca', s);

  console.log('10. Presupuesto (fase 4): lo propone el Gerente de marketing, lo aprueba Dirección');
  const MES = HOY.slice(0, 7);
  [s] = await pedir('GET', '/marketing/presupuestos/' + MES, T.Mara); revisa(s === 403, 'Marketing no ve el presupuesto (sin montos)', s);
  [s] = await pedir('PUT', '/marketing/presupuestos/' + MES, T.Gil, { lineas: { pauta: -5 } }); revisa(s === 400, 'un monto negativo, no', s);
  [s] = await pedir('PUT', '/marketing/presupuestos/' + MES, T.Gil, { lineas: { inventado: 5 } }); revisa(s === 400, 'un rubro inventado, no', s);
  [s, j] = await pedir('PUT', '/marketing/presupuestos/' + MES, T.Gil, { lineas: { pauta: 12000, diseno: 3500.5 } });
  revisa(s === 200 && j.estado === 'borrador' && j.total === 15500.5, 'el Gerente de marketing captura el presupuesto (borrador)', [j.estado, j.total]);
  [s] = await pedir('POST', '/marketing/presupuestos/' + MES + '/estado', T.Gil, { accion: 'aprobar', version: j.version }); revisa(s === 403, 'el Gerente de marketing no se lo aprueba solo', s);
  [s, j] = await pedir('POST', '/marketing/presupuestos/' + MES + '/estado', T.Gil, { accion: 'enviar', version: j.version }); revisa(s === 200 && j.estado === 'enviado', 'lo envía a Dirección', j.estado);
  [s] = await pedir('POST', '/marketing/presupuestos/' + MES + '/estado', A, { accion: 'rechazar', version: j.version }); revisa(s === 400, 'rechazar exige motivo', s);
  [s, j] = await pedir('POST', '/marketing/presupuestos/' + MES + '/estado', A, { accion: 'rechazar', version: j.version, motivo: 'Baja la pauta' }); revisa(s === 200 && j.estado === 'rechazado' && j.motivo === 'Baja la pauta', 'Dirección lo rechaza con motivo', j.estado);
  [s, j] = await pedir('PUT', '/marketing/presupuestos/' + MES, T.Gil, { lineas: { pauta: 9000 }, version: j.version }); [s, j] = await pedir('POST', '/marketing/presupuestos/' + MES + '/estado', T.Gil, { accion: 'enviar', version: j.version });
  [s, j] = await pedir('POST', '/marketing/presupuestos/' + MES + '/estado', A, { accion: 'aprobar', version: j.version });
  revisa(s === 200 && j.estado === 'aprobado' && j.total === 12500.5 && j.aprobado_por_nombre, 'lo corrige, lo reenvía y Dirección lo aprueba', [j.estado, j.total]);
  [s, j] = await pedir('PUT', '/marketing/presupuestos/' + MES, T.Gil, { lineas: { video: 1000 }, version: j.version }); revisa(j.estado === 'borrador' && j.historial[0].texto.includes('regresó a borrador'), 'si se cambia ya aprobado, regresa a borrador', j.estado);

  console.log('11. Gastos del departamento (control interno)');
  for (const [cuerpo, que] of [[{ fecha: HOY, concepto: 'x', rubro: 'pauta', monto: 0 }, 'monto en cero'], [{ fecha: HOY, concepto: ' ', rubro: 'pauta', monto: 10 }, 'sin concepto'], [{ fecha: '2099-01-01', concepto: 'x', rubro: 'pauta', monto: 10 }, 'una fecha futura'], [{ fecha: HOY, concepto: 'x', rubro: 'nada', monto: 10 }, 'un rubro inventado'], [{ fecha: HOY, concepto: 'x', rubro: 'pauta', monto: 10.123 }, 'tres decimales']]) {
    [s] = await pedir('POST', '/marketing/gastos', T.Gil, cuerpo); revisa(s === 400, 'gasto: rechaza ' + que, s);
  }
  [s] = await pedir('POST', '/marketing/gastos', T.Mara, { fecha: HOY, concepto: 'x', rubro: 'pauta', monto: 10 }); revisa(s === 403, 'Marketing no registra gastos', s);
  [s, j] = await pedir('POST', '/marketing/gastos', T.Gil, { fecha: HOY, concepto: 'Pauta Instagram lluvias', rubro: 'pauta', monto: 2500.75, proveedor: 'Meta', red: 'instagram', proyecto_id: proy.id, factura: 'F-123' });
  revisa(s === 201 && j.monto === 2500.75 && j.proyecto_nombre === proy.nombre, 'el Gerente de marketing registra un gasto ligado a un proyecto', j);
  const gasto = j;
  [s, j] = await pedir('POST', '/marketing/gastos/' + gasto.id + '/comprobante', T.Gil, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Nombre': 'factura.pdf' }); revisa(s === 201 && j.tiene_comprobante, 'se adjunta el comprobante', s);
  [s, k] = await pedir('GET', '/marketing/gastos/' + gasto.id + '/comprobante', A); revisa(s === 200 && k._tipo === 'application/pdf', 'el comprobante se descarga', [s, k]);
  [, j] = await pedir('GET', '/marketing/presupuestos/' + MES, A); revisa(j.rubros.find(r => r.rubro === 'pauta').gastado === 2500.75, 'el presupuesto muestra lo gastado por rubro', j.rubros.find(r => r.rubro === 'pauta'));
  [, j] = await pedir('GET', '/finanzas/cxp?vista=todas', A); revisa(!JSON.stringify(j).includes('Pauta Instagram lluvias'), 'el gasto NO aparece en Cuentas por pagar (decisión: solo control interno)');
  [s] = await pedir('POST', '/marketing/gastos/' + gasto.id + '/cancelar', T.Gil, {}); revisa(s === 400, 'cancelar exige motivo', s);
  const g2 = (await pedir('POST', '/marketing/gastos', T.Gil, { fecha: HOY, concepto: 'Lona duplicada', rubro: 'impresion', monto: 800 }))[1];
  [s, j] = await pedir('POST', '/marketing/gastos/' + g2.id + '/cancelar', T.Gil, { motivo: 'Se capturó dos veces' }); revisa(s === 200 && j.cancelado === 1, 'un gasto se cancela con motivo (no se borra)', j);
  [, j] = await pedir('GET', '/marketing/gastos?desde=' + HOY + '&hasta=' + HOY, A); revisa(j.total === 2500.75 && !j.gastos.some(x => x.id === g2.id), 'lo cancelado no suma ni sale en la lista', j.total);

  console.log('12. Resultados y retorno por campaña');
  const [, canales] = await pedir('GET', '/canales', A);
  [s] = await pedir('PUT', '/marketing/proyectos/' + proy.id + '/canal', T.Mara, { canal_id: canales[0].id }); revisa(s === 200, 'se liga la campaña a su canal de «¿Cómo se enteró?»', s);
  await pedir('POST', '/contactos', A, { nombre: 'Cliente de campaña', telefono: '442 777 0101', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  [s, j] = await pedir('GET', '/marketing/resultados?desde=' + dias(-30) + '&hasta=' + dias(30), T.Gil);
  const filaP = j.proyectos?.find(p => p.id === proy.id);
  revisa(s === 200 && filaP && filaP.contactos >= 1 && filaP.gasto === 2500.75 && filaP.costo_contacto > 0 && 'retorno' in filaP, 'la campaña muestra contactos, gasto, costo por contacto y retorno', filaP);
  [s, j] = await pedir('GET', '/marketing/resultados?desde=' + dias(-30) + '&hasta=' + dias(30), T.Mara);
  const filaM = j.proyectos?.find(p => p.id === proy.id);
  revisa(s === 200 && filaM && filaM.contactos >= 1 && !('gasto' in filaM) && !('vendido' in filaM) && !('gasto' in j.totales) && !j.dinero, 'a Marketing le llegan los resultados SIN montos', filaM);
  [s] = await pedir('PUT', '/marketing/canales', T.Mara, { canales: [canales[1].id] }); revisa(s === 200, 'se marcan los canales que cuentan como de marketing', s);

  console.log('13. Plan anual y metas');
  const ANIO = Number(HOY.slice(0, 4)), MESN = Number(HOY.slice(5, 7));
  [s] = await pedir('PUT', '/marketing/plan/' + ANIO + '/metas', T.Mara, { metas: { [MESN]: { gasto: 5000 } } }); revisa(s === 403, 'Marketing no fija metas de dinero', s);
  [s] = await pedir('PUT', '/marketing/plan/' + ANIO + '/metas', T.Mara, { metas: { [MESN]: { publicaciones: 12, contactos: 30 } } }); revisa(s === 200, 'Marketing fija metas de publicaciones y contactos', s);
  [s] = await pedir('PUT', '/marketing/plan/' + ANIO + '/metas', T.Gil, { metas: { [MESN]: { gasto: 15000, ventas: 80000 } } }); revisa(s === 200, 'el Gerente de marketing fija metas de dinero', s);
  [s, j] = await pedir('POST', '/marketing/plan/' + ANIO + '/objetivos', T.Mara, { titulo: 'Duplicar seguidores en TikTok' }); revisa(s === 201 && j.estado === 'en_curso', 'se agrega un objetivo del año', j);
  [s, j] = await pedir('PUT', '/marketing/objetivos/' + j.id, T.Mara, { version: j.version, estado: 'logrado' }); revisa(s === 200 && j.estado === 'logrado', 'se marca logrado', j.estado);
  [, j] = await pedir('GET', '/marketing/plan/' + ANIO, T.Mara);
  revisa(j.metas[MESN]?.publicaciones === 12 && !('gasto' in (j.metas[MESN] || {})) && j.real[MESN] && !('gasto' in j.real[MESN]) && !j.indicadores.gasto, 'Marketing ve sus metas y lo real, sin las de dinero', [j.metas[MESN], j.real[MESN]]);
  [, j] = await pedir('GET', '/marketing/plan/' + ANIO, T.Gil); revisa(j.metas[MESN]?.gasto === 15000 && 'gasto' in j.real[MESN], 'el Gerente de marketing ve también las de dinero', j.metas[MESN]);

  console.log('14. Tablero del departamento');
  [s, j] = await pedir('GET', '/marketing/tablero', T.Gil);
  revisa(s === 200 && j.dinero_mes && j.dinero_mes.gastado === 2500.75 && Array.isArray(j.carga) && j.publicaciones && Array.isArray(j.avisos), 'el tablero trae publicaciones, carga de trabajo, avisos y presupuesto contra gasto', [s, j.error || Object.keys(j)]);
  [s, j] = await pedir('GET', '/marketing/tablero', T.Mara); revisa(s === 200 && j.dinero_mes === null && !('gasto' in j.real) && !JSON.stringify(j).includes('2500.75'), 'a Marketing el tablero le llega sin montos', j.dinero_mes);
  [s] = await pedir('GET', '/marketing/tablero', T.Vale); revisa(s === 403, 'Ventas no entra al tablero de Marketing', s);

  console.log('15. Texto por red, orden de imágenes, resultados por publicación (2026-10-27)');
  {
    const est = async (id, t, accion, extra = {}) => pedir('POST', '/marketing/publicaciones/' + id + '/estado', t, { accion, version: (await pedir('GET', '/marketing/publicaciones/' + id, A))[1].version, ...extra });
    [s, j] = await pedir('POST', '/marketing/publicaciones', T.Mara, { ...base, titulo: 'Texto por red', redes: ['instagram', 'linkedin'], copy: 'Base', copy_redes: { linkedin: 'Versión formal\r\npara LinkedIn', instagram: '   ' } });
    revisa(s === 201 && j.copy_redes.linkedin === 'Versión formal\npara LinkedIn' && !('instagram' in j.copy_redes), 'cada red puede llevar su texto; uno vacío usa el base', j.copy_redes);
    let pr = j;
    for (const [cuerpo, que] of [[{ copy_redes: { myspace: 'x' } }, 'una red inventada'], [{ copy_redes: ['x'] }, 'una lista en vez de textos'], [{ copy_redes: { linkedin: 'x'.repeat(5001) } }, 'un texto de más de 5000'], [{ copy_redes: { linkedin: 5 } }, 'un número']]) {
      [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id, T.Mara, { version: pr.version, ...cuerpo }); revisa(s === 400, 'el texto por red rechaza ' + que, s);
    }
    [s, pr] = await pedir('PUT', '/marketing/publicaciones/' + pr.id, T.Mara, { version: pr.version, copy_redes: { linkedin: 'Versión formal 2' } });
    revisa(s === 200 && pr.copy_redes.linkedin === 'Versión formal 2' && /texto por red/.test(pr.historial[0].texto), 'cambiar el texto de una red queda en el historial', pr.historial?.[0]);
    [s, j] = await pedir('GET', '/marketing/publicaciones?' + new URLSearchParams({ desde: dias(-30), hasta: dias(60), q: 'version formal' }), T.Mara);
    revisa(s === 200 && j.some(p => p.id === pr.id), 'el buscador encuentra el texto de una red (sin acentos)', j.map(p => p.titulo));
    await pedir('POST', '/marketing/publicaciones/' + pr.id + '/imagenes', T.Mara, png([1, 99, 1]), { 'X-Nombre': 'uno.png' });
    await pedir('POST', '/marketing/publicaciones/' + pr.id + '/imagenes', T.Mara, png([2, 99, 2]), { 'X-Nombre': 'dos.png' });
    [s, pr] = await pedir('POST', '/marketing/publicaciones/' + pr.id + '/imagenes', T.Mara, png([3, 99, 3]), { 'X-Nombre': 'tres.png' });
    const ids = pr.lista_imagenes.map(i => i.id);
    [s] = await est(pr.id, T.Mara, 'enviar'); [s, pr] = await est(pr.id, T.Gil, 'aprobar'); revisa(pr.estado === 'aprobada', 'se aprueba (para probar el orden)', pr.estado);
    for (const [cuerpo, que] of [[[ids[0], ids[1]], 'si faltan imágenes'], [[ids[0], ids[0], ids[1]], 'si repite una'], [[ids[0], ids[1], 99999], 'una que no es de la publicación']]) {
      [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/imagenes/orden', T.Mara, { ids: cuerpo, version: pr.version }); revisa(s === 400, 'el orden se rechaza ' + que, s);
    }
    [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/imagenes/orden', T.Mara, { ids: [ids[2], ids[0], ids[1]], version: pr.version - 1 }); revisa(s === 409, 'con una versión vieja, no (otra persona la cambió)', s);
    [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/imagenes/orden', T.Mara, { ids: [ids[2], ids[0], ids[1]], version: pr.version });
    revisa(s === 200 && j.lista_imagenes.map(i => i.nombre).join() === 'tres.png,uno.png,dos.png' && j.portada_id === ids[2], 'cambia el orden y la portada', j.lista_imagenes?.map(i => i.nombre));
    revisa(j.estado === 'borrador' && /portada: «tres.png»/.test(j.historial[0].texto) && /regresó a borrador/.test(j.historial[0].texto), 'en un carrusel el orden es contenido: la aprobada regresa a borrador (queda en el historial)', [j.estado, j.historial[0].texto]);
    [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/imagenes/orden', T.Vale, { ids, version: j.version }); revisa([403, 404].includes(s), 'Ventas no ordena imágenes de Marketing (ni la ve)', s);
    // Resultados: solo publicadas, solo sus redes, números enteros.
    pr = j;
    [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/metricas', T.Mara, { red: 'instagram', valores: { alcance: 10 } }); revisa(s === 409, 'los resultados se capturan hasta que está publicada', s);
    await est(pr.id, T.Mara, 'enviar'); await est(pr.id, T.Gil, 'aprobar'); [s, pr] = await est(pr.id, T.Mara, 'publicar');
    for (const [cuerpo, que] of [[{ red: 'tiktok', valores: { alcance: 1 } }, 'una red que no es de la publicación'], [{ red: 'instagram', valores: { alcance: 1.5 } }, 'decimales'], [{ red: 'instagram', valores: { alcance: -3 } }, 'negativos'],
      [{ red: 'instagram', valores: { likes: 3 } }, 'un dato inventado'], [{ red: 'instagram', valores: {} }, 'nada que guardar'], [{ red: 'instagram', valores: { alcance: 5 }, enlace: 'javascript:alert(1)' }, 'un enlace que no es https']]) {
      [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/metricas', T.Mara, cuerpo); revisa(s === 400, 'resultados: se rechaza ' + que, s);
    }
    [s] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/metricas', T.Vale, { red: 'instagram', valores: { alcance: 5 } }); revisa([403, 404].includes(s), 'Ventas no captura resultados de Marketing (ni la ve)', s);
    [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/metricas', T.Mara, { red: 'instagram', valores: { alcance: 2000, me_gusta: 150, comentarios: 20, compartidos: 10, guardados: 20, mensajes: 4 }, enlace: 'https://www.instagram.com/p/x' });
    revisa(s === 200 && j.metricas.length === 1 && j.metricas[0].alcance === 2000 && j.metricas[0].capturado_por_nombre === 'Mara Marketing', 'Marketing captura los resultados de Instagram (queda quién y cuándo)', j.metricas);
    [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/metricas', T.Gil, { red: 'instagram', valores: { alcance: 2500, me_gusta: 150, comentarios: 20, compartidos: 10, guardados: 20, mensajes: 4 } });
    revisa(s === 200 && j.metricas.length === 1 && j.metricas[0].alcance === 2500 && j.metricas[0].enlace === '', 'volver a capturar la misma red la actualiza (no la duplica)', j.metricas);
    [s, j] = await pedir('PUT', '/marketing/publicaciones/' + pr.id + '/metricas', T.Gil, { red: 'linkedin', valores: { alcance: 500, me_gusta: 20, comentarios: 5 } });
    revisa(s === 200 && j.metricas.length === 2 && /Capturó los resultados de LinkedIn/.test(j.historial[0].texto), 'cada red guarda los suyos y queda en el historial', j.historial?.[0]);
    [s, j] = await pedir('GET', '/marketing/resultados?' + new URLSearchParams({ desde: dias(-60), hasta: dias(60) }), T.Mara);
    const fila = j.publicaciones?.find(p => p.id === pr.id), ig = j.publicaciones_por_red?.find(r => r.red === 'instagram');
    revisa(s === 200 && fila && fila.alcance === 3000 && fila.interacciones === 225 && fila.tasa === 7.5 && fila.mensajes === 4, 'Resultados suma las redes de cada publicación y calcula la tasa (interacciones entre alcance)', fila);
    revisa(ig && ig.interacciones === 200 && ig.tasa === 8, 'y el resumen por red', ig);
    revisa(j.publicaciones[0].id === pr.id || j.publicaciones[0].interacciones >= fila.interacciones, 'ordenadas de más a menos interacciones', j.publicaciones.map(p => p.interacciones));
    revisa(typeof j.sin_capturar === 'number' && !('gasto' in fila), 'cuenta las publicadas sin resultados y no trae dinero', [j.sin_capturar, fila]);
    [s] = await pedir('GET', '/marketing/resultados?' + new URLSearchParams({ desde: dias(-60), hasta: dias(60) }), T.Gema); revisa(s === 403, 'el Gerente de sucursal no ve los resultados de Marketing', s);
    [s, j] = await pedir('GET', '/marketing/publicaciones/' + pr.id, T.Mara);
    revisa(j.versiones.some(v => v.copy_redes?.linkedin), 'las versiones anteriores guardan también los textos por red', j.versiones.map(v => v.copy_redes));
  }

  console.log('7. Catálogos que no le tocan (auditoría 2026-10-27)');
  [s] = await pedir('GET', '/compras/centros', T.Mara); revisa(s === 403, 'Marketing no descarga los centros de costo (con su responsable)', s);
  [s] = await pedir('GET', '/compras/centros', T.Vale); revisa(s === 200, 'Ventas sí (pide solicitudes de compra)', s);

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|Error en (GET|POST|PUT|DELETE)/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
