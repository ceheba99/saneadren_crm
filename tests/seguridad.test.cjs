const test = require('node:test');
const assert = require('node:assert/strict');
const { correoPermitido, problemaPassword, problemaNombre, verificarPassword, hashPassword } = require('../server/seguridad');

test('solo se aceptan correos exactamente @saneadren.com.mx', () => {
  assert.equal(correoPermitido('servicios@saneadren.com.mx'), true);
  assert.equal(correoPermitido('  Servicios@Saneadren.com.mx '), true);
  assert.equal(correoPermitido('servicios@sanedaren.com.mx'), false); // dominio mal escrito
  assert.equal(correoPermitido('x@saneadren.com.mx.evil.com'), false);
  assert.equal(correoPermitido('x@mail.saneadren.com.mx'), false);
  assert.equal(correoPermitido('a@b@saneadren.com.mx'), false);
  assert.equal(correoPermitido('x..y@saneadren.com.mx'), false);
});

test('política de contraseñas', () => {
  assert.ok(problemaPassword('1234'));
  assert.ok(problemaPassword('soloLetrasLargas'));
  assert.ok(problemaPassword('saneadren123'));
  assert.ok(problemaPassword('servicios2026', { correo: 'servicios@saneadren.com.mx' }));
  assert.equal(problemaPassword('Drenaje-2026x'), null);
});

test('el nombre no admite HTML ni símbolos', () => {
  assert.ok(problemaNombre('<img src=x onerror=alert(1)>'));
  assert.ok(problemaNombre('ab'));
  assert.equal(problemaNombre("José Ñúñez O'Neil-Pérez"), null);
});

test('verificación de contraseña', () => {
  const h = hashPassword('Drenaje-2026x');
  assert.equal(verificarPassword('Drenaje-2026x', h), true);
  assert.equal(verificarPassword('otra', h), false);
  assert.equal(verificarPassword('x', undefined), false); // usuario inexistente
});
