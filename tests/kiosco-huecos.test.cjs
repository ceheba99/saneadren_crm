// Huecos sin señal (public/kiosco.html, 2026-11-13): cuando la tableta vuelve a dar señal después de más de 3 minutos,
// manda un renglón que dice QUÉ pasó en ese hueco (sin internet, servidor que no contestó, error del servidor, página
// detenida o pantalla oculta). Se corre el código real de la tableta con un reloj de mentiras.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../public/kiosco.html'), 'utf8');
const A = '  // ---------- Huecos sin señal', B = '  // ---------- Fin de huecos sin señal';
const codigo = html.slice(html.indexOf(A), html.indexOf(B));
function tableta(inicio = Date.parse('2026-11-13T20:13:00Z')) { // 14:13 en México
  let ahora = inicio;
  const RealDate = Date, FakeDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [ahora])); } static now() { return ahora; } };
  const c = vm.createContext({ Date: FakeDate, Intl, Math });
  vm.runInContext(codigo + '\n;this.H = Hueco;', c);
  return { H: c.H, pasar: min => { ahora += min * 60000; } };
}
test('el tramo de la tableta existe', () => { assert.ok(html.includes(A) && html.includes(B) && codigo.length > 500); });
test('sin hueco (señal cada minuto) no se anota nada', () => {
  const t = tableta();
  for (let i = 0; i < 10; i++) { t.pasar(1); t.H.tic(); assert.equal(t.H.volvio(), null); }
});
test('Wi-Fi caído: dice cuánto duró, de qué hora a qué hora y que no había internet', () => {
  const t = tableta();
  for (let i = 0; i < 6; i++) { t.pasar(1); t.H.tic(); t.H.fallo('red'); }
  t.pasar(0.5); const x = t.H.volvio();
  assert.match(x, /^Hueco sin señal de 7 min \(de 14:13 a 14:19\)/);
  assert.match(x, /6 intentos fallidos/); assert.match(x, /6 sin internet en la tableta/);
  assert.doesNotMatch(x, /detenida/);
  assert.equal((t.pasar(1), t.H.tic(), t.H.volvio()), null, 'después de avisar, empieza de cero');
});
test('servidor que no contesta a tiempo y errores del servidor (con su código)', () => {
  const t = tableta();
  t.pasar(1); t.H.tic(); t.H.fallo('tiempo'); t.pasar(1); t.H.tic(); t.H.fallo('tiempo');
  t.pasar(1); t.H.tic(); t.H.fallo('servidor', 502); t.pasar(1); t.H.tic(); t.H.fallo('servidor', 502); t.pasar(1); t.H.tic(); t.H.fallo('ajena');
  t.pasar(0.2); const x = t.H.volvio();
  assert.match(x, /2 sin respuesta a tiempo/); assert.match(x, /2 con error del servidor \(502\)/); assert.match(x, /1 con respuesta ajena al sistema/);
});
test('página detenida: sin intentos y el reloj de la página no corrió', () => {
  const t = tableta();
  t.pasar(1); t.H.tic(); t.pasar(6); t.H.tic(); const x = t.H.volvio();
  assert.match(x, /0 intentos fallidos/); assert.match(x, /la página estuvo detenida 6 min seguidos/);
});
test('pantalla oculta: dice cuánto tiempo', () => {
  const t = tableta();
  t.pasar(1); t.H.oculta(true); t.pasar(5); t.H.oculta(false); t.H.tic(); const x = t.H.volvio();
  assert.match(x, /pantalla oculta 5 min/);
});
test('el texto solo usa caracteres que el servidor conserva', () => {
  const t = tableta();
  t.pasar(1); t.H.tic(); t.H.fallo('servidor', 503); t.H.fallo('red'); t.H.oculta(true); t.pasar(5); t.H.oculta(false); t.H.tic();
  const x = t.H.volvio();
  assert.equal(x.replace(/[^\p{L}\p{N} .,:;()«»\-_/]/gu, ''), x);
});
