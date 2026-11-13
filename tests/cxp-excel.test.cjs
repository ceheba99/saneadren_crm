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

// ---------- Descarga «CXP» igual al Excel (fase 3) ----------
const DATOS = {
  cuentas: [
    // Factura PPD con dos pagos (uno antes de la fecha de la factura = anticipo), beneficiario distinto y tipo de gasto.
    { id: 1, proveedor: 'Aceros Morlet', beneficiario: 'Marco Antonio Herrera', concepto: 'Soldadura', fecha_documento: '2026-03-09', fecha_vencimiento: '2026-03-24', dias_credito: 15,
      capturo: 'Marco Herrera', factura_folio: '7233', tipo_comprobante: 'factura', metodo_sat: 'PPD', total: 1635.48, clabe: '014680655039528945', banco: 'Santander',
      categoria: 'Herramientas, ferretería y consumibles', es_gasto: true, notas: 'Reembolso', orden_folio: null, tipo_gasto: 'unico', cancelada: false },
    // Recibo sin pagar, sin días que cuadren (vencimiento a mano): no lleva fórmula en A.
    { id: 2, proveedor: 'CFE', beneficiario: 'CFE', concepto: 'Luz Cancún', fecha_documento: '2026-11-01', fecha_vencimiento: '2026-11-20', dias_credito: null,
      capturo: 'Letty Pagos', factura_folio: null, tipo_comprobante: 'recibo', metodo_sat: null, total: 229.9, categoria: 'Luz', es_gasto: true, tipo_gasto: 'bimestral', cancelada: false },
    // Cancelada: no sale.
    { id: 3, proveedor: 'X', concepto: 'Cancelada', fecha_documento: '2026-11-01', fecha_vencimiento: '2026-11-01', dias_credito: 0, total: 10, categoria: 'Otro', cancelada: true },
    // Sin factura pagada por layout en un solo pago: PAGADO como número, STATUS PAGADO, METODO LAYOUT, FOLIO SIN FACTURA.
    { id: 4, proveedor: 'Pipas Oaxaca', beneficiario: 'Pipas Oaxaca', concepto: 'Renta pipa', fecha_documento: '2026-11-05', fecha_vencimiento: '2026-11-05', dias_credito: 0,
      capturo: 'Letty', tipo_comprobante: 'sin_factura', total: 8500, categoria: 'Renta de pipas', es_gasto: false, tipo_gasto: null, sucursal: 'OAX', cancelada: false },
  ],
  pagos: [
    { id: 11, cxp_id: 1, fecha: '2026-03-20', monto: 1000.48, metodo: 'transferencia', cancelado: false },
    { id: 10, cxp_id: 1, fecha: '2026-03-01', monto: 400, metodo: 'transferencia', cancelado: false },
    { id: 12, cxp_id: 1, fecha: '2026-03-21', monto: 235, metodo: 'transferencia', cancelado: true }, // cancelado: no cuenta
    { id: 13, cxp_id: 4, fecha: '2026-11-06', monto: 8500, metodo: 'layout', cancelado: false },
  ],
};

test('descarga CXP: 20 columnas con los nombres, colores y anchos del Excel', () => {
  assert.deepStrictEqual(X.COLUMNAS_CXP.map(c => c[0]), ['FECHA VENCIMIENTO', 'TIPO DE GASTO', 'PROVEEDOR', 'BENEFICIARIO', 'DESCRIPCION', 'FECHA FACTURA/SOLICITUD', 'capturo',
    'FOLIO FACTURA', 'METODO DE PAGO', 'MONTO TOTAL FACTURA', 'PENDIENTE', 'ANTICIPO', 'PAGADO', 'CUENTA BANCARIA', 'BANCO', 'DIAS DE CREDITO', 'CONCEPTO DE GASTO ', 'STATUS',
    'FECHA DE PAGO', 'OBSERVACIONES']);
  assert.strictEqual(X.COLUMNAS_CXP[1][2], 'FFF9CB9C'); // TIPO DE GASTO, naranja claro como en el Excel
  assert.strictEqual(X.COLUMNAS_CXP[11][2], 'FF00FF00'); // ANTICIPO verde
  assert.deepStrictEqual(X.COL_FECHAS.map(i => X.COLUMNAS_CXP[i][0]), ['FECHA VENCIMIENTO', 'FECHA FACTURA/SOLICITUD', 'FECHA DE PAGO']);
});

test('descarga CXP: cada renglón con las fórmulas y palabras del Excel', () => {
  const filas = X.renglonesCxp(DATOS);
  assert.strictEqual(filas.length, 3, 'la cancelada no sale');
  const [a, b, c] = filas;
  // Renglón 3: vencimiento =F3+P3, PENDIENTE =J3-M3, PAGADO =400+1000.48 (el cancelado no), anticipo 400, STATUS fórmula.
  assert.deepStrictEqual(a[0], { formula: 'F3+P3', result: '2026-03-24' });
  assert.deepStrictEqual(a.slice(1, 10), ['UNICO', 'Aceros Morlet', 'Marco Antonio Herrera', 'Soldadura', '2026-03-09', 'MARCO', '7233', 'PPD', 1635.48]);
  assert.deepStrictEqual(a[10], { formula: 'J3-M3', result: 235 });
  assert.strictEqual(a[11], 400);
  assert.deepStrictEqual(a[12], { formula: '400+1000.48', result: 1400.48 });
  assert.deepStrictEqual(a.slice(13, 17), ['014680655039528945', 'Santander', 15, 'HERRAMIENTAS, FERRETERÍA Y CONSUMIBLES']);
  assert.deepStrictEqual(a[17], { formula: 'IF(ROUND(M3-J3,2)>=0,"PAGADO",IF(M3>0,"PARCIAL","PENDIENTE"))', result: 'PARCIAL' });
  assert.strictEqual(a[18], '2026-03-20');
  assert.strictEqual(a[19], 'Reembolso');
  // Renglón 4: sin días de crédito → vencimiento como fecha (sin fórmula); nada pagado → PENDIENTE, sin PAGADO ni anticipo.
  assert.strictEqual(b[0], '2026-11-20');
  assert.deepStrictEqual([b[1], b[6], b[7], b[8], b[9]], ['BIMESTRAL', 'LETTY', 'RECIBO', 'SIN FACTURA', 229.9]);
  assert.deepStrictEqual(b[10], { formula: 'J4-M4', result: 229.9 });
  assert.deepStrictEqual([b[11], b[12], b[15], b[18]], [null, null, '', null]);
  assert.strictEqual(b[17].result, 'PENDIENTE');
  // Renglón 5: un solo pago por layout.
  assert.deepStrictEqual(c[0], { formula: 'F5+P5', result: '2026-11-05' });
  assert.deepStrictEqual([c[1], c[7], c[8], c[12], c[17].result], ['', 'SIN FACTURA', 'LAYOUT', 8500, 'PAGADO']);
  assert.strictEqual(c[19], 'No cuenta como gasto');
  assert.strictEqual(c.length, 20);
  assert.strictEqual(X.renglonesCxp(DATOS, { conSucursal: true })[2][20], 'OAX', 'con varias sucursales va una columna más al final');
});

test('descarga CXP: centavos exactos (229.90 y 1635.48) sin errores de punto flotante', () => {
  const d = { cuentas: [{ id: 1, proveedor: 'P', concepto: 'c', fecha_documento: '2026-01-01', fecha_vencimiento: '2026-01-01', dias_credito: 0, total: 0.3, tipo_comprobante: 'recibo', categoria: 'Otro' }],
    pagos: [{ id: 1, cxp_id: 1, fecha: '2026-01-01', monto: 0.1, metodo: 'efectivo' }, { id: 2, cxp_id: 1, fecha: '2026-01-02', monto: 0.2, metodo: 'efectivo' }] };
  const [r] = X.renglonesCxp(d);
  assert.strictEqual(r[12].result, 0.3);
  assert.strictEqual(r[10].result, 0);
  assert.strictEqual(r[17].result, 'PAGADO');
});

test('descarga CXP: hoja LISTA con las columnas del Excel y listas desplegables', () => {
  const l = X.listasCxp(DATOS, ['Luz', 'Otro', 'Renta de pipas']);
  assert.deepStrictEqual(l.map(x => x[0]), ['PROVEEDOR', 'BENEFICIARIO', 'CONCEPTO DE GASTO ', 'METODO DE PAGO', 'DIAS CREDITO', 'STATUS', 'TIPO GASTO']);
  assert.deepStrictEqual(l[0][1], ['Aceros Morlet', 'CFE', 'Pipas Oaxaca']);
  assert.deepStrictEqual(l[2][1], ['LUZ', 'OTRO', 'RENTA DE PIPAS']);
  assert.ok(['PUE', 'PPD', 'PAGADORA', 'LAYOUT', 'SIN FACTURA'].every(m => l[3][1].includes(m)));
  assert.deepStrictEqual(l[4][1], [0, 15]);
  assert.deepStrictEqual(l[5][1], ['PENDIENTE', 'PARCIAL', 'PAGADO']);
  assert.strictEqual(l[6][1].length, 9);
  // Columna de la hoja CXP → columna de LISTA (STATUS no lleva lista: es fórmula).
  assert.deepStrictEqual(X.VALIDACIONES_CXP, [['B', 'G'], ['C', 'A'], ['D', 'B'], ['I', 'D'], ['Q', 'C']]);
});

test('FOLIO FACTURA sin folio: la palabra del Excel según el comprobante', () => {
  assert.strictEqual(X.folioExcel({ factura_folio: 'A-12', tipo_comprobante: 'factura' }), 'A-12');
  assert.strictEqual(X.folioExcel({ tipo_comprobante: 'factura' }), '');
  assert.strictEqual(X.folioExcel({ tipo_comprobante: 'estado_cuenta' }), 'CORRIDA');
  assert.strictEqual(X.folioExcel({ tipo_comprobante: 'pagadora' }), 'PAGADORA');
  assert.strictEqual(X.folioExcel({ tipo_comprobante: 'otro' }), '');
});

test('descarga CXP: celdas vacías en amarillo, como en el Excel', () => {
  assert.strictEqual(X.COLOR_VACIA, 'FFFFD965');
  const s = X.sombreadoVacias(3, 20);
  assert.strictEqual(s.ref, 'A3:T5', 'de la A a la T, solo los renglones con datos');
  assert.deepStrictEqual(s.rules[0].formulae, ['LEN(TRIM(A3))=0']);
  assert.strictEqual(s.rules[0].style.fill.bgColor.argb, 'FFFFD965');
  assert.strictEqual(X.sombreadoVacias(1, 21).ref, 'A3:U3', 'con la columna SUCURSAL llega a la U');
  assert.strictEqual(X.sombreadoVacias(0, 20), null, 'sin renglones no hay sombreado');
});
