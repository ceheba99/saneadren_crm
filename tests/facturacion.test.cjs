// Facturación CFDI 4.0 · F1 (2026-10-27): pruebas unitarias de las validaciones, el cálculo de importes y la configuración.
// Uso: node --test tests/facturacion.test.cjs   (también corre dentro de «npm test»)
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../server/facturacion-validaciones');
const { leerConfig, estadoConfig, HOSTS } = require('../server/facturacion-config');

test('RFC: empresa de 12, persona física de 13 y los genéricos', () => {
  for (const [rfc, tipo] of [['ABC010203AB1', 'moral'], ['GOMC800101AB1', 'fisica'], ['XAXX010101000', 'publico_general'], ['XEXX010101000', 'extranjero'], ['ñab 010203 ab1', 'moral'], ['A&B010203AB1', 'moral']]) {
    const r = V.validarRFC(rfc); assert.equal(r.ok, true, rfc); assert.equal(r.tipo, tipo, rfc);
  }
  assert.equal(V.validarRFC(' abc010203ab1 ').rfc, 'ABC010203AB1', 'quita espacios y pasa a mayúsculas');
});
test('RFC: lo que NO es un RFC', () => {
  for (const [rfc, texto] of [['', /Falta/], ['ABC0102', /12 caracteres/], ['ABC01020301AB1X', /12 caracteres/], ['ABC013203AB1', /fecha/], ['ABC010232AB1', /fecha/], ['ABC000001AB1', /fecha/],
    ['1BC010203AB1', /formato/], ['ABC01O203AB1', /formato/], ['AB 010203 ABC1', /formato|12 caracteres/]]) {
    const r = V.validarRFC(rfc); assert.equal(r.ok, false, rfc); assert.match(r.mensaje, texto, rfc);
  }
});
test('Razón social: MAYÚSCULAS y sin régimen societario', () => {
  const casos = [['Constructora Los Pinos, S.A. de C.V.', 'CONSTRUCTORA LOS PINOS'], ['  acme   sa de cv ', 'ACME'], ['SERVICIOS DEL BAJÍO S. DE R.L. DE C.V.', 'SERVICIOS DEL BAJÍO'],
    ['Grupo X S.A.P.I. de C.V.', 'GRUPO X'], ['Desarrollos Y SAB DE CV', 'DESARROLLOS Y'], ['Colegio Z, A.C.', 'COLEGIO Z'], ['Taller Q S.A.S.', 'TALLER Q'],
    ['JUAN PÉREZ GARCÍA', 'JUAN PÉREZ GARCÍA'], ['Ñandú Importaciones', 'ÑANDÚ IMPORTACIONES']];
  for (const [entra, sale] of casos) assert.equal(V.normalizarRazonSocial(entra).texto, sale, entra);
  assert.ok(V.normalizarRazonSocial('Acme SA de CV').avisos.some(a => /quitó/.test(a)), 'avisa lo que quitó');
  assert.ok(V.normalizarRazonSocial('acme').avisos.some(a => /MAYÚSCULAS/.test(a)), 'avisa que pasó a mayúsculas');
  assert.deepEqual(V.normalizarRazonSocial('ACME').avisos, [], 'si ya está bien, no avisa nada');
  assert.equal(V.normalizarRazonSocial('SA DE CV').texto, 'SA DE CV', 'si es lo único que hay, no lo deja vacío');
  assert.equal(V.normalizarRazonSocial('PLUS A').texto, 'PLUS A', 'no corta palabras');
});
test('Código postal y correo', () => {
  assert.equal(V.validarCP('76087').ok, true); assert.equal(V.validarCP(' 76087 ').cp, '76087');
  for (const cp of ['', '7608', '760871', '7608A', '76 08']) assert.equal(V.validarCP(cp).ok, false, cp);
  assert.equal(V.validarCorreo('ventas@saneadren.com.mx').ok, true);
  for (const c of ['', 'sin-arroba', 'a@b', 'a b@c.mx', 'a@b.c']) assert.equal(V.validarCorreo(c).ok, false, c);
});

// ---- Importes: la regla 5 pide probar con 229.90 y 1635.48 ----
test('IVA de 229.90: 36.784 por concepto y 36.78 en la suma', () => {
  const t = V.calcularTotales([{ base_cent: 22990 }]);
  assert.equal(V.microsATexto(t.conceptos[0].iva_micros, 6), '36.784000');
  assert.equal(t.subtotal_cent, 22990); assert.equal(t.iva_cent, 3678); assert.equal(t.total_cent, 26668);
});
test('IVA de 1635.48: 261.6768 por concepto y 261.68 en la suma', () => {
  const t = V.calcularTotales([{ base_cent: 163548 }]);
  assert.equal(V.microsATexto(t.conceptos[0].iva_micros, 6), '261.676800');
  assert.equal(t.subtotal_cent, 163548); assert.equal(t.iva_cent, 26168); assert.equal(t.total_cent, 189716);
});
test('IVA: se suman los conceptos a 6 decimales y SOLO la suma se redondea', () => {
  // Cada 0.05 genera 0.008 de IVA; diez conceptos suman 0.08 (si se redondeara cada uno a 0.01 darían 0.10).
  const t = V.calcularTotales(Array.from({ length: 10 }, () => ({ base_cent: 5 })));
  assert.equal(t.subtotal_cent, 50); assert.equal(t.iva_cent, 8); assert.equal(t.total_cent, 58);
  const dos = V.calcularTotales([{ base_cent: 22990 }, { base_cent: 163548 }]); // 36.784 + 261.6768 = 298.4608
  assert.equal(dos.subtotal_cent, 186538); assert.equal(dos.iva_cent, 29846);
});
test('IVA: con ObjetoImp 01, 03 o 04 no hay impuestos; con tasa distinta se respeta', () => {
  for (const o of ['01', '03', '04']) assert.equal(V.calcularTotales([{ base_cent: 10000 }], { objetoImp: o }).iva_cent, 0, o);
  assert.equal(V.calcularTotales([{ base_cent: 10000 }], { tasa: 8 }).iva_cent, 800);
  assert.equal(V.calcularTotales([{ base_cent: 10000 }], { tasa: 0 }).iva_cent, 0);
});
test('Importes: pesos a micro-pesos sin flotantes y rechazos', () => {
  assert.equal(V.pesosAMicros(229.9), 229900000n); assert.equal(V.pesosAMicros('1635.48'), 1635480000n); assert.equal(V.pesosAMicros(0.1 + 0.2), 300000n);
  for (const malo of [-1, NaN, Infinity, '12,5', 'abc', '1.1234567', null, undefined]) assert.throws(() => V.pesosAMicros(malo), /Importe no válido/, String(malo));
  assert.throws(() => V.calcularTotales([]), /al menos un concepto/);
  assert.throws(() => V.calcularTotales([{ base_cent: 1.5 }]), /Importe no válido/);
  assert.throws(() => V.calcularTotales([{ base_cent: -5 }]), /Importe no válido/);
  assert.equal(V.microsATexto(36784000n, 2), '36.78'); assert.equal(V.microsATexto(5000n, 6), '0.005000'); assert.equal(V.microsATexto(123000000n, 0), '123');
});

// ---- Datos fiscales completos ----
const CATALOGOS = {
  regimenes: new Map([['601', 'General de Ley Personas Morales'], ['612', 'Personas Físicas con Actividades Empresariales'], ['626', 'Régimen Simplificado de Confianza']]),
  usos: new Map([['G03', { nombre: 'Gastos en general', regimenes: ['601', '612', '626'] }], ['D01', { nombre: 'Honorarios médicos', regimenes: ['612'] }]]),
};
const BUENO = { rfc: 'ABC010203AB1', razon_social: 'Acme SA de CV', cp: '76087', regimen: '601', uso_cfdi: 'g03', correo: 'a@acme.mx' };
test('Datos fiscales completos y correctos', () => {
  const r = V.validarDatosFiscales(BUENO, CATALOGOS);
  assert.equal(r.listo, true); assert.deepEqual(r.faltantes, []); assert.deepEqual(r.errores, []);
  assert.equal(r.normalizado.razon_social, 'ACME'); assert.equal(r.normalizado.uso_cfdi, 'G03');
});
test('Datos fiscales: marca QUÉ falta (y no timbra)', () => {
  const r = V.validarDatosFiscales({ rfc: 'ABC010203AB1' }, CATALOGOS);
  assert.equal(r.listo, false); assert.deepEqual(r.faltantes, ['Razón social', 'Código postal fiscal', 'Correo', 'Régimen fiscal', 'Uso del CFDI']);
  assert.deepEqual(V.validarDatosFiscales({}, CATALOGOS).faltantes[0], 'RFC');
});
test('Datos fiscales: errores de formato y de compatibilidad régimen–uso', () => {
  assert.match(V.validarDatosFiscales({ ...BUENO, rfc: 'ABC' }, CATALOGOS).errores[0], /12 caracteres/);
  assert.match(V.validarDatosFiscales({ ...BUENO, cp: '123' }, CATALOGOS).errores[0], /5 números/);
  assert.match(V.validarDatosFiscales({ ...BUENO, correo: 'x' }, CATALOGOS).errores[0], /correo/);
  assert.match(V.validarDatosFiscales({ ...BUENO, regimen: 'AB1' }, CATALOGOS).errores[0], /3 números/);
  assert.match(V.validarDatosFiscales({ ...BUENO, regimen: '999' }, CATALOGOS).errores[0], /no está en el catálogo/);
  assert.match(V.validarDatosFiscales({ ...BUENO, uso_cfdi: 'ZZZ' }, CATALOGOS).errores[0], /no está en el catálogo/);
  const incompat = V.validarDatosFiscales({ ...BUENO, uso_cfdi: 'D01' }, CATALOGOS);
  assert.equal(incompat.listo, false); assert.match(incompat.errores[0], /no es compatible con el régimen 601/);
  assert.equal(V.validarDatosFiscales({ ...BUENO, regimen: '612', uso_cfdi: 'D01' }, CATALOGOS).listo, true);
});
test('Datos fiscales: sin catálogos del SAT avisa que no pudo comprobar la compatibilidad', () => {
  const r = V.validarDatosFiscales(BUENO, {});
  assert.equal(r.listo, true); assert.ok(r.avisos.some(a => /no están cargados/.test(a)));
});

// ---- Configuración ----
test('Configuración: sin nada es sandbox y dice qué falta', () => {
  const c = leerConfig({}); assert.equal(c.entorno, 'sandbox'); assert.equal(c.host, HOSTS.sandbox); assert.equal(c.listo, false);
  assert.deepEqual(c.faltantes, ['FACTURA_API_KEY', 'FACTURA_SECRET_KEY', 'EMISOR_REGIMEN', 'EMISOR_CP']);
});
test('Configuración: producción SOLO si dice exactamente «prod»', () => {
  for (const v of ['', 'sandbox', 'produccion', 'PRODUCTION', 'true', '1']) assert.equal(leerConfig({ FACTURA_ENV: v }).entorno, 'sandbox', v);
  assert.equal(leerConfig({ FACTURA_ENV: 'prod' }).entorno, 'prod'); assert.equal(leerConfig({ FACTURA_ENV: ' PROD ' }).entorno, 'prod');
  assert.ok(leerConfig({ FACTURA_ENV: 'produccion' }).avisos.some(a => /usa sandbox/.test(a)));
  assert.equal(leerConfig({ FACTURA_ENV: 'prod' }).host, HOSTS.prod);
});
test('Configuración: completa; y el estado que se muestra NUNCA trae las llaves', () => {
  const env = { FACTURA_API_KEY: 'LLAVE-SECRETA-123', FACTURA_SECRET_KEY: 'OTRA-SECRETA-456', EMISOR_REGIMEN: '626', EMISOR_CP: '76087' };
  assert.equal(leerConfig(env).listo, true);
  const e = estadoConfig(env); assert.equal(e.apiKey, 'puesta'); assert.equal(e.secretKey, 'puesta'); assert.equal(e.listo, true);
  const texto = JSON.stringify(e); assert.ok(!texto.includes('LLAVE-SECRETA') && !texto.includes('OTRA-SECRETA'), 'el estado no debe contener las llaves');
  assert.ok(estadoConfig({ ...env, EMISOR_CP: '123' }).avisos.some(a => /5 números/.test(a))); assert.equal(estadoConfig({ ...env, EMISOR_CP: '123' }).listo, false);
  assert.ok(estadoConfig({ ...env, EMISOR_REGIMEN: 'x' }).avisos.some(a => /3 números/.test(a)));
  assert.equal(estadoConfig({ ...env, FACTURA_API_KEY: '   ' }).apiKey, 'falta', 'una llave solo con espacios cuenta como faltante');
});
