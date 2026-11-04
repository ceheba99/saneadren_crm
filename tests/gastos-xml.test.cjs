// Lector de CFDI (server/expediente-oc.js · leerCfdi) para gastos con XML (2026-11-04): solo los impuestos del comprobante,
// IVA e IEPS por separado, retenciones aparte, centavos exactos sin flotantes. Facturas inventadas.
const test = require('node:test'); const assert = require('node:assert');
const { leerCfdi } = require('../server/expediente-oc.js');
const { cfdi } = require('./cfdi-inventado.cjs');

test('gasolina: IVA e IEPS separados; los impuestos de cada concepto no se suman', () => {
  const d = leerCfdi(cfdi({ total: '1255.14', traslados: [['002', '160.00'], ['003', '95.14', 'Cuota', '0.453900']] }));
  assert.equal(d.impuestos.iva_cent, 16000); assert.equal(d.impuestos.ieps_cent, 9514); assert.equal(d.total_cent, 125514); assert.equal(d.subtotal_cent, 100000);
  assert.equal(d.version, '4.0'); assert.equal(d.tipo, 'I'); assert.match(d.uuid, /^[0-9A-F-]{36}$/);
});
test('sin impuestos y exenta: IVA 0', () => {
  assert.equal(leerCfdi(cfdi({ total: '500.00' })).impuestos.iva_cent, 0);
  assert.equal(leerCfdi(cfdi({ total: '250.00', traslados: [['002', '0', 'Exento']] })).impuestos.iva_cent, 0);
});
test('retenciones de ISR e IVA aparte del IVA trasladado', () => {
  const i = leerCfdi(cfdi({ total: '953.33', traslados: [['002', '160.00']], retenciones: [['001', '100.00'], ['002', '106.67']] })).impuestos;
  assert.deepEqual([i.iva_cent, i.ret_isr_cent, i.ret_iva_cent], [16000, 10000, 10667]);
});
test('centavos exactos (redondeo a 2 decimales sin flotantes)', () => {
  const x = (t, iva) => leerCfdi(cfdi({ total: t, subtotal: '1', traslados: [['002', iva]] }));
  assert.equal(x('229.90', '31.71').total_cent, 22990);
  assert.equal(x('1635.48', '225.584999').impuestos.iva_cent, 22558);
  assert.equal(x('1635.48', '225.585').impuestos.iva_cent, 22559);
  assert.equal(x('0.29', '0.04').total_cent, 29);
});
test('comillas sencillas, entidades en el nombre y BOM al inicio', () => {
  const xml = '﻿' + cfdi({ total: '116.00', traslados: [['002', '16.00']], emisorNombre: 'PIPAS &amp; LODOS' }).replace(/Total="116.00"/, "Total='116.00'");
  const d = leerCfdi(xml);
  assert.equal(d.total_cent, 11600); assert.equal(d.emisor_nombre, 'PIPAS & LODOS');
});
test('lo que no es CFDI devuelve null', () => {
  assert.equal(leerCfdi('<?xml version="1.0"?><pedido/>'), null);
});
