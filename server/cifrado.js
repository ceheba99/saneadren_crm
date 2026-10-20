// CIFRADO de datos sensibles en la base y en los archivos (CLABE, RFC, CURP, NSS, salario y documentos del
// expediente del personal). Si alguien se lleva la base, un respaldo o la carpeta de archivos, sin la clave no
// puede leer nada de eso.
//  · AES-256-GCM: cifra y además detecta cualquier alteración (un dato cambiado a mano ya no se descifra).
//    Cada valor lleva su propio vector aleatorio y queda «amarrado» a su campo (la CURP no se puede pegar en la
//    columna de la CLABE).
//  · La clave va en la variable de entorno CLAVE_CIFRADO del servidor (Plesk/Render), NUNCA en el código: el
//    repositorio es público. Acepta 64 caracteres hexadecimales, 32 bytes en base64 o una frase de 32+ caracteres.
//    Si no está, se crea una vez un archivo «clave-cifrado.key» junto a la base (fuera del sitio web); la revisión
//    de integridad avisa que conviene pasarla a la variable de entorno.
//  · Cambio de clave: se pone la nueva en CLAVE_CIFRADO y la anterior en CLAVE_CIFRADO_ANTERIOR; al arrancar se
//    vuelve a cifrar todo con la nueva. El archivo de clave, si existe, se usa como clave anterior.
//  · SIN LA CLAVE LOS DATOS CIFRADOS NO SE RECUPERAN: hay que guardarla aparte (no junto a los respaldos).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIJO = 'enc1:';
const MAGIA = Buffer.from('SNC1'); // inicio de un archivo cifrado
const LARGO_KID = 8, LARGO_IV = 12, LARGO_TAG = 16;
const NOMBRE_ARCHIVO = 'clave-cifrado.key';

class ErrorCifrado extends Error {}

const directorioBase = () => (process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..'));

// Convierte el texto de la variable en 32 bytes. Una frase se estira con scrypt (lento a propósito).
function claveDeTexto(t, nombre) {
  const s = String(t || '').trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(s)) { const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); if (b.length === 32) return b; }
  if (s.length >= 32) return crypto.scryptSync(s, 'saneadren-crm/cifrado/v1', 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  throw new Error(`${nombre} no es válida: usa 64 caracteres hexadecimales (p. ej. el resultado de «node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"») o una frase de al menos 32 caracteres.`);
}
// De la clave maestra salen dos subclaves: una para cifrar y otra para las huellas (HMAC). El identificador
// (kid) dice con qué clave se cifró cada dato, sin revelar nada de ella.
function preparar(maestra, origen) {
  const sub = info => Buffer.from(crypto.hkdfSync('sha256', maestra, Buffer.alloc(0), info, 32));
  const cifrar = sub('saneadren cifrado datos'), huella = sub('saneadren huella'), kid = crypto.createHmac('sha256', sub('saneadren id')).update('kid').digest('hex').slice(0, LARGO_KID);
  return { cifrar, huella, kid, origen };
}

let anillo = null; // { actual, todas: Map(kid → clave), origen, archivo }
function cargar() {
  if (anillo) return anillo;
  const archivo = path.join(directorioBase(), NOMBRE_ARCHIVO);
  const leerArchivo = () => claveDeTexto(fs.readFileSync(archivo, 'utf8'), NOMBRE_ARCHIVO);
  let actual, origen;
  if (process.env.CLAVE_CIFRADO) { actual = preparar(claveDeTexto(process.env.CLAVE_CIFRADO, 'CLAVE_CIFRADO'), 'variable'); origen = 'variable'; }
  else {
    if (!fs.existsSync(archivo)) {
      // Solo la primera vez: «wx» no pisa un archivo que ya exista (si dos procesos arrancan juntos, gana uno).
      try { fs.writeFileSync(archivo, crypto.randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); console.warn(`[cifrado] Se creó la clave en ${archivo}. Guárdala en un lugar seguro y, mejor, pásala a la variable de entorno CLAVE_CIFRADO.`); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    actual = preparar(leerArchivo(), 'archivo'); origen = 'archivo';
  }
  const todas = new Map([[actual.kid, actual]]);
  for (const t of String(process.env.CLAVE_CIFRADO_ANTERIOR || '').split(',').map(x => x.trim()).filter(Boolean)) { const k = preparar(claveDeTexto(t, 'CLAVE_CIFRADO_ANTERIOR'), 'anterior'); if (!todas.has(k.kid)) todas.set(k.kid, k); }
  if (origen === 'variable' && fs.existsSync(archivo)) { try { const k = preparar(leerArchivo(), 'archivo anterior'); if (!todas.has(k.kid)) todas.set(k.kid, k); } catch (e) { console.error('[cifrado] No se pudo leer ' + archivo + ':', e.message); } }
  anillo = { actual, todas, origen, archivo };
  return anillo;
}

// ---------- Textos (columnas de la base) ----------
const esCifrado = v => typeof v === 'string' && v.startsWith(PREFIJO);
function cifrar(valor, contexto) {
  if (valor === null || valor === undefined || valor === '') return null;
  const { actual } = cargar();
  const iv = crypto.randomBytes(LARGO_IV);
  const c = crypto.createCipheriv('aes-256-gcm', actual.cifrar, iv);
  c.setAAD(Buffer.from(String(contexto)));
  const ct = Buffer.concat([c.update(String(valor), 'utf8'), c.final()]);
  return PREFIJO + actual.kid + ':' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
// Devuelve el texto original. Lanza ErrorCifrado si no hay clave para ese dato o si fue alterado.
function descifrar(valor, contexto) {
  if (valor === null || valor === undefined) return null;
  if (!esCifrado(valor)) throw new ErrorCifrado('El dato no está cifrado');
  const [kid, cuerpo] = valor.slice(PREFIJO.length).split(':');
  const k = cargar().todas.get(kid);
  if (!k) throw new ErrorCifrado('No está la clave con la que se cifró este dato');
  const b = Buffer.from(cuerpo || '', 'base64url');
  if (b.length < LARGO_IV + LARGO_TAG) throw new ErrorCifrado('Dato cifrado incompleto');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k.cifrar, b.subarray(0, LARGO_IV));
    d.setAAD(Buffer.from(String(contexto)));
    d.setAuthTag(b.subarray(LARGO_IV, LARGO_IV + LARGO_TAG));
    return Buffer.concat([d.update(b.subarray(LARGO_IV + LARGO_TAG)), d.final()]).toString('utf8');
  } catch { throw new ErrorCifrado('El dato cifrado fue alterado o la clave no corresponde'); }
}
const kidDe = v => (esCifrado(v) ? v.slice(PREFIJO.length).split(':')[0] : null);
// ¿Hay que (re)cifrarlo? Si está en claro o se cifró con una clave que ya no es la actual.
const pendiente = v => v !== null && v !== undefined && v !== '' && kidDe(v) !== cargar().actual.kid;

// ---------- Archivos ----------
const archivoCifrado = buf => Buffer.isBuffer(buf) && buf.length >= MAGIA.length && buf.subarray(0, MAGIA.length).equals(MAGIA);
function cifrarArchivo(buf, contexto) {
  const { actual } = cargar();
  const iv = crypto.randomBytes(LARGO_IV);
  const c = crypto.createCipheriv('aes-256-gcm', actual.cifrar, iv);
  c.setAAD(Buffer.from(String(contexto)));
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIA, Buffer.from(actual.kid, 'ascii'), iv, c.getAuthTag(), ct]);
}
function descifrarArchivo(buf, contexto) {
  if (!archivoCifrado(buf)) throw new ErrorCifrado('El archivo no está cifrado');
  const kid = buf.subarray(MAGIA.length, MAGIA.length + LARGO_KID).toString('ascii'), k = cargar().todas.get(kid);
  if (!k) throw new ErrorCifrado('No está la clave con la que se cifró este archivo');
  const i = MAGIA.length + LARGO_KID;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k.cifrar, buf.subarray(i, i + LARGO_IV));
    d.setAAD(Buffer.from(String(contexto)));
    d.setAuthTag(buf.subarray(i + LARGO_IV, i + LARGO_IV + LARGO_TAG));
    return Buffer.concat([d.update(buf.subarray(i + LARGO_IV + LARGO_TAG)), d.final()]);
  } catch { throw new ErrorCifrado('El archivo fue alterado o la clave no corresponde'); }
}
const kidDeArchivo = buf => (archivoCifrado(buf) ? buf.subarray(MAGIA.length, MAGIA.length + LARGO_KID).toString('ascii') : null);

// Huella con clave (HMAC): sirve para reconocer un archivo repetido sin guardar un hash que cualquiera pueda
// comparar contra documentos conocidos.
const huella = buf => 'h1:' + crypto.createHmac('sha256', cargar().actual.huella).update(buf).digest('hex');

// Escribe un archivo sin dejarlo a medias: primero uno temporal y luego se renombra.
function escribirSeguro(ruta, buf) {
  const tmp = ruta + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, ruta);
}

// ¿Se puede leer con alguna de las claves cargadas?
const tieneClave = kid => cargar().todas.has(kid);
const estado = () => { const a = cargar(); return { origen: a.origen, archivo: a.archivo, kid: a.actual.kid, claves: a.todas.size }; };
// Solo para pruebas: olvidar la clave cargada (para simular otro arranque).
const reiniciar = () => { anillo = null; };

module.exports = { tieneClave, cifrar, descifrar, esCifrado, pendiente, kidDe, cifrarArchivo, descifrarArchivo, archivoCifrado, kidDeArchivo, huella, escribirSeguro, estado, reiniciar, ErrorCifrado, NOMBRE_ARCHIVO, PREFIJO };
