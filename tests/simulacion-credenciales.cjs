// CREDENCIALES DE EMPLEADO (2026-11-05): foto, emisión con vigencia y verificación pública para los clientes.
//  1. Foto: solo quien edita el personal la sube; JPG o PNG de hasta 2 MB; cifrada en el disco; la ficha dice si tiene
//     (nunca el nombre del archivo); otra sucursal no la ve ni la cambia.
//  2. Emitir: solo quien edita el personal, vigencia futura de hasta 3 años, solo personas activas de sus sucursales;
//     el token solo existe en la respuesta (la base guarda su hash); imprimir otra anula la anterior.
//  3. Verificación /credencial/<token>: vigente → foto, nombre, puesto y vigencia; reemplazada, dada de baja, vencida o
//     inventada → «NO VÁLIDA» sin datos de la persona; no se guarda en caché ni se indexa; tope de consultas.
//  4. La base no deja borrar ni cambiar una credencial emitida.
// Uso: node tests/simulacion-credenciales.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-credenciales-')), DB = path.join(dir, 'cred.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Credencial-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Cred-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9700 + Math.floor(Math.random() * 250)), URLB = 'http://localhost:' + PUERTO;
const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
let ip = '10.40.0.1';
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const subirFoto = (t, id, buf, tipo = 'image/jpeg') => fetch(URLB + '/api/personal/' + id + '/foto', { method: 'POST', headers: { 'Content-Type': tipo, 'CF-Connecting-IP': ip, Authorization: 'Bearer ' + t }, body: buf }).then(r => r.status);
const ver = async ruta => { const x = await fetch(URLB + ruta, { headers: { 'CF-Connecting-IP': ip } }); return [x.status, await x.text(), x.headers]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumar = (f, k) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const MARCA = 'FOTO-CRED-' + crypto.randomBytes(5).toString('hex');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(MARCA), crypto.randomBytes(2500), Buffer.from([0xff, 0xd9])]);
const archivos = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? archivos(path.join(d, e.name)) : [path.join(d, e.name)]) : []);

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
  const juan = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Juan Pérez Técnico', puesto: 'Técnico', contacto_emergencia: 'María Pérez', tel_emergencia: '442 111 2233' }), 'alta de Juan');
  const ana = exigir(await pedir('POST', '/personal', T.Gema, { nombre: 'Ana López', puesto: 'Administración' }), 'alta de Ana');
  for (const p of [juan, ana]) exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', T.Gema), 'checador');

  console.log('1. Foto para la credencial');
  revisa(await subirFoto(T.Valeria, juan.id, JPG) === 403, 'Ventas no sube fotos');
  revisa(await subirFoto(T.Gus, juan.id, JPG) === 404, 'El gerente de CDMX no cambia la foto de alguien de Querétaro');
  revisa(await subirFoto(T.Gema, juan.id, Buffer.from('<html>no soy foto</html>'), 'text/html') === 400, 'Algo que no es JPG ni PNG se rechaza');
  revisa(await subirFoto(T.Gema, juan.id, JPG) === 201, 'La gerente sube la foto de Juan');
  const enDisco = archivos(path.join(dir, 'archivos', 'credenciales'));
  revisa(enDisco.length === 1 && !fs.readFileSync(enDisco[0]).includes(MARCA), 'La foto queda cifrada en el disco', enDisco);
  const [, ficha, fichaTxt] = await pedir('GET', '/personal/' + juan.id, T.Gema);
  revisa(ficha.tiene_foto === true && !fichaTxt.includes('.cifrado'), 'La ficha dice que tiene foto, sin el nombre del archivo', ficha.tiene_foto);
  const fx = await fetch(URLB + '/api/personal/' + juan.id + '/foto', { headers: { Authorization: 'Bearer ' + T.Gema } });
  revisa(fx.status === 200 && Buffer.from(await fx.arrayBuffer()).includes(MARCA) && /no-store/.test(fx.headers.get('cache-control') || ''), 'La gerente ve la foto (sin guardarse en caché)');
  revisa((await pedir('GET', '/personal/' + juan.id + '/foto', T.Gus))[0] === 404, 'El de CDMX no la ve');
  revisa(await subirFoto(T.Gema, juan.id, JPG) === 201 && archivos(path.join(dir, 'archivos', 'credenciales')).length === 1, 'Cambiar la foto borra la anterior del disco');

  console.log('2. Emitir credenciales');
  revisa((await pedir('POST', '/rh/credenciales', T.Valeria, { ids: [juan.id], vigencia: sumar(HOY, 365) }))[0] === 403, 'Ventas no imprime credenciales');
  revisa((await pedir('POST', '/rh/credenciales', T.Gus, { ids: [juan.id], vigencia: sumar(HOY, 365) }))[0] === 404, 'El de CDMX no imprime la de alguien de Querétaro');
  revisa((await pedir('POST', '/rh/credenciales', T.Gema, { ids: [juan.id], vigencia: HOY }))[0] === 400, 'La vigencia no puede ser hoy ni antes');
  revisa((await pedir('POST', '/rh/credenciales', T.Gema, { ids: [juan.id], vigencia: sumar(HOY, 1200) }))[0] === 400, 'Ni de más de 3 años');
  const [se, e1] = await pedir('POST', '/rh/credenciales', T.Gema, { ids: [juan.id, ana.id], vigencia: sumar(HOY, 365) });
  const cj = e1.credenciales?.find(c => c.personal_id === juan.id);
  revisa(se === 201 && cj && /^\/credencial\/[A-Za-z0-9_-]{40,60}$/.test(cj.ruta) && cj.codigo && cj.tel_emergencia === '442 111 2233' && cj.tiene_foto, 'Regresa la ruta de verificación, el código, el contacto de emergencia y si tiene foto', cj);
  const tok1 = cj.ruta.split('/').pop();
  revisa(!conBase(d => d.prepare('SELECT 1 FROM credenciales WHERE token_hash = ?').get(tok1)), 'La base guarda solo el hash del token');
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM auditoria WHERE detalle LIKE '%credencial impresa%'").get().n) === 2, 'Cada credencial impresa queda en la bitácora');

  console.log('3. Verificación pública');
  let [sv, html, hdr] = await ver(cj.ruta);
  revisa(sv === 200 && /CREDENCIAL VIGENTE/.test(html) && html.includes('Juan Pérez Técnico') && /data:image\/jpeg;base64,/.test(html) && html.includes('Técnico'), 'Vigente: muestra foto, nombre y puesto', sv);
  revisa(/no-store/.test(hdr.get('cache-control') || '') && /noindex/.test(hdr.get('x-robots-tag') || ''), 'No se guarda en caché ni la indexan los buscadores');
  revisa(!html.includes('442 111 2233') && !html.includes('María'), 'No muestra el contacto de emergencia');
  const tokAna = e1.credenciales.find(c => c.personal_id === ana.id).ruta;
  [sv, html] = await ver(tokAna);
  revisa(sv === 200 && /VIGENTE/.test(html) && /sin foto registrada/.test(html), 'Sin foto: vigente pero avisa que no hay foto');
  const e2 = exigir(await pedir('POST', '/rh/credenciales', T.Gema, { ids: [juan.id], vigencia: sumar(HOY, 365) }), 'reimprimir');
  [sv, html] = await ver(cj.ruta);
  revisa(/NO VÁLIDA/.test(html) && !html.includes('Juan') && !html.includes('base64'), 'Al imprimir otra, la anterior dice «NO VÁLIDA» y no muestra a la persona', sv);
  revisa(/VIGENTE/.test((await ver(e2.credenciales[0].ruta))[1]), 'La nueva sí es vigente');
  exigir(await pedir('POST', '/personal/' + ana.id + '/baja', T.Gema, { fecha_baja: HOY, motivo: 'Renuncia voluntaria' }), 'baja de Ana');
  [sv, html] = await ver(tokAna);
  revisa(/NO VÁLIDA/.test(html) && !html.includes('Ana'), 'Dada de baja: su credencial ya no es válida');
  conBase(d => { d.exec('DROP TRIGGER IF EXISTS credenciales_fijas'); d.prepare('UPDATE credenciales SET vigencia = ? WHERE token_hash IS NOT NULL AND anulada_at IS NULL AND personal_id = ?').run(sumar(HOY, -1), juan.id); });
  [sv, html] = await ver(e2.credenciales[0].ruta);
  revisa(/NO VÁLIDA/.test(html), 'Vencida: ya no es válida');
  [sv, html] = await ver('/credencial/' + 'Z'.repeat(43));
  revisa(sv === 404 && /NO VÁLIDA/.test(html), 'Un token inventado: «NO VÁLIDA»');
  ip = '10.40.0.99';
  for (let i = 0; i < 60; i++) await ver('/credencial/' + crypto.randomBytes(32).toString('base64url'));
  revisa((await ver('/credencial/x'))[0] === 429, 'Quien prueba muchos tokens se frena (429)');

  console.log('4. Candados de la base');
  revisa(conBase(d => { try { d.prepare('DELETE FROM credenciales').run(); return false; } catch { return true; } }), 'Las credenciales emitidas no se borran');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
