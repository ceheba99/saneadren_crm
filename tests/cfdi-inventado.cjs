// Facturas electrónicas (CFDI 4.0) INVENTADAS para las pruebas: RFC, nombres, folios y UUID no son de nadie.
// cfdi({ total: '1160.00', traslados: [['002', '160.00']], ... }) arma el XML con los impuestos del comprobante y,
// adentro de cada concepto, impuestos que NO deben sumarse dos veces (el lector solo lee los del comprobante).
const RECEPTOR_RFC = 'SAN010101AB1'; // RFC inventado de «Saneadren» para las pruebas (va en FACTURA_PROD_EMISOR_RFC)
let n = 0;
const uuidNuevo = () => { n++; return ('5A1D0C0B-0000-4000-8000-' + String(Date.now() % 1e8).padStart(8, '0') + String(n).padStart(4, '0')).toUpperCase(); };
function cfdi({ uuid = uuidNuevo(), version = '4.0', tipo = 'I', serie = 'G', folio = String(1000 + n), fecha = '2026-11-01T10:15:00', moneda = 'MXN', tipoCambio, metodo = 'PUE',
  emisorRfc = 'GAS010101AB1', emisorNombre = 'GASOLINERA INVENTADA DEL BAJIO', receptorRfc = RECEPTOR_RFC, receptorNombre = 'SANEADREN',
  subtotal, descuento, total, traslados = [], retenciones = [], locales = false, sinImpuestos = false } = {}) {
  const sumar = l => l.reduce((t, [, i]) => t + Math.round(Number(i) * 100), 0);
  const tTras = sumar(traslados), tRet = sumar(retenciones);
  const sub = subtotal ?? ((Math.round(Number(total) * 100) - tTras + tRet + Math.round(Number(descuento || 0) * 100)) / 100).toFixed(2);
  const impuestos = sinImpuestos || (!traslados.length && !retenciones.length) ? '' :
    `<cfdi:Impuestos${tRet ? ` TotalImpuestosRetenidos="${(tRet / 100).toFixed(2)}"` : ''}${tTras ? ` TotalImpuestosTrasladados="${(tTras / 100).toFixed(2)}"` : ''}>`
    + (retenciones.length ? '<cfdi:Retenciones>' + retenciones.map(([imp, i]) => `<cfdi:Retencion Impuesto="${imp}" Importe="${i}"/>`).join('') + '</cfdi:Retenciones>' : '')
    + (traslados.length ? '<cfdi:Traslados>' + traslados.map(([imp, i, factor = 'Tasa', tasa = imp === '002' ? '0.160000' : '0.080000']) =>
      factor === 'Exento' ? `<cfdi:Traslado Base="${sub}" Impuesto="${imp}" TipoFactor="Exento"/>` : `<cfdi:Traslado Base="${sub}" Impuesto="${imp}" TipoFactor="${factor}" TasaOCuota="${tasa}" Importe="${i}"/>`).join('') + '</cfdi:Traslados>' : '')
    + '</cfdi:Impuestos>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="${version}" Serie="${serie}" Folio="${folio}" Fecha="${fecha}"
  SubTotal="${sub}"${descuento ? ` Descuento="${descuento}"` : ''} Moneda="${moneda}"${tipoCambio ? ` TipoCambio="${tipoCambio}"` : ''} Total="${total}" TipoDeComprobante="${tipo}" Exportacion="01" MetodoPago="${metodo}" LugarExpedicion="76000">
  <cfdi:Emisor Rfc="${emisorRfc}" Nombre="${emisorNombre}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${receptorRfc}" Nombre="${receptorNombre}" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="H87" Descripcion="Concepto inventado" ValorUnitario="${sub}" Importe="${sub}" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${sub}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="99999.99"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  ${impuestos}
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="${fecha}" RfcProvCertif="AAA010101AAA" SelloCFD="x" NoCertificadoSAT="00001000000000000000" SelloSAT="x"/>
    ${locales ? '<implocal:ImpuestosLocales xmlns:implocal="http://www.sat.gob.mx/implocal" version="1.0" TotaldeRetenciones="0.00" TotaldeTraslados="20.00"><implocal:TrasladosLocales ImpLocTrasladado="ISH" TasadeTraslado="3.00" Importe="20.00"/></implocal:ImpuestosLocales>' : ''}
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}
module.exports = { cfdi, uuidNuevo, RECEPTOR_RFC };
