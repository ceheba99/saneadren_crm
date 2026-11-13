/* Cuentas por pagar con las palabras del Excel «CUENTAS POR PAGAR QRO» (hoja CXP, listas de la hoja LISTA).
   Un solo lugar para el navegador (pantalla y descarga) y el servidor (que lo carga con require), para que
   el STATUS, el MÉTODO DE PAGO y el TIPO DE GASTO salgan iguales en todos lados.
   - TIPO DE GASTO: cada cuánto se repite o a qué plazo es el gasto (no es la categoría: esa es «Concepto de gasto»).
   - STATUS: nunca se captura; sale de los montos (lo pagado contra el total).
   - MÉTODO DE PAGO: se arma con el tipo de comprobante, el método del SAT (PUE/PPD) y la vía del pago. */
(function (raiz, crear) {
  const m = crear();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.CxpExcel = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // [clave guardada, como se ve en pantalla, como va en el Excel]. Lista de la columna G de la hoja LISTA (2026-11-12).
  const TIPOS_GASTO = [['semanal', 'Semanal', 'SEMANAL'], ['mensual', 'Mensual', 'MENSUAL'], ['bimestral', 'Bimestral', 'BIMESTRAL'],
    ['4_meses', '4 meses', '4 MESES'], ['24_meses', '24 meses', '24 MESES'], ['36_meses', '36 meses', '36 MESES'], ['48_meses', '48 meses', '48 MESES'],
    ['variable', 'Variable', 'VARIABLE'], ['unico', 'Único', 'UNICO']];
  const TIPO = Object.fromEntries(TIPOS_GASTO.map(([k, t, e]) => [k, { texto: t, excel: e }]));
  const esTipoGasto = k => Object.prototype.hasOwnProperty.call(TIPO, k);
  const tipoGastoTexto = k => (esTipoGasto(k) ? TIPO[k].texto : '');
  const tipoGastoExcel = k => (esTipoGasto(k) ? TIPO[k].excel : '');

  // STATUS de la hoja LISTA: solo PENDIENTE, PARCIAL y PAGADO (2026-11-12: «SIN FACTURA» es del comprobante y va en MÉTODO DE PAGO).
  const STATUS = ['PENDIENTE', 'PARCIAL', 'PAGADO'];
  const statusDe = (totalCent, pagadoCent) => (!(pagadoCent > 0) ? 'PENDIENTE' : pagadoCent < totalCent ? 'PARCIAL' : 'PAGADO');

  // MÉTODO DE PAGO de la hoja LISTA (columna D) más «SIN FACTURA», que el Excel usa en los gastos sin factura.
  const METODOS_EXCEL = ['PUE', 'PPD', 'PAGADORA', 'CALCULO FINIQUITO/LIQUIDACION', 'LINEA CAPTURA', 'INFORMATIVO', 'LAYOUT', 'DOMICILIACION', 'SIN FACTURA'];
  const POR_COMPROBANTE = { pagadora: 'PAGADORA', nomina: 'CALCULO FINIQUITO/LIQUIDACION', linea_captura: 'LINEA CAPTURA', informativo: 'INFORMATIVO' };
  const POR_VIA = { layout: 'LAYOUT', domiciliado: 'DOMICILIACION' };
  // x: { tipo_comprobante, metodo_sat }; via: vía del último pago (si ya se pagó).
  // Factura → PUE/PPD (vacío si no se capturó). Recibo, estado de cuenta, otro o sin factura → LAYOUT o DOMICILIACION
  // si así se pagó; si no, SIN FACTURA. Sin tipo de comprobante (registros viejos) → vacío.
  function metodoExcel(x, via) {
    const t = x?.tipo_comprobante;
    if (!t) return '';
    if (t === 'factura') return ['PUE', 'PPD'].includes(x.metodo_sat) ? x.metodo_sat : '';
    if (POR_COMPROBANTE[t]) return POR_COMPROBANTE[t];
    return POR_VIA[via] || 'SIN FACTURA';
  }

  // «capturo» como en el Excel: el primer nombre en mayúsculas (MARCO, LETTY).
  const capturoCorto = nombre => String(nombre || '').trim().split(/\s+/)[0].toLocaleUpperCase('es-MX');

  return { TIPOS_GASTO, esTipoGasto, tipoGastoTexto, tipoGastoExcel, STATUS, statusDe, METODOS_EXCEL, metodoExcel, capturoCorto };
});
