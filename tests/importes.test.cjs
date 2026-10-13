// Cálculo de IVA e importe con letra (public/importes.js), el mismo que usan el editor,
// los documentos y el servidor.
const test = require('node:test');
const assert = require('node:assert');
const I = require('../public/importes.js');

const c = (items, modo) => I.calcular(items.map(importe => ({ importe })), modo, 16);

test('más IVA: el IVA se suma al subtotal', () => {
  assert.deepStrictEqual(c([3500], 'mas_iva'), { subtotal_cent: 350000, iva_cent: 56000, total_cent: 406000 });
  assert.deepStrictEqual(c([1500], 'mas_iva'), { subtotal_cent: 150000, iva_cent: 24000, total_cent: 174000 });
  assert.deepStrictEqual(c([1200, 800.5], 'mas_iva'), { subtotal_cent: 200050, iva_cent: 32008, total_cent: 232058 });
  assert.deepStrictEqual(c([1234.57], 'mas_iva'), { subtotal_cent: 123457, iva_cent: 19753, total_cent: 143210 });
});

test('IVA incluido: el total es lo capturado y se desglosa', () => {
  assert.deepStrictEqual(c([1160], 'incluido'), { subtotal_cent: 100000, iva_cent: 16000, total_cent: 116000 });
  assert.deepStrictEqual(c([5000], 'incluido'), { subtotal_cent: 431034, iva_cent: 68966, total_cent: 500000 });
  assert.deepStrictEqual(c([3500], 'incluido'), { subtotal_cent: 301724, iva_cent: 48276, total_cent: 350000 });
  assert.deepStrictEqual(c([100.01], 'incluido'), { subtotal_cent: 8622, iva_cent: 1379, total_cent: 10001 });
});

test('sin IVA: el cliente paga exactamente lo capturado', () => {
  assert.deepStrictEqual(c([1000], 'sin_iva'), { subtotal_cent: 100000, iva_cent: 0, total_cent: 100000 });
  assert.deepStrictEqual(I.filasTotales(c([1000], 'sin_iva'), 'sin_iva', 0), [['Total (sin IVA)', 100000]]);
  assert.strictEqual(I.tasaDe('sin_iva', 16), 0);
  assert.strictEqual(I.tasaDe('mas_iva', 0), 16);
});

test('IVA por definir (registros anteriores): total = suma, sin IVA', () => {
  assert.deepStrictEqual(c([3500, 0.5], null), { subtotal_cent: 350050, iva_cent: null, total_cent: 350050 });
});

test('barrido: los centavos siempre cuadran', () => {
  for (let cent = 1; cent <= 200000; cent++) {
    const inc = c([cent / 100], 'incluido');
    assert.ok(inc.subtotal_cent + inc.iva_cent === cent && inc.iva_cent >= 0 && inc.subtotal_cent >= 0, 'incluido ' + cent);
    const mas = c([cent / 100], 'mas_iva');
    assert.ok(mas.subtotal_cent === cent && mas.iva_cent === Math.round(cent * 16 / 100) && mas.total_cent === cent + mas.iva_cent, 'más IVA ' + cent);
  }
});

test('totales del documento según el modo', () => {
  assert.deepStrictEqual(I.filasTotales(c([1500], 'mas_iva'), 'mas_iva', 16).map(f => f[1]), [150000, 24000, 174000]);
  assert.deepStrictEqual(I.filasTotales(c([1160], 'incluido'), 'incluido', 16).map(f => f[0]), ['Subtotal sin IVA', 'IVA 16% (incluido)', 'Total (IVA incluido)']);
  assert.deepStrictEqual(I.filasTotales(c([900], null), null, null), [['Total', 90000]]);
});

test('importe con letra desde centavos', () => {
  assert.strictEqual(I.enLetras(386628), 'TRES MIL OCHOCIENTOS SESENTA Y SEIS PESOS 28/100 M.N.');
  assert.strictEqual(I.enLetras(406000), 'CUATRO MIL SESENTA PESOS 00/100 M.N.');
  assert.strictEqual(I.enLetras(100000000), 'UN MILLÓN DE PESOS 00/100 M.N.');
  assert.strictEqual(I.enLetras(150000000), 'UN MILLÓN QUINIENTOS MIL PESOS 00/100 M.N.');
  assert.strictEqual(I.enLetras(2100000000), 'VEINTIÚN MILLONES DE PESOS 00/100 M.N.');
  assert.strictEqual(I.enLetras(2101), 'VEINTIÚN PESOS 01/100 M.N.');
  assert.strictEqual(I.enLetras(0), 'CERO PESOS 00/100 M.N.');
  assert.strictEqual(I.enLetras(115), 'UN PESOS 15/100 M.N.');
});
