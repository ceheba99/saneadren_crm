// Palabras del Excel «CUENTAS POR PAGAR QRO» (public/cxp-excel.js): tipo de gasto, STATUS por montos y MÉTODO DE PAGO.
const test = require('node:test'); const assert = require('node:assert');
const X = require('../public/cxp-excel.js');

test('tipo de gasto: la lista de la hoja LISTA (columna G), sin los números sueltos', () => {
  assert.deepStrictEqual(X.TIPOS_GASTO.map(t => t[2]), ['SEMANAL', 'MENSUAL', 'BIMESTRAL', '4 MESES', '24 MESES', '36 MESES', '48 MESES', 'VARIABLE', 'UNICO']);
  assert.strictEqual(X.esTipoGasto('mensual'), true);
  assert.strictEqual(X.esTipoGasto('MENSUAL'), false); // se guarda la clave, no la palabra del Excel
  assert.strictEqual(X.esTipoGasto('12'), false);
  assert.strictEqual(X.esTipoGasto('__proto__'), false);
  assert.strictEqual(X.tipoGastoTexto('unico'), 'Único');
  assert.strictEqual(X.tipoGastoExcel('unico'), 'UNICO');
  assert.strictEqual(X.tipoGastoExcel(null), '');
});

test('STATUS sale de los montos: nada pagado, una parte o todo', () => {
  assert.deepStrictEqual(X.STATUS, ['PENDIENTE', 'PARCIAL', 'PAGADO']);
  assert.strictEqual(X.statusDe(27600, 0), 'PENDIENTE');
  assert.strictEqual(X.statusDe(27600, null), 'PENDIENTE');
  assert.strictEqual(X.statusDe(4800600, 4000000), 'PARCIAL');
  assert.strictEqual(X.statusDe(27600, 27599), 'PARCIAL'); // un centavo de diferencia sigue pendiente
  assert.strictEqual(X.statusDe(27600, 27600), 'PAGADO');
});

test('MÉTODO DE PAGO con las palabras del Excel', () => {
  const m = (tipo_comprobante, metodo_sat, via) => X.metodoExcel({ tipo_comprobante, metodo_sat }, via);
  assert.strictEqual(m('factura', 'PUE'), 'PUE');
  assert.strictEqual(m('factura', 'PPD', 'layout'), 'PPD'); // en factura manda el SAT, no la vía
  assert.strictEqual(m('factura', null), ''); // factura sin PUE/PPD capturado: vacío
  assert.strictEqual(m('pagadora', null, 'layout'), 'PAGADORA');
  assert.strictEqual(m('nomina'), 'CALCULO FINIQUITO/LIQUIDACION');
  assert.strictEqual(m('linea_captura'), 'LINEA CAPTURA');
  assert.strictEqual(m('informativo'), 'INFORMATIVO');
  for (const t of ['recibo', 'estado_cuenta', 'otro', 'sin_factura']) {
    assert.strictEqual(m(t), 'SIN FACTURA', t);
    assert.strictEqual(m(t, null, 'layout'), 'LAYOUT', t);
    assert.strictEqual(m(t, null, 'domiciliado'), 'DOMICILIACION', t);
    assert.strictEqual(m(t, null, 'transferencia'), 'SIN FACTURA', t);
  }
  assert.strictEqual(m(null), ''); // registros viejos sin tipo de comprobante
  assert.ok(['PUE', 'PPD', 'PAGADORA', 'CALCULO FINIQUITO/LIQUIDACION', 'LINEA CAPTURA', 'INFORMATIVO', 'LAYOUT', 'DOMICILIACION', 'SIN FACTURA'].every(v => X.METODOS_EXCEL.includes(v)));
});

test('«capturo»: el primer nombre en mayúsculas, como en el Excel', () => {
  assert.strictEqual(X.capturoCorto('Letty Pagos'), 'LETTY');
  assert.strictEqual(X.capturoCorto('  marco antonio herrera '), 'MARCO');
  assert.strictEqual(X.capturoCorto('Begoña'), 'BEGOÑA');
  assert.strictEqual(X.capturoCorto(null), '');
});
