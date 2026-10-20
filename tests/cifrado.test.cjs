// Pruebas del cifrado (server/cifrado.js) y de los encabezados de seguridad, sin levantar el servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cifrado-'));
const conClave = (env, fn) => {
  const antes = { DB_PATH: process.env.DB_PATH, CLAVE_CIFRADO: process.env.CLAVE_CIFRADO, CLAVE_CIFRADO_ANTERIOR: process.env.CLAVE_CIFRADO_ANTERIOR };
  Object.assign(process.env, { DB_PATH: path.join(dir, 'x.db') }); delete process.env.CLAVE_CIFRADO; delete process.env.CLAVE_CIFRADO_ANTERIOR;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const C = require('../server/cifrado'); C.reiniciar();
  try { return fn(C); } finally { for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } C.reiniciar(); }
};
const K1 = crypto.randomBytes(32).toString('hex'), K2 = crypto.randomBytes(32).toString('hex');

test('cifrar y descifrar: mismo texto, cifrado distinto cada vez, y amarrado a su campo', () => conClave({ CLAVE_CIFRADO: K1 }, C => {
  const a = C.cifrar('012180001234567899', 'personal.clabe:1'), b = C.cifrar('012180001234567899', 'personal.clabe:1');
  assert.ok(a.startsWith('enc1:') && a !== b);
  assert.equal(C.descifrar(a, 'personal.clabe:1'), '012180001234567899');
  assert.throws(() => C.descifrar(a, 'personal.clabe:2'), C.ErrorCifrado); // de otra persona
  assert.throws(() => C.descifrar(a, 'personal.rfc:1'), C.ErrorCifrado); // de otro campo
  assert.equal(C.cifrar('', 'x'), null); assert.equal(C.cifrar(null, 'x'), null);
  assert.equal(C.descifrar(C.cifrar('ñandú 💧', 'x'), 'x'), 'ñandú 💧');
}));

test('cualquier alteración se detecta (no devuelve basura)', () => conClave({ CLAVE_CIFRADO: K1 }, C => {
  const a = C.cifrar('PEGR800101AB1', 'personal.rfc:7');
  for (let i = 14; i < a.length; i += 3) {
    const t = a.slice(0, i) + (a[i] === 'A' ? 'B' : 'A') + a.slice(i + 1);
    if (t !== a) assert.throws(() => C.descifrar(t, 'personal.rfc:7'), C.ErrorCifrado);
  }
  assert.throws(() => C.descifrar('enc1:zzzzzzzz:AAAA', 'x'), C.ErrorCifrado);
  assert.throws(() => C.descifrar('PEGR800101AB1', 'x'), C.ErrorCifrado); // en claro no pasa por cifrado
}));

test('archivos: cifrado con encabezado, alteración e intercambio detectados', () => conClave({ CLAVE_CIFRADO: K1 }, C => {
  const pdf = Buffer.from('%PDF-1.4\n% secreto\n%%EOF');
  const c = C.cifrarArchivo(pdf, 'documentos_personal:3');
  assert.ok(C.archivoCifrado(c) && !c.includes(Buffer.from('secreto')));
  assert.deepEqual(C.descifrarArchivo(c, 'documentos_personal:3'), pdf);
  assert.throws(() => C.descifrarArchivo(c, 'documentos_personal:4'), C.ErrorCifrado);
  const mal = Buffer.from(c); mal[mal.length - 1] ^= 1;
  assert.throws(() => C.descifrarArchivo(mal, 'documentos_personal:3'), C.ErrorCifrado);
  assert.notEqual(C.huella(pdf), 'h1:' + crypto.createHash('sha256').update(pdf).digest('hex'));
}));

test('cambio de clave: con la anterior se lee; sin ella, no', () => {
  const viejo = conClave({ CLAVE_CIFRADO: K1 }, C => C.cifrar('dato', 'c'));
  conClave({ CLAVE_CIFRADO: K2, CLAVE_CIFRADO_ANTERIOR: K1 }, C => { assert.equal(C.descifrar(viejo, 'c'), 'dato'); assert.ok(C.pendiente(viejo)); assert.ok(!C.pendiente(C.cifrar('dato', 'c'))); });
  conClave({ CLAVE_CIFRADO: K2 }, C => assert.throws(() => C.descifrar(viejo, 'c'), C.ErrorCifrado));
});

test('formatos de clave: hexadecimal, base64 y frase larga; las cortas se rechazan sin mostrarlas', () => {
  for (const k of [K1, crypto.randomBytes(32).toString('base64'), 'una frase suficientemente larga para servir de clave']) conClave({ CLAVE_CIFRADO: k }, C => assert.equal(C.estado().origen, 'variable'));
  for (const k of ['corta', 'x'.repeat(31)]) conClave({ CLAVE_CIFRADO: k }, C => assert.throws(() => C.estado(), e => /CLAVE_CIFRADO/.test(e.message) && !e.message.includes(k)));
});

test('sin variable: se crea una sola vez un archivo de clave junto a la base', () => {
  const a = conClave({}, C => C.estado()), b = conClave({}, C => C.estado());
  assert.equal(a.origen, 'archivo'); assert.equal(a.kid, b.kid);
  assert.match(fs.readFileSync(path.join(dir, 'clave-cifrado.key'), 'utf8'), /^[0-9a-f]{64}\s*$/);
});

test('HSTS: se manda si el sitio es https aunque el proxy no lo diga', () => {
  const { encabezadosSeguridad } = require('../server/seguridad');
  const correr = (secure, appUrl) => { const antes = process.env.APP_URL; process.env.APP_URL = appUrl; const h = {}; encabezadosSeguridad({ secure }, { setHeader: (k, v) => { h[k] = v; } }, () => {}); if (antes === undefined) delete process.env.APP_URL; else process.env.APP_URL = antes; return h; };
  assert.ok(correr(false, 'https://sistema.saneadren.com.mx')['Strict-Transport-Security']);
  assert.ok(correr(true, '')['Strict-Transport-Security']);
  assert.equal(correr(false, 'http://localhost:3210')['Strict-Transport-Security'], undefined);
  assert.equal(correr(false, 'http://localhost:3210')['X-Frame-Options'], 'DENY');
});

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ } });
