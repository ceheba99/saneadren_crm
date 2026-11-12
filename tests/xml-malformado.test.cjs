// A-03 (auditoría): un XML mal formado (etiquetas sin cerrar) hacía que el lector de facturas tardara cada vez más (tiempo cuadrático)
// y, como el servidor atiende una cosa a la vez, congelaba el sistema para todos. El lector debe tardar poco SIEMPRE y el XML tiene tope de tamaño.
// Las dos entradas (expediente de la orden de compra y /api/finanzas/cxp/leer-xml) usan este mismo lector y este mismo tope.
const test = require('node:test'); const assert = require('node:assert');
const { leerCfdi, MAX_XML_BYTES } = require('../server/expediente-oc.js');
const { cfdi } = require('./cfdi-inventado.cjs');

const CAB = '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Version="4.0" SubTotal="1.00" Total="1.00">';
const FORMAS = {
  'Conceptos sin cerrar': '<cfdi:Conceptos>',
  'Complemento sin cerrar': '<cfdi:Complemento>',
  'Impuestos sin cerrar': '<cfdi:Impuestos>',
  'Conceptos y Complemento sin cerrar': '<cfdi:Conceptos><cfdi:Complemento>',
  'etiquetas sin ">" final': '<cfdi:Impuestos ',
  'Comprobante repetido sin ">"': '<cfdi:Comprobante ',
  'Traslado repetido': '<cfdi:Impuestos><cfdi:Traslado Impuesto="002" Importe="1.00">',
};
const armar = f => CAB + f.repeat(Math.ceil(640 * 1024 / f.length));

for (const [nombre, f] of Object.entries(FORMAS)) {
  test(`XML de 640 KB con ${nombre}: se lee en menos de 100 ms`, () => {
    const xml = armar(f); const t = process.hrtime.bigint();
    leerCfdi(xml);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 100, `tardó ${ms.toFixed(0)} ms (debe ser < 100 ms)`);
  });
}
test('el tope de tamaño del XML es de 2 MB o menos', () => {
  assert.ok(Number.isInteger(MAX_XML_BYTES) && MAX_XML_BYTES <= 2 * 1024 * 1024 && MAX_XML_BYTES >= 1024 * 1024, 'MAX_XML_BYTES = ' + MAX_XML_BYTES);
});
test('un XML válido sigue leyéndose igual (impuestos del comprobante, retenciones, complemento y conceptos ignorados)', () => {
  const d = leerCfdi(cfdi({ total: '953.33', traslados: [['002', '160.00']], retenciones: [['001', '100.00'], ['002', '106.67']] }));
  assert.deepEqual([d.impuestos.iva_cent, d.impuestos.ret_isr_cent, d.impuestos.ret_iva_cent, d.total_cent], [16000, 10000, 10667, 95333]);
  assert.equal(d.impuestos.traslados.length, 1); assert.equal(d.impuestos.retenciones.length, 2);
  assert.equal(d.emisor_rfc, 'GAS010101AB1'); assert.match(d.uuid, /^[0-9A-F-]{36}$/);
});
test('un XML válido de 300 KB con muchas partidas se lee en menos de 100 ms y da lo mismo', () => {
  const base = cfdi({ total: '348.00', traslados: [['002', '48.00']] });
  const grande = base.replace('Descripcion="Concepto inventado"', 'Descripcion="' + 'Refacción inventada '.repeat(15000) + '"');
  const t = process.hrtime.bigint(); const d = leerCfdi(grande); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(grande.length > 250000 && ms < 100, `tardó ${ms.toFixed(0)} ms`); assert.equal(d.impuestos.iva_cent, 4800);
});
