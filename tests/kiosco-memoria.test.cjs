// Memoria de la tableta y candado de la cola sin conexión (public/kiosco.html, 2026-11-12): se corre el código REAL de
// la tableta (el tramo entre sus dos marcas) con la criptografía de Node, que es la misma del navegador (WebCrypto).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const html = fs.readFileSync(require('node:path').join(__dirname, '../public/kiosco.html'), 'utf8');
const A = '  // ---------- Memoria de la tableta y candado de la cola', B = '  // ---------- Sin conexión: cola en IndexedDB';
const codigo = html.slice(html.indexOf(A), html.indexOf(B));
function tableta(guardado = {}) {
  const datos = new Map(Object.entries(guardado));
  const c = vm.createContext({ crypto: crypto.webcrypto, TextEncoder, btoa, atob, Uint8Array, Date, JSON, Object, String,
    localStorage: { getItem: k => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)) } });
  vm.runInContext(codigo + '\n;this.T = { recordar, pinRecordado, recordado, sellar, memoria, guardarMemoria, MEMORIA, LLAVE_COLA };', c);
  return { ...c.T, datos };
}
test('el tramo de la tableta existe', () => { assert.ok(html.includes(A) && html.includes(B) && codigo.length > 1000); });
test('sin haberse identificado antes, la tableta no puede comprobar el PIN', async () => {
  const t = tableta();
  assert.equal(await t.pinRecordado('1234', '7391'), 'sin-memoria');
});
test('recuerda el PIN bueno y detecta casi todos los equivocados, sin guardar el PIN', async () => {
  const t = tableta();
  await t.recordar('1234', 'Ana', '7391', false);
  assert.equal(await t.pinRecordado('1234', '7391'), 'igual');
  let distintos = 0;
  for (let i = 0; i < 10000; i++) { const p = String(i).padStart(4, '0'); if (p !== '7391' && await t.pinRecordado('1234', p) === 'distinto') distintos++; }
  assert.ok(distintos > 9500, 'detecta más del 95 % de los PIN equivocados: ' + distintos);
  assert.ok(9999 - distintos > 150, 'pero muchos PIN dan la misma marca: con la marca no se saca el PIN (' + (9999 - distintos) + ')');
  const crudo = t.datos.get(t.MEMORIA);
  assert.ok(!crudo.includes('7391'), 'el PIN no está en lo guardado');
  assert.deepEqual(Object.keys(JSON.parse(crudo).codigos['1234']).sort(), ['cara', 'f', 'n', 't']);
  assert.equal(await t.pinRecordado('5678', '7391'), 'sin-memoria', 'otro código no se confunde');
});
test('entrar con la cara no borra la marca del PIN, y al cambiar el PIN la marca se actualiza', async () => {
  const t = tableta();
  await t.recordar('1234', 'Ana', '7391', false);
  await t.recordar('1234', 'Ana', null, true);
  assert.equal(t.recordado('1234').cara, true);
  assert.equal(await t.pinRecordado('1234', '7391'), 'igual');
  await t.recordar('1234', 'Ana', '8264');
  assert.equal(await t.pinRecordado('1234', '8264'), 'igual');
});
test('la memoria no crece sin límite: se quedan los 300 más recientes', async () => {
  const t = tableta(), m = t.memoria();
  for (let i = 0; i < 340; i++) m.codigos[String(1000 + i)] = { n: 'P', t: 1, f: i };
  t.guardarMemoria(m);
  const c = JSON.parse(t.datos.get(t.MEMORIA)).codigos;
  assert.equal(Object.keys(c).length, 300); assert.ok(!c['1000'] && c['1339']);
});
test('sin llave del servidor no se cierra nada (la tableta se porta como antes)', async () => {
  assert.equal(await tableta().sellar('uid-de-prueba-000000', { pin: '7391' }), null);
});
test('con la llave, lo cerrado no deja ver el PIN y cada vez sale distinto', async () => {
  const e = crypto.createECDH('prime256v1'); e.generateKeys();
  const t = tableta({ saneadren_kiosco_llave_cola: e.getPublicKey().toString('base64') });
  const a = await t.sellar('uid-de-prueba-000000', { pin: '7391' }), b = await t.sellar('uid-de-prueba-000000', { pin: '7391' });
  assert.ok(a && a.e && a.iv && a.c && !JSON.stringify(a).includes('7391'));
  assert.notEqual(a.c, b.c);
  // Quien tiene la llave privada (el servidor) sí lo abre.
  const ep = Buffer.from(a.e, 'base64'), c = Buffer.from(a.c, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(Buffer.concat([e.computeSecret(ep), ep])).digest(), Buffer.from(a.iv, 'base64'));
  d.setAAD(Buffer.from('uid-de-prueba-000000')); d.setAuthTag(c.subarray(c.length - 16));
  assert.deepEqual(JSON.parse(Buffer.concat([d.update(c.subarray(0, c.length - 16)), d.final()]).toString()), { pin: '7391' });
});
