// RESPALDO COMPLETO (auditoría 2026-11-03): la base sola no basta. Los PDF de las facturas, los documentos del
// expediente, las fotos de las checadas y los comprobantes viven en la carpeta «archivos/», junto a la base; sin
// ellos, una falla del disco los pierde aunque haya copia de la base. Esta ruta (solo Dirección) descarga UN archivo
// .tar con la copia consistente de la base («saneadren.db») y toda la carpeta «archivos/».
//  · Ruta: POST /api/admin/backup-completo (con sesión) da un boleto; GET /descargas/respaldo-completo?b=… baja el archivo.
//  · Se arma al vuelo (streaming): no se carga en memoria aunque sean varios GB de fotos.
//  · NUNCA incluye la clave de cifrado (clave-cifrado.key vive junto a la base, fuera de «archivos/»): los documentos
//    y fotos van cifrados y sin la clave no se abren. La clave se guarda aparte.
//  · .tar sin comprimir: los archivos ya van cifrados (no se comprimen) y así no se gasta CPU del servidor.
//    Se abre con doble clic en Mac y Windows 11, o con 7-Zip.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

// Encabezado tar (ustar) de 512 bytes. Rutas de hasta 100 bytes en «name»; más largas, partidas en «prefix».
function encabezado(nombre, tamano, mtime, tipo = '0') {
  const b = Buffer.alloc(512);
  let name = nombre, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const corte = nombre.lastIndexOf('/', 155);
    if (corte <= 0 || Buffer.byteLength(nombre.slice(corte + 1)) > 100) return null; // ruta imposible en ustar: se omite
    prefix = nombre.slice(0, corte); name = nombre.slice(corte + 1);
  }
  const escribe = (txt, inicio, largo) => b.write(txt, inicio, largo, 'utf8');
  const octal = (n, largo) => n.toString(8).padStart(largo - 1, '0') + '\0';
  escribe(name, 0, 100);
  escribe(octal(tipo === '5' ? 0o755 : 0o644, 8), 100, 8);
  escribe(octal(0, 8), 108, 8); escribe(octal(0, 8), 116, 8);
  escribe(octal(tamano, 12), 124, 12);
  escribe(octal(Math.floor(mtime / 1000), 12), 136, 12);
  b.fill(' ', 148, 156); // suma de verificación: se calcula con este campo en espacios
  escribe(tipo, 156, 1);
  escribe('ustar\0', 257, 6); escribe('00', 263, 2);
  escribe(prefix, 345, 155);
  let suma = 0; for (const x of b) suma += x;
  escribe(suma.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return b;
}
const relleno = n => Buffer.alloc((512 - (n % 512)) % 512);

// Todos los archivos normales bajo «dir» (sin seguir enlaces), con su ruta relativa con «/».
async function* recorrer(dir, rel = '') {
  let entradas;
  try { entradas = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
  entradas.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entradas) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) yield* recorrer(dir, r);
    else if (e.isFile()) yield r;
  }
}

// Genera el .tar: la base y luego cada archivo. «omitidos» junta lo que no se pudo leer (se reporta en el .tar).
async function* armarTar({ base, dirArchivos }) {
  const omitidos = [];
  const archivo = async function* (ruta, nombre) {
    let st;
    try { st = await fs.promises.stat(ruta); } catch { omitidos.push(nombre + ' (no se pudo leer)'); return; }
    const h = encabezado(nombre, st.size, st.mtimeMs);
    if (!h) { omitidos.push(nombre + ' (ruta demasiado larga)'); return; }
    yield h;
    let enviados = 0;
    // Si el archivo cambia de tamaño mientras se copia, se respeta el tamaño del encabezado (el .tar no se rompe).
    if (st.size) for await (const trozo of fs.createReadStream(ruta, { end: st.size - 1 })) { enviados += trozo.length; yield trozo; }
    if (enviados < st.size) yield Buffer.alloc(st.size - enviados);
    yield relleno(st.size);
  };
  yield* archivo(base, 'saneadren.db');
  let n = 0;
  for await (const rel of recorrer(dirArchivos)) { n++; yield* archivo(path.join(dirArchivos, rel), 'archivos/' + rel); }
  const nota = Buffer.from([
    'RESPALDO COMPLETO DE SANEADREN CRM',
    `Fecha: ${new Date().toISOString()}`,
    `Contiene: saneadren.db (la base) y ${n} archivo(s) de la carpeta «archivos/».`,
    'Los documentos y fotos van CIFRADOS: para abrirlos hace falta la clave de cifrado del servidor (CLAVE_CIFRADO),',
    'que NO viene en este respaldo. Guárdala aparte.',
    'Para restaurar: detén el sistema, pon saneadren.db en la ruta de DB_PATH y la carpeta «archivos/» junto a ella.',
    ...(omitidos.length ? ['', 'NO SE INCLUYERON:', ...omitidos] : []),
  ].join('\n') + '\n');
  yield encabezado('LEEME.txt', nota.length, Date.now());
  yield nota; yield relleno(nota.length);
  yield Buffer.alloc(1024); // fin del .tar: dos bloques en cero
}

// Descarga en dos pasos: con la sesión se pide un boleto de un solo uso (60 s) y el navegador baja el archivo
// directo con ese boleto. Así el archivo (que puede pesar GB) va al disco y no a la memoria de la pestaña.
const BOLETO_MS = 60 * 1000;
module.exports = function respaldoCompleto(app, db, h, { hoyMexico }) {
  const raiz = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const dirArchivos = path.join(raiz, 'archivos');
  const boletos = new Map(); // hash del boleto → { expira, usuarioSesion }
  let enCurso = false; // uno a la vez: arma varios GB y no hace falta en paralelo
  const hash = t => crypto.createHash('sha256').update(t).digest('hex');
  app.post('/api/admin/backup-completo', h((req, res) => {
    if (!req.usuarioSesion?.admin_general) return res.status(403).json({ error: 'Solo Dirección puede descargar el respaldo completo' });
    const t = Date.now();
    for (const [k, v] of boletos) if (v.expira <= t) boletos.delete(k);
    const boleto = crypto.randomBytes(24).toString('base64url');
    boletos.set(hash(boleto), { expira: t + BOLETO_MS, usuarioSesion: req.usuarioSesion });
    res.json({ url: '/descargas/respaldo-completo?b=' + boleto });
  }));
  app.get('/descargas/respaldo-completo', async (req, res) => {
    const b = String(req.query.b || ''), k = /^[A-Za-z0-9_-]{30,40}$/.test(b) ? hash(b) : '', x = boletos.get(k);
    boletos.delete(k); // un solo uso, sirva o no
    res.set('Referrer-Policy', 'no-referrer');
    if (!x || x.expira <= Date.now()) return res.status(403).type('text/plain; charset=utf-8').send('El enlace del respaldo ya se usó o venció. Vuelve a pulsar el botón en el CRM.');
    if (enCurso) return res.status(409).type('text/plain; charset=utf-8').send('Ya se está descargando un respaldo completo. Espera a que termine.');
    req.usuarioSesion = x.usuarioSesion;
    enCurso = true;
    const copia = path.join(os.tmpdir(), `saneadren-completo-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
    try {
      await db.backup(copia); // copia consistente aunque haya escrituras en curso
      res.set({ 'Content-Type': 'application/x-tar', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="saneadren_respaldo_completo_${hoyMexico()}.tar"` });
      await pipeline(armarTar({ base: copia, dirArchivos }), res);
      app.locals.auditoria?.registrar(req, 'respaldo', null, 'descarga', 'Respaldo completo (base + archivos)');
      app.locals.registro?.anotar(req, 'descarga', { detalle: 'Respaldo completo (base + archivos)' });
    } catch (err) {
      console.error('[respaldo completo]', err.message);
      if (!res.headersSent) res.status(500).type('text/plain; charset=utf-8').send('No se pudo generar el respaldo completo');
      else res.destroy(err);
    } finally {
      enCurso = false;
      fs.unlink(copia, () => {});
    }
  });
};
module.exports.armarTar = armarTar;
module.exports.encabezado = encabezado; // para armar otros .tar (los XML del mes de contabilidad.js)
module.exports.relleno = relleno;
